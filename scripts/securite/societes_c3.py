#!/usr/bin/env python3
"""Chantier C3 : interface multi-sociétés, partie base (migration 0277).

- Vue groupe (lecture seule) : en-tête x-company-id = « groupe », réservé aux appartenances « vue groupe » ; la
  société courante est alors vide (toute écriture refusée par les règles de C2) et les droits sont ceux que le
  compte a dans TOUTES ses sociétés (intersection : jamais plus que dans une seule).
- Modules par société : app.module_on(clé) = module installé sur l'instance ET actif dans la société courante
  (vue groupe : actif dans une des sociétés visibles).
- Création d'une société en une fois (company_create, réservé à la plateforme) : société, siège, modules, réglages de
  facturation, premières appartenances.
- Identité de la société d'un document (app.identite_societe) : réglages de l'organisme pour la société de l'instance,
  fiche de la société pour les autres ; utilisée par le contrôle et l'émission des factures (vendeur figé).
- Recopie des profils vers les appartenances : seulement pour un compte qui n'a encore aucune société (un compte
  propre à une autre société n'est plus rattaché d'office à la société de l'instance).
- Contexte de l'écran (my_company_context) : sociétés du compte, rôle, vue groupe possible, modules actifs.

Le script lit billing_issue et app.billing_check dans une base locale équivalente à la production et les modifie
(chaque remplacement doit s'appliquer exactement une fois) ; le retour arrière remet les définitions lues.
Utilisation : python3 scripts/securite/societes_c3.py --base <base locale après 0276>
"""
import argparse
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

LUES = ['app.current_company()', 'app.rights()', 'app.module_on(text)', 'app.sync_profile_member()',
        'public.billing_issue(uuid)', 'app.billing_check(uuid)', 'public.generate_session_reference_v3()', 'public.billing_next_number(text)']

REMPLACEMENTS = [
    ('public.billing_issue(uuid)',
     "        where i.issued_at is not null and i.type = inv.type and i.reference like v_prefix || '%'), 0);",
     "        where i.issued_at is not null and i.type = inv.type and i.company_id = v_company and i.reference like v_prefix || '%'), 0);"),
    ('public.billing_issue(uuid)',
     "  if exists (select 1 from public.invoices where reference = v_ref) then",
     "  if exists (select 1 from public.invoices where reference = v_ref and company_id = v_company) then"),
    ('public.billing_next_number(text)',
     "        where i.issued_at is not null and i.type = p_type and i.reference like v_prefix || '%'), 0);",
     "        where i.issued_at is not null and i.type = p_type and i.company_id = v_company and i.reference like v_prefix || '%'), 0);"),
    ('public.billing_issue(uuid)',
     "    into v_seller from public.organization_settings o limit 1;",
     "    into v_seller from app.identite_societe(inv.company_id) o;"),
    ('app.billing_check(uuid)',
     "  select * into o from public.organization_settings limit 1;",
     "  o := app.identite_societe(inv.company_id);"),
    ('public.generate_session_reference_v3()',
     "select nullif(trim(doc_prefix), '') into v_prefix from organization_settings limit 1;",
     "select nullif(trim(o.doc_prefix), '') into v_prefix from app.identite_societe(new.company_id) o;"),
]

NOUVELLES = r"""
-- En-tête « groupe » : vue groupe demandée
create or replace function app.header_groupe()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_h text := current_setting('request.headers', true);
begin
  return coalesce(v_h is not null and v_h <> '' and v_h::json ->> 'x-company-id' = 'groupe', false);
exception when others then
  return false;
end
$$;

-- Vue groupe en cours : demandée et permise (appartenance active « vue groupe »)
create or replace function app.vue_groupe()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.header_groupe() and exists (
    select 1 from public.company_members m join public.profiles p on p.id = m.profile_id
    where m.profile_id = (select auth.uid()) and m.is_active and m.can_consolidate and p.is_active)
$$;

create or replace function app.current_company()
 returns uuid
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case when app.vue_groupe() then null else coalesce(
    (select h.v from (select app.header_company() as v) h
      where h.v in (select app.visible_companies())),
    (select m.company_id from public.company_members m
      where m.profile_id = (select auth.uid()) and m.is_active and m.is_default
        and m.company_id in (select app.visible_companies())
      limit 1),
    (select c.id from public.companies c
      where c.id in (select app.visible_companies())
      order by c.is_instance_owner desc, c.position, c.created_at
      limit 1)) end
$function$;

-- Droits : ceux de la société courante ; en vue groupe, ceux que le compte a dans toutes ses sociétés
create or replace function app.rights()
 returns text[]
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case when app.vue_groupe() then
    (select coalesce(array_agg(x.code order by x.code), '{}'::text[]) from (
       select r.code from app.visible_companies() v, unnest(app.rights_for((select auth.uid()), v)) r(code)
       group by r.code having count(*) = (select count(*) from app.visible_companies())) x)
  else app.rights_for((select auth.uid()), app.current_company()) end
$function$;

-- Module actif : installé sur l'instance et actif dans la société courante (vue groupe : dans une des sociétés
-- visibles) ; une société sans aucune ligne de modules suit les modules de l'instance (compatibilité)
create or replace function app.module_on(p_key text)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select coalesce((select m.enabled from public.org_modules m where m.key = p_key), false)
    and case
      when app.current_company() is null and app.vue_groupe() then
        exists (select 1 from public.company_modules cm where cm.key = p_key and cm.enabled
                and cm.company_id in (select app.visible_companies()))
      when not exists (select 1 from public.company_modules cm where cm.company_id = app.current_company()) then true
      else coalesce((select cm.enabled from public.company_modules cm
                     where cm.company_id = app.current_company() and cm.key = p_key), false)
    end
$function$;

-- Identité juridique d'une société, sous la forme des réglages de l'organisme : la société de l'instance garde ses
-- réglages (saisis dans Paramètres) ; une autre société prend les champs de sa fiche
create or replace function app.identite_societe(p_company uuid)
returns public.organization_settings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organization_settings;
  c public.companies;
  v_siret text;
begin
  select * into o from public.organization_settings limit 1;
  select * into c from public.companies where id = p_company;
  if c.id is null or c.is_instance_owner then
    return o;
  end if;
  select e.siret into v_siret from public.company_establishments e where e.company_id = c.id and e.is_head_office limit 1;
  o.name := coalesce(c.short_name, c.legal_name);
  o.legal_name := c.legal_name;
  o.forme_juridique := c.legal_form;
  o.capital_social := c.capital;
  o.siren := c.siren;
  o.siret := v_siret;
  o.naf := c.naf;
  o.tva_intra := c.vat_number;
  o.tva_applicable := c.vat_applicable;
  o.rcs := c.rcs;
  o.nda := c.nda;
  o.address := c.address;
  o.postal_code := c.postal_code;
  o.city := c.city;
  o.phone := c.phone;
  o.email := c.email;
  o.website := c.website;
  o.bank_name := c.bank_name;
  o.iban := c.iban;
  o.bic := c.bic;
  o.logo_url := coalesce(c.logo_url, o.logo_url);
  o.doc_prefix := c.doc_prefix;
  return o;
end
$$;

-- Recopie des profils : un compte sans société est rattaché à la société de l'instance ; ensuite, seul le rôle de
-- l'appartenance existante suit le profil (un compte propre à une autre société n'est plus ajouté d'office)
create or replace function app.sync_profile_member()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_company uuid;
  v_role text := app.member_role(new.role);
begin
  select c.id into v_company from public.companies c where c.is_instance_owner;
  if v_company is null then
    return new;
  end if;
  if v_role is null then
    update public.company_members m set is_active = false, updated_at = now()
     where m.company_id = v_company and m.profile_id = new.id and m.is_active;
    return new;
  end if;
  if exists (select 1 from public.company_members m where m.profile_id = new.id and m.company_id = v_company) then
    update public.company_members m set role = v_role, updated_at = now()
     where m.company_id = v_company and m.profile_id = new.id and m.role is distinct from v_role;
    -- Compte désactivé ou réactivé : l'appartenance suit ; sinon son état (retirée d'une société) est gardé
    if tg_op = 'UPDATE' and old.is_active is distinct from new.is_active then
      update public.company_members m set is_active = coalesce(new.is_active, true), updated_at = now()
       where m.company_id = v_company and m.profile_id = new.id;
    end if;
  elsif not exists (select 1 from public.company_members m where m.profile_id = new.id) then
    insert into public.company_members (company_id, profile_id, role, can_consolidate, is_default, is_active)
    values (v_company, new.id, v_role, v_role = 'admin', true, coalesce(new.is_active, true));
  end if;
  return new;
end
$function$;

-- Contexte de l'écran : sociétés du compte, vue groupe, modules de la société courante
create or replace function public.my_company_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'current', app.current_company(),
    'vue_groupe', app.vue_groupe(),
    'peut_vue_groupe', exists (select 1 from public.company_members m where m.profile_id = (select auth.uid())
                               and m.is_active and m.can_consolidate),
    'societes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'legal_name', c.legal_name, 'short_name', c.short_name,
                  'logo_url', c.logo_url, 'status', c.status, 'is_instance_owner', c.is_instance_owner,
                  'role', app.company_role(c.id),
                  'is_default', coalesce((select m.is_default from public.company_members m where m.company_id = c.id and m.profile_id = (select auth.uid())), false))
                  order by c.is_instance_owner desc, c.position, c.legal_name)
                from public.companies c where c.id in (select app.visible_companies())), '[]'::jsonb),
    'modules', coalesce((select jsonb_agg(m.key order by m.key) from public.org_modules m where app.module_on(m.key)), '[]'::jsonb))
$$;

-- Création d'une société en une fois (assistant Paramètres › Sociétés), réservée à la plateforme
create or replace function public.company_create(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_siret text := nullif(regexp_replace(coalesce(p ->> 'siret', ''), '\D', '', 'g'), '');
  v_siren text := nullif(left(regexp_replace(coalesce(p ->> 'siren', p ->> 'siret', ''), '\D', '', 'g'), 9), '');
  m jsonb;
  k text;
begin
  if not app.a_le_droit('plateforme.administrer') then
    raise exception 'Réservé au super administrateur' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p ->> 'legal_name', '')), '') is null then
    raise exception 'Raison sociale obligatoire' using errcode = '22023';
  end if;
  if v_siren is not null and exists (select 1 from public.companies c where c.siren = v_siren) then
    raise exception 'Une société avec ce SIREN existe déjà' using errcode = '23505';
  end if;
  insert into public.companies (legal_name, short_name, legal_form, capital, siren, vat_number, vat_applicable, rcs, naf, idcc,
    fiscal_year_start_month, is_training_org, nda, address, postal_code, city, phone, email, website, bank_name, iban, bic,
    logo_url, doc_prefix, position)
  values (btrim(p ->> 'legal_name'), nullif(btrim(coalesce(p ->> 'short_name', '')), ''), nullif(p ->> 'legal_form', ''),
    nullif(p ->> 'capital', ''), v_siren, nullif(p ->> 'vat_number', ''), coalesce((p ->> 'vat_applicable')::boolean, true),
    nullif(p ->> 'rcs', ''), nullif(p ->> 'naf', ''), nullif(p ->> 'idcc', ''),
    coalesce((p ->> 'fiscal_year_start_month')::int, 1), coalesce((p ->> 'is_training_org')::boolean, false), nullif(p ->> 'nda', ''),
    nullif(p ->> 'address', ''), nullif(p ->> 'postal_code', ''), nullif(p ->> 'city', ''), nullif(p ->> 'phone', ''),
    nullif(p ->> 'email', ''), nullif(p ->> 'website', ''), nullif(p ->> 'bank_name', ''), nullif(p ->> 'iban', ''),
    nullif(p ->> 'bic', ''), nullif(p ->> 'logo_url', ''), nullif(upper(p ->> 'doc_prefix'), ''),
    coalesce((select max(position) + 1 from public.companies), 1))
  returning id into v_id;
  insert into public.company_establishments (company_id, siret, name, address, postal_code, city, is_head_office)
  values (v_id, v_siret, nullif(btrim(coalesce(p ->> 'short_name', p ->> 'legal_name')), ''), nullif(p ->> 'address', ''),
          nullif(p ->> 'postal_code', ''), nullif(p ->> 'city', ''), true);
  for k in select m2.key from public.org_modules m2 loop
    insert into public.company_modules (company_id, key, enabled)
    values (v_id, k, coalesce((p -> 'modules') ? k, false));
  end loop;
  insert into public.billing_settings (company_id, invoice_prefix, credit_prefix)
  values (v_id, coalesce(nullif(upper(p ->> 'invoice_prefix'), ''), 'FACT'), coalesce(nullif(upper(p ->> 'credit_prefix'), ''), 'AVR'))
  on conflict (company_id) do nothing;
  for m in select * from jsonb_array_elements(coalesce(p -> 'members', '[]'::jsonb)) loop
    insert into public.company_members (company_id, profile_id, role, can_consolidate, is_default, is_active, granted_by)
    values (v_id, (m ->> 'profile_id')::uuid, m ->> 'role', coalesce((m ->> 'can_consolidate')::boolean, false),
            not exists (select 1 from public.company_members d where d.profile_id = (m ->> 'profile_id')::uuid and d.is_default),
            true, (select auth.uid()))
    on conflict (company_id, profile_id) do update set role = excluded.role, can_consolidate = excluded.can_consolidate, is_active = true;
  end loop;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_name, details, company_id)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'create', 'system', 'Société créée : ' || btrim(p ->> 'legal_name'),
          jsonb_build_object('company_id', v_id, 'modules', p -> 'modules'), v_id);
  return v_id;
end
$$;

-- Accès d'une personne à une société (Paramètres › Sociétés) : administrateur de la société ou plateforme ;
-- jamais pour un super administrateur (rôle de plateforme, sans appartenance) ; journal d'audit
create or replace function public.company_member_set(p_company uuid, p_profile uuid, p_role text, p_can_consolidate boolean default false,
                                                     p_active boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (app.a_le_droit('plateforme.administrer') or app.is_company_admin(p_company)) then
    raise exception 'Accès refusé : réservé à l''administrateur de la société' using errcode = '42501';
  end if;
  if not exists (select 1 from public.companies where id = p_company) then
    raise exception 'Société inconnue' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.profiles where id = p_profile and role = 'superadmin') then
    raise exception 'Le super administrateur n''a pas d''appartenance' using errcode = '22023';
  end if;
  insert into public.company_members (company_id, profile_id, role, can_consolidate, is_default, is_active, granted_by)
  values (p_company, p_profile, p_role, coalesce(p_can_consolidate, false),
          not exists (select 1 from public.company_members d where d.profile_id = p_profile and d.is_default and d.is_active),
          coalesce(p_active, true), (select auth.uid()))
  on conflict (company_id, profile_id) do update
    set role = excluded.role, can_consolidate = excluded.can_consolidate, is_active = excluded.is_active, updated_at = now();
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details, company_id)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'system', p_profile, 'Accès à une société',
          jsonb_build_object('role', p_role, 'vue_groupe', p_can_consolidate, 'actif', p_active), p_company);
end
$$;
revoke all on function public.company_member_set(uuid, uuid, text, boolean, boolean) from public, anon;
grant execute on function public.company_member_set(uuid, uuid, text, boolean, boolean) to authenticated, service_role;

-- Module d'une société (Paramètres › Sociétés) : administrateur de la société ou plateforme ; la société de l'instance
-- suit les modules installés (Console), recopiés à sens unique
create or replace function public.company_module_set(p_company uuid, p_key text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (app.a_le_droit('plateforme.administrer') or app.is_company_admin(p_company)) then
    raise exception 'Accès refusé : réservé à l''administrateur de la société' using errcode = '42501';
  end if;
  if exists (select 1 from public.companies where id = p_company and is_instance_owner) then
    raise exception 'Les modules de la société de l''instance se règlent dans la Console' using errcode = '22023';
  end if;
  if not exists (select 1 from public.org_modules where key = p_key) then
    raise exception 'Module non installé : %', p_key using errcode = '22023';
  end if;
  insert into public.company_modules (company_id, key, enabled) values (p_company, p_key, coalesce(p_enabled, false))
  on conflict (company_id, key) do update set enabled = excluded.enabled, updated_at = now();
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_name, details, company_id)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'system', 'Module d''une société',
          jsonb_build_object('module', p_key, 'actif', p_enabled), p_company);
end
$$;
revoke all on function public.company_module_set(uuid, text, boolean) from public, anon;
grant execute on function public.company_module_set(uuid, text, boolean) to authenticated, service_role;

-- Numéros uniques par société (factures, devis, sessions) : deux sociétés peuvent avoir le même format de numéro
do $$
declare t text;
begin
  foreach t in array array['invoices', 'quotes', 'sessions'] loop
    if exists (select 1 from pg_constraint where conname = t || '_reference_key') then
      execute format('alter table public.%I drop constraint %I', t, t || '_reference_key');
    end if;
    execute format('create unique index if not exists %I on public.%I (company_id, reference)', t || '_societe_reference_uniq', t);
  end loop;
end
$$;

-- Réglages de facturation d'une société créée autrement (sécurité)
create or replace function app.company_billing_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.billing_settings (company_id) values (new.id) on conflict (company_id) do nothing;
  return new;
end
$$;
drop trigger if exists companies_billing_settings on public.companies;
create trigger companies_billing_settings after insert on public.companies
  for each row execute function app.company_billing_settings();

-- Identité de la société courante pour l'écran (PDF, emails) : réglages de l'organisme ou fiche de la société
create or replace function public.company_identity()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.a_le_droit('organisation.reglages.voir')
    then to_jsonb(app.identite_societe(app.current_company())) - 'comptable_email' - 'comptable_cc' - 'comptable_bcc' - 'email_bcc'
    else null end
$$;
revoke all on function public.company_identity() from public, anon;
grant execute on function public.company_identity() to authenticated, service_role;

revoke all on function app.header_groupe(), app.vue_groupe(), app.identite_societe(uuid), app.company_billing_settings() from public, anon;
grant execute on function app.header_groupe(), app.vue_groupe(), app.identite_societe(uuid) to authenticated, service_role;
revoke all on function public.my_company_context(), public.company_create(jsonb) from public, anon;
grant execute on function public.my_company_context(), public.company_create(jsonb) to authenticated, service_role;
"""

ENTETE = """-- 0277_societes_interface.sql : interface multi-sociétés, partie base (chantier C3).
-- FICHIER GÉNÉRÉ par scripts/securite/societes_c3.py. Ne pas modifier à la main.
--
-- Vue groupe en lecture seule (en-tête « groupe », appartenances « vue groupe », droits communs à toutes ses
-- sociétés), modules par société, création d'une société en une fois (plateforme), identité de la société d'un
-- document pour le contrôle et l'émission des factures, recopie des profils limitée aux comptes sans société,
-- contexte de l'écran. Avec une seule société, rien ne change.
-- Idempotente. Retour arrière : supabase/rollback/0277_societes_interface_retour.sql
"""


def psql(args, sql):
    r = subprocess.run(['psql', '-X', '-At', '-h', args.hote, '-p', str(args.port), '-U', 'postgres', '-d', args.base, '-c', sql],
                       text=True, capture_output=True, check=True)
    return r.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True)
    ap.add_argument('--hote', default='/var/tmp/pgodet')
    ap.add_argument('--port', default=54329, type=int)
    args = ap.parse_args()
    originaux = {s: psql(args, f"select pg_get_functiondef('{s}'::regprocedure)").rstrip('\n') + ';\n' for s in LUES}
    modifies = {}
    for sig, old, new in REMPLACEMENTS:
        d = modifies.get(sig, originaux[sig])
        assert d.count(old) == 1, (sig, d.count(old))
        modifies[sig] = d.replace(old, new)
    out = [ENTETE, NOUVELLES]
    for sig, d in modifies.items():
        out.append(f"\n-- {sig}\n" + d)
    out.append("\ninsert into public.schema_migrations (version) values ('0277_societes_interface') on conflict (version) do nothing;\n")
    (ROOT / 'supabase/migrations/0277_societes_interface.sql').write_text('\n'.join(out), encoding='utf-8')
    rb = ["""-- Retour arrière de 0277_societes_interface.sql : fonctions d'avant C3 remises, nouvelles fonctions retirées.
-- FICHIER GÉNÉRÉ par scripts/securite/societes_c3.py. Refusé s'il existe plus d'une société.

do $$
begin
  if (select count(*) from public.companies) > 1 then
    raise exception 'Retour arrière refusé : plusieurs sociétés existent';
  end if;
end
$$;
"""]
    for sig in LUES:
        rb.append(f"\n-- {sig}\n" + originaux[sig])
    rb.append("""
drop trigger if exists companies_billing_settings on public.companies;
drop function if exists app.company_billing_settings();
do $$
declare t text;
begin
  foreach t in array array['invoices', 'quotes', 'sessions'] loop
    execute format('drop index if exists public.%I', t || '_societe_reference_uniq');
    if not exists (select 1 from pg_constraint where conname = t || '_reference_key') then
      execute format('alter table public.%I add constraint %I unique (reference)', t, t || '_reference_key');
    end if;
  end loop;
end
$$;
drop function if exists public.company_create(jsonb);
drop function if exists public.company_member_set(uuid, uuid, text, boolean, boolean);
drop function if exists public.company_identity();
drop function if exists public.company_module_set(uuid, text, boolean);
drop function if exists public.my_company_context();
drop function if exists app.identite_societe(uuid);
drop function if exists app.vue_groupe();
drop function if exists app.header_groupe();

delete from public.schema_migrations where version = '0277_societes_interface';
""")
    (ROOT / 'supabase/rollback/0277_societes_interface_retour.sql').write_text('\n'.join(rb), encoding='utf-8')
    print('0277 écrite')


if __name__ == '__main__':
    main()

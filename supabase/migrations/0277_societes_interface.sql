-- 0277_societes_interface.sql : interface multi-sociétés, partie base (chantier C3).
-- FICHIER GÉNÉRÉ par scripts/securite/societes_c3.py. Ne pas modifier à la main.
--
-- Vue groupe en lecture seule (en-tête « groupe », appartenances « vue groupe », droits communs à toutes ses
-- sociétés), modules par société, création d'une société en une fois (plateforme), identité de la société d'un
-- document pour le contrôle et l'émission des factures, recopie des profils limitée aux comptes sans société,
-- contexte de l'écran. Avec une seule société, rien ne change.
-- Idempotente. Retour arrière : supabase/rollback/0277_societes_interface_retour.sql


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


-- public.billing_issue(uuid)
CREATE OR REPLACE FUNCTION public.billing_issue(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inv public.invoices;
  v_company uuid := app.billing_company();
  s public.billing_settings;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_prefix text;
  v_last bigint;
  v_ref text;
  t jsonb;
  v_parent public.invoices;
  v_credites numeric;
  v_seller jsonb;
  v_buyer jsonb;
  v_check jsonb;
  v_bloquants text;
begin
  /* société (C2) */ perform app.exiger_societe('invoices', p_invoice, true);
  select * into inv from public.invoices where id = p_invoice for update;
  if inv.id is null then
    raise exception 'Document introuvable' using errcode = 'P0002';
  end if;
  if not app.a_le_droit(case when inv.type = 'credit_note' then 'facturation.avoirs.emettre' else 'facturation.factures.valider' end) then
    raise exception 'Accès refusé : émettre ce document ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  if inv.issued_at is not null then
    raise exception 'Ce document est déjà émis (%)', inv.reference using errcode = '22023';
  end if;
  if inv.client_id is null then
    raise exception 'Client manquant' using errcode = '22023';
  end if;
  if not exists (select 1 from public.invoice_items where invoice_id = p_invoice) then
    raise exception 'Document sans ligne' using errcode = '22023';
  end if;

  -- Mentions obligatoires (0363) : un seul point bloquant suffit à refuser l'émission
  v_check := app.billing_check(p_invoice);
  select string_agg(p ->> 'libelle', ' ; ') into v_bloquants
  from jsonb_array_elements(v_check -> 'points') p where (p ->> 'bloquant')::boolean;
  if v_bloquants is not null then
    raise exception 'Émission impossible, à compléter : %', v_bloquants using errcode = '22023';
  end if;

  t := public.billing_compute_totals(p_invoice);
  if inv.type = 'credit_note' then
    select * into v_parent from public.invoices where id = inv.parent_invoice_id;
    if v_parent.id is null or v_parent.issued_at is null then
      raise exception 'Un avoir se rattache à une facture émise' using errcode = '22023';
    end if;
    select coalesce(sum(total_ttc), 0) into v_credites from public.invoices
    where parent_invoice_id = v_parent.id and type = 'credit_note' and issued_at is not null;
    if v_credites + (t ->> 'total_ttc')::numeric > coalesce(v_parent.total_ttc, 0) + 0.01 then
      raise exception 'Avoirs supérieurs au montant de la facture % (% € déjà crédités)', v_parent.reference, v_credites
        using errcode = '22023';
    end if;
  elsif (t ->> 'total_ttc')::numeric <= 0 then
    raise exception 'Facture d''un montant nul ou négatif : utiliser un avoir' using errcode = '22023';
  end if;

  -- Réglages et compteur de la société (ligne verrouillée jusqu'à la fin de la transaction)
  insert into public.billing_settings (company_id) values (v_company) on conflict (company_id) do nothing;
  select * into s from public.billing_settings where company_id = v_company;
  v_prefix := case when inv.type = 'credit_note' then s.credit_prefix else s.invoice_prefix end;
  select q.last_number into v_last from public.billing_sequences q
  where q.company_id = v_company and q.series = inv.type for update;
  if v_last is null then
    v_last := coalesce(case when inv.type = 'credit_note' then s.credit_last_number_before else s.invoice_last_number_before end,
      (select max((regexp_match(i.reference, '([0-9]+)$'))[1]::bigint) from public.invoices i
        where i.issued_at is not null and i.type = inv.type and i.company_id = v_company and i.reference like v_prefix || '%'), 0);
    insert into public.billing_sequences (company_id, series, last_number) values (v_company, inv.type, v_last)
    on conflict (company_id, series) do nothing;
    select q.last_number into v_last from public.billing_sequences q
    where q.company_id = v_company and q.series = inv.type for update;
  end if;
  v_ref := app.billing_format(s.number_format, v_prefix, v_today, v_last + 1);
  if exists (select 1 from public.invoices where reference = v_ref and company_id = v_company) then
    raise exception 'Numéro % déjà utilisé : vérifier le dernier numéro dans les réglages de facturation', v_ref
      using errcode = '23505';
  end if;
  update public.billing_sequences set last_number = v_last + 1, updated_at = now()
  where company_id = v_company and series = inv.type;

  -- Coordonnées figées (vendeur : réglages de l'organisme ; client et payeur : fiches au moment de l'émission)
  select jsonb_strip_nulls(jsonb_build_object('name', o.name, 'legal_name', o.legal_name, 'forme_juridique', o.forme_juridique,
           'capital_social', o.capital_social, 'siret', o.siret, 'siren', o.siren, 'naf', o.naf, 'tva_intra', o.tva_intra,
           'rcs', o.rcs, 'nda', o.nda, 'address', o.address, 'postal_code', o.postal_code, 'city', o.city,
           'phone', o.phone, 'email', o.email, 'website', o.website))
    into v_seller from app.identite_societe(inv.company_id) o;
  select jsonb_strip_nulls(jsonb_build_object('client', (select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name,
           'address', c.address, 'postal_code', c.postal_code, 'city', c.city, 'siret', c.siret, 'siren', c.siren, 'tva', c.tva,
           'client_type', c.client_type)) from public.clients c where c.id = inv.client_id),
         'payeur', (select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name, 'address', c.address,
           'postal_code', c.postal_code, 'city', c.city, 'siret', c.siret, 'siren', c.siren, 'tva', c.tva))
           from public.clients c where c.id = inv.billing_client_id)))
    into v_buyer;

  update public.invoices set
    reference = v_ref,
    issued_at = now(),
    issued_by = (select auth.uid()),
    due_date = case when inv.due_date is not null and inv.invoice_date is not null
                    then v_today + (inv.due_date - inv.invoice_date) else inv.due_date end,
    invoice_date = v_today,
    total_ht = (t ->> 'total_ht')::numeric,
    total_discount = (t ->> 'total_discount')::numeric,
    total_net_ht = (t ->> 'total_net_ht')::numeric,
    total_tva = (t ->> 'total_tva')::numeric,
    total_ttc = (t ->> 'total_ttc')::numeric,
    amount_due = case when inv.type = 'credit_note' then inv.amount_due
                      else greatest(0, (t ->> 'total_ttc')::numeric - coalesce(inv.amount_paid, 0) - coalesce(inv.amount_credited, 0)) end,
    status = 'due',
    seller_snapshot = v_seller,
    buyer_snapshot = v_buyer,
    legal_mentions = v_check -> 'mentions',
    nature_operation = v_check ->> 'nature',
    updated_at = now()
  where id = p_invoice;

  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'document', p_invoice, v_ref,
          jsonb_build_object('emission', true, 'type', inv.type));

  return jsonb_build_object('reference', v_ref, 'invoice_date', v_today, 'total_ttc', (t ->> 'total_ttc')::numeric);
end
$function$;


-- public.billing_next_number(text)
CREATE OR REPLACE FUNCTION public.billing_next_number(p_type text DEFAULT 'invoice'::text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company uuid := app.billing_company();
  s public.billing_settings;
  v_prefix text;
  v_last bigint;
begin
  if not (app.a_le_droit('facturation.factures.voir')) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select * into s from public.billing_settings where company_id = v_company;
  v_prefix := case when p_type = 'credit_note' then coalesce(s.credit_prefix, 'AVR') else coalesce(s.invoice_prefix, 'FACT') end;
  select q.last_number into v_last from public.billing_sequences q where q.company_id = v_company and q.series = p_type;
  if v_last is null then
    v_last := coalesce(case when p_type = 'credit_note' then s.credit_last_number_before else s.invoice_last_number_before end,
      (select max((regexp_match(i.reference, '([0-9]+)$'))[1]::bigint) from public.invoices i
        where i.issued_at is not null and i.type = p_type and i.company_id = v_company and i.reference like v_prefix || '%'), 0);
  end if;
  return app.billing_format(coalesce(s.number_format, '{PREFIXE}-{AAAAMMJJ}-{N5}'), v_prefix,
                            (now() at time zone 'Europe/Paris')::date, v_last + 1);
end
$function$;


-- app.billing_check(uuid)
CREATE OR REPLACE FUNCTION app.billing_check(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inv public.invoices;
  c public.clients;
  o public.organization_settings;
  s public.billing_settings;
  v_pts jsonb := '[]'::jsonb;
  v_ment jsonb := '[]'::jsonb;
  v_pro boolean;
  v_public boolean;
  v_credit boolean;
  v_net numeric;
  v_n_bien int;
  v_n_service int;
  v_exo boolean;
  v_auto boolean;
  v_franchise boolean;
  v_societe boolean;
  v_ident text;
  v_regle record;
begin
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null then
    raise exception 'Document introuvable' using errcode = 'P0002';
  end if;
  select * into c from public.clients where id = coalesce(inv.billing_client_id, inv.client_id);
  o := app.identite_societe(inv.company_id);
  select * into s from public.billing_settings where company_id = app.billing_company();
  v_credit := inv.type = 'credit_note';
  v_pro := coalesce(c.client_type, 'entreprise') <> 'particulier';
  v_public := c.client_type = 'public';
  v_franchise := o.tva_applicable is false;
  v_societe := coalesce(o.forme_juridique, '') !~* '(entrepreneur|individuel|^ei$|micro)';
  select coalesce(sum(round(coalesce(quantity, 0) * coalesce(unit_price_ht, 0), 2)), 0) * (1 - coalesce(inv.discount_percent, 0) / 100),
         count(*) filter (where nature = 'bien'), count(*) filter (where nature <> 'bien'),
         bool_or(vat_regime = 'exonere'), bool_or(vat_regime = 'autoliquidation')
    into v_net, v_n_bien, v_n_service, v_exo, v_auto
  from public.invoice_items where invoice_id = p_invoice;

  -- Vendeur
  if coalesce(nullif(btrim(o.legal_name), ''), nullif(btrim(o.name), '')) is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_nom', 'libelle', 'raison sociale de l''organisme', 'ou', 'parametres', 'bloquant', true);
  end if;
  if coalesce(nullif(btrim(o.siren), ''), nullif(btrim(o.siret), '')) is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_siren', 'libelle', 'SIREN de l''organisme', 'ou', 'parametres', 'bloquant', true);
  end if;
  if nullif(btrim(o.address), '') is null or nullif(btrim(o.postal_code), '') is null or nullif(btrim(o.city), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_adresse', 'libelle', 'adresse du siège de l''organisme', 'ou', 'parametres', 'bloquant', true);
  end if;
  if nullif(btrim(o.forme_juridique), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_forme', 'libelle', 'forme juridique de l''organisme', 'ou', 'parametres', 'bloquant', true);
  elsif v_societe and o.capital_social is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_capital', 'libelle', 'capital social de l''organisme', 'ou', 'parametres', 'bloquant', true);
  end if;
  if not v_franchise and nullif(btrim(o.tva_intra), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_tva', 'libelle', 'numéro de TVA intracommunautaire de l''organisme', 'ou', 'parametres', 'bloquant', true);
  end if;
  if v_societe and nullif(btrim(o.rcs), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_rcs', 'libelle', 'mention RCS et ville du greffe de l''organisme', 'ou', 'parametres', 'bloquant', false);
  end if;

  -- Circuit de validation (0367, règles de gestion) : facture soumise à validation selon la règle du client, sinon
  -- de la société, sinon le défaut du produit (toujours validée par « Valider les factures »). Émet directement
  -- la personne qui a le droit du valideur (circuit à une étape) ; sinon il faut une demande validée.
  if not v_credit then
    select * into v_regle from app.approval_rule_for(app.billing_company(), 'invoice', inv.client_id);
    if v_regle.mode = 'always' or (v_regle.mode = 'threshold' and v_net > coalesce(v_regle.threshold, 0)) then
      if not exists (select 1 from public.approval_requests ar where ar.object_table = 'invoices' and ar.object_id = inv.id
                       and ar.status = 'approved')
         and not (app.a_le_droit(v_regle.validator_right) and jsonb_array_length(coalesce(v_regle.extra_steps, '[]'::jsonb)) = 0) then
        v_pts := v_pts || jsonb_build_object('code', 'circuit',
          'libelle', case when exists (select 1 from public.approval_requests ar where ar.object_table = 'invoices'
                                        and ar.object_id = inv.id and ar.status = 'pending')
                          then 'validation en attente (circuit de la société)'
                          else 'validation requise avant émission : demandez la validation' end,
          'ou', 'circuit', 'bloquant', true);
      end if;
    end if;
  end if;

  -- Acomptes (0368) : un avoir sur un acompte déjà déduit d'une facture de solde ferait compter deux fois la déduction ;
  -- une facture de solde ne déduit que des acomptes émis et non annulés.
  if v_credit and exists (select 1 from public.invoice_deposit_links l where l.deposit_invoice_id = inv.parent_invoice_id) then
    v_pts := v_pts || jsonb_build_object('code', 'acompte_repris',
      'libelle', 'acompte déjà déduit d''une facture de solde : faites l''avoir sur la facture de solde', 'ou', 'facture', 'bloquant', true);
  end if;
  if inv.invoice_kind = 'solde' and exists (select 1 from public.invoice_deposit_links l join public.invoices d on d.id = l.deposit_invoice_id
                                            where l.final_invoice_id = inv.id and (d.issued_at is null or coalesce(d.amount_credited, 0) > 0.01)) then
    v_pts := v_pts || jsonb_build_object('code', 'acompte_annule',
      'libelle', 'un acompte déduit a été annulé par un avoir : refaites la facture de solde', 'ou', 'facture', 'bloquant', true);
  end if;

  -- Financement OPCO (0368) : numéro de dossier obligatoire sur une facture à un OPCO ; subrogation signalée si
  -- l'OPCO ne l'accepte plus pour les accords datés de sa date de fin ou après (réglée sur la fiche de l'OPCO).
  if c.client_type = 'opco' and nullif(btrim(coalesce(inv.client_reference, '')), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'opco_dossier', 'libelle', 'numéro de dossier de l''OPCO (référence client de la facture)',
      'ou', 'facture', 'bloquant', true);
  end if;
  if coalesce(inv.is_subrogation, false) and c.opco_subrogation_end is not null
     and coalesce((select max(f.agreement_date) from public.session_fundings f
                   where f.session_id = inv.session_id and f.funder_client_id = c.id), inv.invoice_date) >= c.opco_subrogation_end then
    v_pts := v_pts || jsonb_build_object('code', 'opco_subrogation',
      'libelle', 'subrogation : ' || coalesce(c.name, 'l''OPCO') || ' ne l''accepte plus pour les accords datés du '
        || to_char(c.opco_subrogation_end, 'DD/MM/YYYY') || ' ou après (vérifiez l''accord)', 'ou', 'facture', 'bloquant', false);
  end if;

  -- Client
  if c.id is null or nullif(btrim(c.name), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'client_nom', 'libelle', 'nom du client', 'ou', 'client', 'bloquant', true);
  end if;
  if c.id is not null and (nullif(btrim(c.address), '') is null or nullif(btrim(c.postal_code), '') is null or nullif(btrim(c.city), '') is null) then
    v_pts := v_pts || jsonb_build_object('code', 'client_adresse', 'libelle', 'adresse complète du client', 'ou', 'client', 'bloquant', true);
  end if;
  if v_pro and coalesce(nullif(btrim(c.siren), ''), nullif(btrim(c.siret), '')) is null then
    v_pts := v_pts || jsonb_build_object('code', 'client_siren', 'libelle', 'SIREN ou SIRET du client', 'ou', 'client', 'bloquant', true);
  end if;
  if v_pro and not coalesce(c.vat_exempt, false) and not v_franchise and v_net > 150 and nullif(btrim(c.tva), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'client_tva', 'libelle', 'numéro de TVA du client (au-delà de 150 € HT)', 'ou', 'client', 'bloquant', true);
  end if;
  -- Revérification du SIRET dans l'annuaire (0365) : facture à un professionnel, contrôle de moins de 24 h
  -- fait par /api/verifier-siret pour le SIRET actuel du client, ou motif saisi si l'annuaire ne répondait pas.
  v_ident := regexp_replace(coalesce(nullif(btrim(c.siret), ''), c.siren, ''), '\s', '', 'g');
  if v_pro and not v_credit and v_ident ~ '^[0-9]{9}([0-9]{5})?$' then
    if inv.siret_checked_at > now() - interval '24 hours' and inv.siret_check_result ->> 'identifiant' = v_ident then
      if inv.siret_check_result ->> 'etat' in ('ferme', 'siege_deplace', 'inconnu') then
        v_pts := v_pts || jsonb_build_object('code', 'siret_' || (inv.siret_check_result ->> 'etat'),
          'libelle', 'annuaire : ' || coalesce(inv.siret_check_result ->> 'message', 'à vérifier')
            || coalesce(' (' || nullif(concat_ws(' ', inv.siret_check_result ->> 'adresse', inv.siret_check_result ->> 'code_postal',
                 inv.siret_check_result ->> 'ville'), '') || ')', ''),
          'ou', 'client', 'bloquant', false);
      elsif jsonb_array_length(coalesce(inv.siret_check_result -> 'ecarts', '[]'::jsonb)) > 0 then
        v_pts := v_pts || jsonb_build_object('code', 'siret_adresse',
          'libelle', 'adresse du client différente de l''annuaire : ' || concat_ws(' ', inv.siret_check_result ->> 'adresse',
            inv.siret_check_result ->> 'code_postal', inv.siret_check_result ->> 'ville'),
          'ou', 'client', 'bloquant', false);
      end if;
    elsif inv.siret_motif_at > now() - interval '24 hours' and length(btrim(coalesce(inv.siret_check_motif, ''))) >= 5 then
      v_pts := v_pts || jsonb_build_object('code', 'siret_motif',
        'libelle', 'annuaire non consulté, motif : ' || btrim(inv.siret_check_motif), 'ou', 'annuaire', 'bloquant', false);
    else
      v_pts := v_pts || jsonb_build_object('code', 'siret_controle',
        'libelle', 'vérification du SIRET du client dans l''annuaire (moins de 24 h)', 'ou', 'annuaire', 'bloquant', true);
    end if;
  end if;
  if v_public and nullif(btrim(c.siret), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'public_siret', 'libelle', 'SIRET du client public (Chorus Pro)', 'ou', 'client', 'bloquant', true);
  end if;
  if v_public and nullif(btrim(c.chorus_service_code), '') is not null and nullif(btrim(inv.chorus_service_code), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'chorus_service', 'libelle', 'code service Chorus Pro sur la facture', 'ou', 'facture', 'bloquant', true);
  end if;
  if v_public and coalesce(c.chorus_engagement_required, false)
     and coalesce(nullif(btrim(inv.chorus_engagement), ''), nullif(btrim(inv.client_reference), '')) is null then
    v_pts := v_pts || jsonb_build_object('code', 'chorus_engagement', 'libelle', 'numéro d''engagement ou bon de commande (Chorus Pro)', 'ou', 'facture', 'bloquant', true);
  end if;

  -- Lignes et régimes
  if v_exo and not coalesce(s.exoneration_formation_active, false) then
    v_pts := v_pts || jsonb_build_object('code', 'exoneration', 'libelle', 'ligne exonérée alors que l''exonération n''est pas activée dans les réglages', 'ou', 'facture', 'bloquant', true);
  elsif v_exo and nullif(btrim(s.exoneration_attestation_ref), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'exoneration_attestation', 'libelle', 'référence de l''attestation d''exonération (réglages de facturation)', 'ou', 'parametres', 'bloquant', true);
  end if;
  if v_auto and (not v_pro or nullif(btrim(c.tva), '') is null) then
    v_pts := v_pts || jsonb_build_object('code', 'autoliquidation', 'libelle', 'autoliquidation seulement pour un client professionnel avec son numéro de TVA', 'ou', 'facture', 'bloquant', true);
  end if;
  if v_franchise and exists (select 1 from public.invoice_items where invoice_id = p_invoice and coalesce(tva_rate, 0) > 0) then
    v_pts := v_pts || jsonb_build_object('code', 'franchise_taux', 'libelle', 'TVA sur une ligne alors que l''organisme est en franchise', 'ou', 'facture', 'bloquant', true);
  end if;

  -- Facture
  if not v_credit and inv.due_date is null then
    v_pts := v_pts || jsonb_build_object('code', 'echeance', 'libelle', 'date d''échéance', 'ou', 'facture', 'bloquant', true);
  end if;
  if inv.service_start_date is null and inv.service_end_date is null then
    v_pts := v_pts || jsonb_build_object('code', 'date_prestation', 'libelle', 'date de la prestation (à défaut, la date d''émission vaut date de prestation)', 'ou', 'facture', 'bloquant', false);
  end if;

  -- Mentions légales
  if not v_credit and v_pro then
    v_ment := v_ment || to_jsonb(coalesce(s.mention_escompte, 'Escompte pour paiement anticipé : néant.'));
    v_ment := v_ment || to_jsonb(s.mention_penalites);
    v_ment := v_ment || to_jsonb(s.mention_indemnite);
  end if;
  if v_franchise then v_ment := v_ment || to_jsonb(s.mention_franchise); end if;
  if v_exo then
    v_ment := v_ment || to_jsonb(s.mention_exoneration || coalesce(' Attestation ' || nullif(btrim(s.exoneration_attestation_ref), ''), '')
      || coalesce(' du ' || to_char(s.exoneration_attestation_date, 'DD/MM/YYYY'), '') || case when s.exoneration_attestation_ref is not null then '.' else '' end);
  end if;
  if v_auto then v_ment := v_ment || to_jsonb(s.mention_autoliquidation); end if;
  if s.option_debits and not v_franchise then v_ment := v_ment || to_jsonb(s.mention_debits); end if;
  v_ment := (select coalesce(jsonb_agg(m), '[]'::jsonb) from jsonb_array_elements(v_ment) m where m is not null and m <> 'null'::jsonb);

  return jsonb_build_object('points', v_pts, 'mentions', v_ment,
    'nature', case when v_n_bien > 0 and v_n_service > 0 then 'mixte' when v_n_bien > 0 then 'biens' else 'services' end);
end
$function$;


-- public.generate_session_reference_v3()
CREATE OR REPLACE FUNCTION public.generate_session_reference_v3()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prefix text;
  v_course_code text;
  v_date_str text;
  v_counter integer;
begin
  select nullif(trim(o.doc_prefix), '') into v_prefix from app.identite_societe(new.company_id) o;
  v_prefix := upper(coalesce(v_prefix, 'SES'));

  select code into v_course_code from courses where id = new.course_id;
  if v_course_code is null or v_course_code = '' then
    v_course_code := 'FORM';
  end if;

  v_date_str := to_char(new.start_date, 'YYMMDD');

  select coalesce(max(cast(substring(reference from '-(\d{3})$') as integer)), 0) + 1
    into v_counter
  from sessions
  where reference like v_prefix || '-' || v_course_code || '-' || v_date_str || '-%';

  new.reference := v_prefix || '-' || v_course_code || '-' || v_date_str || '-' || lpad(v_counter::text, 3, '0');
  return new;
end;
$function$;


insert into public.schema_migrations (version) values ('0277_societes_interface') on conflict (version) do nothing;

-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (l2_0044) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0044_inter_groupes.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

-- ===== supabase/migrations/0044_inter_groupes.sql =====
-- 0044_inter_groupes.sql : sessions inter et groupes (lot 2, branche inter-groupes).
--
-- Spec : odet-lot2-spec.md v2, section 4. Une session inter réunit plusieurs groupes : une entreprise (convention à son
-- nom) ou un particulier qui paie lui-même (contrat de formation, L6353-3 à L6353-7).
-- 1. sessions.session_type 'inter' (texte libre, aucune contrainte à changer) ; l'ancien regroupement
--    sessions.inter_group_id reste lu (0 session concernée en production).
-- 2. session_groups : nature (entreprise, particulier ; remplace is_individual, recopié), site du client, payeur
--    (entreprise, OPCO, particulier, France Travail, autre) et son client, numéro de dossier, document (à envoyer,
--    envoyé, signé, dates, fichier signé), fin du délai de rétractation, origine (bureau, page publique, espace
--    entreprise), facture du groupe.
-- 3. session_trainees.cpf_dossier_number ; session_fundings.group_id ; invoices.session_group_id (une facture par
--    groupe).
-- 4. inter_requests : demandes d'inscription venues de la page publique (coordonnées, stagiaires, financement,
--    consentement, adresse IP hachée, statut) ; le groupe n'est créé qu'à la confirmation. Écrites plus tard par une
--    fonction publique (page publique livrée après le choix de l'hébergement) ; lues et traitées par qui inscrit.
-- 5. Particulier qui paie lui-même [OFFICIEL, code.travail.gouv.fr, consulté le 14/10/2026] :
--    rétractation 10 jours après la signature (L6353-5) : fin calculée par la base à la signature ;
--    aucune somme avant la fin du délai, puis 30 % au plus avant le début de la formation (L6353-6) : refusé par la
--    base à l'enregistrement d'un paiement sur la facture du groupe.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0044_inter_groupes_retour.sql

-- ── 2. Groupes ──
alter table public.session_groups add column if not exists kind text;
alter table public.session_groups add column if not exists site_id uuid references public.sites(id) on delete set null;
alter table public.session_groups add column if not exists payer_kind text;
alter table public.session_groups add column if not exists payer_client_id uuid references public.clients(id) on delete set null;
alter table public.session_groups add column if not exists dossier_number text;
alter table public.session_groups add column if not exists doc_status text not null default 'a_envoyer';
alter table public.session_groups add column if not exists doc_sent_at timestamptz;
alter table public.session_groups add column if not exists doc_signed_at timestamptz;
alter table public.session_groups add column if not exists doc_signed_path text;
alter table public.session_groups add column if not exists retractation_end date;
alter table public.session_groups add column if not exists source text not null default 'back_office';
alter table public.session_groups add column if not exists invoice_id uuid references public.invoices(id) on delete set null;

update public.session_groups set kind = case when is_individual then 'particulier' else 'entreprise' end where kind is null;
alter table public.session_groups alter column kind set default 'entreprise';
alter table public.session_groups alter column kind set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'session_groups_kind_check') then
    alter table public.session_groups add constraint session_groups_kind_check check (kind in ('entreprise', 'particulier'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'session_groups_payer_check') then
    alter table public.session_groups add constraint session_groups_payer_check
      check (payer_kind is null or payer_kind in ('entreprise', 'opco', 'particulier', 'france_travail', 'autre'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'session_groups_doc_check') then
    alter table public.session_groups add constraint session_groups_doc_check check (doc_status in ('a_envoyer', 'envoye', 'signe'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'session_groups_source_check') then
    alter table public.session_groups add constraint session_groups_source_check
      check (source in ('back_office', 'page_publique', 'espace_entreprise'));
  end if;
end $$;

comment on column public.session_groups.retractation_end is 'Fin du délai de rétractation (particulier qui paie : signature + 10 jours, L6353-5), calculée par la base';

-- Nature reprise dans l'ancienne colonne (lue par l'ancien code), dates de document et de rétractation tenues par la base
create or replace function app.session_group_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.is_individual := (new.kind = 'particulier');
  if new.doc_status = 'envoye' and new.doc_sent_at is null then new.doc_sent_at := now(); end if;
  if new.doc_status = 'signe' and new.doc_signed_at is null then new.doc_signed_at := now(); end if;
  if new.kind = 'particulier' and coalesce(new.payer_kind, 'particulier') = 'particulier' and new.doc_signed_at is not null
     and (tg_op = 'INSERT' or new.doc_signed_at is distinct from old.doc_signed_at or new.retractation_end is null) then
    new.retractation_end := ((new.doc_signed_at at time zone 'Europe/Paris')::date + 10);
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.session_group_maj() from public, anon, authenticated;
drop trigger if exists session_groups_maj on public.session_groups;
create trigger session_groups_maj before insert or update on public.session_groups
  for each row execute function app.session_group_maj();

-- ── 3. Rattachements ──
alter table public.session_trainees add column if not exists cpf_dossier_number text;
alter table public.session_fundings add column if not exists group_id uuid references public.session_groups(id) on delete set null;
alter table public.invoices add column if not exists session_group_id uuid references public.session_groups(id) on delete set null;
create index if not exists session_trainees_group_idx on public.session_trainees (group_id) where group_id is not null;
create index if not exists invoices_session_group_idx on public.invoices (session_group_id) where session_group_id is not null;

-- Facture du groupe : le groupe pointe vers sa facture (à la création comme à la modification)
create or replace function app.invoice_lien_groupe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.session_group_id is not null and new.type = 'invoice'
     and (tg_op = 'INSERT' or new.session_group_id is distinct from old.session_group_id) then
    update public.session_groups g set invoice_id = new.id where g.id = new.session_group_id and g.invoice_id is null;
  end if;
  return new;
end
$$;
revoke all on function app.invoice_lien_groupe() from public, anon, authenticated;
drop trigger if exists invoices_lien_groupe on public.invoices;
create trigger invoices_lien_groupe after insert or update of session_group_id on public.invoices
  for each row execute function app.invoice_lien_groupe();

-- ── 5. Paiements d'un particulier (L6353-6) ──
create or replace function app.paiement_particulier_garde()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  g record;
  v_total numeric;
  v_deja numeric;
begin
  select sg.retractation_end, sg.kind, sg.payer_kind, s.start_date, i.total_ttc
    into g
  from public.invoices i
  join public.session_groups sg on sg.id = i.session_group_id
  join public.sessions s on s.id = sg.session_id
  where i.id = new.invoice_id;
  if g.kind is distinct from 'particulier' or coalesce(g.payer_kind, 'particulier') <> 'particulier' then
    return new;
  end if;
  if g.retractation_end is not null and new.payment_date < g.retractation_end then
    raise exception 'Particulier : aucun paiement avant la fin du délai de rétractation (le %), article L6353-6 du Code du travail',
      to_char(g.retractation_end, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if g.start_date is not null and new.payment_date < g.start_date and coalesce(new.amount, 0) > 0 then
    v_total := coalesce(g.total_ttc, 0);
    select coalesce(sum(p.amount), 0) into v_deja from public.invoice_payments p
    where p.invoice_id = new.invoice_id and p.id is distinct from new.id and p.payment_date < g.start_date;
    if v_deja + new.amount > round(v_total * 0.30, 2) + 0.005 then
      raise exception 'Particulier : avant le début de la formation, 30 %% du prix au plus (% € déjà encaissés sur % € autorisés), article L6353-6',
        to_char(v_deja, 'FM999G990D00'), to_char(round(v_total * 0.30, 2), 'FM999G990D00') using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.paiement_particulier_garde() from public, anon, authenticated;
drop trigger if exists invoice_payments_particulier on public.invoice_payments;
create trigger invoice_payments_particulier before insert or update of amount, payment_date on public.invoice_payments
  for each row execute function app.paiement_particulier_garde();

-- ── 4. Demandes d'inscription (page publique) ──
create table if not exists public.inter_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  session_id uuid not null references public.sessions(id) on delete cascade,
  kind text not null default 'entreprise' check (kind in ('entreprise', 'particulier')),
  company_name text,
  siret text,
  contact_name text,
  contact_email text,
  contact_phone text,
  trainees jsonb not null default '[]'::jsonb,
  funding text,
  message text,
  consent_at timestamptz,
  ip_hash text,
  status text not null default 'a_confirmer' check (status in ('a_confirmer', 'confirme', 'refuse', 'annule')),
  group_id uuid references public.session_groups(id) on delete set null,
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists inter_requests_session_idx on public.inter_requests (session_id, status);
comment on table public.inter_requests is 'Demandes d''inscription aux sessions inter (page publique) : groupe créé seulement à la confirmation';

create or replace function app.inter_request_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.company_id := coalesce((select s.company_id from public.sessions s where s.id = new.session_id), new.company_id);
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.handled_by := (select auth.uid()); new.handled_at := now();
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.inter_request_maj() from public, anon, authenticated;
drop trigger if exists inter_requests_maj on public.inter_requests;
create trigger inter_requests_maj before insert or update on public.inter_requests
  for each row execute function app.inter_request_maj();

alter table public.inter_requests enable row level security;
revoke all on table public.inter_requests from public, anon;
grant select, update, delete on table public.inter_requests to authenticated;
grant all on table public.inter_requests to service_role;

-- Règles (générées par scripts/securite/regles.py, build_suite('0044'))

-- Pose des règles d'une liste de tables : une règle par action, garde du module ajoutée ici.
-- Lecture : module actif, ou super administrateur. Écriture : module actif.
create or replace function pg_temp.regles(p_tables text[], p_module text, p_sel text, p_ins text, p_upd text, p_del text)
returns void
language plpgsql
as $f$
declare
  t text;
  v_on text;
  v_sel text := p_sel; v_ins text := p_ins; v_upd text := p_upd; v_del text := p_del;
begin
  if p_module is not null then
    select '(' || string_agg(format('(select app.module_on(%L))', m), ' or ') || ')' into v_on
    from unnest(string_to_array(p_module, '|')) m;
    if v_sel is not null then v_sel := format('((%s and %s) or (select app.is_superadmin()))', v_on, v_sel); end if;
    if v_ins is not null then v_ins := format('(%s and %s)', v_on, v_ins); end if;
    if v_upd is not null then v_upd := format('(%s and %s)', v_on, v_upd); end if;
    if v_del is not null then v_del := format('(%s and %s)', v_on, v_del); end if;
  end if;
  foreach t in array p_tables loop
    execute format('alter table public.%I enable row level security', t);
    if v_sel is not null then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_lire', t, v_sel);
    end if;
    if v_ins is not null then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_creer', t, v_ins);
    end if;
    if v_upd is not null then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_modifier', t, v_upd, v_upd);
    end if;
    if v_del is not null then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_supprimer', t, v_del);
    end if;
  end loop;
end
$f$;

-- Suppression des règles nommées du générateur (lire, créer, modifier, supprimer) ; les autres règles
-- (règle restrictive des notifications de 0070, etc.) ne sont pas touchées
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['inter_requests'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- inter_requests
select pg_temp.regles(array['inter_requests'], null,
  $r$company_id in (select app.societes_avec_droit('formation.inscriptions.gerer'))$r$,
  null,
  $r$company_id in (select app.societes_avec_droit('formation.inscriptions.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.inscriptions.gerer'))$r$);

drop policy if exists inter_requests_societe_lire on public.inter_requests;
drop policy if exists inter_requests_societe_creer on public.inter_requests;
drop policy if exists inter_requests_societe_modifier on public.inter_requests;
drop policy if exists inter_requests_societe_supprimer on public.inter_requests;
create policy inter_requests_societe_lire on public.inter_requests as restrictive for select to authenticated
  using (company_id in (select app.societes_lisibles()));
create policy inter_requests_societe_creer on public.inter_requests as restrictive for insert to authenticated
  with check (company_id in (select app.societes_ecriture()));
create policy inter_requests_societe_modifier on public.inter_requests as restrictive for update to authenticated
  using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()));
create policy inter_requests_societe_supprimer on public.inter_requests as restrictive for delete to authenticated
  using (company_id in (select app.societes_ecriture()));

insert into public.schema_migrations (version) values ('0044_inter_groupes') on conflict (version) do nothing;

-- ===== supabase/rollback/0044_inter_groupes_retour.sql =====
-- Retour arrière de 0044_inter_groupes.sql : retire les colonnes des groupes inter, la garde des paiements d'un
-- particulier et les demandes d'inscription. Idempotent.
-- Refusé si des données y ont été saisies (payeur, document, rétractation, demande, numéro CPF, facture d'un groupe).

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_groups' and column_name = 'retractation_end') then
    if exists (select 1 from public.session_groups where site_id is not null or payer_kind is not null or payer_client_id is not null
                 or dossier_number is not null or doc_status <> 'a_envoyer' or doc_signed_path is not null or retractation_end is not null
                 or source <> 'back_office' or invoice_id is not null)
       or exists (select 1 from public.inter_requests)
       or exists (select 1 from public.session_trainees where cpf_dossier_number is not null)
       or exists (select 1 from public.session_fundings where group_id is not null)
       or exists (select 1 from public.invoices where session_group_id is not null) then
      raise exception 'Retour arrière refusé : des groupes inter ou des demandes ont été saisis';
    end if;
  end if;
end $$;

drop trigger if exists invoice_payments_particulier on public.invoice_payments;
drop trigger if exists invoices_lien_groupe on public.invoices;
drop trigger if exists session_groups_maj on public.session_groups;
drop function if exists app.paiement_particulier_garde();
drop function if exists app.invoice_lien_groupe();
drop function if exists app.session_group_maj();
drop table if exists public.inter_requests;
drop function if exists app.inter_request_maj();

drop index if exists public.session_trainees_group_idx;
drop index if exists public.invoices_session_group_idx;
alter table public.invoices drop column if exists session_group_id;
alter table public.session_fundings drop column if exists group_id;
alter table public.session_trainees drop column if exists cpf_dossier_number;
alter table public.session_groups drop constraint if exists session_groups_kind_check;
alter table public.session_groups drop constraint if exists session_groups_payer_check;
alter table public.session_groups drop constraint if exists session_groups_doc_check;
alter table public.session_groups drop constraint if exists session_groups_source_check;
alter table public.session_groups drop column if exists invoice_id;
alter table public.session_groups drop column if exists source;
alter table public.session_groups drop column if exists retractation_end;
alter table public.session_groups drop column if exists doc_signed_path;
alter table public.session_groups drop column if exists doc_signed_at;
alter table public.session_groups drop column if exists doc_sent_at;
alter table public.session_groups drop column if exists doc_status;
alter table public.session_groups drop column if exists dossier_number;
alter table public.session_groups drop column if exists payer_client_id;
alter table public.session_groups drop column if exists payer_kind;
alter table public.session_groups drop column if exists site_id;
alter table public.session_groups drop column if exists kind;

delete from public.schema_migrations where version = '0044_inter_groupes';

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE l2_0044 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

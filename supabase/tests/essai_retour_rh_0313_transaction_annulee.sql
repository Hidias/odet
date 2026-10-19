-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (rh_0313) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0313_rh_registre.sql, retour arrière,
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

-- ===== supabase/migrations/0313_rh_registre.sql =====
-- 0313_rh_registre.sql : chantier 12, module RH, registre unique du personnel (articles L1221-13 et D1221-23 du Code
-- du travail, lus le 19/10/2026 sur code.travail.gouv.fr).
--
-- Le registre est généré depuis les fiches et les contrats (aucune double saisie). Il manquait :
--   - nationalité et sexe de la personne ;
--   - pour un travailleur étranger soumis à autorisation de travail : type et numéro de l'autorisation ;
--   - pour un intérimaire ou un salarié mis à disposition : nom et adresse de l'entreprise de travail temporaire ou
--     du groupement d'employeurs ;
--   - date de l'autorisation d'embauche ou de licenciement quand elle est requise.
-- Colonnes facultatives, lues et écrites avec les mêmes droits que la fiche et le contrat (règles de 0290 inchangées),
-- tracées par le journal existant (champs modifiés, jamais les valeurs).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0313_rh_registre_retour.sql

alter table public.hr_people add column if not exists nationality text;
alter table public.hr_people add column if not exists gender text;
alter table public.hr_people add column if not exists work_permit_type text;
alter table public.hr_people add column if not exists work_permit_ref text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hr_people_gender_check') then
    alter table public.hr_people add constraint hr_people_gender_check check (gender is null or gender in ('F', 'M'));
  end if;
end $$;
comment on column public.hr_people.nationality is 'Nationalité (registre unique du personnel, D1221-23)';
comment on column public.hr_people.gender is 'Sexe : F ou M (registre unique du personnel, D1221-23)';
comment on column public.hr_people.work_permit_type is 'Travailleur étranger soumis à autorisation : type de l''autorisation de travail';
comment on column public.hr_people.work_permit_ref is 'Travailleur étranger soumis à autorisation : numéro d''ordre de l''autorisation de travail';

alter table public.hr_employments add column if not exists agency_name text;
alter table public.hr_employments add column if not exists agency_address text;
alter table public.hr_employments add column if not exists authorization_on date;
comment on column public.hr_employments.agency_name is 'Intérim ou mise à disposition : entreprise de travail temporaire ou groupement d''employeurs';
comment on column public.hr_employments.agency_address is 'Adresse de l''entreprise de travail temporaire ou du groupement d''employeurs';
comment on column public.hr_employments.authorization_on is 'Date de l''autorisation d''embauche ou de licenciement, ou de sa demande, quand elle est requise';

insert into public.schema_migrations (version) values ('0313_rh_registre') on conflict (version) do nothing;

-- ===== supabase/rollback/0313_rh_registre_retour.sql =====
-- Retour arrière de 0313_rh_registre.sql : retire les colonnes du registre. Idempotent.
-- Refusé si l'une d'elles a été remplie (données du personnel : à exporter d'abord).

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hr_people' and column_name = 'nationality')
     and exists (select 1 from public.hr_people where nationality is not null or gender is not null or work_permit_type is not null or work_permit_ref is not null) then
    raise exception 'Retour arrière refusé : des fiches portent nationalité, sexe ou autorisation de travail (à exporter d''abord)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hr_employments' and column_name = 'agency_name')
     and exists (select 1 from public.hr_employments where agency_name is not null or agency_address is not null or authorization_on is not null) then
    raise exception 'Retour arrière refusé : des contrats portent une entreprise de travail temporaire ou une autorisation (à exporter d''abord)';
  end if;
end $$;

alter table public.hr_people drop constraint if exists hr_people_gender_check;
alter table public.hr_people drop column if exists work_permit_ref;
alter table public.hr_people drop column if exists work_permit_type;
alter table public.hr_people drop column if exists gender;
alter table public.hr_people drop column if exists nationality;
alter table public.hr_employments drop column if exists authorization_on;
alter table public.hr_employments drop column if exists agency_address;
alter table public.hr_employments drop column if exists agency_name;

delete from public.schema_migrations where version = '0313_rh_registre';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE rh_0313 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

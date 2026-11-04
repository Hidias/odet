-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (regles_sst_0479) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0479_regles_effectif_prerequis.sql, retour arrière,
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

-- ===== supabase/migrations/0479_regles_effectif_prerequis.sql =====
-- 0479 : effectif imposé et prérequis de certificat (règles SST des CGV formation, décision de H du 04/11).
-- Les CGV formation (version 3, fin de l'article 8) fixent pour le SST un groupe de 4 à 10 participants par formateur
-- (document de référence de l'INRS) et, pour le MAC, la copie du certificat de chaque participant, accepté jusqu'à
-- 6 mois après la fin de validité. Rien n'est écrit en dur pour une formation : ce sont deux réglages de la fiche
-- formation, que l'organisme active là où un référentiel l'impose.
-- 1. courses.effectif_strict : le maximum de la formation ne se dépasse jamais (ni la session, ni les inscrits).
-- 2. courses.prerequis_certificat_mois : un certificat est exigé ; tolérance en mois après sa fin de validité.
-- 3. session_trainees : date de fin de validité du certificat présenté, copie (stockage privé), contrôle.
-- 4. Contrôle en base : une inscription au-delà du maximum d'une formation à effectif imposé est refusée,
--    quel que soit l'écran (fiche session, devis, circuit, espace entreprise, inscription confirmée).
-- Additive. Idempotente. Retour arrière : supabase/rollback/0479_regles_effectif_prerequis_retour.sql

-- ── 1 et 2. Réglages de la formation ──
alter table public.courses add column if not exists effectif_strict boolean not null default false;
alter table public.courses add column if not exists prerequis_certificat_mois integer;
alter table public.courses drop constraint if exists courses_prerequis_certificat_mois_check;
alter table public.courses add constraint courses_prerequis_certificat_mois_check
  check (prerequis_certificat_mois is null or prerequis_certificat_mois between 0 and 24);
comment on column public.courses.effectif_strict is 'Effectif imposé par un référentiel (ex. SST : 4 à 10 par formateur) : le maximum de la formation ne se dépasse pas';
comment on column public.courses.prerequis_certificat_mois is 'Certificat exigé à l''entrée (ex. MAC SST) ; nombre de mois tolérés après sa fin de validité (null : aucun certificat exigé)';

-- ── 3. Certificat présenté par le participant ──
alter table public.session_trainees add column if not exists prerequis_valid_until date;
alter table public.session_trainees add column if not exists prerequis_file_path text;
alter table public.session_trainees add column if not exists prerequis_checked_at timestamptz;
alter table public.session_trainees add column if not exists prerequis_checked_by uuid;
alter table public.session_trainees drop constraint if exists session_trainees_prerequis_file_path_check;
alter table public.session_trainees add constraint session_trainees_prerequis_file_path_check
  check (prerequis_file_path is null or prerequis_file_path like 'prerequis/%');
comment on column public.session_trainees.prerequis_valid_until is 'Fin de validité du certificat présenté à l''entrée (ex. certificat SST pour un MAC)';
comment on column public.session_trainees.prerequis_file_path is 'Copie du certificat, bucket privé « documents », dossier prerequis/';

-- ── 4. Contrôles en base ──
create or replace function app.effectif_strict_max(p_session uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(co.effectif_strict, false) then co.max_participants end
  from public.sessions se join public.courses co on co.id = se.course_id
  where se.id = p_session
$$;

create or replace function app.controle_effectif_inscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max int;
  v_n int;
begin
  if coalesce(new.absent, false) then return new; end if;
  if tg_op = 'UPDATE' and new.session_id is not distinct from old.session_id and not coalesce(old.absent, false) then
    return new;
  end if;
  v_max := app.effectif_strict_max(new.session_id);
  if v_max is null then return new; end if;
  select count(*) into v_n from public.session_trainees st
   where st.session_id = new.session_id and not coalesce(st.absent, false) and st.id is distinct from new.id;
  if v_n >= v_max then
    raise exception 'Cette formation est limitée à % participants par formateur (référentiel) : créez une seconde session, chaque groupe comptant au moins le minimum de la formation', v_max
      using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists session_trainees_effectif_strict on public.session_trainees;
create trigger session_trainees_effectif_strict
  before insert or update of session_id, absent on public.session_trainees
  for each row execute function app.controle_effectif_inscription();

create or replace function app.controle_effectif_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max int;
begin
  if new.course_id is null or new.max_participants is null then return new; end if;
  select case when coalesce(co.effectif_strict, false) then co.max_participants end into v_max
    from public.courses co where co.id = new.course_id;
  if v_max is not null and new.max_participants > v_max then
    raise exception 'Cette formation est limitée à % participants par formateur (référentiel) : au-delà, créez une seconde session', v_max
      using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists sessions_effectif_strict on public.sessions;
create trigger sessions_effectif_strict
  before insert or update of max_participants, course_id on public.sessions
  for each row execute function app.controle_effectif_session();

insert into public.schema_migrations (version) values ('0479_regles_effectif_prerequis') on conflict (version) do nothing;

-- ===== supabase/rollback/0479_regles_effectif_prerequis_retour.sql =====
-- Retour arrière de 0479 : contrôles retirés ; colonnes retirées (les réglages et certificats saisis sont perdus).
drop trigger if exists sessions_effectif_strict on public.sessions;
drop trigger if exists session_trainees_effectif_strict on public.session_trainees;
drop function if exists app.controle_effectif_session();
drop function if exists app.controle_effectif_inscription();
drop function if exists app.effectif_strict_max(uuid);
alter table public.session_trainees drop constraint if exists session_trainees_prerequis_file_path_check;
alter table public.session_trainees drop column if exists prerequis_checked_by;
alter table public.session_trainees drop column if exists prerequis_checked_at;
alter table public.session_trainees drop column if exists prerequis_file_path;
alter table public.session_trainees drop column if exists prerequis_valid_until;
alter table public.courses drop constraint if exists courses_prerequis_certificat_mois_check;
alter table public.courses drop column if exists prerequis_certificat_mois;
alter table public.courses drop column if exists effectif_strict;
delete from public.schema_migrations where version = '0479_regles_effectif_prerequis';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE regles_sst_0479 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

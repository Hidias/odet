-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (formation_0048) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0048_fiche_programme.sql, retour arrière,
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

-- ===== supabase/migrations/0048_fiche_programme.sql =====
-- 0048_fiche_programme.sql : fiche formation complète pour le programme (indicateur 1 de Qualiopi) et suivi des
-- versions des programmes.
--
-- Demande de H (19/10) : saisir dans la fiche formation toutes les informations d'un programme audité (modèle des
-- programmes Access Formation) et les retrouver sur le programme généré, sur une seule page.
-- 1. courses : effectif minimum et maximum, délai d'accès, recyclage conseillé ou durée de validité, documents
--    remis, profil du formateur, mention du tarif, modalités, modalités d'évaluation (existante), référence, version
--    et date de mise à jour du programme.
-- 2. programme_versions.course_id : chaque version enregistrée est reliée à sa formation (l'historique existant,
--    sans formation, reste lisible).
-- Aucune table nouvelle : les colonnes sont couvertes par les règles existantes de courses et programme_versions.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0048_fiche_programme_retour.sql

alter table public.courses add column if not exists min_participants integer;
alter table public.courses add column if not exists max_participants integer;
alter table public.courses add column if not exists access_delay text;
alter table public.courses add column if not exists validity_kind text;
alter table public.courses add column if not exists validity_text text;
alter table public.courses add column if not exists deliverables text;
alter table public.courses add column if not exists trainer_profile text;
alter table public.courses add column if not exists price_mention text;
alter table public.courses add column if not exists modalities text;
alter table public.courses add column if not exists program_ref text;
alter table public.courses add column if not exists program_version text;
alter table public.courses add column if not exists program_updated_on date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'courses_participants_check') then
    alter table public.courses add constraint courses_participants_check check (
      (min_participants is null or min_participants between 1 and 500)
      and (max_participants is null or max_participants between 1 and 500)
      and (min_participants is null or max_participants is null or min_participants <= max_participants));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'courses_validity_kind_check') then
    alter table public.courses add constraint courses_validity_kind_check
      check (validity_kind is null or validity_kind in ('recyclage', 'validite'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'courses_programme_textes_check') then
    alter table public.courses add constraint courses_programme_textes_check check (
      coalesce(length(access_delay), 0) <= 200 and coalesce(length(validity_text), 0) <= 60
      and coalesce(length(deliverables), 0) <= 600 and coalesce(length(trainer_profile), 0) <= 300
      and coalesce(length(price_mention), 0) <= 200 and coalesce(length(modalities), 0) <= 200
      and coalesce(length(program_ref), 0) <= 40 and coalesce(length(program_version), 0) <= 10);
  end if;
end $$;

comment on column public.courses.access_delay is 'Délai d''accès affiché sur le programme (vide : « En moyenne sous 15 jours »)';
comment on column public.courses.validity_kind is 'recyclage (Recyclage conseillé) ou validite (Durée de validité)';
comment on column public.courses.deliverables is 'Documents remis à l''issue de la formation (validation de la formation)';
comment on column public.courses.program_updated_on is 'Date de mise à jour du programme (posée à chaque version enregistrée)';

alter table public.programme_versions add column if not exists course_id uuid references public.courses(id) on delete set null;
create index if not exists programme_versions_course_id_idx on public.programme_versions (course_id);

insert into public.schema_migrations (version) values ('0048_fiche_programme') on conflict (version) do nothing;

-- ===== supabase/rollback/0048_fiche_programme_retour.sql =====
-- Retour arrière de 0048_fiche_programme.sql : retire les champs du programme de la fiche formation et le lien des
-- versions vers la formation. Idempotent. Les valeurs saisies dans ces champs sont perdues (ce sont des ajouts) ;
-- les lignes de programme_versions sont gardées.

drop index if exists public.programme_versions_course_id_idx;
alter table public.programme_versions drop column if exists course_id;

alter table public.courses drop constraint if exists courses_programme_textes_check;
alter table public.courses drop constraint if exists courses_validity_kind_check;
alter table public.courses drop constraint if exists courses_participants_check;
alter table public.courses drop column if exists program_updated_on;
alter table public.courses drop column if exists program_version;
alter table public.courses drop column if exists program_ref;
alter table public.courses drop column if exists modalities;
alter table public.courses drop column if exists price_mention;
alter table public.courses drop column if exists trainer_profile;
alter table public.courses drop column if exists deliverables;
alter table public.courses drop column if exists validity_text;
alter table public.courses drop column if exists validity_kind;
alter table public.courses drop column if exists access_delay;
alter table public.courses drop column if exists max_participants;
alter table public.courses drop column if exists min_participants;

delete from public.schema_migrations where version = '0048_fiche_programme';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE formation_0048 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

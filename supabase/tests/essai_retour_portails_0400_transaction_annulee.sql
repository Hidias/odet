-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (portails_0400) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0400_portails_documents_emis.sql, retour arrière,
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

-- ===== supabase/migrations/0400_portails_documents_emis.sql =====
-- 0400 : le portail client et l'espace entreprise servent la version émise des certificats et attestations (0399).
-- Ils recalculaient le document : après une absence décidée ou une correction, le client pouvait télécharger des
-- heures différentes de celles remises. Deux lectures, avec exactement les mêmes droits que les données de session
-- de chaque portail (mêmes sessions, mêmes stagiaires) ; ni motif ni auteur ne sortent. Volatiles : le contrôle du
-- lien du portail peut compter un essai. Idempotent.

create or replace function public.client_portal_documents_emis(p_token text, p_code text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with vis as (
    select (s->>'id')::uuid as sid, (st->>'trainee_id')::uuid as tid
    from jsonb_array_elements(coalesce(public.client_portal_data(p_token, p_code)->'sessions', '[]'::jsonb)) s,
         jsonb_array_elements(coalesce(s->'session_trainees', '[]'::jsonb)) st
  )
  select coalesce(jsonb_agg(jsonb_build_object('session_id', d.session_id, 'trainee_id', d.trainee_id, 'kind', d.kind,
      'version', d.version, 'issued_on', d.issued_on, 'hours', d.hours, 'result', d.result, 'absences', d.absences)
    order by d.session_id, d.trainee_id, d.kind, d.version), '[]'::jsonb)
  from public.training_documents_issued d
  join vis on vis.sid = d.session_id and vis.tid = d.trainee_id
$$;
revoke all on function public.client_portal_documents_emis(text, text) from public;
grant execute on function public.client_portal_documents_emis(text, text) to anon, authenticated;

create or replace function public.ent_documents_emis()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with vis as (
    select (s->>'id')::uuid as sid, (st->>'trainee_id')::uuid as tid
    from jsonb_array_elements(coalesce(public.ent_sessions()->'sessions', '[]'::jsonb)) s,
         jsonb_array_elements(coalesce(s->'session_trainees', '[]'::jsonb)) st
  )
  select coalesce(jsonb_agg(jsonb_build_object('session_id', d.session_id, 'trainee_id', d.trainee_id, 'kind', d.kind,
      'version', d.version, 'issued_on', d.issued_on, 'hours', d.hours, 'result', d.result, 'absences', d.absences)
    order by d.session_id, d.trainee_id, d.kind, d.version), '[]'::jsonb)
  from public.training_documents_issued d
  join vis on vis.sid = d.session_id and vis.tid = d.trainee_id
$$;
revoke all on function public.ent_documents_emis() from public, anon;
grant execute on function public.ent_documents_emis() to authenticated;

insert into public.schema_migrations (version) values ('0400_portails_documents_emis') on conflict (version) do nothing;

-- ===== supabase/rollback/0400_portails_documents_emis_retour.sql =====
-- Retour arrière de 0400_portails_documents_emis.sql. Idempotent.

drop function if exists public.client_portal_documents_emis(text, text);
drop function if exists public.ent_documents_emis();

delete from public.schema_migrations where version = '0400_portails_documents_emis';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE portails_0400 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

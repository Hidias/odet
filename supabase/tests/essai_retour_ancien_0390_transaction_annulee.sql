-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (ancien_0390) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0390_sans_ancien_outil.sql, retour arrière,
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

-- ===== supabase/migrations/0390_sans_ancien_outil.sql =====
-- 0390 : plus de lien vers l'ancien outil (Campus d'un autre organisme) dans les formations, décisions de H du 21/10.
-- 12 programmes et une signature de formateur pointent vers le stockage de cet outil : adresses vidées.
-- 18 fiches de documents de formation y pointent aussi (adresse obligatoire) : retirées, avec l'accord de H (21/10,
-- 6h23 : « oui retire les », documents à recréer plus tard). L'écran les écartait déjà (fichierDeLInstance).
-- Rien n'est perdu : chaque valeur vidée et chaque fiche retirée est gardée entière dans app.retrait_ancien_outil,
-- que le retour arrière relit. Idempotent.

create table if not exists app.retrait_ancien_outil (
  id bigserial primary key,
  company_id uuid,
  table_name text not null,
  row_id uuid not null,
  donnees jsonb not null,
  retire_le timestamptz not null default now(),
  unique (table_name, row_id)
);
revoke all on app.retrait_ancien_outil from public;
revoke all on sequence app.retrait_ancien_outil_id_seq from public;

insert into app.retrait_ancien_outil (company_id, table_name, row_id, donnees)
select c.company_id, 'courses', c.id, jsonb_build_object('program_url', c.program_url)
from public.courses c
where c.program_url like 'https://ibvtdiiwlpocibjvlgxr.supabase.co/%'
on conflict (table_name, row_id) do nothing;
update public.courses set program_url = null where program_url like 'https://ibvtdiiwlpocibjvlgxr.supabase.co/%';

insert into app.retrait_ancien_outil (company_id, table_name, row_id, donnees)
select t.company_id, 'trainers', t.id, jsonb_build_object('signature_url', t.signature_url)
from public.trainers t
where t.signature_url like 'https://ibvtdiiwlpocibjvlgxr.supabase.co/%'
on conflict (table_name, row_id) do nothing;
update public.trainers set signature_url = null where signature_url like 'https://ibvtdiiwlpocibjvlgxr.supabase.co/%';

-- Fiches de documents de formation hébergées sur l'ancien outil (personne ne les a ouvertes : aucune trace de
-- téléchargement ni d'accès rattachée)
insert into app.retrait_ancien_outil (company_id, table_name, row_id, donnees)
select d.company_id, 'course_documents', d.id, to_jsonb(d)
from public.course_documents d
where d.file_url like 'https://ibvtdiiwlpocibjvlgxr.supabase.co/%'
on conflict (table_name, row_id) do nothing;
delete from public.course_documents d
where d.file_url like 'https://ibvtdiiwlpocibjvlgxr.supabase.co/%'
  and exists (select 1 from app.retrait_ancien_outil r where r.table_name = 'course_documents' and r.row_id = d.id);

insert into public.schema_migrations (version) values ('0390_sans_ancien_outil') on conflict (version) do nothing;

-- ===== supabase/rollback/0390_sans_ancien_outil_retour.sql =====
-- Retour arrière de 0390_sans_ancien_outil.sql : remet les adresses vidées et les fiches retirées, puis supprime la table de garde. Idempotent.

do $retour$
begin
  if to_regclass('app.retrait_ancien_outil') is null then return; end if;
  insert into public.course_documents
  select (jsonb_populate_record(null::public.course_documents, r.donnees)).*
  from app.retrait_ancien_outil r where r.table_name = 'course_documents'
  on conflict (id) do nothing;
  update public.courses c set program_url = r.donnees->>'program_url'
  from app.retrait_ancien_outil r where r.table_name = 'courses' and r.row_id = c.id;
  update public.trainers t set signature_url = r.donnees->>'signature_url'
  from app.retrait_ancien_outil r where r.table_name = 'trainers' and r.row_id = t.id;
end
$retour$;

drop table if exists app.retrait_ancien_outil;

delete from public.schema_migrations where version = '0390_sans_ancien_outil';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE ancien_0390 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

-- 0080_securite_urgences.sql : défauts graves relevés le 14/10/2026 (chantier 2, sécurité des accès).
-- 1. Les tâches planifiées (cron_call_vercel et les fonctions *_tick) n'étaient pas réservées au
--    planificateur : tout compte connecté pouvait les appeler et faire partir le secret des tâches
--    vers une adresse de son choix. Elles ne sont plus exécutables que par le planificateur (postgres)
--    et le serveur (service_role), et l'adresse appelée est contrôlée.
-- 2. La table des clés de chiffrement était lisible et modifiable par tout compte connecté.
-- 3. Le déchiffrement du numéro de sécurité sociale n'est plus appelable directement.
-- 4. Les droits TRUNCATE, TRIGGER et REFERENCES des rôles de l'API sont retirés (aucun usage).
-- 5. Les rôles des futurs comptes externes (entreprise, formateur externe, stagiaire) sont admis
--    par la contrainte de profiles. Aucun écran ne permet encore de les attribuer.
-- 0. Avant toute modification, l'état des droits est photographié dans app.etat_avant_chantier2
--    (règles d'accès, définitions et droits des fonctions, droits sur les tables, buckets). Les scripts
--    de retour arrière (supabase/rollback/) le relisent pour tout remettre exactement comme avant.
-- Migration idempotente. Retour arrière : supabase/rollback/0080-0087_securite_retour.sql (les huit migrations ensemble)

-- 0. Photographie de l'état avant le chantier 2 (une seule fois) --------------------------------------

create schema if not exists app;
revoke all on schema app from public;

create table if not exists app.etat_avant_chantier2 (
  id bigserial primary key,
  kind text not null,          -- policy, function, function_acl, table_acl, bucket, view
  name text not null,
  definition text not null,
  taken_at timestamptz not null default now()
);
revoke all on table app.etat_avant_chantier2 from public, anon, authenticated;

do $$
begin
  if exists (select 1 from app.etat_avant_chantier2) then
    return;
  end if;

  insert into app.etat_avant_chantier2 (kind, name, definition)
  select 'policy', schemaname || '.' || tablename || '.' || policyname,
         format('create policy %I on %I.%I as %s for %s to %s%s%s;',
           policyname, schemaname, tablename, permissive, cmd,
           (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') from unnest(roles) r),
           case when qual is not null then ' using (' || qual || ')' else '' end,
           case when with_check is not null then ' with check (' || with_check || ')' else '' end)
  from pg_policies where schemaname in ('public', 'storage');

  insert into app.etat_avant_chantier2 (kind, name, definition)
  select 'function', p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

  insert into app.etat_avant_chantier2 (kind, name, definition)
  select 'function_acl', p.oid::regprocedure::text,
         coalesce((select string_agg(case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end, ',')
                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.privilege_type = 'EXECUTE'), '')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

  insert into app.etat_avant_chantier2 (kind, name, definition)
  -- Lecture directe des droits (information_schema ne liste pas MAINTAIN, droit de PostgreSQL 17)
  select 'table_acl', c.relname || '|' || pg_get_userbyid(a.grantee), string_agg(a.privilege_type, ',' order by a.privilege_type)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
  group by c.relname, a.grantee;

  insert into app.etat_avant_chantier2 (kind, name, definition)
  select 'bucket', id, public::text from storage.buckets;

  insert into app.etat_avant_chantier2 (kind, name, definition)
  select 'view', c.relname, pg_get_viewdef(c.oid)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('trainees_safe', 'v_trainee_session_complete');

  insert into app.etat_avant_chantier2 (kind, name, definition)
  select 'profiles_role_check', 'profiles_role_check', pg_get_constraintdef(oid)
  from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_role_check';
end $$;

-- 1. Tâches planifiées -----------------------------------------------------------------------

create or replace function public.cron_call_vercel(p_path text)
returns bigint
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_secret text;
  v_url text;
  v_id bigint;
begin
  -- Seules les routes de l'API de l'application peuvent être appelées
  if p_path is null or p_path !~ '^/api/[a-z0-9/_-]+(\?[a-zA-Z0-9_=&%.-]*)?$' then
    raise exception 'Chemin refusé' using errcode = '42501';
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_secret is null then
    raise exception 'Clé cron_secret absente du coffre-fort Supabase';
  end if;

  select rtrim(decrypted_secret, '/') into v_url from vault.decrypted_secrets where name = 'app_url';
  if v_url is null or v_url = '' then
    raise exception 'Adresse de l''application (app_url) absente du coffre-fort Supabase';
  end if;

  select net.http_get(
    url := v_url || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 60000
  ) into v_id;

  return v_id;
end;
$function$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('cron_call_vercel', 'mailing_tick', 'signature_tick', 'signature_weekly_tick', 'social_tick')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to postgres, service_role', r.sig);
  end loop;
end $$;

-- 2. Clés de chiffrement ------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = '_encryption_keys'
  loop
    execute format('drop policy %I on public._encryption_keys', r.policyname);
  end loop;
end $$;
alter table public._encryption_keys enable row level security;
revoke all on table public._encryption_keys from public, anon, authenticated;
grant all on table public._encryption_keys to service_role;

-- 3. Déchiffrement du numéro de sécurité sociale -------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('decrypt_ssn', 'encrypt_ssn')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- 4. Droits sans usage sur les tables -------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  loop
    execute format('revoke truncate, trigger, references on table public.%I from anon, authenticated', r.relname);
  end loop;
end $$;

alter default privileges for role postgres in schema public revoke truncate, trigger, references on tables from anon, authenticated;

-- 5. Rôles des comptes externes prévus -------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = any (array[
  'superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture',
  'entreprise', 'formateur_externe', 'stagiaire'
]::text[]));

insert into public.schema_migrations (version) values ('0080_securite_urgences') on conflict (version) do nothing;

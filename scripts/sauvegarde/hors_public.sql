-- Ce que l'export standard de Supabase oublie : objets créés par odet dans les schémas
-- gérés par la plateforme (auth, storage). Le résultat est un script SQL rejouable.
--   1. Politiques d'accès (RLS) sur storage.objects, storage.buckets et auth.
--   2. Déclencheurs posés sur auth.* ou storage.* qui appellent une fonction d'odet
--      (exemple : on_auth_user_created qui crée le profil d'un nouvel utilisateur).
--   3. Tables publiées pour le temps réel (supabase_realtime).
select sql from (
  select 1 as ordre, policyname as cle,
         format('drop policy if exists %I on %I.%I;', policyname, schemaname, tablename) || E'\n' ||
         format('create policy %I on %I.%I as %s for %s to %s%s%s;',
                policyname, schemaname, tablename, permissive, cmd,
                (select string_agg(case when r::text = 'public' then 'public' else quote_ident(r::text) end, ', ')
                   from unnest(roles) r),
                coalesce(' using (' || qual || ')', ''),
                coalesce(' with check (' || with_check || ')', '')) as sql
  from pg_policies
  where schemaname in ('storage', 'auth')
  union all
  select 2, t.tgname,
         format('drop trigger if exists %I on %I.%I;', t.tgname, n.nspname, c.relname) || E'\n' ||
         pg_get_triggerdef(t.oid) || ';'
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace pn on pn.oid = p.pronamespace
  where n.nspname in ('auth', 'storage') and not t.tgisinternal
    and pn.nspname not in ('auth', 'storage')
  union all
  select 3, schemaname || '.' || tablename,
         format('alter publication supabase_realtime add table %I.%I;', schemaname, tablename)
  from pg_publication_tables
  where pubname = 'supabase_realtime'
) x
order by ordre, cle;

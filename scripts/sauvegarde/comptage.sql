-- Empreinte de la base : écrite dans la sauvegarde, puis comparée après restauration.
-- 1. Nombre de lignes de chaque table de public, des comptes utilisateurs et de la
--    fiche des fichiers du Storage.
-- 2. Nombre d'objets de sécurité et de logique (politiques RLS, fonctions, déclencheurs).
select table_complete, lignes from (
  select format('%s.%s', table_schema, table_name) as table_complete,
         (xpath('/row/c/text()',
                query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint as lignes
  from information_schema.tables
  where table_type = 'BASE TABLE'
    and (table_schema = 'public'
         or (table_schema, table_name) in (('auth', 'users'), ('auth', 'identities'),
                                           ('storage', 'buckets'), ('storage', 'objects')))
  union all
  select 'controle.politiques_' || schemaname, count(*)
  from pg_policies where schemaname in ('public', 'storage', 'auth') group by schemaname
  union all
  select 'controle.fonctions_public', count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select 'controle.declencheurs_' || n.nspname, count(*)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace pn on pn.oid = p.pronamespace
  where not t.tgisinternal and n.nspname in ('public', 'auth', 'storage') and pn.nspname not in ('auth', 'storage')
  group by n.nspname
  union all
  -- Empreinte exacte des droits (tables, vues, colonnes, fonctions) : un seul droit
  -- différent change le nombre, et la comparaison échoue.
  select 'controle.empreinte_droits_tables', ('x' || left(md5(coalesce(string_agg(c.relname || ':' || coalesce(c.relacl::text, '-'), '|' order by c.relname), '')), 12))::bit(48)::bigint
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'S', 'p')
  union all
  select 'controle.empreinte_droits_colonnes', ('x' || left(md5(coalesce(string_agg(c.relname || '.' || a.attname || ':' || a.attacl::text, '|' order by c.relname, a.attname), '')), 12))::bit(48)::bigint
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and a.attacl is not null
  union all
  select 'controle.empreinte_droits_fonctions', ('x' || left(md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || coalesce(p.proacl::text, '-'), '|' order by p.oid::regprocedure::text), '')), 12))::bit(48)::bigint
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
) x
order by 1;

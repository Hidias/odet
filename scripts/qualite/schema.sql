-- Colonnes et clés étrangères du schéma public, au format lu par scripts/qualite/colonnes.mjs
select json_build_object(
  'cols', (select json_object_agg(t, c) from (
    select table_name as t, json_agg(column_name order by ordinal_position) as c
    from information_schema.columns where table_schema = 'public' group by 1) x),
  'fks', (select json_agg(json_build_object('t', cl.relname, 'col', a.attname, 'ref', rc.relname, 'name', con.conname))
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    join pg_class rc on rc.oid = con.confrelid
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.contype = 'f' and n.nspname = 'public' and array_length(con.conkey, 1) = 1)
);

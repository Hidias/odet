-- Retour arrière de 0524 : lignes de registre retirées (0523 reste appliquée en base).
delete from public.schema_migrations where version in ('0523_comptes_externes_role', '0524_registre_0523');

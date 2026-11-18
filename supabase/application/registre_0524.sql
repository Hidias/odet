-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (registre_0524) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0524_registre_0523.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0524_registre_0523_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0524_registre_0523.sql =====
-- 0524 : inscription au registre de 0523 (comptes extérieurs), appliquée le 18/11 sous le nom 0522 sans sa ligne de
-- registre, puis renumérotée (0522 est pris par la branche RH). Rejouer 0523 n'est pas possible à l'identique : son
-- retour arrière défait une reprise déjà faite. Rien d'autre ne change.
-- Retour arrière : supabase/rollback/0524_registre_0523_retour.sql
insert into public.schema_migrations (version) values ('0523_comptes_externes_role') on conflict (version) do nothing;
insert into public.schema_migrations (version) values ('0524_registre_0523') on conflict (version) do nothing;

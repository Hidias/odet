-- 0261_registre_migrations.sql : régularisation du registre des migrations (chantier A, mise en service).
--
-- Deux registres existent :
--   public.schema_migrations              tenu par les migrations du dépôt (chaque fichier s'y inscrit) ; lu par la
--                                         Console (« Migrations appliquées ») et par scripts/migrations/lancer.sh ;
--   supabase_migrations.schema_migrations tenu par l'outil Supabase, arrêté le 14/10 (13 versions horodatées).
-- Référence retenue : public.schema_migrations (décision du chantier A, choix prudent : c'est celui que lisent
-- la Console et l'action de migration). Le registre Supabase est laissé tel quel, comme historique.
--
-- Constat en production le 19/10 (lecture seule) :
--   0190_passeport_prevention  objets présents (8 tables pp_*, 10 fonctions pp_*, module « passeport »),
--                              mais absente du registre : inscrite ici, sans rien rejouer ;
--   0110_finance_generique     NON appliquée (contrainte du payeur, valeur par défaut du repas, libellé de compte
--                              et get_budget_kpis encore dans leur version d'origine) : non inscrite, non appliquée.
-- L'inscription n'a lieu que si les objets de 0190 existent vraiment ; sinon rien n'est écrit.
-- Aucune table, aucune règle, aucune donnée métier touchée. Idempotente.
-- Retour arrière : supabase/rollback/0261_registre_migrations_retour.sql

do $$
begin
  if to_regclass('public.pp_lignes') is not null
     and to_regclass('public.pp_nir') is not null
     and to_regclass('public.pp_format_versions') is not null
     and to_regprocedure('public.pp_can()') is not null
     and exists (select 1 from public.org_modules where key = 'passeport') then
    insert into public.schema_migrations (version) values ('0190_passeport_prevention') on conflict (version) do nothing;
  end if;
end $$;

insert into public.schema_migrations (version) values ('0261_registre_migrations') on conflict (version) do nothing;

-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (contraintes_0393) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0393_contraintes_societe.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0393_contraintes_societe_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0393_contraintes_societe.sql =====
-- 0393 : plus de prénoms d'un autre organisme dans les contraintes de la base (point D16 de la liste unique).
-- Trois contraintes n'acceptaient que les dirigeants d'Access Formation :
--   - budget_transactions.payer : 'entreprise', 'hicham_perso', 'maxime_perso' ; l'écran écrit pourtant
--     'perso_<identifiant du profil>' depuis la reprise générique du budget : une dépense personnelle d'un associé
--     de GLD était refusée ;
--   - budget_meal_guests.meal_for : 'hicham', 'maxime' ; l'écran écrit le prénom de l'associé (« hubert »…) ;
--   - prospect_rdv.conducted_by : 'Hicham', 'Maxime' ; l'écran propose les prénoms de l'équipe : un rendez-vous
--     mené par Hubert ou Anthony était refusé.
-- Nouvelles règles, sans nom en dur : forme de la valeur seulement. Les anciennes valeurs restent valides. Idempotent.

alter table public.budget_transactions drop constraint if exists budget_transactions_payer_check;
alter table public.budget_transactions add constraint budget_transactions_payer_check
  check (payer is null or payer = 'entreprise' or payer ~ '^perso_[0-9a-f-]{36}$' or payer ~ '^[a-z0-9_]{1,40}_perso$');

alter table public.budget_meal_guests drop constraint if exists budget_meal_guests_meal_for_check;
alter table public.budget_meal_guests add constraint budget_meal_guests_meal_for_check
  check (meal_for is null or meal_for ~ '^[a-z0-9_]{1,40}$');

alter table public.prospect_rdv drop constraint if exists prospect_rdv_conducted_by_check;
alter table public.prospect_rdv add constraint prospect_rdv_conducted_by_check
  check (conducted_by is null or length(btrim(conducted_by)) between 1 and 100);

insert into public.schema_migrations (version) values ('0393_contraintes_societe') on conflict (version) do nothing;

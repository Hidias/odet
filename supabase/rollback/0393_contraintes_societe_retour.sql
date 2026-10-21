-- Retour arrière de 0393_contraintes_societe.sql : retire les trois règles de forme posées par 0393. Les anciennes
-- règles nominatives de l'organisme d'origine ne sont pas remises (marque blanche). Idempotent.

alter table public.budget_transactions drop constraint if exists budget_transactions_payer_check;
alter table public.budget_meal_guests drop constraint if exists budget_meal_guests_meal_for_check;
alter table public.prospect_rdv drop constraint if exists prospect_rdv_conducted_by_check;

delete from public.schema_migrations where version = '0393_contraintes_societe';

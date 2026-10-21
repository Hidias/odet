-- Retour arrière de 0393_contraintes_societe.sql : remet les trois contraintes d'origine. Idempotent.
-- Échoue si des lignes enregistrées depuis utilisent une valeur que l'ancienne règle refusait (rien n'est effacé).

alter table public.budget_transactions drop constraint if exists budget_transactions_payer_check;
alter table public.budget_transactions add constraint budget_transactions_payer_check
  check (payer = any (array['entreprise'::text, 'hicham_perso'::text, 'maxime_perso'::text]));

alter table public.budget_meal_guests drop constraint if exists budget_meal_guests_meal_for_check;
alter table public.budget_meal_guests add constraint budget_meal_guests_meal_for_check
  check (meal_for = any (array['hicham'::text, 'maxime'::text]));

alter table public.prospect_rdv drop constraint if exists prospect_rdv_conducted_by_check;
alter table public.prospect_rdv add constraint prospect_rdv_conducted_by_check
  check (((conducted_by)::text = any (array[('Hicham'::character varying)::text, ('Maxime'::character varying)::text, (null::character varying)::text])));

delete from public.schema_migrations where version = '0393_contraintes_societe';

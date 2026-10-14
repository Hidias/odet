-- 0110_finance_generique.sql : module Budget sans prénom ni banque d'un organisme particulier.
--
-- 1. Payeur d'une dépense personnelle : « perso_<id du profil> » pour tout associé (rôle superadmin ou admin).
--    Les anciennes valeurs « <prénom>_perso » restent acceptées et lisibles.
-- 2. Repas : la personne invitante n'est plus limitée à deux prénoms ; plus de valeur par défaut nominative.
-- 3. Relevés bancaires : plus de libellé de compte par défaut (il vient de Paramètres > banque).
-- 4. get_budget_kpis : comptes courants d'associés renvoyés par payeur (jsonb), quel que soit leur nombre.
-- Migration sans perte : aucune ligne n'est modifiée.

alter table public.budget_transactions drop constraint if exists budget_transactions_payer_check;
alter table public.budget_transactions
  add constraint budget_transactions_payer_check
  check (payer is null or payer = 'entreprise' or payer ~ '^perso_[0-9a-f-]{36}$' or payer ~ '^[a-z0-9-]+_perso$');

alter table public.budget_meal_guests drop constraint if exists budget_meal_guests_meal_for_check;
alter table public.budget_meal_guests alter column meal_for drop default;

alter table public.bank_statements alter column account_label drop default;

drop function if exists public.get_budget_kpis();
create function public.get_budget_kpis()
returns table(solde_compte numeric, solde_date date, total_credit numeric, total_debit numeric, cca jsonb, nb_transactions bigint)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    round(coalesce(sum(coalesce(credit,0) - coalesce(debit,0)) filter (where is_manual = false), 0)::numeric, 2),
    max(date) filter (where is_manual = false),
    round(coalesce(sum(coalesce(credit,0)) filter (where is_personal = false and linked_transaction_id is null), 0)::numeric, 2),
    round(coalesce(sum(coalesce(debit,0)) filter (where is_personal = false and linked_transaction_id is null), 0)::numeric, 2),
    coalesce((
      select jsonb_object_agg(p.payer, p.total)
      from (
        select payer, round(sum(coalesce(debit,0) - coalesce(credit,0))::numeric, 2) as total
        from budget_transactions
        where is_personal = true and payer is not null and payer <> 'entreprise'
        group by payer
      ) p
    ), '{}'::jsonb),
    count(*)
  from budget_transactions;
$function$;

revoke all on function public.get_budget_kpis() from public, anon;
grant execute on function public.get_budget_kpis() to authenticated, service_role;

insert into public.schema_migrations (version) values ('0110_finance_generique') on conflict (version) do nothing;

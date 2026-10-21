-- 0412 : marque blanche, plus aucun nom de personne ni d'organisme écrit dans la base (décision de H du 21/10 :
-- « 0 infos qui traînent dans le code ; tout ce qui est personnalisé est dans Supabase, avec une seule saisie »).
-- Restes de l'outil d'origine retirés, sans toucher aux données (les tables concernées sont vides en production) :
--   1. budget_meal_guests.meal_for : plus de personne invitante par défaut (l'écran choisit l'associé) ;
--      bank_statements.account_label : plus de banque ni de numéro de compte par défaut (lu sur le relevé).
--   2. Comptes courants des associés (vue budget_compte_courant, fonction get_budget_kpis) : les associés sont les
--      comptes de la société (payeur « perso_<identifiant du compte> »), leur nom est lu dans leur fiche ; les
--      totaux par associé nommé deviennent un total par payeur (cca, lu par l'écran Budget), quel que soit leur
--      nombre. La fonction reste soumise au cloisonnement (pas de security definer : chaque société ne voit que ses
--      lignes).
--   3. social_posts : colonne de publication LinkedIn propre à une personne retirée (vide), trouvée par sa forme.
--   4. Commentaire de la colonne d'exonération de la formation sans nom de société.
--   5. organization_settings.traces_a_signaler : noms ou numéros d'un ancien organisme à repérer dans les modèles de
--      documents, saisis une fois dans les paramètres (ils étaient écrits dans le code).
-- Migration idempotente. Retour arrière : supabase/rollback/0412_marque_blanche_retour.sql, qui rejoue l'état
-- d'avant noté dans la base au premier passage (app.retour_0412) : aucun nom n'est écrit dans le dépôt pour cela.

-- 0. État d'avant, noté dans la base au premier passage seulement
create table if not exists app.retour_0412 (ordre serial primary key, instruction text not null);
revoke all on app.retour_0412 from public, anon, authenticated;
do $$
declare r record;
begin
  if exists (select 1 from app.retour_0412) then return; end if;
  insert into app.retour_0412 (instruction)
  select format('alter table public.%I alter column %I set default %s', c.table_name, c.column_name, c.column_default)
  from information_schema.columns c
  where c.table_schema = 'public' and c.column_default is not null
    and (c.table_name, c.column_name) in (('budget_meal_guests', 'meal_for'), ('bank_statements', 'account_label'));
  if to_regclass('public.budget_compte_courant') is not null then
    insert into app.retour_0412 (instruction)
    select 'create or replace view public.budget_compte_courant'
           || coalesce(' with (' || array_to_string(c.reloptions, ', ') || ')', '')
           || ' as ' || pg_get_viewdef(c.oid, true)
    from pg_class c where c.oid = 'public.budget_compte_courant'::regclass;
  end if;
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'get_budget_kpis' loop
    insert into app.retour_0412 (instruction) values ('drop function if exists ' || r.oid::regprocedure::text);
    insert into app.retour_0412 (instruction) values (pg_get_functiondef(r.oid));
    insert into app.retour_0412 (instruction) values ('revoke all on function ' || r.oid::regprocedure::text || ' from public');
    insert into app.retour_0412 (instruction)
    select format('grant %s on function %s to %s', a.privilege_type, r.oid::regprocedure::text,
                  case when a.grantee = 0 then 'public' else quote_ident(a.grantee::regrole::text) end)
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = r.oid and a.grantee <> p.proowner;
  end loop;
  insert into app.retour_0412 (instruction)
  select format('alter table public.social_posts add column if not exists %I %s', a.attname, format_type(a.atttypid, a.atttypmod))
  from pg_attribute a
  where a.attrelid = 'public.social_posts'::regclass and a.attnum > 0 and not a.attisdropped
    and a.attname ~ '^content_linkedin_[a-z]+$';
  insert into app.retour_0412 (instruction)
  select format('comment on column public.billing_settings.exoneration_formation_active is %L',
                col_description('public.billing_settings'::regclass, a.attnum))
  from pg_attribute a
  where a.attrelid = 'public.billing_settings'::regclass and a.attname = 'exoneration_formation_active'
    and col_description('public.billing_settings'::regclass, a.attnum) is not null;
end $$;

-- 1. Repas, relevés bancaires
alter table public.budget_meal_guests alter column meal_for drop default;
alter table public.bank_statements alter column account_label drop default;

-- 2. Comptes courants des associés
create or replace view public.budget_compte_courant with (security_invoker = true) as
select t.payer,
       case when t.payer = 'entreprise' then 'Entreprise'
            else coalesce((select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email)
                           from public.profiles p where 'perso_' || p.id::text = t.payer), t.payer) end as associe_nom,
       count(*) as nb_operations,
       sum(t.debit) as total_debit,
       sum(t.credit) as total_credit,
       sum(t.debit) - sum(t.credit) as dette_gerant
from public.budget_transactions t
where t.is_personal = true
group by t.payer;

drop function if exists public.get_budget_kpis();
create function public.get_budget_kpis()
returns table(solde_compte numeric, solde_date date, total_credit numeric, total_debit numeric, cca jsonb, nb_transactions bigint)
language sql
stable
set search_path to 'public'
as $function$
  select
    round(coalesce(sum(coalesce(credit, 0) - coalesce(debit, 0)) filter (where is_manual = false), 0)::numeric, 2) as solde_compte,
    max(date) filter (where is_manual = false) as solde_date,
    round(coalesce(sum(coalesce(credit, 0)) filter (where is_personal = false and linked_transaction_id is null), 0)::numeric, 2) as total_credit,
    round(coalesce(sum(coalesce(debit, 0)) filter (where is_personal = false and linked_transaction_id is null), 0)::numeric, 2) as total_debit,
    coalesce((select jsonb_object_agg(x.payer, x.total)
              from (select b.payer, round(sum(coalesce(b.debit, 0) - coalesce(b.credit, 0))::numeric, 2) as total
                    from budget_transactions b
                    where b.is_personal = true and b.payer is not null and b.payer <> 'entreprise'
                    group by b.payer) x), '{}'::jsonb) as cca,
    count(*) as nb_transactions
  from budget_transactions;
$function$;
revoke all on function public.get_budget_kpis() from public, anon;
grant execute on function public.get_budget_kpis() to authenticated, service_role;

-- 3. Colonne LinkedIn propre à une personne (content_linkedin_<prénom>), retirée si elle est vide
do $$
declare c text; n bigint;
begin
  for c in select column_name from information_schema.columns
           where table_schema = 'public' and table_name = 'social_posts' and column_name ~ '^content_linkedin_[a-z]+$' loop
    execute format('select count(*) from public.social_posts where %I is not null', c) into n;
    if n = 0 then execute format('alter table public.social_posts drop column %I', c); end if;
  end loop;
end $$;

-- 4. Commentaire sans nom de société
comment on column public.billing_settings.exoneration_formation_active is
  'Exonération de la formation (attestation DREETS, formulaire 3511-SD), désactivée par défaut';

-- 5. Traces d'un ancien organisme à repérer dans les modèles, saisies dans les paramètres
alter table public.organization_settings add column if not exists traces_a_signaler text[] not null default '{}';
comment on column public.organization_settings.traces_a_signaler is
  'Noms, adresses ou numéros d''un ancien organisme à signaler dans les modèles de documents (jamais remplacés automatiquement)';

insert into public.schema_migrations (version) values ('0412_marque_blanche') on conflict (version) do nothing;

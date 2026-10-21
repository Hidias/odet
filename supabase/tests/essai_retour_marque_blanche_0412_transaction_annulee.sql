-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (marque_blanche_0412) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0412_marque_blanche.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

-- ===== supabase/migrations/0412_marque_blanche.sql =====
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

-- ===== supabase/rollback/0412_marque_blanche_retour.sql =====
-- Retour arrière de 0412_marque_blanche.sql : rejoue l'état d'avant noté dans la base au premier passage
-- (app.retour_0412 : défauts, vue et fonction des comptes des associés, colonne vide, commentaire), puis retire la
-- colonne des traces à signaler. Les colonnes rajoutées reviennent vides (elles l'étaient). Idempotent.

do $$
declare r record;
begin
  if to_regclass('app.retour_0412') is null then return; end if;
  for r in select instruction from app.retour_0412 order by ordre loop
    execute r.instruction;
  end loop;
end $$;
drop table if exists app.retour_0412;

alter table public.organization_settings drop column if exists traces_a_signaler;

delete from public.schema_migrations where version = '0412_marque_blanche';

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE marque_blanche_0412 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

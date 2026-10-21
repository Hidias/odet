-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (contraintes_0393) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0393_contraintes_societe.sql, retour arrière,
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

-- ===== supabase/rollback/0393_contraintes_societe_retour.sql =====
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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE contraintes_0393 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (vue_groupe_0516) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0516_vue_groupe_lecture_seule.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0516_vue_groupe_lecture_seule_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0516_vue_groupe_lecture_seule.sql =====
-- 0516 : vue groupe en vraie lecture seule (décision de H du 08/11).
-- Le sélecteur de sociétés annonce « Vue groupe, lecture seule » et le bandeau dit « pour créer ou modifier, choisissez
-- une société dans l'en-tête », mais la base acceptait les écritures (elles partaient dans la société par défaut du
-- compte). Désormais, en vue groupe, toute écriture d'un compte connecté sur une table rattachée à une société est
-- refusée avec ce message.
--   1. app.vue_groupe_lecture_seule() : déclencheur par instruction (une seule lecture du contexte par requête,
--      app.vue_groupe() est mémorisée) ; sans compte connecté (tâches de nuit, clé de service), rien ne change.
--      Une écriture faite par un autre déclencheur (pg_trigger_depth() > 1) passe : c'est la suite d'une écriture
--      déjà admise (ex. profile_to_trainer : le compte qui corrige son propre nom met à jour sa fiche formateur).
--      Vigilance : un futur déclencheur posé sur une table laissée ouverte (ou sans company_id) qui INSÈRE dans une
--      table fermée passerait aussi en vue groupe, rangé dans la société par défaut : à éviter, ou à contrôler.
--   2. app.vue_groupe_poser() : pose le déclencheur sur toutes les tables de public qui ont une colonne company_id,
--      sauf les journaux et les réglages qui désignent leur société eux-mêmes (liste ci-dessous) ; idempotente, à
--      rappeler après la création d'une table rattachée à une société.
-- Tables laissées ouvertes : journaux (audit_logs, error_logs, job_runs, import_logs, auto_send_switch_log,
-- session_document_access), notifications lues, retours des utilisateurs (user_feedback), « Quoi de neuf »
-- (platform_notices), réglages qui désignent leur société eux-mêmes (company_members, company_member_rights,
-- company_modules, company_establishments, permission_profile_rights, support_access_grants), abonnements aux
-- alertes du téléphone de chaque compte (push_subscriptions).
-- Additive. Idempotente. Retour arrière : supabase/rollback/0516_vue_groupe_lecture_seule_retour.sql

create or replace function app.vue_groupe_lecture_seule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if (select auth.uid()) is not null and coalesce(app.vue_groupe(), false) then
    raise exception 'Vue groupe : lecture seule. Pour créer ou modifier, choisissez une société dans l''en-tête.'
      using errcode = '42501';
  end if;
  return null;
end
$$;
revoke all on function app.vue_groupe_lecture_seule() from public, anon, authenticated;

create or replace function app.vue_groupe_poser()
returns int
language plpgsql
set search_path = ''
as $$
declare
  t text;
  n int := 0;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'company_id'
      and c.table_name <> all (array['audit_logs', 'error_logs', 'job_runs', 'import_logs', 'auto_send_switch_log',
        'session_document_access', 'notifications', 'user_feedback', 'platform_notices', 'company_members',
        'company_member_rights', 'company_modules', 'company_establishments', 'permission_profile_rights',
        'support_access_grants', 'push_subscriptions'])
    order by 1
  loop
    if not exists (select 1 from pg_trigger g where g.tgrelid = format('public.%I', t)::regclass and g.tgname = 'aa_vue_groupe_lecture') then
      execute format('create trigger aa_vue_groupe_lecture before insert or update or delete on public.%I for each statement execute function app.vue_groupe_lecture_seule()', t);
      n := n + 1;
    end if;
  end loop;
  return n;
end
$$;
revoke all on function app.vue_groupe_poser() from public, anon, authenticated;

select app.vue_groupe_poser();

insert into public.schema_migrations (version) values ('0516_vue_groupe_lecture_seule') on conflict (version) do nothing;

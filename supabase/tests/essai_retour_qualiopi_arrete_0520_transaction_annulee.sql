-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (qualiopi_arrete_0520) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0520_qualiopi_arrete_2026.sql, retour arrière,
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

-- ===== supabase/migrations/0520_qualiopi_arrete_2026.sql =====
-- 0520 : référentiel au 1er novembre 2026, données de l'arrêté du 28 octobre 2026 relatif aux modalités d'audit
-- (JO du 1er novembre 2026, JORFTEXT000055041105, relu sur Légifrance le 16/11/2026).
--   1. Nouveaux entrants : la formalisation suffit à l'audit initial pour les indicateurs 2, 3, 11, 13, 14, 19, 24,
--      25 et 26 ; 22 et 32 ne sont plus dans la liste (référentiel de 2019 inchangé).
--   2. Seuils fixés par cet arrêté : huit intervenants par formation (indicateur 19), 50 % des heures d'enseignement
--      par des intervenants permanents (indicateur 20). Notes « non paru » remplacées.
--   3. Note du référentiel : guide de lecture V10 en ligne depuis le 30 octobre 2026, arrêté paru au JO du 1er novembre.
-- Données seulement, aucune fonction ni règle.

update public.cert_indicators
   set new_entrant_light = number in (2, 3, 11, 13, 14, 19, 24, 25, 26)
 where referential_code = 'rnq-2026'
   and new_entrant_light is distinct from (number in (2, 3, 11, 13, 14, 19, 24, 25, 26));

update public.cert_indicators
   set change_note = 'Preuve du suivi effectif des modules à distance ; référent pédagogique par formation au-delà de huit intervenants (arrêté du 28 octobre 2026).'
 where referential_code = 'rnq-2026' and number = 19;

update public.cert_indicators
   set change_note = 'Pilotage et gouvernance ; supervision renforcée quand moins de 50 % des heures d''enseignement sont réalisées par des intervenants permanents (arrêté du 28 octobre 2026).'
 where referential_code = 'rnq-2026' and number = 20;

update public.cert_referentials
   set notes = 'Guide de lecture V10 en ligne depuis le 30 octobre 2026. Arrêté du 28 octobre 2026 (JO du 1er novembre 2026) : modalités d''audit, nouveaux entrants (indicateurs 2, 3, 11, 13, 14, 19, 24, 25 et 26), seuils des indicateurs 19 (huit intervenants) et 20 (50 % d''heures par des intervenants permanents).'
 where code = 'rnq-2026';

insert into public.schema_migrations (version) values ('0520_qualiopi_arrete_2026') on conflict (version) do nothing;

-- ===== supabase/rollback/0520_qualiopi_arrete_2026_retour.sql =====
-- Retour arrière de 0520 : liste des nouveaux entrants, notes des indicateurs 19 et 20 et note du référentiel
-- au 1er novembre 2026 remises comme avant (état du 16/11/2026).

update public.cert_indicators
   set new_entrant_light = number in (2, 3, 11, 13, 14, 19, 22, 24, 25, 26, 32)
 where referential_code = 'rnq-2026';

update public.cert_indicators
   set change_note = 'Preuve du suivi effectif des modules à distance ; référent pédagogique au-delà d''un seuil d''intervenants fixé par arrêté (non paru au 11 octobre 2026).'
 where referential_code = 'rnq-2026' and number = 19;

update public.cert_indicators
   set change_note = 'Pilotage et gouvernance ; supervision renforcée sous un seuil fixé par arrêté (non paru au 11 octobre 2026).'
 where referential_code = 'rnq-2026' and number = 20;

update public.cert_referentials
   set notes = 'Arrêtés des indicateurs 19 et 20 et guide de lecture v10 non parus au 11 octobre 2026.'
 where code = 'rnq-2026';

delete from public.schema_migrations where version = '0520_qualiopi_arrete_2026';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE qualiopi_arrete_0520 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

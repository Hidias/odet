-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (comptes_0053) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0053_nom_affiche_calcule.sql, retour arrière,
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

-- ===== supabase/migrations/0053_nom_affiche_calcule.sql =====
-- 0053_nom_affiche_calcule.sql : le nom affiché d'un compte se calcule à partir du prénom et du nom (fin de la
-- double saisie signalée par H le 19/10 à 16h53 : nom de famille ajouté, mais l'écran montrait toujours « Anthony »).
--
-- profiles.display_name était un champ à part, saisi à l'invitation, que la plupart des écrans affichent. Désormais,
-- dès qu'un prénom ou un nom est renseigné, display_name = « Prénom Nom » (nom en majuscules ramené en casse
-- normale : « POUPARD » donne « Poupard »). Sans prénom ni nom, display_name reste tel quel (comptes d'essai,
-- comptes créés avec une adresse seule).
-- Aucune donnée modifiée ici (retour arrière sans écart) : le rattrapage des comptes actifs se fait après
-- l'application, par une mise à jour de leurs prénom et nom (le déclencheur recalcule le nom affiché).
-- Aucune table nouvelle. Migration additive. Idempotente.
-- Retour arrière : supabase/rollback/0053_nom_affiche_calcule_retour.sql

create or replace function app.nom_affiche(p_prenom text, p_nom text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(concat_ws(' ',
    nullif(btrim(p_prenom), ''),
    case when btrim(p_nom) = upper(btrim(p_nom)) then initcap(lower(btrim(p_nom))) else nullif(btrim(p_nom), '') end
  )), '')
$$;

create or replace function app.profiles_nom_affiche()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v text := app.nom_affiche(new.first_name, new.last_name);
begin
  if v is not null then
    new.display_name := v;
  end if;
  return new;
end $$;

drop trigger if exists profiles_nom_affiche on public.profiles;
create trigger profiles_nom_affiche
  before insert or update of first_name, last_name, display_name on public.profiles
  for each row execute function app.profiles_nom_affiche();

insert into public.schema_migrations (version) values ('0053_nom_affiche_calcule') on conflict (version) do nothing;

-- ===== supabase/rollback/0053_nom_affiche_calcule_retour.sql =====
-- Retour arrière de 0053_nom_affiche_calcule.sql. Idempotent. Les noms affichés recalculés restent (valeurs justes).

drop trigger if exists profiles_nom_affiche on public.profiles;
drop function if exists app.profiles_nom_affiche();
drop function if exists app.nom_affiche(text, text);

delete from public.schema_migrations where version = '0053_nom_affiche_calcule';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE comptes_0053 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

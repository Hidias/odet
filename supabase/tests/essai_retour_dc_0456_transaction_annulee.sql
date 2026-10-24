-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (dc_0456) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0456_derniere_connexion.sql, retour arrière,
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

-- ===== supabase/migrations/0456_derniere_connexion.sql =====
-- 0456 : dernière connexion des comptes de l'espace formateur, stagiaire et entreprise (recette de H du 24/10 : un
-- formateur externe connecté restait « pas encore connecté » sur sa fiche). profiles.last_seen_at n'est jamais écrit ;
-- la date vient désormais de la dernière connexion du compte (auth.users.last_sign_in_at), lue par la base seule.
-- Migration additive (deux fonctions corrigées par remplacement exact). Idempotente.
-- Retour arrière : supabase/rollback/0456_derniere_connexion_retour.sql
do $do$
declare
  r record;
  v_def text;
  v_ancien text := '''last_seen_at'', p.last_seen_at';
  v_nouveau text := '''last_seen_at'', coalesce(p.last_seen_at, (select u.last_sign_in_at from auth.users u where u.id = p.id)) /* 0456 */';
begin
  for r in select * from (values ('public.acces_externe_etat(text, uuid)'), ('public.client_accounts_etat(uuid)')) as t(sig) loop
    v_def := pg_get_functiondef(r.sig::regprocedure);
    continue when position('/* 0456 */' in v_def) > 0;
    if position(v_ancien in v_def) = 0 then
      raise exception 'Fonction % inattendue : rien n''est changé', r.sig;
    end if;
    execute replace(v_def, v_ancien, v_nouveau);
  end loop;
end
$do$;

insert into public.schema_migrations (version) values ('0456_derniere_connexion') on conflict (version) do nothing;

-- ===== supabase/rollback/0456_derniere_connexion_retour.sql =====
-- Retour arrière de 0456_derniere_connexion.sql. Idempotent.
do $do$
declare
  r record;
  v_def text;
  v_ancien text := '''last_seen_at'', p.last_seen_at';
  v_nouveau text := '''last_seen_at'', coalesce(p.last_seen_at, (select u.last_sign_in_at from auth.users u where u.id = p.id)) /* 0456 */';
begin
  for r in select * from (values ('public.acces_externe_etat(text, uuid)'), ('public.client_accounts_etat(uuid)')) as t(sig) loop
    v_def := pg_get_functiondef(r.sig::regprocedure);
    if position(v_nouveau in v_def) > 0 then
      execute replace(v_def, v_nouveau, v_ancien);
    end if;
  end loop;
end
$do$;
delete from public.schema_migrations where version = '0456_derniere_connexion';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE dc_0456 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

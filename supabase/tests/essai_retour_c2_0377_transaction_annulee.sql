-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c2_0377) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0377_droits_ecrans.sql, retour arrière,
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

-- ===== supabase/migrations/0377_droits_ecrans.sql =====
-- 0377_droits_ecrans.sql : fonctions des écrans de droits (chantier 2, branche droits/ecrans).
--
-- Écrans servis : Paramètres › Droits des personnes, Paramètres › Profils de droits, Règles de gestion
-- (circuits de validation, devis du comptable externe).
-- Ce que la base fait ici, et que l'écran ne doit pas recalculer (une seule source) :
--   member_rights_preview(compte)       droits et profils effectifs d'une personne dans la société courante
--   permission_profile_customize(clé)   copie d'un modèle pour la société, en une seule transaction (une copie
--                                       vide remplacerait le modèle et retirerait des droits à tout le monde)
--   permission_profile_reset(clé)       retour au modèle (suppression de la copie de la société)
--   external_accountant_quotes_visible() lecture du réglage des devis du comptable externe
-- Chaque changement de profil est noté au journal d'audit (sans donnée personnelle).
-- Aucune nouvelle table, aucune règle d'accès modifiée. Idempotente.
-- Retour arrière : supabase/rollback/0377_droits_ecrans_retour.sql

create or replace function public.member_rights_preview(p_profile uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.current_company();
begin
  if p_profile is distinct from (select auth.uid()) and not app.a_le_droit('parametres.droits.attribuer') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'company_id', v_company,
    'role', app.role_of(p_profile),
    'profiles', to_jsonb(app.profiles_for(p_profile, v_company)),
    'rights', to_jsonb(app.rights_for(p_profile, v_company)));
end
$$;

create or replace function public.permission_profile_customize(p_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.current_company();
  v_prof uuid;
begin
  if v_company is null or not app.a_le_droit('parametres.profils.gerer') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_key in ('superadmin', 'membre') then
    raise exception 'Ce profil ne se personnalise pas' using errcode = '22023';
  end if;
  select p.id into v_prof from public.permission_profiles p where p.company_id = v_company and p.key = p_key;
  if v_prof is not null then
    return v_prof;
  end if;
  insert into public.permission_profiles (company_id, key, label, description, base_role, position, created_by)
  select v_company, p.key, p.label, p.description, p.base_role, p.position, (select auth.uid())
  from public.permission_profiles p where p.company_id is null and p.key = p_key
  returning id into v_prof;
  if v_prof is null then
    raise exception 'Modèle introuvable : %', p_key using errcode = '22023';
  end if;
  insert into public.permission_profile_rights (profile_id, right_code)
  select v_prof, r.right_code from public.permission_profile_rights r
  join public.permission_profiles p on p.id = r.profile_id
  where p.company_id is null and p.key = p_key;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'create', 'system', 'Profil de droits personnalisé',
          jsonb_build_object('company_id', v_company, 'profil', p_key));
  return v_prof;
end
$$;

create or replace function public.permission_profile_reset(p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.current_company();
  v_n int;
begin
  if v_company is null or not app.a_le_droit('parametres.profils.gerer') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if not exists (select 1 from public.permission_profiles p where p.company_id is null and p.key = p_key) then
    raise exception 'Profil propre à la société sans modèle : il ne se réinitialise pas' using errcode = '22023';
  end if;
  delete from public.permission_profiles where company_id = v_company and key = p_key;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into public.audit_logs (user_id, user_email, action, entity_type, entity_name, details)
    values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'delete', 'system', 'Profil de droits remis au modèle',
            jsonb_build_object('company_id', v_company, 'profil', p_key));
  end if;
  return v_n > 0;
end
$$;

create or replace function public.external_accountant_quotes_visible()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.a_le_droit('facturation.comptable_externe.regler') then
    coalesce((select exists (select 1 from public.permission_profile_rights r where r.profile_id = p.id
                                and r.right_code = 'commercial.devis.voir')
              from public.permission_profiles p
              where p.key = 'comptable_externe' and (p.company_id = app.current_company() or p.company_id is null)
              order by (p.company_id is null) limit 1), false)
  end
$$;

revoke all on function public.member_rights_preview(uuid), public.permission_profile_customize(text),
  public.permission_profile_reset(text), public.external_accountant_quotes_visible() from public, anon;
grant execute on function public.member_rights_preview(uuid), public.permission_profile_customize(text),
  public.permission_profile_reset(text), public.external_accountant_quotes_visible() to authenticated;

insert into public.schema_migrations (version) values ('0377_droits_ecrans') on conflict (version) do nothing;

-- ===== supabase/rollback/0377_droits_ecrans_retour.sql =====
-- Retour arrière de 0377_droits_ecrans.sql : retire les fonctions des écrans de droits.
-- Les profils déjà personnalisés par une société restent (ce sont des lignes de permission_profiles, gérables
-- aussi sans ces fonctions). Idempotent.

drop function if exists public.member_rights_preview(uuid);
drop function if exists public.permission_profile_customize(text);
drop function if exists public.permission_profile_reset(text);
drop function if exists public.external_accountant_quotes_visible();

delete from public.schema_migrations where version = '0377_droits_ecrans';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE c2_0377 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

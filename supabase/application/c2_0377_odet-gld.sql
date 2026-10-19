-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c2_0377) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0377_droits_ecrans.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0377_droits_ecrans_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

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

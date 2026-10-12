-- 0026_identite_parametrable.sql : plus aucune personne ni adresse d'un organisme écrite dans les fonctions.
-- 1. Les initiales de l'entreprise (organization_settings.doc_prefix) sont exposées par get_public_branding,
--    pour que les codes documentaires calculés dans le navigateur s'en servent partout.
-- 2. Droit de régulariser une signature formateur après la session : rôle superadmin ou admin actif,
--    au lieu d'une adresse email écrite en dur.
-- 3. Messages d'erreur de signature : plus de nom de personne.
-- 4. Appel des tâches planifiées : adresse de l'application lue dans le coffre-fort Supabase (secret app_url).

create or replace function public.get_public_branding()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'org_name', name,
    'app_name', coalesce(app_name, name),
    'app_short_name', coalesce(app_short_name, app_name, name),
    'doc_prefix', upper(nullif(trim(doc_prefix), '')),
    'logo_url', logo_url,
    'logo_base64', case when logo_url is null then logo_base64 else null end,
    'logo_on_dark_url', logo_on_dark_url,
    'favicon_url', favicon_url,
    'icon_192_url', icon_192_url,
    'icon_512_url', icon_512_url,
    'brand_primary', brand_primary,
    'brand_accent', brand_accent,
    'brand_highlight', brand_highlight,
    'brand_nav', brand_nav,
    'font_pair', font_pair,
    'city', city,
    'website', website,
    'phone', phone,
    'email', email,
    'qualiopi_certified', qualiopi_certified,
    'setup_completed', setup_completed,
    'activity_kind', activity_kind,
    'google_review_url', google_review_url,
    'demo_mode', coalesce(demo_mode, false),
    'legal_name', coalesce(legal_name, name),
    'address', address,
    'postal_code', postal_code,
    'siret', siret,
    'nda', nda,
    'dirigeant_name', dirigeant_name,
    'referent_handicap_nom', referent_handicap_nom
  )
  from public.organization_settings
  limit 1
$function$;

create or replace function public.is_signature_admin()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles
     where id = auth.uid()
       and coalesce(is_active, true)
       and role in ('superadmin', 'admin')
  );
$function$;

-- Messages d'erreur des fonctions de signature : même texte, sans nom de personne
do $$
declare
  f regprocedure;
  d text;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('trainer_proxy_sign', 'trainer_sign_halfday', 'get_trainer_sign_data')
       and p.prosrc like '%compte de Hicham SAIDI%'
  loop
    d := pg_get_functiondef(f);
    d := replace(d, 'depuis le compte de Hicham SAIDI', 'depuis un compte administrateur');
    execute d;
  end loop;
end $$;

create or replace function public.cron_call_vercel(p_path text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_secret text;
  v_url text;
  v_id bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_secret is null then
    raise exception 'Clé cron_secret absente du coffre-fort Supabase';
  end if;

  select rtrim(decrypted_secret, '/') into v_url from vault.decrypted_secrets where name = 'app_url';
  if v_url is null or v_url = '' then
    raise exception 'Adresse de l''application (app_url) absente du coffre-fort Supabase';
  end if;

  select net.http_get(
    url := v_url || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 60000
  ) into v_id;

  return v_id;
end;
$function$;

insert into public.schema_migrations (version) values ('0026_identite_parametrable') on conflict (version) do nothing;

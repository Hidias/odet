-- 0005_branding_rpc.sql : marque de l'instance lisible sans connexion (pages publiques, écran de connexion)

create or replace function public.get_public_branding()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'org_name', name,
    'app_name', coalesce(app_name, name),
    'app_short_name', coalesce(app_short_name, app_name, name),
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
    'google_review_url', google_review_url
  )
  from public.organization_settings
  limit 1
$$;

grant execute on function public.get_public_branding() to anon, authenticated;

-- Une instance a toujours une ligne d'organisation (remplie par l'assistant de configuration)
insert into public.organization_settings (id, name, setup_completed)
select gen_random_uuid(), 'Nouvelle instance', false
where not exists (select 1 from public.organization_settings);

insert into public.schema_migrations (version) values ('0005_branding_rpc') on conflict (version) do nothing;

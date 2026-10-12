-- 0034_referent_handicap_source_unique.sql : le référent handicap n'est plus recopié.
--
-- Avant : choisir le référent handicap dans Paramètres > Qualité et référents recopiait son nom
-- (et parfois son email et son téléphone) dans organization_settings, lu ensuite par le portail,
-- l'espace entreprise et les PDF. Deux endroits pour la même information.
-- Désormais une seule source : le rôle qualité « referent_handicap » (compte désigné, ou nom fictif
-- pendant la démonstration). organization_settings.referent_handicap_email et _phone restent des
-- coordonnées de contact facultatives (boîte dédiée par exemple) ; vides, ce sont celles du référent.
-- La colonne referent_handicap_nom n'est plus écrite ni lue (vidée ici).

create or replace function public.referent_handicap_info()
returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (
    select q.profile_id, q.demo_name,
           exists (select 1 from public.demo_records where tbl = 'quality_role_names') and nullif(trim(q.demo_name), '') is not null as demo
      from public.quality_roles q where q.code = 'referent_handicap'
  )
  select jsonb_build_object(
    'nom', nullif(public.quality_role_name('referent_handicap'), ''),
    'email', coalesce(nullif(trim(o.referent_handicap_email), ''), case when r.demo then o.email else coalesce(nullif(trim(p.sender_email), ''), p.email) end),
    'phone', coalesce(nullif(trim(o.referent_handicap_phone), ''), case when r.demo then o.phone else p.phone end)
  )
  from public.organization_settings o
  left join r on true
  left join public.profiles p on p.id = r.profile_id
  limit 1
$$;
grant execute on function public.referent_handicap_info() to authenticated;

-- Identité publique (portail stagiaire, écran de connexion) : nom lu dans le rôle
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
    'referent_handicap_nom', public.referent_handicap_info()->>'nom'
  )
  from public.organization_settings
  limit 1
$function$;

-- Espace entreprise : mêmes coordonnées du référent handicap
create or replace function public.client_portal_org(p_token text, p_code text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_check jsonb;
  v_ref jsonb := public.referent_handicap_info();
begin
  v_check := client_portal_check(p_token, p_code);
  if v_check ? 'error' then return v_check; end if;
  return (
    select jsonb_build_object(
      'name', name, 'legal_name', legal_name, 'forme_juridique', forme_juridique, 'app_short_name', app_short_name,
      'address', address, 'postal_code', postal_code, 'city', city, 'lieu_signature', lieu_signature,
      'phone', phone, 'email', email, 'website', website,
      'siret', siret, 'siren', siren, 'naf', naf, 'tva_intra', tva_intra, 'tva_applicable', tva_applicable,
      'nda', nda, 'nda_region', nda_region, 'iban', iban, 'bic', bic,
      'dirigeant_name', dirigeant_name, 'dirigeant_title', dirigeant_title,
      'dirigeant_signature_url', dirigeant_signature_url, 'logo_url', logo_url, 'stamp_base64', stamp_base64,
      'brand_primary', brand_primary, 'brand_accent', brand_accent, 'brand_highlight', brand_highlight,
      'doc_prefix', doc_prefix, 'qualiopi_certified', qualiopi_certified, 'activity_kind', activity_kind,
      'tribunal_competent', tribunal_competent, 'conditions_annulation', conditions_annulation,
      'referent_handicap_nom', v_ref->>'nom', 'referent_handicap_email', v_ref->>'email',
      'referent_handicap_phone', v_ref->>'phone'
    )
    from organization_settings limit 1
  );
end $function$;

-- Ancienne copie du nom : vidée (plus lue)
update public.organization_settings set referent_handicap_nom = null where referent_handicap_nom is not null;

insert into public.schema_migrations (version) values ('0034_referent_handicap_source_unique') on conflict (version) do nothing;

-- Retour arrière de 0494 : app.portail_appareil_noter reprend sa définition de 0449 (relevée en production le 05/11,
-- empreinte fe1f7b555b26b44c825fddba2f3fdfcf). Aucune donnée n'est touchée.

create or replace function app.portail_appareil_noter(p_client uuid, p_access uuid, p_profile uuid, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip text := left(nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', h->>'cf-connecting-ip', h->>'x-real-ip', ''), ',', 1)), ''), 64);
  v_ua text := left(h->>'user-agent', 400);
  v_co uuid;
  v_nom text;
  v_id uuid;
  v_autres int;
  v_nouveau boolean := false;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('error', 'Appareil non reconnu'); end if;
  select c.company_id, c.name into v_co, v_nom from public.clients c where c.id = p_client;
  if v_co is null then return jsonb_build_object('error', 'Client introuvable'); end if;
  select id into v_id from public.portal_devices
   where device_hash = p_hash and ((p_access is not null and access_id = p_access) or (p_profile is not null and profile_id = p_profile));
  if v_id is not null then
    update public.portal_devices set last_seen_at = now(), ip = coalesce(v_ip, ip), user_agent = coalesce(v_ua, user_agent) where id = v_id;
  else
    select count(*) into v_autres from public.portal_devices
     where (p_access is not null and access_id = p_access) or (p_profile is not null and profile_id = p_profile);
    insert into public.portal_devices (company_id, client_id, access_id, profile_id, device_hash, user_agent, ip)
    values (v_co, p_client, p_access, p_profile, p_hash, v_ua, v_ip) returning id into v_id;
    if v_autres > 0 then
      v_nouveau := true;
      insert into public.notifications (company_id, type, title, message, link, metadata)
      values (v_co, 'espace_client_appareil', 'Espace client : nouvel appareil',
        coalesce(v_nom, 'Un client') || ' : connexion depuis un nouvel appareil (' || coalesce(app.appareil_libelle(v_ua), 'navigateur') || ')',
        '/clients/' || p_client, jsonb_build_object('client_id', p_client, 'device_id', v_id, 'canal', case when p_access is not null then 'lien' else 'compte' end));
    end if;
  end if;
  return jsonb_build_object('nouveau', v_nouveau, 'appareils', (
    select coalesce(jsonb_agg(jsonb_build_object('libelle', app.appareil_libelle(d.user_agent), 'premiere', d.first_seen_at,
      'derniere', d.last_seen_at, 'actuel', d.id = v_id) order by d.last_seen_at desc), '[]'::jsonb)
    from public.portal_devices d
    where (p_access is not null and d.access_id = p_access) or (p_profile is not null and d.profile_id = p_profile)));
end
$$;
revoke all on function app.portail_appareil_noter(uuid, uuid, uuid, text) from public, anon, authenticated;

delete from public.schema_migrations where version = '0494_portail_appareil_concurrence';

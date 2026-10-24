-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (espace_client_0449) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0449_espace_client_acces.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0449_espace_client_acces_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0449_espace_client_acces.sql =====
-- 0449 : accès à l'espace client (pilotage de H du 24/10, partie 5 d).
--   1. Lien et code envoyés séparément : dates d'envoi du lien et du code ; option « code envoyé à part » (le code
--      n'est alors plus imprimé sur les devis et conventions, l'encadré renvoie à l'e-mail séparé).
--   2. Le client change son code lui-même (6 à 8 chiffres, ni suite ni répétition) ; l'organisme est prévenu.
--   3. Appareils : chaque navigateur qui ouvre l'espace (lien et code, ou compte) est noté par une empreinte tirée au
--      hasard par le navigateur (aucun pistage) ; un appareil inconnu déclenche une alerte (notification de
--      l'organisme) et le client voit la liste de ses appareils.
--   4. Compte créé à la première connexion : marqueur sur l'accès (le compte est créé par le serveur, api/espace-
--      entreprise, action « creer_compte », avec l'adresse d'un contact du client).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0449_espace_client_acces_retour.sql

-- ── 1. Envois ──
alter table public.client_portal_access add column if not exists link_sent_at timestamptz;
alter table public.client_portal_access add column if not exists code_sent_at timestamptz;
alter table public.client_portal_access add column if not exists code_changed_at timestamptz;
alter table public.client_portal_access add column if not exists code_apart boolean not null default false;
comment on column public.client_portal_access.code_apart is 'Code envoyé à part (e-mail séparé) : il n''est pas imprimé sur les documents';

-- ── 3. Appareils ──
create table if not exists public.portal_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  access_id uuid references public.client_portal_access(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  device_hash text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  user_agent text check (user_agent is null or length(user_agent) <= 400),
  ip text check (ip is null or length(ip) <= 64),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint portal_devices_canal check ((access_id is null) <> (profile_id is null))
);
create unique index if not exists portal_devices_acces_uniq on public.portal_devices (access_id, device_hash) where access_id is not null;
create unique index if not exists portal_devices_compte_uniq on public.portal_devices (profile_id, device_hash) where profile_id is not null;
create index if not exists portal_devices_client_idx on public.portal_devices (client_id, last_seen_at desc);
comment on table public.portal_devices is 'Appareils qui ont ouvert l''espace client (empreinte tirée au hasard par le navigateur) : alerte au premier passage d''un appareil inconnu';

alter table public.portal_devices enable row level security;
revoke all on table public.portal_devices from public, anon;
grant select on table public.portal_devices to authenticated;
grant all on table public.portal_devices to service_role;
drop policy if exists portal_devices_lire on public.portal_devices;
create policy portal_devices_lire on public.portal_devices for select to authenticated
  using (company_id in (select app.societes_avec_droit('clients.espace.gerer')));
drop policy if exists portal_devices_societe_lire on public.portal_devices;
create policy portal_devices_societe_lire on public.portal_devices as restrictive for select to authenticated
  using (company_id in (select app.societes_lisibles()));

-- Libellé lisible d'un navigateur (pour la liste et l'alerte)
create or replace function app.appareil_libelle(p_ua text)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(', ',
    case when p_ua ~* 'edg/' then 'Edge' when p_ua ~* 'chrome|crios' then 'Chrome' when p_ua ~* 'firefox|fxios' then 'Firefox'
         when p_ua ~* 'safari' then 'Safari' else 'Navigateur' end,
    case when p_ua ~* 'iphone' then 'iPhone' when p_ua ~* 'ipad' then 'iPad' when p_ua ~* 'android' then 'Android'
         when p_ua ~* 'windows' then 'Windows' when p_ua ~* 'mac os' then 'Mac' when p_ua ~* 'linux' then 'Linux' else null end)
$$;
revoke all on function app.appareil_libelle(text) from public, anon, authenticated;

-- Note l'appareil ; rend la liste des appareils du canal, l'actuel marqué, et « nouveau » pour un appareil inconnu
-- quand il en existait déjà d'autres (le tout premier appareil ne déclenche pas d'alerte)
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

-- Lien et code
create or replace function public.client_portal_appareil(p_token text, p_code text, p_device text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb := public.client_portal_check(p_token, p_code);
  v_access uuid;
begin
  if v_check ? 'error' then return v_check; end if;
  select a.id into v_access from public.client_portal_access a where a.token = p_token;
  return app.portail_appareil_noter((v_check->>'client_id')::uuid, v_access, null, p_device);
end
$$;
revoke all on function public.client_portal_appareil(text, text, text) from public;
grant execute on function public.client_portal_appareil(text, text, text) to anon, authenticated;

-- Compte entreprise
create or replace function public.ent_appareil(p_device text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
begin
  return app.portail_appareil_noter(v.client_id, null, v.profile_id, p_device);
end
$$;
revoke all on function public.ent_appareil(text) from public, anon;
grant execute on function public.ent_appareil(text) to authenticated;

-- ── 2. Changement de code par le client ──
create or replace function app.code_acces_valable(p_code text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  i int;
  monte boolean := true;
  descend boolean := true;
begin
  if p_code is null or p_code !~ '^[0-9]{6,8}$' then return 'Le code compte 6 à 8 chiffres'; end if;
  if p_code ~ '^(.)\1+$' then return 'Un code fait d''un seul chiffre répété est trop facile à deviner'; end if;
  for i in 2 .. length(p_code) loop
    if (substr(p_code, i, 1)::int - substr(p_code, i - 1, 1)::int + 10) % 10 <> 1 then monte := false; end if;
    if (substr(p_code, i - 1, 1)::int - substr(p_code, i, 1)::int + 10) % 10 <> 1 then descend := false; end if;
  end loop;
  if monte or descend then return 'Une suite de chiffres (123456…) est trop facile à deviner'; end if;
  return null;
end
$$;
revoke all on function app.code_acces_valable(text) from public, anon, authenticated;

create or replace function public.client_portal_changer_code(p_token text, p_code text, p_nouveau text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb := public.client_portal_check(p_token, p_code);
  v_nouveau text := regexp_replace(coalesce(p_nouveau, ''), '\s', '', 'g');
  v_motif text;
  a public.client_portal_access;
begin
  if v_check ? 'error' then return v_check; end if;
  v_motif := app.code_acces_valable(v_nouveau);
  if v_motif is not null then return jsonb_build_object('error', v_motif); end if;
  select * into a from public.client_portal_access where token = p_token;
  if v_nouveau = a.access_code then return jsonb_build_object('error', 'Choisissez un code différent de l''actuel'); end if;
  update public.client_portal_access set access_code = v_nouveau, code_changed_at = now(), attempts = 0, locked_until = null, updated_at = now()
   where id = a.id;
  insert into public.notifications (company_id, type, title, message, link, metadata)
  select a.company_id, 'espace_client_code', 'Espace client : code changé',
         coalesce(c.name, 'Un client') || ' a changé son code d''accès', '/clients/' || a.client_id, jsonb_build_object('client_id', a.client_id)
    from public.clients c where c.id = a.client_id;
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.client_portal_changer_code(text, text, text) from public;
grant execute on function public.client_portal_changer_code(text, text, text) to anon, authenticated;

-- Renseignements de l'accès pour l'écran du client (code envoyé à part, compte déjà créé)
create or replace function public.client_portal_acces_infos(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb := public.client_portal_check(p_token, p_code);
  a public.client_portal_access;
begin
  if v_check ? 'error' then return v_check; end if;
  select * into a from public.client_portal_access where token = p_token;
  return jsonb_build_object('code_changed_at', a.code_changed_at,
    'compte', exists (select 1 from public.client_accounts ca where ca.client_id = a.client_id and ca.is_active),
    'email', a.contact_email);
end
$$;
revoke all on function public.client_portal_acces_infos(text, text) from public;
grant execute on function public.client_portal_acces_infos(text, text) to anon, authenticated;

insert into public.schema_migrations (version) values ('0449_espace_client_acces') on conflict (version) do nothing;

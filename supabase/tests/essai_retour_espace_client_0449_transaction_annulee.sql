-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (espace_client_0449) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0449_espace_client_acces.sql, retour arrière,
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

-- ===== supabase/rollback/0449_espace_client_acces_retour.sql =====
-- Retour arrière de 0449_espace_client_acces.sql. Idempotent. Les codes changés par les clients restent (ce sont
-- leurs codes actuels).
drop function if exists public.client_portal_acces_infos(text, text);
drop function if exists public.client_portal_changer_code(text, text, text);
drop function if exists app.code_acces_valable(text);
drop function if exists public.ent_appareil(text);
drop function if exists public.client_portal_appareil(text, text, text);
drop function if exists app.portail_appareil_noter(uuid, uuid, uuid, text);
drop function if exists app.appareil_libelle(text);
drop table if exists public.portal_devices;
alter table public.client_portal_access drop column if exists code_apart;
alter table public.client_portal_access drop column if exists code_changed_at;
alter table public.client_portal_access drop column if exists code_sent_at;
alter table public.client_portal_access drop column if exists link_sent_at;
delete from public.schema_migrations where version = '0449_espace_client_acces';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE espace_client_0449 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

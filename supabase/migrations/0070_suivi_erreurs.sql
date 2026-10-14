-- 0070_suivi_erreurs.sql : suivi des erreurs de l'application, sans service externe.
-- Les erreurs identiques sont regroupées par empreinte (même origine, même message, même endroit du code) :
-- une ligne par problème, avec un compteur d'occurrences.
-- Écriture uniquement par la fonction log_error (comptes connectés, portails publics, routes /api),
-- avec un plafond de nouvelles erreurs par minute. Lecture et traitement : super administrateur seulement.
-- Purge automatique des erreurs plus vues depuis 90 jours, faite par log_error au plus une fois par heure.
-- Notification « Nouvelle erreur » réservée au super administrateur (metadata.audience = 'superadmin').

create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  source text not null default 'app' check (source in ('app', 'portail', 'entreprise', 'api')),
  message text not null,
  stack text,
  page text,
  user_agent text,
  app_version text,
  user_id uuid,
  user_email text,
  users text[] not null default '{}',
  occurrences integer not null default 1,
  recent jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  resolved_at timestamptz,
  resolved_by text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index if not exists error_logs_last_seen_idx on public.error_logs (last_seen desc);
create index if not exists error_logs_status_idx on public.error_logs (status);

comment on table public.error_logs is 'Erreurs de l''application regroupées par empreinte. Écriture par log_error, lecture super administrateur.';
comment on column public.error_logs.recent is 'Dernières occurrences (10 au plus) : date, page, navigateur, version, personne.';

-- Date de la dernière purge (une seule ligne)
create table if not exists public.error_logs_purge (
  id boolean primary key default true check (id),
  last_run timestamptz not null default now()
);
insert into public.error_logs_purge (id, last_run) values (true, now()) on conflict (id) do nothing;

alter table public.error_logs enable row level security;
alter table public.error_logs_purge enable row level security;

drop policy if exists error_logs_superadmin_select on public.error_logs;
create policy error_logs_superadmin_select on public.error_logs for select to authenticated using (public.is_superadmin());
drop policy if exists error_logs_superadmin_update on public.error_logs;
create policy error_logs_superadmin_update on public.error_logs for update to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
drop policy if exists error_logs_superadmin_delete on public.error_logs;
create policy error_logs_superadmin_delete on public.error_logs for delete to authenticated using (public.is_superadmin());

revoke all on public.error_logs from anon;
revoke insert on public.error_logs from authenticated;
grant select, update, delete on public.error_logs to authenticated;
revoke all on public.error_logs_purge from anon, authenticated;

-- Empreinte : origine + message sans les parties variables (nombres, identifiants)
-- + premier emplacement de la pile sans numéros de ligne ni suffixe de fichier de build.
create or replace function public.error_fingerprint(p_source text, p_message text, p_stack text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select md5(
    coalesce(p_source, '') || '|' ||
    regexp_replace(
      regexp_replace(coalesce(p_message, ''), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '#', 'gi'),
      '[0-9]+', '#', 'g') || '|' ||
    coalesce(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            (select l from regexp_split_to_table(coalesce(p_stack, ''), E'\n') as l where l ~ '(^\s*at |@)' limit 1),
            ':[0-9]+(:[0-9]+)?', '', 'g'),
          '-[A-Za-z0-9_-]{6,}\.(js|mjs)', '.\1', 'g'),
        '\?[^\s)]*', '', 'g'),
      '')
  )
$function$;

create or replace function public.log_error(
  p_source text,
  p_message text,
  p_stack text default null,
  p_page text default null,
  p_user_agent text default null,
  p_app_version text default null,
  p_user_id uuid default null,
  p_user_email text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_source text := case when p_source in ('app', 'portail', 'entreprise', 'api') then p_source else 'app' end;
  v_message text := left(coalesce(nullif(trim(p_message), ''), 'Erreur sans message'), 1000);
  v_stack text := left(p_stack, 8000);
  v_page text := left(p_page, 500);
  v_ua text := left(p_user_agent, 300);
  v_version text := left(p_app_version, 40);
  v_uid uuid := auth.uid();
  v_email text := left(auth.jwt() ->> 'email', 200);
  v_fp text;
  v_row public.error_logs%rowtype;
  v_recent jsonb;
  v_id uuid;
begin
  -- Seul le serveur (clé service_role) peut déclarer la personne concernée ;
  -- un navigateur est identifié par sa propre session, jamais par ce qu'il envoie.
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    v_uid := coalesce(p_user_id, v_uid);
    v_email := coalesce(left(p_user_email, 200), v_email);
  end if;

  -- Purge des erreurs plus vues depuis 90 jours, au plus une fois par heure
  if exists (select 1 from public.error_logs_purge where id and last_run < now() - interval '1 hour') then
    update public.error_logs_purge set last_run = now() where id;
    delete from public.error_logs where last_seen < now() - interval '90 days';
  end if;

  v_fp := public.error_fingerprint(v_source, v_message, v_stack);
  v_recent := jsonb_build_object('at', now(), 'page', v_page, 'ua', v_ua, 'version', v_version, 'user', v_email);

  select * into v_row from public.error_logs where fingerprint = v_fp for update;

  if found then
    update public.error_logs set
      occurrences = occurrences + 1,
      last_seen = now(),
      page = coalesce(v_page, page),
      user_agent = coalesce(v_ua, user_agent),
      app_version = coalesce(v_version, app_version),
      user_id = coalesce(v_uid, user_id),
      user_email = coalesce(v_email, user_email),
      users = case when v_email is null or v_email = any(users) or cardinality(users) >= 20 then users else users || v_email end,
      recent = (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(jsonb_build_array(v_recent) || recent) with ordinality as t(e, n) order by n limit 10) x),
      -- Une erreur traitée qui revient est rouverte ; une erreur ignorée l'est seulement dans une nouvelle version
      status = case
        when status = 'resolved' then 'open'
        when status = 'ignored' and v_version is not null and v_version is distinct from v_row.app_version then 'open'
        else status end,
      resolved_at = case when status = 'resolved' then null else resolved_at end,
      resolved_by = case when status = 'resolved' then null else resolved_by end
    where id = v_row.id;

    if v_row.status = 'resolved' then
      insert into public.notifications (type, title, message, link, metadata)
      values ('error', 'Erreur revenue', left(v_message, 200), '/console/erreurs',
              jsonb_build_object('audience', 'superadmin', 'error_id', v_row.id));
    end if;
    return v_row.id;
  end if;

  -- Plafond : 30 nouvelles erreurs par minute au plus, toutes origines confondues
  if (select count(*) from public.error_logs where first_seen > now() - interval '1 minute') >= 30 then
    return null;
  end if;

  insert into public.error_logs (fingerprint, source, message, stack, page, user_agent, app_version, user_id, user_email, users, recent)
  values (v_fp, v_source, v_message, v_stack, v_page, v_ua, v_version, v_uid, v_email,
          case when v_email is null then '{}'::text[] else array[v_email] end, jsonb_build_array(v_recent))
  on conflict (fingerprint) do update set occurrences = public.error_logs.occurrences + 1, last_seen = now()
  returning id into v_id;

  insert into public.notifications (type, title, message, link, metadata)
  values ('error', 'Nouvelle erreur', left(v_message, 200), '/console/erreurs',
          jsonb_build_object('audience', 'superadmin', 'error_id', v_id));

  return v_id;
end;
$function$;

revoke all on function public.log_error(text, text, text, text, text, text, uuid, text) from public;
grant execute on function public.log_error(text, text, text, text, text, text, uuid, text) to anon, authenticated, service_role;
revoke all on function public.error_fingerprint(text, text, text) from public, anon;
grant execute on function public.error_fingerprint(text, text, text) to authenticated, service_role;

-- Notifications réservées au super administrateur : invisibles pour les autres comptes connectés.
-- Remplace la politique ouverte d'origine (même portée pour toutes les autres notifications).
drop policy if exists notifications_auth_all on public.notifications;
create policy notifications_auth_all on public.notifications for all to authenticated
  using (coalesce(metadata ->> 'audience', '') <> 'superadmin' or public.is_superadmin())
  with check (true);

insert into public.schema_migrations (version) values ('0070_suivi_erreurs') on conflict (version) do nothing;

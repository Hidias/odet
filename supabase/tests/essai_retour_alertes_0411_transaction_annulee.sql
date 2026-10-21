-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (alertes_0411) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0411_alertes_telephone.sql, retour arrière,
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

-- ===== supabase/migrations/0411_alertes_telephone.sql =====
-- 0411 : alertes sur le téléphone (notifications web, gratuites), décision de H du 21/10. Les notifications de
-- l'application (signature d'une convention ou d'un devis, stagiaires prêts, point de la semaine prêt…) arrivent
-- aussi sur les appareils où la personne les a activées, sans abonnement ni service payant.
-- Sans harcèlement : rien entre 21 h et 7 h 30 (heure de Paris), plusieurs alertes d'un coup sont regroupées en une
-- seule, les erreurs techniques et la synchronisation des emails ne sont pas envoyées.
--
--   1. push_keys : la paire de clés de l'instance (créée par le serveur à la première activation, clé privée chiffrée),
--      jamais lisible depuis l'application ; seule la clé publique est donnée (public.push_cle_publique).
--   2. push_subscriptions : les appareils de chaque personne (chacun ne voit et ne retire que les siens).
--   3. notifications.pushed_at : alerte déjà envoyée ou écartée. Les notifications existantes sont marquées envoyées.
--   4. public.push_tick, chaque minute : s'il y a des alertes en attente, hors des heures calmes, et au moins un
--      appareil, la route /api/push-envoi est appelée ; sinon rien n'est réveillé.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0411_alertes_telephone_retour.sql

-- ── 1. Clés de l'instance ──
create table if not exists public.push_keys (
  id integer primary key default 1 check (id = 1),
  company_id uuid references public.companies(id) on delete cascade, -- vide : clés de toute l'instance
  public_key text not null check (length(public_key) between 40 and 200),
  private_key_enc text not null,
  subject text,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.push_keys enable row level security;
comment on table public.push_keys is 'Clés des alertes web de l''instance (clé privée chiffrée, lue seulement par le serveur)';

create or replace function public.push_cle_publique()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select k.public_key from public.push_keys k where k.id = 1
$$;
revoke all on function public.push_cle_publique() from public, anon;
grant execute on function public.push_cle_publique() to authenticated;

-- ── 2. Appareils ──
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  company_id uuid default app.company_default() references public.companies(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  label text check (label is null or length(label) <= 120),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures integer not null default 0
);
create index if not exists push_subscriptions_profile_idx on public.push_subscriptions (profile_id);
comment on table public.push_subscriptions is 'Appareils où une personne reçoit les alertes (téléphone, ordinateur)';

create or replace function app.push_subscriptions_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.profile_id := coalesce(auth.uid(), new.profile_id);
    new.created_at := now();
  else
    new.profile_id := old.profile_id; new.created_at := old.created_at; new.endpoint := old.endpoint;
  end if;
  return new;
end
$$;
revoke all on function app.push_subscriptions_maj() from public, anon, authenticated;
drop trigger if exists push_subscriptions_maj on public.push_subscriptions;
create trigger push_subscriptions_maj before insert or update on public.push_subscriptions
  for each row execute function app.push_subscriptions_maj();

-- ── 3. Alertes envoyées ──
alter table public.notifications add column if not exists pushed_at timestamptz;
update public.notifications set pushed_at = coalesce(created_at, now()) where pushed_at is null;

-- ── 4. Appel de l'envoi, chaque minute, seulement s'il y a quelque chose à envoyer ──
create or replace function public.push_tick()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  h time := (now() at time zone 'Europe/Paris')::time;
begin
  -- Écartées : erreurs techniques, synchronisation des emails, alertes de plus de deux jours
  update public.notifications set pushed_at = now()
   where pushed_at is null and (type in ('error', 'email_sync') or created_at < now() - interval '2 days');
  if h < time '07:30' or h >= time '21:00' then return jsonb_build_object('appel', false, 'raison', 'heures calmes'); end if;
  if not exists (select 1 from public.push_keys) or not exists (select 1 from public.push_subscriptions) then
    return jsonb_build_object('appel', false, 'raison', 'aucun appareil');
  end if;
  if not exists (select 1 from public.notifications where pushed_at is null) then return jsonb_build_object('appel', false); end if;
  perform public.cron_call_vercel('/api/push-envoi');
  return jsonb_build_object('appel', true);
end
$$;
revoke all on function public.push_tick() from public, anon, authenticated;

-- Alertes à envoyer (serveur seulement) : pour chaque appareil, les notifications de sa société que la personne a le
-- droit de voir ; les alertes sans société vont aux super administrateurs. Les notifications prises sont marquées.
create or replace function public.push_a_envoyer()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v jsonb;
begin
  select array_agg(id order by created_at) into v_ids from (
    select id, created_at from public.notifications where pushed_at is null order by created_at limit 200) x;
  if v_ids is null then return jsonb_build_object('appareils', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
           'notifications', a.liste)), '[]'::jsonb) into v
  from public.push_subscriptions s
  cross join lateral (
    select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'message', n.message, 'link', n.link) order by n.created_at) liste
    from public.notifications n
    where n.id = any (v_ids)
      and ((n.company_id is not null and n.company_id = s.company_id
            and 'organisation.notifications.gerer' = any (app.rights_for(s.profile_id, n.company_id)))
        or (n.company_id is null and exists (select 1 from public.profiles p where p.id = s.profile_id and p.role = 'superadmin')))
  ) a
  where a.liste is not null;
  update public.notifications set pushed_at = now() where id = any (v_ids);
  return jsonb_build_object('appareils', v, 'notifications', coalesce(array_length(v_ids, 1), 0));
end
$$;
revoke all on function public.push_a_envoyer() from public, anon, authenticated;
grant execute on function public.push_a_envoyer() to service_role;

-- Tâche planifiée de la base (comme le suivi des signatures et des campagnes)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'odet_push_tick';
    perform cron.schedule('odet_push_tick', '* * * * *', 'select public.push_tick()');
  end if;
end $$;

-- Règles d'accès (générées par scripts/securite/regles.py, build_suite('0411'))


-- Pose des règles d'une liste de tables : une règle par action, garde du module ajoutée ici.
-- Lecture : module actif, ou super administrateur. Écriture : module actif.
create or replace function pg_temp.regles(p_tables text[], p_module text, p_sel text, p_ins text, p_upd text, p_del text)
returns void
language plpgsql
as $f$
declare
  t text;
  v_on text;
  v_sel text := p_sel; v_ins text := p_ins; v_upd text := p_upd; v_del text := p_del;
begin
  if p_module is not null then
    select '(' || string_agg(format('(select app.module_on(%L))', m), ' or ') || ')' into v_on
    from unnest(string_to_array(p_module, '|')) m;
    if v_sel is not null then v_sel := format('((%s and %s) or (select app.is_superadmin()))', v_on, v_sel); end if;
    if v_ins is not null then v_ins := format('(%s and %s)', v_on, v_ins); end if;
    if v_upd is not null then v_upd := format('(%s and %s)', v_on, v_upd); end if;
    if v_del is not null then v_del := format('(%s and %s)', v_on, v_del); end if;
  end if;
  foreach t in array p_tables loop
    execute format('alter table public.%I enable row level security', t);
    if v_sel is not null then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_lire', t, v_sel);
    end if;
    if v_ins is not null then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_creer', t, v_ins);
    end if;
    if v_upd is not null then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_modifier', t, v_upd, v_upd);
    end if;
    if v_del is not null then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_supprimer', t, v_del);
    end if;
  end loop;
end
$f$;

-- Suppression des règles nommées du générateur (lire, créer, modifier, supprimer) ; les autres règles
-- (règle restrictive des notifications de 0070, etc.) ne sont pas touchées
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['push_subscriptions'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- push_subscriptions
select pg_temp.regles(array['push_subscriptions'], null,
  $r$profile_id = (select auth.uid())$r$,
  $r$profile_id = (select auth.uid())$r$,
  $r$profile_id = (select auth.uid())$r$,
  $r$profile_id = (select auth.uid())$r$);


insert into public.schema_migrations (version) values ('0411_alertes_telephone') on conflict (version) do nothing;

-- ===== supabase/rollback/0411_alertes_telephone_retour.sql =====
-- Retour arrière de 0411_alertes_telephone.sql. Les appareils et les clés sont effacés ; la colonne pushed_at retirée.
-- Idempotent.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'odet_push_tick';
  end if;
end $$;
drop function if exists public.push_tick();
drop function if exists public.push_a_envoyer();
alter table public.notifications drop column if exists pushed_at;
drop table if exists public.push_subscriptions;
drop function if exists app.push_subscriptions_maj();
drop function if exists public.push_cle_publique();
drop table if exists public.push_keys;

delete from public.schema_migrations where version = '0411_alertes_telephone';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE alertes_0411 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (espace_societes_0450) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0450_espace_client_multisocietes.sql, retour arrière,
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

-- ===== supabase/migrations/0450_espace_client_multisocietes.sql =====
-- 0450 : un seul compte pour plusieurs sociétés clientes (pilotage de H du 24/10, partie 5 d, « multi-sites »).
-- Un responsable qui suit plusieurs établissements ou sociétés (groupe, plusieurs SIRET) garde une seule adresse et un
-- seul mot de passe : son profil peut avoir un accès par client (client_accounts, un par client), il choisit la
-- société affichée. Les sites d'un même client restaient déjà réglables par accès (client_account_sites, 0046).
--   1. client_accounts : un accès par profil et par client (au lieu d'un par profil).
--   2. client_account_actif : société choisie par le profil ; app.ent_compte() rend l'accès choisi (ou le premier).
--   3. public.ent_societes() : les sociétés du profil ; public.ent_choisir(accès) : changer de société.
-- Toutes les fonctions de l'espace passent par app.ent_compte() : rien d'autre ne change pour elles.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0450_espace_client_multisocietes_retour.sql
-- (refusé si un profil a plusieurs accès).

-- ── 1. Un accès par profil et par client ──
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'client_accounts_profile_id_key') then
    alter table public.client_accounts drop constraint client_accounts_profile_id_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_accounts_profil_client_key') then
    alter table public.client_accounts add constraint client_accounts_profil_client_key unique (profile_id, client_id);
  end if;
end
$$;
create index if not exists client_accounts_profile_idx on public.client_accounts (profile_id);

-- ── 2. Société choisie ──
create table if not exists public.client_account_actif (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  account_id uuid not null references public.client_accounts(id) on delete cascade,
  updated_at timestamptz not null default now()
);
comment on table public.client_account_actif is 'Espace entreprise : société affichée pour un profil qui a plusieurs accès (écrite par public.ent_choisir)';
alter table public.client_account_actif enable row level security;
revoke all on table public.client_account_actif from public, anon, authenticated;
grant all on table public.client_account_actif to service_role;

create or replace function app.ent_compte()
returns public.client_accounts
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.client_accounts;
begin
  -- 0450 : l'accès choisi par le profil s'il est actif, sinon le plus ancien
  select a.* into v
  from public.client_accounts a
  join public.profiles p on p.id = a.profile_id
  left join public.client_account_actif c on c.profile_id = a.profile_id and c.account_id = a.id
  where a.profile_id = (select auth.uid()) and a.is_active and p.role = 'entreprise' and coalesce(p.is_active, true)
  order by (c.account_id is not null) desc, a.created_at, a.id
  limit 1;
  if v.id is null then
    raise exception 'Espace entreprise : compte inconnu ou désactivé' using errcode = '42501';
  end if;
  return v;
end
$$;

-- Dossier du registre (règles du stockage) : même accès que app.ent_compte(), sans erreur pour les autres comptes
create or replace function app.ent_dossier_registre()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.company_id::text || '/' || a.client_id::text
  from public.client_accounts a join public.profiles p on p.id = a.profile_id
  left join public.client_account_actif c on c.profile_id = a.profile_id and c.account_id = a.id
  where a.profile_id = (select auth.uid()) and a.is_active and p.role = 'entreprise' and coalesce(p.is_active, true)
  order by (c.account_id is not null) desc, a.created_at, a.id
  limit 1
$$;

-- ── 3. Sociétés du profil, changement de société ──
create or replace function public.ent_societes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('account_id', a.id, 'client_id', a.client_id, 'name', c.name, 'city', c.city, 'actif', a.id = v.id)
                     order by c.name)
    from public.client_accounts a join public.clients c on c.id = a.client_id
    where a.profile_id = v.profile_id and a.is_active), '[]'::jsonb);
end
$$;
revoke all on function public.ent_societes() from public, anon;
grant execute on function public.ent_societes() to authenticated;

create or replace function public.ent_choisir(p_account uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
begin
  if not exists (select 1 from public.client_accounts a where a.id = p_account and a.profile_id = v.profile_id and a.is_active) then
    raise exception 'Société inconnue pour ce compte' using errcode = '42501';
  end if;
  insert into public.client_account_actif (profile_id, company_id, account_id, updated_at)
  select v.profile_id, a.company_id, a.id, now() from public.client_accounts a where a.id = p_account
  on conflict (profile_id) do update set account_id = excluded.account_id, company_id = excluded.company_id, updated_at = now();
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.ent_choisir(uuid) from public, anon;
grant execute on function public.ent_choisir(uuid) to authenticated;

insert into public.schema_migrations (version) values ('0450_espace_client_multisocietes') on conflict (version) do nothing;

-- ===== supabase/rollback/0450_espace_client_multisocietes_retour.sql =====
-- Retour arrière de 0450_espace_client_multisocietes.sql. Idempotent. Refusé si un profil a plusieurs accès (la règle
-- « un accès par profil » ne pourrait pas revenir) : retirer d'abord les accès en trop.
do $do$
begin
  if exists (select 1 from public.client_accounts group by profile_id having count(*) > 1) then
    raise exception 'Un profil a plusieurs accès entreprise : retour arrière refusé';
  end if;
end
$do$;
drop function if exists public.ent_choisir(uuid);
drop function if exists public.ent_societes();
create or replace function app.ent_dossier_registre()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.company_id::text || '/' || a.client_id::text
  from public.client_accounts a join public.profiles p on p.id = a.profile_id
  where a.profile_id = (select auth.uid()) and a.is_active and p.role = 'entreprise' and coalesce(p.is_active, true)
$$;
create or replace function app.ent_compte()
returns public.client_accounts
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.client_accounts;
begin
  select a.* into v
  from public.client_accounts a
  join public.profiles p on p.id = a.profile_id
  where a.profile_id = (select auth.uid()) and a.is_active and p.role = 'entreprise' and coalesce(p.is_active, true);
  if v.id is null then
    raise exception 'Espace entreprise : compte inconnu ou désactivé' using errcode = '42501';
  end if;
  return v;
end
$$;
drop table if exists public.client_account_actif;
drop index if exists public.client_accounts_profile_idx;
alter table public.client_accounts drop constraint if exists client_accounts_profil_client_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_accounts_profile_id_key') then
    alter table public.client_accounts add constraint client_accounts_profile_id_key unique (profile_id);
  end if;
end
$$;
delete from public.schema_migrations where version = '0450_espace_client_multisocietes';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE espace_societes_0450 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

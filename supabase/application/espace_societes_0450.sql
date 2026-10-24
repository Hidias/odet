-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (espace_societes_0450) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0450_espace_client_multisocietes.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0450_espace_client_multisocietes_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

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

-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (l2_0046) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0046_espace_entreprise.sql, retour arrière,
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

-- ===== supabase/migrations/0046_espace_entreprise.sql =====
-- 0046_espace_entreprise.sql : espace entreprise avec compte (lot 2, branche espace-entreprise).
--
-- Spec : odet-lot2-spec.md v2, section 6. Le lien avec code (client_portal_access) reste pour les contacts sans compte.
-- 1. client_accounts : un compte au rôle « entreprise » relié à un client et à un contact ; options : tous les sites
--    ou certains (client_account_sites), droit d'inscrire des salariés, droit de voir les factures. Le compte est créé
--    par le serveur (/api/espace-entreprise, droit « Gérer l'espace entreprise ») : aucun email n'est envoyé par
--    l'application, le lien d'accès est remis à la personne qui invite.
-- 2. client_requests : demandes faites depuis l'espace (inscription à une session inter, demande de formation intra,
--    remplacement d'un salarié, message), traitées par l'organisme.
-- 3. client_news : actualités et veille rédigées par l'organisme, publiées dans les espaces.
-- 4. Fonctions ent_* (security definer, search_path vide) : seule porte d'un compte entreprise vers les données ;
--    chacune commence par la garde app.ent_compte() (compte actif, rôle entreprise, profil actif) et ne renvoie que
--    son client (et ses sites si le compte est limité). Jamais de numéro de sécurité sociale, ni de prix d'achat, ni
--    de donnée d'un autre client. Le compte n'a aucun droit sur les tables (aucune règle ne lui ouvre une ligne).
--    Accueil, formations (intra du client et groupes du client dans les inter, mêmes champs que l'espace par code
--    pour produire les documents), salariés et validités, échéances, factures (si autorisé), catalogue et sessions
--    inter ouvertes, actualités, demandes.
-- 5. client_accounts_etat(client) : comptes d'un client avec leur dernière connexion, pour la fiche client.
-- Toutes les tables naissent avec company_id ; règles par droits (build_suite('0046')) et isolement par société.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0046_espace_entreprise_retour.sql

-- ── 1. Comptes ──
create table if not exists public.client_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid references public.client_contacts(id) on delete set null,
  email text,
  all_sites boolean not null default true,
  can_register boolean not null default true,
  can_see_invoices boolean not null default false,
  invited_at timestamptz not null default now(),
  invited_by uuid default auth.uid(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_accounts_client_idx on public.client_accounts (client_id);
comment on table public.client_accounts is 'Comptes de l''espace entreprise (rôle entreprise) : un client, un contact, options d''accès';

create table if not exists public.client_account_sites (
  account_id uuid not null references public.client_accounts(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  company_id uuid not null default app.company_default() references public.companies(id),
  primary key (account_id, site_id)
);

-- ── 2. Demandes ──
create table if not exists public.client_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  account_id uuid references public.client_accounts(id) on delete set null,
  kind text not null check (kind in ('inscription_inter', 'demande_intra', 'remplacement', 'message')),
  session_id uuid references public.sessions(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  message text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'nouvelle' check (status in ('nouvelle', 'en_cours', 'traitee', 'refusee')),
  response text,
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_requests_statut_idx on public.client_requests (company_id, status, created_at desc);
create index if not exists client_requests_client_idx on public.client_requests (client_id, created_at desc);

-- ── 3. Actualités ──
create table if not exists public.client_news (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  title text not null,
  body text,
  link text,
  status text not null default 'brouillon' check (status in ('brouillon', 'publie', 'archive')),
  published_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Tenue par la base ──
create or replace function app.espace_entreprise_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'client_accounts' then
    new.company_id := coalesce((select c.company_id from public.clients c where c.id = new.client_id), new.company_id);
    if tg_op = 'UPDATE' then
      new.profile_id := old.profile_id; new.invited_at := old.invited_at; new.invited_by := old.invited_by;
    end if;
  elsif tg_table_name = 'client_account_sites' then
    new.company_id := coalesce((select a.company_id from public.client_accounts a where a.id = new.account_id), new.company_id);
    if not exists (select 1 from public.sites s join public.client_accounts a on a.id = new.account_id
                   where s.id = new.site_id and s.client_id = a.client_id) then
      raise exception 'Ce site n''appartient pas au client du compte' using errcode = '22023';
    end if;
    return new;
  elsif tg_table_name = 'client_requests' then
    if tg_op = 'UPDATE' then
      new.company_id := old.company_id; new.client_id := old.client_id; new.account_id := old.account_id;
      new.kind := old.kind; new.created_at := old.created_at;
      if new.status is distinct from old.status and new.status in ('traitee', 'refusee') then
        new.handled_by := (select auth.uid()); new.handled_at := now();
      end if;
    else
      new.company_id := coalesce((select c.company_id from public.clients c where c.id = new.client_id), new.company_id);
    end if;
  elsif tg_table_name = 'client_news' then
    if new.status = 'publie' and new.published_at is null then new.published_at := now(); end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.espace_entreprise_maj() from public, anon, authenticated;

drop trigger if exists client_accounts_maj on public.client_accounts;
create trigger client_accounts_maj before insert or update on public.client_accounts for each row execute function app.espace_entreprise_maj();
drop trigger if exists client_account_sites_maj on public.client_account_sites;
create trigger client_account_sites_maj before insert or update on public.client_account_sites for each row execute function app.espace_entreprise_maj();
drop trigger if exists client_requests_maj on public.client_requests;
create trigger client_requests_maj before insert or update on public.client_requests for each row execute function app.espace_entreprise_maj();
drop trigger if exists client_news_maj on public.client_news;
create trigger client_news_maj before insert or update on public.client_news for each row execute function app.espace_entreprise_maj();

alter table public.client_accounts enable row level security;
alter table public.client_account_sites enable row level security;
alter table public.client_requests enable row level security;
alter table public.client_news enable row level security;
revoke all on table public.client_accounts, public.client_account_sites, public.client_requests, public.client_news from public, anon;
grant select, insert, update, delete on table public.client_accounts, public.client_account_sites, public.client_requests, public.client_news to authenticated;
grant all on table public.client_accounts, public.client_account_sites, public.client_requests, public.client_news to service_role;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0046')) ──

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
           where schemaname = 'public' and tablename = any (array['client_account_sites', 'client_accounts', 'client_news', 'client_requests'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- client_account_sites, client_accounts
select pg_temp.regles(array['client_account_sites', 'client_accounts'], null,
  $r$company_id in (select app.societes_avec_droit('clients.espace.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.espace.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.espace.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.espace.gerer'))$r$);

-- client_news
select pg_temp.regles(array['client_news'], null,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.espace.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.espace.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.espace.gerer'))$r$);

-- client_requests
select pg_temp.regles(array['client_requests'], null,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.voir'))$r$,
  null,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$,
  $r$company_id in (select app.societes_avec_droit('clients.espace.gerer'))$r$);

do $$
declare t text;
begin
  foreach t in array array['client_accounts', 'client_account_sites', 'client_requests', 'client_news'] loop
    execute format('drop policy if exists %I on public.%I', t || '_societe_lire', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_creer', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_modifier', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_supprimer', t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (company_id in (select app.societes_lisibles()))', t || '_societe_lire', t);
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (company_id in (select app.societes_ecriture()))', t || '_societe_creer', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()))', t || '_societe_modifier', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using (company_id in (select app.societes_ecriture()))', t || '_societe_supprimer', t);
  end loop;
end $$;

-- ── 4. Garde des comptes entreprise ──
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
revoke all on function app.ent_compte() from public, anon;
grant execute on function app.ent_compte() to authenticated;

-- Sites visibles du compte : null = tous les sites du client
create or replace function app.ent_sites(p_compte public.client_accounts)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_compte.all_sites then null
              else coalesce((select array_agg(s.site_id) from public.client_account_sites s where s.account_id = p_compte.id), '{}'::uuid[]) end
$$;
revoke all on function app.ent_sites(public.client_accounts) from public, anon, authenticated;

-- Accueil : identité, choses à faire, échéances, demandes en cours, dernières actualités
create or replace function public.ent_accueil()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
  v_sites uuid[] := app.ent_sites(v);
  v_org jsonb := to_jsonb(app.identite_societe(v.company_id));
begin
  return jsonb_build_object(
    'client', (select jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city) from public.clients c where c.id = v.client_id),
    'compte', jsonb_build_object('can_register', v.can_register, 'can_see_invoices', v.can_see_invoices, 'all_sites', v.all_sites,
      'contact', (select jsonb_build_object('name', coalesce(nullif(btrim(concat_ws(' ', cc.first_name, cc.last_name)), ''), cc.name), 'email', cc.email)
                  from public.client_contacts cc where cc.id = v.contact_id)),
    'org', jsonb_build_object('name', coalesce(v_org ->> 'name', v_org ->> 'legal_name'), 'email', v_org ->> 'email', 'phone', v_org ->> 'phone',
      'website', v_org ->> 'website', 'city', v_org ->> 'city'),
    'a_venir', (select count(distinct s.id) from public.sessions s
                left join public.session_groups g on g.session_id = s.id and g.client_id = v.client_id
                where (s.client_id = v.client_id or g.id is not null) and coalesce(s.end_date, s.start_date) >= current_date
                  and coalesce(s.status, '') not in ('cancelled', 'annulee')
                  and (v_sites is null or s.site_id is null or s.site_id = any (v_sites))),
    'echeances', jsonb_build_object(
      'depasse', (select count(*) from public.v_obligation_deadlines d where d.client_id = v.client_id and d.status = 'depasse'
                  and (v_sites is null or d.site_id is null or d.site_id = any (v_sites))),
      'a_prevoir', (select count(*) from public.v_obligation_deadlines d where d.client_id = v.client_id and d.status = 'a_prevoir'
                    and (v_sites is null or d.site_id is null or d.site_id = any (v_sites)))),
    'demandes_en_cours', (select count(*) from public.client_requests r where r.client_id = v.client_id and r.status in ('nouvelle', 'en_cours')),
    'actus', coalesce((select jsonb_agg(x order by x ->> 'published_at' desc) from (
                 select jsonb_build_object('id', n.id, 'title', n.title, 'published_at', n.published_at) as x
                 from public.client_news n where n.company_id = v.company_id and n.status = 'publie'
                 order by n.published_at desc limit 3) z), '[]'::jsonb)
  );
end
$$;

-- Formations du client : intra et groupes du client dans les inter ; mêmes champs que l'espace par code
create or replace function public.ent_sessions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
  v_sites uuid[] := app.ent_sites(v);
begin
  return jsonb_build_object(
    'client', (select jsonb_build_object('id', c.id, 'name', c.name, 'address', c.address, 'postal_code', c.postal_code, 'city', c.city,
        'siret', c.siret, 'contact_name', c.contact_name, 'contact_function', c.contact_function,
        'contact_email', c.contact_email, 'contact_phone', c.contact_phone)
      from public.clients c where c.id = v.client_id),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'reference', s.reference, 'start_date', s.start_date, 'end_date', s.end_date,
        'start_time', s.start_time, 'end_time', s.end_time, 'day_type', s.day_type, 'status', s.status,
        'location_name', s.location_name, 'location_address', s.location_address,
        'location_postal_code', s.location_postal_code, 'location_city', s.location_city,
        'is_intra', s.is_intra, 'is_remote', s.is_remote, 'session_type', s.session_type,
        'total_price', case when s.client_id = v.client_id then s.total_price else (select g.price_total from public.session_groups g where g.id = x.group_id) end,
        'funding_type', s.funding_type, 'funding_details', s.funding_details,
        'signatory_name', s.signatory_name, 'signatory_role', s.signatory_role,
        'convention_signed', s.convention_signed, 'attendance_token', s.attendance_token,
        'group_id', x.group_id,
        'courses', (select jsonb_build_object('id', co.id, 'title', co.title, 'objectives', co.objectives, 'content', co.content,
            'program', co.program, 'duration_hours', co.duration_hours, 'duration_days', co.duration_days, 'duration', co.duration,
            'price_ht', co.price_ht, 'price_per_day', co.price_per_day, 'target_audience', co.target_audience,
            'prerequisites', co.prerequisites, 'material', co.material, 'teaching_methods', co.teaching_methods,
            'evaluation_methods', co.evaluation_methods)
          from public.courses co where co.id = s.course_id),
        'trainers', (select jsonb_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name)
          from public.trainers t where t.id = s.trainer_id),
        'session_trainees', coalesce((
          select jsonb_agg(jsonb_build_object('trainee_id', st.trainee_id, 'result', st.result, 'absent', coalesce(st.absent, false),
            'access_code', st.access_code,
            'early_departure', coalesce(st.early_departure, false), 'departure_date', st.departure_date, 'departure_time', st.departure_time,
            'arrival_date', st.arrival_date, 'arrival_time', st.arrival_time, 'presence_hours', st.presence_hours,
            'trainees', jsonb_build_object('id', tr.id, 'first_name', tr.first_name, 'last_name', tr.last_name, 'gender', tr.gender, 'job_title', tr.job_title))
            order by tr.last_name, tr.first_name)
          from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
          where st.session_id = s.id
            and (s.client_id = v.client_id or st.group_id = x.group_id or (x.group_id is null and tr.client_id = v.client_id))
            and (v_sites is null or tr.site_id is null or tr.site_id = any (v_sites))
        ), '[]'::jsonb),
        'halfdays', coalesce((
          select jsonb_agg(jsonb_build_object('trainee_id', h.trainee_id, 'date', h.date, 'morning', h.morning, 'afternoon', h.afternoon,
            'signature_morning', h.signature_morning, 'signature_afternoon', h.signature_afternoon))
          from public.attendance_halfdays h
          where h.session_id = s.id and exists (
            select 1 from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
            where st.session_id = s.id and st.trainee_id = h.trainee_id
              and (s.client_id = v.client_id or st.group_id = x.group_id or (x.group_id is null and tr.client_id = v.client_id)))
        ), '[]'::jsonb),
        'proxies', '[]'::jsonb
      ) order by s.start_date desc)
      from (
        select s0.id as session_id, null::uuid as group_id from public.sessions s0 where s0.client_id = v.client_id
        union
        select g.session_id, g.id from public.session_groups g
        join public.sessions s1 on s1.id = g.session_id
        where g.client_id = v.client_id and s1.client_id is distinct from v.client_id
      ) x
      join public.sessions s on s.id = x.session_id
      where v_sites is null or s.site_id is null or s.site_id = any (v_sites)
    ), '[]'::jsonb)
  );
end
$$;

-- Salariés du client et validités de leurs formations (jamais de numéro de sécurité sociale)
create or replace function public.ent_salaries()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
  v_sites uuid[] := app.ent_sites(v);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', tr.id, 'first_name', tr.first_name, 'last_name', tr.last_name, 'job_title', tr.job_title,
      'site', (select si.name from public.sites si where si.id = tr.site_id),
      'validites', coalesce((
        select jsonb_agg(jsonb_build_object('label', coalesce(r.label, vt.validity_group), 'valide_le', vt.valide_le, 'echeance', vt.echeance,
                         'statut', case when vt.echeance is null then 'a_jour' when vt.echeance < current_date then 'depasse'
                                        when vt.echeance <= current_date + coalesce(r.reminder_days, 90) then 'a_prevoir' else 'a_jour' end)
                         order by vt.echeance nulls last)
        from public.v_trainee_validities vt left join public.obligation_rules r on r.id = vt.rule_id
        where vt.trainee_id = tr.id), '[]'::jsonb))
      order by tr.last_name, tr.first_name)
    from public.trainees tr
    where tr.client_id = v.client_id and (v_sites is null or tr.site_id is null or tr.site_id = any (v_sites))
  ), '[]'::jsonb);
end
$$;

-- Échéances du client (formations du personnel, matériel, exercices)
create or replace function public.ent_echeances()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
  v_sites uuid[] := app.ent_sites(v);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('kind', d.kind, 'label', d.rule_label, 'objet', d.objet_label, 'due_on', d.due_on,
                     'status', d.status, 'domain', d.domain, 'site', (select si.name from public.sites si where si.id = d.site_id))
                     order by d.due_on nulls last)
    from public.v_obligation_deadlines d
    where d.client_id = v.client_id and (v_sites is null or d.site_id is null or d.site_id = any (v_sites))
  ), '[]'::jsonb);
end
$$;

-- Factures du client (si le compte y a droit), brouillons exclus
create or replace function public.ent_factures()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  if not v.can_see_invoices then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'reference', i.reference, 'type', i.type, 'invoice_date', i.invoice_date,
                     'due_date', i.due_date, 'object', i.object, 'total_ht', i.total_net_ht, 'total_ttc', i.total_ttc,
                     'amount_paid', i.amount_paid, 'amount_due', i.amount_due, 'status', i.status)
                     order by i.invoice_date desc)
    from public.invoices i
    where (i.client_id = v.client_id or i.billing_client_id = v.client_id) and coalesce(i.status, 'draft') not in ('draft', 'brouillon')
  ), '[]'::jsonb);
end
$$;

-- Catalogue de l'organisme et sessions inter ouvertes à l'inscription
create or replace function public.ent_catalogue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  return jsonb_build_object(
    'formations', coalesce((
      select jsonb_agg(jsonb_build_object('id', co.id, 'title', co.title, 'code', co.code, 'duration_hours', co.duration_hours,
                       'duration_days', co.duration_days, 'objectives', co.objectives, 'target_audience', co.target_audience,
                       'prerequisites', co.prerequisites, 'program_url', co.program_url) order by co.title)
      from public.courses co where co.company_id = v.company_id), '[]'::jsonb),
    'sessions_inter', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'reference', s.reference, 'title', co.title, 'course_id', s.course_id,
                       'start_date', s.start_date, 'end_date', s.end_date, 'location_city', s.location_city,
                       'price_per_person', s.public_price_per_person,
                       'places', greatest(coalesce(s.max_participants, 0) - (select count(*) from public.session_trainees st where st.session_id = s.id), 0))
                       order by s.start_date)
      from public.sessions s left join public.courses co on co.id = s.course_id
      where s.company_id = v.company_id and s.session_type = 'inter' and coalesce(s.is_public, false)
        and s.start_date >= current_date and coalesce(s.status, '') not in ('cancelled', 'annulee')), '[]'::jsonb)
  );
end
$$;

-- Actualités publiées
create or replace function public.ent_actus()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'link', n.link, 'published_at', n.published_at)
                     order by n.published_at desc)
    from public.client_news n where n.company_id = v.company_id and n.status = 'publie'
  ), '[]'::jsonb);
end
$$;

-- Demandes du client
create or replace function public.ent_demandes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'message', r.message, 'payload', r.payload, 'status', r.status,
                     'response', r.response, 'created_at', r.created_at,
                     'session', (select jsonb_build_object('reference', s.reference, 'start_date', s.start_date) from public.sessions s where s.id = r.session_id),
                     'course', (select co.title from public.courses co where co.id = r.course_id))
                     order by r.created_at desc)
    from public.client_requests r where r.client_id = v.client_id
  ), '[]'::jsonb);
end
$$;

-- Nouvelle demande : inscription à une session inter ouverte (si le compte peut inscrire), demande intra,
-- remplacement d'un salarié sur une session du client, message. Notification à l'organisme.
create or replace function public.ent_demander(p_kind text, p_message text default null, p_session uuid default null,
                                               p_course uuid default null, p_payload jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
  v_id uuid;
  v_client text;
begin
  if p_kind not in ('inscription_inter', 'demande_intra', 'remplacement', 'message') then
    raise exception 'Type de demande inconnu' using errcode = '22023';
  end if;
  if p_kind = 'inscription_inter' then
    if not v.can_register then raise exception 'Ce compte ne peut pas inscrire de salariés' using errcode = '42501'; end if;
    if not exists (select 1 from public.sessions s where s.id = p_session and s.company_id = v.company_id and s.session_type = 'inter'
                   and coalesce(s.is_public, false) and s.start_date >= current_date) then
      raise exception 'Session inter introuvable ou fermée' using errcode = '22023';
    end if;
  elsif p_kind = 'remplacement' then
    if not exists (select 1 from public.sessions s left join public.session_groups g on g.session_id = s.id and g.client_id = v.client_id
                   where s.id = p_session and (s.client_id = v.client_id or g.id is not null)) then
      raise exception 'Session introuvable' using errcode = '22023';
    end if;
  elsif p_session is not null then
    raise exception 'Session inattendue pour ce type de demande' using errcode = '22023';
  end if;
  if p_course is not null and not exists (select 1 from public.courses co where co.id = p_course and co.company_id = v.company_id) then
    raise exception 'Formation introuvable' using errcode = '22023';
  end if;
  if length(coalesce(p_message, '')) > 4000 or length(coalesce(p_payload, '{}'::jsonb)::text) > 20000 then
    raise exception 'Demande trop longue' using errcode = '22023';
  end if;

  insert into public.client_requests (company_id, client_id, account_id, kind, session_id, course_id, message, payload)
  values (v.company_id, v.client_id, v.id, p_kind, p_session, p_course, nullif(btrim(p_message), ''), coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;

  select c.name into v_client from public.clients c where c.id = v.client_id;
  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (v.company_id, 'demande_entreprise',
          'Demande de ' || coalesce(v_client, 'un client'),
          case p_kind when 'inscription_inter' then 'Inscription à une session inter' when 'demande_intra' then 'Demande de formation intra'
                      when 'remplacement' then 'Remplacement d''un salarié' else 'Message' end,
          '/espace-entreprise', jsonb_build_object('client_id', v.client_id, 'request_id', v_id));
  return v_id;
end
$$;

-- Identité de l'organisme pour les documents (mêmes champs que l'espace par code, société du compte)
create or replace function public.ent_org()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
  o jsonb := to_jsonb(app.identite_societe(v.company_id));
  v_ref jsonb := public.referent_handicap_info();
  k text;
  r jsonb := '{}'::jsonb;
begin
  foreach k in array array['name', 'legal_name', 'forme_juridique', 'app_short_name', 'address', 'postal_code', 'city', 'lieu_signature',
    'phone', 'email', 'website', 'siret', 'siren', 'naf', 'tva_intra', 'tva_applicable', 'nda', 'nda_region', 'iban', 'bic',
    'dirigeant_name', 'dirigeant_title', 'dirigeant_signature_url', 'logo_url', 'stamp_base64', 'brand_primary', 'brand_accent',
    'brand_highlight', 'doc_prefix', 'qualiopi_certified', 'activity_kind', 'tribunal_competent', 'conditions_annulation'] loop
    if o ? k then r := r || jsonb_build_object(k, o -> k); end if;
  end loop;
  return r || jsonb_build_object('referent_handicap_nom', v_ref ->> 'nom', 'referent_handicap_email', v_ref ->> 'email',
                                 'referent_handicap_phone', v_ref ->> 'phone');
end
$$;

do $$
declare f text;
begin
  foreach f in array array['ent_accueil()', 'ent_org()', 'ent_sessions()', 'ent_salaries()', 'ent_echeances()', 'ent_factures()', 'ent_catalogue()',
                           'ent_actus()', 'ent_demandes()', 'ent_demander(text, text, uuid, uuid, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ── 5. Comptes d'un client, avec leur dernière connexion (fiche client) ──
create or replace function public.client_accounts_etat(p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.clients c where c.id = p_client
                 and c.company_id in (select app.societes_avec_droit('clients.espace.gerer'))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'contact_id', a.contact_id, 'email', coalesce(a.email, p.email),
                     'all_sites', a.all_sites, 'can_register', a.can_register, 'can_see_invoices', a.can_see_invoices,
                     'is_active', a.is_active, 'invited_at', a.invited_at, 'last_seen_at', p.last_seen_at,
                     'sites', coalesce((select jsonb_agg(s.site_id) from public.client_account_sites s where s.account_id = a.id), '[]'::jsonb))
                     order by a.invited_at)
    from public.client_accounts a join public.profiles p on p.id = a.profile_id
    where a.client_id = p_client
  ), '[]'::jsonb);
end
$$;
revoke all on function public.client_accounts_etat(uuid) from public, anon;
grant execute on function public.client_accounts_etat(uuid) to authenticated;

insert into public.schema_migrations (version) values ('0046_espace_entreprise') on conflict (version) do nothing;

-- ===== supabase/rollback/0046_espace_entreprise_retour.sql =====
-- Retour arrière de 0046_espace_entreprise.sql : retire comptes entreprise, demandes, actualités et fonctions ent_*.
-- Idempotent. Refusé si des comptes, demandes ou actualités ont été créés (les profils au rôle « entreprise » et leurs
-- connexions restent alors à traiter à la main).

do $$
begin
  if to_regclass('public.client_accounts') is not null then
    if exists (select 1 from public.client_accounts) or exists (select 1 from public.client_requests) or exists (select 1 from public.client_news) then
      raise exception 'Retour arrière refusé : des comptes entreprise, demandes ou actualités ont été créés';
    end if;
  end if;
end $$;

drop function if exists public.client_accounts_etat(uuid);
drop function if exists public.ent_demander(text, text, uuid, uuid, jsonb);
drop function if exists public.ent_demandes();
drop function if exists public.ent_actus();
drop function if exists public.ent_catalogue();
drop function if exists public.ent_factures();
drop function if exists public.ent_echeances();
drop function if exists public.ent_salaries();
drop function if exists public.ent_sessions();
drop function if exists public.ent_accueil();
drop function if exists public.ent_org();
drop function if exists app.ent_sites(public.client_accounts);
drop function if exists app.ent_compte();
drop table if exists public.client_news;
drop table if exists public.client_requests;
drop table if exists public.client_account_sites;
drop table if exists public.client_accounts;
drop function if exists app.espace_entreprise_maj();

delete from public.schema_migrations where version = '0046_espace_entreprise';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE l2_0046 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

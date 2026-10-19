-- 0262_bandeau_nouveautes.sql : bandeau d'information et page « Quoi de neuf » (chantier A, mise en service).
--
-- 1. Table platform_notices : une ligne par avis.
--      kind = 'bandeau'   texte du bandeau affiché en haut de l'application (un par portée : toutes les sociétés,
--                         ou une société) ; actif quand il est publié ;
--      kind = 'nouveaute' entrée de la page « Quoi de neuf », en français simple, datée à sa publication.
--    company_id vide = toutes les sociétés (avis de la plateforme) ; sinon une seule société.
--    Statuts : brouillon (visible du super administrateur seulement), publie, archive.
--    Source : 'manuel' (écrite dans la Console) ou 'pull_request' (proposée à chaque fusion sur main par l'action
--    GitHub « Nouveautés », toujours en brouillon : rien n'est montré aux utilisateurs avant validation).
--    Aucune donnée personnelle dans les avis.
-- 2. Règles : lecture des avis publiés par tout compte qui voit les réglages de l'organisme ; brouillons, écriture
--    et suppression : super administrateur (droit plateforme.administrer). Isolement par société : règles
--    restrictives qui laissent passer les lignes sans société.
-- 3. profiles.notices_seen_at : dernière ouverture de « Quoi de neuf » (pastille « nouveau » sur le lien).
-- 4. Fonctions :
--      notices_state()                         bandeau à afficher, date de la dernière nouveauté publiée, pastille ;
--      notices_mark_seen()                     « Quoi de neuf » ouvert par le compte connecté ;
--      notice_from_pull_request(n, titre, …)   brouillon proposé par l'action GitHub (serveur seulement).
-- 5. Modules optionnels « nouveautes » et « retours » (actifs par défaut, réactivables dans la Console).
-- 6. Bandeau de départ (toutes les sociétés, publié) : texte par défaut ; deuxième phrase sur les données fictives
--    affichée tant que des données de démonstration existent.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0262_bandeau_nouveautes_retour.sql

-- ── 1. Table ──
create table if not exists public.platform_notices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  kind text not null check (kind in ('bandeau', 'nouveaute')),
  status text not null default 'brouillon' check (status in ('brouillon', 'publie', 'archive')),
  title text check (title is null or char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 4000),
  show_demo_line boolean not null default true,
  source text not null default 'manuel' check (source in ('manuel', 'pull_request')),
  source_ref text,
  source_url text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

comment on table public.platform_notices is 'Bandeau d''information et entrées « Quoi de neuf » ; company_id vide = toutes les sociétés';

create unique index if not exists platform_notices_source_key on public.platform_notices (source, source_ref)
  where source_ref is not null;
create index if not exists platform_notices_kind_idx on public.platform_notices (kind, status, published_at desc);

alter table public.platform_notices enable row level security;
revoke all on table public.platform_notices from public, anon;
grant select, insert, update, delete on table public.platform_notices to authenticated;
grant all on table public.platform_notices to service_role;

-- Dates et auteurs tenus par la base ; date de publication posée au premier passage en « publie »
create or replace function app.platform_notices_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(new.created_by, (select auth.uid()));
  end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  if new.status = 'publie' and (tg_op = 'INSERT' or old.status is distinct from 'publie') then
    new.published_at := coalesce(case when tg_op = 'UPDATE' and old.published_at is not null and new.kind = 'nouveaute'
                                      then old.published_at end, now());
  end if;
  return new;
end
$$;

drop trigger if exists platform_notices_maj on public.platform_notices;
create trigger platform_notices_maj before insert or update on public.platform_notices
  for each row execute function app.platform_notices_maj();

-- ── 2. Règles (générées par scripts/securite/regles.py, build_suite('0262')) ──

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
           where schemaname = 'public' and tablename = any (array['platform_notices'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- platform_notices
select pg_temp.regles(array['platform_notices'], null,
  $r$((status = 'publie' and (select app.a_le_droit('organisation.reglages.voir'))) or (select app.a_le_droit('plateforme.administrer')))$r$,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$,
  $r$(select app.a_le_droit('plateforme.administrer'))$r$);

-- Isolement par société : une ligne sans société vaut pour toutes ; sinon, mêmes sociétés que les autres tables
drop policy if exists platform_notices_societe_lire on public.platform_notices;
drop policy if exists platform_notices_societe_creer on public.platform_notices;
drop policy if exists platform_notices_societe_modifier on public.platform_notices;
drop policy if exists platform_notices_societe_supprimer on public.platform_notices;
create policy platform_notices_societe_lire on public.platform_notices as restrictive for select to authenticated
  using (company_id is null or company_id in (select app.societes_lisibles()));
create policy platform_notices_societe_creer on public.platform_notices as restrictive for insert to authenticated
  with check (company_id is null or company_id in (select app.societes_ecriture()));
create policy platform_notices_societe_modifier on public.platform_notices as restrictive for update to authenticated
  using (company_id is null or company_id in (select app.societes_ecriture()))
  with check (company_id is null or company_id in (select app.societes_ecriture()));
create policy platform_notices_societe_supprimer on public.platform_notices as restrictive for delete to authenticated
  using (company_id is null or company_id in (select app.societes_ecriture()));

-- ── 3. Dernière ouverture de « Quoi de neuf » ──
alter table public.profiles add column if not exists notices_seen_at timestamptz;

-- ── 4. Fonctions ──
create or replace function public.notices_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.current_company();
  v_banner public.platform_notices;
  v_last timestamptz;
  v_seen timestamptz;
  v_demo boolean;
begin
  if (select auth.uid()) is null or not app.a_le_droit('organisation.reglages.voir') then
    return null;
  end if;
  -- Bandeau de la société courante s'il existe, sinon celui de toutes les sociétés
  select n.* into v_banner from public.platform_notices n
  where n.kind = 'bandeau' and n.status = 'publie'
    and (n.company_id is null or n.company_id = v_company)
  order by (n.company_id is null), n.updated_at desc
  limit 1;
  select max(n.published_at) into v_last from public.platform_notices n
  where n.kind = 'nouveaute' and n.status = 'publie'
    and (n.company_id is null or n.company_id = v_company or (v_company is null and n.company_id in (select app.societes_lisibles())));
  select p.notices_seen_at into v_seen from public.profiles p where p.id = (select auth.uid());
  v_demo := exists (select 1 from public.demo_records limit 1);
  return jsonb_build_object(
    'banner', case when v_banner.id is null or btrim(v_banner.body) = '' then null else jsonb_build_object(
      'id', v_banner.id, 'body', v_banner.body,
      'demo', v_banner.show_demo_line and v_demo,
      'updated_at', v_banner.updated_at) end,
    'last_published_at', v_last,
    'seen_at', v_seen,
    'unseen', v_last is not null and (v_seen is null or v_seen < v_last));
end
$$;

create or replace function public.notices_mark_seen()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  update public.profiles set notices_seen_at = v_now where id = (select auth.uid());
  return v_now;
end
$$;

-- Brouillon proposé à partir d'une pull request fusionnée (action GitHub « Nouveautés », clé de service).
-- Titre repris ; texte : premier paragraphe de la description (titres Markdown retirés), sans balises, 800 caractères au plus.
-- Une même pull request ne crée jamais deux entrées. Rien n'est publié.
create or replace function public.notice_from_pull_request(p_number int, p_title text, p_body text, p_url text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_par text;
begin
  if coalesce((select auth.role()), '') not in ('service_role', '') then
    raise exception 'Réservé au serveur' using errcode = '42501';
  end if;
  if p_number is null or p_number <= 0 then
    raise exception 'Numéro de pull request manquant' using errcode = '22023';
  end if;
  -- Titres Markdown (« ## Résumé ») retirés, puis premier paragraphe
  v_par := regexp_replace(replace(coalesce(p_body, ''), E'\r', ''), '^[ \t]*#[^\n]*(\n|$)', '', 'gn');
  v_par := btrim(split_part(btrim(v_par, E' \n\t'), E'\n\n', 1));
  v_par := regexp_replace(v_par, '^[#>*\-\s]+', '', 'g');
  v_par := regexp_replace(v_par, '`+|\*+', '', 'g');
  v_par := left(btrim(regexp_replace(v_par, '\s+', ' ', 'g')), 800);
  insert into public.platform_notices (kind, status, title, body, source, source_ref, source_url)
  values ('nouveaute', 'brouillon', left(btrim(coalesce(p_title, 'Mise à jour')), 200), v_par, 'pull_request',
          'PR #' || p_number, left(p_url, 500))
  on conflict (source, source_ref) where source_ref is not null do nothing
  returning id into v_id;
  return v_id;
end
$$;

revoke all on function public.notices_state(), public.notices_mark_seen() from public, anon;
grant execute on function public.notices_state(), public.notices_mark_seen() to authenticated, service_role;
revoke all on function public.notice_from_pull_request(int, text, text, text) from public, anon, authenticated;
grant execute on function public.notice_from_pull_request(int, text, text, text) to service_role;

-- ── 5. Modules optionnels ──
insert into public.org_modules (key, label, enabled, position, description) values
  ('nouveautes', 'Quoi de neuf', true, 150, 'Page des nouveautés de l''application, en français simple, avec une pastille tant qu''elle n''a pas été ouverte'),
  ('retours', 'Retours des utilisateurs', true, 160, 'Post-it « Une remarque ? » : problèmes, idées et questions, avec capture facultative, suivi et réponse à l''auteur')
on conflict (key) do nothing;

-- ── 6. Bandeau de départ ──
-- Texte composé avec le prénom du super administrateur et le nom de l'application de l'instance (rien en dur),
-- puis réglable dans la Console.
insert into public.platform_notices (kind, status, body, show_demo_line)
select 'bandeau', 'publie',
  coalesce((select nullif(btrim(coalesce(nullif(p.first_name, ''), split_part(p.display_name, ' ', 1))), '')
            from public.profiles p where p.role = 'superadmin' and coalesce(p.is_active, true)
            order by p.created_at limit 1), 'L''éditeur')
  || ' fait évoluer '
  || coalesce((select nullif(btrim(o.app_name), '') from public.organization_settings o limit 1), 'l''application')
  || ' régulièrement : des changements peuvent intervenir.', true
where not exists (select 1 from public.platform_notices where kind = 'bandeau' and company_id is null);

insert into public.schema_migrations (version) values ('0262_bandeau_nouveautes') on conflict (version) do nothing;

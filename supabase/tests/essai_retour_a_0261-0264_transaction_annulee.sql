-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (a_0261-0264) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0261_registre_migrations.sql, 0262_bandeau_nouveautes.sql, 0263_retours_suivi.sql, 0264_demo_lignes_reelles.sql, retour arrière,
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

-- ===== supabase/migrations/0261_registre_migrations.sql =====
-- 0261_registre_migrations.sql : régularisation du registre des migrations (chantier A, mise en service).
--
-- Deux registres existent :
--   public.schema_migrations              tenu par les migrations du dépôt (chaque fichier s'y inscrit) ; lu par la
--                                         Console (« Migrations appliquées ») et par scripts/migrations/lancer.sh ;
--   supabase_migrations.schema_migrations tenu par l'outil Supabase, arrêté le 14/10 (13 versions horodatées).
-- Référence retenue : public.schema_migrations (décision du chantier A, choix prudent : c'est celui que lisent
-- la Console et l'action de migration). Le registre Supabase est laissé tel quel, comme historique.
--
-- Constat en production le 19/10 (lecture seule) :
--   0190_passeport_prevention  objets présents (8 tables pp_*, 10 fonctions pp_*, module « passeport »),
--                              mais absente du registre : inscrite ici, sans rien rejouer ;
--   0110_finance_generique     NON appliquée (contrainte du payeur, valeur par défaut du repas, libellé de compte
--                              et get_budget_kpis encore dans leur version d'origine) : non inscrite, non appliquée.
-- L'inscription n'a lieu que si les objets de 0190 existent vraiment ; sinon rien n'est écrit.
-- Aucune table, aucune règle, aucune donnée métier touchée. Idempotente.
-- Retour arrière : supabase/rollback/0261_registre_migrations_retour.sql

do $$
begin
  if to_regclass('public.pp_lignes') is not null
     and to_regclass('public.pp_nir') is not null
     and to_regclass('public.pp_format_versions') is not null
     and to_regprocedure('public.pp_can()') is not null
     and exists (select 1 from public.org_modules where key = 'passeport') then
    insert into public.schema_migrations (version) values ('0190_passeport_prevention') on conflict (version) do nothing;
  end if;
end $$;

insert into public.schema_migrations (version) values ('0261_registre_migrations') on conflict (version) do nothing;

-- ===== supabase/migrations/0262_bandeau_nouveautes.sql =====
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

-- ===== supabase/migrations/0263_retours_suivi.sql =====
-- 0263_retours_suivi.sql : suivi des retours des utilisateurs (chantier A, évolution du post-it de 0260).
--
-- Un seul circuit : la table user_feedback (0260) reste lue et écrite seulement par le serveur (/api/retours,
-- clé de service) ; aucune règle d'accès, aucun droit pour anon ni pour les comptes connectés.
-- 1. user_feedback : type (problème, idée, question ; vide = remarque libre d'avant), gravité ressentie,
--    capture facultative (chemin dans le bucket privé « retours »), statuts nouveau, vu, en cours, fait, écarté,
--    réponse visible par l'auteur (date de lecture), lien vers l'entrée « Quoi de neuf » qui règle le retour.
-- 2. Bucket privé « retours » (captures compressées, 3 Mo au plus, images seulement) : aucune règle de stockage,
--    donc seul le serveur y lit et écrit ; les captures ne sortent jamais de l'outil (lien signé de courte durée).
-- 3. Droit « organisation.retours.suivre » (module « retours ») : lire tous les retours, voir les captures, changer
--    le statut, répondre. Donné aux modèles super administrateur et administrateur, et aux copies de société du
--    modèle administrateur (un nouveau droit ne doit pas manquer à une société qui a personnalisé ce profil).
--    Sans ce droit, un compte ne voit que ses propres retours.
-- Traitement à inscrire au registre RGPD (chantier F) : retours des utilisateurs internes (texte, page, taille
-- d'écran, capture facultative), conservés pour l'amélioration de l'outil.
-- Migration additive : aucune ligne existante n'est modifiée. Idempotente.
-- Retour arrière : supabase/rollback/0263_retours_suivi_retour.sql

-- ── 1. Colonnes ──
alter table public.user_feedback add column if not exists kind text;
alter table public.user_feedback add column if not exists severity text;
alter table public.user_feedback add column if not exists screenshot_path text;
alter table public.user_feedback add column if not exists response text;
alter table public.user_feedback add column if not exists responded_at timestamptz;
alter table public.user_feedback add column if not exists responded_by uuid;
alter table public.user_feedback add column if not exists response_read_at timestamptz;
alter table public.user_feedback add column if not exists notice_id uuid;
alter table public.user_feedback add column if not exists updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_feedback_kind_check') then
    alter table public.user_feedback add constraint user_feedback_kind_check
      check (kind is null or kind in ('probleme', 'idee', 'question'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_feedback_severity_check') then
    alter table public.user_feedback add constraint user_feedback_severity_check
      check (severity is null or severity in ('faible', 'genant', 'bloquant'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_feedback_response_check') then
    alter table public.user_feedback add constraint user_feedback_response_check
      check (response is null or char_length(response) <= 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_feedback_notice_fk') then
    alter table public.user_feedback add constraint user_feedback_notice_fk
      foreign key (notice_id) references public.platform_notices(id) on delete set null;
  end if;
end $$;

alter table public.user_feedback drop constraint if exists user_feedback_status_check;
alter table public.user_feedback add constraint user_feedback_status_check
  check (status in ('nouveau', 'vu', 'en_cours', 'fait', 'ecarte'));

create index if not exists user_feedback_author_idx on public.user_feedback (author_id, created_at desc);

comment on table public.user_feedback is 'Retours des utilisateurs (post-it) : lus et écrits seulement par le serveur (/api/retours) ; captures dans le bucket privé « retours »';

-- ── 2. Bucket privé des captures ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('retours', 'retours', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ── 3. Droit de suivi ──
insert into public.permissions (code, module, label, description, data_scope, own_scope, shows_prices,
  full_license_only, platform_only, position) values
  ('organisation.retours.suivre', 'retours', 'Suivre les retours des utilisateurs', 'Lire tous les retours (post-it), voir les captures, changer leur statut et répondre à l''auteur ; chacun voit toujours ses propres retours', 'user_feedback (par le serveur, /api/retours)', false, false, false, false, 1360)
on conflict (code) do update set module = excluded.module, label = excluded.label,
  description = excluded.description, data_scope = excluded.data_scope, updated_at = now();

insert into public.permission_profile_rights (profile_id, right_code)
select p.id, 'organisation.retours.suivre' from public.permission_profiles p
where (p.company_id is null and p.key in ('superadmin', 'admin'))
   or (p.company_id is not null and p.key = 'admin')
on conflict do nothing;

insert into public.schema_migrations (version) values ('0263_retours_suivi') on conflict (version) do nothing;

-- ===== supabase/migrations/0264_demo_lignes_reelles.sql =====
-- 0264_demo_lignes_reelles.sql : lignes probablement réelles rattachées aux données de démonstration (chantier A).
--
-- Constat : purge_demo_data() (0024) efface toute ligne qui pointe vers un client, une session, un stagiaire, un
-- devis, une facture ou un rendez-vous fictif (colonnes session_id, trainee_id, client_id, invoice_id, quote_id,
-- rdv_id, parent_invoice_id, billing_client_id), quelle que soit la personne qui l'a saisie. Une saisie réelle
-- rattachée à du fictif (une visite, un devis ou une facture pour un client fictif, un stagiaire réel inscrit à une
-- session fictive, une note sur un client fictif…) disparaîtrait donc avec la purge.
-- demo_real_links() montre ces lignes AVANT la purge, dans la Console (Données de démonstration) :
--   même périmètre que la purge (mêmes colonnes, mêmes devis et factures rattachés aux clients et sessions fictifs) ;
--   « probablement réelle » = créée plus d'une heure après le dernier enregistrement de démonstration (les lignes
--   créées avec le jeu fictif ne sont pas listées) ; tables sans date de création : comptées à part.
-- Rien n'est effacé ni modifié ici ; la purge reste un geste du super administrateur. Lecture seule.
-- Idempotente. Retour arrière : supabase/rollback/0264_demo_lignes_reelles_retour.sql

create or replace function public.demo_real_links()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sessions uuid[]; v_trainees uuid[]; v_clients uuid[]; v_invoices uuid[]; v_quotes uuid[]; v_rdv uuid[];
  v_seuil timestamptz;
  r record;
  v_ids uuid[];
  v_n int; v_last timestamptz; v_sample jsonb;
  v_out jsonb := '[]'::jsonb;
  v_sans_date jsonb := '[]'::jsonb;
  v_total int := 0;
  v_has_id boolean;
begin
  if not app.a_le_droit('plateforme.administrer') then
    raise exception 'Réservé au super administrateur' using errcode = '42501';
  end if;
  select max(created_at) + interval '1 hour' into v_seuil from public.demo_records;
  if v_seuil is null then
    return jsonb_build_object('seuil', null, 'lignes', '[]'::jsonb, 'sans_date', '[]'::jsonb, 'total', 0);
  end if;

  select coalesce(array_agg(id) filter (where tbl = 'sessions'), '{}'), coalesce(array_agg(id) filter (where tbl = 'trainees'), '{}'),
         coalesce(array_agg(id) filter (where tbl = 'clients'), '{}'), coalesce(array_agg(id) filter (where tbl = 'invoices'), '{}'),
         coalesce(array_agg(id) filter (where tbl = 'quotes'), '{}'), coalesce(array_agg(id) filter (where tbl = 'prospect_rdv'), '{}')
    into v_sessions, v_trainees, v_clients, v_invoices, v_quotes, v_rdv
  from public.demo_records;
  -- Même extension que la purge : devis et factures des sessions et clients fictifs
  v_invoices := v_invoices || coalesce((select array_agg(id) from public.invoices
                                        where session_id = any(v_sessions) or client_id = any(v_clients)), '{}');
  v_quotes := v_quotes || coalesce((select array_agg(id) from public.quotes
                                    where session_id = any(v_sessions) or client_id = any(v_clients)), '{}');

  for r in
    select c.table_name, c.column_name,
           exists (select 1 from information_schema.columns d where d.table_schema = 'public'
                   and d.table_name = c.table_name and d.column_name = 'created_at') as has_date
    from information_schema.columns c join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.data_type = 'uuid'
      and c.column_name in ('session_id', 'trainee_id', 'client_id', 'invoice_id', 'quote_id', 'rdv_id', 'parent_invoice_id', 'billing_client_id')
      and c.table_name not in ('demo_records', 'profiles', 'courses')
    order by c.table_name, c.column_name
  loop
    v_ids := case r.column_name
      when 'session_id' then v_sessions when 'trainee_id' then v_trainees
      when 'client_id' then v_clients when 'billing_client_id' then v_clients
      when 'invoice_id' then v_invoices when 'parent_invoice_id' then v_invoices
      when 'quote_id' then v_quotes else v_rdv end;
    continue when coalesce(array_length(v_ids, 1), 0) = 0;
    v_has_id := exists (select 1 from information_schema.columns d where d.table_schema = 'public'
                        and d.table_name = r.table_name and d.column_name = 'id' and d.data_type = 'uuid');
    if r.has_date then
      execute format(
        'select count(*), max(x.created_at), coalesce(jsonb_agg(x.id) filter (where x.rn <= 10), ''[]''::jsonb)
           from (select %s as id, t.created_at, row_number() over (order by t.created_at desc) rn
                   from public.%I t
                  where t.%I = any($1) and t.created_at > $2
                    and not exists (select 1 from public.demo_records d where d.tbl = %L and %s)) x',
        case when v_has_id then 't.id' else 'null::uuid' end, r.table_name, r.column_name, r.table_name,
        case when v_has_id then 'd.id = t.id' else 'false' end)
        into v_n, v_last, v_sample using v_ids, v_seuil;
      if v_n > 0 then
        v_out := v_out || jsonb_build_object('table', r.table_name, 'colonne', r.column_name, 'nombre', v_n,
                                             'derniere', v_last, 'exemples', v_sample);
        v_total := v_total + v_n;
      end if;
    else
      execute format('select count(*) from public.%I t where t.%I = any($1)', r.table_name, r.column_name)
        into v_n using v_ids;
      if v_n > 0 then
        v_sans_date := v_sans_date || jsonb_build_object('table', r.table_name, 'colonne', r.column_name, 'nombre', v_n);
      end if;
    end if;
  end loop;

  return jsonb_build_object('seuil', v_seuil, 'lignes', v_out, 'sans_date', v_sans_date, 'total', v_total);
end
$$;

revoke all on function public.demo_real_links() from public, anon;
grant execute on function public.demo_real_links() to authenticated;

insert into public.schema_migrations (version) values ('0264_demo_lignes_reelles') on conflict (version) do nothing;

-- ===== supabase/rollback/0261-0264_mise_en_service_retour.sql =====
-- Retour arrière du lot a_0261-0264 (mise en service) : 0264, 0263, 0262 puis 0261, dans cet ordre. Idempotent.
-- Chaque partie est aussi disponible seule : supabase/rollback/026x_*_retour.sql

-- ═══ 0264_demo_lignes_reelles ═══
-- Retour arrière de 0264_demo_lignes_reelles.sql : retire la lecture des lignes réelles rattachées au fictif.
-- Idempotent ; aucune donnée concernée.

drop function if exists public.demo_real_links();

delete from public.schema_migrations where version = '0264_demo_lignes_reelles';

-- ═══ 0263_retours_suivi ═══
-- Retour arrière de 0263_retours_suivi.sql : retire le suivi des retours (colonnes, bucket, droit). Idempotent.
-- Refusé si des retours portent déjà un type, une capture, une réponse ou un statut nouveau (vu, en cours) :
-- ce sont des données saisies par les utilisateurs, jamais effacées par un retour arrière.

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_feedback'
             and column_name = 'kind') then
    if exists (select 1 from public.user_feedback
               where kind is not null or severity is not null or screenshot_path is not null or response is not null
                  or notice_id is not null or status in ('vu', 'en_cours')) then
      raise exception 'Retour arrière refusé : des retours utilisent déjà le suivi (type, capture, réponse ou statut)';
    end if;
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'retours') then
    raise exception 'Retour arrière refusé : le bucket « retours » contient des captures';
  end if;
end $$;

delete from public.permission_profile_rights where right_code = 'organisation.retours.suivre';
delete from public.company_member_rights where right_code = 'organisation.retours.suivre';
delete from public.permissions where code = 'organisation.retours.suivre';
delete from storage.buckets where id = 'retours';

drop index if exists public.user_feedback_author_idx;
alter table public.user_feedback drop constraint if exists user_feedback_status_check;
alter table public.user_feedback add constraint user_feedback_status_check check (status in ('nouveau', 'fait', 'ecarte'));
alter table public.user_feedback drop constraint if exists user_feedback_notice_fk;
alter table public.user_feedback drop constraint if exists user_feedback_response_check;
alter table public.user_feedback drop constraint if exists user_feedback_severity_check;
alter table public.user_feedback drop constraint if exists user_feedback_kind_check;
alter table public.user_feedback drop column if exists updated_at;
alter table public.user_feedback drop column if exists notice_id;
alter table public.user_feedback drop column if exists response_read_at;
alter table public.user_feedback drop column if exists responded_by;
alter table public.user_feedback drop column if exists responded_at;
alter table public.user_feedback drop column if exists response;
alter table public.user_feedback drop column if exists screenshot_path;
alter table public.user_feedback drop column if exists severity;
alter table public.user_feedback drop column if exists kind;
comment on table public.user_feedback is 'Retours des utilisateurs (post-it) : lus et écrits seulement par le serveur (/api/retours)';

delete from public.schema_migrations where version = '0263_retours_suivi';

-- ═══ 0262_bandeau_nouveautes ═══
-- Retour arrière de 0262_bandeau_nouveautes.sql : retire le bandeau, les nouveautés et leurs modules. Idempotent.
-- Refusé si des entrées « Quoi de neuf » ont été publiées (contenu écrit par l'éditeur, à exporter d'abord) ou si
-- 0263 est encore en place (lien des retours vers les nouveautés).

do $$
begin
  if to_regclass('public.platform_notices') is not null then
    if exists (select 1 from public.platform_notices where kind = 'nouveaute' and status = 'publie') then
      raise exception 'Retour arrière refusé : des nouveautés ont été publiées (les exporter, puis les archiver ou les supprimer)';
    end if;
    if exists (select 1 from pg_constraint where conname = 'user_feedback_notice_fk') then
      raise exception 'Retour arrière refusé : retirer d''abord 0263 (supabase/rollback/0263_retours_suivi_retour.sql)';
    end if;
  end if;
end $$;

drop function if exists public.notice_from_pull_request(int, text, text, text);
drop function if exists public.notices_mark_seen();
drop function if exists public.notices_state();
drop table if exists public.platform_notices;
drop function if exists app.platform_notices_maj();
alter table public.profiles drop column if exists notices_seen_at;
delete from public.company_modules where key in ('nouveautes', 'retours');
delete from public.org_modules where key in ('nouveautes', 'retours');

delete from public.schema_migrations where version = '0262_bandeau_nouveautes';

-- ═══ 0261_registre_migrations ═══
-- Retour arrière de 0261_registre_migrations.sql : retire l'inscription faite par 0261. Idempotent.
-- 0190 n'est retirée que si elle a été inscrite par 0261 (même instant d'inscription, même transaction) :
-- une inscription faite par 0190 elle-même reste en place.

delete from public.schema_migrations s
where s.version = '0190_passeport_prevention'
  and exists (select 1 from public.schema_migrations r
              where r.version = '0261_registre_migrations' and r.applied_at = s.applied_at)
  and (select count(*) from public.schema_migrations x
       where x.applied_at = s.applied_at) = 2;

delete from public.schema_migrations where version = '0261_registre_migrations';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE a_0261-0264 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (f_0344) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0344_purges_rgpd.sql, retour arrière,
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

-- ===== supabase/migrations/0344_purges_rgpd.sql =====
-- 0344_purges_rgpd.sql : chantier F phase 2, durées de conservation reliées à des purges validées.
--
-- Spec : odet-conformite-rgpd-certifications.md § 5.2. Rien n'est supprimé en silence.
-- 1. rgpd_purge_regles (par société) : quatre règles livrées, chacune programmée en SQL (jamais une requête libre) :
--    journal d'audit au-delà de 12 mois (supprimer), prospects sans contact depuis 36 mois (supprimer, la liste
--    « ne pas appeler » est gardée), stagiaires sans session depuis 60 mois (anonymiser : les preuves de réalisation
--    restent, sans nom), données de handicap 12 mois après la dernière session (supprimer). Délai réglable, jamais en
--    dessous du minimum de la règle.
-- 2. rgpd_purge_passages : chaque nuit (api/maintenance-nuit.js), rgpd_purges_generer() calcule les lignes concernées
--    et crée un passage « à valider » (une seule à la fois par règle). La personne qui a le droit « Valider les purges »
--    exécute ou ignore ; la base recalcule les lignes à l'exécution (une ligne redevenue active n'est pas touchée).
-- 3. Mode automatique prévu (colonne mode) mais jamais posé par l'outil : il faut d'abord un passage validé à la main.
-- Tables : company_id, règles par droits (build_suite('0344')) et isolement par société.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0344_purges_rgpd_retour.sql

create table if not exists public.rgpd_purge_regles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  cle text not null check (cle in ('journal', 'prospects', 'stagiaires', 'handicap')),
  libelle text not null,
  objet text not null,
  action text not null check (action in ('supprimer', 'anonymiser')),
  delai_mois int not null,
  delai_minimum int not null,
  mode text not null default 'proposition' check (mode in ('proposition', 'automatique')),
  active boolean not null default true,
  derniere_validation_le timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, cle),
  constraint rgpd_purge_regles_delai check (delai_mois >= delai_minimum)
);
comment on table public.rgpd_purge_regles is 'Règles de purge par société (durées de conservation) ; chaque passage est validé par une personne';

create table if not exists public.rgpd_purge_passages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  regle_id uuid not null references public.rgpd_purge_regles(id) on delete cascade,
  cle text not null,
  cree_le timestamptz not null default now(),
  nb int not null default 0,
  candidats uuid[] not null default '{}',
  statut text not null default 'a_valider' check (statut in ('a_valider', 'execute', 'ignore')),
  decide_par uuid references public.profiles(id) on delete set null,
  decide_le timestamptz,
  nb_traites int,
  note text
);
create unique index if not exists rgpd_purge_passages_ouvert on public.rgpd_purge_passages (regle_id) where statut = 'a_valider';
comment on table public.rgpd_purge_passages is 'Passages de purge : lignes concernées (identifiants seuls), décision, exécution';

create or replace function app.rgpd_purge_regles_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id; new.cle := old.cle; new.action := old.action; new.objet := old.objet;
    new.delai_minimum := old.delai_minimum; new.created_at := old.created_at;
    -- Date de dernière validation : posée seulement par rgpd_purge_decider
    if coalesce(current_setting('app.purge_validation', true), '') <> '1' then
      new.derniere_validation_le := old.derniere_validation_le;
    end if;
    -- Le mode automatique n'est posé que par la société, après au moins un passage validé à la main
    if new.mode = 'automatique' and old.mode <> 'automatique' and old.derniere_validation_le is null then
      raise exception 'Mode automatique possible seulement après un premier passage validé à la main' using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.rgpd_purge_regles_maj() from public, anon, authenticated;
drop trigger if exists rgpd_purge_regles_maj on public.rgpd_purge_regles;
create trigger rgpd_purge_regles_maj before insert or update on public.rgpd_purge_regles
  for each row execute function app.rgpd_purge_regles_maj();

create or replace function app.rgpd_purge_regles_depart(p_company uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.rgpd_purge_regles (company_id, cle, libelle, objet, action, delai_mois, delai_minimum)
  values
    (p_company, 'journal', 'Journal d''audit', 'Lignes du journal d''audit plus anciennes que le délai', 'supprimer', 12, 6),
    (p_company, 'prospects', 'Prospects sans contact', 'Prospects de la base prospects sans contact depuis le délai (la liste « ne pas appeler » est gardée)', 'supprimer', 36, 36),
    (p_company, 'stagiaires', 'Stagiaires sans session', 'Fiches des stagiaires sans session depuis le délai : nom, coordonnées, naissance et notes effacés, preuves gardées sans nom', 'anonymiser', 60, 60),
    (p_company, 'handicap', 'Données de handicap', 'Besoins et adaptations déclarés, après la dernière session du stagiaire', 'supprimer', 12, 1)
  on conflict (company_id, cle) do nothing
$$;
revoke all on function app.rgpd_purge_regles_depart(uuid) from public, anon, authenticated;
select app.rgpd_purge_regles_depart(c.id) from public.companies c;

create or replace function app.societe_referentiels_depart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.subcontractor_doc_types_depart(new.id);
  if to_regprocedure('app.obligation_rules_depart(uuid)') is not null then
    execute 'select app.obligation_rules_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.commercial_lists_depart(uuid)') is not null then
    execute 'select app.commercial_lists_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_sous_traitants_depart(uuid)') is not null then
    execute 'select app.rgpd_sous_traitants_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_purge_regles_depart(uuid)') is not null then
    execute 'select app.rgpd_purge_regles_depart($1)' using new.id;
  end if;
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

-- Lignes concernées par une règle (identifiants seuls, 5 000 au plus par passage)
create or replace function app.rgpd_purge_candidats(p_regle public.rgpd_purge_regles)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limite timestamptz := now() - make_interval(months => p_regle.delai_mois);
  v_ids uuid[];
begin
  if p_regle.cle = 'journal' then
    select coalesce(array_agg(id), '{}') into v_ids from (
      select a.id from public.audit_logs a
      where a.company_id = p_regle.company_id and coalesce(a.timestamp, a.created_at) < v_limite
      order by a.timestamp limit 5000) x;
  elsif p_regle.cle = 'prospects' then
    select coalesce(array_agg(id), '{}') into v_ids from (
      select p.id from public.prospection_massive p
      where p.company_id = p_regle.company_id
        and not coalesce(p.do_not_call, false)
        and greatest(coalesce(p.contacted_at, p.created_at), coalesce(p.created_at, p.contacted_at)) < v_limite
        and not exists (select 1 from public.prospection_massive f where f.gere_par_id = p.id)
      limit 5000) x;
  elsif p_regle.cle = 'stagiaires' then
    select coalesce(array_agg(id), '{}') into v_ids from (
      select t.id from public.trainees t
      where t.company_id = p_regle.company_id
        and not (t.first_name = 'Anonymisé' and t.email is null)
        and coalesce(t.created_at, now()) < v_limite
        and coalesce((select max(coalesce(s.end_date, s.start_date)) from public.session_trainees st
                      join public.sessions s on s.id = st.session_id where st.trainee_id = t.id), t.last_session_date, t.created_at::date)
            < v_limite::date
      limit 5000) x;
  elsif p_regle.cle = 'handicap' then
    select coalesce(array_agg(trainee_id), '{}') into v_ids from (
      select d.trainee_id from public.trainee_disability d
      where d.company_id = p_regle.company_id
        and coalesce((select max(coalesce(s.end_date, s.start_date)) from public.session_trainees st
                      join public.sessions s on s.id = st.session_id where st.trainee_id = d.trainee_id), d.updated_at::date)
            < v_limite::date
        and not exists (select 1 from public.session_trainees st join public.sessions s on s.id = st.session_id
                        where st.trainee_id = d.trainee_id and coalesce(s.end_date, s.start_date) >= current_date)
      limit 5000) x;
  end if;
  return coalesce(v_ids, '{}');
end
$$;
revoke all on function app.rgpd_purge_candidats(public.rgpd_purge_regles) from public, anon, authenticated;

-- Chaque nuit : un passage « à valider » par règle active qui a des lignes concernées (service seulement)
create or replace function public.rgpd_purges_generer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rgpd_purge_regles;
  v_ids uuid[];
  v_crees int := 0;
begin
  for r in select * from public.rgpd_purge_regles where active loop
    if exists (select 1 from public.rgpd_purge_passages p where p.regle_id = r.id and p.statut = 'a_valider') then
      continue;
    end if;
    v_ids := app.rgpd_purge_candidats(r);
    if cardinality(v_ids) > 0 then
      insert into public.rgpd_purge_passages (company_id, regle_id, cle, nb, candidats)
      values (r.company_id, r.id, r.cle, cardinality(v_ids), v_ids);
      v_crees := v_crees + 1;
    end if;
  end loop;
  return jsonb_build_object('passages', v_crees);
end
$$;
revoke all on function public.rgpd_purges_generer() from public, anon, authenticated;
grant execute on function public.rgpd_purges_generer() to service_role;

-- Décision d'une personne : exécuter ou ignorer un passage
create or replace function public.rgpd_purge_decider(p_passage uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.rgpd_purge_passages;
  r public.rgpd_purge_regles;
  v_ids uuid[];
  v_n int := 0;
begin
  select * into p from public.rgpd_purge_passages where id = p_passage for update;
  if p.id is null then
    raise exception 'Passage introuvable' using errcode = 'P0002';
  end if;
  if not (p.company_id in (select app.societes_avec_droit('conformite.purges.valider'))) then
    raise exception 'Droit « Valider les purges » requis' using errcode = '42501';
  end if;
  if p.statut <> 'a_valider' then
    raise exception 'Passage déjà traité' using errcode = '22023';
  end if;
  if p_decision not in ('executer', 'ignorer') then
    raise exception 'Décision inconnue : %', p_decision using errcode = '22023';
  end if;
  select * into r from public.rgpd_purge_regles where id = p.regle_id;
  if p_decision = 'executer' then
    -- Lignes recalculées : seules celles encore concernées et listées dans le passage sont traitées
    select coalesce(array_agg(x), '{}') into v_ids from unnest(app.rgpd_purge_candidats(r)) x where x = any (p.candidats);
    if r.cle = 'journal' then
      delete from public.audit_logs where id = any (v_ids);
    elsif r.cle = 'prospects' then
      delete from public.prospection_massive where id = any (v_ids);
    elsif r.cle = 'stagiaires' then
      delete from public.trainee_disability where trainee_id = any (v_ids);
      update public.trainees
         set first_name = 'Anonymisé', last_name = 'Stagiaire', email = null, phone = null, birth_date = null,
             birth_place = null, address = null, postal_code = null, notes = null, social_security_number = null,
             ssn_encrypted = null, nom_naissance = null, has_disability = false, disability_details = null,
             disability_adaptations = null
       where id = any (v_ids);
    elsif r.cle = 'handicap' then
      delete from public.trainee_disability where trainee_id = any (v_ids);
      update public.trainees set has_disability = false, disability_details = null, disability_adaptations = null
       where id = any (v_ids) and (has_disability or disability_details is not null or disability_adaptations is not null);
    end if;
    v_n := cardinality(v_ids);
    perform set_config('app.purge_validation', '1', true);
    update public.rgpd_purge_regles set derniere_validation_le = now() where id = r.id;
    perform set_config('app.purge_validation', '', true);
    update public.rgpd_purge_passages
       set statut = 'execute', decide_par = (select auth.uid()), decide_le = now(), nb_traites = v_n, note = p_note
     where id = p.id;
  else
    update public.rgpd_purge_passages
       set statut = 'ignore', decide_par = (select auth.uid()), decide_le = now(), nb_traites = 0, note = p_note
     where id = p.id;
  end if;
  return jsonb_build_object('statut', case when p_decision = 'executer' then 'execute' else 'ignore' end, 'traites', v_n);
end
$$;
revoke all on function public.rgpd_purge_decider(uuid, text, text) from public, anon;
grant execute on function public.rgpd_purge_decider(uuid, text, text) to authenticated;

-- ── Droits des tables ──
alter table public.rgpd_purge_regles enable row level security;
alter table public.rgpd_purge_passages enable row level security;
revoke all on table public.rgpd_purge_regles, public.rgpd_purge_passages from public, anon;
grant select, update on table public.rgpd_purge_regles to authenticated;
grant select on table public.rgpd_purge_passages to authenticated;
grant all on table public.rgpd_purge_regles, public.rgpd_purge_passages to service_role;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0344')) ──

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
           where schemaname = 'public' and tablename = any (array['rgpd_purge_passages', 'rgpd_purge_regles'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- rgpd_purge_passages
select pg_temp.regles(array['rgpd_purge_passages'], null,
  $r$company_id in (select app.societes_avec_droit('conformite.purges.valider'))$r$,
  null,
  null,
  null);

-- rgpd_purge_regles
select pg_temp.regles(array['rgpd_purge_regles'], null,
  $r$(company_id in (select app.societes_avec_droit('conformite.purges.valider')) or company_id in (select app.societes_avec_droit('conformite.rgpd.gerer')))$r$,
  null,
  $r$(company_id in (select app.societes_avec_droit('conformite.purges.valider')) or company_id in (select app.societes_avec_droit('conformite.rgpd.gerer')))$r$,
  null);

do $$
declare t text;
begin
  foreach t in array array['rgpd_purge_regles', 'rgpd_purge_passages'] loop
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

insert into public.schema_migrations (version) values ('0344_purges_rgpd') on conflict (version) do nothing;

-- ===== supabase/rollback/0344_purges_rgpd_retour.sql =====
-- Retour arrière de 0344_purges_rgpd.sql : retire les règles et passages de purge et leurs fonctions. Idempotent.
-- Refusé si un passage a été exécuté (les lignes purgées ne reviennent pas : le registre des passages est la preuve).

do $$
begin
  if to_regclass('public.rgpd_purge_passages') is not null and exists (select 1 from public.rgpd_purge_passages where statut = 'execute') then
    raise exception 'Retour arrière refusé : des purges ont été exécutées (le registre des passages doit être gardé)';
  end if;
end $$;

drop function if exists public.rgpd_purge_decider(uuid, text, text);
drop function if exists public.rgpd_purges_generer();
drop function if exists app.rgpd_purge_candidats(public.rgpd_purge_regles);
drop table if exists public.rgpd_purge_passages;
drop table if exists public.rgpd_purge_regles;
drop function if exists app.rgpd_purge_regles_maj();

-- Départ d'une nouvelle société : version de 0340
create or replace function app.societe_referentiels_depart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.subcontractor_doc_types_depart(new.id);
  if to_regprocedure('app.obligation_rules_depart(uuid)') is not null then
    execute 'select app.obligation_rules_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.commercial_lists_depart(uuid)') is not null then
    execute 'select app.commercial_lists_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_sous_traitants_depart(uuid)') is not null then
    execute 'select app.rgpd_sous_traitants_depart($1)' using new.id;
  end if;
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;
drop function if exists app.rgpd_purge_regles_depart(uuid);

delete from public.schema_migrations where version = '0344_purges_rgpd';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE f_0344 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

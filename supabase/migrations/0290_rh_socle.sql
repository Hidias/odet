-- 0290_rh_socle.sql : chantier 12, module RH, socle (spec odet-spec-rh.md § 2 à 4, branche rh/socle).
--
-- Personnes, contrats, équipes, horaires de référence, rémunérations. Le module « rh » reste coupé (org_modules) :
-- il s'active société par société, après la relecture de Léandra.
-- Choix (C1b, 18/10) : aucun rôle « rh » ni « salarie » ajouté à profiles.role ; les droits viennent des profils
-- « Ressources humaines » et « Salarié » (rôle de base « membre ») et des droits rh.* déjà au catalogue.
--
-- Droits (règles générées par regles.py, build_suite('0290'), et isolement par société) :
-- - annuaire (vue v_hr_annuaire : nom, emploi, équipe, téléphone et email professionnels) : « Voir le personnel » ;
-- - fiche complète et contrats : « Voir les dossiers du personnel », ou sa propre fiche (compte relié) ;
-- - écriture : « Tenir les dossiers du personnel » ; horaires : « Configurer les RH » ;
-- - rémunération : jamais lue directement sauf la sienne ; la RH la lit par hr_remuneration(), qui exige « Voir les
--   salaires » et écrit chaque consultation au journal d'audit ; écriture avec « Voir les salaires » et « Tenir les
--   dossiers ».
-- Minimisation (spec § 5) : aucun numéro de sécurité sociale, aucune donnée de santé ni de handicap, pas de situation
-- familiale au-delà du contact d'urgence.
-- Journal : personnes, contrats et rémunérations tracés par app.audit_row (champs modifiés, jamais les valeurs).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0290_rh_socle_retour.sql

create table if not exists public.hr_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  name text not null,
  days jsonb not null default '{"lun":[["08:30","12:30"],["13:30","17:30"]],"mar":[["08:30","12:30"],["13:30","17:30"]],"mer":[["08:30","12:30"],["13:30","17:30"]],"jeu":[["08:30","12:30"],["13:30","17:30"]],"ven":[["08:30","12:30"],["13:30","17:30"]]}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hr_schedules is 'Horaires de référence par société (par défaut du cahier : 8h30-12h30, 13h30-17h30)';

create table if not exists public.hr_people (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  usage_name text,
  birth_date date,
  personal_address text,
  personal_postal_code text,
  personal_city text,
  personal_phone text,
  personal_email text,
  work_phone text,
  work_email text,
  emergency_name text,
  emergency_relation text,
  emergency_phone text,
  photo_url text,
  profile_id uuid references public.profiles(id) on delete set null,
  trainer_id uuid references public.trainers(id) on delete set null,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_people_noms check (length(btrim(first_name)) > 0 and length(btrim(last_name)) > 0)
);
create unique index if not exists hr_people_profil_uniq on public.hr_people (company_id, profile_id) where profile_id is not null;
create index if not exists hr_people_company_idx on public.hr_people (company_id);
create index if not exists hr_people_profile_idx on public.hr_people (profile_id);
comment on table public.hr_people is 'Fiche personne du personnel (sans NIR, santé ni handicap) ; compte relié facultatif';

create table if not exists public.hr_teams (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  name text not null,
  manager_person_id uuid references public.hr_people(id) on delete set null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_teams_company_idx on public.hr_teams (company_id);

create table if not exists public.hr_employments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  person_id uuid not null references public.hr_people(id) on delete cascade,
  establishment_id uuid references public.company_establishments(id) on delete set null,
  contract_type text not null default 'cdi'
    check (contract_type in ('cdi', 'cdd', 'apprentissage', 'professionnalisation', 'stage', 'interim', 'mandataire', 'autre')),
  start_on date not null,
  end_on date,
  end_reason text,
  trial_end_on date,
  job_title text,
  job_description text,
  qualification text,
  team_id uuid references public.hr_teams(id) on delete set null,
  manager_person_id uuid references public.hr_people(id) on delete set null,
  weekly_hours numeric(5,2) check (weekly_hours is null or (weekly_hours > 0 and weekly_hours <= 60)),
  days_per_year int check (days_per_year is null or (days_per_year > 0 and days_per_year <= 366)),
  schedule_id uuid references public.hr_schedules(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_employments_dates check (end_on is null or end_on >= start_on)
);
create index if not exists hr_employments_company_idx on public.hr_employments (company_id);
create index if not exists hr_employments_person_idx on public.hr_employments (person_id);
comment on table public.hr_employments is 'Contrats : type, dates, emploi, équipe, responsable, temps de travail';

create table if not exists public.hr_compensation (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  employment_id uuid not null references public.hr_employments(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  period text not null default 'mensuel' check (period in ('horaire', 'mensuel', 'annuel')),
  effective_on date not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists hr_compensation_company_idx on public.hr_compensation (company_id);
create index if not exists hr_compensation_employment_idx on public.hr_compensation (employment_id);
comment on table public.hr_compensation is 'Rémunérations : lues par hr_remuneration() (consultation journalisée), ou la sienne';

-- Mise à jour : société et date de création figées
create or replace function app.hr_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then new.company_id := old.company_id; new.created_at := old.created_at; end if;
  if tg_table_name <> 'hr_compensation' then new.updated_at := now(); end if;
  return new;
end
$$;
revoke all on function app.hr_maj() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['hr_schedules', 'hr_people', 'hr_teams', 'hr_employments', 'hr_compensation'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_maj', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.hr_maj()', t || '_maj', t);
  end loop;
end $$;

-- Contrat et équipe : même société que la personne
create or replace function app.hr_meme_societe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'hr_employments' then
    if not exists (select 1 from public.hr_people p where p.id = new.person_id and p.company_id = new.company_id) then
      raise exception 'Contrat : la personne appartient à une autre société' using errcode = '23514';
    end if;
  elsif tg_table_name = 'hr_compensation' then
    if not exists (select 1 from public.hr_employments e where e.id = new.employment_id and e.company_id = new.company_id) then
      raise exception 'Rémunération : le contrat appartient à une autre société' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.hr_meme_societe() from public, anon, authenticated;
drop trigger if exists hr_employments_societe on public.hr_employments;
create trigger hr_employments_societe before insert or update on public.hr_employments for each row execute function app.hr_meme_societe();
drop trigger if exists hr_compensation_societe on public.hr_compensation;
create trigger hr_compensation_societe before insert or update on public.hr_compensation for each row execute function app.hr_meme_societe();

-- Fiches reliées au compte connecté (sa propre fiche), pour les règles
create or replace function app.hr_mes_personnes()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.hr_people p where p.profile_id = (select auth.uid())
$$;
revoke all on function app.hr_mes_personnes() from public, anon;
grant execute on function app.hr_mes_personnes() to authenticated;

-- Annuaire : seulement les champs professionnels, pour qui voit le personnel ; contrat en cours ou à venir
create or replace view public.v_hr_annuaire as
  select p.id, p.company_id, p.first_name, p.last_name, p.usage_name, p.work_phone, p.work_email, p.photo_url,
         e.job_title, e.contract_type, e.start_on, e.end_on, t.id as team_id, t.name as team,
         ce.name as establishment,
         case when e.id is null then 'sans_contrat'
              when e.start_on > current_date then 'a_venir'
              when e.end_on is not null and e.end_on < current_date then 'termine'
              else 'actif' end as statut
  from public.hr_people p
  left join lateral (
    select x.* from public.hr_employments x
    where x.person_id = p.id
    order by (x.end_on is null or x.end_on >= current_date) desc, x.start_on desc
    limit 1) e on true
  left join public.hr_teams t on t.id = e.team_id
  left join public.company_establishments ce on ce.id = e.establishment_id
  where p.archived_at is null
    and p.company_id in (select app.societes_avec_droit('rh.personnel.voir'));
comment on view public.v_hr_annuaire is 'Annuaire du personnel : champs professionnels seulement (droit « Voir le personnel »)';
revoke all on public.v_hr_annuaire from public, anon;
grant select on public.v_hr_annuaire to authenticated;

-- Rémunérations d'un contrat : « Voir les salaires » dans sa société (ou son propre contrat) ; chaque consultation
-- est écrite au journal d'audit (sans le montant)
create or replace function public.hr_remuneration(p_employment uuid)
returns setof public.hr_compensation
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
  v_person uuid;
begin
  select e.company_id, e.person_id into v_co, v_person from public.hr_employments e where e.id = p_employment;
  if v_co is null then
    raise exception 'Contrat introuvable' using errcode = 'P0002';
  end if;
  if not (v_co in (select app.societes_avec_droit('rh.salaires.voir')) or v_person in (select app.hr_mes_personnes())) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  insert into public.audit_logs (action, entity_type, entity_id, entity_name, details, company_id, source)
  values ('view', 'remuneration', p_employment, null, jsonb_build_object('table', 'hr_compensation'), v_co, 'base');
  return query select c.* from public.hr_compensation c where c.employment_id = p_employment order by c.effective_on desc;
end
$$;
revoke all on function public.hr_remuneration(uuid) from public, anon;
grant execute on function public.hr_remuneration(uuid) to authenticated;

-- Journal : personnes, contrats, rémunérations (champs modifiés, jamais les valeurs)
do $$
declare r record;
begin
  for r in select * from (values ('hr_people', 'personnel'), ('hr_employments', 'personnel'), ('hr_compensation', 'remuneration')) as t(nom, type) loop
    execute format('drop trigger if exists zz_audit_row on public.%I', r.nom);
    execute format('create trigger zz_audit_row after insert or update or delete on public.%I for each row execute function app.audit_row(%L)', r.nom, r.type);
  end loop;
end $$;

-- Horaire de référence par défaut pour chaque société (et chaque nouvelle)
create or replace function app.hr_horaires_depart(p_company uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.hr_schedules (company_id, name, is_default)
  select p_company, 'Horaire de référence (8h30-12h30, 13h30-17h30)', true
  where not exists (select 1 from public.hr_schedules s where s.company_id = p_company)
$$;
revoke all on function app.hr_horaires_depart(uuid) from public, anon, authenticated;
select app.hr_horaires_depart(c.id) from public.companies c;

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
  if to_regprocedure('app.cert_pitfalls_depart(uuid)') is not null then
    execute 'select app.cert_pitfalls_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_horaires_depart(uuid)') is not null then
    execute 'select app.hr_horaires_depart($1)' using new.id;
  end if;
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

-- ── Droits des tables ──
alter table public.hr_schedules enable row level security;
alter table public.hr_people enable row level security;
alter table public.hr_teams enable row level security;
alter table public.hr_employments enable row level security;
alter table public.hr_compensation enable row level security;
revoke all on table public.hr_schedules, public.hr_people, public.hr_teams, public.hr_employments, public.hr_compensation from public, anon;
grant select, insert, update, delete on table public.hr_schedules, public.hr_people, public.hr_teams, public.hr_employments, public.hr_compensation to authenticated;
grant all on table public.hr_schedules, public.hr_people, public.hr_teams, public.hr_employments, public.hr_compensation to service_role;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0290')) ──

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
           where schemaname = 'public' and tablename = any (array['hr_compensation', 'hr_employments', 'hr_people', 'hr_schedules', 'hr_teams'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- hr_compensation
select pg_temp.regles(array['hr_compensation'], null,
  $r$employment_id in (select e.id from public.hr_employments e where e.person_id in (select app.hr_mes_personnes()))$r$,
  $r$(company_id in (select app.societes_avec_droit('rh.salaires.voir')) and company_id in (select app.societes_avec_droit('rh.dossiers.gerer')))$r$,
  $r$(company_id in (select app.societes_avec_droit('rh.salaires.voir')) and company_id in (select app.societes_avec_droit('rh.dossiers.gerer')))$r$,
  $r$(company_id in (select app.societes_avec_droit('rh.salaires.voir')) and company_id in (select app.societes_avec_droit('rh.dossiers.gerer')))$r$);

-- hr_employments
select pg_temp.regles(array['hr_employments'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or person_id in (select app.hr_mes_personnes()))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$);

-- hr_people
select pg_temp.regles(array['hr_people'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or id in (select app.hr_mes_personnes()))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$);

-- hr_schedules
select pg_temp.regles(array['hr_schedules'], null,
  $r$company_id in (select app.societes_avec_droit('rh.personnel.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.parametres.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.parametres.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.parametres.gerer'))$r$);

-- hr_teams
select pg_temp.regles(array['hr_teams'], null,
  $r$company_id in (select app.societes_avec_droit('rh.personnel.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$);

do $$
declare t text;
begin
  foreach t in array array['hr_schedules', 'hr_people', 'hr_teams', 'hr_employments', 'hr_compensation'] loop
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

insert into public.schema_migrations (version) values ('0290_rh_socle') on conflict (version) do nothing;

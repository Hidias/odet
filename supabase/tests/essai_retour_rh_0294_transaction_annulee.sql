-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (rh_0294) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0294_rh_absences.sql, retour arrière,
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

-- ===== supabase/migrations/0294_rh_absences.sql =====
-- 0294_rh_absences.sql : chantier 12, module RH, absences (spec odet-spec-rh.md § 2 à 5, branche rh/absences).
--
-- Types d'absence par société (liste de départ, à confirmer par la RH), demandes, mouvements de solde, soldes calculés.
-- Une demande passe par le circuit de validation commun (approval_requests, périmètre « absence », C1b) : la décision
-- (approval_decide) met la demande à jour et, pour un type qui décompte un solde, écrit la prise dans le registre.
-- Toutes les écritures des demandes passent par des fonctions (hr_absence_demander, hr_absence_annuler) : aucune
-- écriture directe. Jours comptés en jours ouvrés (lundi au vendredi, demi-journées), jours fériés à venir
-- (calendrier par société) : « par défaut, à confirmer » (spec § 5).
-- Droits (build_suite('0294')) : demandes et soldes lus par la personne elle-même, ou avec « Voir les dossiers » ou
-- « Valider les absences » ; types lus avec « Voir le personnel », réglés avec « Configurer les RH » ; ajustements de
-- solde avec « Tenir les dossiers ». Le motif médical n'existe pas : seule la catégorie « maladie » du type.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0294_rh_absences_retour.sql

create table if not exists public.hr_absence_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  code text not null,
  label text not null,
  category text not null default 'autre' check (category in ('conges_payes', 'rtt', 'recuperation', 'autorisee', 'maladie',
    'accident_travail', 'evenement_familial', 'sans_solde', 'autre')),
  half_days boolean not null default true,
  requires_proof boolean not null default false,
  counts_balance boolean not null default false,
  employee_can_request boolean not null default true,
  is_active boolean not null default true,
  position int not null default 0,
  to_confirm boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);
comment on table public.hr_absence_types is 'Types d''absence par société ; liste de départ marquée « à confirmer »';

create table if not exists public.hr_absence_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  person_id uuid not null references public.hr_people(id) on delete cascade,
  type_id uuid not null references public.hr_absence_types(id),
  start_on date not null,
  start_half text check (start_half is null or start_half = 'apres_midi'),
  end_on date not null,
  end_half text check (end_half is null or end_half = 'matin'),
  days numeric(6,1) not null,
  comment text,
  status text not null default 'demandee' check (status in ('demandee', 'validee', 'refusee', 'annulee')),
  approval_id uuid references public.approval_requests(id) on delete set null,
  requested_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  refusal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_absence_dates check (end_on >= start_on and (end_on > start_on or start_half is null or end_half is null))
);
create index if not exists hr_absence_requests_company_idx on public.hr_absence_requests (company_id);
create index if not exists hr_absence_requests_person_idx on public.hr_absence_requests (person_id, start_on);

create table if not exists public.hr_leave_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  person_id uuid not null references public.hr_people(id) on delete cascade,
  type_id uuid not null references public.hr_absence_types(id),
  kind text not null check (kind in ('acquisition', 'prise', 'ajustement', 'report', 'annulation')),
  days numeric(6,1) not null,
  period_label text,
  note text,
  request_id uuid references public.hr_absence_requests(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists hr_leave_ledger_company_idx on public.hr_leave_ledger (company_id);
create index if not exists hr_leave_ledger_person_idx on public.hr_leave_ledger (person_id, type_id);
comment on table public.hr_leave_ledger is 'Mouvements de solde (le solde est calculé, jamais saisi)';

-- Soldes : somme des mouvements (droits de la table appliqués : vue à droits de l'appelant)
create or replace view public.v_hr_soldes with (security_invoker = true) as
  select l.company_id, l.person_id, l.type_id, sum(l.days) as solde,
         sum(l.days) filter (where l.kind = 'acquisition') as acquis,
         -sum(l.days) filter (where l.kind = 'prise') as pris
  from public.hr_leave_ledger l
  group by l.company_id, l.person_id, l.type_id;
revoke all on public.v_hr_soldes from public, anon;
grant select on public.v_hr_soldes to authenticated;

-- Jours ouvrés entre deux dates (lundi au vendredi), demi-journées de début (après-midi) et de fin (matin)
create or replace function app.hr_jours_ouvres(p_debut date, p_debut_demi text, p_fin date, p_fin_demi text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select greatest(0, (select count(*) from generate_series(p_debut, p_fin, interval '1 day') d
                      where extract(isodow from d) < 6)
         - case when p_debut_demi = 'apres_midi' and extract(isodow from p_debut) < 6 then 0.5 else 0 end
         - case when p_fin_demi = 'matin' and extract(isodow from p_fin) < 6 then 0.5 else 0 end)::numeric
$$;
revoke all on function app.hr_jours_ouvres(date, text, date, text) from public, anon;
grant execute on function app.hr_jours_ouvres(date, text, date, text) to authenticated;

create or replace function app.hr_abs_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then new.company_id := old.company_id; new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.hr_abs_maj() from public, anon, authenticated;
drop trigger if exists hr_absence_types_maj on public.hr_absence_types;
create trigger hr_absence_types_maj before insert or update on public.hr_absence_types for each row execute function app.hr_abs_maj();
drop trigger if exists hr_absence_requests_maj on public.hr_absence_requests;
create trigger hr_absence_requests_maj before insert or update on public.hr_absence_requests for each row execute function app.hr_abs_maj();

-- Mouvement de solde : personne et type de la même société
create or replace function app.hr_mouvement_societe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.hr_people p where p.id = new.person_id and p.company_id = new.company_id)
     or not exists (select 1 from public.hr_absence_types t where t.id = new.type_id and t.company_id = new.company_id) then
    raise exception 'Solde : la personne ou le type appartient à une autre société' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function app.hr_mouvement_societe() from public, anon, authenticated;
drop trigger if exists hr_leave_ledger_societe on public.hr_leave_ledger;
create trigger hr_leave_ledger_societe before insert or update on public.hr_leave_ledger for each row execute function app.hr_mouvement_societe();

-- Demander une absence (pour soi, ou pour une personne de la société avec « Tenir les dossiers »)
create or replace function public.hr_absence_demander(p_type uuid, p_debut date, p_debut_demi text, p_fin date,
  p_fin_demi text, p_commentaire text default null, p_personne uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid := app.current_company();
  v_pers uuid;
  v_type public.hr_absence_types;
  v_jours numeric;
  v_id uuid;
  v_appro uuid;
begin
  if v_co is null then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if p_personne is null then
    select p.id into v_pers from public.hr_people p where p.profile_id = (select auth.uid()) and p.company_id = v_co and p.archived_at is null;
    if v_pers is null then raise exception 'Aucune fiche du personnel reliée à votre compte' using errcode = 'P0002'; end if;
    if not app.a_le_droit('rh.absences.demander') and not app.a_le_droit('rh.dossiers.gerer') then
      raise exception 'Accès refusé' using errcode = '42501';
    end if;
  else
    select p.id into v_pers from public.hr_people p where p.id = p_personne and p.company_id = v_co;
    if v_pers is null then raise exception 'Personne introuvable' using errcode = 'P0002'; end if;
    if not (v_pers in (select app.hr_mes_personnes()) and app.a_le_droit('rh.absences.demander')) and not app.a_le_droit('rh.dossiers.gerer') then
      raise exception 'Accès refusé' using errcode = '42501';
    end if;
  end if;
  select * into v_type from public.hr_absence_types t where t.id = p_type and t.company_id = v_co and t.is_active;
  if v_type.id is null then raise exception 'Type d''absence inconnu' using errcode = 'P0002'; end if;
  if not v_type.employee_can_request and not app.a_le_droit('rh.dossiers.gerer') then
    raise exception 'Ce type d''absence est saisi par la RH' using errcode = '42501';
  end if;
  if p_fin < p_debut then raise exception 'La fin est avant le début' using errcode = '22023'; end if;
  if not v_type.half_days and (p_debut_demi is not null or p_fin_demi is not null) then
    raise exception 'Ce type d''absence se prend par journées entières' using errcode = '22023';
  end if;
  if exists (select 1 from public.hr_absence_requests r where r.person_id = v_pers and r.status in ('demandee', 'validee')
             and daterange(r.start_on, r.end_on, '[]') && daterange(p_debut, p_fin, '[]')) then
    raise exception 'Une demande couvre déjà une partie de ces dates' using errcode = '23505';
  end if;
  v_jours := app.hr_jours_ouvres(p_debut, p_debut_demi, p_fin, p_fin_demi);
  if v_jours <= 0 then raise exception 'Aucun jour ouvré dans cette période' using errcode = '22023'; end if;
  insert into public.hr_absence_requests (company_id, person_id, type_id, start_on, start_half, end_on, end_half, days, comment, requested_by)
  values (v_co, v_pers, v_type.id, p_debut, p_debut_demi, p_fin, p_fin_demi, v_jours, nullif(btrim(coalesce(p_commentaire, '')), ''), (select auth.uid()))
  returning id into v_id;
  v_appro := public.approval_submit('absence', 'hr_absence_requests', v_id, null, null,
    left(v_type.label || ' du ' || to_char(p_debut, 'DD/MM/YYYY') || ' au ' || to_char(p_fin, 'DD/MM/YYYY'), 200));
  if v_appro is null then
    -- Aucune validation demandée par la société : validée tout de suite
    perform app.hr_absence_appliquer(v_id, 'validee', null, null);
  else
    update public.hr_absence_requests set approval_id = v_appro where id = v_id;
  end if;
  return v_id;
end
$$;
revoke all on function public.hr_absence_demander(uuid, date, text, date, text, text, uuid) from public, anon;
grant execute on function public.hr_absence_demander(uuid, date, text, date, text, text, uuid) to authenticated;

-- Effet d'une décision : statut, et mouvement de solde (prise, ou annulation d'une prise validée)
create or replace function app.hr_absence_appliquer(p_req uuid, p_statut text, p_par uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.hr_absence_requests;
  v_compte boolean;
begin
  select * into r from public.hr_absence_requests where id = p_req for update;
  if r.id is null or r.status = p_statut then return; end if;
  select t.counts_balance into v_compte from public.hr_absence_types t where t.id = r.type_id;
  update public.hr_absence_requests set status = p_statut, decided_by = p_par, decided_at = now(),
    refusal_reason = case when p_statut = 'refusee' then p_motif else refusal_reason end
  where id = r.id;
  if v_compte and p_statut = 'validee' then
    insert into public.hr_leave_ledger (company_id, person_id, type_id, kind, days, request_id, created_by, note)
    values (r.company_id, r.person_id, r.type_id, 'prise', -r.days, r.id, p_par, 'Demande validée');
  elsif v_compte and p_statut = 'annulee' and r.status = 'validee' then
    insert into public.hr_leave_ledger (company_id, person_id, type_id, kind, days, request_id, created_by, note)
    values (r.company_id, r.person_id, r.type_id, 'annulation', r.days, r.id, p_par, 'Absence validée puis annulée');
  end if;
end
$$;
revoke all on function app.hr_absence_appliquer(uuid, text, uuid, text) from public, anon, authenticated;

-- Décision prise dans le circuit commun (approval_decide) : reportée sur la demande
create or replace function app.hr_absence_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.object_table = 'hr_absence_requests' and new.status is distinct from old.status then
    if new.status = 'approved' then
      perform app.hr_absence_appliquer(new.object_id, 'validee', new.decided_by, null);
    elsif new.status = 'rejected' then
      perform app.hr_absence_appliquer(new.object_id, 'refusee', new.decided_by, new.decision_comment);
    elsif new.status = 'cancelled' then
      perform app.hr_absence_appliquer(new.object_id, 'annulee', (select auth.uid()), null);
    end if;
  end if;
  return null;
end
$$;
revoke all on function app.hr_absence_decision() from public, anon, authenticated;
drop trigger if exists hr_absence_decision on public.approval_requests;
create trigger hr_absence_decision after update of status on public.approval_requests
  for each row execute function app.hr_absence_decision();

-- Annuler sa demande (en attente, ou validée et pas encore commencée) ; la RH peut annuler toute demande
create or replace function public.hr_absence_annuler(p_req uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.hr_absence_requests;
begin
  select * into r from public.hr_absence_requests where id = p_req;
  if r.id is null then raise exception 'Demande introuvable' using errcode = 'P0002'; end if;
  if not ((r.person_id in (select app.hr_mes_personnes()) and r.status = 'demandee')
          or (r.person_id in (select app.hr_mes_personnes()) and r.status = 'validee' and r.start_on > current_date)
          or r.company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if r.status not in ('demandee', 'validee') then raise exception 'Demande déjà close' using errcode = '22023'; end if;
  if r.approval_id is not null and r.status = 'demandee' then
    update public.approval_requests set status = 'cancelled', updated_at = now(),
      history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', (select auth.uid()), 'action', 'cancelled'))
    where id = r.approval_id and status = 'pending';
  end if;
  perform app.hr_absence_appliquer(r.id, 'annulee', (select auth.uid()), null);
  return 'annulee';
end
$$;
revoke all on function public.hr_absence_annuler(uuid) from public, anon;
grant execute on function public.hr_absence_annuler(uuid) to authenticated;

-- Liste de départ des types (à confirmer par la RH ou l'expert-comptable de la société)
create or replace function app.hr_types_absence_depart(p_company uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.hr_absence_types (company_id, code, label, category, half_days, requires_proof, counts_balance, employee_can_request, position)
  select p_company, d.code, d.label, d.cat, d.demi, d.justif, d.solde, d.salarie, d.pos
  from (values
    ('CP', 'Congés payés', 'conges_payes', true, false, true, true, 1),
    ('RTT', 'RTT', 'rtt', true, false, true, true, 2),
    ('RECUP', 'Récupération', 'recuperation', true, false, true, true, 3),
    ('AUTORISEE', 'Absence autorisée', 'autorisee', true, false, false, true, 4),
    ('FAMILLE', 'Événement familial', 'evenement_familial', false, true, false, true, 5),
    ('SANS_SOLDE', 'Congé sans solde', 'sans_solde', false, false, false, true, 6),
    ('MALADIE', 'Arrêt maladie', 'maladie', false, true, false, false, 7),
    ('AT', 'Accident du travail', 'accident_travail', false, true, false, false, 8)
  ) as d(code, label, cat, demi, justif, solde, salarie, pos)
  on conflict (company_id, code) do nothing
$$;
revoke all on function app.hr_types_absence_depart(uuid) from public, anon, authenticated;
select app.hr_types_absence_depart(c.id) from public.companies c;

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
  if to_regprocedure('app.hr_types_absence_depart(uuid)') is not null then
    execute 'select app.hr_types_absence_depart($1)' using new.id;
  end if;
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

-- Journal : demandes et mouvements de solde (champs, jamais les valeurs)
do $$
declare r record;
begin
  for r in select * from (values ('hr_absence_requests', 'absence'), ('hr_leave_ledger', 'absence')) as t(nom, type) loop
    execute format('drop trigger if exists zz_audit_row on public.%I', r.nom);
    execute format('create trigger zz_audit_row after insert or update or delete on public.%I for each row execute function app.audit_row(%L)', r.nom, r.type);
  end loop;
end $$;

-- ── Droits des tables ──
alter table public.hr_absence_types enable row level security;
alter table public.hr_absence_requests enable row level security;
alter table public.hr_leave_ledger enable row level security;
revoke all on table public.hr_absence_types, public.hr_absence_requests, public.hr_leave_ledger from public, anon;
grant select, insert, update, delete on table public.hr_absence_types, public.hr_absence_requests, public.hr_leave_ledger to authenticated;
grant all on table public.hr_absence_types, public.hr_absence_requests, public.hr_leave_ledger to service_role;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0294')) ──

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
           where schemaname = 'public' and tablename = any (array['hr_absence_requests', 'hr_absence_types', 'hr_leave_ledger'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- hr_absence_requests
select pg_temp.regles(array['hr_absence_requests'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or company_id in (select app.societes_avec_droit('rh.absences.valider')) or person_id in (select app.hr_mes_personnes()))$r$,
  null,
  null,
  null);

-- hr_absence_types
select pg_temp.regles(array['hr_absence_types'], null,
  $r$company_id in (select app.societes_avec_droit('rh.personnel.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.parametres.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.parametres.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.parametres.gerer'))$r$);

-- hr_leave_ledger
select pg_temp.regles(array['hr_leave_ledger'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or company_id in (select app.societes_avec_droit('rh.absences.valider')) or person_id in (select app.hr_mes_personnes()))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$);

do $$
declare t text;
begin
  foreach t in array array['hr_absence_types', 'hr_absence_requests', 'hr_leave_ledger'] loop
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

insert into public.schema_migrations (version) values ('0294_rh_absences') on conflict (version) do nothing;

-- ===== supabase/rollback/0294_rh_absences_retour.sql =====
-- Retour arrière de 0294_rh_absences.sql : retire les absences, les soldes et leurs fonctions. Idempotent.
-- Refusé si des demandes ou des mouvements de solde existent (données du personnel : à exporter d'abord).

do $$
begin
  if (to_regclass('public.hr_absence_requests') is not null and exists (select 1 from public.hr_absence_requests))
     or (to_regclass('public.hr_leave_ledger') is not null and exists (select 1 from public.hr_leave_ledger)) then
    raise exception 'Retour arrière refusé : des absences ou des mouvements de solde existent (à exporter d''abord)';
  end if;
end $$;

-- Départ d'une nouvelle société : version de 0290
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
drop function if exists app.hr_types_absence_depart(uuid);

drop trigger if exists hr_absence_decision on public.approval_requests;
drop function if exists app.hr_absence_decision();
drop function if exists public.hr_absence_annuler(uuid);
drop function if exists public.hr_absence_demander(uuid, date, text, date, text, text, uuid);
drop function if exists app.hr_absence_appliquer(uuid, text, uuid, text);
drop view if exists public.v_hr_soldes;
delete from public.approval_requests where object_table = 'hr_absence_requests';
drop table if exists public.hr_leave_ledger;
drop table if exists public.hr_absence_requests;
drop table if exists public.hr_absence_types;
drop function if exists app.hr_abs_maj();
drop function if exists app.hr_mouvement_societe();
drop function if exists app.hr_jours_ouvres(date, text, date, text);

delete from public.schema_migrations where version = '0294_rh_absences';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE rh_0294 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

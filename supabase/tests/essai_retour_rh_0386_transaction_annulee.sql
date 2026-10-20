-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (rh_0386) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0386_rh_affectation.sql, retour arrière,
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

-- ===== supabase/migrations/0386_rh_affectation.sql =====
-- 0386_rh_affectation.sql : contrôle d'affectation, inaptitude, attestation de non contre-indication (audit du 19/10).
--
-- Décisions de H (19/10, 22h50) : bloquer une affectation quand un titre ou une aptitude manque, ou qu'une consigne
-- médicale l'interdit ; seule la direction lève le blocage, avec un motif, et c'est tracé. Inaptitude : alerte,
-- suspension des titres, échéance à un mois, visite de reprise.
--
--   1. Attestation de non contre-indication médicale (depuis le 01/10/2025, articles R4323-56 et R4544-10 du code du
--      travail) : nouveau type de visite « non_contre_indication », valable 5 ans, pour la conduite d'engins et/ou
--      l'habilitation électrique (colonne nci_scope).
--   2. Consignes de travail (hr_work_restrictions) : ce que la personne ne doit pas faire, sans aucun motif médical
--      (hauteur, charges, électricité, conduite, travail isolé, nuit, autre), avec leurs dates. Lues par la RH et par
--      qui planifie les interventions.
--   3. Inaptitude : un avis « inapte » suspend d'office les habilitations électriques et autorisations de conduite de la
--      personne et prévient la RH ; l'échéance d'un mois (reclassement ou licenciement, sinon reprise du salaire,
--      articles L1226-4 et L1226-11) et les visites de reprise dues après un arrêt de 30 jours ou plus (article R4624-31)
--      sont listées par la vue v_hr_vigilance.
--   4. Titres : symboles ou catégories (B0, H0V, BR, BS, BE manœuvre… ; R489 1A, 3, 5…), périmètre, suspension.
--   5. Contrôle d'affectation d'une visite d'intervention : le technicien doit être apte, présent, sans consigne qui
--      interdit le travail, et détenir les titres exigés par le matériel du site (règles par famille d'appareils,
--      assignment_requirements), valides le jour de la visite, avec l'attestation de non contre-indication quand le
--      titre l'exige ; un mineur sans dérogation ne peut pas recevoir ces travaux. Sinon l'affectation est refusée avec
--      ses raisons, sauf levée par la direction (affectation_lever, motif obligatoire, tracée dans assignment_overrides
--      et le journal d'audit). Sans fiche du personnel reliée au compte, ou sans module RH, rien n'est bloqué.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0386_rh_affectation_retour.sql

-- 1. Attestation de non contre-indication
alter table public.hr_medical_followups drop constraint if exists hr_medical_followups_visit_type_check;
alter table public.hr_medical_followups add constraint hr_medical_followups_visit_type_check
  check (visit_type in ('information_prevention', 'embauche', 'periodique', 'reprise', 'prereprise', 'mi_carriere', 'demande',
                        'non_contre_indication'));
alter table public.hr_medical_followups add column if not exists nci_scope text[]
  check (nci_scope is null or nci_scope <@ array['conduite', 'electrique']::text[]);
alter table public.hr_medical_followups add column if not exists inaptitude_outcome text
  check (inaptitude_outcome is null or inaptitude_outcome in ('reclassement', 'licenciement', 'reprise_salaire', 'autre'));
alter table public.hr_medical_followups add column if not exists inaptitude_closed_on date;
comment on column public.hr_medical_followups.nci_scope is 'Attestation de non contre-indication : conduite d''engins, habilitation électrique (validité 5 ans, next_due_on)';

-- 4. Titres : symboles, périmètre, suspension
alter table public.hr_qualifications add column if not exists symbols text[];
alter table public.hr_qualifications add column if not exists scope text;
alter table public.hr_qualifications add column if not exists suspended_at timestamptz;
alter table public.hr_qualifications add column if not exists suspended_reason text;
comment on column public.hr_qualifications.symbols is 'Symboles d''habilitation (B0, H0V, BR, BS, BE manœuvre…) ou catégories de conduite (R489 1A, 3, 5…)';

-- Dérogation des jeunes travailleurs (articles D4153-15 et suivants) : date de fin de la dérogation déclarée
alter table public.hr_people add column if not exists minor_derogation_until date;

-- 2. Consignes de travail, sans motif médical
create table if not exists public.hr_work_restrictions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  person_id uuid not null references public.hr_people(id) on delete cascade,
  kind text not null check (kind in ('hauteur', 'charges', 'electrique', 'conduite', 'travail_isole', 'nuit', 'autre')),
  label text check (label is null or length(label) <= 200),
  starts_on date not null default current_date,
  ends_on date,
  medical_followup_id uuid references public.hr_medical_followups(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_work_restrictions_dates check (ends_on is null or ends_on >= starts_on)
);
create index if not exists hr_work_restrictions_person_idx on public.hr_work_restrictions (person_id);
create index if not exists hr_work_restrictions_company_idx on public.hr_work_restrictions (company_id);
comment on table public.hr_work_restrictions is 'Consignes de travail du service de santé au travail, sans aucun élément médical';

-- 5. Règles d'affectation par famille d'appareils
create table if not exists public.assignment_requirements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  equipment_family text not null,
  required_kind text check (required_kind is null or required_kind in ('habilitation_electrique', 'autorisation_conduite', 'sst', 'incendie', 'apsad', 'permis', 'autre')),
  required_symbols text[],
  forbidden_restriction text check (forbidden_restriction is null or forbidden_restriction in ('hauteur', 'charges', 'electrique', 'conduite', 'travail_isole', 'nuit', 'autre')),
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint assignment_requirements_objet check (required_kind is not null or forbidden_restriction is not null)
);
create index if not exists assignment_requirements_company_idx on public.assignment_requirements (company_id);
comment on table public.assignment_requirements is 'Titres exigés et consignes bloquantes pour intervenir sur une famille d''appareils';

-- Levées de blocage par la direction
create table if not exists public.assignment_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  object_table text not null check (object_table in ('itv_visits')),
  object_id uuid not null,
  profile_id uuid not null,
  reasons text[] not null,
  motif text not null check (length(btrim(motif)) >= 5),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists assignment_overrides_obj_idx on public.assignment_overrides (object_table, object_id, profile_id);
comment on table public.assignment_overrides is 'Affectations refusées puis autorisées par la direction, avec le motif';

-- Règles de départ pour chaque société : électricité pour l'éclairage de sécurité et l'alarme, hauteur pour le désenfumage
create or replace function app.affectation_regles_depart(p_company uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.assignment_requirements (company_id, equipment_family, required_kind, required_symbols, forbidden_restriction, label)
  select p_company, d.fam, d.kind, d.sym, d.restr, d.label
  from (values
    ('Éclairage de sécurité', 'habilitation_electrique', array['BS', 'BR', 'BE manœuvre', 'B1V', 'B2V'], 'electrique', 'Éclairage de sécurité : habilitation électrique (BS, BE manœuvre, BR ou B1V)'),
    ('Alarme', 'habilitation_electrique', array['BS', 'BR', 'BE manœuvre', 'B1V', 'B2V'], 'electrique', 'Alarme incendie : habilitation électrique (BS, BE manœuvre, BR ou B1V)'),
    ('Désenfumage', null, null, 'hauteur', 'Désenfumage : travail en hauteur')
  ) as d(fam, kind, sym, restr, label)
  where not exists (select 1 from public.assignment_requirements r where r.company_id = p_company and r.equipment_family = d.fam)
$$;
revoke all on function app.affectation_regles_depart(uuid) from public, anon, authenticated;
select app.affectation_regles_depart(c.id) from public.companies c;

-- Raisons qui empêchent d'affecter un compte à une visite ce jour-là (vide : rien ne s'y oppose)
create or replace function app.affectation_motifs(p_visit uuid, p_profile uuid, p_date date)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_co uuid;
  v_site uuid;
  p public.hr_people;
  v_age int;
  v_motifs text[] := '{}';
  r record;
  v_ok boolean;
  v_date date := coalesce(p_date, current_date);
begin
  if p_profile is null then return v_motifs; end if;
  select v.company_id, v.site_id into v_co, v_site from public.itv_visits v where v.id = p_visit;
  if v_co is null then
    v_co := app.company_default();
  end if;
  -- Sans module RH ou sans fiche reliée au compte : aucun contrôle possible, rien n'est bloqué
  if not exists (select 1 from public.company_modules cm where cm.company_id = v_co and cm.key = 'rh' and cm.enabled) then
    return v_motifs;
  end if;
  select * into p from public.hr_people h where h.profile_id = p_profile and h.company_id = v_co and h.archived_at is null limit 1;
  if p.id is null then return v_motifs; end if;

  -- Avis d'inaptitude en cours
  if exists (select 1 from public.hr_medical_followups m where m.person_id = p.id and m.conclusion = 'inapte'
             and m.inaptitude_closed_on is null and coalesce(m.visit_on, current_date) <= v_date
             and not exists (select 1 from public.hr_medical_followups m2 where m2.person_id = p.id
                             and m2.conclusion in ('apte', 'apte_amenagements') and m2.visit_on > coalesce(m.visit_on, '-infinity'::date))) then
    v_motifs := v_motifs || 'avis d''inaptitude en cours'::text;
  end if;

  -- Absence validée ce jour-là
  if exists (select 1 from public.hr_absence_requests a where a.person_id = p.id and a.status = 'validee'
             and v_date between a.start_on and a.end_on) then
    v_motifs := v_motifs || 'absent ce jour-là (absence validée)'::text;
  end if;

  -- Titres et consignes exigés par le matériel du site
  for r in
    select distinct q.* from public.assignment_requirements q
    where q.company_id = v_co and q.is_active
      and exists (select 1 from public.itv_equipment e join public.itv_equipment_types t on t.id = e.type_id
                  where e.site_id = v_site and t.family = q.equipment_family)
  loop
    if r.forbidden_restriction is not null and exists (
         select 1 from public.hr_work_restrictions w where w.person_id = p.id and w.kind = r.forbidden_restriction
         and v_date >= w.starts_on and (w.ends_on is null or v_date <= w.ends_on)) then
      v_motifs := v_motifs || (r.equipment_family || ' : consigne de travail contraire (' ||
        case r.forbidden_restriction when 'hauteur' then 'pas de travail en hauteur' when 'charges' then 'pas de port de charges'
          when 'electrique' then 'pas de travaux électriques' when 'conduite' then 'pas de conduite' when 'travail_isole' then 'pas de travail isolé'
          when 'nuit' then 'pas de travail de nuit' else 'consigne particulière' end || ')')::text;
    end if;
    if r.required_kind is not null then
      select exists (
        select 1 from public.hr_qualifications h
        where h.person_id = p.id and h.kind = r.required_kind and h.archived_at is null and h.suspended_at is null
          and (h.expires_on is null or h.expires_on >= v_date)
          and (r.required_symbols is null or h.symbols && r.required_symbols
               or exists (select 1 from unnest(r.required_symbols) s where h.label ilike '%' || s || '%')))
        into v_ok;
      if not v_ok then
        v_motifs := v_motifs || (r.label || ' : titre absent, échu ou suspendu')::text;
      elsif r.required_kind in ('habilitation_electrique', 'autorisation_conduite') and not exists (
          select 1 from public.hr_medical_followups m where m.person_id = p.id and m.visit_type = 'non_contre_indication'
          and (case r.required_kind when 'habilitation_electrique' then 'electrique' else 'conduite' end) = any (coalesce(m.nci_scope, '{}'))
          and coalesce(m.next_due_on, m.visit_on + interval '5 years') >= v_date) then
        v_motifs := v_motifs || (r.equipment_family || ' : attestation de non contre-indication médicale absente ou échue')::text;
      end if;
      -- Jeune travailleur : travaux électriques et conduite interdits sans dérogation en cours
      if p.birth_date is not null then
        v_age := extract(year from age(v_date, p.birth_date));
        if v_age < 18 and r.required_kind in ('habilitation_electrique', 'autorisation_conduite')
           and (p.minor_derogation_until is null or p.minor_derogation_until < v_date) then
          v_motifs := v_motifs || (r.equipment_family || ' : travaux interdits à un mineur sans dérogation en cours')::text;
        end if;
      end if;
    end if;
  end loop;
  return v_motifs;
end
$$;
revoke all on function app.affectation_motifs(uuid, uuid, date) from public, anon, authenticated;

-- Vérification avant d'enregistrer (écran du planning) : les raisons, et si une levée existe déjà
create or replace function public.affectation_verifier(p_visit uuid, p_profile uuid, p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_motifs text[];
begin
  if not app.a_le_droit('interventions.visites.gerer') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  v_motifs := app.affectation_motifs(p_visit, p_profile, p_date);
  return jsonb_build_object('motifs', to_jsonb(v_motifs),
    'levee', exists (select 1 from public.assignment_overrides o where o.object_table = 'itv_visits' and o.object_id = p_visit and o.profile_id = p_profile),
    'peut_lever', app.company_role() in ('superadmin', 'admin', 'direction'));
end
$$;
revoke all on function public.affectation_verifier(uuid, uuid, date) from public, anon;
grant execute on function public.affectation_verifier(uuid, uuid, date) to authenticated;

-- Levée du blocage par la direction, motif obligatoire, tracée
create or replace function public.affectation_lever(p_visit uuid, p_profile uuid, p_motif text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
  v_id uuid;
  v_motifs text[];
begin
  select v.company_id into v_co from public.itv_visits v where v.id = p_visit;
  if v_co is null then raise exception 'Visite introuvable' using errcode = 'P0002'; end if;
  if coalesce(app.company_role(v_co), '') not in ('superadmin', 'admin', 'direction') then
    raise exception 'Seule la direction lève un blocage d''affectation' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motif, ''))) < 5 then
    raise exception 'Motif obligatoire (5 caractères au moins)' using errcode = '22023';
  end if;
  v_motifs := app.affectation_motifs(p_visit, p_profile, (select v.planned_on from public.itv_visits v where v.id = p_visit));
  insert into public.assignment_overrides (company_id, object_table, object_id, profile_id, reasons, motif)
  values (v_co, 'itv_visits', p_visit, p_profile, coalesce(v_motifs, '{}'), btrim(p_motif))
  returning id into v_id;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'document', p_visit, 'Affectation autorisée malgré un blocage',
          jsonb_build_object('profil', p_profile, 'raisons', v_motifs, 'motif', btrim(p_motif)));
  return v_id;
end
$$;
revoke all on function public.affectation_lever(uuid, uuid, text) from public, anon;
grant execute on function public.affectation_lever(uuid, uuid, text) to authenticated;

-- Garde en base : affectation refusée avec ses raisons, sauf levée (écritures du système non concernées)
create or replace function app.affectation_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motifs text[];
begin
  if (select auth.uid()) is null or new.technician_id is null or new.status in ('terminee', 'annulee') then return new; end if;
  if tg_op = 'UPDATE' and new.technician_id is not distinct from old.technician_id
     and new.planned_on is not distinct from old.planned_on and new.site_id is not distinct from old.site_id then
    return new;
  end if;
  v_motifs := app.affectation_motifs(new.id, new.technician_id, new.planned_on);
  if cardinality(v_motifs) > 0 and not exists (
       select 1 from public.assignment_overrides o where o.object_table = 'itv_visits' and o.object_id = new.id
       and o.profile_id = new.technician_id) then
    raise exception 'Affectation refusée : %', array_to_string(v_motifs, ' ; ')
      using errcode = 'check_violation', hint = 'La direction peut lever le blocage avec un motif.';
  end if;
  return new;
end
$$;
revoke all on function app.affectation_garde() from public, anon, authenticated;
drop trigger if exists itv_visits_affectation_garde on public.itv_visits;
create trigger itv_visits_affectation_garde before insert or update of technician_id, planned_on, site_id on public.itv_visits
  for each row execute function app.affectation_garde();

-- 3. Inaptitude : suspension des titres et alerte de la RH
create or replace function app.hr_inaptitude_suite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nom text;
begin
  if new.conclusion = 'inapte' and (tg_op = 'INSERT' or old.conclusion is distinct from 'inapte') then
    update public.hr_qualifications q
    set suspended_at = now(), suspended_reason = 'Avis d''inaptitude du ' || to_char(coalesce(new.visit_on, current_date), 'DD/MM/YYYY')
    where q.person_id = new.person_id and q.archived_at is null and q.suspended_at is null
      and q.kind in ('habilitation_electrique', 'autorisation_conduite');
    select h.first_name || ' ' || h.last_name into v_nom from public.hr_people h where h.id = new.person_id;
    begin
      insert into public.notifications (type, title, message, link, metadata)
      values ('rh_inaptitude', 'Avis d''inaptitude : ' || coalesce(v_nom, 'une personne'),
              'Titres suspendus. Reclassement ou licenciement à décider avant le '
                || to_char(coalesce(new.visit_on, current_date) + interval '1 month', 'DD/MM/YYYY')
                || ' ; à défaut, le salaire reprend (article L1226-4).',
              '/collaborateurs/' || new.person_id, jsonb_build_object('person_id', new.person_id, 'company_id', new.company_id));
    exception when others then null; -- l'alerte ne doit jamais empêcher l'enregistrement
    end;
  end if;
  return new;
end
$$;
revoke all on function app.hr_inaptitude_suite() from public, anon, authenticated;
drop trigger if exists hr_medical_followups_inaptitude on public.hr_medical_followups;
create trigger hr_medical_followups_inaptitude after insert or update of conclusion on public.hr_medical_followups
  for each row execute function app.hr_inaptitude_suite();

-- Vigilance RH : inaptitudes à traiter (échéance d'un mois) et visites de reprise dues (arrêt de 30 jours ou plus)
create or replace view public.v_hr_vigilance
with (security_invoker = true)
as
select m.company_id, m.person_id, 'inaptitude'::text as kind,
       coalesce(m.visit_on, m.created_at::date) as depuis,
       (coalesce(m.visit_on, m.created_at::date) + interval '1 month')::date as echeance,
       'Reclassement ou licenciement à décider ; à défaut, reprise du salaire'::text as libelle
from public.hr_medical_followups m
where m.conclusion = 'inapte' and m.inaptitude_closed_on is null
union all
select a.company_id, a.person_id, 'visite_reprise'::text,
       a.end_on + 1, (a.end_on + 8)::date,
       'Visite de reprise à organiser dans les 8 jours qui suivent le retour'::text
from public.hr_absence_requests a
join public.hr_absence_types t on t.id = a.type_id
where a.status = 'validee' and t.category in ('maladie', 'accident_travail') and (a.end_on - a.start_on + 1) >= 30
  and a.end_on >= current_date - 60
  and not exists (select 1 from public.hr_medical_followups m where m.person_id = a.person_id and m.visit_type = 'reprise'
                  and m.visit_on >= a.end_on);
grant select on public.v_hr_vigilance to authenticated;

-- Règles d'accès (générées par scripts/securite/regles.py, build_suite('0386'))

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
           where schemaname = 'public' and tablename = any (array['assignment_overrides', 'assignment_requirements', 'hr_work_restrictions'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- assignment_overrides
select pg_temp.regles(array['assignment_overrides'], null,
  $r$(company_id in (select app.societes_avec_droit('interventions.visites.gerer')) or company_id in (select app.societes_avec_droit('rh.dossiers.voir')))$r$,
  null,
  null,
  null);

-- assignment_requirements
select pg_temp.regles(array['assignment_requirements'], null,
  $r$(company_id in (select app.societes_avec_droit('interventions.visites.gerer')) or company_id in (select app.societes_avec_droit('rh.dossiers.voir')))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.parametres.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.parametres.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.parametres.gerer'))$r$);

-- hr_work_restrictions
select pg_temp.regles(array['hr_work_restrictions'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or person_id in (select app.hr_mes_personnes()) or company_id in (select app.societes_avec_droit('interventions.visites.gerer')))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$);

insert into public.schema_migrations (version) values ('0386_rh_affectation') on conflict (version) do nothing;

-- ===== supabase/rollback/0386_rh_affectation_retour.sql =====
-- Retour arrière de 0386_rh_affectation.sql : retire le contrôle d'affectation, les consignes, la suite de l'inaptitude
-- et l'attestation de non contre-indication. Les colonnes ajoutées sont retirées (données de ces colonnes perdues).
-- Idempotent.

drop view if exists public.v_hr_vigilance;
drop trigger if exists hr_medical_followups_inaptitude on public.hr_medical_followups;
drop function if exists app.hr_inaptitude_suite();
drop trigger if exists itv_visits_affectation_garde on public.itv_visits;
drop function if exists app.affectation_garde();
drop function if exists public.affectation_lever(uuid, uuid, text);
drop function if exists public.affectation_verifier(uuid, uuid, date);
drop function if exists app.affectation_motifs(uuid, uuid, date);
drop function if exists app.affectation_regles_depart(uuid);
drop table if exists public.assignment_overrides;
drop table if exists public.assignment_requirements;
drop table if exists public.hr_work_restrictions;
alter table public.hr_people drop column if exists minor_derogation_until;
alter table public.hr_qualifications drop column if exists suspended_reason;
alter table public.hr_qualifications drop column if exists suspended_at;
alter table public.hr_qualifications drop column if exists scope;
alter table public.hr_qualifications drop column if exists symbols;
alter table public.hr_medical_followups drop column if exists inaptitude_closed_on;
alter table public.hr_medical_followups drop column if exists inaptitude_outcome;
alter table public.hr_medical_followups drop column if exists nci_scope;
alter table public.hr_medical_followups drop constraint if exists hr_medical_followups_visit_type_check;
alter table public.hr_medical_followups add constraint hr_medical_followups_visit_type_check
  check (visit_type in ('information_prevention', 'embauche', 'periodique', 'reprise', 'prereprise', 'mi_carriere', 'demande'));

delete from public.schema_migrations where version = '0386_rh_affectation';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE rh_0386 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

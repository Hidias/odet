-- 0320_vehicules_parc.sql : module Véhicules, parc, pleins, entretiens et incidents (spec odet-spec-vehicules.md § 2
-- à 5, branches vehicules/fiche, vehicules/pleins et vehicules/entretiens-incidents réunies ; la géolocalisation
-- attend le fournisseur réel et la vérification des durées sur cnil.fr).
--
--   - véhicules (vehicles) : immatriculation, identité, énergie, acquisition (achat, crédit, location), contrat et fin,
--     emprunt lié (Manager), assurance et échéance, carte carburant (4 derniers chiffres seulement), statut ;
--   - attributions (vehicle_assignments) : un conducteur à la fois (compte, fiche du personnel facultative), état des
--     lieux de remise et de restitution (kilométrage, carburant, observations) ;
--   - relevés de kilométrage (vehicle_odometer), alimentés par les pleins, les états des lieux, les entretiens et la
--     saisie ; échéances (vehicle_maintenance_rules) en kilomètres ou en mois, reprises dans v_vehicle_deadlines avec
--     l'assurance et la fin de contrat ;
--   - entretiens, réparations, contrôles, sinistres, pannes, immobilisations (vehicle_events) : coût, prestataire,
--     facture, retour prévu ; un entretien rattaché à une échéance la remet à jour ;
--   - pleins (vehicle_fuel) : saisie rapide sur téléphone, photo du ticket (bucket privé « vehicules »), anomalies
--     signalées et jamais corrigées en silence (kilométrage inférieur au précédent, ticket en double, véhicule non
--     attribué au conducteur) ; consommation calculée seulement entre deux pleins complets (v_vehicle_consumption).
-- Module « vehicules » ajouté, coupé. Droits (build_suite('0320')) : voir regles.py ; isolement par société ;
-- journal par app.audit_row.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0320_vehicules_parc_retour.sql

insert into public.org_modules (key, label, enabled, position, description)
values ('vehicules', 'Véhicules', false, 160, 'Parc, conducteurs, kilométrage, échéances, pleins, entretiens et incidents')
on conflict (key) do nothing;

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  plate text not null check (length(btrim(plate)) > 0),
  vin text,
  brand text,
  model text,
  energy text not null default 'gazole' check (energy in ('gazole', 'essence', 'electrique', 'hybride', 'gpl', 'autre')),
  first_registration_on date,
  acquisition text not null default 'achat' check (acquisition in ('achat', 'credit', 'lld', 'loa', 'credit_bail')),
  lessor text,
  contract_ref text,
  contract_end_on date,
  loan_id uuid references public.loans(id) on delete set null,
  insurer text,
  insurance_policy text,
  insurance_due_on date,
  fuel_card_last4 text check (fuel_card_last4 is null or fuel_card_last4 ~ '^[0-9]{4}$'),
  status text not null default 'actif' check (status in ('actif', 'immobilise', 'vendu', 'restitue')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vehicles_company_idx on public.vehicles (company_id);
create unique index if not exists vehicles_plate_uniq on public.vehicles (company_id, upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g')));
comment on table public.vehicles is 'Véhicules de la société (carte carburant : 4 derniers chiffres seulement)';

create table if not exists public.vehicle_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  person_id uuid references public.hr_people(id) on delete set null,
  driver_name text,
  start_on date not null default current_date,
  end_on date,
  start_km integer check (start_km is null or start_km >= 0),
  end_km integer check (end_km is null or end_km >= 0),
  start_fuel text,
  end_fuel text,
  start_notes text,
  end_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_assignments_dates check (end_on is null or end_on >= start_on)
);
create index if not exists vehicle_assignments_company_idx on public.vehicle_assignments (company_id);
create unique index if not exists vehicle_assignments_ouverte_uniq on public.vehicle_assignments (vehicle_id) where end_on is null;

create table if not exists public.vehicle_odometer (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  read_on date not null default current_date,
  km integer not null check (km >= 0),
  source text not null default 'saisie' check (source in ('plein', 'etat_des_lieux', 'entretien', 'saisie', 'boitier')),
  source_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists vehicle_odometer_vehicle_idx on public.vehicle_odometer (vehicle_id, read_on desc);
create index if not exists vehicle_odometer_company_idx on public.vehicle_odometer (company_id);

create table if not exists public.vehicle_maintenance_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  kind text not null check (kind in ('vidange', 'pneus', 'freins', 'revision', 'controle_technique', 'autre')),
  label text,
  every_km integer check (every_km is null or every_km > 0),
  every_months integer check (every_months is null or every_months > 0),
  last_on date,
  last_km integer check (last_km is null or last_km >= 0),
  alert_days integer not null default 30 check (alert_days >= 0),
  alert_km integer not null default 1000 check (alert_km >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_rules_periode check (every_km is not null or every_months is not null)
);
create index if not exists vehicle_maintenance_rules_company_idx on public.vehicle_maintenance_rules (company_id);

create table if not exists public.vehicle_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  kind text not null check (kind in ('entretien', 'reparation', 'controle_technique', 'sinistre', 'panne', 'immobilisation')),
  happened_on date not null default current_date,
  km integer check (km is null or km >= 0),
  provider text,
  cost_ttc numeric(12,2) check (cost_ttc is null or cost_ttc >= 0),
  invoice_ref text,
  description text,
  unavailable_until date,
  rule_id uuid references public.vehicle_maintenance_rules(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vehicle_events_vehicle_idx on public.vehicle_events (vehicle_id, happened_on desc);
create index if not exists vehicle_events_company_idx on public.vehicle_events (company_id);

create table if not exists public.vehicle_fuel (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  filled_at timestamptz not null default now(),
  driver_id uuid default auth.uid(),
  km integer not null check (km >= 0),
  liters numeric(8,2) not null check (liters > 0),
  amount_ttc numeric(10,2) not null check (amount_ttc >= 0),
  station text,
  fuel text,
  full_tank boolean not null default true,
  receipt_path text,
  receipt_hash text,
  to_reimburse boolean not null default false,
  status text not null default 'normal' check (status in ('normal', 'a_verifier')),
  anomaly text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vehicle_fuel_vehicle_idx on public.vehicle_fuel (vehicle_id, filled_at desc);
create index if not exists vehicle_fuel_company_idx on public.vehicle_fuel (company_id, filled_at desc);
comment on table public.vehicle_fuel is 'Pleins ; anomalies signalées (statut « à vérifier »), jamais corrigées en silence';

do $$
declare t text;
begin
  foreach t in array array['vehicles', 'vehicle_assignments', 'vehicle_maintenance_rules', 'vehicle_events', 'vehicle_fuel'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_maj', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.hr_h_maj()', t || '_maj', t);
  end loop;
end $$;

-- Véhicules qui me sont attribués (attribution ouverte)
create or replace function app.vehicules_miens()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.vehicle_id from public.vehicle_assignments a
  where a.profile_id = (select auth.uid()) and a.end_on is null
$$;
revoke all on function app.vehicules_miens() from public, anon;
grant execute on function app.vehicules_miens() to authenticated;

-- Dernier kilométrage connu d'un véhicule
create or replace function app.vehicule_km(p_vehicle uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select max(o.km) from public.vehicle_odometer o where o.vehicle_id = p_vehicle
$$;
revoke all on function app.vehicule_km(uuid) from public, anon, authenticated;

-- Lignes rattachées : même société que le véhicule ; emprunt lié de la même société
create or replace function app.vehicule_enfant_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
begin
  if tg_table_name = 'vehicles' then
    if new.loan_id is not null and not exists (select 1 from public.loans l where l.id = new.loan_id and l.company_id = new.company_id) then
      raise exception 'Emprunt d''une autre société' using errcode = '23514';
    end if;
    new.plate := upper(btrim(new.plate));
    return new;
  end if;
  select v.company_id into v_co from public.vehicles v where v.id = new.vehicle_id;
  if v_co is null then raise exception 'Véhicule introuvable' using errcode = 'P0002'; end if;
  new.company_id := v_co;
  return new;
end
$$;
revoke all on function app.vehicule_enfant_garde() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['vehicles', 'vehicle_assignments', 'vehicle_odometer', 'vehicle_maintenance_rules', 'vehicle_events', 'vehicle_fuel'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_garde', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.vehicule_enfant_garde()', t || '_garde', t);
  end loop;
end $$;

-- Plein : contrôles (signalés, jamais corrigés) ; le conducteur est le compte connecté sauf pour qui gère le parc
create or replace function app.vehicule_plein_controle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_km integer;
  v_notes text[] := '{}';
  v_attrib uuid;
begin
  if not (new.company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))) then
    new.driver_id := (select auth.uid());
  end if;
  if tg_op = 'UPDATE' then return new; end if;
  v_km := app.vehicule_km(new.vehicle_id);
  if v_km is not null and new.km < v_km then
    v_notes := v_notes || ('Kilométrage inférieur au précédent (' || v_km || ' km)');
  end if;
  if new.receipt_hash is not null and exists (select 1 from public.vehicle_fuel f where f.company_id = new.company_id and f.receipt_hash = new.receipt_hash) then
    v_notes := v_notes || 'Ticket déjà envoyé'::text;
  elsif exists (select 1 from public.vehicle_fuel f where f.vehicle_id = new.vehicle_id and f.amount_ttc = new.amount_ttc
                and abs(extract(epoch from (f.filled_at - new.filled_at))) < 3600) then
    v_notes := v_notes || 'Même montant dans la même heure : doublon possible'::text;
  end if;
  select a.profile_id into v_attrib from public.vehicle_assignments a where a.vehicle_id = new.vehicle_id and a.end_on is null;
  if v_attrib is not null and new.driver_id is distinct from v_attrib then
    v_notes := v_notes || 'Véhicule attribué à un autre conducteur'::text;
  end if;
  if cardinality(v_notes) > 0 then
    new.status := 'a_verifier';
    new.anomaly := array_to_string(v_notes, ' · ');
  else
    new.status := 'normal'; new.anomaly := null;
  end if;
  return new;
end
$$;
revoke all on function app.vehicule_plein_controle() from public, anon, authenticated;
drop trigger if exists vehicle_fuel_controle on public.vehicle_fuel;
create trigger vehicle_fuel_controle before insert or update on public.vehicle_fuel for each row execute function app.vehicule_plein_controle();

-- Relevé de kilométrage tiré d'un plein, d'un entretien ou d'un état des lieux ; échéance remise à jour par un entretien
create or replace function app.vehicule_releve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'vehicle_fuel' then
    insert into public.vehicle_odometer (company_id, vehicle_id, read_on, km, source, source_id, created_by)
    values (new.company_id, new.vehicle_id, new.filled_at::date, new.km, 'plein', new.id, new.driver_id);
  elsif tg_table_name = 'vehicle_events' then
    if new.km is not null then
      insert into public.vehicle_odometer (company_id, vehicle_id, read_on, km, source, source_id, created_by)
      values (new.company_id, new.vehicle_id, new.happened_on, new.km, 'entretien', new.id, new.created_by);
    end if;
    if new.rule_id is not null then
      update public.vehicle_maintenance_rules set last_on = new.happened_on, last_km = coalesce(new.km, last_km)
      where id = new.rule_id and vehicle_id = new.vehicle_id and (last_on is null or last_on <= new.happened_on);
    end if;
  elsif tg_table_name = 'vehicle_assignments' then
    if tg_op = 'INSERT' and new.start_km is not null then
      insert into public.vehicle_odometer (company_id, vehicle_id, read_on, km, source, source_id)
      values (new.company_id, new.vehicle_id, new.start_on, new.start_km, 'etat_des_lieux', new.id);
    elsif tg_op = 'UPDATE' and new.end_km is not null and old.end_km is null then
      insert into public.vehicle_odometer (company_id, vehicle_id, read_on, km, source, source_id)
      values (new.company_id, new.vehicle_id, coalesce(new.end_on, current_date), new.end_km, 'etat_des_lieux', new.id);
    end if;
  end if;
  return null;
end
$$;
revoke all on function app.vehicule_releve() from public, anon, authenticated;
drop trigger if exists vehicle_fuel_releve on public.vehicle_fuel;
create trigger vehicle_fuel_releve after insert on public.vehicle_fuel for each row execute function app.vehicule_releve();
drop trigger if exists vehicle_events_releve on public.vehicle_events;
create trigger vehicle_events_releve after insert on public.vehicle_events for each row execute function app.vehicule_releve();
drop trigger if exists vehicle_assignments_releve on public.vehicle_assignments;
create trigger vehicle_assignments_releve after insert or update on public.vehicle_assignments for each row execute function app.vehicule_releve();

-- Échéances : règles d'entretien (date ou kilométrage, le premier atteint), assurance, fin de contrat
create or replace view public.v_vehicle_deadlines with (security_invoker = true) as
  with km as (select o.vehicle_id, max(o.km) as km from public.vehicle_odometer o group by o.vehicle_id),
  echeances as (
    select r.company_id, r.vehicle_id, r.kind, coalesce(r.label, initcap(replace(r.kind, '_', ' '))) as label,
           case when r.every_months is not null and r.last_on is not null then (r.last_on + make_interval(months => r.every_months))::date end as due_on,
           case when r.every_km is not null and r.last_km is not null then r.last_km + r.every_km end as due_km,
           r.alert_days, r.alert_km, r.id as rule_id
    from public.vehicle_maintenance_rules r
    union all
    select v.company_id, v.id, 'assurance', 'Assurance', v.insurance_due_on, null, 30, 0, null from public.vehicles v where v.insurance_due_on is not null
    union all
    select v.company_id, v.id, 'fin_contrat', 'Fin de contrat', v.contract_end_on, null, 60, 0, null from public.vehicles v where v.contract_end_on is not null)
  select e.company_id, e.vehicle_id, v.plate, e.kind, e.label, e.due_on, e.due_km, km.km as current_km, e.rule_id,
    case
      when (e.due_on is not null and e.due_on < current_date) or (e.due_km is not null and km.km >= e.due_km) then 'depassee'
      when (e.due_on is not null and e.due_on <= current_date + e.alert_days) or (e.due_km is not null and km.km >= e.due_km - e.alert_km) then 'bientot'
      when e.due_on is null and e.due_km is null then 'inconnue'
      else 'ok' end as state
  from echeances e
  join public.vehicles v on v.id = e.vehicle_id and v.status in ('actif', 'immobilise')
  left join km on km.vehicle_id = e.vehicle_id;
comment on view public.v_vehicle_deadlines is 'Échéances des véhicules : entretiens (date ou kilomètres), assurance, fin de contrat';
revoke all on public.v_vehicle_deadlines from public, anon;
grant select on public.v_vehicle_deadlines to authenticated;

-- Consommation entre deux pleins complets successifs (litres des pleins depuis le précédent plein complet)
create or replace view public.v_vehicle_consumption with (security_invoker = true) as
  with complets as (
    select f.id, f.company_id, f.vehicle_id, f.filled_at, f.km,
           lag(f.km) over w as km_prec, lag(f.filled_at) over w as date_prec
    from public.vehicle_fuel f where f.full_tank and f.status = 'normal'
    window w as (partition by f.vehicle_id order by f.filled_at))
  select c.company_id, c.vehicle_id, c.id as fuel_id, c.filled_at, c.km - c.km_prec as distance,
    (select sum(f.liters) from public.vehicle_fuel f where f.vehicle_id = c.vehicle_id and f.filled_at > c.date_prec and f.filled_at <= c.filled_at) as liters,
    (select sum(f.amount_ttc) from public.vehicle_fuel f where f.vehicle_id = c.vehicle_id and f.filled_at > c.date_prec and f.filled_at <= c.filled_at) as amount_ttc,
    round(100 * (select sum(f.liters) from public.vehicle_fuel f where f.vehicle_id = c.vehicle_id and f.filled_at > c.date_prec and f.filled_at <= c.filled_at)
          / nullif(c.km - c.km_prec, 0), 2) as l_per_100
  from complets c
  where c.km_prec is not null and c.km > c.km_prec;
comment on view public.v_vehicle_consumption is 'Consommation aux 100 km, seulement entre deux pleins complets cohérents';
revoke all on public.v_vehicle_consumption from public, anon;
grant select on public.v_vehicle_consumption to authenticated;

-- Photos des tickets : bucket privé « vehicules », chemin société/véhicule/fichier ; lues avec le plein
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicules', 'vehicules', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
drop policy if exists vehicules_lire on storage.objects;
drop policy if exists vehicules_creer on storage.objects;
drop policy if exists vehicules_supprimer on storage.objects;
create policy vehicules_lire on storage.objects for select to authenticated
  using (bucket_id = 'vehicules' and (
    (storage.foldername(name))[1] in (select x::text from app.societes_avec_droit('vehicules.parc.voir') x)
    or (storage.foldername(name))[1] in (select x::text from app.societes_avec_droit('vehicules.couts.voir') x)
    or exists (select 1 from public.vehicle_fuel f where f.receipt_path = objects.name and f.driver_id = (select auth.uid()))));
create policy vehicules_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicules' and (
    (storage.foldername(name))[1] in (select x::text from app.societes_avec_droit('vehicules.parc.gerer') x)
    or (storage.foldername(name))[2] in (select x::text from app.vehicules_miens() x)));
create policy vehicules_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'vehicules' and (storage.foldername(name))[1] in (select x::text from app.societes_avec_droit('vehicules.parc.gerer') x));

-- Journal
do $$
declare r record;
begin
  for r in select * from (values ('vehicles', 'vehicules'), ('vehicle_assignments', 'vehicules'), ('vehicle_maintenance_rules', 'vehicules'),
                                 ('vehicle_events', 'vehicules'), ('vehicle_fuel', 'vehicules')) as t(nom, type) loop
    execute format('drop trigger if exists zz_audit_row on public.%I', r.nom);
    execute format('create trigger zz_audit_row after insert or update or delete on public.%I for each row execute function app.audit_row(%L)', r.nom, r.type);
  end loop;
end $$;

-- ── Droits des tables ──
do $$
declare t text;
begin
  foreach t in array array['vehicles', 'vehicle_assignments', 'vehicle_odometer', 'vehicle_maintenance_rules', 'vehicle_events', 'vehicle_fuel'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0320')) ──

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
           where schemaname = 'public' and tablename = any (array['vehicle_assignments', 'vehicle_events', 'vehicle_fuel', 'vehicle_maintenance_rules', 'vehicle_odometer', 'vehicles'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- vehicle_assignments
select pg_temp.regles(array['vehicle_assignments'], null,
  $r$(company_id in (select app.societes_avec_droit('vehicules.parc.voir')) or profile_id = (select auth.uid()))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$);

-- vehicle_events
select pg_temp.regles(array['vehicle_events'], null,
  $r$(company_id in (select app.societes_avec_droit('vehicules.parc.voir')) or company_id in (select app.societes_avec_droit('vehicules.couts.voir')) or vehicle_id in (select app.vehicules_miens()))$r$,
  $r$(company_id in (select app.societes_avec_droit('vehicules.parc.gerer')) or (company_id in (select app.societes_avec_droit('vehicules.siens.utiliser')) and vehicle_id in (select app.vehicules_miens())))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$);

-- vehicle_fuel
select pg_temp.regles(array['vehicle_fuel'], null,
  $r$(company_id in (select app.societes_avec_droit('vehicules.parc.voir')) or company_id in (select app.societes_avec_droit('vehicules.couts.voir')) or driver_id = (select auth.uid()))$r$,
  $r$(company_id in (select app.societes_avec_droit('vehicules.parc.gerer')) or (company_id in (select app.societes_avec_droit('vehicules.siens.utiliser')) and vehicle_id in (select app.vehicules_miens())))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$);

-- vehicle_maintenance_rules
select pg_temp.regles(array['vehicle_maintenance_rules'], null,
  $r$(company_id in (select app.societes_avec_droit('vehicules.parc.voir')) or vehicle_id in (select app.vehicules_miens()))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$);

-- vehicle_odometer
select pg_temp.regles(array['vehicle_odometer'], null,
  $r$(company_id in (select app.societes_avec_droit('vehicules.parc.voir')) or vehicle_id in (select app.vehicules_miens()))$r$,
  $r$(company_id in (select app.societes_avec_droit('vehicules.parc.gerer')) or (company_id in (select app.societes_avec_droit('vehicules.siens.utiliser')) and vehicle_id in (select app.vehicules_miens())))$r$,
  null,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$);

-- vehicles
select pg_temp.regles(array['vehicles'], null,
  $r$(company_id in (select app.societes_avec_droit('vehicules.parc.voir')) or company_id in (select app.societes_avec_droit('vehicules.couts.voir')) or id in (select app.vehicules_miens()))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$);


do $$
declare t text;
begin
  foreach t in array array['vehicles', 'vehicle_assignments', 'vehicle_odometer', 'vehicle_maintenance_rules', 'vehicle_events', 'vehicle_fuel'] loop
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

insert into public.schema_migrations (version) values ('0320_vehicules_parc') on conflict (version) do nothing;

-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (vehicules_suivi_0448) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0448_vehicules_suivi.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0448_vehicules_suivi_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0448_vehicules_suivi.sql =====
-- 0448 : suivi des véhicules (pilotage de H du 24/10).
--   1. Avis de contravention : désignation du conducteur dans les 45 jours (article L121-6 du code de la route,
--      obligation de l'employeur personne morale). Le conducteur est retrouvé par la base dans les attributions à la date
--      de l'infraction (modifiable), la date limite est posée, le responsable du parc est prévenu ; l'échéance remonte
--      dans les échéances du véhicule tant que la désignation n'est pas faite.
--   2. États des lieux en photos : photos rattachées à la remise ou à la restitution (papiers « etat_des_lieux »),
--      déposées par le responsable du parc ou par le conducteur pour son véhicule.
--   3. Équipements du véhicule (extincteur, trousse de secours, gilet, triangle…) : vérification et péremption suivies
--      dans les échéances du véhicule.
--   4. Coût total : prix d'achat, loyer ou mensualité, assurance annuelle et date d'entrée dans le parc, pour le coût
--      total par véhicule (carburant, entretiens, sinistres nets, amendes payées par la société, loyers, assurance).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0448_vehicules_suivi_retour.sql

-- ── 4. Coûts ──
alter table public.vehicles add column if not exists acquired_on date;
alter table public.vehicles add column if not exists purchase_price_ttc numeric(12,2);
alter table public.vehicles add column if not exists monthly_cost_ttc numeric(12,2);
alter table public.vehicles add column if not exists insurance_annual_ttc numeric(12,2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_couts_check') then
    alter table public.vehicles add constraint vehicles_couts_check check (
      (purchase_price_ttc is null or purchase_price_ttc >= 0) and (monthly_cost_ttc is null or monthly_cost_ttc >= 0)
      and (insurance_annual_ttc is null or insurance_annual_ttc >= 0));
  end if;
end
$$;
comment on column public.vehicles.monthly_cost_ttc is 'Loyer (location) ou mensualité (crédit) TTC par mois, pour le coût total du véhicule';

-- ── 1. Avis de contravention ──
create table if not exists public.vehicle_fines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  offense_at timestamptz not null,
  notice_on date not null,
  notice_number text check (notice_number is null or length(notice_number) <= 50),
  place text check (place is null or length(place) <= 300),
  offense text check (offense is null or length(offense) <= 300),
  amount numeric(10,2) check (amount is null or amount >= 0),
  profile_id uuid references public.profiles(id) on delete set null,
  driver_name text check (driver_name is null or length(driver_name) <= 200),
  driver_source text check (driver_source is null or driver_source in ('attribution', 'saisie')),
  deadline_on date,
  designated_on date,
  paid_by_company boolean not null default false,
  status text not null default 'a_designer' check (status in ('a_designer', 'designe', 'conteste', 'paye', 'classe')),
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vehicle_fines_company_idx on public.vehicle_fines (company_id, status);
create index if not exists vehicle_fines_vehicle_idx on public.vehicle_fines (vehicle_id, offense_at desc);
comment on table public.vehicle_fines is 'Avis de contravention des véhicules : conducteur retrouvé à la date de l''infraction, désignation dans les 45 jours';

drop trigger if exists vehicle_fines_maj on public.vehicle_fines;
create trigger vehicle_fines_maj before insert or update on public.vehicle_fines for each row execute function app.hr_h_maj();
drop trigger if exists vehicle_fines_garde on public.vehicle_fines;
create trigger vehicle_fines_garde before insert or update on public.vehicle_fines for each row execute function app.vehicule_enfant_garde();

-- Conducteur d'un véhicule à une date : l'attribution qui couvre ce jour
create or replace function app.vehicule_conducteur_le(p_vehicle uuid, p_jour date)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.profile_id from public.vehicle_assignments a
  where a.vehicle_id = p_vehicle and a.start_on <= p_jour and (a.end_on is null or a.end_on >= p_jour)
  order by a.start_on desc limit 1
$$;
revoke all on function app.vehicule_conducteur_le(uuid, date) from public, anon, authenticated;

create or replace function app.vehicule_amende_suivi()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jour date := (new.offense_at at time zone 'Europe/Paris')::date;
  v_plate text;
  v_nom text;
begin
  new.deadline_on := new.notice_on + 45;
  if new.profile_id is null and (tg_op = 'INSERT' or new.offense_at is distinct from old.offense_at or new.vehicle_id is distinct from old.vehicle_id) then
    new.profile_id := app.vehicule_conducteur_le(new.vehicle_id, v_jour);
    if new.profile_id is not null then new.driver_source := 'attribution'; end if;
  elsif new.profile_id is not null and (tg_op = 'INSERT' or new.profile_id is distinct from old.profile_id) then
    new.driver_source := case when new.profile_id = app.vehicule_conducteur_le(new.vehicle_id, v_jour) then 'attribution' else 'saisie' end;
  end if;
  if new.profile_id is not null and (tg_op = 'INSERT' or new.profile_id is distinct from old.profile_id or new.driver_name is null) then
    select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') into v_nom from public.profiles p where p.id = new.profile_id;
    new.driver_name := coalesce(v_nom, new.driver_name);
  end if;
  if new.designated_on is not null and new.status = 'a_designer' then new.status := 'designe'; end if;
  if tg_op = 'INSERT' then
    select v.plate into v_plate from public.vehicles v where v.id = new.vehicle_id;
    insert into public.notifications (company_id, type, title, message, link, metadata)
    values (new.company_id, 'vehicule_amende', 'Avis de contravention : ' || coalesce(v_plate, ''),
      'Conducteur à désigner avant le ' || to_char(new.deadline_on, 'DD/MM/YYYY')
        || case when new.driver_name is not null then ' (conducteur ce jour-là : ' || new.driver_name || ')' else ' (aucun conducteur attribué ce jour-là)' end,
      '/vehicules/parc', jsonb_build_object('vehicle_id', new.vehicle_id, 'fine_id', new.id));
  end if;
  return new;
end
$$;
revoke all on function app.vehicule_amende_suivi() from public, anon, authenticated;
drop trigger if exists vehicle_fines_suivi on public.vehicle_fines;
create trigger vehicle_fines_suivi before insert or update on public.vehicle_fines for each row execute function app.vehicule_amende_suivi();

-- Conducteur retrouvé pour l'écran, avant d'enregistrer l'avis (qui gère le parc seulement)
create or replace function public.vehicule_conducteur_a(p_vehicle uuid, p_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_co uuid;
  v_p uuid;
  v_nom text;
begin
  select v.company_id into v_co from public.vehicles v where v.id = p_vehicle;
  if v_co is null or not (v_co in (select app.societes_avec_droit('vehicules.parc.gerer'))) then
    raise exception 'Véhicule introuvable ou non accessible' using errcode = '42501';
  end if;
  v_p := app.vehicule_conducteur_le(p_vehicle, (p_at at time zone 'Europe/Paris')::date);
  if v_p is null then return null; end if;
  select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') into v_nom from public.profiles p where p.id = v_p;
  return jsonb_build_object('profile_id', v_p, 'name', v_nom);
end
$$;
revoke all on function public.vehicule_conducteur_a(uuid, timestamptz) from public, anon;
grant execute on function public.vehicule_conducteur_a(uuid, timestamptz) to authenticated;

-- ── 3. Équipements du véhicule ──
create table if not exists public.vehicle_equipment (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  kind text not null check (kind in ('extincteur', 'trousse_secours', 'gilet', 'triangle', 'autre')),
  label text check (label is null or length(label) <= 200),
  serial text check (serial is null or length(serial) <= 100),
  checked_on date,
  next_check_on date,
  expires_on date,
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vehicle_equipment_company_idx on public.vehicle_equipment (company_id);
create index if not exists vehicle_equipment_vehicle_idx on public.vehicle_equipment (vehicle_id);
comment on table public.vehicle_equipment is 'Équipements de sécurité du véhicule (extincteur, trousse de secours…) : vérification et péremption';
drop trigger if exists vehicle_equipment_maj on public.vehicle_equipment;
create trigger vehicle_equipment_maj before insert or update on public.vehicle_equipment for each row execute function app.hr_h_maj();
drop trigger if exists vehicle_equipment_garde on public.vehicle_equipment;
create trigger vehicle_equipment_garde before insert or update on public.vehicle_equipment for each row execute function app.vehicule_enfant_garde();

do $$
declare t text;
begin
  foreach t in array array['vehicle_fines', 'vehicle_equipment'] loop
    execute format('drop trigger if exists zz_audit_row on public.%I', t);
    execute format('create trigger zz_audit_row after insert or update or delete on public.%I for each row execute function app.audit_row(%L)', t, 'vehicules');
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- ── 2. États des lieux en photos, avis de contravention en pièce jointe ──
alter table public.vehicle_papers add column if not exists assignment_id uuid references public.vehicle_assignments(id) on delete set null;
alter table public.vehicle_papers add column if not exists fine_id uuid references public.vehicle_fines(id) on delete cascade;
alter table public.vehicle_papers add column if not exists moment text;
do $$
begin
  alter table public.vehicle_papers drop constraint if exists vehicle_papers_kind_check;
  alter table public.vehicle_papers add constraint vehicle_papers_kind_check check (kind in ('carte_grise', 'attestation_assurance', 'constat_vierge',
    'constat', 'photo_sinistre', 'cession', 'autre', 'etat_des_lieux', 'avis_contravention'));
  if not exists (select 1 from pg_constraint where conname = 'vehicle_papers_moment_check') then
    alter table public.vehicle_papers add constraint vehicle_papers_moment_check check (moment is null or moment in ('remise', 'restitution'));
  end if;
end
$$;
create index if not exists vehicle_papers_assignment_idx on public.vehicle_papers (assignment_id) where assignment_id is not null;
create index if not exists vehicle_papers_fine_idx on public.vehicle_papers (fine_id) where fine_id is not null;

create or replace function app.vehicule_papier_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
begin
  if new.vehicle_id is not null then
    select v.company_id into v_co from public.vehicles v where v.id = new.vehicle_id;
    if v_co is null then raise exception 'Véhicule introuvable' using errcode = 'P0002'; end if;
    new.company_id := v_co;
  end if;
  if new.event_id is not null and not exists (select 1 from public.vehicle_events e where e.id = new.event_id and e.vehicle_id = new.vehicle_id) then
    raise exception 'Incident d''un autre véhicule' using errcode = '23514';
  end if;
  -- 0448 : état des lieux et avis de contravention du même véhicule
  if new.assignment_id is not null and not exists (select 1 from public.vehicle_assignments a where a.id = new.assignment_id and a.vehicle_id = new.vehicle_id) then
    raise exception 'Attribution d''un autre véhicule' using errcode = '23514';
  end if;
  if new.fine_id is not null and not exists (select 1 from public.vehicle_fines f where f.id = new.fine_id and f.vehicle_id = new.vehicle_id) then
    raise exception 'Avis d''un autre véhicule' using errcode = '23514';
  end if;
  if split_part(new.file_path, '/', 1) <> new.company_id::text then
    raise exception 'Fichier hors du dossier de la société' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then new.created_by := (select auth.uid()); end if;
  return new;
end
$$;
revoke all on function app.vehicule_papier_garde() from public, anon, authenticated;

-- ── Règles ──
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

do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['vehicle_papers', 'vehicle_fines', 'vehicle_equipment'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- vehicle_papers : comme 0447 ; le conducteur dépose aussi les photos de l'état des lieux de son véhicule
select pg_temp.regles(array['vehicle_papers'], null,
  $r$(company_id in (select app.societes_avec_droit('vehicules.parc.voir')) or vehicle_id in (select app.vehicules_miens()) or (vehicle_id is null and company_id in (select app.societes_avec_droit('vehicules.siens.utiliser'))))$r$,
  $r$(company_id in (select app.societes_avec_droit('vehicules.parc.gerer')) or (company_id in (select app.societes_avec_droit('vehicules.siens.utiliser')) and vehicle_id in (select app.vehicules_miens()) and kind in ('constat', 'photo_sinistre', 'etat_des_lieux')))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$);

-- vehicle_fines : lus par qui voit le parc ou les coûts, et par le conducteur désigné ; tenus par qui gère le parc
select pg_temp.regles(array['vehicle_fines'], null,
  $r$(company_id in (select app.societes_avec_droit('vehicules.parc.voir')) or company_id in (select app.societes_avec_droit('vehicules.couts.voir')) or profile_id = (select auth.uid()))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$);

-- vehicle_equipment : lus par qui voit le parc et par le conducteur pour son véhicule ; tenus par qui gère le parc
select pg_temp.regles(array['vehicle_equipment'], null,
  $r$(company_id in (select app.societes_avec_droit('vehicules.parc.voir')) or vehicle_id in (select app.vehicules_miens()))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('vehicules.parc.gerer'))$r$);

do $$
declare t text;
begin
  foreach t in array array['vehicle_fines', 'vehicle_equipment'] loop
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

-- ── Échéances : équipements et désignations en attente ajoutés (mêmes colonnes qu'en 0320) ──
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
    select v.company_id, v.id, 'fin_contrat', 'Fin de contrat', v.contract_end_on, null, 60, 0, null from public.vehicles v where v.contract_end_on is not null
    union all
    select q.company_id, q.vehicle_id, 'equipement',
           coalesce(q.label, case q.kind when 'extincteur' then 'Extincteur' when 'trousse_secours' then 'Trousse de secours' when 'gilet' then 'Gilet' when 'triangle' then 'Triangle' else 'Équipement' end),
           least(q.next_check_on, q.expires_on), null, 30, 0, q.id
    from public.vehicle_equipment q where q.next_check_on is not null or q.expires_on is not null
    union all
    select f.company_id, f.vehicle_id, 'designation', 'Désignation du conducteur (avis de contravention)', f.deadline_on, null, 15, 0, f.id
    from public.vehicle_fines f where f.status = 'a_designer')
  select e.company_id, e.vehicle_id, v.plate, e.kind, e.label, e.due_on, e.due_km, km.km as current_km, e.rule_id,
    case
      when (e.due_on is not null and e.due_on < current_date) or (e.due_km is not null and km.km >= e.due_km) then 'depassee'
      when (e.due_on is not null and e.due_on <= current_date + e.alert_days) or (e.due_km is not null and km.km >= e.due_km - e.alert_km) then 'bientot'
      when e.due_on is null and e.due_km is null then 'inconnue'
      else 'ok' end as state
  from echeances e
  join public.vehicles v on v.id = e.vehicle_id and v.status in ('actif', 'immobilise')
  left join km on km.vehicle_id = e.vehicle_id;
comment on view public.v_vehicle_deadlines is 'Échéances des véhicules : entretiens (date ou kilomètres), assurance, fin de contrat, équipements, désignations de conducteur en attente (0448)';
revoke all on public.v_vehicle_deadlines from public, anon;
grant select on public.v_vehicle_deadlines to authenticated;

insert into public.schema_migrations (version) values ('0448_vehicules_suivi') on conflict (version) do nothing;

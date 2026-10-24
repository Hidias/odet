-- Retour arrière de 0448_vehicules_suivi.sql. Idempotent. Refusé s'il existe des avis de contravention, des
-- équipements ou des photos d'état des lieux (ils seraient perdus) : les retirer d'abord.
do $do$
begin
  if (to_regclass('public.vehicle_fines') is not null and exists (select 1 from public.vehicle_fines))
     or (to_regclass('public.vehicle_equipment') is not null and exists (select 1 from public.vehicle_equipment))
     or exists (select 1 from public.vehicle_papers where kind in ('etat_des_lieux', 'avis_contravention')) then
    raise exception 'Des avis, équipements ou états des lieux existent : retour arrière refusé';
  end if;
end
$do$;
-- Échéances comme en 0320
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
-- Règles et garde des papiers comme en 0447
drop policy if exists vehicle_papers_creer on public.vehicle_papers;
create policy vehicle_papers_creer on public.vehicle_papers for insert to authenticated with check ((company_id in (select app.societes_avec_droit('vehicules.parc.gerer')) or (company_id in (select app.societes_avec_droit('vehicules.siens.utiliser')) and vehicle_id in (select app.vehicules_miens()) and kind in ('constat', 'photo_sinistre'))));
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
  if split_part(new.file_path, '/', 1) <> new.company_id::text then
    raise exception 'Fichier hors du dossier de la société' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then new.created_by := (select auth.uid()); end if;
  return new;
end
$$;
revoke all on function app.vehicule_papier_garde() from public, anon, authenticated;
alter table public.vehicle_papers drop constraint if exists vehicle_papers_moment_check;
alter table public.vehicle_papers drop constraint if exists vehicle_papers_kind_check;
alter table public.vehicle_papers add constraint vehicle_papers_kind_check check (kind in ('carte_grise', 'attestation_assurance', 'constat_vierge', 'constat', 'photo_sinistre', 'cession', 'autre'));
drop index if exists public.vehicle_papers_fine_idx;
drop index if exists public.vehicle_papers_assignment_idx;
alter table public.vehicle_papers drop column if exists moment;
alter table public.vehicle_papers drop column if exists fine_id;
alter table public.vehicle_papers drop column if exists assignment_id;
drop table if exists public.vehicle_equipment;
drop function if exists public.vehicule_conducteur_a(uuid, timestamptz);
drop table if exists public.vehicle_fines;
drop function if exists app.vehicule_amende_suivi();
drop function if exists app.vehicule_conducteur_le(uuid, date);
alter table public.vehicles drop constraint if exists vehicles_couts_check;
alter table public.vehicles drop column if exists insurance_annual_ttc;
alter table public.vehicles drop column if exists monthly_cost_ttc;
alter table public.vehicles drop column if exists purchase_price_ttc;
alter table public.vehicles drop column if exists acquired_on;
delete from public.schema_migrations where version = '0448_vehicules_suivi';

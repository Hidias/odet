-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (f_0354) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0354_interventions_remplacement.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0354_interventions_remplacement_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0354_interventions_remplacement.sql =====
-- 0354_interventions_remplacement.sql : chantier F phase 2, Interventions (spec § 7, erreurs A1 et A2).
--
-- 1. Lignes de visite : motif de remplacement (replace_reason, replace_note), information du client (client_informed)
--    et numéro de série du nouvel appareil (new_serial_number).
-- 2. Appareils : numéro de série (serial_number).
-- 3. Garde à la clôture d'une visite (déclencheur sur itv_visits, quel que soit le chemin de clôture) :
--    - un appareil « remplacé » sans motif bloque la clôture ;
--    - motif « autre » sans précision : bloque ;
--    - remplacement à la place d'une opération périodique (maintenance additionnelle, révision, requalification) :
--      le client doit avoir été informé (case cochée), sinon la clôture est refusée.
--    Les lignes peuvent être enregistrées une à une pendant la visite (le technicien touche « Remplacé », puis choisit
--    le motif) : seule la clôture contrôle.
-- 4. Après la clôture : le numéro de série saisi pour un appareil remplacé devient celui de l'appareil.
-- Aucune nouvelle table : pas de nouvelle règle d'accès (colonnes couvertes par les droits existants des tables).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0354_interventions_remplacement_retour.sql

alter table public.itv_visit_items add column if not exists replace_reason text;
alter table public.itv_visit_items add column if not exists replace_note text;
alter table public.itv_visit_items add column if not exists client_informed boolean not null default false;
alter table public.itv_visit_items add column if not exists new_serial_number text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'itv_visit_items_replace_reason_check') then
    alter table public.itv_visit_items add constraint itv_visit_items_replace_reason_check
      check (replace_reason is null or replace_reason in ('fin_de_vie', 'hors_service', 'non_reparable', 'demande_client', 'cout', 'obsolete', 'autre'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'itv_visit_items_new_serial_number_check') then
    alter table public.itv_visit_items add constraint itv_visit_items_new_serial_number_check
      check (new_serial_number is null or length(new_serial_number) <= 60);
  end if;
end $$;
comment on column public.itv_visit_items.replace_reason is 'Motif du remplacement (obligatoire à la clôture si l''appareil est remplacé)';
comment on column public.itv_visit_items.client_informed is 'Client informé et d''accord (obligatoire si le remplacement prend la place d''une opération périodique)';

alter table public.itv_equipment add column if not exists serial_number text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'itv_equipment_serial_number_check') then
    alter table public.itv_equipment add constraint itv_equipment_serial_number_check
      check (serial_number is null or length(serial_number) <= 60);
  end if;
end $$;

create or replace function app.itv_visite_cloture_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if new.status = 'terminee' and old.status is distinct from 'terminee' then
    select count(*) into v_n from public.itv_visit_items
     where visit_id = new.id and result = 'remplace' and replace_reason is null;
    if v_n > 0 then
      raise exception 'Clôture refusée : % appareil(s) remplacé(s) sans motif de remplacement', v_n using errcode = '23514';
    end if;
    select count(*) into v_n from public.itv_visit_items
     where visit_id = new.id and result = 'remplace' and replace_reason = 'autre' and coalesce(btrim(replace_note), '') = '';
    if v_n > 0 then
      raise exception 'Clôture refusée : % remplacement(s) « autre motif » sans précision', v_n using errcode = '23514';
    end if;
    select count(*) into v_n from public.itv_visit_items
     where visit_id = new.id and result = 'remplace' and operation in ('maa', 'revision', 'requalification', 'epreuve')
       and not client_informed;
    if v_n > 0 then
      raise exception 'Clôture refusée : % remplacement(s) à la place d''une opération périodique sans information du client', v_n using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.itv_visite_cloture_garde() from public, anon, authenticated;
drop trigger if exists itv_visite_cloture_garde on public.itv_visits;
create trigger itv_visite_cloture_garde before update of status on public.itv_visits
  for each row execute function app.itv_visite_cloture_garde();

create or replace function app.itv_visite_cloture_series()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'terminee' and old.status is distinct from 'terminee' then
    update public.itv_equipment e set serial_number = i.new_serial_number, updated_at = now()
      from public.itv_visit_items i
     where i.visit_id = new.id and i.equipment_id = e.id and i.result = 'remplace'
       and coalesce(btrim(i.new_serial_number), '') <> '';
  end if;
  return null;
end
$$;
revoke all on function app.itv_visite_cloture_series() from public, anon, authenticated;
drop trigger if exists itv_visite_cloture_series on public.itv_visits;
create trigger itv_visite_cloture_series after update of status on public.itv_visits
  for each row execute function app.itv_visite_cloture_series();

insert into public.schema_migrations (version) values ('0354_interventions_remplacement') on conflict (version) do nothing;

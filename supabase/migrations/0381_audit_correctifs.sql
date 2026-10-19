-- 0381_audit_correctifs.sql : correctifs de l'audit du 19/10 au soir (angles morts relevés par H).
--
--   1. Visite d'intervention terminée : figée en base, comme le rapport signé remis au client. Après la clôture, seuls
--      le devis, la facture, la date d'envoi du rapport et les notes internes changent ; les contrôles, pièces,
--      observations, signature, technicien et dates ne se modifient plus (sauf super administrateur, pour une
--      réouverture tracée par le journal). Jusqu'ici, seul l'écran empêchait la modification.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0381_audit_correctifs_retour.sql

-- 1. Visite terminée figée
create or replace function app.itv_visite_figee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_statut text;
begin
  -- Écritures du système (tâches, migrations) et super administrateur : permises
  if (select auth.uid()) is null or app.is_superadmin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_table_name = 'itv_visits' then
    if old.status = 'terminee' and (
         new.status is distinct from old.status or new.client_id is distinct from old.client_id
         or new.site_id is distinct from old.site_id or new.contract_id is distinct from old.contract_id
         or new.technician_id is distinct from old.technician_id or new.started_at is distinct from old.started_at
         or new.finished_at is distinct from old.finished_at or new.signer_name is distinct from old.signer_name
         or new.client_signature is distinct from old.client_signature or new.observations is distinct from old.observations
         or new.site_observations is distinct from old.site_observations or new.photos is distinct from old.photos
         or new.planned_on is distinct from old.planned_on) then
      raise exception 'Visite terminée : le rapport est figé. Une correction passe par le super administrateur.' using errcode = '23514';
    end if;
    return new;
  end if;
  select v.status into v_statut from public.itv_visits v where v.id = case when tg_op = 'DELETE' then old.visit_id else new.visit_id end;
  if v_statut = 'terminee' then
    raise exception 'Visite terminée : ses contrôles et ses pièces ne se modifient plus.' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke all on function app.itv_visite_figee() from public, anon, authenticated;

drop trigger if exists itv_visits_figee on public.itv_visits;
create trigger itv_visits_figee before update on public.itv_visits for each row execute function app.itv_visite_figee();
drop trigger if exists itv_visit_items_figee on public.itv_visit_items;
create trigger itv_visit_items_figee before insert or update or delete on public.itv_visit_items for each row execute function app.itv_visite_figee();
drop trigger if exists itv_visit_parts_figee on public.itv_visit_parts;
create trigger itv_visit_parts_figee before insert or update or delete on public.itv_visit_parts for each row execute function app.itv_visite_figee();

insert into public.schema_migrations (version) values ('0381_audit_correctifs') on conflict (version) do nothing;

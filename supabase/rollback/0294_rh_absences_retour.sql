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

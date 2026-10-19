-- Retour arrière de 0297_rh_heures.sql : retire le pointage, les semaines et leurs fonctions. Idempotent.
-- Refusé si des heures ont été saisies (données du personnel : à exporter d'abord).

do $$
begin
  if (to_regclass('public.hr_time_entries') is not null and exists (select 1 from public.hr_time_entries))
     or (to_regclass('public.hr_timesheets') is not null and exists (select 1 from public.hr_timesheets)) then
    raise exception 'Retour arrière refusé : des heures ont été saisies (à exporter d''abord)';
  end if;
end $$;

drop trigger if exists hr_semaine_decision on public.approval_requests;
drop function if exists app.hr_semaine_decision();
drop function if exists public.hr_semaine_soumettre(date);
drop function if exists public.hr_semaine_preparer(date);
delete from public.approval_requests where object_table = 'hr_timesheets';
drop table if exists public.hr_time_entries;
drop table if exists public.hr_timesheets;
drop function if exists app.hr_ligne_garde();
drop function if exists app.hr_h_maj();
drop function if exists app.hr_ma_fiche();

delete from public.schema_migrations where version = '0297_rh_heures';

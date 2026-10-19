-- Retour arrière de 0220_manager_emprunts.sql : retire les emprunts (tables, vue, fonctions) et le module s'il est
-- coupé. Idempotent. Refusé si un emprunt a été saisi (à exporter d'abord).

do $$
begin
  if to_regclass('public.loans') is not null and exists (select 1 from public.loans) then
    raise exception 'Retour arrière refusé : des emprunts ont été saisis (à exporter d''abord)';
  end if;
end $$;

drop view if exists public.v_loans_summary;
drop function if exists public.loan_propositions(uuid);
drop function if exists public.loan_importer(uuid, jsonb);
drop function if exists public.loan_calculer(uuid);
drop function if exists app.loan_controle(uuid);
drop table if exists public.loan_events;
drop table if exists public.loan_schedule_lines;
drop table if exists public.loans;
drop function if exists app.loan_enfant_garde();
delete from public.org_modules where key = 'manager' and not enabled;

delete from public.schema_migrations where version = '0220_manager_emprunts';

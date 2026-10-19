-- Retour arrière de 0130_pont_formation_maintenance.sql : retire les pistes, les fonctions du technicien, le
-- déclencheur de fin de session et le module « pont ». Idempotent. Refusé si des pistes ont été créées.
-- Les exercices déclarés au technicien (client_safety_checks) restent : ils appartiennent au lot 2.

do $$
begin
  if to_regclass('public.cross_sell_leads') is not null and exists (select 1 from public.cross_sell_leads) then
    raise exception 'Retour arrière refusé : des pistes ont été créées';
  end if;
end $$;

drop trigger if exists sessions_pont_fin on public.sessions;
drop function if exists app.pont_fin_session();
drop function if exists public.pont_declarer_exercice(uuid, date);
drop function if exists public.pont_signaler_besoin(uuid, text);
drop function if exists public.itv_site_training_summary(uuid);
drop function if exists app.pont_visite(uuid);
drop function if exists app.pont_domaines();
drop function if exists app.pont_reglages();
drop table if exists public.cross_sell_leads;
drop function if exists app.cross_sell_leads_maj();
delete from public.company_modules where key = 'pont';
delete from public.org_modules where key = 'pont';

delete from public.schema_migrations where version = '0130_pont_formation_maintenance';

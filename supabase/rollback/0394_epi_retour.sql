-- Retour arrière de 0394_epi.sql : retire les remises d'EPI (s'il n'y en a aucune), leurs déclencheurs et les colonnes
-- EPI des articles. Les mouvements de stock déjà écrits restent (le stock reste juste). Idempotent.

do $r$
begin
  if to_regclass('public.hr_ppe_handovers') is not null and exists (select 1 from public.hr_ppe_handovers) then
    raise exception 'Des EPI ont été remis : retour arrière refusé, rien n''est modifié';
  end if;
end $r$;

drop table if exists public.hr_ppe_handovers;
drop function if exists app.epi_remise_avant();
drop function if exists app.epi_remise_stock();
alter table public.stock_items drop constraint if exists stock_items_ppe_renew_months_check;
alter table public.stock_items drop column if exists ppe_renew_months;
alter table public.stock_items drop column if exists ppe;

delete from public.schema_migrations where version = '0394_epi';

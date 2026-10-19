-- Retour arrière de 0240_stock_socle.sql : retire le stock (fournisseurs, articles, emplacements, seuils, mouvements),
-- ses vues et fonctions, les colonnes ajoutées aux pièces de visite et le module. Idempotent.
-- Refusé si un mouvement a été écrit ou si un fournisseur ou un article a été créé à la main (données à exporter
-- d'abord) ; les articles repris des pièces d'intervention et les emplacements de départ ne comptent pas.

do $$
begin
  if (to_regclass('public.stock_movements') is not null and exists (select 1 from public.stock_movements))
     or (to_regclass('public.suppliers') is not null and exists (select 1 from public.suppliers))
     or (to_regclass('public.stock_items') is not null and exists (select 1 from public.stock_items where itv_part_id is null)) then
    raise exception 'Retour arrière refusé : du stock a été saisi (mouvements, fournisseurs ou articles, à exporter d''abord)';
  end if;
end $$;

drop trigger if exists companies_stock_depart on public.companies;
drop function if exists app.stock_depart_societe();
drop trigger if exists itv_visits_stock_cloture on public.itv_visits;
drop function if exists app.stock_visite_cloture();
drop function if exists public.stock_depots_terrain();
drop function if exists public.stock_articles_terrain();
drop function if exists public.stock_mon_stock();
drop function if exists public.stock_mouvement(text, uuid, numeric, uuid, uuid, text, numeric, text);
drop view if exists public.v_stock_value;
drop view if exists public.v_stock_alerts;
drop view if exists public.v_stock_levels;
alter table public.itv_visit_parts drop column if exists stock_location_id;
alter table public.itv_visit_parts drop column if exists stock_item_id;
drop table if exists public.stock_movements;
drop table if exists public.stock_thresholds;
drop table if exists public.stock_item_costs;
drop table if exists public.stock_locations;
drop table if exists public.stock_items;
drop table if exists public.stock_categories;
drop table if exists public.suppliers;
drop function if exists app.stock_depart(uuid);
drop function if exists app.stock_mes_emplacements();
drop function if exists app.stock_mon_emplacement(boolean);
drop function if exists app.stock_mouvement_fige();
drop function if exists app.stock_cout_garde();
delete from public.org_modules where key = 'stock' and not enabled;

delete from public.schema_migrations where version = '0240_stock_socle';

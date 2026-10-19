-- Retour arrière de 0247_stock_inventaire.sql : retire les inventaires et les numéros de série (tables, fonctions,
-- déclencheurs). Idempotent. Refusé si un inventaire ou un numéro de série a été saisi (à exporter d'abord).

do $$
begin
  if (to_regclass('public.stock_counts') is not null and exists (select 1 from public.stock_counts))
     or (to_regclass('public.stock_serials') is not null and exists (select 1 from public.stock_serials)) then
    raise exception 'Retour arrière refusé : des inventaires ou des numéros de série ont été saisis (à exporter d''abord)';
  end if;
end $$;

drop function if exists public.stock_inventaire_annuler(uuid);
drop function if exists public.stock_inventaire_valider(uuid);
drop function if exists public.stock_inventaire_compter(uuid, uuid, numeric);
drop function if exists public.stock_inventaire_ouvrir(uuid, text);
drop function if exists app.stock_niveau(uuid, uuid);
drop function if exists app.stock_peut_compter(uuid);
drop trigger if exists stock_movements_serie on public.stock_movements;
drop function if exists app.stock_serie_suivre();
drop table if exists public.stock_serials;
drop function if exists app.stock_serie_garde();
drop table if exists public.stock_count_lines;
drop table if exists public.stock_counts;

delete from public.schema_migrations where version = '0247_stock_inventaire';

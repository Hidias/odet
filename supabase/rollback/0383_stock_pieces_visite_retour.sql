-- Retour arrière de 0383_stock_pieces_visite.sql : retire le camion automatique et le lien des pièces, remet la
-- clôture de 0240. Les liens déjà posés sur les pièces (stock_item_id) restent : ils ne changent rien sans ce lot.
-- Idempotent.

drop trigger if exists itv_visit_parts_stock_lien on public.itv_visit_parts;
drop function if exists app.stock_piece_visite_lien();
drop trigger if exists itv_technicians_stock_camion on public.itv_technicians;
drop function if exists app.stock_camion_technicien();

create or replace function app.stock_visite_cloture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_loc uuid;
begin
  if new.status <> 'terminee' or old.status = 'terminee' then return new; end if;
  for r in select vp.* from public.itv_visit_parts vp where vp.visit_id = new.id and vp.stock_item_id is not null and vp.quantity > 0 loop
    v_loc := r.stock_location_id;
    if v_loc is null and new.technician_id is not null then
      select l.id into v_loc from public.stock_locations l
      join public.stock_items i on i.id = r.stock_item_id
      where l.kind = 'technicien' and l.profile_id = new.technician_id and l.company_id = i.company_id and l.is_active;
    end if;
    if v_loc is null then continue; end if;
    insert into public.stock_movements (company_id, kind, item_id, quantity, from_location_id, source_table, source_id, note, created_by)
    select i.company_id, 'sortie', r.stock_item_id, r.quantity, v_loc, 'itv_visit_parts', r.id, 'Visite ' || coalesce(new.reference, new.id::text), (select auth.uid())
    from public.stock_items i where i.id = r.stock_item_id
    on conflict (source_table, source_id) where source_table is not null and source_id is not null do nothing;
  end loop;
  return new;
end
$$;
revoke all on function app.stock_visite_cloture() from public, anon, authenticated;

drop function if exists app.stock_camion(uuid, uuid, boolean);

delete from public.schema_migrations where version = '0383_stock_pieces_visite';

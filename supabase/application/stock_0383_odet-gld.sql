-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (stock_0383) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0383_stock_pieces_visite.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0383_stock_pieces_visite_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0383_stock_pieces_visite.sql =====
-- 0383_stock_pieces_visite.sql : les pièces notées pendant une visite sortent vraiment du stock (audit du 19/10 au soir).
--
--   Constat : à la clôture d'une visite, seules les pièces reliées à un article du stock (stock_item_id) sortent ; or
--   l'ajout d'une pièce pendant la visite (itv_visit_part_add, écran Visite) ne remplissait jamais ce lien : aucune pièce
--   n'est jamais sortie du stock (0 mouvement d'origine visite). Et un technicien sans emplacement était ignoré.
--
--   1. Chaque technicien a son « camion » : emplacement du stock de type technicien, créé à son arrivée dans les
--      techniciens, ou à la première pièce qu'il note, ou à la clôture d'une visite (app.stock_camion).
--   2. Une pièce de visite est reliée d'elle-même à l'article du stock correspondant à la pièce du catalogue
--      d'intervention (stock_items.itv_part_id) et au camion du technicien de la visite, à l'ajout comme au changement
--      de pièce.
--   3. À la clôture, une pièce reliée à un article sort du camion du technicien, même s'il n'avait pas encore
--      d'emplacement (créé alors) : le stock peut passer en négatif, ce qui le signale dans les alertes.
--   4. Les pièces des visites pas encore terminées sont reliées tout de suite. Les visites terminées ne changent pas.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0383_stock_pieces_visite_retour.sql

-- 1. Camion d'un technicien dans une société, créé au besoin
create or replace function app.stock_camion(p_company uuid, p_profile uuid, p_creer boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_nom text;
begin
  if p_company is null or p_profile is null then return null; end if;
  select l.id into v_id from public.stock_locations l
  where l.company_id = p_company and l.kind = 'technicien' and l.profile_id = p_profile
  order by l.is_active desc limit 1;
  if v_id is null and p_creer then
    select coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.display_name, p.email) into v_nom
    from public.profiles p where p.id = p_profile;
    insert into public.stock_locations (company_id, kind, name, profile_id)
    values (p_company, 'technicien', 'Camion de ' || coalesce(v_nom, 'technicien'), p_profile)
    on conflict do nothing
    returning id into v_id;
    if v_id is null then
      select l.id into v_id from public.stock_locations l
      where l.company_id = p_company and l.kind = 'technicien' and l.profile_id = p_profile limit 1;
    end if;
  end if;
  return v_id;
end
$$;
revoke all on function app.stock_camion(uuid, uuid, boolean) from public, anon, authenticated;

-- Nouveau technicien (ou technicien réactivé) : son camion, si le stock existe pour cette société
create or replace function app.stock_camion_technicien()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active and (tg_op = 'INSERT' or not coalesce(old.is_active, false))
     and exists (select 1 from public.company_modules cm where cm.company_id = new.company_id and cm.key = 'stock' and cm.enabled) then
    perform app.stock_camion(new.company_id, new.profile_id, true);
  end if;
  return new;
end
$$;
revoke all on function app.stock_camion_technicien() from public, anon, authenticated;
drop trigger if exists itv_technicians_stock_camion on public.itv_technicians;
create trigger itv_technicians_stock_camion after insert or update of is_active on public.itv_technicians
  for each row execute function app.stock_camion_technicien();

-- 2. Pièce de visite reliée à l'article du stock et au camion du technicien
create or replace function app.stock_piece_visite_lien()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tech uuid;
begin
  if tg_op = 'UPDATE' and new.part_id is not distinct from old.part_id then return new; end if;
  if new.part_id is not null and (tg_op = 'UPDATE' or new.stock_item_id is null) then
    select i.id into new.stock_item_id from public.stock_items i
    where i.company_id = new.company_id and i.itv_part_id = new.part_id and i.is_active
    limit 1;
  end if;
  if new.stock_item_id is not null and new.stock_location_id is null then
    select v.technician_id into v_tech from public.itv_visits v where v.id = new.visit_id;
    new.stock_location_id := app.stock_camion(new.company_id, v_tech, true);
  end if;
  return new;
end
$$;
revoke all on function app.stock_piece_visite_lien() from public, anon, authenticated;
drop trigger if exists itv_visit_parts_stock_lien on public.itv_visit_parts;
create trigger itv_visit_parts_stock_lien before insert or update of part_id on public.itv_visit_parts
  for each row execute function app.stock_piece_visite_lien();

-- 3. Clôture : sortie du camion du technicien de la visite (créé au besoin), une seule fois par pièce
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
      v_loc := app.stock_camion((select i.company_id from public.stock_items i where i.id = r.stock_item_id), new.technician_id, true);
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

-- 4. Pièces des visites en cours ou à venir : reliées maintenant (écriture du système : le verrou des visites
-- terminées de 0381 ne concerne que les visites terminées, qui ne sont pas touchées)
update public.itv_visit_parts vp
set stock_item_id = i.id
from public.stock_items i, public.itv_visits v
where v.id = vp.visit_id and v.status <> 'terminee'
  and vp.stock_item_id is null and vp.part_id is not null
  and i.company_id = vp.company_id and i.itv_part_id = vp.part_id and i.is_active;

insert into public.schema_migrations (version) values ('0383_stock_pieces_visite') on conflict (version) do nothing;

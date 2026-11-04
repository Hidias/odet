-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (stock_0483) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0483_stock_emplacements_inactifs.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0483_stock_emplacements_inactifs_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0483_stock_emplacements_inactifs.sql =====
-- 0483 : emplacement de stock désactivé (suite de #271, relecture indépendante du 04/11).
-- 1. Les alertes de stock (v_stock_alerts) et la commande préparée depuis les alertes (stock_commande_depuis_alertes)
--    ignorent les emplacements inactifs : un emplacement fermé qui garde des seuils ne reste plus en alerte et ne
--    gonfle plus les quantités commandées.
-- 2. Emplacement d'un technicien : s'il existe mais a été désactivé, il est réactivé au lieu d'en créer un second
--    (sinon erreur de doublon sur stock_locations_tech_uniq quand un technicien réactivé ouvre « Mon stock »), et les
--    pièces posées pendant une visite sortent d'un emplacement visible (app.stock_camion, utilisée par la clôture).
--    Sans demande de création (p_creer = false), rien ne change : l'emplacement inactif n'est pas renvoyé.
-- Au 04/11 en production : aucun seuil, un seul emplacement inactif (sans technicien actif) : aucun effet immédiat.
-- Additive. Idempotente. Retour arrière : supabase/rollback/0483_stock_emplacements_inactifs_retour.sql

-- ── 1. Alertes : emplacements actifs seulement ──
create or replace view public.v_stock_alerts with (security_invoker = true) as
  select t.company_id, t.item_id, t.location_id, t.min_qty, t.target_qty, coalesce(l.quantity, 0) as quantity,
         greatest(0, coalesce(t.target_qty, t.min_qty) - coalesce(l.quantity, 0)) as to_order
  from public.stock_thresholds t
  join public.stock_locations s on s.id = t.location_id and s.is_active
  left join public.v_stock_levels l on l.item_id = t.item_id and l.location_id = t.location_id
  where coalesce(l.quantity, 0) < t.min_qty or coalesce(l.quantity, 0) < 0;
comment on view public.v_stock_alerts is 'Articles sous le seuil (ou en négatif) par emplacement actif, quantité à commander';
revoke all on public.v_stock_alerts from public, anon;
grant select on public.v_stock_alerts to authenticated;

create or replace function public.stock_commande_depuis_alertes(p_supplier uuid, p_location uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
  v_id uuid;
  v_prix boolean;
  v_n integer;
begin
  select s.company_id into v_co from public.suppliers s where s.id = p_supplier and s.archived_at is null;
  if v_co is null then raise exception 'Fournisseur introuvable' using errcode = 'P0002'; end if;
  v_prix := v_co in (select app.societes_avec_droit('stock.valeur.voir'));
  v_id := public.stock_commande_creer(p_supplier, p_location, 'Préparée depuis les alertes de stock');
  insert into public.purchase_order_lines (company_id, order_id, item_id, quantity, unit_price_ht, position)
  select v_co, v_id, a.item_id, a.qte, case when v_prix then c.purchase_price_ht end, row_number() over (order by i.label)
  from (select t.item_id, sum(greatest(0, coalesce(t.target_qty, t.min_qty) - coalesce(lv.quantity, 0))) as qte
        from public.stock_thresholds t
        join public.stock_locations el on el.id = t.location_id and el.is_active
        left join (select m.item_id, x.location_id, sum(x.sens * m.quantity) as quantity
                   from public.stock_movements m
                   cross join lateral (values (m.to_location_id, 1), (m.from_location_id, -1)) as x(location_id, sens)
                   where m.company_id = v_co and x.location_id is not null
                   group by m.item_id, x.location_id) lv on lv.item_id = t.item_id and lv.location_id = t.location_id
        where t.company_id = v_co and (p_location is null or t.location_id = p_location)
          and coalesce(lv.quantity, 0) < t.min_qty
        group by t.item_id) a
  join public.stock_items i on i.id = a.item_id and i.supplier_id = p_supplier and i.is_active
  left join public.stock_item_costs c on c.item_id = a.item_id
  where a.qte > 0;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Aucun article de ce fournisseur sous le seuil' using errcode = 'P0002';
  end if;
  return v_id;
end
$$;
revoke all on function public.stock_commande_depuis_alertes(uuid, uuid) from public, anon;
grant execute on function public.stock_commande_depuis_alertes(uuid, uuid) to authenticated;

-- ── 2. Emplacement du technicien : réactivé plutôt que recréé ──
create or replace function app.stock_mon_emplacement(p_creer boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid := app.current_company();
  v_id uuid;
  v_actif boolean;
  v_nom text;
begin
  select l.id, l.is_active into v_id, v_actif from public.stock_locations l
  where l.company_id = v_co and l.kind = 'technicien' and l.profile_id = (select auth.uid())
  order by l.is_active desc limit 1;
  if v_id is not null and not v_actif then
    if not p_creer then return null; end if;
    update public.stock_locations set is_active = true, updated_at = now() where id = v_id;
  end if;
  if v_id is null and p_creer then
    select coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.display_name, p.email) into v_nom
    from public.profiles p where p.id = (select auth.uid());
    insert into public.stock_locations (company_id, kind, name, profile_id)
    values (v_co, 'technicien', 'Stock de ' || coalesce(v_nom, 'technicien'), (select auth.uid()))
    returning id into v_id;
  end if;
  return v_id;
end
$$;
revoke all on function app.stock_mon_emplacement(boolean) from public, anon, authenticated;

create or replace function app.stock_camion(p_company uuid, p_profile uuid, p_creer boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_actif boolean;
  v_nom text;
begin
  if p_company is null or p_profile is null then return null; end if;
  select l.id, l.is_active into v_id, v_actif from public.stock_locations l
  where l.company_id = p_company and l.kind = 'technicien' and l.profile_id = p_profile
  order by l.is_active desc limit 1;
  if v_id is not null and not v_actif and p_creer then
    update public.stock_locations set is_active = true, updated_at = now() where id = v_id;
  end if;
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

insert into public.schema_migrations (version) values ('0483_stock_emplacements_inactifs') on conflict (version) do nothing;

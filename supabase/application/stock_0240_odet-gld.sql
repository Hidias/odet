-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (stock_0240) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0240_stock_socle.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0240_stock_socle_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0240_stock_socle.sql =====
-- 0240_stock_socle.sql : module Stock, socle (spec odet-spec-stock.md § 3 à 6, branches stock/catalogue-fournisseurs,
-- stock/mouvements et stock/interventions réunies).
--
-- Une seule source : la quantité n'est jamais saisie, elle découle des mouvements. Une écriture n'est jamais
-- modifiée ni supprimée : une erreur se corrige par un mouvement inverse.
--   - fournisseurs (suppliers), catégories (stock_categories), articles (stock_items) ; prix d'achat à part
--     (stock_item_costs), lus seulement avec « Voir les prix d'achat et la valeur du stock » ;
--   - emplacements (stock_locations) : dépôt (établissement), technicien (son compte), véhicule (en attendant le
--     module Véhicules : un nom), chantier ; seuils par article et emplacement (stock_thresholds) ;
--   - mouvements (stock_movements), écrits seulement par public.stock_mouvement() : entrée, sortie, transfert,
--     retour, perte ou casse, ajustement ; quantités par emplacement (v_stock_levels), alertes sous le seuil
--     (v_stock_alerts), valeur au coût moyen pondéré (v_stock_value, prix d'achat requis) ;
--   - « Mon stock » du technicien (public.stock_mon_stock, sans aucun prix) et articles du terrain
--     (public.stock_articles_terrain, sans aucun prix) ;
--   - visites d'intervention : une pièce de visite peut désigner un article du stock et l'emplacement d'où elle
--     sort ; à la clôture de la visite, les pièces sortent elles-mêmes (une seule fois par pièce) ; une sortie qui
--     passe sous zéro est acceptée (le terrain n'est pas bloqué) et signalée.
-- Reprise : les 6 pièces d'intervention (itv_parts) deviennent des articles de la catégorie « Pièces
-- d'intervention » (itv_parts reste lisible). Module « stock » ajouté, coupé : il s'active dans la Console.
-- Droits (build_suite('0240')) : voir regles.py, module Stock ; isolement par société ; journal par app.audit_row.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0240_stock_socle_retour.sql

insert into public.org_modules (key, label, enabled, position, description)
values ('stock', 'Stock et achats', false, 140, 'Articles, emplacements, mouvements, alertes de réapprovisionnement, fournisseurs')
on conflict (key) do nothing;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  siren text check (siren is null or siren ~ '^[0-9]{9}$'),
  contact_name text,
  email text,
  phone text,
  website text,
  payment_terms text,
  lead_time_days int check (lead_time_days is null or lead_time_days between 0 and 365),
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists suppliers_company_idx on public.suppliers (company_id);
comment on table public.suppliers is 'Fournisseurs du stock et des achats';

create table if not exists public.stock_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists stock_categories_company_idx on public.stock_categories (company_id);

create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  reference text,
  supplier_reference text,
  label text not null check (length(btrim(label)) > 0),
  category_id uuid references public.stock_categories(id) on delete set null,
  unit text not null default 'unité',
  sale_price_ht numeric(12,2) check (sale_price_ht is null or sale_price_ht >= 0),
  supplier_id uuid references public.suppliers(id) on delete set null,
  barcode text,
  serialized boolean not null default false,
  consumable boolean not null default true,
  itv_part_id uuid references public.itv_parts(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stock_items_company_idx on public.stock_items (company_id);
create unique index if not exists stock_items_ref_uniq on public.stock_items (company_id, reference) where reference is not null;
create unique index if not exists stock_items_part_uniq on public.stock_items (company_id, itv_part_id) where itv_part_id is not null;
comment on table public.stock_items is 'Articles du stock (le prix d''achat est dans stock_item_costs)';

create table if not exists public.stock_item_costs (
  item_id uuid primary key references public.stock_items(id) on delete cascade,
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  purchase_price_ht numeric(12,4) not null check (purchase_price_ht >= 0),
  updated_at timestamptz not null default now()
);
create index if not exists stock_item_costs_company_idx on public.stock_item_costs (company_id);
comment on table public.stock_item_costs is 'Prix d''achat de référence d''un article (droit « Voir les prix d''achat »)';

create table if not exists public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  kind text not null default 'depot' check (kind in ('depot', 'technicien', 'vehicule', 'chantier')),
  name text not null check (length(btrim(name)) > 0),
  establishment_id uuid references public.company_establishments(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stock_locations_company_idx on public.stock_locations (company_id);
create unique index if not exists stock_locations_tech_uniq on public.stock_locations (company_id, profile_id) where profile_id is not null and kind = 'technicien';
comment on table public.stock_locations is 'Emplacements : dépôt, technicien (son compte), véhicule, chantier';

create table if not exists public.stock_thresholds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  item_id uuid not null references public.stock_items(id) on delete cascade,
  location_id uuid not null references public.stock_locations(id) on delete cascade,
  min_qty numeric(12,3) not null default 0 check (min_qty >= 0),
  target_qty numeric(12,3) check (target_qty is null or target_qty >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, location_id)
);
create index if not exists stock_thresholds_company_idx on public.stock_thresholds (company_id);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  kind text not null check (kind in ('entree', 'sortie', 'transfert', 'retour', 'perte', 'ajustement')),
  item_id uuid not null references public.stock_items(id) on delete restrict,
  quantity numeric(12,3) not null check (quantity > 0),
  from_location_id uuid references public.stock_locations(id) on delete restrict,
  to_location_id uuid references public.stock_locations(id) on delete restrict,
  unit_cost numeric(12,4) check (unit_cost is null or unit_cost >= 0),
  serial text,
  source_table text,
  source_id uuid,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint stock_movements_emplacements check (
    (kind = 'entree' and to_location_id is not null and from_location_id is null)
    or (kind in ('sortie', 'perte') and from_location_id is not null and to_location_id is null)
    or (kind in ('transfert', 'retour') and from_location_id is not null and to_location_id is not null and from_location_id <> to_location_id)
    or (kind = 'ajustement' and ((from_location_id is null) <> (to_location_id is null))))
);
create index if not exists stock_movements_company_idx on public.stock_movements (company_id, created_at desc);
create index if not exists stock_movements_item_idx on public.stock_movements (item_id);
create unique index if not exists stock_movements_source_uniq on public.stock_movements (source_table, source_id) where source_table is not null and source_id is not null;
comment on table public.stock_movements is 'Mouvements du stock, jamais modifiés ni supprimés (correction par un mouvement inverse)';

alter table public.itv_visit_parts add column if not exists stock_item_id uuid references public.stock_items(id) on delete set null;
alter table public.itv_visit_parts add column if not exists stock_location_id uuid references public.stock_locations(id) on delete set null;

do $$
declare t text;
begin
  foreach t in array array['suppliers', 'stock_categories', 'stock_items', 'stock_locations', 'stock_thresholds'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_maj', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.hr_h_maj()', t || '_maj', t);
  end loop;
end $$;

-- Prix d'achat : même société que l'article ; date de mise à jour
create or replace function app.stock_cout_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select i.company_id into new.company_id from public.stock_items i where i.id = new.item_id;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.stock_cout_garde() from public, anon, authenticated;
drop trigger if exists stock_item_costs_garde on public.stock_item_costs;
create trigger stock_item_costs_garde before insert or update on public.stock_item_costs for each row execute function app.stock_cout_garde();

-- Mouvements : jamais modifiés ni supprimés
create or replace function app.stock_mouvement_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Un mouvement de stock ne se modifie pas : corrigez par un mouvement inverse' using errcode = '23514';
end
$$;
revoke all on function app.stock_mouvement_fige() from public, anon, authenticated;
drop trigger if exists stock_movements_fige on public.stock_movements;
create trigger stock_movements_fige before update or delete on public.stock_movements for each row execute function app.stock_mouvement_fige();

-- Emplacement du compte connecté (technicien) dans la société courante, créé au besoin
create or replace function app.stock_mon_emplacement(p_creer boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid := app.current_company();
  v_id uuid;
  v_nom text;
begin
  select l.id into v_id from public.stock_locations l
  where l.company_id = v_co and l.kind = 'technicien' and l.profile_id = (select auth.uid()) and l.is_active;
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

create or replace function app.stock_mes_emplacements()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id from public.stock_locations l where l.kind = 'technicien' and l.profile_id = (select auth.uid())
$$;
revoke all on function app.stock_mes_emplacements() from public, anon;
grant execute on function app.stock_mes_emplacements() to authenticated;

-- Quantités par article et emplacement (aux droits du lecteur : les règles de stock_movements filtrent)
create or replace view public.v_stock_levels with (security_invoker = true) as
  select m.company_id, x.location_id, m.item_id, sum(x.sens * m.quantity) as quantity
  from public.stock_movements m
  cross join lateral (values (m.to_location_id, 1), (m.from_location_id, -1)) as x(location_id, sens)
  where x.location_id is not null
  group by m.company_id, x.location_id, m.item_id;
comment on view public.v_stock_levels is 'Quantité par article et emplacement, calculée depuis les mouvements';
revoke all on public.v_stock_levels from public, anon;
grant select on public.v_stock_levels to authenticated;

create or replace view public.v_stock_alerts with (security_invoker = true) as
  select t.company_id, t.item_id, t.location_id, t.min_qty, t.target_qty, coalesce(l.quantity, 0) as quantity,
         greatest(0, coalesce(t.target_qty, t.min_qty) - coalesce(l.quantity, 0)) as to_order
  from public.stock_thresholds t
  left join public.v_stock_levels l on l.item_id = t.item_id and l.location_id = t.location_id
  where coalesce(l.quantity, 0) < t.min_qty or coalesce(l.quantity, 0) < 0;
comment on view public.v_stock_alerts is 'Articles sous le seuil (ou en négatif) par emplacement, quantité à commander';
revoke all on public.v_stock_alerts from public, anon;
grant select on public.v_stock_alerts to authenticated;

-- Valeur au coût moyen pondéré des entrées (prix de l'entrée, sinon prix de référence) : prix d'achat requis
create or replace view public.v_stock_value with (security_invoker = true) as
  with cmp as (
    select m.item_id, sum(m.quantity * coalesce(m.unit_cost, c.purchase_price_ht, 0)) / nullif(sum(m.quantity), 0) as cout_moyen
    from public.stock_movements m
    left join public.stock_item_costs c on c.item_id = m.item_id
    where m.kind = 'entree'
    group by m.item_id)
  select l.company_id, l.item_id, sum(l.quantity) as quantity,
         coalesce(cmp.cout_moyen, c.purchase_price_ht) as unit_cost,
         round(sum(l.quantity) * coalesce(cmp.cout_moyen, c.purchase_price_ht, 0), 2) as value
  from public.v_stock_levels l
  join public.stock_item_costs c on c.item_id = l.item_id
  left join cmp on cmp.item_id = l.item_id
  group by l.company_id, l.item_id, cmp.cout_moyen, c.purchase_price_ht;
comment on view public.v_stock_value is 'Valeur du stock par article au coût moyen pondéré (droit « Voir les prix d''achat »)';
revoke all on public.v_stock_value from public, anon;
grant select on public.v_stock_value to authenticated;

-- Écrire un mouvement. Droits : « Gérer les articles et les seuils » pour tout mouvement ; « Mouvementer son stock »
-- pour un mouvement qui part de son emplacement ou y arrive (prise au dépôt, retour, sortie, perte).
create or replace function public.stock_mouvement(p_kind text, p_item uuid, p_quantity numeric, p_from uuid, p_to uuid,
  p_note text default null, p_unit_cost numeric default null, p_serial text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
  v_id uuid;
  v_mien uuid;
begin
  select i.company_id into v_co from public.stock_items i where i.id = p_item and i.is_active;
  if v_co is null then raise exception 'Article introuvable' using errcode = 'P0002'; end if;
  if v_co not in (select app.societes_ecriture()) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if exists (select 1 from public.stock_locations l where l.id in (p_from, p_to) and l.company_id <> v_co) then
    raise exception 'Emplacement d''une autre société' using errcode = '23514';
  end if;
  if not (v_co in (select app.societes_avec_droit('stock.articles.gerer'))) then
    if not (v_co in (select app.societes_avec_droit('stock.sien.mouvementer'))) then
      raise exception 'Accès refusé' using errcode = '42501';
    end if;
    select l.id into v_mien from public.stock_locations l
    where l.company_id = v_co and l.kind = 'technicien' and l.profile_id = (select auth.uid()) and l.id in (p_from, p_to);
    if v_mien is null then raise exception 'Vous mouvementez seulement votre propre stock' using errcode = '42501'; end if;
    if p_kind in ('entree', 'ajustement') then raise exception 'Entrée et ajustement : réservés à qui gère le stock' using errcode = '42501'; end if;
    p_unit_cost := null;
  end if;
  insert into public.stock_movements (company_id, kind, item_id, quantity, from_location_id, to_location_id, unit_cost, serial, note)
  values (v_co, p_kind, p_item, p_quantity, p_from, p_to, p_unit_cost, nullif(btrim(coalesce(p_serial, '')), ''), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.stock_mouvement(text, uuid, numeric, uuid, uuid, text, numeric, text) from public, anon;
grant execute on function public.stock_mouvement(text, uuid, numeric, uuid, uuid, text, numeric, text) to authenticated;

-- Mon stock (technicien) : quantités de son emplacement, sans aucun prix ; l'emplacement est créé au premier appel
create or replace function public.stock_mon_stock()
returns table (location_id uuid, location_name text, item_id uuid, reference text, label text, unit text, quantity numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loc uuid;
begin
  if not (app.a_le_droit('stock.sien.mouvementer') or app.a_le_droit('stock.articles.gerer')) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  v_loc := app.stock_mon_emplacement(true);
  return query
    select v_loc, l.name, i.id, i.reference, i.label, i.unit, coalesce(q.quantity, 0)
    from public.stock_locations l
    cross join public.stock_items i
    left join lateral (select sum(case when m.to_location_id = v_loc then m.quantity else -m.quantity end) as quantity
                       from public.stock_movements m where m.item_id = i.id and v_loc in (m.from_location_id, m.to_location_id)) q on true
    where l.id = v_loc and i.company_id = l.company_id and i.is_active
      and (coalesce(q.quantity, 0) <> 0 or exists (select 1 from public.stock_thresholds t where t.item_id = i.id and t.location_id = v_loc))
    order by i.label;
end
$$;
revoke all on function public.stock_mon_stock() from public, anon;
grant execute on function public.stock_mon_stock() to authenticated;

-- Articles et emplacements du terrain (prise au dépôt, retour) : sans aucun prix
create or replace function public.stock_articles_terrain()
returns table (id uuid, reference text, label text, unit text, category text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.reference, i.label, i.unit, c.name
  from public.stock_items i left join public.stock_categories c on c.id = i.category_id
  where i.company_id = app.current_company() and i.is_active
    and (app.a_le_droit('stock.sien.mouvementer') or app.a_le_droit('stock.voir'))
  order by c.position nulls last, i.label
$$;
revoke all on function public.stock_articles_terrain() from public, anon;
grant execute on function public.stock_articles_terrain() to authenticated;

create or replace function public.stock_depots_terrain()
returns table (id uuid, name text, kind text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.name, l.kind from public.stock_locations l
  where l.company_id = app.current_company() and l.is_active and l.kind in ('depot', 'vehicule')
    and (app.a_le_droit('stock.sien.mouvementer') or app.a_le_droit('stock.voir'))
  order by l.kind, l.name
$$;
revoke all on function public.stock_depots_terrain() from public, anon;
grant execute on function public.stock_depots_terrain() to authenticated;

-- Visite terminée : les pièces reliées à un article sortent de leur emplacement (ou de celui du technicien de la
-- visite), une seule fois par pièce. Écrit par la base, quel que soit le compte qui clôt la visite.
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
drop trigger if exists itv_visits_stock_cloture on public.itv_visits;
create trigger itv_visits_stock_cloture after update of status on public.itv_visits for each row execute function app.stock_visite_cloture();

-- Catégories de départ et reprise des pièces d'intervention, pour chaque société (et chaque nouvelle)
create or replace function app.stock_depart(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat uuid;
begin
  insert into public.stock_categories (company_id, name, position)
  values (p_company, 'Pièces d''intervention', 1), (p_company, 'Extincteurs et matériel neuf', 2),
         (p_company, 'Consommables', 3), (p_company, 'Équipements de protection individuelle', 4)
  on conflict (company_id, name) do nothing;
  select id into v_cat from public.stock_categories where company_id = p_company and name = 'Pièces d''intervention';
  insert into public.stock_items (company_id, label, unit, sale_price_ht, category_id, itv_part_id, is_active)
  select p_company, p.name, p.unit, p.price_ht, v_cat, p.id, p.is_active
  from public.itv_parts p
  where p.company_id = p_company or p_company = any (coalesce(p.company_ids, '{}'))
  on conflict (company_id, itv_part_id) where itv_part_id is not null do nothing;
  insert into public.stock_locations (company_id, kind, name, establishment_id)
  select p_company, 'depot', 'Dépôt ' || coalesce(e.city, e.name, 'principal'), e.id
  from public.company_establishments e
  where e.company_id = p_company and e.is_main_site and e.status = 'active'
    and not exists (select 1 from public.stock_locations l where l.company_id = p_company and l.kind = 'depot');
end
$$;
revoke all on function app.stock_depart(uuid) from public, anon, authenticated;
select app.stock_depart(c.id) from public.companies c;

create or replace function app.stock_depart_societe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.stock_depart(new.id);
  return null;
end
$$;
revoke all on function app.stock_depart_societe() from public, anon, authenticated;
drop trigger if exists companies_stock_depart on public.companies;
create trigger companies_stock_depart after insert on public.companies for each row execute function app.stock_depart_societe();

-- Journal
do $$
declare r record;
begin
  for r in select * from (values ('suppliers', 'stock'), ('stock_items', 'stock'), ('stock_item_costs', 'stock'), ('stock_locations', 'stock'),
                                 ('stock_thresholds', 'stock'), ('stock_categories', 'stock')) as t(nom, type) loop
    execute format('drop trigger if exists zz_audit_row on public.%I', r.nom);
    execute format('create trigger zz_audit_row after insert or update or delete on public.%I for each row execute function app.audit_row(%L)', r.nom, r.type);
  end loop;
end $$;

-- ── Droits des tables ──
do $$
declare t text;
begin
  foreach t in array array['suppliers', 'stock_categories', 'stock_items', 'stock_item_costs', 'stock_locations', 'stock_thresholds', 'stock_movements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0240')) ──

-- Pose des règles d'une liste de tables : une règle par action, garde du module ajoutée ici.
-- Lecture : module actif, ou super administrateur. Écriture : module actif.
create or replace function pg_temp.regles(p_tables text[], p_module text, p_sel text, p_ins text, p_upd text, p_del text)
returns void
language plpgsql
as $f$
declare
  t text;
  v_on text;
  v_sel text := p_sel; v_ins text := p_ins; v_upd text := p_upd; v_del text := p_del;
begin
  if p_module is not null then
    select '(' || string_agg(format('(select app.module_on(%L))', m), ' or ') || ')' into v_on
    from unnest(string_to_array(p_module, '|')) m;
    if v_sel is not null then v_sel := format('((%s and %s) or (select app.is_superadmin()))', v_on, v_sel); end if;
    if v_ins is not null then v_ins := format('(%s and %s)', v_on, v_ins); end if;
    if v_upd is not null then v_upd := format('(%s and %s)', v_on, v_upd); end if;
    if v_del is not null then v_del := format('(%s and %s)', v_on, v_del); end if;
  end if;
  foreach t in array p_tables loop
    execute format('alter table public.%I enable row level security', t);
    if v_sel is not null then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_lire', t, v_sel);
    end if;
    if v_ins is not null then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_creer', t, v_ins);
    end if;
    if v_upd is not null then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_modifier', t, v_upd, v_upd);
    end if;
    if v_del is not null then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_supprimer', t, v_del);
    end if;
  end loop;
end
$f$;

-- Suppression des règles nommées du générateur (lire, créer, modifier, supprimer) ; les autres règles
-- (règle restrictive des notifications de 0070, etc.) ne sont pas touchées
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['stock_categories', 'stock_item_costs', 'stock_items', 'stock_locations', 'stock_movements', 'stock_thresholds', 'suppliers'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- stock_categories
select pg_temp.regles(array['stock_categories'], null,
  $r$(company_id in (select app.societes_avec_droit('stock.voir')) or company_id in (select app.societes_avec_droit('stock.sien.mouvementer')))$r$,
  $r$company_id in (select app.societes_avec_droit('stock.articles.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('stock.articles.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('stock.articles.gerer'))$r$);

-- stock_item_costs
select pg_temp.regles(array['stock_item_costs'], null,
  $r$company_id in (select app.societes_avec_droit('stock.valeur.voir'))$r$,
  $r$(company_id in (select app.societes_avec_droit('stock.articles.gerer')) and company_id in (select app.societes_avec_droit('stock.valeur.voir')))$r$,
  $r$(company_id in (select app.societes_avec_droit('stock.articles.gerer')) and company_id in (select app.societes_avec_droit('stock.valeur.voir')))$r$,
  $r$(company_id in (select app.societes_avec_droit('stock.articles.gerer')) and company_id in (select app.societes_avec_droit('stock.valeur.voir')))$r$);

-- stock_items, stock_thresholds, suppliers
select pg_temp.regles(array['stock_items', 'stock_thresholds', 'suppliers'], null,
  $r$company_id in (select app.societes_avec_droit('stock.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('stock.articles.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('stock.articles.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('stock.articles.gerer'))$r$);

-- stock_locations
select pg_temp.regles(array['stock_locations'], null,
  $r$(company_id in (select app.societes_avec_droit('stock.voir')) or id in (select app.stock_mes_emplacements()))$r$,
  $r$company_id in (select app.societes_avec_droit('stock.articles.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('stock.articles.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('stock.articles.gerer'))$r$);

-- stock_movements
select pg_temp.regles(array['stock_movements'], null,
  $r$(company_id in (select app.societes_avec_droit('stock.voir')) or from_location_id in (select app.stock_mes_emplacements()) or to_location_id in (select app.stock_mes_emplacements()))$r$,
  null,
  null,
  null);


do $$
declare t text;
begin
  foreach t in array array['suppliers', 'stock_categories', 'stock_items', 'stock_item_costs', 'stock_locations', 'stock_thresholds', 'stock_movements'] loop
    execute format('drop policy if exists %I on public.%I', t || '_societe_lire', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_creer', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_modifier', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_supprimer', t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (company_id in (select app.societes_lisibles()))', t || '_societe_lire', t);
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (company_id in (select app.societes_ecriture()))', t || '_societe_creer', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()))', t || '_societe_modifier', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using (company_id in (select app.societes_ecriture()))', t || '_societe_supprimer', t);
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0240_stock_socle') on conflict (version) do nothing;

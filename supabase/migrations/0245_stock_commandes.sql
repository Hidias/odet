-- 0245_stock_commandes.sql : module Stock, commandes aux fournisseurs (spec odet-spec-stock.md § 3 à 6, branche
-- stock/commandes, migrations 0245-0246 réunies).
--
--   - commandes (purchase_orders) et lignes (purchase_order_lines) : brouillon, à valider, validée, envoyée, en partie
--     reçue, reçue, refusée, annulée. Une commande se prépare depuis les alertes (articles sous le seuil d'un
--     fournisseur) ou à la main ; elle passe par le circuit de validation commun (approval_requests, périmètre
--     « purchase_order », réglé dans Règles de gestion : par défaut tout est validé) ;
--   - « Envoyée » se coche quand la commande est partie : la base n'envoie rien au fournisseur ;
--   - réceptions (purchase_receipts), partielles ou totales : chacune écrit l'entrée en stock au prix de la ligne
--     (coût moyen pondéré) ; rapprochement avec la facture du fournisseur (référence, date, montant HT) ;
--   - les prix d'achat ne se lisent qu'avec « Valider les commandes » ou « Voir les prix d'achat » ; qui prépare sans
--     voir les prix (technicien) fait une demande sans prix et ne voit que ses propres demandes ;
--   - modifications seulement sur un brouillon ou une commande refusée ; les statuts passent par les fonctions ;
--   - la purge des données de démonstration couvre le stock (articles, emplacements, fournisseurs, commandes
--     inscrits dans demo_records, avec leurs mouvements) ; elle seule peut effacer un mouvement.
-- Droits (build_suite('0245')) : voir regles.py, module Stock ; isolement par société ; journal par app.audit_row.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0245_stock_commandes_retour.sql

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  reference text,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  location_id uuid references public.stock_locations(id) on delete restrict,
  status text not null default 'brouillon'
    check (status in ('brouillon', 'a_valider', 'validee', 'envoyee', 'partielle', 'recue', 'refusee', 'annulee')),
  approval_id uuid references public.approval_requests(id) on delete set null,
  total_ht numeric(12,2) not null default 0,
  expected_on date,
  notes text,
  validated_by uuid,
  validated_at timestamptz,
  refusal_reason text,
  sent_at timestamptz,
  received_at timestamptz,
  supplier_invoice_ref text,
  supplier_invoice_on date,
  supplier_invoice_ht numeric(12,2) check (supplier_invoice_ht is null or supplier_invoice_ht >= 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchase_orders_company_idx on public.purchase_orders (company_id, created_at desc);
create unique index if not exists purchase_orders_ref_uniq on public.purchase_orders (company_id, reference) where reference is not null;
comment on table public.purchase_orders is 'Commandes aux fournisseurs (statuts écrits par les fonctions stock_commande_*)';

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid not null references public.stock_items(id) on delete restrict,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price_ht numeric(12,4) check (unit_price_ht is null or unit_price_ht >= 0),
  received_qty numeric(12,3) not null default 0,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchase_order_lines_order_idx on public.purchase_order_lines (order_id);
create index if not exists purchase_order_lines_company_idx on public.purchase_order_lines (company_id);
comment on table public.purchase_order_lines is 'Lignes de commande (prix d''achat : droit des prix d''achat)';

create table if not exists public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  line_id uuid not null references public.purchase_order_lines(id) on delete cascade,
  quantity numeric(12,3) not null check (quantity > 0),
  location_id uuid not null references public.stock_locations(id) on delete restrict,
  note text,
  received_by uuid default auth.uid(),
  received_at timestamptz not null default now()
);
create index if not exists purchase_receipts_order_idx on public.purchase_receipts (order_id);
create index if not exists purchase_receipts_company_idx on public.purchase_receipts (company_id);
comment on table public.purchase_receipts is 'Réceptions de commandes ; chacune écrit une entrée en stock';

do $$
declare t text;
begin
  foreach t in array array['purchase_orders', 'purchase_order_lines'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_maj', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.hr_h_maj()', t || '_maj', t);
  end loop;
end $$;

-- Mes commandes (celles que j'ai préparées) : sert aux règles de qui prépare sans voir les prix
create or replace function app.stock_mes_commandes()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id from public.purchase_orders o where o.created_by = (select auth.uid())
$$;
revoke all on function app.stock_mes_commandes() from public, anon;
grant execute on function app.stock_mes_commandes() to authenticated;

-- Commande : numéro, même société que le fournisseur et le dépôt ; statut et validation écrits seulement par les
-- fonctions (réglage local app.stock_commande) ; contenu modifiable sur un brouillon ou une commande refusée ;
-- la note et la facture du fournisseur restent modifiables.
create or replace function app.stock_commande_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fn boolean := coalesce(current_setting('app.stock_commande', true), '') = 'on';
  v_n integer;
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.stock_purge', true), '') = 'on' then return old; end if;
    if old.status not in ('brouillon', 'refusee', 'annulee') or exists (select 1 from public.purchase_receipts r where r.order_id = old.id) then
      raise exception 'Seul un brouillon, une commande refusée ou annulée sans réception se supprime' using errcode = '23514';
    end if;
    return old;
  end if;
  if not exists (select 1 from public.suppliers s where s.id = new.supplier_id and s.company_id = new.company_id) then
    raise exception 'Fournisseur d''une autre société' using errcode = '23514';
  end if;
  if new.location_id is not null and not exists (select 1 from public.stock_locations l where l.id = new.location_id and l.company_id = new.company_id) then
    raise exception 'Emplacement d''une autre société' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if not v_fn then
      new.status := 'brouillon'; new.approval_id := null; new.validated_by := null; new.validated_at := null;
      new.sent_at := null; new.received_at := null; new.refusal_reason := null; new.total_ht := 0;
    end if;
    new.created_by := coalesce(new.created_by, (select auth.uid()));
    if new.reference is null then
      select count(*) + 1 into v_n from public.purchase_orders o
      where o.company_id = new.company_id and o.reference like 'CMD-' || to_char(now(), 'YYYYMMDD') || '-%';
      new.reference := 'CMD-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_n::text, 2, '0');
    end if;
    return new;
  end if;
  new.reference := old.reference;
  new.created_by := old.created_by;
  if not v_fn then
    if new.status is distinct from old.status or new.approval_id is distinct from old.approval_id
       or new.validated_by is distinct from old.validated_by or new.validated_at is distinct from old.validated_at
       or new.sent_at is distinct from old.sent_at or new.received_at is distinct from old.received_at
       or new.refusal_reason is distinct from old.refusal_reason or new.total_ht is distinct from old.total_ht then
      raise exception 'Le statut d''une commande change par ses boutons (soumettre, envoyée, recevoir, annuler)' using errcode = '42501';
    end if;
    if old.status not in ('brouillon', 'refusee')
       and (new.supplier_id is distinct from old.supplier_id or new.location_id is distinct from old.location_id
            or new.expected_on is distinct from old.expected_on) then
      raise exception 'Commande déjà soumise : elle ne se modifie plus (annulez-la et refaites-en une)' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.stock_commande_garde() from public, anon, authenticated;
drop trigger if exists purchase_orders_garde on public.purchase_orders;
create trigger purchase_orders_garde before insert or update or delete on public.purchase_orders for each row execute function app.stock_commande_garde();

-- Ligne : même société que la commande et l'article ; seulement sur un brouillon ou une commande refusée ;
-- sans le droit des prix d'achat, le prix n'est ni écrit ni changé ; quantité reçue écrite par la réception
create or replace function app.stock_ligne_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fn boolean := coalesce(current_setting('app.stock_commande', true), '') = 'on';
  v_cmd public.purchase_orders;
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.stock_purge', true), '') = 'on' then return old; end if;
    select * into v_cmd from public.purchase_orders where id = old.order_id;
    if v_cmd.id is not null and v_cmd.status not in ('brouillon', 'refusee') and not v_fn then
      raise exception 'Commande déjà soumise : ses lignes ne se modifient plus' using errcode = '23514';
    end if;
    return old;
  end if;
  select * into v_cmd from public.purchase_orders where id = new.order_id;
  if v_cmd.id is null then raise exception 'Commande introuvable' using errcode = 'P0002'; end if;
  new.company_id := v_cmd.company_id;
  if not exists (select 1 from public.stock_items i where i.id = new.item_id and i.company_id = v_cmd.company_id) then
    raise exception 'Article d''une autre société' using errcode = '23514';
  end if;
  if not v_fn then
    if v_cmd.status not in ('brouillon', 'refusee') then
      raise exception 'Commande déjà soumise : ses lignes ne se modifient plus' using errcode = '23514';
    end if;
    if not (v_cmd.company_id in (select app.societes_avec_droit('stock.valeur.voir'))) then
      new.unit_price_ht := case when tg_op = 'UPDATE' then old.unit_price_ht else null end;
    end if;
    new.received_qty := case when tg_op = 'UPDATE' then old.received_qty else 0 end;
    if tg_op = 'UPDATE' then new.order_id := old.order_id; end if;
  end if;
  return new;
end
$$;
revoke all on function app.stock_ligne_garde() from public, anon, authenticated;
drop trigger if exists purchase_order_lines_garde on public.purchase_order_lines;
create trigger purchase_order_lines_garde before insert or update or delete on public.purchase_order_lines for each row execute function app.stock_ligne_garde();

-- Total HT de la commande, recalculé à chaque ligne
create or replace function app.stock_commande_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cmd uuid := coalesce(new.order_id, old.order_id);
  v_avant text := coalesce(current_setting('app.stock_commande', true), '');
begin
  perform set_config('app.stock_commande', 'on', true);
  update public.purchase_orders o
  set total_ht = coalesce((select round(sum(l.quantity * coalesce(l.unit_price_ht, 0)), 2) from public.purchase_order_lines l where l.order_id = v_cmd), 0)
  where o.id = v_cmd;
  perform set_config('app.stock_commande', v_avant, true);
  return null;
end
$$;
revoke all on function app.stock_commande_total() from public, anon, authenticated;
drop trigger if exists purchase_order_lines_total on public.purchase_order_lines;
create trigger purchase_order_lines_total after insert or update or delete on public.purchase_order_lines for each row execute function app.stock_commande_total();

-- Mouvements : la purge de démonstration (et elle seule) peut en effacer
create or replace function app.stock_mouvement_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.stock_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'Un mouvement de stock ne se modifie pas : corrigez par un mouvement inverse' using errcode = '23514';
end
$$;
revoke all on function app.stock_mouvement_fige() from public, anon, authenticated;

-- Commande d'une société : contrôle commun aux fonctions
create or replace function app.stock_commande_lire(p_order uuid, p_droit text)
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.purchase_orders;
begin
  select * into v from public.purchase_orders where id = p_order for update;
  if v.id is null then raise exception 'Commande introuvable' using errcode = 'P0002'; end if;
  if not (v.company_id in (select app.societes_ecriture())) or not (v.company_id in (select app.societes_avec_droit(p_droit))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return v;
end
$$;
revoke all on function app.stock_commande_lire(uuid, text) from public, anon, authenticated;

-- Nouvelle commande (brouillon) ; dépôt de réception : celui donné, sinon le premier dépôt actif
create or replace function public.stock_commande_creer(p_supplier uuid, p_location uuid default null, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
  v_loc uuid := p_location;
  v_id uuid;
begin
  select s.company_id into v_co from public.suppliers s where s.id = p_supplier and s.archived_at is null;
  if v_co is null then raise exception 'Fournisseur introuvable' using errcode = 'P0002'; end if;
  if not (v_co in (select app.societes_ecriture())) or not (v_co in (select app.societes_avec_droit('stock.commandes.preparer'))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if v_loc is null then
    select l.id into v_loc from public.stock_locations l where l.company_id = v_co and l.kind = 'depot' and l.is_active order by l.created_at limit 1;
  end if;
  insert into public.purchase_orders (company_id, supplier_id, location_id, notes, created_by)
  values (v_co, p_supplier, v_loc, nullif(btrim(coalesce(p_notes, '')), ''), (select auth.uid()))
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.stock_commande_creer(uuid, uuid, text) from public, anon;
grant execute on function public.stock_commande_creer(uuid, uuid, text) to authenticated;

-- Commande préparée depuis les alertes : articles de ce fournisseur sous le seuil, quantité à commander,
-- prix d'achat de référence si le droit des prix d'achat le permet
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

-- Soumettre : passe par le circuit de validation (montant HT) ; sans validation demandée, validée tout de suite
create or replace function public.stock_commande_soumettre(p_order uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.purchase_orders;
  v_appro uuid;
  v_fourn text;
begin
  v := app.stock_commande_lire(p_order, 'stock.commandes.preparer');
  if v.status not in ('brouillon', 'refusee') then raise exception 'Commande déjà soumise' using errcode = '22023'; end if;
  if v.company_id is distinct from app.current_company() then
    raise exception 'Ouvrez la société de la commande pour la soumettre' using errcode = '22023';
  end if;
  if not exists (select 1 from public.purchase_order_lines l where l.order_id = v.id) then
    raise exception 'Commande sans ligne' using errcode = '22023';
  end if;
  select s.name into v_fourn from public.suppliers s where s.id = v.supplier_id;
  v_appro := public.approval_submit('purchase_order', 'purchase_orders', v.id, v.total_ht, null,
    left('Commande ' || v.reference || ' : ' || coalesce(v_fourn, ''), 200));
  perform set_config('app.stock_commande', 'on', true);
  if v_appro is null then
    update public.purchase_orders set status = 'validee', approval_id = null, refusal_reason = null,
      validated_by = (select auth.uid()), validated_at = now() where id = v.id;
  else
    update public.purchase_orders set status = 'a_valider', approval_id = v_appro, refusal_reason = null where id = v.id;
  end if;
  perform set_config('app.stock_commande', '', true);
  return case when v_appro is null then 'validee' else 'a_valider' end;
end
$$;
revoke all on function public.stock_commande_soumettre(uuid) from public, anon;
grant execute on function public.stock_commande_soumettre(uuid) to authenticated;

-- Décision prise dans le circuit commun (approval_decide) : reportée sur la commande
create or replace function app.stock_commande_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.object_table = 'purchase_orders' and new.status is distinct from old.status then
    perform set_config('app.stock_commande', 'on', true);
    if new.status = 'approved' then
      update public.purchase_orders set status = 'validee', validated_by = new.decided_by, validated_at = now()
      where id = new.object_id and status = 'a_valider';
    elsif new.status = 'rejected' then
      update public.purchase_orders set status = 'refusee', refusal_reason = new.decision_comment
      where id = new.object_id and status = 'a_valider';
    elsif new.status = 'cancelled' then
      update public.purchase_orders set status = 'brouillon', approval_id = null
      where id = new.object_id and status = 'a_valider';
    end if;
    perform set_config('app.stock_commande', '', true);
  end if;
  return null;
end
$$;
revoke all on function app.stock_commande_decision() from public, anon, authenticated;
drop trigger if exists stock_commande_decision on public.approval_requests;
create trigger stock_commande_decision after update of status on public.approval_requests
  for each row execute function app.stock_commande_decision();

-- Envoyée : la commande est partie chez le fournisseur (la base n'envoie rien)
create or replace function public.stock_commande_envoyee(p_order uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.purchase_orders;
begin
  v := app.stock_commande_lire(p_order, 'stock.commandes.preparer');
  if v.status <> 'validee' then raise exception 'Seule une commande validée se marque envoyée' using errcode = '22023'; end if;
  perform set_config('app.stock_commande', 'on', true);
  update public.purchase_orders set status = 'envoyee', sent_at = now() where id = v.id;
  perform set_config('app.stock_commande', '', true);
  return 'envoyee';
end
$$;
revoke all on function public.stock_commande_envoyee(uuid) from public, anon;
grant execute on function public.stock_commande_envoyee(uuid) to authenticated;

-- Réception d'une ligne (partielle ou totale) : entrée en stock au prix de la ligne, statut de la commande
create or replace function public.stock_commande_recevoir(p_line uuid, p_quantity numeric, p_location uuid default null, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.purchase_order_lines;
  v public.purchase_orders;
  v_loc uuid;
  v_rec uuid;
  v_statut text;
begin
  select * into l from public.purchase_order_lines where id = p_line;
  if l.id is null then raise exception 'Ligne introuvable' using errcode = 'P0002'; end if;
  select * into v from public.purchase_orders where id = l.order_id for update;
  if not (v.company_id in (select app.societes_ecriture()))
     or not (v.company_id in (select app.societes_avec_droit('stock.commandes.preparer'))
             or v.company_id in (select app.societes_avec_droit('stock.articles.gerer'))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if v.status not in ('validee', 'envoyee', 'partielle') then
    raise exception 'Seule une commande validée ou envoyée se réceptionne' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Indiquez une quantité supérieure à zéro' using errcode = '22023'; end if;
  v_loc := coalesce(p_location, v.location_id);
  if v_loc is null or not exists (select 1 from public.stock_locations s where s.id = v_loc and s.company_id = v.company_id and s.is_active) then
    raise exception 'Choisissez l''emplacement de réception' using errcode = '22023';
  end if;
  insert into public.purchase_receipts (company_id, order_id, line_id, quantity, location_id, note)
  values (v.company_id, v.id, l.id, p_quantity, v_loc, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_rec;
  insert into public.stock_movements (company_id, kind, item_id, quantity, to_location_id, unit_cost, source_table, source_id, note, created_by)
  values (v.company_id, 'entree', l.item_id, p_quantity, v_loc, l.unit_price_ht, 'purchase_receipts', v_rec,
          'Commande ' || v.reference, (select auth.uid()));
  perform set_config('app.stock_commande', 'on', true);
  update public.purchase_order_lines set received_qty = received_qty + p_quantity where id = l.id;
  v_statut := case when exists (select 1 from public.purchase_order_lines x where x.order_id = v.id and x.received_qty < x.quantity)
                   then 'partielle' else 'recue' end;
  update public.purchase_orders set status = v_statut, received_at = case when v_statut = 'recue' then now() else received_at end
  where id = v.id;
  perform set_config('app.stock_commande', '', true);
  return v_statut;
end
$$;
revoke all on function public.stock_commande_recevoir(uuid, numeric, uuid, text) from public, anon;
grant execute on function public.stock_commande_recevoir(uuid, numeric, uuid, text) to authenticated;

-- Annuler (avant toute réception), ou solder une commande en partie reçue (le reste ne viendra pas)
create or replace function public.stock_commande_annuler(p_order uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.purchase_orders;
  v_statut text;
begin
  v := app.stock_commande_lire(p_order, 'stock.commandes.preparer');
  if v.status in ('recue', 'annulee') then raise exception 'Commande déjà close' using errcode = '22023'; end if;
  if v.approval_id is not null and v.status = 'a_valider' then
    update public.approval_requests set status = 'cancelled', updated_at = now(),
      history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', (select auth.uid()), 'action', 'cancelled'))
    where id = v.approval_id and status = 'pending';
  end if;
  v_statut := case when v.status = 'partielle' then 'recue' else 'annulee' end;
  perform set_config('app.stock_commande', 'on', true);
  update public.purchase_orders set status = v_statut, received_at = case when v_statut = 'recue' then now() else received_at end
  where id = v.id;
  perform set_config('app.stock_commande', '', true);
  return v_statut;
end
$$;
revoke all on function public.stock_commande_annuler(uuid) from public, anon;
grant execute on function public.stock_commande_annuler(uuid) to authenticated;

-- Purge des données de démonstration : celle de 0315, plus le stock (articles, emplacements, fournisseurs, commandes
-- inscrits dans demo_records, avec leurs mouvements, seuils, prix et réceptions)
create or replace function public.purge_demo_data()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sessions uuid[]; v_trainees uuid[]; v_clients uuid[]; v_invoices uuid[]; v_quotes uuid[];
  v_rdv uuid[]; v_trainers uuid[]; v_veille uuid[];
  v_hr uuid[];
  v_st uuid[]; v_loc uuid[]; v_sup uuid[]; v_cmd uuid[];
  r record; v_pass int; v_left int; v_done jsonb := '{}'::jsonb; v_n int; v_blocked text[];
begin
  if not public.is_superadmin() then
    raise exception 'Réservé au super administrateur' using errcode = '42501';
  end if;
  select array_agg(id) filter (where tbl = 'sessions'), array_agg(id) filter (where tbl = 'trainees'),
         array_agg(id) filter (where tbl = 'clients'), array_agg(id) filter (where tbl = 'invoices'),
         array_agg(id) filter (where tbl = 'quotes'), array_agg(id) filter (where tbl = 'prospect_rdv'),
         array_agg(id) filter (where tbl = 'trainers'), array_agg(id) filter (where tbl = 'veille_qualiopi')
    into v_sessions, v_trainees, v_clients, v_invoices, v_quotes, v_rdv, v_trainers, v_veille
  from demo_records;
  v_sessions := coalesce(v_sessions, '{}'); v_trainees := coalesce(v_trainees, '{}'); v_clients := coalesce(v_clients, '{}');
  v_invoices := coalesce(v_invoices, '{}'); v_quotes := coalesce(v_quotes, '{}'); v_rdv := coalesce(v_rdv, '{}');
  v_trainers := coalesce(v_trainers, '{}'); v_veille := coalesce(v_veille, '{}');
  -- Les factures et devis liés aux sessions et clients de démonstration sont aussi de la démonstration
  v_invoices := v_invoices || coalesce((select array_agg(id) from invoices where session_id = any(v_sessions) or client_id = any(v_clients)), '{}');
  v_quotes := v_quotes || coalesce((select array_agg(id) from quotes where session_id = any(v_sessions) or client_id = any(v_clients)), '{}');
  -- Liens croisés (session <-> devis, devis <-> facture) : coupés d'abord, sinon chacun bloque l'autre
  update sessions set quote_id = null, subcontract_invoice_id = null where id = any(v_sessions);
  update quotes set session_id = null where id = any(v_quotes);
  update invoices set quote_id = null, parent_invoice_id = null where id = any(v_invoices);
  update prospect_rdv set session_id = null, quote_id = null where id = any(v_rdv);
  -- Plusieurs passes : une suppression bloquée par une clé étrangère est retentée à la passe suivante
  for v_pass in 1..6 loop
    v_left := 0; v_blocked := '{}';
    for r in
      select c.table_name, c.column_name
      from information_schema.columns c join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.data_type = 'uuid'
        and c.column_name in ('session_id', 'trainee_id', 'client_id', 'invoice_id', 'quote_id', 'rdv_id', 'parent_invoice_id', 'billing_client_id')
        and c.table_name not in ('demo_records', 'profiles', 'courses')
      order by c.table_name
    loop
      begin
        execute format('delete from public.%I where %I = any($1)', r.table_name, r.column_name)
          using case r.column_name
            when 'session_id' then v_sessions when 'trainee_id' then v_trainees
            when 'client_id' then v_clients when 'billing_client_id' then v_clients
            when 'invoice_id' then v_invoices when 'parent_invoice_id' then v_invoices
            when 'quote_id' then v_quotes else v_rdv end;
        get diagnostics v_n = row_count;
        if v_n > 0 then v_done := v_done || jsonb_build_object(r.table_name, coalesce((v_done->>r.table_name)::int, 0) + v_n); end if;
      exception when foreign_key_violation then
        v_left := v_left + 1; v_blocked := v_blocked || (r.table_name || '.' || r.column_name);
      end;
    end loop;
    begin delete from invoices where id = any(v_invoices); exception when foreign_key_violation then v_left := v_left + 1; v_blocked := v_blocked || 'invoices'::text; end;
    begin delete from quotes where id = any(v_quotes); exception when foreign_key_violation then v_left := v_left + 1; v_blocked := v_blocked || 'quotes'::text; end;
    begin delete from prospect_rdv where id = any(v_rdv); exception when foreign_key_violation then v_left := v_left + 1; v_blocked := v_blocked || 'prospect_rdv'::text; end;
    begin delete from sessions where id = any(v_sessions); exception when foreign_key_violation then v_left := v_left + 1; v_blocked := v_blocked || 'sessions'::text; end;
    begin delete from trainees where id = any(v_trainees); exception when foreign_key_violation then v_left := v_left + 1; v_blocked := v_blocked || 'trainees'::text; end;
    begin delete from clients where id = any(v_clients); exception when foreign_key_violation then v_left := v_left + 1; v_blocked := v_blocked || 'clients'::text; end;
    begin
      delete from trainer_trainings where trainer_id = any(v_trainers);
      delete from trainer_interviews where trainer_id = any(v_trainers);
      delete from trainer_certificates where trainer_id = any(v_trainers);
      update sessions set trainer_id = null where trainer_id = any(v_trainers);
      delete from session_trainers where trainer_id = any(v_trainers);
      update courses set default_trainer_id = null where default_trainer_id = any(v_trainers);
      update profiles set trainer_id = null where trainer_id = any(v_trainers);
      delete from trainers where id = any(v_trainers);
    exception when foreign_key_violation then v_left := v_left + 1; v_blocked := v_blocked || 'trainers'::text; end;
    delete from veille_qualiopi where id = any(v_veille);
    exit when v_left = 0;
  end loop;

  if v_left > 0 then
    raise exception 'Purge incomplète : % suppression(s) bloquée(s) (%), rien n''a été effacé', v_left, array_to_string(v_blocked, ', ');
  end if;

  -- RH (0315) : fiches du personnel et équipes de démonstration, avec ce qui leur est rattaché (contrats, absences,
  -- heures, documents et leurs fichiers, habilitations, visites, entretiens) ; les validations du circuit commun aussi
  if to_regclass('public.hr_people') is not null then
    select array_agg(id) into v_hr from demo_records where tbl = 'hr_people';
    if v_hr is not null then
      delete from approval_requests
      where (object_table = 'hr_absence_requests' and object_id in (select id from hr_absence_requests where person_id = any(v_hr)))
         or (object_table = 'hr_timesheets' and object_id in (select id from hr_timesheets where person_id = any(v_hr)));
      if to_regclass('public.hr_documents') is not null then
        perform set_config('storage.allow_delete_query', 'true', true);
        delete from storage.objects where bucket_id = 'rh' and split_part(name, '/', 2) in (select x::text from unnest(v_hr) x);
      end if;
      delete from hr_people where id = any(v_hr);
      v_done := v_done || jsonb_build_object('hr_people', cardinality(v_hr));
    end if;
    delete from hr_teams where id in (select id from demo_records where tbl = 'hr_teams');
  end if;

  -- Stock (0245) : commandes, puis mouvements, articles, emplacements et fournisseurs de démonstration ; seule la
  -- purge peut effacer un mouvement (réglage local app.stock_purge)
  if to_regclass('public.stock_items') is not null then
    select array_agg(id) filter (where tbl = 'stock_items'), array_agg(id) filter (where tbl = 'stock_locations'),
           array_agg(id) filter (where tbl = 'suppliers'), array_agg(id) filter (where tbl = 'purchase_orders')
      into v_st, v_loc, v_sup, v_cmd
    from demo_records;
    v_st := coalesce(v_st, '{}'); v_loc := coalesce(v_loc, '{}'); v_sup := coalesce(v_sup, '{}'); v_cmd := coalesce(v_cmd, '{}');
    if cardinality(v_st) + cardinality(v_loc) + cardinality(v_sup) + cardinality(v_cmd) > 0 then
      perform set_config('app.stock_purge', 'on', true);
      if to_regclass('public.purchase_orders') is not null then
        v_cmd := v_cmd || coalesce((select array_agg(o.id) from purchase_orders o where o.supplier_id = any(v_sup) or o.location_id = any(v_loc)
                                      or o.id in (select l.order_id from purchase_order_lines l where l.item_id = any(v_st))), '{}');
        delete from approval_requests where object_table = 'purchase_orders' and object_id = any(v_cmd);
        delete from stock_movements where source_table = 'purchase_receipts'
          and source_id in (select pr.id from purchase_receipts pr where pr.order_id = any(v_cmd));
        delete from purchase_orders where id = any(v_cmd);
      end if;
      delete from stock_movements where item_id = any(v_st) or from_location_id = any(v_loc) or to_location_id = any(v_loc);
      update itv_visit_parts set stock_item_id = null where stock_item_id = any(v_st);
      update itv_visit_parts set stock_location_id = null where stock_location_id = any(v_loc);
      delete from stock_items where id = any(v_st);
      delete from stock_locations where id = any(v_loc);
      delete from suppliers where id = any(v_sup);
      perform set_config('app.stock_purge', '', true);
      v_done := v_done || jsonb_build_object('stock_items', cardinality(v_st), 'purchase_orders', cardinality(v_cmd));
    end if;
  end if;

  delete from demo_records;
  return jsonb_build_object('ok', true, 'detail', v_done);
end $$;

revoke all on function public.purge_demo_data() from public, anon;
grant execute on function public.purge_demo_data() to authenticated;

-- Journal
do $$
declare r record;
begin
  for r in select * from (values ('purchase_orders', 'stock'), ('purchase_order_lines', 'stock'), ('purchase_receipts', 'stock')) as t(nom, type) loop
    execute format('drop trigger if exists zz_audit_row on public.%I', r.nom);
    execute format('create trigger zz_audit_row after insert or update or delete on public.%I for each row execute function app.audit_row(%L)', r.nom, r.type);
  end loop;
end $$;

-- ── Droits des tables ──
do $$
declare t text;
begin
  foreach t in array array['purchase_orders', 'purchase_order_lines', 'purchase_receipts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0245')) ──

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
           where schemaname = 'public' and tablename = any (array['purchase_order_lines', 'purchase_orders', 'purchase_receipts'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- purchase_order_lines
select pg_temp.regles(array['purchase_order_lines'], null,
  $r$((company_id in (select app.societes_avec_droit('stock.commandes.valider')) or company_id in (select app.societes_avec_droit('stock.valeur.voir'))) or (company_id in (select app.societes_avec_droit('stock.commandes.preparer')) and order_id in (select app.stock_mes_commandes())))$r$,
  $r$(company_id in (select app.societes_avec_droit('stock.commandes.preparer')) and (company_id in (select app.societes_avec_droit('stock.valeur.voir')) or order_id in (select app.stock_mes_commandes())))$r$,
  $r$(company_id in (select app.societes_avec_droit('stock.commandes.preparer')) and (company_id in (select app.societes_avec_droit('stock.valeur.voir')) or order_id in (select app.stock_mes_commandes())))$r$,
  $r$(company_id in (select app.societes_avec_droit('stock.commandes.preparer')) and (company_id in (select app.societes_avec_droit('stock.valeur.voir')) or order_id in (select app.stock_mes_commandes())))$r$);

-- purchase_orders
select pg_temp.regles(array['purchase_orders'], null,
  $r$((company_id in (select app.societes_avec_droit('stock.commandes.valider')) or company_id in (select app.societes_avec_droit('stock.valeur.voir'))) or (company_id in (select app.societes_avec_droit('stock.commandes.preparer')) and id in (select app.stock_mes_commandes())))$r$,
  $r$company_id in (select app.societes_avec_droit('stock.commandes.preparer'))$r$,
  $r$(company_id in (select app.societes_avec_droit('stock.commandes.preparer')) and (company_id in (select app.societes_avec_droit('stock.valeur.voir')) or id in (select app.stock_mes_commandes())))$r$,
  $r$(company_id in (select app.societes_avec_droit('stock.commandes.preparer')) and (company_id in (select app.societes_avec_droit('stock.valeur.voir')) or id in (select app.stock_mes_commandes())))$r$);

-- purchase_receipts
select pg_temp.regles(array['purchase_receipts'], null,
  $r$((company_id in (select app.societes_avec_droit('stock.commandes.valider')) or company_id in (select app.societes_avec_droit('stock.valeur.voir'))) or (company_id in (select app.societes_avec_droit('stock.commandes.preparer')) and order_id in (select app.stock_mes_commandes())))$r$,
  null,
  null,
  null);


do $$
declare t text;
begin
  foreach t in array array['purchase_orders', 'purchase_order_lines', 'purchase_receipts'] loop
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

insert into public.schema_migrations (version) values ('0245_stock_commandes') on conflict (version) do nothing;

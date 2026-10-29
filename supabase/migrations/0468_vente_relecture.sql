-- 0468 : vente de matériel, relecture de #246 (lot 6).
-- 1. Livraison terminée sans technicien affecté : les articles sortent du premier dépôt actif, au lieu de ne pas
--    sortir du tout (la sortie de 0240 n'agit que si elle trouve un emplacement). Posé juste avant la clôture.
-- 2. Stock insuffisant : le calcul retire ce qui est déjà promis aux autres livraisons en attente.
-- 3. Plus de plafond silencieux à 200 appareils par ligne : jusqu'à 1000, au-delà un rappel signale le reste.
-- Corps de 0467 repris, seules ces conditions changent. Retour arrière : réappliquer 0467, supprimer le déclencheur
-- itv_visits_livraison_depot et sa fonction.

-- ── 2. Préparation de la livraison ──
create or replace function app.devis_prepare_livraison(p_quote uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  c public.clients;
  v_site uuid;
  v_visit uuid;
  v_k uuid;
  v_stock boolean;
  r record;
  v_po uuid;
  v_manque text := '';
begin
  select * into q from public.quotes where id = p_quote;
  if q.id is null or q.status not in ('accepted', 'partial') or q.amendment_of is not null then return null; end if;
  if exists (select 1 from public.itv_visits v where v.quote_id = q.id and v.kind = 'livraison') then return null; end if;
  if not exists (select 1 from public.quote_items i where i.quote_id = q.id and coalesce(i.accepted, true) and i.stock_item_id is not null
                   and coalesce(i.metier, q.metier) in ('vente', 'installation') and coalesce(i.quantity, 0) > 0) then
    return null;
  end if;
  select * into c from public.clients where id = q.client_id;

  select s.id into v_site from public.sites s where s.client_id = q.client_id and s.is_active order by s.is_default desc nulls last, s.created_at limit 1;
  if v_site is null then
    insert into public.sites (client_id, company_id, kind, name, address, postal_code, city, is_default, is_active)
    values (q.client_id, q.company_id, 'client', 'Site principal', c.address, c.postal_code, c.city, true, true)
    returning id into v_site;
  end if;
  select k.id into v_k from public.itv_contracts k
  where k.client_id = q.client_id and k.status = 'actif' and (k.site_ids is null or cardinality(k.site_ids) = 0 or v_site = any(k.site_ids))
  order by k.created_at limit 1;

  insert into public.itv_visits (client_id, site_id, company_id, contract_id, kind, status, due_on, quote_id, notes)
  values (q.client_id, v_site, q.company_id, v_k, 'livraison', 'a_planifier', current_date, q.id,
          'Livraison du devis ' || coalesce(q.reference, '') || ' signé')
  returning id into v_visit;

  insert into public.itv_visit_parts (visit_id, company_id, part_id, label, quantity, unit_price_ht, stock_item_id)
  select v_visit, q.company_id, si.itv_part_id, coalesce(nullif(i.description_title, ''), si.label), i.quantity, coalesce(i.unit_price_ht, 0), si.id
  from public.quote_items i join public.stock_items si on si.id = i.stock_item_id
  where i.quote_id = q.id and coalesce(i.accepted, true) and coalesce(i.metier, q.metier) in ('vente', 'installation') and coalesce(i.quantity, 0) > 0
  order by i.position;

  -- Stock insuffisant : commande proposée par fournisseur, rappel avec la liste
  select coalesce(bool_or(m.enabled), false) into v_stock from public.org_modules m where m.key = 'stock';
  for r in
    select si.id as item_id, si.label, si.supplier_id, sum(i.quantity) as besoin,
           coalesce((select sum(case when mv.to_location_id is not null then mv.quantity else 0 end) - sum(case when mv.from_location_id is not null then mv.quantity else 0 end)
                     from public.stock_movements mv where mv.item_id = si.id and mv.company_id = q.company_id), 0)
           -- déjà promis aux autres livraisons en attente (pas encore sorties du stock)
           - coalesce((select sum(op.quantity) from public.itv_visit_parts op join public.itv_visits ov on ov.id = op.visit_id
                       where op.stock_item_id = si.id and ov.id <> v_visit and ov.company_id = q.company_id
                         and ov.kind in ('livraison', 'installation', 'mise_en_service') and ov.status not in ('terminee', 'annulee')), 0) as dispo
    from public.quote_items i join public.stock_items si on si.id = i.stock_item_id
    where i.quote_id = q.id and coalesce(i.accepted, true) and coalesce(i.metier, q.metier) in ('vente', 'installation') and coalesce(i.quantity, 0) > 0
    group by si.id, si.label, si.supplier_id
    order by si.supplier_id nulls last, si.label
  loop
    if r.besoin <= greatest(r.dispo, 0) then continue; end if;
    v_manque := v_manque || E'\n- ' || r.label || ' : ' || trim(to_char(r.besoin - greatest(r.dispo, 0), 'FM999990.###'))
      || ' manquant' || case when r.supplier_id is null then ' (aucun fournisseur sur l''article)' else '' end;
    if v_stock and r.supplier_id is not null then
      select o.id into v_po from public.purchase_orders o
      where o.company_id = q.company_id and o.supplier_id = r.supplier_id and o.status = 'brouillon'
        and o.notes = 'Proposée pour la livraison du devis ' || coalesce(q.reference, q.id::text);
      if v_po is null then
        insert into public.purchase_orders (company_id, supplier_id, location_id, notes)
        values (q.company_id, r.supplier_id,
                (select l.id from public.stock_locations l where l.company_id = q.company_id and l.kind = 'depot' and l.is_active order by l.created_at limit 1),
                'Proposée pour la livraison du devis ' || coalesce(q.reference, q.id::text))
        returning id into v_po;
      end if;
      insert into public.purchase_order_lines (company_id, order_id, item_id, quantity, position)
      values (q.company_id, v_po, r.item_id, r.besoin - greatest(r.dispo, 0),
              (select coalesce(max(position), 0) + 1 from public.purchase_order_lines where order_id = v_po));
      v_po := null;
    end if;
  end loop;
  if v_manque <> '' then
    insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
    values (q.company_id, 'rappel', 'itv_visits', v_visit, q.client_id, current_date,
            'Livraison du devis ' || coalesce(q.reference, '') || ' pour ' || c.name || ' : stock insuffisant',
            jsonb_build_object('interne', true, 'lien', '/stock',
              'texte', 'Il manque, tous emplacements confondus et en tenant compte des autres livraisons en attente :' || v_manque || E'\n\n'
                || case when v_stock then 'Une commande en brouillon est proposée pour chaque fournisseur (Stock › Commandes) : relisez-la, puis soumettez-la.'
                        else 'Le module Stock n''est pas actif : aucune commande n''a été préparée.' end),
            'livraison_stock:' || v_visit)
    on conflict (company_id, dedup_key) do nothing;
  end if;
  return v_visit;
end
$$;

-- ── 1. Emplacement de sortie quand aucun technicien n'est affecté ──
create or replace function app.itv_livraison_depot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_loc uuid;
begin
  if not (new.status = 'terminee' and old.status is distinct from 'terminee') then return new; end if;
  if new.kind not in ('livraison', 'installation', 'mise_en_service') or new.technician_id is not null then return new; end if;
  select l.id into v_loc from public.stock_locations l where l.company_id = new.company_id and l.kind = 'depot' and l.is_active order by l.created_at limit 1;
  if v_loc is null then return new; end if;
  -- Avant la clôture : la visite n'est pas encore terminée, ses pièces se modifient encore
  update public.itv_visit_parts set stock_location_id = v_loc
  where visit_id = new.id and stock_item_id is not null and stock_location_id is null;
  return new;
end
$$;
revoke all on function app.itv_livraison_depot() from public, anon, authenticated;
drop trigger if exists itv_visits_livraison_depot on public.itv_visits;
create trigger itv_visits_livraison_depot before update of status on public.itv_visits
  for each row execute function app.itv_livraison_depot();

-- ── 3. Entrée au parc ──
create or replace function app.itv_livraison_parc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_day date;
  v_prefix text;
  v_start int;
  v_n int;
  v_ref text;
begin
  if not (new.status = 'terminee' and old.status is distinct from 'terminee') then return new; end if;
  if new.kind not in ('livraison', 'installation', 'mise_en_service') then return new; end if;
  v_day := coalesce((new.started_at at time zone 'Europe/Paris')::date, new.planned_on, current_date);
  select reference into v_ref from public.quotes where id = new.quote_id;
  for r in
    select p.id, p.quantity, si.equipment_type_id, si.warranty_months, si.label, t.verification_months
    from public.itv_visit_parts p
    join public.stock_items si on si.id = p.stock_item_id
    join public.itv_equipment_types t on t.id = si.equipment_type_id
    where p.visit_id = new.id and si.equipment_type_id is not null and p.quantity >= 1
      and not exists (select 1 from public.itv_equipment q where q.source_visit_part_id = p.id)
  loop
    v_n := floor(r.quantity)::int;
    if v_n > 1000 then
      -- Quantité hors norme (erreur de saisie probable) : 1000 appareils créés, le reste signalé, rien de perdu en silence
      insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
      values (new.company_id, 'rappel', 'itv_visits', new.id, new.client_id, current_date,
              'Livraison ' || coalesce(new.reference, '') || ' : ' || (v_n - 1000) || ' appareils non entrés au parc',
              jsonb_build_object('interne', true, 'lien', '/interventions/parc/' || new.client_id,
                'texte', 'La ligne « ' || r.label || ' » compte ' || v_n || ' unités : 1000 sont entrées au parc. Vérifiez la quantité, puis ajoutez le reste à la main si elle est juste.'),
              'livraison_plafond:' || r.id)
      on conflict (company_id, dedup_key) do nothing;
      v_n := 1000;
    end if;
    select coalesce(nullif(trim(s.label_prefix), ''), nullif(trim(o.doc_prefix), ''), 'APP') into v_prefix
    from public.itv_settings s left join lateral (select doc_prefix from public.organization_settings limit 1) o on true where s.id = 1;
    update public.itv_settings set label_next = label_next + v_n, updated_at = now() where id = 1 returning label_next - v_n into v_start;
    insert into public.itv_equipment (client_id, site_id, type_id, company_id, label_code, status, installed_on, manufactured_year,
                                      warranty_until, next_check_on, source_quote_id, source_visit_part_id, notes)
    select new.client_id, new.site_id, r.equipment_type_id, new.company_id,
           upper(coalesce(v_prefix, 'APP')) || '-' || lpad((v_start + g - 1)::text, 5, '0'), 'en_service', v_day, extract(year from v_day)::int,
           case when r.warranty_months is not null then (v_day + make_interval(months => r.warranty_months))::date end,
           (v_day + make_interval(months => coalesce(r.verification_months, 12)))::date, new.quote_id, r.id,
           left(r.label || ', ' || case new.kind when 'livraison' then 'livré' when 'installation' then 'installé' else 'mis en service' end
             || ' le ' || to_char(v_day, 'DD/MM/YYYY') || coalesce(' (devis ' || v_ref || ')', ''), 500)
    from generate_series(1, v_n) g;
  end loop;
  return new;
end
$$;

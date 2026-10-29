-- 0467 : contrats de maintenance, lot 6 : vente de matériel, du devis signé au parc.
--
-- 1. Article du stock relié à un type d'appareil (stock_items.equipment_type_id) et garantie en mois
--    (stock_items.warranty_months, vide = non renseignée : rien n'est inventé).
-- 2. Devis de vente (ou d'installation) signé : la livraison est préparée (intervention « livraison » à planifier,
--    lignes du devis reprises comme pièces sorties du stock), une seule fois par devis, jamais pour un avenant.
-- 3. Stock insuffisant à ce moment-là : une commande fournisseur est proposée en brouillon par fournisseur (module
--    Stock actif), et un rappel liste ce qui manque, avec les articles sans fournisseur. Rien n'est envoyé.
-- 4. Livraison (ou installation, mise en service) terminée : la sortie du stock existe déjà (0240) ; en plus, chaque
--    article relié à un type d'appareil entre au parc du site, une fois : étiquette, date de pose, année, fin de
--    garantie, prochaine vérification à l'échéance du type. Sous contrat signé, le rappel d'avenant de 0463 suit.
-- 5. Une livraison issue d'un devis se facture depuis le devis : pas de rappel « facture à préparer » (0465 ajusté).
--
-- Retour arrière (manuel) : en fin de fichier.

alter table public.stock_items add column if not exists equipment_type_id uuid references public.itv_equipment_types(id) on delete set null;
alter table public.stock_items add column if not exists warranty_months integer check (warranty_months is null or warranty_months between 1 and 240);
comment on column public.stock_items.equipment_type_id is '0467 : type d''appareil créé au parc du client quand l''article est livré.';
comment on column public.stock_items.warranty_months is '0467 : garantie du fabricant ou du vendeur, en mois (vide : non renseignée).';

alter table public.itv_equipment add column if not exists warranty_until date;
alter table public.itv_equipment add column if not exists source_quote_id uuid references public.quotes(id) on delete set null;
comment on column public.itv_equipment.warranty_until is '0467 : fin de garantie de l''appareil vendu.';
comment on column public.itv_equipment.source_quote_id is '0467 : devis de vente d''où vient l''appareil.';

alter table public.itv_equipment add column if not exists source_visit_part_id uuid references public.itv_visit_parts(id) on delete set null;
comment on column public.itv_equipment.source_visit_part_id is '0467 : ligne de livraison d''où vient l''appareil (une seule entrée au parc par ligne ; la pièce d''une visite terminée reste figée).';
create index if not exists itv_equipment_source_part_idx on public.itv_equipment (source_visit_part_id) where source_visit_part_id is not null;

-- ── Préparation de la livraison ──
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
                     from public.stock_movements mv where mv.item_id = si.id and mv.company_id = q.company_id), 0) as dispo
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
              'texte', 'Il manque, tous emplacements confondus :' || v_manque || E'\n\n'
                || case when v_stock then 'Une commande en brouillon est proposée pour chaque fournisseur (Stock › Commandes) : relisez-la, puis soumettez-la.'
                        else 'Le module Stock n''est pas actif : aucune commande n''a été préparée.' end),
            'livraison_stock:' || v_visit)
    on conflict (company_id, dedup_key) do nothing;
  end if;
  return v_visit;
end
$$;
revoke all on function app.devis_prepare_livraison(uuid) from public, anon, authenticated;

create or replace function app.devis_accepte_livraison()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('accepted', 'partial') and coalesce(old.status, '') not in ('accepted', 'partial') then
    -- La signature du devis ne doit jamais échouer à cause de la livraison : en cas d'erreur, un rappel la signale
    begin
      perform app.devis_prepare_livraison(new.id);
    exception when others then
      insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
      values (new.company_id, 'rappel', 'quotes', new.id, new.client_id, current_date,
              'Devis ' || coalesce(new.reference, '') || ' signé : livraison à préparer à la main',
              jsonb_build_object('interne', true, 'lien', '/devis?open=' || new.id,
                'texte', 'La livraison n''a pas pu être préparée toute seule (' || left(sqlerrm, 300) || '). Créez l''intervention de livraison depuis la fiche parc du client.'),
              'livraison_erreur:' || new.id)
      on conflict (company_id, dedup_key) do nothing;
    end;
  end if;
  return new;
end
$$;
revoke all on function app.devis_accepte_livraison() from public, anon, authenticated;
drop trigger if exists quotes_accepte_livraison on public.quotes;
create trigger quotes_accepte_livraison after update of status on public.quotes
  for each row execute function app.devis_accepte_livraison();

-- ── Entrée au parc à la fin de la livraison ──
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
    v_n := least(floor(r.quantity)::int, 200);
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
revoke all on function app.itv_livraison_parc() from public, anon, authenticated;
drop trigger if exists itv_visits_livraison_parc on public.itv_visits;
create trigger itv_visits_livraison_parc after update of status on public.itv_visits
  for each row execute function app.itv_livraison_parc();

-- ── Facture à préparer : pas pour une livraison issue d'un devis (corps de 0465, une condition ajoutée) ──
create or replace function app.itv_visite_a_facturer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.itv_contracts;
  v_couvert boolean;
  v_nature text;
begin
  if not (new.status = 'terminee' and old.status is distinct from 'terminee') or new.invoice_id is not null then return new; end if;
  -- Livraison d'un devis signé (0467) : la facture se fait depuis le devis
  if new.kind = 'livraison' and new.quote_id is not null then return new; end if;
  select * into k from public.itv_contracts where id = new.contract_id;
  -- Couvert : vérification d'un contrat facturé par échéancier, sans pièce hors contrat
  v_couvert := k.id is not null and new.kind = 'verification' and k.billing_period in ('mensuel', 'trimestriel', 'annuel')
    and not exists (
      select 1 from public.itv_visit_parts p left join public.itv_parts c on c.id = p.part_id
      where p.visit_id = new.id
        and coalesce((k.includes ->> case coalesce(c.category, 'piece') when 'recharge' then 'recharges' when 'deplacement' then 'deplacement' else 'pieces' end)::boolean, false) = false);
  if v_couvert then return new; end if;
  v_nature := case new.kind when 'inventaire' then 'Inventaire' when 'depannage' then 'Dépannage' when 'installation' then 'Installation'
    when 'livraison' then 'Livraison' when 'mise_en_service' then 'Mise en service' when 'exercice_evacuation' then 'Exercice d''évacuation' else 'Visite' end;
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, due_on, title, payload, dedup_key)
  select new.company_id, 'rappel', 'itv_visits', new.id, new.client_id, current_date,
         v_nature || ' terminé' || case when new.kind in ('verification', 'livraison', 'installation', 'mise_en_service') then 'e' else '' end
           || ' chez ' || c.name || ' : facture à préparer',
         jsonb_build_object('interne', true, 'lien', '/interventions/visite/' || new.id,
           'texte', 'L''intervention ' || coalesce(new.reference, '') || ' est terminée. Ouvrez-la et appuyez sur « Préparer la facture » : '
             || 'le brouillon reprend le forfait, les pièces sorties et ce que le contrat comprend. Rien n''est émis sans vous.'),
         'visite_facture:' || new.id
  from public.clients c where c.id = new.client_id
  on conflict (company_id, dedup_key) do nothing;
  return new;
end
$$;

-- Retour arrière (manuel) :
-- réappliquer app.itv_visite_a_facturer de 0465 ;
-- drop trigger if exists itv_visits_livraison_parc on public.itv_visits; drop function if exists app.itv_livraison_parc();
-- drop trigger if exists quotes_accepte_livraison on public.quotes; drop function if exists app.devis_accepte_livraison(); drop function if exists app.devis_prepare_livraison(uuid);
-- alter table public.itv_equipment drop column if exists source_visit_part_id, drop column if exists source_quote_id, drop column if exists warranty_until;
-- alter table public.stock_items drop column if exists warranty_months, drop column if exists equipment_type_id;

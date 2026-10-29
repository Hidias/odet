-- Essai local de 0472 : rentabilité d'un contrat (CA, temps, pièces, main-d'œuvre) et rappels de fidélisation.
begin;
set local client_min_messages = warning;
do $$
declare v_cie uuid; v_client uuid; v_site uuid; v_k uuid; v_vis uuid; v_inv uuid; v_it uuid; v_r jsonb; l jsonb;
begin
  select id into v_cie from public.companies limit 1;
  update public.billing_settings set cout_horaire_intervention = 40 where company_id = v_cie;
  insert into public.clients (name, client_type, company_id) values ('Mairie 0472', 'public', v_cie) returning id into v_client;
  insert into public.sites (client_id, name, is_active, company_id) values (v_client, 'Mairie', true, v_cie) returning id into v_site;
  insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status) values (v_client, v_cie, date '2026-01-01', 1200, array[3], 'actif') returning id into v_k;
  insert into public.stock_items (company_id, label, unit) values (v_cie, 'Joint 0472', 'u') returning id into v_it;
  insert into public.stock_item_costs (item_id, company_id, purchase_price_ht) values (v_it, v_cie, 2.5);
  -- Visite de 1 h 30 avec 4 joints, facture émise de 300 € HT
  insert into public.itv_visits (client_id, site_id, company_id, contract_id, status, started_at, finished_at)
  values (v_client, v_site, v_cie, v_k, 'en_cours', timestamptz '2026-03-10 09:00+01', timestamptz '2026-03-10 10:30+01') returning id into v_vis;
  insert into public.itv_visit_parts (visit_id, company_id, label, quantity, unit_price_ht, stock_item_id) values (v_vis, v_cie, 'Joint', 4, 6, v_it);
  update public.itv_visits set status = 'terminee' where id = v_vis;
  insert into public.invoices (reference, type, client_id, company_id, status, total_ht, total_net_ht, total_ttc, invoice_date) values ('FACT-0472', 'invoice', v_client, v_cie, 'draft', 300, 300, 360, date '2026-03-31') returning id into v_inv;
  alter table public.invoices disable trigger user; update public.invoices set status = 'sent' where id = v_inv; alter table public.invoices enable trigger user;
  alter table public.itv_visits disable trigger user; update public.itv_visits set invoice_id = v_inv where id = v_vis; alter table public.itv_visits enable trigger user;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  v_r := public.contrats_pilotage(date '2026-01-01', date '2026-12-31');
  select x into l from jsonb_array_elements(v_r->'contrats') x where x->>'id' = v_k::text;
  -- CA 300 ; 1,5 h × 40 = 60 ; pièces 4 × 2,5 = 10 ; marge 230
  if (l->>'ca')::numeric <> 300 or (l->>'heures')::numeric <> 1.5 or (l->>'main_oeuvre')::numeric <> 60 then raise exception 'rentabilité : %', l; end if;
  if (v_r->>'prix_achat')::boolean and ((l->>'pieces')::numeric <> 10 or (l->>'marge')::numeric <> 230) then raise exception 'pièces/marge : %', l; end if;
  raise warning 'ESSAI 0472 : OK (%)', l;
end
$$;
rollback;

-- Essai local de 0463 (inventaire, prix d'après le parc, déduction, avenant), en transaction annulée. Base locale seulement.
begin;
set local client_min_messages = warning;
do $$
declare
  v_client uuid; v_k uuid; v_s1 uuid; v_t1 uuid; v_t2 uuid; v_r jsonb; v_cie uuid; v_vis uuid; v_inv0 uuid; v_inv uuid; i record; v_n int; v_sum numeric;
begin
  select id into v_cie from public.companies limit 1;
  select id into v_t1 from public.itv_equipment_types order by name limit 1;
  select id into v_t2 from public.itv_equipment_types where id <> v_t1 order by name limit 1;
  insert into public.clients (name, client_type, company_id) values ('Client Essai 0463', 'entreprise', v_cie) returning id into v_client;
  insert into public.sites (client_id, name, city, is_active, company_id) values (v_client, 'Atelier', 'Concarneau', true, v_cie) returning id into v_s1;
  insert into public.itv_equipment (client_id, site_id, type_id, status, company_id, label_code)
    select v_client, v_s1, case when g <= 3 then v_t1 else v_t2 end, 'en_service', v_cie, 'E0463-' || g from generate_series(1, 5) g;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  -- Prix : type 1 au prix de la société, type 2 sans prix ; puis tarif client sur le type 1
  insert into public.itv_type_prices (company_id, type_id, price_ht) values (v_cie, v_t1, 10);
  insert into public.itv_contracts (client_id, company_id, start_on, annual_price_ht, visit_months, status, duration_years, tacit_renewal, billing_period)
  values (v_client, v_cie, current_date, 0, array[3], 'a_valider', 1, true, 'annuel') returning id into v_k;
  v_r := public.contrat_prix_parc(v_k);
  if (v_r->>'appareils')::int <> 5 or (v_r->>'total')::numeric <> 30 or jsonb_array_length(v_r->'manquants') <> 1 then raise exception 'prix parc : %', v_r; end if;
  insert into public.client_prices (client_id, company_id, kind, equipment_type_id, prix_ht) values (v_client, v_cie, 'equipement', v_t1, 8);
  insert into public.itv_type_prices (company_id, type_id, price_ht) values (v_cie, v_t2, 15);
  v_r := public.contrat_prix_parc(v_k);
  if (v_r->>'total')::numeric <> 54 or jsonb_array_length(v_r->'manquants') <> 0 then raise exception 'tarif client : %', v_r; end if;
  if not exists (select 1 from jsonb_array_elements(v_r->'lignes') l where l->>'source' = 'client' and (l->>'prix')::numeric = 8) then raise exception 'source client absente'; end if;

  -- Inventaire terminé et facturé (60 €), contrat validé dans le délai : la 1re échéance le déduit, une seule fois
  insert into public.invoices (reference, type, client_id, company_id, status, total_ht, total_net_ht, total_tva, total_ttc, amount_due)
  values ('FACT-ESSAI-0463', 'invoice', v_client, v_cie, 'sent', 60, 60, 12, 72, 72) returning id into v_inv0;
  insert into public.invoice_items (invoice_id, company_id, position, code, description_title, quantity, unit, unit_price_ht, tva_rate, total_ht, nature, vat_regime)
  values (v_inv0, v_cie, 0, 'INVENTAIRE', 'Inventaire initial du parc', 1, 'forfait', 60, 20, 60, 'service', 'normal');
  -- une facture créée est toujours un brouillon : on la considère émise
  alter table public.invoices disable trigger user;
  update public.invoices set status = 'sent', reference = 'FACT-ESSAI-0463' where id = v_inv0;
  alter table public.invoices enable trigger user;
  insert into public.itv_visits (client_id, site_id, company_id, kind, status, started_at, finished_at, invoice_id)
  values (v_client, v_s1, v_cie, 'inventaire', 'terminee', now() - interval '5 days', now() - interval '5 days', v_inv0) returning id into v_vis;
  update public.itv_contracts set annual_price_ht = 54 where id = v_k;
  v_r := public.contrat_valider(v_k);
  select * into i from public.itv_contract_installments where contract_id = v_k order by period_start limit 1;
  v_inv := public.contrat_echeance_facturer(i.id);
  select count(*), sum(total_ht) into v_n, v_sum from public.invoice_items where invoice_id = v_inv;
  if v_n <> 2 or v_sum <> i.amount_ht - least(60, i.amount_ht) then raise exception 'déduction : % lignes, % ; k=% ; v=%', v_n, v_sum, (select row_to_json(x) from (select signed_at, validated_at, status from public.itv_contracts where id = v_k) x), (select row_to_json(w) from (select status, finished_at, invoice_id, kind from public.itv_visits where id = v_vis) w); end if;
  if not exists (select 1 from public.invoices where id = v_inv and total_ht = i.amount_ht - least(60, i.amount_ht)) then raise exception 'totaux facture non recalculés'; end if;
  if (select deducted_in_invoice_id from public.itv_visits where id = v_vis) is distinct from v_inv then raise exception 'visite non marquée'; end if;

  -- Appareil ajouté sous contrat signé : un rappel, pas deux le même mois
  update public.itv_contracts set signed_on_paper = true, signed_at = now(), created_at = now() - interval '1 day' where id = v_k;
  insert into public.itv_equipment (client_id, site_id, type_id, status, company_id, label_code) values (v_client, v_s1, v_t1, 'en_service', v_cie, 'E0463-6');
  insert into public.itv_equipment (client_id, site_id, type_id, status, company_id, label_code) values (v_client, v_s1, v_t1, 'en_service', v_cie, 'E0463-7');
  select count(*) into v_n from public.scheduled_actions where client_id = v_client and dedup_key like 'parc_avenant:%';
  if v_n <> 1 then raise exception 'rappel avenant : %', v_n; end if;

  raise warning 'ESSAI 0463 : OK';
end
$$;
rollback;

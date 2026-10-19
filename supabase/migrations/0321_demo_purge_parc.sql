-- 0321_demo_purge_parc.sql : la purge des données de démonstration couvre les véhicules (0320) et les emprunts (0220).
--
-- Véhicules et emprunts de démonstration inscrits dans demo_records (tbl « vehicles », « loans ») : effacés avec ce
-- qui leur est rattaché (suppression en cascade) et les photos des tickets du bucket « vehicules ». Le reste de la
-- purge est identique à 0245. La purge reste un geste du super administrateur, jamais automatique.
-- Migration additive (fonction remplacée). Idempotente. Retour arrière : supabase/rollback/0321_demo_purge_parc_retour.sql

create or replace function public.purge_demo_data()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sessions uuid[]; v_trainees uuid[]; v_clients uuid[]; v_invoices uuid[]; v_quotes uuid[];
  v_rdv uuid[]; v_trainers uuid[]; v_veille uuid[];
  v_hr uuid[];
  v_st uuid[]; v_loc uuid[]; v_sup uuid[]; v_cmd uuid[];
  v_veh uuid[]; v_loans uuid[];
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

  -- Véhicules et emprunts (0321) : véhicules de démonstration avec leurs attributions, relevés, échéances, entretiens,
  -- pleins et photos de tickets ; emprunts de démonstration avec leur échéancier et leurs événements
  if to_regclass('public.vehicles') is not null then
    select array_agg(id) into v_veh from demo_records where tbl = 'vehicles';
    if v_veh is not null then
      perform set_config('storage.allow_delete_query', 'true', true);
      delete from storage.objects where bucket_id = 'vehicules' and split_part(name, '/', 2) in (select x::text from unnest(v_veh) x);
      delete from vehicles where id = any(v_veh);
      v_done := v_done || jsonb_build_object('vehicles', cardinality(v_veh));
    end if;
  end if;
  if to_regclass('public.loans') is not null then
    select array_agg(id) into v_loans from demo_records where tbl = 'loans';
    if v_loans is not null then
      if to_regclass('public.vehicles') is not null then update vehicles set loan_id = null where loan_id = any(v_loans); end if;
      delete from loans where id = any(v_loans);
      v_done := v_done || jsonb_build_object('loans', cardinality(v_loans));
    end if;
  end if;

  delete from demo_records;
  return jsonb_build_object('ok', true, 'detail', v_done);
end $$;

revoke all on function public.purge_demo_data() from public, anon;
grant execute on function public.purge_demo_data() to authenticated;

insert into public.schema_migrations (version) values ('0321_demo_purge_parc') on conflict (version) do nothing;

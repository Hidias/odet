-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (purge_0385) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0385_demo_purge_complete.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0385_demo_purge_complete_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0385_demo_purge_complete.sql =====
-- 0385_demo_purge_complete.sql : purge complète des données de démonstration et rapport « réel / test » (audit du 19/10).
--
--   Constats (audit de pilotage et essai à blanc du 19/10) : la purge s'arrêtait au premier document émis (verrou des
--   factures), ignorait plusieurs types marqués (réseaux sociaux, campagnes, prospects, Passeport, fichiers du stockage,
--   RIB de démonstration, noms fictifs des référents) et vidait toute la liste des marques, même ce qu'elle n'effaçait pas.
--
--   1. purge_demo_data : refuse tout type de marque inconnu (rien n'est effacé) ; lève les verrous des documents émis et
--      des visites terminées pour sa seule transaction ; traite tous les types connus ; ne retire une marque que si son
--      objet a disparu, et rend la liste de ce qui reste (« restants »). Les comptes de démonstration ne sont jamais
--      supprimés par la purge (gestion des comptes : super administrateur) : ils sont listés à part (« comptes_demo »).
--   2. demo_rapport() : rapport « réel / test » à valider avant la purge. Il exécute la purge à blanc (annulée) et
--      rend, par table, le nombre de lignes avant, ce qui partirait (test) et ce qui resterait (réel), avec le nom
--      des lignes qui resteraient pour les tables où une donnée réelle peut se cacher.
--   La purge reste un geste du super administrateur, jamais automatique.
-- Migration additive (fonctions remplacées). Idempotente. Retour arrière : supabase/rollback/0385_demo_purge_complete_retour.sql

-- Types de marques que la purge sait traiter
create or replace function app.demo_types_connus()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['sessions', 'trainees', 'clients', 'invoices', 'quotes', 'prospect_rdv', 'trainers', 'veille_qualiopi',
               'hr_people', 'hr_teams', 'stock_items', 'stock_locations', 'suppliers', 'purchase_orders', 'vehicles', 'loans',
               'social_posts', 'social_media_library', 'mailing_campaigns', 'prospection_massive', 'pp_nir', 'pp_fichiers',
               'pp_accuses', 'storage_objects', 'organization_settings_bank', 'quality_role_names', 'auth_users']
$$;

-- Verrous levés (false) ou remis (true) le temps de la purge : documents émis, lignes de facture, liens d'acompte,
-- visites terminées, mouvements de stock. Seul le propriétaire des tables (fonctions de la base) peut le faire.
create or replace function app.demo_verrous(p_actifs boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select * from (values
      ('invoices', 'invoices_verrou'), ('invoices', 'invoices_verrou_creation'), ('invoices', 'invoices_verrou_rib_demo'),
      ('invoice_items', 'invoice_items_verrou'), ('invoice_deposit_links', 'invoice_deposit_links_verrou'),
      ('itv_visits', 'itv_visits_figee'), ('itv_visits', 'itv_visite_cloture_garde'), ('itv_visit_items', 'itv_visit_items_figee'),
      ('itv_visit_parts', 'itv_visit_parts_figee')) as v(t, g)
  loop
    if exists (select 1 from pg_trigger tg where tg.tgrelid = to_regclass('public.' || r.t) and tg.tgname = r.g and not tg.tgisinternal) then
      execute format('alter table public.%I %s trigger %I', r.t, case when p_actifs then 'enable' else 'disable' end, r.g);
    end if;
  end loop;
end
$$;
revoke all on function app.demo_verrous(boolean) from public, anon, authenticated;

create or replace function public.purge_demo_data()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sessions uuid[]; v_trainees uuid[]; v_clients uuid[]; v_invoices uuid[]; v_quotes uuid[];
  v_rdv uuid[]; v_trainers uuid[]; v_veille uuid[];
  v_hr uuid[];
  v_st uuid[]; v_loc uuid[]; v_sup uuid[]; v_cmd uuid[];
  v_veh uuid[]; v_loans uuid[];
  r record; v_pass int; v_left int; v_done jsonb := '{}'::jsonb; v_n int; v_blocked text[];
  v_inconnus text[]; v_ids uuid[]; v_t text; v_restants jsonb := '{}'::jsonb; v_comptes jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'Réservé au super administrateur' using errcode = '42501';
  end if;
  -- Type inconnu : refus, rien n'est effacé (une marque que la purge ne sait pas traiter ne doit pas disparaître)
  select array_agg(distinct d.tbl order by d.tbl) into v_inconnus from demo_records d where not (d.tbl = any(app.demo_types_connus()));
  if v_inconnus is not null then
    raise exception 'Purge refusée : type(s) de données de démonstration inconnu(s) (%). Rien n''a été effacé.', array_to_string(v_inconnus, ', ')
      using errcode = '22023';
  end if;
  -- Verrous des documents émis et des visites terminées : levés pour cette seule transaction (la purge est un geste
  -- du super administrateur, sur des données inscrites comme fictives) ; ils se remettent en fin de purge, et tout est
  -- annulé si la purge échoue
  perform app.demo_verrous(false);
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

  -- Contenus simples marqués par leur identifiant (réseaux sociaux, campagnes, prospects, Passeport)
  foreach v_t in array array['social_posts', 'social_media_library', 'mailing_campaigns', 'prospection_massive', 'pp_fichiers', 'pp_accuses'] loop
    if to_regclass('public.' || v_t) is not null then
      select array_agg(id) into v_ids from demo_records where tbl = v_t;
      if v_ids is not null then
        if v_t = 'prospection_massive' then
          update prospection_massive set gere_par_id = null where gere_par_id = any(v_ids);
        end if;
        begin
          execute format('delete from public.%I where id = any($1)', v_t) using v_ids;
          get diagnostics v_n = row_count;
          if v_n > 0 then v_done := v_done || jsonb_build_object(v_t, v_n); end if;
        exception when foreign_key_violation then null; -- gardé, signalé dans « restants »
        end;
      end if;
    end if;
  end loop;
  -- Numéros de sécurité sociale fictifs du Passeport (clé : le stagiaire)
  if to_regclass('public.pp_nir') is not null then
    delete from pp_nir where trainee_id in (select id from demo_records where tbl = 'pp_nir');
  end if;
  -- Fichiers de démonstration du stockage (images des réseaux sociaux)
  select array_agg(id) into v_ids from demo_records where tbl = 'storage_objects';
  if v_ids is not null then
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects where id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_done := v_done || jsonb_build_object('storage_objects', v_n); end if;
  end if;
  -- Coordonnées bancaires de démonstration : retirées (à saisir : l'émission reste refusée tant qu'elles manquent, 0384)
  if exists (select 1 from demo_records where tbl = 'organization_settings_bank') then
    update organization_settings set iban = null, bic = null
      where upper(coalesce(bic, '')) like 'DEMO%' or regexp_replace(upper(coalesce(iban, '')), '\s', '', 'g') = 'FR7630006000011234567890189';
    update companies set iban = null, bic = null
      where upper(coalesce(bic, '')) like 'DEMO%' or regexp_replace(upper(coalesce(iban, '')), '\s', '', 'g') = 'FR7630006000011234567890189';
    delete from demo_records where tbl = 'organization_settings_bank';
    v_done := v_done || jsonb_build_object('rib_demo', 1);
  end if;
  -- Noms fictifs des référents qualité : n'apparaissent plus dès que la marque disparaît (0033)
  delete from demo_records where tbl = 'quality_role_names';

  perform app.demo_verrous(true);

  -- Trace : seules disparaissent les marques dont l'objet n'existe plus. Ce qui n'a pas pu être effacé reste inscrit
  -- et revient dans « restants ». Les comptes de démonstration ne sont jamais supprimés par la purge : la gestion des
  -- comptes passe par le super administrateur (Paramètres › Utilisateurs).
  for v_t in select distinct tbl from demo_records loop
    if v_t = 'auth_users' then continue; end if;
    if v_t = 'storage_objects' then
      delete from demo_records d where d.tbl = v_t and not exists (select 1 from storage.objects o where o.id = d.id);
    elsif v_t = 'pp_nir' then
      delete from demo_records d where d.tbl = v_t and not exists (select 1 from pp_nir n where n.trainee_id = d.id);
    elsif to_regclass('public.' || v_t) is not null then
      execute format('delete from demo_records d where d.tbl = %L and not exists (select 1 from public.%I x where x.id = d.id)', v_t, v_t);
    end if;
  end loop;
  select coalesce(jsonb_object_agg(tbl, n), '{}'::jsonb) into v_restants
  from (select tbl, count(*) as n from demo_records where tbl <> 'auth_users' group by tbl) x;
  select jsonb_agg(jsonb_build_object('id', d.id, 'nom', coalesce(p.display_name, u.email)))
    into v_comptes
  from demo_records d left join profiles p on p.id = d.id left join auth.users u on u.id = d.id
  where d.tbl = 'auth_users';
  return jsonb_build_object('ok', v_restants = '{}'::jsonb, 'detail', v_done, 'restants', v_restants,
                            'comptes_demo', coalesce(v_comptes, '[]'::jsonb));
end $$;

revoke all on function public.purge_demo_data() from public, anon;
grant execute on function public.purge_demo_data() to authenticated;

-- Rapport « réel / test » : purge à blanc dans un bloc annulé, comptes avant et après
create or replace function public.demo_rapport()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tables text[] := array['clients', 'client_contacts', 'sites', 'quotes', 'invoices', 'sessions', 'trainees', 'trainers',
    'courses', 'itv_contracts', 'itv_equipment', 'itv_visits', 'hr_people', 'stock_items', 'stock_locations', 'suppliers',
    'purchase_orders', 'vehicles', 'loans', 'prospect_calls', 'prospect_rdv', 'opportunities', 'social_posts',
    'social_media_library', 'mailing_campaigns', 'prospection_massive', 'veille_qualiopi'];
  v_avant jsonb := '{}'::jsonb;
  v_apres jsonb := '{}'::jsonb;
  v_noms jsonb := '{}'::jsonb;
  v_purge jsonb;
  v_erreur text;
  t text;
  n bigint;
  v_lignes jsonb := '[]'::jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'Réservé au super administrateur' using errcode = '42501';
  end if;
  foreach t in array v_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      v_avant := v_avant || jsonb_build_object(t, n);
    end if;
  end loop;
  begin
    v_purge := public.purge_demo_data();
    foreach t in array v_tables loop
      if to_regclass('public.' || t) is not null then
        execute format('select count(*) from public.%I', t) into n;
        v_apres := v_apres || jsonb_build_object(t, n);
      end if;
    end loop;
    -- Ce qui resterait, nommé, là où une donnée réelle peut se cacher
    select jsonb_build_object(
      'clients', (select coalesce(jsonb_agg(c.name order by c.name), '[]'::jsonb) from clients c),
      'quotes', (select coalesce(jsonb_agg(q.reference order by q.reference), '[]'::jsonb) from quotes q),
      'invoices', (select coalesce(jsonb_agg(i.reference order by i.reference), '[]'::jsonb) from invoices i),
      'sessions', (select coalesce(jsonb_agg(s.reference order by s.reference), '[]'::jsonb) from sessions s),
      'trainers', (select coalesce(jsonb_agg(tr.first_name || ' ' || tr.last_name), '[]'::jsonb) from trainers tr),
      'sites', (select coalesce(jsonb_agg(st.name), '[]'::jsonb) from sites st),
      'hr_people', (select coalesce(jsonb_agg(h.first_name || ' ' || h.last_name), '[]'::jsonb) from hr_people h),
      'stock_items', (select coalesce(jsonb_agg(si.label order by si.label), '[]'::jsonb) from stock_items si),
      'stock_locations', (select coalesce(jsonb_agg(sl.name), '[]'::jsonb) from stock_locations sl),
      'suppliers', (select coalesce(jsonb_agg(su.name), '[]'::jsonb) from suppliers su),
      'vehicles', (select coalesce(jsonb_agg(v.plate), '[]'::jsonb) from vehicles v),
      'loans', (select coalesce(jsonb_agg(l.label), '[]'::jsonb) from loans l))
      into v_noms;
    raise exception 'demo_rapport_annule' using errcode = 'P0001';
  exception when others then
    if sqlerrm <> 'demo_rapport_annule' then v_erreur := sqlerrm; end if;
  end;
  if v_erreur is not null then
    return jsonb_build_object('ok', false, 'erreur', v_erreur);
  end if;
  foreach t in array v_tables loop
    if v_avant ? t then
      v_lignes := v_lignes || jsonb_build_object('table', t, 'avant', (v_avant ->> t)::bigint,
        'test', (v_avant ->> t)::bigint - coalesce((v_apres ->> t)::bigint, 0), 'reel', coalesce((v_apres ->> t)::bigint, 0),
        'noms', v_noms -> t);
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'tables', v_lignes, 'purge', v_purge);
end
$$;
revoke all on function public.demo_rapport() from public, anon;
grant execute on function public.demo_rapport() to authenticated;

insert into public.schema_migrations (version) values ('0385_demo_purge_complete') on conflict (version) do nothing;

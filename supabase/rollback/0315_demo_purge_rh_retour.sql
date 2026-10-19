-- Retour arrière de 0315_demo_purge_rh.sql : remet la purge de 0024. Idempotent.

create or replace function public.purge_demo_data()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sessions uuid[]; v_trainees uuid[]; v_clients uuid[]; v_invoices uuid[]; v_quotes uuid[];
  v_rdv uuid[]; v_trainers uuid[]; v_veille uuid[];
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

  delete from demo_records;
  return jsonb_build_object('ok', true, 'detail', v_done);
end $$;

revoke all on function public.purge_demo_data() from public, anon;
grant execute on function public.purge_demo_data() to authenticated;
revoke all on function public.demo_data_summary() from public, anon;
grant execute on function public.demo_data_summary() to authenticated;

insert into public.schema_migrations (version) values ('0024_donnees_demo') on conflict (version) do nothing;

revoke all on function public.purge_demo_data() from public, anon;
grant execute on function public.purge_demo_data() to authenticated;

delete from public.schema_migrations where version = '0315_demo_purge_rh';

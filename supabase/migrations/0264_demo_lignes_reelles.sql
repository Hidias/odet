-- 0264_demo_lignes_reelles.sql : lignes probablement réelles rattachées aux données de démonstration (chantier A).
--
-- Constat : purge_demo_data() (0024) efface toute ligne qui pointe vers un client, une session, un stagiaire, un
-- devis, une facture ou un rendez-vous fictif (colonnes session_id, trainee_id, client_id, invoice_id, quote_id,
-- rdv_id, parent_invoice_id, billing_client_id), quelle que soit la personne qui l'a saisie. Une saisie réelle
-- rattachée à du fictif (une visite, un devis ou une facture pour un client fictif, un stagiaire réel inscrit à une
-- session fictive, une note sur un client fictif…) disparaîtrait donc avec la purge.
-- demo_real_links() montre ces lignes AVANT la purge, dans la Console (Données de démonstration) :
--   même périmètre que la purge (mêmes colonnes, mêmes devis et factures rattachés aux clients et sessions fictifs) ;
--   « probablement réelle » = créée plus d'une heure après le dernier enregistrement de démonstration (les lignes
--   créées avec le jeu fictif ne sont pas listées) ; tables sans date de création : comptées à part.
-- Rien n'est effacé ni modifié ici ; la purge reste un geste du super administrateur. Lecture seule.
-- Idempotente. Retour arrière : supabase/rollback/0264_demo_lignes_reelles_retour.sql

create or replace function public.demo_real_links()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sessions uuid[]; v_trainees uuid[]; v_clients uuid[]; v_invoices uuid[]; v_quotes uuid[]; v_rdv uuid[];
  v_seuil timestamptz;
  r record;
  v_ids uuid[];
  v_n int; v_last timestamptz; v_sample jsonb;
  v_out jsonb := '[]'::jsonb;
  v_sans_date jsonb := '[]'::jsonb;
  v_total int := 0;
  v_has_id boolean;
begin
  if not app.a_le_droit('plateforme.administrer') then
    raise exception 'Réservé au super administrateur' using errcode = '42501';
  end if;
  select max(created_at) + interval '1 hour' into v_seuil from public.demo_records;
  if v_seuil is null then
    return jsonb_build_object('seuil', null, 'lignes', '[]'::jsonb, 'sans_date', '[]'::jsonb, 'total', 0);
  end if;

  select coalesce(array_agg(id) filter (where tbl = 'sessions'), '{}'), coalesce(array_agg(id) filter (where tbl = 'trainees'), '{}'),
         coalesce(array_agg(id) filter (where tbl = 'clients'), '{}'), coalesce(array_agg(id) filter (where tbl = 'invoices'), '{}'),
         coalesce(array_agg(id) filter (where tbl = 'quotes'), '{}'), coalesce(array_agg(id) filter (where tbl = 'prospect_rdv'), '{}')
    into v_sessions, v_trainees, v_clients, v_invoices, v_quotes, v_rdv
  from public.demo_records;
  -- Même extension que la purge : devis et factures des sessions et clients fictifs
  v_invoices := v_invoices || coalesce((select array_agg(id) from public.invoices
                                        where session_id = any(v_sessions) or client_id = any(v_clients)), '{}');
  v_quotes := v_quotes || coalesce((select array_agg(id) from public.quotes
                                    where session_id = any(v_sessions) or client_id = any(v_clients)), '{}');

  for r in
    select c.table_name, c.column_name,
           exists (select 1 from information_schema.columns d where d.table_schema = 'public'
                   and d.table_name = c.table_name and d.column_name = 'created_at') as has_date
    from information_schema.columns c join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.data_type = 'uuid'
      and c.column_name in ('session_id', 'trainee_id', 'client_id', 'invoice_id', 'quote_id', 'rdv_id', 'parent_invoice_id', 'billing_client_id')
      and c.table_name not in ('demo_records', 'profiles', 'courses')
    order by c.table_name, c.column_name
  loop
    v_ids := case r.column_name
      when 'session_id' then v_sessions when 'trainee_id' then v_trainees
      when 'client_id' then v_clients when 'billing_client_id' then v_clients
      when 'invoice_id' then v_invoices when 'parent_invoice_id' then v_invoices
      when 'quote_id' then v_quotes else v_rdv end;
    continue when coalesce(array_length(v_ids, 1), 0) = 0;
    v_has_id := exists (select 1 from information_schema.columns d where d.table_schema = 'public'
                        and d.table_name = r.table_name and d.column_name = 'id' and d.data_type = 'uuid');
    if r.has_date then
      execute format(
        'select count(*), max(x.created_at), coalesce(jsonb_agg(x.id) filter (where x.rn <= 10), ''[]''::jsonb)
           from (select %s as id, t.created_at, row_number() over (order by t.created_at desc) rn
                   from public.%I t
                  where t.%I = any($1) and t.created_at > $2
                    and not exists (select 1 from public.demo_records d where d.tbl = %L and %s)) x',
        case when v_has_id then 't.id' else 'null::uuid' end, r.table_name, r.column_name, r.table_name,
        case when v_has_id then 'd.id = t.id' else 'false' end)
        into v_n, v_last, v_sample using v_ids, v_seuil;
      if v_n > 0 then
        v_out := v_out || jsonb_build_object('table', r.table_name, 'colonne', r.column_name, 'nombre', v_n,
                                             'derniere', v_last, 'exemples', v_sample);
        v_total := v_total + v_n;
      end if;
    else
      execute format('select count(*) from public.%I t where t.%I = any($1)', r.table_name, r.column_name)
        into v_n using v_ids;
      if v_n > 0 then
        v_sans_date := v_sans_date || jsonb_build_object('table', r.table_name, 'colonne', r.column_name, 'nombre', v_n);
      end if;
    end if;
  end loop;

  return jsonb_build_object('seuil', v_seuil, 'lignes', v_out, 'sans_date', v_sans_date, 'total', v_total);
end
$$;

revoke all on function public.demo_real_links() from public, anon;
grant execute on function public.demo_real_links() to authenticated;

insert into public.schema_migrations (version) values ('0264_demo_lignes_reelles') on conflict (version) do nothing;

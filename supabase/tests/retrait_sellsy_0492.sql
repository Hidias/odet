-- Essai local de 0492 : colonnes héritées sellsy_* retirées, vue v_clients_a_appeler toujours juste (contact principal,
-- téléphone pris sur le mobile du contact), migration inscrite.
begin;
set local client_min_messages = warning;
do $$
declare
  v_cie uuid; v_cli uuid; v_ligne record;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and column_name in ('sellsy_id', 'sellsy_contact_id', 'sellsy_reference')) then
    raise exception '1. une colonne sellsy_* existe encore';
  end if;
  if exists (select 1 from pg_constraint where conname = 'clients_sellsy_id_key')
     or exists (select 1 from pg_indexes where schemaname = 'public' and indexname in ('idx_clients_sellsy', 'idx_courses_sellsy_id')) then
    raise exception '2. contrainte ou index sellsy restant';
  end if;
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Client essai 0492', v_cie) returning id into v_cli;
  insert into public.client_contacts (client_id, name, first_name, last_name, mobile, phone, is_primary, company_id)
    values (v_cli, 'Contact secondaire', 'Paul', 'Second', '0600000002', null, false, v_cie),
           (v_cli, 'Contact principal', 'Anne', 'Premier', '0600000001', '0200000001', true, v_cie);
  insert into public.itv_contracts (company_id, client_id, label, end_on) values (v_cie, v_cli, 'Contrat essai 0492', current_date + 30);
  select * into v_ligne from public.v_clients_a_appeler where client_id = v_cli;
  if v_ligne.client_id is null then raise exception '3a. client avec échéance absent de la vue'; end if;
  if v_ligne.contact_name <> 'Anne Premier' or v_ligne.contact_phone <> '0600000001' then
    raise exception '3b. contact principal ou téléphone faux (%, %)', v_ligne.contact_name, v_ligne.contact_phone;
  end if;
end $$;
do $$
declare v_def text;
begin
  v_def := pg_get_viewdef('public.v_clients_a_appeler'::regclass);
  if v_def ilike '%sellsy%' then raise exception '3c. la vue lit encore une colonne sellsy'; end if;
  if (select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid = 'public.v_clients_a_appeler'::regclass and attnum > 0)
     <> 'company_id,client_id,client_name,city,client_status,premiere_echeance,nb_echeances,natures,depassee,ne_pas_appeler,contact_id,contact_name,contact_phone,affaire_en_cours,devis_en_cours,dernier_echange,owner_id' then
    raise exception '4. colonnes de la vue changées';
  end if;
  if not (select coalesce(reloptions::text, '') like '%security_invoker=true%' from pg_class where oid = 'public.v_clients_a_appeler'::regclass) then
    raise exception '5. la vue a perdu security_invoker';
  end if;
  if not exists (select 1 from public.schema_migrations where version = '0492_retrait_sellsy') then
    raise exception '6. 0492 non inscrite';
  end if;
end $$;
rollback;

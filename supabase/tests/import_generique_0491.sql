-- Essai local de 0491 : colonnes génériques de l'import (origine et identifiant de l'ancien outil), longueur bornée
-- comme les colonnes héritées, facture émise toujours figée mais identifiant externe renseignable.
begin;
set local client_min_messages = warning;
do $$
declare
  v_cie uuid; v_cli uuid; v_ct uuid;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id, external_source, external_ref) values ('Client essai 0491', v_cie, 'csv', 'S-42')
    returning id into v_cli;
  if (select external_source || ':' || external_ref from public.clients where id = v_cli) <> 'csv:S-42' then
    raise exception '1. origine ou identifiant non gardé';
  end if;
  insert into public.client_contacts (client_id, name, external_ref, company_id) values (v_cli, 'Contact essai', 'C-1', v_cie)
    returning id into v_ct;
  begin
    update public.clients set external_ref = repeat('x', 51) where id = v_cli;
    raise exception '2. identifiant de plus de 50 caractères accepté';
  exception when check_violation then null;
  end;
  begin
    update public.client_contacts set external_ref = repeat('x', 51) where id = v_ct;
    raise exception '3. identifiant de contact de plus de 50 caractères accepté';
  exception when check_violation then null;
  end;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name = 'external_ref') then
    raise exception '4. invoices.external_ref absente';
  end if;
  if not exists (select 1 from public.schema_migrations where version = '0491_import_generique') then
    raise exception '5. 0491 non inscrite';
  end if;
end $$;
rollback;

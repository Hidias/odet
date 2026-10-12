-- 0037_contacts_client_source_unique.sql : un contact client n'est saisi qu'une fois.
--
-- La fiche client porte des champs « contact » (contact_name, contact_function, contact_email,
-- contact_phone) lus par une trentaine d'écrans et de documents ; la liste des contacts du client
-- (client_contacts) en porte d'autres. Désormais les champs de la fiche sont le reflet exact du
-- contact principal :
--   - modifier le contact principal dans la liste met à jour la fiche ;
--   - modifier les champs contact de la fiche met à jour le contact principal (ou le crée) ;
--   - un seul contact principal par client ;
--   - après le retrait du contact principal, client_contact_sync_primary(client_id) désigne le
--     contact suivant comme principal, ou vide les champs de la fiche s'il n'en reste aucun.

create or replace function public.client_contact_to_client()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.is_primary then
    update public.client_contacts set is_primary = false
     where client_id = new.client_id and id <> new.id and is_primary;
    update public.clients
       set contact_name = coalesce(nullif(trim(new.name), ''), nullif(trim(concat_ws(' ', new.first_name, new.last_name)), '')),
           contact_function = coalesce(nullif(trim(new.role), ''), nullif(trim(new.fonction), '')),
           contact_email = nullif(trim(new.email), ''),
           contact_phone = coalesce(nullif(trim(new.phone), ''), nullif(trim(new.mobile), ''))
     where id = new.client_id;
  end if;
  return new;
end $$;

create or replace function public.client_to_primary_contact()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'UPDATE'
     and new.contact_name is not distinct from old.contact_name
     and new.contact_function is not distinct from old.contact_function
     and new.contact_email is not distinct from old.contact_email
     and new.contact_phone is not distinct from old.contact_phone then
    return new;
  end if;
  if coalesce(nullif(trim(new.contact_name), ''), nullif(trim(new.contact_email), ''), nullif(trim(new.contact_phone), '')) is null then
    return new;
  end if;
  select id into v_id from public.client_contacts where client_id = new.id and is_primary order by created_at limit 1;
  if v_id is null then
    insert into public.client_contacts (client_id, name, role, email, phone, is_primary)
    values (new.id, coalesce(nullif(trim(new.contact_name), ''), 'Contact'), nullif(trim(new.contact_function), ''),
            nullif(trim(new.contact_email), ''), nullif(trim(new.contact_phone), ''), true);
  else
    update public.client_contacts
       set name = coalesce(nullif(trim(new.contact_name), ''), name),
           role = nullif(trim(new.contact_function), ''),
           email = nullif(trim(new.contact_email), ''),
           phone = nullif(trim(new.contact_phone), ''),
           updated_at = now()
     where id = v_id;
  end if;
  return new;
end $$;

-- Après le retrait d'un contact : nouveau principal, ou champs de la fiche vidés
create or replace function public.client_contact_sync_primary(p_client_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.client_contacts where client_id = p_client_id and is_primary) then
    select id into v_id from public.client_contacts where client_id = p_client_id order by created_at limit 1;
    if v_id is null then
      update public.clients set contact_name = null, contact_function = null, contact_email = null, contact_phone = null where id = p_client_id;
    else
      update public.client_contacts set is_primary = true where id = v_id;
    end if;
  end if;
end $$;
grant execute on function public.client_contact_sync_primary(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'client_contact_to_client_trg') then
    create trigger client_contact_to_client_trg after insert or update on public.client_contacts
      for each row execute function public.client_contact_to_client();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'client_to_primary_contact_trg') then
    create trigger client_to_primary_contact_trg after insert or update on public.clients
      for each row execute function public.client_to_primary_contact();
  end if;
end $$;

insert into public.schema_migrations (version) values ('0037_contacts_client_source_unique') on conflict (version) do nothing;

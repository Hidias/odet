-- Retour arrière de 0404_documents_espace_client.sql. Le bucket et ses fichiers restent. Idempotent.

drop function if exists public.client_portal_mes_documents(text, text);
drop function if exists public.ent_mes_documents();
drop function if exists app.portail_documents_client(uuid);
drop table if exists public.client_shared_documents;
drop function if exists app.client_shared_documents_fige();

alter table public.portal_events drop constraint if exists portal_events_object_type_check;
alter table public.portal_events add constraint portal_events_object_type_check
  check (object_type is null or object_type in ('session', 'invoice', 'quote', 'itv_visit', 'itv_contract'));

create or replace function app.objet_du_client(p_type text, p_id uuid, p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'session' then exists (select 1 from public.sessions s where s.id = p_id and s.client_id = p_client)
      or exists (select 1 from public.session_groups g where g.session_id = p_id and g.client_id = p_client)
    when 'invoice' then exists (select 1 from public.invoices i where i.id = p_id and (i.client_id = p_client or i.billing_client_id = p_client))
    when 'quote' then exists (select 1 from public.quotes q where q.id = p_id and q.client_id = p_client)
    when 'itv_visit' then exists (select 1 from public.itv_visits v where v.id = p_id and v.client_id = p_client)
    when 'itv_contract' then exists (select 1 from public.itv_contracts c where c.id = p_id and c.client_id = p_client)
    else false end
$$;
revoke all on function app.objet_du_client(text, uuid, uuid) from public, anon, authenticated;

delete from public.schema_migrations where version = '0404_documents_espace_client';

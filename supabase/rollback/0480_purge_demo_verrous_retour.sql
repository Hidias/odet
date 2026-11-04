-- Retour arrière de 0480 : verrous d'origine (0435, 0454) ; réglage de la purge retiré.
create or replace function app.devis_signe(p_quote uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.quotes q
    where q.id = p_quote and q.status in ('accepted', 'partial', 'invoiced', 'replaced')
      and (q.signature_base64 is not null
        or exists (select 1 from public.document_signatures d
                   where d.status = 'valid' and d.signer_type = 'client' and d.metadata ->> 'object_id' = q.id::text)
        or exists (select 1 from public.client_deposits cd
                   where cd.object_type = 'quote' and cd.object_id = q.id and cd.status = 'valide')))
$$;

create or replace function app.frais_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.company_id, new.trainer_id, new.session_id, new.spent_on, new.category, new.amount_ttc, new.km, new.description, new.receipt_path, new.created_by, new.created_at)
     is distinct from (old.company_id, old.trainer_id, old.session_id, old.spent_on, old.category, old.amount_ttc, old.km, old.description, old.receipt_path, old.created_by, old.created_at) then
    raise exception 'Une note de frais déclarée ne se modifie pas : refusez-la avec un motif' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'soumise' and new.status in ('validee', 'refusee', 'annulee'))
         or (old.status = 'validee' and new.status in ('remboursee', 'soumise'))
         or (old.status = 'refusee' and new.status = 'soumise')) then
      raise exception 'Passage impossible de « % » à « % »', old.status, new.status using errcode = '23514';
    end if;
    if new.status = 'refusee' and length(btrim(coalesce(new.decision_note, ''))) < 3 then
      raise exception 'Indiquez le motif du refus' using errcode = '23514';
    end if;
    if new.status = 'remboursee' and new.paid_on is null then new.paid_on := public.paris_today(); end if;
    if new.status = 'soumise' then new.decided_by := null; new.decided_at := null; new.paid_on := null;
    else new.decided_by := (select auth.uid()); new.decided_at := now(); end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

revoke all on function app.frais_garde() from public, anon, authenticated;

do $do$
begin
  if to_regprocedure('app.purge_demo_data_corps()') is not null then
    drop function if exists public.purge_demo_data();
    alter function app.purge_demo_data_corps() set schema public;
    alter function public.purge_demo_data_corps() rename to purge_demo_data;
  end if;
end
$do$;
revoke all on function public.purge_demo_data() from public, anon;
grant execute on function public.purge_demo_data() to authenticated;

delete from public.schema_migrations where version = '0480_purge_demo_verrous';

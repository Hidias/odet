-- 0362_facturation_verrou.sql : facture émise figée, en base (Facturation fiable).
--
-- Décision du 17/10 : une facture émise n'est modifiable ni supprimable par personne, super administrateur compris ;
-- une erreur se corrige par un avoir. Garanti en base pour l'application, l'API et tous les comptes.
--   À la création : un document naît brouillon, sans numéro (référence « BROUILLON-… »), jamais déjà émis.
--   Brouillon : il ne quitte l'état brouillon que par billing_issue (0361).
--   Émis : seuls changent les champs de vie (statut de paiement, montants payés, dus et crédités, transmission au
--   comptable, notes internes, date de mise à jour) ; retour en brouillon et annulation refusés ; suppression refusée.
--   Lignes d'un document émis : aucune création, modification ni suppression.
-- Limite connue : le propriétaire de la base (éditeur SQL de Supabase) peut désactiver un déclencheur.
-- Idempotente. Retour arrière : supabase/rollback/0360-0362_facturation_numerotation_retour.sql

-- Sans SECURITY DEFINER : current_user est le rôle de la requête. Un compte connecté (authenticated) ne peut pas poser
-- la date d'émission lui-même ; billing_issue (SECURITY DEFINER, propriétaire de la base) le peut.
create or replace function app.invoices_verrou()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.issued_at := null;
    new.issued_by := null;
    new.seller_snapshot := null;
    new.buyer_snapshot := null;
    new.status := 'draft';
    new.reference := 'BROUILLON-' || upper(substr(replace(new.id::text, '-', ''), 1, 10));
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.issued_at is not null then
      raise exception 'Document émis (%) : suppression impossible, corriger par un avoir', old.reference using errcode = '42501';
    end if;
    return old;
  end if;
  -- UPDATE
  if old.issued_at is null then
    if new.issued_at is not null and current_user in ('authenticated', 'anon') then
      raise exception 'L''émission passe par la fonction d''émission' using errcode = '42501';
    end if;
    if new.issued_at is null and new.status is distinct from 'draft' then
      raise exception 'Un brouillon s''émet avant de changer de statut' using errcode = '42501';
    end if;
    if new.issued_at is null then
      new.reference := old.reference;
    end if;
    return new;
  end if;
  if new.status in ('draft', 'cancelled') then
    raise exception 'Document émis (%) : retour en brouillon ou annulation impossible, corriger par un avoir', old.reference
      using errcode = '42501';
  end if;
  if (new.reference, new.type, new.client_id, new.contact_id, new.quote_id, new.session_id, new.parent_invoice_id,
      new.client_reference, new.invoice_date, new.service_start_date, new.service_end_date, new.due_date, new.object,
      new.payment_method, new.payment_terms, new.discount_percent, new.discount_label, new.tva_applicable, new.total_ht,
      new.total_discount, new.total_net_ht, new.total_tva, new.total_ttc, new.is_formation_pro, new.billing_client_id,
      new.is_subrogation, new.issued_at, new.issued_by, new.seller_snapshot, new.buyer_snapshot, new.created_by, new.created_at)
     is distinct from
     (old.reference, old.type, old.client_id, old.contact_id, old.quote_id, old.session_id, old.parent_invoice_id,
      old.client_reference, old.invoice_date, old.service_start_date, old.service_end_date, old.due_date, old.object,
      old.payment_method, old.payment_terms, old.discount_percent, old.discount_label, old.tva_applicable, old.total_ht,
      old.total_discount, old.total_net_ht, old.total_tva, old.total_ttc, old.is_formation_pro, old.billing_client_id,
      old.is_subrogation, old.issued_at, old.issued_by, old.seller_snapshot, old.buyer_snapshot, old.created_by, old.created_at) then
    raise exception 'Document émis (%) : contenu figé, corriger par un avoir', old.reference using errcode = '42501';
  end if;
  return new;
end
$$;

create or replace function app.invoice_items_verrou()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
begin
  if exists (select 1 from public.invoices i where i.id = v_id and i.issued_at is not null)
     or (tg_op = 'UPDATE' and exists (select 1 from public.invoices i where i.id = old.invoice_id and i.issued_at is not null)) then
    raise exception 'Lignes d''un document émis : contenu figé, corriger par un avoir' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

revoke all on function app.invoice_items_verrou() from public, anon, authenticated;
revoke all on function app.invoices_verrou() from public, anon;
grant execute on function app.invoices_verrou() to authenticated, service_role;

drop trigger if exists invoices_verrou_creation on public.invoices;
create trigger invoices_verrou_creation before insert on public.invoices
  for each row execute function app.invoices_verrou();
drop trigger if exists invoices_verrou on public.invoices;
create trigger invoices_verrou before update or delete on public.invoices
  for each row execute function app.invoices_verrou();
drop trigger if exists invoice_items_verrou on public.invoice_items;
create trigger invoice_items_verrou before insert or update or delete on public.invoice_items
  for each row execute function app.invoice_items_verrou();

insert into public.schema_migrations (version) values ('0362_facturation_verrou') on conflict (version) do nothing;

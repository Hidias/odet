-- Retour arrière de 0363_facturation_mentions.sql : émission de 0361 remise telle quelle, contrôle des mentions
-- retiré, colonnes ajoutées retirées (les mentions figées des factures émises entre-temps sont perdues). Idempotent.

create or replace function public.billing_issue(p_invoice uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
  v_company uuid := app.billing_company();
  s public.billing_settings;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_prefix text;
  v_last bigint;
  v_ref text;
  t jsonb;
  v_parent public.invoices;
  v_credites numeric;
  v_seller jsonb;
  v_buyer jsonb;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if inv.id is null then
    raise exception 'Document introuvable' using errcode = 'P0002';
  end if;
  if not app.a_le_droit(case when inv.type = 'credit_note' then 'facturation.avoirs.emettre' else 'facturation.factures.valider' end) then
    raise exception 'Accès refusé : émettre ce document ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  if inv.issued_at is not null then
    raise exception 'Ce document est déjà émis (%)', inv.reference using errcode = '22023';
  end if;
  if inv.client_id is null then
    raise exception 'Client manquant' using errcode = '22023';
  end if;
  if not exists (select 1 from public.invoice_items where invoice_id = p_invoice) then
    raise exception 'Document sans ligne' using errcode = '22023';
  end if;

  t := public.billing_compute_totals(p_invoice);
  if inv.type = 'credit_note' then
    select * into v_parent from public.invoices where id = inv.parent_invoice_id;
    if v_parent.id is null or v_parent.issued_at is null then
      raise exception 'Un avoir se rattache à une facture émise' using errcode = '22023';
    end if;
    select coalesce(sum(total_ttc), 0) into v_credites from public.invoices
    where parent_invoice_id = v_parent.id and type = 'credit_note' and issued_at is not null;
    if v_credites + (t ->> 'total_ttc')::numeric > coalesce(v_parent.total_ttc, 0) + 0.01 then
      raise exception 'Avoirs supérieurs au montant de la facture % (% € déjà crédités)', v_parent.reference, v_credites
        using errcode = '22023';
    end if;
  elsif (t ->> 'total_ttc')::numeric <= 0 then
    raise exception 'Facture d''un montant nul ou négatif : utiliser un avoir' using errcode = '22023';
  end if;

  -- Réglages et compteur de la société (ligne verrouillée jusqu'à la fin de la transaction)
  insert into public.billing_settings (company_id) values (v_company) on conflict (company_id) do nothing;
  select * into s from public.billing_settings where company_id = v_company;
  v_prefix := case when inv.type = 'credit_note' then s.credit_prefix else s.invoice_prefix end;
  select q.last_number into v_last from public.billing_sequences q
  where q.company_id = v_company and q.series = inv.type for update;
  if v_last is null then
    v_last := coalesce(case when inv.type = 'credit_note' then s.credit_last_number_before else s.invoice_last_number_before end,
      (select max((regexp_match(i.reference, '([0-9]+)$'))[1]::bigint) from public.invoices i
        where i.issued_at is not null and i.type = inv.type and i.reference like v_prefix || '%'), 0);
    insert into public.billing_sequences (company_id, series, last_number) values (v_company, inv.type, v_last)
    on conflict (company_id, series) do nothing;
    select q.last_number into v_last from public.billing_sequences q
    where q.company_id = v_company and q.series = inv.type for update;
  end if;
  v_ref := app.billing_format(s.number_format, v_prefix, v_today, v_last + 1);
  if exists (select 1 from public.invoices where reference = v_ref) then
    raise exception 'Numéro % déjà utilisé : vérifier le dernier numéro dans les réglages de facturation', v_ref
      using errcode = '23505';
  end if;
  update public.billing_sequences set last_number = v_last + 1, updated_at = now()
  where company_id = v_company and series = inv.type;

  -- Coordonnées figées (vendeur : réglages de l'organisme ; client et payeur : fiches au moment de l'émission)
  select jsonb_strip_nulls(jsonb_build_object('name', o.name, 'legal_name', o.legal_name, 'forme_juridique', o.forme_juridique,
           'capital_social', o.capital_social, 'siret', o.siret, 'siren', o.siren, 'naf', o.naf, 'tva_intra', o.tva_intra,
           'rcs', o.rcs, 'nda', o.nda, 'address', o.address, 'postal_code', o.postal_code, 'city', o.city,
           'phone', o.phone, 'email', o.email, 'website', o.website))
    into v_seller from public.organization_settings o limit 1;
  select jsonb_strip_nulls(jsonb_build_object('client', (select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name,
           'address', c.address, 'postal_code', c.postal_code, 'city', c.city, 'siret', c.siret, 'siren', c.siren, 'tva', c.tva,
           'client_type', c.client_type)) from public.clients c where c.id = inv.client_id),
         'payeur', (select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name, 'address', c.address,
           'postal_code', c.postal_code, 'city', c.city, 'siret', c.siret, 'siren', c.siren, 'tva', c.tva))
           from public.clients c where c.id = inv.billing_client_id)))
    into v_buyer;

  update public.invoices set
    reference = v_ref,
    issued_at = now(),
    issued_by = (select auth.uid()),
    due_date = case when inv.due_date is not null and inv.invoice_date is not null
                    then v_today + (inv.due_date - inv.invoice_date) else inv.due_date end,
    invoice_date = v_today,
    total_ht = (t ->> 'total_ht')::numeric,
    total_discount = (t ->> 'total_discount')::numeric,
    total_net_ht = (t ->> 'total_net_ht')::numeric,
    total_tva = (t ->> 'total_tva')::numeric,
    total_ttc = (t ->> 'total_ttc')::numeric,
    amount_due = case when inv.type = 'credit_note' then inv.amount_due
                      else greatest(0, (t ->> 'total_ttc')::numeric - coalesce(inv.amount_paid, 0) - coalesce(inv.amount_credited, 0)) end,
    status = 'due',
    seller_snapshot = v_seller,
    buyer_snapshot = v_buyer,
    updated_at = now()
  where id = p_invoice;

  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'document', p_invoice, v_ref,
          jsonb_build_object('emission', true, 'type', inv.type));

  return jsonb_build_object('reference', v_ref, 'invoice_date', v_today, 'total_ttc', (t ->> 'total_ttc')::numeric);
end
$$;

revoke all on function public.billing_issue(uuid) from public, anon;
grant execute on function public.billing_issue(uuid) to authenticated, service_role;
drop function if exists public.billing_missing_mentions(uuid);
drop function if exists app.billing_check(uuid);

alter table public.clients drop column if exists chorus_engagement_required;
alter table public.clients drop column if exists chorus_service_code;
alter table public.invoices drop column if exists chorus_engagement;
alter table public.invoices drop column if exists chorus_service_code;
alter table public.invoices drop column if exists nature_operation;
alter table public.invoices drop column if exists legal_mentions;
alter table public.billing_settings drop column if exists exoneration_attestation_date;
alter table public.billing_settings drop column if exists exoneration_attestation_ref;
alter table public.billing_settings drop column if exists exoneration_formation_active;
alter table public.billing_settings drop column if exists mention_debits;
alter table public.billing_settings drop column if exists option_debits;
alter table public.billing_settings drop column if exists mention_autoliquidation;
alter table public.billing_settings drop column if exists mention_franchise;
alter table public.billing_settings drop column if exists mention_exoneration;
alter table public.billing_settings drop column if exists mention_escompte;
alter table public.billing_settings drop column if exists mention_indemnite;
alter table public.billing_settings drop column if exists mention_penalites;
alter table public.quote_items drop constraint if exists quote_items_vat_regime_check;
alter table public.quote_items drop constraint if exists quote_items_nature_check;
alter table public.invoice_items drop constraint if exists invoice_items_vat_regime_check;
alter table public.invoice_items drop constraint if exists invoice_items_nature_check;
alter table public.quote_items drop column if exists vat_regime;
alter table public.quote_items drop column if exists nature;
alter table public.invoice_items drop column if exists vat_regime;
alter table public.invoice_items drop column if exists nature;

delete from public.schema_migrations where version = '0363_facturation_mentions';

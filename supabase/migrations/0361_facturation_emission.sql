-- 0361_facturation_emission.sql : émission des factures et des avoirs par la base (Facturation fiable).
--
-- Décisions du 17/10 : aucun numéro avant la validation (le brouillon porte « BROUILLON-… », sans valeur) ; le numéro
-- définitif est donné par la base à l'émission, dans la même transaction que le calcul des totaux et le gel des
-- coordonnées du vendeur et du client ; « émise » = date d'émission renseignée (issued_at), les statuts actuels
-- restent ceux des écrans.
--   app.billing_company()         société de facturation (la société de l'instance tant que C2 n'a pas rattaché
--                                 invoices à une société)
--   app.billing_format(...)       numéro selon le format réglé : {PREFIXE} {AAAA} {MM} {JJ} {AAAAMMJJ} {N} {N4}..{N9}
--   billing_compute_totals(id)    totaux d'un document, même règle que src/core/billing/totals.js (EN 16931)
--   billing_issue(id)             émission : contrôles, totaux, coordonnées figées, numéro, date du jour
--   billing_next_number(type)     aperçu du prochain numéro (lecture, n'avance pas le compteur)
-- Reprise : les factures déjà sorties du brouillon sont marquées émises (date de facture) ; leurs numéros restent.
-- Idempotente. Retour arrière : supabase/rollback/0360-0362_facturation_numerotation_retour.sql

alter table public.invoices add column if not exists issued_at timestamptz;
alter table public.invoices add column if not exists issued_by uuid;
alter table public.invoices add column if not exists seller_snapshot jsonb;
alter table public.invoices add column if not exists buyer_snapshot jsonb;
comment on column public.invoices.issued_at is 'Date d''émission : la facture est numérotée et figée (aucune modification ni suppression ensuite)';
comment on column public.invoices.seller_snapshot is 'Coordonnées du vendeur figées à l''émission';
comment on column public.invoices.buyer_snapshot is 'Coordonnées du client (et du payeur) figées à l''émission';

-- Reprise : ce qui n'est plus un brouillon a déjà été émis
update public.invoices
   set issued_at = coalesce(invoice_date::timestamp at time zone 'Europe/Paris', created_at)
 where issued_at is null and status is distinct from 'draft';

create or replace function app.billing_company()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_company(), (select c.id from public.companies c where c.is_instance_owner limit 1))
$$;

create or replace function app.billing_format(p_format text, p_prefix text, p_day date, p_number bigint)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := p_format;
  m text[];
begin
  v := replace(v, '{PREFIXE}', p_prefix);
  v := replace(v, '{AAAAMMJJ}', to_char(p_day, 'YYYYMMDD'));
  v := replace(v, '{AAAA}', to_char(p_day, 'YYYY'));
  v := replace(v, '{MM}', to_char(p_day, 'MM'));
  v := replace(v, '{JJ}', to_char(p_day, 'DD'));
  m := regexp_match(v, '\{N([0-9]?)\}');
  if m is null then
    raise exception 'Format de numéro sans compteur : %', p_format using errcode = '22023';
  end if;
  return regexp_replace(v, '\{N[0-9]?\}',
    case when m[1] = '' then p_number::text else lpad(p_number::text, greatest(m[1]::int, length(p_number::text)), '0') end);
end
$$;

-- Totaux : ligne arrondie ; regroupement par taux ; remise par groupe arrondie ; TVA par groupe arrondie ; TTC = HT net + TVA
create or replace function public.billing_compute_totals(p_invoice uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with inv as (
    select i.id, coalesce(i.discount_percent, 0) as dp, coalesce(i.tva_applicable, true) as vat
    from public.invoices i where i.id = p_invoice and app.a_le_droit('facturation.factures.voir')
  ), lignes as (
    select case when inv.vat then coalesce(it.tva_rate, 20) else 0 end as rate,
           round(coalesce(it.quantity, 0) * coalesce(it.unit_price_ht, 0), 2) as net
    from public.invoice_items it join inv on inv.id = it.invoice_id
  ), groupes as (
    select l.rate, round(sum(l.net), 2) as lines from lignes l group by l.rate
  ), calc as (
    select g.rate, g.lines,
           case when inv.dp > 0 then round(g.lines * inv.dp / 100, 2) else 0 end as allowance
    from groupes g, inv
  ), fin as (
    select c.rate, c.lines, c.allowance, round(c.lines - c.allowance, 2) as base,
           case when c.rate > 0 then round(round(c.lines - c.allowance, 2) * c.rate / 100, 2) else 0 end as tax
    from calc c
  )
  select jsonb_build_object(
    'total_ht', coalesce((select round(sum(net), 2) from lignes), 0),
    'total_discount', coalesce((select round(sum(allowance), 2) from fin), 0),
    'total_net_ht', coalesce((select round(sum(base), 2) from fin), 0),
    'total_tva', coalesce((select round(sum(tax), 2) from fin), 0),
    'total_ttc', coalesce((select round(sum(base), 2) + round(sum(tax), 2) from fin), 0),
    'par_taux', coalesce((select jsonb_agg(jsonb_build_object('taux', rate, 'base', base, 'tva', tax) order by rate) from fin), '[]'::jsonb))
$$;

create or replace function public.billing_next_number(p_type text default 'invoice')
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.billing_company();
  s public.billing_settings;
  v_prefix text;
  v_last bigint;
begin
  if not (app.a_le_droit('facturation.factures.voir')) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select * into s from public.billing_settings where company_id = v_company;
  v_prefix := case when p_type = 'credit_note' then coalesce(s.credit_prefix, 'AVR') else coalesce(s.invoice_prefix, 'FACT') end;
  select q.last_number into v_last from public.billing_sequences q where q.company_id = v_company and q.series = p_type;
  if v_last is null then
    v_last := coalesce(case when p_type = 'credit_note' then s.credit_last_number_before else s.invoice_last_number_before end,
      (select max((regexp_match(i.reference, '([0-9]+)$'))[1]::bigint) from public.invoices i
        where i.issued_at is not null and i.type = p_type and i.reference like v_prefix || '%'), 0);
  end if;
  return app.billing_format(coalesce(s.number_format, '{PREFIXE}-{AAAAMMJJ}-{N5}'), v_prefix,
                            (now() at time zone 'Europe/Paris')::date, v_last + 1);
end
$$;

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

revoke all on function app.billing_company(), app.billing_format(text, text, date, bigint) from public, anon;
grant execute on function app.billing_company(), app.billing_format(text, text, date, bigint) to authenticated, service_role;
revoke all on function public.billing_compute_totals(uuid), public.billing_next_number(text), public.billing_issue(uuid)
  from public, anon;
grant execute on function public.billing_compute_totals(uuid), public.billing_next_number(text), public.billing_issue(uuid)
  to authenticated, service_role;

insert into public.schema_migrations (version) values ('0361_facturation_emission') on conflict (version) do nothing;

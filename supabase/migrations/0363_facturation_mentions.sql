-- 0363_facturation_mentions.sql : mentions obligatoires, nature et régime de TVA par ligne (Facturation fiable).
--
-- Règles vérifiées : odet-facturation-phase1.md § 1 et 2. Décision du 17/10 : aucune exonération pour la première société
-- (régime « exonéré formation » désactivé dans ses réglages, disponible pour d'autres organismes).
--   invoice_items, quote_items : nature (service, bien) et régime de TVA (normal, exonéré, autoliquidation) par ligne ;
--     la franchise est un régime du vendeur (organization_settings.tva_applicable = faux), pas d'une ligne.
--   billing_settings : textes des mentions réglables (recodification CIBS au 01/01/2027 : aucune phrase légale dans le
--     code), option pour la TVA sur les débits, exonération de la formation et son attestation.
--   invoices : mentions et nature de l'opération figées à l'émission ; champs Chorus Pro (code service, engagement).
--   clients : code service Chorus par défaut et engagement exigé.
--   app.billing_check(facture) : points à compléter (bloquants ou alertes), mentions et nature calculées ;
--   billing_missing_mentions(facture) pour l'écran ; billing_issue refuse l'émission si un point est bloquant.
-- Idempotente. Retour arrière : supabase/rollback/0363_facturation_mentions_retour.sql

alter table public.invoice_items add column if not exists nature text not null default 'service';
alter table public.invoice_items add column if not exists vat_regime text not null default 'normal';
alter table public.quote_items add column if not exists nature text not null default 'service';
alter table public.quote_items add column if not exists vat_regime text not null default 'normal';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_items_nature_check') then
    alter table public.invoice_items add constraint invoice_items_nature_check check (nature in ('service', 'bien'));
    alter table public.invoice_items add constraint invoice_items_vat_regime_check check (vat_regime in ('normal', 'exonere', 'autoliquidation'));
    alter table public.quote_items add constraint quote_items_nature_check check (nature in ('service', 'bien'));
    alter table public.quote_items add constraint quote_items_vat_regime_check check (vat_regime in ('normal', 'exonere', 'autoliquidation'));
  end if;
end
$$;
comment on column public.invoice_items.nature is 'Nature de la ligne : service ou bien (nature de l''opération, cadre de facturation du Factur-X)';
comment on column public.invoice_items.vat_regime is 'Régime de TVA de la ligne : normal, exonere (mention d''exonération réglée), autoliquidation';

alter table public.billing_settings add column if not exists mention_penalites text not null
  default 'Pénalités de retard : taux directeur de la Banque centrale européenne majoré de 10 points (art. L441-10 du code de commerce).';
alter table public.billing_settings add column if not exists mention_indemnite text not null
  default 'Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 € (art. D441-5 du code de commerce).';
alter table public.billing_settings add column if not exists mention_escompte text not null default 'Escompte pour paiement anticipé : néant.';
alter table public.billing_settings add column if not exists mention_exoneration text not null default 'Exonération de TVA, article 261-4-4° a du CGI.';
alter table public.billing_settings add column if not exists mention_franchise text not null default 'TVA non applicable, art. 293 B du CGI.';
alter table public.billing_settings add column if not exists mention_autoliquidation text not null default 'Autoliquidation.';
alter table public.billing_settings add column if not exists option_debits boolean not null default false;
alter table public.billing_settings add column if not exists mention_debits text not null default 'Option pour le paiement de la taxe d''après les débits.';
alter table public.billing_settings add column if not exists exoneration_formation_active boolean not null default false;
alter table public.billing_settings add column if not exists exoneration_attestation_ref text;
alter table public.billing_settings add column if not exists exoneration_attestation_date date;
comment on column public.billing_settings.exoneration_formation_active is 'Exonération de la formation (attestation DREETS, formulaire 3511-SD), désactivée par défaut';

alter table public.invoices add column if not exists legal_mentions jsonb;
alter table public.invoices add column if not exists nature_operation text;
alter table public.invoices add column if not exists chorus_service_code text;
alter table public.invoices add column if not exists chorus_engagement text;
comment on column public.invoices.legal_mentions is 'Mentions légales figées à l''émission (liste de textes)';
comment on column public.invoices.nature_operation is 'Nature de l''opération figée à l''émission : services, biens ou mixte';

alter table public.clients add column if not exists chorus_service_code text;
alter table public.clients add column if not exists chorus_engagement_required boolean not null default false;
comment on column public.clients.chorus_service_code is 'Client public : code du service chargé du paiement (annuaire Chorus Pro), repris par défaut sur les factures';

-- Contrôle d'une facture ou d'un avoir : points à compléter, mentions légales et nature calculées
create or replace function app.billing_check(p_invoice uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
  c public.clients;
  o public.organization_settings;
  s public.billing_settings;
  v_pts jsonb := '[]'::jsonb;
  v_ment jsonb := '[]'::jsonb;
  v_pro boolean;
  v_public boolean;
  v_credit boolean;
  v_net numeric;
  v_n_bien int;
  v_n_service int;
  v_exo boolean;
  v_auto boolean;
  v_franchise boolean;
  v_societe boolean;
begin
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null then
    raise exception 'Document introuvable' using errcode = 'P0002';
  end if;
  select * into c from public.clients where id = coalesce(inv.billing_client_id, inv.client_id);
  select * into o from public.organization_settings limit 1;
  select * into s from public.billing_settings where company_id = app.billing_company();
  v_credit := inv.type = 'credit_note';
  v_pro := coalesce(c.client_type, 'entreprise') <> 'particulier';
  v_public := c.client_type = 'public';
  v_franchise := o.tva_applicable is false;
  v_societe := coalesce(o.forme_juridique, '') !~* '(entrepreneur|individuel|^ei$|micro)';
  select coalesce(sum(round(coalesce(quantity, 0) * coalesce(unit_price_ht, 0), 2)), 0) * (1 - coalesce(inv.discount_percent, 0) / 100),
         count(*) filter (where nature = 'bien'), count(*) filter (where nature <> 'bien'),
         bool_or(vat_regime = 'exonere'), bool_or(vat_regime = 'autoliquidation')
    into v_net, v_n_bien, v_n_service, v_exo, v_auto
  from public.invoice_items where invoice_id = p_invoice;

  -- Vendeur
  if coalesce(nullif(btrim(o.legal_name), ''), nullif(btrim(o.name), '')) is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_nom', 'libelle', 'raison sociale de l''organisme', 'ou', 'parametres', 'bloquant', true);
  end if;
  if coalesce(nullif(btrim(o.siren), ''), nullif(btrim(o.siret), '')) is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_siren', 'libelle', 'SIREN de l''organisme', 'ou', 'parametres', 'bloquant', true);
  end if;
  if nullif(btrim(o.address), '') is null or nullif(btrim(o.postal_code), '') is null or nullif(btrim(o.city), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_adresse', 'libelle', 'adresse du siège de l''organisme', 'ou', 'parametres', 'bloquant', true);
  end if;
  if nullif(btrim(o.forme_juridique), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_forme', 'libelle', 'forme juridique de l''organisme', 'ou', 'parametres', 'bloquant', true);
  elsif v_societe and o.capital_social is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_capital', 'libelle', 'capital social de l''organisme', 'ou', 'parametres', 'bloquant', true);
  end if;
  if not v_franchise and nullif(btrim(o.tva_intra), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_tva', 'libelle', 'numéro de TVA intracommunautaire de l''organisme', 'ou', 'parametres', 'bloquant', true);
  end if;
  if v_societe and nullif(btrim(o.rcs), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'vendeur_rcs', 'libelle', 'mention RCS et ville du greffe de l''organisme', 'ou', 'parametres', 'bloquant', false);
  end if;

  -- Client
  if c.id is null or nullif(btrim(c.name), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'client_nom', 'libelle', 'nom du client', 'ou', 'client', 'bloquant', true);
  end if;
  if c.id is not null and (nullif(btrim(c.address), '') is null or nullif(btrim(c.postal_code), '') is null or nullif(btrim(c.city), '') is null) then
    v_pts := v_pts || jsonb_build_object('code', 'client_adresse', 'libelle', 'adresse complète du client', 'ou', 'client', 'bloquant', true);
  end if;
  if v_pro and coalesce(nullif(btrim(c.siren), ''), nullif(btrim(c.siret), '')) is null then
    v_pts := v_pts || jsonb_build_object('code', 'client_siren', 'libelle', 'SIREN ou SIRET du client', 'ou', 'client', 'bloquant', true);
  end if;
  if v_pro and not coalesce(c.vat_exempt, false) and not v_franchise and v_net > 150 and nullif(btrim(c.tva), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'client_tva', 'libelle', 'numéro de TVA du client (au-delà de 150 € HT)', 'ou', 'client', 'bloquant', true);
  end if;
  if v_public and nullif(btrim(c.siret), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'public_siret', 'libelle', 'SIRET du client public (Chorus Pro)', 'ou', 'client', 'bloquant', true);
  end if;
  if v_public and nullif(btrim(c.chorus_service_code), '') is not null and nullif(btrim(inv.chorus_service_code), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'chorus_service', 'libelle', 'code service Chorus Pro sur la facture', 'ou', 'facture', 'bloquant', true);
  end if;
  if v_public and coalesce(c.chorus_engagement_required, false)
     and coalesce(nullif(btrim(inv.chorus_engagement), ''), nullif(btrim(inv.client_reference), '')) is null then
    v_pts := v_pts || jsonb_build_object('code', 'chorus_engagement', 'libelle', 'numéro d''engagement ou bon de commande (Chorus Pro)', 'ou', 'facture', 'bloquant', true);
  end if;

  -- Lignes et régimes
  if v_exo and not coalesce(s.exoneration_formation_active, false) then
    v_pts := v_pts || jsonb_build_object('code', 'exoneration', 'libelle', 'ligne exonérée alors que l''exonération n''est pas activée dans les réglages', 'ou', 'facture', 'bloquant', true);
  elsif v_exo and nullif(btrim(s.exoneration_attestation_ref), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'exoneration_attestation', 'libelle', 'référence de l''attestation d''exonération (réglages de facturation)', 'ou', 'parametres', 'bloquant', true);
  end if;
  if v_auto and (not v_pro or nullif(btrim(c.tva), '') is null) then
    v_pts := v_pts || jsonb_build_object('code', 'autoliquidation', 'libelle', 'autoliquidation seulement pour un client professionnel avec son numéro de TVA', 'ou', 'facture', 'bloquant', true);
  end if;
  if v_franchise and exists (select 1 from public.invoice_items where invoice_id = p_invoice and coalesce(tva_rate, 0) > 0) then
    v_pts := v_pts || jsonb_build_object('code', 'franchise_taux', 'libelle', 'TVA sur une ligne alors que l''organisme est en franchise', 'ou', 'facture', 'bloquant', true);
  end if;

  -- Facture
  if not v_credit and inv.due_date is null then
    v_pts := v_pts || jsonb_build_object('code', 'echeance', 'libelle', 'date d''échéance', 'ou', 'facture', 'bloquant', true);
  end if;
  if inv.service_start_date is null and inv.service_end_date is null then
    v_pts := v_pts || jsonb_build_object('code', 'date_prestation', 'libelle', 'date de la prestation (à défaut, la date d''émission vaut date de prestation)', 'ou', 'facture', 'bloquant', false);
  end if;

  -- Mentions légales
  if not v_credit and v_pro then
    v_ment := v_ment || to_jsonb(coalesce(s.mention_escompte, 'Escompte pour paiement anticipé : néant.'));
    v_ment := v_ment || to_jsonb(s.mention_penalites);
    v_ment := v_ment || to_jsonb(s.mention_indemnite);
  end if;
  if v_franchise then v_ment := v_ment || to_jsonb(s.mention_franchise); end if;
  if v_exo then
    v_ment := v_ment || to_jsonb(s.mention_exoneration || coalesce(' Attestation ' || nullif(btrim(s.exoneration_attestation_ref), ''), '')
      || coalesce(' du ' || to_char(s.exoneration_attestation_date, 'DD/MM/YYYY'), '') || case when s.exoneration_attestation_ref is not null then '.' else '' end);
  end if;
  if v_auto then v_ment := v_ment || to_jsonb(s.mention_autoliquidation); end if;
  if s.option_debits and not v_franchise then v_ment := v_ment || to_jsonb(s.mention_debits); end if;
  v_ment := (select coalesce(jsonb_agg(m), '[]'::jsonb) from jsonb_array_elements(v_ment) m where m is not null and m <> 'null'::jsonb);

  return jsonb_build_object('points', v_pts, 'mentions', v_ment,
    'nature', case when v_n_bien > 0 and v_n_service > 0 then 'mixte' when v_n_bien > 0 then 'biens' else 'services' end);
end
$$;

create or replace function public.billing_missing_mentions(p_invoice uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.a_le_droit('facturation.factures.voir') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return app.billing_check(p_invoice);
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
  v_check jsonb;
  v_bloquants text;
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

  -- Mentions obligatoires (0363) : un seul point bloquant suffit à refuser l'émission
  v_check := app.billing_check(p_invoice);
  select string_agg(p ->> 'libelle', ' ; ') into v_bloquants
  from jsonb_array_elements(v_check -> 'points') p where (p ->> 'bloquant')::boolean;
  if v_bloquants is not null then
    raise exception 'Émission impossible, à compléter : %', v_bloquants using errcode = '22023';
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
    legal_mentions = v_check -> 'mentions',
    nature_operation = v_check ->> 'nature',
    updated_at = now()
  where id = p_invoice;

  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'document', p_invoice, v_ref,
          jsonb_build_object('emission', true, 'type', inv.type));

  return jsonb_build_object('reference', v_ref, 'invoice_date', v_today, 'total_ttc', (t ->> 'total_ttc')::numeric);
end
$$;

revoke all on function app.billing_check(uuid) from public, anon, authenticated;
grant execute on function app.billing_check(uuid) to service_role;
revoke all on function public.billing_missing_mentions(uuid) from public, anon;
grant execute on function public.billing_missing_mentions(uuid) to authenticated, service_role;
revoke all on function public.billing_issue(uuid) from public, anon;
grant execute on function public.billing_issue(uuid) to authenticated, service_role;

insert into public.schema_migrations (version) values ('0363_facturation_mentions') on conflict (version) do nothing;

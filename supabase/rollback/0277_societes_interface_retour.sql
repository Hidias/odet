-- Retour arrière de 0277_societes_interface.sql : fonctions d'avant C3 remises, nouvelles fonctions retirées.
-- FICHIER GÉNÉRÉ par scripts/securite/societes_c3.py. Refusé s'il existe plus d'une société.

do $$
begin
  if (select count(*) from public.companies) > 1 then
    raise exception 'Retour arrière refusé : plusieurs sociétés existent';
  end if;
end
$$;


-- app.current_company()
CREATE OR REPLACE FUNCTION app.current_company()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select h.v from (select app.header_company() as v) h
      where h.v in (select app.visible_companies())),
    (select m.company_id from public.company_members m
      where m.profile_id = (select auth.uid()) and m.is_active and m.is_default
        and m.company_id in (select app.visible_companies())
      limit 1),
    (select c.id from public.companies c
      where c.id in (select app.visible_companies())
      order by c.is_instance_owner desc, c.position, c.created_at
      limit 1))
$function$;


-- app.rights()
CREATE OR REPLACE FUNCTION app.rights()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app.rights_for((select auth.uid()), app.current_company())
$function$;


-- app.module_on(text)
CREATE OR REPLACE FUNCTION app.module_on(p_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select m.enabled from public.org_modules m where m.key = p_key), false)
$function$;


-- app.sync_profile_member()
CREATE OR REPLACE FUNCTION app.sync_profile_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company uuid;
  v_role text := app.member_role(new.role);
begin
  select c.id into v_company from public.companies c where c.is_instance_owner;
  if v_company is null then
    return new;
  end if;
  if v_role is null then
    update public.company_members m set is_active = false, updated_at = now()
     where m.company_id = v_company and m.profile_id = new.id and m.is_active;
    return new;
  end if;
  insert into public.company_members (company_id, profile_id, role, can_consolidate, is_default, is_active)
  values (v_company, new.id, v_role, v_role = 'admin',
          not exists (select 1 from public.company_members d where d.profile_id = new.id and d.is_default),
          coalesce(new.is_active, true))
  on conflict (company_id, profile_id) do update
    set role = excluded.role, is_active = excluded.is_active, updated_at = now();
  return new;
end
$function$;


-- public.billing_issue(uuid)
CREATE OR REPLACE FUNCTION public.billing_issue(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  /* société (C2) */ perform app.exiger_societe('invoices', p_invoice, true);
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
$function$;


-- app.billing_check(uuid)
CREATE OR REPLACE FUNCTION app.billing_check(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_ident text;
  v_regle record;
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

  -- Circuit de validation (0367, règles de gestion) : facture soumise à validation selon la règle du client, sinon
  -- de la société, sinon le défaut du produit (toujours validée par « Valider les factures »). Émet directement
  -- la personne qui a le droit du valideur (circuit à une étape) ; sinon il faut une demande validée.
  if not v_credit then
    select * into v_regle from app.approval_rule_for(app.billing_company(), 'invoice', inv.client_id);
    if v_regle.mode = 'always' or (v_regle.mode = 'threshold' and v_net > coalesce(v_regle.threshold, 0)) then
      if not exists (select 1 from public.approval_requests ar where ar.object_table = 'invoices' and ar.object_id = inv.id
                       and ar.status = 'approved')
         and not (app.a_le_droit(v_regle.validator_right) and jsonb_array_length(coalesce(v_regle.extra_steps, '[]'::jsonb)) = 0) then
        v_pts := v_pts || jsonb_build_object('code', 'circuit',
          'libelle', case when exists (select 1 from public.approval_requests ar where ar.object_table = 'invoices'
                                        and ar.object_id = inv.id and ar.status = 'pending')
                          then 'validation en attente (circuit de la société)'
                          else 'validation requise avant émission : demandez la validation' end,
          'ou', 'circuit', 'bloquant', true);
      end if;
    end if;
  end if;

  -- Acomptes (0368) : un avoir sur un acompte déjà déduit d'une facture de solde ferait compter deux fois la déduction ;
  -- une facture de solde ne déduit que des acomptes émis et non annulés.
  if v_credit and exists (select 1 from public.invoice_deposit_links l where l.deposit_invoice_id = inv.parent_invoice_id) then
    v_pts := v_pts || jsonb_build_object('code', 'acompte_repris',
      'libelle', 'acompte déjà déduit d''une facture de solde : faites l''avoir sur la facture de solde', 'ou', 'facture', 'bloquant', true);
  end if;
  if inv.invoice_kind = 'solde' and exists (select 1 from public.invoice_deposit_links l join public.invoices d on d.id = l.deposit_invoice_id
                                            where l.final_invoice_id = inv.id and (d.issued_at is null or coalesce(d.amount_credited, 0) > 0.01)) then
    v_pts := v_pts || jsonb_build_object('code', 'acompte_annule',
      'libelle', 'un acompte déduit a été annulé par un avoir : refaites la facture de solde', 'ou', 'facture', 'bloquant', true);
  end if;

  -- Financement OPCO (0368) : numéro de dossier obligatoire sur une facture à un OPCO ; subrogation signalée si
  -- l'OPCO ne l'accepte plus pour les accords datés de sa date de fin ou après (réglée sur la fiche de l'OPCO).
  if c.client_type = 'opco' and nullif(btrim(coalesce(inv.client_reference, '')), '') is null then
    v_pts := v_pts || jsonb_build_object('code', 'opco_dossier', 'libelle', 'numéro de dossier de l''OPCO (référence client de la facture)',
      'ou', 'facture', 'bloquant', true);
  end if;
  if coalesce(inv.is_subrogation, false) and c.opco_subrogation_end is not null
     and coalesce((select max(f.agreement_date) from public.session_fundings f
                   where f.session_id = inv.session_id and f.funder_client_id = c.id), inv.invoice_date) >= c.opco_subrogation_end then
    v_pts := v_pts || jsonb_build_object('code', 'opco_subrogation',
      'libelle', 'subrogation : ' || coalesce(c.name, 'l''OPCO') || ' ne l''accepte plus pour les accords datés du '
        || to_char(c.opco_subrogation_end, 'DD/MM/YYYY') || ' ou après (vérifiez l''accord)', 'ou', 'facture', 'bloquant', false);
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
  -- Revérification du SIRET dans l'annuaire (0365) : facture à un professionnel, contrôle de moins de 24 h
  -- fait par /api/verifier-siret pour le SIRET actuel du client, ou motif saisi si l'annuaire ne répondait pas.
  v_ident := regexp_replace(coalesce(nullif(btrim(c.siret), ''), c.siren, ''), '\s', '', 'g');
  if v_pro and not v_credit and v_ident ~ '^[0-9]{9}([0-9]{5})?$' then
    if inv.siret_checked_at > now() - interval '24 hours' and inv.siret_check_result ->> 'identifiant' = v_ident then
      if inv.siret_check_result ->> 'etat' in ('ferme', 'siege_deplace', 'inconnu') then
        v_pts := v_pts || jsonb_build_object('code', 'siret_' || (inv.siret_check_result ->> 'etat'),
          'libelle', 'annuaire : ' || coalesce(inv.siret_check_result ->> 'message', 'à vérifier')
            || coalesce(' (' || nullif(concat_ws(' ', inv.siret_check_result ->> 'adresse', inv.siret_check_result ->> 'code_postal',
                 inv.siret_check_result ->> 'ville'), '') || ')', ''),
          'ou', 'client', 'bloquant', false);
      elsif jsonb_array_length(coalesce(inv.siret_check_result -> 'ecarts', '[]'::jsonb)) > 0 then
        v_pts := v_pts || jsonb_build_object('code', 'siret_adresse',
          'libelle', 'adresse du client différente de l''annuaire : ' || concat_ws(' ', inv.siret_check_result ->> 'adresse',
            inv.siret_check_result ->> 'code_postal', inv.siret_check_result ->> 'ville'),
          'ou', 'client', 'bloquant', false);
      end if;
    elsif inv.siret_motif_at > now() - interval '24 hours' and length(btrim(coalesce(inv.siret_check_motif, ''))) >= 5 then
      v_pts := v_pts || jsonb_build_object('code', 'siret_motif',
        'libelle', 'annuaire non consulté, motif : ' || btrim(inv.siret_check_motif), 'ou', 'annuaire', 'bloquant', false);
    else
      v_pts := v_pts || jsonb_build_object('code', 'siret_controle',
        'libelle', 'vérification du SIRET du client dans l''annuaire (moins de 24 h)', 'ou', 'annuaire', 'bloquant', true);
    end if;
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
$function$;


-- public.generate_session_reference_v3()
CREATE OR REPLACE FUNCTION public.generate_session_reference_v3()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prefix text;
  v_course_code text;
  v_date_str text;
  v_counter integer;
begin
  select nullif(trim(doc_prefix), '') into v_prefix from organization_settings limit 1;
  v_prefix := upper(coalesce(v_prefix, 'SES'));

  select code into v_course_code from courses where id = new.course_id;
  if v_course_code is null or v_course_code = '' then
    v_course_code := 'FORM';
  end if;

  v_date_str := to_char(new.start_date, 'YYMMDD');

  select coalesce(max(cast(substring(reference from '-(\d{3})$') as integer)), 0) + 1
    into v_counter
  from sessions
  where reference like v_prefix || '-' || v_course_code || '-' || v_date_str || '-%';

  new.reference := v_prefix || '-' || v_course_code || '-' || v_date_str || '-' || lpad(v_counter::text, 3, '0');
  return new;
end;
$function$;


-- public.billing_next_number(text)
CREATE OR REPLACE FUNCTION public.billing_next_number(p_type text DEFAULT 'invoice'::text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;


drop trigger if exists companies_billing_settings on public.companies;
drop function if exists app.company_billing_settings();
do $$
declare t text;
begin
  foreach t in array array['invoices', 'quotes', 'sessions'] loop
    execute format('drop index if exists public.%I', t || '_societe_reference_uniq');
    if not exists (select 1 from pg_constraint where conname = t || '_reference_key') then
      execute format('alter table public.%I add constraint %I unique (reference)', t, t || '_reference_key');
    end if;
  end loop;
end
$$;
drop function if exists public.company_create(jsonb);
drop function if exists public.company_member_set(uuid, uuid, text, boolean, boolean);
drop function if exists public.company_identity();
drop function if exists public.company_module_set(uuid, text, boolean);
drop function if exists public.my_company_context();
drop function if exists app.identite_societe(uuid);
drop function if exists app.vue_groupe();
drop function if exists app.header_groupe();

delete from public.schema_migrations where version = '0277_societes_interface';

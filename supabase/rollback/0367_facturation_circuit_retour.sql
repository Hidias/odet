-- Retour arrière de 0367_facturation_circuit.sql : circuit débranché, app.billing_check remise dans sa version de 0365.
-- Les demandes de validation déjà déposées restent (table de C1b). Idempotent.

drop trigger if exists invoices_circuit_emis on public.invoices;
drop function if exists app.billing_circuit_emis();
drop function if exists public.billing_request_validation(uuid);

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
  v_ident text;
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
$$;

delete from public.schema_migrations where version = '0367_facturation_circuit';

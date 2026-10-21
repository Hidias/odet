-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (tva_0427) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0427_tva_zero_public.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

-- ===== supabase/migrations/0427_tva_zero_public.sql =====
-- 0427 : TVA à 0 % verrouillée pour un organisme assujetti, pénalités de retard d'un acheteur public (décisions de H,
-- 21/10, 23 h 08). Un organisme assujetti ne peut plus émettre de facture « TVA non applicable » ni de ligne au régime
-- normal à 0 % : seules l'exonération de la formation (attestation de la DREETS dans les réglages) et l'autoliquidation
-- (client professionnel avec son numéro de TVA) le permettent, contrôles déjà en place. Client public (fiche client
-- « public ») : mentions du code de la commande publique (taux de la BCE + 8 points, R2192-31 ; indemnité de 40 €,
-- D2192-35) au lieu de celles du code de commerce. Textes modifiables dans les réglages de facturation.
-- Migration additive (colonnes, fonction redéfinie). Idempotente. Retour arrière : supabase/rollback/0427_tva_zero_public_retour.sql

alter table public.billing_settings add column if not exists mention_penalites_public text not null
  default 'Intérêts moratoires en cas de retard de paiement : taux de la Banque centrale européenne majoré de 8 points (art. L2192-13 et R2192-31 du code de la commande publique).';
alter table public.billing_settings add column if not exists mention_indemnite_public text not null
  default 'Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 € (art. L2192-13 et D2192-35 du code de la commande publique).';

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
  o := app.identite_societe(inv.company_id);
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
  -- Organisme assujetti (0427) : pas de TVA à 0 % hors cas prévus (exonération de la formation, autoliquidation)
  if not v_franchise and not v_credit and (coalesce(inv.tva_applicable, true) is false or exists (select 1 from public.invoice_items
      where invoice_id = p_invoice and coalesce(vat_regime, 'normal') = 'normal' and coalesce(tva_rate, 0) = 0)) then
    v_pts := v_pts || jsonb_build_object('code', 'tva_zero', 'libelle', 'TVA à 0 % alors que l''organisme est assujetti (seules l''exonération de la formation et l''autoliquidation le permettent)', 'ou', 'facture', 'bloquant', true);
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
    -- Acheteur public (0427) : intérêts moratoires du code de la commande publique
    v_ment := v_ment || to_jsonb(case when v_public then s.mention_penalites_public else s.mention_penalites end);
    v_ment := v_ment || to_jsonb(case when v_public then s.mention_indemnite_public else s.mention_indemnite end);
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

insert into public.schema_migrations (version) values ('0427_tva_zero_public') on conflict (version) do nothing;

-- ===== supabase/rollback/0427_tva_zero_public_retour.sql =====
-- Retour arrière de 0427_tva_zero_public.sql : contrôle de facture d'avant 0427 (version en production), colonnes retirées. Idempotent.
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
  o := app.identite_societe(inv.company_id);
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

alter table public.billing_settings drop column if exists mention_penalites_public;
alter table public.billing_settings drop column if exists mention_indemnite_public;
delete from public.schema_migrations where version = '0427_tva_zero_public';

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE tva_0427 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

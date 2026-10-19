-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c4_0365) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0365_facturation_annuaire.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0365_facturation_annuaire_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0365_facturation_annuaire.sql =====
-- 0365_facturation_annuaire.sql : revérification du SIRET dans l'annuaire officiel avant émission (Facturation fiable).
--
-- Décision de H (17/10) : à l'émission d'une facture à un professionnel, le SIRET du client est revérifié dans
-- l'annuaire officiel (recherche-entreprises.api.gouv.fr, gratuit, sans clé). Établissement fermé, siège déplacé,
-- SIRET inconnu ou adresse différente = alerte avec l'adresse à jour proposée. Si l'annuaire ne répond pas, émission
-- permise avec un motif saisi (on garde les informations de la fiche client).
-- La base ne peut pas appeler l'annuaire : la route serveur /api/verifier-siret le fait et garde le résultat sur le
-- brouillon ; la base exige seulement un contrôle de moins de 24 h pour le SIRET actuel du client, ou un motif.
--   invoices : siret_checked_at, siret_check_result (résultat de l'annuaire), siret_check_motif, siret_motif_at ;
--   clients : siret_checked_at, siret_check_result (contrôle depuis la fiche client) ;
--   app.siret_controle_garde : ces colonnes ne s'écrivent pas depuis l'application (valeurs envoyées ignorées) ;
--     seulement par le serveur après lecture sous la session de l'appelant, ou par billing_siret_motif ;
--   billing_siret_motif(facture, motif) : motif saisi quand l'annuaire ne répond pas (brouillon seulement) ;
--   app.billing_check : point bloquant « vérification du SIRET » et alertes de l'annuaire (redéfinie, reste identique).
-- Aucune nouvelle table. Idempotente. Retour arrière : supabase/rollback/0365_facturation_annuaire_retour.sql

alter table public.invoices add column if not exists siret_checked_at timestamptz;
alter table public.invoices add column if not exists siret_check_result jsonb;
alter table public.invoices add column if not exists siret_check_motif text;
alter table public.invoices add column if not exists siret_motif_at timestamptz;
comment on column public.invoices.siret_check_result is 'Résultat de l''annuaire officiel pour le SIRET du client (état, adresse à jour, écarts), écrit par /api/verifier-siret';
comment on column public.invoices.siret_check_motif is 'Motif saisi pour émettre sans contrôle de l''annuaire (annuaire indisponible)';
alter table public.clients add column if not exists siret_checked_at timestamptz;
alter table public.clients add column if not exists siret_check_result jsonb;
comment on column public.clients.siret_check_result is 'Dernier contrôle du SIRET dans l''annuaire officiel, écrit par /api/verifier-siret';

create or replace function app.siret_controle_garde()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.siret_checked_at := null;
    new.siret_check_result := null;
    if tg_table_name = 'invoices' then
      new.siret_check_motif := null;
      new.siret_motif_at := null;
    end if;
    return new;
  end if;
  -- Mise à jour depuis l'application : le contrôle reste celui du serveur (valeurs envoyées ignorées, jamais d'erreur,
  -- pour qu'un écran qui renvoie toute la fiche ne soit pas bloqué).
  new.siret_checked_at := old.siret_checked_at;
  new.siret_check_result := old.siret_check_result;
  if tg_table_name = 'invoices' then
    new.siret_check_motif := old.siret_check_motif;
    new.siret_motif_at := old.siret_motif_at;
  end if;
  return new;
end
$$;

drop trigger if exists invoices_siret_garde on public.invoices;
create trigger invoices_siret_garde before insert or update on public.invoices
  for each row execute function app.siret_controle_garde();
drop trigger if exists clients_siret_garde on public.clients;
create trigger clients_siret_garde before insert or update on public.clients
  for each row execute function app.siret_controle_garde();

create or replace function public.billing_siret_motif(p_invoice uuid, p_motif text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
  v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
begin
  if not app.un_des_droits(array['facturation.factures.valider', 'facturation.avoirs.emettre']) then
    raise exception 'Accès refusé : émettre ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null then
    raise exception 'Document introuvable' using errcode = 'P0002';
  end if;
  if inv.issued_at is not null then
    raise exception 'Document déjà émis' using errcode = '22023';
  end if;
  if v_motif is not null and length(v_motif) < 5 then
    raise exception 'Motif trop court' using errcode = '22023';
  end if;
  update public.invoices set siret_check_motif = left(v_motif, 500), siret_motif_at = case when v_motif is null then null else now() end
  where id = inv.id;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'document', inv.id,
          'Émission sans contrôle de l''annuaire', jsonb_build_object('motif', left(v_motif, 500)));
  return true;
end
$$;

revoke all on function public.billing_siret_motif(uuid, text) from public, anon;
grant execute on function public.billing_siret_motif(uuid, text) to authenticated, service_role;

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

insert into public.schema_migrations (version) values ('0365_facturation_annuaire') on conflict (version) do nothing;

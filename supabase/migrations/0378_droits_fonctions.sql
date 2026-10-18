-- 0378_droits_fonctions.sql : fonctions, stockage et handicap passés aux droits (chantier 3, branche droits/fonctions).
--
-- Après C1b, les règles des tables demandent un droit (app.a_le_droit) ; restaient par rôle les fonctions
-- SECURITY DEFINER du chantier 2 (0085), les règles des fichiers (0086) et l'accès aux données de handicap (0081).
-- Ici, chacune demande le droit du catalogue qui correspond exactement à l'ancien groupe de rôles :
--   app.can_read_session     formation.suivi.voir, ou formation.sessions.voir_siennes pour ses sessions
--   app.can_edit_session     formation.suivi.gerer, ou formation.sessions.modifier_siennes pour ses sessions
--   app.can_see_disability   qualite.handicap.voir, ou référent handicap désigné (inchangé)
--   gardes des fonctions     droit équivalent (app.require_right) ; seule différence voulue : la déconnexion forcée
--                            demande parametres.utilisateurs.gerer (licence totale, comme 0379)
--   fichiers (Storage)       rôle d'avant ET un des droits du domaine : un droit retiré à une personne vaut aussi pour
--                            ses fichiers ; aucun profil de base ne perd d'accès
-- Le technicien (« lecture » coché) garde son blocage : ses profils n'ont aucun de ces droits.
-- Idempotente. Retour arrière : supabase/rollback/0378_droits_fonctions_retour.sql

-- Aides -------------------------------------------------------------------------------------------------------
create or replace function app.un_des_droits(p_codes text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.rights() && p_codes, false)
$$;

create or replace function app.require_right(p_code text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(app.a_le_droit(p_code), false) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
end
$$;

-- Remplace une garde exacte dans le corps d'une fonction (idempotent : rien si la nouvelle garde est déjà là)
create or replace function app.remplacer_garde(p_sig regprocedure, p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def text := pg_get_functiondef(p_sig);
begin
  if position(p_new in v_def) > 0 then
    return;
  end if;
  if position(p_old in v_def) = 0 then
    raise exception 'Garde attendue absente de %', p_sig;
  end if;
  execute replace(v_def, p_old, p_new);
end
$$;
revoke all on function app.remplacer_garde(regprocedure, text, text) from public, anon, authenticated;

revoke all on function app.un_des_droits(text[]), app.require_right(text) from public, anon;
grant execute on function app.un_des_droits(text[]), app.require_right(text) to authenticated, service_role;

-- Contrôles par session et handicap -------------------------------------------------------------------------
create or replace function app.can_read_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.a_le_droit('formation.suivi.voir')
    or (app.a_le_droit('formation.sessions.voir_siennes') and p_session_id in (select app.trainer_session_ids())),
  false)
$$;

create or replace function app.can_edit_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.a_le_droit('formation.suivi.gerer')
    or (app.a_le_droit('formation.sessions.modifier_siennes') and p_session_id in (select app.trainer_session_ids())),
  false)
$$;

create or replace function app.can_see_disability()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.a_le_droit('qualite.handicap.voir')
    or (app.role() is not null and exists (
          select 1 from public.quality_roles q
          where q.code = 'referent_handicap' and q.profile_id = (select auth.uid()))),
    false)
$$;

-- Gardes des fonctions SECURITY DEFINER (0085) ------------------------------------------------------------
do $$
begin
  perform app.remplacer_garde('public.export_trainee_data(uuid)'::regprocedure, 'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'']);', 'perform app.require_right(''formation.stagiaires.archives'');');
  perform app.remplacer_garde('public.purge_trainee(uuid, text)'::regprocedure, 'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'']);', 'perform app.require_right(''formation.stagiaires.archives'');');
  perform app.remplacer_garde('public.get_purge_stats()'::regprocedure, 'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'']);', 'perform app.require_right(''formation.stagiaires.archives'');');
  perform app.remplacer_garde('public.itv_generate_contract_visits(uuid, integer)'::regprocedure, 'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'']);', 'perform app.require_right(''interventions.visites.gerer'');');
  perform app.remplacer_garde('public.get_audit_logs(text, uuid, text, text, timestamptz, timestamptz, integer)'::regprocedure, 'perform app.require_roles(array[''superadmin'', ''admin'']);', 'perform app.require_right(''conformite.journal.voir'');');
  perform app.remplacer_garde('public.admin_logout_user(text)'::regprocedure, 'perform app.require_roles(array[''superadmin'', ''admin'']);', 'perform app.require_right(''parametres.utilisateurs.gerer'');');
  perform app.remplacer_garde('public.detect_client_links(uuid)'::regprocedure, 'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'', ''commercial'', ''comptable'', ''formateur'', ''lecture'']);', 'perform app.require_right(''clients.fiches.voir'');');
  perform app.remplacer_garde('public.client_contact_sync_primary(uuid)'::regprocedure, 'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'', ''commercial'']);', 'perform app.require_right(''clients.fiches.modifier'');');
end $$;

-- Fichiers (Storage) -------------------------------------------------------------------------------------
drop policy if exists odet_signatures_lire on storage.objects;
create policy odet_signatures_lire on storage.objects for select to authenticated
  using (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'lecture']) and (select app.un_des_droits(array['formation.suivi.voir', 'formation.sessions.voir_siennes', 'formation.sessions.voir'])));
drop policy if exists odet_documents_lire on storage.objects;
create policy odet_documents_lire on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture']) and (select app.un_des_droits(array['formation.documents.voir', 'facturation.factures.voir', 'commercial.devis.voir'])));
drop policy if exists odet_documents_creer on storage.objects;
create policy odet_documents_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']) and (select app.un_des_droits(array['formation.documents.modifier', 'facturation.factures.modifier', 'commercial.devis.modifier'])));
drop policy if exists odet_documents_modifier on storage.objects;
create policy odet_documents_modifier on storage.objects for update to authenticated
  using (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']) and (select app.un_des_droits(array['formation.documents.modifier', 'facturation.factures.modifier', 'commercial.devis.modifier'])))
  with check (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']) and (select app.un_des_droits(array['formation.documents.modifier', 'facturation.factures.modifier', 'commercial.devis.modifier'])));
drop policy if exists odet_documents_supprimer on storage.objects;
create policy odet_documents_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']) and (select app.un_des_droits(array['formation.documents.modifier', 'facturation.factures.modifier', 'commercial.devis.modifier'])));
drop policy if exists odet_bureau_lire on storage.objects;
create policy odet_bureau_lire on storage.objects for select to authenticated
  using (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture']) and (select app.un_des_droits(array['formation.sessions.voir', 'formation.sessions.voir_siennes', 'facturation.factures.voir'])));
drop policy if exists odet_bureau_creer on storage.objects;
create policy odet_bureau_creer on storage.objects for insert to authenticated
  with check (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']) and (select app.un_des_droits(array['formation.sessions.modifier', 'formation.sessions.modifier_siennes', 'formation.convocations.envoyer', 'facturation.factures.modifier', 'facturation.factures.envoyer'])));
drop policy if exists odet_bureau_modifier on storage.objects;
create policy odet_bureau_modifier on storage.objects for update to authenticated
  using (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']) and (select app.un_des_droits(array['formation.sessions.modifier', 'formation.sessions.modifier_siennes', 'formation.convocations.envoyer', 'facturation.factures.modifier', 'facturation.factures.envoyer'])))
  with check (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']) and (select app.un_des_droits(array['formation.sessions.modifier', 'formation.sessions.modifier_siennes', 'formation.convocations.envoyer', 'facturation.factures.modifier', 'facturation.factures.envoyer'])));
drop policy if exists odet_bureau_supprimer on storage.objects;
create policy odet_bureau_supprimer on storage.objects for delete to authenticated
  using (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']) and (select app.un_des_droits(array['formation.sessions.modifier', 'formation.sessions.modifier_siennes', 'formation.convocations.envoyer', 'facturation.factures.modifier', 'facturation.factures.envoyer'])));
drop policy if exists odet_mailing_lire on storage.objects;
create policy odet_mailing_lire on storage.objects for select to authenticated
  using (bucket_id = 'mailing-attachments' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']) and (select app.un_des_droits(array['communication.campagnes.gerer'])));
drop policy if exists odet_mailing_creer on storage.objects;
create policy odet_mailing_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'mailing-attachments' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']) and (select app.un_des_droits(array['communication.campagnes.gerer'])));
drop policy if exists odet_mailing_supprimer on storage.objects;
create policy odet_mailing_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'mailing-attachments' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']) and (select app.un_des_droits(array['communication.campagnes.gerer'])));
drop policy if exists odet_finance_lire on storage.objects;
create policy odet_finance_lire on storage.objects for select to authenticated
  using (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']) and (select app.un_des_droits(array['finance.budget.gerer', 'facturation.export.comptable'])));
drop policy if exists odet_finance_creer on storage.objects;
create policy odet_finance_creer on storage.objects for insert to authenticated
  with check (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']) and (select app.un_des_droits(array['finance.budget.gerer'])));
drop policy if exists odet_finance_modifier on storage.objects;
create policy odet_finance_modifier on storage.objects for update to authenticated
  using (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']) and (select app.un_des_droits(array['finance.budget.gerer'])))
  with check (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']) and (select app.un_des_droits(array['finance.budget.gerer'])));
drop policy if exists odet_finance_supprimer on storage.objects;
create policy odet_finance_supprimer on storage.objects for delete to authenticated
  using (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']) and (select app.un_des_droits(array['finance.budget.gerer'])));
drop policy if exists odet_supports_creer on storage.objects;
create policy odet_supports_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']) and (select app.un_des_droits(array['formation.catalogue.gerer'])));
drop policy if exists odet_supports_modifier on storage.objects;
create policy odet_supports_modifier on storage.objects for update to authenticated
  using (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']) and (select app.un_des_droits(array['formation.catalogue.gerer'])))
  with check (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']) and (select app.un_des_droits(array['formation.catalogue.gerer'])));
drop policy if exists odet_supports_supprimer on storage.objects;
create policy odet_supports_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']) and (select app.un_des_droits(array['formation.catalogue.gerer'])));
drop policy if exists odet_media_creer on storage.objects;
create policy odet_media_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']) and (select app.un_des_droits(array['communication.reseaux.gerer', 'parametres.organisme.modifier'])));
drop policy if exists odet_media_modifier on storage.objects;
create policy odet_media_modifier on storage.objects for update to authenticated
  using (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']) and (select app.un_des_droits(array['communication.reseaux.gerer', 'parametres.organisme.modifier'])))
  with check (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']) and (select app.un_des_droits(array['communication.reseaux.gerer', 'parametres.organisme.modifier'])));
drop policy if exists odet_media_supprimer on storage.objects;
create policy odet_media_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']) and (select app.un_des_droits(array['communication.reseaux.gerer', 'parametres.organisme.modifier'])));
drop policy if exists odet_signatures_creer on storage.objects;
create policy odet_signatures_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']) and (select app.un_des_droits(array['formation.formateurs.gerer', 'formation.formateurs.modifier_sa_fiche'])));
drop policy if exists odet_signatures_modifier on storage.objects;
create policy odet_signatures_modifier on storage.objects for update to authenticated
  using (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']) and (select app.un_des_droits(array['formation.formateurs.gerer', 'formation.formateurs.modifier_sa_fiche'])))
  with check (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']) and (select app.un_des_droits(array['formation.formateurs.gerer', 'formation.formateurs.modifier_sa_fiche'])));
drop policy if exists odet_signatures_supprimer on storage.objects;
create policy odet_signatures_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']) and (select app.un_des_droits(array['formation.formateurs.gerer', 'formation.formateurs.modifier_sa_fiche'])));

insert into public.schema_migrations (version) values ('0378_droits_fonctions') on conflict (version) do nothing;

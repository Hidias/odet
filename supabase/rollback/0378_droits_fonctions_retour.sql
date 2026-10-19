-- Retour arrière de 0378_droits_fonctions.sql : fonctions, stockage et handicap reviennent aux contrôles par rôle
-- du chantier 2 (textes identiques à 0081, 0085 et 0086). Idempotent.

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

do $$
begin
  perform app.remplacer_garde('public.export_trainee_data(uuid)'::regprocedure, 'perform app.require_right(''formation.stagiaires.archives'');', 'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'']);');
  perform app.remplacer_garde('public.purge_trainee(uuid, text)'::regprocedure, 'perform app.require_right(''formation.stagiaires.archives'');', 'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'']);');
  perform app.remplacer_garde('public.get_purge_stats()'::regprocedure, 'perform app.require_right(''formation.stagiaires.archives'');', 'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'']);');
  perform app.remplacer_garde('public.itv_generate_contract_visits(uuid, integer)'::regprocedure, 'perform app.require_right(''interventions.visites.gerer'');', 'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'']);');
  perform app.remplacer_garde('public.get_audit_logs(text, uuid, text, text, timestamptz, timestamptz, integer)'::regprocedure, 'perform app.require_right(''conformite.journal.voir'');', 'perform app.require_roles(array[''superadmin'', ''admin'']);');
  perform app.remplacer_garde('public.admin_logout_user(text)'::regprocedure, 'perform app.require_right(''parametres.utilisateurs.gerer'');', 'perform app.require_roles(array[''superadmin'', ''admin'']);');
  perform app.remplacer_garde('public.detect_client_links(uuid)'::regprocedure, 'perform app.require_right(''clients.fiches.voir'');', 'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'', ''commercial'', ''comptable'', ''formateur'', ''lecture'']);');
  perform app.remplacer_garde('public.client_contact_sync_primary(uuid)'::regprocedure, 'perform app.require_right(''clients.fiches.modifier'');', 'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'', ''commercial'']);');
end $$;

create or replace function app.can_read_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.role() = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial', 'lecture'])
    or (app.role() = 'formateur' and p_session_id in (select app.trainer_session_ids())),
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
    app.role() = any (array['superadmin', 'admin', 'direction', 'gestionnaire'])
    or (app.role() = 'formateur' and p_session_id in (select app.trainer_session_ids())),
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
    app.role() = any (array['superadmin', 'admin', 'direction'])
    or (app.role() is not null and exists (
          select 1 from public.quality_roles q
          where q.code = 'referent_handicap' and q.profile_id = (select auth.uid()))),
    false)
$$;

drop policy if exists odet_signatures_lire on storage.objects;
create policy odet_signatures_lire on storage.objects for select to authenticated
  using (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'lecture']));
drop policy if exists odet_documents_lire on storage.objects;
create policy odet_documents_lire on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture']));
drop policy if exists odet_documents_creer on storage.objects;
create policy odet_documents_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));
drop policy if exists odet_documents_modifier on storage.objects;
create policy odet_documents_modifier on storage.objects for update to authenticated
  using (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']))
  with check (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));
drop policy if exists odet_documents_supprimer on storage.objects;
create policy odet_documents_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));
drop policy if exists odet_bureau_lire on storage.objects;
create policy odet_bureau_lire on storage.objects for select to authenticated
  using (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture']));
drop policy if exists odet_bureau_creer on storage.objects;
create policy odet_bureau_creer on storage.objects for insert to authenticated
  with check (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));
drop policy if exists odet_bureau_modifier on storage.objects;
create policy odet_bureau_modifier on storage.objects for update to authenticated
  using (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']))
  with check (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));
drop policy if exists odet_bureau_supprimer on storage.objects;
create policy odet_bureau_supprimer on storage.objects for delete to authenticated
  using (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));
drop policy if exists odet_mailing_lire on storage.objects;
create policy odet_mailing_lire on storage.objects for select to authenticated
  using (bucket_id = 'mailing-attachments' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));
drop policy if exists odet_mailing_creer on storage.objects;
create policy odet_mailing_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'mailing-attachments' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));
drop policy if exists odet_mailing_supprimer on storage.objects;
create policy odet_mailing_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'mailing-attachments' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));
drop policy if exists odet_finance_lire on storage.objects;
create policy odet_finance_lire on storage.objects for select to authenticated
  using (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']));
drop policy if exists odet_finance_creer on storage.objects;
create policy odet_finance_creer on storage.objects for insert to authenticated
  with check (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']));
drop policy if exists odet_finance_modifier on storage.objects;
create policy odet_finance_modifier on storage.objects for update to authenticated
  using (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']))
  with check (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']));
drop policy if exists odet_finance_supprimer on storage.objects;
create policy odet_finance_supprimer on storage.objects for delete to authenticated
  using (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']));
drop policy if exists odet_supports_creer on storage.objects;
create policy odet_supports_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']));
drop policy if exists odet_supports_modifier on storage.objects;
create policy odet_supports_modifier on storage.objects for update to authenticated
  using (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']))
  with check (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']));
drop policy if exists odet_supports_supprimer on storage.objects;
create policy odet_supports_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']));
drop policy if exists odet_media_creer on storage.objects;
create policy odet_media_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));
drop policy if exists odet_media_modifier on storage.objects;
create policy odet_media_modifier on storage.objects for update to authenticated
  using (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']))
  with check (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));
drop policy if exists odet_media_supprimer on storage.objects;
create policy odet_media_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));
drop policy if exists odet_signatures_creer on storage.objects;
create policy odet_signatures_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']));
drop policy if exists odet_signatures_modifier on storage.objects;
create policy odet_signatures_modifier on storage.objects for update to authenticated
  using (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']))
  with check (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']));
drop policy if exists odet_signatures_supprimer on storage.objects;
create policy odet_signatures_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']));

drop function if exists app.remplacer_garde(regprocedure, text, text);
drop function if exists app.require_right(text);
drop function if exists app.un_des_droits(text[]);

delete from public.schema_migrations where version = '0378_droits_fonctions';

-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c3_0378) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0378_droits_fonctions.sql, retour arrière,
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

-- ===== supabase/migrations/0378_droits_fonctions.sql =====
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

-- ===== supabase/rollback/0378_droits_fonctions_retour.sql =====
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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE c3_0378 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

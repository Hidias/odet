-- 0086_securite_stockage.sql : fichiers (Storage) par rôle (chantier 2, Q4).
-- Avant : le bucket documents acceptait lecture, envoi, remplacement et suppression par tout visiteur
-- non connecté ; les autres buckets étaient ouverts à tout compte connecté (technicien compris).
-- Après :
--   * plus aucune écriture, suppression ni liste de fichiers par un visiteur non connecté ;
--   * chaque bucket a une règle par action selon la matrice du chantier 2 ;
--   * documents RESTE en lecture par lien public pour l'instant : 33 endroits du code (programmes,
--     cartes FORPREV, courriers, scans d'analyse du besoin, pièces jointes des emails) stockent et
--     relisent le lien public. Le passer en privé demande de servir ces fichiers par liens signés
--     partout (travail séparé, voir le compte rendu du chantier 2). Les chemins ne sont pas
--     listables par un visiteur ;
--   * course-documents et media restent lisibles par lien public (supports de formation du portail, logo) ;
--   * trainer-signatures devient privé (ajout du chantier F, 17/10) : signatures manuscrites lues par
--     liens signés de courte durée (src/core/storageUtils.js, readableUrl) par le personnel, et par
--     api/portail-signature.js pour l'espace entreprise ; les adresses déjà enregistrées restent valables
--     (elles servent à retrouver le chemin du fichier) ;
--   * les règles des buckets certification et interventions (0030, 0050) ne changent pas.
-- Migration idempotente. Retour arrière : supabase/rollback/0080-0087_securite_retour.sql (les huit migrations ensemble)

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname not like 'certification\_%' and policyname not like 'interventions\_%'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- Lecture publique conservée : supports de formation, médias
create policy odet_public_lire on storage.objects for select to anon, authenticated
  using (bucket_id in ('course-documents', 'media'));

-- Signatures des formateurs : bucket privé, lecture par le personnel (liens signés)
update storage.buckets set public = false where id = 'trainer-signatures';
create policy odet_signatures_lire on storage.objects for select to authenticated
  using (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'lecture']));

-- documents : personnel de bureau (la lecture par lien public reste possible, voir en tête)
create policy odet_documents_lire on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture']));
create policy odet_documents_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));
create policy odet_documents_modifier on storage.objects for update to authenticated
  using (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']))
  with check (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));
create policy odet_documents_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));

-- Emails de session, pièces jointes, conventions signées : personnel de bureau
create policy odet_bureau_lire on storage.objects for select to authenticated
  using (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture']));
create policy odet_bureau_creer on storage.objects for insert to authenticated
  with check (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));
create policy odet_bureau_modifier on storage.objects for update to authenticated
  using (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']))
  with check (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));
create policy odet_bureau_supprimer on storage.objects for delete to authenticated
  using (bucket_id in ('session-email-docs', 'email-attachments', 'signed-conventions')
         and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable']));

-- Campagnes email
create policy odet_mailing_lire on storage.objects for select to authenticated
  using (bucket_id = 'mailing-attachments' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));
create policy odet_mailing_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'mailing-attachments' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));
create policy odet_mailing_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'mailing-attachments' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));

-- Budget et relevés bancaires
create policy odet_finance_lire on storage.objects for select to authenticated
  using (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']));
create policy odet_finance_creer on storage.objects for insert to authenticated
  with check (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']));
create policy odet_finance_modifier on storage.objects for update to authenticated
  using (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']))
  with check (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']));
create policy odet_finance_supprimer on storage.objects for delete to authenticated
  using (bucket_id in ('bank-statements', 'budget-receipts') and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'comptable']));

-- Supports de formation : gestion
create policy odet_supports_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']));
create policy odet_supports_modifier on storage.objects for update to authenticated
  using (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']))
  with check (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']));
create policy odet_supports_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'course-documents' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire']));

-- Médias (logo, réseaux sociaux) : administrateurs et personnel commercial
create policy odet_media_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));
create policy odet_media_modifier on storage.objects for update to authenticated
  using (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']))
  with check (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));
create policy odet_media_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']));

-- Signatures des formateurs
create policy odet_signatures_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']));
create policy odet_signatures_modifier on storage.objects for update to authenticated
  using (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']))
  with check (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']));
create policy odet_signatures_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'trainer-signatures' and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur']));

insert into public.schema_migrations (version) values ('0086_securite_stockage') on conflict (version) do nothing;

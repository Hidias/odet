-- 0303_rh_fichiers_suppression.sql : chantier 12, module RH, suppression des fichiers du bucket « rh » (constat du
-- 19/10 en recette : un document supprimé laissait son fichier dans le bucket).
--
-- Le service de stockage lit le fichier avant de l'effacer. La lecture n'était permise que si la ligne du document
-- existait encore : une fois la ligne supprimée, l'effacement du fichier échouait sans bruit. De même, le fichier
-- d'un dépôt refusé par la base ne pouvait pas être retiré.
-- Désormais :
--   - l'écran efface le fichier AVANT la ligne du document (rhDocuments.js) ;
--   - la personne qui a déposé un fichier peut le lire (owner_id), ce qui permet de retirer un dépôt refusé ;
--   - l'effacement reste réservé à qui tient les dossiers (règle rh_supprimer de 0301, inchangée).
-- Migration additive (règle remplacée). Idempotente. Retour arrière : supabase/rollback/0303_rh_fichiers_suppression_retour.sql

drop policy if exists rh_lire on storage.objects;
create policy rh_lire on storage.objects for select to authenticated
  using (bucket_id = 'rh' and (
    exists (select 1 from public.hr_documents d where d.file_path = objects.name)
    or owner_id = (select auth.uid())::text));

insert into public.schema_migrations (version) values ('0303_rh_fichiers_suppression') on conflict (version) do nothing;

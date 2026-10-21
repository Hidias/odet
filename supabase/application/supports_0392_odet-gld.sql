-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (supports_0392) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0392_supports_prives.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0392_supports_prives_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0392_supports_prives.sql =====
-- 0392 : supports et livrets de formation privés (bucket « course-documents »), suite de 0389.
-- Avant : lisibles par n'importe qui ayant l'adresse (règle odet_public_lire, anon compris).
-- Après : lecture par l'équipe connectée qui voit le catalogue ou les documents de formation ; le portail stagiaire obtient un lien signé de 5 minutes par
-- /api/portail-document, qui vérifie le jeton de la session et que le livret est activé pour elle.
-- Les images publiques (bucket « media » : logo, publications) restent publiques. Idempotent.

update storage.buckets set public = false where id = 'course-documents';

drop policy if exists odet_public_lire on storage.objects;
create policy odet_public_lire on storage.objects for select to anon, authenticated
  using (bucket_id = 'media');

drop policy if exists odet_supports_lire on storage.objects;
create policy odet_supports_lire on storage.objects for select to authenticated
  using (bucket_id = 'course-documents'
    and (select app.role()) = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture'])
    and (select app.un_des_droits(array['formation.catalogue.voir', 'formation.documents.voir'])));

insert into public.schema_migrations (version) values ('0392_supports_prives') on conflict (version) do nothing;

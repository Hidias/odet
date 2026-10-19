-- 0389_documents_prives.sql : stockage « documents » privé (audit de pilotage du 19/10, sécurité).
--
--   Le bucket « documents » (documents de session, scans, cartes SST, attestations envoyées aux stagiaires, programmes
--   déposés, courriers) était public : quiconque avait l'adresse d'un fichier pouvait le lire sans connexion. Il devient
--   privé : l'outil ouvre chaque fichier par un lien signé de courte durée (core/storageUtils.js, readableUrl et
--   ouvrirFichier), les emails le joignent par la clé serveur. Les règles de lecture restent celles du personnel ; les
--   programmes déposés (dossier « programmes/ ») sont aussi lisibles des comptes externes connectés (espace entreprise,
--   formateur externe, stagiaire), qui les voient dans leur espace. Les autres buckets publics (images des publications
--   et de l'identité, supports de cours) ne changent pas.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0389_documents_prives_retour.sql

update storage.buckets set public = false where id = 'documents';

drop policy if exists odet_documents_programmes_lire on storage.objects;
create policy odet_documents_programmes_lire on storage.objects for select to authenticated
  using (bucket_id = 'documents' and name like 'programmes/%');

insert into public.schema_migrations (version) values ('0389_documents_prives') on conflict (version) do nothing;

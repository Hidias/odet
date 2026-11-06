-- Retour arrière de 0496 : fonctions de lecture, déclencheur et colonne du signataire prévu retirés. Seule la copie
-- figée du signataire est perdue (elle reste imprimée dans le PDF publié) ; l'écran retombe sur un nom vide, comme avant.

drop function if exists public.ent_signataire_prevu(uuid);
drop function if exists public.client_portal_signataire_prevu(text, text, uuid);
drop function if exists app.signataire_prevu(uuid, uuid);
drop trigger if exists client_shared_documents_signataire_prevu on public.client_shared_documents;
drop function if exists app.document_signataire_prevu();
drop function if exists app.signataire_du_groupe(uuid);
alter table public.client_shared_documents drop column if exists signataire_prevu;

delete from public.schema_migrations where version = '0496_signataire_prevu';

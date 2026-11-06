-- Retour arrière de 0496 : les trois fonctions de lecture du signataire prévu sont retirées (aucune donnée touchée ;
-- l'écran retombe sur un nom vide, comme avant).

drop function if exists public.ent_signataire_prevu(uuid);
drop function if exists public.client_portal_signataire_prevu(text, text, uuid);
drop function if exists app.signataire_prevu(uuid, uuid);

delete from public.schema_migrations where version = '0496_signataire_prevu';

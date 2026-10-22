-- 0438 : correctif de 0435 (22/10, 12 h 29 : « permission denied for function devis_signe » à l'enregistrement d'un
-- devis). Les déclencheurs qui figent un devis signé appellent app.devis_signe, réservée au serveur : ils s'exécutent
-- désormais avec les droits de leur propriétaire, comme devis_version_remplace. Appliqué en production le 22/10.
-- Idempotente. Retour arrière : supabase/rollback/0438_devis_signe_droits_retour.sql
alter function app.devis_signe_fige() security definer;
alter function app.lignes_devis_signe_figees() security definer;

insert into public.schema_migrations (version) values ('0438_devis_signe_droits') on conflict (version) do nothing;

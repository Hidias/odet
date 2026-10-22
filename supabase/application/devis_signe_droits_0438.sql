-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (devis_signe_droits_0438) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0438_devis_signe_droits.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0438_devis_signe_droits_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0438_devis_signe_droits.sql =====
-- 0438 : correctif de 0435 (22/10, 12 h 29 : « permission denied for function devis_signe » à l'enregistrement d'un
-- devis). Les déclencheurs qui figent un devis signé appellent app.devis_signe, réservée au serveur : ils s'exécutent
-- désormais avec les droits de leur propriétaire, comme devis_version_remplace. Appliqué en production le 22/10.
-- Idempotente. Retour arrière : supabase/rollback/0438_devis_signe_droits_retour.sql
alter function app.devis_signe_fige() security definer;
alter function app.lignes_devis_signe_figees() security definer;

insert into public.schema_migrations (version) values ('0438_devis_signe_droits') on conflict (version) do nothing;

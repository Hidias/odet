-- 0489 : retrait de public.detect_completude_blockers (décision de H, 05/11).
-- Fonction reprise de Campus, appelée par aucune tâche, aucun écran ni aucune fonction en production (vérifié le 05/11) ;
-- exécutable par tout compte connecté, elle parcourait les stagiaires, sessions et réclamations de toutes les sociétés,
-- écrivait des alertes sans société et effaçait des notifications. La page Complétude calcule ses points à l'écran ;
-- l'échantillon de « Préparer l'audit » lit désormais l'état de la convention (etatConvention.js) au lieu de la table
-- completude_alerts, restée vide. Les tables completude_alerts et completude_tracking sont laissées en place (vides).
-- Aucune donnée supprimée. Idempotente. Retour arrière : supabase/rollback/0489_completude_retrait_retour.sql

drop function if exists public.detect_completude_blockers();

insert into public.schema_migrations (version) values ('0489_completude_retrait') on conflict (version) do nothing;

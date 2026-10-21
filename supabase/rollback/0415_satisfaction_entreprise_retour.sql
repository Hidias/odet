-- Retour arrière de 0415_satisfaction_entreprise.sql. Les avis des entreprises sont effacés ; les notifications déjà
-- créées restent. Idempotent.

drop function if exists public.ent_satisfactions();
drop function if exists public.ent_satisfaction(uuid, jsonb);
drop table if exists public.client_satisfactions;

delete from public.schema_migrations where version = '0415_satisfaction_entreprise';

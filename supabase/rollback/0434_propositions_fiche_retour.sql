-- Retour arrière de 0434_propositions_fiche.sql : colonnes retirées (propositions perdues). Idempotent.
alter table public.courses drop column if exists propositions;
alter table public.training_themes drop column if exists modele_fiche;
delete from public.schema_migrations where version = '0434_propositions_fiche';

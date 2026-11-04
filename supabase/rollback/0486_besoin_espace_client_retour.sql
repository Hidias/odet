-- Retour arrière de 0486 : fonctions de l'espace entreprise, garde de validation, colonnes ajoutées.
-- Les colonnes retirées emportent les réponses envoyées par les entreprises et les validations de l'organisme.
drop function if exists public.ent_besoin_enregistrer(uuid, jsonb);
drop function if exists public.ent_besoins();
drop function if exists app.besoin_texte(jsonb, text, integer);
drop trigger if exists besoin_validation on public.session_needs_analysis;
drop function if exists app.besoin_validation();
alter table public.session_needs_analysis
  drop column if exists client_submitted_at,
  drop column if exists client_submitted_by,
  drop column if exists psh_adaptation,
  drop column if exists psh_contact,
  drop column if exists org_conclusion,
  drop column if exists org_validated_at,
  drop column if exists org_validated_by;
delete from public.schema_migrations where version = '0486_besoin_espace_client';

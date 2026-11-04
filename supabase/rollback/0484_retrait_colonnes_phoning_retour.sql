-- Retour arrière de 0484 : colonnes du briefing phoning recréées, vides, avec leurs valeurs par défaut d'origine
-- (0001_base_schema.sql). Rien n'avait été effacé : 0484 refuse de s'appliquer si un briefing existe.

alter table public.mailing_campaigns
  add column if not exists phoning_message text,
  add column if not exists phoning_notes jsonb default '[]'::jsonb,
  add column if not exists phoning_active boolean default false,
  add column if not exists phoning_active_until timestamp with time zone;

delete from public.schema_migrations where version = '0484_retrait_colonnes_phoning';

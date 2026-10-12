-- 0023_activite_caces.sql : l'organisme délivre-t-il des CACES ? (Paramètres > Identité).
-- Désactivé par défaut : l'Aide à la rédaction parle alors de « formation à la conduite en vue de
-- l'autorisation de conduite » et jamais de « CACES ».
alter table public.organization_settings
  add column if not exists caces_activity boolean not null default false;

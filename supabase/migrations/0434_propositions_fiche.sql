-- 0434 : fiche formation complète pour la convention et la déclaration d'activité (décision de H, 22/10, 0 h 40).
--  - courses.propositions : textes proposés pour les champs vides de la fiche (moyens pédagogiques et techniques,
--    à prévoir par le stagiaire, modalités d'évaluation…), à accepter ou modifier dans la fiche ; jamais appliqués seuls.
--  - training_themes.modele_fiche : textes types par thème, proposés pour toute nouvelle formation du thème.
-- Les textes eux-mêmes sont des données de chaque société (marque blanche) : aucun dans ce fichier.
-- Migration additive (colonnes). Idempotente. Retour arrière : supabase/rollback/0434_propositions_fiche_retour.sql
alter table public.courses add column if not exists propositions jsonb;
alter table public.training_themes add column if not exists modele_fiche jsonb;
comment on column public.courses.propositions is 'Textes proposés pour les champs vides de la fiche, à valider (0434)';
comment on column public.training_themes.modele_fiche is 'Textes types du thème proposés pour une nouvelle formation (0434)';
insert into public.schema_migrations (version) values ('0434_propositions_fiche') on conflict (version) do nothing;

-- Retour arrière de 0377_droits_ecrans.sql : retire les fonctions des écrans de droits.
-- Les profils déjà personnalisés par une société restent (ce sont des lignes de permission_profiles, gérables
-- aussi sans ces fonctions). Idempotent.

drop function if exists public.member_rights_preview(uuid);
drop function if exists public.permission_profile_customize(text);
drop function if exists public.permission_profile_reset(text);
drop function if exists public.external_accountant_quotes_visible();

delete from public.schema_migrations where version = '0377_droits_ecrans';

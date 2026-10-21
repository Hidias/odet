-- Retour arrière de 0417_emargement_sans_reseau.sql. Les signatures déjà reçues restent ; seule l'heure de réception
-- des envois différés est effacée. Idempotent.

drop function if exists public.portal_sign_halfday_differe(text, uuid, text, text, timestamptz);
alter table public.attendance_halfdays drop column if exists signed_afternoon_received_at;
alter table public.attendance_halfdays drop column if exists signed_morning_received_at;

delete from public.schema_migrations where version = '0417_emargement_sans_reseau';

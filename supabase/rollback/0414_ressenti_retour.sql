-- Retour arrière de 0414_ressenti.sql. Les ressentis sont effacés ; les notifications déjà créées restent. Idempotent.

drop function if exists public.portal_ressenti(text, uuid, text, int, text);
drop function if exists app.ressenti_notification(uuid, date, boolean);
drop table if exists public.session_ressentis;

delete from public.schema_migrations where version = '0414_ressenti';

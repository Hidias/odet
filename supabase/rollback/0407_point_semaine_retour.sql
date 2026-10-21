-- Retour arrière de 0407_point_semaine.sql. Les actions, points et bilans saisis sont effacés. Idempotent.

drop function if exists public.point_semaine_generer(date);
drop function if exists public.point_semaine_preparer(date, text);
drop function if exists app.point_preparer(uuid, date, text, uuid);
drop function if exists app.point_lignes(uuid, date, text);
drop function if exists app.nom_profil(uuid);
drop function if exists app.euros(numeric);
drop table if exists public.weekly_brief_recipients;
drop table if exists public.weekly_briefs;
drop table if exists public.team_actions;
drop function if exists app.weekly_briefs_maj();
drop function if exists app.team_actions_maj();

delete from public.schema_migrations where version = '0407_point_semaine';

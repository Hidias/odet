-- Retour arrière de 0053_nom_affiche_calcule.sql. Idempotent. Les noms affichés recalculés restent (valeurs justes).

drop trigger if exists profiles_nom_affiche on public.profiles;
drop function if exists app.profiles_nom_affiche();
drop function if exists app.nom_affiche(text, text);

delete from public.schema_migrations where version = '0053_nom_affiche_calcule';

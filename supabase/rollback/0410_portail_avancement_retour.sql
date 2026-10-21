-- Retour arrière de 0410_portail_avancement.sql. Les notifications déjà créées restent. Idempotent.

drop trigger if exists portail_avancement_test on public.session_trainees;
drop trigger if exists portail_avancement_fiche on public.trainee_info_sheets;
drop function if exists app.portail_avancement_test();
drop function if exists app.portail_avancement_fiche();
drop function if exists app.portail_avancement(uuid);

delete from public.schema_migrations where version = '0410_portail_avancement';

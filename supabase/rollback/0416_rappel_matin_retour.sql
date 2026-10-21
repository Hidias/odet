-- Retour arrière de 0416_rappel_matin.sql. Les notifications déjà créées restent. Idempotent.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'odet_rappel_matin';
  end if;
end $$;
drop function if exists app.rappel_matin(boolean);

delete from public.schema_migrations where version = '0416_rappel_matin';

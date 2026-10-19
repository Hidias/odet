-- Retour arrière de 0382_taches_et_envois.sql : retire le journal des tâches et les interrupteurs d'envoi. Idempotent.

drop function if exists public.envoi_auto_reprendre(uuid, text);
drop function if exists public.envoi_auto_suspendre(uuid, text, text, text);
drop function if exists public.envoi_auto_regler(uuid, text, boolean);
drop function if exists app.envoi_auto_autorise(uuid, text);
drop function if exists app.envoi_auto_types();
drop table if exists public.auto_send_switch_log;
drop table if exists public.auto_send_switches;
drop view if exists public.v_job_last_runs;
drop table if exists public.job_runs;

delete from public.schema_migrations where version = '0382_taches_et_envois';

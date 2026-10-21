-- Retour arrière de 0422_creneaux_recurrents.sql. Les créneaux sont effacés ; les sessions déjà créées restent, sans
-- lien au créneau. La réserve de maintien posée par défaut est retirée (seulement si elle n'a pas été modifiée).
-- Idempotent.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'odet_recurrences';
  end if;
end $$;

update public.organization_settings
   set mention_maintien = null
 where mention_maintien = 'Les sessions inter-entreprises sont maintenues sous réserve d''un nombre minimum d''inscrits et de la disponibilité du formateur. En cas de report ou d''annulation, l''inscrit est prévenu au plus tard 10 jours avant le début, sans aucun frais, et les dates suivantes lui sont proposées.';

drop trigger if exists sessions_recurrence_supprimee on public.sessions;
drop function if exists public.recurrence_generer(uuid);
drop function if exists app.recurrences_etendre();
drop function if exists app.recurrence_creer_sessions(uuid);
drop function if exists app.recurrence_ferie(uuid, date);
drop function if exists app.recurrence_dates(uuid, date, date);
drop function if exists app.recurrence_session_supprimee();
drop index if exists public.sessions_recurrence_date_uniq;
alter table public.sessions drop column if exists recurrence_date;
alter table public.sessions drop column if exists recurrence_id;
drop table if exists public.session_recurrences;
drop function if exists app.session_recurrences_maj();

delete from public.schema_migrations where version = '0422_creneaux_recurrents';

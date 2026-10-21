-- Retour arrière de 0411_alertes_telephone.sql. Les appareils et les clés sont effacés ; la colonne pushed_at retirée.
-- Idempotent.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'odet_push_tick';
  end if;
end $$;
drop function if exists public.push_tick();
drop function if exists public.push_a_envoyer();
alter table public.notifications drop column if exists pushed_at;
drop table if exists public.push_subscriptions;
drop function if exists app.push_subscriptions_maj();
drop function if exists public.push_cle_publique();
drop table if exists public.push_keys;

delete from public.schema_migrations where version = '0411_alertes_telephone';

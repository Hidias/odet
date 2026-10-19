-- Retour arrière de 0262_bandeau_nouveautes.sql : retire le bandeau, les nouveautés et leurs modules. Idempotent.
-- Refusé si des entrées « Quoi de neuf » ont été publiées (contenu écrit par l'éditeur, à exporter d'abord) ou si
-- 0263 est encore en place (lien des retours vers les nouveautés).

do $$
begin
  if to_regclass('public.platform_notices') is not null then
    if exists (select 1 from public.platform_notices where kind = 'nouveaute' and status = 'publie') then
      raise exception 'Retour arrière refusé : des nouveautés ont été publiées (les exporter, puis les archiver ou les supprimer)';
    end if;
    if exists (select 1 from pg_constraint where conname = 'user_feedback_notice_fk') then
      raise exception 'Retour arrière refusé : retirer d''abord 0263 (supabase/rollback/0263_retours_suivi_retour.sql)';
    end if;
  end if;
end $$;

drop function if exists public.notice_from_pull_request(int, text, text, text);
drop function if exists public.notices_mark_seen();
drop function if exists public.notices_state();
drop table if exists public.platform_notices;
drop function if exists app.platform_notices_maj();
alter table public.profiles drop column if exists notices_seen_at;
delete from public.company_modules where key in ('nouveautes', 'retours');
delete from public.org_modules where key in ('nouveautes', 'retours');

delete from public.schema_migrations where version = '0262_bandeau_nouveautes';

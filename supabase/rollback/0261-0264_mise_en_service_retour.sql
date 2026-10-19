-- Retour arrière du lot a_0261-0264 (mise en service) : 0264, 0263, 0262 puis 0261, dans cet ordre. Idempotent.
-- Chaque partie est aussi disponible seule : supabase/rollback/026x_*_retour.sql

-- ═══ 0264_demo_lignes_reelles ═══
-- Retour arrière de 0264_demo_lignes_reelles.sql : retire la lecture des lignes réelles rattachées au fictif.
-- Idempotent ; aucune donnée concernée.

drop function if exists public.demo_real_links();

delete from public.schema_migrations where version = '0264_demo_lignes_reelles';

-- ═══ 0263_retours_suivi ═══
-- Retour arrière de 0263_retours_suivi.sql : retire le suivi des retours (colonnes, bucket, droit). Idempotent.
-- Refusé si des retours portent déjà un type, une capture, une réponse ou un statut nouveau (vu, en cours) :
-- ce sont des données saisies par les utilisateurs, jamais effacées par un retour arrière.

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_feedback'
             and column_name = 'kind') then
    if exists (select 1 from public.user_feedback
               where kind is not null or severity is not null or screenshot_path is not null or response is not null
                  or notice_id is not null or status in ('vu', 'en_cours')) then
      raise exception 'Retour arrière refusé : des retours utilisent déjà le suivi (type, capture, réponse ou statut)';
    end if;
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'retours') then
    raise exception 'Retour arrière refusé : le bucket « retours » contient des captures';
  end if;
end $$;

delete from public.permission_profile_rights where right_code = 'organisation.retours.suivre';
delete from public.company_member_rights where right_code = 'organisation.retours.suivre';
delete from public.permissions where code = 'organisation.retours.suivre';
delete from storage.buckets where id = 'retours';

drop index if exists public.user_feedback_author_idx;
alter table public.user_feedback drop constraint if exists user_feedback_status_check;
alter table public.user_feedback add constraint user_feedback_status_check check (status in ('nouveau', 'fait', 'ecarte'));
alter table public.user_feedback drop constraint if exists user_feedback_notice_fk;
alter table public.user_feedback drop constraint if exists user_feedback_response_check;
alter table public.user_feedback drop constraint if exists user_feedback_severity_check;
alter table public.user_feedback drop constraint if exists user_feedback_kind_check;
alter table public.user_feedback drop column if exists updated_at;
alter table public.user_feedback drop column if exists notice_id;
alter table public.user_feedback drop column if exists response_read_at;
alter table public.user_feedback drop column if exists responded_by;
alter table public.user_feedback drop column if exists responded_at;
alter table public.user_feedback drop column if exists response;
alter table public.user_feedback drop column if exists screenshot_path;
alter table public.user_feedback drop column if exists severity;
alter table public.user_feedback drop column if exists kind;
comment on table public.user_feedback is 'Retours des utilisateurs (post-it) : lus et écrits seulement par le serveur (/api/retours)';

delete from public.schema_migrations where version = '0263_retours_suivi';

-- ═══ 0262_bandeau_nouveautes ═══
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

-- ═══ 0261_registre_migrations ═══
-- Retour arrière de 0261_registre_migrations.sql : retire l'inscription faite par 0261. Idempotent.
-- 0190 n'est retirée que si elle a été inscrite par 0261 (même instant d'inscription, même transaction) :
-- une inscription faite par 0190 elle-même reste en place.

delete from public.schema_migrations s
where s.version = '0190_passeport_prevention'
  and exists (select 1 from public.schema_migrations r
              where r.version = '0261_registre_migrations' and r.applied_at = s.applied_at)
  and (select count(*) from public.schema_migrations x
       where x.applied_at = s.applied_at) = 2;

delete from public.schema_migrations where version = '0261_registre_migrations';

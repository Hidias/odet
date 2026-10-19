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
-- Bucket vide : retiré si le stockage l'autorise par SQL ; sinon laissé (vide, privé, sans effet) et à supprimer
-- dans Supabase › Storage
do $$
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.buckets where id = 'retours';
exception when others then
  raise notice 'Bucket « retours » laissé en place (vide) : %', sqlerrm;
end $$;

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

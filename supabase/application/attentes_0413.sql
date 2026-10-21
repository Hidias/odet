-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (attentes_0413) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0413_bilan_attentes.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0413_bilan_attentes_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0413_bilan_attentes.sql =====
-- 0413 : bilan des attentes en fin de formation (suggestion validée par H le 21/10). Les attentes que le stagiaire
-- écrit dans sa fiche de renseignements sont reprises à la fin :
--   1. sur le portail, avec l'avis à chaud : « Vous attendiez : … Ces attentes ont-elles été satisfaites ? »
--      (oui, en partie, non, et un commentaire) ; une réponse « non » prévient l'équipe (une notification) ;
--   2. dans la session, onglet Évaluations : le formateur ou l'organisme note son propre bilan pour chaque stagiaire.
-- Rien n'est envoyé par email. Migration additive : deux colonnes sur trainee_evaluations, trois sur session_trainees,
-- une fonction du portail (même contrôle que les autres : jeton de session, stagiaire inscrit, code d'accès).
-- Idempotente. Retour arrière : supabase/rollback/0413_bilan_attentes_retour.sql

-- 1. Avis du stagiaire
alter table public.trainee_evaluations add column if not exists attentes_satisfaites text;
alter table public.trainee_evaluations add column if not exists attentes_commentaire text;
alter table public.trainee_evaluations drop constraint if exists trainee_evaluations_attentes_satisfaites_check;
alter table public.trainee_evaluations add constraint trainee_evaluations_attentes_satisfaites_check
  check (attentes_satisfaites is null or attentes_satisfaites in ('oui', 'en_partie', 'non'));
comment on column public.trainee_evaluations.attentes_satisfaites is
  'Avis du stagiaire en fin de formation sur ses attentes (fiche de renseignements) : oui, en_partie, non';

-- 2. Bilan du formateur ou de l'organisme
alter table public.session_trainees add column if not exists attentes_bilan text;
alter table public.session_trainees add column if not exists attentes_bilan_note text;
alter table public.session_trainees add column if not exists attentes_bilan_at timestamptz;
alter table public.session_trainees drop constraint if exists session_trainees_attentes_bilan_check;
alter table public.session_trainees add constraint session_trainees_attentes_bilan_check
  check (attentes_bilan is null or attentes_bilan in ('oui', 'en_partie', 'non'));
comment on column public.session_trainees.attentes_bilan is
  'Bilan de l''organisme sur les attentes du stagiaire en fin de formation : oui, en_partie, non';

-- 3. Portail : avis du stagiaire sur ses attentes
create or replace function public.portal_save_attentes(p_token text, p_trainee_id uuid, p_verdict text,
                                                       p_commentaire text default null, p_ticket text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
  v_avant text;
  s record;
  t record;
begin
  v_session := app.portal_session_for(p_token, p_trainee_id, p_ticket);
  if p_verdict is null or p_verdict not in ('oui', 'en_partie', 'non') then
    raise exception 'Réponse invalide';
  end if;
  select e.attentes_satisfaites into v_avant from public.trainee_evaluations e
   where e.session_id = v_session and e.trainee_id = p_trainee_id;
  -- Seulement sur un avis déjà envoyé : une ligne créée ici fausserait la satisfaction (notes à 5 par défaut)
  update public.trainee_evaluations e
     set attentes_satisfaites = p_verdict,
         attentes_commentaire = nullif(btrim(left(coalesce(p_commentaire, ''), 2000)), ''),
         updated_at = now()
   where e.session_id = v_session and e.trainee_id = p_trainee_id;
  if not found then raise exception 'Envoyez d''abord votre avis sur la formation'; end if;
  -- Attentes non satisfaites : l'équipe est prévenue une fois (pas de nouvelle alerte si la réponse ne change pas)
  if p_verdict = 'non' and v_avant is distinct from 'non' then
    select se.company_id, se.start_date, co.title into s
      from public.sessions se left join public.courses co on co.id = se.course_id where se.id = v_session;
    select tr.first_name, tr.last_name into t from public.trainees tr where tr.id = p_trainee_id;
    insert into public.notifications (type, title, message, link, company_id, metadata)
    values ('attentes_non_satisfaites',
            left('Attentes non satisfaites' || coalesce(' : ' || s.title, '') || coalesce(' du ' || to_char(s.start_date, 'DD/MM'), ''), 255),
            concat_ws(' ', t.first_name, upper(t.last_name)) || ' indique que ses attentes n''ont pas été satisfaites.'
              || coalesce(' « ' || nullif(btrim(left(coalesce(p_commentaire, ''), 300)), '') || ' »', ''),
            '/sessions/' || v_session, s.company_id,
            jsonb_build_object('session_id', v_session, 'trainee_id', p_trainee_id));
  end if;
  return json_build_object('success', true);
end
$$;
revoke all on function public.portal_save_attentes(text, uuid, text, text, text) from public;
grant execute on function public.portal_save_attentes(text, uuid, text, text, text) to anon, authenticated;

insert into public.schema_migrations (version) values ('0413_bilan_attentes') on conflict (version) do nothing;

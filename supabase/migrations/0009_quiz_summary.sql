-- 0009_quiz_summary.sql : le résumé du portail indique la taille de la banque d'évaluation du thème
-- (pour masquer l'entraînement et l'évaluation des acquis quand aucune question notée n'existe)

create or replace function public.portal_quiz_summary(p_token text, p_trainee_id uuid)
returns json language sql stable security definer set search_path = public as $$
  with s as (
    select s.id, c.theme_id from sessions s join courses c on c.id = s.course_id where s.attendance_token = p_token
  )
  select json_build_object(
    'evaluation_bank', (select count(*) from theme_questions q, s where q.theme_id = s.theme_id and q.is_active and q.for_evaluation),
    'training_attempts', (select count(*) from quiz_attempts a, s where a.session_id = s.id and a.trainee_id = p_trainee_id and a.purpose = 'training'),
    'training_best', (select max(case when max_score > 0 then round(100.0 * score / max_score) else 0 end) from quiz_attempts a, s where a.session_id = s.id and a.trainee_id = p_trainee_id and a.purpose = 'training'),
    'xp', (select coalesce(sum(xp), 0) from quiz_attempts a, s where a.session_id = s.id and a.trainee_id = p_trainee_id),
    'final', (select json_build_object('score', score, 'max_score', max_score, 'finished_at', finished_at) from quiz_attempts a, s where a.session_id = s.id and a.trainee_id = p_trainee_id and a.purpose = 'final' and finished_at is not null limit 1)
  )
$$;
grant execute on function public.portal_quiz_summary(text, uuid) to anon, authenticated;

insert into public.schema_migrations (version) values ('0009_quiz_summary') on conflict (version) do nothing;

-- Les questions de niveau moyen et difficile servent à l'entraînement et à l'évaluation des acquis,
-- pas au positionnement (qui garde les questions d'origine, ouvertes et d'auto-évaluation comprises)
update public.theme_questions set for_positioning = false where difficulty in ('moyen', 'difficile');

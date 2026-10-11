-- 0007_quiz.sql : moteur de quiz (positionnement, entraînement, évaluation des acquis)
-- La banque reste theme_questions (par thème de formation), enrichie ; les tentatives
-- d'entraînement et d'évaluation vont dans quiz_attempts, notées côté serveur.

alter table public.theme_questions
  add column if not exists kind text not null default 'single' check (kind in ('single', 'truefalse', 'order', 'image')),
  add column if not exists difficulty text not null default 'facile' check (difficulty in ('facile', 'moyen', 'difficile')),
  add column if not exists explanation text,
  add column if not exists objective_index integer,
  add column if not exists xp integer not null default 10,
  add column if not exists image_url text,
  add column if not exists option_images jsonb,
  add column if not exists is_active boolean not null default true,
  add column if not exists for_positioning boolean not null default true,
  add column if not exists for_evaluation boolean not null default true;

comment on column public.theme_questions.kind is 'single : une bonne réponse ; truefalse ; order : remettre dans l''ordre (correct_order) ; image : options illustrées';
comment on column public.theme_questions.difficulty is 'Jamais affichée au stagiaire ; sert à composer les tests';

alter table public.theme_questions add column if not exists correct_order jsonb;

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  trainee_id uuid not null references public.trainees(id) on delete cascade,
  purpose text not null check (purpose in ('training', 'final')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score integer not null default 0,
  max_score integer not null default 0,
  xp integer not null default 0,
  answers jsonb not null default '[]'::jsonb,
  by_objective jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists quiz_attempts_session_trainee_idx on public.quiz_attempts(session_id, trainee_id, purpose);

alter table public.quiz_attempts enable row level security;
create policy "quiz_attempts_select" on public.quiz_attempts for select to authenticated using (true);
create policy "quiz_attempts_update_superadmin" on public.quiz_attempts for update to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy "quiz_attempts_delete_superadmin" on public.quiz_attempts for delete to authenticated using (public.is_superadmin());

-- ------------------------------------------------------------
-- Sélection des questions pour le portail (sans les bonnes réponses)
--   positioning : toutes les questions actives du thème marquées for_positioning
--   training / final : tirage de 12 questions (8 faciles, 2 moyennes, 2 difficiles si disponibles), ordre aléatoire
-- ------------------------------------------------------------
create or replace function public.portal_quiz_questions(p_token text, p_trainee_id uuid, p_purpose text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_session_id uuid;
  v_theme_id uuid;
  v_result json;
begin
  select s.id, c.theme_id into v_session_id, v_theme_id
  from sessions s join courses c on c.id = s.course_id
  where s.attendance_token = p_token;
  if v_session_id is null then raise exception 'Token invalide'; end if;
  if not exists (select 1 from session_trainees where session_id = v_session_id and trainee_id = p_trainee_id) then
    raise exception 'Stagiaire non trouvé dans cette session';
  end if;

  if p_purpose = 'positioning' then
    select json_agg(json_build_object(
      'id', q.id, 'kind', q.kind, 'question_text', q.question_text, 'question_type', q.question_type,
      'options', q.options, 'option_images', q.option_images, 'image_url', q.image_url, 'xp', q.xp, 'objective_index', q.objective_index
    ) order by q.position)
    into v_result
    from theme_questions q
    where q.theme_id = v_theme_id and q.is_active and q.for_positioning;
  else
    with ranked as (
      select q.*, row_number() over (partition by q.difficulty order by random()) as rn
      from theme_questions q
      where q.theme_id = v_theme_id and q.is_active and q.for_evaluation
    ),
    picked as (
      select * from ranked where (difficulty = 'facile' and rn <= 8) or (difficulty = 'moyen' and rn <= 2) or (difficulty = 'difficile' and rn <= 2)
    )
    select json_agg(json_build_object(
      'id', p.id, 'kind', p.kind, 'question_text', p.question_text, 'question_type', p.question_type,
      'options', p.options, 'option_images', p.option_images, 'image_url', p.image_url, 'xp', p.xp, 'objective_index', p.objective_index
    ) order by random())
    into v_result
    from picked p;
  end if;

  return coalesce(v_result, '[]'::json);
end $$;
grant execute on function public.portal_quiz_questions(text, uuid, text) to anon, authenticated;

-- Vérification d'une réponse (entraînement et évaluation) : la correction reste côté serveur
create or replace function public.portal_quiz_check(p_token text, p_question_id uuid, p_answer jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_q record;
  v_ok boolean := false;
begin
  if not exists (select 1 from sessions where attendance_token = p_token) then raise exception 'Token invalide'; end if;
  select * into v_q from theme_questions where id = p_question_id;
  if v_q.id is null then raise exception 'Question inconnue'; end if;

  if v_q.kind = 'order' then
    v_ok := (p_answer->'order') = v_q.correct_order;
  else
    v_ok := (p_answer->>'index')::int = v_q.correct_index;
  end if;

  return json_build_object(
    'correct', v_ok,
    'explanation', v_q.explanation,
    'correct_index', v_q.correct_index,
    'correct_order', v_q.correct_order,
    'xp', case when v_ok then v_q.xp else 0 end
  );
end $$;
grant execute on function public.portal_quiz_check(text, uuid, jsonb) to anon, authenticated;

-- Enregistrement d'une tentative notée côté serveur.
-- final : une seule tentative terminée par stagiaire et par session (la suivante renvoie l'existante)
create or replace function public.portal_quiz_finish(p_token text, p_trainee_id uuid, p_purpose text, p_answers jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_session_id uuid;
  v_existing record;
  v_a jsonb;
  v_q record;
  v_ok boolean;
  v_score int := 0;
  v_max int := 0;
  v_xp int := 0;
  v_details jsonb := '[]'::jsonb;
  v_obj jsonb := '{}'::jsonb;
  v_key text;
  v_attempt_id uuid;
begin
  select id into v_session_id from sessions where attendance_token = p_token;
  if v_session_id is null then raise exception 'Token invalide'; end if;
  if not exists (select 1 from session_trainees where session_id = v_session_id and trainee_id = p_trainee_id) then
    raise exception 'Stagiaire non trouvé dans cette session';
  end if;
  if p_purpose not in ('training', 'final') then raise exception 'Type de quiz inconnu'; end if;

  if p_purpose = 'final' then
    select * into v_existing from quiz_attempts
    where session_id = v_session_id and trainee_id = p_trainee_id and purpose = 'final' and finished_at is not null
    limit 1;
    if v_existing.id is not null then
      return json_build_object('already_done', true, 'attempt_id', v_existing.id, 'score', v_existing.score, 'max_score', v_existing.max_score, 'xp', v_existing.xp, 'by_objective', v_existing.by_objective);
    end if;
  end if;

  for v_a in select * from jsonb_array_elements(p_answers) loop
    select * into v_q from theme_questions where id = (v_a->>'question_id')::uuid;
    if v_q.id is null then continue; end if;
    if v_q.kind = 'order' then
      v_ok := (v_a->'order') = v_q.correct_order;
    else
      v_ok := (v_a->>'index')::int = v_q.correct_index;
    end if;
    v_max := v_max + 1;
    if v_ok then v_score := v_score + 1; v_xp := v_xp + coalesce(v_q.xp, 10); end if;
    v_details := v_details || jsonb_build_object('question_id', v_q.id, 'correct', v_ok, 'answer', v_a);
    v_key := coalesce(v_q.objective_index::text, 'general');
    v_obj := jsonb_set(v_obj, array[v_key], jsonb_build_object(
      'total', coalesce((v_obj->v_key->>'total')::int, 0) + 1,
      'correct', coalesce((v_obj->v_key->>'correct')::int, 0) + case when v_ok then 1 else 0 end
    ), true);
  end loop;

  insert into quiz_attempts (session_id, trainee_id, purpose, finished_at, score, max_score, xp, answers, by_objective)
  values (v_session_id, p_trainee_id, p_purpose, now(), v_score, v_max, v_xp, v_details, v_obj)
  returning id into v_attempt_id;

  return json_build_object('already_done', false, 'attempt_id', v_attempt_id, 'score', v_score, 'max_score', v_max, 'xp', v_xp, 'by_objective', v_obj);
end $$;
grant execute on function public.portal_quiz_finish(text, uuid, text, jsonb) to anon, authenticated;

-- Résumé des tentatives d'un stagiaire (pour le portail)
create or replace function public.portal_quiz_summary(p_token text, p_trainee_id uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'training_attempts', (select count(*) from quiz_attempts a join sessions s on s.id = a.session_id where s.attendance_token = p_token and a.trainee_id = p_trainee_id and a.purpose = 'training'),
    'training_best', (select max(case when max_score > 0 then round(100.0 * score / max_score) else 0 end) from quiz_attempts a join sessions s on s.id = a.session_id where s.attendance_token = p_token and a.trainee_id = p_trainee_id and a.purpose = 'training'),
    'xp', (select coalesce(sum(xp), 0) from quiz_attempts a join sessions s on s.id = a.session_id where s.attendance_token = p_token and a.trainee_id = p_trainee_id),
    'final', (select json_build_object('score', score, 'max_score', max_score, 'finished_at', finished_at) from quiz_attempts a join sessions s on s.id = a.session_id where s.attendance_token = p_token and a.trainee_id = p_trainee_id and a.purpose = 'final' and finished_at is not null limit 1)
  )
$$;
grant execute on function public.portal_quiz_summary(text, uuid) to anon, authenticated;

insert into public.schema_migrations (version) values ('0007_quiz') on conflict (version) do nothing;

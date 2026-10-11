-- 0011_quiz_display_order.sql : pour les questions « remettre dans l'ordre », le serveur fournit
-- un ordre d'affichage mélangé (jamais égal au bon ordre) sans révéler la bonne réponse.

create or replace function public.quiz_display_order(p_options jsonb, p_correct jsonb)
returns jsonb language plpgsql volatile as $$
declare
  v_n int := coalesce(jsonb_array_length(p_options), 0);
  v_arr int[];
  v_tmp int;
  i int; j int;
  v_out jsonb;
begin
  if v_n = 0 then return '[]'::jsonb; end if;
  v_arr := array(select generate_series(0, v_n - 1));
  for i in reverse v_n..2 loop
    j := 1 + floor(random() * i)::int;
    v_tmp := v_arr[i]; v_arr[i] := v_arr[j]; v_arr[j] := v_tmp;
  end loop;
  v_out := to_jsonb(v_arr);
  if p_correct is not null and v_out = p_correct and v_n > 1 then
    v_out := to_jsonb(v_arr[2:v_n] || v_arr[1:1]);
  end if;
  return v_out;
end $$;

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
      'options', q.options, 'option_images', q.option_images, 'image_url', q.image_url, 'xp', q.xp, 'objective_index', q.objective_index,
      'display_order', case when q.kind = 'order' then quiz_display_order(q.options, q.correct_order) else null end
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
      'options', p.options, 'option_images', p.option_images, 'image_url', p.image_url, 'xp', p.xp, 'objective_index', p.objective_index,
      'display_order', case when p.kind = 'order' then quiz_display_order(p.options, p.correct_order) else null end
    ) order by random())
    into v_result
    from picked p;
  end if;

  return coalesce(v_result, '[]'::json);
end $$;
grant execute on function public.portal_quiz_questions(text, uuid, text) to anon, authenticated;

insert into public.schema_migrations (version) values ('0011_quiz_display_order') on conflict (version) do nothing;

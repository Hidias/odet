-- 0425 : quiz flash en cours de formation (demande de H, 21/10, 21 h 45 à 22 h 08). Entre deux étapes, le formateur
-- lance un petit quiz rapide et ludique pour voir où en est le groupe : rien de certificatif, pas grave s'il n'est pas
-- fait. Deux façons de jouer, au choix du formateur :
--   « direct » : page plein écran projetée (QR code, chrono, réponses en direct, correction, podium) ; le formateur
--                fait avancer les questions, tout le groupe joue en même temps ;
--   « autonome » : QR code seul ; chacun joue à son rythme, avec un chrono par question.
-- Les stagiaires jouent depuis le portail, déjà identifiés par leur code (0423) ; à l'écran, ils n'apparaissent que
-- sous un surnom tiré au hasard (liste de l'organisme, modifiable). Les questions viennent de la banque par thème déjà
-- en place (theme_questions, modifiable dans l'outil) : questions à une seule bonne réponse, du thème de la formation.
--   1. theme_questions.for_flash : une question peut être retirée du quiz flash.
--   2. quiz_flash_surnoms (liste de l'organisme), quiz_flash_parties, quiz_flash_joueurs, quiz_flash_reponses.
--   3. Formateur : quiz_flash_lancer, quiz_flash_piloter, quiz_flash_ecran (droit de modifier la session).
--   4. Portail : portal_quiz_flash (état et inscription au jeu), portal_quiz_flash_repondre (points calculés par la base).
-- Points : bonne réponse 500 à 1 000 selon la rapidité, 700 en mode « sans chrono » (accessibilité), +100 par bonne
-- réponse d'affilée à partir de la deuxième. Migration additive. Idempotente.
-- Retour arrière : supabase/rollback/0425_quiz_flash_retour.sql

-- ── 1. Banque ──
alter table public.theme_questions add column if not exists for_flash boolean not null default true;
comment on column public.theme_questions.for_flash is 'Question proposée dans le quiz flash en cours de formation (une seule bonne réponse)';

-- ── 2. Tables ──
create table if not exists public.quiz_flash_surnoms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  surnom text not null check (length(btrim(surnom)) between 2 and 40),
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, surnom)
);
comment on table public.quiz_flash_surnoms is 'Surnoms tirés au hasard pour le quiz flash (aucun vrai nom à l''écran) ; liste de l''organisme, modifiable';

create table if not exists public.quiz_flash_parties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  theme_id uuid references public.training_themes(id) on delete set null,
  question_ids uuid[] not null,
  mode text not null default 'direct' check (mode in ('direct', 'autonome')),
  phase text not null default 'attente' check (phase in ('attente', 'question', 'correction', 'fini')),
  q_index int not null default -1,
  q_debut timestamptz,
  duree int not null default 20 check (duree between 10 and 60),
  cree_par uuid,
  created_at timestamptz not null default now(),
  fini_at timestamptz
);
create index if not exists quiz_flash_parties_session_idx on public.quiz_flash_parties (session_id, created_at desc);
comment on table public.quiz_flash_parties is 'Quiz flash d''une session : évaluation en cours de formation, non certificative';

create table if not exists public.quiz_flash_joueurs (
  id uuid primary key default gen_random_uuid(),
  partie_id uuid not null references public.quiz_flash_parties(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  trainee_id uuid not null references public.trainees(id) on delete cascade,
  surnom text not null,
  points int not null default 0,
  serie int not null default 0,
  q_vue int not null default -1,
  q_vue_at timestamptz,
  created_at timestamptz not null default now(),
  unique (partie_id, trainee_id),
  unique (partie_id, surnom)
);

create table if not exists public.quiz_flash_reponses (
  id uuid primary key default gen_random_uuid(),
  partie_id uuid not null references public.quiz_flash_parties(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  trainee_id uuid not null references public.trainees(id) on delete cascade,
  question_id uuid not null,
  q_index int not null,
  choix int not null,
  juste boolean not null,
  ms int not null,
  points int not null default 0,
  created_at timestamptz not null default now(),
  unique (partie_id, trainee_id, q_index)
);

-- Surnoms de départ (nature, mer, symboles, lieux, gastronomie de Bretagne : jamais une personne, un métier ou un
-- groupe), posés pour chaque société, sans toucher à ceux qui existent ; modifiables dans l'outil
insert into public.quiz_flash_surnoms (company_id, surnom)
select c.id, s.surnom
  from public.companies c
  cross join (values ('Goéland des Glénan'), ('Hermine de Brocéliande'), ('Phare d''Eckmühl'), ('Menhir de Carnac'),
                     ('Kouign-amann Turbo'), ('Triskell Express'), ('Marée Haute'), ('Embruns du Raz'), ('Fest-Noz'),
                     ('Sardine de Concarneau'), ('Crêpe Dentelle'), ('Fou de Bassan'), ('Ajonc d''Or'), ('Pointe du Van'),
                     ('Cormoran de Sein'), ('Lande des Monts d''Arrée'), ('Galette Express'), ('Phare du Créac''h'),
                     ('Macareux des Sept-Îles'), ('Vent de Noroît'), ('Granit Rose'), ('Marée de Vives-Eaux'),
                     ('Bruyère de Locronan'), ('Bigorneau Fusée'), ('Chouchen Doré'), ('Phoque de Molène'),
                     ('Fanal de Penmarc''h'), ('Écume de Quiberon'), ('Caramel au Beurre Salé'), ('Dolmen Express')) as s(surnom)
on conflict (company_id, surnom) do nothing;

-- ── 3. Questions : texte, réponses (format de la banque normalisé), bonne réponse, explication ──
create or replace function app.qf_question(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', q.id, 'texte', q.question_text,
    'choix', case jsonb_typeof(q.options) when 'string' then (q.options #>> '{}')::jsonb else q.options end,
    'bonne', q.correct_index, 'explication', q.explanation)
  from public.theme_questions q where q.id = p_id
$$;
revoke all on function app.qf_question(uuid) from public, anon, authenticated;

-- Questions jouables d'un thème pour une société : une seule bonne réponse, 2 à 4 réponses
create or replace function app.qf_questions_jouables(p_company uuid, p_theme uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare q record; v_o jsonb;
begin
  for q in select id, options, correct_index from public.theme_questions t
            where t.theme_id = p_theme and coalesce(t.is_active, true) and coalesce(t.for_flash, true)
              and coalesce(t.kind, 'single') in ('single', 'truefalse') and t.correct_index is not null
              and (t.company_id = p_company or p_company = any (coalesce(t.company_ids, '{}'::uuid[]))) loop
    begin
      v_o := case jsonb_typeof(q.options) when 'string' then (q.options #>> '{}')::jsonb else q.options end;
    exception when others then continue;
    end;
    continue when jsonb_typeof(v_o) <> 'array' or jsonb_array_length(v_o) not between 2 and 4
      or q.correct_index < 0 or q.correct_index >= jsonb_array_length(v_o);
    return next q.id;
  end loop;
end
$$;
revoke all on function app.qf_questions_jouables(uuid, uuid) from public, anon, authenticated;

-- Surnom libre tiré au hasard dans la liste de la société (sinon « Joueur N »)
create or replace function app.qf_surnom(p_partie uuid, p_company uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v text;
begin
  select s.surnom into v from public.quiz_flash_surnoms s
   where s.company_id = p_company and s.actif
     and not exists (select 1 from public.quiz_flash_joueurs j where j.partie_id = p_partie and j.surnom = s.surnom)
   order by random() limit 1;
  if v is null then
    v := 'Joueur ' || ((select count(*) from public.quiz_flash_joueurs j where j.partie_id = p_partie) + 1);
  end if;
  return v;
end
$$;
revoke all on function app.qf_surnom(uuid, uuid) from public, anon, authenticated;

-- ── 4. Formateur ──
create or replace function public.quiz_flash_lancer(p_session uuid, p_mode text default 'direct', p_theme uuid default null, p_nb int default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  v_theme uuid;
  v_ids uuid[];
  v_id uuid;
begin
  if not app.can_edit_session(p_session) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if p_mode not in ('direct', 'autonome') then raise exception 'Mode inconnu' using errcode = '22023'; end if;
  select se.id, se.company_id, co.theme_id into s from public.sessions se left join public.courses co on co.id = se.course_id where se.id = p_session;
  v_theme := coalesce(p_theme, s.theme_id);
  if v_theme is null then raise exception 'Choisissez le thème des questions' using errcode = '22023'; end if;
  select array_agg(x order by random()) into v_ids
    from (select x from app.qf_questions_jouables(s.company_id, v_theme) x) z;
  if coalesce(array_length(v_ids, 1), 0) < 3 then
    raise exception 'Pas assez de questions à une seule bonne réponse dans ce thème (3 au minimum) : complétez la banque' using errcode = '22023';
  end if;
  v_ids := v_ids[1:greatest(3, least(coalesce(p_nb, 5), 10))];
  update public.quiz_flash_parties set phase = 'fini', fini_at = now() where session_id = p_session and phase <> 'fini';
  insert into public.quiz_flash_parties (company_id, session_id, theme_id, question_ids, mode, phase, cree_par)
  values (s.company_id, p_session, v_theme, v_ids, p_mode, case when p_mode = 'autonome' then 'question' else 'attente' end, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'questions', array_length(v_ids, 1));
end
$$;
revoke all on function public.quiz_flash_lancer(uuid, text, uuid, int) from public, anon;
grant execute on function public.quiz_flash_lancer(uuid, text, uuid, int) to authenticated;

create or replace function public.quiz_flash_piloter(p_partie uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare p public.quiz_flash_parties;
begin
  select * into p from public.quiz_flash_parties where id = p_partie for update;
  if p.id is null then raise exception 'Quiz inconnu' using errcode = '22023'; end if;
  if not app.can_edit_session(p.session_id) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if p_action = 'terminer' then
    update public.quiz_flash_parties set phase = 'fini', fini_at = now() where id = p.id;
  elsif p.mode = 'direct' and p_action = 'demarrer' and p.phase = 'attente' then
    update public.quiz_flash_parties set phase = 'question', q_index = 0, q_debut = now() where id = p.id;
  elsif p.mode = 'direct' and p_action = 'corriger' and p.phase = 'question' then
    update public.quiz_flash_parties set phase = 'correction' where id = p.id;
  elsif p.mode = 'direct' and p_action = 'suivante' and p.phase = 'correction' then
    if p.q_index + 1 >= array_length(p.question_ids, 1) then
      update public.quiz_flash_parties set phase = 'fini', fini_at = now() where id = p.id;
    else
      update public.quiz_flash_parties set phase = 'question', q_index = p.q_index + 1, q_debut = now() where id = p.id;
    end if;
  end if;
  return public.quiz_flash_ecran(p.id);
end
$$;
revoke all on function public.quiz_flash_piloter(uuid, text) from public, anon;
grant execute on function public.quiz_flash_piloter(uuid, text) to authenticated;

-- Écran du formateur (projeté) : jamais de vrai nom ; la bonne réponse seulement à la correction et à la fin
create or replace function public.quiz_flash_ecran(p_partie uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.quiz_flash_parties;
  v_q jsonb;
  v_n int;
  v_stats jsonb;
begin
  select * into p from public.quiz_flash_parties where id = p_partie;
  if p.id is null then raise exception 'Quiz inconnu' using errcode = '22023'; end if;
  if not app.can_edit_session(p.session_id) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  v_n := array_length(p.question_ids, 1);
  if p.mode = 'direct' and p.q_index >= 0 and p.q_index < v_n then
    v_q := app.qf_question(p.question_ids[p.q_index + 1]);
    if p.phase = 'question' then v_q := v_q - 'bonne' - 'explication'; end if;
    v_q := v_q || jsonb_build_object('compte', (
      select coalesce(jsonb_agg(c order by k), '[]'::jsonb) from (
        select k, (select count(*) from public.quiz_flash_reponses r where r.partie_id = p.id and r.q_index = p.q_index and r.choix = k) as c
          from generate_series(0, greatest(jsonb_array_length(v_q->'choix') - 1, 0)) k) z),
      'reponses', (select count(*) from public.quiz_flash_reponses r where r.partie_id = p.id and r.q_index = p.q_index));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('index', i - 1, 'texte', (app.qf_question(p.question_ids[i]))->>'texte',
           'reponses', (select count(*) from public.quiz_flash_reponses r where r.partie_id = p.id and r.q_index = i - 1),
           'justes', (select count(*) from public.quiz_flash_reponses r where r.partie_id = p.id and r.q_index = i - 1 and r.juste)) order by i), '[]'::jsonb)
    into v_stats from generate_series(1, v_n) i;
  return jsonb_build_object(
    'id', p.id, 'mode', p.mode, 'phase', p.phase, 'q_index', p.q_index, 'nb', v_n, 'duree', p.duree,
    'q_debut', p.q_debut, 'maintenant', now(),
    'theme', (select t.name from public.training_themes t where t.id = p.theme_id),
    'joueurs', (select count(*) from public.quiz_flash_joueurs j where j.partie_id = p.id),
    'surnoms', (select coalesce(jsonb_agg(j.surnom order by j.created_at), '[]'::jsonb) from public.quiz_flash_joueurs j where j.partie_id = p.id),
    'question', v_q,
    'classement', (select coalesce(jsonb_agg(jsonb_build_object('surnom', x.surnom, 'points', x.points) order by x.points desc, x.created_at), '[]'::jsonb)
                     from (select j.surnom, j.points, j.created_at from public.quiz_flash_joueurs j where j.partie_id = p.id
                           order by j.points desc, j.created_at limit 10) x),
    'stats', v_stats);
end
$$;
revoke all on function public.quiz_flash_ecran(uuid) from public, anon;
grant execute on function public.quiz_flash_ecran(uuid) to authenticated;

-- ── 5. Portail ──
create or replace function public.portal_quiz_flash(p_token text, p_trainee_id uuid, p_ticket text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
  p public.quiz_flash_parties;
  j public.quiz_flash_joueurs;
  v_n int;
  v_idx int;
  v_q jsonb;
  r public.quiz_flash_reponses;
  v_rang int;
begin
  v_session := app.portal_session_for(p_token, p_trainee_id, p_ticket);
  select * into p from public.quiz_flash_parties
   where session_id = v_session and phase <> 'fini' and created_at > now() - interval '4 hours'
   order by created_at desc limit 1;
  if p.id is null then
    -- Dernière partie terminée depuis moins d'une heure : le stagiaire voit son résultat
    select * into p from public.quiz_flash_parties
     where session_id = v_session and phase = 'fini' and fini_at > now() - interval '1 hour'
       and exists (select 1 from public.quiz_flash_joueurs x where x.partie_id = quiz_flash_parties.id and x.trainee_id = p_trainee_id)
     order by fini_at desc limit 1;
    if p.id is null then return jsonb_build_object('partie', null); end if;
  end if;
  select * into j from public.quiz_flash_joueurs where partie_id = p.id and trainee_id = p_trainee_id;
  if j.id is null then
    if p.phase = 'fini' then return jsonb_build_object('partie', null); end if;
    insert into public.quiz_flash_joueurs (partie_id, company_id, trainee_id, surnom)
    values (p.id, p.company_id, p_trainee_id, app.qf_surnom(p.id, p.company_id))
    on conflict (partie_id, trainee_id) do nothing;
    select * into j from public.quiz_flash_joueurs where partie_id = p.id and trainee_id = p_trainee_id;
  end if;
  v_n := array_length(p.question_ids, 1);
  if p.mode = 'direct' then
    v_idx := case when p.phase in ('question', 'correction') then p.q_index else null end;
  else
    v_idx := (select count(*) from public.quiz_flash_reponses x where x.partie_id = p.id and x.trainee_id = p_trainee_id);
    if v_idx >= v_n or p.phase = 'fini' then v_idx := null;
    elsif j.q_vue <> v_idx then
      update public.quiz_flash_joueurs set q_vue = v_idx, q_vue_at = now() where id = j.id returning * into j;
    end if;
  end if;
  if v_idx is not null then
    v_q := app.qf_question(p.question_ids[v_idx + 1]);
    select * into r from public.quiz_flash_reponses where partie_id = p.id and trainee_id = p_trainee_id and q_index = v_idx;
    if r.id is null and not (p.mode = 'direct' and p.phase = 'correction') then
      v_q := v_q - 'bonne' - 'explication';
    end if;
  end if;
  select count(*) + 1 into v_rang from public.quiz_flash_joueurs x where x.partie_id = p.id and x.points > j.points;
  return jsonb_build_object(
    'partie', p.id, 'mode', p.mode, 'phase', case when p.mode = 'autonome' and v_idx is null then 'fini' else p.phase end,
    'q_index', v_idx, 'nb', v_n, 'duree', p.duree, 'maintenant', now(),
    'q_debut', case when p.mode = 'direct' then p.q_debut else j.q_vue_at end,
    'theme', (select t.name from public.training_themes t where t.id = p.theme_id),
    'question', v_q,
    'ma_reponse', case when r.id is null then null else jsonb_build_object('choix', r.choix, 'juste', r.juste, 'points', r.points) end,
    'moi', jsonb_build_object('surnom', j.surnom, 'points', j.points, 'serie', j.serie, 'rang', v_rang,
                              'joueurs', (select count(*) from public.quiz_flash_joueurs x where x.partie_id = p.id)),
    'podium', case when p.phase = 'fini' or (p.mode = 'autonome' and v_idx is null) then (
      select coalesce(jsonb_agg(jsonb_build_object('surnom', x.surnom, 'points', x.points) order by x.points desc, x.created_at), '[]'::jsonb)
        from (select surnom, points, created_at from public.quiz_flash_joueurs where partie_id = p.id order by points desc, created_at limit 3) x)
      else null end);
end
$$;
revoke all on function public.portal_quiz_flash(text, uuid, text) from public;
grant execute on function public.portal_quiz_flash(text, uuid, text) to anon, authenticated;

create or replace function public.portal_quiz_flash_repondre(p_token text, p_trainee_id uuid, p_ticket text, p_partie uuid,
                                                             p_index int, p_choix int, p_sans_chrono boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
  p public.quiz_flash_parties;
  j public.quiz_flash_joueurs;
  v_q jsonb;
  v_debut timestamptz;
  v_ms int;
  v_juste boolean;
  v_pts int := 0;
  v_serie int;
begin
  v_session := app.portal_session_for(p_token, p_trainee_id, p_ticket);
  select * into p from public.quiz_flash_parties where id = p_partie and session_id = v_session for update;
  if p.id is null or p.phase = 'fini' then raise exception 'Ce quiz est terminé' using errcode = '22023'; end if;
  select * into j from public.quiz_flash_joueurs where partie_id = p.id and trainee_id = p_trainee_id for update;
  if j.id is null then raise exception 'Rejoignez d''abord le quiz' using errcode = '22023'; end if;
  if p.mode = 'direct' then
    if p.phase <> 'question' or p.q_index <> p_index then raise exception 'Cette question est close' using errcode = '22023'; end if;
    v_debut := p.q_debut;
  else
    if p_index <> (select count(*) from public.quiz_flash_reponses x where x.partie_id = p.id and x.trainee_id = p_trainee_id)
       or j.q_vue <> p_index then
      raise exception 'Question inattendue' using errcode = '22023';
    end if;
    v_debut := j.q_vue_at;
  end if;
  if exists (select 1 from public.quiz_flash_reponses x where x.partie_id = p.id and x.trainee_id = p_trainee_id and x.q_index = p_index) then
    raise exception 'Réponse déjà donnée' using errcode = '22023';
  end if;
  v_ms := greatest(0, round(extract(epoch from (now() - coalesce(v_debut, now()))) * 1000))::int;
  v_q := app.qf_question(p.question_ids[p_index + 1]);
  -- choix -1 : temps écoulé sans réponse (mode autonome : passer à la question suivante), aucun point
  if p_choix = -1 then
    v_juste := false;
  else
    if not coalesce(p_sans_chrono, false) and v_ms > (p.duree + 2) * 1000 then
      raise exception 'Temps écoulé pour cette question' using errcode = '22023';
    end if;
    if p_choix is null or p_choix < 0 or p_choix >= jsonb_array_length(v_q->'choix') then raise exception 'Réponse inconnue' using errcode = '22023'; end if;
    v_juste := p_choix = (v_q->>'bonne')::int;
  end if;
  v_serie := case when v_juste then j.serie + 1 else 0 end;
  if v_juste then
    v_pts := case when coalesce(p_sans_chrono, false) then 700
                  else 500 + round(500 * greatest(0, 1 - v_ms::numeric / (p.duree * 1000)))::int end
             + case when v_serie >= 2 then 100 * (v_serie - 1) else 0 end;
  end if;
  insert into public.quiz_flash_reponses (partie_id, company_id, trainee_id, question_id, q_index, choix, juste, ms, points)
  values (p.id, p.company_id, p_trainee_id, p.question_ids[p_index + 1], p_index, p_choix, v_juste, v_ms, v_pts);
  update public.quiz_flash_joueurs set points = points + v_pts, serie = v_serie where id = j.id;
  return jsonb_build_object('juste', v_juste, 'bonne', (v_q->>'bonne')::int, 'explication', v_q->>'explication',
                            'points', v_pts, 'total', j.points + v_pts, 'serie', v_serie);
end
$$;
revoke all on function public.portal_quiz_flash_repondre(text, uuid, text, uuid, int, int, boolean) from public;
grant execute on function public.portal_quiz_flash_repondre(text, uuid, text, uuid, int, int, boolean) to anon, authenticated;


-- Pose des règles d'une liste de tables : une règle par action, garde du module ajoutée ici.
-- Lecture : module actif, ou super administrateur. Écriture : module actif.
create or replace function pg_temp.regles(p_tables text[], p_module text, p_sel text, p_ins text, p_upd text, p_del text)
returns void
language plpgsql
as $f$
declare
  t text;
  v_on text;
  v_sel text := p_sel; v_ins text := p_ins; v_upd text := p_upd; v_del text := p_del;
begin
  if p_module is not null then
    select '(' || string_agg(format('(select app.module_on(%L))', m), ' or ') || ')' into v_on
    from unnest(string_to_array(p_module, '|')) m;
    if v_sel is not null then v_sel := format('((%s and %s) or (select app.is_superadmin()))', v_on, v_sel); end if;
    if v_ins is not null then v_ins := format('(%s and %s)', v_on, v_ins); end if;
    if v_upd is not null then v_upd := format('(%s and %s)', v_on, v_upd); end if;
    if v_del is not null then v_del := format('(%s and %s)', v_on, v_del); end if;
  end if;
  foreach t in array p_tables loop
    execute format('alter table public.%I enable row level security', t);
    if v_sel is not null then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_lire', t, v_sel);
    end if;
    if v_ins is not null then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_creer', t, v_ins);
    end if;
    if v_upd is not null then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_modifier', t, v_upd, v_upd);
    end if;
    if v_del is not null then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_supprimer', t, v_del);
    end if;
  end loop;
end
$f$;

-- Suppression des règles nommées du générateur (lire, créer, modifier, supprimer) ; les autres règles
-- (règle restrictive des notifications de 0070, etc.) ne sont pas touchées
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['quiz_flash_joueurs', 'quiz_flash_parties', 'quiz_flash_reponses', 'quiz_flash_surnoms'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- quiz_flash_joueurs, quiz_flash_parties, quiz_flash_reponses
select pg_temp.regles(array['quiz_flash_joueurs', 'quiz_flash_parties', 'quiz_flash_reponses'], null,
  $r$company_id in (select app.societes_avec_droit('formation.sessions.voir'))$r$,
  null,
  null,
  null);

-- quiz_flash_surnoms
select pg_temp.regles(array['quiz_flash_surnoms'], null,
  $r$company_id in (select app.societes_avec_droit('formation.catalogue.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.catalogue.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.catalogue.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.catalogue.gerer'))$r$);


insert into public.schema_migrations (version) values ('0425_quiz_flash') on conflict (version) do nothing;

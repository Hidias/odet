-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (formation_mixte_0452) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0452_formation_mixte.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

-- ===== supabase/migrations/0452_formation_mixte.sql =====
-- 0452 : formation mixte (pilotage de H du 24/10, partie 5 e ; piste 14 « priorité forte »). Des modules en ligne sont
-- rattachés à une formation du catalogue ; chaque stagiaire d'une session de cette formation les suit sur son portail
-- avant la session (texte, vidéo, lien, petites questions de validation). Le temps passé et la validation sont notés
-- par la base, sans saisie : le formateur voit qui est prêt, et la preuve de la partie à distance est gardée.
--   1. course_modules : modules d'une formation (ordre, type, contenu, durée prévue, obligatoire, questions, seuil).
--   2. course_module_progress : suivi par session, stagiaire et module (ouverture, temps passé, validation, score).
--   3. Portail : public.portal_modules (liste et suivi du stagiaire) ; public.portal_module_suivre (ouvrir, temps passé
--      par tranches plafonnées, terminer avec les réponses : la base corrige, jamais l'écran).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0452_formation_mixte_retour.sql

create table if not exists public.course_modules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  position int not null default 0,
  title text not null check (length(btrim(title)) between 2 and 200),
  kind text not null default 'texte' check (kind in ('texte', 'video', 'lien')),
  body text check (body is null or length(body) <= 20000),
  url text check (url is null or (url ~ '^https://' and length(url) <= 1000)),
  duration_minutes int check (duration_minutes is null or duration_minutes between 1 and 600),
  required boolean not null default true,
  questions jsonb not null default '[]'::jsonb,
  pass_percent int not null default 70 check (pass_percent between 0 and 100),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_modules_questions check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 30)
);
create index if not exists course_modules_course_idx on public.course_modules (course_id, position);
create index if not exists course_modules_company_idx on public.course_modules (company_id);
comment on table public.course_modules is 'Formation mixte : modules en ligne d''une formation, suivis sur le portail du stagiaire avant la session';
comment on column public.course_modules.questions is 'Questions de validation : [{ "q": texte, "choix": [..], "bonne": indice }] ; la base corrige';

create table if not exists public.course_module_progress (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  trainee_id uuid not null references public.trainees(id) on delete cascade,
  module_id uuid not null references public.course_modules(id) on delete cascade,
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seconds_spent int not null default 0 check (seconds_spent >= 0),
  attempts int not null default 0 check (attempts >= 0),
  score_percent int check (score_percent is null or score_percent between 0 and 100),
  completed_at timestamptz,
  constraint course_module_progress_uniq unique (session_id, trainee_id, module_id)
);
create index if not exists course_module_progress_session_idx on public.course_module_progress (session_id);
create index if not exists course_module_progress_company_idx on public.course_module_progress (company_id);
comment on table public.course_module_progress is 'Formation mixte : suivi des modules par stagiaire (temps passé, validation), écrit seulement par les fonctions du portail';

-- Société et formation tenues par la base
create or replace function app.course_module_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid;
  v_q jsonb;
begin
  select c.company_id into v_co from public.courses c where c.id = new.course_id;
  if v_co is null then raise exception 'Formation introuvable' using errcode = 'P0002'; end if;
  new.company_id := v_co;
  new.updated_at := now();
  for v_q in select * from jsonb_array_elements(new.questions) loop
    if jsonb_typeof(v_q->'choix') <> 'array' or jsonb_array_length(v_q->'choix') < 2 or jsonb_array_length(v_q->'choix') > 6
       or length(btrim(coalesce(v_q->>'q', ''))) < 3 or (v_q->>'bonne') !~ '^[0-9]+$'
       or (v_q->>'bonne')::int >= jsonb_array_length(v_q->'choix') then
      raise exception 'Question de validation incomplète : un énoncé, 2 à 6 choix et la bonne réponse' using errcode = '23514';
    end if;
  end loop;
  return new;
end
$$;
revoke all on function app.course_module_garde() from public, anon, authenticated;
drop trigger if exists course_modules_garde on public.course_modules;
create trigger course_modules_garde before insert or update on public.course_modules for each row execute function app.course_module_garde();
drop trigger if exists zz_audit_row on public.course_modules;
create trigger zz_audit_row after insert or update or delete on public.course_modules for each row execute function app.audit_row('formation');

do $$
declare t text;
begin
  foreach t in array array['course_modules', 'course_module_progress'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;
grant select, insert, update, delete on table public.course_modules to authenticated;
grant select on table public.course_module_progress to authenticated;

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

do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['course_modules', 'course_module_progress'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- course_modules : lus avec le catalogue ou les sessions, tenus par qui gère le catalogue
select pg_temp.regles(array['course_modules'], null,
  $r$(company_id in (select app.societes_avec_droit('formation.catalogue.voir')) or company_id in (select app.societes_avec_droit('formation.sessions.voir')))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.catalogue.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.catalogue.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.catalogue.gerer'))$r$);
-- course_module_progress : lu avec les sessions ; écrit seulement par les fonctions du portail
select pg_temp.regles(array['course_module_progress'], null,
  $r$company_id in (select app.societes_avec_droit('formation.sessions.voir'))$r$, null, null, null);

do $$
declare t text;
begin
  foreach t in array array['course_modules', 'course_module_progress'] loop
    execute format('drop policy if exists %I on public.%I', t || '_societe_lire', t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (company_id in (select app.societes_lisibles()))', t || '_societe_lire', t);
  end loop;
  execute 'drop policy if exists course_modules_societe_creer on public.course_modules';
  execute 'drop policy if exists course_modules_societe_modifier on public.course_modules';
  execute 'drop policy if exists course_modules_societe_supprimer on public.course_modules';
  execute 'create policy course_modules_societe_creer on public.course_modules as restrictive for insert to authenticated with check (company_id in (select app.societes_ecriture()))';
  execute 'create policy course_modules_societe_modifier on public.course_modules as restrictive for update to authenticated using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()))';
  execute 'create policy course_modules_societe_supprimer on public.course_modules as restrictive for delete to authenticated using (company_id in (select app.societes_ecriture()))';
end $$;

-- ── 3. Portail du stagiaire ──
-- Modules de la session du stagiaire, sans les bonnes réponses, avec son suivi
create or replace function public.portal_modules(p_token text, p_trainee_id uuid, p_ticket text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid := app.portal_session_for(p_token, p_trainee_id, p_ticket);
  v_course uuid;
begin
  select s.course_id into v_course from public.sessions s where s.id = v_session;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'position', m.position, 'title', m.title, 'kind', m.kind, 'body', m.body, 'url', m.url,
      'duration_minutes', m.duration_minutes, 'required', m.required, 'pass_percent', m.pass_percent,
      'questions', (select coalesce(jsonb_agg(jsonb_build_object('q', q->>'q', 'choix', q->'choix')), '[]'::jsonb) from jsonb_array_elements(m.questions) q),
      'suivi', (select jsonb_build_object('seconds', p.seconds_spent, 'completed_at', p.completed_at, 'score', p.score_percent, 'attempts', p.attempts)
                from public.course_module_progress p where p.session_id = v_session and p.trainee_id = p_trainee_id and p.module_id = m.id))
      order by m.position, m.created_at)
    from public.course_modules m where m.course_id = v_course and m.archived_at is null), '[]'::jsonb);
end
$$;
revoke all on function public.portal_modules(text, uuid, text) from public;
grant execute on function public.portal_modules(text, uuid, text) to anon, authenticated;

-- Suivi : « ouvrir », « temps » (tranches de 15 s à 2 min, au plus 2 fois la durée prévue + 30 min par module),
-- « terminer » (réponses corrigées par la base ; validé si le seuil est atteint ou s'il n'y a pas de questions)
create or replace function public.portal_module_suivre(p_token text, p_trainee_id uuid, p_ticket text, p_module uuid, p_action text,
  p_seconds int default 0, p_reponses jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid := app.portal_session_for(p_token, p_trainee_id, p_ticket);
  m public.course_modules;
  p public.course_module_progress;
  v_plafond int;
  v_bonnes int := 0;
  v_n int;
  v_score int;
  i int;
begin
  select cm.* into m from public.course_modules cm join public.sessions s on s.course_id = cm.course_id
   where cm.id = p_module and s.id = v_session and cm.archived_at is null;
  if m.id is null then raise exception 'Module inconnu pour cette formation' using errcode = '42501'; end if;
  insert into public.course_module_progress (company_id, session_id, trainee_id, module_id)
  select s.company_id, v_session, p_trainee_id, m.id from public.sessions s where s.id = v_session
  on conflict (session_id, trainee_id, module_id) do nothing;
  select * into p from public.course_module_progress where session_id = v_session and trainee_id = p_trainee_id and module_id = m.id for update;

  if p_action = 'temps' then
    v_plafond := (coalesce(m.duration_minutes, 30) * 2 + 30) * 60;
    update public.course_module_progress
       set seconds_spent = least(v_plafond, seconds_spent + greatest(0, least(coalesce(p_seconds, 0), 120))), last_seen_at = now()
     where id = p.id;
  elsif p_action = 'terminer' then
    v_n := jsonb_array_length(m.questions);
    if v_n > 0 then
      if p_reponses is null or jsonb_typeof(p_reponses) <> 'array' or jsonb_array_length(p_reponses) <> v_n then
        raise exception 'Répondez à toutes les questions' using errcode = '22023';
      end if;
      for i in 0 .. v_n - 1 loop
        if (p_reponses->>i) = (m.questions->i->>'bonne') then v_bonnes := v_bonnes + 1; end if;
      end loop;
      v_score := round(100.0 * v_bonnes / v_n);
    end if;
    update public.course_module_progress
       set attempts = attempts + 1, score_percent = coalesce(v_score, score_percent), last_seen_at = now(),
           completed_at = case when completed_at is not null then completed_at
                               when v_n = 0 or v_score >= m.pass_percent then now() end
     where id = p.id;
  elsif p_action <> 'ouvrir' then
    raise exception 'Action inconnue' using errcode = '22023';
  end if;
  select * into p from public.course_module_progress where id = p.id;
  return jsonb_build_object('seconds', p.seconds_spent, 'completed_at', p.completed_at, 'score', p.score_percent, 'attempts', p.attempts,
    'reussi', p.completed_at is not null);
end
$$;
revoke all on function public.portal_module_suivre(text, uuid, text, uuid, text, int, jsonb) from public;
grant execute on function public.portal_module_suivre(text, uuid, text, uuid, text, int, jsonb) to anon, authenticated;

insert into public.schema_migrations (version) values ('0452_formation_mixte') on conflict (version) do nothing;

-- ===== supabase/rollback/0452_formation_mixte_retour.sql =====
-- Retour arrière de 0452_formation_mixte.sql. Idempotent. Refusé s'il existe des modules ou un suivi (ils seraient
-- perdus) : les retirer d'abord.
do $do$
begin
  if to_regclass('public.course_modules') is not null and exists (select 1 from public.course_modules) then
    raise exception 'Des modules en ligne existent : retour arrière refusé';
  end if;
end
$do$;
drop function if exists public.portal_module_suivre(text, uuid, text, uuid, text, int, jsonb);
drop function if exists public.portal_modules(text, uuid, text);
drop table if exists public.course_module_progress;
drop table if exists public.course_modules;
drop function if exists app.course_module_garde();
delete from public.schema_migrations where version = '0452_formation_mixte';

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE formation_mixte_0452 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

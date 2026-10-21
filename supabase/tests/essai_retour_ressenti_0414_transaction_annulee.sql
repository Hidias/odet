-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (ressenti_0414) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0414_ressenti.sql, retour arrière,
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

-- ===== supabase/migrations/0414_ressenti.sql =====
-- 0414 : ressenti au fil de la formation (suggestion validée par H le 21/10 : « évaluations au fil de l'eau sur le
-- portail »). Chaque jour de formation, le stagiaire donne sur le portail son ressenti de la journée (de 1 à 5) et,
-- s'il veut, une difficulté ou une question pour le formateur. Le formateur le voit le jour même et peut adapter la
-- suite (Qualiopi, indicateur 11 : suivi de la progression ; indicateur 30 : appréciations recueillies).
--   1. session_ressentis : un ressenti par stagiaire et par jour (modifiable le jour même).
--   2. public.portal_ressenti : lecture et enregistrement depuis le portail (jeton de session, stagiaire inscrit,
--      code d'accès ; seulement pendant les dates de la formation).
--   3. Une seule notification par session et par jour, tenue à jour (« 6 ressentis, 4,2 sur 5, 1 difficulté ») ;
--      une note de 1 ou 2 la remet en non lue et relance l'alerte du téléphone. Aucun email.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0414_ressenti_retour.sql

-- ── 1. Ressentis ──
create table if not exists public.session_ressentis (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  trainee_id uuid not null references public.trainees(id) on delete cascade,
  jour date not null,
  note smallint not null check (note between 1 and 5),
  commentaire text check (commentaire is null or length(commentaire) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, trainee_id, jour)
);
create index if not exists session_ressentis_session_idx on public.session_ressentis (session_id, jour);
comment on table public.session_ressentis is 'Ressenti du stagiaire au fil de la formation (une note de 1 à 5 par jour, et une remarque), donné sur le portail';
drop trigger if exists session_ressentis_societe on public.session_ressentis;
create trigger session_ressentis_societe before insert or update of session_id on public.session_ressentis
  for each row execute function app.societe_du_parent('sessions', 'session_id');

-- ── 2. Notification du jour, tenue à jour ──
create or replace function app.ressenti_notification(p_session uuid, p_jour date, p_alerte boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  n int; moy numeric; n_diff int; n_rem int;
  v_id uuid; v_titre text; v_msg text;
begin
  select se.company_id, se.start_date, co.title into s
    from public.sessions se left join public.courses co on co.id = se.course_id where se.id = p_session;
  select count(*), round(avg(r.note), 1), count(*) filter (where r.note <= 2),
         count(*) filter (where nullif(btrim(coalesce(r.commentaire, '')), '') is not null)
    into n, moy, n_diff, n_rem
  from public.session_ressentis r where r.session_id = p_session and r.jour = p_jour;
  if n = 0 then return; end if;
  v_titre := left('Ressenti du jour' || coalesce(' : ' || s.title, '') || ' (' || to_char(p_jour, 'DD/MM') || ')', 255);
  v_msg := format('%s ressenti%s, %s sur 5', n, case when n > 1 then 's' else '' end, replace(moy::text, '.', ','))
           || case when n_diff > 0 then format(', %s difficulté%s', n_diff, case when n_diff > 1 then 's' else '' end) else '' end
           || case when n_rem > 0 then format(', %s remarque%s', n_rem, case when n_rem > 1 then 's' else '' end) else '' end || '.';
  select id into v_id from public.notifications
   where type = 'ressenti_stagiaires' and metadata->>'session_id' = p_session::text and metadata->>'jour' = p_jour::text
   order by created_at desc limit 1;
  if v_id is null then
    insert into public.notifications (type, title, message, link, company_id, metadata)
    values ('ressenti_stagiaires', v_titre, v_msg, '/sessions/' || p_session, s.company_id,
            jsonb_build_object('session_id', p_session, 'jour', p_jour));
  else
    update public.notifications
       set title = v_titre, message = v_msg,
           read_at = case when p_alerte then null else read_at end,
           pushed_at = case when p_alerte then null else pushed_at end
     where id = v_id;
  end if;
end
$$;
revoke all on function app.ressenti_notification(uuid, date, boolean) from public, anon, authenticated;

-- ── 3. Portail ──
create or replace function public.portal_ressenti(p_token text, p_trainee_id uuid, p_ticket text default null,
                                                  p_note int default null, p_commentaire text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
  v_jour date := (now() at time zone 'Europe/Paris')::date;
  v_ouvert boolean;
  v_avant smallint;
  r record;
begin
  v_session := app.portal_session_for(p_token, p_trainee_id, p_ticket);
  select v_jour between se.start_date and coalesce(se.end_date, se.start_date) into v_ouvert
    from public.sessions se where se.id = v_session;
  if p_note is not null then
    if not coalesce(v_ouvert, false) then raise exception 'Le ressenti se donne pendant les jours de formation'; end if;
    if p_note < 1 or p_note > 5 then raise exception 'Note invalide'; end if;
    select x.note into v_avant from public.session_ressentis x
     where x.session_id = v_session and x.trainee_id = p_trainee_id and x.jour = v_jour;
    insert into public.session_ressentis (session_id, trainee_id, jour, note, commentaire)
    values (v_session, p_trainee_id, v_jour, p_note, nullif(btrim(left(coalesce(p_commentaire, ''), 1000)), ''))
    on conflict (session_id, trainee_id, jour) do update
      set note = excluded.note, commentaire = excluded.commentaire, updated_at = now();
    -- Alerte relancée seulement pour une nouvelle difficulté (note de 1 ou 2 qui ne l'était pas)
    perform app.ressenti_notification(v_session, v_jour, p_note <= 2 and (v_avant is null or v_avant > 2));
  end if;
  select x.note, x.commentaire into r from public.session_ressentis x
   where x.session_id = v_session and x.trainee_id = p_trainee_id and x.jour = v_jour;
  return json_build_object('ouvert', coalesce(v_ouvert, false), 'jour', v_jour, 'note', r.note, 'commentaire', r.commentaire);
end
$$;
revoke all on function public.portal_ressenti(text, uuid, text, int, text) from public;
grant execute on function public.portal_ressenti(text, uuid, text, int, text) to anon, authenticated;

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
           where schemaname = 'public' and tablename = any (array['session_ressentis'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- session_ressentis
select pg_temp.regles(array['session_ressentis'], null,
  $r$(company_id in (select app.societes_avec_droit('formation.suivi.voir')) or ((select app.a_le_droit('formation.sessions.voir_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  null,
  null,
  $r$(company_id in (select app.societes_avec_droit('formation.suivi.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$);


insert into public.schema_migrations (version) values ('0414_ressenti') on conflict (version) do nothing;

-- ===== supabase/rollback/0414_ressenti_retour.sql =====
-- Retour arrière de 0414_ressenti.sql. Les ressentis sont effacés ; les notifications déjà créées restent. Idempotent.

drop function if exists public.portal_ressenti(text, uuid, text, int, text);
drop function if exists app.ressenti_notification(uuid, date, boolean);
drop table if exists public.session_ressentis;

delete from public.schema_migrations where version = '0414_ressenti';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE ressenti_0414 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

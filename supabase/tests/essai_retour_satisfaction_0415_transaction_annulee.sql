-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (satisfaction_0415) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0415_satisfaction_entreprise.sql, retour arrière,
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

-- ===== supabase/migrations/0415_satisfaction_entreprise.sql =====
-- 0415 : satisfaction de l'entreprise (suggestion validée par H le 21/10). Après une formation, l'entreprise cliente
-- donne son avis en ligne depuis son espace entreprise (au lieu du questionnaire papier joint à l'email) : note
-- globale, organisation, communication, atteinte des objectifs, suivi, recommandation, remarques et besoins à venir.
-- Qualiopi, indicateur 30 : appréciations des parties prenantes (entreprises).
--   1. client_satisfactions : un avis par entreprise et par session, modifiable.
--   2. public.ent_satisfaction(session, réponses) : lecture ou envoi par le compte de l'espace entreprise (session de
--      ce client, terminée) ; public.ent_satisfactions() : avis déjà donnés par ce client.
--   3. Premier avis : une notification à l'équipe (« Avis de l'entreprise : 4 sur 5 »). Aucun email.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0415_satisfaction_entreprise_retour.sql

-- ── 1. Avis ──
create table if not exists public.client_satisfactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  note_globale smallint not null check (note_globale between 1 and 5),
  q_organisation smallint check (q_organisation between 1 and 5),
  q_communication smallint check (q_communication between 1 and 5),
  q_objectifs smallint check (q_objectifs between 1 and 5),
  q_suivi smallint check (q_suivi between 1 and 5),
  recommande boolean,
  commentaire text check (commentaire is null or length(commentaire) <= 2000),
  besoins text check (besoins is null or length(besoins) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, client_id)
);
create index if not exists client_satisfactions_client_idx on public.client_satisfactions (client_id);
comment on table public.client_satisfactions is 'Avis de l''entreprise cliente sur une formation, donné depuis l''espace entreprise';
drop trigger if exists client_satisfactions_societe on public.client_satisfactions;
create trigger client_satisfactions_societe before insert or update of session_id on public.client_satisfactions
  for each row execute function app.societe_du_parent('sessions', 'session_id');

-- ── 2. Espace entreprise ──
create or replace function public.ent_satisfaction(p_session uuid, p_reponses jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
  s record;
  v_nouveau boolean;
  v_note int;
  r public.client_satisfactions;
  n text;
begin
  if not app.objet_du_client('session', p_session, v.client_id) then
    raise exception 'Session inconnue pour ce client' using errcode = '42501';
  end if;
  if p_reponses is not null then
    select se.company_id, se.start_date, coalesce(se.end_date, se.start_date) as fin, co.title into s
      from public.sessions se left join public.courses co on co.id = se.course_id where se.id = p_session;
    if s.fin > (now() at time zone 'Europe/Paris')::date then
      raise exception 'L''avis se donne à la fin de la formation' using errcode = '22023';
    end if;
    v_note := (p_reponses->>'note_globale')::int;
    if v_note is null or v_note < 1 or v_note > 5 then raise exception 'Note globale requise (de 1 à 5)' using errcode = '22023'; end if;
    foreach n in array array['q_organisation', 'q_communication', 'q_objectifs', 'q_suivi'] loop
      if p_reponses ? n and p_reponses->>n is not null and ((p_reponses->>n)::int < 1 or (p_reponses->>n)::int > 5) then
        raise exception 'Note invalide' using errcode = '22023';
      end if;
    end loop;
    v_nouveau := not exists (select 1 from public.client_satisfactions x where x.session_id = p_session and x.client_id = v.client_id);
    insert into public.client_satisfactions (session_id, client_id, profile_id, note_globale, q_organisation, q_communication,
                                             q_objectifs, q_suivi, recommande, commentaire, besoins)
    values (p_session, v.client_id, v.profile_id, v_note, (p_reponses->>'q_organisation')::int, (p_reponses->>'q_communication')::int,
            (p_reponses->>'q_objectifs')::int, (p_reponses->>'q_suivi')::int, (p_reponses->>'recommande')::boolean,
            nullif(btrim(left(coalesce(p_reponses->>'commentaire', ''), 2000)), ''),
            nullif(btrim(left(coalesce(p_reponses->>'besoins', ''), 1000)), ''))
    on conflict (session_id, client_id) do update
      set profile_id = excluded.profile_id, note_globale = excluded.note_globale, q_organisation = excluded.q_organisation,
          q_communication = excluded.q_communication, q_objectifs = excluded.q_objectifs, q_suivi = excluded.q_suivi,
          recommande = excluded.recommande, commentaire = excluded.commentaire, besoins = excluded.besoins, updated_at = now();
    if v_nouveau then
      insert into public.notifications (type, title, message, link, company_id, metadata)
      select 'satisfaction_entreprise',
             left('Avis de l''entreprise : ' || c.name || coalesce(' (' || s.title || ')', ''), 255),
             format('Note globale : %s sur 5', v_note)
               || case when (p_reponses->>'recommande')::boolean is true then ', recommande la formation'
                       when (p_reponses->>'recommande')::boolean is false then ', ne la recommande pas' else '' end
               || coalesce('. Besoins à venir : ' || nullif(btrim(left(coalesce(p_reponses->>'besoins', ''), 200)), ''), '') || '.',
             '/sessions/' || p_session, s.company_id,
             jsonb_build_object('session_id', p_session, 'client_id', v.client_id)
      from public.clients c where c.id = v.client_id;
    end if;
  end if;
  select * into r from public.client_satisfactions x where x.session_id = p_session and x.client_id = v.client_id;
  if r.id is null then return null; end if;
  return jsonb_build_object('note_globale', r.note_globale, 'q_organisation', r.q_organisation, 'q_communication', r.q_communication,
    'q_objectifs', r.q_objectifs, 'q_suivi', r.q_suivi, 'recommande', r.recommande, 'commentaire', r.commentaire,
    'besoins', r.besoins, 'updated_at', r.updated_at);
end
$$;
revoke all on function public.ent_satisfaction(uuid, jsonb) from public, anon;
grant execute on function public.ent_satisfaction(uuid, jsonb) to authenticated;

create or replace function public.ent_satisfactions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('session_id', x.session_id, 'note_globale', x.note_globale))
                   from public.client_satisfactions x where x.client_id = v.client_id), '[]'::jsonb);
end
$$;
revoke all on function public.ent_satisfactions() from public, anon;
grant execute on function public.ent_satisfactions() to authenticated;

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
           where schemaname = 'public' and tablename = any (array['client_satisfactions'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- client_satisfactions
select pg_temp.regles(array['client_satisfactions'], null,
  $r$company_id in (select app.societes_avec_droit('formation.suivi.voir'))$r$,
  null,
  null,
  $r$company_id in (select app.societes_avec_droit('formation.suivi.gerer'))$r$);


insert into public.schema_migrations (version) values ('0415_satisfaction_entreprise') on conflict (version) do nothing;

-- ===== supabase/rollback/0415_satisfaction_entreprise_retour.sql =====
-- Retour arrière de 0415_satisfaction_entreprise.sql. Les avis des entreprises sont effacés ; les notifications déjà
-- créées restent. Idempotent.

drop function if exists public.ent_satisfactions();
drop function if exists public.ent_satisfaction(uuid, jsonb);
drop table if exists public.client_satisfactions;

delete from public.schema_migrations where version = '0415_satisfaction_entreprise';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE satisfaction_0415 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

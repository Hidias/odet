-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (inscriptions_0485) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0485_trace_inscriptions.sql, retour arrière,
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

-- ===== supabase/migrations/0485_trace_inscriptions.sql =====
-- 0485 : trace de l'ajout et du retrait d'un stagiaire dans une session (demande de H, 04/11).
-- Jusqu'ici, retirer un stagiaire supprimait la ligne de session_trainees sans aucune trace : impossible de savoir
-- qui l'avait retiré, quand, ni s'il avait déjà émargé ou répondu à l'évaluation.
-- Un déclencheur écrit une ligne au journal d'audit (type « inscription ») à chaque ajout et à chaque retrait,
-- y compris quand le stagiaire est supprimé (la trace le dit, sans compter les émargements déjà effacés par leur
-- propre cascade). La suppression d'une session entière donne une seule ligne, écrite avant la cascade. L'auteur, son rôle et son poste sont posés par la garde du
-- journal (0345) ; une écriture sans compte (portail, tâche) est tracée aussi, sans auteur.
-- Contenu : identifiants de la session et du stagiaire, référence de la session, convention signée ou non,
-- et pour un retrait : demi-journées émargées, fiche de renseignement remplie (trainee_info_sheets.filled_at) et
-- évaluation remplie (trainee_evaluations.questionnaire_submitted). Jamais le nom, ni
-- aucune donnée personnelle du stagiaire (principe de 0345).
-- La trace est rattachée à la session (entity_id = session) pour être retrouvée depuis elle.
-- Additive. Idempotente. Retour arrière : supabase/rollback/0485_trace_inscriptions_retour.sql

create or replace function app.trace_inscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.session_trainees;
  v_ref text;
  v_conv boolean;
  v_company uuid;
  v_details jsonb;
  v_emargees integer := 0;
begin
  -- Suppression de la session entière : une seule ligne, écrite avant par app.trace_suppression_session()
  if tg_op = 'DELETE' and position(old.session_id::text in coalesce(current_setting('odet.sessions_supprimees', true), '')) > 0 then
    return null;
  end if;
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  select s.reference, s.convention_signed, s.company_id
    into v_ref, v_conv, v_company
  from public.sessions s where s.id = v_row.session_id;
  v_details := jsonb_build_object(
    'table', 'session_trainees',
    'session_id', v_row.session_id,
    'trainee_id', v_row.trainee_id,
    'session_reference', v_ref,
    'convention_signee', v_conv);
  if tg_op = 'DELETE' then
    -- Retrait provoqué par la suppression de la fiche du stagiaire : ses émargements, fiche et évaluation ont déjà
    -- été effacés par leur propre cascade. On le dit, sans compter ce qu'on ne voit plus.
    if not exists (select 1 from public.trainees t where t.id = v_row.trainee_id) then
      v_details := v_details || jsonb_build_object('suppression', 'stagiaire');
    else
      select count(*) filter (where a.morning) + count(*) filter (where a.afternoon)
        into v_emargees
      from public.attendance_halfdays a
      where a.session_id = v_row.session_id and a.trainee_id = v_row.trainee_id;
      v_details := v_details || jsonb_build_object(
        'demi_journees_emargees', coalesce(v_emargees, 0),
        'fiche_remplie', exists (select 1 from public.trainee_info_sheets f
                                 where f.session_id = v_row.session_id and f.trainee_id = v_row.trainee_id
                                   and f.filled_at is not null),
        'evaluation_remplie', exists (select 1 from public.trainee_evaluations e
                                      where e.session_id = v_row.session_id and e.trainee_id = v_row.trainee_id
                                        and coalesce(e.questionnaire_submitted, false)));
    end if;
  end if;
  -- Société de la ligne, sinon celle de la session ; une société disparue renvoie au journal de l'instance
  v_company := coalesce(v_row.company_id, v_company);
  if v_company is not null and not exists (select 1 from public.companies c where c.id = v_company) then
    v_company := null;
  end if;
  insert into public.audit_logs (action, entity_type, entity_id, entity_name, details, company_id, source)
  values (case tg_op when 'INSERT' then 'create' else 'delete' end,
          'inscription', v_row.session_id, v_ref, v_details,
          coalesce(v_company, app.current_company(), app.company_default()), 'base');
  return null;
end
$$;
revoke all on function app.trace_inscription() from public, anon, authenticated;

-- Suppression d'une session : une seule ligne au journal, écrite AVANT la cascade (référence, nombre d'inscriptions,
-- demi-journées émargées), et les retraits de ses inscriptions ne sont pas tracés un par un.
create or replace function app.trace_suppression_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inscrits integer;
  v_emargees integer;
  v_company uuid := old.company_id;
begin
  select count(*) into v_inscrits from public.session_trainees st where st.session_id = old.id;
  select count(*) filter (where a.morning) + count(*) filter (where a.afternoon) into v_emargees
  from public.attendance_halfdays a where a.session_id = old.id;
  if v_company is not null and not exists (select 1 from public.companies c where c.id = v_company) then
    v_company := null;
  end if;
  insert into public.audit_logs (action, entity_type, entity_id, entity_name, details, company_id, source)
  values ('delete', 'inscription', old.id, old.reference,
          jsonb_build_object('table', 'sessions', 'suppression', 'session', 'session_id', old.id,
                             'session_reference', old.reference, 'convention_signee', old.convention_signed,
                             'inscriptions', coalesce(v_inscrits, 0), 'demi_journees_emargees', coalesce(v_emargees, 0)),
          coalesce(v_company, app.current_company(), app.company_default()), 'base');
  -- Liste de la transaction (plusieurs sessions peuvent être supprimées par une même requête)
  perform set_config('odet.sessions_supprimees', coalesce(current_setting('odet.sessions_supprimees', true), '') || old.id::text || ',', true);
  return old;
end
$$;
revoke all on function app.trace_suppression_session() from public, anon, authenticated;

drop trigger if exists zz_trace_suppression_session on public.sessions;
create trigger zz_trace_suppression_session before delete on public.sessions
  for each row execute function app.trace_suppression_session();

drop trigger if exists zz_trace_inscription on public.session_trainees;
create trigger zz_trace_inscription after insert or delete on public.session_trainees
  for each row execute function app.trace_inscription();

insert into public.schema_migrations (version) values ('0485_trace_inscriptions') on conflict (version) do nothing;

-- ===== supabase/rollback/0485_trace_inscriptions_retour.sql =====
-- Retour arrière de 0485 : retrait du déclencheur et de sa fonction. Les lignes déjà écrites au journal d'audit
-- restent (le journal ne se modifie pas).
drop trigger if exists zz_trace_inscription on public.session_trainees;
drop function if exists app.trace_inscription();
drop trigger if exists zz_trace_suppression_session on public.sessions;
drop function if exists app.trace_suppression_session();
delete from public.schema_migrations where version = '0485_trace_inscriptions';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE inscriptions_0485 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

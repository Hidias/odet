-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (inscriptions_0485) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0485_trace_inscriptions.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0485_trace_inscriptions_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

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

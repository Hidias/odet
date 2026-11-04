-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (inscriptions_0485) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0485_trace_inscriptions.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0485_trace_inscriptions_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0485_trace_inscriptions.sql =====
-- 0485 : trace de l'ajout et du retrait d'un stagiaire dans une session (demande de H, 04/11).
-- Jusqu'ici, retirer un stagiaire supprimait la ligne de session_trainees sans aucune trace : impossible de savoir
-- qui l'avait retiré, quand, ni s'il avait déjà émargé ou répondu à l'évaluation.
-- Un déclencheur écrit une ligne au journal d'audit (type « inscription ») à chaque ajout et à chaque retrait,
-- y compris quand la session entière est supprimée. L'auteur, son rôle et son poste sont posés par la garde du
-- journal (0345) ; une écriture sans compte (portail, tâche) est tracée aussi, sans auteur.
-- Contenu : identifiants de la session et du stagiaire, référence de la session, convention signée ou non,
-- et pour un retrait : demi-journées émargées, fiche de renseignement et évaluation remplies. Jamais le nom, ni
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
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  select s.reference, coalesce(s.convention_signed, false), s.company_id
    into v_ref, v_conv, v_company
  from public.sessions s where s.id = v_row.session_id;
  v_details := jsonb_build_object(
    'table', 'session_trainees',
    'session_id', v_row.session_id,
    'trainee_id', v_row.trainee_id,
    'session_reference', v_ref,
    'convention_signee', coalesce(v_conv, false));
  if tg_op = 'DELETE' then
    select count(*) filter (where a.morning) + count(*) filter (where a.afternoon)
      into v_emargees
    from public.attendance_halfdays a
    where a.session_id = v_row.session_id and a.trainee_id = v_row.trainee_id;
    v_details := v_details || jsonb_build_object(
      'demi_journees_emargees', coalesce(v_emargees, 0),
      'fiche_remplie', coalesce(v_row.info_sheet_completed, false),
      'evaluation_remplie', coalesce(v_row.evaluation_completed, false));
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

drop trigger if exists zz_trace_inscription on public.session_trainees;
create trigger zz_trace_inscription after insert or delete on public.session_trainees
  for each row execute function app.trace_inscription();

insert into public.schema_migrations (version) values ('0485_trace_inscriptions') on conflict (version) do nothing;

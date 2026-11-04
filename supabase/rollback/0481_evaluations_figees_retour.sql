-- Retour arrière de 0481 : réponses de nouveau modifiables selon les seules règles d'accès ; portail d'origine.
-- Les colonnes ajoutées (submitted_at, saisi_par) sont gardées : elles ne gênent rien et gardent la trace.
do $$
declare t text;
begin
  foreach t in array array['trainee_evaluations', 'evaluations_cold', 'trainer_evaluations'] loop
    execute format('drop trigger if exists evaluation_figee on public.%I', t);
  end loop;
end $$;
drop function if exists public.evaluation_enregistrer(text, uuid, uuid, jsonb, text);
drop function if exists public.evaluation_supprimer(text, uuid, uuid, text);
drop function if exists public.evaluation_froid_suivi(uuid, uuid, boolean);
drop function if exists app.evaluation_peut_saisir(uuid);
drop function if exists app.evaluation_table(text);
drop function if exists app.evaluation_champs(text);
drop function if exists app.evaluation_figee();
drop function if exists app.evaluation_recue(text, jsonb);

CREATE OR REPLACE FUNCTION public.save_evaluation(p_token text, p_trainee_id uuid, p_eval_data jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session_id uuid;
  v_result json;
BEGIN
  SELECT id INTO v_session_id FROM sessions WHERE attendance_token = p_token;
  IF v_session_id IS NULL THEN RAISE EXCEPTION 'Token invalide'; END IF;
  IF NOT EXISTS (SELECT 1 FROM session_trainees WHERE session_id = v_session_id AND trainee_id = p_trainee_id) THEN
    RAISE EXCEPTION 'Stagiaire non trouvé dans cette session';
  END IF;
  
  INSERT INTO trainee_evaluations (
    session_id, trainee_id, q_org_documents, q_org_accueil, q_org_locaux, q_org_materiel,
    q_contenu_organisation, q_contenu_supports, q_contenu_duree, q_contenu_programme,
    q_formateur_pedagogie, q_formateur_expertise, q_formateur_progression, q_formateur_moyens,
    q_global_adequation, q_global_competences, would_recommend, comment_general, comment_projet,
    questionnaire_submitted, submitted_at, submitted_online
  ) VALUES (
    v_session_id, p_trainee_id,
    (p_eval_data->>'q_org_documents')::integer, (p_eval_data->>'q_org_accueil')::integer,
    (p_eval_data->>'q_org_locaux')::integer, (p_eval_data->>'q_org_materiel')::integer,
    (p_eval_data->>'q_contenu_organisation')::integer, (p_eval_data->>'q_contenu_supports')::integer,
    (p_eval_data->>'q_contenu_duree')::integer, (p_eval_data->>'q_contenu_programme')::integer,
    (p_eval_data->>'q_formateur_pedagogie')::integer, (p_eval_data->>'q_formateur_expertise')::integer,
    (p_eval_data->>'q_formateur_progression')::integer, (p_eval_data->>'q_formateur_moyens')::integer,
    (p_eval_data->>'q_global_adequation')::integer, (p_eval_data->>'q_global_competences')::integer,
    (p_eval_data->>'would_recommend')::boolean, p_eval_data->>'comment_general',
    p_eval_data->>'comment_projet', true, now(), true
  )
  ON CONFLICT (session_id, trainee_id)
  DO UPDATE SET
    q_org_documents = EXCLUDED.q_org_documents, q_org_accueil = EXCLUDED.q_org_accueil,
    q_org_locaux = EXCLUDED.q_org_locaux, q_org_materiel = EXCLUDED.q_org_materiel,
    q_contenu_organisation = EXCLUDED.q_contenu_organisation, q_contenu_supports = EXCLUDED.q_contenu_supports,
    q_contenu_duree = EXCLUDED.q_contenu_duree, q_contenu_programme = EXCLUDED.q_contenu_programme,
    q_formateur_pedagogie = EXCLUDED.q_formateur_pedagogie, q_formateur_expertise = EXCLUDED.q_formateur_expertise,
    q_formateur_progression = EXCLUDED.q_formateur_progression, q_formateur_moyens = EXCLUDED.q_formateur_moyens,
    q_global_adequation = EXCLUDED.q_global_adequation, q_global_competences = EXCLUDED.q_global_competences,
    would_recommend = EXCLUDED.would_recommend, comment_general = EXCLUDED.comment_general,
    comment_projet = EXCLUDED.comment_projet, questionnaire_submitted = true,
    submitted_at = now(), submitted_online = true
  RETURNING to_json(trainee_evaluations.*) INTO v_result;
  
  RETURN v_result;
END;
$function$

;

delete from public.schema_migrations where version = '0481_evaluations_figees';

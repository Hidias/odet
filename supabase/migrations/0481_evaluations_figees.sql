-- 0481 : réponses aux évaluations figées dès leur réception (décision de H du 04/11, contrôle A3).
-- Constat du 04/11 sur les évaluations à chaud (trainee_evaluations), à froid (evaluations_cold) et du formateur
-- (trainer_evaluations) :
--   1. le portail stagiaire (save_evaluation, lien de la session) réécrivait une évaluation à chaud déjà envoyée ;
--   2. la réponse « attentes » (portal_save_attentes) se réécrivait de même ;
--   3. aucune trace des corrections faites par le super administrateur ;
--   4. sur la fiche session, les réponses saisies clic par clic ne s'enregistraient plus après le premier clic pour un
--      utilisateur autre que super administrateur (modification réservée à plateforme.administrer).
-- Décision : une réponse reçue ne se modifie plus. La saisie d'une réponse papier se fait en une fois et la fige.
-- Le super administrateur garde une marge de correction (erreur de saisie d'une entreprise, d'un stagiaire, d'un
-- formateur) : correction ou suppression avec motif obligatoire, trace avant et après au journal d'audit.
-- 1. trainer_evaluations.submitted_at (reçue) ; saisi_par sur les trois tables (réponse saisie pour le compte de la
--    personne ; vide : remplie par elle-même en ligne). Les avis du formateur déjà remplis sont tenus pour reçus.
-- 2. Déclencheur app.evaluation_figee : une ligne reçue ne se modifie ni ne se supprime, sauf par
--    evaluation_enregistrer / evaluation_supprimer (super administrateur, motif), la purge des données de
--    démonstration et l'effacement en cascade d'une session ou d'un stagiaire (régis par leurs propres règles).
--    Seule exception : la réponse « attentes » se donne une fois après l'évaluation à chaud.
-- 3. public.evaluation_enregistrer(type, session, personne, réponses, motif) : saisie en une fois (droit de suivi de
--    la session) ou correction (super administrateur, motif).
-- 4. public.evaluation_supprimer(type, session, personne, motif) : super administrateur, trace complète.
-- 5. public.evaluation_froid_suivi(session, stagiaire, envoyé) : case « Envoyé » de l'évaluation à froid.
-- 6. save_evaluation : refuse une évaluation déjà reçue ; portal_save_attentes : une seule réponse.
-- Additive. Idempotente. Retour arrière : supabase/rollback/0481_evaluations_figees_retour.sql

-- ── 1. Colonnes ──
alter table public.trainer_evaluations add column if not exists submitted_at timestamptz;
alter table public.trainer_evaluations add column if not exists saisi_par uuid;
alter table public.trainee_evaluations add column if not exists saisi_par uuid;
alter table public.evaluations_cold add column if not exists saisi_par uuid;
comment on column public.trainer_evaluations.submitted_at is 'Avis du formateur reçu : figé, correction par le super administrateur seulement (0481)';
comment on column public.trainee_evaluations.saisi_par is 'Compte qui a saisi la réponse reçue sur papier ; vide : remplie en ligne par le stagiaire (0481)';
comment on column public.evaluations_cold.saisi_par is 'Compte qui a saisi la réponse reçue sur papier ; vide : remplie en ligne par le stagiaire (0481)';
comment on column public.trainer_evaluations.saisi_par is 'Compte qui a enregistré l''avis du formateur (0481)';

update public.trainer_evaluations
   set submitted_at = coalesce(updated_at, created_at, now())
 where submitted_at is null
   and (coalesce(group_motivation, group_level, material_conditions, organization, documentation, overall_score) is not null
        or nullif(btrim(coalesce(comments, '') || coalesce(difficulties, '') || coalesce(successes, '') || coalesce(recommendations, '')), '') is not null);

-- ── 2. Réponse figée ──
create or replace function app.evaluation_recue(p_table text, p_row jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_table
    when 'trainee_evaluations' then coalesce((p_row ->> 'questionnaire_submitted')::boolean, false)
    when 'evaluations_cold' then p_row ->> 'completed_at' is not null
    when 'trainer_evaluations' then p_row ->> 'submitted_at' is not null
    else false end
$$;
revoke all on function app.evaluation_recue(text, jsonb) from public, anon, authenticated;

create or replace function app.evaluation_figee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb;
  v_champs text[];
begin
  if not app.evaluation_recue(tg_table_name, v_old) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Corrections et suppressions du super administrateur (fonctions ci-dessous), purge des données de démonstration
  if coalesce(current_setting('app.eval_correction', true), '') = 'on'
     or coalesce(current_setting('app.demo_purge', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    -- Effacement en cascade d'une session ou d'un stagiaire : régi par les règles de la session ou du stagiaire
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'Réponse reçue : elle ne se supprime pas (super administrateur seulement, avec un motif)' using errcode = '42501';
  end if;
  v_new := to_jsonb(new);
  select coalesce(array_agg(k order by k), '{}') into v_champs
    from jsonb_object_keys(v_new) k
   where (v_new -> k) is distinct from (v_old -> k) and k not in ('updated_at', 'company_id');
  if cardinality(v_champs) = 0 then return new; end if;
  -- La réponse « attentes » se donne une fois, après l'évaluation à chaud
  if tg_table_name = 'trainee_evaluations' and v_champs <@ array['attentes_commentaire', 'attentes_satisfaites'] then
    if v_old ->> 'attentes_satisfaites' is null then return new; end if;
    raise exception 'Votre réponse sur vos attentes est déjà enregistrée : merci' using errcode = '42501';
  end if;
  raise exception 'Réponse reçue : elle ne se modifie plus (correction par le super administrateur, avec un motif)' using errcode = '42501';
end
$$;
revoke all on function app.evaluation_figee() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['trainee_evaluations', 'evaluations_cold', 'trainer_evaluations'] loop
    execute format('drop trigger if exists evaluation_figee on public.%I', t);
    execute format('create trigger evaluation_figee before update or delete on public.%I for each row execute function app.evaluation_figee()', t);
  end loop;
end $$;

-- ── 3. Saisie en une fois, ou correction par le super administrateur ──
-- Réponses admises par type (clé : nature) ; toute autre clé est refusée.
create or replace function app.evaluation_champs(p_type text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'chaud' then jsonb_build_object(
      'q_org_documents', 'note', 'q_org_accueil', 'note', 'q_org_locaux', 'note', 'q_org_materiel', 'note',
      'q_contenu_organisation', 'note', 'q_contenu_supports', 'note', 'q_contenu_duree', 'note', 'q_contenu_programme', 'note',
      'q_formateur_pedagogie', 'note', 'q_formateur_expertise', 'note', 'q_formateur_progression', 'note', 'q_formateur_moyens', 'note',
      'q_global_adequation', 'note', 'q_global_competences', 'note', 'would_recommend', 'oui_non',
      'comment_general', 'texte', 'comment_projet', 'texte', 'attentes_satisfaites', 'attentes', 'attentes_commentaire', 'texte')
    when 'froid' then jsonb_build_object(
      'skills_applied', 'note', 'objectives_met', 'note', 'knowledge_retained', 'note', 'job_impact', 'note',
      'would_recommend', 'oui_non', 'needs_met', 'oui_non', 'concrete_examples', 'texte', 'obstacles', 'texte',
      'additional_needs', 'texte', 'comments', 'texte')
    when 'formateur' then jsonb_build_object(
      'group_motivation', 'note', 'group_level', 'note', 'material_conditions', 'note', 'organization', 'note',
      'documentation', 'note', 'overall_score', 'note', 'comments', 'texte', 'difficulties', 'texte',
      'successes', 'texte', 'recommendations', 'texte')
  end
$$;
revoke all on function app.evaluation_champs(text) from public, anon, authenticated;

create or replace function app.evaluation_table(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type when 'chaud' then 'trainee_evaluations' when 'froid' then 'evaluations_cold' when 'formateur' then 'trainer_evaluations' end
$$;
revoke all on function app.evaluation_table(text) from public, anon, authenticated;

-- Droit de suivi sur la session : formation.suivi.gerer dans la société de la session, ou formateur de la session
create or replace function app.evaluation_peut_saisir(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sessions s
     where s.id = p_session
       and (s.company_id in (select app.societes_avec_droit('formation.suivi.gerer'))
            or (s.company_id in (select app.societes_avec_droit('formation.sessions.modifier_siennes'))
                and s.id in (select app.trainer_session_ids()))))
$$;
revoke all on function app.evaluation_peut_saisir(uuid) from public, anon, authenticated;

create or replace function public.evaluation_enregistrer(p_type text, p_session uuid, p_personne uuid, p_reponses jsonb, p_motif text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text := app.evaluation_table(p_type);
  v_champs jsonb := app.evaluation_champs(p_type);
  v_col text := case p_type when 'formateur' then 'trainer_id' else 'trainee_id' end;
  v_cle text;
  v_val jsonb;
  v_nature text;
  v_avant jsonb;
  v_apres jsonb;
  v_id uuid;
  v_company uuid;
  v_correction boolean;
  v_set text := '';
  v_diff jsonb := '{}'::jsonb;
  v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  if v_table is null then raise exception 'Type d''évaluation inconnu' using errcode = '22023'; end if;
  if p_reponses is null or jsonb_typeof(p_reponses) <> 'object' then raise exception 'Réponses absentes' using errcode = '22023'; end if;
  select company_id into v_company from public.sessions where id = p_session;
  if v_company is null then raise exception 'Session introuvable' using errcode = '22023'; end if;
  -- La personne doit appartenir à la session
  if p_type = 'formateur' then
    if not exists (select 1 from public.sessions s where s.id = p_session and s.trainer_id = p_personne)
       and not exists (select 1 from public.session_trainers st where st.session_id = p_session and st.trainer_id = p_personne) then
      raise exception 'Ce formateur n''anime pas cette session' using errcode = '22023';
    end if;
  elsif not exists (select 1 from public.session_trainees st where st.session_id = p_session and st.trainee_id = p_personne) then
    raise exception 'Ce stagiaire n''est pas inscrit à cette session' using errcode = '22023';
  end if;
  -- Contrôle des réponses
  for v_cle, v_val in select * from jsonb_each(p_reponses) loop
    v_nature := v_champs ->> v_cle;
    if v_nature is null then raise exception 'Réponse inconnue : %', v_cle using errcode = '22023'; end if;
    if jsonb_typeof(v_val) = 'null' then continue; end if;
    if v_nature = 'note' and not (jsonb_typeof(v_val) = 'number' and (v_val #>> '{}')::numeric in (1, 2, 3, 4, 5)) then
      raise exception 'Réponse « % » : une note de 1 à 5 est attendue', v_cle using errcode = '22023';
    elsif v_nature = 'oui_non' and jsonb_typeof(v_val) <> 'boolean' then
      raise exception 'Réponse « % » : oui ou non est attendu', v_cle using errcode = '22023';
    elsif v_nature = 'texte' and (jsonb_typeof(v_val) <> 'string' or length(v_val #>> '{}') > 4000) then
      raise exception 'Réponse « % » : texte de 4 000 caractères au plus', v_cle using errcode = '22023';
    elsif v_nature = 'attentes' and not (jsonb_typeof(v_val) = 'string' and (v_val #>> '{}') in ('oui', 'en_partie', 'non')) then
      raise exception 'Réponse « attentes » invalide' using errcode = '22023';
    end if;
  end loop;

  execute format('select to_jsonb(t) from public.%I t where t.session_id = $1 and ($2 or t.%I = $3)', v_table, v_col)
     into v_avant using p_session, p_type = 'formateur', p_personne;
  v_correction := v_avant is not null and app.evaluation_recue(v_table, v_avant);

  if v_correction then
    if not app.is_superadmin() then
      raise exception 'Réponse déjà reçue : seule une correction par le super administrateur est possible' using errcode = '42501';
    end if;
    if v_motif is null or length(v_motif) < 5 then
      raise exception 'Indiquez le motif de la correction' using errcode = '22023';
    end if;
  elsif not (app.evaluation_peut_saisir(p_session) or app.is_superadmin()) then
    raise exception 'Droit de suivi de la session requis' using errcode = '42501';
  end if;

  if v_avant is null then
    execute format('insert into public.%I (session_id, %I) values ($1, $2) returning id', v_table, v_col) into v_id using p_session, p_personne;
  else
    v_id := (v_avant ->> 'id')::uuid;
  end if;

  -- Mise à jour des seules réponses transmises
  for v_cle in select jsonb_object_keys(p_reponses) loop
    v_set := v_set || format('%I = (jsonb_populate_record(null::public.%I, $1)).%I, ', v_cle, v_table, v_cle);
  end loop;
  if v_correction then
    perform set_config('app.eval_correction', 'on', true);
  else
    v_set := v_set || 'saisi_par = $3, ' || case p_type
      when 'chaud' then 'questionnaire_submitted = true, submitted_online = false, submitted_at = now(), '
      when 'froid' then 'completed_at = now(), sent_at = coalesce(sent_at, now()), '
      else 'submitted_at = now(), ' end;
  end if;
  v_set := v_set || case when p_type = 'froid' then 'session_id = session_id' else 'updated_at = now()' end;
  execute format('update public.%I set %s where id = $2', v_table, v_set) using p_reponses, v_id, (select auth.uid());
  perform set_config('app.eval_correction', '', true);

  execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_table) into v_apres using v_id;
  if v_correction then
    select coalesce(jsonb_object_agg(k, jsonb_build_object('avant', v_avant -> k, 'apres', v_apres -> k)), '{}') into v_diff
      from jsonb_object_keys(v_apres) k
     where (v_apres -> k) is distinct from (v_avant -> k) and k <> 'updated_at';
    insert into public.audit_logs (action, entity_type, entity_id, entity_name, details, company_id, source)
    values ('update', 'evaluation', v_id, 'Correction d''une évaluation reçue',
            jsonb_build_object('table', v_table, 'type', p_type, 'session_id', p_session, 'personne_id', p_personne,
                               'motif', v_motif, 'changements', v_diff),
            v_company, 'base');
  end if;
  return jsonb_build_object('id', v_id, 'correction', v_correction, 'evaluation', v_apres);
end
$$;
revoke all on function public.evaluation_enregistrer(text, uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.evaluation_enregistrer(text, uuid, uuid, jsonb, text) to authenticated;

-- ── 4. Suppression d'une réponse reçue ──
create or replace function public.evaluation_supprimer(p_type text, p_session uuid, p_personne uuid, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text := app.evaluation_table(p_type);
  v_col text := case p_type when 'formateur' then 'trainer_id' else 'trainee_id' end;
  v_avant jsonb;
  v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
begin
  if not app.is_superadmin() then raise exception 'Réservé au super administrateur' using errcode = '42501'; end if;
  if v_table is null then raise exception 'Type d''évaluation inconnu' using errcode = '22023'; end if;
  if v_motif is null or length(v_motif) < 5 then raise exception 'Indiquez le motif de la suppression' using errcode = '22023'; end if;
  execute format('select to_jsonb(t) from public.%I t where t.session_id = $1 and ($2 or t.%I = $3)', v_table, v_col)
     into v_avant using p_session, p_type = 'formateur', p_personne;
  if v_avant is null then raise exception 'Aucune réponse à supprimer' using errcode = '22023'; end if;
  perform set_config('app.eval_correction', 'on', true);
  execute format('delete from public.%I where id = $1', v_table) using (v_avant ->> 'id')::uuid;
  perform set_config('app.eval_correction', '', true);
  insert into public.audit_logs (action, entity_type, entity_id, entity_name, details, company_id, source)
  values ('delete', 'evaluation', (v_avant ->> 'id')::uuid, 'Suppression d''une évaluation',
          jsonb_build_object('table', v_table, 'type', p_type, 'session_id', p_session, 'personne_id', p_personne,
                             'motif', v_motif, 'avant', v_avant),
          (v_avant ->> 'company_id')::uuid, 'base');
  return jsonb_build_object('supprime', true);
end
$$;
revoke all on function public.evaluation_supprimer(text, uuid, uuid, text) from public, anon;
grant execute on function public.evaluation_supprimer(text, uuid, uuid, text) to authenticated;

-- ── 5. Case « Envoyé » de l'évaluation à froid ──
create or replace function public.evaluation_froid_suivi(p_session uuid, p_trainee uuid, p_envoye boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb;
begin
  if not (app.evaluation_peut_saisir(p_session) or app.is_superadmin()) then
    raise exception 'Droit de suivi de la session requis' using errcode = '42501';
  end if;
  if not exists (select 1 from public.session_trainees st where st.session_id = p_session and st.trainee_id = p_trainee) then
    raise exception 'Ce stagiaire n''est pas inscrit à cette session' using errcode = '22023';
  end if;
  insert into public.evaluations_cold (session_id, trainee_id, sent_at)
  values (p_session, p_trainee, case when p_envoye then now() end)
  on conflict (session_id, trainee_id) do update
     set sent_at = case when p_envoye then coalesce(public.evaluations_cold.sent_at, now()) end
   where public.evaluations_cold.completed_at is null;
  select to_jsonb(e) into v from public.evaluations_cold e where e.session_id = p_session and e.trainee_id = p_trainee;
  if v ->> 'completed_at' is not null and not p_envoye then
    raise exception 'Réponse déjà reçue : l''envoi ne s''annule plus' using errcode = '22023';
  end if;
  return v;
end
$$;
revoke all on function public.evaluation_froid_suivi(uuid, uuid, boolean) from public, anon;
grant execute on function public.evaluation_froid_suivi(uuid, uuid, boolean) to authenticated;

-- ── 6. Portail : une évaluation à chaud reçue ne se réécrit plus ──
create or replace function public.save_evaluation(p_token text, p_trainee_id uuid, p_eval_data jsonb)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_result json;
begin
  select id into v_session_id from public.sessions where attendance_token = p_token;
  if v_session_id is null then raise exception 'Token invalide'; end if;
  if not exists (select 1 from public.session_trainees where session_id = v_session_id and trainee_id = p_trainee_id) then
    raise exception 'Stagiaire non trouvé dans cette session';
  end if;
  if exists (select 1 from public.trainee_evaluations e
              where e.session_id = v_session_id and e.trainee_id = p_trainee_id and coalesce(e.questionnaire_submitted, false)) then
    raise exception 'Votre évaluation est déjà enregistrée : merci de votre réponse' using errcode = '23505';
  end if;

  insert into public.trainee_evaluations (
    session_id, trainee_id, q_org_documents, q_org_accueil, q_org_locaux, q_org_materiel,
    q_contenu_organisation, q_contenu_supports, q_contenu_duree, q_contenu_programme,
    q_formateur_pedagogie, q_formateur_expertise, q_formateur_progression, q_formateur_moyens,
    q_global_adequation, q_global_competences, would_recommend, comment_general, comment_projet,
    questionnaire_submitted, submitted_at, submitted_online
  ) values (
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
  on conflict (session_id, trainee_id)
  do update set
    q_org_documents = excluded.q_org_documents, q_org_accueil = excluded.q_org_accueil,
    q_org_locaux = excluded.q_org_locaux, q_org_materiel = excluded.q_org_materiel,
    q_contenu_organisation = excluded.q_contenu_organisation, q_contenu_supports = excluded.q_contenu_supports,
    q_contenu_duree = excluded.q_contenu_duree, q_contenu_programme = excluded.q_contenu_programme,
    q_formateur_pedagogie = excluded.q_formateur_pedagogie, q_formateur_expertise = excluded.q_formateur_expertise,
    q_formateur_progression = excluded.q_formateur_progression, q_formateur_moyens = excluded.q_formateur_moyens,
    q_global_adequation = excluded.q_global_adequation, q_global_competences = excluded.q_global_competences,
    would_recommend = excluded.would_recommend, comment_general = excluded.comment_general,
    comment_projet = excluded.comment_projet, questionnaire_submitted = true,
    submitted_at = now(), submitted_online = true
  returning to_json(public.trainee_evaluations.*) into v_result;

  return v_result;
end
$$;
revoke all on function public.save_evaluation(text, uuid, jsonb) from public;
grant execute on function public.save_evaluation(text, uuid, jsonb) to anon, authenticated;

insert into public.schema_migrations (version) values ('0481_evaluations_figees') on conflict (version) do nothing;

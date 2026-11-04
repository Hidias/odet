-- Retour arrière de 0487 : copie automatique, reprise manuelle, contrôle unique ; ent_demander revient à 0046 et
-- ent_besoin_enregistrer à 0486. Les besoins déjà rangés dans les demandes restent dans leur payload.
drop trigger if exists zz_besoin_session_creee on public.sessions;
drop function if exists app.besoin_session_creee();
drop function if exists public.besoin_reprendre_demande(uuid, uuid);
drop function if exists app.besoin_copier(uuid, uuid);

create or replace function public.ent_demander(p_kind text, p_message text default null, p_session uuid default null,
                                               p_course uuid default null, p_payload jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
  v_id uuid;
  v_client text;
begin
  if p_kind not in ('inscription_inter', 'demande_intra', 'remplacement', 'message') then
    raise exception 'Type de demande inconnu' using errcode = '22023';
  end if;
  if p_kind = 'inscription_inter' then
    if not v.can_register then raise exception 'Ce compte ne peut pas inscrire de salariés' using errcode = '42501'; end if;
    if not exists (select 1 from public.sessions s where s.id = p_session and s.company_id = v.company_id and s.session_type = 'inter'
                   and coalesce(s.is_public, false) and s.start_date >= current_date) then
      raise exception 'Session inter introuvable ou fermée' using errcode = '22023';
    end if;
  elsif p_kind = 'remplacement' then
    if not exists (select 1 from public.sessions s left join public.session_groups g on g.session_id = s.id and g.client_id = v.client_id
                   where s.id = p_session and (s.client_id = v.client_id or g.id is not null)) then
      raise exception 'Session introuvable' using errcode = '22023';
    end if;
  elsif p_session is not null then
    raise exception 'Session inattendue pour ce type de demande' using errcode = '22023';
  end if;
  if p_course is not null and not exists (select 1 from public.courses co where co.id = p_course and co.company_id = v.company_id) then
    raise exception 'Formation introuvable' using errcode = '22023';
  end if;
  if length(coalesce(p_message, '')) > 4000 or length(coalesce(p_payload, '{}'::jsonb)::text) > 20000 then
    raise exception 'Demande trop longue' using errcode = '22023';
  end if;

  insert into public.client_requests (company_id, client_id, account_id, kind, session_id, course_id, message, payload)
  values (v.company_id, v.client_id, v.id, p_kind, p_session, p_course, nullif(btrim(p_message), ''), coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;

  select c.name into v_client from public.clients c where c.id = v.client_id;
  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (v.company_id, 'demande_entreprise',
          'Demande de ' || coalesce(v_client, 'un client'),
          case p_kind when 'inscription_inter' then 'Inscription à une session inter' when 'demande_intra' then 'Demande de formation intra'
                      when 'remplacement' then 'Remplacement d''un salarié' else 'Message' end,
          '/espace-entreprise', jsonb_build_object('client_id', v.client_id, 'request_id', v_id));
  return v_id;
end
$$;

create or replace function public.ent_besoin_enregistrer(p_session uuid, p_reponses jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
  s public.sessions;
  a public.session_needs_analysis;
  v_raisons text[];
  v_profils text[];
  v_nb integer;
  v_niveau text;
  v_objectifs text;
  v_psh boolean;
  v_contact text;
  v_equip boolean;
  v_epi boolean;
  v_message text;
  v_notif uuid;
begin
  select * into s from public.sessions where id = p_session and client_id = v.client_id;
  if s.id is null or coalesce(s.session_type, 'intra') <> 'intra' or coalesce(s.status, '') in ('cancelled', 'annulee', 'annule') then
    raise exception 'Session inconnue pour ce client' using errcode = '42501';
  end if;
  if s.end_date is null or s.end_date < public.paris_today() then raise exception 'Session terminée' using errcode = '22023'; end if;
  if p_reponses is null or jsonb_typeof(p_reponses) <> 'object' then raise exception 'Réponses invalides' using errcode = '22023'; end if;

  -- Ligne verrouillée : une validation ou une saisie de l'organisme au même moment attend la fin de l'envoi
  select * into a from public.session_needs_analysis where session_id = s.id for update;
  if a.org_validated_at is not null then
    raise exception 'Analyse déjà validée par votre organisme : pour un changement, contactez-le' using errcode = '22023';
  end if;
  if a.filled_at is not null and a.client_submitted_at is null then
    raise exception 'Analyse déjà réalisée avec votre organisme : pour un changement, contactez-le' using errcode = '22023';
  end if;
  -- L'organisme a repris l'analyse après l'envoi : ses corrections ne s'écrasent pas
  if a.filled_at is not null and a.filled_at > a.client_submitted_at then
    raise exception 'Votre organisme a complété l''analyse : pour un changement, contactez-le' using errcode = '22023';
  end if;

  -- Listes fermées (mêmes valeurs que src/modules/formation/lib/besoinClient.js)
  if jsonb_typeof(coalesce(p_reponses -> 'context_reasons', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_reponses -> 'participants_profiles', '[]'::jsonb)) <> 'array' then
    raise exception 'Réponses invalides' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct r), '{}') into v_raisons from jsonb_array_elements_text(coalesce(p_reponses -> 'context_reasons', '[]'::jsonb)) r;
  if not v_raisons <@ array['reglementation', 'accident', 'renouvellement', 'nouveaux_embauches', 'evolution_risques', 'autre'] then
    raise exception 'Motif inconnu' using errcode = '22023';
  end if;
  if cardinality(v_raisons) = 0 then raise exception 'Indiquez au moins un motif de la formation' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct r), '{}') into v_profils from jsonb_array_elements_text(coalesce(p_reponses -> 'participants_profiles', '[]'::jsonb)) r;
  if not v_profils <@ array['administratif', 'production', 'terrain', 'encadrement'] then
    raise exception 'Profil inconnu' using errcode = '22023';
  end if;
  v_niveau := nullif(btrim(coalesce(p_reponses ->> 'level', '')), '');
  if v_niveau is not null and v_niveau not in ('debutant', 'intermediaire', 'avance') then
    raise exception 'Niveau inconnu' using errcode = '22023';
  end if;

  -- Nombre de participants (obligatoire)
  if coalesce(p_reponses ->> 'participants_count', '') !~ '^\s*[0-9]{1,3}\s*$' then
    raise exception 'Indiquez le nombre de participants' using errcode = '22023';
  end if;
  v_nb := (p_reponses ->> 'participants_count')::integer;
  if v_nb < 1 then raise exception 'Indiquez le nombre de participants' using errcode = '22023'; end if;

  -- Ce que l'entreprise attend de la formation (obligatoire)
  v_objectifs := app.besoin_texte(p_reponses, 'objectives_description', 2000);
  if v_objectifs is null then raise exception 'Décrivez ce que vous attendez de la formation' using errcode = '22023'; end if;

  -- Adaptation : oui ou non obligatoire ; si oui, une personne à contacter
  if jsonb_typeof(p_reponses -> 'psh_adaptation') is distinct from 'boolean' then
    raise exception 'Répondez à la question sur le besoin d''adaptation' using errcode = '22023';
  end if;
  v_psh := (p_reponses ->> 'psh_adaptation')::boolean;
  v_contact := app.besoin_texte(p_reponses, 'psh_contact', 200);
  if v_psh and v_contact is null then
    raise exception 'Indiquez la personne à contacter pour l''adaptation' using errcode = '22023';
  end if;
  if not v_psh then v_contact := null; end if;

  v_equip := case jsonb_typeof(p_reponses -> 'company_equipment') when 'boolean' then (p_reponses ->> 'company_equipment')::boolean end;
  v_epi := case jsonb_typeof(p_reponses -> 'ppe_provided') when 'boolean' then (p_reponses ->> 'ppe_provided')::boolean end;

  insert into public.session_needs_analysis (
    session_id, context_reasons, context_other, context_stakes, objectives_description, participants_count,
    participants_profiles, level, particularities_non_french, preferred_schedule, company_equipment,
    company_equipment_details, ppe_provided, other_constraints, psh_adaptation, psh_contact,
    analysis_date, client_submitted_at, client_submitted_by)
  values (
    s.id, v_raisons, case when 'autre' = any (v_raisons) then app.besoin_texte(p_reponses, 'context_other', 500) end,
    app.besoin_texte(p_reponses, 'context_stakes', 2000), v_objectifs, v_nb,
    v_profils, v_niveau, coalesce(p_reponses -> 'particularities_non_french' = 'true'::jsonb, false),
    app.besoin_texte(p_reponses, 'preferred_schedule', 500), v_equip,
    case when v_equip then app.besoin_texte(p_reponses, 'company_equipment_details', 1000) end, v_epi,
    app.besoin_texte(p_reponses, 'other_constraints', 2000), v_psh, v_contact,
    public.paris_today(), now(), (select auth.uid()))
  on conflict (session_id) do update set
    context_reasons = excluded.context_reasons, context_other = excluded.context_other,
    context_stakes = excluded.context_stakes, objectives_description = excluded.objectives_description,
    participants_count = excluded.participants_count, participants_profiles = excluded.participants_profiles,
    level = excluded.level, particularities_non_french = excluded.particularities_non_french,
    preferred_schedule = excluded.preferred_schedule, company_equipment = excluded.company_equipment,
    company_equipment_details = excluded.company_equipment_details, ppe_provided = excluded.ppe_provided,
    other_constraints = excluded.other_constraints, psh_adaptation = excluded.psh_adaptation,
    psh_contact = excluded.psh_contact, analysis_date = excluded.analysis_date,
    client_submitted_at = excluded.client_submitted_at, client_submitted_by = excluded.client_submitted_by, updated_at = now()
  where session_needs_analysis.org_validated_at is null
    and (session_needs_analysis.filled_at is null
         or (session_needs_analysis.client_submitted_at is not null and session_needs_analysis.filled_at <= session_needs_analysis.client_submitted_at));
  if not found then
    raise exception 'Analyse reprise par votre organisme entre-temps : pour un changement, contactez-le' using errcode = '22023';
  end if;

  -- Une seule notification par session tant qu'elle n'est pas lue : la dernière saisie la remplace
  v_message := coalesce((select c.name from public.clients c where c.id = v.client_id), 'Le client')
    || ' a rempli l''analyse du besoin de la session ' || coalesce(s.reference, '') || ' : à relire et valider.';
  select n.id into v_notif from public.notifications n
  where n.type = 'besoin_a_valider' and n.read_at is null and n.metadata ->> 'session_id' = s.id::text
  order by n.created_at desc limit 1;
  if v_notif is not null then
    update public.notifications set message = v_message, created_at = now() where id = v_notif;
  else
    insert into public.notifications (company_id, type, title, message, link, metadata)
    values (s.company_id, 'besoin_a_valider', 'Analyse du besoin à valider', v_message,
      '/sessions/' || s.id, jsonb_build_object('session_id', s.id));
  end if;

  return jsonb_build_object('success', true);
end
$$;
revoke all on function public.ent_besoin_enregistrer(uuid, jsonb) from public, anon;
grant execute on function public.ent_besoin_enregistrer(uuid, jsonb) to authenticated;

drop function if exists app.besoin_texte_tableau(jsonb, text);
drop function if exists app.besoin_normaliser(jsonb);
delete from public.schema_migrations where version = '0487_besoin_demande_intra';

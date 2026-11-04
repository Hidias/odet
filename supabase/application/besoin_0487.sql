-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (besoin_0487) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0487_besoin_demande_intra.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0487_besoin_demande_intra_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0487_besoin_demande_intra.sql =====
-- 0487 : analyse du besoin dès la demande « Formation intra » de l'espace entreprise (option B choisie par H le 04/11,
-- en complément de 0486).
--  1. app.besoin_normaliser() : contrôle unique des réponses de l'entreprise (motifs, profils et niveaux en listes
--     fermées, nombre de participants, attentes, adaptation oui ou non avec une personne à contacter, longueurs).
--     ent_besoin_enregistrer (0486) l'utilise désormais : mêmes règles, mêmes messages.
--  2. ent_demander : une demande « Formation intra » peut porter le besoin (payload.besoin), contrôlé et rangé
--     normalisé. Facultatif : la demande part aussi sans.
--  3. À la création d'une session intra non annulée, si le client a exactement une demande intra ouverte (nouvelle
--     ou en cours) de moins de 6 mois, avec un besoin, pas encore reliée à une session et pour la même formation, le
--     besoin est recopié dans l'analyse de la session (envoyé par l'entreprise à la date de la demande, date
--     d'analyse au jour de la copie, à valider par l'organisme) et la demande est reliée à la session
--     (client_requests.session_id). Sinon (demande sans formation, plusieurs demandes) : rien n'est recopié,
--     l'organisme choisit dans la fiche de session (besoin_reprendre_demande, demandes ouvertes seulement). Une
--     erreur de copie ne bloque jamais la création de la session.
-- Rien ne part par e-mail. Additive. Idempotente. Retour arrière : supabase/rollback/0487_besoin_demande_intra_retour.sql

-- ── 1. Contrôle unique des réponses ──
create or replace function app.besoin_normaliser(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_raisons text[];
  v_profils text[];
  v_nb integer;
  v_niveau text;
  v_objectifs text;
  v_psh boolean;
  v_contact text;
  v_equip boolean;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Réponses invalides' using errcode = '22023'; end if;
  -- Listes fermées (mêmes valeurs que src/modules/formation/lib/besoinClient.js)
  if jsonb_typeof(coalesce(p -> 'context_reasons', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p -> 'participants_profiles', '[]'::jsonb)) <> 'array' then
    raise exception 'Réponses invalides' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct r order by r), '{}') into v_raisons from jsonb_array_elements_text(coalesce(p -> 'context_reasons', '[]'::jsonb)) r;
  if not v_raisons <@ array['reglementation', 'accident', 'renouvellement', 'nouveaux_embauches', 'evolution_risques', 'autre'] then
    raise exception 'Motif inconnu' using errcode = '22023';
  end if;
  if cardinality(v_raisons) = 0 then raise exception 'Indiquez au moins un motif de la formation' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct r order by r), '{}') into v_profils from jsonb_array_elements_text(coalesce(p -> 'participants_profiles', '[]'::jsonb)) r;
  if not v_profils <@ array['administratif', 'production', 'terrain', 'encadrement'] then
    raise exception 'Profil inconnu' using errcode = '22023';
  end if;
  v_niveau := nullif(btrim(coalesce(p ->> 'level', '')), '');
  if v_niveau is not null and v_niveau not in ('debutant', 'intermediaire', 'avance') then
    raise exception 'Niveau inconnu' using errcode = '22023';
  end if;

  -- Nombre de participants (obligatoire)
  if coalesce(p ->> 'participants_count', '') !~ '^\s*[0-9]{1,3}\s*$' then
    raise exception 'Indiquez le nombre de participants' using errcode = '22023';
  end if;
  v_nb := (p ->> 'participants_count')::integer;
  if v_nb < 1 then raise exception 'Indiquez le nombre de participants' using errcode = '22023'; end if;

  -- Ce que l'entreprise attend de la formation (obligatoire)
  v_objectifs := app.besoin_texte(p, 'objectives_description', 2000);
  if v_objectifs is null then raise exception 'Décrivez ce que vous attendez de la formation' using errcode = '22023'; end if;

  -- Adaptation : oui ou non obligatoire ; si oui, une personne à contacter ; jamais de détail de santé
  if jsonb_typeof(p -> 'psh_adaptation') is distinct from 'boolean' then
    raise exception 'Répondez à la question sur le besoin d''adaptation' using errcode = '22023';
  end if;
  v_psh := (p ->> 'psh_adaptation')::boolean;
  v_contact := app.besoin_texte(p, 'psh_contact', 200);
  if v_psh and v_contact is null then
    raise exception 'Indiquez la personne à contacter pour l''adaptation' using errcode = '22023';
  end if;
  if not v_psh then v_contact := null; end if;

  v_equip := case jsonb_typeof(p -> 'company_equipment') when 'boolean' then (p ->> 'company_equipment')::boolean end;

  return jsonb_build_object(
    'context_reasons', to_jsonb(v_raisons),
    'context_other', case when 'autre' = any (v_raisons) then app.besoin_texte(p, 'context_other', 500) end,
    'context_stakes', app.besoin_texte(p, 'context_stakes', 2000),
    'objectives_description', v_objectifs,
    'participants_count', v_nb,
    'participants_profiles', to_jsonb(v_profils),
    'level', v_niveau,
    'particularities_non_french', coalesce(p -> 'particularities_non_french' = 'true'::jsonb, false),
    'preferred_schedule', app.besoin_texte(p, 'preferred_schedule', 500),
    'company_equipment', v_equip,
    'company_equipment_details', case when v_equip then app.besoin_texte(p, 'company_equipment_details', 1000) end,
    'ppe_provided', case jsonb_typeof(p -> 'ppe_provided') when 'boolean' then (p ->> 'ppe_provided')::boolean end,
    'other_constraints', app.besoin_texte(p, 'other_constraints', 2000),
    'psh_adaptation', v_psh,
    'psh_contact', v_contact);
end
$$;
revoke all on function app.besoin_normaliser(jsonb) from public, anon, authenticated;

-- Écriture des réponses normalisées dans l'analyse d'une session (insertion seulement : l'appelant a vérifié qu'elle
-- n'existe pas, ou passe par ent_besoin_enregistrer pour une mise à jour)
create or replace function app.besoin_texte_tableau(p jsonb, p_cle text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(select jsonb_array_elements_text(coalesce(p -> p_cle, '[]'::jsonb))), '{}'::text[])
$$;
revoke all on function app.besoin_texte_tableau(jsonb, text) from public, anon;
grant execute on function app.besoin_texte_tableau(jsonb, text) to authenticated;

-- ── ent_besoin_enregistrer (0486) sur le contrôle unique ──
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
  n jsonb;
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

  n := app.besoin_normaliser(p_reponses);

  insert into public.session_needs_analysis (
    session_id, context_reasons, context_other, context_stakes, objectives_description, participants_count,
    participants_profiles, level, particularities_non_french, preferred_schedule, company_equipment,
    company_equipment_details, ppe_provided, other_constraints, psh_adaptation, psh_contact,
    analysis_date, client_submitted_at, client_submitted_by)
  values (
    s.id, app.besoin_texte_tableau(n, 'context_reasons'), n ->> 'context_other', n ->> 'context_stakes',
    n ->> 'objectives_description', (n ->> 'participants_count')::integer, app.besoin_texte_tableau(n, 'participants_profiles'),
    n ->> 'level', (n ->> 'particularities_non_french')::boolean, n ->> 'preferred_schedule', (n ->> 'company_equipment')::boolean,
    n ->> 'company_equipment_details', (n ->> 'ppe_provided')::boolean, n ->> 'other_constraints',
    (n ->> 'psh_adaptation')::boolean, n ->> 'psh_contact',
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
  select n2.id into v_notif from public.notifications n2
  where n2.type = 'besoin_a_valider' and n2.read_at is null and n2.metadata ->> 'session_id' = s.id::text
  order by n2.created_at desc limit 1;
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

-- ── 2. Demande « Formation intra » avec le besoin ──
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
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if p_kind not in ('inscription_inter', 'demande_intra', 'remplacement', 'message') then
    raise exception 'Type de demande inconnu' using errcode = '22023';
  end if;
  if jsonb_typeof(v_payload) <> 'object' then raise exception 'Demande invalide' using errcode = '22023'; end if;
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
  -- 0487 : le besoin n'accompagne qu'une demande intra ; il est contrôlé et rangé normalisé
  if v_payload ? 'besoin' then
    if p_kind <> 'demande_intra' then
      v_payload := v_payload - 'besoin';
    elsif jsonb_typeof(v_payload -> 'besoin') = 'null' then
      v_payload := v_payload - 'besoin';
    else
      v_payload := jsonb_set(v_payload, '{besoin}', app.besoin_normaliser(v_payload -> 'besoin'));
    end if;
  end if;
  if length(coalesce(p_message, '')) > 4000 or length(v_payload::text) > 20000 then
    raise exception 'Demande trop longue' using errcode = '22023';
  end if;

  insert into public.client_requests (company_id, client_id, account_id, kind, session_id, course_id, message, payload)
  values (v.company_id, v.client_id, v.id, p_kind, p_session, p_course, nullif(btrim(p_message), ''), v_payload)
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
revoke all on function public.ent_demander(text, text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.ent_demander(text, text, uuid, uuid, jsonb) to authenticated;

-- ── 3. Copie du besoin d'une demande dans l'analyse d'une session ──
-- Sans droits propres : exécutée avec les droits de l'appelant (règles d'accès de l'organisme pour la reprise
-- manuelle, propriétaire pour le déclencheur)
create or replace function app.besoin_copier(p_session uuid, p_request uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  s public.sessions;
  r public.client_requests;
  n jsonb;
begin
  select * into s from public.sessions where id = p_session;
  if s.id is null or s.client_id is null or coalesce(s.session_type, 'intra') <> 'intra' then
    raise exception 'Session intra introuvable' using errcode = '22023';
  end if;
  select * into r from public.client_requests where id = p_request for update;
  if r.id is null or r.kind <> 'demande_intra' or r.client_id <> s.client_id or r.company_id <> s.company_id
     or jsonb_typeof(r.payload -> 'besoin') is distinct from 'object' then
    raise exception 'Demande sans besoin pour ce client' using errcode = '22023';
  end if;
  if r.status not in ('nouvelle', 'en_cours') then
    raise exception 'Demande déjà traitée ou refusée' using errcode = '22023';
  end if;
  if r.session_id is not null and r.session_id <> s.id then
    raise exception 'Demande déjà reliée à une autre session' using errcode = '22023';
  end if;
  if exists (select 1 from public.session_needs_analysis where session_id = s.id) then
    raise exception 'Analyse du besoin déjà commencée pour cette session' using errcode = '22023';
  end if;
  n := r.payload -> 'besoin';
  insert into public.session_needs_analysis (
    session_id, context_reasons, context_other, context_stakes, objectives_description, participants_count,
    participants_profiles, level, particularities_non_french, preferred_schedule, company_equipment,
    company_equipment_details, ppe_provided, other_constraints, psh_adaptation, psh_contact,
    analysis_date, client_submitted_at, client_submitted_by)
  values (
    s.id, app.besoin_texte_tableau(n, 'context_reasons'), n ->> 'context_other', n ->> 'context_stakes',
    n ->> 'objectives_description', (n ->> 'participants_count')::integer, app.besoin_texte_tableau(n, 'participants_profiles'),
    n ->> 'level', coalesce((n ->> 'particularities_non_french')::boolean, false), n ->> 'preferred_schedule',
    (n ->> 'company_equipment')::boolean, n ->> 'company_equipment_details', (n ->> 'ppe_provided')::boolean,
    n ->> 'other_constraints', (n ->> 'psh_adaptation')::boolean, n ->> 'psh_contact',
    public.paris_today(), r.created_at,
    (select a.profile_id from public.client_accounts a where a.id = r.account_id));
  update public.client_requests set session_id = s.id where id = r.id;
  if not found then raise exception 'Demande non modifiable' using errcode = '42501'; end if;
end
$$;
revoke all on function app.besoin_copier(uuid, uuid) from public, anon;
grant execute on function app.besoin_copier(uuid, uuid) to authenticated;

-- Reprise choisie par l'organisme dans la fiche de session (droits de l'appelant)
create or replace function public.besoin_reprendre_demande(p_session uuid, p_request uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sessions where id = p_session) then
    raise exception 'Session introuvable' using errcode = '42501';
  end if;
  perform app.besoin_copier(p_session, p_request);
  return jsonb_build_object('success', true);
end
$$;
revoke all on function public.besoin_reprendre_demande(uuid, uuid) from public, anon;
grant execute on function public.besoin_reprendre_demande(uuid, uuid) to authenticated;

-- Copie automatique à la création d'une session intra : une seule demande possible, sinon rien
create or replace function app.besoin_session_creee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_ids uuid[];
begin
  if new.client_id is null or coalesce(new.session_type, 'intra') <> 'intra'
     or coalesce(new.status, '') in ('cancelled', 'annulee', 'annule') or new.course_id is null then return null; end if;
  select array_agg(r.id) into v_ids from public.client_requests r
  where r.kind = 'demande_intra' and r.client_id = new.client_id and r.company_id = new.company_id
    and r.session_id is null and r.status in ('nouvelle', 'en_cours')
    and jsonb_typeof(r.payload -> 'besoin') = 'object'
    and r.course_id = new.course_id and r.created_at > now() - interval '6 months';
  if cardinality(v_ids) = 1 then
    begin
      perform app.besoin_copier(new.id, v_ids[1]);
    exception when others then
      raise warning 'Analyse du besoin non recopiée pour la session % : %', new.reference, sqlerrm;
    end;
  end if;
  return null;
end
$$;

drop trigger if exists zz_besoin_session_creee on public.sessions;
create trigger zz_besoin_session_creee after insert on public.sessions
  for each row execute function app.besoin_session_creee();

insert into public.schema_migrations (version) values ('0487_besoin_demande_intra') on conflict (version) do nothing;

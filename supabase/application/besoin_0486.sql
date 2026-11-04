-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (besoin_0486) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0486_besoin_espace_client.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0486_besoin_espace_client_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0486_besoin_espace_client.sql =====
-- 0486 : analyse du besoin remplie depuis l'espace entreprise (option A choisie par H le 04/11).
-- Qualiopi, indicateur 4 (décret n° 2026-728) : « Le prestataire analyse le besoin du bénéficiaire en lien avec
-- l'entreprise et/ou le financeur concerné(s) ». Guide de lecture V10 (novembre 2026), niveau attendu : « Démontrer
-- comment le besoin du bénéficiaire est analysé en fonction de la finalité de la prestation » ; obligation
-- spécifique handicap : prise en compte des situations de handicap et des besoins de compensation.
-- Donc : l'entreprise renseigne son besoin sur chaque session intra de son espace, l'organisme le relit, écrit son
-- analyse et valide. Seule une analyse validée (ou faite par l'organisme lui-même) compte comme preuve.
--  1. Colonnes sur session_needs_analysis : envoi par l'entreprise (date, compte), besoin d'adaptation oui ou non et
--     personne à contacter (jamais le détail de santé : il reste entre le stagiaire et le référent handicap),
--     analyse de l'organisme, validation (date, auteur).
--  2. Garde : une validation exige l'analyse de l'organisme ; date et auteur posés par la base ; une analyse validée
--     ne change plus sans être rouverte ; l'origine « entreprise » d'une réponse ne s'efface pas.
--  3. ent_besoins() : sessions intra du client avec l'état de leur analyse et les réponses de l'entreprise.
--     ent_besoin_enregistrer() : enregistre les réponses (date d'analyse = jour d'envoi, heure de Paris) tant que
--     l'organisme n'a ni validé ni repris l'analyse, ligne verrouillée, puis notifie l'organisme (une seule
--     notification non lue par session).
-- Aucun accès direct à la table pour le compte entreprise (principe de 0046). Additive. Idempotente.
-- Retour arrière : supabase/rollback/0486_besoin_espace_client_retour.sql

-- ── 1. Colonnes ──
alter table public.session_needs_analysis
  add column if not exists client_submitted_at timestamptz,
  add column if not exists client_submitted_by uuid,
  add column if not exists psh_adaptation boolean,
  add column if not exists psh_contact text,
  add column if not exists org_conclusion text,
  add column if not exists org_validated_at timestamptz,
  add column if not exists org_validated_by uuid;

comment on column public.session_needs_analysis.client_submitted_at is 'Réponses envoyées par l''entreprise depuis son espace (0486)';
comment on column public.session_needs_analysis.psh_adaptation is 'Un participant a-t-il besoin d''une adaptation ? Oui ou non seulement, sans détail de santé (0486)';
comment on column public.session_needs_analysis.psh_contact is 'Personne à contacter pour l''adaptation (nom, téléphone ou e-mail), sans détail de santé (0486)';
comment on column public.session_needs_analysis.org_conclusion is 'Analyse de l''organisme : ce qu''il retient du besoin et les adaptations prévues (0486)';
comment on column public.session_needs_analysis.org_validated_at is 'Analyse validée par l''organisme (0486) : preuve de l''indicateur 4';

-- ── 2. Garde de validation ──
create or replace function app.besoin_validation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- colonnes qui ne changent pas le contenu de l'analyse (traces, signatures, validation elle-même)
  v_hors text[] := array['updated_at', 'filled_at', 'filled_by', 'signature_client', 'signature_trainer', 'signed_at',
                         'org_validated_at', 'org_validated_by'];
begin
  -- Réponses de l'entreprise : leur date et leur auteur ne s'effacent pas (une réponse non validée ne devient
  -- pas une preuve en effaçant son origine)
  if tg_op = 'UPDATE' and old.client_submitted_at is not null and new.client_submitted_at is null then
    raise exception 'Les réponses envoyées par l''entreprise gardent leur date d''envoi' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.client_submitted_by is not null and new.client_submitted_by is distinct from old.client_submitted_by
     and new.client_submitted_at is not distinct from old.client_submitted_at then
    new.client_submitted_by := old.client_submitted_by;
  end if;

  -- Reprise par l'organisme datée par le serveur, jamais par l'horloge de l'ordinateur (comparée à l'envoi de
  -- l'entreprise) ; à l'insertion, la copie d'une analyse prospect garde sa date
  if tg_op = 'UPDATE' and new.filled_at is not null and new.filled_at is distinct from old.filled_at then
    new.filled_at := now();
  end if;

  if new.org_validated_at is null then
    new.org_validated_by := null;
    return new;
  end if;
  if tg_op = 'INSERT' or old.org_validated_at is null then
    if length(btrim(coalesce(new.org_conclusion, ''))) = 0 then
      raise exception 'Écrivez l''analyse de l''organisme avant de valider' using errcode = '22023';
    end if;
    -- date et auteur posés par la base, jamais par l'écran
    new.org_validated_at := now();
    new.org_validated_by := (select auth.uid());
  else
    -- validation déjà posée : sa date et son auteur ne se réécrivent pas, le contenu ne change plus
    new.org_validated_at := old.org_validated_at;
    new.org_validated_by := old.org_validated_by;
    if (to_jsonb(new) - v_hors) is distinct from (to_jsonb(old) - v_hors) then
      raise exception 'Analyse validée : rouvrez-la avant de la modifier' using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists besoin_validation on public.session_needs_analysis;
create trigger besoin_validation before insert or update on public.session_needs_analysis
  for each row execute function app.besoin_validation();

-- ── 3. Espace entreprise ──
-- Texte facultatif nettoyé, refusé au-delà de la longueur permise
create or replace function app.besoin_texte(p jsonb, p_cle text, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare v text := nullif(btrim(coalesce(p ->> p_cle, '')), '');
begin
  if v is not null and length(v) > p_max then
    raise exception 'Texte trop long (% caractères au plus)', p_max using errcode = '22023';
  end if;
  return v;
end
$$;
revoke all on function app.besoin_texte(jsonb, text, integer) from public, anon, authenticated;

create or replace function public.ent_besoins()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  return coalesce((
    select jsonb_agg(x.j order by x.d)
    from (
      select s.start_date as d, jsonb_build_object(
        'session_id', s.id,
        'reference', s.reference,
        'formation', c.title,
        'start_date', s.start_date,
        'end_date', s.end_date,
        'etat', case
          when a.org_validated_at is not null then 'validee'
          when a.client_submitted_at is not null then 'a_valider'
          when a.filled_at is not null then 'organisme'
          else 'a_completer' end,
        'modifiable', s.end_date >= public.paris_today() and a.org_validated_at is null
                      and not (a.filled_at is not null and (a.client_submitted_at is null or a.filled_at > a.client_submitted_at)),
        'envoyee_le', a.client_submitted_at,
        'validee_le', a.org_validated_at,
        'reponses', case when a.client_submitted_at is null then null else jsonb_build_object(
          'context_reasons', to_jsonb(coalesce(a.context_reasons, '{}'::text[])),
          'context_other', a.context_other,
          'context_stakes', a.context_stakes,
          'objectives_description', a.objectives_description,
          'participants_count', a.participants_count,
          'participants_profiles', to_jsonb(coalesce(a.participants_profiles, '{}'::text[])),
          'level', a.level,
          'particularities_non_french', a.particularities_non_french,
          'preferred_schedule', a.preferred_schedule,
          'company_equipment', a.company_equipment,
          'company_equipment_details', a.company_equipment_details,
          'ppe_provided', a.ppe_provided,
          'other_constraints', a.other_constraints,
          'psh_adaptation', a.psh_adaptation,
          'psh_contact', a.psh_contact) end) as j
      from public.sessions s
      left join public.courses c on c.id = s.course_id
      left join public.session_needs_analysis a on a.session_id = s.id
      where s.client_id = v.client_id
        and coalesce(s.session_type, 'intra') = 'intra'
        and coalesce(s.status, '') not in ('cancelled', 'annulee', 'annule')
        and s.end_date is not null
        and (s.end_date >= public.paris_today() or a.client_submitted_at is not null)
    ) x
  ), '[]'::jsonb);
end
$$;
revoke all on function public.ent_besoins() from public, anon;
grant execute on function public.ent_besoins() to authenticated;

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

insert into public.schema_migrations (version) values ('0486_besoin_espace_client') on conflict (version) do nothing;

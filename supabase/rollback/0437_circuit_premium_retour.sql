-- Retour arrière de 0437_circuit_premium.sql. Idempotent. Les sessions supplémentaires et les fiches complétées restent.
drop function if exists public.circuit_relance_marquer(uuid, text, text);
drop function if exists public.circuit_relances_dues();
drop function if exists public.session_ajouter_depuis_devis(uuid, jsonb);
drop function if exists public.session_confirmer(uuid, jsonb);
drop function if exists app.session_appliquer(uuid, jsonb);
drop function if exists public.participant_attente_decider(uuid, uuid, boolean);
drop function if exists public.ent_salaries_connus();
drop function if exists public.client_portal_salaries_connus(text, text);
drop function if exists app.salaries_du_client(uuid, uuid[]);
-- Versions de 0435
CREATE OR REPLACE FUNCTION app.participants_etat(p_client uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'session_id', s.id,
    'validation_requise', s.validation_requise,
    'devis', s.quote_id is not null,
    'devis_signe', q.id is not null and q.status in ('accepted', 'partial', 'invoiced'),
    'ouvert', q.id is not null and q.status in ('accepted', 'partial', 'invoiced') and not s.validation_requise
              and not coalesce(s.convention_signed, false) and s.end_date >= current_date,
    'raison', case
      when s.quote_id is null then null
      when q.status not in ('accepted', 'partial', 'invoiced') then 'Le devis doit d''abord être signé.'
      when s.validation_requise then 'Votre organisme confirme les dates de la session : vous pourrez ensuite saisir vos participants.'
      when coalesce(s.convention_signed, false) then 'Convention signée : pour un changement, contactez votre organisme.'
      when s.end_date < current_date then 'Session terminée.'
      else null end,
    'places', coalesce(s.max_participants, 10),
    'saisis_le', s.participants_saisis_le,
    'participants', coalesce((select jsonb_agg(jsonb_build_object('trainee_id', t.id, 'first_name', t.first_name, 'last_name', t.last_name,
                                  'nom_naissance', t.nom_naissance, 'email', t.email, 'birth_date', t.birth_date, 'birth_place', t.birth_place,
                                  'job_title', t.job_title, 'ssn_present', coalesce(t.ssn_present, false))
                                order by t.last_name, t.first_name)
                              from public.session_trainees st join public.trainees t on t.id = st.trainee_id
                              where st.session_id = s.id and t.client_id = p_client), '[]'::jsonb)
  ) order by s.start_date desc), '[]'::jsonb)
  from public.sessions s
  left join public.quotes q on q.id = s.quote_id
  where s.client_id = p_client and coalesce(s.session_type, 'intra') <> 'inter'
$function$;
revoke all on function app.participants_etat(uuid) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION app.participants_enregistrer(p_client uuid, p_channel text, p_access uuid, p_profile uuid, p_session uuid, p_liste jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.sessions;
  q public.quotes;
  e jsonb;
  v_prenom text;
  v_nom text;
  v_naissance text;
  v_mail text;
  v_nir text;
  v_nir_brut text;
  v_ne_le date;
  v_ne_a text;
  v_poste text;
  v_tr uuid;
  v_gardes uuid[] := '{}';
  v_n int;
  v_cles text[] := '{}';
  v_cle text;
  v_retire record;
  v_notif uuid;
  v_message text;
begin
  select * into s from public.sessions where id = p_session and client_id = p_client;
  if s.id is null then raise exception 'Session inconnue pour ce client' using errcode = '42501'; end if;
  select * into q from public.quotes where id = s.quote_id;
  if q.id is null or q.status not in ('accepted', 'partial', 'invoiced') then raise exception 'Le devis doit d''abord être signé' using errcode = '22023'; end if;
  if s.validation_requise then raise exception 'Votre organisme confirme d''abord les dates de la session' using errcode = '22023'; end if;
  if coalesce(s.convention_signed, false) then raise exception 'Convention signée : pour un changement, contactez votre organisme' using errcode = '22023'; end if;
  if s.end_date < current_date then raise exception 'Session terminée' using errcode = '22023'; end if;
  if p_liste is null or jsonb_typeof(p_liste) <> 'array' then raise exception 'Liste invalide' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_liste);
  if v_n > coalesce(s.max_participants, 10) then
    raise exception '% places au plus pour cette session', coalesce(s.max_participants, 10) using errcode = '22023';
  end if;

  for e in select * from jsonb_array_elements(p_liste) loop
    v_prenom := btrim(coalesce(e ->> 'first_name', ''));
    v_nom := btrim(coalesce(e ->> 'last_name', ''));
    v_mail := nullif(lower(btrim(coalesce(e ->> 'email', ''))), '');
    v_naissance := nullif(upper(btrim(coalesce(e ->> 'nom_naissance', ''))), '');
    v_nir_brut := nullif(btrim(coalesce(e ->> 'ssn', '')), '');
    v_ne_a := nullif(btrim(coalesce(e ->> 'birth_place', '')), '');
    v_poste := nullif(btrim(coalesce(e ->> 'job_title', '')), '');
    if length(v_prenom) < 1 or length(v_prenom) > 100 or length(v_nom) < 1 or length(v_nom) > 100 then
      raise exception 'Nom et prénom de chaque participant requis' using errcode = '22023';
    end if;
    if v_prenom !~ '[[:alpha:]]' or v_nom !~ '[[:alpha:]]' then
      raise exception 'Nom ou prénom illisible : % %', v_prenom, v_nom using errcode = '22023';
    end if;
    if v_mail is not null and (length(v_mail) > 255 or v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
      raise exception 'Adresse e-mail invalide : %', v_mail using errcode = '22023';
    end if;
    if v_naissance is not null and (length(v_naissance) > 100 or v_naissance !~ '[[:alpha:]]') then
      raise exception 'Nom de naissance invalide pour % %', v_prenom, v_nom using errcode = '22023';
    end if;
    v_nir := null;
    if v_nir_brut is not null then
      v_nir := app.nir_complet(v_nir_brut);
      if v_nir is null then raise exception 'N° de sécurité sociale invalide pour % % : vérifiez-le ou laissez la case vide', v_prenom, v_nom using errcode = '22023'; end if;
    end if;
    v_ne_le := null;
    if nullif(e ->> 'birth_date', '') is not null then
      begin
        v_ne_le := (e ->> 'birth_date')::date;
      exception when others then
        raise exception 'Date de naissance invalide pour % %', v_prenom, v_nom using errcode = '22023';
      end;
      if v_ne_le < date '1930-01-01' or v_ne_le > current_date - interval '14 years' then
        raise exception 'Date de naissance invraisemblable pour % %', v_prenom, v_nom using errcode = '22023';
      end if;
    end if;
    if v_ne_a is not null and length(v_ne_a) > 100 then raise exception 'Lieu de naissance trop long' using errcode = '22023'; end if;
    if v_poste is not null and length(v_poste) > 255 then raise exception 'Poste trop long' using errcode = '22023'; end if;
    v_cle := lower(v_prenom) || '|' || lower(v_nom);
    if v_cle = any (v_cles) then raise exception 'Participant en double : % %', v_prenom, v_nom using errcode = '22023'; end if;
    v_cles := v_cles || v_cle;
    -- Déjà inscrit, puis salarié connu du client, sinon nouveau
    select t.id into v_tr from public.session_trainees st join public.trainees t on t.id = st.trainee_id
    where st.session_id = s.id and t.client_id = p_client and lower(t.first_name) = lower(v_prenom) and lower(t.last_name) = lower(v_nom) limit 1;
    if v_tr is null then
      select t.id into v_tr from public.trainees t
      where t.client_id = p_client and lower(t.first_name) = lower(v_prenom) and lower(t.last_name) = lower(v_nom) order by t.created_at limit 1;
    end if;
    if v_tr is null then
      insert into public.trainees (first_name, last_name, nom_naissance, email, birth_date, birth_place, job_title, social_security_number, client_id, company_id)
      values (v_prenom, upper(v_nom), coalesce(v_naissance, upper(v_nom)), v_mail, v_ne_le, v_ne_a, v_poste, v_nir, p_client, s.company_id)
      returning id into v_tr;
    else
      -- Ce que le client indique complète la fiche ; rien de vide n'efface ce qui est connu
      update public.trainees set
        email = coalesce(v_mail, email),
        nom_naissance = coalesce(v_naissance, nom_naissance, upper(v_nom)),
        birth_date = coalesce(v_ne_le, birth_date),
        birth_place = coalesce(v_ne_a, birth_place),
        job_title = coalesce(v_poste, job_title),
        social_security_number = case when v_nir is not null and not coalesce(refused_ssn, false) then v_nir else null end,
        updated_at = now()
      where id = v_tr;
    end if;
    if not exists (select 1 from public.session_trainees where session_id = s.id and trainee_id = v_tr) then
      insert into public.session_trainees (session_id, trainee_id) values (s.id, v_tr);
    end if;
    v_gardes := v_gardes || v_tr;
  end loop;

  -- Retirés de la liste : seulement s'ils n'ont encore rien signé ni rempli
  for v_retire in
    select st.id, st.trainee_id, t.first_name, t.last_name from public.session_trainees st join public.trainees t on t.id = st.trainee_id
    where st.session_id = s.id and t.client_id = p_client and not (st.trainee_id = any (v_gardes))
  loop
    if exists (select 1 from public.attendance_halfdays h where h.session_id = s.id and h.trainee_id = v_retire.trainee_id and (h.morning or h.afternoon))
       or exists (select 1 from public.trainee_evaluations ev where ev.session_id = s.id and ev.trainee_id = v_retire.trainee_id and coalesce(ev.questionnaire_submitted, false)) then
      raise exception '% % a déjà émargé ou répondu : contactez votre organisme', v_retire.first_name, v_retire.last_name using errcode = '22023';
    end if;
    delete from public.trainee_evaluations where session_id = s.id and trainee_id = v_retire.trainee_id;
    delete from public.trainee_info_sheets where session_id = s.id and trainee_id = v_retire.trainee_id;
    delete from public.session_trainees where id = v_retire.id;
  end loop;

  update public.sessions set participants_saisis_le = now() where id = s.id;
  insert into public.portal_events (company_id, client_id, channel, access_id, profile_id, event, object_type, object_id, document_label, ip, user_agent)
  values (s.company_id, p_client, p_channel, p_access, p_profile, 'participants', 'session', s.id, v_n || ' participant(s)',
    left(coalesce(app.audit_entete('x-forwarded-for'), app.audit_entete('x-real-ip')), 64), left(app.entete_complet('user-agent'), 400));

  -- Une seule notification par session tant qu'elle n'est pas lue : la dernière saisie la remplace
  v_message := coalesce((select c.name from public.clients c where c.id = p_client), 'Le client') || ' a saisi ' || v_n || ' participant(s) pour la session '
    || coalesce(s.reference, '') || '.';
  select n.id into v_notif from public.notifications n
  where n.type = 'participants_saisis' and n.read_at is null and n.metadata ->> 'session_id' = s.id::text
  order by n.created_at desc limit 1;
  if v_notif is not null then
    update public.notifications set message = v_message, created_at = now(), metadata = jsonb_build_object('session_id', s.id, 'nombre', v_n)
    where id = v_notif;
  else
    insert into public.notifications (company_id, type, title, message, link, metadata)
    values (s.company_id, 'participants_saisis', 'Participants saisis par le client', v_message, '/sessions/' || s.id,
      jsonb_build_object('session_id', s.id, 'nombre', v_n));
  end if;
  return jsonb_build_object('ok', true, 'nombre', v_n);
end
$function$;
revoke all on function app.participants_enregistrer(uuid, text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from public.session_places_attente) then drop table public.session_places_attente; end if;
  if not exists (select 1 from public.circuit_relances) then drop table public.circuit_relances; end if;
  if not exists (select 1 from public.sessions where places_supplementaires <> 0) then
    alter table public.sessions drop constraint if exists sessions_places_supplementaires_check;
    alter table public.sessions drop column if exists places_supplementaires;
  end if;
end $$;
delete from public.auto_send_switches where kind = 'relance_circuit';
alter table public.auto_send_switches drop constraint if exists auto_send_switches_kind_check;
alter table public.auto_send_switches add constraint auto_send_switches_kind_check
  check (kind in ('relance_recyclage', 'relance_devis', 'relance_facture', 'convocation', 'attestation', 'evaluation_froid',
                  'renouvellement_contrat', 'visite_hors_contrat', 'justificatif_prestataire'));
create or replace function app.envoi_auto_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['relance_recyclage', 'relance_devis', 'relance_facture', 'convocation', 'attestation', 'evaluation_froid',
               'renouvellement_contrat', 'visite_hors_contrat', 'justificatif_prestataire']
$$;
delete from public.schema_migrations where version = '0437_circuit_premium';

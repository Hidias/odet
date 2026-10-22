-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (circuit_premium_0437) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0437_circuit_premium.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0437_circuit_premium_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0437_circuit_premium.sql =====
-- 0437 : circuit de formation, retours de H du 22/10 (11 h 52).
--  1. Participants saisis par le client : genre (femme, homme, non genré) et nom de naissance remontent dans la fiche
--     du stagiaire, avec le reste (0435).
--  2. Places : maximum de la session et dépassement autorisé (0 par défaut). Au-delà du maximum, les participants
--     saisis par le client attendent l'accord de l'organisme (table session_places_attente) : ils ne sont inscrits
--     (convention, convocations, émargement) qu'une fois acceptés.
--  3. Confirmation d'une session préparée depuis un devis : dates, horaires, lieu, formateur, places et contact
--     contrôlés dans une fenêtre, puis enregistrés ensemble (public.session_confirmer) ; sessions supplémentaires
--     d'un même devis (« 2 sessions de 2 heures ») créées confirmées, une convention chacune (public.session_ajouter_depuis_devis).
--  4. Relances du client : participants non saisis à 10 jours, convention non signée à 7 jours (une fois chacune,
--     trace dans circuit_relances) ; envoi par /api/relances-circuit.
-- Migration additive (colonnes, tables, fonctions, règles). Idempotente.
-- Retour arrière : supabase/rollback/0437_circuit_premium_retour.sql

alter table public.sessions add column if not exists places_supplementaires int not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sessions_places_supplementaires_check') then
    alter table public.sessions add constraint sessions_places_supplementaires_check check (places_supplementaires between 0 and 20);
  end if;
end $$;

create table if not exists public.session_places_attente (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  trainee_id uuid not null references public.trainees (id) on delete cascade,
  client_id uuid references public.clients (id),
  statut text not null default 'attente' check (statut in ('attente', 'refuse')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  unique (session_id, trainee_id)
);
comment on table public.session_places_attente is 'Participants saisis par le client au-delà du maximum de la session, en attente de l''accord de l''organisme (0437)';

create table if not exists public.circuit_relances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  kind text not null check (kind in ('participants', 'convention')),
  sent_to text,
  sent_at timestamptz not null default now(),
  unique (session_id, kind)
);
comment on table public.circuit_relances is 'Relances envoyées au client pendant le circuit devis → session (0437), une par session et par objet';

-- ── 1 et 2. Participants ──
create or replace function app.participants_etat(p_client uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
    'places_supplementaires', coalesce(s.places_supplementaires, 0),
    'saisis_le', s.participants_saisis_le,
    'participants', coalesce((
      select jsonb_agg(x.j order by x.nom, x.prenom) from (
        select t.last_name nom, t.first_name prenom, jsonb_build_object('trainee_id', t.id, 'first_name', t.first_name, 'last_name', t.last_name,
          'nom_naissance', t.nom_naissance, 'gender', t.gender, 'email', t.email, 'birth_date', t.birth_date, 'birth_place', t.birth_place,
          'job_title', t.job_title, 'ssn_present', coalesce(t.ssn_present, false), 'statut', 'inscrit') j
        from public.session_trainees st join public.trainees t on t.id = st.trainee_id
        where st.session_id = s.id and t.client_id = p_client
        union all
        select t.last_name, t.first_name, jsonb_build_object('trainee_id', t.id, 'first_name', t.first_name, 'last_name', t.last_name,
          'nom_naissance', t.nom_naissance, 'gender', t.gender, 'email', t.email, 'birth_date', t.birth_date, 'birth_place', t.birth_place,
          'job_title', t.job_title, 'ssn_present', coalesce(t.ssn_present, false), 'statut', a.statut)
        from public.session_places_attente a join public.trainees t on t.id = a.trainee_id
        where a.session_id = s.id and t.client_id = p_client) x), '[]'::jsonb)
  ) order by s.start_date desc), '[]'::jsonb)
  from public.sessions s
  left join public.quotes q on q.id = s.quote_id
  where s.client_id = p_client and coalesce(s.session_type, 'intra') <> 'inter'
$$;
revoke all on function app.participants_etat(uuid) from public, anon, authenticated;

create or replace function app.participants_enregistrer(p_client uuid, p_channel text, p_access uuid, p_profile uuid, p_session uuid, p_liste jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.sessions;
  q public.quotes;
  e jsonb;
  v_prenom text;
  v_nom text;
  v_naissance text;
  v_genre text;
  v_mail text;
  v_nir text;
  v_nir_brut text;
  v_ne_le date;
  v_ne_a text;
  v_poste text;
  v_tr uuid;
  v_gardes uuid[] := '{}';
  v_n int;
  v_max int;
  v_plafond int;
  v_inscrits int := 0;
  v_attente int := 0;
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
  v_max := coalesce(s.max_participants, 10);
  v_plafond := v_max + coalesce(s.places_supplementaires, 0);
  if v_n > v_plafond then
    raise exception '% places au plus pour cette session', v_plafond using errcode = '22023';
  end if;

  for e in select * from jsonb_array_elements(p_liste) loop
    v_prenom := btrim(coalesce(e ->> 'first_name', ''));
    v_nom := btrim(coalesce(e ->> 'last_name', ''));
    v_mail := nullif(lower(btrim(coalesce(e ->> 'email', ''))), '');
    v_naissance := nullif(upper(btrim(coalesce(e ->> 'nom_naissance', ''))), '');
    v_genre := nullif(btrim(coalesce(e ->> 'gender', '')), '');
    v_nir_brut := nullif(btrim(coalesce(e ->> 'ssn', '')), '');
    v_ne_a := nullif(btrim(coalesce(e ->> 'birth_place', '')), '');
    v_poste := nullif(btrim(coalesce(e ->> 'job_title', '')), '');
    if length(v_prenom) < 1 or length(v_prenom) > 100 or length(v_nom) < 1 or length(v_nom) > 100 then
      raise exception 'Nom et prénom de chaque participant requis' using errcode = '22023';
    end if;
    if v_prenom !~ '[[:alpha:]]' or v_nom !~ '[[:alpha:]]' then
      raise exception 'Nom ou prénom illisible : % %', v_prenom, v_nom using errcode = '22023';
    end if;
    if v_genre is not null and v_genre not in ('female', 'male', 'non_binary') then
      raise exception 'Genre inconnu pour % %', v_prenom, v_nom using errcode = '22023';
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
    -- Déjà inscrit ou en attente, puis salarié connu du client, sinon nouveau
    select t.id into v_tr from public.trainees t
    where t.client_id = p_client and lower(t.first_name) = lower(v_prenom) and lower(t.last_name) = lower(v_nom)
    order by (exists (select 1 from public.session_trainees st where st.session_id = s.id and st.trainee_id = t.id)) desc,
             (exists (select 1 from public.session_places_attente a where a.session_id = s.id and a.trainee_id = t.id)) desc, t.created_at
    limit 1;
    if v_tr is null then
      insert into public.trainees (first_name, last_name, nom_naissance, gender, email, birth_date, birth_place, job_title, social_security_number, client_id, company_id)
      values (v_prenom, upper(v_nom), coalesce(v_naissance, upper(v_nom)), v_genre, v_mail, v_ne_le, v_ne_a, v_poste, v_nir, p_client, s.company_id)
      returning id into v_tr;
    else
      -- Ce que le client indique complète la fiche ; rien de vide n'efface ce qui est connu
      update public.trainees set
        email = coalesce(v_mail, email),
        nom_naissance = coalesce(v_naissance, nom_naissance, upper(v_nom)),
        gender = coalesce(v_genre, gender),
        birth_date = coalesce(v_ne_le, birth_date),
        birth_place = coalesce(v_ne_a, birth_place),
        job_title = coalesce(v_poste, job_title),
        social_security_number = case when v_nir is not null and not coalesce(refused_ssn, false) then v_nir else null end,
        updated_at = now()
      where id = v_tr;
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
  delete from public.session_places_attente a where a.session_id = s.id and a.client_id = p_client and not (a.trainee_id = any (v_gardes));

  -- Inscrits dans l'ordre de la liste et dans la limite du maximum ; au-delà, en attente de l'accord de l'organisme
  -- (un participant refusé reste refusé ; un participant accepté reste inscrit)
  foreach v_tr in array v_gardes loop
    if exists (select 1 from public.session_trainees where session_id = s.id and trainee_id = v_tr) then
      v_inscrits := v_inscrits + 1;
    elsif exists (select 1 from public.session_places_attente where session_id = s.id and trainee_id = v_tr) then
      v_attente := v_attente + 1;
    elsif (select count(*) from public.session_trainees where session_id = s.id) < v_max then
      insert into public.session_trainees (session_id, trainee_id) values (s.id, v_tr);
      v_inscrits := v_inscrits + 1;
    else
      insert into public.session_places_attente (company_id, session_id, trainee_id, client_id) values (s.company_id, s.id, v_tr, p_client);
      v_attente := v_attente + 1;
    end if;
  end loop;

  update public.sessions set participants_saisis_le = now() where id = s.id;
  insert into public.portal_events (company_id, client_id, channel, access_id, profile_id, event, object_type, object_id, document_label, ip, user_agent)
  values (s.company_id, p_client, p_channel, p_access, p_profile, 'participants', 'session', s.id, v_n || ' participant(s)',
    left(coalesce(app.audit_entete('x-forwarded-for'), app.audit_entete('x-real-ip')), 64), left(app.entete_complet('user-agent'), 400));

  -- Une seule notification par session tant qu'elle n'est pas lue : la dernière saisie la remplace
  v_message := coalesce((select c.name from public.clients c where c.id = p_client), 'Le client') || ' a saisi ' || v_n || ' participant(s) pour la session '
    || coalesce(s.reference, '') || '.'
    || case when v_attente > 0 then ' ' || v_attente || ' en plus du maximum (' || v_max || ') : votre accord est attendu.' else '' end;
  select n.id into v_notif from public.notifications n
  where n.type = 'participants_saisis' and n.read_at is null and n.metadata ->> 'session_id' = s.id::text
  order by n.created_at desc limit 1;
  if v_notif is not null then
    update public.notifications set message = v_message, created_at = now(), metadata = jsonb_build_object('session_id', s.id, 'nombre', v_n, 'attente', v_attente)
    where id = v_notif;
  else
    insert into public.notifications (company_id, type, title, message, link, metadata)
    values (s.company_id, 'participants_saisis', 'Participants saisis par le client', v_message, '/sessions/' || s.id,
      jsonb_build_object('session_id', s.id, 'nombre', v_n, 'attente', v_attente));
  end if;
  return jsonb_build_object('ok', true, 'nombre', v_n, 'inscrits', v_inscrits, 'attente', v_attente);
end
$$;
revoke all on function app.participants_enregistrer(uuid, text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- Salariés déjà connus du client (recherche dans la fenêtre des participants, 22/10) : identité et informations
-- administratives utiles, jamais le n° de sécurité sociale (seulement s'il est connu)
create or replace function app.salaries_du_client(p_client uuid, p_sites uuid[] default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('trainee_id', t.id, 'first_name', t.first_name, 'last_name', t.last_name,
    'nom_naissance', t.nom_naissance, 'gender', t.gender, 'email', t.email, 'birth_date', t.birth_date, 'birth_place', t.birth_place,
    'job_title', t.job_title, 'ssn_present', coalesce(t.ssn_present, false), 'derniere_formation', t.last_session_date)
    order by t.last_name, t.first_name), '[]'::jsonb)
  from public.trainees t where t.client_id = p_client and (p_sites is null or t.site_id is null or t.site_id = any (p_sites))
$$;
revoke all on function app.salaries_du_client(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.client_portal_salaries_connus(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_check jsonb := public.client_portal_check(p_token, p_code);
begin
  if v_check ? 'error' then return v_check; end if;
  return app.salaries_du_client((v_check ->> 'client_id')::uuid);
end
$$;
revoke all on function public.client_portal_salaries_connus(text, text) from public;
grant execute on function public.client_portal_salaries_connus(text, text) to anon, authenticated;

create or replace function public.ent_salaries_connus()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  return app.salaries_du_client(v.client_id, app.ent_sites(v));
end
$$;
revoke all on function public.ent_salaries_connus() from public, anon;
grant execute on function public.ent_salaries_connus() to authenticated;

-- Décision de l'organisme sur un participant en attente : accepté (inscrit), ou refusé (le client le voit)
create or replace function public.participant_attente_decider(p_session uuid, p_trainee uuid, p_accepte boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare a public.session_places_attente;
begin
  if not app.can_edit_session(p_session) then raise exception 'Droit insuffisant' using errcode = '42501'; end if;
  select * into a from public.session_places_attente where session_id = p_session and trainee_id = p_trainee;
  if a.id is null then raise exception 'Aucune demande pour ce participant' using errcode = 'P0002'; end if;
  if p_accepte then
    insert into public.session_trainees (session_id, trainee_id) values (p_session, p_trainee) on conflict do nothing;
    delete from public.session_places_attente where id = a.id;
  else
    update public.session_places_attente set statut = 'refuse', decided_at = now(), decided_by = auth.uid() where id = a.id;
  end if;
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.participant_attente_decider(uuid, uuid, boolean) from public, anon;
grant execute on function public.participant_attente_decider(uuid, uuid, boolean) to authenticated;

-- ── 3. Confirmation d'une session préparée, sessions supplémentaires d'un devis ──
-- p_data : start_date, end_date, start_time, end_time, location_name, location_address, location_postal_code,
-- location_city, trainer_id, max_participants, places_supplementaires, contact_id, total_price (facultatif)
create or replace function app.session_appliquer(p_session uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debut date := nullif(p_data ->> 'start_date', '')::date;
  v_fin date := coalesce(nullif(p_data ->> 'end_date', '')::date, nullif(p_data ->> 'start_date', '')::date);
  v_h1 time := nullif(p_data ->> 'start_time', '')::time;
  v_h2 time := nullif(p_data ->> 'end_time', '')::time;
  v_max int := nullif(p_data ->> 'max_participants', '')::int;
  v_sup int := coalesce(nullif(p_data ->> 'places_supplementaires', '')::int, 0);
  v_formateur uuid := nullif(p_data ->> 'trainer_id', '')::uuid;
begin
  if v_debut is null or v_h1 is null or v_h2 is null then raise exception 'Date, heure de début et heure de fin requises' using errcode = '22023'; end if;
  if v_fin < v_debut then raise exception 'La fin est avant le début' using errcode = '22023'; end if;
  if v_h2 <= v_h1 then raise exception 'L''heure de fin doit suivre l''heure de début' using errcode = '22023'; end if;
  if v_formateur is null then raise exception 'Formateur requis' using errcode = '22023'; end if;
  if v_max is null or v_max < 1 or v_max > 200 then raise exception 'Nombre de places invalide' using errcode = '22023'; end if;
  if v_sup < 0 or v_sup > 20 then raise exception 'Dépassement autorisé entre 0 et 20' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_data ->> 'location_name', '') || coalesce(p_data ->> 'location_address', '') || coalesce(p_data ->> 'location_city', ''))) < 2 then
    raise exception 'Lieu requis' using errcode = '22023';
  end if;
  update public.sessions set
    start_date = v_debut, end_date = v_fin, start_time = v_h1, end_time = v_h2,
    day_type = case when v_h2 - v_h1 <= interval '4 hours 30 minutes' then 'half' else 'full' end,
    location_name = nullif(btrim(coalesce(p_data ->> 'location_name', '')), ''),
    location_address = nullif(btrim(coalesce(p_data ->> 'location_address', '')), ''),
    location_postal_code = nullif(btrim(coalesce(p_data ->> 'location_postal_code', '')), ''),
    location_city = nullif(btrim(coalesce(p_data ->> 'location_city', '')), ''),
    trainer_id = v_formateur, max_participants = v_max, places_supplementaires = v_sup,
    contact_id = coalesce(nullif(p_data ->> 'contact_id', '')::uuid, contact_id),
    total_price = coalesce(nullif(p_data ->> 'total_price', '')::numeric, total_price),
    validation_requise = false, status_locked = true, updated_at = now()
  where id = p_session;
  delete from public.session_trainers where session_id = p_session and trainer_id <> v_formateur;
  insert into public.session_trainers (session_id, trainer_id) values (p_session, v_formateur) on conflict do nothing;
end
$$;
revoke all on function app.session_appliquer(uuid, jsonb) from public, anon, authenticated;

create or replace function public.session_confirmer(p_session uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.can_edit_session(p_session) then raise exception 'Droit insuffisant' using errcode = '42501'; end if;
  if coalesce((select convention_signed from public.sessions where id = p_session), false) then
    raise exception 'Convention déjà signée : modifiez la session avec un avenant' using errcode = '22023';
  end if;
  perform app.session_appliquer(p_session, p_data);
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.session_confirmer(uuid, jsonb) from public, anon;
grant execute on function public.session_confirmer(uuid, jsonb) to authenticated;

-- Session supplémentaire d'un même devis (même formation, client, contact), confirmée d'emblée ; sa convention à part
create or replace function public.session_ajouter_depuis_devis(p_session uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.sessions;
  v_id uuid;
begin
  select * into s from public.sessions where id = p_session;
  if s.id is null or s.quote_id is null then raise exception 'Session issue d''un devis introuvable' using errcode = 'P0002'; end if;
  if not app.can_edit_session(p_session) then raise exception 'Droit insuffisant' using errcode = '42501'; end if;
  insert into public.sessions (course_id, client_id, contact_id, quote_id, trainer_id, company_id, start_date, end_date, status,
    is_intra, session_type, day_type, total_price, funding_type, validation_requise, notes)
  values (s.course_id, s.client_id, s.contact_id, s.quote_id, s.trainer_id, s.company_id, (p_data ->> 'start_date')::date,
    coalesce(nullif(p_data ->> 'end_date', '')::date, (p_data ->> 'start_date')::date), 'planned', true, 'intra', s.day_type,
    s.total_price, s.funding_type, true, 'Session supplémentaire du devis : ' || coalesce((select reference from public.quotes where id = s.quote_id), ''))
  returning id into v_id;
  perform app.session_appliquer(v_id, p_data);
  return v_id;
end
$$;
revoke all on function public.session_ajouter_depuis_devis(uuid, jsonb) from public, anon;
grant execute on function public.session_ajouter_depuis_devis(uuid, jsonb) to authenticated;

-- ── 4. Relances du client ──
-- Interrupteur des envois automatiques (0382) : nouveau type « relance_circuit », fermé tant que le super
-- administrateur ne l'ouvre pas
alter table public.auto_send_switches drop constraint if exists auto_send_switches_kind_check;
alter table public.auto_send_switches add constraint auto_send_switches_kind_check
  check (kind in ('relance_recyclage', 'relance_devis', 'relance_facture', 'convocation', 'attestation', 'evaluation_froid',
                  'renouvellement_contrat', 'visite_hors_contrat', 'justificatif_prestataire', 'relance_circuit'));
create or replace function app.envoi_auto_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['relance_recyclage', 'relance_devis', 'relance_facture', 'convocation', 'attestation', 'evaluation_froid',
               'renouvellement_contrat', 'visite_hors_contrat', 'justificatif_prestataire', 'relance_circuit']
$$;

-- Sessions issues d'un devis, confirmées : participants non saisis à 10 jours ou moins, convention non signée à
-- 7 jours ou moins ; une relance par objet, contact du client joignable
create or replace function public.circuit_relances_dues()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('session_id', x.id, 'kind', x.kind, 'reference', x.reference, 'start_date', x.start_date,
    'start_time', x.start_time, 'course', x.course, 'client', x.client, 'contact_name', x.contact_name, 'email', x.email)), '[]'::jsonb)
  from (
    select s.id, k.kind, s.reference, s.start_date, s.start_time, co.title course, c.name client,
      coalesce(cc.first_name, cc.name) contact_name,
      coalesce(nullif(cc.email, ''), nullif(c.billing_email, ''), nullif(c.contact_email, ''), nullif(c.email, '')) email
    from public.sessions s
    join public.clients c on c.id = s.client_id
    left join public.courses co on co.id = s.course_id
    left join public.client_contacts cc on cc.id = s.contact_id
    cross join lateral (values ('participants'), ('convention')) k(kind)
    where s.quote_id is not null and not coalesce(s.validation_requise, false) and s.start_date > current_date
      and app.envoi_auto_autorise(s.company_id, 'relance_circuit')
      and not exists (select 1 from public.demo_records r where r.tbl = 'sessions' and r.id = s.id)
      and not exists (select 1 from public.circuit_relances r where r.session_id = s.id and r.kind = k.kind)
      and ((k.kind = 'participants' and s.start_date - current_date <= 10
            and not exists (select 1 from public.session_trainees st where st.session_id = s.id))
        or (k.kind = 'convention' and s.start_date - current_date <= 7 and not coalesce(s.convention_signed, false)
            and exists (select 1 from public.session_trainees st where st.session_id = s.id)))
  ) x
  where x.email is not null
$$;
revoke all on function public.circuit_relances_dues() from public, anon, authenticated;
grant execute on function public.circuit_relances_dues() to service_role;

create or replace function public.circuit_relance_marquer(p_session uuid, p_kind text, p_to text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.circuit_relances (company_id, session_id, kind, sent_to)
  select s.company_id, s.id, p_kind, left(p_to, 255) from public.sessions s where s.id = p_session
  on conflict (session_id, kind) do nothing
$$;
revoke all on function public.circuit_relance_marquer(uuid, text, text) from public, anon, authenticated;
grant execute on function public.circuit_relance_marquer(uuid, text, text) to service_role;

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
           where schemaname = 'public' and tablename = any (array['circuit_relances', 'session_places_attente'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- circuit_relances, session_places_attente
select pg_temp.regles(array['circuit_relances', 'session_places_attente'], null,
  $r$company_id in (select app.societes_avec_droit('formation.suivi.voir'))$r$,
  null,
  null,
  null);


insert into public.schema_migrations (version) values ('0437_circuit_premium') on conflict (version) do nothing;

-- 0430 : circuit devis signé → session à valider → participants saisis par le client → convention → convocations à
-- valider (décisions de H, 21/10, 23 h 30).
--  - Devis signé par le client depuis son espace : une session est préparée par ligne de formation, marquée
--    « à valider » (dates et formateur à confirmer par l'organisme). Date lue dans l'objet du devis (« du 25 novembre
--    2026 »), sinon 30 jours après le devis. L'organisme est prévenu.
--  - Session validée et devis signé : le client saisit ses participants (nom, prénom, e-mail facultatif) depuis son
--    espace (par code ou avec compte), dans la limite des places, jusqu'à la signature de la convention. Mêmes
--    données que la session : l'équipe peut aussi les saisir. L'organisme est prévenu.
--  - Convention signée : l'organisme est prévenu que les convocations et documents sont à valider et envoyer.
-- Migration additive (colonnes, fonctions, déclencheurs). Idempotente. Retour arrière :
-- supabase/rollback/0430_circuit_participants_retour.sql

alter table public.sessions add column if not exists validation_requise boolean not null default false;
alter table public.sessions add column if not exists participants_saisis_le timestamptz;
comment on column public.sessions.validation_requise is 'Session préparée depuis un devis signé : dates et formateur à confirmer par l''organisme (0430)';

alter table public.portal_events drop constraint if exists portal_events_event_check;
alter table public.portal_events add constraint portal_events_event_check check (event in ('connexion', 'document', 'signature', 'participants', 'depot'));

-- Date écrite en toutes lettres dans un texte (« du 25 novembre 2026 », « le 1er mars 2027 »)
create or replace function app.date_fr_du_texte(p_texte text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  m text[];
  v_mois int;
begin
  m := regexp_match(lower(coalesce(p_texte, '')), '(\d{1,2})(?:er)?\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})');
  if m is null then return null; end if;
  v_mois := case
    when m[2] = 'janvier' then 1 when m[2] in ('février', 'fevrier') then 2 when m[2] = 'mars' then 3 when m[2] = 'avril' then 4
    when m[2] = 'mai' then 5 when m[2] = 'juin' then 6 when m[2] = 'juillet' then 7 when m[2] in ('août', 'aout', 'août') then 8
    when m[2] = 'septembre' then 9 when m[2] = 'octobre' then 10 when m[2] = 'novembre' then 11 else 12 end;
  return make_date(m[3]::int, v_mois, m[1]::int);
exception when others then
  return null;
end
$$;

-- Devis signé : sessions préparées (une par ligne de formation acceptée), une seule fois par devis
create or replace function app.devis_prepare_sessions(p_quote uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  c public.clients;
  it record;
  v_date date;
  v_id uuid;
  v_n int := 0;
  v_fund text;
begin
  select * into q from public.quotes where id = p_quote;
  if q.id is null or q.status not in ('accepted', 'partial') then return 0; end if;
  if exists (select 1 from public.sessions s where s.quote_id = q.id) then return 0; end if;
  select * into c from public.clients where id = q.client_id;
  v_date := coalesce(app.date_fr_du_texte(q.object), coalesce(q.quote_date, current_date) + 30);
  if v_date < current_date then v_date := current_date + 7; end if;
  v_fund := coalesce(nullif(to_jsonb(q) ->> 'funding_type', ''), 'none');
  if v_fund not in ('none', 'opco', 'cpf', 'faf', 'region', 'france_travail', 'ptp', 'fne', 'direct', 'other') then v_fund := 'none'; end if;
  for it in
    select i.*, co.default_trainer_id, co.duration_hours
    from public.quote_items i join public.courses co on co.id = i.course_id
    where i.quote_id = q.id and i.course_id is not null and coalesce(i.accepted, true)
    order by i.position
  loop
    insert into public.sessions (course_id, client_id, contact_id, quote_id, trainer_id, company_id, start_date, end_date,
      status, is_intra, session_type, day_type, location_name, location_address, location_postal_code, location_city,
      total_price, funding_type, validation_requise, notes)
    values (it.course_id, q.client_id, q.contact_id, q.id, it.default_trainer_id, q.company_id, v_date, v_date,
      'planned', true, 'intra', case when coalesce(it.duration_hours, 7) <= 4.5 then 'half' else 'full' end,
      c.name, c.address, c.postal_code, c.city,
      round(coalesce(it.quantity, 1) * coalesce(it.unit_price_ht, 0) * (1 - coalesce(q.discount_percent, 0) / 100), 2), v_fund, true,
      'Préparée depuis le devis signé ' || coalesce(q.reference, '') || ' : dates et formateur à confirmer.')
    returning id into v_id;
    v_n := v_n + 1;
    insert into public.notifications (company_id, type, title, message, link, metadata)
    values (q.company_id, 'session_a_valider', 'Session à valider',
      'Devis ' || coalesce(q.reference, '') || ' signé par ' || coalesce(c.name, 'le client') || ' : session préparée, confirmez les dates et le formateur.',
      '/sessions/' || v_id, jsonb_build_object('session_id', v_id, 'quote_id', q.id));
  end loop;
  return v_n;
end
$$;
revoke all on function app.devis_prepare_sessions(uuid) from public, anon, authenticated;

create or replace function app.devis_signe_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Signé par le client lui-même depuis son espace (une signature dessinée par l'équipe ne prépare rien : l'équipe crée
  -- alors la session depuis le devis, comme avant)
  if new.status in ('accepted', 'partial') and coalesce(old.status, '') not in ('accepted', 'partial')
     and exists (select 1 from public.document_signatures d
          where d.status = 'valid' and d.signer_type = 'client' and d.metadata ->> 'object_id' = new.id::text) then
    perform app.devis_prepare_sessions(new.id);
  end if;
  return new;
end
$$;
revoke all on function app.devis_signe_sessions() from public, anon, authenticated;
drop trigger if exists quotes_signe_sessions on public.quotes;
create trigger quotes_signe_sessions after update of status on public.quotes
  for each row execute function app.devis_signe_sessions();

-- L'organisme confirme la session préparée (dates et formateur vérifiés)
create or replace function public.session_preparee_valider(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.can_edit_session(p_session) then raise exception 'Droit insuffisant' using errcode = '42501'; end if;
  update public.sessions set validation_requise = false, updated_at = now() where id = p_session and validation_requise;
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.session_preparee_valider(uuid) from public, anon;
grant execute on function public.session_preparee_valider(uuid) to authenticated;

-- État des participants des sessions du client : saisie ouverte ou non, raison, places, participants (les siens)
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
    'saisis_le', s.participants_saisis_le,
    'participants', coalesce((select jsonb_agg(jsonb_build_object('trainee_id', t.id, 'first_name', t.first_name, 'last_name', t.last_name, 'email', t.email)
                                order by t.last_name, t.first_name)
                              from public.session_trainees st join public.trainees t on t.id = st.trainee_id
                              where st.session_id = s.id and t.client_id = p_client), '[]'::jsonb)
  ) order by s.start_date desc), '[]'::jsonb)
  from public.sessions s
  left join public.quotes q on q.id = s.quote_id
  where s.client_id = p_client and coalesce(s.session_type, 'intra') <> 'inter'
$$;
revoke all on function app.participants_etat(uuid) from public, anon, authenticated;

-- Enregistre la liste des participants du client pour une session (remplace la liste précédente)
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
  v_mail text;
  v_tr uuid;
  v_gardes uuid[] := '{}';
  v_n int;
  v_cles text[] := '{}';
  v_cle text;
  v_retire record;
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
    if length(v_prenom) < 1 or length(v_prenom) > 100 or length(v_nom) < 1 or length(v_nom) > 100 then
      raise exception 'Nom et prénom de chaque participant requis' using errcode = '22023';
    end if;
    if v_mail is not null and (length(v_mail) > 255 or v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
      raise exception 'Adresse e-mail invalide : %', v_mail using errcode = '22023';
    end if;
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
      insert into public.trainees (first_name, last_name, email, client_id, company_id)
      values (v_prenom, upper(v_nom), v_mail, p_client, s.company_id) returning id into v_tr;
    elsif v_mail is not null then
      update public.trainees set email = v_mail, updated_at = now() where id = v_tr and nullif(btrim(coalesce(email, '')), '') is null;
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
       or exists (select 1 from public.trainee_evaluations ev where ev.session_id = s.id and ev.trainee_id = v_retire.trainee_id) then
      raise exception '% % a déjà émargé ou répondu : contactez votre organisme', v_retire.first_name, v_retire.last_name using errcode = '22023';
    end if;
    delete from public.session_trainees where id = v_retire.id;
  end loop;

  update public.sessions set participants_saisis_le = now() where id = s.id;
  insert into public.portal_events (company_id, client_id, channel, access_id, profile_id, event, object_type, object_id, document_label, ip, user_agent)
  values (s.company_id, p_client, p_channel, p_access, p_profile, 'participants', 'session', s.id, v_n || ' participant(s)',
    left(coalesce(app.audit_entete('x-forwarded-for'), app.audit_entete('x-real-ip')), 64), left(app.entete_complet('user-agent'), 400));
  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (s.company_id, 'participants_saisis', 'Participants saisis par le client',
    coalesce((select c.name from public.clients c where c.id = p_client), 'Le client') || ' a saisi ' || v_n || ' participant(s) pour la session '
      || coalesce(s.reference, '') || '.', '/sessions/' || s.id, jsonb_build_object('session_id', s.id, 'nombre', v_n));
  return jsonb_build_object('ok', true, 'nombre', v_n);
end
$$;
revoke all on function app.participants_enregistrer(uuid, text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- Espace par lien et code
create or replace function public.client_portal_participants(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_check jsonb := public.client_portal_check(p_token, p_code);
begin
  if v_check ? 'error' then return v_check; end if;
  return app.participants_etat((v_check ->> 'client_id')::uuid);
end
$$;
revoke all on function public.client_portal_participants(text, text) from public;
grant execute on function public.client_portal_participants(text, text) to anon, authenticated;

create or replace function public.client_portal_participants_enregistrer(p_token text, p_code text, p_session uuid, p_liste jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_check jsonb := public.client_portal_check(p_token, p_code);
begin
  if v_check ? 'error' then return v_check; end if;
  return app.participants_enregistrer((v_check ->> 'client_id')::uuid, 'lien', (select a.id from public.client_portal_access a where a.token = p_token),
    null, p_session, p_liste);
end
$$;
revoke all on function public.client_portal_participants_enregistrer(text, text, uuid, jsonb) from public;
grant execute on function public.client_portal_participants_enregistrer(text, text, uuid, jsonb) to anon, authenticated;

-- Espace avec compte
create or replace function public.ent_participants()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  return app.participants_etat(v.client_id);
end
$$;
revoke all on function public.ent_participants() from public, anon;
grant execute on function public.ent_participants() to authenticated;

create or replace function public.ent_participants_enregistrer(p_session uuid, p_liste jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  return app.participants_enregistrer(v.client_id, 'compte', null, v.profile_id, p_session, p_liste);
end
$$;
revoke all on function public.ent_participants_enregistrer(uuid, jsonb) from public, anon;
grant execute on function public.ent_participants_enregistrer(uuid, jsonb) to authenticated;

-- Convention signée : convocations et documents à valider par l'organisme
create or replace function app.convention_signee_convocations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.convention_signed, false) and not coalesce(old.convention_signed, false) then
    insert into public.notifications (company_id, type, title, message, link, metadata)
    values (new.company_id, 'convocations_a_valider', 'Convocations à valider',
      'Convention ' || coalesce(new.reference, '') || ' signée : vérifiez puis envoyez les convocations et les documents de la session.',
      '/sessions/' || new.id, jsonb_build_object('session_id', new.id));
  end if;
  return new;
end
$$;
revoke all on function app.convention_signee_convocations() from public, anon, authenticated;
drop trigger if exists sessions_convention_convocations on public.sessions;
create trigger sessions_convention_convocations after update of convention_signed on public.sessions
  for each row execute function app.convention_signee_convocations();

insert into public.schema_migrations (version) values ('0430_circuit_participants') on conflict (version) do nothing;

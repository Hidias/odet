-- Retour arrière de 0435_circuit_v2.sql. Idempotent.
-- Les nouvelles versions de devis déjà créées restent (colonnes conservées si des versions existent) ; le statut
-- « replaced » repasse en « accepted » avant de remettre l'ancienne règle des statuts.

-- 3. Devis
drop trigger if exists quotes_a_version_remplace on public.quotes;
drop function if exists app.devis_version_remplace();
drop function if exists public.devis_nouvelle_version(uuid);
drop trigger if exists quote_items_signe_figees on public.quote_items;
drop function if exists app.lignes_devis_signe_figees();
drop trigger if exists quotes_signe_fige on public.quotes;
drop function if exists app.devis_signe_fige();
drop function if exists public.devis_est_signe(uuid);
drop function if exists app.devis_signe(uuid);
update public.quotes set status = 'accepted' where status = 'replaced';
alter table public.quotes drop constraint if exists quotes_status_check;
alter table public.quotes add constraint quotes_status_check
  check (status in ('draft', 'sent', 'accepted', 'partial', 'refused', 'expired', 'invoiced'));
do $$
begin
  if not exists (select 1 from public.quotes where previous_quote_id is not null) then
    alter table public.quotes drop column if exists replaced_at;
    alter table public.quotes drop column if exists replaced_by_id;
    alter table public.quotes drop column if exists previous_quote_id;
    alter table public.quotes drop column if exists version;
  end if;
end $$;

-- 2. Participants : versions de 0430
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
drop function if exists app.nir_complet(text);

-- 1. Date d'envoi de la convocation retirée des espaces
do $do$
declare
  f text;
  d text;
  avant text := $b$'access_code', st.access_code, 'convocation_sent_at', st.convocation_sent_at,$b$;
  apres text := $a$'access_code', st.access_code,$a$;
begin
  foreach f in array array['public.client_portal_data(text,text)', 'public.ent_sessions()'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position(avant in d) = 0 then continue; end if;
    execute replace(d, avant, apres);
  end loop;
end
$do$;

delete from public.schema_migrations where version = '0435_circuit_v2';

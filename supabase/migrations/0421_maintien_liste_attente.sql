-- 0421 : seuil de maintien et liste d'attente des sessions inter (série du 21/10, n° 29 et 30).
--   1. Liste d'attente : une inscription en ligne sur une session complète n'est plus refusée, elle va en liste
--      d'attente. Dès qu'une place se libère (stagiaire retiré ou noté absent, demande refusée, places augmentées),
--      la base propose la place à la plus ancienne demande qui tient dans les places libres (« place proposée ») et
--      prévient l'équipe, qui confirme comme d'habitude.
--   2. Seuil de maintien : chaque matin, une session inter qui commence dans 10 jours ou moins et qui n'a pas son
--      minimum d'inscrits fait une notification (une seule fois) ; la session montre le choix : maintenir, reporter ou
--      annuler (décision notée), avec les inscrits à prévenir et les dates suivantes de la même formation.
-- Aucun email n'est envoyé par l'outil. Migration additive. Idempotente.
-- Retour arrière : supabase/rollback/0421_maintien_liste_attente_retour.sql

-- ── 1. Liste d'attente ──
alter table public.online_registrations drop constraint if exists online_registrations_status_check;
alter table public.online_registrations add constraint online_registrations_status_check
  check (status in ('en_attente', 'liste_attente', 'place_proposee', 'confirmee', 'refusee'));
alter table public.online_registrations add column if not exists proposed_at timestamptz;

create or replace function public.public_inscrire(p_session uuid, p_inscription jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  v_ouvert boolean;
  v_kind text := p_inscription->>'kind';
  v_email text := lower(btrim(coalesce(p_inscription->>'contact_email', '')));
  v_parts jsonb := coalesce(p_inscription->'participants', '[]'::jsonb);
  v_n int;
  v_places int;
  v_id uuid;
  p jsonb;
  v_attente boolean := false;
begin
  select coalesce(os.calendrier_public, false) into v_ouvert from public.organization_settings os limit 1;
  if not coalesce(v_ouvert, false) then raise exception 'Inscriptions en ligne fermées' using errcode = '42501'; end if;
  select se.id, se.company_id, se.max_participants, se.start_date, co.title into s
    from public.sessions se left join public.courses co on co.id = se.course_id
   where se.id = p_session and se.session_type = 'inter' and coalesce(se.is_public, false)
     and se.start_date >= (now() at time zone 'Europe/Paris')::date and coalesce(se.status, '') not in ('cancelled', 'annulee');
  if s.id is null then raise exception 'Session introuvable ou fermée aux inscriptions' using errcode = '22023'; end if;
  if v_kind not in ('particulier', 'entreprise') then raise exception 'Type d''inscription inconnu' using errcode = '22023'; end if;
  if not coalesce((p_inscription->>'consent')::boolean, false) then
    raise exception 'Accord sur l''usage des données requis' using errcode = '22023';
  end if;
  if jsonb_typeof(v_parts) <> 'array' or jsonb_array_length(v_parts) < 1 or jsonb_array_length(v_parts) > 20 then
    raise exception 'Indiquez de 1 à 20 participants' using errcode = '22023';
  end if;
  for p in select * from jsonb_array_elements(v_parts) loop
    if length(btrim(coalesce(p->>'first_name', ''))) < 1 or length(btrim(coalesce(p->>'last_name', ''))) < 1 then
      raise exception 'Prénom et nom de chaque participant requis' using errcode = '22023';
    end if;
  end loop;
  v_n := jsonb_array_length(v_parts);
  if s.max_participants is not null then
    select s.max_participants - count(*) into v_places from public.session_trainees st
     where st.session_id = s.id and not coalesce(st.absent, false);
    -- Plus assez de places : la demande va en liste d'attente (0421) ; une place libérée lui sera proposée
    if v_n > v_places then v_attente := true; end if;
  end if;
  if (select count(*) from public.online_registrations r
       where r.session_id = s.id and lower(r.contact_email) = v_email and r.status in ('en_attente', 'liste_attente', 'place_proposee')) >= 3 then
    raise exception 'Une demande est déjà en attente pour cette adresse : l''organisme va vous répondre' using errcode = '22023';
  end if;

  insert into public.online_registrations (session_id, kind, contact_first_name, contact_last_name, contact_email, contact_phone,
    contact_function, company_name, siret, address, postal_code, city, participants, message, status)
  values (s.id, v_kind, btrim(p_inscription->>'contact_first_name'), btrim(p_inscription->>'contact_last_name'), v_email,
    nullif(btrim(coalesce(p_inscription->>'contact_phone', '')), ''), nullif(btrim(coalesce(p_inscription->>'contact_function', '')), ''),
    nullif(btrim(coalesce(p_inscription->>'company_name', '')), ''),
    nullif(regexp_replace(coalesce(p_inscription->>'siret', ''), '\s', '', 'g'), ''),
    nullif(btrim(coalesce(p_inscription->>'address', '')), ''), nullif(btrim(coalesce(p_inscription->>'postal_code', '')), ''),
    nullif(btrim(coalesce(p_inscription->>'city', '')), ''),
    (select jsonb_agg(jsonb_build_object('first_name', btrim(x->>'first_name'), 'last_name', btrim(x->>'last_name'),
                                         'email', nullif(lower(btrim(coalesce(x->>'email', ''))), ''),
                                         'job_title', nullif(btrim(coalesce(x->>'job_title', '')), '')))
       from jsonb_array_elements(v_parts) x),
    nullif(btrim(left(coalesce(p_inscription->>'message', ''), 2000)), ''),
    case when v_attente then 'liste_attente' else 'en_attente' end)
  returning id into v_id;

  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (s.company_id, 'inscription_en_ligne',
          left('Inscription en ligne : ' || coalesce(s.title, 'session inter') || ' du ' || to_char(s.start_date, 'DD/MM'), 255),
          case when v_kind = 'entreprise' then coalesce(p_inscription->>'company_name', 'Une entreprise') || ' inscrit '
                 || v_n || ' participant' || case when v_n > 1 then 's' else '' end
               else btrim(p_inscription->>'contact_first_name') || ' ' || upper(btrim(p_inscription->>'contact_last_name')) || ' s''inscrit' end
            || case when v_attente then ' : session complète, en liste d''attente.' else ' : à confirmer dans la session.' end,
          '/sessions/' || s.id, jsonb_build_object('session_id', s.id, 'registration_id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id, 'liste_attente', v_attente);
end
$$;

create or replace function public.inscription_confirmer(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.online_registrations;
  s record;
  v_client uuid;
  v_trainee uuid;
  v_group uuid;
  v_prix numeric;
  v_nom text;
  p jsonb;
begin
  select * into r from public.online_registrations where id = p_id for update;
  if r.id is null then raise exception 'Inscription inconnue' using errcode = '22023'; end if;
  if r.company_id not in (select app.societes_avec_droit('formation.inscriptions.gerer')) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if r.status not in ('en_attente', 'place_proposee', 'liste_attente') then raise exception 'Inscription déjà traitée' using errcode = '22023'; end if;
  select se.id, se.course_id, se.public_price_per_person into s from public.sessions se where se.id = r.session_id;

  -- Client : retrouvé (entreprise par SIRET, sinon par nom et code postal ; particulier par adresse email), sinon créé
  if r.kind = 'entreprise' then
    select c.id into v_client from public.clients c
     where c.company_id = r.company_id and r.siret is not null and c.siret = r.siret limit 1;
    if v_client is null then
      select c.id into v_client from public.clients c
       where c.company_id = r.company_id and lower(btrim(c.name)) = lower(btrim(r.company_name))
         and coalesce(c.postal_code, '') = coalesce(r.postal_code, '') limit 1;
    end if;
    if v_client is null then
      insert into public.clients (company_id, name, siret, siren, address, postal_code, city, client_type, type, email, contact_name, contact_email, contact_phone)
      values (r.company_id, btrim(r.company_name), r.siret, left(r.siret, 9), r.address, r.postal_code, r.city, 'entreprise', 'client',
              r.contact_email, r.contact_first_name || ' ' || r.contact_last_name, r.contact_email, r.contact_phone)
      returning id into v_client;
    end if;
    if not exists (select 1 from public.client_contacts cc where cc.client_id = v_client and lower(cc.email) = r.contact_email) then
      insert into public.client_contacts (client_id, name, first_name, last_name, email, phone, fonction, is_document_contact)
      values (v_client, r.contact_first_name || ' ' || r.contact_last_name, r.contact_first_name, r.contact_last_name, r.contact_email,
              r.contact_phone, r.contact_function, true);
    end if;
  else
    select c.id into v_client from public.clients c
     where c.company_id = r.company_id and c.client_type = 'particulier'
       and (lower(c.email) = r.contact_email or lower(c.contact_email) = r.contact_email) limit 1;
    if v_client is null then
      insert into public.clients (company_id, name, client_type, type, email, contact_name, contact_email, contact_phone, mobile, address, postal_code, city)
      values (r.company_id, r.contact_first_name || ' ' || upper(r.contact_last_name), 'particulier', 'client', r.contact_email,
              r.contact_first_name || ' ' || r.contact_last_name, r.contact_email, r.contact_phone, r.contact_phone, r.address, r.postal_code, r.city)
      returning id into v_client;
    end if;
  end if;

  -- Groupe inter : prix par personne du tarif du client (0418), sinon prix public de la session
  select g.id into v_group from public.session_groups g where g.session_id = r.session_id and g.client_id = v_client limit 1;
  if v_group is null then
    v_prix := coalesce((app.prix_client(v_client, 'formation', s.course_id)).prix_inter_ht, s.public_price_per_person);
    insert into public.session_groups (session_id, client_id, kind, payer_kind, nb_personnes, price_per_person, status, doc_status, source)
    values (r.session_id, v_client, r.kind, r.kind, jsonb_array_length(r.participants), v_prix, 'confirmed', 'a_envoyer', 'page_publique')
    returning id into v_group;
  end if;

  -- Stagiaires : retrouvés dans le client (adresse email, sinon prénom et nom), sinon créés ; inscrits dans le groupe
  for p in select * from jsonb_array_elements(r.participants) loop
    v_trainee := null;
    if nullif(p->>'email', '') is not null then
      select t.id into v_trainee from public.trainees t where t.client_id = v_client and lower(t.email) = lower(p->>'email') limit 1;
    end if;
    if v_trainee is null then
      select t.id into v_trainee from public.trainees t
       where t.client_id = v_client and lower(btrim(t.first_name)) = lower(p->>'first_name') and lower(btrim(t.last_name)) = lower(p->>'last_name') limit 1;
    end if;
    if v_trainee is null then
      insert into public.trainees (first_name, last_name, email, job_title, client_id)
      values (p->>'first_name', upper(p->>'last_name'), nullif(p->>'email', ''), nullif(p->>'job_title', ''), v_client)
      returning id into v_trainee;
    end if;
    if not exists (select 1 from public.session_trainees st where st.session_id = r.session_id and st.trainee_id = v_trainee) then
      insert into public.session_trainees (session_id, trainee_id, group_id) values (r.session_id, v_trainee, v_group);
    end if;
  end loop;
  update public.session_groups g set nb_personnes = (select count(*) from public.session_trainees st where st.group_id = g.id)
   where g.id = v_group;

  update public.online_registrations
     set status = 'confirmee', client_id = v_client, group_id = v_group, handled_by = auth.uid(), handled_at = now()
   where id = r.id;
  return jsonb_build_object('ok', true, 'client_id', v_client, 'group_id', v_group);
end
$$;

create or replace function public.inscription_refuser(p_id uuid, p_motif text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.online_registrations;
begin
  select * into r from public.online_registrations where id = p_id for update;
  if r.id is null then raise exception 'Inscription inconnue' using errcode = '22023'; end if;
  if r.company_id not in (select app.societes_avec_droit('formation.inscriptions.gerer')) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if r.status not in ('en_attente', 'place_proposee', 'liste_attente') then raise exception 'Inscription déjà traitée' using errcode = '22023'; end if;
  update public.online_registrations
     set status = 'refusee', response = nullif(btrim(left(coalesce(p_motif, ''), 1000)), ''), handled_by = auth.uid(), handled_at = now()
   where id = r.id;
  return jsonb_build_object('ok', true);
end
$$;

-- Place libérée : proposée à la plus ancienne demande en liste d'attente qui tient dans les places libres
create or replace function app.liste_attente_avancer(p_session uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  v_libres int;
  r record;
  v_faits int := 0;
begin
  select se.id, se.company_id, se.max_participants, se.start_date, co.title into s
    from public.sessions se left join public.courses co on co.id = se.course_id where se.id = p_session;
  if s.id is null or s.max_participants is null or s.start_date < (now() at time zone 'Europe/Paris')::date then return 0; end if;
  select s.max_participants
         - (select count(*) from public.session_trainees st where st.session_id = s.id and not coalesce(st.absent, false))
         - coalesce((select sum(jsonb_array_length(o.participants)) from public.online_registrations o
                      where o.session_id = s.id and o.status = 'place_proposee'), 0)
    into v_libres;
  for r in select o.id, o.kind, o.company_name, o.contact_first_name, o.contact_last_name, jsonb_array_length(o.participants) as n
             from public.online_registrations o where o.session_id = s.id and o.status = 'liste_attente' order by o.created_at loop
    exit when v_libres <= 0;
    continue when r.n > v_libres;
    update public.online_registrations set status = 'place_proposee', proposed_at = now() where id = r.id;
    v_libres := v_libres - r.n;
    v_faits := v_faits + 1;
    insert into public.notifications (company_id, type, title, message, link, metadata)
    values (s.company_id, 'liste_attente',
            left('Place libérée : ' || coalesce(s.title, 'session inter') || ' du ' || to_char(s.start_date, 'DD/MM'), 255),
            'Place proposée à ' || case when r.kind = 'entreprise' then coalesce(r.company_name, 'une entreprise')
                                        else r.contact_first_name || ' ' || upper(r.contact_last_name) end
              || ' (liste d''attente, ' || r.n || ' participant' || case when r.n > 1 then 's' else '' end || ') : à confirmer dans la session.',
            '/sessions/' || s.id, jsonb_build_object('session_id', s.id, 'registration_id', r.id));
  end loop;
  return v_faits;
end
$$;
revoke all on function app.liste_attente_avancer(uuid) from public, anon, authenticated;

create or replace function app.liste_attente_declencheur()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'session_trainees' then
    perform app.liste_attente_avancer(coalesce(new.session_id, old.session_id));
  elsif tg_table_name = 'sessions' then
    perform app.liste_attente_avancer(new.id);
  elsif tg_table_name = 'online_registrations' and new.status = 'refusee' then
    perform app.liste_attente_avancer(new.session_id);
  end if;
  return null;
end
$$;
revoke all on function app.liste_attente_declencheur() from public, anon, authenticated;
drop trigger if exists liste_attente_retrait on public.session_trainees;
create trigger liste_attente_retrait after delete or update of absent on public.session_trainees
  for each row execute function app.liste_attente_declencheur();
drop trigger if exists liste_attente_places on public.sessions;
create trigger liste_attente_places after update of max_participants on public.sessions
  for each row when (coalesce(new.max_participants, 0) > coalesce(old.max_participants, 0))
  execute function app.liste_attente_declencheur();
drop trigger if exists liste_attente_refus on public.online_registrations;
create trigger liste_attente_refus after update of status on public.online_registrations
  for each row execute function app.liste_attente_declencheur();

-- ── 2. Seuil de maintien ──
alter table public.sessions add column if not exists maintien_decision text;
alter table public.sessions drop constraint if exists sessions_maintien_decision_check;
alter table public.sessions add constraint sessions_maintien_decision_check
  check (maintien_decision is null or maintien_decision in ('maintenue', 'reportee', 'annulee'));
alter table public.sessions add column if not exists maintien_decision_at timestamptz;
comment on column public.sessions.maintien_decision is 'Décision de l''organisme quand le minimum d''inscrits n''est pas atteint à J-10 : maintenue, reportée, annulée';

create or replace function app.seuil_maintien_verifier()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jour date := (now() at time zone 'Europe/Paris')::date;
  s record;
  v_faits int := 0;
begin
  for s in
    select se.id, se.company_id, se.start_date, se.min_participants, co.title,
           (select count(*) from public.session_trainees st where st.session_id = se.id and not coalesce(st.absent, false)) as n
      from public.sessions se left join public.courses co on co.id = se.course_id
     where se.session_type = 'inter' and se.maintien_decision is null
       and se.start_date between v_jour and v_jour + 10
       and coalesce(se.status, '') not in ('cancelled', 'annulee')
       and coalesce(se.min_participants, 0) > 0
  loop
    continue when s.n >= s.min_participants;
    continue when exists (select 1 from public.notifications n where n.type = 'seuil_maintien' and n.metadata->>'session_id' = s.id::text);
    insert into public.notifications (company_id, type, title, message, link, metadata)
    values (s.company_id, 'seuil_maintien',
            left('Seuil de maintien non atteint : ' || coalesce(s.title, 'session inter') || ' du ' || to_char(s.start_date, 'DD/MM'), 255),
            s.n || ' inscrit' || case when s.n > 1 then 's' else '' end || ' pour un minimum de ' || s.min_participants
              || ', à J-' || (s.start_date - v_jour) || ' : maintenir, reporter ou annuler (dans la session).',
            '/sessions/' || s.id, jsonb_build_object('session_id', s.id, 'inscrits', s.n, 'minimum', s.min_participants));
    v_faits := v_faits + 1;
  end loop;
  return v_faits;
end
$$;
revoke all on function app.seuil_maintien_verifier() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'odet_seuil_maintien';
    perform cron.schedule('odet_seuil_maintien', '40 5 * * *', 'select app.seuil_maintien_verifier()');
  end if;
end $$;

insert into public.schema_migrations (version) values ('0421_maintien_liste_attente') on conflict (version) do nothing;

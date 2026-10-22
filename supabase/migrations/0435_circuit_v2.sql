-- 0435 : retours de H sur le premier essai réel du circuit (22/10).
--  1. Espaces client : chaque participant porte la date d'envoi de sa convocation, pour que le client ne voie les
--     convocations d'une session issue d'un devis qu'une fois validées et envoyées par l'organisme.
--  2. Participants saisis par le client : nom d'usage et nom de naissance (case « identique »), e-mail, n° de sécurité
--     sociale (rangé chiffré par la capture existante, jamais renvoyé), date et lieu de naissance, poste. Seuls le nom
--     et le prénom sont obligatoires ; rien de saisi n'efface ce qui est déjà connu. Une seule notification par
--     session tant qu'elle n'est pas lue.
--  3. Devis signé par le client : il ne se modifie plus (montants, lignes, client, objet, dates) ni ne s'efface ; un
--     changement passe par une nouvelle version (V2, V3…) à faire signer. Quand la nouvelle version est acceptée,
--     l'ancienne passe « remplacée » et la session suit la nouvelle version (pas de seconde session).
-- Migration additive (colonnes, fonctions, déclencheurs, statut « replaced »). Idempotente.
-- Retour arrière : supabase/rollback/0435_circuit_v2_retour.sql

-- ── 1. Date d'envoi de la convocation dans les espaces ──
do $do$
declare
  f text;
  d text;
  avant text := $a$'access_code', st.access_code,$a$;
  apres text := $b$'access_code', st.access_code, 'convocation_sent_at', st.convocation_sent_at,$b$;
begin
  foreach f in array array['public.client_portal_data(text,text)', 'public.ent_sessions()'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position($c$'convocation_sent_at', st.convocation_sent_at$c$ in d) > 0 then continue; end if;
    if (length(d) - length(replace(d, avant, ''))) / length(avant) <> 1 then raise exception 'Bloc participants introuvable dans %', f; end if;
    execute replace(d, avant, apres);
  end loop;
end
$do$;

-- ── 2. Participants saisis par le client ──

-- N° de sécurité sociale : 13 caractères, ou 15 avec la clé (2A / 2B pour la Corse). Renvoie les 15 caractères, ou null
create or replace function app.nir_complet(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := upper(regexp_replace(coalesce(p, ''), '[\s.\-]', '', 'g'));
  v13 text;
  v_cle int;
begin
  if v = '' then return null; end if;
  if length(v) not in (13, 15) then return null; end if;
  v13 := left(v, 13);
  if v13 !~ '^[12][0-9]{4}([0-9]{2}|2A|2B)[0-9]{6}$' then return null; end if;
  v_cle := 97 - (replace(replace(v13, '2A', '19'), '2B', '18')::numeric % 97)::int;
  if length(v) = 15 and substr(v, 14, 2) !~ '^[0-9]{2}$' then return null; end if;
  if length(v) = 15 and substr(v, 14, 2)::int <> v_cle then return null; end if;
  return v13 || lpad(v_cle::text, 2, '0');
end
$$;
revoke all on function app.nir_complet(text) from public, anon, authenticated;

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
$$;
revoke all on function app.participants_enregistrer(uuid, text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- ── 3. Devis signé figé, nouvelles versions ──
alter table public.quotes add column if not exists version int not null default 1;
alter table public.quotes add column if not exists previous_quote_id uuid references public.quotes (id);
alter table public.quotes add column if not exists replaced_by_id uuid references public.quotes (id);
alter table public.quotes add column if not exists replaced_at timestamptz;
create index if not exists quotes_previous_idx on public.quotes (previous_quote_id) where previous_quote_id is not null;

alter table public.quotes drop constraint if exists quotes_status_check;
alter table public.quotes add constraint quotes_status_check
  check (status in ('draft', 'sent', 'accepted', 'partial', 'refused', 'expired', 'invoiced', 'replaced'));

-- Signé par le client : signature en ligne, signature dessinée, ou scan déposé et validé
create or replace function app.devis_signe(p_quote uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.quotes q
    where q.id = p_quote and q.status in ('accepted', 'partial', 'invoiced', 'replaced')
      and (q.signature_base64 is not null
        or exists (select 1 from public.document_signatures d
                   where d.status = 'valid' and d.signer_type = 'client' and d.metadata ->> 'object_id' = q.id::text)
        or exists (select 1 from public.client_deposits cd
                   where cd.object_type = 'quote' and cd.object_id = q.id and cd.status = 'valide')))
$$;
revoke all on function app.devis_signe(uuid) from public, anon, authenticated;

create or replace function public.devis_est_signe(p_quote uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_societe uuid;
begin
  select company_id into v_societe from public.quotes where id = p_quote;
  if v_societe is null then return false; end if;
  if not (app.a_le_droit_dans(v_societe, 'commercial.devis.voir') or app.a_le_droit_dans(v_societe, 'commercial.devis.modifier')) then
    raise exception 'Droit insuffisant' using errcode = '42501';
  end if;
  return app.devis_signe(p_quote);
end
$$;
revoke all on function public.devis_est_signe(uuid) from public, anon;
grant execute on function public.devis_est_signe(uuid) to authenticated;

-- Devis signé : les éléments du contrat ne changent plus, il ne s'efface pas, il ne revient pas en brouillon
create or replace function app.devis_signe_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.devis_signe(old.id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Devis signé par le client : il ne s''efface pas' using errcode = '42501';
  end if;
  if new.status in ('draft', 'sent', 'expired') then
    raise exception 'Devis signé par le client : il ne revient pas en brouillon. Créez une nouvelle version.' using errcode = '42501';
  end if;
  if new.reference is distinct from old.reference or new.client_id is distinct from old.client_id
     or new.quote_date is distinct from old.quote_date or new.validity_date is distinct from old.validity_date
     or new.object is distinct from old.object or new.discount_percent is distinct from old.discount_percent
     or new.discount_label is distinct from old.discount_label or new.tva_rate is distinct from old.tva_rate
     or new.tva_applicable is distinct from old.tva_applicable or new.total_ht is distinct from old.total_ht
     or new.total_tva is distinct from old.total_tva or new.total_ttc is distinct from old.total_ttc
     or new.payment_method is distinct from old.payment_method or new.payment_terms is distinct from old.payment_terms
     or (old.signature_base64 is not null and new.signature_base64 is distinct from old.signature_base64) then
    raise exception 'Devis signé par le client : il ne se modifie plus. Créez une nouvelle version (V2) à faire signer.' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.devis_signe_fige() from public, anon, authenticated;
drop trigger if exists quotes_signe_fige on public.quotes;
create trigger quotes_signe_fige before update or delete on public.quotes
  for each row execute function app.devis_signe_fige();

create or replace function app.lignes_devis_signe_figees()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Seule l'acceptation ligne à ligne (acceptation partielle) reste possible
    if (to_jsonb(new) - 'accepted') = (to_jsonb(old) - 'accepted') then return new; end if;
    if app.devis_signe(old.quote_id) or app.devis_signe(new.quote_id) then
      raise exception 'Devis signé par le client : ses lignes ne changent plus. Créez une nouvelle version (V2).' using errcode = '42501';
    end if;
    return new;
  end if;
  if app.devis_signe(case when tg_op = 'DELETE' then old.quote_id else new.quote_id end) then
    raise exception 'Devis signé par le client : ses lignes ne changent plus. Créez une nouvelle version (V2).' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke all on function app.lignes_devis_signe_figees() from public, anon, authenticated;
drop trigger if exists quote_items_signe_figees on public.quote_items;
create trigger quote_items_signe_figees before insert or update or delete on public.quote_items
  for each row execute function app.lignes_devis_signe_figees();

-- Nouvelle version d'un devis signé : copie en brouillon (référence + « -V2 »), à modifier puis faire signer
create or replace function public.devis_nouvelle_version(p_quote uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v_id uuid;
  v_ref text;
begin
  select * into q from public.quotes where id = p_quote;
  if q.id is null then raise exception 'Devis introuvable' using errcode = 'P0002'; end if;
  if not app.a_le_droit_dans(q.company_id, 'commercial.devis.modifier') then raise exception 'Droit insuffisant' using errcode = '42501'; end if;
  if q.status = 'replaced' then raise exception 'Ce devis est déjà remplacé par une version plus récente' using errcode = '22023'; end if;
  if q.status = 'invoiced' then raise exception 'Devis facturé : un changement passe par un avoir et une nouvelle facture' using errcode = '22023'; end if;
  -- Une version en préparation existe déjà : on la reprend
  select id into v_id from public.quotes where previous_quote_id = q.id and status in ('draft', 'sent') order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  v_ref := regexp_replace(coalesce(q.reference, ''), '-V[0-9]+$', '') || '-V' || (coalesce(q.version, 1) + 1);
  v_id := gen_random_uuid();
  insert into public.quotes
  select (jsonb_populate_record(null::public.quotes, to_jsonb(q) || jsonb_build_object(
    'id', v_id, 'reference', v_ref, 'status', 'draft', 'signature_base64', null, 'session_id', null,
    'quote_date', current_date, 'validity_date', current_date + 30,
    'version', coalesce(q.version, 1) + 1, 'previous_quote_id', q.id, 'replaced_by_id', null, 'replaced_at', null,
    'relance_count', 0, 'last_relance_date', null, 'followup_state', 'actif', 'next_followup_date', null, 'triaged_at', null,
    'created_at', now(), 'updated_at', now()))).*;
  insert into public.quote_items
  select (jsonb_populate_record(null::public.quote_items, to_jsonb(i) || jsonb_build_object(
    'id', gen_random_uuid(), 'quote_id', v_id, 'accepted', null, 'created_at', now()))).*
  from public.quote_items i where i.quote_id = q.id;
  return v_id;
end
$$;
revoke all on function public.devis_nouvelle_version(uuid) from public, anon;
grant execute on function public.devis_nouvelle_version(uuid) to authenticated;

-- Nouvelle version acceptée : l'ancienne passe « remplacée », la session et les dépôts suivent la nouvelle version.
-- Nommé pour passer avant quotes_signe_sessions (ordre alphabétique) : aucune seconde session n'est préparée.
create or replace function app.devis_version_remplace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ancien public.quotes;
  v_n int;
begin
  if new.previous_quote_id is null or new.status not in ('accepted', 'partial') or coalesce(old.status, '') in ('accepted', 'partial') then
    return new;
  end if;
  select * into v_ancien from public.quotes where id = new.previous_quote_id;
  if v_ancien.id is null or v_ancien.status = 'replaced' then return new; end if;
  update public.quotes set status = 'replaced', replaced_by_id = new.id, replaced_at = now(), updated_at = now() where id = v_ancien.id;
  update public.sessions set quote_id = new.id, updated_at = now() where quote_id = v_ancien.id;
  get diagnostics v_n = row_count;
  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (new.company_id, 'devis_version_acceptee', 'Nouvelle version du devis acceptée',
    'Le devis ' || coalesce(new.reference, '') || ' remplace ' || coalesce(v_ancien.reference, '') || '.'
      || case when v_n > 0 then ' La session suit la nouvelle version : vérifiez son prix et ses dates.' else '' end,
    '/devis?open=' || new.id, jsonb_build_object('quote_id', new.id, 'ancien_id', v_ancien.id, 'sessions', v_n));
  return new;
end
$$;
revoke all on function app.devis_version_remplace() from public, anon, authenticated;
drop trigger if exists quotes_a_version_remplace on public.quotes;
create trigger quotes_a_version_remplace after update of status on public.quotes
  for each row execute function app.devis_version_remplace();

insert into public.schema_migrations (version) values ('0435_circuit_v2') on conflict (version) do nothing;

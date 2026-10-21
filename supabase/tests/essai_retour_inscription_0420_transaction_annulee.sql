-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (inscription_0420) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0420_inscription_en_ligne.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

-- ===== supabase/migrations/0420_inscription_en_ligne.sql =====
-- 0420 : inscription directe en ligne aux sessions inter (série du 21/10, n° 28). Depuis le calendrier public, un
-- particulier s'inscrit lui-même, ou une entreprise inscrit plusieurs salariés. L'inscription reste « en attente »
-- jusqu'à ce que l'organisme la confirme dans la session. À la confirmation, la base crée ou retrouve le client, les
-- stagiaires et le groupe inter, sans doublon ; la convention (entreprise) ou le contrat de formation (particulier,
-- 10 jours de rétractation, aucun paiement avant) se met ensuite à disposition dans l'espace client pour être signé en
-- ligne ; la signature passe le document du groupe à « signé ». Aucun paiement en ligne (décision de H). Aucun email.
--   1. online_registrations : les inscriptions en ligne et leur suite.
--   2. public.public_inscrire(session, inscription) : dépôt depuis la page publique (calendrier publié, session inter
--      publiée et à venir, places suffisantes, accord sur l'usage des données, trois demandes en attente au plus par
--      adresse et par session).
--   3. public.inscription_confirmer(id), public.inscription_refuser(id, motif) : par qui gère les inscriptions.
--   4. Documents de l'espace client : un groupe inter devient un objet du client (app.objet_du_client), et la signature
--      de son document le marque signé (app.portail_signer_document).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0420_inscription_en_ligne_retour.sql

-- ── 1. Inscriptions en ligne ──
create table if not exists public.online_registrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  kind text not null check (kind in ('particulier', 'entreprise')),
  contact_first_name text not null check (length(btrim(contact_first_name)) between 1 and 80),
  contact_last_name text not null check (length(btrim(contact_last_name)) between 1 and 80),
  contact_email text not null check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(contact_email) <= 200),
  contact_phone text check (contact_phone is null or length(contact_phone) <= 40),
  contact_function text check (contact_function is null or length(contact_function) <= 120),
  company_name text check (company_name is null or length(company_name) <= 200),
  siret text check (siret is null or siret ~ '^[0-9]{14}$'),
  address text check (address is null or length(address) <= 300),
  postal_code text check (postal_code is null or length(postal_code) <= 10),
  city text check (city is null or length(city) <= 120),
  participants jsonb not null default '[]'::jsonb check (jsonb_typeof(participants) = 'array' and jsonb_array_length(participants) between 1 and 20),
  message text check (message is null or length(message) <= 2000),
  consent_at timestamptz not null default now(),
  status text not null default 'en_attente' check (status in ('en_attente', 'confirmee', 'refusee')),
  response text check (response is null or length(response) <= 1000),
  client_id uuid references public.clients(id) on delete set null,
  group_id uuid references public.session_groups(id) on delete set null,
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  check (kind = 'particulier' or nullif(btrim(company_name), '') is not null)
);
create index if not exists online_registrations_session_idx on public.online_registrations (session_id, status);
comment on table public.online_registrations is 'Inscriptions en ligne aux sessions inter (page publique), en attente de confirmation par l''organisme';
drop trigger if exists online_registrations_societe on public.online_registrations;
create trigger online_registrations_societe before insert or update of session_id on public.online_registrations
  for each row execute function app.societe_du_parent('sessions', 'session_id');

-- ── 2. Dépôt depuis la page publique ──
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
    if v_n > v_places then raise exception 'Plus assez de places sur cette session' using errcode = '22023'; end if;
  end if;
  if (select count(*) from public.online_registrations r
       where r.session_id = s.id and lower(r.contact_email) = v_email and r.status = 'en_attente') >= 3 then
    raise exception 'Une demande est déjà en attente pour cette adresse : l''organisme va vous répondre' using errcode = '22023';
  end if;

  insert into public.online_registrations (session_id, kind, contact_first_name, contact_last_name, contact_email, contact_phone,
    contact_function, company_name, siret, address, postal_code, city, participants, message)
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
    nullif(btrim(left(coalesce(p_inscription->>'message', ''), 2000)), ''))
  returning id into v_id;

  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (s.company_id, 'inscription_en_ligne',
          left('Inscription en ligne : ' || coalesce(s.title, 'session inter') || ' du ' || to_char(s.start_date, 'DD/MM'), 255),
          case when v_kind = 'entreprise' then coalesce(p_inscription->>'company_name', 'Une entreprise') || ' inscrit '
                 || v_n || ' participant' || case when v_n > 1 then 's' else '' end
               else btrim(p_inscription->>'contact_first_name') || ' ' || upper(btrim(p_inscription->>'contact_last_name')) || ' s''inscrit' end
            || ' : à confirmer dans la session.',
          '/sessions/' || s.id, jsonb_build_object('session_id', s.id, 'registration_id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end
$$;
revoke all on function public.public_inscrire(uuid, jsonb) from public;
grant execute on function public.public_inscrire(uuid, jsonb) to anon, authenticated;

-- ── 3. Confirmation et refus par l'organisme ──
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
  if r.status <> 'en_attente' then raise exception 'Inscription déjà traitée' using errcode = '22023'; end if;
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
revoke all on function public.inscription_confirmer(uuid) from public, anon;
grant execute on function public.inscription_confirmer(uuid) to authenticated;

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
  if r.status <> 'en_attente' then raise exception 'Inscription déjà traitée' using errcode = '22023'; end if;
  update public.online_registrations
     set status = 'refusee', response = nullif(btrim(left(coalesce(p_motif, ''), 1000)), ''), handled_by = auth.uid(), handled_at = now()
   where id = r.id;
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.inscription_refuser(uuid, text) from public, anon;
grant execute on function public.inscription_refuser(uuid, text) to authenticated;

-- ── 4. Documents de l'espace client : le groupe inter ──
CREATE OR REPLACE FUNCTION app.objet_du_client(p_type text, p_id uuid, p_client uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case p_type
    when 'client' then p_id = p_client
    when 'session' then exists (select 1 from public.sessions s where s.id = p_id and s.client_id = p_client)
      or exists (select 1 from public.session_groups g where g.session_id = p_id and g.client_id = p_client)
    when 'invoice' then exists (select 1 from public.invoices i where i.id = p_id and (i.client_id = p_client or i.billing_client_id = p_client))
    when 'quote' then exists (select 1 from public.quotes q where q.id = p_id and q.client_id = p_client)
    when 'itv_visit' then exists (select 1 from public.itv_visits v where v.id = p_id and v.client_id = p_client)
    when 'itv_contract' then exists (select 1 from public.itv_contracts c where c.id = p_id and c.client_id = p_client)
    when 'session_group' then exists (select 1 from public.session_groups g where g.id = p_id and g.client_id = p_client)
    else false end
$function$;

CREATE OR REPLACE FUNCTION app.portail_signer_document(p_client uuid, p_channel text, p_access uuid, p_profile uuid, p_document uuid, p_name text, p_role text, p_signature text, p_consent text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d public.client_shared_documents;
  v_ex uuid;
  v_id uuid;
  v_nom text := btrim(coalesce(p_name, ''));
  v_lien text;
  v_client text;
begin
  select * into d from public.client_shared_documents where id = p_document and client_id = p_client and withdrawn_at is null;
  if d.id is null then raise exception 'Document inconnu pour ce client' using errcode = '42501'; end if;
  if d.kind not in ('devis', 'contrat') then raise exception 'Document non signable' using errcode = '22023'; end if;
  if length(v_nom) < 2 or length(v_nom) > 120 then raise exception 'Nom du signataire requis' using errcode = '22023'; end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,' or length(p_signature) > 400000 then
    raise exception 'Signature invalide' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_consent, ''))) < 20 then raise exception 'Accord du signataire requis' using errcode = '22023'; end if;
  if d.kind = 'devis' and exists (select 1 from public.quotes q where q.id = d.object_id and q.status in ('refused', 'expired')) then
    raise exception 'Ce devis n''est plus valable : contactez votre interlocuteur' using errcode = '22023';
  end if;

  select s.id into v_ex from public.document_signatures s
  where s.signer_type = 'client' and s.status = 'valid' and s.metadata->>'document_id' = d.id::text limit 1;
  if v_ex is not null then return jsonb_build_object('id', v_ex, 'deja', true); end if;

  insert into public.document_signatures (document_type, session_id, client_id, signer_type, signer_name, signer_role,
    signature_data, document_hash, signed_at, metadata, status, company_id)
  values (d.kind, case when d.object_type = 'session' then d.object_id end, p_client, 'client', v_nom,
    nullif(left(btrim(coalesce(p_role, '')), 120), ''), p_signature, d.sha256, now(),
    jsonb_build_object('canal', p_channel, 'access_id', p_access, 'profile_id', p_profile, 'consentement', left(p_consent, 1000),
      'document', d.label, 'document_id', d.id, 'object_type', d.object_type, 'object_id', d.object_id),
    'valid', d.company_id)
  returning id into v_id;

  -- Devis signé : accepté, avec la signature du client (le devis garde son historique de statut habituel)
  if d.kind = 'devis' and d.object_type = 'quote' then
    update public.quotes set status = 'accepted', signature_base64 = p_signature, updated_at = now()
    where id = d.object_id and status in ('draft', 'sent', 'partial');
    v_lien := '/devis?open=' || d.object_id;
  elsif d.kind = 'contrat' and d.object_type = 'session_group' then
    -- Convention ou contrat d'un groupe inter signé en ligne (0420) : document du groupe signé (la base calcule la fin
    -- de rétractation d'un particulier à partir de cette date)
    update public.session_groups set doc_status = 'signe', doc_signed_at = coalesce(doc_signed_at, now())
    where id = d.object_id;
    select '/sessions/' || g.session_id into v_lien from public.session_groups g where g.id = d.object_id;
  else
    v_lien := '/clients/' || p_client;
  end if;

  insert into public.portal_events (company_id, client_id, channel, access_id, profile_id, event, object_type, object_id,
    document_kind, document_label, document_sha256, ip, user_agent)
  values (d.company_id, p_client, p_channel, p_access, p_profile, 'signature', d.object_type, d.object_id, d.kind, d.label, d.sha256,
    left(coalesce(app.audit_entete('x-forwarded-for'), app.audit_entete('x-real-ip')), 64), left(app.entete_complet('user-agent'), 400));

  select c.name into v_client from public.clients c where c.id = p_client;
  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (d.company_id, case when d.kind = 'devis' then 'devis_signe' else 'contrat_signe' end,
    case when d.kind = 'devis' then 'Devis signé en ligne' else 'Contrat signé en ligne' end,
    v_nom || coalesce(', ' || nullif(btrim(coalesce(p_role, '')), ''), '') || ' a signé « ' || d.label || ' » (' || coalesce(v_client, '') || ').',
    v_lien, jsonb_build_object('document_id', d.id, 'signature_id', v_id));

  return jsonb_build_object('id', v_id, 'deja', false);
end
$function$;

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
           where schemaname = 'public' and tablename = any (array['online_registrations'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- online_registrations
select pg_temp.regles(array['online_registrations'], null,
  $r$company_id in (select app.societes_avec_droit('formation.inscriptions.gerer'))$r$,
  null,
  null,
  $r$company_id in (select app.societes_avec_droit('formation.inscriptions.gerer'))$r$);



insert into public.schema_migrations (version) values ('0420_inscription_en_ligne') on conflict (version) do nothing;

-- ===== supabase/rollback/0420_inscription_en_ligne_retour.sql =====
-- Retour arrière de 0420_inscription_en_ligne.sql. Les inscriptions en ligne sont effacées ; les clients, stagiaires
-- et groupes déjà créés par une confirmation restent. Les deux fonctions de l'espace client reprennent leur version
-- d'avant. Idempotent.

CREATE OR REPLACE FUNCTION app.objet_du_client(p_type text, p_id uuid, p_client uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case p_type
    when 'client' then p_id = p_client
    when 'session' then exists (select 1 from public.sessions s where s.id = p_id and s.client_id = p_client)
      or exists (select 1 from public.session_groups g where g.session_id = p_id and g.client_id = p_client)
    when 'invoice' then exists (select 1 from public.invoices i where i.id = p_id and (i.client_id = p_client or i.billing_client_id = p_client))
    when 'quote' then exists (select 1 from public.quotes q where q.id = p_id and q.client_id = p_client)
    when 'itv_visit' then exists (select 1 from public.itv_visits v where v.id = p_id and v.client_id = p_client)
    when 'itv_contract' then exists (select 1 from public.itv_contracts c where c.id = p_id and c.client_id = p_client)
    else false end
$function$;

CREATE OR REPLACE FUNCTION app.portail_signer_document(p_client uuid, p_channel text, p_access uuid, p_profile uuid, p_document uuid, p_name text, p_role text, p_signature text, p_consent text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d public.client_shared_documents;
  v_ex uuid;
  v_id uuid;
  v_nom text := btrim(coalesce(p_name, ''));
  v_lien text;
  v_client text;
begin
  select * into d from public.client_shared_documents where id = p_document and client_id = p_client and withdrawn_at is null;
  if d.id is null then raise exception 'Document inconnu pour ce client' using errcode = '42501'; end if;
  if d.kind not in ('devis', 'contrat') then raise exception 'Document non signable' using errcode = '22023'; end if;
  if length(v_nom) < 2 or length(v_nom) > 120 then raise exception 'Nom du signataire requis' using errcode = '22023'; end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,' or length(p_signature) > 400000 then
    raise exception 'Signature invalide' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_consent, ''))) < 20 then raise exception 'Accord du signataire requis' using errcode = '22023'; end if;
  if d.kind = 'devis' and exists (select 1 from public.quotes q where q.id = d.object_id and q.status in ('refused', 'expired')) then
    raise exception 'Ce devis n''est plus valable : contactez votre interlocuteur' using errcode = '22023';
  end if;

  select s.id into v_ex from public.document_signatures s
  where s.signer_type = 'client' and s.status = 'valid' and s.metadata->>'document_id' = d.id::text limit 1;
  if v_ex is not null then return jsonb_build_object('id', v_ex, 'deja', true); end if;

  insert into public.document_signatures (document_type, session_id, client_id, signer_type, signer_name, signer_role,
    signature_data, document_hash, signed_at, metadata, status, company_id)
  values (d.kind, case when d.object_type = 'session' then d.object_id end, p_client, 'client', v_nom,
    nullif(left(btrim(coalesce(p_role, '')), 120), ''), p_signature, d.sha256, now(),
    jsonb_build_object('canal', p_channel, 'access_id', p_access, 'profile_id', p_profile, 'consentement', left(p_consent, 1000),
      'document', d.label, 'document_id', d.id, 'object_type', d.object_type, 'object_id', d.object_id),
    'valid', d.company_id)
  returning id into v_id;

  -- Devis signé : accepté, avec la signature du client (le devis garde son historique de statut habituel)
  if d.kind = 'devis' and d.object_type = 'quote' then
    update public.quotes set status = 'accepted', signature_base64 = p_signature, updated_at = now()
    where id = d.object_id and status in ('draft', 'sent', 'partial');
    v_lien := '/devis?open=' || d.object_id;
  else
    v_lien := '/clients/' || p_client;
  end if;

  insert into public.portal_events (company_id, client_id, channel, access_id, profile_id, event, object_type, object_id,
    document_kind, document_label, document_sha256, ip, user_agent)
  values (d.company_id, p_client, p_channel, p_access, p_profile, 'signature', d.object_type, d.object_id, d.kind, d.label, d.sha256,
    left(coalesce(app.audit_entete('x-forwarded-for'), app.audit_entete('x-real-ip')), 64), left(app.entete_complet('user-agent'), 400));

  select c.name into v_client from public.clients c where c.id = p_client;
  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (d.company_id, case when d.kind = 'devis' then 'devis_signe' else 'contrat_signe' end,
    case when d.kind = 'devis' then 'Devis signé en ligne' else 'Contrat signé en ligne' end,
    v_nom || coalesce(', ' || nullif(btrim(coalesce(p_role, '')), ''), '') || ' a signé « ' || d.label || ' » (' || coalesce(v_client, '') || ').',
    v_lien, jsonb_build_object('document_id', d.id, 'signature_id', v_id));

  return jsonb_build_object('id', v_id, 'deja', false);
end
$function$;

drop function if exists public.inscription_refuser(uuid, text);
drop function if exists public.inscription_confirmer(uuid);
drop function if exists public.public_inscrire(uuid, jsonb);
drop table if exists public.online_registrations;

delete from public.schema_migrations where version = '0420_inscription_en_ligne';

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE inscription_0420 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

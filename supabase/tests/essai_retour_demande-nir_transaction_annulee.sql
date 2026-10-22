-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (demande-nir) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0440_demande_nir.sql, retour arrière,
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

-- ===== supabase/migrations/0440_demande_nir.sql =====
-- 0440 : le stagiaire ne retrouve pas son n° de sécurité sociale (décision de H du 22/10, 12 h 54).
-- Après 3 essais refusés dans le portail, le stagiaire peut demander à son entreprise de le transmettre : il signe une
-- autorisation (document_signatures 'autorisation_nir', même preuve que la décharge 0436), un e-mail part de la boîte
-- du formateur vers le contact de l'entreprise avec l'autorisation signée, et l'entreprise saisit le numéro dans son
-- espace client (accès par code ou compte). Envoi automatique soumis à l'interrupteur « demande_nir », fermé par
-- défaut : tant qu'il est fermé, l'organisme envoie la demande lui-même depuis la session.
-- Additive. Idempotente. Retour arrière : supabase/rollback/0440_demande_nir_retour.sql

-- ── 1. Interrupteur des envois automatiques ──
alter table public.auto_send_switches drop constraint if exists auto_send_switches_kind_check;
alter table public.auto_send_switches add constraint auto_send_switches_kind_check
  check (kind in ('relance_recyclage', 'relance_devis', 'relance_facture', 'convocation', 'attestation', 'evaluation_froid',
                  'renouvellement_contrat', 'visite_hors_contrat', 'justificatif_prestataire', 'relance_circuit', 'demande_nir'));
create or replace function app.envoi_auto_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['relance_recyclage', 'relance_devis', 'relance_facture', 'convocation', 'attestation', 'evaluation_froid',
               'renouvellement_contrat', 'visite_hors_contrat', 'justificatif_prestataire', 'relance_circuit', 'demande_nir']
$$;

-- ── 2. Numéro enregistré pour un stagiaire (fiche ou Passeport de prévention) ──
create or replace function app.nir_renseigne(p_trainee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select t.ssn_present from public.trainees t where t.id = p_trainee), false)
      or exists (select 1 from public.pp_nir n where n.trainee_id = p_trainee)
$$;
revoke all on function app.nir_renseigne(uuid) from public, anon, authenticated;

-- ── 3. Portail stagiaire : état et signature de la demande ──
create or replace function public.portail_nir_demande_etat(p_token text, p_trainee_id uuid, p_ticket text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session uuid := app.portal_session_for(p_token, p_trainee_id, p_ticket);
  d public.document_signatures;
begin
  select * into d from public.document_signatures
  where session_id = v_session and trainee_id = p_trainee_id and document_type = 'autorisation_nir' and status = 'valid'
  order by signed_at desc limit 1;
  return jsonb_build_object('demandee', d.id is not null, 'signature_id', d.id, 'signed_at', d.signed_at,
    'envoyee_le', (select max(e.created_at) from public.session_emails_sent e
                   where e.session_id = v_session and e.email_type = 'demande_nir' and e.attachments @> jsonb_build_array(jsonb_build_object('signature_id', d.id))),
    'renseigne', app.nir_renseigne(p_trainee_id));
end
$$;
revoke all on function public.portail_nir_demande_etat(text, uuid, text) from public;
grant execute on function public.portail_nir_demande_etat(text, uuid, text) to anon, authenticated;

create or replace function public.portail_nir_demander(p_token text, p_trainee_id uuid, p_ticket text, p_signature text, p_hash text, p_nom text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid := app.portal_session_for(p_token, p_trainee_id, p_ticket);
  s public.sessions;
  t public.trainees;
  d public.document_signatures;
  v_nom text := left(btrim(coalesce(p_nom, '')), 120);
begin
  select * into s from public.sessions where id = v_session;
  select * into t from public.trainees where id = p_trainee_id;
  if app.nir_renseigne(p_trainee_id) then
    raise exception 'Votre numéro est déjà enregistré : rien à demander' using errcode = '22023';
  end if;
  if coalesce(p_signature, '') !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or length(p_signature) > 400000 then
    raise exception 'Signature illisible, recommencez' using errcode = '22023';
  end if;
  if coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'Empreinte du document invalide' using errcode = '22023'; end if;
  if length(v_nom) < 2 then v_nom := left(btrim(concat_ws(' ', t.first_name, t.last_name)), 120); end if;
  select * into d from public.document_signatures
  where session_id = v_session and trainee_id = p_trainee_id and document_type = 'autorisation_nir' and status = 'valid'
  order by signed_at desc limit 1;
  if d.id is not null then
    return jsonb_build_object('ok', true, 'signature_id', d.id, 'signed_at', d.signed_at, 'deja', true,
      'envoi_auto', app.envoi_auto_autorise(s.company_id, 'demande_nir'));
  end if;
  insert into public.document_signatures (document_type, session_id, trainee_id, client_id, signer_type, signer_name, signer_email,
    signature_data, document_hash, signed_at, metadata, status, company_id)
  values ('autorisation_nir', v_session, p_trainee_id, s.client_id, 'stagiaire', v_nom, t.email,
    p_signature, p_hash, now(), jsonb_build_object('document', 'Autorisation : transmission du numéro de sécurité sociale par l''employeur', 'canal', 'portail stagiaire'),
    'valid', s.company_id)
  returning * into d;
  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (s.company_id, 'nir_demande', 'N° de sécurité sociale demandé à l''entreprise',
    v_nom || ' ne retrouve pas son numéro de sécurité sociale et autorise son entreprise à le transmettre (session '
      || coalesce(s.reference, '') || ').'
      || case when app.envoi_auto_autorise(s.company_id, 'demande_nir') then '' else ' Demande à envoyer depuis la session.' end,
    '/sessions/' || s.id, jsonb_build_object('session_id', s.id, 'trainee_id', p_trainee_id, 'signature_id', d.id));
  return jsonb_build_object('ok', true, 'signature_id', d.id, 'signed_at', d.signed_at,
    'envoi_auto', app.envoi_auto_autorise(s.company_id, 'demande_nir'));
end
$$;
revoke all on function public.portail_nir_demander(text, uuid, text, text, text, text) from public;
grant execute on function public.portail_nir_demander(text, uuid, text, text, text, text) to anon, authenticated;

-- ── 4. Envoi de la demande (serveur seulement) : tout ce que l'e-mail affiche vient de la base ──
create or replace function public.nir_demande_pour_envoi(p_signature uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('signature_id', d.id, 'session_id', s.id, 'company_id', s.company_id, 'reference', s.reference,
    'start_date', s.start_date, 'end_date', s.end_date, 'course', co.title, 'client', c.name,
    'trainee_id', t.id, 'first_name', t.first_name, 'last_name', t.last_name, 'birth_date', t.birth_date, 'job_title', t.job_title,
    'signer_name', d.signer_name, 'signed_at', d.signed_at, 'signature_data', d.signature_data,
    'contact_name', coalesce(cc.first_name, cc.name),
    'email', coalesce(nullif(cc.email, ''), nullif(c.contact_email, ''), nullif(c.email, '')),
    'trainer_email', nullif(tr.email, ''), 'trainer_name', btrim(concat_ws(' ', tr.first_name, tr.last_name)),
    'renseigne', app.nir_renseigne(t.id),
    'envoi_auto', app.envoi_auto_autorise(s.company_id, 'demande_nir'),
    'demo', exists (select 1 from public.demo_records r where r.tbl = 'sessions' and r.id = s.id),
    'envoyee_le', (select max(e.created_at) from public.session_emails_sent e
                   where e.session_id = s.id and e.email_type = 'demande_nir' and e.attachments @> jsonb_build_array(jsonb_build_object('signature_id', d.id))))
  from public.document_signatures d
  join public.sessions s on s.id = d.session_id
  join public.trainees t on t.id = d.trainee_id
  join public.clients c on c.id = s.client_id
  left join public.courses co on co.id = s.course_id
  left join public.client_contacts cc on cc.id = s.contact_id
  left join public.trainers tr on tr.id = s.trainer_id
  where d.id = p_signature and d.document_type = 'autorisation_nir' and d.status = 'valid'
$$;
revoke all on function public.nir_demande_pour_envoi(uuid) from public, anon, authenticated;
grant execute on function public.nir_demande_pour_envoi(uuid) to service_role;

-- ── 5. Espace client : demandes en cours et numéro transmis ──
create or replace function app.nir_demandes_client(p_client uuid, p_sites uuid[] default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('signature_id', d.id, 'session_id', s.id, 'trainee_id', t.id,
    'first_name', t.first_name, 'last_name', t.last_name, 'gender', t.gender, 'birth_date', t.birth_date,
    'course', co.title, 'start_date', s.start_date, 'demande_le', d.signed_at, 'renseigne', app.nir_renseigne(t.id))
    order by d.signed_at desc), '[]'::jsonb)
  from public.document_signatures d
  join public.sessions s on s.id = d.session_id
  join public.trainees t on t.id = d.trainee_id
  left join public.courses co on co.id = s.course_id
  where d.document_type = 'autorisation_nir' and d.status = 'valid' and t.client_id = p_client and s.client_id = p_client
    and d.signed_at > now() - interval '1 year'
    and (p_sites is null or t.site_id is null or t.site_id = any (p_sites))
$$;
revoke all on function app.nir_demandes_client(uuid, uuid[]) from public, anon, authenticated;

create or replace function app.nir_transmettre(p_client uuid, p_trainee uuid, p_nir text, p_canal text, p_sites uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trainees;
  d public.document_signatures;
  s public.sessions;
  v_nir text := app.nir_complet(p_nir);
begin
  select * into t from public.trainees where id = p_trainee and client_id = p_client
    and (p_sites is null or site_id is null or site_id = any (p_sites));
  if t.id is null then raise exception 'Salarié introuvable' using errcode = 'P0002'; end if;
  select * into d from public.document_signatures
  where trainee_id = t.id and document_type = 'autorisation_nir' and status = 'valid' and client_id = p_client
  order by signed_at desc limit 1;
  if d.id is null then raise exception 'Aucune demande de ce salarié' using errcode = '42501'; end if;
  if v_nir is null then
    raise exception 'N° de sécurité sociale invalide : 15 caractères, clé comprise (vérifiez chaque chiffre)' using errcode = '22023';
  end if;
  -- Rangé à part par le déclencheur de la fiche (trainee_ssn), jamais lisible depuis l'espace
  update public.trainees set social_security_number = v_nir, refused_ssn = false, updated_at = now() where id = t.id;
  select * into s from public.sessions where id = d.session_id;
  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (s.company_id, 'nir_transmis', 'N° de sécurité sociale transmis par l''entreprise',
    btrim(concat_ws(' ', t.first_name, upper(t.last_name))) || ' : numéro transmis par l''entreprise (' || p_canal || ', session '
      || coalesce(s.reference, '') || ').',
    '/sessions/' || s.id, jsonb_build_object('session_id', s.id, 'trainee_id', t.id, 'signature_id', d.id));
  return jsonb_build_object('ok', true, 'fin', right(v_nir, 3));
end
$$;
revoke all on function app.nir_transmettre(uuid, uuid, text, text, uuid[]) from public, anon, authenticated;

create or replace function public.client_portal_nir_demandes(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_check jsonb := public.client_portal_check(p_token, p_code);
begin
  if v_check ? 'error' then return v_check; end if;
  return app.nir_demandes_client((v_check ->> 'client_id')::uuid);
end
$$;
revoke all on function public.client_portal_nir_demandes(text, text) from public;
grant execute on function public.client_portal_nir_demandes(text, text) to anon, authenticated;

create or replace function public.client_portal_nir_transmettre(p_token text, p_code text, p_trainee uuid, p_nir text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_check jsonb := public.client_portal_check(p_token, p_code);
begin
  if v_check ? 'error' then return v_check; end if;
  return app.nir_transmettre((v_check ->> 'client_id')::uuid, p_trainee, p_nir, 'espace client');
end
$$;
revoke all on function public.client_portal_nir_transmettre(text, text, uuid, text) from public;
grant execute on function public.client_portal_nir_transmettre(text, text, uuid, text) to anon, authenticated;

create or replace function public.ent_nir_demandes()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  return app.nir_demandes_client(v.client_id, app.ent_sites(v));
end
$$;
revoke all on function public.ent_nir_demandes() from public, anon;
grant execute on function public.ent_nir_demandes() to authenticated;

create or replace function public.ent_nir_transmettre(p_trainee uuid, p_nir text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  return app.nir_transmettre(v.client_id, p_trainee, p_nir, 'espace entreprise', app.ent_sites(v));
end
$$;
revoke all on function public.ent_nir_transmettre(uuid, text) from public, anon;
grant execute on function public.ent_nir_transmettre(uuid, text) to authenticated;

-- ── 6. L'autorisation signée ne s'efface pas, comme la décharge ──
do $do$
declare
  d text := pg_get_functiondef('app.signature_client_figee()'::regprocedure);
  avant text := $a$old.signer_type = 'stagiaire' and old.document_type = 'decharge_nir'$a$;
  apres text := $b$old.signer_type = 'stagiaire' and old.document_type in ('decharge_nir', 'autorisation_nir')$b$;
begin
  if position(apres in d) > 0 then return; end if;
  if position(avant in d) = 0 then raise exception 'Protection de la décharge introuvable'; end if;
  execute replace(d, avant, apres);
end
$do$;

insert into public.schema_migrations (version) values ('0440_demande_nir') on conflict (version) do nothing;

-- ===== supabase/rollback/0440_demande_nir_retour.sql =====
-- Retour arrière de 0440_demande_nir.sql. Idempotent. Les autorisations déjà signées (document_signatures) restent :
-- ce sont des preuves.
drop function if exists public.ent_nir_transmettre(uuid, text);
drop function if exists public.ent_nir_demandes();
drop function if exists public.client_portal_nir_transmettre(text, text, uuid, text);
drop function if exists public.client_portal_nir_demandes(text, text);
drop function if exists app.nir_transmettre(uuid, uuid, text, text, uuid[]);
drop function if exists app.nir_demandes_client(uuid, uuid[]);
drop function if exists public.nir_demande_pour_envoi(uuid);
drop function if exists public.portail_nir_demander(text, uuid, text, text, text, text);
drop function if exists public.portail_nir_demande_etat(text, uuid, text);
drop function if exists app.nir_renseigne(uuid);
delete from public.auto_send_switches where kind = 'demande_nir';
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
do $do$
declare
  d text := pg_get_functiondef('app.signature_client_figee()'::regprocedure);
begin
  d := replace(d, $b$old.document_type in ('decharge_nir', 'autorisation_nir')$b$, $a$old.document_type = 'decharge_nir'$a$);
  execute d;
end
$do$;
delete from public.schema_migrations where version = '0440_demande_nir';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE demande-nir (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (decharge_nir_0436) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0436_decharge_nir.sql, retour arrière,
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

-- ===== supabase/migrations/0436_decharge_nir.sql =====
-- 0436 : décharge « numéro de sécurité sociale non communiqué » signée depuis le portail stagiaire (décision de H, 22/10).
-- Le stagiaire qui coche « je refuse de communiquer mon numéro » signe la décharge à l'écran ; la signature est rangée
-- avec l'empreinte du document présenté, l'adresse IP et l'appareil, et l'organisme est prévenu. Après la formation,
-- la décharge signée part avec les documents envoyés à l'entreprise, qui fait alors la déclaration au Passeport de
-- prévention (décret n° 2025-748 du 1er août 2025, article 7).
-- Une signature du stagiaire ne se modifie pas et ne s'efface pas, comme celle du client.
-- Migration additive (fonctions). Idempotente. Retour arrière : supabase/rollback/0436_decharge_nir_retour.sql

-- Identité de l'organisme pour les documents générés dans le portail stagiaire (mêmes champs que l'espace client,
-- sans coordonnées bancaires)
create or replace function public.portail_org_stagiaire(p_token text, p_trainee_id uuid, p_ticket text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session uuid := app.portal_session_for(p_token, p_trainee_id, p_ticket);
  v_ref jsonb := public.referent_handicap_info();
begin
  if v_session is null then return null; end if;
  return (
    select jsonb_build_object(
      'name', o.name, 'legal_name', o.legal_name, 'forme_juridique', o.forme_juridique, 'app_short_name', o.app_short_name,
      'address', o.address, 'postal_code', o.postal_code, 'city', o.city, 'lieu_signature', o.lieu_signature,
      'phone', o.phone, 'email', o.email, 'website', o.website,
      'siret', o.siret, 'siren', o.siren, 'naf', o.naf, 'nda', o.nda, 'nda_region', o.nda_region,
      'dirigeant_name', o.dirigeant_name, 'dirigeant_title', o.dirigeant_title, 'logo_url', o.logo_url,
      'brand_primary', o.brand_primary, 'brand_accent', o.brand_accent, 'brand_highlight', o.brand_highlight,
      'doc_prefix', o.doc_prefix, 'qualiopi_certified', o.qualiopi_certified, 'activity_kind', o.activity_kind,
      'referent_handicap_nom', v_ref ->> 'nom', 'referent_handicap_email', v_ref ->> 'email', 'referent_handicap_phone', v_ref ->> 'phone')
    from public.organization_settings o
    limit 1);
end
$$;
revoke all on function public.portail_org_stagiaire(text, uuid, text) from public;
grant execute on function public.portail_org_stagiaire(text, uuid, text) to anon, authenticated;

-- État de la décharge du stagiaire pour cette session
create or replace function public.portail_decharge_nir_etat(p_token text, p_trainee_id uuid, p_ticket text default null)
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
  where session_id = v_session and trainee_id = p_trainee_id and document_type = 'decharge_nir' and status = 'valid'
  order by signed_at desc limit 1;
  return jsonb_build_object(
    'refuse', coalesce((select refused_ssn from public.trainees where id = p_trainee_id), false),
    'signee', d.id is not null, 'signed_at', d.signed_at);
end
$$;
revoke all on function public.portail_decharge_nir_etat(text, uuid, text) from public;
grant execute on function public.portail_decharge_nir_etat(text, uuid, text) to anon, authenticated;

-- Signature de la décharge par le stagiaire
create or replace function public.portail_decharge_nir_signer(p_token text, p_trainee_id uuid, p_ticket text, p_signature text, p_hash text, p_nom text)
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
  if not coalesce(t.refused_ssn, false) then
    raise exception 'La décharge ne concerne que le refus de communiquer son numéro' using errcode = '22023';
  end if;
  if coalesce(p_signature, '') !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or length(p_signature) > 400000 then
    raise exception 'Signature illisible, recommencez' using errcode = '22023';
  end if;
  if coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'Empreinte du document invalide' using errcode = '22023'; end if;
  if length(v_nom) < 2 then v_nom := left(btrim(concat_ws(' ', t.first_name, t.last_name)), 120); end if;
  select * into d from public.document_signatures
  where session_id = v_session and trainee_id = p_trainee_id and document_type = 'decharge_nir' and status = 'valid'
  order by signed_at desc limit 1;
  if d.id is not null then return jsonb_build_object('ok', true, 'signed_at', d.signed_at, 'deja', true); end if;
  insert into public.document_signatures (document_type, session_id, trainee_id, client_id, signer_type, signer_name, signer_email,
    signature_data, document_hash, signed_at, metadata, status, company_id)
  values ('decharge_nir', v_session, p_trainee_id, s.client_id, 'stagiaire', v_nom, t.email,
    p_signature, p_hash, now(), jsonb_build_object('document', 'Décharge : numéro de sécurité sociale non communiqué', 'canal', 'portail stagiaire'),
    'valid', s.company_id)
  returning * into d;
  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (s.company_id, 'decharge_nir_signee', 'Décharge NIR signée',
    v_nom || ' a refusé de communiquer son numéro de sécurité sociale et a signé la décharge (session ' || coalesce(s.reference, '') || ').',
    '/sessions/' || s.id, jsonb_build_object('session_id', s.id, 'trainee_id', p_trainee_id, 'signature_id', d.id));
  return jsonb_build_object('ok', true, 'signed_at', d.signed_at);
end
$$;
revoke all on function public.portail_decharge_nir_signer(text, uuid, text, text, text, text) from public;
grant execute on function public.portail_decharge_nir_signer(text, uuid, text, text, text, text) to anon, authenticated;

-- Signature du stagiaire figée comme celle du client
create or replace function app.signature_client_figee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.signer_type = 'stagiaire' and old.document_type = 'decharge_nir'
       and exists (select 1 from public.sessions s where s.id = old.session_id)
       and not exists (select 1 from public.demo_records r where r.tbl = 'sessions' and r.id = old.session_id) then
      raise exception 'Signature du stagiaire : elle ne s''efface pas' using errcode = '42501';
    end if;
    if old.signer_type = 'client' and old.client_id is not null
       and exists (select 1 from public.clients c where c.id = old.client_id)
       and not exists (select 1 from public.demo_records r where r.tbl = 'clients' and r.id = old.client_id)
       and not (old.session_id is not null and (not exists (select 1 from public.sessions s where s.id = old.session_id)
                or exists (select 1 from public.demo_records r where r.tbl = 'sessions' and r.id = old.session_id))) then
      raise exception 'Signature du client : elle ne s''efface pas' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.signer_type in ('client', 'stagiaire') and (
       new.signature_data is distinct from old.signature_data or new.document_hash is distinct from old.document_hash
    or new.signed_at is distinct from old.signed_at or new.ip_address is distinct from old.ip_address
    or new.user_agent is distinct from old.user_agent or new.signer_name is distinct from old.signer_name
    or new.signer_role is distinct from old.signer_role or new.document_type is distinct from old.document_type
    or new.session_id is distinct from old.session_id or new.metadata is distinct from old.metadata) then
    raise exception 'Signature : elle ne se modifie pas' using errcode = '42501';
  end if;
  return new;
end
$$;

insert into public.schema_migrations (version) values ('0436_decharge_nir') on conflict (version) do nothing;

-- ===== supabase/rollback/0436_decharge_nir_retour.sql =====
-- Retour arrière de 0436_decharge_nir.sql. Idempotent. Les décharges déjà signées restent.
drop function if exists public.portail_decharge_nir_signer(text, uuid, text, text, text, text);
drop function if exists public.portail_decharge_nir_etat(text, uuid, text);
drop function if exists public.portail_org_stagiaire(text, uuid, text);
-- Règle d'avant (signature du client seulement)
CREATE OR REPLACE FUNCTION app.signature_client_figee()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.signer_type = 'client' and old.client_id is not null
       and exists (select 1 from public.clients c where c.id = old.client_id)
       and not exists (select 1 from public.demo_records r where r.tbl = 'clients' and r.id = old.client_id)
       and not (old.session_id is not null and (not exists (select 1 from public.sessions s where s.id = old.session_id)
                or exists (select 1 from public.demo_records r where r.tbl = 'sessions' and r.id = old.session_id))) then
      raise exception 'Signature du client : elle ne s''efface pas' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.signer_type = 'client' and (
       new.signature_data is distinct from old.signature_data or new.document_hash is distinct from old.document_hash
    or new.signed_at is distinct from old.signed_at or new.ip_address is distinct from old.ip_address
    or new.user_agent is distinct from old.user_agent or new.signer_name is distinct from old.signer_name
    or new.signer_role is distinct from old.signer_role or new.document_type is distinct from old.document_type
    or new.session_id is distinct from old.session_id or new.metadata is distinct from old.metadata) then
    raise exception 'Signature du client : elle ne se modifie pas' using errcode = '42501';
  end if;
  return new;
end
$function$;
delete from public.schema_migrations where version = '0436_decharge_nir';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE decharge_nir_0436 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

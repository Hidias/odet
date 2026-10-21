-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (portail_code_0423) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0423_portail_par_code.sql, retour arrière,
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

-- ===== supabase/migrations/0423_portail_par_code.sql =====
-- 0423 : portail stagiaire par code, sans liste de noms (demande de H, 21/10, 20 h 52). Jusqu'ici, le lien du portail
-- (QR de la salle) renvoyait à quiconque l'ouvrait la liste des inscrits (nom, prénom, identifiant), et en inter le
-- nom du client. Désormais : le stagiaire tape son code personnel (convocation, ou liste du formateur), qui
-- l'identifie ; il renseigne ensuite ses informations. Personne ne voit le nom d'un autre participant.
--   1. Chaque inscrit a un code (ceux qui n'en ont pas en reçoivent un ; les nouveaux en ont déjà un à l'inscription).
--   2. sessions : compteur d'essais faux du portail ; au-delà de 15 en une heure, le portail de la session est bloqué
--      30 minutes (le formateur peut débloquer depuis la session : public.portail_debloquer).
--   3. public.portal_entrer(lien, code) : le code identifie le stagiaire de la session et délivre le ticket.
--   4. public.get_portal_session : plus de liste d'inscrits ; nom du client seulement en intra.
-- Migration additive (fonctions et colonnes). Idempotente. Retour arrière : supabase/rollback/0423_portail_par_code_retour.sql

-- ── 1. Un code pour chaque inscrit ──
update public.session_trainees set access_code = public.generate_access_code(), code_generated_at = now()
 where access_code is null;

-- ── 2. Essais faux par session ──
alter table public.sessions add column if not exists portail_essais_faux int not null default 0;
alter table public.sessions add column if not exists portail_essais_depuis timestamptz;
alter table public.sessions add column if not exists portail_bloque_jusqua timestamptz;
comment on column public.sessions.portail_bloque_jusqua is 'Portail stagiaire bloqué après trop de codes faux (15 en une heure) : 30 minutes, ou déblocage par l''équipe';

-- ── 3. Entrée par code ──
create or replace function public.portal_entrer(p_token text, p_code text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  st record;
  v_code text := regexp_replace(coalesce(p_code, ''), '\s', '', 'g');
  v_ticket text;
begin
  select id, portail_essais_faux, portail_essais_depuis, portail_bloque_jusqua into s
    from public.sessions where attendance_token = p_token for update;
  if s.id is null then return json_build_object('success', false, 'error', 'Lien invalide'); end if;
  if s.portail_bloque_jusqua is not null and s.portail_bloque_jusqua > now() then
    return json_build_object('success', false, 'error', 'Trop de codes incorrects : réessayez dans quelques minutes ou voyez avec votre formateur',
      'bloque_jusqua', s.portail_bloque_jusqua);
  end if;
  if v_code !~ '^[0-9]{6}$' then return json_build_object('success', false, 'error', 'Le code comporte 6 chiffres'); end if;

  select st2.id, st2.trainee_id, st2.access_code_locked, coalesce(st2.absent, false) as absent,
         st2.portal_ticket, st2.portal_ticket_expires_at, t.first_name, t.last_name
    into st
    from public.session_trainees st2 join public.trainees t on t.id = st2.trainee_id
   where st2.session_id = s.id and st2.access_code = v_code;

  if st.id is null then
    update public.sessions
       set portail_essais_faux = case when portail_essais_depuis is null or portail_essais_depuis < now() - interval '1 hour' then 1 else portail_essais_faux + 1 end,
           portail_essais_depuis = case when portail_essais_depuis is null or portail_essais_depuis < now() - interval '1 hour' then now() else portail_essais_depuis end,
           portail_bloque_jusqua = case when portail_essais_depuis is not null and portail_essais_depuis >= now() - interval '1 hour'
                                         and portail_essais_faux + 1 >= 15 then now() + interval '30 minutes' else portail_bloque_jusqua end
     where id = s.id;
    return json_build_object('success', false, 'error', 'Code inconnu pour cette formation : vérifiez votre convocation ou demandez-le à votre formateur');
  end if;
  if st.access_code_locked then
    return json_build_object('success', false, 'error', 'Accès suspendu : voyez avec votre formateur');
  end if;

  v_ticket := case when st.portal_ticket is not null and st.portal_ticket_expires_at > now() then st.portal_ticket
                   else replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') end;
  update public.session_trainees
     set access_code_attempts = 0, access_code_locked = false, portal_ticket = v_ticket,
         portal_ticket_expires_at = now() + interval '12 hours'
   where id = st.id;
  update public.sessions set portail_essais_faux = 0, portail_essais_depuis = null where id = s.id and portail_essais_faux > 0;

  return json_build_object('success', true, 'ticket', v_ticket, 'trainee', json_build_object(
    'id', st.trainee_id, 'session_trainee_id', st.id, 'first_name', st.first_name, 'last_name', st.last_name,
    'absent', st.absent, 'has_access_code', true));
end
$$;
revoke all on function public.portal_entrer(text, text) from public;
grant execute on function public.portal_entrer(text, text) to anon, authenticated;

-- Déblocage par l'équipe (qui peut modifier la session)
create or replace function public.portail_debloquer(p_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.can_edit_session(p_session) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  update public.sessions set portail_essais_faux = 0, portail_essais_depuis = null, portail_bloque_jusqua = null where id = p_session;
end
$$;
revoke all on function public.portail_debloquer(uuid) from public, anon;
grant execute on function public.portail_debloquer(uuid) to authenticated;

-- ── 4. Session du portail sans liste d'inscrits ──
create or replace function public.get_portal_session(token_param text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  session_record record;
  result json;
begin
  select s.*,
         json_build_object('id', c.id, 'title', c.title, 'code', c.code, 'duration_hours', c.duration_hours, 'duration_days', c.duration_days, 'objectives', c.objectives, 'theme_id', c.theme_id) as course_data,
         case when coalesce(s.session_type, 'intra') = 'inter' then null
              else json_build_object('id', cl.id, 'name', cl.name, 'city', cl.city) end as client_data
  into session_record
  from sessions s
  left join courses c on c.id = s.course_id
  left join clients cl on cl.id = s.client_id
  where s.attendance_token = token_param;

  if not found then
    raise exception 'Session non trouvée';
  end if;

  select json_build_object(
    'id', session_record.id,
    'reference', session_record.reference,
    'start_date', session_record.start_date,
    'end_date', session_record.end_date,
    'start_time', session_record.start_time,
    'end_time', session_record.end_time,
    'status', session_record.status,
    'day_type', session_record.day_type,
    'signature_mode', session_record.signature_mode,
    'session_type', session_record.session_type,
    'location_name', session_record.location_name,
    'location_city', session_record.location_city,
    'course_id', session_record.course_id,
    'client_id', case when coalesce(session_record.session_type, 'intra') = 'inter' then null else session_record.client_id end,
    'courses', session_record.course_data,
    'clients', session_record.client_data,
    'par_code', true
  ) into result;

  return result;
end $function$;

insert into public.schema_migrations (version) values ('0423_portail_par_code') on conflict (version) do nothing;

-- ===== supabase/rollback/0423_portail_par_code_retour.sql =====
-- Retour arrière de 0423_portail_par_code.sql. get_portal_session reprend sa version d'avant (liste des inscrits) ;
-- les codes donnés aux inscrits qui n'en avaient pas restent (sans effet). Idempotent.

drop function if exists public.portal_entrer(text, text);
drop function if exists public.portail_debloquer(uuid);
alter table public.sessions drop column if exists portail_bloque_jusqua;
alter table public.sessions drop column if exists portail_essais_depuis;
alter table public.sessions drop column if exists portail_essais_faux;

CREATE OR REPLACE FUNCTION public.get_portal_session(token_param text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  session_record record;
  result json;
begin
  select s.*,
         json_build_object('id', c.id, 'title', c.title, 'code', c.code, 'duration_hours', c.duration_hours, 'duration_days', c.duration_days, 'objectives', c.objectives, 'theme_id', c.theme_id) as course_data,
         json_build_object('id', cl.id, 'name', cl.name, 'city', cl.city) as client_data
  into session_record
  from sessions s
  left join courses c on c.id = s.course_id
  left join clients cl on cl.id = s.client_id
  where s.attendance_token = token_param;

  if not found then
    raise exception 'Session non trouvée';
  end if;

  select json_build_object(
    'id', session_record.id,
    'reference', session_record.reference,
    'start_date', session_record.start_date,
    'end_date', session_record.end_date,
    'start_time', session_record.start_time,
    'end_time', session_record.end_time,
    'status', session_record.status,
    'day_type', session_record.day_type,
    'signature_mode', session_record.signature_mode,
    'session_type', session_record.session_type,
    'location_name', session_record.location_name,
    'location_city', session_record.location_city,
    'course_id', session_record.course_id,
    'client_id', session_record.client_id,
    'courses', session_record.course_data,
    'clients', session_record.client_data,
    'trainees', (
      select json_agg(json_build_object(
        'id', t.id,
        'first_name', t.first_name,
        'last_name', t.last_name,
        'session_trainee_id', st.id,
        'has_access_code', (st.access_code is not null),
        'access_code_attempts', st.access_code_attempts,
        'access_code_locked', coalesce(st.access_code_locked, false),
        'absent', coalesce(st.absent, false)
      ) order by t.last_name, t.first_name)
      from session_trainees st
      join trainees t on t.id = st.trainee_id
      where st.session_id = session_record.id
    )
  ) into result;

  return result;
end $function$

;

delete from public.schema_migrations where version = '0423_portail_par_code';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE portail_code_0423 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (nir_chiffre_0502) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0502_nir_chiffre.sql, retour arrière,
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

-- ===== supabase/migrations/0502_nir_chiffre.sql =====
-- 0502 : numéro de sécurité sociale chiffré dans trainee_ssn (décision de H du 07/11 : coffre Supabase).
-- trainee_ssn reçoit le numéro saisi sur la fiche de renseignements du portail, la liste des participants ou transmis
-- par l'entreprise (déclencheurs trainee_ssn_capture et info_sheet_ssn_capture, inchangés) ; la reprise automatique
-- du Passeport (api/passeport.js, toutes les 15 minutes) le passe dans pp_nir, chiffré par le serveur, puis l'efface.
-- Jusqu'ici il restait en clair entre les deux (table fermée à tous les comptes).
--   1. Clé tirée au hasard et rangée dans le coffre Supabase (vault, secret odet_trainee_ssn) ; elle n'est ni dans le
--      dépôt ni dans les sauvegardes en clair. app.ssn_cle() la lit, fermée à tous les comptes.
--   2. trainee_ssn.ssn_chiffre (pgp_sym_encrypt) et trainee_ssn.fin (3 derniers chiffres) ; un déclencheur chiffre tout
--      numéro écrit, la colonne ssn reste vide (contrainte).
--   3. Saisies : trainee_ssn_capture et info_sheet_ssn_capture écrivent par « insert ... on conflict do update » ; le
--      déclencheur chiffre la ligne proposée avant le conflit, la mise à jour reprend donc ssn_chiffre et fin (une
--      correction du numéro remplace l'ancien). Seule ligne changée dans chacune.
--   4. Lectures : load_trainee_data (portail) et get_trainee_with_ssn (fiche stagiaire) lisent fin, comme avant les
--      3 derniers chiffres ; seul changement de leur corps.
--   5. public.trainee_ssn_a_reprendre() : numéros déchiffrés pour la reprise du Passeport, réservée au serveur
--      (service_role).
-- Production le 07/11 : 0 ligne dans trainee_ssn. Retour arrière : supabase/rollback/0502_nir_chiffre_retour.sql
-- (remet les numéros en clair avant de retirer les colonnes : possible après usage réel).

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'odet_trainee_ssn') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'odet_trainee_ssn',
      'Clé de chiffrement des numéros de sécurité sociale de trainee_ssn (0502)');
  end if;
end $$;

create or replace function app.ssn_cle()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'odet_trainee_ssn';
  if v is null or v = '' then raise exception 'Clé de chiffrement des numéros absente du coffre'; end if;
  return v;
end
$$;
revoke all on function app.ssn_cle() from public, anon, authenticated;

alter table public.trainee_ssn add column if not exists ssn_chiffre bytea;
alter table public.trainee_ssn add column if not exists fin text;
alter table public.trainee_ssn alter column ssn drop not null;
comment on column public.trainee_ssn.ssn_chiffre is 'Numéro chiffré (pgp_sym_encrypt, clé du coffre odet_trainee_ssn) (0502)';
comment on column public.trainee_ssn.fin is 'Trois derniers chiffres du numéro, pour l''affichage (0502)';

create or replace function app.trainee_ssn_chiffrer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ssn is not null then
    new.ssn_chiffre := extensions.pgp_sym_encrypt(new.ssn, app.ssn_cle());
    new.fin := right(new.ssn, 3);
    new.ssn := null;
  end if;
  return new;
end
$$;
revoke all on function app.trainee_ssn_chiffrer() from public, anon, authenticated;
drop trigger if exists a_trainee_ssn_chiffrer on public.trainee_ssn;
create trigger a_trainee_ssn_chiffrer before insert or update on public.trainee_ssn
  for each row execute function app.trainee_ssn_chiffrer();

-- Numéros déjà présents : chiffrés par le déclencheur
update public.trainee_ssn set ssn = ssn where ssn is not null;
alter table public.trainee_ssn drop constraint if exists trainee_ssn_jamais_en_clair;
alter table public.trainee_ssn add constraint trainee_ssn_jamais_en_clair check (ssn is null);

CREATE OR REPLACE FUNCTION public.load_trainee_data(p_token text, p_trainee_id uuid, p_ticket text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session_id uuid;
  v_result json;
  v_trainee record;
  v_info_sheet record;
  v_theme_id uuid;
  v_ssn text;
begin
  v_session_id := app.portal_session_for(p_token, p_trainee_id, p_ticket);

  select * into v_trainee from trainees where id = p_trainee_id;
  select * into v_info_sheet from trainee_info_sheets where session_id = v_session_id and trainee_id = p_trainee_id;
  select c.theme_id into v_theme_id from sessions s join courses c on c.id = s.course_id where s.id = v_session_id;
  select s.fin into v_ssn from trainee_ssn s where s.trainee_id = p_trainee_id and s.fin is not null;

  select json_build_object(
    'gender', v_trainee.gender,
    'info_sheet', json_build_object(
      'id', v_info_sheet.id,
      'session_id', v_session_id,
      'trainee_id', p_trainee_id,
      'email', coalesce(v_trainee.email, v_info_sheet.email),
      'ssn', null,
      'ssn_on_file', v_ssn is not null,
      'ssn_last3', case when v_ssn is not null then right(v_ssn, 3) end,
      'ssn_refused', coalesce(v_trainee.refused_ssn, v_info_sheet.ssn_refused, false),
      'csp', coalesce(v_trainee.csp, v_info_sheet.csp),
      'job_title', coalesce(v_trainee.job_title, v_info_sheet.job_title),
      'last_training_year', v_info_sheet.last_training_year,
      'highest_diploma', v_info_sheet.highest_diploma,
      'training_expectations', v_info_sheet.training_expectations,
      'rgpd_consent', v_info_sheet.rgpd_consent,
      'rgpd_consent_date', v_info_sheet.rgpd_consent_date,
      'filled_at', v_info_sheet.filled_at,
      'filled_online', v_info_sheet.filled_online
    ),
    'attendance', (
      select json_agg(row_to_json(a.*))
      from attendance_halfdays a
      where a.session_id = v_session_id and a.trainee_id = p_trainee_id
    ),
    'evaluation', (
      select row_to_json(e.*)
      from trainee_evaluations e
      where e.session_id = v_session_id and e.trainee_id = p_trainee_id
    ),
    'positioning_questions', (
      select json_agg(json_build_object(
        'id', tq.id, 'question_text', tq.question_text, 'question_type', tq.question_type,
        'options', tq.options, 'position', tq.position, 'score', tq.score, 'critical', tq.critical
      ) order by tq.position)
      from theme_questions tq
      where tq.theme_id = v_theme_id
    ),
    'positioning_test_completed', (
      select positioning_test_completed from session_trainees
      where session_id = v_session_id and trainee_id = p_trainee_id
    )
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_trainee_with_ssn(p_id uuid)
 RETURNS TABLE(id uuid, first_name text, last_name text, email text, phone text, social_security_number text, client_id uuid, notes text, birth_date date, refused_ssn boolean, has_disability boolean, disability_details text, disability_adaptations text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := app.role();
  v_handi boolean := app.can_see_disability();
begin
  /* société (C2) */ perform app.exiger_societe('trainees', p_id, false);
  if not (v_role = any (array['superadmin', 'admin', 'direction', 'gestionnaire'])
          or (v_role = 'formateur' and p_id in (select app.trainer_trainee_ids()))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return query
  select t.id, t.first_name::text, t.last_name::text, t.email::text, t.phone::text,
         (select repeat('•', 12) || s.fin from public.trainee_ssn s where s.trainee_id = t.id and s.fin is not null),
         t.client_id, t.notes, t.birth_date, t.refused_ssn,
         case when v_handi then coalesce(d.has_disability, false) end,
         case when v_handi then d.details end,
         case when v_handi then d.adaptations end,
         t.created_at, t.updated_at
  from public.trainees t
  left join public.trainee_disability d on d.trainee_id = t.id
  where t.id = p_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.trainee_ssn_capture()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ssn text := nullif(regexp_replace(coalesce(new.social_security_number, ''), '\s', '', 'g'), '');
begin
  if new.id is null then
    new.id := gen_random_uuid();
  end if;
  if coalesce(new.refused_ssn, false) then
    delete from public.trainee_ssn where trainee_id = new.id;
    new.ssn_present := false;
  elsif v_ssn is not null then
    insert into public.trainee_ssn (trainee_id, ssn, updated_at) values (new.id, v_ssn, now())
    on conflict (trainee_id) do update set ssn_chiffre = excluded.ssn_chiffre, fin = excluded.fin, updated_at = now();
    new.ssn_present := true;
  elsif tg_op = 'INSERT' then
    new.ssn_present := false;
  end if;
  new.social_security_number := null;
  new.ssn_encrypted := null;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.info_sheet_ssn_capture()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ssn text := nullif(regexp_replace(coalesce(new.ssn, ''), '\s', '', 'g'), '');
begin
  if coalesce(new.ssn_refused, false) then
    delete from public.trainee_ssn where trainee_id = new.trainee_id;
    update public.trainees set ssn_present = false where id = new.trainee_id and ssn_present;
    new.ssn_present := false;
  elsif v_ssn is not null then
    insert into public.trainee_ssn (trainee_id, ssn, updated_at) values (new.trainee_id, v_ssn, now())
    on conflict (trainee_id) do update set ssn_chiffre = excluded.ssn_chiffre, fin = excluded.fin, updated_at = now();
    update public.trainees set ssn_present = true where id = new.trainee_id and not ssn_present;
    new.ssn_present := true;
  else
    new.ssn_present := exists (select 1 from public.trainee_ssn s where s.trainee_id = new.trainee_id);
  end if;
  new.ssn := null;
  return new;
end
$function$;

-- Reprise du Passeport (api/passeport.js, clé de service) : numéros déchiffrés, jamais pour un compte
create or replace function public.trainee_ssn_a_reprendre()
returns table (trainee_id uuid, ssn text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.trainee_id, extensions.pgp_sym_decrypt(s.ssn_chiffre, app.ssn_cle())
  from public.trainee_ssn s where s.ssn_chiffre is not null
$$;
revoke all on function public.trainee_ssn_a_reprendre() from public, anon, authenticated;
grant execute on function public.trainee_ssn_a_reprendre() to service_role;

insert into public.schema_migrations (version) values ('0502_nir_chiffre') on conflict (version) do nothing;

-- ===== supabase/rollback/0502_nir_chiffre_retour.sql =====
-- Retour arrière de 0502 : numéros remis en clair dans trainee_ssn.ssn (avant de retirer les colonnes), lectures et
-- saisies d'origine, clé retirée du coffre. À faire avec le retour de api/passeport.js (lecture de la table) : sinon la
-- reprise du Passeport ne trouve plus trainee_ssn_a_reprendre et laisse les numéros dans trainee_ssn (sans perte).
drop function if exists public.trainee_ssn_a_reprendre();
alter table public.trainee_ssn drop constraint if exists trainee_ssn_jamais_en_clair;
drop trigger if exists a_trainee_ssn_chiffrer on public.trainee_ssn;
update public.trainee_ssn set ssn = extensions.pgp_sym_decrypt(ssn_chiffre, app.ssn_cle()) where ssn_chiffre is not null;
alter table public.trainee_ssn alter column ssn set not null;

CREATE OR REPLACE FUNCTION public.load_trainee_data(p_token text, p_trainee_id uuid, p_ticket text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session_id uuid;
  v_result json;
  v_trainee record;
  v_info_sheet record;
  v_theme_id uuid;
  v_ssn text;
begin
  v_session_id := app.portal_session_for(p_token, p_trainee_id, p_ticket);

  select * into v_trainee from trainees where id = p_trainee_id;
  select * into v_info_sheet from trainee_info_sheets where session_id = v_session_id and trainee_id = p_trainee_id;
  select c.theme_id into v_theme_id from sessions s join courses c on c.id = s.course_id where s.id = v_session_id;
  select s.ssn into v_ssn from trainee_ssn s where s.trainee_id = p_trainee_id;

  select json_build_object(
    'gender', v_trainee.gender,
    'info_sheet', json_build_object(
      'id', v_info_sheet.id,
      'session_id', v_session_id,
      'trainee_id', p_trainee_id,
      'email', coalesce(v_trainee.email, v_info_sheet.email),
      'ssn', null,
      'ssn_on_file', v_ssn is not null,
      'ssn_last3', case when v_ssn is not null then right(v_ssn, 3) end,
      'ssn_refused', coalesce(v_trainee.refused_ssn, v_info_sheet.ssn_refused, false),
      'csp', coalesce(v_trainee.csp, v_info_sheet.csp),
      'job_title', coalesce(v_trainee.job_title, v_info_sheet.job_title),
      'last_training_year', v_info_sheet.last_training_year,
      'highest_diploma', v_info_sheet.highest_diploma,
      'training_expectations', v_info_sheet.training_expectations,
      'rgpd_consent', v_info_sheet.rgpd_consent,
      'rgpd_consent_date', v_info_sheet.rgpd_consent_date,
      'filled_at', v_info_sheet.filled_at,
      'filled_online', v_info_sheet.filled_online
    ),
    'attendance', (
      select json_agg(row_to_json(a.*))
      from attendance_halfdays a
      where a.session_id = v_session_id and a.trainee_id = p_trainee_id
    ),
    'evaluation', (
      select row_to_json(e.*)
      from trainee_evaluations e
      where e.session_id = v_session_id and e.trainee_id = p_trainee_id
    ),
    'positioning_questions', (
      select json_agg(json_build_object(
        'id', tq.id, 'question_text', tq.question_text, 'question_type', tq.question_type,
        'options', tq.options, 'position', tq.position, 'score', tq.score, 'critical', tq.critical
      ) order by tq.position)
      from theme_questions tq
      where tq.theme_id = v_theme_id
    ),
    'positioning_test_completed', (
      select positioning_test_completed from session_trainees
      where session_id = v_session_id and trainee_id = p_trainee_id
    )
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_trainee_with_ssn(p_id uuid)
 RETURNS TABLE(id uuid, first_name text, last_name text, email text, phone text, social_security_number text, client_id uuid, notes text, birth_date date, refused_ssn boolean, has_disability boolean, disability_details text, disability_adaptations text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := app.role();
  v_handi boolean := app.can_see_disability();
begin
  /* société (C2) */ perform app.exiger_societe('trainees', p_id, false);
  if not (v_role = any (array['superadmin', 'admin', 'direction', 'gestionnaire'])
          or (v_role = 'formateur' and p_id in (select app.trainer_trainee_ids()))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return query
  select t.id, t.first_name::text, t.last_name::text, t.email::text, t.phone::text,
         (select repeat('•', greatest(length(s.ssn) - 3, 0)) || right(s.ssn, 3) from public.trainee_ssn s where s.trainee_id = t.id),
         t.client_id, t.notes, t.birth_date, t.refused_ssn,
         case when v_handi then coalesce(d.has_disability, false) end,
         case when v_handi then d.details end,
         case when v_handi then d.adaptations end,
         t.created_at, t.updated_at
  from public.trainees t
  left join public.trainee_disability d on d.trainee_id = t.id
  where t.id = p_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.trainee_ssn_capture()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ssn text := nullif(regexp_replace(coalesce(new.social_security_number, ''), '\s', '', 'g'), '');
begin
  if new.id is null then
    new.id := gen_random_uuid();
  end if;
  if coalesce(new.refused_ssn, false) then
    delete from public.trainee_ssn where trainee_id = new.id;
    new.ssn_present := false;
  elsif v_ssn is not null then
    insert into public.trainee_ssn (trainee_id, ssn, updated_at) values (new.id, v_ssn, now())
    on conflict (trainee_id) do update set ssn = excluded.ssn, updated_at = now();
    new.ssn_present := true;
  elsif tg_op = 'INSERT' then
    new.ssn_present := false;
  end if;
  new.social_security_number := null;
  new.ssn_encrypted := null;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.info_sheet_ssn_capture()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ssn text := nullif(regexp_replace(coalesce(new.ssn, ''), '\s', '', 'g'), '');
begin
  if coalesce(new.ssn_refused, false) then
    delete from public.trainee_ssn where trainee_id = new.trainee_id;
    update public.trainees set ssn_present = false where id = new.trainee_id and ssn_present;
    new.ssn_present := false;
  elsif v_ssn is not null then
    insert into public.trainee_ssn (trainee_id, ssn, updated_at) values (new.trainee_id, v_ssn, now())
    on conflict (trainee_id) do update set ssn = excluded.ssn, updated_at = now();
    update public.trainees set ssn_present = true where id = new.trainee_id and not ssn_present;
    new.ssn_present := true;
  else
    new.ssn_present := exists (select 1 from public.trainee_ssn s where s.trainee_id = new.trainee_id);
  end if;
  new.ssn := null;
  return new;
end
$function$;

alter table public.trainee_ssn drop column if exists ssn_chiffre;
alter table public.trainee_ssn drop column if exists fin;
drop function if exists app.trainee_ssn_chiffrer();
drop function if exists app.ssn_cle();
delete from vault.secrets where name = 'odet_trainee_ssn';

delete from public.schema_migrations where version = '0502_nir_chiffre';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE nir_chiffre_0502 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

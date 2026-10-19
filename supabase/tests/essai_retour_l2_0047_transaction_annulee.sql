-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (l2_0047) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0047_comptes_externes.sql, retour arrière,
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

-- ===== supabase/migrations/0047_comptes_externes.sql =====
-- 0047_comptes_externes.sql : comptes formateur externe et stagiaire (lot 2, branche comptes-externes).
--
-- Spec : odet-lot2-spec.md v2, section 7. Comme le compte entreprise (0046), ces comptes n'ont aucun droit sur les
-- tables : tout passe par des fonctions de la base qui commencent par une garde et ne renvoient que leur périmètre.
-- 1. profiles.trainee_id (unique) : compte stagiaire relié à sa fiche ; profiles.trainer_id existe déjà.
-- 2 bis. Règle profiles_lire : chaque compte lit aussi sa propre ligne (les comptes externes en ont besoin pour se connecter).
-- 2. Garde des liens du profil : trainer_id, trainee_id et is_active ne se changent que par un compte qui gère les
--    utilisateurs, ou par le serveur. Jusqu'ici un compte pouvait modifier sa propre ligne (règle profiles_modifier :
--    id = auth.uid()) et donc se rattacher à une autre fiche formateur ou se réactiver lui-même.
-- 3. Formateur externe (rôle formateur_externe) : ext_sessions() (ses sessions, comme formateur principal ou
--    associé : dates, lieu, programme, stagiaires ; jamais de prix, de facture ni de numéro de sécurité sociale),
--    ext_justificatifs() (ses certificats et, s'il est rattaché à un prestataire, l'état des justificatifs de
--    celui-ci), ext_org().
-- 4. Stagiaire (rôle stagiaire) : stg_sessions() (ses sessions, son résultat, ses demi-journées, son évaluation),
--    stg_org(). Création du compte par le stagiaire depuis le portail (code de sa convocation, contrôlé par le
--    serveur) ou par l'organisme (lien affiché, aucun email envoyé) : /api/comptes-externes.
-- 5. acces_externe_etat(type, fiche) : compte relié à une fiche formateur ou stagiaire, pour les fiches de l'organisme.
-- Aucune table nouvelle. Migration additive. Idempotente. Retour arrière : supabase/rollback/0047_comptes_externes_retour.sql

alter table public.profiles add column if not exists trainee_id uuid references public.trainees(id) on delete set null;
create unique index if not exists profiles_trainee_id_key on public.profiles (trainee_id) where trainee_id is not null;

-- ── 2. Garde des liens du profil ──
create or replace function app.profiles_liens_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.trainer_id is distinct from old.trainer_id or new.trainee_id is distinct from old.trainee_id
      or new.is_active is distinct from old.is_active)
     and (select auth.uid()) is not null
     and not app.a_le_droit('parametres.utilisateurs.gerer') and not app.a_le_droit('plateforme.administrer') then
    raise exception 'Seul un compte qui gère les utilisateurs peut changer la fiche reliée ou l''activation d''un compte'
      using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.profiles_liens_garde() from public, anon, authenticated;
drop trigger if exists profiles_liens_garde on public.profiles;
create trigger profiles_liens_garde before update on public.profiles for each row execute function app.profiles_liens_garde();

-- ── Lecture de son propre profil ──
-- Les comptes externes (entreprise, formateur externe, stagiaire) n'ont pas le droit de voir les comptes : sans leur
-- propre ligne, l'application ne lit pas leur profil à la connexion et les déconnecte. La règle de lecture des
-- profils (matrice, scripts/securite/regles.py) devient : sa propre ligne, ou le droit de voir les comptes.
drop policy if exists profiles_lire on public.profiles;
create policy profiles_lire on public.profiles for select to authenticated
  using ((id = (select auth.uid()) or (select app.a_le_droit('organisation.comptes.voir'))));

-- ── Identité de l'organisme pour les documents (champs de l'espace par code), d'une société ──
create or replace function app.org_documents(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o jsonb := to_jsonb(app.identite_societe(p_company));
  v_ref jsonb := public.referent_handicap_info();
  k text;
  r jsonb := '{}'::jsonb;
begin
  foreach k in array array['name', 'legal_name', 'forme_juridique', 'app_short_name', 'address', 'postal_code', 'city', 'lieu_signature',
    'phone', 'email', 'website', 'siret', 'siren', 'naf', 'tva_intra', 'tva_applicable', 'nda', 'nda_region',
    'dirigeant_name', 'dirigeant_title', 'dirigeant_signature_url', 'logo_url', 'stamp_base64', 'brand_primary', 'brand_accent',
    'brand_highlight', 'doc_prefix', 'qualiopi_certified', 'activity_kind'] loop
    if o ? k then r := r || jsonb_build_object(k, o -> k); end if;
  end loop;
  return r || jsonb_build_object('referent_handicap_nom', v_ref ->> 'nom', 'referent_handicap_email', v_ref ->> 'email',
                                 'referent_handicap_phone', v_ref ->> 'phone');
end
$$;
revoke all on function app.org_documents(uuid) from public, anon, authenticated;

-- ── 3. Formateur externe ──
create or replace function app.ext_formateur()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v uuid;
begin
  select p.trainer_id into v from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'formateur_externe' and coalesce(p.is_active, true) and p.trainer_id is not null;
  if v is null then raise exception 'Espace formateur : compte inconnu ou désactivé' using errcode = '42501'; end if;
  return v;
end
$$;
revoke all on function app.ext_formateur() from public, anon;
grant execute on function app.ext_formateur() to authenticated;

create or replace function public.ext_sessions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_t uuid := app.ext_formateur();
begin
  return jsonb_build_object(
    'trainer', (select jsonb_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name) from public.trainers t where t.id = v_t),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'reference', s.reference, 'start_date', s.start_date, 'end_date', s.end_date, 'start_time', s.start_time,
        'end_time', s.end_time, 'day_type', s.day_type, 'status', s.status, 'session_type', s.session_type,
        'location_name', s.location_name, 'location_address', s.location_address, 'location_postal_code', s.location_postal_code,
        'location_city', s.location_city, 'location_details', s.location_details, 'room', s.room,
        'is_remote', s.is_remote, 'remote_link', s.remote_link, 'principal', s.trainer_id = v_t,
        'client', (select jsonb_build_object('name', c.name, 'city', c.city) from public.clients c where c.id = s.client_id),
        'courses', (select jsonb_build_object('id', co.id, 'title', co.title, 'objectives', co.objectives, 'content', co.content,
            'program', co.program, 'program_url', co.program_url, 'duration_hours', co.duration_hours, 'duration_days', co.duration_days,
            'duration', co.duration, 'target_audience', co.target_audience, 'prerequisites', co.prerequisites, 'material', co.material,
            'trainer_equipment', co.trainer_equipment, 'teaching_methods', co.teaching_methods, 'evaluation_methods', co.evaluation_methods)
          from public.courses co where co.id = s.course_id),
        'trainers', (select jsonb_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name) from public.trainers t where t.id = s.trainer_id),
        'session_trainees', coalesce((
          select jsonb_agg(jsonb_build_object('trainee_id', st.trainee_id, 'result', st.result, 'absent', coalesce(st.absent, false),
            'trainees', jsonb_build_object('id', tr.id, 'first_name', tr.first_name, 'last_name', tr.last_name, 'gender', tr.gender,
              'job_title', tr.job_title))
            order by tr.last_name, tr.first_name)
          from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id where st.session_id = s.id), '[]'::jsonb)
      ) order by s.start_date desc)
      from public.sessions s
      where s.trainer_id = v_t or exists (select 1 from public.session_trainers x where x.session_id = s.id and x.trainer_id = v_t)
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.ext_justificatifs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t uuid := app.ext_formateur();
  v_st uuid;
begin
  if to_regclass('public.subcontractors') is not null then
    execute 'select subcontractor_id from public.trainers where id = $1' into v_st using v_t;
  end if;
  return jsonb_build_object(
    'certificats', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(c.name, c.custom_type, c.certificate_type), 'issuer', c.issuer,
                       'obtained', coalesce(c.obtained_date, c.issue_date), 'expiry_date', c.expiry_date, 'no_expiry', c.no_expiry,
                       'status', case when c.no_expiry or c.expiry_date is null then 'a_jour' when c.expiry_date < current_date then 'perime'
                                      when c.expiry_date <= current_date + 60 then 'a_renouveler' else 'a_jour' end)
                       order by c.expiry_date nulls last)
      from public.trainer_certificates c where c.trainer_id = v_t), '[]'::jsonb),
    'prestataire', case when v_st is null then null else (
      select jsonb_build_object('name', min(v.subcontractor_name),
             'justificatifs', jsonb_agg(jsonb_build_object('label', v.label, 'status', v.status, 'valid_until', v.valid_until) order by v.label))
      from public.v_subcontractor_compliance v where v.subcontractor_id = v_st) end
  );
end
$$;

create or replace function public.ext_org()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_t uuid := app.ext_formateur();
begin
  return app.org_documents((select t.company_id from public.trainers t where t.id = v_t));
end
$$;

-- ── 4. Stagiaire ──
create or replace function app.stg_stagiaire()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v uuid;
begin
  select p.trainee_id into v from public.profiles p
  where p.id = (select auth.uid()) and p.role = 'stagiaire' and coalesce(p.is_active, true) and p.trainee_id is not null;
  if v is null then raise exception 'Espace stagiaire : compte inconnu ou désactivé' using errcode = '42501'; end if;
  return v;
end
$$;
revoke all on function app.stg_stagiaire() from public, anon;
grant execute on function app.stg_stagiaire() to authenticated;

create or replace function public.stg_sessions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_tr uuid := app.stg_stagiaire();
begin
  return jsonb_build_object(
    'trainee', (select jsonb_build_object('id', tr.id, 'first_name', tr.first_name, 'last_name', tr.last_name, 'gender', tr.gender,
                  'email', tr.email, 'job_title', tr.job_title,
                  'client', (select jsonb_build_object('name', c.name) from public.clients c where c.id = tr.client_id))
                from public.trainees tr where tr.id = v_tr),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'reference', s.reference, 'start_date', s.start_date, 'end_date', s.end_date, 'start_time', s.start_time,
        'end_time', s.end_time, 'day_type', s.day_type, 'status', s.status, 'session_type', s.session_type,
        'location_name', s.location_name, 'location_address', s.location_address, 'location_postal_code', s.location_postal_code,
        'location_city', s.location_city, 'is_remote', s.is_remote, 'remote_link', s.remote_link, 'attendance_token', s.attendance_token,
        'clients', (select jsonb_build_object('name', c.name, 'address', c.address, 'postal_code', c.postal_code, 'city', c.city, 'siret', c.siret)
                    from public.clients c where c.id = s.client_id),
        'courses', (select jsonb_build_object('id', co.id, 'title', co.title, 'objectives', co.objectives, 'content', co.content,
            'program', co.program, 'program_url', co.program_url, 'duration_hours', co.duration_hours, 'duration_days', co.duration_days,
            'duration', co.duration, 'prerequisites', co.prerequisites, 'material', co.material)
          from public.courses co where co.id = s.course_id),
        'trainers', (select jsonb_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name) from public.trainers t where t.id = s.trainer_id),
        'result', st.result, 'absent', coalesce(st.absent, false), 'access_code', st.access_code,
        'presence_hours', st.presence_hours, 'early_departure', coalesce(st.early_departure, false),
        'departure_date', st.departure_date, 'departure_time', st.departure_time, 'arrival_date', st.arrival_date, 'arrival_time', st.arrival_time,
        'halfdays', coalesce((select jsonb_agg(jsonb_build_object('trainee_id', h.trainee_id, 'date', h.date, 'morning', h.morning, 'afternoon', h.afternoon) order by h.date)
                              from public.attendance_halfdays h where h.session_id = s.id and h.trainee_id = v_tr), '[]'::jsonb),
        'evaluation_done', exists (select 1 from public.trainee_evaluations e where e.session_id = s.id and e.trainee_id = v_tr
                                   and coalesce(e.questionnaire_submitted, e.submitted_online, false)),
        'sst_certified', exists (select 1 from public.sst_certifications c where c.session_id = s.id and c.trainee_id = v_tr and c.candidat_certifie)
      ) order by s.start_date desc)
      from public.session_trainees st join public.sessions s on s.id = st.session_id
      where st.trainee_id = v_tr
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.stg_org()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_tr uuid := app.stg_stagiaire();
begin
  return app.org_documents((select tr.company_id from public.trainees tr where tr.id = v_tr));
end
$$;

-- ── 5. Compte relié à une fiche formateur ou stagiaire (fiches de l'organisme) ──
create or replace function public.acces_externe_etat(p_kind text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare r jsonb;
begin
  if p_kind = 'formateur' then
    if not exists (select 1 from public.trainers t where t.id = p_id and t.company_id in (select app.societes_avec_droit('formation.formateurs.voir'))) then
      raise exception 'Accès refusé' using errcode = '42501';
    end if;
    select jsonb_build_object('profile_id', p.id, 'email', p.email, 'role', p.role, 'is_active', p.is_active, 'last_seen_at', p.last_seen_at)
      into r from public.profiles p where p.trainer_id = p_id order by p.created_at limit 1;
  elsif p_kind = 'stagiaire' then
    if not exists (select 1 from public.trainees t where t.id = p_id and t.company_id in (select app.societes_avec_droit('formation.stagiaires.voir'))) then
      raise exception 'Accès refusé' using errcode = '42501';
    end if;
    select jsonb_build_object('profile_id', p.id, 'email', p.email, 'role', p.role, 'is_active', p.is_active, 'last_seen_at', p.last_seen_at)
      into r from public.profiles p where p.trainee_id = p_id;
  else
    raise exception 'Type inconnu' using errcode = '22023';
  end if;
  return r;
end
$$;
revoke all on function public.acces_externe_etat(text, uuid) from public, anon;
grant execute on function public.acces_externe_etat(text, uuid) to authenticated;

do $$
declare f text;
begin
  foreach f in array array['ext_sessions()', 'ext_justificatifs()', 'ext_org()', 'stg_sessions()', 'stg_org()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0047_comptes_externes') on conflict (version) do nothing;

-- ===== supabase/rollback/0047_comptes_externes_retour.sql =====
-- Retour arrière de 0047_comptes_externes.sql : retire les fonctions des comptes formateur externe et stagiaire, la
-- garde des liens du profil, la lecture de son propre profil et la colonne profiles.trainee_id. Idempotent.
-- Refusé si un compte est relié à une fiche stagiaire.

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'trainee_id') then
    if exists (select 1 from public.profiles where trainee_id is not null) then
      raise exception 'Retour arrière refusé : des comptes stagiaires sont reliés à leur fiche';
    end if;
  end if;
end $$;

drop function if exists public.acces_externe_etat(text, uuid);
drop function if exists public.stg_org();
drop function if exists public.stg_sessions();
drop function if exists app.stg_stagiaire();
drop function if exists public.ext_org();
drop function if exists public.ext_justificatifs();
drop function if exists public.ext_sessions();
drop function if exists app.ext_formateur();
drop function if exists app.org_documents(uuid);
drop trigger if exists profiles_liens_garde on public.profiles;
drop function if exists app.profiles_liens_garde();

drop policy if exists profiles_lire on public.profiles;
create policy profiles_lire on public.profiles for select to authenticated
  using ((select app.a_le_droit('organisation.comptes.voir')));

drop index if exists public.profiles_trainee_id_key;
alter table public.profiles drop column if exists trainee_id;

delete from public.schema_migrations where version = '0047_comptes_externes';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE l2_0047 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

-- 0083_securite_numero_secu.sql : le numéro de sécurité sociale quitte les tables lisibles (chantier 2, Q3).
-- Avant : le numéro était une colonne de trainees et de trainee_info_sheets, lisible par tout compte
-- connecté et renvoyé en entier par le portail stagiaire avec le seul jeton de session.
-- Après :
--   * le numéro vit dans la table trainee_ssn, sans aucune règle d'accès : seules les fonctions
--     contrôlées par rôle le lisent ou l'écrivent ;
--   * partout dans l'application, le numéro n'est affiché que masqué (3 derniers chiffres au plus,
--     décision du 14/10) : get_trainee_with_ssn renvoie la forme masquée ; le numéro complet ne sort
--     que côté serveur (déclaration Passeport de prévention) ;
--   * les anciennes colonnes restent (aucun code existant ne casse) mais un déclencheur déplace
--     toute valeur écrite vers trainee_ssn et les remet à vide ;
--   * trainees.ssn_present et trainee_info_sheets.ssn_present disent seulement si le numéro est connu ;
--   * get_trainee_with_ssn (lecture) : direction, gestion et formateur de la session ;
--     save_trainee_with_ssn (écriture) : personnel autorisé à modifier le stagiaire.
-- La fonction save_trainee_with_ssn écrivait un texte chiffré avec une clé écrite en dur, illisible
-- ensuite : elle enregistre désormais le numéro saisi.
-- Migration idempotente. Retour arrière : supabase/rollback/0080-0087_securite_retour.sql (les huit migrations ensemble)

create table if not exists public.trainee_ssn (
  trainee_id uuid primary key references public.trainees(id) on delete cascade deferrable initially deferred,
  ssn text not null,
  updated_at timestamptz not null default now()
);
alter table public.trainee_ssn enable row level security;
revoke all on table public.trainee_ssn from public, anon, authenticated;
grant all on table public.trainee_ssn to service_role;

alter table public.trainees add column if not exists ssn_present boolean not null default false;
alter table public.trainee_info_sheets add column if not exists ssn_present boolean not null default false;

-- Reprise des numéros déjà saisis (aucun au 14/10/2026 sur odet-gld)
insert into public.trainee_ssn (trainee_id, ssn)
select t.id, regexp_replace(t.social_security_number, '\s', '', 'g')
from public.trainees t
where nullif(trim(t.social_security_number), '') is not null
on conflict (trainee_id) do nothing;

insert into public.trainee_ssn (trainee_id, ssn)
select distinct on (i.trainee_id) i.trainee_id, regexp_replace(i.ssn, '\s', '', 'g')
from public.trainee_info_sheets i
where nullif(trim(i.ssn), '') is not null
order by i.trainee_id, i.filled_at desc nulls last
on conflict (trainee_id) do nothing;

-- Déclencheur sur trainees : le numéro écrit part dans trainee_ssn
create or replace function public.trainee_ssn_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
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

-- La clé étrangère de trainee_ssn est vérifiée en fin de transaction : à l'insertion d'un stagiaire,
-- son numéro peut être rangé avant que la ligne trainees n'existe.
drop trigger if exists a_trainee_ssn_capture on public.trainees;
create trigger a_trainee_ssn_capture before insert or update on public.trainees
  for each row execute function public.trainee_ssn_capture();

-- Déclencheur sur trainee_info_sheets : même règle, rattachée au stagiaire
create or replace function public.info_sheet_ssn_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
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

drop trigger if exists a_info_sheet_ssn_capture on public.trainee_info_sheets;
create trigger a_info_sheet_ssn_capture before insert or update on public.trainee_info_sheets
  for each row execute function public.info_sheet_ssn_capture();

-- Les numéros déjà présents sortent des colonnes lisibles
update public.trainees t set
  ssn_present = exists (select 1 from public.trainee_ssn s where s.trainee_id = t.id) and not coalesce(t.refused_ssn, false),
  social_security_number = null,
  ssn_encrypted = null
where t.social_security_number is not null or t.ssn_encrypted is not null
   or t.ssn_present is distinct from (exists (select 1 from public.trainee_ssn s where s.trainee_id = t.id) and not coalesce(t.refused_ssn, false));

update public.trainee_info_sheets i set
  ssn_present = exists (select 1 from public.trainee_ssn s where s.trainee_id = i.trainee_id),
  ssn = null
where i.ssn is not null
   or i.ssn_present is distinct from exists (select 1 from public.trainee_ssn s where s.trainee_id = i.trainee_id);

-- Complétude : « Numéro SS manquant » lit désormais ssn_present
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.detect_completude_blockers()'::regprocedure) into v_def;
  if position('ssn_present' in v_def) = 0 then
    v_def := replace(v_def, 'AND (t.social_security_number IS NULL OR t.social_security_number = '''')', 'AND NOT coalesce(t.ssn_present, false)');
    v_def := replace(v_def, '(t.social_security_number IS NOT NULL AND t.social_security_number != '''')', 'coalesce(t.ssn_present, false)');
    if position('social_security_number' in v_def) > 0 then
      raise exception 'detect_completude_blockers : remplacement incomplet';
    end if;
    execute v_def;
  end if;
end $$;

-- Lecture du numéro, masqué (3 derniers chiffres), par le personnel autorisé
create or replace function public.get_trainee_with_ssn(p_id uuid)
returns table(id uuid, first_name text, last_name text, email text, phone text, social_security_number text,
              client_id uuid, notes text, birth_date date, refused_ssn boolean, has_disability boolean,
              disability_details text, disability_adaptations text, created_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_role text := app.role();
begin
  if not (v_role = any (array['superadmin', 'admin', 'direction', 'gestionnaire'])
          or (v_role = 'formateur' and p_id in (select app.trainer_trainee_ids()))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return query
  select t.id, t.first_name::text, t.last_name::text, t.email::text, t.phone::text,
         (select repeat('•', greatest(length(s.ssn) - 3, 0)) || right(s.ssn, 3) from public.trainee_ssn s where s.trainee_id = t.id),
         t.client_id, t.notes, t.birth_date, t.refused_ssn, t.has_disability,
         t.disability_details, t.disability_adaptations, t.created_at, t.updated_at
  from public.trainees t
  where t.id = p_id;
end
$function$;

-- Écriture d'un stagiaire avec son numéro par le personnel autorisé
create or replace function public.save_trainee_with_ssn(
  p_id uuid, p_first_name text, p_last_name text, p_email text default null, p_phone text default null,
  p_ssn text default null, p_client_id uuid default null, p_notes text default null, p_birth_date date default null,
  p_refused_ssn boolean default false, p_has_disability boolean default false, p_disability_details text default null,
  p_disability_adaptations text default null, p_csp text default null, p_job_title text default null,
  p_gender text default null)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_role text := app.role();
begin
  if not (v_role = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial'])
          or (v_role = 'formateur' and p_id in (select app.trainer_trainee_ids()))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.trainees set
    first_name = p_first_name,
    last_name = p_last_name,
    email = p_email,
    phone = p_phone,
    social_security_number = case when coalesce(p_refused_ssn, false) then null else nullif(trim(p_ssn), '') end,
    client_id = p_client_id,
    notes = p_notes,
    birth_date = p_birth_date,
    refused_ssn = coalesce(p_refused_ssn, false),
    has_disability = coalesce(p_has_disability, false),
    disability_details = p_disability_details,
    disability_adaptations = p_disability_adaptations,
    csp = coalesce(p_csp, csp),
    job_title = coalesce(p_job_title, job_title),
    gender = coalesce(p_gender, gender),
    updated_at = now()
  where id = p_id;
end
$function$;

-- Vues : plus de numéro en clair
create or replace view public.trainees_safe with (security_invoker = true) as
select id, first_name, last_name, email, phone,
       case when ssn_present then '***-**-*****'::text else null::text end as social_security_number_masked,
       ssn_present as has_ssn,
       client_id, notes, birth_date, refused_ssn, has_disability, disability_details, disability_adaptations,
       created_at, updated_at
from public.trainees;

create or replace view public.v_trainee_session_complete with (security_invoker = true) as
select st.id as session_trainee_id, st.session_id, st.trainee_id, t.first_name, t.last_name,
  (((t.first_name)::text || ' '::text) || (t.last_name)::text) as full_name,
  t.email, t.phone, t.birth_date, t.birth_place, t.address, t.postal_code, t.city,
  null::character varying(15) as social_security_number,
  t.refused_ssn, t.job_title, t.csp, t.gender, t.has_disability, t.disability_details, t.disability_adaptations,
  t.client_id, c.name as client_name, s.reference as session_reference, s.start_date, s.end_date,
  s.status as session_status, s.location_name, s.course_id, co.title as course_title, co.duration_hours,
  st.registration_date, st.result, st.presence_complete, st.early_departure, st.departure_date,
  st.departure_reason, st.admin_observation, st.remediation_proposal, st.access_code, st.forprev_card_sent,
  st.certificate_sent_individual, st.cold_eval_sent_individual, tis.id as info_sheet_id,
  tis.training_expectations, tis.last_training_year, tis.highest_diploma, tis.rgpd_consent,
  tis.rgpd_consent_date, tis.filled_at as info_sheet_filled_at, tis.filled_online as info_sheet_filled_online
from session_trainees st
  join trainees t on t.id = st.trainee_id
  join sessions s on s.id = st.session_id
  left join clients c on c.id = t.client_id
  left join courses co on co.id = s.course_id
  left join trainee_info_sheets tis on tis.trainee_id = st.trainee_id and tis.session_id = st.session_id;
revoke all on public.trainees_safe, public.v_trainee_session_complete from anon;

insert into public.schema_migrations (version) values ('0083_securite_numero_secu') on conflict (version) do nothing;

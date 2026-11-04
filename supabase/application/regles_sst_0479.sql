-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (regles_sst_0479) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0479_regles_effectif_prerequis.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0479_regles_effectif_prerequis_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0479_regles_effectif_prerequis.sql =====
-- 0479 : effectif imposé et prérequis de certificat (règles SST des CGV formation, décision de H du 04/11).
-- Les CGV formation (version 3, fin de l'article 8) fixent pour le SST un groupe de 4 à 10 participants par formateur
-- (document de référence de l'INRS) et, pour le MAC, la copie du certificat de chaque participant, accepté jusqu'à
-- 6 mois après la fin de validité. Rien n'est écrit en dur pour une formation : ce sont deux réglages de la fiche
-- formation, que l'organisme active là où un référentiel l'impose.
-- 1. courses.effectif_strict : le maximum de la formation ne se dépasse jamais (ni la session, ni les inscrits).
-- 2. courses.prerequis_certificat_mois : un certificat est exigé ; tolérance en mois après sa fin de validité.
-- 3. session_trainees : date de fin de validité du certificat présenté, copie (stockage privé), contrôle.
-- 4. Contrôle en base : une inscription au-delà du maximum d'une formation à effectif imposé est refusée,
--    quel que soit l'écran (fiche session, devis, circuit, espace entreprise, inscription confirmée).
-- Additive. Idempotente. Retour arrière : supabase/rollback/0479_regles_effectif_prerequis_retour.sql

-- ── 1 et 2. Réglages de la formation ──
alter table public.courses add column if not exists effectif_strict boolean not null default false;
alter table public.courses add column if not exists prerequis_certificat_mois integer;
alter table public.courses drop constraint if exists courses_prerequis_certificat_mois_check;
alter table public.courses add constraint courses_prerequis_certificat_mois_check
  check (prerequis_certificat_mois is null or prerequis_certificat_mois between 0 and 24);
comment on column public.courses.effectif_strict is 'Effectif imposé par un référentiel (ex. SST : 4 à 10 par formateur) : le maximum de la formation ne se dépasse pas';
comment on column public.courses.prerequis_certificat_mois is 'Certificat exigé à l''entrée (ex. MAC SST) ; nombre de mois tolérés après sa fin de validité (null : aucun certificat exigé)';

-- ── 3. Certificat présenté par le participant ──
alter table public.session_trainees add column if not exists prerequis_valid_until date;
alter table public.session_trainees add column if not exists prerequis_file_path text;
alter table public.session_trainees add column if not exists prerequis_checked_at timestamptz;
alter table public.session_trainees add column if not exists prerequis_checked_by uuid;
alter table public.session_trainees drop constraint if exists session_trainees_prerequis_file_path_check;
alter table public.session_trainees add constraint session_trainees_prerequis_file_path_check
  check (prerequis_file_path is null or prerequis_file_path like 'prerequis/%');
comment on column public.session_trainees.prerequis_valid_until is 'Fin de validité du certificat présenté à l''entrée (ex. certificat SST pour un MAC)';
comment on column public.session_trainees.prerequis_file_path is 'Copie du certificat, bucket privé « documents », dossier prerequis/';

-- ── 4. Contrôles en base ──
create or replace function app.effectif_strict_max(p_session uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(co.effectif_strict, false) then co.max_participants end
  from public.sessions se join public.courses co on co.id = se.course_id
  where se.id = p_session
$$;

create or replace function app.controle_effectif_inscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max int;
  v_n int;
begin
  if coalesce(new.absent, false) then return new; end if;
  if tg_op = 'UPDATE' and new.session_id is not distinct from old.session_id and not coalesce(old.absent, false) then
    return new;
  end if;
  v_max := app.effectif_strict_max(new.session_id);
  if v_max is null then return new; end if;
  select count(*) into v_n from public.session_trainees st
   where st.session_id = new.session_id and not coalesce(st.absent, false) and st.id is distinct from new.id;
  if v_n >= v_max then
    raise exception 'Cette formation est limitée à % participants par formateur (référentiel) : créez une seconde session, chaque groupe comptant au moins le minimum de la formation', v_max
      using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists session_trainees_effectif_strict on public.session_trainees;
create trigger session_trainees_effectif_strict
  before insert or update of session_id, absent on public.session_trainees
  for each row execute function app.controle_effectif_inscription();

create or replace function app.controle_effectif_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max int;
begin
  if new.course_id is null or new.max_participants is null then return new; end if;
  select case when coalesce(co.effectif_strict, false) then co.max_participants end into v_max
    from public.courses co where co.id = new.course_id;
  if v_max is not null and new.max_participants > v_max then
    raise exception 'Cette formation est limitée à % participants par formateur (référentiel) : au-delà, créez une seconde session', v_max
      using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists sessions_effectif_strict on public.sessions;
create trigger sessions_effectif_strict
  before insert or update of max_participants, course_id on public.sessions
  for each row execute function app.controle_effectif_session();

insert into public.schema_migrations (version) values ('0479_regles_effectif_prerequis') on conflict (version) do nothing;

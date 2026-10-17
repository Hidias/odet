-- 0087_securite_handicap.sql : les données de handicap quittent les tables lisibles (chantier 2, ajout du
-- chantier F du 17/10/2026, écart n° 8 de odet-conformite-rgpd-certifications.md).
-- Avant : has_disability, disability_details et disability_adaptations étaient des colonnes de trainees,
-- lisibles par tout compte qui voit les stagiaires ; le registre PSH était lisible par tout le personnel.
-- Après :
--   * ces données vivent dans trainee_disability, lisible et modifiable seulement par la direction
--     (superadmin, admin, direction) et le référent handicap désigné dans Qualité > Référents
--     (app.can_see_disability, 0081) ; même règle pour psh_requests (0082) ;
--   * les colonnes de trainees restent (aucun code existant ne casse) : un déclencheur range toute valeur
--     écrite dans trainee_disability puis les remet à vide. Il AJOUTE seulement (case cochée, texte
--     saisi) : un compte qui ne voit pas ces données ne peut pas les effacer en enregistrant une fiche ;
--   * save_trainee_with_ssn : la direction et le référent écrivent exactement ce que montre la fiche
--     (y compris décocher ou vider) ; les autres comptes ne peuvent qu'ajouter ;
--   * get_trainee_with_ssn ne renvoie ces données qu'à la direction et au référent ;
--   * disability_count donne le nombre de stagiaires concernés (sans identité) au personnel, pour les
--     statistiques et les preuves Qualiopi (indicateur 26).
-- Aucun stagiaire réel au 17/10/2026 (0 ligne avec handicap sur odet-gld).
-- Migration idempotente. Retour arrière : supabase/rollback/0080-0087_securite_retour.sql

create table if not exists public.trainee_disability (
  trainee_id uuid primary key references public.trainees(id) on delete cascade deferrable initially deferred,
  has_disability boolean not null default false,
  details text,
  adaptations text,
  updated_at timestamptz not null default now()
);
alter table public.trainee_disability enable row level security;
revoke all on table public.trainee_disability from public, anon, authenticated;
grant select, insert, update, delete on table public.trainee_disability to authenticated;
grant all on table public.trainee_disability to service_role;

drop policy if exists trainee_disability_lire on public.trainee_disability;
drop policy if exists trainee_disability_creer on public.trainee_disability;
drop policy if exists trainee_disability_modifier on public.trainee_disability;
drop policy if exists trainee_disability_supprimer on public.trainee_disability;
create policy trainee_disability_lire on public.trainee_disability for select to authenticated
  using ((select app.can_see_disability()));
create policy trainee_disability_creer on public.trainee_disability for insert to authenticated
  with check ((select app.can_see_disability()));
create policy trainee_disability_modifier on public.trainee_disability for update to authenticated
  using ((select app.can_see_disability())) with check ((select app.can_see_disability()));
create policy trainee_disability_supprimer on public.trainee_disability for delete to authenticated
  using ((select app.can_see_disability()));

-- Reprise des données déjà saisies
insert into public.trainee_disability (trainee_id, has_disability, details, adaptations)
select t.id, coalesce(t.has_disability, false), nullif(trim(t.disability_details), ''), nullif(trim(t.disability_adaptations), '')
from public.trainees t
where coalesce(t.has_disability, false)
   or nullif(trim(t.disability_details), '') is not null
   or nullif(trim(t.disability_adaptations), '') is not null
on conflict (trainee_id) do nothing;

-- Déclencheur sur trainees : ce qui est écrit part dans trainee_disability (ajout seulement)
create or replace function public.trainee_disability_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_details text := nullif(trim(coalesce(new.disability_details, '')), '');
  v_adapt text := nullif(trim(coalesce(new.disability_adaptations, '')), '');
begin
  if new.id is null then
    new.id := gen_random_uuid();
  end if;
  if coalesce(new.has_disability, false) or v_details is not null or v_adapt is not null then
    insert into public.trainee_disability (trainee_id, has_disability, details, adaptations, updated_at)
    values (new.id, true, v_details, v_adapt, now())
    on conflict (trainee_id) do update set
      has_disability = true,
      details = coalesce(excluded.details, public.trainee_disability.details),
      adaptations = coalesce(excluded.adaptations, public.trainee_disability.adaptations),
      updated_at = now();
  end if;
  new.has_disability := false;
  new.disability_details := null;
  new.disability_adaptations := null;
  return new;
end
$function$;
revoke all on function public.trainee_disability_capture() from public, anon, authenticated;

drop trigger if exists a_trainee_disability_capture on public.trainees;
create trigger a_trainee_disability_capture before insert or update on public.trainees
  for each row execute function public.trainee_disability_capture();

-- Les valeurs déjà présentes sortent des colonnes lisibles
update public.trainees set has_disability = false, disability_details = null, disability_adaptations = null
where coalesce(has_disability, false) or disability_details is not null or disability_adaptations is not null;

-- La fiche sait si le compte connecté peut voir ces données (texte d'aide à l'écran)
create or replace function public.can_see_disability()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.can_see_disability() $$;
revoke all on function public.can_see_disability() from public, anon;
grant execute on function public.can_see_disability() to authenticated, service_role;

-- Nombre de stagiaires concernés, sans identité (statistiques, preuves de l'indicateur 26)
create or replace function public.disability_count(p_trainee_ids uuid[] default null)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.is_staff() then
    (select count(*) from public.trainee_disability d
     where d.has_disability and (p_trainee_ids is null or d.trainee_id = any (p_trainee_ids)))
  else 0 end
$$;
revoke all on function public.disability_count(uuid[]) from public, anon;
grant execute on function public.disability_count(uuid[]) to authenticated, service_role;

-- Nombre de demandes du registre PSH, sans contenu (preuve de l'indicateur 26)
create or replace function public.psh_request_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$ select case when app.is_staff() then (select count(*) from public.psh_requests) else 0 end $$;
revoke all on function public.psh_request_count() from public, anon;
grant execute on function public.psh_request_count() to authenticated, service_role;

-- Lecture d'un stagiaire : handicap seulement pour la direction et le référent
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
  v_handi boolean := app.can_see_disability();
begin
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

-- Écriture d'un stagiaire : la direction et le référent écrivent exactement le handicap montré par la fiche
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
  v_details text := nullif(trim(coalesce(p_disability_details, '')), '');
  v_adapt text := nullif(trim(coalesce(p_disability_adaptations, '')), '');
begin
  if not (v_role = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial'])
          or (v_role = 'formateur' and p_id in (select app.trainer_trainee_ids()))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  -- Le déclencheur range le numéro et ajoute le handicap saisi
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
  -- Direction et référent : la fiche montre les données, elle les remplace (décocher efface)
  if app.can_see_disability() then
    if coalesce(p_has_disability, false) or v_details is not null or v_adapt is not null then
      insert into public.trainee_disability (trainee_id, has_disability, details, adaptations, updated_at)
      values (p_id, coalesce(p_has_disability, false), v_details, v_adapt, now())
      on conflict (trainee_id) do update set
        has_disability = excluded.has_disability, details = excluded.details,
        adaptations = excluded.adaptations, updated_at = now();
    else
      delete from public.trainee_disability where trainee_id = p_id;
    end if;
  end if;
end
$function$;

insert into public.schema_migrations (version) values ('0087_securite_handicap') on conflict (version) do nothing;

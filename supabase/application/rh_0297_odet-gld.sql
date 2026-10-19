-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (rh_0297) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0297_rh_heures.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0297_rh_heures_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0297_rh_heures.sql =====
-- 0297_rh_heures.sql : chantier 12, module RH, heures (spec odet-spec-rh.md § 2, 3.5, 5, branche rh/heures).
--
-- Pointage par jour (hr_time_entries) et semaine (hr_timesheets). Une seule source : les lignes sont proposées depuis
-- les visites d'intervention du technicien et les sessions du formateur (hr_semaine_preparer), la personne confirme
-- ou corrige ; une correction ne modifie ni la visite ni la session.
-- Soumission (hr_semaine_soumettre) : total, écart au contrat, heures supplémentaires calculées, puis circuit commun
-- (approval_requests, périmètre « timesheet », droit « Valider les heures ») ; personne ne valide sa propre semaine.
-- Les heures supplémentaires ne comptent qu'après validation. Semaine soumise ou validée : lignes figées.
-- Dépassements (10 h par jour, 48 h par semaine, valeurs du Code du travail « par défaut, à confirmer ») : signalés à
-- l'écran, jamais bloqués ; l'outil ne calcule pas la paie.
-- Droits (build_suite('0297')) : lignes et semaines lues par la personne, ou avec « Voir les dossiers » ou « Valider
-- les heures » ; lignes écrites par la personne avec « Saisir ses heures », ou avec « Tenir les dossiers » ;
-- semaines écrites seulement par les fonctions.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0297_rh_heures_retour.sql

create table if not exists public.hr_time_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  person_id uuid not null references public.hr_people(id) on delete cascade,
  work_date date not null,
  start_time time not null,
  end_time time not null,
  break_minutes int not null default 0 check (break_minutes >= 0 and break_minutes <= 600),
  minutes int generated always as (greatest(0, (extract(epoch from (end_time - start_time)) / 60)::int - break_minutes)) stored,
  client_id uuid references public.clients(id) on delete set null,
  origin text not null default 'saisie' check (origin in ('saisie', 'visite', 'session', 'import')),
  source_id uuid,
  observation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_time_entries_heures check (end_time > start_time)
);
create index if not exists hr_time_entries_company_idx on public.hr_time_entries (company_id);
create index if not exists hr_time_entries_person_idx on public.hr_time_entries (person_id, work_date);
create unique index if not exists hr_time_entries_source_uniq on public.hr_time_entries (person_id, origin, source_id, work_date) where source_id is not null;

create table if not exists public.hr_timesheets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  person_id uuid not null references public.hr_people(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  status text not null default 'ouverte' check (status in ('ouverte', 'soumise', 'validee', 'rejetee')),
  total_minutes int not null default 0,
  contract_minutes int,
  overtime_minutes int not null default 0,
  approval_id uuid references public.approval_requests(id) on delete set null,
  submitted_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, week_start)
);
create index if not exists hr_timesheets_company_idx on public.hr_timesheets (company_id);

create or replace function app.hr_h_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then new.company_id := old.company_id; new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.hr_h_maj() from public, anon, authenticated;
drop trigger if exists hr_time_entries_maj on public.hr_time_entries;
create trigger hr_time_entries_maj before insert or update on public.hr_time_entries for each row execute function app.hr_h_maj();
drop trigger if exists hr_timesheets_maj on public.hr_timesheets;
create trigger hr_timesheets_maj before insert or update on public.hr_timesheets for each row execute function app.hr_h_maj();

-- Ligne : même société que la personne ; semaine soumise ou validée : figée
create or replace function app.hr_ligne_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.hr_time_entries := coalesce(new, old);
begin
  if tg_op <> 'DELETE' and not exists (select 1 from public.hr_people p where p.id = new.person_id and p.company_id = new.company_id) then
    raise exception 'Heures : la personne appartient à une autre société' using errcode = '23514';
  end if;
  if exists (select 1 from public.hr_timesheets s
             where s.person_id = v_row.person_id and s.status in ('soumise', 'validee')
               and s.week_start = (date_trunc('week', v_row.work_date))::date)
     or (tg_op = 'UPDATE' and exists (select 1 from public.hr_timesheets s
             where s.person_id = old.person_id and s.status in ('soumise', 'validee')
               and s.week_start = (date_trunc('week', old.work_date))::date)) then
    raise exception 'Semaine soumise ou validée : les heures ne se modifient plus' using errcode = '23514';
  end if;
  return coalesce(new, old);
end
$$;
revoke all on function app.hr_ligne_garde() from public, anon, authenticated;
drop trigger if exists hr_time_entries_garde on public.hr_time_entries;
create trigger hr_time_entries_garde before insert or update or delete on public.hr_time_entries for each row execute function app.hr_ligne_garde();

-- Fiche reliée au compte dans la société courante
create or replace function app.hr_ma_fiche()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.hr_people p
  where p.profile_id = (select auth.uid()) and p.company_id = app.current_company() and p.archived_at is null
  limit 1
$$;
revoke all on function app.hr_ma_fiche() from public, anon;
grant execute on function app.hr_ma_fiche() to authenticated;

-- Proposer les lignes de la semaine depuis ses visites (technicien) et ses sessions (formateur)
create or replace function public.hr_semaine_preparer(p_lundi date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pers uuid := app.hr_ma_fiche();
  v_trainer uuid;
  v_co uuid := app.current_company();
  v_n int := 0;
  v_k int;
begin
  if v_pers is null then raise exception 'Aucune fiche du personnel reliée à votre compte' using errcode = 'P0002'; end if;
  if not app.a_le_droit('rh.heures.saisir') then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if extract(isodow from p_lundi) <> 1 then raise exception 'La semaine commence un lundi' using errcode = '22023'; end if;
  if exists (select 1 from public.hr_timesheets s where s.person_id = v_pers and s.week_start = p_lundi and s.status in ('soumise', 'validee')) then
    return 0;
  end if;
  select p.trainer_id into v_trainer from public.hr_people p where p.id = v_pers;
  -- Visites terminées ou en cours du technicien
  insert into public.hr_time_entries (company_id, person_id, work_date, start_time, end_time, client_id, origin, source_id, observation)
  select v_co, v_pers, (v.started_at at time zone 'Europe/Paris')::date,
         date_trunc('minute', (v.started_at at time zone 'Europe/Paris'))::time,
         date_trunc('minute', (v.finished_at at time zone 'Europe/Paris'))::time,
         v.client_id, 'visite', v.id, 'Visite ' || coalesce(v.reference, '')
  from public.itv_visits v
  where v.technician_id = (select auth.uid()) and v.started_at is not null and v.finished_at is not null
    and (v.started_at at time zone 'Europe/Paris')::date between p_lundi and p_lundi + 6
    and (v.finished_at at time zone 'Europe/Paris')::date = (v.started_at at time zone 'Europe/Paris')::date
    and (v.finished_at at time zone 'Europe/Paris')::time > (v.started_at at time zone 'Europe/Paris')::time
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  -- Sessions du formateur (jours ouvrés de la session dans la semaine), pause d'une heure au-delà de 6 h
  if v_trainer is not null then
    insert into public.hr_time_entries (company_id, person_id, work_date, start_time, end_time, break_minutes, client_id, origin, source_id, observation)
    select v_co, v_pers, d::date, coalesce(s.start_time, '09:00'), coalesce(s.end_time, '17:00'),
           case when coalesce(s.end_time, '17:00') - coalesce(s.start_time, '09:00') > interval '6 hours' then 60 else 0 end,
           s.client_id, 'session', s.id, 'Session ' || coalesce(s.reference, '')
    from public.sessions s
    cross join lateral generate_series(greatest(s.start_date, p_lundi), least(s.end_date, p_lundi + 6), interval '1 day') d
    where s.trainer_id = v_trainer and s.start_date <= p_lundi + 6 and s.end_date >= p_lundi
      and coalesce(s.status, '') not in ('cancelled', 'annulee') and extract(isodow from d) < 7
      and coalesce(s.end_time, '17:00') > coalesce(s.start_time, '09:00')
    on conflict do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;
  return v_n;
end
$$;
revoke all on function public.hr_semaine_preparer(date) from public, anon;
grant execute on function public.hr_semaine_preparer(date) to authenticated;

-- Soumettre sa semaine : totaux, écart, heures supplémentaires, circuit commun
create or replace function public.hr_semaine_soumettre(p_lundi date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pers uuid := app.hr_ma_fiche();
  v_co uuid := app.current_company();
  v_total int;
  v_contrat int;
  v_id uuid;
  v_appro uuid;
  v_nom text;
begin
  if v_pers is null then raise exception 'Aucune fiche du personnel reliée à votre compte' using errcode = 'P0002'; end if;
  if not app.a_le_droit('rh.heures.saisir') then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if extract(isodow from p_lundi) <> 1 then raise exception 'La semaine commence un lundi' using errcode = '22023'; end if;
  if exists (select 1 from public.hr_timesheets s where s.person_id = v_pers and s.week_start = p_lundi and s.status in ('soumise', 'validee')) then
    raise exception 'Semaine déjà soumise' using errcode = '22023';
  end if;
  select coalesce(sum(e.minutes), 0) into v_total from public.hr_time_entries e
  where e.person_id = v_pers and e.work_date between p_lundi and p_lundi + 6;
  if v_total = 0 then raise exception 'Aucune heure saisie cette semaine' using errcode = '22023'; end if;
  select (coalesce(e.weekly_hours, 35) * 60)::int into v_contrat from public.hr_employments e
  where e.person_id = v_pers and e.start_on <= p_lundi + 6 and (e.end_on is null or e.end_on >= p_lundi)
  order by e.start_on desc limit 1;
  v_contrat := coalesce(v_contrat, 35 * 60);
  insert into public.hr_timesheets (company_id, person_id, week_start, status, total_minutes, contract_minutes, overtime_minutes, submitted_at)
  values (v_co, v_pers, p_lundi, 'soumise', v_total, v_contrat, greatest(0, v_total - v_contrat), now())
  on conflict (person_id, week_start) do update set status = 'soumise', total_minutes = excluded.total_minutes,
    contract_minutes = excluded.contract_minutes, overtime_minutes = excluded.overtime_minutes, submitted_at = now(),
    decided_by = null, decided_at = null, reject_reason = null
  returning id into v_id;
  select coalesce(p.usage_name, p.last_name) || ' ' || p.first_name into v_nom from public.hr_people p where p.id = v_pers;
  v_appro := public.approval_submit('timesheet', 'hr_timesheets', v_id, null, null,
    left('Heures de ' || v_nom || ', semaine du ' || to_char(p_lundi, 'DD/MM/YYYY'), 200));
  if v_appro is null then
    update public.hr_timesheets set status = 'validee', decided_at = now() where id = v_id;
  else
    update public.hr_timesheets set approval_id = v_appro where id = v_id;
  end if;
  return v_id;
end
$$;
revoke all on function public.hr_semaine_soumettre(date) from public, anon;
grant execute on function public.hr_semaine_soumettre(date) to authenticated;

-- Décision prise dans le circuit commun : reportée sur la semaine (rejetée : de nouveau modifiable)
create or replace function app.hr_semaine_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.object_table = 'hr_timesheets' and new.status is distinct from old.status then
    update public.hr_timesheets set
      status = case new.status when 'approved' then 'validee' when 'rejected' then 'rejetee' else 'ouverte' end,
      decided_by = new.decided_by, decided_at = coalesce(new.decided_at, now()),
      reject_reason = case when new.status = 'rejected' then new.decision_comment end
    where id = new.object_id;
  end if;
  return null;
end
$$;
revoke all on function app.hr_semaine_decision() from public, anon, authenticated;
drop trigger if exists hr_semaine_decision on public.approval_requests;
create trigger hr_semaine_decision after update of status on public.approval_requests
  for each row execute function app.hr_semaine_decision();

-- Journal : semaines (soumission, décision)
drop trigger if exists zz_audit_row on public.hr_timesheets;
create trigger zz_audit_row after insert or update or delete on public.hr_timesheets for each row execute function app.audit_row('heures');

-- ── Droits des tables ──
alter table public.hr_time_entries enable row level security;
alter table public.hr_timesheets enable row level security;
revoke all on table public.hr_time_entries, public.hr_timesheets from public, anon;
grant select, insert, update, delete on table public.hr_time_entries, public.hr_timesheets to authenticated;
grant all on table public.hr_time_entries, public.hr_timesheets to service_role;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0297')) ──

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
           where schemaname = 'public' and tablename = any (array['hr_time_entries', 'hr_timesheets'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- hr_time_entries
select pg_temp.regles(array['hr_time_entries'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or company_id in (select app.societes_avec_droit('rh.heures.valider')) or person_id in (select app.hr_mes_personnes()))$r$,
  $r$((person_id in (select app.hr_mes_personnes()) and company_id in (select app.societes_avec_droit('rh.heures.saisir'))) or company_id in (select app.societes_avec_droit('rh.dossiers.gerer')))$r$,
  $r$((person_id in (select app.hr_mes_personnes()) and company_id in (select app.societes_avec_droit('rh.heures.saisir'))) or company_id in (select app.societes_avec_droit('rh.dossiers.gerer')))$r$,
  $r$((person_id in (select app.hr_mes_personnes()) and company_id in (select app.societes_avec_droit('rh.heures.saisir'))) or company_id in (select app.societes_avec_droit('rh.dossiers.gerer')))$r$);

-- hr_timesheets
select pg_temp.regles(array['hr_timesheets'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or company_id in (select app.societes_avec_droit('rh.heures.valider')) or person_id in (select app.hr_mes_personnes()))$r$,
  null,
  null,
  null);

do $$
declare t text;
begin
  foreach t in array array['hr_time_entries', 'hr_timesheets'] loop
    execute format('drop policy if exists %I on public.%I', t || '_societe_lire', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_creer', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_modifier', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_supprimer', t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (company_id in (select app.societes_lisibles()))', t || '_societe_lire', t);
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (company_id in (select app.societes_ecriture()))', t || '_societe_creer', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()))', t || '_societe_modifier', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using (company_id in (select app.societes_ecriture()))', t || '_societe_supprimer', t);
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0297_rh_heures') on conflict (version) do nothing;

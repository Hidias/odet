-- 0311_rh_jours_feries.sql : chantier 12, module RH, jours fériés par société (spec odet-spec-rh.md § 5, « Jours
-- fériés : calendrier par société, le restaurant travaille souvent les jours fériés ; jour de solidarité réglable »).
--
-- hr_public_holidays : un jour par ligne et par société, libellé, « travaillé » (le jour compte alors comme un jour
-- ouvré). Les 11 jours fériés légaux de métropole sont posés pour l'année passée, l'année en cours et les deux
-- suivantes, pour chaque société et chaque nouvelle société ; public.hr_feries_annee(année) ajoute une année.
-- Le lundi de Pentecôte est posé comme férié, à marquer « travaillé » si la société en fait sa journée de solidarité.
-- Le décompte des absences (hr_absence_demander) ne compte plus les jours fériés non travaillés de la société.
-- Une demande déjà faite garde son nombre de jours.
-- Droits (build_suite('0311')) : lecture avec « Voir le personnel », écriture avec « Configurer les RH ».
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0311_rh_jours_feries_retour.sql

create table if not exists public.hr_public_holidays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  day date not null,
  label text not null check (length(btrim(label)) > 0),
  is_worked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, day)
);
create index if not exists hr_public_holidays_company_idx on public.hr_public_holidays (company_id, day);
comment on table public.hr_public_holidays is 'Jours fériés par société ; « travaillé » : le jour compte comme ouvré (restaurant, journée de solidarité)';
drop trigger if exists hr_public_holidays_maj on public.hr_public_holidays;
create trigger hr_public_holidays_maj before insert or update on public.hr_public_holidays for each row execute function app.hr_h_maj();

-- Date de Pâques (calendrier grégorien, algorithme de Meeus, Jones et Butcher)
create or replace function app.paques(p_annee int)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  a int := p_annee % 19; b int := p_annee / 100; c int := p_annee % 100;
  d int; e int; f int; g int; h int; i int; k int; l int; m int; mois int; jour int;
begin
  d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  mois := (h + l - 7 * m + 114) / 31; jour := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_annee, mois, jour);
end
$$;
revoke all on function app.paques(int) from public, anon;
grant execute on function app.paques(int) to authenticated;

-- Jours fériés légaux de métropole d'une année, posés pour une société (sans toucher à ce qui existe)
create or replace function app.hr_feries_poser(p_company uuid, p_annee int)
returns int
language sql
security definer
set search_path = ''
as $$
  with j(day, label) as (
    values (make_date(p_annee, 1, 1), 'Jour de l''an'), (app.paques(p_annee) + 1, 'Lundi de Pâques'),
           (make_date(p_annee, 5, 1), 'Fête du travail'), (make_date(p_annee, 5, 8), 'Victoire 1945'),
           (app.paques(p_annee) + 39, 'Ascension'), (app.paques(p_annee) + 50, 'Lundi de Pentecôte'),
           (make_date(p_annee, 7, 14), 'Fête nationale'), (make_date(p_annee, 8, 15), 'Assomption'),
           (make_date(p_annee, 11, 1), 'Toussaint'), (make_date(p_annee, 11, 11), 'Armistice 1918'),
           (make_date(p_annee, 12, 25), 'Noël')),
  ins as (
    insert into public.hr_public_holidays (company_id, day, label)
    select p_company, j.day, j.label from j
    on conflict (company_id, day) do nothing
    returning 1)
  select count(*)::int from ins
$$;
revoke all on function app.hr_feries_poser(uuid, int) from public, anon, authenticated;

create or replace function app.hr_feries_depart(p_company uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select app.hr_feries_poser(p_company, y)
  from generate_series(extract(year from current_date)::int - 1, extract(year from current_date)::int + 2) y
$$;
revoke all on function app.hr_feries_depart(uuid) from public, anon, authenticated;
select app.hr_feries_depart(c.id) from public.companies c;

-- Ajouter une année pour la société courante (« Configurer les RH »)
create or replace function public.hr_feries_annee(p_annee int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid := app.current_company();
begin
  if v_co is null or not app.a_le_droit('rh.parametres.gerer') then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if p_annee < 2000 or p_annee > 2100 then raise exception 'Année hors limites' using errcode = '22023'; end if;
  return app.hr_feries_poser(v_co, p_annee);
end
$$;
revoke all on function public.hr_feries_annee(int) from public, anon;
grant execute on function public.hr_feries_annee(int) to authenticated;

-- Jours ouvrés d'une société : lundi au vendredi, hors jours fériés non travaillés de la société, demi-journées
create or replace function app.hr_jours_ouvres_societe(p_company uuid, p_debut date, p_debut_demi text, p_fin date, p_fin_demi text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with jours as (
    select d::date as d from generate_series(p_debut, p_fin, interval '1 day') d
    where extract(isodow from d) < 6
      and not exists (select 1 from public.hr_public_holidays h where h.company_id = p_company and h.day = d::date and not h.is_worked))
  select greatest(0, (select count(*) from jours)
         - case when p_debut_demi = 'apres_midi' and exists (select 1 from jours where d = p_debut) then 0.5 else 0 end
         - case when p_fin_demi = 'matin' and exists (select 1 from jours where d = p_fin) then 0.5 else 0 end)::numeric
$$;
revoke all on function app.hr_jours_ouvres_societe(uuid, date, text, date, text) from public, anon;
grant execute on function app.hr_jours_ouvres_societe(uuid, date, text, date, text) to authenticated;

-- Demande d'absence : décompte avec les jours fériés de la société (le reste est celui de 0294)
create or replace function public.hr_absence_demander(p_type uuid, p_debut date, p_debut_demi text, p_fin date,
  p_fin_demi text, p_commentaire text default null, p_personne uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_co uuid := app.current_company();
  v_pers uuid;
  v_type public.hr_absence_types;
  v_jours numeric;
  v_id uuid;
  v_appro uuid;
begin
  if v_co is null then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if p_personne is null then
    select p.id into v_pers from public.hr_people p where p.profile_id = (select auth.uid()) and p.company_id = v_co and p.archived_at is null;
    if v_pers is null then raise exception 'Aucune fiche du personnel reliée à votre compte' using errcode = 'P0002'; end if;
    if not app.a_le_droit('rh.absences.demander') and not app.a_le_droit('rh.dossiers.gerer') then
      raise exception 'Accès refusé' using errcode = '42501';
    end if;
  else
    select p.id into v_pers from public.hr_people p where p.id = p_personne and p.company_id = v_co;
    if v_pers is null then raise exception 'Personne introuvable' using errcode = 'P0002'; end if;
    if not (v_pers in (select app.hr_mes_personnes()) and app.a_le_droit('rh.absences.demander')) and not app.a_le_droit('rh.dossiers.gerer') then
      raise exception 'Accès refusé' using errcode = '42501';
    end if;
  end if;
  select * into v_type from public.hr_absence_types t where t.id = p_type and t.company_id = v_co and t.is_active;
  if v_type.id is null then raise exception 'Type d''absence inconnu' using errcode = 'P0002'; end if;
  if not v_type.employee_can_request and not app.a_le_droit('rh.dossiers.gerer') then
    raise exception 'Ce type d''absence est saisi par la RH' using errcode = '42501';
  end if;
  if p_fin < p_debut then raise exception 'La fin est avant le début' using errcode = '22023'; end if;
  if not v_type.half_days and (p_debut_demi is not null or p_fin_demi is not null) then
    raise exception 'Ce type d''absence se prend par journées entières' using errcode = '22023';
  end if;
  if exists (select 1 from public.hr_absence_requests r where r.person_id = v_pers and r.status in ('demandee', 'validee')
             and daterange(r.start_on, r.end_on, '[]') && daterange(p_debut, p_fin, '[]')) then
    raise exception 'Une demande couvre déjà une partie de ces dates' using errcode = '23505';
  end if;
  v_jours := app.hr_jours_ouvres_societe(v_co, p_debut, p_debut_demi, p_fin, p_fin_demi);
  if v_jours <= 0 then raise exception 'Aucun jour ouvré dans cette période' using errcode = '22023'; end if;
  insert into public.hr_absence_requests (company_id, person_id, type_id, start_on, start_half, end_on, end_half, days, comment, requested_by)
  values (v_co, v_pers, v_type.id, p_debut, p_debut_demi, p_fin, p_fin_demi, v_jours, nullif(btrim(coalesce(p_commentaire, '')), ''), (select auth.uid()))
  returning id into v_id;
  v_appro := public.approval_submit('absence', 'hr_absence_requests', v_id, null, null,
    left(v_type.label || ' du ' || to_char(p_debut, 'DD/MM/YYYY') || ' au ' || to_char(p_fin, 'DD/MM/YYYY'), 200));
  if v_appro is null then
    -- Aucune validation demandée par la société : validée tout de suite
    perform app.hr_absence_appliquer(v_id, 'validee', null, null);
  else
    update public.hr_absence_requests set approval_id = v_appro where id = v_id;
  end if;
  return v_id;
end
$$;
revoke all on function public.hr_absence_demander(uuid, date, text, date, text, text, uuid) from public, anon;
grant execute on function public.hr_absence_demander(uuid, date, text, date, text, text, uuid) to authenticated;

-- Nouvelle société : jours fériés posés avec les autres référentiels de départ
create or replace function app.societe_referentiels_depart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.subcontractor_doc_types_depart(new.id);
  if to_regprocedure('app.obligation_rules_depart(uuid)') is not null then
    execute 'select app.obligation_rules_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.commercial_lists_depart(uuid)') is not null then
    execute 'select app.commercial_lists_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_sous_traitants_depart(uuid)') is not null then
    execute 'select app.rgpd_sous_traitants_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_purge_regles_depart(uuid)') is not null then
    execute 'select app.rgpd_purge_regles_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.cert_pitfalls_depart(uuid)') is not null then
    execute 'select app.cert_pitfalls_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_horaires_depart(uuid)') is not null then
    execute 'select app.hr_horaires_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_types_absence_depart(uuid)') is not null then
    execute 'select app.hr_types_absence_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_feries_depart(uuid)') is not null then
    execute 'select app.hr_feries_depart($1)' using new.id;
  end if;
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

-- Journal
drop trigger if exists zz_audit_row on public.hr_public_holidays;
create trigger zz_audit_row after insert or update or delete on public.hr_public_holidays for each row execute function app.audit_row('parametres_rh');

-- ── Droits des tables ──
alter table public.hr_public_holidays enable row level security;
revoke all on table public.hr_public_holidays from public, anon;
grant select, insert, update, delete on table public.hr_public_holidays to authenticated;
grant all on table public.hr_public_holidays to service_role;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0311')) ──

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
           where schemaname = 'public' and tablename = any (array['hr_public_holidays'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- hr_public_holidays
select pg_temp.regles(array['hr_public_holidays'], null,
  $r$company_id in (select app.societes_avec_droit('rh.personnel.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.parametres.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.parametres.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.parametres.gerer'))$r$);


do $$
declare t text;
begin
  foreach t in array array['hr_public_holidays'] loop
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

insert into public.schema_migrations (version) values ('0311_rh_jours_feries') on conflict (version) do nothing;

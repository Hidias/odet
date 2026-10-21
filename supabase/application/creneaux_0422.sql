-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (creneaux_0422) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0422_creneaux_recurrents.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0422_creneaux_recurrents_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0422_creneaux_recurrents.sql =====
-- 0422 : créneaux récurrents des sessions inter (série du 21/10, n° 31). Exemple : « MAC SST le premier mardi du
-- mois à Quimper ». L'organisme décrit le créneau une fois ; les sessions des douze mois à venir sont créées seules,
-- publiées directement au calendrier public (décision de H : pas de « à confirmer »), et couvertes par la réserve de
-- maintien de l'organisme (organization_settings.mention_maintien, 0419), affichée au calendrier, à l'inscription, sur
-- la convention et le contrat. Chaque matin, l'horizon de douze mois est complété.
--   1. session_recurrences : le créneau (formation, rythme mensuel « n-ième jour du mois » ou hebdomadaire, durée en
--      jours ouvrés, horaires, lieu, formateur, effectifs, prix public, période, actif, dates écartées).
--   2. sessions.recurrence_id et sessions.recurrence_date (date prévue par le créneau) : une date n'est créée qu'une
--      fois, même si la session est déplacée ensuite ; une session supprimée n'est pas recréée (date écartée).
--   3. app.recurrence_dates(créneau, du, au) ; app.recurrence_creer_sessions(créneau) : jours fériés non travaillés
--      de la société écartés (hr_public_holidays, 0311), compte rendu (créées, fériés écartés).
--   4. public.recurrence_generer(créneau) : par qui crée les sessions ; app.recurrences_etendre() chaque matin.
--   5. Réserve de maintien : texte par défaut posé seulement là où il est vide (modifiable dans les paramètres).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0422_creneaux_recurrents_retour.sql

-- ── 1. Créneaux ──
create table if not exists public.session_recurrences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  frequence text not null default 'mensuel' check (frequence in ('mensuel', 'hebdo')),
  rang int check (rang is null or rang in (1, 2, 3, 4, -1)),
  jour_semaine int not null check (jour_semaine between 1 and 7),
  intervalle int not null default 1 check (intervalle between 1 and 12),
  nb_jours int not null default 1 check (nb_jours between 1 and 10),
  start_time time not null default '09:00',
  end_time time not null default '17:00',
  location_name text check (location_name is null or length(location_name) <= 200),
  location_address text check (location_address is null or length(location_address) <= 300),
  location_postal_code text check (location_postal_code is null or length(location_postal_code) <= 10),
  location_city text check (location_city is null or length(location_city) <= 100),
  trainer_id uuid references public.trainers(id) on delete set null,
  min_participants int check (min_participants is null or min_participants between 1 and 500),
  max_participants int check (max_participants is null or max_participants between 1 and 500),
  public_price_per_person numeric check (public_price_per_person is null or public_price_per_person >= 0),
  date_debut date not null default current_date,
  date_fin date,
  actif boolean not null default true,
  dates_ecartees date[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_recurrences_rang_requis check (frequence <> 'mensuel' or rang is not null),
  constraint session_recurrences_periode_check check (date_fin is null or date_fin >= date_debut),
  constraint session_recurrences_effectif_check check (min_participants is null or max_participants is null or min_participants <= max_participants)
);
create index if not exists session_recurrences_company_idx on public.session_recurrences (company_id);
comment on table public.session_recurrences is 'Créneaux récurrents des sessions inter : les sessions des douze mois à venir sont créées seules';
comment on column public.session_recurrences.rang is 'Rythme mensuel : 1er, 2e, 3e, 4e ou dernier (-1) jour_semaine du mois';
comment on column public.session_recurrences.jour_semaine is '1 = lundi … 7 = dimanche';
comment on column public.session_recurrences.intervalle is 'Tous les N mois (mensuel) ou toutes les N semaines (hebdo)';
comment on column public.session_recurrences.dates_ecartees is 'Dates du créneau à ne pas (re)créer : session supprimée par l''organisme';

create or replace function app.session_recurrences_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists session_recurrences_maj on public.session_recurrences;
create trigger session_recurrences_maj before update on public.session_recurrences for each row execute function app.session_recurrences_maj();

-- ── 2. Lien des sessions au créneau ──
alter table public.sessions add column if not exists recurrence_id uuid references public.session_recurrences(id) on delete set null;
alter table public.sessions add column if not exists recurrence_date date;
create unique index if not exists sessions_recurrence_date_uniq on public.sessions (recurrence_id, recurrence_date) where recurrence_id is not null;
comment on column public.sessions.recurrence_date is 'Date prévue par le créneau récurrent (reste la même si la session est déplacée)';

-- Session d'un créneau supprimée : sa date est écartée, elle n'est pas recréée
create or replace function app.recurrence_session_supprimee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.recurrence_id is not null and old.recurrence_date is not null then
    update public.session_recurrences
       set dates_ecartees = array_append(dates_ecartees, old.recurrence_date)
     where id = old.recurrence_id and not (old.recurrence_date = any (dates_ecartees));
  end if;
  return old;
end
$$;
revoke all on function app.recurrence_session_supprimee() from public, anon, authenticated;
drop trigger if exists sessions_recurrence_supprimee on public.sessions;
create trigger sessions_recurrence_supprimee after delete on public.sessions for each row execute function app.recurrence_session_supprimee();

-- ── 3. Dates d'un créneau ──
create or replace function app.recurrence_dates(p_id uuid, p_du date, p_au date)
returns setof date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.session_recurrences;
  v_mois date;
  v_jour date;
  v_dernier date;
begin
  select * into r from public.session_recurrences where id = p_id;
  if r.id is null or p_du > p_au then return; end if;
  if r.frequence = 'mensuel' then
    v_mois := date_trunc('month', r.date_debut)::date;
    while v_mois <= p_au loop
      if r.rang = -1 then
        v_dernier := (v_mois + interval '1 month')::date - 1;
        v_jour := v_dernier - ((extract(isodow from v_dernier)::int - r.jour_semaine + 7) % 7);
      else
        v_jour := v_mois + ((r.jour_semaine - extract(isodow from v_mois)::int + 7) % 7) + (r.rang - 1) * 7;
      end if;
      if v_jour between greatest(p_du, r.date_debut) and least(p_au, coalesce(r.date_fin, p_au))
         and date_trunc('month', v_jour) = v_mois then
        return next v_jour;
      end if;
      v_mois := (v_mois + make_interval(months => r.intervalle))::date;
    end loop;
  else
    v_jour := r.date_debut + ((r.jour_semaine - extract(isodow from r.date_debut)::int + 7) % 7);
    while v_jour <= least(p_au, coalesce(r.date_fin, p_au)) loop
      if v_jour >= p_du then return next v_jour; end if;
      v_jour := v_jour + 7 * r.intervalle;
    end loop;
  end if;
end
$$;
revoke all on function app.recurrence_dates(uuid, date, date) from public, anon, authenticated;

-- Jour férié non travaillé de la société (0311), s'il existe
create or replace function app.recurrence_ferie(p_company uuid, p_jour date)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v boolean := false;
begin
  if to_regclass('public.hr_public_holidays') is null then return false; end if;
  execute 'select exists (select 1 from public.hr_public_holidays where company_id = $1 and day = $2 and not is_worked)'
    into v using p_company, p_jour;
  return v;
end
$$;
revoke all on function app.recurrence_ferie(uuid, date) from public, anon, authenticated;

-- Sessions d'un créneau jusqu'à douze mois (à partir de demain), sans doublon
create or replace function app.recurrence_creer_sessions(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.session_recurrences;
  c record;
  v_jour date;
  v_fin date;
  v_k int;
  v_ferie boolean;
  v_crees int := 0;
  v_feries date[] := '{}';
  v_demain date := (now() at time zone 'Europe/Paris')::date + 1;
begin
  select * into r from public.session_recurrences where id = p_id;
  if r.id is null or not r.actif then return jsonb_build_object('crees', 0, 'feries', '[]'::jsonb); end if;
  select co.min_participants, co.max_participants into c from public.courses co where co.id = r.course_id;
  for v_jour in select d from app.recurrence_dates(r.id, v_demain, v_demain + 365) d loop
    continue when v_jour = any (r.dates_ecartees);
    continue when exists (select 1 from public.sessions s where s.recurrence_id = r.id and s.recurrence_date = v_jour);
    -- Fin : nb_jours jours ouvrés (sans samedi, dimanche ni jour férié non travaillé)
    v_fin := v_jour; v_k := 1; v_ferie := app.recurrence_ferie(r.company_id, v_jour);
    while v_k < r.nb_jours loop
      v_fin := v_fin + 1;
      continue when extract(isodow from v_fin) in (6, 7) or app.recurrence_ferie(r.company_id, v_fin);
      v_k := v_k + 1;
    end loop;
    if v_ferie then v_feries := v_feries || v_jour; continue; end if;
    insert into public.sessions (company_id, course_id, session_type, is_intra, is_public, start_date, end_date, start_time, end_time,
      location_name, location_address, location_postal_code, location_city, trainer_id, min_participants, max_participants,
      public_price_per_person, status, recurrence_id, recurrence_date)
    values (r.company_id, r.course_id, 'inter', false, true, v_jour, v_fin, r.start_time, r.end_time,
      r.location_name, r.location_address, r.location_postal_code, r.location_city, r.trainer_id,
      coalesce(r.min_participants, c.min_participants), coalesce(r.max_participants, c.max_participants),
      r.public_price_per_person, 'planned', r.id, v_jour);
    v_crees := v_crees + 1;
  end loop;
  return jsonb_build_object('crees', v_crees, 'feries', to_jsonb(v_feries));
end
$$;
revoke all on function app.recurrence_creer_sessions(uuid) from public, anon, authenticated;

-- ── 4. Appel depuis l'outil et complément chaque matin ──
create or replace function public.recurrence_generer(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_company uuid;
begin
  select company_id into v_company from public.session_recurrences where id = p_id;
  if v_company is null then raise exception 'Créneau inconnu' using errcode = '22023'; end if;
  if v_company not in (select app.societes_avec_droit('formation.sessions.creer')) then
    raise exception 'Droit de créer des sessions requis' using errcode = '42501';
  end if;
  return app.recurrence_creer_sessions(p_id);
end
$$;
revoke all on function public.recurrence_generer(uuid) from public, anon;
grant execute on function public.recurrence_generer(uuid) to authenticated;

create or replace function app.recurrences_etendre()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare r record; v int := 0;
begin
  for r in select id from public.session_recurrences where actif and (date_fin is null or date_fin > current_date) loop
    v := v + coalesce((app.recurrence_creer_sessions(r.id)->>'crees')::int, 0);
  end loop;
  return v;
end
$$;
revoke all on function app.recurrences_etendre() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'odet_recurrences';
    perform cron.schedule('odet_recurrences', '20 5 * * *', 'select app.recurrences_etendre()');
  end if;
end $$;

-- ── 5. Réserve de maintien par défaut (seulement si vide) ──
update public.organization_settings
   set mention_maintien = 'Les sessions inter-entreprises sont maintenues sous réserve d''un nombre minimum d''inscrits et de la disponibilité du formateur. En cas de report ou d''annulation, l''inscrit est prévenu au plus tard 10 jours avant le début, sans aucun frais, et les dates suivantes lui sont proposées.'
 where coalesce(btrim(mention_maintien), '') = '';


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
           where schemaname = 'public' and tablename = any (array['session_recurrences'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- session_recurrences
select pg_temp.regles(array['session_recurrences'], null,
  $r$company_id in (select app.societes_avec_droit('formation.sessions.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.sessions.creer'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.sessions.creer'))$r$,
  $r$company_id in (select app.societes_avec_droit('formation.sessions.supprimer'))$r$);


insert into public.schema_migrations (version) values ('0422_creneaux_recurrents') on conflict (version) do nothing;

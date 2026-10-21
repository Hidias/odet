-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (heures_0398) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0398_heures_realisees.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0398_heures_realisees_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0398_heures_realisees.sql =====
-- 0398 : heures réellement suivies et régularisation tracée des émargements manquants (décision de H du 21/10).
-- Le certificat de réalisation (D6353-4) porte la durée réellement suivie, et l'OPCO la rapproche des feuilles
-- d'émargement. Une demi-journée sans signature se décide avant d'éditer les documents : « présent, a oublié de
-- signer » (avec motif) ou « absent » (heures retirées). Chaque décision est gardée telle quelle : qui, quand,
-- pourquoi ; une correction ajoute une nouvelle décision, la plus récente fait foi. Idempotent.

create table if not exists public.attendance_regularisations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  trainee_id uuid not null references public.trainees(id) on delete cascade,
  date date not null,
  period text not null check (period in ('morning', 'afternoon')),
  decision text not null check (decision in ('present_oubli', 'absent')),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  decided_by uuid default auth.uid(),
  decided_by_name text check (decided_by_name is null or length(decided_by_name) <= 120),
  decided_at timestamptz not null default now()
);
create index if not exists attendance_regularisations_session_idx on public.attendance_regularisations (session_id, trainee_id, date, period, decided_at desc);
create index if not exists attendance_regularisations_company_idx on public.attendance_regularisations (company_id);
comment on table public.attendance_regularisations is 'Décisions sur les demi-journées sans émargement (présent sans signature ou absent), historique conservé';

drop trigger if exists attendance_regularisations_societe on public.attendance_regularisations;
create trigger attendance_regularisations_societe before insert on public.attendance_regularisations
  for each row execute function app.societe_du_parent('sessions', 'session_id');

-- Auteur et heure posés par la base, jamais par l'écran
create or replace function app.regularisation_auteur()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.decided_at := now();
  if auth.uid() is not null then new.decided_by := auth.uid(); end if;
  return new;
end
$$;
revoke all on function app.regularisation_auteur() from public, anon, authenticated;
drop trigger if exists attendance_regularisations_auteur on public.attendance_regularisations;
create trigger attendance_regularisations_auteur before insert on public.attendance_regularisations
  for each row execute function app.regularisation_auteur();

-- Règles d'accès (générées par scripts/securite/regles.py, build_suite('0398')) : lecture et ajout seulement

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
           where schemaname = 'public' and tablename = any (array['attendance_regularisations'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- attendance_regularisations
select pg_temp.regles(array['attendance_regularisations'], null,
  $r$(company_id in (select app.societes_avec_droit('formation.suivi.voir')) or ((select app.a_le_droit('formation.sessions.voir_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$(company_id in (select app.societes_avec_droit('formation.suivi.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  null,
  null);


insert into public.schema_migrations (version) values ('0398_heures_realisees') on conflict (version) do nothing;

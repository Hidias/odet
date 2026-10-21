-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (avis_0396) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0396_avis_formation.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0396_avis_formation_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0396_avis_formation.sql =====
-- 0396 : avis après formation pour l'habilitation électrique et la conduite d'engins (audit des angles morts du 19/10).
-- Après la formation, l'organisme ne délivre pas le titre : il donne à l'employeur un avis par stagiaire (symboles
-- ou catégories proposés, résultat, observations) sur lequel l'employeur s'appuie pour délivrer le titre
-- d'habilitation (norme NF C18-510) ou l'autorisation de conduite (article R4323-56 du code du travail).
--   1. courses.avis_kind : la formation donne lieu à un avis (habilitation électrique, conduite) ; repris d'office
--      pour les formations du catalogue dont le thème le dit (« Habilitation… », « Conduite… »).
--   2. training_avis : un avis par stagiaire et par session, mêmes droits que la certification SST.
-- Idempotent.

alter table public.courses add column if not exists avis_kind text;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'courses_avis_kind_check') then
    alter table public.courses add constraint courses_avis_kind_check
      check (avis_kind is null or avis_kind in ('habilitation_electrique', 'autorisation_conduite'));
  end if;
end $c$;

update public.courses c set avis_kind = 'habilitation_electrique'
from public.training_themes t
where t.id = c.theme_id and c.avis_kind is null and t.name ~* '^habilitation';
update public.courses c set avis_kind = 'autorisation_conduite'
from public.training_themes t
where t.id = c.theme_id and c.avis_kind is null and t.name ~* '^conduite';

create table if not exists public.training_avis (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  trainee_id uuid not null references public.trainees(id) on delete cascade,
  kind text not null check (kind in ('habilitation_electrique', 'autorisation_conduite')),
  result text not null default 'favorable' check (result in ('favorable', 'defavorable', 'reserve')),
  symbols text[] not null default '{}',
  voltage text check (voltage is null or length(voltage) <= 60),
  scope text check (scope is null or length(scope) <= 300),
  observations text check (observations is null or length(observations) <= 1500),
  decided_on date not null default current_date,
  trainer_name text check (trainer_name is null or length(trainer_name) <= 120),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, trainee_id)
);
create index if not exists training_avis_session_idx on public.training_avis (session_id);
create index if not exists training_avis_company_idx on public.training_avis (company_id);
comment on table public.training_avis is 'Avis après formation (habilitation électrique, conduite) remis à l''employeur pour délivrer le titre';

drop trigger if exists training_avis_societe on public.training_avis;
create trigger training_avis_societe before insert or update of session_id on public.training_avis
  for each row execute function app.societe_du_parent('sessions', 'session_id');

create or replace function app.training_avis_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.training_avis_maj() from public, anon, authenticated;
drop trigger if exists training_avis_maj on public.training_avis;
create trigger training_avis_maj before update on public.training_avis
  for each row execute function app.training_avis_maj();

-- Règles d'accès (générées par scripts/securite/regles.py, build_suite('0396'))


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
           where schemaname = 'public' and tablename = any (array['training_avis'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- training_avis
select pg_temp.regles(array['training_avis'], null,
  $r$(company_id in (select app.societes_avec_droit('formation.suivi.voir')) or ((select app.a_le_droit('formation.sessions.voir_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$(company_id in (select app.societes_avec_droit('formation.suivi.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$(company_id in (select app.societes_avec_droit('formation.suivi.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$,
  $r$(company_id in (select app.societes_avec_droit('formation.suivi.gerer')) or ((select app.a_le_droit('formation.sessions.modifier_siennes')) and session_id in (select app.trainer_session_ids())))$r$);


insert into public.schema_migrations (version) values ('0396_avis_formation') on conflict (version) do nothing;

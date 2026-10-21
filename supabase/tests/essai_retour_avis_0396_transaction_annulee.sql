-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (avis_0396) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0396_avis_formation.sql, retour arrière,
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

-- ===== supabase/rollback/0396_avis_formation_retour.sql =====
-- Retour arrière de 0396_avis_formation.sql : retire les avis (s'il n'y en a aucun) et la colonne du catalogue.
-- Idempotent.

do $r$
begin
  if to_regclass('public.training_avis') is not null and exists (select 1 from public.training_avis) then
    raise exception 'Des avis après formation existent : retour arrière refusé, rien n''est modifié';
  end if;
end $r$;

drop table if exists public.training_avis;
drop function if exists app.training_avis_maj();
alter table public.courses drop constraint if exists courses_avis_kind_check;
alter table public.courses drop column if exists avis_kind;

delete from public.schema_migrations where version = '0396_avis_formation';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE avis_0396 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

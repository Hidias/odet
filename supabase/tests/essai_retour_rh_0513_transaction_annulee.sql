-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (rh_0513) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0513_rh_postes_habilitations.sql, retour arrière,
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

-- ===== supabase/migrations/0513_rh_postes_habilitations.sql =====
-- 0513 : habilitations exigées par poste (idée n° 3 reprise d'Odoo, choix de H du 08/11).
-- Décisions de H (08/11) : une liste de postes par société, chacun avec les titres qu'il exige ; le poste se choisit sur le
-- contrat ; chaque nuit, une action de l'équipe pour chaque manque ou fin de validité à moins de 3 mois, confiée au compte
-- choisi dans les paramètres RH ; rien n'est envoyé.
--   1. hr_jobs (postes) et hr_job_requirements (titres exigés : type, symboles ou catégories acceptés, libellé).
--   2. hr_employments.job_id : poste du contrat (le texte « Emploi » reste, il sert au registre du personnel).
--   3. hr_settings : compte à qui confier les actions (sans choix : action sans responsable).
--   4. team_actions : source « habilitation » et clé de dédoublonnage (dedup_key), posées par la base seule (tâche de
--      nuit) ; une action déjà créée, faite ou abandonnée, n'est jamais recréée pour le même manque ou la même fin.
--   5. app.habilitations_ecarts(société, jour) : manques et fins à moins de 3 mois des personnes sous contrat ce jour-là
--      avec un poste ; public.habilitations_actions_generer() (nuit) crée les actions.
-- Le délai de 3 mois est un choix de gestion (H), pas une règle réglementaire ; aucune durée de validité n'est codée :
-- seule compte la date de fin saisie sur le titre. L'attestation médicale (suivi de santé, restreint) n'est pas lue ici.
-- Additive. Idempotente. Retour arrière : supabase/rollback/0513_rh_postes_habilitations_retour.sql

-- ── 1. Postes et titres exigés ──
create table if not exists public.hr_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 100),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists hr_jobs_nom_uniq on public.hr_jobs (company_id, lower(btrim(name)));
comment on table public.hr_jobs is 'Postes de la société (0513) : chacun porte la liste des titres exigés';

create table if not exists public.hr_job_requirements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  job_id uuid not null references public.hr_jobs(id) on delete cascade,
  required_kind text not null
    check (required_kind in ('habilitation_electrique', 'autorisation_conduite', 'sst', 'incendie', 'apsad', 'permis', 'autre')),
  required_symbols text[] check (required_symbols is null or cardinality(required_symbols) between 1 and 30),
  label text not null check (length(btrim(label)) between 2 and 200),
  created_at timestamptz not null default now()
);
create index if not exists hr_job_requirements_job_idx on public.hr_job_requirements (job_id);
create index if not exists hr_job_requirements_company_idx on public.hr_job_requirements (company_id);
comment on table public.hr_job_requirements is 'Titres exigés par un poste (0513) : type de titre et, au choix, un des symboles ou catégories acceptés';

-- La société d'une exigence est celle de son poste
create or replace function app.hr_job_requirements_societe()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select j.company_id into new.company_id from public.hr_jobs j where j.id = new.job_id;
  if new.company_id is null then
    raise exception 'Poste introuvable' using errcode = '23503';
  end if;
  return new;
end
$$;
revoke all on function app.hr_job_requirements_societe() from public, anon, authenticated;
drop trigger if exists hr_job_requirements_societe on public.hr_job_requirements;
create trigger hr_job_requirements_societe before insert or update on public.hr_job_requirements
  for each row execute function app.hr_job_requirements_societe();

-- ── 2. Poste du contrat ──
alter table public.hr_employments add column if not exists job_id uuid references public.hr_jobs(id) on delete set null;
create index if not exists hr_employments_job_idx on public.hr_employments (job_id);
comment on column public.hr_employments.job_id is 'Poste du contrat (0513) : titres exigés ; le texte « Emploi » (job_title) reste pour le registre';

-- Poste d'une autre société refusé
create or replace function app.hr_employments_poste()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.job_id is not null and not exists (select 1 from public.hr_jobs j where j.id = new.job_id and j.company_id = new.company_id) then
    raise exception 'Ce poste appartient à une autre société' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function app.hr_employments_poste() from public, anon, authenticated;
drop trigger if exists hr_employments_poste on public.hr_employments;
create trigger hr_employments_poste before insert or update of job_id, company_id on public.hr_employments
  for each row execute function app.hr_employments_poste();

-- ── 3. Paramètres ──
create table if not exists public.hr_settings (
  company_id uuid primary key default app.company_default() references public.companies(id) on delete cascade,
  titres_owner_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
comment on table public.hr_settings is 'Paramètres RH par société (0513) : compte à qui confier les actions sur les titres exigés';

-- ── 4. Actions de l'équipe préparées par la base ──
alter table public.team_actions drop constraint if exists team_actions_source_check;
alter table public.team_actions add constraint team_actions_source_check
  check (source in ('manuel', 'point', 'bilan', 'reunion', 'habilitation'));
alter table public.team_actions add column if not exists dedup_key text check (dedup_key is null or length(dedup_key) <= 300);
create unique index if not exists team_actions_dedup_uniq on public.team_actions (company_id, dedup_key) where dedup_key is not null;
comment on column public.team_actions.dedup_key is 'Action préparée par la base (0513) : une seule par manque ou fin de validité ; jamais posée par un compte';

-- Corps de 0407 repris à l'identique, plus : source « habilitation » et clé posées seulement sans compte connecté
-- (tâche de nuit), clé figée ensuite
create or replace function app.team_actions_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.postponed_count := 0;
    if auth.uid() is not null then
      if new.source = 'habilitation' then
        raise exception 'Action réservée à la préparation de la nuit' using errcode = '42501';
      end if;
      new.dedup_key := null;
    end if;
  else
    new.company_id := old.company_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.source := old.source;
    new.source_id := old.source_id;
    new.dedup_key := old.dedup_key;
    -- Report : l'échéance d'une action à faire recule
    new.postponed_count := old.postponed_count;
    if old.status = 'a_faire' and new.status = 'a_faire' and old.due_on is not null and new.due_on > old.due_on then
      new.postponed_count := old.postponed_count + 1;
    end if;
  end if;
  if new.status = 'fait' and (tg_op = 'INSERT' or old.status <> 'fait') then
    new.done_at := now();
    new.done_by := auth.uid();
  elsif new.status <> 'fait' then
    new.done_at := null;
    new.done_by := null;
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.team_actions_maj() from public, anon, authenticated;

-- ── 5. Écarts et préparation de la nuit ──
-- Un titre couvre une exigence : même type, et un des symboles acceptés (sur le titre ou dans son libellé), comme 0386
create or replace function app.habilitation_couvre(p_q public.hr_qualifications, p_kind text, p_symbols text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_q.kind = p_kind
     and (p_symbols is null or coalesce(p_q.symbols, '{}') && p_symbols
          or exists (select 1 from unnest(p_symbols) s where p_q.label ilike '%' || s || '%'))
$$;
revoke all on function app.habilitation_couvre(public.hr_qualifications, text, text[]) from public, anon, authenticated;

-- Manques (aucun titre valide ce jour-là) et fins à moins de 3 mois, pour les personnes sous contrat avec un poste
create or replace function app.habilitations_ecarts(p_company uuid, p_jour date)
returns table (person_id uuid, nom text, poste text, requirement_id uuid, exigence text, motif text,
               qualification_id uuid, titre text, expires_on date, derniere_fin date)
language sql
stable
security definer
set search_path = ''
as $$
  with besoins as (
    select distinct p.id as person_id,
           upper(btrim(coalesce(nullif(btrim(p.usage_name), ''), p.last_name))) || ' ' || btrim(p.first_name) as nom,
           j.name as poste, r.id as requirement_id, r.label as exigence, r.required_kind, r.required_symbols
    from public.hr_people p
    join public.hr_employments e on e.person_id = p.id and e.company_id = p_company
      and e.start_on <= p_jour and (e.end_on is null or e.end_on >= p_jour)
    join public.hr_jobs j on j.id = e.job_id
    join public.hr_job_requirements r on r.job_id = j.id
    where p.company_id = p_company and p.archived_at is null
  ), meilleur as (
    select b.*,
           (select q.id from public.hr_qualifications q
            where q.person_id = b.person_id and q.archived_at is null and q.suspended_at is null
              and (q.expires_on is null or q.expires_on >= p_jour)
              and app.habilitation_couvre(q, b.required_kind, b.required_symbols)
            order by q.expires_on desc nulls first limit 1) as qid,
           (select max(q.expires_on) from public.hr_qualifications q
            where q.person_id = b.person_id and q.expires_on < p_jour
              and app.habilitation_couvre(q, b.required_kind, b.required_symbols)) as derniere_fin
    from besoins b
  )
  select m.person_id, m.nom, m.poste, m.requirement_id, m.exigence,
         case when m.qid is null then 'manque' else 'fin_proche' end,
         m.qid, q.label, q.expires_on, m.derniere_fin
  from meilleur m
  left join public.hr_qualifications q on q.id = m.qid
  where m.qid is null or (q.expires_on is not null and q.expires_on < (p_jour + interval '3 months')::date)
$$;
revoke all on function app.habilitations_ecarts(uuid, date) from public, anon, authenticated;

create or replace function public.habilitations_actions_generer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  v_owner uuid;
  v_jour date := (now() at time zone 'Europe/Paris')::date;
  v_n int;
  v_total int := 0;
begin
  if coalesce((select auth.role()), '') not in ('service_role', '') then
    raise exception 'Réservé à la tâche de nuit' using errcode = '42501';
  end if;
  for c in
    select co.id from public.companies co
    where exists (select 1 from public.company_modules cm where cm.company_id = co.id and cm.key = 'rh' and cm.enabled)
  loop
    select s.titres_owner_id into v_owner from public.hr_settings s
    join public.profiles pr on pr.id = s.titres_owner_id and pr.is_active
    where s.company_id = c.id;
    insert into public.team_actions (company_id, title, detail, owner_id, due_on, source, source_id, link, dedup_key)
    select c.id,
           left(case e.motif when 'manque' then 'Titre à obtenir : ' else 'Titre à renouveler : ' end || e.nom || ', ' || e.exigence, 300),
           left(case e.motif
             when 'manque' then 'Le poste « ' || e.poste || ' » exige : ' || e.exigence
               || '. Aucun titre valide sur la fiche du personnel (absent, échu ou suspendu).'
             else 'Le poste « ' || e.poste || ' » exige : ' || e.exigence || '. Le titre « ' || e.titre || ' » se termine le '
               || to_char(e.expires_on, 'DD/MM/YYYY') || '.'
           end, 2000),
           v_owner,
           case e.motif when 'manque' then v_jour else e.expires_on end,
           'habilitation', e.person_id, '/collaborateurs/' || e.person_id,
           'hab:' || e.person_id || ':' || e.requirement_id || ':' ||
             case e.motif when 'manque' then 'manque:' || coalesce(e.derniere_fin::text, 'aucun')
                          else 'fin:' || e.expires_on::text end
    from app.habilitations_ecarts(c.id, v_jour) e
    on conflict (company_id, dedup_key) where dedup_key is not null do nothing;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;
  return jsonb_build_object('actions', v_total);
end
$$;
revoke all on function public.habilitations_actions_generer() from public, anon, authenticated;
grant execute on function public.habilitations_actions_generer() to service_role;

-- ── Journal et droits ──
do $$
declare t text;
begin
  foreach t in array array['hr_jobs', 'hr_job_requirements', 'hr_settings'] loop
    execute format('drop trigger if exists zz_audit_row on public.%I', t);
    execute format('create trigger zz_audit_row after insert or update or delete on public.%I for each row execute function app.audit_row(%L)', t, 'parametres_rh');
  end loop;
end $$;

alter table public.hr_jobs enable row level security;
alter table public.hr_job_requirements enable row level security;
alter table public.hr_settings enable row level security;
revoke all on table public.hr_jobs, public.hr_job_requirements, public.hr_settings from public, anon;
grant select, insert, update, delete on table public.hr_jobs, public.hr_job_requirements, public.hr_settings to authenticated;
grant all on table public.hr_jobs, public.hr_job_requirements, public.hr_settings to service_role;

do $$
declare t text;
begin
  foreach t in array array['hr_jobs', 'hr_job_requirements', 'hr_settings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_lire', t);
    execute format('drop policy if exists %I on public.%I', t || '_creer', t);
    execute format('drop policy if exists %I on public.%I', t || '_modifier', t);
    execute format('drop policy if exists %I on public.%I', t || '_supprimer', t);
    -- Lecture : qui voit les dossiers du personnel ou règle les paramètres RH ; écriture : paramètres RH
    execute format('create policy %I on public.%I for select to authenticated using ((company_id in (select app.societes_avec_droit(%L)) or company_id in (select app.societes_avec_droit(%L))))',
      t || '_lire', t, 'rh.dossiers.voir', 'rh.parametres.gerer');
    execute format('create policy %I on public.%I for insert to authenticated with check (company_id in (select app.societes_avec_droit(%L)))', t || '_creer', t, 'rh.parametres.gerer');
    execute format('create policy %I on public.%I for update to authenticated using (company_id in (select app.societes_avec_droit(%L))) with check (company_id in (select app.societes_avec_droit(%L)))', t || '_modifier', t, 'rh.parametres.gerer', 'rh.parametres.gerer');
    execute format('create policy %I on public.%I for delete to authenticated using (company_id in (select app.societes_avec_droit(%L)))', t || '_supprimer', t, 'rh.parametres.gerer');
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0513_rh_postes_habilitations') on conflict (version) do nothing;

-- ===== supabase/rollback/0513_rh_postes_habilitations_retour.sql =====
-- Retour arrière de 0513 : postes, titres exigés, paramètres RH et préparation de nuit retirés ; app.team_actions_maj
-- remise au corps de 0407. Les actions déjà préparées restent, en source « manuel » (le travail fait n'est pas perdu).

drop function if exists public.habilitations_actions_generer();
drop function if exists app.habilitations_ecarts(uuid, date);
drop function if exists app.habilitation_couvre(public.hr_qualifications, text, text[]);

CREATE OR REPLACE FUNCTION app.team_actions_maj()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.postponed_count := 0;
  else
    new.company_id := old.company_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.source := old.source;
    new.source_id := old.source_id;
    -- Report : l'échéance d'une action à faire recule
    new.postponed_count := old.postponed_count;
    if old.status = 'a_faire' and new.status = 'a_faire' and old.due_on is not null and new.due_on > old.due_on then
      new.postponed_count := old.postponed_count + 1;
    end if;
  end if;
  if new.status = 'fait' and (tg_op = 'INSERT' or old.status <> 'fait') then
    new.done_at := now();
    new.done_by := auth.uid();
  elsif new.status <> 'fait' then
    new.done_at := null;
    new.done_by := null;
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  new.updated_at := now();
  return new;
end
$function$;
revoke all on function app.team_actions_maj() from public, anon, authenticated;

alter table public.team_actions disable trigger team_actions_maj;
update public.team_actions set source = 'manuel' where source = 'habilitation';
alter table public.team_actions enable trigger team_actions_maj;
drop index if exists public.team_actions_dedup_uniq;
alter table public.team_actions drop column if exists dedup_key;
alter table public.team_actions drop constraint if exists team_actions_source_check;
alter table public.team_actions add constraint team_actions_source_check
  check (source in ('manuel', 'point', 'bilan', 'reunion'));

drop trigger if exists hr_employments_poste on public.hr_employments;
drop function if exists app.hr_employments_poste();
drop index if exists public.hr_employments_job_idx;
alter table public.hr_employments drop column if exists job_id;
drop table if exists public.hr_settings;
drop table if exists public.hr_job_requirements;
drop function if exists app.hr_job_requirements_societe();
drop table if exists public.hr_jobs;

delete from public.schema_migrations where version = '0513_rh_postes_habilitations';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE rh_0513 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

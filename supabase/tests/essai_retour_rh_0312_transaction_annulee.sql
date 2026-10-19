-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (rh_0312) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0312_rh_validation_responsable.sql, retour arrière,
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

-- ===== supabase/migrations/0312_rh_validation_responsable.sql =====
-- 0312_rh_validation_responsable.sql : chantier 12, module RH, validation par le responsable d'équipe (spec
-- odet-spec-rh.md § 2 : « le manager n'est pas un rôle : c'est la relation responsable d'équipe, qui donne les
-- validations de son équipe quel que soit son rôle »).
--
-- Équipe d'une personne (app.hr_mon_equipe) : les personnes dont le contrat en cours la désigne comme responsable,
-- ou dont l'équipe a cette personne comme responsable. Jamais soi-même.
-- Le responsable lit les demandes d'absence, les soldes, les heures et les semaines de son équipe, et décide dans le
-- circuit commun (approval_decide) les absences et les semaines de son équipe. Les règles habituelles restent :
-- personne ne valide sa propre demande ; un refus demande un motif ; la RH et les droits « Valider » gardent la main.
-- Il ne lit ni les coordonnées personnelles, ni les documents, ni le suivi de santé de son équipe.
-- Droits (build_suite('0312')) : règles de lecture de 0294 et 0297 complétées par l'équipe.
-- Migration additive (fonctions et règles remplacées). Idempotente.
-- Retour arrière : supabase/rollback/0312_rh_validation_responsable_retour.sql

create or replace function app.hr_mon_equipe()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct e.person_id
  from public.hr_employments e
  left join public.hr_teams t on t.id = e.team_id
  where (e.end_on is null or e.end_on >= current_date - 31)
    and e.start_on <= current_date + 62
    and (e.manager_person_id in (select app.hr_mes_personnes()) or t.manager_person_id in (select app.hr_mes_personnes()))
    and e.person_id not in (select app.hr_mes_personnes())
$$;
revoke all on function app.hr_mon_equipe() from public, anon;
grant execute on function app.hr_mon_equipe() to authenticated;

-- Le compte connecté est-il responsable d'au moins une personne ? (écrans : tableau de bord, validations)
create or replace function public.hr_suis_responsable()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.hr_mon_equipe())
$$;
revoke all on function public.hr_suis_responsable() from public, anon;
grant execute on function public.hr_suis_responsable() to authenticated;

-- Le responsable peut-il décider cette demande du circuit ? Absences et semaines de son équipe, en attente,
-- jamais la sienne
create or replace function app.hr_responsable_peut_decider(p_request uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
  v_pers uuid;
begin
  select * into r from public.approval_requests where id = p_request;
  if r.id is null or r.status <> 'pending' or r.requested_by is not distinct from (select auth.uid()) then return false; end if;
  if r.scope = 'absence' and r.object_table = 'hr_absence_requests' then
    select a.person_id into v_pers from public.hr_absence_requests a where a.id = r.object_id and a.company_id = r.company_id;
  elsif r.scope = 'timesheet' and r.object_table = 'hr_timesheets' then
    select s.person_id into v_pers from public.hr_timesheets s where s.id = r.object_id and s.company_id = r.company_id;
  else
    return false;
  end if;
  return v_pers is not null and v_pers in (select app.hr_mon_equipe());
end
$$;
revoke all on function app.hr_responsable_peut_decider(uuid) from public, anon;
grant execute on function app.hr_responsable_peut_decider(uuid) to authenticated;

-- Décision dans le circuit commun : identique à 0375, le responsable d'équipe en plus
create or replace function public.approval_decide(p_request uuid, p_decision text, p_comment text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
  v_right text;
  v_as uuid;
  v_status text;
begin
  select * into r from public.approval_requests where id = p_request for update;
  if r.id is null then
    raise exception 'Demande introuvable' using errcode = '22023';
  end if;
  v_right := r.steps ->> r.current_step;
  if not (app.approval_can_decide(r.company_id, r.scope, v_right, r.requested_by, r.status)
          or app.hr_responsable_peut_decider(r.id)) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Décision inconnue : %', p_decision using errcode = '22023';
  end if;
  if p_decision = 'rejected' and char_length(btrim(coalesce(p_comment, ''))) < 3 then
    raise exception 'Un refus demande un motif' using errcode = '22023';
  end if;
  -- Décision au nom d'une autre personne (délégation) : notée
  if not app.a_le_droit_dans(r.company_id, v_right) then
    select d.from_profile into v_as from public.approval_delegations d
    where d.company_id = r.company_id and d.to_profile = (select auth.uid()) and d.revoked_at is null
      and now() >= d.starts_at and now() < d.ends_at and (d.scope is null or d.scope = r.scope)
      and v_right = any (app.rights_for(d.from_profile, r.company_id))
    order by d.created_at limit 1;
  end if;
  v_status := case when p_decision = 'rejected' then 'rejected'
                   when r.current_step + 1 >= jsonb_array_length(r.steps) then 'approved'
                   else 'pending' end;
  update public.approval_requests set
    status = v_status,
    current_step = case when v_status = 'pending' then r.current_step + 1 else r.current_step end,
    history = r.history || jsonb_build_array(jsonb_build_object('at', now(), 'by', (select auth.uid()), 'as', v_as,
                                                                'action', p_decision, 'step', r.current_step,
                                                                'comment', left(p_comment, 500))),
    decided_by = case when v_status <> 'pending' then (select auth.uid()) end,
    decided_at = case when v_status <> 'pending' then now() end,
    decision_comment = case when v_status <> 'pending' then left(p_comment, 500) end,
    updated_at = now()
  where id = r.id;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'system', r.id, 'Validation : ' || p_decision,
          jsonb_build_object('company_id', r.company_id, 'scope', r.scope, 'object_table', r.object_table,
                             'step', r.current_step, 'on_behalf_of', v_as, 'status', v_status));
  return v_status;
end
$$;


-- ── Règles (générées par scripts/securite/regles.py, build_suite('0312')) ──

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
           where schemaname = 'public' and tablename = any (array['hr_absence_requests', 'hr_leave_ledger', 'hr_time_entries', 'hr_timesheets'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- hr_absence_requests
select pg_temp.regles(array['hr_absence_requests'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or company_id in (select app.societes_avec_droit('rh.absences.valider')) or person_id in (select app.hr_mes_personnes()) or person_id in (select app.hr_mon_equipe()))$r$,
  null,
  null,
  null);

-- hr_leave_ledger
select pg_temp.regles(array['hr_leave_ledger'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or company_id in (select app.societes_avec_droit('rh.absences.valider')) or person_id in (select app.hr_mes_personnes()) or person_id in (select app.hr_mon_equipe()))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$);

-- hr_time_entries
select pg_temp.regles(array['hr_time_entries'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or company_id in (select app.societes_avec_droit('rh.heures.valider')) or person_id in (select app.hr_mes_personnes()) or person_id in (select app.hr_mon_equipe()))$r$,
  $r$((person_id in (select app.hr_mes_personnes()) and company_id in (select app.societes_avec_droit('rh.heures.saisir'))) or company_id in (select app.societes_avec_droit('rh.dossiers.gerer')))$r$,
  $r$((person_id in (select app.hr_mes_personnes()) and company_id in (select app.societes_avec_droit('rh.heures.saisir'))) or company_id in (select app.societes_avec_droit('rh.dossiers.gerer')))$r$,
  $r$((person_id in (select app.hr_mes_personnes()) and company_id in (select app.societes_avec_droit('rh.heures.saisir'))) or company_id in (select app.societes_avec_droit('rh.dossiers.gerer')))$r$);

-- hr_timesheets
select pg_temp.regles(array['hr_timesheets'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or company_id in (select app.societes_avec_droit('rh.heures.valider')) or person_id in (select app.hr_mes_personnes()) or person_id in (select app.hr_mon_equipe()))$r$,
  null,
  null,
  null);


insert into public.schema_migrations (version) values ('0312_rh_validation_responsable') on conflict (version) do nothing;

-- ===== supabase/rollback/0312_rh_validation_responsable_retour.sql =====
-- Retour arrière de 0312_rh_validation_responsable.sql : remet la décision du circuit (0375) et les règles de lecture
-- de 0294 et 0297, retire les fonctions de l'équipe. Idempotent.

create or replace function public.approval_decide(p_request uuid, p_decision text, p_comment text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
  v_right text;
  v_as uuid;
  v_status text;
begin
  select * into r from public.approval_requests where id = p_request for update;
  if r.id is null then
    raise exception 'Demande introuvable' using errcode = '22023';
  end if;
  v_right := r.steps ->> r.current_step;
  if not app.approval_can_decide(r.company_id, r.scope, v_right, r.requested_by, r.status) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Décision inconnue : %', p_decision using errcode = '22023';
  end if;
  if p_decision = 'rejected' and char_length(btrim(coalesce(p_comment, ''))) < 3 then
    raise exception 'Un refus demande un motif' using errcode = '22023';
  end if;
  -- Décision au nom d'une autre personne (délégation) : notée
  if not app.a_le_droit_dans(r.company_id, v_right) then
    select d.from_profile into v_as from public.approval_delegations d
    where d.company_id = r.company_id and d.to_profile = (select auth.uid()) and d.revoked_at is null
      and now() >= d.starts_at and now() < d.ends_at and (d.scope is null or d.scope = r.scope)
      and v_right = any (app.rights_for(d.from_profile, r.company_id))
    order by d.created_at limit 1;
  end if;
  v_status := case when p_decision = 'rejected' then 'rejected'
                   when r.current_step + 1 >= jsonb_array_length(r.steps) then 'approved'
                   else 'pending' end;
  update public.approval_requests set
    status = v_status,
    current_step = case when v_status = 'pending' then r.current_step + 1 else r.current_step end,
    history = r.history || jsonb_build_array(jsonb_build_object('at', now(), 'by', (select auth.uid()), 'as', v_as,
                                                                'action', p_decision, 'step', r.current_step,
                                                                'comment', left(p_comment, 500))),
    decided_by = case when v_status <> 'pending' then (select auth.uid()) end,
    decided_at = case when v_status <> 'pending' then now() end,
    decision_comment = case when v_status <> 'pending' then left(p_comment, 500) end,
    updated_at = now()
  where id = r.id;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'system', r.id, 'Validation : ' || p_decision,
          jsonb_build_object('company_id', r.company_id, 'scope', r.scope, 'object_table', r.object_table,
                             'step', r.current_step, 'on_behalf_of', v_as, 'status', v_status));
  return v_status;
end
$$;



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
           where schemaname = 'public' and tablename = any (array['hr_absence_requests', 'hr_leave_ledger', 'hr_time_entries', 'hr_timesheets'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;



-- hr_absence_requests
select pg_temp.regles(array['hr_absence_requests'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or company_id in (select app.societes_avec_droit('rh.absences.valider')) or person_id in (select app.hr_mes_personnes()))$r$,
  null,
  null,
  null);

-- hr_leave_ledger
select pg_temp.regles(array['hr_leave_ledger'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or company_id in (select app.societes_avec_droit('rh.absences.valider')) or person_id in (select app.hr_mes_personnes()))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$);

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

drop function if exists app.hr_responsable_peut_decider(uuid);
drop function if exists public.hr_suis_responsable();
drop function if exists app.hr_mon_equipe();

delete from public.schema_migrations where version = '0312_rh_validation_responsable';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE rh_0312 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (f_0345) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0345_journal_audit.sql, retour arrière,
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

-- ===== supabase/migrations/0345_journal_audit.sql =====
-- 0345_journal_audit.sql : chantier F phase 2, journal d'audit commun écrit par la base.
--
-- Spec : odet-conformite-rgpd-certifications.md § 5.7 (principe 5 de l'architecture).
-- 1. audit_logs : rôle de l'auteur et source (base, application, support) ; type d'objet libre (lettres et _).
-- 2. Garde à l'écriture : l'auteur, son email, son rôle, l'adresse IP et le navigateur sont posés par la base à partir
--    du jeton et des en-têtes de la requête ; une ligne ne peut plus être écrite au nom d'un autre compte.
--    log_audit() ignore désormais l'utilisateur et l'email passés par l'application. Aucune modification ni
--    suppression par un compte (inchangé : aucune règle ne le permet).
-- 3. app.audit_row() : déclencheur posé sur les tables sensibles (stagiaires, handicap, Passeport, formateurs,
--    comptes et appartenances, sociétés, réglages, modules, factures, RGPD, certification). Il écrit l'action, la
--    table, l'identifiant et la liste des champs modifiés, JAMAIS leurs valeurs. Les écritures sans compte (tâches
--    de nuit, service) ne sont pas tracées ; les champs techniques (dates de mise à jour, préférences d'affichage)
--    ne déclenchent rien seuls.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0345_journal_audit_retour.sql

-- ── 1. Colonnes ──
alter table public.audit_logs add column if not exists actor_role text;
alter table public.audit_logs add column if not exists source text not null default 'application';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'audit_logs_source_check') then
    alter table public.audit_logs add constraint audit_logs_source_check check (source in ('application', 'base', 'support'));
  end if;
end $$;
alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type::text ~ '^[a-z_]{2,50}$');
create index if not exists audit_logs_company_temps_idx on public.audit_logs (company_id, "timestamp" desc);

-- ── 2. Garde à l'écriture ──
create or replace function app.audit_entete(p_nom text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(left(btrim(split_part(coalesce((nullif(current_setting('request.headers', true), '')::jsonb) ->> p_nom, ''), ',', 1)), 300), '')
$$;
revoke all on function app.audit_entete(text) from public, anon, authenticated;

create or replace function app.audit_logs_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is not null then
    new.user_id := v_uid;
    new.user_email := coalesce((select p.email from public.profiles p where p.id = v_uid),
                               nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email');
    new.actor_role := app.role();
    new.ip_address := coalesce(app.audit_entete('x-forwarded-for'), app.audit_entete('x-real-ip'), new.ip_address);
    new.user_agent := coalesce(app.audit_entete('user-agent'), new.user_agent);
    if new.source = 'base' and tg_op = 'INSERT' and pg_trigger_depth() = 1 then
      new.source := 'application';
    end if;
  end if;
  new.timestamp := coalesce(new.timestamp, now());
  return new;
end
$$;
revoke all on function app.audit_logs_garde() from public, anon, authenticated;
drop trigger if exists audit_logs_garde on public.audit_logs;
create trigger audit_logs_garde before insert on public.audit_logs for each row execute function app.audit_logs_garde();

-- log_audit : même signature (l'application l'appelle), mais l'auteur vient du jeton, jamais des paramètres
create or replace function public.log_audit(p_user_id uuid, p_user_email text, p_action text, p_entity_type text,
  p_entity_id uuid default null, p_entity_name text default null, p_details jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Journal d''audit : compte connecté requis' using errcode = '42501';
  end if;
  insert into public.audit_logs (action, entity_type, entity_id, entity_name, details, company_id, source)
  values (p_action, p_entity_type, p_entity_id, p_entity_name, p_details,
          coalesce(app.current_company(), app.company_default()), 'application')
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.log_audit(uuid, text, text, text, uuid, text, jsonb) from public, anon;
grant execute on function public.log_audit(uuid, text, text, text, uuid, text, jsonb) to authenticated;

-- ── 3. Déclencheur des tables sensibles ──
create or replace function app.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_champs text[];
  v_id uuid;
  v_company uuid;
  v_type text := coalesce(tg_argv[0], 'system');
  v_bruit text[] := array['updated_at', 'date_mise_a_jour', 'ui_prefs', 'last_seen_at', 'last_sign_in_at', 'portal_last_access'];
begin
  if v_uid is null then
    return null;
  end if;
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row := coalesce(v_new, v_old);
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into v_champs
    from jsonb_object_keys(v_new) k
    where (v_new -> k) is distinct from (v_old -> k) and not (k = any (v_bruit));
    if cardinality(v_champs) = 0 then
      return null;
    end if;
  end if;
  begin
    v_id := (v_row ->> 'id')::uuid;
  exception when others then
    v_id := null;
  end;
  begin
    v_company := (v_row ->> 'company_id')::uuid;
  exception when others then
    v_company := null;
  end;
  -- Une société, ou une ligne supprimée avec sa société : la trace va au journal de la société propriétaire de
  -- l'instance
  if tg_table_name = 'companies'
     or (v_company is not null and not exists (select 1 from public.companies c where c.id = v_company)) then
    v_company := app.company_default();
  end if;
  insert into public.audit_logs (action, entity_type, entity_id, entity_name, details, company_id, source)
  values (case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
          v_type, v_id,
          case when v_id is null then coalesce(v_row ->> 'key', v_row ->> 'code') end,
          jsonb_strip_nulls(jsonb_build_object('table', tg_table_name, 'champs', v_champs)),
          coalesce(v_company, app.current_company(), app.company_default()), 'base');
  return null;
end
$$;
revoke all on function app.audit_row() from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('trainees', 'trainee'), ('trainee_disability', 'stagiaire_handicap'), ('psh_requests', 'stagiaire_handicap'),
    ('trainee_ssn', 'passeport'), ('pp_nir', 'passeport'), ('trainers', 'trainer'),
    ('profiles', 'compte'), ('company_members', 'compte'), ('company_member_roles', 'compte'),
    ('companies', 'societe'), ('organization_settings', 'reglages'), ('billing_settings', 'reglages'),
    ('cert_settings', 'reglages'), ('org_modules', 'module'), ('company_modules', 'module'),
    ('invoices', 'facture'), ('rgpd_traitements', 'rgpd'), ('rgpd_demandes', 'rgpd'), ('rgpd_violations', 'rgpd'),
    ('rgpd_sous_traitants', 'rgpd')
  ) as t(nom, type) loop
    if to_regclass('public.' || r.nom) is not null then
      execute format('drop trigger if exists zz_audit_row on public.%I', r.nom);
      execute format('create trigger zz_audit_row after insert or update or delete on public.%I for each row execute function app.audit_row(%L)', r.nom, r.type);
    end if;
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0345_journal_audit') on conflict (version) do nothing;

-- ===== supabase/rollback/0345_journal_audit_retour.sql =====
-- Retour arrière de 0345_journal_audit.sql : retire le déclencheur des tables sensibles, la garde à l'écriture et les
-- colonnes ajoutées ; log_audit revient à sa version d'origine (0001). Idempotent.
-- Les lignes écrites par la base (source « base ») et celles d'un type d'objet inconnu de l'ancienne liste sont
-- retirées (l'ancienne contrainte les refuserait) : ce retour arrière efface donc la partie du journal écrite depuis 0345.

do $$
declare r record;
begin
  for r in select tgrelid::regclass as t from pg_trigger where tgname = 'zz_audit_row' and not tgisinternal loop
    execute format('drop trigger if exists zz_audit_row on %s', r.t);
  end loop;
end $$;
drop function if exists app.audit_row();
drop trigger if exists audit_logs_garde on public.audit_logs;
drop function if exists app.audit_logs_garde();
drop function if exists app.audit_entete(text);

create or replace function public.log_audit(p_user_id uuid, p_user_email text, p_action text, p_entity_type text,
  p_entity_id uuid default null::uuid, p_entity_name text default null::text, p_details jsonb default null::jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO audit_logs (
    user_id, user_email, action, entity_type, 
    entity_id, entity_name, details
  ) VALUES (
    p_user_id, p_user_email, p_action, p_entity_type,
    p_entity_id, p_entity_name, p_details
  )
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$function$;
revoke all on function public.log_audit(uuid, text, text, text, uuid, text, jsonb) from public, anon;
grant execute on function public.log_audit(uuid, text, text, text, uuid, text, jsonb) to authenticated, service_role;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'source') then
    execute 'delete from public.audit_logs where source = ''base''';
  end if;
end $$;
delete from public.audit_logs where entity_type not in ('trainee', 'session', 'client', 'trainer', 'course', 'document', 'nc', 'veille', 'evaluation', 'attendance', 'system');
alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check (((entity_type)::text = any (array[('trainee'::character varying)::text, ('session'::character varying)::text, ('client'::character varying)::text, ('trainer'::character varying)::text, ('course'::character varying)::text, ('document'::character varying)::text, ('nc'::character varying)::text, ('veille'::character varying)::text, ('evaluation'::character varying)::text, ('attendance'::character varying)::text, ('system'::character varying)::text])));
alter table public.audit_logs drop constraint if exists audit_logs_source_check;
drop index if exists public.audit_logs_company_temps_idx;
alter table public.audit_logs drop column if exists source;
alter table public.audit_logs drop column if exists actor_role;

delete from public.schema_migrations where version = '0345_journal_audit';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE f_0345 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

-- 0273_societes_regles.sql : règles d'accès des tables du socle multi-sociétés (chantier C1a).
-- FICHIER GÉNÉRÉ par scripts/securite/regles.py (matrice MS). Ne pas modifier à la main.
--
-- Même principe que 0082 : une règle par action et par table pour authenticated ; aucune pour anon.
-- Termine par la photographie des tables existantes (app.tables_avant_societes) : toute table créée après
-- cette migration doit naître avec une colonne company_id (contrôlé par supabase/tests/droits_chantier2.sql).
-- Migration idempotente. Retour arrière : supabase/rollback/0270-0273_societes_retour.sql

-- Droits des tables : rien pour anon ; ni TRUNCATE, ni TRIGGER, ni REFERENCES pour les comptes connectés
do $$
declare t text;
begin
  foreach t in array array['companies', 'company_establishments', 'company_member_roles', 'company_members', 'company_modules', 'support_access_grants'] loop
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke truncate, trigger, references on table public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end $$;

-- Suppression des règles existantes de ces tables
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['companies', 'company_establishments', 'company_member_roles', 'company_members', 'company_modules', 'support_access_grants']) loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


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


-- companies
select pg_temp.regles(array['companies'], null,
  $r$(id in (select app.visible_companies()) or (select app.is_superadmin()))$r$,
  $r$(select app.is_superadmin())$r$,
  $r$((select app.is_superadmin()) or (app.is_company_admin(id) and full_license))$r$,
  null);

-- company_establishments
select pg_temp.regles(array['company_establishments'], null,
  $r$(company_id in (select app.visible_companies()) or (select app.is_superadmin()))$r$,
  $r$((select app.is_superadmin()) or (app.is_company_admin(company_id) and exists (select 1 from public.companies c where c.id = company_id and c.full_license)))$r$,
  $r$((select app.is_superadmin()) or (app.is_company_admin(company_id) and exists (select 1 from public.companies c where c.id = company_id and c.full_license)))$r$,
  $r$(select app.is_superadmin())$r$);

-- company_member_roles
select pg_temp.regles(array['company_member_roles'], null,
  $r$member_id in (select m.id from public.company_members m)$r$,
  $r$member_id in (select m.id from public.company_members m where app.is_company_admin(m.company_id))$r$,
  $r$member_id in (select m.id from public.company_members m where app.is_company_admin(m.company_id))$r$,
  $r$member_id in (select m.id from public.company_members m where app.is_company_admin(m.company_id))$r$);

-- company_members
select pg_temp.regles(array['company_members'], null,
  $r$(profile_id = (select auth.uid()) or app.is_company_admin(company_id))$r$,
  $r$app.is_company_admin(company_id)$r$,
  $r$app.is_company_admin(company_id)$r$,
  $r$app.is_company_admin(company_id)$r$);

-- company_modules
select pg_temp.regles(array['company_modules'], null,
  $r$(company_id in (select app.visible_companies()) or (select app.is_superadmin()))$r$,
  $r$app.is_company_admin(company_id)$r$,
  $r$app.is_company_admin(company_id)$r$,
  $r$(select app.is_superadmin())$r$);

-- support_access_grants
select pg_temp.regles(array['support_access_grants'], null,
  $r$((select app.is_superadmin()) or coalesce(app.company_role(company_id) = any (array['admin', 'direction']), false))$r$,
  null,
  null,
  null);

-- Photographie des tables existantes : elles seront rattachées aux sociétés par C2.
-- Toute table créée après 0273 doit naître avec une colonne company_id.
create table if not exists app.tables_avant_societes (table_name text primary key);
revoke all on table app.tables_avant_societes from public, anon, authenticated;
insert into app.tables_avant_societes (table_name)
select c.relname from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
on conflict (table_name) do nothing;

insert into public.schema_migrations (version) values ('0273_societes_regles') on conflict (version) do nothing;

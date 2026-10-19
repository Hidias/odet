-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (societes_0054) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0054_etablissement_principal.sql, retour arrière,
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

-- ===== supabase/migrations/0054_etablissement_principal.sql =====
-- 0054_etablissement_principal.sql : une seule source pour l'adresse mise en avant de chaque société
-- (décision de H, 19/10, 18h32).
--
-- 1. company_establishments.is_main_site : l'établissement « adresse principale » d'une société (au plus un).
--    C'est l'adresse mise en avant sur les documents et les signatures (le siège reste l'adresse légale).
--    Un établissement peut ne pas avoir de SIRET (site non déclaré) : la colonne siret est déjà facultative.
-- 2. Société qui porte l'instance : organization_settings.exploitation_* (0049) devient une copie tenue par la base
--    depuis son établissement principal (déclencheur) ; plus de double saisie.
-- 3. app.identite_societe : une autre société prend l'adresse de SON établissement principal (avant : elle héritait
--    de celle de la société qui porte l'instance).
-- Aucune table nouvelle : colonne couverte par les règles existantes de company_establishments (0273).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0054_etablissement_principal_retour.sql

alter table public.company_establishments add column if not exists is_main_site boolean not null default false;

create unique index if not exists company_establishments_main_site_uniq
  on public.company_establishments (company_id) where is_main_site;

-- Copie dans organization_settings de l'établissement principal de la société qui porte l'instance
create or replace function app.etablissement_principal_vers_reglages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := coalesce(new.company_id, old.company_id);
  e public.company_establishments;
begin
  if not exists (select 1 from public.companies c where c.id = v_company and c.is_instance_owner) then
    return null;
  end if;
  select * into e from public.company_establishments
   where company_id = v_company and is_main_site and status = 'active' limit 1;
  update public.organization_settings
     set exploitation_address = e.address,
         exploitation_postal_code = e.postal_code,
         exploitation_city = e.city
   where exploitation_address is distinct from e.address
      or exploitation_postal_code is distinct from e.postal_code
      or exploitation_city is distinct from e.city;
  return null;
end $$;

drop trigger if exists company_establishments_principal on public.company_establishments;
create trigger company_establishments_principal
  after insert or update or delete on public.company_establishments
  for each row execute function app.etablissement_principal_vers_reglages();

-- Identité d'une autre société : adresse de son établissement principal (aucune : pas de site mis en avant)
create or replace function app.identite_societe(p_company uuid)
 returns public.organization_settings
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  o public.organization_settings;
  c public.companies;
  v_siret text;
  e public.company_establishments;
begin
  select * into o from public.organization_settings limit 1;
  select * into c from public.companies where id = p_company;
  if c.id is null or c.is_instance_owner then
    return o;
  end if;
  select e2.siret into v_siret from public.company_establishments e2 where e2.company_id = c.id and e2.is_head_office limit 1;
  select * into e from public.company_establishments e3 where e3.company_id = c.id and e3.is_main_site and e3.status = 'active' limit 1;
  o.name := coalesce(c.short_name, c.legal_name);
  o.legal_name := c.legal_name;
  o.forme_juridique := c.legal_form;
  o.capital_social := c.capital;
  o.siren := c.siren;
  o.siret := v_siret;
  o.naf := c.naf;
  o.tva_intra := c.vat_number;
  o.tva_applicable := c.vat_applicable;
  o.rcs := c.rcs;
  o.nda := c.nda;
  o.address := c.address;
  o.postal_code := c.postal_code;
  o.city := c.city;
  o.exploitation_address := e.address;
  o.exploitation_postal_code := e.postal_code;
  o.exploitation_city := e.city;
  o.phone := c.phone;
  o.email := c.email;
  o.website := c.website;
  o.bank_name := c.bank_name;
  o.iban := c.iban;
  o.bic := c.bic;
  o.logo_url := coalesce(c.logo_url, o.logo_url);
  o.doc_prefix := c.doc_prefix;
  return o;
end
$function$;

revoke all on function app.etablissement_principal_vers_reglages() from public, anon, authenticated;

insert into public.schema_migrations (version) values ('0054_etablissement_principal') on conflict (version) do nothing;

-- ===== supabase/rollback/0054_etablissement_principal_retour.sql =====
-- Retour arrière de 0054_etablissement_principal.sql. Idempotent. Les sites saisis restent dans
-- company_establishments (la marque « adresse principale » est perdue) ; organization_settings garde sa dernière copie.

drop trigger if exists company_establishments_principal on public.company_establishments;
drop function if exists app.etablissement_principal_vers_reglages();

create or replace function app.identite_societe(p_company uuid)
 returns public.organization_settings
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  o public.organization_settings;
  c public.companies;
  v_siret text;
begin
  select * into o from public.organization_settings limit 1;
  select * into c from public.companies where id = p_company;
  if c.id is null or c.is_instance_owner then
    return o;
  end if;
  select e.siret into v_siret from public.company_establishments e where e.company_id = c.id and e.is_head_office limit 1;
  o.name := coalesce(c.short_name, c.legal_name);
  o.legal_name := c.legal_name;
  o.forme_juridique := c.legal_form;
  o.capital_social := c.capital;
  o.siren := c.siren;
  o.siret := v_siret;
  o.naf := c.naf;
  o.tva_intra := c.vat_number;
  o.tva_applicable := c.vat_applicable;
  o.rcs := c.rcs;
  o.nda := c.nda;
  o.address := c.address;
  o.postal_code := c.postal_code;
  o.city := c.city;
  o.phone := c.phone;
  o.email := c.email;
  o.website := c.website;
  o.bank_name := c.bank_name;
  o.iban := c.iban;
  o.bic := c.bic;
  o.logo_url := coalesce(c.logo_url, o.logo_url);
  o.doc_prefix := c.doc_prefix;
  return o;
end
$function$;

drop index if exists public.company_establishments_main_site_uniq;
alter table public.company_establishments drop column if exists is_main_site;

delete from public.schema_migrations where version = '0054_etablissement_principal';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE societes_0054 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

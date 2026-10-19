-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (societes_0054) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0054_etablissement_principal.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0054_etablissement_principal_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

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

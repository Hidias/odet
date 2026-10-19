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

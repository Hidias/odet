-- Retour arrière de 0491 : les identifiants rangés dans les colonnes génériques sont recopiés dans les colonnes héritées
-- quand celles-ci sont vides (aucune perte d'identifiant), puis les colonnes génériques sont retirées. L'origine
-- « csv » d'un client importé est perdue : elle n'existait pas avant 0491.
update public.clients set sellsy_id = external_ref
  where nullif(btrim(external_ref), '') is not null and nullif(btrim(sellsy_id), '') is null;
update public.client_contacts set sellsy_contact_id = external_ref
  where nullif(btrim(external_ref), '') is not null and nullif(btrim(sellsy_contact_id), '') is null;
update public.invoices set sellsy_reference = external_ref
  where nullif(btrim(external_ref), '') is not null and nullif(btrim(sellsy_reference), '') is null;

alter table public.clients drop column if exists external_source;
alter table public.clients drop column if exists external_ref;
alter table public.client_contacts drop column if exists external_ref;
alter table public.invoices drop column if exists external_ref;

delete from public.schema_migrations where version = '0491_import_generique';

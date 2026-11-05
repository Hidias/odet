-- 0491 : import générique (B3, décision de H du 05/11). L'import au format Sellsy devient un import CSV avec
-- correspondance des colonnes ; les identifiants de l'ancien outil sont rangés dans des colonnes génériques :
-- clients.external_source (« csv », plus tard « henrri ») et external_ref sur clients, client_contacts et invoices.
-- Les colonnes héritées sellsy_id, sellsy_contact_id et sellsy_reference (toutes vides en production, contrôle du 05/11)
-- sont recopiées dans les nouvelles colonnes, puis gardées : la version de l'application en service les écrit encore
-- jusqu'au déploiement. Leur retrait se fera dans un lot suivant. courses.sellsy_id n'a plus d'usage (import du
-- catalogue retiré, décision de H) : retrait dans ce même lot suivant. Aucune donnée supprimée.
-- Idempotente. Retour arrière : supabase/rollback/0491_import_generique_retour.sql

alter table public.clients add column if not exists external_source text;
alter table public.clients add column if not exists external_ref text;
alter table public.client_contacts add column if not exists external_ref text;
alter table public.invoices add column if not exists external_ref text;

-- Même longueur que les colonnes héritées (50) : le retour arrière y recopie les identifiants sans rien couper
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_external_ref_longueur') then
    alter table public.clients add constraint clients_external_ref_longueur check (char_length(external_ref) <= 50);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_contacts_external_ref_longueur') then
    alter table public.client_contacts add constraint client_contacts_external_ref_longueur check (char_length(external_ref) <= 50);
  end if;
end $$;

comment on column public.clients.external_source is 'Outil ou fichier d''origine du client importé (csv ; henrri plus tard). Vide pour un client créé dans l''application.';
comment on column public.clients.external_ref is 'Identifiant du client dans l''outil d''origine, gardé tel quel.';
comment on column public.client_contacts.external_ref is 'Identifiant du contact dans l''outil d''origine, gardé tel quel.';
comment on column public.invoices.external_ref is 'Numéro de la facture dans l''outil d''origine (historique importé), gardé tel quel.';

update public.clients set external_ref = sellsy_id, external_source = coalesce(external_source, 'sellsy')
  where nullif(btrim(sellsy_id), '') is not null and external_ref is null;
update public.client_contacts set external_ref = sellsy_contact_id
  where nullif(btrim(sellsy_contact_id), '') is not null and external_ref is null;
update public.invoices set external_ref = sellsy_reference
  where nullif(btrim(sellsy_reference), '') is not null and external_ref is null;

insert into public.schema_migrations (version) values ('0491_import_generique') on conflict (version) do nothing;

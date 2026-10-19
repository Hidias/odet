-- Retour arrière de 0041_clients_sites.sql : retire la synchronisation adresse de la fiche / site par défaut et
-- les colonnes ajoutées. Idempotent.
-- Refusé si une colonne ajoutée porte déjà une valeur (lecture du répertoire, SIRET d'un site, rattachement d'un
-- contact ou d'un salarié à un site) : ce sont des données saisies, jamais effacées par un retour arrière.
-- Les sites « adresse de la fiche » créés par 0041 restent (ce sont des sites ordinaires, sans effet sans les
-- déclencheurs).

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sites' and column_name = 'is_head_office') then
    if exists (select 1 from public.clients where legal_name is not null or dirigeant_nom is not null or dirigeant_qualite is not null
                 or date_creation is not null or etat_administratif is not null or registry_synced_at is not null
                 or registry_snapshot is not null or country is distinct from 'FR')
       or exists (select 1 from public.sites where siret is not null or is_head_office or etat_administratif is not null or registry_snapshot is not null)
       or exists (select 1 from public.client_contacts where site_id is not null)
       or exists (select 1 from public.trainees where site_id is not null) then
      raise exception 'Retour arrière refusé : des valeurs ont été saisies dans les colonnes de 0041';
    end if;
  end if;
end $$;

drop trigger if exists clients_site_defaut on public.clients;
drop trigger if exists clients_adresse_site on public.clients;
drop trigger if exists sites_adresse_client on public.sites;
drop function if exists app.client_site_defaut();
drop function if exists app.client_adresse_vers_site();
drop function if exists app.site_adresse_vers_client();
drop function if exists public.tva_from_siren(text);

drop index if exists public.sites_client_default_key;
drop index if exists public.sites_siret_idx;
drop index if exists public.client_contacts_site_idx;
drop index if exists public.trainees_site_idx;

alter table public.trainees drop column if exists site_id;
alter table public.client_contacts drop column if exists site_id;
alter table public.sites drop column if exists registry_snapshot;
alter table public.sites drop column if exists etat_administratif;
alter table public.sites drop column if exists is_head_office;
alter table public.sites drop column if exists siret;
alter table public.clients drop column if exists registry_snapshot;
alter table public.clients drop column if exists registry_synced_at;
alter table public.clients drop column if exists etat_administratif;
alter table public.clients drop column if exists date_creation;
alter table public.clients drop column if exists dirigeant_qualite;
alter table public.clients drop column if exists dirigeant_nom;
alter table public.clients drop column if exists country;
alter table public.clients drop column if exists legal_name;

delete from public.schema_migrations where version = '0041_clients_sites';

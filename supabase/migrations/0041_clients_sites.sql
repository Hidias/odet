-- 0041_clients_sites.sql : clients et sites, une seule source pour chaque information (lot 2, branche clients-sites).
--
-- Spec : odet-lot2-spec.md v2, section 2. Déjà fait avant : TVA calculée depuis le SIREN et particuliers (0040),
-- coordonnées du client figées à l'émission (0361, invoices.buyer_snapshot), contrôle de l'annuaire (0365).
-- 1. clients : raison sociale du répertoire, pays, dirigeant, date de création, état administratif, dernière
--    lecture du répertoire et sa photographie (jamais écrites sans l'accord de l'utilisateur, écart par écart).
-- 2. sites : SIRET, siège au répertoire, état administratif, photographie du répertoire ; un seul site
--    « adresse de la fiche » (is_default) par client.
-- 3. client_contacts.site_id, trainees.site_id (facultatifs) : rattacher un interlocuteur ou un salarié à un site.
-- 4. Adresse de la fiche = site par défaut, synchronisés dans les deux sens (déclencheurs, sans boucle) ; un
--    client professionnel créé reçoit son site par défaut ; les clients professionnels qui n'en ont pas le
--    reçoivent ici (données de démonstration). Un particulier n'a pas de site.
-- 5. public.tva_from_siren(siren) : même calcul que l'application (src/core/org/tva.js), pour le serveur.
-- Classes multi-sociétés : sites hérite des sociétés du client (company_id, company_ids) à la création automatique.
-- Migration additive : aucune colonne retirée. Idempotente.
-- Retour arrière : supabase/rollback/0041_clients_sites_retour.sql

-- ── 1. clients ──
alter table public.clients add column if not exists legal_name text;
alter table public.clients add column if not exists country char(2) not null default 'FR';
alter table public.clients add column if not exists dirigeant_nom text;
alter table public.clients add column if not exists dirigeant_qualite text;
alter table public.clients add column if not exists date_creation date;
alter table public.clients add column if not exists etat_administratif text;
alter table public.clients add column if not exists registry_synced_at timestamptz;
alter table public.clients add column if not exists registry_snapshot jsonb;

comment on column public.clients.legal_name is 'Raison sociale au répertoire (le nom d''usage reste dans name)';
comment on column public.clients.etat_administratif is 'État au répertoire : A actif, C cessé (lu, jamais saisi)';
comment on column public.clients.registry_snapshot is 'Dernière réponse normalisée du répertoire des entreprises (écarts proposés, jamais écrits d''office)';

-- ── 2. sites ──
alter table public.sites add column if not exists siret varchar(14);
alter table public.sites add column if not exists is_head_office boolean not null default false;
alter table public.sites add column if not exists etat_administratif text;
alter table public.sites add column if not exists registry_snapshot jsonb;

comment on column public.sites.is_default is 'Site « adresse de la fiche » du client, synchronisé avec l''adresse de clients';
comment on column public.sites.is_head_office is 'Siège au répertoire (indépendant de is_default)';

create unique index if not exists sites_client_default_key on public.sites (client_id) where is_default and client_id is not null;
create index if not exists sites_siret_idx on public.sites (siret) where siret is not null;

-- ── 3. Rattachements facultatifs ──
alter table public.client_contacts add column if not exists site_id uuid references public.sites(id) on delete set null;
alter table public.trainees add column if not exists site_id uuid references public.sites(id) on delete set null;
create index if not exists client_contacts_site_idx on public.client_contacts (site_id) where site_id is not null;
create index if not exists trainees_site_idx on public.trainees (site_id) where site_id is not null;

-- ── 4. Adresse de la fiche = site par défaut ──
-- Création du client professionnel : site par défaut avec l'adresse de la fiche (droits du propriétaire : un compte
-- qui peut créer un client n'a pas forcément le droit d'écrire un site, et la création ne doit pas échouer pour cela)
create or replace function app.client_site_defaut()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.client_type, 'entreprise') = 'particulier' then
    return new;
  end if;
  if not exists (select 1 from public.sites s where s.client_id = new.id and s.is_default) then
    insert into public.sites (kind, name, address, postal_code, city, client_id, is_default, is_active, company_id, company_ids)
    values ('client', 'Adresse de la fiche', new.address, new.postal_code, new.city, new.id, true, true,
            new.company_id, new.company_ids);
  end if;
  return new;
end
$$;

-- Adresse de la fiche modifiée : le site par défaut suit (position effacée : recalculée au prochain enregistrement)
create or replace function app.client_adresse_vers_site()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sites s
     set address = new.address, postal_code = new.postal_code, city = new.city,
         latitude = null, longitude = null, updated_at = now()
   where s.client_id = new.id and s.is_default
     and (s.address is distinct from new.address or s.postal_code is distinct from new.postal_code
          or s.city is distinct from new.city);
  return new;
end
$$;

-- Site par défaut modifié : l'adresse de la fiche suit (aucune boucle : rien ne change si les valeurs sont égales)
create or replace function app.site_adresse_vers_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_default and new.client_id is not null then
    update public.clients c
       set address = new.address, postal_code = new.postal_code, city = new.city, updated_at = now()
     where c.id = new.client_id
       and (c.address is distinct from new.address or c.postal_code is distinct from new.postal_code
            or c.city is distinct from new.city);
  end if;
  return new;
end
$$;

revoke all on function app.client_site_defaut(), app.client_adresse_vers_site(), app.site_adresse_vers_client()
  from public, anon, authenticated;

drop trigger if exists clients_site_defaut on public.clients;
create trigger clients_site_defaut after insert on public.clients
  for each row execute function app.client_site_defaut();

drop trigger if exists clients_adresse_site on public.clients;
create trigger clients_adresse_site after update of address, postal_code, city on public.clients
  for each row execute function app.client_adresse_vers_site();

drop trigger if exists sites_adresse_client on public.sites;
create trigger sites_adresse_client after insert or update of address, postal_code, city, is_default on public.sites
  for each row execute function app.site_adresse_vers_client();

-- Clients professionnels sans site par défaut : on le crée depuis l'adresse de la fiche
insert into public.sites (kind, name, address, postal_code, city, client_id, is_default, is_active, company_id, company_ids)
select 'client', 'Adresse de la fiche', c.address, c.postal_code, c.city, c.id, true, true, c.company_id, c.company_ids
from public.clients c
where coalesce(c.client_type, 'entreprise') <> 'particulier'
  and not exists (select 1 from public.sites s where s.client_id = c.id and s.is_default);

-- ── 5. TVA depuis le SIREN ──
create or replace function public.tva_from_siren(p_siren text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_siren ~ '^\d{9}' then
    'FR' || lpad(((12 + 3 * (left(p_siren, 9)::bigint % 97)) % 97)::text, 2, '0') || left(p_siren, 9)
  end
$$;
grant execute on function public.tva_from_siren(text) to authenticated, service_role;

insert into public.schema_migrations (version) values ('0041_clients_sites') on conflict (version) do nothing;

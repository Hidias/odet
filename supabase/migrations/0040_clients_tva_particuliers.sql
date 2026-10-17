-- 0040_clients_tva_particuliers.sql : premier pas du lot 2 sur la fiche client (spec odet-lot2-spec.md v2, section 2).
--
-- 1. Case « non assujetti à la TVA » : le numéro de TVA du client n'est alors ni calculé ni imprimé.
-- 2. Type de client « particulier » : séparé des professionnels dans la liste des clients.
-- Le numéro de TVA est calculé dans l'application depuis le SIREN (src/core/org/tva.js).
-- Migration additive : aucune donnée existante n'est modifiée.

alter table public.clients
  add column if not exists vat_exempt boolean not null default false;

comment on column public.clients.vat_exempt is 'Client non assujetti à la TVA : pas de numéro de TVA sur les documents';

-- Contrainte du type de client : mêmes valeurs qu'avant, plus « particulier »
alter table public.clients drop constraint if exists clients_client_type_check;
alter table public.clients
  add constraint clients_client_type_check
  check (client_type = any (array['entreprise'::text, 'organisme_formation'::text, 'public'::text, 'opco'::text, 'particulier'::text]));

insert into public.schema_migrations (version) values ('0040_clients_tva_particuliers') on conflict (version) do nothing;

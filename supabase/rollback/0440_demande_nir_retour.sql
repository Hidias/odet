-- Retour arrière de 0440_demande_nir.sql. Idempotent. Les autorisations déjà signées (document_signatures) restent :
-- ce sont des preuves.
drop function if exists public.ent_nir_transmettre(uuid, text);
drop function if exists public.ent_nir_demandes();
drop function if exists public.client_portal_nir_transmettre(text, text, uuid, text);
drop function if exists public.client_portal_nir_demandes(text, text);
drop function if exists app.nir_transmettre(uuid, uuid, text, text, uuid[]);
drop function if exists app.nir_demandes_client(uuid, uuid[]);
drop function if exists public.nir_demande_pour_envoi(uuid);
drop function if exists public.portail_nir_demander(text, uuid, text, text, text, text);
drop function if exists public.portail_nir_demande_etat(text, uuid, text);
drop function if exists app.nir_renseigne(uuid);
delete from public.auto_send_switches where kind = 'demande_nir';
alter table public.auto_send_switches drop constraint if exists auto_send_switches_kind_check;
alter table public.auto_send_switches add constraint auto_send_switches_kind_check
  check (kind in ('relance_recyclage', 'relance_devis', 'relance_facture', 'convocation', 'attestation', 'evaluation_froid',
                  'renouvellement_contrat', 'visite_hors_contrat', 'justificatif_prestataire', 'relance_circuit'));
create or replace function app.envoi_auto_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['relance_recyclage', 'relance_devis', 'relance_facture', 'convocation', 'attestation', 'evaluation_froid',
               'renouvellement_contrat', 'visite_hors_contrat', 'justificatif_prestataire', 'relance_circuit']
$$;
do $do$
declare
  d text := pg_get_functiondef('app.signature_client_figee()'::regprocedure);
begin
  d := replace(d, $b$old.document_type in ('decharge_nir', 'autorisation_nir')$b$, $a$old.document_type = 'decharge_nir'$a$);
  execute d;
end
$do$;
delete from public.schema_migrations where version = '0440_demande_nir';

-- Retour arrière de 0490 : déclencheurs et fonction retirés, contraintes remises comme en 0404. Les documents déjà
-- retirés restent retirés. Échoue si un document ou un événement de groupe existe déjà (à retirer d'abord).
drop trigger if exists quotes_retrait_espace_client on public.quotes;
drop trigger if exists session_groups_retrait_espace_client on public.session_groups;
drop function if exists app.espace_client_retirer_supprime();
alter table public.client_shared_documents drop constraint if exists client_shared_documents_object_type_check;
alter table public.client_shared_documents add constraint client_shared_documents_object_type_check
  check (object_type = any (array['client', 'session', 'invoice', 'quote', 'itv_visit', 'itv_contract']));
alter table public.portal_events drop constraint if exists portal_events_object_type_check;
alter table public.portal_events add constraint portal_events_object_type_check
  check (object_type is null or object_type in ('client', 'session', 'invoice', 'quote', 'itv_visit', 'itv_contract'));

delete from public.schema_migrations where version = '0490_espace_client_retrait_supprimes';

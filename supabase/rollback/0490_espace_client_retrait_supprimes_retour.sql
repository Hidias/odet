-- Retour arrière de 0490 : déclencheurs et fonction retirés. Les contraintes sont remises comme en 0404 seulement s'il
-- n'existe encore aucun document ni événement de groupe inter : sinon elles gardent « session_group », pour que ces
-- lignes (qui ne s'effacent pas) puissent toujours être retirées. Les documents déjà retirés restent retirés.
drop trigger if exists quotes_retrait_espace_client on public.quotes;
drop trigger if exists session_groups_retrait_espace_client on public.session_groups;
drop function if exists app.espace_client_retirer_supprime();

do $$
begin
  if exists (select 1 from public.client_shared_documents where object_type = 'session_group')
     or exists (select 1 from public.portal_events where object_type = 'session_group') then
    raise notice 'Documents de groupe présents : contraintes de 0490 laissées en place';
  else
    alter table public.client_shared_documents drop constraint if exists client_shared_documents_object_type_check;
    alter table public.client_shared_documents add constraint client_shared_documents_object_type_check
      check (object_type = any (array['client', 'session', 'invoice', 'quote', 'itv_visit', 'itv_contract']));
    alter table public.portal_events drop constraint if exists portal_events_object_type_check;
    alter table public.portal_events add constraint portal_events_object_type_check
      check (object_type is null or object_type in ('client', 'session', 'invoice', 'quote', 'itv_visit', 'itv_contract'));
  end if;
end $$;

delete from public.schema_migrations where version = '0490_espace_client_retrait_supprimes';

-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (espace_client_0490) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0490_espace_client_retrait_supprimes.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0490_espace_client_retrait_supprimes_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0490_espace_client_retrait_supprimes.sql =====
-- 0490 : un devis ou un groupe inter supprimé n'est plus visible dans l'espace client (décision de H, 05/11).
-- Jusqu'ici, supprimer un devis publié (ou un groupe dont la convention était mise à signer) laissait son PDF
-- visible, et même signable, dans l'espace du client. Désormais la suppression retire le document : il est gardé,
-- avec la date, l'auteur et le motif du retrait (une ligne de client_shared_documents ne s'efface jamais, 0404).
-- Un document signé en ligne n'est jamais retiré : il reste la preuve que le client consulte. La signature en ligne
-- refuse déjà un document retiré (0420). Rien ne part par e-mail. Aucune donnée supprimée.
-- Convention ou contrat d'un groupe inter (0420) : les contraintes de 0404 n'acceptaient pas l'objet « session_group »,
-- si bien que sa mise à disposition échouait toujours (0 document de groupe en production, relevé le 05/11). Elles
-- l'acceptent désormais ; tant qu'il n'est pas signé, un nouveau document du groupe remplace le précédent
-- (api/documents-client.js), comme pour un contrat de maintenance.
-- Idempotente. Retour arrière : supabase/rollback/0490_espace_client_retrait_supprimes_retour.sql

alter table public.client_shared_documents drop constraint if exists client_shared_documents_object_type_check;
alter table public.client_shared_documents add constraint client_shared_documents_object_type_check
  check (object_type in ('client', 'session', 'invoice', 'quote', 'itv_visit', 'itv_contract', 'session_group'));
alter table public.portal_events drop constraint if exists portal_events_object_type_check;
alter table public.portal_events add constraint portal_events_object_type_check
  check (object_type is null or object_type in ('client', 'session', 'invoice', 'quote', 'itv_visit', 'itv_contract', 'session_group'));

create or replace function app.espace_client_retirer_supprime()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.client_shared_documents
     set withdrawn_at = now(),
         withdrawn_reason = case tg_argv[0] when 'quote' then 'Devis supprimé' else 'Groupe supprimé' end
   where object_type = tg_argv[0] and object_id = old.id and withdrawn_at is null
     and not exists (select 1 from public.document_signatures s
                      where s.status = 'valid' and s.metadata->>'document_id' = client_shared_documents.id::text);
  return old;
end
$$;
revoke all on function app.espace_client_retirer_supprime() from public, anon, authenticated;
comment on function app.espace_client_retirer_supprime() is 'Retire de l''espace client le document d''un devis ou d''un groupe inter supprimé (0490)';

drop trigger if exists quotes_retrait_espace_client on public.quotes;
create trigger quotes_retrait_espace_client after delete on public.quotes
  for each row execute function app.espace_client_retirer_supprime('quote');

drop trigger if exists session_groups_retrait_espace_client on public.session_groups;
create trigger session_groups_retrait_espace_client after delete on public.session_groups
  for each row execute function app.espace_client_retirer_supprime('session_group');

insert into public.schema_migrations (version) values ('0490_espace_client_retrait_supprimes') on conflict (version) do nothing;

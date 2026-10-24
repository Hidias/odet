-- Retour arrière de 0455_circuit_documents.sql. Idempotent. Refusé s'il existe un circuit (relectures, avis et décisions
-- seraient perdus) ou un réglage autre que « direct ».
do $do$
begin
  if to_regclass('public.doc_reviews') is not null and exists (select 1 from public.doc_reviews) then
    raise exception 'Des circuits de relecture existent : retour arrière refusé';
  end if;
  if to_regclass('public.doc_review_settings') is not null and exists (select 1 from public.doc_review_settings where default_mode <> 'direct' or per_doc <> '{}'::jsonb) then
    raise exception 'Un circuit de validation est réglé : remettez-le sur « direct » avant le retour arrière';
  end if;
end
$do$;
drop trigger if exists quality_doc_versions_circuit on public.quality_doc_versions;
drop function if exists app.doc_version_par_circuit();
drop function if exists public.relecteurs_possibles();
drop function if exists public.doc_review_regler(text, jsonb);
drop function if exists public.doc_review_decider(uuid, text, text, text);
drop table if exists public.doc_review_items;
drop table if exists public.doc_review_participants;
drop table if exists public.doc_reviews;
drop table if exists public.doc_review_settings;
drop function if exists app.doc_review_item_garde();
drop function if exists app.doc_review_participant_garde();
drop function if exists app.doc_review_notifier();
drop function if exists app.doc_review_garde();
drop function if exists app.peut_gerer_docs(uuid);
drop function if exists app.peut_valider_docs(uuid);
drop function if exists app.mes_relectures();
drop function if exists app.doc_review_mode(uuid, text);
delete from public.schema_migrations where version = '0455_circuit_documents';

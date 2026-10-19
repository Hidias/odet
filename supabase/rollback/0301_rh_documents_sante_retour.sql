-- Retour arrière de 0301_rh_documents_sante.sql : retire les documents, habilitations et suivi de santé du personnel,
-- leurs fonctions, la vue des échéances, les règles du bucket « rh » et le bucket s'il est vide. Idempotent.
-- Refusé si des documents, habilitations ou visites ont été saisis, ou si des fichiers ont été déposés (données du
-- personnel : à exporter d'abord).

do $$
begin
  if (to_regclass('public.hr_documents') is not null and exists (select 1 from public.hr_documents))
     or (to_regclass('public.hr_qualifications') is not null and exists (select 1 from public.hr_qualifications))
     or (to_regclass('public.hr_medical_followups') is not null and exists (select 1 from public.hr_medical_followups))
     or exists (select 1 from storage.objects where bucket_id = 'rh') then
    raise exception 'Retour arrière refusé : des documents ou des données de santé au travail ont été saisis (à exporter d''abord)';
  end if;
end $$;

drop policy if exists rh_lire on storage.objects;
drop policy if exists rh_creer on storage.objects;
drop policy if exists rh_supprimer on storage.objects;
do $$
begin
  if not exists (select 1 from storage.objects where bucket_id = 'rh') then
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.buckets where id = 'rh';
  end if;
end $$;

drop view if exists public.v_hr_echeances;
drop function if exists public.hr_document_ouvrir(uuid);
drop function if exists app.hr_fichier_supprimable(text);
drop table if exists public.hr_medical_followups;
drop table if exists public.hr_qualifications;
drop table if exists public.hr_documents;
drop function if exists app.hr_ds_garde();

delete from public.schema_migrations where version = '0301_rh_documents_sante';

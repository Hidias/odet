-- Retour arrière de 0140_registre_securite.sql : retire les documents du client, les fonctions du registre, le
-- bucket « registre » et le module. Idempotent. Refusé si des documents ont été déposés.
-- Les exercices saisis depuis l'espace entreprise (client_safety_checks) restent : ils appartiennent au lot 2.

do $$
begin
  if to_regclass('public.client_documents') is not null and exists (select 1 from public.client_documents) then
    raise exception 'Retour arrière refusé : des documents ont été déposés au registre';
  end if;
end $$;

drop function if exists public.registre_client(uuid, uuid);
drop function if exists public.ent_document_ajouter(uuid, text, text, text, text, date, date);
drop function if exists public.ent_exercice_ajouter(uuid, uuid, date, int, text);
drop function if exists public.ent_registre(uuid);
drop function if exists public.ent_modules();
drop function if exists app.registre_donnees(uuid, uuid, uuid[], uuid);

drop policy if exists registre_lire on storage.objects;
drop policy if exists registre_creer on storage.objects;
drop policy if exists registre_supprimer on storage.objects;
do $$
begin
  if not exists (select 1 from storage.objects where bucket_id = 'registre') then
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.buckets where id = 'registre';
  end if;
exception when others then
  raise notice 'Bucket « registre » laissé en place (%), à retirer depuis le tableau de bord', sqlerrm;
end $$;
drop function if exists app.ent_dossier_registre();

drop table if exists public.client_documents;
drop function if exists app.client_documents_maj();
delete from public.company_modules where key = 'registre';
delete from public.org_modules where key = 'registre';

delete from public.schema_migrations where version = '0140_registre_securite';

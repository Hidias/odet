-- Retour arrière de 0454_frais_formateur.sql. Idempotent. Refusé s'il existe des notes de frais ou des justificatifs
-- (ils seraient perdus).
do $do$
begin
  if to_regclass('public.trainer_expenses') is not null and exists (select 1 from public.trainer_expenses) then
    raise exception 'Des notes de frais existent : retour arrière refusé';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'frais') then
    raise exception 'Des justificatifs de frais existent : retour arrière refusé';
  end if;
end
$do$;
drop policy if exists frais_lire on storage.objects;
drop policy if exists frais_creer on storage.objects;
delete from storage.buckets where id = 'frais';
drop function if exists public.ext_frais_annuler(uuid);
drop function if exists public.ext_frais_ajouter(date, text, numeric, numeric, uuid, text, text);
drop function if exists public.ext_frais();
drop function if exists app.ext_formateur_societe();
drop function if exists app.ext_formateur_ou_null();
drop table if exists public.trainer_expenses;
drop function if exists app.frais_garde();
delete from public.schema_migrations where version = '0454_frais_formateur';

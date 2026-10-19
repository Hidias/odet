-- Retour arrière de 0047_comptes_externes.sql : retire les fonctions des comptes formateur externe et stagiaire, la
-- garde des liens du profil, la lecture de son propre profil et la colonne profiles.trainee_id. Idempotent.
-- Refusé si un compte est relié à une fiche stagiaire.

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'trainee_id') then
    if exists (select 1 from public.profiles where trainee_id is not null) then
      raise exception 'Retour arrière refusé : des comptes stagiaires sont reliés à leur fiche';
    end if;
  end if;
end $$;

drop function if exists public.acces_externe_etat(text, uuid);
drop function if exists public.stg_org();
drop function if exists public.stg_sessions();
drop function if exists app.stg_stagiaire();
drop function if exists public.ext_org();
drop function if exists public.ext_justificatifs();
drop function if exists public.ext_sessions();
drop function if exists app.ext_formateur();
drop function if exists app.org_documents(uuid);
drop trigger if exists profiles_liens_garde on public.profiles;
drop function if exists app.profiles_liens_garde();

drop policy if exists profiles_lire on public.profiles;
create policy profiles_lire on public.profiles for select to authenticated
  using ((select app.a_le_droit('organisation.comptes.voir')));

drop index if exists public.profiles_trainee_id_key;
alter table public.profiles drop column if exists trainee_id;

delete from public.schema_migrations where version = '0047_comptes_externes';

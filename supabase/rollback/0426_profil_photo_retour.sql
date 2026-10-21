-- Retour arrière de 0426_profil_photo.sql : photos retirées. Idempotent.
drop function if exists public.mon_profil_photo(text);
drop function if exists public.mon_profil_prenom(text);
alter table public.profiles drop constraint if exists profiles_photo_check;
alter table public.profiles drop column if exists photo;
delete from public.schema_migrations where version = '0426_profil_photo';

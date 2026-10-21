-- 0426 : photo ou logo du profil (espaces extérieurs, demande de H, 21/10, 21 h 31). Chaque personne connectée à un
-- espace (entreprise, formateur, stagiaire, équipe) peut mettre une photo ou un logo pour une expérience à son image ;
-- l'accueil dit « Bonjour » + son prénom, jamais le nom de l'entreprise. Image réduite par le navigateur (256 px), gardée
-- dans le profil (au plus 300 000 caractères). Seule la personne elle-même les change (public.mon_profil_photo, public.mon_profil_prenom).
-- Migration additive (colonne et fonction). Idempotente. Retour arrière : supabase/rollback/0426_profil_photo_retour.sql

alter table public.profiles add column if not exists photo text;
alter table public.profiles drop constraint if exists profiles_photo_check;
alter table public.profiles add constraint profiles_photo_check
  check (photo is null or (length(photo) <= 300000 and photo ~ '^data:image/(png|jpeg|webp);base64,'));
comment on column public.profiles.photo is 'Photo ou logo choisi par la personne (image réduite, en data URL) pour ses espaces';

create or replace function public.mon_profil_photo(p_photo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v text := nullif(btrim(coalesce(p_photo, '')), '');
begin
  if auth.uid() is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  if v is not null and (length(v) > 300000 or v !~ '^data:image/(png|jpeg|webp);base64,') then
    raise exception 'Image refusée : JPEG, PNG ou WebP de petite taille' using errcode = '22023';
  end if;
  update public.profiles set photo = v, updated_at = now() where id = auth.uid();
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.mon_profil_photo(text) from public, anon;
grant execute on function public.mon_profil_photo(text) to authenticated;

-- Prénom affiché à l'accueil (« Bonjour Sophie ») : la personne le renseigne elle-même (comptes entreprise créés sans prénom)
create or replace function public.mon_profil_prenom(p_prenom text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v text := nullif(btrim(coalesce(p_prenom, '')), '');
begin
  if auth.uid() is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  if v is not null and length(v) > 60 then raise exception 'Prénom trop long' using errcode = '22023'; end if;
  update public.profiles set first_name = v, updated_at = now() where id = auth.uid();
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.mon_profil_prenom(text) from public, anon;
grant execute on function public.mon_profil_prenom(text) to authenticated;

insert into public.schema_migrations (version) values ('0426_profil_photo') on conflict (version) do nothing;

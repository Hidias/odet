-- 0038_formateurs_source_unique.sql : un formateur qui a aussi un compte utilisateur n'est saisi qu'une fois.
--
-- Paramètres > Utilisateurs relie un compte à sa fiche formateur (profiles.trainer_id). Une fois reliés,
-- le prénom, le nom et le téléphone sont les mêmes des deux côtés : modifier l'un met à jour l'autre.
-- L'email du compte (adresse de connexion) est reporté sur la fiche formateur.
-- Au moment de relier : les valeurs du compte l'emportent, celles de la fiche complètent ce qui manque.

create or replace function public.profile_to_trainer()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.trainers;
begin
  if pg_trigger_depth() > 1 or new.trainer_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.trainer_id is not distinct from old.trainer_id
     and new.first_name is not distinct from old.first_name
     and new.last_name is not distinct from old.last_name
     and new.phone is not distinct from old.phone
     and new.email is not distinct from old.email then
    return new;
  end if;
  select * into t from public.trainers where id = new.trainer_id;
  if t.id is null then return new; end if;
  -- Compte sans prénom, nom ou téléphone : repris de la fiche formateur
  if nullif(trim(new.first_name), '') is null or nullif(trim(new.last_name), '') is null or nullif(trim(new.phone), '') is null then
    update public.profiles
       set first_name = coalesce(nullif(trim(new.first_name), ''), t.first_name),
           last_name = coalesce(nullif(trim(new.last_name), ''), t.last_name),
           phone = coalesce(nullif(trim(new.phone), ''), t.phone)
     where id = new.id;
  end if;
  update public.trainers
     set first_name = coalesce(nullif(trim(new.first_name), ''), first_name),
         last_name = coalesce(nullif(trim(new.last_name), ''), last_name),
         phone = coalesce(nullif(trim(new.phone), ''), phone),
         email = coalesce(nullif(trim(new.email), ''), email),
         updated_at = now()
   where id = new.trainer_id;
  return new;
end $$;

create or replace function public.trainer_to_profile()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.first_name is not distinct from old.first_name
     and new.last_name is not distinct from old.last_name
     and new.phone is not distinct from old.phone then
    return new;
  end if;
  update public.profiles
     set first_name = new.first_name, last_name = new.last_name, phone = new.phone, updated_at = now()
   where trainer_id = new.id;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'profile_to_trainer_trg') then
    create trigger profile_to_trainer_trg after insert or update on public.profiles
      for each row execute function public.profile_to_trainer();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trainer_to_profile_trg') then
    create trigger trainer_to_profile_trg after update on public.trainers
      for each row execute function public.trainer_to_profile();
  end if;
end $$;

-- Un compte ne peut être relié qu'à une fiche, une fiche qu'à un compte
create unique index if not exists profiles_trainer_id_unique on public.profiles (trainer_id) where trainer_id is not null;

insert into public.schema_migrations (version) values ('0038_formateurs_source_unique') on conflict (version) do nothing;

-- 0459 : genre des personnes (S19, 27/10/2026)
--
-- Les accords (formateur / formatrice, soussigné / soussignée, inscrit / inscrite...) sont faits par
-- src/core/genre.js. Ici, seulement les deux fiches qui n'avaient pas de genre :
--   - formateur (trainers.gender), même convention que les stagiaires ('male' | 'female') ;
--   - signataire de l'organisme (organization_settings.dirigeant_gender).
-- Une seule source : quand la fiche du personnel est reliée au formateur (hr_people.trainer_id),
-- le genre saisi d'un côté est repris de l'autre (déclencheurs ci-dessous, sans boucle).
-- Additive : aucune donnée existante modifiée, sauf la reprise du genre déjà saisi dans le personnel.
-- Retour arrière en fin de fichier.

alter table public.trainers add column if not exists gender text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trainers_gender_chk') then
    alter table public.trainers add constraint trainers_gender_chk check (gender is null or gender in ('male', 'female'));
  end if;
end $$;
comment on column public.trainers.gender is 'Genre du formateur (accords des documents) : male ou female ; repris de la fiche du personnel reliée (0459)';

alter table public.organization_settings add column if not exists dirigeant_gender text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organization_settings_dirigeant_gender_chk') then
    alter table public.organization_settings add constraint organization_settings_dirigeant_gender_chk check (dirigeant_gender is null or dirigeant_gender in ('male', 'female'));
  end if;
end $$;
comment on column public.organization_settings.dirigeant_gender is 'Genre du signataire de l''organisme (« Je soussignée », « Dirigeante ») : male ou female (0459)';

-- Personnel → formateur relié ('M' / 'F' vers 'male' / 'female')
create or replace function app.genre_personnel_vers_formateur()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if pg_trigger_depth() > 1 or new.trainer_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.gender is not distinct from old.gender and new.trainer_id is not distinct from old.trainer_id then return new; end if;
  v := case upper(coalesce(new.gender, '')) when 'F' then 'female' when 'M' then 'male' else null end;
  if v is null then return new; end if;
  update public.trainers t set gender = v where t.id = new.trainer_id and t.gender is distinct from v;
  return new;
end $$;

drop trigger if exists hr_people_genre_formateur on public.hr_people;
create trigger hr_people_genre_formateur after insert or update of gender, trainer_id on public.hr_people
  for each row execute function app.genre_personnel_vers_formateur();

-- Formateur → fiche du personnel reliée
create or replace function app.genre_formateur_vers_personnel()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.gender is not distinct from old.gender then return new; end if;
  v := case new.gender when 'female' then 'F' when 'male' then 'M' else null end;
  if v is null then return new; end if;
  update public.hr_people p set gender = v where p.trainer_id = new.id and p.gender is distinct from v;
  return new;
end $$;

drop trigger if exists trainers_genre_personnel on public.trainers;
create trigger trainers_genre_personnel after update of gender on public.trainers
  for each row execute function app.genre_formateur_vers_personnel();

-- Reprise : genre déjà saisi dans le personnel pour les formateurs reliés
update public.trainers t set gender = case upper(p.gender) when 'F' then 'female' when 'M' then 'male' end
  from public.hr_people p
 where p.trainer_id = t.id and t.gender is null and upper(coalesce(p.gender, '')) in ('F', 'M');

-- Retour arrière :
-- drop trigger if exists trainers_genre_personnel on public.trainers;
-- drop trigger if exists hr_people_genre_formateur on public.hr_people;
-- drop function if exists app.genre_formateur_vers_personnel();
-- drop function if exists app.genre_personnel_vers_formateur();
-- alter table public.organization_settings drop column if exists dirigeant_gender;
-- alter table public.trainers drop column if exists gender;

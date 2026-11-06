-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (formateurs_0495) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0495_formateurs_session_cles.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0495_formateurs_session_cles_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0495_formateurs_session_cles.sql =====
-- 0495 : formateurs d'une session (suite de C6, #304).
-- 1. app.session_appliquer (0437), appelée à la confirmation d'une session préparée et pour une session supplémentaire
--    d'un devis, retirait de session_trainers tous les formateurs sauf celui qu'elle pose : les autres formateurs cochés
--    depuis C6 disparaissaient à la confirmation. Elle ne retire plus que l'ancien formateur principal, s'il change.
-- 2. session_trainers n'avait aucune clé étrangère vers sessions ni trainers (relevé en production le 05/11) : ses lignes
--    partent désormais avec la session ou le formateur (cascade), dans la même transaction. 0 ligne orpheline en
--    production le 06/11 (1 ligne au total). L'index sur trainer_id existe déjà (0081), session_id est en tête de la
--    clé primaire.

create or replace function app.session_appliquer(p_session uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debut date := nullif(p_data ->> 'start_date', '')::date;
  v_fin date := coalesce(nullif(p_data ->> 'end_date', '')::date, nullif(p_data ->> 'start_date', '')::date);
  v_h1 time := nullif(p_data ->> 'start_time', '')::time;
  v_h2 time := nullif(p_data ->> 'end_time', '')::time;
  v_max int := nullif(p_data ->> 'max_participants', '')::int;
  v_sup int := coalesce(nullif(p_data ->> 'places_supplementaires', '')::int, 0);
  v_formateur uuid := nullif(p_data ->> 'trainer_id', '')::uuid;
  v_ancien uuid;
begin
  if v_debut is null or v_h1 is null or v_h2 is null then raise exception 'Date, heure de début et heure de fin requises' using errcode = '22023'; end if;
  if v_fin < v_debut then raise exception 'La fin est avant le début' using errcode = '22023'; end if;
  if v_h2 <= v_h1 then raise exception 'L''heure de fin doit suivre l''heure de début' using errcode = '22023'; end if;
  if v_formateur is null then raise exception 'Formateur requis' using errcode = '22023'; end if;
  if v_max is null or v_max < 1 or v_max > 200 then raise exception 'Nombre de places invalide' using errcode = '22023'; end if;
  if v_sup < 0 or v_sup > 20 then raise exception 'Dépassement autorisé entre 0 et 20' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_data ->> 'location_name', '') || coalesce(p_data ->> 'location_address', '') || coalesce(p_data ->> 'location_city', ''))) < 2 then
    raise exception 'Lieu requis' using errcode = '22023';
  end if;
  select trainer_id into v_ancien from public.sessions where id = p_session;
  update public.sessions set
    start_date = v_debut, end_date = v_fin, start_time = v_h1, end_time = v_h2,
    day_type = case when v_h2 - v_h1 <= interval '4 hours 30 minutes' then 'half' else 'full' end,
    location_name = nullif(btrim(coalesce(p_data ->> 'location_name', '')), ''),
    location_address = nullif(btrim(coalesce(p_data ->> 'location_address', '')), ''),
    location_postal_code = nullif(btrim(coalesce(p_data ->> 'location_postal_code', '')), ''),
    location_city = nullif(btrim(coalesce(p_data ->> 'location_city', '')), ''),
    trainer_id = v_formateur, max_participants = v_max, places_supplementaires = v_sup,
    contact_id = coalesce(nullif(p_data ->> 'contact_id', '')::uuid, contact_id),
    total_price = coalesce(nullif(p_data ->> 'total_price', '')::numeric, total_price),
    validation_requise = false, status_locked = true, updated_at = now()
  where id = p_session;
  if v_ancien is not null and v_ancien <> v_formateur then
    delete from public.session_trainers where session_id = p_session and trainer_id = v_ancien;
  end if;
  insert into public.session_trainers (session_id, trainer_id) values (p_session, v_formateur) on conflict do nothing;
end
$$;
revoke all on function app.session_appliquer(uuid, jsonb) from public, anon, authenticated;

alter table public.session_trainers
  add constraint session_trainers_session_fk foreign key (session_id) references public.sessions (id) on delete cascade;
alter table public.session_trainers
  add constraint session_trainers_trainer_fk foreign key (trainer_id) references public.trainers (id) on delete cascade;

insert into public.schema_migrations (version) values ('0495_formateurs_session_cles') on conflict (version) do nothing;

-- Retour arrière de 0495 : clés étrangères de session_trainers retirées, app.session_appliquer reprend sa définition
-- de 0437 (relevée en production le 06/11, empreinte 490dddc7aa3a23eb2a86b6662af3921f). Aucune donnée n'est touchée.

alter table public.session_trainers drop constraint if exists session_trainers_trainer_fk;
alter table public.session_trainers drop constraint if exists session_trainers_session_fk;

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
  delete from public.session_trainers where session_id = p_session and trainer_id <> v_formateur;
  insert into public.session_trainers (session_id, trainer_id) values (p_session, v_formateur) on conflict do nothing;
end
$$;
revoke all on function app.session_appliquer(uuid, jsonb) from public, anon, authenticated;

delete from public.schema_migrations where version = '0495_formateurs_session_cles';

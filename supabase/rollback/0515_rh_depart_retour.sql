-- Retour arrière de 0515 : fonctions du départ retirées, colonnes du départ retirées de hr_people, source « depart » des
-- actions de l'équipe retirée (les actions déjà créées restent, passées en source « manuel ») et app.team_actions_maj
-- remise au corps de production avant 0515 (0513). Les contrats clos, véhicules rendus, absences annulées, fiches
-- archivées et comptes coupés restent tels quels (le travail fait n'est pas défait).

drop function if exists public.rh_departs_appliquer();
drop function if exists public.rh_annuler_depart(uuid);
drop function if exists public.rh_enregistrer_depart(uuid, date, text, jsonb);
drop function if exists public.rh_depart_bilan(uuid, date);
drop function if exists app.depart_droit(uuid);
drop function if exists app.depart_bilan(uuid, date);

CREATE OR REPLACE FUNCTION app.team_actions_maj()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.postponed_count := 0;
    if auth.uid() is not null then
      if new.source = 'habilitation' then
        raise exception 'Action réservée à la préparation de la nuit' using errcode = '42501';
      end if;
      new.dedup_key := null;
    end if;
  else
    new.company_id := old.company_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.source := old.source;
    new.source_id := old.source_id;
    new.dedup_key := old.dedup_key;
    -- Report : l'échéance d'une action à faire recule
    new.postponed_count := old.postponed_count;
    if old.status = 'a_faire' and new.status = 'a_faire' and old.due_on is not null and new.due_on > old.due_on then
      new.postponed_count := old.postponed_count + 1;
    end if;
  end if;
  if new.status = 'fait' and (tg_op = 'INSERT' or old.status <> 'fait') then
    new.done_at := now();
    new.done_by := auth.uid();
  elsif new.status <> 'fait' then
    new.done_at := null;
    new.done_by := null;
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  new.updated_at := now();
  return new;
end
$function$;
revoke all on function app.team_actions_maj() from public, anon, authenticated;

alter table public.team_actions disable trigger team_actions_maj;
update public.team_actions set source = 'manuel', dedup_key = null where source = 'depart';
alter table public.team_actions enable trigger team_actions_maj;
alter table public.team_actions drop constraint if exists team_actions_source_check;
alter table public.team_actions add constraint team_actions_source_check
  check (source in ('manuel', 'point', 'bilan', 'reunion', 'habilitation'));

drop trigger if exists hr_people_depart_garde on public.hr_people;
drop function if exists app.hr_people_depart_garde();
drop index if exists public.hr_people_depart_idx;
alter table public.hr_people drop column if exists departure_profile_id;
alter table public.hr_people drop column if exists departure_applied_at;
alter table public.hr_people drop column if exists departure_recorded_at;
alter table public.hr_people drop column if exists departure_by;
alter table public.hr_people drop column if exists departure_auto;
alter table public.hr_people drop column if exists departure_reason;
alter table public.hr_people drop column if exists departure_on;

delete from public.schema_migrations where version = '0515_rh_depart';

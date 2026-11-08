-- Retour arrière de 0513 : postes, titres exigés, paramètres RH et préparation de nuit retirés ; app.team_actions_maj
-- remise au corps de 0407. Les actions déjà préparées restent, en source « manuel » (le travail fait n'est pas perdu).

drop function if exists public.habilitations_actions_generer();
drop function if exists app.habilitations_ecarts(uuid, date);
drop function if exists app.habilitation_couvre(public.hr_qualifications, text, text[]);

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
  else
    new.company_id := old.company_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.source := old.source;
    new.source_id := old.source_id;
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
update public.team_actions set source = 'manuel' where source = 'habilitation';
alter table public.team_actions enable trigger team_actions_maj;
drop index if exists public.team_actions_dedup_uniq;
alter table public.team_actions drop column if exists dedup_key;
alter table public.team_actions drop constraint if exists team_actions_source_check;
alter table public.team_actions add constraint team_actions_source_check
  check (source in ('manuel', 'point', 'bilan', 'reunion'));

drop trigger if exists hr_employments_poste on public.hr_employments;
drop function if exists app.hr_employments_poste();
drop index if exists public.hr_employments_job_idx;
alter table public.hr_employments drop column if exists job_id;
drop table if exists public.hr_settings;
drop table if exists public.hr_job_requirements;
drop function if exists app.hr_job_requirements_societe();
drop table if exists public.hr_jobs;

delete from public.schema_migrations where version = '0513_rh_postes_habilitations';

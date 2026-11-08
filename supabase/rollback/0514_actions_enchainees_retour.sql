-- Retour arrière de 0514 : types d'action, type et suite des actions retirés ; app.societe_referentiels_depart remise au
-- corps en production avant 0514. Les actions restent (le travail fait n'est pas perdu), sans type ni lien de suite.

CREATE OR REPLACE FUNCTION app.societe_referentiels_depart()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.subcontractor_doc_types_depart(new.id);
  if to_regprocedure('app.obligation_rules_depart(uuid)') is not null then
    execute 'select app.obligation_rules_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.commercial_lists_depart(uuid)') is not null then
    execute 'select app.commercial_lists_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_sous_traitants_depart(uuid)') is not null then
    execute 'select app.rgpd_sous_traitants_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_purge_regles_depart(uuid)') is not null then
    execute 'select app.rgpd_purge_regles_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.cert_pitfalls_depart(uuid)') is not null then
    execute 'select app.cert_pitfalls_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_horaires_depart(uuid)') is not null then
    execute 'select app.hr_horaires_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_types_absence_depart(uuid)') is not null then
    execute 'select app.hr_types_absence_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_feries_depart(uuid)') is not null then
    execute 'select app.hr_feries_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.hr_listes_depart(uuid)') is not null then
    execute 'select app.hr_listes_depart($1)' using new.id;
  end if;
  return null;
end
$function$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

drop function if exists app.team_action_types_depart(uuid);
drop trigger if exists team_actions_suite on public.team_actions;
drop function if exists app.team_actions_suite();
drop index if exists public.team_actions_suite_uniq;
drop index if exists public.team_actions_type_idx;
alter table public.team_actions drop column if exists previous_id;
alter table public.team_actions drop column if exists type_id;
drop trigger if exists team_action_types_regle on public.team_action_types;
drop function if exists app.team_action_types_regle();
drop table if exists public.team_action_types;

delete from public.schema_migrations where version = '0514_actions_enchainees';

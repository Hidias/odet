-- Retour arrière de 0290_rh_socle.sql : retire les tables du socle RH, l'annuaire et leurs fonctions. Idempotent.
-- Refusé si des fiches du personnel ont été saisies (données de personnes : à exporter puis supprimer d'abord).

do $$
begin
  if to_regclass('public.hr_people') is not null and exists (select 1 from public.hr_people) then
    raise exception 'Retour arrière refusé : des fiches du personnel existent (à exporter puis supprimer d''abord)';
  end if;
end $$;

-- Départ d'une nouvelle société : version de 0350
create or replace function app.societe_referentiels_depart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;
drop function if exists app.hr_horaires_depart(uuid);

drop function if exists public.hr_remuneration(uuid);
drop view if exists public.v_hr_annuaire;
drop table if exists public.hr_compensation;
drop table if exists public.hr_employments;
drop table if exists public.hr_teams;
drop table if exists public.hr_people;
drop table if exists public.hr_schedules;
drop function if exists app.hr_mes_personnes();
drop function if exists app.hr_meme_societe();
drop function if exists app.hr_maj();

delete from public.schema_migrations where version = '0290_rh_socle';

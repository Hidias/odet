-- Retour arrière de 0380_commercial_affaires.sql : retire les affaires, les listes, les objectifs, les vues, le suivi
-- des devis, la fiche client enrichie et le module « affaires ». Idempotent. Refusé si des affaires ou des objectifs
-- ont été saisis, ou si une fiche client porte un segment, une source, un responsable ou une opposition autre que
-- l'email (l'opposition par email reste dans « ne pas solliciter »).

do $$
begin
  if to_regclass('public.opportunities') is not null and exists (select 1 from public.opportunities) then
    raise exception 'Retour arrière refusé : des affaires ont été saisies';
  end if;
  if to_regclass('public.activity_targets') is not null and exists (select 1 from public.activity_targets) then
    raise exception 'Retour arrière refusé : des objectifs de cadence ont été saisis';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'segment') then
    if exists (select 1 from public.clients
               where segment is not null or source is not null or source_detail is not null or owner_id is not null
                  or first_contact_on is not null or informed_at is not null
                  or opposition_canaux && array['appel', 'courrier']) then
      raise exception 'Retour arrière refusé : des fiches clients portent des informations commerciales saisies';
    end if;
  end if;
end $$;

drop view if exists public.v_clients_a_appeler;
drop view if exists public.v_client_metiers;
drop view if exists public.v_cadence_semaine;
drop view if exists public.v_activity_log;
drop view if exists public.v_pipeline;

drop trigger if exists quotes_affaire_suivre on public.quotes;
drop function if exists app.quotes_affaire_suivre();
drop table if exists public.opportunities;
drop function if exists app.opportunities_maj();
drop table if exists public.activity_targets;
drop function if exists app.activity_targets_maj();

drop trigger if exists clients_opposition_maj on public.clients;
drop function if exists app.clients_opposition_maj();
alter table public.clients drop column if exists informed_at;
alter table public.clients drop column if exists opposition_motif;
alter table public.clients drop column if exists opposition_at;
alter table public.clients drop column if exists opposition_canaux;
alter table public.clients drop column if exists first_contact_on;
alter table public.clients drop column if exists owner_id;
alter table public.clients drop column if exists source_detail;
alter table public.clients drop column if exists source;
alter table public.clients drop column if exists segment;
drop index if exists public.client_interactions_auteur_idx;
alter table public.client_interactions drop column if exists created_by;

-- Départ d'une nouvelle société : version de 0045
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
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

drop function if exists app.commercial_lists_depart(uuid);
drop table if exists public.commercial_lists;
drop function if exists app.commercial_lists_maj();

delete from public.company_modules where key = 'affaires';
delete from public.org_modules where key = 'affaires';

delete from public.schema_migrations where version = '0380_commercial_affaires';

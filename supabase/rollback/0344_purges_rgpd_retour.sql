-- Retour arrière de 0344_purges_rgpd.sql : retire les règles et passages de purge et leurs fonctions. Idempotent.
-- Refusé si un passage a été exécuté (les lignes purgées ne reviennent pas : le registre des passages est la preuve).

do $$
begin
  if to_regclass('public.rgpd_purge_passages') is not null and exists (select 1 from public.rgpd_purge_passages where statut = 'execute') then
    raise exception 'Retour arrière refusé : des purges ont été exécutées (le registre des passages doit être gardé)';
  end if;
end $$;

drop function if exists public.rgpd_purge_decider(uuid, text, text);
drop function if exists public.rgpd_purges_generer();
drop function if exists app.rgpd_purge_candidats(public.rgpd_purge_regles);
drop table if exists public.rgpd_purge_passages;
drop table if exists public.rgpd_purge_regles;
drop function if exists app.rgpd_purge_regles_maj();

-- Départ d'une nouvelle société : version de 0340
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
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;
drop function if exists app.rgpd_purge_regles_depart(uuid);

delete from public.schema_migrations where version = '0344_purges_rgpd';

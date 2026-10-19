-- Retour arrière de 0340_conformite_rgpd.sql : retire le module « Conformité RGPD », ses tables, ses fonctions, les
-- traitements modèles et les colonnes ajoutées au registre ; les lignes reprises reviennent à l'identique.
-- Idempotent. Refusé si une demande, une violation, une preuve d'information ou une analyse d'impact a été saisie,
-- si un traitement a été validé, ou si un traitement a été saisi à la main dans le nouveau registre.

do $$
begin
  if to_regclass('public.rgpd_demandes') is not null and (
       exists (select 1 from public.rgpd_demandes) or exists (select 1 from public.rgpd_violations)
       or exists (select 1 from public.rgpd_informations) or exists (select 1 from public.rgpd_aipd)) then
    raise exception 'Retour arrière refusé : des demandes, violations, preuves d''information ou analyses d''impact ont été saisies';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rgpd_traitements' and column_name = 'statut') then
    if exists (select 1 from public.rgpd_traitements where statut = 'valide' or (origine = 'saisie' and modele_cle is null)) then
      raise exception 'Retour arrière refusé : des traitements ont été validés ou saisis dans le nouveau registre';
    end if;
  end if;
  if exists (select 1 from public.rgpd_traitements where length(coalesce(duree_conservation, '')) > 100 and modele_cle is null)
     or exists (select 1 from public.rgpd_traitements where length(coalesce(base_legale, '')) > 100 and modele_cle is null) then
    raise exception 'Retour arrière refusé : des textes trop longs pour l''ancien registre ont été saisis';
  end if;
end $$;

delete from public.company_modules where key = 'rgpd';
delete from public.org_modules where key = 'rgpd';

drop function if exists public.rgpd_proposer_modeles();
drop table if exists public.rgpd_aipd;
drop table if exists public.rgpd_informations;
drop table if exists public.rgpd_violations;
drop table if exists public.rgpd_demandes;
drop table if exists public.rgpd_sous_traitants;
drop function if exists app.rgpd_aipd_validation();
drop function if exists app.rgpd_violations_echeance();
drop function if exists app.rgpd_demandes_echeance();
drop function if exists app.rgpd_maj();

-- Départ d'une nouvelle société : version de 0380 si elle est appliquée, sinon celle de 0045
do $$
begin
  if to_regprocedure('app.commercial_lists_depart(uuid)') is not null then
    execute $f$
create or replace function app.societe_referentiels_depart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $b$
begin
  perform app.subcontractor_doc_types_depart(new.id);
  if to_regprocedure('app.obligation_rules_depart(uuid)') is not null then
    execute 'select app.obligation_rules_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.commercial_lists_depart(uuid)') is not null then
    execute 'select app.commercial_lists_depart($1)' using new.id;
  end if;
  return null;
end
$b$;
$f$;
  else
    execute $f$
create or replace function app.societe_referentiels_depart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $b$
begin
  perform app.subcontractor_doc_types_depart(new.id);
  if to_regprocedure('app.obligation_rules_depart(uuid)') is not null then
    execute 'select app.obligation_rules_depart($1)' using new.id;
  end if;
  return null;
end
$b$;
$f$;
  end if;
end $$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;
drop function if exists app.rgpd_traitements_depart(uuid);
drop function if exists app.rgpd_sous_traitants_depart(uuid);

-- Registre : traitements modèles retirés, colonnes ajoutées retirées, types d'origine
drop trigger if exists rgpd_traitements_maj on public.rgpd_traitements;
drop function if exists app.rgpd_traitements_maj();
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rgpd_traitements' and column_name = 'origine') then
    execute 'delete from public.rgpd_traitements where origine = ''modele''';
  end if;
end $$;
drop index if exists public.rgpd_traitements_modele;
alter table public.rgpd_traitements drop constraint if exists rgpd_traitements_statut_check;
alter table public.rgpd_traitements drop constraint if exists rgpd_traitements_origine_check;
alter table public.rgpd_traitements drop constraint if exists rgpd_traitements_aipd_check;
alter table public.rgpd_traitements drop column if exists notes;
alter table public.rgpd_traitements drop column if exists revue_le;
alter table public.rgpd_traitements drop column if exists valide_le;
alter table public.rgpd_traitements drop column if exists valide_par;
alter table public.rgpd_traitements drop column if exists aipd;
alter table public.rgpd_traitements drop column if exists contact_interne_id;
alter table public.rgpd_traitements drop column if exists garanties_transfert;
alter table public.rgpd_traitements drop column if exists sous_traitants;
alter table public.rgpd_traitements drop column if exists donnees_sensibles;
alter table public.rgpd_traitements drop column if exists base_legale_article;
alter table public.rgpd_traitements drop column if exists statut;
alter table public.rgpd_traitements drop column if exists origine;
alter table public.rgpd_traitements drop column if exists module;
alter table public.rgpd_traitements drop column if exists modele_version;
alter table public.rgpd_traitements drop column if exists modele_cle;
alter table public.rgpd_traitements alter column base_legale type character varying(100);
alter table public.rgpd_traitements alter column duree_conservation type character varying(100);

delete from public.schema_migrations where version = '0340_conformite_rgpd';

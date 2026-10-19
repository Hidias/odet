-- Retour arrière de 0046_espace_entreprise.sql : retire comptes entreprise, demandes, actualités et fonctions ent_*.
-- Idempotent. Refusé si des comptes, demandes ou actualités ont été créés (les profils au rôle « entreprise » et leurs
-- connexions restent alors à traiter à la main).

do $$
begin
  if to_regclass('public.client_accounts') is not null then
    if exists (select 1 from public.client_accounts) or exists (select 1 from public.client_requests) or exists (select 1 from public.client_news) then
      raise exception 'Retour arrière refusé : des comptes entreprise, demandes ou actualités ont été créés';
    end if;
  end if;
end $$;

drop function if exists public.client_accounts_etat(uuid);
drop function if exists public.ent_demander(text, text, uuid, uuid, jsonb);
drop function if exists public.ent_demandes();
drop function if exists public.ent_actus();
drop function if exists public.ent_catalogue();
drop function if exists public.ent_factures();
drop function if exists public.ent_echeances();
drop function if exists public.ent_salaries();
drop function if exists public.ent_sessions();
drop function if exists public.ent_accueil();
drop function if exists public.ent_org();
drop function if exists app.ent_sites(public.client_accounts);
drop function if exists app.ent_compte();
drop table if exists public.client_news;
drop table if exists public.client_requests;
drop table if exists public.client_account_sites;
drop table if exists public.client_accounts;
drop function if exists app.espace_entreprise_maj();

delete from public.schema_migrations where version = '0046_espace_entreprise';

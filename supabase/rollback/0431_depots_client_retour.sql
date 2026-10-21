-- Retour arrière de 0431_depots_client.sql : fonctions retirées ; la table n'est retirée que si aucun dépôt réel n'y
-- figure (les dépôts sont des preuves). Idempotent.
drop function if exists public.depot_client_decider(uuid, text, text);
drop function if exists public.client_portal_depots(text, text);
drop function if exists public.ent_depots();
drop function if exists app.depots_du_client(uuid);
do $r$
begin
  if to_regclass('public.client_deposits') is not null and not exists (select 1 from public.client_deposits) then
    drop table public.client_deposits;
    drop function if exists app.client_deposits_fige();
  end if;
end
$r$;
delete from public.schema_migrations where version = '0431_depots_client';

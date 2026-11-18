-- Essai de 0524 : 0523 est appliquée (garde et reprise) et inscrite au registre. Rouge sans 0524.
begin;
do $$
begin
  if not exists (select 1 from public.schema_migrations where version = '0523_comptes_externes_role') then
    raise exception '1. 0523 absente du registre'; end if;
  if position('compte extérieur' in pg_get_functiondef('public.protect_profile_role'::regproc)) = 0 then
    raise exception '2. garde de 0523 absente'; end if;
  if exists (select 1 from public.client_accounts a join public.profiles p on p.id = a.profile_id where p.role <> 'entreprise') then
    raise exception '3. compte de l''espace client avec un rôle de l''équipe'; end if;
end $$;
rollback;

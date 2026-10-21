-- 0403 : le journal de l'espace client (0401) laisse passer la purge des données de test.
-- Effacer un accès par lien met à vide le lien du journal (access_id, « on delete set null ») : c'était refusé comme
-- une modification, ce qui bloquait la purge et le rapport « réel / test ». Seule cette mise à vide est permise ;
-- toute autre modification d'une ligne reste refusée. Idempotent.

create or replace function app.portal_events_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.access_id is not null and new.access_id is null
     and (to_jsonb(new) - 'access_id') = (to_jsonb(old) - 'access_id') then
    return new;
  end if;
  raise exception 'Journal de l''espace client : une ligne ne se modifie pas' using errcode = '42501';
end
$$;
revoke all on function app.portal_events_fige() from public, anon, authenticated;

insert into public.schema_migrations (version) values ('0403_journal_purge') on conflict (version) do nothing;

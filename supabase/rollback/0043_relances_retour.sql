-- Retour arrière de 0043_relances.sql : retire le moteur des relances. Idempotent.
-- Refusé si une action a été validée, envoyée ou ignorée par une personne (trace d'un échange avec un client).

do $$
begin
  if to_regclass('public.scheduled_actions') is not null
     and exists (select 1 from public.scheduled_actions where status <> 'a_valider') then
    raise exception 'Retour arrière refusé : des relances ont déjà été traitées (validées, envoyées ou ignorées)';
  end if;
end $$;

drop function if exists public.scheduled_actions_generate();
drop table if exists public.scheduled_actions;
drop function if exists app.scheduled_actions_maj();

delete from public.schema_migrations where version = '0043_relances';

-- 0035_qualiopi_source_unique.sql : la certification Qualiopi se saisit à un seul endroit.
--
-- Module Certification actif : date du certificat et certificateur se renseignent dans Certification
-- (cert_settings). La base reporte d'elle-même la mention « certifié Qualiopi », la date et le
-- certificateur dans organization_settings, que lisent les documents, le portail et l'écran de
-- connexion. Paramètres affiche ces valeurs sans permettre de les modifier.
-- Module inactif : elles se saisissent dans Paramètres, comme avant.

create or replace function public.cert_settings_sync_org()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT'
     or new.certified_at is distinct from old.certified_at
     or new.certifier_name is distinct from old.certifier_name then
    update public.organization_settings
       set qualiopi_certified = (new.certified_at is not null),
           qualiopi_since = new.certified_at,
           qualiopi_organisme = case when new.certified_at is not null then nullif(trim(new.certifier_name), '') end,
           updated_at = now()
     where id is not null;
  end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'cert_settings_sync_org_trg') then
    create trigger cert_settings_sync_org_trg after insert or update on public.cert_settings
      for each row execute function public.cert_settings_sync_org();
  end if;
end $$;

insert into public.schema_migrations (version) values ('0035_qualiopi_source_unique') on conflict (version) do nothing;

-- 0015_email_configs_imap.sql : serveur IMAP par compte d'envoi (copie dans Envoyés, synchronisation)
alter table public.user_email_configs add column if not exists imap_host text;
insert into public.schema_migrations (version) values ('0015_email_configs_imap') on conflict (version) do nothing;

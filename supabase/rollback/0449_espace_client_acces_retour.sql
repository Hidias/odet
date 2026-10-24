-- Retour arrière de 0449_espace_client_acces.sql. Idempotent. Les codes changés par les clients restent (ce sont
-- leurs codes actuels).
drop function if exists public.client_portal_acces_infos(text, text);
drop function if exists public.client_portal_changer_code(text, text, text);
drop function if exists app.code_acces_valable(text);
drop function if exists public.ent_appareil(text);
drop function if exists public.client_portal_appareil(text, text, text);
drop function if exists app.portail_appareil_noter(uuid, uuid, uuid, text);
drop function if exists app.appareil_libelle(text);
drop table if exists public.portal_devices;
alter table public.client_portal_access drop column if exists code_apart;
alter table public.client_portal_access drop column if exists code_changed_at;
alter table public.client_portal_access drop column if exists code_sent_at;
alter table public.client_portal_access drop column if exists link_sent_at;
delete from public.schema_migrations where version = '0449_espace_client_acces';

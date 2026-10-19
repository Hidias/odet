-- Retour arrière de 0366_facturation_transmission.sql : réglage de transmission retiré. Idempotent.

drop function if exists public.billing_transmission_mode();
alter table public.billing_settings drop constraint if exists billing_settings_comptable_transmission_check;
alter table public.billing_settings drop column if exists comptable_transmission, drop column if exists plateforme_agreee;

delete from public.schema_migrations where version = '0366_facturation_transmission';

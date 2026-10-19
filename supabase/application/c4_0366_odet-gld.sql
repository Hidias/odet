-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c4_0366) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0366_facturation_transmission.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0366_facturation_transmission_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0366_facturation_transmission.sql =====
-- 0366_facturation_transmission.sql : transmission des factures au comptable, réglée par société (Facturation fiable).
--
-- Rien n'est supposé : tant que la société n'a pas choisi son mode de transmission, l'envoi au comptable est désactivé
-- avec un message. Le destinataire reste celui des Paramètres (comptable_* de l'organisme) jusqu'au chantier C2.
--   billing_settings.comptable_transmission : email_facturx (récapitulatif mensuel et Factur-X de chaque facture),
--     email_pdf (récapitulatif mensuel et PDF simple) ; vide = envoi désactivé ;
--   billing_settings.plateforme_agreee : plateforme de dématérialisation retenue (renseignement, branchement plus tard) ;
--   billing_transmission_mode() : mode de la société courante, lu par l'écran et par /api/send-invoices-comptable,
--     qui n'envoie plus que des factures et avoirs émis.
-- Aucune nouvelle table. Idempotente. Retour arrière : supabase/rollback/0366_facturation_transmission_retour.sql

alter table public.billing_settings add column if not exists comptable_transmission text;
alter table public.billing_settings add column if not exists plateforme_agreee text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'billing_settings_comptable_transmission_check') then
    alter table public.billing_settings add constraint billing_settings_comptable_transmission_check
      check (comptable_transmission is null or comptable_transmission in ('email_facturx', 'email_pdf'));
  end if;
end
$$;
comment on column public.billing_settings.comptable_transmission is 'Transmission au comptable : email_facturx, email_pdf ; vide = envoi désactivé (rien n''est supposé)';
comment on column public.billing_settings.plateforme_agreee is 'Plateforme de dématérialisation retenue par la société (renseignement, branchement par API plus tard)';

create or replace function public.billing_transmission_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.comptable_transmission from public.billing_settings s
  where s.company_id = app.billing_company()
    and app.un_des_droits(array['facturation.export.comptable', 'facturation.factures.voir'])
$$;

revoke all on function public.billing_transmission_mode() from public, anon;
grant execute on function public.billing_transmission_mode() to authenticated, service_role;

insert into public.schema_migrations (version) values ('0366_facturation_transmission') on conflict (version) do nothing;

-- Retour arrière de 0364_facturation_avoirs.sql : retire la préparation des avoirs et la reprise d'une facture.
-- Les brouillons déjà préparés restent (lignes ordinaires de invoices). Idempotent.

drop function if exists public.billing_create_credit_note(uuid, text, jsonb, numeric);
drop function if exists public.billing_duplicate_invoice(uuid);

delete from public.schema_migrations where version = '0364_facturation_avoirs';

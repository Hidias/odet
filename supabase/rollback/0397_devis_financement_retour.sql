-- Retour arrière de 0397_devis_financement.sql : le devis ne porte plus le financement prévu. Idempotent.

alter table public.quotes drop constraint if exists quotes_funding_type_check;
alter table public.quotes drop constraint if exists quotes_funding_amount_check;
alter table public.quotes drop column if exists funding_type;
alter table public.quotes drop column if exists funding_client_id;
alter table public.quotes drop column if exists funding_name;
alter table public.quotes drop column if exists funding_agreement_ref;
alter table public.quotes drop column if exists funding_agreement_date;
alter table public.quotes drop column if exists funding_subrogation;
alter table public.quotes drop column if exists funding_amount_ht;

delete from public.schema_migrations where version = '0397_devis_financement';

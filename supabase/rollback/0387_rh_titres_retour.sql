-- Retour arrière de 0387_rh_titres.sql : retire les signatures enregistrées et la délivrance des titres. Idempotent.

alter table public.hr_qualifications drop column if exists title_document_id;
alter table public.hr_qualifications drop column if exists employee_signed_at;
alter table public.hr_qualifications drop column if exists delivered_by;
alter table public.hr_qualifications drop column if exists delivered_at;
drop table if exists public.user_signatures;

delete from public.schema_migrations where version = '0387_rh_titres';

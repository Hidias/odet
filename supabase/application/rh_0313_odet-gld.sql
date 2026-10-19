-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (rh_0313) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0313_rh_registre.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0313_rh_registre_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0313_rh_registre.sql =====
-- 0313_rh_registre.sql : chantier 12, module RH, registre unique du personnel (articles L1221-13 et D1221-23 du Code
-- du travail, lus le 19/10/2026 sur code.travail.gouv.fr).
--
-- Le registre est généré depuis les fiches et les contrats (aucune double saisie). Il manquait :
--   - nationalité et sexe de la personne ;
--   - pour un travailleur étranger soumis à autorisation de travail : type et numéro de l'autorisation ;
--   - pour un intérimaire ou un salarié mis à disposition : nom et adresse de l'entreprise de travail temporaire ou
--     du groupement d'employeurs ;
--   - date de l'autorisation d'embauche ou de licenciement quand elle est requise.
-- Colonnes facultatives, lues et écrites avec les mêmes droits que la fiche et le contrat (règles de 0290 inchangées),
-- tracées par le journal existant (champs modifiés, jamais les valeurs).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0313_rh_registre_retour.sql

alter table public.hr_people add column if not exists nationality text;
alter table public.hr_people add column if not exists gender text;
alter table public.hr_people add column if not exists work_permit_type text;
alter table public.hr_people add column if not exists work_permit_ref text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hr_people_gender_check') then
    alter table public.hr_people add constraint hr_people_gender_check check (gender is null or gender in ('F', 'M'));
  end if;
end $$;
comment on column public.hr_people.nationality is 'Nationalité (registre unique du personnel, D1221-23)';
comment on column public.hr_people.gender is 'Sexe : F ou M (registre unique du personnel, D1221-23)';
comment on column public.hr_people.work_permit_type is 'Travailleur étranger soumis à autorisation : type de l''autorisation de travail';
comment on column public.hr_people.work_permit_ref is 'Travailleur étranger soumis à autorisation : numéro d''ordre de l''autorisation de travail';

alter table public.hr_employments add column if not exists agency_name text;
alter table public.hr_employments add column if not exists agency_address text;
alter table public.hr_employments add column if not exists authorization_on date;
comment on column public.hr_employments.agency_name is 'Intérim ou mise à disposition : entreprise de travail temporaire ou groupement d''employeurs';
comment on column public.hr_employments.agency_address is 'Adresse de l''entreprise de travail temporaire ou du groupement d''employeurs';
comment on column public.hr_employments.authorization_on is 'Date de l''autorisation d''embauche ou de licenciement, ou de sa demande, quand elle est requise';

insert into public.schema_migrations (version) values ('0313_rh_registre') on conflict (version) do nothing;

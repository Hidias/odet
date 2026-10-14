-- Retour arrière de 0190_passeport_prevention.sql (module Passeport de prévention).
-- À coller dans l'éditeur SQL de Supabase. Efface toutes les données du module (réglages, numéros chiffrés,
-- lignes de déclaration, envois, fichiers, accusés) et les deux colonnes ajoutées à trainees.
-- Rien d'autre n'est touché : ni les règles existantes, ni les autres tables.

begin;

drop trigger if exists pp_demo_record_deleted on public.demo_records;
drop function if exists public.pp_demo_record_deleted();

drop function if exists public.pp_marquer_fichier(uuid, boolean);
drop function if exists public.pp_import_accuse(text, jsonb);
drop function if exists public.pp_nir_encore_utile(uuid);
drop function if exists public.pp_enregistrer_refus(uuid, boolean);
drop function if exists public.pp_enregistrer_nom(uuid, text, boolean);
drop function if exists public.pp_donnees(uuid[], uuid[]);
drop function if exists public.pp_nir_etat(uuid[]);

drop table if exists public.pp_envois;
drop table if exists public.pp_lignes;
drop table if exists public.pp_accuses;
drop table if exists public.pp_fichiers;
drop table if exists public.pp_nir;
drop table if exists public.pp_course_settings;
drop table if exists public.pp_presets;
drop table if exists public.pp_format_versions;

drop function if exists public.pp_can_read();
drop function if exists public.pp_can();

alter table public.trainees drop column if exists nom_naissance_confirme_le;
alter table public.trainees drop column if exists nom_naissance;

delete from public.org_modules where key = 'passeport';

-- Lignes de démonstration du module
delete from public.demo_records where tbl in ('pp_fichiers', 'pp_accuses', 'pp_nir');

commit;

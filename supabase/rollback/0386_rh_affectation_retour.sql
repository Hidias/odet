-- Retour arrière de 0386_rh_affectation.sql : retire le contrôle d'affectation, les consignes, la suite de l'inaptitude
-- et l'attestation de non contre-indication. Les colonnes ajoutées sont retirées (données de ces colonnes perdues).
-- Idempotent.

drop view if exists public.v_hr_vigilance;
drop trigger if exists hr_medical_followups_inaptitude on public.hr_medical_followups;
drop function if exists app.hr_inaptitude_suite();
drop trigger if exists itv_visits_affectation_garde on public.itv_visits;
drop function if exists app.affectation_garde();
drop function if exists public.affectation_lever(uuid, uuid, text);
drop function if exists public.affectation_verifier(uuid, uuid, date);
drop function if exists app.affectation_motifs(uuid, uuid, date);
drop function if exists app.affectation_regles_depart(uuid);
drop table if exists public.assignment_overrides;
drop table if exists public.assignment_requirements;
drop table if exists public.hr_work_restrictions;
alter table public.hr_people drop column if exists minor_derogation_until;
alter table public.hr_qualifications drop column if exists suspended_reason;
alter table public.hr_qualifications drop column if exists suspended_at;
alter table public.hr_qualifications drop column if exists scope;
alter table public.hr_qualifications drop column if exists symbols;
alter table public.hr_medical_followups drop column if exists inaptitude_closed_on;
alter table public.hr_medical_followups drop column if exists inaptitude_outcome;
alter table public.hr_medical_followups drop column if exists nci_scope;
alter table public.hr_medical_followups drop constraint if exists hr_medical_followups_visit_type_check;
alter table public.hr_medical_followups add constraint hr_medical_followups_visit_type_check
  check (visit_type in ('information_prevention', 'embauche', 'periodique', 'reprise', 'prereprise', 'mi_carriere', 'demande'));

delete from public.schema_migrations where version = '0386_rh_affectation';

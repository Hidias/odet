-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (rh_dpae_0521) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0521_rh_dpae.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0521_rh_dpae_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0521_rh_dpae.sql =====
-- 0521 : suivi de la déclaration préalable à l'embauche (DPAE) sur le contrat (demande de H du 16/11, choix du 18/11 :
-- lien officiel, récapitulatif à recopier, suivi et alerte ; pas d'envoi par l'API de l'Urssaf).
-- Sources (Légifrance, lues le 18/11/2026) : Code du travail, R1221-1 (mentions), R1221-4 (au plus tôt dans les huit
-- jours précédant la date prévisible de l'embauche), R1221-5 (voie électronique), R1221-7 (accusé de réception).
-- Règles :
--   1. hr_employments : date d'envoi de la DPAE et référence de l'accusé de réception. Le numéro de sécurité sociale
--      n'est jamais stocké : il se saisit sur le site de l'Urssaf.
--   2. hr_documents : catégorie « dpae » pour ranger l'accusé de réception, jamais en confidentialité « normal »
--      (contrainte hr_documents_confidentialite de 0301 reprise, « dpae » ajoutée ; relecture du 18/11).
--   3. v_hr_echeances : échéance « DPAE » pour un contrat de salarié (CDI, CDD, apprentissage, professionnalisation)
--      sans DPAE notée, à la date de début du contrat ; plus montrée 30 jours après le début (même fenêtre que les fins
--      de contrat). Stage, intérim (déclaré par l'agence), mandataire et autre : pas d'échéance.
--      Corps des cinq autres branches repris de la production (0314, identique le 18/11).
-- Additive. Idempotente. Retour arrière : supabase/rollback/0521_rh_dpae_retour.sql

alter table public.hr_employments add column if not exists dpae_sent_on date;
alter table public.hr_employments add column if not exists dpae_reference text;
alter table public.hr_employments drop constraint if exists hr_employments_dpae_reference_longueur;
alter table public.hr_employments add constraint hr_employments_dpae_reference_longueur
  check (dpae_reference is null or length(dpae_reference) <= 60);
comment on column public.hr_employments.dpae_sent_on is 'Date d''envoi de la DPAE à l''Urssaf (R1221-4 : au plus tôt 8 jours avant l''embauche)';
comment on column public.hr_employments.dpae_reference is 'Référence de l''accusé de réception de la DPAE (R1221-7)';

alter table public.hr_documents drop constraint if exists hr_documents_category_check;
alter table public.hr_documents add constraint hr_documents_category_check
  check (category = any (array['contrat', 'avenant', 'fiche_poste', 'attestation', 'titre', 'justificatif', 'sante', 'bulletin', 'dpae', 'autre']));
-- Accusé de réception de la DPAE jamais « normal », comme les justificatifs et la santé (contrainte de 0301 reprise)
alter table public.hr_documents drop constraint if exists hr_documents_confidentialite;
alter table public.hr_documents add constraint hr_documents_confidentialite check (
  (category not in ('justificatif', 'sante', 'dpae') or confidentiality <> 'normal')
  and (category <> 'bulletin' or confidentiality = 'prive'));

create or replace view public.v_hr_echeances with (security_invoker = true) as
  select q.company_id, q.person_id, 'habilitation'::text as kind, q.label, q.expires_on as due_on, q.id as source_id
  from public.hr_qualifications q
  where q.archived_at is null and q.expires_on is not null
  union all
  select m.company_id, m.person_id, 'visite', 'Visite de santé au travail', m.next_due_on, m.id
  from public.hr_medical_followups m
  where m.next_due_on is not null
    and not exists (select 1 from public.hr_medical_followups m2
                    where m2.person_id = m.person_id and m2.visit_on is not null and m2.visit_on >= m.next_due_on)
  union all
  select e.company_id, e.person_id, 'fin_contrat', 'Fin de contrat', e.end_on, e.id
  from public.hr_employments e
  where e.end_on is not null and e.end_on >= current_date - 30
  union all
  select e.company_id, e.person_id, 'fin_essai', 'Fin de la période d''essai', e.trial_end_on, e.id
  from public.hr_employments e
  where e.trial_end_on is not null and e.trial_end_on >= current_date - 30
  union all
  select r.company_id, r.person_id, 'entretien',
         case r.kind when 'parcours' then 'Entretien de parcours professionnel' when 'bilan' then 'Bilan du parcours professionnel'
                     when 'annuel' then 'Entretien annuel' else 'Entretien' end,
         coalesce(case when r.done_on is null then r.planned_on end, r.next_due_on), r.id
  from public.hr_reviews r
  where coalesce(case when r.done_on is null then r.planned_on end, r.next_due_on) is not null
    and not exists (select 1 from public.hr_reviews r2 where r2.person_id = r.person_id and r2.kind = r.kind
                    and r2.done_on is not null and r2.done_on > coalesce(r.done_on, r.planned_on, r.next_due_on))
  union all
  select e.company_id, e.person_id, 'dpae', 'Déclaration préalable à l''embauche (DPAE)', e.start_on, e.id
  from public.hr_employments e
  where e.dpae_sent_on is null
    and e.contract_type in ('cdi', 'cdd', 'apprentissage', 'professionnalisation')
    and e.start_on >= current_date - 30
;
comment on view public.v_hr_echeances is 'Échéances RH (habilitations, visites, fins de CDD et d''essai, entretiens, DPAE), aux droits du lecteur';
revoke all on public.v_hr_echeances from public, anon;
grant select on public.v_hr_echeances to authenticated;

-- Retour arrière de 0521 : échéance DPAE retirée de la vue (corps de 0314), catégorie « dpae » retirée (documents de
-- cette catégorie passés en « attestation », titre gardé), colonnes de suivi supprimées.
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
;
comment on view public.v_hr_echeances is 'Échéances RH (habilitations, visites, fins de CDD et d''essai, entretiens), aux droits du lecteur';
revoke all on public.v_hr_echeances from public, anon;
grant select on public.v_hr_echeances to authenticated;

update public.hr_documents set category = 'attestation' where category = 'dpae';
alter table public.hr_documents drop constraint if exists hr_documents_category_check;
alter table public.hr_documents add constraint hr_documents_category_check
  check (category = any (array['contrat', 'avenant', 'fiche_poste', 'attestation', 'titre', 'justificatif', 'sante', 'bulletin', 'autre']));

alter table public.hr_employments drop constraint if exists hr_employments_dpae_reference_longueur;
alter table public.hr_employments drop column if exists dpae_reference;
alter table public.hr_employments drop column if exists dpae_sent_on;

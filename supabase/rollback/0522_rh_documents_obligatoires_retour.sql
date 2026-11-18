-- Retour arrière de 0522 : échéances remises comme en 0521, modèle de liste d'arrivée remis comme en 0314 (ligne
-- « Accueil sécurité fait » retirée des modèles, y compris une ligne de même libellé ajoutée à la main ; les listes déjà
-- ouvertes la gardent), tables, fonctions et colonnes supprimées.
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

create or replace function app.hr_listes_depart(p_company uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.hr_checklist_templates (company_id, kind, label, position)
  select p_company, x.kind, x.label, x.pos
  from (values
    ('arrivee', 'Contrat signé et rangé dans les documents', 1),
    ('arrivee', 'Déclaration préalable à l''embauche faite', 2),
    ('arrivee', 'Visite d''information et de prévention demandée', 3),
    ('arrivee', 'Livret d''accueil et règlement intérieur remis', 4),
    ('arrivee', 'Équipements de protection individuelle remis', 5),
    ('arrivee', 'Accès à l''outil, badge et clés donnés', 6),
    ('arrivee', 'Habilitations vérifiées ou formations prévues', 7),
    ('depart', 'Matériel, véhicule, badge et clés restitués', 1),
    ('depart', 'Accès à l''outil et aux comptes coupés', 2),
    ('depart', 'Solde de tout compte remis', 3),
    ('depart', 'Certificat de travail et attestation France Travail remis', 4),
    ('depart', 'Entretien de départ fait', 5)) as x(kind, label, pos)
  on conflict (company_id, kind, label) do nothing
$$;
revoke all on function app.hr_listes_depart(uuid) from public, anon, authenticated;
delete from public.hr_checklist_templates where kind = 'arrivee' and label = 'Accueil sécurité fait';

drop trigger if exists hr_checklists_accueil on public.hr_checklists;
drop function if exists app.hr_liste_accueil();
drop table if exists public.hr_safety_inductions;
drop function if exists app.hr_debut_continu(uuid);
drop function if exists app.hr_dati_remis(uuid);
drop function if exists app.hr_accueil_avant();
drop function if exists app.hr_accueil_liste();
drop table if exists public.hr_postings;
drop function if exists app.hr_affichage_maj();
alter table public.hr_settings drop constraint if exists hr_settings_posting_location_longueur;
alter table public.hr_settings drop column if exists posting_location;
alter table public.stock_items drop column if exists dati;
alter table public.hr_jobs drop constraint if exists hr_jobs_lone_work_check;
alter table public.hr_jobs drop column if exists lone_work_duerp_ref;
alter table public.hr_jobs drop column if exists lone_work_note;
alter table public.hr_jobs drop column if exists lone_work_measures;
alter table public.hr_jobs drop column if exists lone_work;
delete from public.schema_migrations where version = '0522_rh_documents_obligatoires';

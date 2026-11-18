-- Retour arrière de 0523 : échéances remises comme en 0522, tables, fonctions, déclencheurs, contraintes et colonnes
-- supprimés (les contrats et avenants générés restent dans les documents RH, sans leur origine ni leur empreinte).
-- La vue lit hr_employments.* : supprimée d'abord, recréée comme en 0522 après le retrait des colonnes
drop view if exists public.v_hr_echeances;

-- Documents RH : règles et fonctions remises comme en 0301 ; droit « Voir les contrats de travail » retiré
drop policy if exists hr_documents_lire on public.hr_documents;
drop policy if exists hr_documents_creer on public.hr_documents;
drop policy if exists hr_documents_modifier on public.hr_documents;
drop policy if exists hr_documents_supprimer on public.hr_documents;
create policy hr_documents_lire on public.hr_documents for select to authenticated
  using ((person_id in (select app.hr_mes_personnes()) or (confidentiality = 'normal' and company_id in (select app.societes_avec_droit('rh.dossiers.voir'))) or (confidentiality <> 'normal' and company_id in (select app.societes_avec_droit('rh.documents.restreints')))));
create policy hr_documents_creer on public.hr_documents for insert to authenticated
  with check (((company_id in (select app.societes_avec_droit('rh.dossiers.gerer')) and (confidentiality = 'normal' or company_id in (select app.societes_avec_droit('rh.documents.restreints')))) or (person_id in (select app.hr_mes_personnes()) and category = 'justificatif' and confidentiality = 'restreint')));
create policy hr_documents_modifier on public.hr_documents for update to authenticated
  using ((company_id in (select app.societes_avec_droit('rh.dossiers.gerer')) and (confidentiality = 'normal' or company_id in (select app.societes_avec_droit('rh.documents.restreints')))))
  with check ((company_id in (select app.societes_avec_droit('rh.dossiers.gerer')) and (confidentiality = 'normal' or company_id in (select app.societes_avec_droit('rh.documents.restreints')))));
create policy hr_documents_supprimer on public.hr_documents for delete to authenticated
  using ((company_id in (select app.societes_avec_droit('rh.dossiers.gerer')) and (confidentiality = 'normal' or company_id in (select app.societes_avec_droit('rh.documents.restreints')))));

create or replace function public.hr_document_ouvrir(p_doc uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.hr_documents;
  v_moi boolean;
begin
  select * into v_d from public.hr_documents d where d.id = p_doc;
  if v_d.id is null then raise exception 'Document introuvable' using errcode = 'P0002'; end if;
  v_moi := v_d.person_id in (select app.hr_mes_personnes());
  if not (v_moi
          or (v_d.confidentiality = 'normal' and v_d.company_id in (select app.societes_avec_droit('rh.dossiers.voir')))
          or (v_d.confidentiality <> 'normal' and v_d.company_id in (select app.societes_avec_droit('rh.documents.restreints')))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if v_d.confidentiality <> 'normal' and not v_moi then
    insert into public.audit_logs (action, entity_type, entity_id, entity_name, details, company_id, source)
    values ('view', 'document_rh', v_d.id, null,
            jsonb_build_object('table', 'hr_documents', 'confidentialite', v_d.confidentiality, 'categorie', v_d.category),
            v_d.company_id, 'base');
  end if;
  return v_d.file_path;
end
$$;
revoke all on function public.hr_document_ouvrir(uuid) from public, anon;
grant execute on function public.hr_document_ouvrir(uuid) to authenticated;

create or replace function app.hr_fichier_supprimable(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select split_part(p_path, '/', 1) in (select x::text from app.societes_avec_droit('rh.dossiers.gerer') x)
     and (not exists (select 1 from public.hr_documents d where d.file_path = p_path and d.confidentiality <> 'normal')
          or split_part(p_path, '/', 1) in (select x::text from app.societes_avec_droit('rh.documents.restreints') x))
$$;
revoke all on function app.hr_fichier_supprimable(text) from public, anon;
grant execute on function app.hr_fichier_supprimable(text) to authenticated;

delete from public.permission_profile_rights where right_code = 'rh.contrats.voir';
delete from public.permissions where code = 'rh.contrats.voir';

alter table public.hr_compensation drop constraint if exists hr_compensation_components_longueur;
alter table public.hr_compensation drop column if exists components;

drop function if exists app.hr_jour_ouvrable_apres(uuid, date, int);

drop function if exists public.hr_document_protege(uuid);
drop table if exists public.hr_contract_amendments;
drop function if exists app.hr_avenant_avant();
drop function if exists app.hr_avenant_suppression();
drop table if exists public.hr_contract_models;
drop function if exists public.hr_modeles_contrat_poser(uuid);
drop function if exists app.hr_modeles_contrat_depart(uuid);
drop function if exists app.hr_modele_avant();

alter table public.hr_documents drop constraint if exists hr_documents_genere;
alter table public.hr_documents drop column if exists generated_from;
alter table public.hr_documents drop column if exists content_sha256;

drop trigger if exists hr_employments_document on public.hr_employments;
drop function if exists app.hr_contrat_document();
alter table public.hr_employments drop constraint if exists hr_employments_contrat_ecrit;
alter table public.hr_employments drop column if exists work_places;
alter table public.hr_employments drop column if exists cdd_reason;
alter table public.hr_employments drop column if exists cdd_replaced_name;
alter table public.hr_employments drop column if exists cdd_replaced_qualification;
alter table public.hr_employments drop column if exists cdd_min_end_on;
alter table public.hr_employments drop column if exists cdd_renewable;
alter table public.hr_employments drop column if exists risky_post;
alter table public.hr_employments drop column if exists contract_handed_on;
alter table public.hr_employments drop column if exists signed_document_id;

alter table public.hr_settings drop constraint if exists hr_settings_contrats_longueurs;
alter table public.hr_settings drop column if exists collective_agreement_name;
alter table public.hr_settings drop column if exists retirement_fund;
alter table public.hr_settings drop column if exists prevoyance_org;
alter table public.hr_settings drop column if exists pay_terms;

create or replace view public.v_hr_echeances with (security_invoker = true) as
  -- Contrat le plus récent par personne non archivée, en cours ou qui commence dans les 30 jours
  with courant as (
    select distinct on (e.person_id) e.*
    from public.hr_employments e
    join public.hr_people p on p.id = e.person_id and p.archived_at is null
    where (e.end_on is null or e.end_on >= current_date) and e.start_on <= current_date + 30
    order by e.person_id, e.start_on desc, e.created_at desc)
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
  union all
  -- Contrat le plus récent de la personne (non archivée), sans accueil signé pour son poste depuis ce contrat ou les
  -- contrats enchaînés sur le même poste (app.hr_debut_continu) ; mandataire : sans objet
  select c.company_id, c.person_id, 'accueil_securite',
         case when coalesce((select i.job_id from public.hr_safety_inductions i where i.person_id = c.person_id and i.signed_at is not null
                             order by i.done_on desc, i.signed_at desc limit 1), c.job_id) is distinct from c.job_id
              then 'Accueil sécurité à refaire (changement de poste)' else 'Accueil sécurité' end,
         c.start_on, c.id
  from courant c
  where c.contract_type <> 'mandataire'
    and not exists (select 1 from public.hr_safety_inductions i
                    where i.person_id = c.person_id and i.signed_at is not null
                      and i.job_id is not distinct from c.job_id
                      and i.done_on >= app.hr_debut_continu(c.id) - 30)
  union all
  -- Poste « seul » sans mesure, ou mesure DATI sans DATI remis et non rendu ; daté du début du contrat
  select c.company_id, c.person_id, 'travail_isole',
         case when cardinality(j.lone_work_measures) = 0 then 'Travail isolé : aucune mesure sur le poste ' || j.name
              else 'Travail isolé : DATI à remettre' end,
         c.start_on, c.id
  from courant c
  join public.hr_jobs j on j.id = c.job_id and j.lone_work
  where cardinality(j.lone_work_measures) = 0
     or ('dati' = any (j.lone_work_measures) and not app.hr_dati_remis(c.person_id))
;
comment on view public.v_hr_echeances is 'Échéances RH (habilitations, visites, fins de CDD et d''essai, entretiens, DPAE, accueil sécurité, travail isolé), aux droits du lecteur';
revoke all on public.v_hr_echeances from public, anon;
grant select on public.v_hr_echeances to authenticated;

delete from public.schema_migrations where version = '0523_rh_contrats';

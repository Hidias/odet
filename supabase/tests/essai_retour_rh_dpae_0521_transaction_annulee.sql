-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (rh_dpae_0521) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0521_rh_dpae.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

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

-- ===== supabase/rollback/0521_rh_dpae_retour.sql =====
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

alter table public.hr_documents drop constraint if exists hr_documents_confidentialite;
alter table public.hr_documents add constraint hr_documents_confidentialite check (
  (category not in ('justificatif', 'sante') or confidentiality <> 'normal')
  and (category <> 'bulletin' or confidentiality = 'prive'));
update public.hr_documents set category = 'attestation' where category = 'dpae';
alter table public.hr_documents drop constraint if exists hr_documents_category_check;
alter table public.hr_documents add constraint hr_documents_category_check
  check (category = any (array['contrat', 'avenant', 'fiche_poste', 'attestation', 'titre', 'justificatif', 'sante', 'bulletin', 'autre']));

alter table public.hr_employments drop constraint if exists hr_employments_dpae_reference_longueur;
alter table public.hr_employments drop column if exists dpae_reference;
alter table public.hr_employments drop column if exists dpae_sent_on;

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE rh_dpae_0521 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

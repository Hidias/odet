-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (f_0350) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0350_certifications_generiques.sql, retour arrière,
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

-- ===== supabase/migrations/0350_certifications_generiques.sql =====
-- 0350_certifications_generiques.sql : chantier F phase 2, module Certification générique et rattaché à la société.
--
-- Spec : odet-conformite-rgpd-certifications.md § 7 (validée par H le 17/10).
-- 1. Référentiels : nature (Qualiopi, NDA, APSAD, interne, autre), organisme, source du texte (officiel public, fourni
--    par la société, à saisir) ; un référentiel peut appartenir à une société (texte acheté, ex. APSAD) ou à la
--    plateforme (Qualiopi). Chapitres et exigences gardent leur numéro et reçoivent un code libre (« R4 § 5.2 ») et
--    la page d'origine du texte importé. Squelette APSAD & NF Service I4NF285 (sans aucune exigence : le texte est
--    payant, il est importé par la société).
-- 2. cert_company_certifications : une ligne par société et par référentiel (statut, certificateur, numéro, validité,
--    audits prévus et faits, périmètre, certificat).
-- 3. app.cert_valid(société, référentiel) : vraie seulement si la certification est obtenue et en cours de validité.
--    Tout futur document réservé aux certifiés (N4, Q4…) devra l'appeler en base.
-- 4. cert_pitfalls : face interne « erreurs à éviter », conseil réservé à la direction (droit manager.cockpit.voir :
--    profils direction et administrateur). Aucune vue ni fonction d'export ne la lit. Liste de départ par société
--    (APSAD A0 à A13, Qualiopi Q1 à Q15, NDA N1 à N8), toutes « à confirmer par la société ».
-- Tables : company_id, règles par droits (build_suite('0350')) et isolement par société ; référentiels de plateforme
-- (company_id vide) lus par toutes les sociétés, modifiés seulement par le super administrateur.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0350_certifications_generiques_retour.sql

-- ── 1. Référentiels génériques ──
alter table public.cert_referentials add column if not exists kind text not null default 'autre';
alter table public.cert_referentials add column if not exists issuer text;
alter table public.cert_referentials add column if not exists text_source text not null default 'officiel';
alter table public.cert_referentials add column if not exists company_id uuid references public.companies(id) on delete cascade;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cert_referentials_kind_check') then
    alter table public.cert_referentials add constraint cert_referentials_kind_check check (kind in ('qualiopi', 'nda', 'apsad', 'interne', 'autre'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cert_referentials_text_source_check') then
    alter table public.cert_referentials add constraint cert_referentials_text_source_check check (text_source in ('officiel', 'societe', 'a_saisir'));
  end if;
end $$;
update public.cert_referentials set kind = 'qualiopi', issuer = coalesce(issuer, 'France compétences (référentiel national qualité)')
 where code like 'rnq-%' and kind = 'autre';

alter table public.cert_criteria add column if not exists code text;
alter table public.cert_indicators add column if not exists code text;
alter table public.cert_indicators add column if not exists imported_from text;

insert into public.cert_referentials (code, label, legal_ref, source_url, notes, sort_order, kind, issuer, text_source)
values ('apsad-i4nf285', 'APSAD & NF Service I4NF285 (extincteurs)', 'Règle APSAD R4, NF S 61-919, NF S 61-922',
        'https://www.cnpp.com/tester-certifier/certifier-prestations-service-apsad-incendie/extincteurs-portatifs-mobiles-fixes',
        'Texte payant : les exigences sont importées par la société depuis son exemplaire (aucune exigence livrée avec l''outil).',
        50, 'apsad', 'CNPP Cert. et AFNOR Certification', 'a_saisir')
on conflict (code) do nothing;

-- Référentiel lisible : de plateforme (sans société) ou d'une société lisible ; modifiable : de sa société (écriture),
-- ou de plateforme par le super administrateur seulement
create or replace function app.cert_ref_lisible(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.cert_referentials r where r.code = p_code
                 and (r.company_id is null or r.company_id in (select app.societes_lisibles())))
$$;
create or replace function app.cert_ref_ecriture(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.cert_referentials r where r.code = p_code
                 and ((r.company_id is null and app.is_superadmin()) or r.company_id in (select app.societes_ecriture())))
$$;
revoke all on function app.cert_ref_lisible(text) from public, anon;
revoke all on function app.cert_ref_ecriture(text) from public, anon;
grant execute on function app.cert_ref_lisible(text), app.cert_ref_ecriture(text) to authenticated;

drop policy if exists cert_referentials_societe_lire on public.cert_referentials;
drop policy if exists cert_referentials_societe_creer on public.cert_referentials;
drop policy if exists cert_referentials_societe_modifier on public.cert_referentials;
drop policy if exists cert_referentials_societe_supprimer on public.cert_referentials;
create policy cert_referentials_societe_lire on public.cert_referentials as restrictive for select to authenticated
  using (company_id is null or company_id in (select app.societes_lisibles()));
create policy cert_referentials_societe_creer on public.cert_referentials as restrictive for insert to authenticated
  with check ((company_id is null and (select app.is_superadmin())) or company_id in (select app.societes_ecriture()));
create policy cert_referentials_societe_modifier on public.cert_referentials as restrictive for update to authenticated
  using ((company_id is null and (select app.is_superadmin())) or company_id in (select app.societes_ecriture()))
  with check ((company_id is null and (select app.is_superadmin())) or company_id in (select app.societes_ecriture()));
create policy cert_referentials_societe_supprimer on public.cert_referentials as restrictive for delete to authenticated
  using ((company_id is null and (select app.is_superadmin())) or company_id in (select app.societes_ecriture()));
do $$
declare t text;
begin
  foreach t in array array['cert_criteria', 'cert_indicators'] loop
    execute format('drop policy if exists %I on public.%I', t || '_societe_lire', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_creer', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_modifier', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_supprimer', t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using ((select app.cert_ref_lisible(referential_code)))', t || '_societe_lire', t);
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check ((select app.cert_ref_ecriture(referential_code)))', t || '_societe_creer', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using ((select app.cert_ref_ecriture(referential_code))) with check ((select app.cert_ref_ecriture(referential_code)))', t || '_societe_modifier', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using ((select app.cert_ref_ecriture(referential_code)))', t || '_societe_supprimer', t);
  end loop;
end $$;

-- ── 2. Certifications de la société ──
create table if not exists public.cert_company_certifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  referential_code text not null references public.cert_referentials(code) on delete cascade,
  statut text not null default 'visee' check (statut in ('visee', 'dossier', 'audit_planifie', 'obtenue', 'suspendue', 'retiree', 'refusee')),
  certificateur text,
  numero text,
  obtenue_le date,
  valable_jusqu_au date,
  audit_initial_prevu date,
  audit_initial_fait date,
  audit_suivi_prevu date,
  audit_suivi_fait date,
  renouvellement_prevu date,
  perimetre text,
  document_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, referential_code)
);
comment on table public.cert_company_certifications is 'Certifications de chaque société (statut, validité, audits) : app.cert_valid en dépend';

-- ── 3. Garde des documents réservés aux certifiés ──
create or replace function app.cert_valid(p_company uuid, p_referential text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.cert_company_certifications c
                 where c.company_id = p_company and c.referential_code = p_referential and c.statut = 'obtenue'
                   and (c.valable_jusqu_au is null or c.valable_jusqu_au >= current_date))
$$;
revoke all on function app.cert_valid(uuid, text) from public, anon;
grant execute on function app.cert_valid(uuid, text) to authenticated;

-- ── 4. Face interne « erreurs à éviter » ──
create table if not exists public.cert_pitfalls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  domaine text not null check (domaine in ('apsad', 'qualiopi', 'nda', 'autre')),
  referential_code text references public.cert_referentials(code) on delete set null,
  code text not null,
  exigence text,
  erreur text not null,
  reperage text,
  action text,
  source text,
  source_type text not null default 'secondaire' check (source_type in ('officiel', 'secondaire', 'societe')),
  statut text not null default 'a_confirmer' check (statut in ('a_confirmer', 'confirme', 'ecarte')),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, domaine, code)
);
comment on table public.cert_pitfalls is 'Face interne (conseil de direction) : jamais dans un export, un PDF, un portail ni un document d''audit';

create or replace function app.cert_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then new.company_id := old.company_id; new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.cert_maj() from public, anon, authenticated;
drop trigger if exists cert_company_certifications_maj on public.cert_company_certifications;
create trigger cert_company_certifications_maj before insert or update on public.cert_company_certifications for each row execute function app.cert_maj();
drop trigger if exists cert_pitfalls_maj on public.cert_pitfalls;
create trigger cert_pitfalls_maj before insert or update on public.cert_pitfalls for each row execute function app.cert_maj();

create or replace function app.cert_pitfalls_depart(p_company uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.cert_pitfalls (company_id, domaine, referential_code, code, exigence, erreur, reperage, action, source, source_type, position)
  select p_company, d.domaine, d.ref, d.code, d.exigence, d.erreur, d.reperage, d.action, d.source, d.st, d.pos
  from (values
    ('apsad', 'apsad-i4nf285', 'A0', 'Audit en clientèle et contrôle des connaissances (B0) ; opérations de la règle R4',
     'Présenter à l''audit un parc refait à neuf : sans appareil de 5, 10 ou 15 ans, l''auditeur ne voit ni maintenance additionnelle ni révision',
     'Sites où des opérations à 5, 10 ou 15 ans ont été faites récemment ou sont dues, avec photos, étiquettes et rapports',
     'Garder des sites où les opérations dues sont faites (et non des remplacements) ; préparer un dossier par opération réalisée',
     'Explication des associés (17/10) ; audit en clientèle, référentiel général B0 du CNPP', 'societe', 0),
    ('apsad', 'apsad-i4nf285', 'A1', 'R4 (opérations périodiques) ; NF S 61-919',
     'Remplacer un appareil au lieu de faire la maintenance additionnelle (5 et 15 ans) ou la révision (10 ans), sans justification écrite',
     'Visite où l''appareil est remplacé alors que l''opération due était une maintenance ou une révision et qu''il n''est pas en fin de vie',
     'Motif obligatoire, information et accord du client tracés, devis', 'Référentiel du CAP vérificateur (eduscol b045)', 'secondaire', 1),
    ('apsad', 'apsad-i4nf285', 'A2', 'NF S 61-919 (périodicités)', 'Opération due non faite à l''échéance (appareil de 5, 10 ou 15 ans vérifié comme un appareil récent)',
     'Liste des opérations dues et en retard par client', 'Planifier l''opération, l''inscrire au contrat', 'Résumés publics de la NF S 61-919', 'secondaire', 2),
    ('apsad', 'apsad-i4nf285', 'A3', 'NF S 61-919 (durée de vie)', 'Appareil gardé au-delà de 20 ans (eau, poudre)', 'Appareils de plus de 20 ans encore en service',
     'Proposer le remplacement, motif « fin de vie »', 'Résumés publics de la NF S 61-919', 'secondaire', 3),
    ('apsad', 'apsad-i4nf285', 'A4', 'R4, étiquette informative', 'Étiquette de maintenance incomplète (opération, mois et année, prochaine échéance, technicien)',
     'Rapport sans technicien identifié par appareil', 'Identifier le technicien sur chaque ligne', 'Sommaire public de la règle R4', 'secondaire', 4),
    ('apsad', 'apsad-i4nf285', 'A5', 'R4, compte rendu Q4', 'Compte rendu de vérification (Q4) non remis ou remis hors délai',
     'Visite terminée sans date d''envoi du rapport', 'Envoyer le rapport, tracer la remise', 'Formulaire Q4 publié par une préfecture', 'secondaire', 5),
    ('apsad', 'apsad-i4nf285', 'A6', 'Règles d''usage de la marque (B0)', 'Utiliser N4, Q4 ou la marque APSAD sans être certifié',
     'Document N4 ou Q4 demandé sans certification valide', 'Blocage en base (app.cert_valid)', 'Pages du CNPP et référentiel B0', 'officiel', 6),
    ('apsad', 'apsad-i4nf285', 'A7', 'Périmètre du certificat', 'Établir un Q4 pour une installation hors périmètre ou sans N4 ni déclaration d''installation',
     'Q4 demandé sur un site sans N4 ni déclaration', 'Demander la déclaration ou faire la mise en conformité', 'FAQ CNPP R13 (transposition à confirmer)', 'secondaire', 7),
    ('apsad', 'apsad-i4nf285', 'A8', 'B0 ; NF285 (techniciens formés, responsable technique)', 'Techniciens non qualifiés ou en nombre insuffisant ; départ d''une personne qualifiée non signalé',
     'Technicien sans titre en cours de validité ; départ sans remplaçant', 'Signaler au CNPP sous un mois, remplacer sous trois', 'Référentiel B0 ; marque-nf.com', 'officiel', 8),
    ('apsad', 'apsad-i4nf285', 'A9', 'NF285', 'Pas de contrat signé, fréquences non respectées, devoir de conseil non tracé',
     'Site sans contrat actif ; visites en retard', 'Contrats dans l''outil, alertes', 'marque-nf.com', 'secondaire', 9),
    ('apsad', 'apsad-i4nf285', 'A10', 'NF285 (sous-traitants)', 'Révision en atelier sous-traitée sans contrôle', 'Révision faite par un tiers sans trace',
     'Fournisseur qualifié, bon de retour', 'marque-nf.com', 'secondaire', 10),
    ('apsad', 'apsad-i4nf285', 'A11', 'B0 (registre des réclamations)', 'Réclamations des clients de maintenance non enregistrées', 'Aucune réclamation côté maintenance',
     'Enregistrer aussi les réclamations des interventions', 'Référentiel B0 du CNPP', 'officiel', 11),
    ('apsad', 'apsad-i4nf285', 'A12', 'Contrôle des connaissances (B0) ; compétences (NF285)', 'Technicien incapable de dérouler devant l''auditeur une maintenance additionnelle ou une révision',
     'Technicien sans opération à 5 ou 10 ans réalisée depuis 12 mois', 'Mode opératoire écrit par type d''appareil ; entraînement avant l''audit', 'Référentiel B0 ; marque-nf.com', 'officiel', 12),
    ('apsad', 'apsad-i4nf285', 'A13', 'Moyens et contrôle des sous-traitants (NF285)', 'Révision en atelier impossible à montrer (ni atelier, ni outillage, ni contrat avec l''atelier)',
     'Opération « révision » sans lieu ni prestataire renseigné', 'Montrer l''atelier, ou le contrat et les bons de retour de l''atelier', 'marque-nf.com', 'secondaire', 13),
    ('qualiopi', 'rnq-2026', 'Q1', 'Indicateur 30', 'Appréciations des financeurs et des entreprises non recueillies ou non tracées',
     'Sessions terminées sans évaluation entreprise ou financeur', 'Recueillir et classer les appréciations', 'Relevé d''un certificateur (ICPF, 2024)', 'secondaire', 20),
    ('qualiopi', 'rnq-2026', 'Q2', 'Règles de la marque', 'Logo Qualiopi mal utilisé ; catégorie d''action absente à côté du logo',
     'Documents ou site sans la mention', 'Vérifier chaque support', 'ICPF ; Centre Inffo', 'secondaire', 21),
    ('qualiopi', 'rnq-2026', 'Q3', 'Communication du certificat', 'Certificat non affiché dans les locaux et sur le site, ou expiré',
     'Date de validité dépassée', 'Afficher le certificat à jour', 'Annexe II du référentiel', 'officiel', 22),
    ('qualiopi', 'rnq-2026', 'Q4', 'Indicateur 1', 'Information publique incomplète (prérequis, délais d''accès, accessibilité, tarifs)',
     'Fiche formation incomplète', 'Compléter les fiches du catalogue', 'ICPF', 'secondaire', 23),
    ('qualiopi', 'rnq-2026', 'Q5', 'Indicateur 2', 'Résultats non publiés', 'Résultats jamais publiés', 'Publier les indicateurs de résultats', 'CertiFlash', 'secondaire', 24),
    ('qualiopi', 'rnq-2026', 'Q6', 'Indicateur 8', 'Positionnement absent', 'Sessions sans positionnement', 'Faire passer le test de positionnement', 'ICPF', 'secondaire', 25),
    ('qualiopi', 'rnq-2026', 'Q7', 'Indicateur 11', 'Évaluation des acquis absente ou sans lien avec les objectifs',
     'Sessions sans évaluation des acquis', 'Suivi formatif par séquence', 'CertiFlash', 'secondaire', 26),
    ('qualiopi', 'rnq-2026', 'Q8', 'Indicateur 21', 'Compétences des formateurs non prouvées', 'Formateur sans certificat en cours', 'Classer les justificatifs des formateurs', 'CertiFlash', 'secondaire', 27),
    ('qualiopi', 'rnq-2026', 'Q9', 'Indicateurs 23 à 25', 'Veille non tracée', 'Veille vide depuis 3 mois', 'Noter la veille au fil de l''eau', 'CertiFlash', 'secondaire', 28),
    ('qualiopi', 'rnq-2026', 'Q10', 'Indicateur 26', 'Accueil du handicap non organisé (référent, registre)', 'Référent handicap vide', 'Désigner le référent, tenir le registre', 'CertiFlash', 'secondaire', 29),
    ('qualiopi', 'rnq-2026', 'Q11', 'Indicateurs 31 et 32', 'Réclamations sans procédure écrite ; amélioration continue non tracée',
     'Procédure absente ; cartographie des risques non validée', 'Écrire la procédure, valider la cartographie', 'CertiFlash ; Certiforma', 'secondaire', 30),
    ('qualiopi', 'rnq-2026', 'Q12', 'Indicateur 27', 'Sous-traitants sans traçabilité contractuelle de leur conformité',
     'Session sous-traitée sans contrat ni justificatif', 'Justificatifs des prestataires à jour', 'Certiforma', 'secondaire', 31),
    ('qualiopi', 'rnq-2026', 'Q13', 'Tous (échantillon de l''auditeur)', 'Montrer une session « vitrine » au lieu de la pratique réelle : l''auditeur choisit son échantillon',
     'Sessions terminées dont les preuves sont incomplètes', 'Rendre toutes les sessions complètes, pas seulement celles qu''on compte montrer', 'Annexe II du référentiel', 'officiel', 32),
    ('qualiopi', 'rnq-2026', 'Q14', 'Indicateurs 1, 23 à 25, 32', 'Documents créés ou modifiés juste avant l''audit, ou sans version tracée',
     'Document créé ou validé dans les 15 jours avant l''audit', 'Versions datées et validées au fil de l''eau', 'Bon sens, à confirmer avec le certificateur', 'societe', 33),
    ('qualiopi', 'rnq-2026', 'Q15', 'Indicateurs 26, 31 et entretiens', 'Personne de l''équipe incapable d''expliquer le processus qu''elle applique',
     'Référents vides ou jamais désignés', 'Désigner les référents, les faire répéter avant l''audit', 'À confirmer avec le certificateur', 'societe', 34),
    ('nda', null, 'N1', 'L6351-1, R6351-1', 'Dépôt de la déclaration après le délai de 3 mois suivant la première convention',
     'Échéance de la déclaration', 'Déposer à temps', 'code.travail.gouv.fr', 'officiel', 40),
    ('nda', null, 'N2', 'Pièces du dossier', 'Pièces datées de plus d''un mois ; convention non signée par toutes les parties ou de plus de 3 mois',
     'Pièces du dossier avec leur date', 'Refaire les pièces avant le dépôt', 'Notices des DREETS', 'officiel', 41),
    ('nda', null, 'N3', 'R6351-5', 'Lien entre les titres des formateurs et la prestation non expliqué', 'Pièce « intervenants »',
     'Expliquer le lien titre et prestation', 'code.travail.gouv.fr ; DREETS', 'officiel', 42),
    ('nda', null, 'N4b', 'L6351-6', 'Bilan pédagogique et financier non déposé ou sans activité : déclaration caduque',
     'Échéance du 30 avril', 'Déposer le BPF chaque année', 'code.travail.gouv.fr', 'officiel', 43),
    ('nda', null, 'N5', 'R6351-6, L6352-12', 'Numéro absent des conventions ; publicité sans « Cet enregistrement ne vaut pas agrément de l''État »',
     'Documents générés', 'Mentions dans les modèles', 'code.travail.gouv.fr', 'officiel', 44),
    ('nda', null, 'N6', 'R6351-8', 'Changement (adresse, dirigeant) non déclaré sous 30 jours', 'Réglages de la société modifiés', 'Déclarer le changement', 'code.travail.gouv.fr', 'officiel', 45),
    ('nda', null, 'N7', 'L6351-3', 'Première convention « de façade » pour obtenir le numéro', 'Convention sans session réalisée ni émargement',
     'Ne déclarer qu''une vraie action de formation', 'code.travail.gouv.fr', 'officiel', 46),
    ('nda', null, 'N8', 'L6351-6', 'Bilan sans activité réelle plusieurs années : numéro caduc', 'BPF prérempli depuis les sessions réalisées',
     'Garder une activité réelle déclarée', 'code.travail.gouv.fr', 'officiel', 47)
  ) as d(domaine, ref, code, exigence, erreur, reperage, action, source, st, pos)
  on conflict (company_id, domaine, code) do nothing
$$;
revoke all on function app.cert_pitfalls_depart(uuid) from public, anon, authenticated;
select app.cert_pitfalls_depart(c.id) from public.companies c;

create or replace function app.societe_referentiels_depart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.subcontractor_doc_types_depart(new.id);
  if to_regprocedure('app.obligation_rules_depart(uuid)') is not null then
    execute 'select app.obligation_rules_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.commercial_lists_depart(uuid)') is not null then
    execute 'select app.commercial_lists_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_sous_traitants_depart(uuid)') is not null then
    execute 'select app.rgpd_sous_traitants_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_purge_regles_depart(uuid)') is not null then
    execute 'select app.rgpd_purge_regles_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.cert_pitfalls_depart(uuid)') is not null then
    execute 'select app.cert_pitfalls_depart($1)' using new.id;
  end if;
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

-- ── 5. Import du texte d'un référentiel payant (APSAD…) depuis l'exemplaire de la société ──
-- Crée (ou remplace) la copie propre à la société courante : code « <source>-<8 premiers caractères de la société> »,
-- company_id posé, texte « fourni par la société ». Droits de l'appelant (security invoker) : il faut pouvoir gérer
-- la certification dans cette société. Remplacement refusé si des exigences de la copie ont déjà un suivi.
-- p_exigences : [{"chapitre": 1, "chapitre_titre": "…", "code": "5.2", "titre": "…", "texte": "…"}, …]
create or replace function public.cert_importer_texte(p_source text, p_exigences jsonb)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_co uuid := app.current_company();
  v_src public.cert_referentials;
  v_code text;
  v_n int := 0;
  e jsonb;
begin
  select * into v_src from public.cert_referentials where code = p_source and company_id is null;
  if v_src.code is null then
    raise exception 'Référentiel commun inconnu : %', p_source using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_exigences) <> 'array' or jsonb_array_length(p_exigences) = 0 then
    raise exception 'Aucune exigence à importer' using errcode = '22023';
  end if;
  if jsonb_array_length(p_exigences) > 2000 then
    raise exception 'Trop d''exigences (2000 au plus)' using errcode = '22023';
  end if;
  v_code := p_source || '-' || substr(replace(v_co::text, '-', ''), 1, 8);
  if exists (select 1 from public.cert_indicator_status where referential_code = v_code) then
    raise exception 'Des exigences importées ont déjà un suivi : remplacement refusé' using errcode = '23503';
  end if;
  delete from public.cert_indicators where referential_code = v_code;
  delete from public.cert_criteria where referential_code = v_code;
  insert into public.cert_referentials (code, label, legal_ref, source_url, notes, sort_order, kind, issuer, text_source, company_id)
  values (v_code, v_src.label || ' (texte de la société)', v_src.legal_ref, v_src.source_url,
          'Copie propre à la société, importée depuis son exemplaire le ' || to_char(current_date, 'DD/MM/YYYY') || '.',
          v_src.sort_order + 1, v_src.kind, v_src.issuer, 'societe', v_co)
  on conflict (code) do update set notes = excluded.notes, text_source = 'societe';

  insert into public.cert_criteria (referential_code, number, title, code)
  select distinct on (c) v_code, c, coalesce(nullif(t, ''), 'Chapitre ' || c), nullif(k, '')
  from (select (x ->> 'chapitre')::int as c, x ->> 'chapitre_titre' as t, x ->> 'chapitre_code' as k
        from jsonb_array_elements(p_exigences) x) s
  where c is not null
  order by c, t nulls last;

  for e in select * from jsonb_array_elements(p_exigences) loop
    v_n := v_n + 1;
    insert into public.cert_indicators (referential_code, number, criterion, short_title, text, code, imported_from)
    values (v_code, v_n, (e ->> 'chapitre')::int,
            left(coalesce(nullif(e ->> 'titre', ''), e ->> 'texte'), 200),
            coalesce(nullif(e ->> 'texte', ''), e ->> 'titre'),
            nullif(e ->> 'code', ''), p_source);
  end loop;
  return v_code;
end
$$;
revoke all on function public.cert_importer_texte(text, jsonb) from public, anon;
grant execute on function public.cert_importer_texte(text, jsonb) to authenticated;

-- ── Droits des tables ──
alter table public.cert_company_certifications enable row level security;
alter table public.cert_pitfalls enable row level security;
revoke all on table public.cert_company_certifications, public.cert_pitfalls from public, anon;
grant select, insert, update, delete on table public.cert_company_certifications, public.cert_pitfalls to authenticated;
grant all on table public.cert_company_certifications, public.cert_pitfalls to service_role;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0350')) ──

-- Pose des règles d'une liste de tables : une règle par action, garde du module ajoutée ici.
-- Lecture : module actif, ou super administrateur. Écriture : module actif.
create or replace function pg_temp.regles(p_tables text[], p_module text, p_sel text, p_ins text, p_upd text, p_del text)
returns void
language plpgsql
as $f$
declare
  t text;
  v_on text;
  v_sel text := p_sel; v_ins text := p_ins; v_upd text := p_upd; v_del text := p_del;
begin
  if p_module is not null then
    select '(' || string_agg(format('(select app.module_on(%L))', m), ' or ') || ')' into v_on
    from unnest(string_to_array(p_module, '|')) m;
    if v_sel is not null then v_sel := format('((%s and %s) or (select app.is_superadmin()))', v_on, v_sel); end if;
    if v_ins is not null then v_ins := format('(%s and %s)', v_on, v_ins); end if;
    if v_upd is not null then v_upd := format('(%s and %s)', v_on, v_upd); end if;
    if v_del is not null then v_del := format('(%s and %s)', v_on, v_del); end if;
  end if;
  foreach t in array p_tables loop
    execute format('alter table public.%I enable row level security', t);
    if v_sel is not null then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_lire', t, v_sel);
    end if;
    if v_ins is not null then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_creer', t, v_ins);
    end if;
    if v_upd is not null then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_modifier', t, v_upd, v_upd);
    end if;
    if v_del is not null then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_supprimer', t, v_del);
    end if;
  end loop;
end
$f$;

-- Suppression des règles nommées du générateur (lire, créer, modifier, supprimer) ; les autres règles
-- (règle restrictive des notifications de 0070, etc.) ne sont pas touchées
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['cert_company_certifications', 'cert_pitfalls'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- cert_company_certifications
select pg_temp.regles(array['cert_company_certifications'], null,
  $r$company_id in (select app.societes_avec_droit('qualite.certification.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('qualite.certification.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('qualite.certification.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('qualite.certification.gerer'))$r$);

-- cert_pitfalls
select pg_temp.regles(array['cert_pitfalls'], null,
  $r$company_id in (select app.societes_avec_droit('manager.cockpit.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('manager.cockpit.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('manager.cockpit.voir'))$r$,
  $r$company_id in (select app.societes_avec_droit('manager.cockpit.voir'))$r$);

do $$
declare t text;
begin
  foreach t in array array['cert_company_certifications', 'cert_pitfalls'] loop
    execute format('drop policy if exists %I on public.%I', t || '_societe_lire', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_creer', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_modifier', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_supprimer', t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (company_id in (select app.societes_lisibles()))', t || '_societe_lire', t);
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (company_id in (select app.societes_ecriture()))', t || '_societe_creer', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()))', t || '_societe_modifier', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using (company_id in (select app.societes_ecriture()))', t || '_societe_supprimer', t);
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0350_certifications_generiques') on conflict (version) do nothing;

-- ===== supabase/rollback/0350_certifications_generiques_retour.sql =====
-- Retour arrière de 0350_certifications_generiques.sql : retire les certifications de la société, la face interne,
-- les colonnes génériques des référentiels et le squelette APSAD. Idempotent.
-- Refusé si une société a créé son propre référentiel ou importé des exigences APSAD : sans la colonne company_id, ces
-- lignes deviendraient lisibles par toutes les sociétés.

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cert_referentials' and column_name = 'company_id')
     and exists (select 1 from public.cert_referentials where company_id is not null) then
    raise exception 'Retour arrière refusé : des référentiels appartiennent à une société (à exporter puis supprimer d''abord)';
  end if;
  if exists (select 1 from public.cert_criteria where referential_code = 'apsad-i4nf285')
     or exists (select 1 from public.cert_indicators where referential_code = 'apsad-i4nf285') then
    raise exception 'Retour arrière refusé : des exigences APSAD ont été importées';
  end if;
end $$;

-- Départ d'une nouvelle société : version de 0344
create or replace function app.societe_referentiels_depart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.subcontractor_doc_types_depart(new.id);
  if to_regprocedure('app.obligation_rules_depart(uuid)') is not null then
    execute 'select app.obligation_rules_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.commercial_lists_depart(uuid)') is not null then
    execute 'select app.commercial_lists_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_sous_traitants_depart(uuid)') is not null then
    execute 'select app.rgpd_sous_traitants_depart($1)' using new.id;
  end if;
  if to_regprocedure('app.rgpd_purge_regles_depart(uuid)') is not null then
    execute 'select app.rgpd_purge_regles_depart($1)' using new.id;
  end if;
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

drop function if exists public.cert_importer_texte(text, jsonb);
drop function if exists app.cert_pitfalls_depart(uuid);
drop table if exists public.cert_pitfalls;
drop function if exists app.cert_valid(uuid, text);
drop table if exists public.cert_company_certifications;
drop function if exists app.cert_maj();

do $$
declare t text;
begin
  foreach t in array array['cert_referentials', 'cert_criteria', 'cert_indicators'] loop
    execute format('drop policy if exists %I on public.%I', t || '_societe_lire', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_creer', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_modifier', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_supprimer', t);
  end loop;
end $$;
drop function if exists app.cert_ref_lisible(text);
drop function if exists app.cert_ref_ecriture(text);

delete from public.cert_referentials where code = 'apsad-i4nf285';
alter table public.cert_indicators drop column if exists imported_from;
alter table public.cert_indicators drop column if exists code;
alter table public.cert_criteria drop column if exists code;
alter table public.cert_referentials drop constraint if exists cert_referentials_kind_check;
alter table public.cert_referentials drop constraint if exists cert_referentials_text_source_check;
alter table public.cert_referentials drop column if exists company_id;
alter table public.cert_referentials drop column if exists text_source;
alter table public.cert_referentials drop column if exists issuer;
alter table public.cert_referentials drop column if exists kind;

delete from public.schema_migrations where version = '0350_certifications_generiques';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE f_0350 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;

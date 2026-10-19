-- 0340_conformite_rgpd.sql : chantier F phase 2, module « Conformité RGPD » (registre, sous-traitants, demandes des
-- personnes, violations, preuves d'information, analyses d'impact), tenu par société.
--
-- Spec : odet-conformite-rgpd-certifications.md § 4 et 5.1, 5.3 à 5.6, 5.11 (validée par H le 17/10 à 9h58).
-- 1. rgpd_traitements (table existante, registre unique) : modèle d'origine, statut (à revoir, validé, archivé),
--    article de la base légale, données sensibles, sous-traitants, garanties de transfert, contact interne, AIPD,
--    validation. Les 6 lignes héritées (3 doublons, « Sellsy », nom écrit en dur) sont archivées, jamais supprimées.
-- 2. Traitements modèles par module (fonction app.rgpd_traitements_depart) proposés « à revoir » dans chaque
--    société pour ses modules actifs ; la société les valide, les modifie ou les archive.
-- 3. rgpd_sous_traitants : services réellement appelés par l'outil (clé technique), pays, hébergement, garantie de
--    transfert, contrat ; posés pour chaque société, à compléter (date de signature, document).
-- 4. rgpd_demandes : demandes des personnes, échéance d'un mois calculée par la base (trois mois si prolongée).
-- 5. rgpd_violations : registre des violations, échéance de notification à 72 h calculée par la base ; toute
--    violation est inscrite, même non notifiée (art. 33.5).
-- 6. rgpd_informations (preuves d'information) et rgpd_aipd (analyses d'impact).
-- 7. Module « rgpd » (org_modules), actif si le module qualité l'est.
-- Droits (catalogue C1b, déjà posé) : conformite.rgpd.gerer (registre, sous-traitants, informations, AIPD),
-- conformite.demandes.gerer, conformite.violations.gerer. Le registre lui-même garde ses règles (qualite.registres.*).
-- Tables : company_id, règles par droits (build_suite('0340')) et isolement par société.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0340_conformite_rgpd_retour.sql

-- ── 1. Registre : colonnes ajoutées ──
alter table public.rgpd_traitements alter column duree_conservation type text;
alter table public.rgpd_traitements alter column base_legale type text;
alter table public.rgpd_traitements add column if not exists modele_cle text;
alter table public.rgpd_traitements add column if not exists modele_version int;
alter table public.rgpd_traitements add column if not exists module text;
alter table public.rgpd_traitements add column if not exists origine text not null default 'saisie';
alter table public.rgpd_traitements add column if not exists statut text not null default 'a_revoir';
alter table public.rgpd_traitements add column if not exists base_legale_article text;
alter table public.rgpd_traitements add column if not exists donnees_sensibles text[] not null default '{}';
alter table public.rgpd_traitements add column if not exists sous_traitants text[] not null default '{}';
alter table public.rgpd_traitements add column if not exists garanties_transfert text;
alter table public.rgpd_traitements add column if not exists contact_interne_id uuid references public.profiles(id) on delete set null;
alter table public.rgpd_traitements add column if not exists aipd text;
alter table public.rgpd_traitements add column if not exists valide_par uuid references public.profiles(id) on delete set null;
alter table public.rgpd_traitements add column if not exists valide_le timestamptz;
alter table public.rgpd_traitements add column if not exists revue_le date;
alter table public.rgpd_traitements add column if not exists notes text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rgpd_traitements_statut_check') then
    alter table public.rgpd_traitements add constraint rgpd_traitements_statut_check check (statut in ('a_revoir', 'valide', 'archive'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rgpd_traitements_origine_check') then
    alter table public.rgpd_traitements add constraint rgpd_traitements_origine_check check (origine in ('modele', 'saisie', 'reprise'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rgpd_traitements_aipd_check') then
    alter table public.rgpd_traitements add constraint rgpd_traitements_aipd_check check (aipd is null or aipd in ('requise', 'recommandee', 'non_requise'));
  end if;
end $$;
create unique index if not exists rgpd_traitements_modele on public.rgpd_traitements (company_id, modele_cle) where modele_cle is not null;
comment on column public.rgpd_traitements.statut is 'à revoir (proposé par un modèle ou repris), validé (par la société), archivé';

-- Validation tracée par la base ; le responsable du traitement est la société (personne morale), jamais un nom
create or replace function app.rgpd_traitements_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id; new.created_at := old.created_at;
    new.modele_cle := old.modele_cle; new.origine := old.origine;
  end if;
  if new.statut = 'valide' and (tg_op = 'INSERT' or old.statut is distinct from 'valide') then
    new.valide_par := (select auth.uid()); new.valide_le := now(); new.revue_le := current_date;
  end if;
  if new.statut <> 'valide' then new.valide_par := null; new.valide_le := null; end if;
  new.actif := new.statut <> 'archive';
  new.date_mise_a_jour := current_date;
  return new;
end
$$;
revoke all on function app.rgpd_traitements_maj() from public, anon, authenticated;
drop trigger if exists rgpd_traitements_maj on public.rgpd_traitements;
create trigger rgpd_traitements_maj before insert or update on public.rgpd_traitements
  for each row execute function app.rgpd_traitements_maj();

-- Reprise des lignes héritées : archivées (doublons, mentions d'un autre outil, nom écrit en dur), jamais supprimées ;
-- seules les nouvelles colonnes changent (le retour arrière les retire, les lignes reviennent à l'identique)
alter table public.rgpd_traitements disable trigger rgpd_traitements_maj;
update public.rgpd_traitements
   set origine = 'reprise', statut = 'archive',
       notes = concat_ws(' ', nullif(notes, ''), 'Ligne reprise de l''outil précédent, archivée le ' || to_char(current_date, 'DD/MM/YYYY') || ' : remplacée par les traitements modèles du registre.')
 where modele_cle is null and origine = 'saisie' and statut = 'a_revoir' and created_at < now() - interval '1 minute';
alter table public.rgpd_traitements enable trigger rgpd_traitements_maj;

-- ── 2. Sous-traitants ──
create table if not exists public.rgpd_sous_traitants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  cle text not null,
  nom text not null,
  role text,
  pays_siege text,
  hebergement text,
  transfert text not null default 'aucun' check (transfert in ('aucun', 'adequation', 'dpf', 'clauses_types', 'a_verifier')),
  dpa_url text,
  contrat_signe_le date,
  document_url text,
  notes text,
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, cle)
);
comment on table public.rgpd_sous_traitants is 'Sous-traitants (art. 28) appelés par l''outil ou ajoutés par la société ; contrat et garantie de transfert';

-- ── 3. Demandes des personnes ──
create table if not exists public.rgpd_demandes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  personne_type text not null default 'autre' check (personne_type in ('stagiaire', 'contact', 'prospect', 'salarie', 'formateur', 'autre')),
  personne_id uuid,
  nom text not null,
  email text,
  canal text,
  droit text not null check (droit in ('acces', 'rectification', 'effacement', 'limitation', 'opposition', 'portabilite')),
  recue_le date not null default current_date,
  identite_verifiee text,
  prolongee boolean not null default false,
  prolongation_motif text,
  personne_prevenue_le date,
  echeance date,
  statut text not null default 'recue' check (statut in ('recue', 'en_cours', 'repondue', 'refusee')),
  actions text,
  reponse_le date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rgpd_demandes_prolongation check (not prolongee or (nullif(btrim(coalesce(prolongation_motif, '')), '') is not null))
);
create index if not exists rgpd_demandes_echeance_idx on public.rgpd_demandes (company_id, statut, echeance);
comment on table public.rgpd_demandes is 'Demandes des personnes (art. 12 à 22) : réponse sous un mois, trois mois au plus si prolongée avec motif';

-- ── 4. Violations ──
create table if not exists public.rgpd_violations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  decouverte_le timestamptz not null default now(),
  decouverte_par text,
  nature text[] not null default '{}',
  description text not null,
  categories text,
  personnes_nb int,
  lignes_nb int,
  consequences text,
  mesures text,
  risque text check (risque is null or risque in ('aucun', 'risque', 'eleve')),
  risque_justification text,
  echeance_notification timestamptz,
  notifiee_le timestamptz,
  numero_notification text,
  complement_le timestamptz,
  personnes_informees_le timestamptz,
  moyen_information text,
  motif_non_notification text,
  statut text not null default 'ouverte' check (statut in ('ouverte', 'close')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rgpd_violations_nature check (nature <@ array['confidentialite', 'integrite', 'disponibilite'])
);
create index if not exists rgpd_violations_ouvertes_idx on public.rgpd_violations (company_id, statut, echeance_notification);
comment on table public.rgpd_violations is 'Registre des violations (art. 33.5) : notification à la CNIL sous 72 h si risque, toute violation inscrite';

-- ── 5. Preuves d'information et analyses d'impact ──
create table if not exists public.rgpd_informations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  traitement_id uuid references public.rgpd_traitements(id) on delete set null,
  notice_titre text not null,
  notice_version text,
  destinataires text,
  remise_le date not null default current_date,
  mode text not null default 'email' check (mode in ('main_propre', 'email', 'affichage', 'portail', 'courrier', 'autre')),
  preuve_url text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.rgpd_informations is 'Preuves d''information des personnes (notice, date, mode, preuve)';

create table if not exists public.rgpd_aipd (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id),
  traitement_id uuid references public.rgpd_traitements(id) on delete set null,
  titre text not null,
  criteres text[] not null default '{}',
  conclusion text check (conclusion is null or conclusion in ('requise', 'recommandee', 'non_requise')),
  justification text,
  description text,
  necessite text,
  risques text,
  mesures text,
  avis text,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'validee')),
  validee_par uuid references public.profiles(id) on delete set null,
  validee_le timestamptz,
  revision_le date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.rgpd_aipd is 'Analyses d''impact (art. 35) : critères du CEPD cochés, conclusion, mesures, validation';

-- Tenue commune : société reprise du traitement lié, dates de création figées, échéances calculées par la base
create or replace function app.rgpd_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tr uuid;
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id; new.created_at := old.created_at;
  end if;
  if tg_table_name in ('rgpd_informations', 'rgpd_aipd') then
    v_tr := (to_jsonb(new) ->> 'traitement_id')::uuid;
    if v_tr is not null and tg_op = 'INSERT' then
      new.company_id := coalesce((select t.company_id from public.rgpd_traitements t where t.id = v_tr), new.company_id);
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function app.rgpd_maj() from public, anon, authenticated;

create or replace function app.rgpd_demandes_echeance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.echeance := (new.recue_le + case when new.prolongee then interval '3 months' else interval '1 month' end)::date;
  if new.statut in ('repondue', 'refusee') and new.reponse_le is null then new.reponse_le := current_date; end if;
  return new;
end
$$;
revoke all on function app.rgpd_demandes_echeance() from public, anon, authenticated;

create or replace function app.rgpd_violations_echeance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.echeance_notification := new.decouverte_le + interval '72 hours';
  return new;
end
$$;
revoke all on function app.rgpd_violations_echeance() from public, anon, authenticated;

create or replace function app.rgpd_aipd_validation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.statut = 'validee' and (tg_op = 'INSERT' or old.statut is distinct from 'validee') then
    new.validee_par := (select auth.uid()); new.validee_le := now();
  elsif new.statut <> 'validee' then
    new.validee_par := null; new.validee_le := null;
  end if;
  return new;
end
$$;
revoke all on function app.rgpd_aipd_validation() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['rgpd_sous_traitants', 'rgpd_demandes', 'rgpd_violations', 'rgpd_informations', 'rgpd_aipd'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_maj', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.rgpd_maj()', t || '_maj', t);
  end loop;
end $$;
drop trigger if exists rgpd_demandes_echeance on public.rgpd_demandes;
create trigger rgpd_demandes_echeance before insert or update on public.rgpd_demandes
  for each row execute function app.rgpd_demandes_echeance();
drop trigger if exists rgpd_violations_echeance on public.rgpd_violations;
create trigger rgpd_violations_echeance before insert or update of decouverte_le on public.rgpd_violations
  for each row execute function app.rgpd_violations_echeance();
drop trigger if exists rgpd_aipd_validation on public.rgpd_aipd;
create trigger rgpd_aipd_validation before insert or update on public.rgpd_aipd
  for each row execute function app.rgpd_aipd_validation();

-- ── 6. Départ d'une société : sous-traitants et traitements modèles des modules actifs ──
create or replace function app.rgpd_sous_traitants_depart(p_company uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.rgpd_sous_traitants (company_id, cle, nom, role, pays_siege, hebergement, transfert, dpa_url, notes)
  select p_company, d.cle, d.nom, d.role, d.pays, d.heb, d.transfert, d.dpa, d.notes
  from (values
    ('supabase', 'Supabase', 'Base de données, authentification, stockage, tâches planifiées', 'Singapour (Supabase Pte. Ltd.)', 'Paris (eu-west-3)', 'clauses_types', 'https://supabase.com/legal/dpa', 'Accord de traitement intégré aux conditions ; sous-traitants ultérieurs avec préavis'),
    ('vercel', 'Vercel', 'Hébergement de l''application et des fonctions serveur', 'États-Unis', 'Paris (cdg1) pour les fonctions', 'dpf', 'https://vercel.com/legal/dpa', null),
    ('anthropic', 'Anthropic', 'Intelligence artificielle (rédaction, lecture de documents) quand elle est utilisée', 'États-Unis', 'États-Unis', 'clauses_types', 'https://www.anthropic.com/legal/data-processing-addendum', 'Seulement si des fonctions d''IA sont activées'),
    ('messagerie', 'Messagerie de la société', 'Envoi et copie des emails', 'France (à préciser selon le fournisseur)', 'à préciser', 'a_verifier', null, 'Contrat du fournisseur de messagerie choisi par la société'),
    ('google', 'Google', 'Agenda et fiche d''établissement, si connectés', 'États-Unis', 'à préciser', 'dpf', null, 'Seulement si la synchronisation d''agenda ou la publication est activée'),
    ('osm', 'OpenStreetMap (tuiles de carte)', 'Affichage des cartes (adresse IP de l''utilisateur)', 'Royaume-Uni', 'Royaume-Uni', 'adequation', null, null)
  ) as d(cle, nom, role, pays, heb, transfert, dpa, notes)
  on conflict (company_id, cle) do nothing
$$;
revoke all on function app.rgpd_sous_traitants_depart(uuid) from public, anon, authenticated;

create or replace function app.rgpd_traitements_depart(p_company uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  insert into public.rgpd_traitements (company_id, modele_cle, modele_version, module, origine, statut, nom_traitement, finalite,
    base_legale, base_legale_article, categories_personnes, categories_donnees, donnees_sensibles, destinataires,
    sous_traitants, transfert_hors_ue, duree_conservation, mesures_securite, aipd)
  select p_company, m.cle, 1, m.module, 'modele', 'a_revoir', m.nom, m.finalite, m.base, m.art, m.personnes, m.donnees,
         m.sensibles, m.destinataires, m.st, m.hors_ue, m.duree, m.mesures, m.aipd
  from (values
    ('formation.stagiaires', 'formation', 'Gestion des stagiaires et des sessions de formation',
     'Organiser les formations, convoquer, émarger, évaluer, délivrer attestations et certificats, répondre aux financeurs',
     'Contrat ; obligation légale', 'Art. 6.1.b et 6.1.c ; code du travail L6353-1 et suivants, L6362-6',
     array['Stagiaires', 'Contacts des entreprises clientes'], array['Identité', 'Coordonnées', 'Emploi', 'Présence et signatures', 'Évaluations et résultats'],
     array['Handicap (besoins d''adaptation)'], array['Formateurs', 'Entreprise cliente', 'Financeurs'], array['supabase', 'vercel', 'messagerie'], false,
     'Dossier : 5 ans après la dernière session ; preuves de réalisation : 6 ans après la clôture de l''exercice ; handicap : fin de session plus 1 an',
     'Accès par rôle et par société ; handicap réservé à la direction et au référent ; journal d''audit', 'non_requise'),
    ('passeport.declarations', 'passeport', 'Passeport de prévention',
     'Déclarer les formations santé et sécurité au Passeport de prévention',
     'Obligation légale', 'Art. 6.1.c ; code du travail L4141-5 ; décret 2023-1073 (NIR)',
     array['Stagiaires'], array['Identité', 'Formations suivies'], array['Numéro de sécurité sociale (chiffré)'],
     array['Portail du Passeport de prévention'], array['supabase', 'vercel'], false,
     'Numéro de sécurité sociale effacé à l''accusé de réception en succès ; déclarations : délai de contestation',
     'Numéro chiffré, masqué à l''écran (3 derniers caractères), jamais dans les journaux', 'non_requise'),
    ('formation.formateurs', 'formation', 'Formateurs',
     'Gérer les formateurs internes et externes, leurs qualifications et leurs interventions',
     'Contrat ; obligation Qualiopi', 'Art. 6.1.b et 6.1.c',
     array['Formateurs'], array['Identité', 'Coordonnées', 'Qualifications et certificats', 'Signature', 'Tarifs'], '{}'::text[],
     array['Direction'], array['supabase', 'vercel'], false,
     'Durée de la collaboration plus 5 ans', 'Accès par rôle ; signatures en liens signés', 'non_requise'),
    ('commercial.clients', 'commercial', 'Clients, devis et facturation',
     'Gérer la relation client, établir devis et factures, suivre les paiements',
     'Contrat ; obligation légale (comptabilité)', 'Art. 6.1.b et 6.1.c ; code de commerce L123-22',
     array['Contacts des clients', 'Clients particuliers'], array['Identité', 'Coordonnées', 'Fonction', 'Devis, factures, paiements', 'Signature électronique'], '{}'::text[],
     array['Expert-comptable'], array['supabase', 'vercel', 'messagerie'], false,
     'Relation plus 3 ans ; pièces comptables 10 ans', 'Accès par rôle ; factures émises figées', 'non_requise'),
    ('commercial.affaires', 'affaires', 'Suivi commercial (affaires, échanges, appels)',
     'Suivre les affaires, noter les échanges, relancer les clients sur leurs échéances',
     'Intérêt légitime', 'Art. 6.1.f',
     array['Contacts des clients et des prospects'], array['Identité', 'Coordonnées', 'Échanges', 'Opposition'], '{}'::text[],
     array['Équipe commerciale'], array['supabase', 'vercel'], false,
     'Prospect : 3 ans après le dernier contact venant de lui ; client : relation plus 3 ans ; liste d''opposition conservée',
     'Accès par rôle ; opposition par canal respectée', 'non_requise'),
    ('prospection.base', 'prospection', 'Prospection et campagnes',
     'Identifier des entreprises à démarcher, les appeler et leur écrire',
     'Intérêt légitime (prospection B2B)', 'Art. 6.1.f ; information art. 14',
     array['Dirigeants et contacts d''entreprises'], array['Identité', 'Coordonnées professionnelles', 'Notes d''appel', 'Scores'], '{}'::text[],
     array['Équipe commerciale'], array['supabase', 'vercel', 'messagerie'], false,
     '3 ans après le dernier contact venant du prospect ; liste d''opposition conservée',
     'Origine des données et lien d''opposition dans chaque email ; analyse d''impact recommandée', 'recommandee'),
    ('interventions.maintenance', 'interventions', 'Maintenance incendie',
     'Planifier et réaliser les visites, établir les rapports et le registre de sécurité des clients',
     'Contrat ; obligation légale du client', 'Art. 6.1.b ; code du travail R4224-17, R4227-39',
     array['Contacts des sites', 'Techniciens'], array['Identité', 'Signature du client', 'Photos de visite', 'Horaires'], '{}'::text[],
     array['Client'], array['supabase', 'vercel', 'osm'], false,
     'Rapports et registre : 5 ans après la fin du contrat ; photos : 1 an après la visite',
     'Bucket privé ; prix cachés au technicien', 'non_requise'),
    ('qualite.reclamations', 'qualite', 'Qualité et réclamations',
     'Traiter les réclamations et les non-conformités, améliorer le service',
     'Obligation (Qualiopi indicateur 31) ; intérêt légitime', 'Art. 6.1.c et 6.1.f',
     array['Réclamants', 'Stagiaires', 'Entreprises'], array['Identité', 'Coordonnées', 'Récit'], '{}'::text[],
     array['Direction', 'Référents'], array['supabase', 'vercel'], false,
     'Clôture plus 3 ans', 'Accès par rôle', 'non_requise'),
    ('plateforme.comptes', null, 'Comptes et journaux de l''application',
     'Donner accès à l''application, sécuriser et tracer les actions sensibles',
     'Intérêt légitime (sécurité)', 'Art. 6.1.f ; art. 32',
     array['Utilisateurs internes'], array['Email', 'Rôle', 'Journal d''audit', 'Préférences'], '{}'::text[],
     array['Administrateur'], array['supabase', 'vercel'], false,
     'Compte : jusqu''à désactivation plus 1 an ; journal : 1 an',
     'Comptes désactivés au départ ; journal écrit par la base', 'non_requise'),
    ('plateforme.messagerie', null, 'Emails envoyés depuis l''application',
     'Envoyer convocations, devis, factures et documents ; garder une copie',
     'Selon l''objet du message (contrat, obligation légale)', 'Art. 6.1.b et 6.1.c',
     array['Destinataires des emails'], array['Adresses', 'Objets', 'Contenus', 'Pièces jointes'], '{}'::text[],
     array['Fournisseur de messagerie'], array['messagerie', 'supabase', 'vercel'], false,
     '3 ans', 'Comptes d''envoi personnels ; copie cachée vers l''adresse de la société', 'non_requise'),
    ('finance.budget', 'finance', 'Budget et banque',
     'Suivre les dépenses et recettes, préparer la comptabilité',
     'Obligation légale ; intérêt légitime', 'Art. 6.1.c et 6.1.f',
     array['Associés', 'Salariés', 'Tiers figurant sur les relevés'], array['Relevés bancaires', 'Justificatifs'], '{}'::text[],
     array['Expert-comptable'], array['supabase', 'vercel'], false,
     '10 ans (pièces comptables)', 'Buckets privés ; accès finance', 'non_requise'),
    ('social.publications', 'social', 'Réseaux sociaux',
     'Publier des contenus sur les pages de la société',
     'Intérêt légitime (communication)', 'Art. 6.1.f ; droit à l''image',
     array['Personnes visibles sur les visuels'], array['Images', 'Textes'], '{}'::text[],
     array['Plateformes de publication'], array['supabase', 'vercel', 'google'], true,
     'Durée de la publication', 'Accord des personnes photographiées', 'non_requise'),
    ('duerp.evaluations', 'duerp', 'Document unique (DUERP) réalisé pour les clients',
     'Évaluer les risques professionnels des clients et rédiger leur document unique',
     'Contrat', 'Art. 6.1.b',
     array['Salariés des clients'], array['Participants', 'Situations de travail', 'Photos'], '{}'::text[],
     array['Client'], array['supabase', 'vercel'], false,
     'Durée du contrat plus 5 ans', 'Accès par rôle', 'non_requise'),
    ('portail.acces', 'portail', 'Portails stagiaire et entreprise',
     'Donner accès aux documents et à l''émargement',
     'Contrat ; intérêt légitime (sécurité)', 'Art. 6.1.b et 6.1.f',
     array['Stagiaires', 'Contacts des entreprises'], array['Code d''accès', 'Tentatives', 'Dernier accès', 'Téléchargements'], '{}'::text[],
     array['Aucun'], array['supabase', 'vercel'], false,
     'Traces d''accès : 6 mois après la session', 'Codes limités en tentatives ; liens signés', 'non_requise')
  ) as m(cle, module, nom, finalite, base, art, personnes, donnees, sensibles, destinataires, st, hors_ue, duree, mesures, aipd)
  where m.module is null
     or exists (select 1 from public.company_modules cm where cm.company_id = p_company and cm.key = m.module and cm.enabled)
  on conflict (company_id, modele_cle) where modele_cle is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function app.rgpd_traitements_depart(uuid) from public, anon, authenticated;

-- Proposer les modèles d'un module activé plus tard (bouton « Mettre à jour depuis les modules » du registre)
create or replace function public.rgpd_proposer_modeles()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.current_company();
begin
  if v_company is null or not app.a_le_droit('conformite.rgpd.gerer') then
    raise exception 'Droit « Tenir le registre RGPD » requis' using errcode = '42501';
  end if;
  perform app.rgpd_sous_traitants_depart(v_company);
  return app.rgpd_traitements_depart(v_company);
end
$$;
revoke all on function public.rgpd_proposer_modeles() from public, anon;
grant execute on function public.rgpd_proposer_modeles() to authenticated;

select app.rgpd_sous_traitants_depart(c.id), app.rgpd_traitements_depart(c.id) from public.companies c;

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
  return null;
end
$$;
revoke all on function app.societe_referentiels_depart() from public, anon, authenticated;

-- ── Droits des tables ──
alter table public.rgpd_sous_traitants enable row level security;
alter table public.rgpd_demandes enable row level security;
alter table public.rgpd_violations enable row level security;
alter table public.rgpd_informations enable row level security;
alter table public.rgpd_aipd enable row level security;
revoke all on table public.rgpd_sous_traitants, public.rgpd_demandes, public.rgpd_violations, public.rgpd_informations, public.rgpd_aipd from public, anon;
grant select, insert, update, delete on table public.rgpd_sous_traitants, public.rgpd_demandes, public.rgpd_violations, public.rgpd_informations, public.rgpd_aipd to authenticated;
grant all on table public.rgpd_sous_traitants, public.rgpd_demandes, public.rgpd_violations, public.rgpd_informations, public.rgpd_aipd to service_role;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0340')) ──

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
           where schemaname = 'public' and tablename = any (array['rgpd_aipd', 'rgpd_demandes', 'rgpd_informations', 'rgpd_sous_traitants', 'rgpd_violations'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- rgpd_aipd, rgpd_informations, rgpd_sous_traitants
select pg_temp.regles(array['rgpd_aipd', 'rgpd_informations', 'rgpd_sous_traitants'], null,
  $r$company_id in (select app.societes_avec_droit('conformite.rgpd.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('conformite.rgpd.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('conformite.rgpd.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('conformite.rgpd.gerer'))$r$);

-- rgpd_demandes
select pg_temp.regles(array['rgpd_demandes'], null,
  $r$company_id in (select app.societes_avec_droit('conformite.demandes.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('conformite.demandes.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('conformite.demandes.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('conformite.demandes.gerer'))$r$);

-- rgpd_violations
select pg_temp.regles(array['rgpd_violations'], null,
  $r$company_id in (select app.societes_avec_droit('conformite.violations.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('conformite.violations.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('conformite.violations.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('conformite.violations.gerer'))$r$);

do $$
declare t text;
begin
  foreach t in array array['rgpd_sous_traitants', 'rgpd_demandes', 'rgpd_violations', 'rgpd_informations', 'rgpd_aipd'] loop
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

-- ── 7. Module ──
insert into public.org_modules (key, label, enabled, position, description)
select 'rgpd', 'Conformité RGPD',
       coalesce((select enabled from public.org_modules where key = 'qualite'), false), 135,
       'Registre des traitements par société (pré-rempli depuis les modules actifs), sous-traitants, demandes des personnes (un mois), violations (72 h), preuves d''information, analyses d''impact'
on conflict (key) do nothing;

insert into public.schema_migrations (version) values ('0340_conformite_rgpd') on conflict (version) do nothing;

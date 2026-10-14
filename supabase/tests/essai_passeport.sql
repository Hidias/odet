-- Essai du module Passeport de prévention en transaction annulée : migration 0190 + seed de mise en route + contrôles.
-- À coller en une fois dans l'éditeur SQL de Supabase. Se termine TOUJOURS par une erreur volontaire « RESULTAT ESSAI PASSEPORT : ... » :
-- tout est annulé, rien n'est enregistré. Attendu : tables=8 module=true formations_reglees=12 regles_pp_nir=0 anon_lit_nir=false
-- connecte_lit_nir=false refus=(environ 180) inscriptions_superadmin=(plus de 0) nir_illisible=OK lecture_refusee=OK

-- 0190_passeport_prevention.sql : module « Passeport de prévention » (déclarations ADF et JDR de l'organisme).
--
-- Migration additive : aucune colonne, règle ni fonction existante n'est modifiée. Rejouable sans effet.
-- Retour arrière : supabase/rollback/0190_passeport_retour.sql
--
-- 1. Module « passeport » (org_modules), distinct du module « prevention » (SST, cartes, notices).
-- 2. pp_format_versions : format officiel versionné (contrat d'interface), délais, catégories, causes de rejet,
--    sources. Un changement du portail officiel = une nouvelle version, jamais une modification du code.
-- 3. pp_presets : valeurs proposées d'après les fiches officielles (préremplissage des réglages).
-- 4. pp_course_settings : réglages Passeport par formation du catalogue.
-- 5. trainees : nom de naissance et date de confirmation (le refus reste la colonne existante refused_ssn).
-- 6. pp_nir : numéro chiffré par le serveur (clé ENCRYPTION_KEY, jamais en base). Règles actives sans aucune
--    autorisation : ni anon, ni compte connecté ne lisent ni n'écrivent ; seul le serveur (service role) y accède.
-- 7. pp_lignes (une par inscription et par type), pp_envois (une par tentative, identifiants uniques à vie),
--    pp_fichiers (fichiers préparés, sans contenu), pp_accuses (accusés importés, sans contenu).
-- 8. Fonctions : pp_can(), pp_nir_etat(), pp_donnees(), pp_enregistrer_nom(), pp_enregistrer_refus(),
--    pp_nir_encore_utile(), pp_import_accuse(), pp_marquer_fichier().
-- 9. Démonstration : fichiers et accusés inscrits dans demo_records disparaissent avec la purge ; les autres
--    lignes pp_* portent session_id ou trainee_id et sont déjà effacées par purge_demo_data().
--
-- Droits : superadmin, admin, direction, gestionnaire, module actif. Module coupé : lecture du superadmin seulement.

-- ── 1. Module ──
insert into public.org_modules (key, label, enabled, position, description)
values ('passeport', 'Passeport de prévention', false, 35,
        'Déclarations des formations santé et sécurité au Passeport de prévention : collecte, contrôles, fichiers ADF et JDR, accusés, corrections')
on conflict (key) do nothing;

-- ── Droit d'accès au module ──
create or replace function public.pp_can()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    auth.role() = 'service_role'
    or (
      public.current_profile_role() in ('superadmin', 'admin', 'direction', 'gestionnaire')
      and exists (select 1 from public.org_modules m where m.key = 'passeport' and m.enabled)
    ),
    false)
$$;

create or replace function public.pp_can_read()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.pp_can() or public.current_profile_role() = 'superadmin', false)
$$;

-- ── 2. Format officiel versionné ──
create table if not exists public.pp_format_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  label text not null,
  en_vigueur boolean not null default false,
  contrat jsonb not null,
  regles jsonb not null,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.pp_format_versions (version, label, en_vigueur, contrat, regles, sources)
values (
  '2026-02-27',
  'Contrat d''interface du 27/02/2026 (guides d''import en masse OF, février 2026)',
  true,
  $json${
    "separateur": "|",
    "encodage": "UTF-8",
    "format_date": "jj/mm/aaaa",
    "fichier_max_mo": 200,
    "nom_fichier_max": 200,
    "nom_fichier_interdits": "@<>:\"/\\|?*%",
    "titulaires_max_par_declaration": 500,
    "nom_titulaire_max": 30,
    "nir_longueur": 13,
    "rome_min": 3, "rome_max": 10,
    "formacode_min": 1, "formacode_max": 5,
    "nsf_min": 1, "nsf_max": 3,
    "adf": ["ID_DECLARATION","REFERENCE_DECLARATION","ID_UNIQUE_PARTENAIRE","NOM_FORMATION","DATE_DEBUT_FORMATION","DATE_FIN_FORMATION","MODALITE_DISPENSE","COMPETENCE_TRANSFERABLE","QUALIFICATION_FORMATEUR","FORMATION_CERTIFIANTE","CERTIFICATION_VISEE","DOMAINE_FORMATION","SPECIALITE_FORMATION","NIR","NOM_TITULAIRE","PRESENCE_EMPLOYEUR","SIRET_EMPLOYEUR","REFERENCE_EMPLOYEUR","DATE_DEBUT_VALIDITE","DATE_FIN_VALIDITE"],
    "jdr": ["ID_DECLARATION","REFERENCE_DECLARATION","ID_UNIQUE_PARTENAIRE","TYPE_JDR","NOM_JDR","NOM_OPTION_SPECIALITE","MODE_OBTENTION","COMPETENCE_TRANSFERABLE","PRESENCE_FORMATION","NOM_FORMATION","DATE_DEBUT_FORMATION","DATE_FIN_FORMATION","MODALITE_DISPENSE","QUALIFICATION_FORMATEUR","FORMATION_CERTIFIANTE","CERTIFICATION_VISEE","DOMAINE_FORMATION","SPECIALITE_FORMATION","NIR","NOM_TITULAIRE","PRESENCE_EMPLOYEUR","SIRET_EMPLOYEUR","REFERENCE_EMPLOYEUR","DATE_DEBUT_VALIDITE","DATE_FIN_VALIDITE","RESULTAT_OBTENU","MENTION_OBTENUE","LIEN_PREUVE","IDENTIFIANT_PREUVE"],
    "valeurs": {
      "MODALITE_DISPENSE": ["PRESENTIEL","A_DISTANCE","MIXTE"],
      "QUALIFICATION_FORMATEUR": ["ENSEIGNANT","FORMATEUR_D_ADULTES_FORMATION_SPECIALISEE","INGENIEUR","PREVENTEUR","PSYCHOLOGUE","RESPONSABLE_QHSE","ANCIEN_PROFESSIONNEL"],
      "TYPE_JDR": ["DIPLOME","TITRE","HABILITATION","CERTIFICAT"],
      "MODE_OBTENTION": ["PAR_ADMISSION","PAR_SCORING",""]
    },
    "accuse": {
      "separateur": ";",
      "colonnes": ["NUMERO_LIGNE","ID_UNIQUE_PARTENAIRE","ID_DECLARATION_PARTENAIRE","STATUT","COLONNE","CODE_ERREUR","DESCRIPTION_ERREUR"],
      "succes": "TRAITEMENT_TERMINE_SUCCES",
      "echec": "TRAITEMENT_TERMINE_ECHEC"
    },
    "suffixe_correction_identifiant": "-C",
    "suffixe_correction_declaration": "_C"
  }$json$::jsonb,
  $json${
    "categories": [
      {"n": 1, "label": "Formations obligatoires encadrées par la réglementation"},
      {"n": 2, "label": "Postes nécessitant une autorisation ou une habilitation de l'employeur"},
      {"n": 3, "label": "Objectif spécifique prévu par la réglementation"},
      {"n": 4, "label": "Obligation générale de formation à la sécurité"}
    ],
    "obligation_of": {"categories_1_2_depuis": "2025-09-01", "toutes_depuis": "2026-07-01"},
    "obligation_employeur": {"toutes_depuis": "2027-01-01"},
    "delais": {
      "droit_commun_mois": 3,
      "transitoire": {"fin_formation_jusqu_au": "2026-12-31", "mois": 6, "a_confirmer": true},
      "employeur_mois": 9
    },
    "couleurs": {"rouge_jours": 30, "orange_jours": 90},
    "alerte_sans_accuse_jours": 15,
    "causes": {
      "TITU_INCOHERENCE_NIR_NOM": {
        "nom_usage": "Nom d'usage envoyé à la place du nom de naissance (femme ou nom composé). Sinon : numéro mal saisi.",
        "nir": "Numéro mal saisi, ou nom de naissance différent du nom connu."
      },
      "_defaut": "Voir le libellé du portail et la colonne en cause."
    },
    "exclusions": "Formations de formateurs, formation à la sécurité au poste (R4141-13), formation SSCT des élus du CSE, formations de préventeurs, formations permettant d'assurer la sécurité des personnes et des biens, sauf le SST (décret n° 2025-748, art. 4 II).",
    "sanction": "Amende administrative jusqu'à 4 000 euros par manquement, doublée en cas de récidive dans les deux ans (Code du travail, L6356-1 et L6356-2, loi n° 2026-534 du 25 juin 2026)."
  }$json$::jsonb,
  $json$[
    {"label": "Code du travail, article L4141-5", "url": "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043884452", "consulte_le": "2026-10-14", "note": "Légifrance inaccessible le 14/10, confirmé par des sources secondaires"},
    {"label": "Décret n° 2025-748 du 1er août 2025, modifié par le décret n° 2026-496 du 12 juin 2026", "url": "https://www.legifrance.gouv.fr/", "consulte_le": "2026-10-14", "note": "Texte du décret 2026-496 à relire"},
    {"label": "Décret n° 2023-1073 du 20 novembre 2023 (numéro de sécurité sociale pour le Passeport)", "url": "https://www.legifrance.gouv.fr/", "consulte_le": "2026-10-14"},
    {"label": "Guide d'import en masse OF, attestation de formation (ADF)", "url": "https://passeport-prevention.travail-emploi.gouv.fr/espace-public/sites/pp/files/2026-02/Guide%20import%20en%20masse_OF_ADF.pdf", "consulte_le": "2026-10-14"},
    {"label": "Guide d'import en masse OF, justificatif de réussite (JDR)", "url": "https://passeport-prevention.travail-emploi.gouv.fr/espace-public/sites/pp/files/2026-02/Guide%20import%20en%20masse_OF_JDR.pdf", "consulte_le": "2026-10-14"},
    {"label": "Fiches de codes des formations", "url": "https://passeport-prevention.travail-emploi.gouv.fr/espace-public/node/106", "consulte_le": "2026-10-14", "note": "Site en maintenance le 14/10"},
    {"label": "Site du Passeport de prévention", "url": "https://passeport-prevention.travail-emploi.gouv.fr/", "consulte_le": "2026-10-14"}
  ]$json$::jsonb
)
on conflict (version) do nothing;

-- ── 3. Valeurs proposées (fiches officielles) ──
create table if not exists public.pp_presets (
  code text primary key,
  label text not null,
  declarable boolean not null default true,
  motif text,
  categorie smallint,
  type_decl text,
  type_jdr text,
  nom_jdr text,
  mode_obtention text,
  rome text[] not null default '{}',
  formacodes text[] not null default '{}',
  nsf text[] not null default '{}',
  certifiante boolean not null default false,
  code_rs text,
  validite_mois integer,
  source text,
  a_confirmer boolean not null default true,
  position integer not null default 0
);

insert into public.pp_presets (code, label, declarable, motif, categorie, type_decl, type_jdr, nom_jdr, mode_obtention, rome, formacodes, nsf, certifiante, validite_mois, source, position) values
  ('SST', 'Sauveteur Secouriste du Travail (initial et MAC)', true, null, 3, 'JDR', 'CERTIFICAT', 'Certificat de Sauveteur Secouriste du Travail', 'PAR_ADMISSION',
   array['115650','400635','114955','120864','400610','103885','102382','496733','121831','119571'], array['42866','42875','42829','42817','42819'], array['344r'], false, 24,
   'Fiche officielle SST (page des fiches de codes). Catégorie 3 à confirmer.', 10),
  ('GESTES_POSTURES', 'PRAP, gestes et postures', true, null, 3, 'ADF', null, null, null,
   array['483792','500222','120864','121638','119800','481161','479531','496837','119571','119596'], array['42819','42898','42866','42875'], array['344r'], false, null,
   'Fiche officielle PRAP (page des fiches de codes).', 20),
  ('HABILITATION_NON_ELEC', 'Habilitation électrique non électricien (B0, H0, H0V, BS, BE manœuvre)', true, null, 2, 'ADF', null, null, null,
   array['489756','489625','105752','489701','100240'], array['24049','24039'], array['255s','255r','230r'], false, null,
   'Pas de fiche dédiée : reprise de la fiche B1 (page des fiches de codes).', 30),
  ('CONDUITE_R489', 'Conduite de chariots, autorisation de conduite interne (non certifiante)', true, null, 2, 'ADF', null, null, null,
   array['484039','400631','485099','125180','103792','110468','119977'], array['31784','31747','31768','31795'], array['311u'], false, null,
   'Fiche officielle conduite de chariots (page des fiches de codes).', 40),
  ('EXCLUE_SECURITE_BIENS', 'Exclue : sécurité des personnes et des biens (incendie, évacuation, initiation premiers secours)', false,
   'Formation permettant d''assurer la sécurité des personnes et des biens (décret n° 2025-748, art. 4 II)', null, null, null, null, null,
   '{}', '{}', '{}', false, null, 'Choix de l''organisme, à confirmer auprès de l''assistance du portail.', 90),
  ('EXCLUE_AUTRE', 'Exclue : hors champ du Passeport', false, 'Formation sans objectif de prévention des risques professionnels', null, null, null, null, null,
   '{}', '{}', '{}', false, null, null, 99)
on conflict (code) do nothing;

-- ── 4. Réglages par formation ──
create table if not exists public.pp_course_settings (
  course_id uuid primary key references public.courses(id) on delete cascade,
  declarable boolean not null default true,
  motif text,
  categorie smallint check (categorie between 1 and 4),
  type_decl text check (type_decl in ('ADF', 'JDR')),
  type_jdr text,
  nom_jdr text,
  nom_option text,
  mode_obtention text,
  rome text[] not null default '{}',
  formacodes text[] not null default '{}',
  nsf text[] not null default '{}',
  certifiante boolean not null default false,
  code_rs text,
  validite_mois integer check (validite_mois is null or validite_mois > 0),
  qualification_formateur text not null default 'FORMATEUR_D_ADULTES_FORMATION_SPECIALISEE',
  modalite text not null default 'PRESENTIEL',
  nom_formation text,
  preset_code text references public.pp_presets(code),
  valeurs_confirmees boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ── 5. Stagiaire : nom de naissance ──
alter table public.trainees add column if not exists nom_naissance text;
alter table public.trainees add column if not exists nom_naissance_confirme_le timestamptz;

-- ── 6. Numéro chiffré (serveur seulement) ──
create table if not exists public.pp_nir (
  trainee_id uuid primary key references public.trainees(id) on delete cascade,
  nir_chiffre text not null,
  fin text not null check (char_length(fin) between 1 and 3),
  source text not null default 'fiche' check (source in ('portail', 'fiche', 'demo')),
  saisi_le timestamptz not null default now(),
  saisi_par uuid
);

-- ── 7. Lignes, envois, fichiers, accusés ──
create table if not exists public.pp_fichiers (
  id uuid primary key default gen_random_uuid(),
  type_decl text not null check (type_decl in ('ADF', 'JDR')),
  version_format text not null,
  nom text not null,
  nb_lignes integer not null default 0,
  nb_declarations integer not null default 0,
  correction boolean not null default false,
  selection jsonb not null default '{}'::jsonb,
  genere_le timestamptz not null default now(),
  genere_par uuid,
  accuse_id uuid,
  marque_non_depose boolean not null default false
);

create table if not exists public.pp_accuses (
  id uuid primary key default gen_random_uuid(),
  nom_fichier text,
  importe_le timestamptz not null default now(),
  importe_par uuid,
  nb_lignes integer not null default 0,
  nb_succes integer not null default 0,
  nb_echecs integer not null default 0,
  nb_inconnus integer not null default 0
);

create table if not exists public.pp_lignes (
  id uuid primary key default gen_random_uuid(),
  session_trainee_id uuid not null references public.session_trainees(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  trainee_id uuid not null references public.trainees(id) on delete cascade,
  type_decl text not null check (type_decl in ('ADF', 'JDR')),
  id_unique_base uuid not null unique default gen_random_uuid(),
  statut text not null default 'genere' check (statut in ('genere', 'declare', 'rejete')),
  tentative integer not null default 1,
  corrige_le timestamptz,
  realise_par_sous_traitant boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_trainee_id, type_decl)
);
create index if not exists pp_lignes_trainee_idx on public.pp_lignes (trainee_id);
create index if not exists pp_lignes_session_idx on public.pp_lignes (session_id);

create table if not exists public.pp_envois (
  id uuid primary key default gen_random_uuid(),
  ligne_id uuid not null references public.pp_lignes(id) on delete cascade,
  fichier_id uuid references public.pp_fichiers(id) on delete set null,
  tentative integer not null,
  id_unique_partenaire text not null unique,
  id_declaration text not null,
  statut text not null default 'envoye' check (statut in ('envoye', 'succes', 'echec')),
  colonne text,
  code_erreur text,
  description_erreur text,
  cause_probable text,
  accuse_id uuid references public.pp_accuses(id) on delete set null,
  traite_le timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pp_envois_ligne_idx on public.pp_envois (ligne_id);
create index if not exists pp_envois_fichier_idx on public.pp_envois (fichier_id);

-- ── Règles d'accès ──
alter table public.pp_format_versions enable row level security;
alter table public.pp_presets enable row level security;
alter table public.pp_course_settings enable row level security;
alter table public.pp_nir enable row level security;
alter table public.pp_fichiers enable row level security;
alter table public.pp_accuses enable row level security;
alter table public.pp_lignes enable row level security;
alter table public.pp_envois enable row level security;

do $$
declare t text;
begin
  -- Lecture : rôles habilités, module actif (superadmin en lecture même module coupé)
  foreach t in array array['pp_format_versions', 'pp_presets', 'pp_course_settings', 'pp_fichiers', 'pp_accuses', 'pp_lignes', 'pp_envois'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_select') then
      execute format('create policy %I on public.%I for select to authenticated using (public.pp_can_read())', t || '_select', t);
    end if;
  end loop;
  -- Écriture directe : seulement les réglages par formation (le reste passe par les fonctions et le serveur)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pp_course_settings' and policyname = 'pp_course_settings_write') then
    create policy pp_course_settings_write on public.pp_course_settings for all to authenticated
      using (public.pp_can()) with check (public.pp_can());
  end if;
  -- pp_nir : aucune règle, donc aucun accès hors serveur
end $$;

revoke all on public.pp_nir from anon, authenticated;
revoke all on public.pp_format_versions, public.pp_presets, public.pp_course_settings, public.pp_fichiers,
  public.pp_accuses, public.pp_lignes, public.pp_envois from anon;
revoke insert, update, delete, truncate on public.pp_format_versions, public.pp_presets, public.pp_fichiers,
  public.pp_accuses, public.pp_lignes, public.pp_envois from authenticated;

-- ── 8. Fonctions ──

-- Présence du numéro, 3 derniers caractères au plus
create or replace function public.pp_nir_etat(p_trainee_ids uuid[])
returns table (trainee_id uuid, present boolean, fin text, source text, saisi_le timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pp_can_read() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return query
    select n.trainee_id, true, n.fin, n.source, n.saisi_le
    from public.pp_nir n where n.trainee_id = any(p_trainee_ids);
end $$;

-- Inscriptions des sessions terminées (hors sessions réalisées pour le compte d'un autre organisme)
create or replace function public.pp_donnees(p_session_ids uuid[] default null, p_inscription_ids uuid[] default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.pp_can_read() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(r order by r->>'end_date', r->>'reference', r->>'last_name'), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'inscription_id', st.id,
      'session_id', s.id,
      'reference', s.reference,
      'start_date', s.start_date,
      'end_date', s.end_date,
      'is_remote', coalesce(s.is_remote, false),
      'course_id', c.id,
      'course_title', c.title,
      'course_code', c.code,
      'client_id', cl.id,
      'client_name', cl.name,
      'client_siret', cl.siret,
      'client_type', cl.client_type,
      'trainee_id', t.id,
      'first_name', t.first_name,
      'last_name', t.last_name,
      'gender', t.gender,
      'birth_date', t.birth_date,
      'nom_naissance', t.nom_naissance,
      'nom_naissance_confirme_le', t.nom_naissance_confirme_le,
      'refused_ssn', coalesce(t.refused_ssn, false),
      'absent', coalesce(st.absent, false),
      'early_departure', coalesce(st.early_departure, false),
      'result', st.result,
      'date_certification', (select sc.date_certification from public.sst_certifications sc
                             where sc.session_id = s.id and sc.trainee_id = t.id order by sc.created_at desc limit 1),
      'nir_present', (n.trainee_id is not null),
      'nir_fin', n.fin,
      'ligne', (select to_jsonb(l) from public.pp_lignes l where l.session_trainee_id = st.id order by l.created_at desc limit 1),
      'dernier_envoi', (select to_jsonb(e) from public.pp_envois e join public.pp_lignes l on l.id = e.ligne_id
                        where l.session_trainee_id = st.id order by e.tentative desc, e.created_at desc limit 1)
    ) as r
    from public.session_trainees st
    join public.sessions s on s.id = st.session_id
    join public.trainees t on t.id = st.trainee_id
    left join public.courses c on c.id = s.course_id
    left join public.clients cl on cl.id = s.client_id
    left join public.pp_nir n on n.trainee_id = t.id
    where s.end_date < current_date
      and s.subcontract_client_ref is null
      and coalesce(s.session_type, '') not in ('subcontract', 'sous-traitance')
      and (p_session_ids is null or s.id = any(p_session_ids))
      and (p_inscription_ids is null or st.id = any(p_inscription_ids))
  ) x;
  return v;
end $$;

-- Nom de naissance (saisi ou confirmé par l'organisme)
create or replace function public.pp_enregistrer_nom(p_trainee_id uuid, p_nom text, p_confirme boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pp_can() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.trainees
     set nom_naissance = nullif(btrim(p_nom), ''),
         nom_naissance_confirme_le = case when p_confirme and nullif(btrim(p_nom), '') is not null then now() else null end
   where id = p_trainee_id;
  update public.pp_lignes set corrige_le = now(), updated_at = now()
   where trainee_id = p_trainee_id and statut = 'rejete';
end $$;

-- Refus de communiquer le numéro (colonne existante refused_ssn, une seule source)
create or replace function public.pp_enregistrer_refus(p_trainee_id uuid, p_refus boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pp_can() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.trainees set refused_ssn = coalesce(p_refus, false) where id = p_trainee_id;
  if coalesce(p_refus, false) then
    delete from public.pp_nir where trainee_id = p_trainee_id;
  end if;
end $$;

-- Le numéro sert-il encore ? (une inscription à une formation déclarable, pas encore acceptée par le portail)
create or replace function public.pp_nir_encore_utile(p_trainee_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.session_trainees st
    join public.sessions s on s.id = st.session_id
    join public.pp_course_settings cs on cs.course_id = s.course_id and cs.declarable
    where st.trainee_id = p_trainee_id
      and s.subcontract_client_ref is null
      and coalesce(st.absent, false) = false
      and coalesce(st.early_departure, false) = false
      and (cs.type_decl = 'ADF' or st.result is null or st.result = 'acquired')
      and not exists (select 1 from public.pp_lignes l where l.session_trainee_id = st.id and l.statut = 'declare')
  )
$$;

-- Import de l'accusé de traitement (lu dans le navigateur, sans aucun numéro)
create or replace function public.pp_import_accuse(p_nom_fichier text, p_lignes jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_accuse uuid;
  r jsonb;
  e record;
  v_succes int := 0; v_echecs int := 0; v_inconnus int := 0; v_total int := 0; v_effaces int := 0;
  v_ok text; v_ko text; v_cause text; v_gender text; v_nom text;
  v_trainees uuid[] := '{}';
  v_t uuid;
  v_inconnues jsonb := '[]'::jsonb;
begin
  if not public.pp_can() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select contrat->'accuse'->>'succes', contrat->'accuse'->>'echec' into v_ok, v_ko
    from public.pp_format_versions where en_vigueur order by created_at desc limit 1;
  v_ok := coalesce(v_ok, 'TRAITEMENT_TERMINE_SUCCES');
  v_ko := coalesce(v_ko, 'TRAITEMENT_TERMINE_ECHEC');

  insert into public.pp_accuses (nom_fichier, importe_par) values (left(p_nom_fichier, 200), auth.uid()) returning id into v_accuse;
  -- En mode démonstration, l'accusé part avec les données fictives
  if exists (select 1 from public.organization_settings where demo_mode) then
    insert into public.demo_records (tbl, id) values ('pp_accuses', v_accuse);
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) loop
    v_total := v_total + 1;
    select en.*, l.trainee_id, l.id as lid into e
      from public.pp_envois en join public.pp_lignes l on l.id = en.ligne_id
     where en.id_unique_partenaire = r->>'id_unique' limit 1;
    if not found then
      v_inconnus := v_inconnus + 1;
      v_inconnues := v_inconnues || jsonb_build_object('numero', r->>'numero', 'id_unique', r->>'id_unique');
      continue;
    end if;
    if r->>'statut' = v_ok then
      update public.pp_envois set statut = 'succes', colonne = null, code_erreur = null, description_erreur = null,
             cause_probable = null, accuse_id = v_accuse, traite_le = now() where id = e.id;
      update public.pp_lignes set statut = 'declare', updated_at = now() where id = e.lid;
      v_succes := v_succes + 1;
      v_trainees := v_trainees || e.trainee_id;
    else
      v_cause := null;
      if r->>'code' = 'TITU_INCOHERENCE_NIR_NOM' then
        select t.gender, coalesce(t.nom_naissance, t.last_name) into v_gender, v_nom from public.trainees t where t.id = e.trainee_id;
        v_cause := case when v_gender = 'female' or v_nom ~ '[- '']' then 'nom_usage' else 'nir' end;
      end if;
      update public.pp_envois set statut = 'echec', colonne = nullif(r->>'colonne', ''), code_erreur = nullif(r->>'code', ''),
             description_erreur = nullif(r->>'description', ''), cause_probable = v_cause, accuse_id = v_accuse, traite_le = now()
       where id = e.id;
      update public.pp_lignes set statut = 'rejete', corrige_le = null, updated_at = now() where id = e.lid;
      v_echecs := v_echecs + 1;
    end if;
    update public.pp_fichiers set accuse_id = v_accuse where id = e.fichier_id and accuse_id is null;
  end loop;

  -- Numéro effacé quand il ne sert plus (toutes les déclarations du stagiaire acceptées)
  foreach v_t in array v_trainees loop
    if not public.pp_nir_encore_utile(v_t) then
      delete from public.pp_nir where trainee_id = v_t;
      if found then v_effaces := v_effaces + 1; end if;
    end if;
  end loop;

  update public.pp_accuses set nb_lignes = v_total, nb_succes = v_succes, nb_echecs = v_echecs, nb_inconnus = v_inconnus
   where id = v_accuse;
  return jsonb_build_object('accuse_id', v_accuse, 'lignes', v_total, 'succes', v_succes, 'echecs', v_echecs,
                            'inconnus', v_inconnus, 'numeros_effaces', v_effaces, 'inconnues', v_inconnues);
end $$;

-- Fichier préparé mais jamais déposé : il ne compte plus dans l'alerte
create or replace function public.pp_marquer_fichier(p_fichier_id uuid, p_non_depose boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pp_can() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.pp_fichiers set marque_non_depose = coalesce(p_non_depose, false) where id = p_fichier_id;
end $$;

revoke all on function public.pp_nir_etat(uuid[]), public.pp_donnees(uuid[], uuid[]),
  public.pp_enregistrer_nom(uuid, text, boolean), public.pp_enregistrer_refus(uuid, boolean),
  public.pp_nir_encore_utile(uuid), public.pp_import_accuse(text, jsonb), public.pp_marquer_fichier(uuid, boolean),
  public.pp_can(), public.pp_can_read() from public, anon;
grant execute on function public.pp_nir_etat(uuid[]), public.pp_donnees(uuid[], uuid[]),
  public.pp_enregistrer_nom(uuid, text, boolean), public.pp_enregistrer_refus(uuid, boolean),
  public.pp_import_accuse(text, jsonb), public.pp_marquer_fichier(uuid, boolean),
  public.pp_can(), public.pp_can_read() to authenticated, service_role;
grant execute on function public.pp_nir_encore_utile(uuid) to service_role;

-- ── 9. Démonstration : fichiers et accusés fictifs effacés avec la purge ──
create or replace function public.pp_demo_record_deleted()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.tbl in ('pp_fichiers', 'pp_accuses') then
    execute format('delete from public.%I where id = $1', old.tbl) using old.id;
  end if;
  return old;
end $$;
revoke all on function public.pp_demo_record_deleted() from public, anon, authenticated;

create or replace trigger pp_demo_record_deleted after delete on public.demo_records
  for each row execute function public.pp_demo_record_deleted();
-- Passeport de prévention : mise en route sur l'instance et données de démonstration.
-- À jouer APRÈS la migration 0190, dans l'éditeur SQL de Supabase. Rejouable sans effet.
--
-- 1. Active le module « passeport ».
-- 2. Règle chaque formation du catalogue à partir des valeurs proposées (pp_presets), par code de formation.
--    Réglages de l'instance : ils restent après la purge des données de démonstration.
-- 3. Démonstration seulement (lignes inscrites dans demo_records) : SIRET fictifs rendus valides (clé de Luhn),
--    sauf un, gardé faux pour montrer le blocage ; refus levé pour les stagiaires fictifs des formations
--    déclarables (le jeu fictif les marquait presque tous en refus), puis deux refus fictifs.
-- Les numéros fictifs sont créés ensuite par l'action « demo-seed » de api/passeport.js (chiffrement côté serveur),
-- lancée par le super administrateur depuis la page (voir la procédure du chantier 16).

-- ── 1. Module ──
update public.org_modules set enabled = true where key = 'passeport';

-- ── 2. Réglages par formation ──
insert into public.pp_course_settings (course_id, declarable, motif, categorie, type_decl, type_jdr, nom_jdr, mode_obtention,
                                       rome, formacodes, nsf, certifiante, validite_mois, preset_code)
select c.id, p.declarable, p.motif, p.categorie, p.type_decl, p.type_jdr, p.nom_jdr, p.mode_obtention,
       p.rome, p.formacodes, p.nsf, p.certifiante, p.validite_mois, p.code
from public.courses c
join (values
  ('SST-FI', 'SST'), ('SST-MAC', 'SST'),
  ('ERG-GP', 'GESTES_POSTURES'),
  ('B0H0V', 'HABILITATION_NON_ELEC'), ('BSBEM', 'HABILITATION_NON_ELEC'),
  ('R489', 'CONDUITE_R489'),
  ('INC-EPI', 'EXCLUE_SECURITE_BIENS'), ('INC-EXT', 'EXCLUE_SECURITE_BIENS'), ('IGPS', 'EXCLUE_SECURITE_BIENS'),
  ('DUERP', 'EXCLUE_AUTRE'), ('FOR', 'EXCLUE_AUTRE')
) m(code, preset) on m.code = c.code
join public.pp_presets p on p.code = m.preset
on conflict (course_id) do nothing;

-- Conduite R485 : déclarable (catégorie 2, ADF), codes à compléter depuis la fiche officielle
insert into public.pp_course_settings (course_id, declarable, categorie, type_decl)
select c.id, true, 2, 'ADF' from public.courses c where c.code = 'R485'
on conflict (course_id) do nothing;

-- ── 3. Démonstration ──
do $$
declare
  r record;
  v_base text; v_digit int; v_sum int; v_n int; i int;
  v_garde uuid;
begin
  -- Client gardé avec un SIRET faux : celui de la dernière session terminée de SST formation initiale
  select s.client_id into v_garde
  from public.sessions s join public.courses c on c.id = s.course_id
  where c.code = 'SST-FI' and s.end_date < current_date
    and s.client_id in (select id from public.demo_records where tbl = 'clients')
  order by s.end_date desc limit 1;

  for r in select cl.id, cl.siret from public.clients cl
           where cl.id in (select id from public.demo_records where tbl = 'clients')
             and cl.siret ~ '^\d{14}$' and cl.id is distinct from v_garde loop
    v_base := left(r.siret, 13);
    for v_digit in 0..9 loop
      v_sum := 0;
      for i in 1..14 loop
        v_n := substr(v_base || v_digit::text, 15 - i, 1)::int;
        if i % 2 = 0 then v_n := v_n * 2; if v_n > 9 then v_n := v_n - 9; end if; end if;
        v_sum := v_sum + v_n;
      end loop;
      if v_sum % 10 = 0 then
        if r.siret <> v_base || v_digit::text then
          update public.clients set siret = v_base || v_digit::text where id = r.id;
        end if;
        exit;
      end if;
    end loop;
  end loop;

  -- Le jeu fictif marquait presque tous les stagiaires « refuse de communiquer son numéro » : on lève ce refus
  -- pour les stagiaires fictifs des sessions terminées de formations déclarables (ils recevront un numéro fictif)
  update public.trainees set refused_ssn = false
  where refused_ssn
    and id in (select id from public.demo_records where tbl = 'trainees')
    and id in (
      select st.trainee_id
      from public.session_trainees st
      join public.sessions s on s.id = st.session_id
      join public.pp_course_settings cs on cs.course_id = s.course_id and cs.declarable
      where s.end_date < current_date
    );

  -- Deux stagiaires fictifs refusent de communiquer leur numéro (sessions terminées, formations déclarables)
  update public.trainees set refused_ssn = true
  where id in (
    select st.trainee_id
    from public.session_trainees st
    join public.sessions s on s.id = st.session_id
    join public.pp_course_settings cs on cs.course_id = s.course_id and cs.declarable
    where s.end_date < current_date
      and st.trainee_id in (select id from public.demo_records where tbl = 'trainees')
    order by s.end_date, st.trainee_id
    limit 2
  );
end $$;

-- Contrôle
select
  (select enabled from public.org_modules where key = 'passeport') as module_actif,
  (select count(*) from public.pp_course_settings) as formations_reglees,
  (select count(*) from public.trainees where refused_ssn) as refus;

-- ESSAI-FIN : contrôles puis erreur volontaire (tout est annulé, rien n'est enregistré)
do $$
declare
  r text := '';
  d jsonb;
  v_lecture uuid;
  ok boolean;
begin
  r := r || 'tables=' || (select count(*) from pg_tables where schemaname = 'public' and tablename like 'pp\_%');
  r := r || ' module=' || (select enabled from public.org_modules where key = 'passeport');
  r := r || ' formations_reglees=' || (select count(*) from public.pp_course_settings);
  r := r || ' regles_pp_nir=' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'pp_nir');
  r := r || ' anon_lit_nir=' || has_table_privilege('anon', 'public.pp_nir', 'select');
  r := r || ' connecte_lit_nir=' || has_table_privilege('authenticated', 'public.pp_nir', 'select');
  r := r || ' refus=' || (select count(*) from public.trainees where refused_ssn);
  -- superadmin
  perform set_config('request.jwt.claim.sub', '38038f89-81e6-41aa-91db-de56b62f0a43', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  d := public.pp_donnees();
  r := r || ' inscriptions_superadmin=' || jsonb_array_length(d);
  r := r || ' lignes_visibles=' || (select count(*) from public.pp_lignes);
  begin
    perform 1 from public.pp_nir limit 1;
    r := r || ' NIR_LISIBLE=ECHEC';
  exception when insufficient_privilege then r := r || ' nir_illisible=OK';
  end;
  execute 'reset role';
  -- compte en lecture (technicien) : refusé
  select id into v_lecture from public.profiles where role = 'lecture' and is_active limit 1;
  if v_lecture is not null then
    perform set_config('request.jwt.claim.sub', v_lecture::text, true);
    execute 'set local role authenticated';
    begin
      perform public.pp_donnees();
      r := r || ' LECTURE=ECHEC';
    exception when insufficient_privilege then r := r || ' lecture_refusee=OK';
    end;
    execute 'reset role';
  end if;
  raise exception 'RESULTAT ESSAI PASSEPORT : %', r;
end $$;

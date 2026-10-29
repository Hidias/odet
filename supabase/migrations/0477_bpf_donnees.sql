-- 0477 : BPF au format du Cerfa n° 10443*17 (chantier formation S12, lot 1b, conception validée par H le 29/10).
-- Sources vérifiées le 29/10/2026 : formulaire 10443*17 et notice n° 50199#17 (mai 2025), service-public.gouv.fr.
-- 1. Liste officielle des spécialités de formation (annexe de la notice, 92 codes).
-- 2. Formation : objectif au sens du BPF (cadre F-3) et spécialité (cadre F-4), choisis une fois par formation.
-- 3. Participant : catégorie du cadre F-1 quand la base ne peut pas la déduire (apprenti, demandeur d'emploi…).
-- 4. Déclaration : une par société et par exercice ; valeurs rangées sous le code officiel des lignes ; le calcul
--    et les saisies sont gardés à part (un recalcul n'écrase jamais une saisie).
-- 5. bpf_calculer(société, année) : calcul en base, avec le détail de chaque chiffre et ce qui reste à classer.
-- Additive. Idempotente. Retour arrière : supabase/rollback/0477_bpf_donnees_retour.sql

-- ── 1. Spécialités de formation (annexe de la notice 50199#17) ──
create table if not exists public.bpf_specialites (
  code text primary key check (code ~ '^[1-4][0-9]{2}$'),
  libelle text not null
);
comment on table public.bpf_specialites is 'Spécialités de formation du BPF (annexe de la notice Cerfa 50199#17), cadre F-4';
insert into public.bpf_specialites (code, libelle) values
  ('100', 'Formations générales'),
  ('110', 'Spécialités pluriscientifiques'),
  ('111', 'Physique-chimie'),
  ('112', 'Chimie-biologie, biochimie'),
  ('113', 'Sciences naturelles (biologie-géologie)'),
  ('114', 'Mathématiques'),
  ('115', 'Physique'),
  ('116', 'Chimie'),
  ('117', 'Sciences de la terre'),
  ('118', 'Sciences de la vie'),
  ('120', 'Spécialités pluridisciplinaires, sciences humaines et droit'),
  ('121', 'Géographie'),
  ('122', 'Economie'),
  ('123', 'Sciences sociales (y compris démographie, anthropologie)'),
  ('124', 'Psychologie'),
  ('125', 'Linguistique'),
  ('126', 'Histoire'),
  ('127', 'Philosophie, éthique et théologie'),
  ('128', 'Droit, sciences politiques'),
  ('130', 'Spécialités littéraires et artistiques plurivalentes'),
  ('131', 'Français, littérature et civilisation française'),
  ('132', 'Arts plastiques'),
  ('133', 'Musique, arts du spectacle'),
  ('134', 'Autres disciplines artistiques et spécialités artistiques plurivalentes'),
  ('135', 'Langues et civilisations anciennes'),
  ('136', 'Langues vivantes, civilisations étrangères et régionales'),
  ('200', 'Technologies industrielles fondamentales (génie industriel, procédés de transformation, spécialités à dominante fonctionnelle)'),
  ('201', 'Technologies de commandes des transformations industriels (automatismes et robotique industriels, informatique industrielle)'),
  ('210', 'Spécialités plurivalentes de l''agronomie et de l''agriculture'),
  ('211', 'Productions végétales, cultures spécialisées (horticulture, viticulture, arboriculture fruitière...)'),
  ('212', 'Productions animales, élevage spécialisé, aquaculture, soins aux animaux, y compris vétérinaire'),
  ('213', 'Forêts, espaces naturels, faune sauvage, pêche'),
  ('214', 'Aménagement paysager (parcs, jardins, espaces verts ...)'),
  ('220', 'Spécialités pluritechnologiques des transformations'),
  ('221', 'Agro-alimentaire, alimentation, cuisine'),
  ('222', 'Transformations chimiques et apparentées (y compris industrie pharmaceutique)'),
  ('223', 'Métallurgie (y compris sidérurgie, fonderie, non ferreux...)'),
  ('224', 'Matériaux de construction, verre, céramique'),
  ('225', 'Plasturgie, matériaux composites'),
  ('226', 'Papier, carton'),
  ('227', 'Energie, génie climatique (y compris énergie nucléaire, thermique, hydraulique ; utilités : froid, climatisation, chauffage)'),
  ('230', 'Spécialités pluritechnologiques, génie civil, construction, bois'),
  ('231', 'Mines et carrières, génie civil, topographie'),
  ('232', 'Bâtiment : construction et couverture'),
  ('233', 'Bâtiment : finitions'),
  ('234', 'Travail du bois et de l''ameublement'),
  ('240', 'Spécialités pluritechnologiques matériaux souples'),
  ('241', 'Textile'),
  ('242', 'Habillement (y compris mode, couture)'),
  ('243', 'Cuirs et peaux'),
  ('250', 'Spécialités pluritechnologiques mécanique-électricité (y compris maintenance mécano-électrique)'),
  ('251', 'Mécanique générale et de précision, usinage'),
  ('252', 'Moteurs et mécanique auto'),
  ('253', 'Mécanique aéronautique et spatiale'),
  ('254', 'Structures métalliques (y compris soudure, carrosserie, coque bateau, cellule avion)'),
  ('255', 'Electricité, électronique (non compris automatismes, productique)'),
  ('300', 'Spécialités plurivalentes des services'),
  ('310', 'Spécialités plurivalentes des échanges et de la gestion (y compris administration générale des entreprises et des collectivités)'),
  ('311', 'Transports, manutention, magasinage'),
  ('312', 'Commerce, vente'),
  ('313', 'Finances, banque, assurances'),
  ('314', 'Comptabilité, gestion'),
  ('315', 'Ressources humaines, gestion du personnel, gestion de l''emploi'),
  ('320', 'Spécialités plurivalentes de la communication'),
  ('321', 'Journalisme, communication (y compris communication graphique et publicité)'),
  ('322', 'Techniques de l''imprimerie et de l''édition'),
  ('323', 'Techniques de l''image et du son, métiers connexes du spectacle'),
  ('324', 'Secrétariat, bureautique'),
  ('325', 'Documentation, bibliothèques, administration des données'),
  ('326', 'Informatique, traitement de l''information, réseaux de transmission des données'),
  ('330', 'Spécialités plurivalentes sanitaires et sociales'),
  ('331', 'Santé'),
  ('332', 'Travail social'),
  ('333', 'Enseignement, formation'),
  ('334', 'Accueil, hôtellerie, tourisme'),
  ('335', 'Animation culturelle, sportive et de loisirs'),
  ('336', 'Coiffure, esthétique et autres spécialités des services aux personnes'),
  ('341', 'Aménagement du territoire, développement, urbanisme'),
  ('342', 'Protection et développement du patrimoine'),
  ('343', 'Nettoyage, assainissement, protection de l''environnement'),
  ('344', 'Sécurité des biens et des personnes, police, surveillance (y compris hygiène et sécurité)'),
  ('345', 'Application des droits et statut des personnes'),
  ('346', 'Spécialités militaires'),
  ('410', 'Spécialités concernant plusieurs capacités'),
  ('411', 'Pratiques sportives (y compris : arts martiaux)'),
  ('412', 'Développement des capacités mentales et apprentissages de base'),
  ('413', 'Développement des capacités comportementales et relationnelles'),
  ('414', 'Développement des capacités individuelles d''organisation'),
  ('415', 'Développement des capacités d''orientation, d''insertion ou de réinsertion sociales et professionnelles'),
  ('421', 'Jeux et activités spécifiques de loisirs'),
  ('422', 'Economie et activités domestiques'),
  ('423', 'Vie familiale, vie sociale et autres formations au développement personnel')
on conflict (code) do update set libelle = excluded.libelle;

-- Nomenclature nationale, la même pour toutes les sociétés : pas de société sur ses lignes. Inscrite parmi les tables
-- sans société (app.tables_avant_societes), seule exception depuis 0273, pour la règle « toute nouvelle table naît
-- avec company_id » de la suite des droits.
insert into app.tables_avant_societes (table_name) values ('bpf_specialites') on conflict (table_name) do nothing;
alter table public.bpf_specialites enable row level security;
drop policy if exists bpf_specialites_lire on public.bpf_specialites;
create policy bpf_specialites_lire on public.bpf_specialites for select to authenticated using (true);
revoke all on public.bpf_specialites from anon;
grant select on public.bpf_specialites to authenticated;

-- ── 2. Formation : objectif (F-3) et spécialité (F-4) ──
alter table public.courses add column if not exists bpf_objectif text;
alter table public.courses add column if not exists bpf_rncp_niveau integer;
alter table public.courses add column if not exists bpf_fiche text;
alter table public.courses add column if not exists nsf_code text;
alter table public.courses drop constraint if exists courses_bpf_objectif_check;
alter table public.courses add constraint courses_bpf_objectif_check
  check (bpf_objectif is null or bpf_objectif in ('rncp', 'rncp_cqp', 'rs', 'cqp', 'autre', 'bilan', 'vae'));
alter table public.courses drop constraint if exists courses_bpf_niveau_check;
alter table public.courses add constraint courses_bpf_niveau_check
  check ((bpf_rncp_niveau is null or bpf_rncp_niveau between 2 and 8) and (bpf_objectif = 'rncp' or bpf_rncp_niveau is null));
alter table public.courses drop constraint if exists courses_bpf_fiche_check;
alter table public.courses add constraint courses_bpf_fiche_check
  check (bpf_fiche is null or (length(btrim(bpf_fiche)) between 2 and 40));
alter table public.courses drop constraint if exists courses_nsf_code_fkey;
alter table public.courses add constraint courses_nsf_code_fkey foreign key (nsf_code) references public.bpf_specialites(code);
comment on column public.courses.bpf_objectif is 'BPF cadre F-3 : rncp (diplôme ou titre, niveau requis), rncp_cqp (CQP au RNCP sans niveau), rs (répertoire spécifique), cqp (hors RNCP et RS), autre, bilan, vae';
comment on column public.courses.nsf_code is 'BPF cadre F-4 : spécialité de formation (bpf_specialites)';

-- ── 3. Participant : catégorie du cadre F-1 ──
alter table public.session_trainees add column if not exists bpf_categorie text;
alter table public.session_trainees drop constraint if exists session_trainees_bpf_categorie_check;
alter table public.session_trainees add constraint session_trainees_bpf_categorie_check
  check (bpf_categorie is null or bpf_categorie in ('a', 'b', 'c', 'd', 'e'));
comment on column public.session_trainees.bpf_categorie is 'BPF cadre F-1 quand la base ne le déduit pas : a salarié privé, b apprenti, c demandeur d''emploi, d particulier à ses frais, e autre';

-- ── 4. Déclaration par société et par exercice ──
alter table public.bpf_declarations add column if not exists cerfa_version text not null default '10443*17';
alter table public.bpf_declarations add column if not exists calcul jsonb;
alter table public.bpf_declarations add column if not exists saisies jsonb not null default '{}'::jsonb;
alter table public.bpf_declarations drop constraint if exists bpf_declarations_saisies_check;
alter table public.bpf_declarations add constraint bpf_declarations_saisies_check
  check (jsonb_typeof(saisies) = 'object' and (calcul is null or jsonb_typeof(calcul) = 'object'));
alter table public.bpf_declarations drop constraint if exists bpf_declarations_year_key;
create unique index if not exists bpf_declarations_societe_annee on public.bpf_declarations (company_id, year);
-- Lecture et création réservées à ceux qui gèrent les registres qualité (chiffre d'affaires et charges) : la règle
-- précédente laissait lire tout compte qui voit les registres (formateur, commercial, lecture) et créer à qui signale.
-- Même forme que les règles générées (scripts/securite/regles.py, mis à jour) ; règles « société » inchangées.
drop policy if exists bpf_declarations_lire on public.bpf_declarations;
create policy bpf_declarations_lire on public.bpf_declarations for select to authenticated
  using ((((select app.module_on('qualite')) and (select app.a_le_droit('qualite.registres.gerer'))) or (select app.is_superadmin())));
drop policy if exists bpf_declarations_creer on public.bpf_declarations;
create policy bpf_declarations_creer on public.bpf_declarations for insert to authenticated
  with check (((select app.module_on('qualite')) and (select app.a_le_droit('qualite.registres.gerer'))));
comment on column public.bpf_declarations.calcul is 'Dernier calcul de bpf_calculer (lignes au code officiel, détail, à classer)';
comment on column public.bpf_declarations.saisies is 'Saisies par code officiel de ligne (prioritaires sur le calcul), ex. {"D": 1200, "F-2": {"stagiaires": 3, "heures": 21}}';

-- ── 5. Calcul ──
-- Exercice : année p_annee = exercice qui se termine dans cette année, à partir du mois de début réglé dans
-- Réglages › Sociétés (companies.fiscal_year_start_month), premier jour du mois.
-- Hypothèses de lecture de la notice, rendues avec le résultat pour être vues : un stagiaire suivi dans deux
-- actions compte deux fois ; heures suivies = heures des documents émis, sinon durée prévue (signalée).
create or replace function public.bpf_calculer(p_annee integer, p_company uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cie uuid := coalesce(p_company, app.current_company());
  v_mois integer;
  v_debut date;
  v_fin date;
  v_lignes jsonb := '{}'::jsonb;
  v_detail jsonb := '{}'::jsonb;
  v_c_total numeric := 0;
  v_ca_total numeric := 0;
  v_part integer := null;
  r record;
begin
  -- Chiffre d'affaires et charges : réservé à ceux qui gèrent les registres qualité, dans cette société
  if v_cie is null then raise exception 'Choisissez une société : le BPF se fait société par société'; end if;
  perform app.require_right('qualite.registres.gerer');
  if not app.is_superadmin() and not app.a_le_droit_dans(v_cie, 'qualite.registres.gerer') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_annee is null or p_annee < 2000 or p_annee > 2100 then raise exception 'Année invalide'; end if;

  select fiscal_year_start_month into v_mois from public.companies where id = v_cie;
  if v_mois is null then raise exception 'Société inconnue'; end if;
  if v_mois = 1 then
    v_debut := make_date(p_annee, 1, 1);
  else
    v_debut := make_date(p_annee - 1, v_mois, 1);
  end if;
  v_fin := (v_debut + interval '1 year' - interval '1 day')::date;

  -- ── Cadre C : produits de formation (factures émises de l'exercice, avoirs déduits, HT) ──
  create temporary table if not exists pg_temp.bpf_fac (id uuid, reference text, ht numeric, formation boolean, ligne text, motif text) on commit drop;
  truncate pg_temp.bpf_fac;
  insert into pg_temp.bpf_fac
  select i.id, i.reference,
         case when i.type = 'credit_note' then -abs(coalesce(i.total_net_ht, i.total_ht, 0)) else coalesce(i.total_net_ht, i.total_ht, 0) end,
         coalesce(i.is_formation_pro, true),
         x.ligne, x.motif
  from public.invoices i
  left join public.clients c on c.id = i.client_id
  left join public.clients cb on cb.id = i.billing_client_id
  left join public.sessions s on s.id = i.session_id
  left join public.quotes q on q.id = i.quote_id
  left join public.session_groups g on g.id = i.session_group_id
  cross join lateral (
    -- Payeur réel d'abord (groupe d'une session inter : 0044), puis financement de la session ou du devis ; la
    -- subrogation seule ne dit pas qui paie (OPCO ou France Travail) et n'est pas utilisée (relecture de #254)
    select case
      when g.payer_kind = 'france_travail' then 'C-7'
      when g.payer_kind = 'particulier' or (g.payer_kind is null and c.client_type = 'particulier') then 'C-9'
      when g.payer_kind = 'opco' then 'C-2-h'
      when c.client_type = 'organisme_formation' or s.session_type = 'subcontract' then 'C-10'
      when coalesce(s.funding_type, '') = 'cpf' or q.funding_type = 'cpf' then 'C-2-e'
      when s.funding_type = 'ptp' then 'C-2-d'
      when s.funding_type = 'faf' then 'C-2-g'
      when s.funding_type = 'region' or q.funding_type = 'region' then 'C-6'
      when s.funding_type = 'france_travail' or q.funding_type = 'france_travail' then 'C-7'
      when s.funding_type = 'fne' then 'C-5'
      when s.funding_type = 'opco' or q.funding_type = 'opco' or cb.client_type = 'opco' or c.client_type = 'opco' then 'C-2-h'
      when c.client_type = 'public' then 'C-3'
      else 'C-1'
    end as ligne,
    case
      when g.payer_kind in ('france_travail', 'particulier', 'opco') then 'payeur du groupe : ' || g.payer_kind
      when c.client_type = 'particulier' then 'client particulier'
      when c.client_type = 'organisme_formation' or s.session_type = 'subcontract' then 'pour le compte d''un autre organisme'
      when coalesce(s.funding_type, '') in ('cpf', 'ptp', 'faf', 'region', 'france_travail', 'fne', 'opco') then 'financement de la session : ' || s.funding_type
      when q.funding_type is not null then 'financement prévu au devis : ' || q.funding_type
      when cb.client_type = 'opco' or c.client_type = 'opco' then 'facturé à l''OPCO'
      when c.client_type = 'public' then 'client public (agents)'
      else 'employeur (par défaut)'
    end as motif
  ) x
  where i.company_id = v_cie
    and i.status not in ('draft', 'cancelled')
    and i.invoice_date between v_debut and v_fin;

  for r in select ligne, round(sum(ht)) as montant, count(*) as nb from pg_temp.bpf_fac where formation group by ligne loop
    v_lignes := v_lignes || jsonb_build_object(r.ligne, r.montant);
  end loop;
  v_lignes := v_lignes || jsonb_build_object('C-2', (
    select coalesce(round(sum(ht)), 0) from pg_temp.bpf_fac where formation and ligne like 'C-2-%'));
  select coalesce(round(sum(ht)), 0) into v_c_total from pg_temp.bpf_fac where formation;
  select coalesce(round(sum(ht)), 0) into v_ca_total from pg_temp.bpf_fac;
  v_lignes := v_lignes || jsonb_build_object('C', v_c_total);
  if v_ca_total > 0 and v_c_total > 0 then
    v_part := greatest(1, round(100 * v_c_total / v_ca_total));
  end if;
  v_detail := v_detail || jsonb_build_object('C', coalesce((
    select jsonb_agg(jsonb_build_object('facture', reference, 'ligne', ligne, 'ht', round(ht, 2), 'motif', motif) order by ligne, reference)
    from pg_temp.bpf_fac where formation), '[]'::jsonb),
    'hors_formation', (select count(*) from pg_temp.bpf_fac where not formation));

  -- ── Participations des actions de l'exercice (cadres F et G) ──
  create temporary table if not exists pg_temp.bpf_part (session_id uuid, reference text, trainee_id uuid, sous_traitance_recue boolean,
    categorie text, heures numeric, heures_source text, objectif text, niveau integer, nsf text, course_title text) on commit drop;
  truncate pg_temp.bpf_part;
  insert into pg_temp.bpf_part
  select s.id, s.reference, st.trainee_id,
         (s.session_type = 'subcontract' or c.client_type = 'organisme_formation'),
         coalesce(st.bpf_categorie, case when c.client_type = 'particulier' then 'd' when c.client_type = 'public' then 'e' else 'a' end),
         coalesce(h.hours, co.duration_hours, 0),
         case when h.hours is not null then 'document émis' else 'durée prévue' end,
         co.bpf_objectif, co.bpf_rncp_niveau, co.nsf_code, co.title
  from public.sessions s
  join public.session_trainees st on st.session_id = s.id and not coalesce(st.absent, false)
  left join public.clients c on c.id = s.client_id
  left join public.courses co on co.id = s.course_id
  left join lateral (
    select d.hours from public.training_documents_issued d
    where d.session_id = s.id and d.trainee_id = st.trainee_id and d.hours is not null
    order by case d.kind when 'attestation' then 1 when 'certificat' then 2 else 3 end, d.version desc
    limit 1
  ) h on true
  where s.company_id = v_cie
    and coalesce(s.status, '') not in ('cancelled', 'canceled', 'annule', 'annulee')
    and coalesce(s.end_date, s.start_date) between v_debut and v_fin;

  -- F-1 : type de stagiaires
  for r in select categorie, count(*) as nb, round(sum(heures)) as h from pg_temp.bpf_part where not sous_traitance_recue group by categorie loop
    v_lignes := v_lignes || jsonb_build_object('F-1-' || r.categorie, jsonb_build_object('stagiaires', r.nb, 'heures', r.h));
  end loop;
  v_lignes := v_lignes || jsonb_build_object('F-1', (
    select jsonb_build_object('stagiaires', count(*), 'heures', coalesce(round(sum(heures)), 0)) from pg_temp.bpf_part where not sous_traitance_recue));

  -- F-3 : objectif général (les formations non classées sont listées, jamais rangées d'office)
  for r in
    select case
             when objectif = 'rncp' and niveau >= 6 then 'F-3-a-6'
             when objectif = 'rncp' and niveau = 5 then 'F-3-a-5'
             when objectif = 'rncp' and niveau = 4 then 'F-3-a-4'
             when objectif = 'rncp' and niveau = 3 then 'F-3-a-3'
             when objectif = 'rncp' and niveau = 2 then 'F-3-a-2'
             when objectif = 'rncp_cqp' then 'F-3-a-cqp'
             when objectif = 'rs' then 'F-3-b'
             when objectif = 'cqp' then 'F-3-c'
             when objectif = 'autre' then 'F-3-d'
             when objectif = 'bilan' then 'F-3-e'
             when objectif = 'vae' then 'F-3-f'
           end as ligne, count(*) as nb, round(sum(heures)) as h
    from pg_temp.bpf_part where not sous_traitance_recue and objectif is not null and (objectif <> 'rncp' or niveau is not null)
    group by 1
  loop
    v_lignes := v_lignes || jsonb_build_object(r.ligne, jsonb_build_object('stagiaires', r.nb, 'heures', r.h));
  end loop;
  v_lignes := v_lignes || jsonb_build_object('F-3-a', (
    select jsonb_build_object('stagiaires', count(*), 'heures', coalesce(round(sum(heures)), 0)) from pg_temp.bpf_part
    where not sous_traitance_recue and ((objectif = 'rncp' and niveau is not null) or objectif = 'rncp_cqp')));
  v_lignes := v_lignes || jsonb_build_object('F-3', (
    select jsonb_build_object('stagiaires', count(*), 'heures', coalesce(round(sum(heures)), 0)) from pg_temp.bpf_part
    where not sous_traitance_recue and objectif is not null and (objectif <> 'rncp' or niveau is not null)));

  -- F-4 : 5 principales spécialités (par heures), le reste en « autres »
  v_lignes := v_lignes || jsonb_build_object('F-4', coalesce((
    with sp as (
      select nsf, count(*) as nb, round(sum(heures)) as h, row_number() over (order by sum(heures) desc, count(*) desc, nsf) as rang
      from pg_temp.bpf_part where not sous_traitance_recue and nsf is not null group by nsf
    )
    select jsonb_build_object(
      'principales', coalesce((select jsonb_agg(jsonb_build_object('code', nsf, 'stagiaires', nb, 'heures', h) order by rang) from sp where rang <= 5), '[]'::jsonb),
      'autres', (select jsonb_build_object('stagiaires', coalesce(sum(nb), 0), 'heures', coalesce(sum(h), 0)) from sp where rang > 5),
      'total', (select jsonb_build_object('stagiaires', coalesce(sum(nb), 0), 'heures', coalesce(sum(h), 0)) from sp))
  ), '{}'::jsonb));

  -- F-2 : actions confiées à un autre organisme (bon de commande à un prestataire « organisme », hors brouillon et
  -- annulé) ; ces stagiaires restent comptés en F-1 (notice : « parmi les actions mentionnées au cadre F-1 »)
  v_lignes := v_lignes || jsonb_build_object('F-2', (
    select jsonb_build_object('stagiaires', count(*), 'heures', coalesce(round(sum(p.heures)), 0))
    from pg_temp.bpf_part p
    where not p.sous_traitance_recue and exists (
      select 1 from public.subcontract_orders o join public.subcontractors su on su.id = o.subcontractor_id
      where o.session_id = p.session_id and o.company_id = v_cie and su.kind = 'organisme'
        and o.status not in ('brouillon', 'annule'))));

  -- G : actions confiées par un autre organisme
  v_lignes := v_lignes || jsonb_build_object('G', (
    select jsonb_build_object('stagiaires', count(*), 'heures', coalesce(round(sum(heures)), 0)) from pg_temp.bpf_part where sous_traitance_recue));

  -- ── Cadre E : personnes qui ont dispensé les heures (intervenant principal et co-intervenants) ──
  v_lignes := v_lignes || jsonb_build_object('E-1', (
    with sess as (
      select distinct s.id, coalesce(co.duration_hours, 0) as h, t.id as tid, (coalesce(t.is_internal, true) and t.subcontractor_id is null) as interne
      from public.sessions s
      left join public.courses co on co.id = s.course_id
      join lateral (select s.trainer_id as id union select x.trainer_id from public.session_trainers x where x.session_id = s.id) tr on tr.id is not null
      join public.trainers t on t.id = tr.id
      where s.company_id = v_cie and coalesce(s.status, '') not in ('cancelled', 'canceled', 'annule', 'annulee')
        and coalesce(s.end_date, s.start_date) between v_debut and v_fin
    )
    select jsonb_build_object('personnes', count(distinct tid), 'heures', coalesce(round(sum(h)), 0)) from sess where interne));
  v_lignes := v_lignes || jsonb_build_object('E-2', (
    with sess as (
      select distinct s.id, coalesce(co.duration_hours, 0) as h, t.id as tid, (coalesce(t.is_internal, true) and t.subcontractor_id is null) as interne
      from public.sessions s
      left join public.courses co on co.id = s.course_id
      join lateral (select s.trainer_id as id union select x.trainer_id from public.session_trainers x where x.session_id = s.id) tr on tr.id is not null
      join public.trainers t on t.id = tr.id
      where s.company_id = v_cie and coalesce(s.status, '') not in ('cancelled', 'canceled', 'annule', 'annulee')
        and coalesce(s.end_date, s.start_date) between v_debut and v_fin
    )
    select jsonb_build_object('personnes', count(distinct tid), 'heures', coalesce(round(sum(h)), 0)) from sess where not interne));

  -- B-2 : formation à distance pendant l'exercice
  v_lignes := v_lignes || jsonb_build_object('B-2', exists (
    select 1 from public.sessions s where s.company_id = v_cie and coalesce(s.is_remote, false)
      and coalesce(s.end_date, s.start_date) between v_debut and v_fin));

  return jsonb_build_object(
    'cerfa', '10443*17',
    'societe', v_cie,
    'exercice', jsonb_build_object('debut', v_debut, 'fin', v_fin),
    'calcule_le', now(),
    'lignes', v_lignes,
    'part_ca', v_part,
    'detail', v_detail || jsonb_build_object(
      'heures_prevues', (select count(*) from pg_temp.bpf_part where heures_source = 'durée prévue'),
      'participations', (select count(*) from pg_temp.bpf_part)),
    'a_classer', jsonb_build_object(
      'objectif', coalesce((select jsonb_agg(distinct course_title) from pg_temp.bpf_part
                            where not sous_traitance_recue and (objectif is null or (objectif = 'rncp' and niveau is null))), '[]'::jsonb),
      'specialite', coalesce((select jsonb_agg(distinct course_title) from pg_temp.bpf_part where not sous_traitance_recue and nsf is null), '[]'::jsonb)),
    'a_saisir', jsonb_build_array('D', 'D-1', 'D-2', 'C-2-a', 'C-2-b', 'C-2-c', 'C-2-f', 'C-4', 'C-8', 'C-11'),
    'hypotheses', jsonb_build_array(
      'Un stagiaire suivi dans deux actions compte deux fois (lecture de la notice, à confirmer auprès de la DREETS).',
      'Heures suivies : celles des documents émis ; sinon la durée prévue de la formation, signalée.',
      'Formateurs : heures = durée de la formation pour chaque session animée ; formateur rattaché à un prestataire = personne extérieure (E-2).')
  );
end
$$;
revoke all on function public.bpf_calculer(integer, uuid) from public, anon;
grant execute on function public.bpf_calculer(integer, uuid) to authenticated;

-- Registre des migrations (la Console compare ce registre aux fichiers ; relecture de #254). 0459 à 0475 ont été
-- appliquées par l'outil Supabase sans s'y inscrire (constaté le 29/10 : présentes dans la liste des migrations de
-- Supabase, absentes du registre) ; elles y sont inscrites ici, sans être rejouées. 0468 est rapatriée dans le dépôt
-- à part (empreintes des fonctions identiques à la production).
insert into public.schema_migrations (version)
select v from unnest(array['0459_genre_personnes', '0460_contrats_cycle', '0461_contrats_echeancier', '0462_contrats_revision',
  '0463_contrats_inventaire', '0464_inventaire_cloture', '0465_interventions_types', '0466_contrat_fige_urgence',
  '0467_vente_materiel', '0468_vente_relecture', '0469_impayes', '0470_impayes_relecture', '0471_contrat_resiliation_en_ligne',
  '0472_contrats_pilotage', '0473_pilotage_droits', '0474_previsionnel_scenarios', '0475_previsionnel_alerte',
  '0477_bpf_donnees']) v
on conflict (version) do nothing;

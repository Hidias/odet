import { teamNames, docCode } from '../../../core/org/currentOrg'
import { loadTemplateContext, fillDeep, fillTemplate } from '../../../core/org/templateContext'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../../core/supabase'
import { 
  FileText, Download, ChevronDown, ChevronRight, Save, X, Edit,
  Building2, ClipboardList, Table, Users2, BarChart3, CheckSquare,
  Loader2, RefreshCw, Plus, Trash2, CheckCircle
} from 'lucide-react'
import { buildQualityDocPDF } from '../pdf/qualityDocsPDF'
import { loadTemplates, isRich, fromTemplate, docStatus } from '../richdocs/model'
import RichDocEditor, { StatusChip } from '../richdocs/RichDocEditor'
import { buildRichDocPDF } from '../richdocs/richDocPDF'
import { loadPublishedDoc } from '../richdocs/published'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { APP_VERSION } from '../../../core/version'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'

// ===== CONFIG ENTREPRISE =====
// Identité de l'organisme : lue dans les paramètres au chargement de la page, jamais écrite ici
const ORG = { nom: '', forme: '', siret: '', nda: '', adresse: '', cp: '', ville: '', tel: '', email: '', dirigeant: '', dirigeantTitre: '' }
function syncOrg(o) {
  if (!o) return
  Object.assign(ORG, {
    nom: o.legal_name || o.name || '', forme: o.forme_juridique || '', siret: o.siret || '', nda: o.nda || '',
    adresse: o.address || '', cp: o.postal_code || '', ville: o.city || '', tel: o.phone || '', email: o.email || '',
    dirigeant: o.dirigeant_name || '', dirigeantTitre: o.dirigeant_title || '',
  })
}
// Référence d'un programme sans les initiales qu'elle porterait déjà (« XYZ-PROG-SST » donne « PROG-SST »)
const progCode = (ref) => String(ref || '').replace(/^[A-Z0-9]{1,5}-(?=PROG-)/, '')
const raisonSociale = () => [ORG.nom, ORG.forme && !ORG.nom.toLowerCase().includes(ORG.forme.toLowerCase()) ? ORG.forme : ''].filter(Boolean).join(' ')
// Personnes proposées par défaut : membres de l'équipe (profils)
const P = (i) => teamNames()[i] || teamNames()[0] || ''

// ===== STRUCTURE DOCUMENTS COMPLÈTE =====
const QUALITY_DOCS = {
  gouvernance: { name: 'Gouvernance', icon: Building2, color: 'blue', docs: [
    { id: 'organigramme', name: 'Organigramme (calculé : direction, rôles qualité, formateurs)', code: 'ORG-001', computed: true },
    { id: 'des-qual', name: 'Désignation Responsable Qualité', code: 'QUAL-DESQUAL', editable: true },
    { id: 'des-hand', name: 'Désignation Référent Handicap', code: 'QUAL-DESHAND', editable: true },
    { id: 'des-deon', name: 'Désignation Référent Déontologie', code: 'QUAL-DESDEON', editable: true },
    { id: 'des-recl', name: 'Désignation Référent Réclamations', code: 'QUAL-DESRECL', editable: true },
    { id: 'des-veil', name: 'Désignation Référent Veille', code: 'QUAL-DESVEIL', editable: true },
    { id: 'des-amel', name: 'Désignation Référent Amélioration', code: 'QUAL-DESAMEL', editable: true },
    { id: 'des-sign', name: 'Désignation Référent violences, harcèlement et discriminations', code: 'QUAL-DESSIGN', editable: true },
    { id: 'des-rgpd', name: 'Désignation Référent données personnelles', code: 'QUAL-DESRGPD', editable: true },
    { id: 'des-peda', name: 'Désignation Référent pédagogique', code: 'QUAL-DESPEDA', editable: true },
  ]},
  // Procédures, documents stagiaires et clients, fiches : nouveau modèle (richdocs/templates.js)
  registres: { name: 'Registres', icon: Table, color: 'purple', docs: [
    { id: 'reg-recl', name: 'Registre réclamations', code: 'QUAL-REGREC', table: 'reclamations' },
    { id: 'reg-nc', name: 'Registre non-conformités', code: 'QUAL-REGNC', table: 'non_conformites' },
    { id: 'reg-veille', name: 'Registre veille', code: 'QUAL-REGVEI', table: 'veille_qualiopi' },
    { id: 'reg-mat', name: 'Registre matériel', code: 'QUAL-REGMAT', table: 'equipment_catalog' },
    { id: 'reg-rgpd', name: 'Registre traitements RGPD', code: 'QUAL-REGRGPD', table: 'rgpd_traitements' },
    { id: 'reg-audit', name: 'Registre audits internes', code: 'QUAL-REGAUD', table: 'audits_internes' },
    { id: 'reg-programmes', name: 'Programmes de formation', code: 'QUAL-REGPROG', table: 'programme_versions' },
    { id: 'reg-psh', name: 'Registre PSH (Ind. 26)', code: 'QUAL-REGPSH', table: 'psh_requests' },
  ]},
  checklists: { name: 'Check-lists', icon: CheckSquare, color: 'orange', docs: [
    { id: 'ck-materiel', name: 'Checklist matériel formation', code: 'QUAL-CKMAT', editable: true },
  ]},
  pilotage: { name: 'Pilotage', icon: BarChart3, color: 'teal', docs: [
    { id: 'rdd', name: 'Revue de direction', code: 'QUAL-RDD', computed: true },
    { id: 'plan-action', name: 'Plan d\'actions', code: 'QUAL-PLAN', editable: true },
    { id: 'carto-risques', name: 'Cartographie des risques qualité', code: 'QUAL-RISQ', indicateur: '32', editable: true },
    { id: 'indicateurs', name: 'Tableau des indicateurs', code: 'QUAL-INDIC', computed: true },
  ]},
  soustraitance: { name: 'Sous-traitance', icon: Users2, color: 'gray', docs: [
    { id: 'contrat-st', name: 'Contrat sous-traitance', code: 'QUAL-CTRAIT', editable: true },
    { id: 'charte-st', name: 'Charte qualité prestataire', code: 'QUAL-CHARTE', editable: true },
    { id: 'nda', name: 'Accord de confidentialité', code: 'QUAL-NDA', editable: true },
  ]},
}

// Désignations : rôle qualité (personne, suppléant) et ligne des « Fiches de mission des référents »
const DES_ROLE = {
  'des-qual': ['responsable_qualite', 'Responsable qualité'], 'des-hand': ['referent_handicap', 'Référent handicap'],
  'des-deon': ['referent_deontologie', 'Référent déontologie'], 'des-recl': ['referent_reclamations', 'Référent réclamations'],
  'des-veil': ['referent_veille', 'Référent veille'], 'des-amel': ['referent_amelioration', 'Référent amélioration continue'],
  'des-rgpd': ['referent_rgpd', 'Référent données personnelles'], 'des-sign': ['referent_signalements', 'Référent signalements'],
  'des-peda': ['validation_programmes', 'Référent pédagogique'],
}
const stripMd = (x) => String(x || '').replace(/\*\*([^*]+)\*\*/g, '$1').trim()
/** Ligne de mission d'un rôle dans le document des fiches de mission (brouillon, version validée ou modèle) */
async function missionRow(label) {
  const pub = await loadPublishedDoc('des-fiches')
  for (const sec of pub?.content?.sections || []) {
    for (const b of sec.blocks || []) {
      if (b.t !== 'table') continue
      const row = (b.rows || []).find((r) => stripMd(r[0]).toLowerCase() === label.toLowerCase())
      if (row) {
        return { mission: stripMd(row[1]), missions: [stripMd(row[2])].filter(Boolean), competences: stripMd(row[3]), publie: stripMd(row[4]) }
      }
    }
  }
  return {}
}

// ===== DONNÉES PAR DÉFAUT =====
const DEFAULT_DATA = {
  'organigramme': {
    direction: [
      { nom: P(0), roles: ['Responsable Qualité', 'Veille légale', 'Réclamations', 'RGPD', 'Commercial', 'Planification'] },
      { nom: P(1), roles: ['Ingénierie pédagogique', 'Veille métiers', 'Amélioration continue', 'Déontologie', 'Handicap'] },
    ],
    formateurs: [
      { nom: P(0), specialites: ['SST', 'Incendie', 'Habilitation électrique'] },
      { nom: P(1), specialites: ['SST', 'Gestes & postures', 'Incendie', 'Conduite de chariots'] },
    ],
  },
  'des-qual': { personne: '{{role.responsable_qualite}}', role: 'Responsable Qualité', date: format(new Date(), 'yyyy-MM-dd'), missions: ['Piloter le système qualité', 'Suivre les indicateurs', 'Préparer les audits', 'Proposer les améliorations', 'Garantir la conformité Qualiopi'] },
  'des-hand': { personne: '{{role.referent_handicap}}', role: 'Référent Handicap', date: format(new Date(), 'yyyy-MM-dd'), missions: ['Accueillir les PSH', 'Identifier les besoins d\'adaptation', 'Lien avec Agefiph/MDPH', 'Sensibiliser l\'équipe', 'Suivre les aménagements'] },
  'des-deon': { personne: '{{role.referent_deontologie}}', role: 'Référent Déontologie', date: format(new Date(), 'yyyy-MM-dd'), missions: ['Veiller au respect des règles éthiques', 'Traiter les signalements', 'Conseiller la direction', 'Sensibiliser l\'équipe'] },
  'des-recl': { personne: '{{role.referent_reclamations}}', role: 'Référent Réclamations', date: format(new Date(), 'yyyy-MM-dd'), missions: ['Réceptionner les réclamations', 'Analyser les causes', 'Clôturer sous 5 jours ouvrés', 'Communiquer les résultats', 'Proposer des actions préventives'] },
  'des-veil': { personne: '{{role.referent_veille}}', role: 'Référent Veille', date: format(new Date(), 'yyyy-MM-dd'), missions: ['Veille réglementaire mensuelle', 'Suivre les référentiels INRS', 'Informer l\'équipe sous 30 jours', 'Mettre à jour les documents'] },
  'des-amel': { personne: '{{role.referent_amelioration}}', role: 'Référent Amélioration Continue', date: format(new Date(), 'yyyy-MM-dd'), missions: ['Analyser les NC', 'Suivre les actions correctives', 'Animer l\'amélioration continue', 'Mesurer l\'efficacité', 'Préparer la RDD'] },
  'des-peda': { personne: '{{role.validation_programmes}}', role: 'Référent pédagogique', date: format(new Date(), 'yyyy-MM-dd'), missions: [] },
  'des-sign': { personne: '{{role.referent_signalements}}', role: 'Référent violences, harcèlement et discriminations', date: format(new Date(), 'yyyy-MM-dd'), missions: ['Recevoir les signalements de violences, harcèlement, agissements sexistes et discriminations', 'Écouter, orienter et protéger la victime', 'Conduire l\'examen des faits avec un second membre de la direction', 'Proposer les mesures et suivre la victime un mois après', 'Établir le bilan annuel anonymisé'] },
  'des-rgpd': { personne: '{{role.referent_rgpd}}', role: 'Référent données personnelles', date: format(new Date(), 'yyyy-MM-dd'), missions: ['Conformité RGPD', 'Registre des traitements', 'Répondre aux demandes de droits', 'Sensibiliser le personnel', 'Gérer les violations'] },
  'proc-recl': { 
    objectif: 'Définir les modalités de traitement des réclamations pour garantir la satisfaction des parties prenantes.',
    responsable: P(0), delaiAccuse: '48h', delaiCloture: '5 jours ouvrés',
    indicateurs: ['Nombre de réclamations', 'Délai moyen de traitement', 'Taux de clôture'],
    swimlanes: [
      { acteur: 'Client/Stagiaire', etape: 'Émet une réclamation', delai: '-', output: 'Réclamation reçue' },
      { acteur: 'Réf. Réclamations', etape: 'Réceptionne et enregistre', delai: 'Immédiat', output: 'N° enregistrement' },
      { acteur: 'Réf. Réclamations', etape: 'Accuse réception', delai: '48h', output: 'Mail/courrier AR' },
      { acteur: 'Réf. Réclamations', etape: 'Analyse les causes', delai: '2 jours', output: 'Analyse causale' },
      { acteur: 'Réf. Réclamations', etape: 'Propose une solution', delai: '-', output: 'Proposition' },
      { acteur: 'Direction', etape: 'Valide la solution', delai: '-', output: 'Validation' },
      { acteur: 'Réf. Réclamations', etape: 'Met en œuvre et informe', delai: '-', output: 'Action réalisée' },
      { acteur: 'Réf. Réclamations', etape: 'Vérifie efficacité et clôture', delai: '5j ouvrés max', output: 'Dossier clôturé' },
    ],
  },
  'proc-nc': {
    objectif: 'Définir les modalités de traitement des non-conformités pour l\'amélioration continue.',
    responsable: P(1), delaiTraitement: '5 jours ouvrés',
    indicateurs: ['Nombre de NC', 'Délai de traitement', 'Taux NC récurrentes'],
    swimlanes: [
      { acteur: 'Toute l\'équipe', etape: 'Détecte une NC', delai: '-', output: 'Signalement' },
      { acteur: 'Réf. Amélioration', etape: 'Enregistre la NC', delai: 'Immédiat', output: 'Fiche NC' },
      { acteur: 'Réf. Amélioration', etape: 'Analyse causes (5P)', delai: '2 jours', output: 'Causes identifiées' },
      { acteur: 'Réf. Amélioration', etape: 'Définit action corrective', delai: '-', output: 'Action proposée' },
      { acteur: 'Direction', etape: 'Valide l\'action', delai: '-', output: 'Validation' },
      { acteur: 'Responsable désigné', etape: 'Met en œuvre', delai: '5j ouvrés', output: 'Action réalisée' },
      { acteur: 'Réf. Amélioration', etape: 'Vérifie efficacité', delai: '-', output: 'Contrôle OK/KO' },
      { acteur: 'Réf. Amélioration', etape: 'Clôture NC', delai: '-', output: 'NC clôturée' },
    ],
  },
  'proc-sat': {
    objectif: 'Définir les modalités de recueil et d\'analyse de la satisfaction.',
    responsable: P(0),
    indicateurs: ['Score satisfaction (cible: >4/5)', 'Taux de réponse', 'Taux recommandation'],
    swimlanes: [
      { acteur: 'Formateur', etape: 'Termine la formation', delai: '-', output: 'Formation terminée' },
      { acteur: 'Formateur', etape: 'Distribue évaluation à chaud', delai: 'Immédiat', output: 'QR code/lien' },
      { acteur: 'Stagiaire', etape: 'Complète l\'évaluation', delai: '-', output: 'Réponses enregistrées' },
      { acteur: 'Application', etape: 'Envoie évaluation J+90', delai: '90 jours', output: 'Email automatique' },
      { acteur: 'Application', etape: 'Génère alertes si score <4', delai: 'Automatique', output: 'Alerte qualité' },
      { acteur: 'Réf. Qualité', etape: 'Analyse les résultats', delai: 'Mensuel', output: 'Synthèse' },
      { acteur: 'Réf. Qualité', etape: 'Déclenche action si nécessaire', delai: '-', output: 'Fiche action' },
    ],
  },
  'proc-veille': {
    objectif: 'Définir les modalités de veille légale, réglementaire et pédagogique.',
    responsable: P(0), frequence: 'Mensuelle', delaiMiseAJour: '30 jours',
    sources: ['Code du travail', 'INRS (SST, R485, R489)', 'NF C18-510', 'Légifrance', 'Centre Inffo'],
    indicateurs: ['Nombre de veilles', 'Délai de mise à jour'],
    swimlanes: [
      { acteur: 'Réf. Veille', etape: 'Consulte les sources', delai: 'Mensuel', output: 'Informations collectées' },
      { acteur: 'Réf. Veille', etape: 'Identifie les évolutions', delai: '-', output: 'Fiche veille' },
      { acteur: 'Réf. Veille', etape: 'Analyse l\'impact sur AF', delai: '-', output: 'Note d\'impact' },
      { acteur: 'Direction', etape: 'Valide les actions', delai: '-', output: 'Validation' },
      { acteur: 'Responsable désigné', etape: 'Met à jour documents/process', delai: '30 jours', output: 'Documents à jour' },
      { acteur: 'Réf. Veille', etape: 'Archive dans registre', delai: '-', output: 'Registre à jour' },
    ],
  },
  'ck-audit': { items: ['Vérifier la documentation qualité', 'Contrôler les enregistrements', 'Évaluer la conformité aux procédures', 'Identifier les écarts', 'Proposer des améliorations'] },
  'ck-accueil': { items: ['Vérifier l\'identité du stagiaire', 'Faire signer la feuille d\'émargement', 'Présenter le programme', 'Expliquer les règles de sécurité', 'Distribuer les supports'] },
  'ck-cloture': { items: ['Récupérer les émargements signés', 'Faire compléter les évaluations à chaud', 'Remettre les attestations', 'Ranger le matériel', 'Transmettre les documents au siège'] },
  'ck-materiel': { items: ['Vérifier le matériel de sécurité', 'Contrôler les mannequins SST', 'Tester le défibrillateur', 'Vérifier les extincteurs de démonstration', 'Préparer les supports de cours'] },
  // Procédures supplémentaires
  'proc-besoin': {
    objectif: 'Définir les modalités d\'analyse des besoins des clients et bénéficiaires.',
    responsable: P(0),
    indicateurs: ['Taux de conformité des analyses', 'Satisfaction client sur l\'analyse'],
    swimlanes: [
      { acteur: 'Commercial', etape: 'Reçoit la demande', delai: '-', output: 'Demande enregistrée' },
      { acteur: 'Commercial', etape: 'Identifie les besoins', delai: '48h', output: 'Fiche besoins' },
      { acteur: 'Réf. Pédagogique', etape: 'Analyse les prérequis', delai: '-', output: 'Analyse prérequis' },
      { acteur: 'Réf. Pédagogique', etape: 'Propose le programme adapté', delai: '-', output: 'Programme personnalisé' },
      { acteur: 'Direction', etape: 'Valide et chiffre', delai: '-', output: 'Devis' },
      { acteur: 'Commercial', etape: 'Transmet au client', delai: '48h', output: 'Devis envoyé' },
    ],
  },
  'proc-concep': {
    objectif: 'Définir les modalités de conception des actions de formation.',
    responsable: P(1),
    indicateurs: ['Conformité aux référentiels', 'Validation pédagogique'],
    swimlanes: [
      { acteur: 'Réf. Pédagogique', etape: 'Analyse le référentiel', delai: '-', output: 'Analyse référentiel' },
      { acteur: 'Réf. Pédagogique', etape: 'Définit les objectifs', delai: '-', output: 'Objectifs pédagogiques' },
      { acteur: 'Réf. Pédagogique', etape: 'Conçoit le programme', delai: '-', output: 'Programme de formation' },
      { acteur: 'Réf. Pédagogique', etape: 'Crée les supports', delai: '-', output: 'Supports pédagogiques' },
      { acteur: 'Direction', etape: 'Valide la conception', delai: '-', output: 'Validation' },
      { acteur: 'Réf. Qualité', etape: 'Archive', delai: '-', output: 'Documentation archivée' },
    ],
  },
  'proc-real': {
    objectif: 'Définir les modalités de réalisation des formations.',
    responsable: P(1),
    indicateurs: ['Taux de réalisation', 'Taux d\'assiduité'],
    swimlanes: [
      { acteur: 'Formateur', etape: 'Prépare la session', delai: 'J-1', output: 'Session prête' },
      { acteur: 'Formateur', etape: 'Accueille les stagiaires', delai: 'J', output: 'Émargement signé' },
      { acteur: 'Formateur', etape: 'Déroule le programme', delai: '-', output: 'Formation en cours' },
      { acteur: 'Formateur', etape: 'Évalue les acquis', delai: '-', output: 'Évaluation réalisée' },
      { acteur: 'Formateur', etape: 'Clôture la session', delai: 'J', output: 'Documents complets' },
      { acteur: 'Administratif', etape: 'Archive les documents', delai: 'J+1', output: 'Dossier archivé' },
    ],
  },
  'proc-eval': {
    objectif: 'Définir les modalités d\'évaluation des acquis des stagiaires.',
    responsable: P(1),
    indicateurs: ['Taux de réussite', 'Taux de certification'],
    swimlanes: [
      { acteur: 'Formateur', etape: 'Évalue en continu', delai: '-', output: 'Évaluations formatives' },
      { acteur: 'Formateur', etape: 'Réalise l\'évaluation finale', delai: 'Fin formation', output: 'Grille d\'évaluation' },
      { acteur: 'Formateur', etape: 'Analyse les résultats', delai: '-', output: 'Résultats analysés' },
      { acteur: 'Formateur', etape: 'Délivre l\'attestation', delai: '-', output: 'Attestation/Certificat' },
      { acteur: 'Administratif', etape: 'Archive', delai: 'J+1', output: 'PV archivé' },
    ],
  },
  'proc-hand': {
    objectif: 'Définir les modalités d\'accueil et d\'accompagnement des PSH.',
    responsable: P(1),
    indicateurs: ['Nombre de PSH accueillis', 'Taux d\'adaptations réalisées'],
    swimlanes: [
      { acteur: 'Commercial', etape: 'Identifie le besoin PSH', delai: '-', output: 'Besoin identifié' },
      { acteur: 'Réf. Handicap', etape: 'Évalue les adaptations', delai: '48h', output: 'Fiche adaptation' },
      { acteur: 'Réf. Handicap', etape: 'Contacte les partenaires', delai: '-', output: 'Contacts établis' },
      { acteur: 'Réf. Handicap', etape: 'Met en place les aménagements', delai: 'Avant formation', output: 'Aménagements prêts' },
      { acteur: 'Formateur', etape: 'Accueille le stagiaire PSH', delai: 'J', output: 'Accueil adapté' },
      { acteur: 'Réf. Handicap', etape: 'Suit et ajuste', delai: '-', output: 'Suivi réalisé' },
    ],
  },
  'proc-rgpd': {
    objectif: 'Définir les modalités de protection des données personnelles.',
    responsable: P(0),
    indicateurs: ['Conformité RGPD', 'Nombre de demandes traitées'],
    swimlanes: [
      { acteur: 'DPO', etape: 'Tient le registre des traitements', delai: 'Continu', output: 'Registre à jour' },
      { acteur: 'DPO', etape: 'Reçoit une demande de droits', delai: '-', output: 'Demande enregistrée' },
      { acteur: 'DPO', etape: 'Vérifie l\'identité', delai: '48h', output: 'Identité vérifiée' },
      { acteur: 'DPO', etape: 'Traite la demande', delai: '30 jours', output: 'Demande traitée' },
      { acteur: 'DPO', etape: 'Répond au demandeur', delai: '-', output: 'Réponse envoyée' },
      { acteur: 'DPO', etape: 'Archive', delai: '-', output: 'Dossier archivé' },
    ],
  },
  // Sous-traitance
  'contrat-st': {
    prestataire: '', objet: '', duree: '', montant: '',
    obligations: ['Respecter le cahier des charges', 'Garantir la qualité des prestations', 'Respecter le référentiel national qualité (articles L6316-1 et R6316-1 du code du travail) pour les prestations confiées et en fournir les preuves sur demande', 'Fournir les justificatifs demandés (certificat Qualiopi le cas échéant, CV, attestations, assurance)', 'Respecter la confidentialité'],
    conditions: ['Paiement à 30 jours', 'Résiliation sous préavis de 30 jours'],
  },
  'charte-st': {
    engagements: ['Respecter les exigences Qualiopi', 'Transmettre les documents dans les délais', 'Participer aux audits qualité', 'Signaler tout incident', 'Maintenir les certifications à jour'],
  },
  'nda': {
    parties: [raisonSociale(), ''],
    duree: '5 ans après fin du contrat',
    informations: ['Données clients', 'Données stagiaires', 'Supports pédagogiques', 'Méthodes et process'],
  },
  // Indicateur 12 (référentiel au 1er novembre 2026)
  'proc-vss': {
    objectif: 'Prévenir toute situation de violence, dont les violences sexistes et sexuelles, de harcèlement ou de discrimination pendant les formations, permettre à toute personne de la signaler et garantir son traitement sans délai.',
    responsable: P(0), delaiAccuse: '24h', delaiTraitement: '5 jours ouvrés',
    indicateurs: ['Nombre de signalements', 'Délai de prise en charge', 'Mesures de protection mises en place', 'Actions de prévention menées'],
    swimlanes: [
      { acteur: 'Stagiaire, témoin ou formateur', etape: 'Signale la situation (oral, écrit, formulaire de réclamation, email au référent signalements)', delai: 'Dès que possible', output: 'Signalement reçu' },
      { acteur: 'Formateur', etape: 'Fait cesser la situation et met la personne en sécurité', delai: 'Immédiat', output: 'Mesures conservatoires' },
      { acteur: 'Référent signalements', etape: 'Accuse réception et reçoit la personne en toute confidentialité', delai: '24h', output: 'Entretien, écoute' },
      { acteur: 'Référent signalements', etape: 'Informe la personne de ses droits et des recours possibles (employeur, inspection du travail, Défenseur des droits, dépôt de plainte)', delai: '24h', output: 'Information remise' },
      { acteur: 'Direction', etape: 'Analyse les faits et décide des mesures (exclusion de la session, information de l\'employeur, sanction prévue au règlement intérieur)', delai: '5 jours ouvrés', output: 'Décision écrite' },
      { acteur: 'Référent signalements', etape: 'Enregistre le signalement et ses suites, sans détail inutile sur les personnes', delai: '5 jours ouvrés', output: 'Trace confidentielle' },
      { acteur: 'Responsable qualité', etape: 'Analyse les causes et prévient la récidive (sensibilisation des formateurs, règlement intérieur, livret d\'accueil)', delai: '30 jours', output: 'Action d\'amélioration' },
    ],
  },
  // Indicateur 32 (référentiel au 1er novembre 2026) : gravité et probabilité de 1 à 4
  'carto-risques': {
    revue: 'Annuelle, et après chaque réclamation ou non-conformité',
    risques: [
      { processus: "Réalisation (P07, D05)", risque: "Accident d'un stagiaire en séquence pratique (atteinte à la personne, responsabilité)", gravite: 4, probabilite: 2, maitrise: "Consignes, EPI obligatoires, matériel vérifié, formateur qualifié", action: '', responsable: P(0), echeance: '' },
      { processus: "Compétences (P14)", risque: "Formateur dont la qualification a expiré (formation et certificats non valables)", gravite: 4, probabilite: 2, maitrise: "Matrice, alerte 3 mois avant", action: '', responsable: P(0), echeance: '' },
      { processus: "Réclamations (P01, P13)", risque: "Formateur indisponible au dernier moment (session annulée, client mécontent)", gravite: 3, probabilite: 2, maitrise: "Remplaçants référencés, procédure aléas", action: '', responsable: P(0), echeance: '' },
      { processus: "Réalisation (P07)", risque: "Session démarrée sans convention signée (litige, non-paiement, écart d'audit)", gravite: 3, probabilite: 2, maitrise: "Alerte dans l'outil, check-list B", action: '', responsable: P(0), echeance: '' },
      { processus: "Réalisation (P07, P15)", risque: "Émargement incomplet ou absent (financement refusé, écart d'audit)", gravite: 3, probabilite: 2, maitrise: "Émargement numérique, contrôle le soir", action: '', responsable: P(0), echeance: '' },
      { processus: "Analyse du besoin (P05, P09)", risque: "Besoin d'adaptation non repéré (exclusion de fait d'une personne, discrimination)", gravite: 4, probabilite: 2, maitrise: "Question systématique, référent handicap", action: '', responsable: P(0), echeance: '' },
      { processus: "Accessibilité (P10)", risque: "Lieu inaccessible découvert le jour même (personne ne pouvant suivre la formation)", gravite: 3, probabilite: 2, maitrise: "Fiches lieux, information dans la convocation", action: '', responsable: P(0), echeance: '' },
      { processus: "Violences et discriminations (P11)", risque: "Violence, harcèlement ou discrimination non traité (atteinte à la personne, responsabilité, image)", gravite: 4, probabilite: 1, maitrise: "Référent et suppléant, cadre annoncé, délais", action: '', responsable: P(0), echeance: '' },
      { processus: "Réclamations (P01)", risque: "Réclamation non traitée dans les délais (perte du client, écart d'audit)", gravite: 2, probabilite: 2, maitrise: "Accusé automatique, alertes", action: '', responsable: P(0), echeance: '' },
      { processus: "Appréciations (P03)", risque: "Avis négatifs non exploités (mêmes défauts répétés)", gravite: 2, probabilite: 2, maitrise: "Alerte par avis négatif, synthèse trimestrielle", action: '', responsable: P(0), echeance: '' },
      { processus: "Veille (P04, P06)", risque: "Programme non conforme au référentiel technique à jour (certificat contestable)", gravite: 4, probabilite: 2, maitrise: "Veille, revue annuelle des programmes", action: '', responsable: P(0), echeance: '' },
      { processus: "Appréciations (P03)", risque: "Information publiée inexacte (résultats, certification) (pratique commerciale trompeuse, écart d'audit)", gravite: 3, probabilite: 1, maitrise: "Calcul automatique, méthode publiée", action: '', responsable: P(0), echeance: '' },
      { processus: "Sous-traitance (P13)", risque: "Sous-traitant non conforme ou non qualifié (prestation défaillante, responsabilité)", gravite: 3, probabilite: 2, maitrise: "Dossier complet, évaluation annuelle", action: '', responsable: P(0), echeance: '' },
      { processus: "Sous-traitance (P13)", risque: "Absence d'attestation de vigilance d'un sous-traitant (solidarité financière en cas de travail dissimulé)", gravite: 3, probabilite: 2, maitrise: "Relance tous les 6 mois", action: '', responsable: P(0), echeance: '' },
      { processus: "Données personnelles (P12)", risque: "Fuite ou perte de données personnelles (atteinte aux personnes, sanction CNIL)", gravite: 3, probabilite: 2, maitrise: "Droits limités, sauvegardes, procédure incident", action: '', responsable: P(0), echeance: '' },
      { processus: "Accessibilité (P10, P12)", risque: "Indisponibilité de l'outil de gestion (sessions et documents bloqués)", gravite: 3, probabilite: 1, maitrise: "Sauvegardes, versions papier de repli", action: '', responsable: P(0), echeance: '' },
      { processus: "Organisation (D01)", risque: "Dépendance à une seule personne clé (activité arrêtée en cas d'absence)", gravite: 4, probabilite: 2, maitrise: "Suppléants, procédures écrites", action: '', responsable: P(0), echeance: '' },
      { processus: "Pilotage (D11)", risque: "Échéance réglementaire manquée (audit, bilan, déclaration) (perte de la certification ou de l'enregistrement)", gravite: 4, probabilite: 1, maitrise: "Échéances suivies dans le module Certification", action: '', responsable: P(0), echeance: '' },
      { processus: "Pilotage (D11)", risque: "Dépendance à un client ou à un donneur d'ordre principal (fragilité financière)", gravite: 3, probabilite: 2, maitrise: "Suivi de la répartition du chiffre d'affaires en revue", action: '', responsable: P(0), echeance: '' },
      { processus: "Conditions de vente (D06)", risque: "Impayé ou refus de prise en charge d'un financeur (trésorerie)", gravite: 2, probabilite: 3, maitrise: "Accord de prise en charge avant début, CGV", action: '', responsable: P(0), echeance: '' },
      { processus: "Réalisation (P07)", risque: "Matériel de formation défectueux ou insuffisant (séquence pratique impossible, risque)", gravite: 3, probabilite: 2, maitrise: "Vérification la veille, liste par session", action: '', responsable: P(0), echeance: '' },
      { processus: "Analyse du besoin (P05, P08)", risque: "Stagiaire sans les prérequis (échec, risque en pratique)", gravite: 3, probabilite: 2, maitrise: "Vérification avant la session", action: '', responsable: P(0), echeance: '' },
    ],
  },
  // Pilotage
  'plan-action': {
    actions: [
      { action: '', responsable: P(0), echeance: '', statut: 'en_cours', priorite: 'normale' }
    ],
  },
}

// ===== COMPOSANT PRINCIPAL =====
export default function QualiteEditables() {
  const [expandedCats, setExpandedCats] = useState(['gouvernance'])
  const [activeTab, setActiveTab] = useState('documents')
  const [generating, setGenerating] = useState(false)
  const [editingDoc, setEditingDoc] = useState(null)
  const [editData, setEditData] = useState({})
  const [saving, setSaving] = useState(false)
  const [savedDocs, setSavedDocs] = useState({})
  const [registreData, setRegistreData] = useState({})
  const [loadingData, setLoadingData] = useState(false)
  const [rddData, setRddData] = useState(null)
  // Nouveau modèle (procédures, documents stagiaires et clients, gouvernance, pilotage, fiches)
  const [templates, setTemplates] = useState(null)
  const [richOpen, setRichOpen] = useState(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('tous')
  useEffect(() => { loadTemplates().then(setTemplates).catch((e) => toast.error(e.message)) }, [])
  // Lien direct vers un document (?doc=reglement), depuis la page Qualiopi ou Paramètres
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const id = params.get('doc')
    if (id && templates?.[id]) setRichOpen(id)
  }, [templates, params])
  
  // Champs {{org.*}}, {{role.*}} : remplis à l'affichage depuis Paramètres (identité et rôles qualité)
  const [tplCtx, setTplCtx] = useState(null)
  useEffect(() => {
    loadSavedDocs()
    supabase.from('organization_settings').select('*').limit(1).maybeSingle().then(({ data }) => syncOrg(data))
    loadTemplateContext(true).then(setTplCtx).catch(() => {})
  }, [])
  
  const loadSavedDocs = async () => {
    const { data } = await supabase.from('quality_documents').select('*')
    if (data) {
      const docs = {}
      data.forEach(d => { docs[d.doc_id] = d.content })
      setSavedDocs(docs)
    }
  }
  
  const richPDF = async (tpl) => {
    setGenerating(true)
    try {
      const content = isRich(savedDocs[tpl.id]) ? savedDocs[tpl.id] : fromTemplate(tpl)
      const [{ data: history }, ORG, ctx] = await Promise.all([
        supabase.from('quality_doc_versions').select('*').eq('doc_id', tpl.id).order('version', { ascending: false }),
        loadPdfOrg(true),
        tplCtx ? Promise.resolve(tplCtx) : loadTemplateContext(),
      ])
      const r = buildRichDocPDF(ORG, { tpl, code: docCode(tpl.code), content, ctx, history: history || [] })
      r.doc.save(r.filename)
    } catch (e) { console.error(e); toast.error('Erreur PDF') }
    setGenerating(false)
  }

  const toggleCat = (id) => setExpandedCats(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id])
  const getColor = (c) => ({ blue: 'bg-[rgb(var(--c-info))]', green: 'bg-[rgb(var(--c-success))]', purple: 'bg-gray-700', orange: 'bg-[rgb(var(--c-warning))]', teal: 'bg-gray-700', gray: 'bg-gray-500' }[c] || 'bg-gray-500')
  
  const openEditor = (docId) => {
    const saved = savedDocs[docId]
    const defaults = DEFAULT_DATA[docId] || {}
    setEditData(saved || defaults)
    setEditingDoc(docId)
  }
  
  const saveDocument = async () => {
    setSaving(true)
    try {
      const docInfo = findDocInfo(editingDoc)
      const { error } = await supabase.from('quality_documents').upsert({
        doc_id: editingDoc, code: docInfo?.code || editingDoc, name: docInfo?.name || editingDoc,
        content: editData, updated_at: new Date().toISOString()
      }, { onConflict: 'doc_id' })
      if (error) throw error
      setSavedDocs(prev => ({ ...prev, [editingDoc]: editData }))
      toast.success('Document sauvegardé !')
      setEditingDoc(null)
    } catch (e) { console.error(e); toast.error('Erreur de sauvegarde') }
    setSaving(false)
  }
  
  const findDocInfo = (docId) => {
    for (const cat of Object.values(QUALITY_DOCS)) {
      const doc = cat.docs.find(d => d.id === docId)
      if (doc) return doc
    }
    return null
  }
  
  const loadRegistre = async (table) => {
    setLoadingData(true)
    try {
      const { data, error } = await supabase.from(table).select('*').order('created_at', { ascending: false })
      if (error) toast.error(`Erreur: ${error.message}`)
      else setRegistreData(prev => ({ ...prev, [table]: data || [] }))
    } catch (e) { console.error(e) }
    setLoadingData(false)
  }
  
  const loadRDD = async () => {
    setLoadingData(true)
    const now = new Date()
    const startDate = now.getMonth() >= 7 ? new Date(now.getFullYear(), 7, 1) : new Date(now.getFullYear() - 1, 7, 1)
    
    try {
      // Charger TOUTES les sessions avec leurs stagiaires
      const { data: sessions, error: sessErr } = await supabase
        .from('sessions')
        .select('id, status, start_date, session_trainees(id)')
      
      if (sessErr) console.error('Sessions error:', sessErr)
      
      // Charger toutes les évaluations à chaud
      const { data: evalData, error: evalErr } = await supabase
        .from('trainee_evaluations')
        .select('*')
      
      if (evalErr) console.error('Evals error:', evalErr)
      
      const evals = evalData || []
      
      // Calculer la satisfaction (moyenne des notes q_* sur 5)
      const qKeys = [
        'q_org_documents', 'q_org_accueil', 'q_org_locaux', 'q_org_materiel',
        'q_contenu_organisation', 'q_contenu_supports', 'q_contenu_duree', 'q_contenu_programme',
        'q_formateur_pedagogie', 'q_formateur_expertise', 'q_formateur_progression', 'q_formateur_moyens',
        'q_global_adequation', 'q_global_competences'
      ]
      
      let allScores = []
      evals.forEach(e => {
        qKeys.forEach(key => {
          if (e[key] !== null && e[key] !== undefined) {
            allScores.push(Number(e[key]))
          }
        })
      })
      
      const avgScore = allScores.length > 0 ? (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(1) : 'N/A'
      
      // Taux de recommandation
      const withReco = evals.filter(e => e.would_recommend !== null && e.would_recommend !== undefined)
      const tauxReco = withReco.length > 0 
        ? Math.round((withReco.filter(e => e.would_recommend === true).length / withReco.length) * 100) 
        : 'N/A'
      
      // Charger réclamations et NC
      const { data: recl } = await supabase.from('reclamations').select('id, status')
      const { data: ncs } = await supabase.from('non_conformites').select('id, status')
      
      const allSessions = sessions || []
      
      // Compter les stagiaires de TOUTES les sessions (pas de filtre date)
      const totalStagiaires = allSessions.reduce((acc, s) => acc + (s.session_trainees?.length || 0), 0)
      
      // Debug log pour vérifier
      console.log('RDD Debug:', {
        totalSessions: allSessions.length,
        completedSessions: allSessions.filter(s => s.status === 'completed').length,
        stagiaires: totalStagiaires,
        evaluationsCount: evals.length,
        scoresCount: allScores.length,
        avgScore: avgScore,
        tauxReco: tauxReco
      })
      
      setRddData({
        periode: { start: startDate, end: now },
        sessions: { 
          total: allSessions.length, 
          terminees: allSessions.filter(s => s.status === 'completed').length 
        },
        stagiaires: totalStagiaires,
        satisfaction: { score: avgScore, tauxReco },
        reclamations: { total: (recl || []).length, cloturees: (recl || []).filter(r => r.status === 'resolved' || r.status === 'closed').length },
        nc: { total: (ncs || []).length, cloturees: (ncs || []).filter(n => n.status === 'closed').length },
      })
    } catch (e) { console.error(e); toast.error('Erreur chargement RDD') }
    setLoadingData(false)
  }
  
  useEffect(() => { if (activeTab === 'rdd') loadRDD() }, [activeTab])
  
  // ===== GÉNÉRATION PDF =====
  const generatePDF = async (docId, docInfo) => {
    setGenerating(true)
    try {
      const v = APP_VERSION
      const ctx = tplCtx || await loadTemplateContext()
      let data = fillDeep(savedDocs[docId] || DEFAULT_DATA[docId] || {}, ctx)
      if (docId === 'organigramme') {
        const { data: tr } = await supabase.from('trainers').select('first_name, last_name, specialties, qualifications_list, is_internal').order('last_name')
        data = {
          direction: [{ nom: ctx.org.dirigeant || '', roles: [ctx.org.dirigeant_qualite || 'Direction'] }],
          roles: Object.values(ctx.role || {}).filter((r) => r.label).map((r) => ({ label: r.label, nom: r.nom, suppleant: r.suppleant })),
          formateurs: (tr || []).map((x) => ({
            nom: [x.first_name, x.last_name ? String(x.last_name).toUpperCase() : ''].filter(Boolean).join(' '),
            specialites: (Array.isArray(x.qualifications_list) && x.qualifications_list.length ? x.qualifications_list.join(', ') : x.specialties) || '',
            interne: x.is_internal !== false,
          })),
        }
      }
      if (DES_ROLE[docId]) {
        const [code, label] = DES_ROLE[docId]
        data = { date: data.date, personne: ctx.role?.[code]?.nom || '', suppleant: ctx.role?.[code]?.suppleant || '', role: ctx.role?.[code]?.label || label, ...(await missionRow(label)) }
      }
      const pdfOrg = await loadPdfOrg(true)
      const doc = buildQualityDocPDF(pdfOrg, {
        docId, docInfo, code: docCode(docInfo.code), version: v, data, rddData,
        registre: docInfo.table ? (registreData[docInfo.table] || []) : [],
      })
      doc.save(`${docCode(docInfo.code)}-V${v}.pdf`)
      toast.success('PDF généré')
    } catch (e) { console.error(e); toast.error('Erreur PDF') }
    setGenerating(false)
  }
  
  // ===== MODAL ÉDITEUR =====
  const renderEditor = () => {
    if (!editingDoc) return null
    const docInfo = findDocInfo(editingDoc)
    
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-ui shadow-md w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <div className="p-4 border-b flex items-center justify-between bg-gray-50">
            <div><h2 className="font-bold text-lg">{docInfo?.name}</h2><p className="text-ui text-gray-500">{docCode(docInfo?.code)}</p></div>
            <button onClick={() => setEditingDoc(null)} className="p-2 hover:bg-gray-200 rounded-ui-sm"><X className="w-5 h-5" /></button>
          </div>
          
          <div className="p-4 overflow-y-auto flex-1 space-y-4">
            {/* ORGANIGRAMME */}
            {editingDoc === 'organigramme' && (
              <>
                <div>
                  <label className="block text-ui font-medium mb-2">Direction (personnes et rôles)</label>
                  {(editData.direction || DEFAULT_DATA.organigramme.direction).map((dir, idx) => (
                    <div key={idx} className="mb-4 p-3 bg-gray-50 rounded-ui-sm">
                      <input type="text" value={dir.nom} onChange={e => {
                        const newDir = [...(editData.direction || DEFAULT_DATA.organigramme.direction)]
                        newDir[idx] = { ...newDir[idx], nom: e.target.value }
                        setEditData({ ...editData, direction: newDir })
                      }} className="input w-full mb-2" placeholder="Nom" />
                      <label className="text-ui-sm text-gray-500">Rôles (un par ligne)</label>
                      <textarea value={(dir.roles || []).join('\n')} onChange={e => {
                        const newDir = [...(editData.direction || DEFAULT_DATA.organigramme.direction)]
                        newDir[idx] = { ...newDir[idx], roles: e.target.value.split('\n') }
                        setEditData({ ...editData, direction: newDir })
                      }} className="input w-full h-24" />
                    </div>
                  ))}
                </div>
                <div>
                  <label className="block text-ui font-medium mb-2">Formateurs (personnes et spécialités)</label>
                  {(editData.formateurs || DEFAULT_DATA.organigramme.formateurs).map((form, idx) => (
                    <div key={idx} className="mb-4 p-3 bg-gray-50 rounded-ui-sm">
                      <input type="text" value={form.nom} onChange={e => {
                        const newForm = [...(editData.formateurs || DEFAULT_DATA.organigramme.formateurs)]
                        newForm[idx] = { ...newForm[idx], nom: e.target.value }
                        setEditData({ ...editData, formateurs: newForm })
                      }} className="input w-full mb-2" placeholder="Nom" />
                      <input type="text" value={(form.specialites || []).join(', ')} onChange={e => {
                        const newForm = [...(editData.formateurs || DEFAULT_DATA.organigramme.formateurs)]
                        newForm[idx] = { ...newForm[idx], specialites: e.target.value.split(', ') }
                        setEditData({ ...editData, formateurs: newForm })
                      }} className="input w-full" placeholder="Spécialités (séparées par virgule)" />
                    </div>
                  ))}
                </div>
              </>
            )}
            
            {/* DÉSIGNATIONS : personne et suppléant dans Paramètres, mission dans les fiches de mission */}
            {editingDoc.startsWith('des-') && (
              <>
                <div>
                  <label className="block text-ui font-medium mb-1">Personne désignée</label>
                  <div className="input w-full bg-gray-50 text-gray-700">
                    {(DES_ROLE[editingDoc] && tplCtx?.role?.[DES_ROLE[editingDoc][0]]?.nom) || 'Non désignée'}
                    {DES_ROLE[editingDoc] && tplCtx?.role?.[DES_ROLE[editingDoc][0]]?.suppleant ? `, suppléant ${tplCtx.role[DES_ROLE[editingDoc][0]].suppleant}` : ''}
                    <span className="block text-ui-sm text-gray-500 mt-1">Se change dans Paramètres &gt; Qualité et référents</span>
                  </div>
                </div>
                <div>
                  <label className="block text-ui font-medium mb-1">Date de désignation</label>
                  <input type="date" value={editData.date || ''} onChange={e => setEditData({...editData, date: e.target.value})} className="input w-full" />
                </div>
                <div className="rounded-ui-sm bg-gray-50 p-3 text-ui text-gray-700">
                  La mission, les tâches et les compétences attendues viennent des « Fiches de mission des référents ».
                  <button type="button" className="block mt-1 text-primary-600 font-semibold" onClick={() => { setEditingDoc(null); setRichOpen('des-fiches') }}>Ouvrir les fiches de mission</button>
                </div>
              </>
            )}
            
            {/* PROCÉDURES */}
            {editingDoc.startsWith('proc-') && (
              <>
                <div>
                  <label className="block text-ui font-medium mb-1">Objectif</label>
                  <textarea value={editData.objectif || ''} onChange={e => setEditData({...editData, objectif: e.target.value})} className="input w-full h-20" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-ui font-medium mb-1">Responsable</label>
                    <select value={editData.responsable || ''} onChange={e => setEditData({...editData, responsable: e.target.value})} className="input w-full">
                      {teamNames().map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  {editData.delaiAccuse !== undefined && <div><label className="block text-ui font-medium mb-1">Délai AR</label><input type="text" value={editData.delaiAccuse || ''} onChange={e => setEditData({...editData, delaiAccuse: e.target.value})} className="input w-full" /></div>}
                  {editData.delaiCloture !== undefined && <div><label className="block text-ui font-medium mb-1">Délai clôture</label><input type="text" value={editData.delaiCloture || ''} onChange={e => setEditData({...editData, delaiCloture: e.target.value})} className="input w-full" /></div>}
                  {editData.delaiTraitement !== undefined && <div><label className="block text-ui font-medium mb-1">Délai traitement</label><input type="text" value={editData.delaiTraitement || ''} onChange={e => setEditData({...editData, delaiTraitement: e.target.value})} className="input w-full" /></div>}
                </div>
                <div>
                  <label className="block text-ui font-medium mb-1">Indicateurs</label>
                  {(editData.indicateurs || []).map((ind, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <input type="text" value={ind} onChange={e => { const n = [...(editData.indicateurs || [])]; n[i] = e.target.value; setEditData({...editData, indicateurs: n}) }} className="input flex-1" />
                      <button onClick={() => setEditData({...editData, indicateurs: (editData.indicateurs || []).filter((_, idx) => idx !== i)})} className="btn btn-sm btn-secondary"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <button onClick={() => setEditData({...editData, indicateurs: [...(editData.indicateurs || []), '']})} className="btn btn-sm btn-secondary"><Plus className="w-4 h-4 mr-1" /> Ajouter</button>
                </div>
                {editData.swimlanes && (
                  <div>
                    <label className="block text-ui font-medium mb-1">Étapes du logigramme</label>
                    <div className="text-ui-sm text-gray-500 mb-2">Format: Acteur | Étape | Délai | Output</div>
                    {editData.swimlanes.map((row, i) => (
                      <div key={i} className="grid grid-cols-4 gap-1 mb-2">
                        <input type="text" value={row.acteur || ''} onChange={e => { const n = [...editData.swimlanes]; n[i] = {...n[i], acteur: e.target.value}; setEditData({...editData, swimlanes: n}) }} className="input text-ui-sm" placeholder="Acteur" />
                        <input type="text" value={row.etape || ''} onChange={e => { const n = [...editData.swimlanes]; n[i] = {...n[i], etape: e.target.value}; setEditData({...editData, swimlanes: n}) }} className="input text-ui-sm" placeholder="Étape" />
                        <input type="text" value={row.delai || ''} onChange={e => { const n = [...editData.swimlanes]; n[i] = {...n[i], delai: e.target.value}; setEditData({...editData, swimlanes: n}) }} className="input text-ui-sm" placeholder="Délai" />
                        <div className="flex gap-1">
                          <input type="text" value={row.output || ''} onChange={e => { const n = [...editData.swimlanes]; n[i] = {...n[i], output: e.target.value}; setEditData({...editData, swimlanes: n}) }} className="input text-ui-sm flex-1" placeholder="Output" />
                          <button onClick={() => setEditData({...editData, swimlanes: editData.swimlanes.filter((_, idx) => idx !== i)})} className="text-[rgb(var(--c-danger))]"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => setEditData({...editData, swimlanes: [...editData.swimlanes, { acteur: '', etape: '', delai: '', output: '' }]})} className="btn btn-sm btn-secondary"><Plus className="w-4 h-4 mr-1" /> Ajouter étape</button>
                  </div>
                )}
              </>
            )}
            
            {/* CHECKLISTS */}
            {editingDoc.startsWith('ck-') && (
              <div>
                <label className="block text-ui font-medium mb-1">Items de la checklist</label>
                {(editData.items || []).map((item, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <span className="w-6 text-center text-gray-500">{i + 1}.</span>
                    <input type="text" value={item} onChange={e => { const n = [...(editData.items || [])]; n[i] = e.target.value; setEditData({...editData, items: n}) }} className="input flex-1" />
                    <button onClick={() => setEditData({...editData, items: (editData.items || []).filter((_, idx) => idx !== i)})} className="btn btn-sm btn-secondary"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                <button onClick={() => setEditData({...editData, items: [...(editData.items || []), '']})} className="btn btn-sm btn-secondary"><Plus className="w-4 h-4 mr-1" /> Ajouter item</button>
              </div>
            )}
            
            {/* CONTRAT SOUS-TRAITANCE */}
            {editingDoc === 'contrat-st' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-ui font-medium mb-1">Nom du prestataire</label><input type="text" value={editData.prestataire || ''} onChange={e => setEditData({...editData, prestataire: e.target.value})} className="input w-full" /></div>
                  <div><label className="block text-ui font-medium mb-1">Durée du contrat</label><input type="text" value={editData.duree || ''} onChange={e => setEditData({...editData, duree: e.target.value})} className="input w-full" placeholder="ex: 1 an renouvelable" /></div>
                </div>
                <div><label className="block text-ui font-medium mb-1">Objet du contrat</label><textarea value={editData.objet || ''} onChange={e => setEditData({...editData, objet: e.target.value})} className="input w-full h-20" /></div>
                <div><label className="block text-ui font-medium mb-1">Montant</label><input type="text" value={editData.montant || ''} onChange={e => setEditData({...editData, montant: e.target.value})} className="input w-full" /></div>
                <div>
                  <label className="block text-ui font-medium mb-1">Obligations du prestataire</label>
                  {(editData.obligations || []).map((o, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <input type="text" value={o} onChange={e => { const n = [...(editData.obligations || [])]; n[i] = e.target.value; setEditData({...editData, obligations: n}) }} className="input flex-1" />
                      <button onClick={() => setEditData({...editData, obligations: (editData.obligations || []).filter((_, idx) => idx !== i)})} className="btn btn-sm btn-secondary"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <button onClick={() => setEditData({...editData, obligations: [...(editData.obligations || []), '']})} className="btn btn-sm btn-secondary"><Plus className="w-4 h-4 mr-1" /> Ajouter</button>
                </div>
                <div>
                  <label className="block text-ui font-medium mb-1">Conditions particulières</label>
                  {(editData.conditions || []).map((c, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <input type="text" value={c} onChange={e => { const n = [...(editData.conditions || [])]; n[i] = e.target.value; setEditData({...editData, conditions: n}) }} className="input flex-1" />
                      <button onClick={() => setEditData({...editData, conditions: (editData.conditions || []).filter((_, idx) => idx !== i)})} className="btn btn-sm btn-secondary"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <button onClick={() => setEditData({...editData, conditions: [...(editData.conditions || []), '']})} className="btn btn-sm btn-secondary"><Plus className="w-4 h-4 mr-1" /> Ajouter</button>
                </div>
              </>
            )}
            
            {/* CHARTE SOUS-TRAITANCE */}
            {editingDoc === 'charte-st' && (
              <div>
                <label className="block text-ui font-medium mb-1">Engagements qualité du prestataire</label>
                {(editData.engagements || []).map((e, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <span className="w-6 text-center text-gray-500">{i + 1}.</span>
                    <input type="text" value={e} onChange={ev => { const n = [...(editData.engagements || [])]; n[i] = ev.target.value; setEditData({...editData, engagements: n}) }} className="input flex-1" />
                    <button onClick={() => setEditData({...editData, engagements: (editData.engagements || []).filter((_, idx) => idx !== i)})} className="btn btn-sm btn-secondary"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                <button onClick={() => setEditData({...editData, engagements: [...(editData.engagements || []), '']})} className="btn btn-sm btn-secondary"><Plus className="w-4 h-4 mr-1" /> Ajouter engagement</button>
              </div>
            )}
            
            {/* NDA */}
            {editingDoc === 'nda' && (
              <>
                <div>
                  <label className="block text-ui font-medium mb-1">Parties au contrat</label>
                  <input type="text" value={raisonSociale()} disabled className="input w-full mb-2 bg-gray-100" />
                  <input type="text" value={(editData.parties || [])[1] || ''} onChange={e => setEditData({...editData, parties: [raisonSociale(), e.target.value]})} className="input w-full" placeholder="Nom du cocontractant" />
                </div>
                <div><label className="block text-ui font-medium mb-1">Durée de confidentialité</label><input type="text" value={editData.duree || ''} onChange={e => setEditData({...editData, duree: e.target.value})} className="input w-full" placeholder="ex: 5 ans après fin du contrat" /></div>
                <div>
                  <label className="block text-ui font-medium mb-1">Informations confidentielles couvertes</label>
                  {(editData.informations || []).map((info, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <input type="text" value={info} onChange={e => { const n = [...(editData.informations || [])]; n[i] = e.target.value; setEditData({...editData, informations: n}) }} className="input flex-1" />
                      <button onClick={() => setEditData({...editData, informations: (editData.informations || []).filter((_, idx) => idx !== i)})} className="btn btn-sm btn-secondary"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <button onClick={() => setEditData({...editData, informations: [...(editData.informations || []), '']})} className="btn btn-sm btn-secondary"><Plus className="w-4 h-4 mr-1" /> Ajouter</button>
                </div>
              </>
            )}
            
            {/* PLAN D'ACTIONS */}
            {editingDoc === 'plan-action' && (
              <div>
                <label className="block text-ui font-medium mb-2">Actions en cours</label>
                <div className="text-ui-sm text-gray-500 mb-2">Gérez vos actions d'amélioration continue</div>
                {(editData.actions || []).map((act, i) => (
                  <div key={i} className="p-3 bg-gray-50 rounded-ui-sm mb-3">
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <input type="text" value={act.action || ''} onChange={e => { const n = [...(editData.actions || [])]; n[i] = {...n[i], action: e.target.value}; setEditData({...editData, actions: n}) }} className="input col-span-2" placeholder="Description de l'action" />
                      <select value={act.responsable || ''} onChange={e => { const n = [...(editData.actions || [])]; n[i] = {...n[i], responsable: e.target.value}; setEditData({...editData, actions: n}) }} className="input">
                        {teamNames().map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <input type="date" value={act.echeance || ''} onChange={e => { const n = [...(editData.actions || [])]; n[i] = {...n[i], echeance: e.target.value}; setEditData({...editData, actions: n}) }} className="input" />
                      <select value={act.statut || 'en_cours'} onChange={e => { const n = [...(editData.actions || [])]; n[i] = {...n[i], statut: e.target.value}; setEditData({...editData, actions: n}) }} className="input">
                        <option value="en_cours">En cours</option>
                        <option value="terminee">Terminée</option>
                        <option value="annulee">Annulée</option>
                      </select>
                      <select value={act.priorite || 'normale'} onChange={e => { const n = [...(editData.actions || [])]; n[i] = {...n[i], priorite: e.target.value}; setEditData({...editData, actions: n}) }} className="input">
                        <option value="haute">Haute</option>
                        <option value="normale">Normale</option>
                        <option value="basse">Basse</option>
                      </select>
                    </div>
                    <button onClick={() => setEditData({...editData, actions: (editData.actions || []).filter((_, idx) => idx !== i)})} className="text-[rgb(var(--c-danger))] text-ui-sm">Supprimer cette action</button>
                  </div>
                ))}
                <button onClick={() => setEditData({...editData, actions: [...(editData.actions || []), { action: '', responsable: P(0), echeance: '', statut: 'en_cours', priorite: 'normale' }]})} className="btn btn-sm btn-secondary"><Plus className="w-4 h-4 mr-1" /> Ajouter action</button>
              </div>
            )}

            {/* CARTOGRAPHIE DES RISQUES QUALITÉ (indicateur 32) */}
            {editingDoc === 'carto-risques' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-ui font-medium mb-1">Fréquence de revue</label>
                  <input type="text" value={editData.revue || ''} onChange={e => setEditData({...editData, revue: e.target.value})} className="input w-full" />
                </div>
                <div className="text-ui-sm text-gray-500">Gravité et probabilité de 1 (faible) à 4 (forte). Criticité = gravité x probabilité : de 1 à 4 acceptable et surveillé, de 5 à 8 à réduire (action planifiée), de 9 à 16 prioritaire (action immédiate).</div>
                {(editData.risques || []).map((r, i) => {
                  const upd = (k, v) => { const n = [...(editData.risques || [])]; n[i] = {...n[i], [k]: v}; setEditData({...editData, risques: n}) }
                  const crit = (Number(r.gravite) || 0) * (Number(r.probabilite) || 0)
                  return (
                    <div key={i} className="p-3 bg-gray-50 rounded-ui-sm space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-2">
                        <input type="text" value={r.processus || ''} onChange={e => upd('processus', e.target.value)} className="input" placeholder="Processus" />
                        <input type="text" value={r.risque || ''} onChange={e => upd('risque', e.target.value)} className="input" placeholder="Risque sur la qualité des formations" />
                      </div>
                      <div className="grid grid-cols-3 gap-2 items-center">
                        <label className="text-ui-sm">Gravité<select value={r.gravite || 1} onChange={e => upd('gravite', Number(e.target.value))} className="input">{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
                        <label className="text-ui-sm">Probabilité<select value={r.probabilite || 1} onChange={e => upd('probabilite', Number(e.target.value))} className="input">{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
                        <span className={`badge ${crit >= 9 ? 'badge-danger' : crit >= 5 ? 'badge-warning' : 'badge-success'} justify-self-start`}>Criticité {crit}</span>
                      </div>
                      <input type="text" value={r.maitrise || ''} onChange={e => upd('maitrise', e.target.value)} className="input w-full" placeholder="Mesures de maîtrise en place" />
                      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-2">
                        <input type="text" value={r.action || ''} onChange={e => upd('action', e.target.value)} className="input" placeholder="Action à mener" />
                        <select value={r.responsable || ''} onChange={e => upd('responsable', e.target.value)} className="input">
                          {teamNames().map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <input type="date" value={r.echeance || ''} onChange={e => upd('echeance', e.target.value)} className="input" />
                      </div>
                      <button onClick={() => setEditData({...editData, risques: (editData.risques || []).filter((_, idx) => idx !== i)})} className="text-[rgb(var(--c-danger))] text-ui-sm">Retirer ce risque</button>
                    </div>
                  )
                })}
                <button onClick={() => setEditData({...editData, risques: [...(editData.risques || []), { processus: '', risque: '', gravite: 2, probabilite: 2, maitrise: '', action: '', responsable: P(0), echeance: '' }]})} className="btn btn-sm btn-secondary"><Plus className="w-4 h-4 mr-1" /> Ajouter un risque</button>
              </div>
            )}
          </div>
          
          <div className="p-4 border-t bg-gray-50 flex justify-end gap-2">
            <button onClick={() => setEditingDoc(null)} className="btn btn-secondary">Annuler</button>
            <button onClick={saveDocument} disabled={saving} className="btn btn-primary flex items-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Sauvegarder
            </button>
          </div>
        </div>
      </div>
    )
  }
  
  // ===== RENDU =====
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Documents Qualité</h1>
        <p className="text-gray-500">Procédures, documents remis aux stagiaires et aux clients, gouvernance et pilotage : modèles à adapter, versions validées</p>
      </div>
      
      <div className="flex gap-2 border-b">
        {[
          { id: 'documents', icon: FileText, label: 'Documents' }, 
          { id: 'registres', icon: Table, label: 'Registres' }, 
          { id: 'rdd', icon: BarChart3, label: 'Revue Direction' },
          { id: 'completude', icon: CheckCircle, label: 'Complétude', link: '/qualite/completude' }
        ].map(tab => (
          <button 
            key={tab.id} 
            onClick={() => tab.link ? window.location.href = `#${tab.link}` : setActiveTab(tab.id)}
            className={`px-4 py-2 font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === tab.id ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <tab.icon className="w-4 h-4" />{tab.label}
          </button>
        ))}
      </div>
      
      {activeTab === 'documents' && (() => {
        const CATS = [
          { id: 'gouvernance', name: 'Gouvernance', icon: Building2, color: 'blue', legacy: QUALITY_DOCS.gouvernance.docs },
          { id: 'procedures', name: 'Procédures', icon: ClipboardList, color: 'green', legacy: [] },
          { id: 'stagiaires', name: 'Stagiaires et clients', icon: Users2, color: 'purple', legacy: [] },
          { id: 'checklists', name: 'Check-lists', icon: CheckSquare, color: 'orange', legacy: QUALITY_DOCS.checklists.docs },
          { id: 'pilotage', name: 'Pilotage', icon: BarChart3, color: 'teal', legacy: QUALITY_DOCS.pilotage.docs },
          { id: 'soustraitance', name: 'Sous-traitance', icon: Users2, color: 'gray', legacy: QUALITY_DOCS.soustraitance.docs },
          { id: 'fiches', name: 'Fiches modèles', icon: FileText, color: 'gray', legacy: [] },
        ]
        const q = search.trim().toLowerCase()
        const richList = Object.values(templates || {}).sort((x, y) => x.num.localeCompare(y.num))
        const stOf = (t) => docStatus(savedDocs[t.id])
        const needsWork = (t) => ['modele', 'brouillon', 'a_revoir'].includes(stOf(t).code)
        const matchRich = (t) => (!q || `${t.name} ${t.code} ${(t.indicators || []).join(' ')}`.toLowerCase().includes(q))
          && (filter === 'tous' || (filter === 'revoir' && needsWork(t)) || (filter === 'publics' && (t.family === 'stagiaires' || savedDocs[t.id]?.diffusion?.portail)))
        const matchLegacy = (d) => filter === 'tous' && (!q || `${d.name} ${d.code} ${d.indicateur || ''}`.toLowerCase().includes(q))
        const toReview = richList.filter((t) => stOf(t).code === 'a_revoir').length
        return (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <input type="search" className="input flex-1" placeholder="Rechercher un document, un code ou un indicateur" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher un document" />
              <div className="inline-flex rounded-ui-sm bg-gray-100 p-0.5 self-start" role="group" aria-label="Filtre">
                {[['tous', 'Tous'], ['revoir', 'À traiter'], ['publics', 'Publics']].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setFilter(k)} className={`h-9 px-3 rounded-ui-sm text-ui font-semibold ${filter === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'}`}>{l}</button>
                ))}
              </div>
            </div>
            {toReview > 0 && <p className="text-ui text-[rgb(var(--c-warning))] bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] rounded-ui-sm p-2">{toReview} document{toReview > 1 ? 's' : ''} validé{toReview > 1 ? 's' : ''} il y a plus d'un an : revue annuelle à faire.</p>}
            {!templates && <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}
            {CATS.map((cat) => {
              const Icon = cat.icon
              const rich = richList.filter((t) => t.family === cat.id && matchRich(t))
              const legacy = cat.legacy.filter(matchLegacy)
              if (!rich.length && !legacy.length) return null
              const isExp = expandedCats.includes(cat.id) || !!q || filter !== 'tous'
              return (
                <div key={cat.id} className="card p-0 overflow-hidden">
                  <button onClick={() => toggleCat(cat.id)} className="w-full flex items-center justify-between p-4 hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-ui-sm ${getColor(cat.color)} text-white`}><Icon className="w-5 h-5" /></div>
                      <div className="text-left"><h3 className="font-semibold">{cat.name}</h3><p className="text-ui text-gray-500">{rich.length + legacy.length} document{rich.length + legacy.length > 1 ? 's' : ''}</p></div>
                    </div>
                    {isExp ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
                  </button>
                  {isExp && (
                    <div className="border-t divide-y">
                      {rich.map((t) => (
                        <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-gray-50">
                          <button type="button" onClick={() => setRichOpen(t.id)} className="flex items-start gap-3 text-left flex-1 min-w-[220px]">
                            <FileText className="w-5 h-5 text-gray-400 mt-0.5 shrink-0" />
                            <span className="flex flex-col gap-0.5">
                              <span className="font-medium text-gray-900">{t.name}</span>
                              <span className="text-ui-sm text-gray-500">{docCode(t.code)}{(t.indicators || []).length ? ` · Ind. ${t.indicators.join(', ')}` : ''}{savedDocs[t.id]?.next_review ? ` · revue le ${savedDocs[t.id].next_review.split('-').reverse().join('/')}` : ''}</span>
                            </span>
                          </button>
                          <div className="flex items-center gap-2">
                            <StatusChip status={stOf(t)} />
                            <button onClick={() => setRichOpen(t.id)} className="btn btn-sm btn-secondary flex items-center gap-1"><Edit className="w-4 h-4" /> Ouvrir</button>
                            <button onClick={() => richPDF(t)} disabled={generating} className="btn btn-sm btn-primary flex items-center gap-1">{generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} PDF</button>
                          </div>
                        </div>
                      ))}
                      {legacy.map(docItem => (
                        <div key={docItem.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-gray-50">
                          <div className="flex items-center gap-3">
                            <FileText className="w-5 h-5 text-gray-400" />
                            <div>
                              <span className="text-ui-sm font-mono bg-gray-100 px-1.5 py-0.5 rounded mr-2">{docCode(docItem.code)}</span>
                              <span>{docItem.name}</span>
                              {docItem.indicateur && <span className="ml-2 text-ui-sm bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))] px-1.5 py-0.5 rounded">Q{docItem.indicateur}</span>}
                              {savedDocs[docItem.id] && <span className="ml-2 text-ui-sm bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] px-1.5 py-0.5 rounded">Édité</span>}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {docItem.editable && <button onClick={() => openEditor(docItem.id)} className="btn btn-sm btn-secondary flex items-center gap-1"><Edit className="w-4 h-4" /> Éditer</button>}
                            <button onClick={() => generatePDF(docItem.id, docItem)} disabled={generating} className="btn btn-sm btn-primary flex items-center gap-1">
                              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} PDF
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })()}

      {activeTab === 'registres' && (
        <div className="space-y-4">
          <p className="text-ui text-[rgb(var(--c-info))] bg-[rgb(var(--c-info-bg))] p-3 rounded-ui-sm">Les registres sont liés aux données de l'application. Cliquez "Charger" pour voir les données.</p>
          {QUALITY_DOCS.registres.docs.map(reg => (
            <div key={reg.id} className="card">
              <div className="flex items-center justify-between mb-3">
                <div><h3 className="font-semibold">{reg.name}</h3><p className="text-ui text-gray-500">{docCode(reg.code)}</p></div>
                <div className="flex gap-2">
                  <button onClick={() => loadRegistre(reg.table)} disabled={loadingData} className="btn btn-sm btn-secondary flex items-center gap-1">
                    {loadingData ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Charger
                  </button>
                  <button onClick={() => generatePDF(reg.id, reg)} className="btn btn-sm btn-primary flex items-center gap-1"><Download className="w-4 h-4" /> PDF</button>
                </div>
              </div>
              {registreData[reg.table] !== undefined && (
                <div className="border rounded overflow-hidden">
                  {registreData[reg.table].length > 0 ? (
                    reg.table === 'programme_versions' ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-ui">
                          <thead className="bg-gray-800 text-white">
                            <tr>
                              <th className="text-left px-3 py-2.5 font-semibold">Réf. document</th>
                              <th className="text-left px-3 py-2.5 font-semibold">Programme</th>
                              <th className="text-center px-3 py-2.5 font-semibold">Version</th>
                              <th className="text-center px-3 py-2.5 font-semibold">Date MAJ</th>
                              <th className="text-left px-3 py-2.5 font-semibold">Validé par</th>
                              <th className="text-left px-3 py-2.5 font-semibold">Raison du changement</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {(() => {
                              const grouped = {}
                              registreData[reg.table].forEach(item => {
                                const key = progCode(item.ref_doc)
                                if (!grouped[key]) grouped[key] = []
                                grouped[key].push(item)
                              })
                              Object.keys(grouped).forEach(key => {
                                grouped[key].sort((a, b) => {
                                  const va = a.version.split('.').map(Number)
                                  const vb = b.version.split('.').map(Number)
                                  return (vb[0] - va[0]) || (vb[1] - va[1])
                                })
                              })
                              return Object.keys(grouped).sort((a, b) => a.localeCompare(b)).flatMap(k => grouped[k])
                            })().map((item, i, arr) => {
                              const isNewGroup = i === 0 || progCode(arr[i - 1].ref_doc) !== progCode(item.ref_doc)
                              const isLatest = isNewGroup
                              return (
                                <tr key={i} className={`${isNewGroup && i > 0 ? 'border-t-2 border-gray-300' : ''} ${isLatest ? 'bg-[rgb(var(--c-info-bg))]' : 'bg-white hover:bg-gray-50'}`}>
                                  <td className="px-3 py-2.5">
                                    <span className="font-mono text-ui-sm bg-gray-100 px-1.5 py-0.5 rounded">{docCode(progCode(item.ref_doc))}</span>
                                  </td>
                                  <td className="px-3 py-2.5 text-gray-800">{item.nom_programme}</td>
                                  <td className="px-3 py-2.5 text-center">
                                    <span className={`inline-block px-2 py-0.5 rounded text-ui-sm font-bold ${isLatest ? 'bg-[rgb(var(--c-info))] text-white' : 'bg-gray-200 text-gray-700'}`}>
                                      V{item.version}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5 text-center text-gray-600">{format(new Date(item.date_maj + 'T00:00:00'), 'dd/MM/yyyy')}</td>
                                  <td className="px-3 py-2.5 text-gray-700">{item.valide_par}</td>
                                  <td className="px-3 py-2.5 text-gray-600 italic">{item.raison_changement}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : reg.table === 'psh_requests' ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-ui">
                          <thead className="bg-gray-800 text-white">
                            <tr>
                              <th className="text-left px-3 py-2.5 font-semibold">Réf.</th>
                              <th className="text-left px-3 py-2.5 font-semibold">Besoin fonctionnel</th>
                              <th className="text-left px-3 py-2.5 font-semibold">Décision</th>
                              <th className="text-left px-3 py-2.5 font-semibold">Statut</th>
                              <th className="text-left px-3 py-2.5 font-semibold">Date</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {registreData[reg.table].map((item, i) => {
                              const pshDecisionClass = { a_analyser: 'bg-gray-100 text-gray-700', adapte: 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]', partiel: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]', oriente: 'bg-gray-100 text-gray-800', refuse: 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]' }
                              const pshDecisionLabel = { a_analyser: 'À analyser', adapte: 'Adaptée', partiel: 'Partielle', oriente: 'Orientée', refuse: 'Refusée' }
                              const pshStatusClass = { open: 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]', in_review: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]', awaiting_info: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]', decided: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]', implemented: 'bg-gray-100 text-gray-800', closed: 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' }
                              const pshStatusLabel = { open: 'Ouverte', in_review: 'En analyse', awaiting_info: 'Info manquante', decided: 'Décidée', implemented: 'Mise en œuvre', closed: 'Clôturé' }
                              return (
                                <tr key={i} className={item.is_test ? 'bg-[rgb(var(--c-warning-bg))]' : 'bg-white hover:bg-gray-50'}>
                                  <td className="px-3 py-2.5">
                                    <span className="font-mono text-ui-sm bg-gray-100 px-1.5 py-0.5 rounded">{item.reference}</span>
                                    {item.is_test && <span className="ml-1.5 text-ui-sm bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] px-1 py-0.5 rounded">test</span>}
                                  </td>
                                  <td className="px-3 py-2.5 text-gray-800">{(item.besoin_fonctionnel || '-').substring(0, 45)}</td>
                                  <td className="px-3 py-2.5"><span className={`text-ui-sm px-2 py-0.5 rounded ${pshDecisionClass[item.decision] || 'bg-gray-100 text-gray-700'}`}>{pshDecisionLabel[item.decision] || item.decision}</span></td>
                                  <td className="px-3 py-2.5"><span className={`text-ui-sm px-2 py-0.5 rounded ${pshStatusClass[item.status] || 'bg-gray-100 text-gray-700'}`}>{pshStatusLabel[item.status] || item.status}</span></td>
                                  <td className="px-3 py-2.5 text-gray-600">{format(new Date(item.created_at), 'dd/MM/yyyy')}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <table className="w-full text-ui">
                        <thead className="bg-gray-50"><tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Description</th><th className="px-3 py-2">Statut</th></tr></thead>
                        <tbody className="divide-y">
                          {registreData[reg.table].slice(0, 5).map((item, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2">{format(new Date(item.created_at || item.date_veille || item.date), 'dd/MM/yy')}</td>
                              <td className="px-3 py-2">{(item.subject || item.sujet || item.titre || item.description || item.name || '-').substring(0, 50)}</td>
                              <td className="px-3 py-2 text-center">
                                <span className={`px-2 py-0.5 rounded text-ui-sm ${
                                  (item.status === 'resolved' || item.status === 'closed' || item.statut === 'traite') 
                                    ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' 
                                    : 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]'
                                }`}>
                                  {item.status || item.statut || '-'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  ) : <p className="text-center text-gray-500 py-4">Aucun enregistrement</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      
      {activeTab === 'rdd' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div><h3 className="font-semibold text-lg">Revue de Direction</h3><p className="text-ui text-gray-500">Année glissante depuis août {rddData ? format(rddData.periode.start, 'yyyy') : ''}</p></div>
            <div className="flex gap-2">
              <button onClick={loadRDD} disabled={loadingData} className="btn btn-sm btn-secondary flex items-center gap-1">{loadingData ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Actualiser</button>
              <button onClick={() => generatePDF('rdd', { id: 'rdd', name: 'Revue de direction', code: 'QUAL-RDD' })} disabled={!rddData} className="btn btn-sm btn-primary flex items-center gap-1"><Download className="w-4 h-4" /> PDF</button>
            </div>
          </div>
          {rddData ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="p-4 bg-[rgb(var(--c-info-bg))] rounded-ui-sm"><p className="text-2xl font-bold text-[rgb(var(--c-info))]">{rddData.sessions.terminees}/{rddData.sessions.total}</p><p className="text-ui text-[rgb(var(--c-info))]">Sessions</p></div>
              <div className="p-4 bg-[rgb(var(--c-success-bg))] rounded-ui-sm"><p className="text-2xl font-bold text-[rgb(var(--c-success))]">{rddData.stagiaires}</p><p className="text-ui text-[rgb(var(--c-success))]">Stagiaires</p></div>
              <div className="p-4 bg-gray-50 rounded-ui-sm">
                <p className="text-2xl font-bold text-gray-800">{rddData.satisfaction.score === 'N/A' ? '-' : `${rddData.satisfaction.score}/5`}</p>
                <p className="text-ui text-gray-800">Satisfaction</p>
                {rddData.satisfaction.score === 'N/A' && <p className="text-ui-sm text-gray-500 mt-1">Aucune évaluation</p>}
              </div>
              <div className="p-4 bg-[rgb(var(--c-warning-bg))] rounded-ui-sm">
                <p className="text-2xl font-bold text-[rgb(var(--c-warning))]">{rddData.satisfaction.tauxReco === 'N/A' ? '-' : `${rddData.satisfaction.tauxReco}%`}</p>
                <p className="text-ui text-[rgb(var(--c-warning))]">Recommandation</p>
                {rddData.satisfaction.tauxReco === 'N/A' && <p className="text-ui-sm text-[rgb(var(--c-warning))] mt-1">Aucune évaluation</p>}
              </div>
              <div className="p-4 bg-[rgb(var(--c-danger-bg))] rounded-ui-sm"><p className="text-2xl font-bold text-[rgb(var(--c-danger))]">{rddData.reclamations.total}</p><p className="text-ui text-[rgb(var(--c-danger))]">Réclamations</p></div>
              <div className="p-4 bg-[rgb(var(--c-warning-bg))] rounded-ui-sm"><p className="text-2xl font-bold text-[rgb(var(--c-warning))]">{rddData.nc.total}</p><p className="text-ui text-[rgb(var(--c-warning))]">Non-conformités</p></div>
            </div>
          ) : <div className="text-center py-8"><Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" /><p className="text-gray-500 mt-2">Chargement...</p></div>}
        </div>
      )}
      
      {renderEditor()}
      {richOpen && templates?.[richOpen] && (
        <RichDocEditor
          key={richOpen}
          tpl={templates[richOpen]}
          saved={isRich(savedDocs[richOpen]) ? savedDocs[richOpen] : fromTemplate(templates[richOpen])}
          ctx={tplCtx}
          onClose={() => { setRichOpen(null); if (params.get('doc')) setParams({}) }}
          onSaved={(id, content) => setSavedDocs((prev) => ({ ...prev, [id]: content }))}
        />
      )}
    </div>
  )
}

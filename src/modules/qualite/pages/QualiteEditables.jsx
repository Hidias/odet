import { teamNames, docCode } from '../../../core/org/currentOrg'
import { useState, useEffect } from 'react'
import { supabase } from '../../../core/supabase'
import { 
  FileText, Download, ChevronDown, ChevronRight, Save, X, Edit,
  Building2, ClipboardList, Table, Users2, BarChart3, CheckSquare,
  Loader2, RefreshCw, Plus, Trash2, CheckCircle
} from 'lucide-react'
import { jsPDF } from 'jspdf'
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
    { id: 'organigramme', name: 'Organigramme', code: 'ORG-001', editable: true },
    { id: 'des-qual', name: 'Désignation Responsable Qualité', code: 'QUAL-DESQUAL', editable: true },
    { id: 'des-hand', name: 'Désignation Référent Handicap', code: 'QUAL-DESHAND', editable: true },
    { id: 'des-deon', name: 'Désignation Référent Déontologie', code: 'QUAL-DESDEON', editable: true },
    { id: 'des-recl', name: 'Désignation Référent Réclamations', code: 'QUAL-DESRECL', editable: true },
    { id: 'des-veil', name: 'Désignation Référent Veille', code: 'QUAL-DESVEIL', editable: true },
    { id: 'des-amel', name: 'Désignation Référent Amélioration', code: 'QUAL-DESAMEL', editable: true },
    { id: 'des-rgpd', name: 'Désignation DPO/RGPD', code: 'QUAL-DESRGPD', editable: true },
  ]},
  procedures: { name: 'Procédures', icon: ClipboardList, color: 'green', docs: [
    { id: 'proc-recl', name: 'Traitement des réclamations', code: 'QUAL-RECL', indicateur: '31', editable: true },
    { id: 'proc-nc', name: 'Non-conformités et amélioration', code: 'QUAL-NC', indicateur: '32', editable: true },
    { id: 'proc-sat', name: 'Évaluation satisfaction', code: 'QUAL-SAT', indicateur: '30-31', editable: true },
    { id: 'proc-veille', name: 'Veille réglementaire', code: 'QUAL-VEILLE', indicateur: '23-25', editable: true },
    { id: 'proc-besoin', name: 'Analyse des besoins', code: 'QUAL-BESOIN', indicateur: '4', editable: true },
    { id: 'proc-concep', name: 'Conception des formations', code: 'QUAL-CONCEP', indicateur: '5', editable: true },
    { id: 'proc-real', name: 'Réalisation des formations', code: 'QUAL-REAL', indicateur: '9-11', editable: true },
    { id: 'proc-eval', name: 'Évaluation des acquis', code: 'QUAL-EVAL', indicateur: '11', editable: true },
    { id: 'proc-hand', name: 'Accessibilité handicap', code: 'QUAL-HAND', indicateur: '26', editable: true },
    { id: 'proc-rgpd', name: 'Protection des données', code: 'QUAL-RGPD', indicateur: '1', editable: true },
  ]},
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
  checklists: { name: 'Checklists', icon: CheckSquare, color: 'orange', docs: [
    { id: 'ck-audit', name: 'Checklist audit interne', code: 'QUAL-CKAUD', editable: true },
    { id: 'ck-accueil', name: 'Checklist accueil stagiaire', code: 'QUAL-CKACC', editable: true },
    { id: 'ck-cloture', name: 'Checklist clôture session', code: 'QUAL-CKCLO', editable: true },
    { id: 'ck-materiel', name: 'Checklist matériel formation', code: 'QUAL-CKMAT', editable: true },
  ]},
  pilotage: { name: 'Pilotage', icon: BarChart3, color: 'teal', docs: [
    { id: 'rdd', name: 'Revue de direction', code: 'QUAL-RDD', computed: true },
    { id: 'plan-action', name: 'Plan d\'actions', code: 'QUAL-PLAN', editable: true },
    { id: 'indicateurs', name: 'Tableau des indicateurs', code: 'QUAL-INDIC', computed: true },
  ]},
  soustraitance: { name: 'Sous-traitance', icon: Users2, color: 'gray', docs: [
    { id: 'contrat-st', name: 'Contrat sous-traitance', code: 'QUAL-CTRAIT', editable: true },
    { id: 'charte-st', name: 'Charte qualité prestataire', code: 'QUAL-CHARTE', editable: true },
    { id: 'nda', name: 'Accord de confidentialité', code: 'QUAL-NDA', editable: true },
  ]},
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
  'des-qual': { personne: P(0), role: 'Responsable Qualité', date: format(new Date(), 'yyyy-MM-dd'), missions: ['Piloter le système qualité', 'Suivre les indicateurs', 'Préparer les audits', 'Proposer les améliorations', 'Garantir la conformité Qualiopi'] },
  'des-hand': { personne: P(1), role: 'Référent Handicap', date: format(new Date(), 'yyyy-MM-dd'), missions: ['Accueillir les PSH', 'Identifier les besoins d\'adaptation', 'Lien avec Agefiph/MDPH', 'Sensibiliser l\'équipe', 'Suivre les aménagements'] },
  'des-deon': { personne: P(1), role: 'Référent Déontologie', date: format(new Date(), 'yyyy-MM-dd'), missions: ['Veiller au respect des règles éthiques', 'Traiter les signalements', 'Conseiller la direction', 'Sensibiliser l\'équipe'] },
  'des-recl': { personne: P(0), role: 'Référent Réclamations', date: format(new Date(), 'yyyy-MM-dd'), missions: ['Réceptionner les réclamations', 'Analyser les causes', 'Clôturer sous 5 jours ouvrés', 'Communiquer les résultats', 'Proposer des actions préventives'] },
  'des-veil': { personne: P(0), role: 'Référent Veille', date: format(new Date(), 'yyyy-MM-dd'), missions: ['Veille réglementaire mensuelle', 'Suivre les référentiels INRS/CACES', 'Informer l\'équipe sous 30 jours', 'Mettre à jour les documents'] },
  'des-amel': { personne: P(1), role: 'Référent Amélioration Continue', date: format(new Date(), 'yyyy-MM-dd'), missions: ['Analyser les NC', 'Suivre les actions correctives', 'Animer l\'amélioration continue', 'Mesurer l\'efficacité', 'Préparer la RDD'] },
  'des-rgpd': { personne: P(0), role: 'DPO', date: format(new Date(), 'yyyy-MM-dd'), missions: ['Conformité RGPD', 'Registre des traitements', 'Répondre aux demandes de droits', 'Sensibiliser le personnel', 'Gérer les violations'] },
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
    obligations: ['Respecter le cahier des charges', 'Garantir la qualité des prestations', 'Fournir les justificatifs demandés', 'Respecter la confidentialité'],
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
  
  useEffect(() => {
    loadSavedDocs()
    supabase.from('organization_settings').select('*').limit(1).maybeSingle().then(({ data }) => syncOrg(data))
  }, [])
  
  const loadSavedDocs = async () => {
    const { data } = await supabase.from('quality_documents').select('*')
    if (data) {
      const docs = {}
      data.forEach(d => { docs[d.doc_id] = d.content })
      setSavedDocs(docs)
    }
  }
  
  const toggleCat = (id) => setExpandedCats(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id])
  const getColor = (c) => ({ blue: 'bg-blue-500', green: 'bg-green-500', purple: 'bg-purple-500', orange: 'bg-orange-500', teal: 'bg-teal-500', gray: 'bg-gray-500' }[c] || 'bg-gray-500')
  
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
      const doc = new jsPDF()
      const w = doc.internal.pageSize.getWidth()
      const h = doc.internal.pageSize.getHeight()
      const v = '2.8.0'
      const d = format(new Date(), 'dd/MM/yyyy')
      const data = savedDocs[docId] || DEFAULT_DATA[docId] || {}
      
      const header = () => { doc.setFontSize(9); doc.setTextColor(100); doc.text(`${ORG.nom} ${ORG.forme} - ${ORG.siret}`, 20, 15); doc.text(`${ORG.adresse}, ${ORG.cp} ${ORG.ville}`, 20, 20) }
      const footer = (p = 1) => { doc.setFontSize(8); doc.setTextColor(128); doc.text(`${docCode(docInfo.code)}-V${v}`, 20, h - 10); doc.text(d, w/2, h - 10, { align: 'center' }); doc.text(`Page ${p}`, w - 20, h - 10, { align: 'right' }) }
      const title = (t, y = 35) => { doc.setFontSize(14); doc.setTextColor(0); doc.setFont(undefined, 'bold'); doc.text(t.toUpperCase(), w/2, y, { align: 'center' }); doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(100); doc.text(`${docCode(docInfo.code)}-V${v}`, w/2, y + 6, { align: 'center' }); return y + 15 }
      
      header()
      let y = title(docInfo.name)
      
      // ORGANIGRAMME
      if (docId === 'organigramme') {
        const orgData = data.direction || DEFAULT_DATA.organigramme.direction
        const formData = data.formateurs || DEFAULT_DATA.organigramme.formateurs
        
        // Gouvernance
        doc.setFillColor(37, 99, 235); doc.rect(20, y, w - 40, 10, 'F')
        doc.setTextColor(255); doc.setFontSize(10); doc.setFont(undefined, 'bold')
        doc.text('GOUVERNANCE (co-direction 50/50)', w/2, y + 7, { align: 'center' })
        y += 15
        
        const colW = (w - 50) / 2
        doc.setTextColor(0); doc.setFillColor(245, 245, 245)
        
        orgData.forEach((dir, idx) => {
          const xPos = idx === 0 ? 20 : 30 + colW
          doc.rect(xPos, y, colW, 40, 'F')
          doc.setFont(undefined, 'bold'); doc.setFontSize(10)
          doc.text(dir.nom, xPos + colW/2, y + 8, { align: 'center' })
          doc.setFont(undefined, 'normal'); doc.setFontSize(8)
          let yr = y + 14
          ;(dir.roles || []).forEach(r => { doc.text(`• ${r}`, xPos + 4, yr); yr += 4.5 })
        })
        y += 50
        
        // Équipe pédagogique
        doc.setFillColor(34, 197, 94); doc.rect(20, y, w - 40, 10, 'F')
        doc.setTextColor(255); doc.setFontSize(10); doc.setFont(undefined, 'bold')
        doc.text('ÉQUIPE PÉDAGOGIQUE', w/2, y + 7, { align: 'center' })
        y += 15; doc.setTextColor(0); doc.setFontSize(9); doc.setFont(undefined, 'normal')
        formData.forEach(f => { doc.text(`${f.nom} : ${(f.specialites || []).join(', ')}`, 25, y); y += 6 })
        
      // DÉSIGNATIONS
      } else if (docId.startsWith('des-')) {
        const dateStr = data.date ? format(new Date(data.date), 'd MMMM yyyy', { locale: fr }) : format(new Date(), 'd MMMM yyyy', { locale: fr })
        doc.setFontSize(11); doc.setTextColor(0)
        doc.text(`La société ${raisonSociale()}, représentée par ${ORG.dirigeant || 'son représentant légal'}${ORG.dirigeantTitre ? `, ${ORG.dirigeantTitre}` : ''},`, 20, y); y += 12
        doc.text('Désigne par la présente :', 20, y); y += 10
        doc.setFont(undefined, 'bold'); doc.setFontSize(14)
        doc.text(data.personne || 'Non défini', 40, y); y += 10
        doc.setFont(undefined, 'normal'); doc.setFontSize(11)
        doc.text(`en qualité de ${data.role || 'Non défini'}.`, 20, y); y += 8
        doc.text(`Désignation effective au ${dateStr}.`, 20, y); y += 15
        
        doc.setFont(undefined, 'bold'); doc.text('Missions :', 20, y); y += 7
        doc.setFont(undefined, 'normal'); doc.setFontSize(10)
        ;(data.missions || []).forEach(m => { doc.text(`• ${m}`, 25, y); y += 6 })
        
        y = 210
        doc.setFontSize(11)
        doc.text(`Fait à ${ORG.ville}, le ${dateStr}`, 20, y); y += 12
        doc.text(ORG.dirigeantTitre ? `${ORG.dirigeantTitre},` : 'Le représentant légal,', 20, y); y += 15
        doc.text(ORG.dirigeant || '', 35, y)
        
      // PROCÉDURES AVEC SWIMLANES
      } else if (docId.startsWith('proc-')) {
        // Cartouche
        doc.setFillColor(245, 245, 245); doc.rect(20, y, w - 40, 18, 'F')
        doc.setFontSize(9); doc.setTextColor(0)
        doc.text(`Indicateur Qualiopi : ${docInfo.indicateur || '-'}`, 25, y + 6)
        doc.text(`Responsable : ${data.responsable || '-'}`, 25, y + 12)
        doc.text(`Révision : Annuelle | ${d}`, 120, y + 6)
        if (data.delaiAccuse) doc.text(`Délai AR : ${data.delaiAccuse}`, 120, y + 12)
        if (data.delaiCloture) doc.text(`Délai clôture : ${data.delaiCloture}`, 155, y + 12)
        if (data.delaiTraitement) doc.text(`Délai trait. : ${data.delaiTraitement}`, 120, y + 12)
        y += 25
        
        // Objectif
        doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.text('1. OBJECTIF', 20, y); y += 7
        doc.setFont(undefined, 'normal'); doc.setFontSize(10)
        const objLines = doc.splitTextToSize(data.objectif || '', w - 45)
        doc.text(objLines, 25, y); y += objLines.length * 5 + 8
        
        // Indicateurs
        if (data.indicateurs?.length) {
          doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.text('2. INDICATEURS', 20, y); y += 7
          doc.setFont(undefined, 'normal'); doc.setFontSize(10)
          data.indicateurs.forEach(ind => { doc.text(`• ${ind}`, 25, y); y += 5 }); y += 5
        }
        
        // Sources (veille)
        if (data.sources?.length) {
          doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.text('3. SOURCES DE VEILLE', 20, y); y += 7
          doc.setFont(undefined, 'normal'); doc.setFontSize(10)
          data.sources.forEach(src => { doc.text(`• ${src}`, 25, y); y += 5 }); y += 5
        }
        
        // LOGIGRAMME SWIMLANE (format tableau)
        if (data.swimlanes?.length) {
          doc.addPage(); header(); y = 35
          doc.setFont(undefined, 'bold'); doc.setFontSize(11)
          doc.text(`${data.sources ? '4' : '3'}. LOGIGRAMME (QUI FAIT QUOI)`, 20, y); y += 10
          
          // En-têtes du tableau
          const colWidths = [40, 65, 25, 45]
          doc.setFillColor(59, 130, 246); doc.rect(20, y, w - 40, 8, 'F')
          doc.setTextColor(255); doc.setFontSize(8); doc.setFont(undefined, 'bold')
          doc.text('ACTEUR', 22, y + 5.5)
          doc.text('ÉTAPE', 62, y + 5.5)
          doc.text('DÉLAI', 127, y + 5.5)
          doc.text('OUTPUT', 152, y + 5.5)
          y += 10
          
          // Lignes du tableau
          doc.setTextColor(0); doc.setFont(undefined, 'normal')
          data.swimlanes.forEach((row, idx) => {
            if (y > h - 30) { footer(doc.internal.getNumberOfPages()); doc.addPage(); header(); y = 35 }
            
            const bgColor = idx % 2 === 0 ? [250, 250, 250] : [240, 240, 245]
            doc.setFillColor(...bgColor)
            doc.rect(20, y, w - 40, 10, 'F')
            doc.setDrawColor(200); doc.rect(20, y, w - 40, 10)
            
            doc.setFontSize(7)
            doc.text((row.acteur || '').substring(0, 20), 22, y + 6)
            doc.text((row.etape || '').substring(0, 35), 62, y + 6)
            doc.text(row.delai || '-', 127, y + 6)
            doc.text((row.output || '').substring(0, 25), 152, y + 6)
            y += 10
          })
          
          y += 5
          doc.setFontSize(8); doc.setTextColor(100)
          doc.text('Ce logigramme présente le processus étape par étape avec les acteurs responsables.', 25, y)
          footer(doc.internal.getNumberOfPages())
        }
        
      // CHECKLISTS
      } else if (docId.startsWith('ck-')) {
        doc.setFontSize(10); doc.setTextColor(0)
        const items = data.items || []
        items.forEach((item, idx) => {
          doc.rect(25, y - 3, 4, 4) // Checkbox
          doc.text(`${idx + 1}. ${item}`, 32, y)
          y += 8
        })
        
      // RDD
      } else if (docId === 'rdd' && rddData) {
        const periodeStr = `${format(rddData.periode.start, 'MMMM yyyy', { locale: fr })} - ${format(rddData.periode.end, 'MMMM yyyy', { locale: fr })}`
        doc.setFillColor(245, 245, 245); doc.rect(20, y, w - 40, 12, 'F')
        doc.setFontSize(10); doc.setTextColor(0)
        doc.text(`Période : ${periodeStr}`, 25, y + 5)
        doc.text(`Participants : Direction`, 25, y + 10)
        y += 20
        
        const section = (titre, items, color) => {
          doc.setFillColor(...color); doc.rect(20, y, w - 40, 8, 'F')
          doc.setTextColor(255); doc.setFont(undefined, 'bold'); doc.setFontSize(10)
          doc.text(titre, 25, y + 6); y += 12
          doc.setTextColor(0); doc.setFont(undefined, 'normal'); doc.setFontSize(10)
          items.forEach(item => { doc.text(`• ${item}`, 25, y); y += 6 }); y += 5
        }
        
        section('1. FORMATIONS', [`Sessions : ${rddData.sessions.terminees}/${rddData.sessions.total}`, `Stagiaires : ${rddData.stagiaires}`], [59, 130, 246])
        section('2. SATISFACTION', [`Score moyen : ${rddData.satisfaction.score}/5`, `Recommandation : ${rddData.satisfaction.tauxReco}%`], [34, 197, 94])
        section('3. RÉCLAMATIONS', [`Total : ${rddData.reclamations.total}`, `Clôturées : ${rddData.reclamations.cloturees}`], [239, 68, 68])
        section('4. NON-CONFORMITÉS', [`Total : ${rddData.nc.total}`, `Clôturées : ${rddData.nc.cloturees}`], [251, 191, 36])
        
      // REGISTRES
      } else if (docId.startsWith('reg-') && docInfo.table) {
        const tableData = registreData[docInfo.table] || []
        doc.setFontSize(9); doc.text(`Export ${d} - ${tableData.length} enregistrement(s)`, 20, y); y += 8
        
        if (tableData.length > 0) {
          if (docInfo.table === 'psh_requests') {
            // Rendu spécifique PSH
            doc.setFillColor(240, 240, 240); doc.rect(20, y, w - 40, 7, 'F')
            doc.setFont(undefined, 'bold'); doc.setFontSize(8)
            doc.text('Réf.', 22, y + 5); doc.text('Besoin fonctionnel', 50, y + 5); doc.text('Décision', 130, y + 5); doc.text('Statut', 155, y + 5)
            y += 9; doc.setFont(undefined, 'normal')
            
            const pshDL = { a_analyser: 'À analyser', adapte: 'Adaptée', partiel: 'Partielle', oriente: 'Orientée', refuse: 'Refusée' }
            const pshSL = { open: 'Ouverte', in_review: 'En analyse', awaiting_info: 'Info manq.', decided: 'Décidée', implemented: 'Mise en œuvre', closed: 'Clôturé' }
            tableData.slice(0, 25).forEach(item => {
              doc.text(item.reference || '-', 22, y)
              doc.text((item.besoin_fonctionnel || '-').substring(0, 50), 50, y)
              doc.text(pshDL[item.decision] || '-', 130, y)
              doc.text(pshSL[item.status] || '-', 155, y)
              y += 5
            })
          } else {
          doc.setFillColor(240, 240, 240); doc.rect(20, y, w - 40, 7, 'F')
          doc.setFont(undefined, 'bold'); doc.setFontSize(8)
          doc.text('Date', 22, y + 5); doc.text('Description', 50, y + 5); doc.text('Statut', 150, y + 5)
          y += 9; doc.setFont(undefined, 'normal')
          
          tableData.slice(0, 25).forEach(item => {
            doc.text(format(new Date(item.created_at), 'dd/MM/yy'), 22, y)
            doc.text((item.subject || item.description || item.titre || item.name || '-').substring(0, 55), 50, y)
            doc.text(item.status || '-', 150, y)
            y += 5
          })
          }
        } else { doc.text('Aucun enregistrement.', 20, y) }
        
      } else {
        doc.setFontSize(10); doc.text('Document en cours de rédaction.', 20, y)
      }
      
      footer()
      doc.save(`${docCode(docInfo.code)}-V${v}.pdf`)
      toast.success('PDF généré !')
    } catch (e) { console.error(e); toast.error('Erreur PDF') }
    setGenerating(false)
  }
  
  // ===== MODAL ÉDITEUR =====
  const renderEditor = () => {
    if (!editingDoc) return null
    const docInfo = findDocInfo(editingDoc)
    
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <div className="p-4 border-b flex items-center justify-between bg-gray-50">
            <div><h2 className="font-bold text-lg">{docInfo?.name}</h2><p className="text-sm text-gray-500">{docCode(docInfo?.code)}</p></div>
            <button onClick={() => setEditingDoc(null)} className="p-2 hover:bg-gray-200 rounded-lg"><X className="w-5 h-5" /></button>
          </div>
          
          <div className="p-4 overflow-y-auto flex-1 space-y-4">
            {/* ORGANIGRAMME */}
            {editingDoc === 'organigramme' && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-2">Direction (personnes et rôles)</label>
                  {(editData.direction || DEFAULT_DATA.organigramme.direction).map((dir, idx) => (
                    <div key={idx} className="mb-4 p-3 bg-gray-50 rounded-lg">
                      <input type="text" value={dir.nom} onChange={e => {
                        const newDir = [...(editData.direction || DEFAULT_DATA.organigramme.direction)]
                        newDir[idx] = { ...newDir[idx], nom: e.target.value }
                        setEditData({ ...editData, direction: newDir })
                      }} className="input w-full mb-2" placeholder="Nom" />
                      <label className="text-xs text-gray-500">Rôles (un par ligne)</label>
                      <textarea value={(dir.roles || []).join('\n')} onChange={e => {
                        const newDir = [...(editData.direction || DEFAULT_DATA.organigramme.direction)]
                        newDir[idx] = { ...newDir[idx], roles: e.target.value.split('\n') }
                        setEditData({ ...editData, direction: newDir })
                      }} className="input w-full h-24" />
                    </div>
                  ))}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Formateurs (personnes et spécialités)</label>
                  {(editData.formateurs || DEFAULT_DATA.organigramme.formateurs).map((form, idx) => (
                    <div key={idx} className="mb-4 p-3 bg-gray-50 rounded-lg">
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
            
            {/* DÉSIGNATIONS */}
            {editingDoc.startsWith('des-') && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Personne désignée</label>
                  <select value={editData.personne || ''} onChange={e => setEditData({...editData, personne: e.target.value})} className="input w-full">
                    {teamNames().map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Fonction</label>
                  <input type="text" value={editData.role || ''} onChange={e => setEditData({...editData, role: e.target.value})} className="input w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Date de désignation</label>
                  <input type="date" value={editData.date || ''} onChange={e => setEditData({...editData, date: e.target.value})} className="input w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Missions</label>
                  {(editData.missions || []).map((m, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <input type="text" value={m} onChange={e => {
                        const newM = [...(editData.missions || [])]; newM[i] = e.target.value
                        setEditData({...editData, missions: newM})
                      }} className="input flex-1" />
                      <button onClick={() => setEditData({...editData, missions: (editData.missions || []).filter((_, idx) => idx !== i)})} className="btn btn-sm btn-secondary"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <button onClick={() => setEditData({...editData, missions: [...(editData.missions || []), '']})} className="btn btn-sm btn-secondary"><Plus className="w-4 h-4 mr-1" /> Ajouter</button>
                </div>
              </>
            )}
            
            {/* PROCÉDURES */}
            {editingDoc.startsWith('proc-') && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Objectif</label>
                  <textarea value={editData.objectif || ''} onChange={e => setEditData({...editData, objectif: e.target.value})} className="input w-full h-20" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Responsable</label>
                    <select value={editData.responsable || ''} onChange={e => setEditData({...editData, responsable: e.target.value})} className="input w-full">
                      {teamNames().map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  {editData.delaiAccuse !== undefined && <div><label className="block text-sm font-medium mb-1">Délai AR</label><input type="text" value={editData.delaiAccuse || ''} onChange={e => setEditData({...editData, delaiAccuse: e.target.value})} className="input w-full" /></div>}
                  {editData.delaiCloture !== undefined && <div><label className="block text-sm font-medium mb-1">Délai clôture</label><input type="text" value={editData.delaiCloture || ''} onChange={e => setEditData({...editData, delaiCloture: e.target.value})} className="input w-full" /></div>}
                  {editData.delaiTraitement !== undefined && <div><label className="block text-sm font-medium mb-1">Délai traitement</label><input type="text" value={editData.delaiTraitement || ''} onChange={e => setEditData({...editData, delaiTraitement: e.target.value})} className="input w-full" /></div>}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Indicateurs</label>
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
                    <label className="block text-sm font-medium mb-1">Étapes du logigramme</label>
                    <div className="text-xs text-gray-500 mb-2">Format: Acteur | Étape | Délai | Output</div>
                    {editData.swimlanes.map((row, i) => (
                      <div key={i} className="grid grid-cols-4 gap-1 mb-2">
                        <input type="text" value={row.acteur || ''} onChange={e => { const n = [...editData.swimlanes]; n[i] = {...n[i], acteur: e.target.value}; setEditData({...editData, swimlanes: n}) }} className="input text-xs" placeholder="Acteur" />
                        <input type="text" value={row.etape || ''} onChange={e => { const n = [...editData.swimlanes]; n[i] = {...n[i], etape: e.target.value}; setEditData({...editData, swimlanes: n}) }} className="input text-xs" placeholder="Étape" />
                        <input type="text" value={row.delai || ''} onChange={e => { const n = [...editData.swimlanes]; n[i] = {...n[i], delai: e.target.value}; setEditData({...editData, swimlanes: n}) }} className="input text-xs" placeholder="Délai" />
                        <div className="flex gap-1">
                          <input type="text" value={row.output || ''} onChange={e => { const n = [...editData.swimlanes]; n[i] = {...n[i], output: e.target.value}; setEditData({...editData, swimlanes: n}) }} className="input text-xs flex-1" placeholder="Output" />
                          <button onClick={() => setEditData({...editData, swimlanes: editData.swimlanes.filter((_, idx) => idx !== i)})} className="text-red-500"><Trash2 className="w-3 h-3" /></button>
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
                <label className="block text-sm font-medium mb-1">Items de la checklist</label>
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
                  <div><label className="block text-sm font-medium mb-1">Nom du prestataire</label><input type="text" value={editData.prestataire || ''} onChange={e => setEditData({...editData, prestataire: e.target.value})} className="input w-full" /></div>
                  <div><label className="block text-sm font-medium mb-1">Durée du contrat</label><input type="text" value={editData.duree || ''} onChange={e => setEditData({...editData, duree: e.target.value})} className="input w-full" placeholder="ex: 1 an renouvelable" /></div>
                </div>
                <div><label className="block text-sm font-medium mb-1">Objet du contrat</label><textarea value={editData.objet || ''} onChange={e => setEditData({...editData, objet: e.target.value})} className="input w-full h-20" /></div>
                <div><label className="block text-sm font-medium mb-1">Montant</label><input type="text" value={editData.montant || ''} onChange={e => setEditData({...editData, montant: e.target.value})} className="input w-full" /></div>
                <div>
                  <label className="block text-sm font-medium mb-1">Obligations du prestataire</label>
                  {(editData.obligations || []).map((o, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <input type="text" value={o} onChange={e => { const n = [...(editData.obligations || [])]; n[i] = e.target.value; setEditData({...editData, obligations: n}) }} className="input flex-1" />
                      <button onClick={() => setEditData({...editData, obligations: (editData.obligations || []).filter((_, idx) => idx !== i)})} className="btn btn-sm btn-secondary"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <button onClick={() => setEditData({...editData, obligations: [...(editData.obligations || []), '']})} className="btn btn-sm btn-secondary"><Plus className="w-4 h-4 mr-1" /> Ajouter</button>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Conditions particulières</label>
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
                <label className="block text-sm font-medium mb-1">Engagements qualité du prestataire</label>
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
                  <label className="block text-sm font-medium mb-1">Parties au contrat</label>
                  <input type="text" value={raisonSociale()} disabled className="input w-full mb-2 bg-gray-100" />
                  <input type="text" value={(editData.parties || [])[1] || ''} onChange={e => setEditData({...editData, parties: [raisonSociale(), e.target.value]})} className="input w-full" placeholder="Nom du cocontractant" />
                </div>
                <div><label className="block text-sm font-medium mb-1">Durée de confidentialité</label><input type="text" value={editData.duree || ''} onChange={e => setEditData({...editData, duree: e.target.value})} className="input w-full" placeholder="ex: 5 ans après fin du contrat" /></div>
                <div>
                  <label className="block text-sm font-medium mb-1">Informations confidentielles couvertes</label>
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
                <label className="block text-sm font-medium mb-2">Actions en cours</label>
                <div className="text-xs text-gray-500 mb-2">Gérez vos actions d'amélioration continue</div>
                {(editData.actions || []).map((act, i) => (
                  <div key={i} className="p-3 bg-gray-50 rounded-lg mb-3">
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
                    <button onClick={() => setEditData({...editData, actions: (editData.actions || []).filter((_, idx) => idx !== i)})} className="text-red-500 text-xs">Supprimer cette action</button>
                  </div>
                ))}
                <button onClick={() => setEditData({...editData, actions: [...(editData.actions || []), { action: '', responsable: P(0), echeance: '', statut: 'en_cours', priorite: 'normale' }]})} className="btn btn-sm btn-secondary"><Plus className="w-4 h-4 mr-1" /> Ajouter action</button>
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
        <p className="text-gray-500">Pack Qualiopi V2.8.0 - Documents éditables</p>
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
      
      {activeTab === 'documents' && (
        <div className="space-y-3">
          {Object.entries(QUALITY_DOCS).filter(([k]) => k !== 'registres').map(([catId, cat]) => {
            const Icon = cat.icon; const isExp = expandedCats.includes(catId)
            return (
              <div key={catId} className="card p-0 overflow-hidden">
                <button onClick={() => toggleCat(catId)} className="w-full flex items-center justify-between p-4 hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${getColor(cat.color)} text-white`}><Icon className="w-5 h-5" /></div>
                    <div className="text-left"><h3 className="font-semibold">{cat.name}</h3><p className="text-sm text-gray-500">{cat.docs.length} docs</p></div>
                  </div>
                  {isExp ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
                </button>
                {isExp && (
                  <div className="border-t divide-y">
                    {cat.docs.map(docItem => (
                      <div key={docItem.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                        <div className="flex items-center gap-3">
                          <FileText className="w-5 h-5 text-gray-400" />
                          <div>
                            <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded mr-2">{docCode(docItem.code)}</span>
                            <span>{docItem.name}</span>
                            {docItem.indicateur && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Q{docItem.indicateur}</span>}
                            {savedDocs[docItem.id] && <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Édité</span>}
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
      )}
      
      {activeTab === 'registres' && (
        <div className="space-y-4">
          <p className="text-sm text-blue-700 bg-blue-50 p-3 rounded-lg">Les registres sont liés aux données de l'application. Cliquez "Charger" pour voir les données.</p>
          {QUALITY_DOCS.registres.docs.map(reg => (
            <div key={reg.id} className="card">
              <div className="flex items-center justify-between mb-3">
                <div><h3 className="font-semibold">{reg.name}</h3><p className="text-sm text-gray-500">{docCode(reg.code)}</p></div>
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
                        <table className="w-full text-sm">
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
                                <tr key={i} className={`${isNewGroup && i > 0 ? 'border-t-2 border-gray-300' : ''} ${isLatest ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'}`}>
                                  <td className="px-3 py-2.5">
                                    <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{docCode(progCode(item.ref_doc))}</span>
                                  </td>
                                  <td className="px-3 py-2.5 text-gray-800">{item.nom_programme}</td>
                                  <td className="px-3 py-2.5 text-center">
                                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${isLatest ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>
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
                        <table className="w-full text-sm">
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
                              const pshDecisionClass = { a_analyser: 'bg-gray-100 text-gray-700', adapte: 'bg-green-100 text-green-700', partiel: 'bg-blue-100 text-blue-700', oriente: 'bg-purple-100 text-purple-700', refuse: 'bg-red-100 text-red-700' }
                              const pshDecisionLabel = { a_analyser: 'À analyser', adapte: 'Adaptée', partiel: 'Partielle', oriente: 'Orientée', refuse: 'Refusée' }
                              const pshStatusClass = { open: 'bg-red-100 text-red-700', in_review: 'bg-yellow-100 text-yellow-700', awaiting_info: 'bg-orange-100 text-orange-700', decided: 'bg-blue-100 text-blue-700', implemented: 'bg-purple-100 text-purple-700', closed: 'bg-green-100 text-green-700' }
                              const pshStatusLabel = { open: 'Ouverte', in_review: 'En analyse', awaiting_info: 'Info manquante', decided: 'Décidée', implemented: 'Mise en œuvre', closed: 'Clôturé' }
                              return (
                                <tr key={i} className={item.is_test ? 'bg-yellow-50' : 'bg-white hover:bg-gray-50'}>
                                  <td className="px-3 py-2.5">
                                    <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{item.reference}</span>
                                    {item.is_test && <span className="ml-1.5 text-xs bg-yellow-200 text-yellow-800 px-1 py-0.5 rounded">test</span>}
                                  </td>
                                  <td className="px-3 py-2.5 text-gray-800">{(item.besoin_fonctionnel || '-').substring(0, 45)}</td>
                                  <td className="px-3 py-2.5"><span className={`text-xs px-2 py-0.5 rounded ${pshDecisionClass[item.decision] || 'bg-gray-100 text-gray-700'}`}>{pshDecisionLabel[item.decision] || item.decision}</span></td>
                                  <td className="px-3 py-2.5"><span className={`text-xs px-2 py-0.5 rounded ${pshStatusClass[item.status] || 'bg-gray-100 text-gray-700'}`}>{pshStatusLabel[item.status] || item.status}</span></td>
                                  <td className="px-3 py-2.5 text-gray-600">{format(new Date(item.created_at), 'dd/MM/yyyy')}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50"><tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Description</th><th className="px-3 py-2">Statut</th></tr></thead>
                        <tbody className="divide-y">
                          {registreData[reg.table].slice(0, 5).map((item, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2">{format(new Date(item.created_at || item.date_veille || item.date), 'dd/MM/yy')}</td>
                              <td className="px-3 py-2">{(item.subject || item.sujet || item.titre || item.description || item.name || '-').substring(0, 50)}</td>
                              <td className="px-3 py-2 text-center">
                                <span className={`px-2 py-0.5 rounded text-xs ${
                                  (item.status === 'resolved' || item.status === 'closed' || item.statut === 'traite') 
                                    ? 'bg-green-100 text-green-700' 
                                    : 'bg-yellow-100 text-yellow-700'
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
            <div><h3 className="font-semibold text-lg">Revue de Direction</h3><p className="text-sm text-gray-500">Année glissante depuis août {rddData ? format(rddData.periode.start, 'yyyy') : ''}</p></div>
            <div className="flex gap-2">
              <button onClick={loadRDD} disabled={loadingData} className="btn btn-sm btn-secondary flex items-center gap-1">{loadingData ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Actualiser</button>
              <button onClick={() => generatePDF('rdd', { id: 'rdd', name: 'Revue de direction', code: 'QUAL-RDD' })} disabled={!rddData} className="btn btn-sm btn-primary flex items-center gap-1"><Download className="w-4 h-4" /> PDF</button>
            </div>
          </div>
          {rddData ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg"><p className="text-2xl font-bold text-blue-700">{rddData.sessions.terminees}/{rddData.sessions.total}</p><p className="text-sm text-blue-600">Sessions</p></div>
              <div className="p-4 bg-green-50 rounded-lg"><p className="text-2xl font-bold text-green-700">{rddData.stagiaires}</p><p className="text-sm text-green-600">Stagiaires</p></div>
              <div className="p-4 bg-purple-50 rounded-lg">
                <p className="text-2xl font-bold text-purple-700">{rddData.satisfaction.score === 'N/A' ? '-' : `${rddData.satisfaction.score}/5`}</p>
                <p className="text-sm text-purple-600">Satisfaction</p>
                {rddData.satisfaction.score === 'N/A' && <p className="text-xs text-purple-400 mt-1">Aucune évaluation</p>}
              </div>
              <div className="p-4 bg-orange-50 rounded-lg">
                <p className="text-2xl font-bold text-orange-700">{rddData.satisfaction.tauxReco === 'N/A' ? '-' : `${rddData.satisfaction.tauxReco}%`}</p>
                <p className="text-sm text-orange-600">Recommandation</p>
                {rddData.satisfaction.tauxReco === 'N/A' && <p className="text-xs text-orange-400 mt-1">Aucune évaluation</p>}
              </div>
              <div className="p-4 bg-red-50 rounded-lg"><p className="text-2xl font-bold text-red-700">{rddData.reclamations.total}</p><p className="text-sm text-red-600">Réclamations</p></div>
              <div className="p-4 bg-yellow-50 rounded-lg"><p className="text-2xl font-bold text-yellow-700">{rddData.nc.total}</p><p className="text-sm text-yellow-600">Non-conformités</p></div>
            </div>
          ) : <div className="text-center py-8"><Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" /><p className="text-gray-500 mt-2">Chargement...</p></div>}
        </div>
      )}
      
      {renderEditor()}
    </div>
  )
}

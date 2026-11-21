// Documents obligatoires du personnel (0522, choix de H du 18/11) : travail isolé sur le poste, accueil sécurité signé
// à l'écran, affichages obligatoires (un seul panneau). Sources lues le 18/11/2026 :
//   - Code du travail L4121-1 et R4512-13 (travail isolé) ;
//   - L4141-2 (formation pratique et appropriée à la sécurité) et R4141-3 (circulation dans l'entreprise, exécution
//     du travail, conduite à tenir en cas d'accident ou de sinistre) ;
//   - fiche service-public reprise par code.travail.gouv.fr, mise à jour du 08/07/2026 (affichages, jusqu'à 10 salariés).

import { supabase } from '../../../core/supabase'
import { enregistrerOuLever } from '../../../core/enregistrer'
import { societeEnCours } from '../../../core/company/societes'

const must = ({ data, error }) => { if (error) throw error; return data }
const jour = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Travail isolé ───
export const MESURES_ISOLE = {
  dati: 'DATI remis (alarme pour travailleur isolé)',
  appel_controle: 'Appel de contrôle à heure fixe',
  procedure_alerte: 'Procédure d\'alerte écrite',
  autre: 'Autre mesure (à préciser)',
}

/** Erreur de saisie du travail isolé d'un poste, ou null */
export function erreurTravailIsole({ lone_work, lone_work_measures = [], lone_work_note = '' }) {
  if (!lone_work) return null
  if ((lone_work_measures || []).some((x) => !MESURES_ISOLE[x])) return 'Mesure inconnue'
  if ((lone_work_measures || []).includes('autre') && !String(lone_work_note || '').trim()) return 'Précisez la mesure « autre »'
  if (String(lone_work_note || '').length > 1000) return 'Précision trop longue (1 000 caractères au plus)'
  return null
}

export async function enregistrerTravailIsole(jobId, v) {
  const err = erreurTravailIsole(v)
  if (err) throw new Error(err)
  const seul = !!v.lone_work
  return enregistrerOuLever(supabase.from('hr_jobs').update({
    lone_work: seul,
    lone_work_measures: seul ? (v.lone_work_measures || []) : [],
    lone_work_note: seul ? (String(v.lone_work_note || '').trim() || null) : null,
    lone_work_duerp_ref: seul ? (String(v.lone_work_duerp_ref || '').trim() || null) : null,
  }).eq('id', jobId))
}

/** Résumé lisible du travail isolé d'un poste */
export function resumeTravailIsole(poste) {
  if (!poste?.lone_work) return 'Ne travaille pas seul'
  const m = (poste.lone_work_measures || []).map((x) => (x === 'autre' ? (poste.lone_work_note || 'autre mesure') : MESURES_ISOLE[x]?.split(' (')[0])).filter(Boolean)
  return m.length ? `Peut travailler seul : ${m.join(', ')}` : 'Peut travailler seul : aucune mesure retenue'
}

// ─── Accueil sécurité ───
export const MOTIFS_ACCUEIL = {
  embauche: 'Embauche',
  changement_poste: 'Changement de poste',
  changement_technique: 'Changement de technique ou de matériel',
  retour_absence: 'Retour après une absence',
  interim: 'Intérimaire',
  autre: 'Autre',
}

// Trois domaines de R4141-3, puis les points pratiques proposés (modifiables à la saisie)
export const POINTS_ACCUEIL = [
  'Conditions de circulation dans l\'entreprise (R4141-3, 1°)',
  'Conditions d\'exécution du travail (R4141-3, 2°)',
  'Conduite à tenir en cas d\'accident ou de sinistre (R4141-3, 3°)',
  'Gestes sûrs, modes opératoires et dispositifs de protection du poste',
  'Consignes incendie et évacuation',
  'Équipements de protection individuelle et leur usage',
  'Risques du poste (document unique) et habilitations exigées',
]
export const POINT_ISOLE = 'Consignes du travail isolé : moyens d\'alerte, appel de contrôle, conduite à tenir'

/** Points proposés pour une personne : ceux de base, plus le travail isolé si son poste peut travailler seul */
export function pointsProposes(poste) {
  return [...POINTS_ACCUEIL, ...(poste?.lone_work ? [POINT_ISOLE] : [])].map((label) => ({ label, done: false }))
}

/** Erreur de saisie d'un accueil sécurité, ou null */
export function erreurAccueil({ done_on, reason, topics = [], signature }) {
  if (!done_on) return 'Date de l\'accueil manquante'
  if (done_on > jour()) return 'L\'accueil ne peut pas être daté dans le futur'
  if (!MOTIFS_ACCUEIL[reason]) return 'Motif manquant'
  if (!(topics || []).some((t) => t.done)) return 'Cochez au moins un point abordé'
  if ((topics || []).length > 40) return 'Trop de points (40 au plus)'
  if (!signature) return 'Faites signer le salarié dans le cadre'
  return null
}

export const chargerAccueils = async (personId) => must(await supabase.from('hr_safety_inductions')
  .select('id, done_on, reason, topics, conducted_by, signed_at, notes, job_id, hr_jobs(name)')
  .eq('person_id', personId).order('done_on', { ascending: false }))

export async function enregistrerAccueil(personId, v) {
  const err = erreurAccueil(v)
  if (err) throw new Error(err)
  return must(await supabase.from('hr_safety_inductions').insert({
    person_id: personId, employment_id: v.employment_id || null, done_on: v.done_on, reason: v.reason,
    topics: (v.topics || []).map((t) => ({ label: String(t.label).trim(), done: !!t.done })).filter((t) => t.label),
    conducted_by: String(v.conducted_by || '').trim() || null, employee_signature: v.signature,
    notes: String(v.notes || '').trim() || null,
  }).select('id').single())
}
export const supprimerAccueil = async (id) => enregistrerOuLever(supabase.from('hr_safety_inductions').delete().eq('id', id))

// ─── Affichages obligatoires ───
// Référentiel des affichages et diffusions (fiche service-public reprise par code.travail.gouv.fr, mise à jour du
// 08/07/2026, tableau « Jusqu'à 10 salariés », 21 lignes lues le 18/11/2026). Les codes sont contrôlés par la base (0522).
export const AFFICHAGES = [
  { code: "inspection_travail", label: "Inspection du travail", content: "Adresse, nom et téléphone de l'inspecteur du travail compétent.", mode: "affichage" },
  { code: "discriminations_accueil", label: "Accueil téléphonique sur les discriminations", content: "Numéro 09 69 39 00 00 ; informations sur les discriminations et la saisine du Défenseur des droits.", mode: "affichage" },
  { code: "medecin_travail", label: "Médecine du travail", content: "Adresse et téléphone du médecin du travail ou du service de santé au travail.", mode: "affichage" },
  { code: "secours_urgence", label: "Services de secours d'urgence", content: "Adresse et téléphone des secours d'urgence (pompiers, SAMU, etc.).", mode: "affichage" },
  { code: "consignes_securite", label: "Consignes de sécurité", content: "Consignes incendie (signalisation NF EN ISO 7010), responsables du matériel de secours, personnes chargées de l'évacuation, premiers soins en cas d'accident électrique.", mode: "affichage" },
  { code: "conventions_accords", label: "Conventions et accords collectifs", content: "Liste des conventions et accords applicables, lieu et conditions de consultation.", mode: "tout_moyen" },
  { code: "egalite_remuneration", label: "Égalité de rémunération femmes et hommes", content: "Texte des articles du Code du travail sur l'égalité de rémunération.", mode: "tout_moyen", reference: "Code du travail, L3221-1 à L3221-7" },
  { code: "duree_travail", label: "Durée du travail", content: "Répartition de la durée du travail en cas d'aménagement et ses modifications ; composition nominative des équipes en cas de travail par relais, roulement ou équipes successives.", mode: "affichage" },
  { code: "horaires_collectifs", label: "Horaires collectifs", content: "Heures de début et de fin du travail, durée des repos.", mode: "affichage" },
  { code: "repos_hebdomadaire", label: "Repos hebdomadaire", content: "Jours et heures du repos collectif s'il n'est pas donné le dimanche ; suspension pour travaux urgents.", mode: "tout_moyen" },
  { code: "conges_payes", label: "Congés payés", content: "Période de prise des congés (2 mois avant l'ouverture de la période) et ordre des départs (1 mois avant le début des congés) ; caisse des congés payés pour les employeurs d'artistes du spectacle et du bâtiment et des travaux publics.", mode: "tout_moyen" },
  { code: "harcelement_moral", label: "Harcèlement moral", content: "Texte de l'article du Code pénal sur le harcèlement moral.", mode: "tout_moyen", reference: "Code pénal, 222-33-2" },
  { code: "harcelement_sexuel", label: "Harcèlement sexuel", content: "Texte de l'article du Code pénal sur le harcèlement sexuel, actions possibles, coordonnées du médecin du travail, de l'inspection du travail et du Défenseur des droits.", mode: "tout_moyen", reference: "Code pénal, 222-33" },
  { code: "discriminations", label: "Lutte contre les discriminations", content: "Texte des articles du Code pénal sur les discriminations.", mode: "tout_moyen", reference: "Code pénal, 225-1 à 225-4" },
  { code: "interdiction_fumer", label: "Interdiction de fumer", content: "Interdiction de fumer dans les locaux.", mode: "affichage" },
  { code: "interdiction_vapoter", label: "Interdiction de vapoter", content: "Interdiction de vapoter dans les lieux de travail fermés ou couverts à usage collectif, sauf exceptions (lieux de travail accueillant du public, par exemple).", mode: "affichage" },
  { code: "acces_duerp", label: "Document unique d'évaluation des risques", content: "Conditions d'accès et de consultation du document unique.", mode: "affichage" },
  { code: "panneaux_syndicaux", label: "Panneaux syndicaux", content: "Panneaux pour les communications syndicales, selon accord avec l'employeur.", mode: "affichage" },
  { code: "organisations_syndicales", label: "Organisations syndicales de la branche", content: "Accès aux adresses des organisations syndicales représentatives de la branche (site du ministère du Travail).", mode: "tout_moyen" },
  { code: "rupture_conventionnelle_collective", label: "Rupture conventionnelle collective", content: "Décision de validation de l'administration, le cas échéant.", mode: "tout_moyen" },
  { code: "travail_temporaire", label: "Travail temporaire", content: "Informations nominatives des relevés de contrats de mission transmises à France Travail et à la DDETS ; droits d'accès et de rectification.", mode: "tout_moyen" },
]

export const MODES_AFFICHAGE = { affichage: 'Affichage', tout_moyen: 'Par tout moyen' }

/** État d'une ligne : à faire, fait, sans objet ; « à vérifier » si faite ou vérifiée il y a plus d'un an */
export function etatAffichage(ligne, aujourdhui = jour()) {
  if (!ligne) return 'a_faire'
  if (ligne.status === 'sans_objet') return 'sans_objet'
  const ref = ligne.checked_on || ligne.done_on
  if (!ref) return 'a_faire'
  const [a, m, j] = aujourdhui.split('-').map(Number)
  const unAn = `${a - 1}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`
  return ref < unAn ? 'a_verifier' : 'fait'
}
export const ETATS_AFFICHAGE = {
  a_faire: { label: 'À faire', badge: 'badge-danger' },
  a_verifier: { label: 'À vérifier', badge: 'badge-warning' },
  fait: { label: 'Fait', badge: 'badge-success' },
  sans_objet: { label: 'Sans objet', badge: 'badge-neutral' },
}

/** Bilan : nombre de lignes par état */
export function bilanAffichages(items = [], lignes = [], aujourdhui = jour()) {
  const par = Object.fromEntries((lignes || []).map((l) => [l.item_code, l]))
  const b = { a_faire: 0, a_verifier: 0, fait: 0, sans_objet: 0 }
  for (const it of items || []) b[etatAffichage(par[it.code], aujourdhui)] += 1
  return b
}

/** Erreur de saisie d'une ligne d'affichage, ou null */
export function erreurAffichage({ status, done_on, checked_on, note }) {
  if (status === 'sans_objet') return String(note || '').trim() ? null : 'Indiquez pourquoi cet affichage est sans objet'
  if (status !== 'fait') return 'État inconnu'
  if (!done_on) return 'Date de mise en place manquante'
  if (done_on > jour()) return 'Date dans le futur'
  if (checked_on && checked_on < done_on) return 'La vérification ne peut pas précéder la mise en place'
  if (checked_on && checked_on > jour()) return 'Date dans le futur'
  return null
}

// Lignes de la société en cours seulement (un compte membre de plusieurs sociétés les lit toutes)
export async function chargerAffichages() {
  let q = supabase.from('hr_postings').select('id, company_id, item_code, status, done_on, checked_on, means, note, updated_at')
  const c = societeEnCours()
  if (c) q = q.eq('company_id', c)
  return must(await q)
}

export async function enregistrerAffichage(code, v) {
  const err = erreurAffichage(v)
  if (err) throw new Error(err)
  const sansObjet = v.status === 'sans_objet'
  return must(await supabase.from('hr_postings').upsert({
    item_code: code, status: v.status,
    done_on: sansObjet ? null : v.done_on, checked_on: sansObjet ? null : (v.checked_on || null),
    means: String(v.means || '').trim() || null, note: String(v.note || '').trim() || null,
  }, { onConflict: 'company_id,item_code' }))
}
export const effacerAffichage = async (id) => enregistrerOuLever(supabase.from('hr_postings').delete().eq('id', id))

export async function chargerLieuPanneau() {
  const rows = must(await supabase.from('hr_settings').select('company_id, posting_location').limit(1))
  return rows?.[0]?.posting_location || ''
}
export const enregistrerLieuPanneau = async (lieu) => must(await supabase.from('hr_settings')
  .upsert({ posting_location: String(lieu || '').trim() || null, updated_at: new Date().toISOString() }, { onConflict: 'company_id' }))

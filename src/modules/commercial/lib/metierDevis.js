// Métier d'un devis : ce qu'il vend (formation, maintenance, vente de matériel…). Une seule règle pour tout l'outil,
// pour que le PDF, l'envoi, les pièces jointes et les mentions disent la même chose (0443).

export const METIERS = [
  { id: 'formation', label: 'Formation' },
  { id: 'maintenance', label: 'Maintenance et vérification' },
  { id: 'vente', label: 'Vente de matériel' },
  { id: 'installation', label: 'Installation ou travaux' },
  { id: 'depannage', label: 'Dépannage' },
  { id: 'audit', label: 'DUERP ou audit' },
]
export const METIER_MIXTE = { id: 'mixte', label: 'Mixte' }
const IDS = new Set(METIERS.map((m) => m.id))

export const libelleMetier = (id) => (id === 'mixte' ? METIER_MIXTE.label : METIERS.find((m) => m.id === id)?.label || '')

// Matériel de formation et frais de déplacement (fraisCatalogue.js) : ils accompagnent une formation ou une
// intervention, ils ne font pas d'un devis une vente de matériel
const CODE_ACCESSOIRE = /^(MAT|DEP)-/

/**
 * Métier d'une ligne : celui posé sur la ligne, sinon formation pour une ligne du catalogue de formation, sinon vente
 * pour un bien. Une ligne libre de service, un frais de déplacement ou du matériel de formation : aucun (null).
 */
export function metierLigne(item) {
  if (!item) return null
  if (item.metier && IDS.has(item.metier)) return item.metier
  if (item.course_id) return 'formation'
  if (CODE_ACCESSOIRE.test(item.code || '')) return null
  if (item.nature === 'bien' || item.stock_item_id) return 'vente'
  return null
}

/** Métiers présents dans les lignes (ordre de la liste METIERS) */
export function metiersDesLignes(items, quote) {
  const set = new Set((items || []).map(metierLigne).filter(Boolean))
  if (quote?.session_id) set.add('formation')
  return METIERS.map((m) => m.id).filter((id) => set.has(id))
}

/** Métier déduit des lignes : un seul métier, « mixte » s'il y en a plusieurs, null si rien ne permet de le dire */
export function metierDeduit(items, quote) {
  const ms = metiersDesLignes(items, quote)
  if (ms.length === 0) return null
  return ms.length === 1 ? ms[0] : 'mixte'
}

/** Métier du devis : celui choisi par l'équipe, sinon celui déduit des lignes */
export function metierDevis(quote, items) {
  const choisi = quote?.metier
  if (choisi && (IDS.has(choisi) || choisi === 'mixte')) return choisi
  return metierDeduit(items, quote)
}

/**
 * Métiers dont le devis reçoit les pièces : le métier choisi ; pour un devis mixte (ou sans choix), chaque métier
 * présent dans les lignes.
 */
export function metiersPourPieces(quote, items) {
  const m = metierDevis(quote, items)
  if (m && m !== 'mixte') return [m]
  return metiersDesLignes(items, quote)
}

/**
 * Le devis contient-il de la formation ? Seul un devis de formation reçoit des documents de formation (programme,
 * CGV de formation, NDA, mention d'exonération de TVA de la formation).
 */
export function devisDeFormation(quote, items) {
  return metiersPourPieces(quote, items).includes('formation')
}

// Conditions générales et documents qualité joints par métier (documents qualité versionnés, famille « commerce »).
// Pour un particulier, la variante « particuliers » du même document (articles conditionnels).
export const DOCS_PAR_METIER = {
  formation: [{ doc: 'cgv', label: 'Conditions générales de vente (formation)', kind: 'cgv' }],
  maintenance: [
    { doc: 'cgv-maintenance', label: 'Conditions générales de maintenance et de vérification', kind: 'cgv' },
    { doc: 'perimetre-maintenance', label: 'Périmètre des prestations de maintenance', kind: 'perimetre' },
  ],
  depannage: [{ doc: 'cgv-maintenance', label: 'Conditions générales de maintenance et de vérification', kind: 'cgv' }],
  vente: [
    { doc: 'cgv-vente', label: 'Conditions générales de vente de matériel', kind: 'cgv' },
    { doc: 'garantie-vente', label: 'Garanties du matériel vendu', kind: 'garantie' },
  ],
  installation: [{ doc: 'cgv-installation', label: 'Conditions générales d\'installation et de travaux', kind: 'cgv' }],
  audit: [],
}

// Pièces de l'entreprise (company_papers) jointes par métier : attestation de responsabilité civile professionnelle
// pour l'installation ; décennale si le devis porte sur des travaux (installation).
export const PIECES_ENTREPRISE_PAR_METIER = {
  installation: ['rc_pro', 'decennale'],
}

/** Documents qualité à joindre (sans doublon) pour les métiers du devis */
export function documentsAJoindre(quote, items) {
  const vus = new Set()
  const out = []
  metiersPourPieces(quote, items).forEach((m) => (DOCS_PAR_METIER[m] || []).forEach((d) => {
    if (vus.has(d.doc)) return
    vus.add(d.doc)
    out.push({ ...d, metier: m })
  }))
  return out
}

/** Types de pièces de l'entreprise à joindre */
export function piecesEntrepriseAJoindre(quote, items) {
  const set = new Set()
  metiersPourPieces(quote, items).forEach((m) => (PIECES_ENTREPRISE_PAR_METIER[m] || []).forEach((k) => set.add(k)))
  return [...set]
}

/** Une pièce de l'entreprise est-elle valable à la date du devis ? */
export function pieceValable(piece, jour = new Date().toISOString().slice(0, 10)) {
  if (!piece) return false
  if (piece.valid_until && piece.valid_until < jour) return false
  if (piece.valid_from && piece.valid_from > jour) return false
  return true
}

/** Objets proposés pour un métier (réglages de facturation), sans doublon */
export function objetsProposes(objetsDevis, metier) {
  const src = objetsDevis && typeof objetsDevis === 'object' ? objetsDevis : {}
  const ids = metier && metier !== 'mixte' ? [metier] : METIERS.map((m) => m.id)
  return [...new Set(ids.flatMap((id) => (Array.isArray(src[id]) ? src[id] : [])).map((s) => String(s).trim()).filter(Boolean))]
}

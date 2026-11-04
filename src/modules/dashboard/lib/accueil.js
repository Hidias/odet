// Règles de l'accueil (angles morts A7, A8, A9, 04/11) : mêmes statuts et mêmes exclusions qu'ailleurs.

// A9 : une session « Confirmée » est une session à venir comme une session « Prévue »
export const STATUTS_A_VENIR = ['planned', 'confirmed']
export const estAVenir = (s) => STATUTS_A_VENIR.includes(s?.status)

// A8 : un stagiaire noté absent ne compte ni pour l'émargement, ni pour la convocation, ni pour le positionnement
export const stagiairesPresents = (s) => (s?.session_trainees || []).filter((st) => !st.absent)

// A7 : statuts réels des devis (contrainte de la table quotes) ; `signed`, `pending`, `rejected` gardés pour les
// anciennes lignes. Un devis remplacé par une nouvelle version n'est compté nulle part. Un devis partiel compte comme
// signé, pour le montant de ses seules lignes acceptées (quote_items.accepted), remise globale du devis déduite.
export const DEVIS_SIGNES = ['accepted', 'partial', 'invoiced', 'signed']
export const DEVIS_ENVOYES = ['sent', 'pending']
export const DEVIS_REFUSES = ['refused', 'rejected']
export const estDevisSigne = (q) => DEVIS_SIGNES.includes(q?.status)

const ht = (q) => parseFloat(q?.total_ht) || 0
export function montantSigne(q) {
  if (q?.status === 'partial' && Array.isArray(q.quote_items)) {
    const lignes = q.quote_items.filter((it) => it.accepted === true).reduce((t, it) => t + (parseFloat(it.total_ht) || 0), 0)
    const remise = Math.min(Math.max(parseFloat(q.discount_percent) || 0, 0), 100)
    return Math.round(lignes * (1 - remise / 100) * 100) / 100
  }
  return ht(q)
}
const somme = (l, f = ht) => l.reduce((t, q) => t + f(q), 0)

export function pipelineDevis(devis = []) {
  const q = (devis || []).filter((x) => x?.status !== 'replaced')
  const draft = q.filter((x) => x.status === 'draft')
  const sent = q.filter((x) => DEVIS_ENVOYES.includes(x.status))
  const signed = q.filter(estDevisSigne)
  const refused = q.filter((x) => DEVIS_REFUSES.includes(x.status))
  return { draft, sent, signed, refused, totalDraft: somme(draft), totalSent: somme(sent), totalSigned: somme(signed, montantSigne) }
}

export function tauxConversion(devis = []) {
  const q = (devis || []).filter((x) => x?.status !== 'replaced')
  const signes = q.filter(estDevisSigne).length
  return { signes, total: q.length, taux: q.length > 0 ? Math.round((signes / q.length) * 100) : 0 }
}

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

// A3 : le widget BPF lit la déclaration de l'exercice clos de la société (bpf_declarations), au lieu d'un texte fixe.
// Statuts de la page BPF : déposée quand `submitted_at` est posée, sinon brouillon enregistré, sinon rien.
// Chantier BPF (05/11) : `suivi` vient de exerciceBpfSuivi (formation/lib/bpf.js) ; il donne le nom de l'exercice et la
// date limite, et écarte l'annonce tant que le numéro de déclaration n'est pas saisi ou que le premier exercice soumis
// n'est pas clos.
const dateFr = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}` }
export function etatBpf(declaration, annee, suivi = null) {
  if (suivi?.cle === 'sans_numero') return { cle: 'sans_numero', titre: 'BPF pas encore dû', detail: 'Il sera dû après l\'attribution du numéro de déclaration d\'activité' }
  if (suivi?.cle === 'pas_encore') {
    return { cle: 'pas_encore', titre: `Premier BPF : exercice ${suivi.libelle}`, detail: `Exercice du ${dateFr(suivi.debut)} au ${dateFr(suivi.fin)}, à transmettre avant le ${dateFr(suivi.limite)}` }
  }
  if (!annee) return { cle: 'inconnu', titre: 'BPF', detail: 'Choisissez une société pour voir son BPF' }
  const nom = suivi?.libelle || annee
  const avant = suivi?.limite ? `, à transmettre avant le ${dateFr(suivi.limite)}` : ''
  if (declaration?.submitted_at) {
    const d = new Date(declaration.submitted_at)
    return { cle: 'depose', titre: `BPF ${nom} déposé`, detail: `Déposé le ${d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}` }
  }
  if (declaration) return { cle: 'brouillon', titre: `BPF ${nom} en cours`, detail: `Brouillon enregistré, pas encore déposé${avant}` }
  return { cle: 'a_faire', titre: `BPF ${nom} à préparer`, detail: `Aucune déclaration enregistrée pour cet exercice${avant}` }
}

// A4 : rappel « évaluation à froid » aligné sur la relance à froid (0482) : délai réglé par la société ou la formation
// (60 jours par défaut, comme app.froid_reglage), sessions plus anciennes que le réglage exclues sauf inclusion à la
// main, et plus rien dès que chaque stagiaire formé a reçu son envoi, a été écarté ou a répondu. Les absents ne comptent
// pas. Mêmes exclusions que la préparation de nuit (froid_preparer_corps) : sous-traitance, client organisme de
// formation, circuit désactivé par la société.
export const FROID_DEFAUT = { actif: true, premier_envoi_jours: 60, anciennete_max_jours: 365 }
const JOUR_MS = 86400000
const jourUtc = (v) => { const [y, m, d] = String(v).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) }
export const cleStagiaire = (sessionId, traineeId) => `${sessionId}:${traineeId}`

export function froidARappeler(s, { reglage, envoyes, repondus, aujourdhui } = {}) {
  if (!s || s.status !== 'completed') return false
  const fin = s.end_date || s.start_date
  if (!fin || !aujourdhui) return false
  if (s.session_type === 'subcontract' || s.clients?.client_type === 'organisme_formation') return false
  const r = { ...FROID_DEFAUT, ...(reglage || {}) }
  if (r.actif === false) return false
  const delai = s.courses?.froid_delai_jours ?? r.premier_envoi_jours
  const ecart = Math.round((jourUtc(aujourdhui) - jourUtc(fin)) / JOUR_MS)
  if (ecart < delai) return false
  if (ecart > r.anciennete_max_jours && !s.froid_inclure) return false
  const formes = stagiairesPresents(s).filter((st) => st.presence_complete || st.early_departure || st.result)
  return formes.some((st) => {
    const k = cleStagiaire(s.id, st.trainee_id)
    return !envoyes?.has(k) && !repondus?.has(k)
  })
}

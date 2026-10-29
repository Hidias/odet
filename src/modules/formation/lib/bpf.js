// BPF (Cerfa n° 10443*17, notice n° 50199#17, vérifiés le 29/10/2026) : ce que la fiche formation apporte au calcul.
// Objectif général (cadre F-3) et spécialité de formation (cadre F-4), choisis une fois par formation (0477).

export const OBJECTIFS_BPF = [
  { value: 'rncp', label: 'Diplôme ou titre inscrit au RNCP', hint: 'Niveau à préciser (F-3 a)' },
  { value: 'rncp_cqp', label: 'CQP inscrit au RNCP sans niveau', hint: 'F-3 a' },
  { value: 'rs', label: 'Certification ou habilitation inscrite au répertoire spécifique (RS)', hint: 'F-3 b' },
  { value: 'cqp', label: 'CQP non inscrit au RNCP ni au RS', hint: 'F-3 c' },
  { value: 'autre', label: 'Autre formation professionnelle', hint: 'F-3 d' },
  { value: 'bilan', label: 'Bilan de compétences', hint: 'F-3 e' },
  { value: 'vae', label: 'Accompagnement à la VAE', hint: 'F-3 f' },
]

export const NIVEAUX_RNCP = [2, 3, 4, 5, 6, 7, 8]

/**
 * Spécialité proposée d'après l'intitulé, à confirmer : jamais retenue sans choix explicite.
 * Reprend les correspondances de l'ancienne page BPF (sécurité 344, conduite 311, électricité 255).
 */
export function specialiteSuggeree(course) {
  const t = `${course?.title || ''} ${course?.code || ''}`.toLowerCase()
  if (/\bsst\b|secouris|incendie|evacuation|évacuation|\bepi\b|extincteur/.test(t)) return '344'
  if (/r48[2-9]|chariot|nacelle|engin|cariste|manutention|gerbeur/.test(t)) return '311'
  if (/electri|électri|habilit|\bb0\b|\bh0\b|\bbr\b|\bbc\b/.test(t)) return '255'
  return null
}

/** Ce qu'il manque à la fiche pour le BPF (vide si complète) */
export function manquesBpf(course) {
  const m = []
  if (!course?.bpf_objectif) m.push('objectif')
  else if (course.bpf_objectif === 'rncp' && !course.bpf_rncp_niveau) m.push('niveau RNCP')
  if (!course?.nsf_code) m.push('spécialité')
  return m
}

// ── Lignes du Cerfa 10443*17 (libellés de la notice 50199#17, reformulés au plus près) ──
// type : 'montant' (euros HT), 'sh' (stagiaires et heures), 'ph' (personnes et heures).
// total : ligne calculée à partir d'autres lignes, jamais saisie.
export const LIGNES_BPF = [
  { cadre: 'C', code: 'C-1', label: 'Employeurs, pour la formation de leurs salariés', type: 'montant' },
  { cadre: 'C', code: 'C-2-a', label: 'Fonds de la formation : contrats d\'apprentissage', type: 'montant', sous: true },
  { cadre: 'C', code: 'C-2-b', label: 'Fonds de la formation : contrats de professionnalisation', type: 'montant', sous: true },
  { cadre: 'C', code: 'C-2-c', label: 'Fonds de la formation : promotion ou reconversion par alternance', type: 'montant', sous: true },
  { cadre: 'C', code: 'C-2-d', label: 'Fonds de la formation : projets de transition professionnelle', type: 'montant', sous: true },
  { cadre: 'C', code: 'C-2-e', label: 'Fonds de la formation : compte personnel de formation', type: 'montant', sous: true },
  { cadre: 'C', code: 'C-2-f', label: 'Fonds de la formation : dispositifs pour les personnes en recherche d\'emploi', type: 'montant', sous: true },
  { cadre: 'C', code: 'C-2-g', label: 'Fonds de la formation : non-salariés', type: 'montant', sous: true },
  { cadre: 'C', code: 'C-2-h', label: 'Fonds de la formation : plan de développement des compétences ou autres dispositifs', type: 'montant', sous: true },
  { cadre: 'C', code: 'C-2', label: 'Total des fonds de la formation (lignes a à h)', type: 'montant', total: ['C-2-a', 'C-2-b', 'C-2-c', 'C-2-d', 'C-2-e', 'C-2-f', 'C-2-g', 'C-2-h'] },
  { cadre: 'C', code: 'C-3', label: 'Pouvoirs publics, pour la formation de leurs agents', type: 'montant' },
  { cadre: 'C', code: 'C-4', label: 'Instances européennes', type: 'montant' },
  { cadre: 'C', code: 'C-5', label: 'État', type: 'montant' },
  { cadre: 'C', code: 'C-6', label: 'Conseils régionaux', type: 'montant' },
  { cadre: 'C', code: 'C-7', label: 'France Travail', type: 'montant' },
  { cadre: 'C', code: 'C-8', label: 'Autres ressources publiques', type: 'montant' },
  { cadre: 'C', code: 'C-9', label: 'Particuliers, à leurs frais', type: 'montant' },
  { cadre: 'C', code: 'C-10', label: 'Autres organismes de formation (sous-traitance)', type: 'montant' },
  { cadre: 'C', code: 'C-11', label: 'Autres produits liés à la formation', type: 'montant' },
  { cadre: 'C', code: 'C', label: 'Total des produits de formation (lignes 1 à 11)', type: 'montant', total: ['C-1', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', 'C-7', 'C-8', 'C-9', 'C-10', 'C-11'] },
  { cadre: 'D', code: 'D', label: 'Total des charges liées à l\'activité de formation', type: 'montant' },
  { cadre: 'D', code: 'D-1', label: 'dont salaires des formateurs (compte 6411)', type: 'montant', sous: true },
  { cadre: 'D', code: 'D-2', label: 'dont achats de formation et honoraires de formation (comptes 604 et 6226)', type: 'montant', sous: true },
  { cadre: 'E', code: 'E-1', label: 'Personnes de votre organisme', type: 'ph' },
  { cadre: 'E', code: 'E-2', label: 'Personnes extérieures (sous-traitance, honoraires)', type: 'ph' },
  { cadre: 'F-1', code: 'F-1-a', label: 'Salariés d\'employeurs privés, hors apprentis', type: 'sh' },
  { cadre: 'F-1', code: 'F-1-b', label: 'Apprentis', type: 'sh' },
  { cadre: 'F-1', code: 'F-1-c', label: 'Personnes en recherche d\'emploi', type: 'sh' },
  { cadre: 'F-1', code: 'F-1-d', label: 'Particuliers à leurs frais', type: 'sh' },
  { cadre: 'F-1', code: 'F-1-e', label: 'Autres stagiaires', type: 'sh' },
  { cadre: 'F-1', code: 'F-1', label: 'Total (lignes a à e)', type: 'sh', total: ['F-1-a', 'F-1-b', 'F-1-c', 'F-1-d', 'F-1-e'] },
  { cadre: 'F-2', code: 'F-2', label: 'Activité confiée à un autre organisme', type: 'sh' },
  { cadre: 'F-3', code: 'F-3-a-6', label: 'RNCP niveaux 6 à 8', type: 'sh', sous: true },
  { cadre: 'F-3', code: 'F-3-a-5', label: 'RNCP niveau 5', type: 'sh', sous: true },
  { cadre: 'F-3', code: 'F-3-a-4', label: 'RNCP niveau 4', type: 'sh', sous: true },
  { cadre: 'F-3', code: 'F-3-a-3', label: 'RNCP niveau 3', type: 'sh', sous: true },
  { cadre: 'F-3', code: 'F-3-a-2', label: 'RNCP niveau 2', type: 'sh', sous: true },
  { cadre: 'F-3', code: 'F-3-a-cqp', label: 'CQP inscrit au RNCP sans niveau', type: 'sh', sous: true },
  { cadre: 'F-3', code: 'F-3-a', label: 'Formations visant un diplôme, un titre ou un CQP inscrit au RNCP', type: 'sh', total: ['F-3-a-6', 'F-3-a-5', 'F-3-a-4', 'F-3-a-3', 'F-3-a-2', 'F-3-a-cqp'] },
  { cadre: 'F-3', code: 'F-3-b', label: 'Certification ou habilitation inscrite au répertoire spécifique', type: 'sh' },
  { cadre: 'F-3', code: 'F-3-c', label: 'CQP non inscrit au RNCP ni au RS', type: 'sh' },
  { cadre: 'F-3', code: 'F-3-d', label: 'Autres formations professionnelles', type: 'sh' },
  { cadre: 'F-3', code: 'F-3-e', label: 'Bilans de compétences', type: 'sh' },
  { cadre: 'F-3', code: 'F-3-f', label: 'Accompagnement à la VAE', type: 'sh' },
  { cadre: 'F-3', code: 'F-3', label: 'Total (lignes a à f)', type: 'sh', total: ['F-3-a', 'F-3-b', 'F-3-c', 'F-3-d', 'F-3-e', 'F-3-f'] },
  { cadre: 'G', code: 'G', label: 'Stagiaires confiés par un autre organisme de formation', type: 'sh' },
]
export const CADRES_BPF = [
  { cadre: 'C', titre: 'C. Origine des produits (euros HT)' },
  { cadre: 'D', titre: 'D. Charges de l\'organisme (euros HT)' },
  { cadre: 'E', titre: 'E. Personnes dispensant des heures de formation' },
  { cadre: 'F-1', titre: 'F-1. Type de stagiaires' },
  { cadre: 'F-2', titre: 'F-2. Activité sous-traitée' },
  { cadre: 'F-3', titre: 'F-3. Objectif général des prestations' },
  { cadre: 'F-4', titre: 'F-4. Spécialités de formation' },
  { cadre: 'G', titre: 'G. Formation confiée par un autre organisme' },
]

const CHAMPS = { montant: [null], sh: ['stagiaires', 'heures'], ph: ['personnes', 'heures'] }
const nombre = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))

/** Valeur retenue d'une ligne : la saisie quand elle existe, sinon le calcul ; les totaux sont recalculés */
export function valeursRetenues(calculLignes = {}, saisies = {}) {
  const out = {}
  for (const l of LIGNES_BPF) {
    if (l.total) continue
    const champs = CHAMPS[l.type]
    if (l.type === 'montant') {
      const s = nombre(saisies[l.code])
      out[l.code] = s != null ? Math.round(s) : Math.round(Number(calculLignes[l.code]) || 0)
    } else {
      out[l.code] = Object.fromEntries(champs.map((k) => {
        const s = nombre(saisies[l.code]?.[k])
        return [k, s != null ? Math.round(s) : Math.round(Number(calculLignes[l.code]?.[k]) || 0)]
      }))
    }
  }
  for (const l of LIGNES_BPF.filter((x) => x.total)) {
    if (l.type === 'montant') out[l.code] = l.total.reduce((t, c) => t + (out[c] || 0), 0)
    else out[l.code] = Object.fromEntries(CHAMPS[l.type].map((k) => [k, l.total.reduce((t, c) => t + (out[c]?.[k] || 0), 0)]))
  }
  return out
}

/**
 * Dernier exercice clos à une date, nommé comme dans bpf_calculer : l'exercice « A » se termine dans l'année A.
 * Début en janvier : exercice civil. Début en octobre : l'exercice 2026 va du 01/10/2025 au 30/09/2026.
 */
export function dernierExerciceClos(moisDebut, aujourdhui = new Date()) {
  const m = Number(moisDebut) || 1
  const annee = aujourdhui.getFullYear()
  if (m === 1) return annee - 1
  // L'exercice de l'année en cours se termine le dernier jour du mois m - 1 : clos dès le mois m
  return aujourdhui.getMonth() + 1 >= m ? annee : annee - 1
}

/** Contrôles de la notice : totaux F-1 = F-3 = F-4, montants positifs, part du CA au moins 1 % s'il y a de l'activité */
export function controlesBpf(retenues, f4Total, partCa) {
  const ecarts = []
  const f1 = retenues['F-1'] || {}; const f3 = retenues['F-3'] || {}; const f4 = f4Total || {}
  for (const k of ['stagiaires', 'heures']) {
    if ((f1[k] || 0) !== (f3[k] || 0)) ecarts.push(`F-1 et F-3 : ${k} différents (${f1[k] || 0} et ${f3[k] || 0})`)
    if ((f1[k] || 0) !== (f4[k] || 0)) ecarts.push(`F-1 et F-4 : ${k} différents (${f1[k] || 0} et ${f4[k] || 0})`)
  }
  if ((retenues.C || 0) > 0 && !(partCa >= 1)) ecarts.push('Part du chiffre d\'affaires : au moins 1 % dès qu\'il y a eu de l\'activité')
  const d = retenues.D || 0
  if ((retenues['D-1'] || 0) + (retenues['D-2'] || 0) > d) ecarts.push('Cadre D : salaires et achats dépassent le total des charges')
  return ecarts
}

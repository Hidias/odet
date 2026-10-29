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

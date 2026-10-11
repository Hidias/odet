// ════════════════════════════════════════════════════════════════
// phoningLabels.js - Libellés partagés de l'assistant d'appel
// (bibliothèque éditable, panneau d'appel, mode session)
// ════════════════════════════════════════════════════════════════

export const OBJECTION_CATEGORIES = [
  { value: 'barrage', label: 'Accueil' },
  { value: 'accroche', label: 'Dès l\'accroche' },
  { value: 'temps', label: 'Temps' },
  { value: 'budget', label: 'Budget et financement' },
  { value: 'concurrence', label: 'Prestataire en place' },
  { value: 'deja_couvert', label: 'Déjà couvert' },
  { value: 'pas_concerne', label: 'Pas concerné' },
  { value: 'confiance', label: 'Confiance' },
  { value: 'client_existant', label: 'Client existant' },
  { value: 'autre', label: 'Autre' },
]

export const STEP_TYPES = [
  { value: 'accueil', label: 'Accueil' },
  { value: 'accroche', label: 'Accroche' },
  { value: 'ouverture', label: 'Question d\'ouverture' },
  { value: 'decouverte', label: 'Découverte' },
  { value: 'proposition_rdv', label: 'Proposition de RDV' },
  { value: 'messagerie', label: 'Message vocal' },
  { value: 'conclusion', label: 'Conclusion' },
]

export const THEMES = [
  { value: 'sst', label: 'SST' },
  { value: 'incendie', label: 'Incendie' },
  { value: 'electrique', label: 'Électrique' },
  { value: 'conduite', label: 'Conduite d\'engins' },
  { value: 'gestes_postures', label: 'Gestes et postures' },
  { value: 'duerp', label: 'DUERP' },
  { value: 'opco', label: 'OPCO' },
]

export const PROVIDER_THEMES = [
  { value: 'sst', label: 'SST' },
  { value: 'incendie', label: 'Incendie' },
  { value: 'electrique', label: 'Électrique' },
  { value: 'conduite', label: 'Conduite d\'engins' },
  { value: 'gestes_postures', label: 'Gestes et postures' },
  { value: 'duerp', label: 'DUERP' },
  { value: 'autre', label: 'Autre' },
]

export function labelOf(list, value) {
  return list.find(x => x.value === value)?.label || value
}

// Code technique à partir d'un titre (trames et objections créées à la main)
export function slugCode(text, prefix = '') {
  const base = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return `${prefix}${base || 'element'}_${Date.now().toString(36)}`
}

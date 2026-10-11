// src/lib/duerpConformiteData.js
// ══════════════════════════════════════════════════════════════════
// Moteur de conformité DUERP — Obligations réglementaires automatiques
// Basé sur Code du Travail, INRS, normes NF
// ══════════════════════════════════════════════════════════════════

// ── TYPES D'ÉQUIPEMENTS ──────────────────────────────────────────
export const EQUIPMENT_TYPES = [
  {
    id: 'extincteur_eau',
    label: 'Extincteur eau pulvérisée 6L',
    icon: '🧯',
    category: 'incendie',
    reglementation: 'Art. R4227-29 Code du Travail',
    periodicite_check: 12, // mois
    periodicite_visuelle: 3,
    duree_vie_max: 20, // ans (APSAD R4)
    notes: '1 minimum par 200 m² et par niveau',
  },
  {
    id: 'extincteur_co2',
    label: 'Extincteur CO₂ 2kg/5kg',
    icon: '🧯',
    category: 'incendie',
    reglementation: 'Art. R4227-29 — risques électriques',
    periodicite_check: 12,
    periodicite_visuelle: 3,
    duree_vie_max: null, // pas de limite pour CO2
    notes: 'Obligatoire si risque électrique identifié',
  },
  {
    id: 'extincteur_poudre',
    label: 'Extincteur poudre ABC',
    icon: '🧯',
    category: 'incendie',
    reglementation: 'Art. R4227-29 — risques spécifiques',
    periodicite_check: 12,
    periodicite_visuelle: 3,
    duree_vie_max: 20,
    notes: 'Adapté aux liquides inflammables et gaz',
  },
  {
    id: 'dae',
    label: 'Défibrillateur (DAE)',
    icon: '💓',
    category: 'secours',
    reglementation: 'Art. L157-2 Code construction (ERP) / Recommandé INRS',
    periodicite_check: null, // selon fabricant
    periodicite_visuelle: 1,
    duree_vie_max: null,
    notes: 'Obligatoire pour ERP cat 1-4. Recommandé si risque électrique, effectif >50 ou site isolé',
  },
  {
    id: 'trousse_secours',
    label: 'Trousse / Armoire de secours',
    icon: '🩹',
    category: 'secours',
    reglementation: 'Art. R4224-14 Code du Travail',
    periodicite_check: 3, // vérif contenu trimestrielle recommandée
    periodicite_visuelle: 1,
    duree_vie_max: null,
    notes: 'Contenu adapté aux risques, facilement accessible et signalé',
  },
  {
    id: 'couverture_anti_feu',
    label: 'Couverture anti-feu',
    icon: '🔥',
    category: 'incendie',
    reglementation: 'Norme EN 1869',
    periodicite_check: 12,
    periodicite_visuelle: 3,
    duree_vie_max: null,
    notes: 'Recommandée dans les cuisines et laboratoires',
  },
  {
    id: 'ria',
    label: 'Robinet d\'Incendie Armé (RIA)',
    icon: '🚿',
    category: 'incendie',
    reglementation: 'APSAD R5 — Norme NF S 62-201',
    periodicite_check: 12,
    periodicite_visuelle: 3,
    duree_vie_max: null,
    notes: 'Vérification annuelle par organisme agréé',
  },
  {
    id: 'alarme_incendie',
    label: 'Système alarme incendie',
    icon: '🔔',
    category: 'incendie',
    reglementation: 'Art. R4227-34 à R4227-36 Code du Travail',
    periodicite_check: 12,
    periodicite_visuelle: 3,
    duree_vie_max: null,
    notes: 'Obligatoire dans tout établissement >50 personnes',
  },
  {
    id: 'eclairage_securite',
    label: 'Éclairage de sécurité (BAES)',
    icon: '💡',
    category: 'evacuation',
    reglementation: 'Art. R4227-14 Code du Travail',
    periodicite_check: 12,
    periodicite_visuelle: 1,
    duree_vie_max: null,
    notes: 'Vérification annuelle + test autonomie semestriel',
  },
  {
    id: 'plan_evacuation',
    label: 'Plan d\'évacuation',
    icon: '🗺️',
    category: 'evacuation',
    reglementation: 'Art. R4227-37 Code du Travail',
    periodicite_check: null,
    periodicite_visuelle: null,
    duree_vie_max: null,
    notes: 'Affiché à chaque niveau, mis à jour si modification des locaux',
  },
  {
    id: 'point_rassemblement',
    label: 'Signalisation point de rassemblement',
    icon: '🟢',
    category: 'evacuation',
    reglementation: 'Norme EN ISO 7010',
    periodicite_check: null,
    periodicite_visuelle: null,
    duree_vie_max: null,
    notes: 'Panneau vert + pictogramme blanc, visible de l\'extérieur',
  },
  {
    id: 'detecteur_fumee',
    label: 'Détecteur de fumée / Incendie',
    icon: '🔍',
    category: 'incendie',
    reglementation: 'NF S 61-970',
    periodicite_check: 12,
    periodicite_visuelle: 3,
    duree_vie_max: 10, // recommandé
    notes: 'Test fonctionnel semestriel recommandé',
  },
  {
    id: 'douche_oculaire',
    label: 'Douche / Rince-œil de sécurité',
    icon: '🚿',
    category: 'secours',
    reglementation: 'Norme NF EN 15154',
    periodicite_check: 3,
    periodicite_visuelle: 1,
    duree_vie_max: null,
    notes: 'Obligatoire si manipulation de produits chimiques corrosifs',
  },
]

export const EQUIPMENT_CATEGORIES = {
  incendie: { label: 'Lutte incendie', icon: '🔥', color: 'red' },
  secours: { label: 'Premiers secours', icon: '🩹', color: 'green' },
  evacuation: { label: 'Évacuation', icon: '🚪', color: 'blue' },
}

// ── STATUTS ÉQUIPEMENT ───────────────────────────────────────────
export const EQUIPMENT_STATUS = {
  conforme: { label: 'Conforme', icon: '✅', color: 'bg-green-100 text-green-800', ring: 'ring-green-500' },
  a_verifier: { label: 'Vérification requise', icon: '🔶', color: 'bg-amber-100 text-amber-800', ring: 'ring-amber-500' },
  non_conforme: { label: 'Non conforme', icon: '🔴', color: 'bg-red-100 text-red-800', ring: 'ring-red-500' },
  perime: { label: 'Périmé', icon: '⛔', color: 'bg-red-200 text-red-900', ring: 'ring-red-700' },
  manquant: { label: 'Manquant', icon: '❌', color: 'bg-gray-100 text-gray-600', ring: 'ring-gray-400' },
}

// ── HABILITATIONS & FORMATIONS TRAÇABLES ─────────────────────────
export const HABILITATION_TYPES = [
  {
    id: 'sst',
    label: 'SST — Sauveteur Secouriste du Travail',
    short: 'SST',
    icon: '🩺',
    duree_validite: 24, // mois
    reglementation: 'Art. R4224-15 Code du Travail',
    obligation: 'Min. 1 SST par atelier / chantier à travaux dangereux. Recommandation : 10-15% effectif',
    access_formation: true,
    access_ref: 'SST',
    color: 'emerald',
  },
  {
    id: 'mac_sst',
    label: 'MAC SST — Maintien & Actualisation des Compétences',
    short: 'MAC SST',
    icon: '🔄',
    duree_validite: 24,
    reglementation: 'Art. R4224-15 Code du Travail',
    obligation: 'Recyclage obligatoire tous les 24 mois',
    access_formation: true,
    access_ref: 'MAC SST',
    color: 'emerald',
  },
  {
    id: 'epi_incendie',
    label: 'EPI — Équipier de Première Intervention',
    short: 'EPI',
    icon: '🧯',
    duree_validite: 12, // recommandé annuel
    reglementation: 'Art. R4227-28 et R4227-39 Code du Travail',
    obligation: 'Min. 1 personne formée présente durant les heures de travail',
    access_formation: true,
    access_ref: 'EPI',
    color: 'red',
  },
  {
    id: 'evacuation',
    label: 'Exercice évacuation',
    short: 'ÉVAC',
    icon: '🚪',
    duree_validite: 6,
    reglementation: 'Art. R4227-39 Code du Travail',
    obligation: 'Exercice tous les 6 mois minimum (recommandation INRS)',
    access_formation: true,
    access_ref: 'ÉVAC',
    color: 'blue',
  },
  {
    id: 'caces_r489',
    label: 'CACES R489 — Chariots automoteurs',
    short: 'CACES R489',
    icon: '🏗️',
    duree_validite: 60,
    reglementation: 'Art. R4323-55 Code du Travail',
    obligation: 'Obligatoire pour la conduite de chariots élévateurs',
    access_formation: true,
    access_ref: 'CACES R489',
    color: 'amber',
  },
  {
    id: 'caces_r482',
    label: 'CACES R482 — Engins de chantier',
    short: 'CACES R482',
    icon: '🏗️',
    duree_validite: 60,
    reglementation: 'Art. R4323-55 Code du Travail',
    obligation: 'Obligatoire pour la conduite d\'engins de chantier',
    access_formation: true,
    access_ref: 'CACES R482',
    color: 'amber',
  },
  {
    id: 'caces_r486',
    label: 'CACES R486 — Nacelles (PEMP)',
    short: 'CACES R486',
    icon: '🏗️',
    duree_validite: 60,
    reglementation: 'Art. R4323-55 Code du Travail',
    obligation: 'Obligatoire pour la conduite de nacelles élévatrices',
    access_formation: true,
    access_ref: 'CACES R486',
    color: 'amber',
  },
  {
    id: 'habilitation_electrique',
    label: 'Habilitation électrique',
    short: 'ELEC',
    icon: '⚡',
    duree_validite: 36,
    reglementation: 'Art. R4544-10 Code du Travail',
    obligation: 'Obligatoire pour travaux d\'ordre électrique ou à proximité',
    access_formation: true,
    access_ref: 'H0B0',
    color: 'yellow',
  },
  {
    id: 'travail_hauteur',
    label: 'Travail en hauteur / Port du harnais',
    short: 'HAUTEUR',
    icon: '🪜',
    duree_validite: 36,
    reglementation: 'Art. R4323-89 Code du Travail',
    obligation: 'Recyclage recommandé tous les 3 ans',
    access_formation: true,
    access_ref: 'HAUTEUR',
    color: 'orange',
  },
  {
    id: 'aipr',
    label: 'AIPR — Réseaux',
    short: 'AIPR',
    icon: '🔌',
    duree_validite: 60,
    reglementation: 'Décret 2011-1241',
    obligation: 'Obligatoire pour travaux à proximité de réseaux',
    access_formation: false,
    color: 'violet',
  },
  {
    id: 'prap',
    label: 'PRAP — Prévention des Risques liés à l\'Activité Physique',
    short: 'PRAP',
    icon: '🏋️',
    duree_validite: 24,
    reglementation: 'Art. R4541-4 Code du Travail',
    obligation: 'Recommandé pour les postes avec manutention manuelle',
    access_formation: true,
    access_ref: 'PRAP',
    color: 'teal',
  },
]

// ── MOTEUR DE RÈGLES — Obligations automatiques ──────────────────
// Génère les obligations en fonction des risques identifiés, effectif, secteur

/**
 * Calcule les obligations réglementaires basées sur le contexte du DUERP
 * @param {Object} params - { risks, units, effectif, sector, surface }
 * @returns {Object} { equipements: [], formations: [], alertes: [] }
 */
export function computeObligations({ risks = [], units = [], effectif = 0, sector = '', surface = 0 }) {
  const riskNames = risks.map(r => (r.risk_name || '').toLowerCase())
  const riskCategories = [...new Set(risks.map(r => r.category_code).filter(Boolean))]
  const hasRisk = (keyword) => riskNames.some(r => r.includes(keyword))

  const equipements = []
  const formationsObl = []
  const alertes = []

  // ─── EXTINCTEURS ───
  // Toujours obligatoire
  const nbExtincteurs = surface > 0 ? Math.max(1, Math.ceil(surface / 200)) : units.length || 1
  equipements.push({
    type_id: 'extincteur_eau',
    quantite_requise: nbExtincteurs,
    obligatoire: true,
    raison: `${nbExtincteurs} extincteur(s) eau 6L requis (1/200m²${surface > 0 ? `, ${surface}m²` : ', estimation par unité'})`,
    priorite: 'critique',
  })

  // CO2 si risque électrique
  if (hasRisk('électri') || hasRisk('electri')) {
    equipements.push({
      type_id: 'extincteur_co2',
      quantite_requise: Math.max(1, Math.ceil(nbExtincteurs / 3)),
      obligatoire: true,
      raison: 'Risque électrique identifié → extincteur CO₂ obligatoire',
      priorite: 'critique',
    })
  }

  // Poudre si chimique/inflammable
  if (hasRisk('chimi') || hasRisk('inflamm') || hasRisk('explosion') || hasRisk('bitume') || hasRisk('soudage')) {
    equipements.push({
      type_id: 'extincteur_poudre',
      quantite_requise: 1,
      obligatoire: true,
      raison: 'Risque chimique/inflammable identifié → extincteur poudre recommandé',
      priorite: 'elevee',
    })
  }

  // ─── DAE ───
  const daeRecommande = hasRisk('électri') || hasRisk('electri') || effectif >= 50 || hasRisk('cardia')
  equipements.push({
    type_id: 'dae',
    quantite_requise: daeRecommande ? 1 : 0,
    obligatoire: false,
    raison: daeRecommande
      ? `Recommandé : ${effectif >= 50 ? 'effectif > 50' : 'risque électrique identifié'} — formation SST inclut manipulation DAE`
      : 'Non obligatoire mais recommandé pour la sécurité des salariés',
    priorite: daeRecommande ? 'elevee' : 'recommandee',
  })

  // ─── TROUSSE SECOURS ───
  equipements.push({
    type_id: 'trousse_secours',
    quantite_requise: Math.max(1, units.length),
    obligatoire: true,
    raison: `${Math.max(1, units.length)} trousse(s) requise(s) — 1 par unité de travail minimum`,
    priorite: 'critique',
  })

  // ─── DOUCHE/RINCE-OEIL ───
  if (hasRisk('chimi') || hasRisk('corros') || hasRisk('acide') || hasRisk('agent sensibili')) {
    equipements.push({
      type_id: 'douche_oculaire',
      quantite_requise: 1,
      obligatoire: true,
      raison: 'Risque chimique/corrosif identifié → douche/rince-œil obligatoire (NF EN 15154)',
      priorite: 'critique',
    })
  }

  // ─── COUVERTURE ANTI-FEU ───
  if (hasRisk('incendie') || hasRisk('cuisine') || sector === 'restauration') {
    equipements.push({
      type_id: 'couverture_anti_feu',
      quantite_requise: 1,
      obligatoire: false,
      raison: 'Recommandée pour les zones cuisine / risque incendie',
      priorite: 'recommandee',
    })
  }

  // ─── ALARME INCENDIE ───
  if (effectif >= 50) {
    equipements.push({
      type_id: 'alarme_incendie',
      quantite_requise: 1,
      obligatoire: true,
      raison: `Effectif ≥ 50 → système d'alarme incendie obligatoire`,
      priorite: 'critique',
    })
  }

  // ─── ÉCLAIRAGE SÉCURITÉ ───
  equipements.push({
    type_id: 'eclairage_securite',
    quantite_requise: 1,
    obligatoire: true,
    raison: 'Éclairage de sécurité obligatoire pour assurer l\'évacuation',
    priorite: 'elevee',
  })

  // ─── PLANS ÉVACUATION ───
  equipements.push({
    type_id: 'plan_evacuation',
    quantite_requise: Math.max(1, units.length),
    obligatoire: true,
    raison: 'Plan d\'évacuation affiché à chaque niveau / zone',
    priorite: 'elevee',
  })

  // ═══ FORMATIONS OBLIGATOIRES ═══

  // SST — toujours
  const nbSSTrecommande = Math.max(1, Math.ceil(effectif * 0.15))
  formationsObl.push({
    type_id: 'sst',
    nb_personnes_requises: nbSSTrecommande,
    obligatoire: true,
    raison: `${nbSSTrecommande} SST recommandé(s) (15% de ${effectif || '?'} salariés) — min. 1 par atelier dangereux`,
    priorite: 'critique',
  })

  // EPI — toujours
  formationsObl.push({
    type_id: 'epi_incendie',
    nb_personnes_requises: Math.max(1, Math.ceil(effectif * 0.10)),
    obligatoire: true,
    raison: 'Min. 1 EPI présent en permanence. Recommandé : 10% effectif',
    priorite: 'critique',
  })

  // Évacuation — toujours
  formationsObl.push({
    type_id: 'evacuation',
    nb_personnes_requises: effectif || 1,
    obligatoire: true,
    raison: 'Tout le personnel doit participer aux exercices d\'évacuation',
    priorite: 'critique',
  })

  // Habilitation électrique si risque
  if (hasRisk('électri') || hasRisk('electri')) {
    formationsObl.push({
      type_id: 'habilitation_electrique',
      nb_personnes_requises: null,
      obligatoire: true,
      raison: 'Risque électrique identifié → habilitation obligatoire pour les intervenants',
      priorite: 'critique',
    })
  }

  // CACES si engins
  if (hasRisk('chario') || hasRisk('engin') || hasRisk('nacelle') || hasRisk('élévat')) {
    if (hasRisk('chario') || hasRisk('élévat')) {
      formationsObl.push({ type_id: 'caces_r489', nb_personnes_requises: null, obligatoire: true, raison: 'Utilisation de chariots identifiée', priorite: 'critique' })
    }
    if (hasRisk('engin')) {
      formationsObl.push({ type_id: 'caces_r482', nb_personnes_requises: null, obligatoire: true, raison: 'Utilisation d\'engins de chantier identifiée', priorite: 'critique' })
    }
    if (hasRisk('nacelle') || hasRisk('pemp') || hasRisk('hauteur')) {
      formationsObl.push({ type_id: 'caces_r486', nb_personnes_requises: null, obligatoire: true, raison: 'Utilisation de nacelles identifiée', priorite: 'critique' })
    }
  }

  // Travail en hauteur
  if (hasRisk('hauteur') || hasRisk('harnais') || hasRisk('échafaudage')) {
    formationsObl.push({
      type_id: 'travail_hauteur',
      nb_personnes_requises: null,
      obligatoire: true,
      raison: 'Risque chute de hauteur identifié → formation port du harnais obligatoire',
      priorite: 'elevee',
    })
  }

  // PRAP si manutention
  if (hasRisk('activité physique') || hasRisk('manutention') || hasRisk('posture') || hasRisk('tms') || hasRisk('gestes et postures')) {
    formationsObl.push({
      type_id: 'prap',
      nb_personnes_requises: null,
      obligatoire: false,
      raison: 'Risque de TMS/manutention identifié → PRAP recommandé',
      priorite: 'recommandee',
    })
  }

  // ═══ ALERTES AUTO ═══
  if (effectif >= 20 && !hasRisk('incendie')) {
    alertes.push({
      type: 'warning',
      message: 'Effectif ≥ 20 : vérifiez que le risque incendie est bien évalué dans le DUERP',
    })
  }

  if (effectif >= 11) {
    alertes.push({
      type: 'info',
      message: `Effectif ≥ 11 : un CSE doit être en place. Ses membres doivent être formés (Art. R2315-10).`,
    })
  }

  if (effectif >= 200) {
    alertes.push({
      type: 'warning',
      message: 'Effectif ≥ 200 : une infirmerie est obligatoire (Art. R4214-23 Code du Travail)',
    })
  }

  return { equipements, formations: formationsObl, alertes }
}

/**
 * Calcule le score de conformité global (0-100%)
 */
export function computeConformityScore(obligations, equipementData = [], habilitationData = []) {
  let total = 0
  let ok = 0

  // Vérifier les équipements obligatoires
  obligations.equipements.filter(e => e.obligatoire).forEach(obl => {
    total++
    const installed = equipementData.filter(eq => eq.type_id === obl.type_id && (eq.auto_status || eq.status) === 'conforme')
    if (installed.length >= (obl.quantite_requise || 1)) ok++
  })

  // Vérifier les formations obligatoires
  obligations.formations.filter(f => f.obligatoire).forEach(obl => {
    total++
    const hab = HABILITATION_TYPES.find(h => h.id === obl.type_id)
    if (!hab) return
    const valid = habilitationData.filter(h =>
      h.type_id === obl.type_id &&
      h.expiry_date &&
      new Date(h.expiry_date) > new Date()
    )
    if (obl.nb_personnes_requises) {
      if (valid.length >= obl.nb_personnes_requises) ok++
      else if (valid.length > 0) ok += 0.5 // partiellement conforme
    } else {
      if (valid.length > 0) ok++
    }
  })

  return total > 0 ? Math.round((ok / total) * 100) : 0
}

/**
 * Calcule le statut d'un équipement basé sur ses dates
 */
export function getEquipmentAutoStatus(equip) {
  const today = new Date()
  const type = EQUIPMENT_TYPES.find(t => t.id === equip.type_id)
  if (!type) return equip.status || 'conforme'

  // Les dates ont priorité sur le statut manuel (péremption, contrôle dépassé)
  // Vérifier péremption
  if (equip.expiry_date && new Date(equip.expiry_date) < today) return 'perime'

  // Vérifier si prochain contrôle dépassé
  if (equip.next_check_date && new Date(equip.next_check_date) < today) return 'a_verifier'

  // Vérifier durée de vie max
  if (type.duree_vie_max && equip.install_date) {
    const installDate = new Date(equip.install_date)
    const maxDate = new Date(installDate)
    maxDate.setFullYear(maxDate.getFullYear() + type.duree_vie_max)
    if (maxDate < today) return 'perime'
  }

  // Vérifier si contrôle annuel dépassé
  if (type.periodicite_check && equip.last_check_date) {
    const lastCheck = new Date(equip.last_check_date)
    const nextDue = new Date(lastCheck)
    nextDue.setMonth(nextDue.getMonth() + type.periodicite_check)
    if (nextDue < today) return 'a_verifier'
  }

  // Respecter le statut saisi manuellement (manquant, non_conforme, a_verifier…)
  return equip.status || 'conforme'
}

/**
 * Calcule le statut d'une habilitation basé sur la date d'expiration
 */
export function getHabilitationStatus(hab) {
  if (!hab.expiry_date) return 'unknown'
  const today = new Date()
  const expiry = new Date(hab.expiry_date)
  const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24))

  if (daysLeft < 0) return 'expiree'
  if (daysLeft < 60) return 'bientot'
  return 'valide'
}

// Analyse du besoin remplie par l'entreprise depuis son espace (0486, Qualiopi indicateur 4).
// Règles partagées entre le formulaire de l'espace entreprise et l'écran de l'organisme. Les listes fermées sont
// les mêmes que dans public.ent_besoin_enregistrer (supabase/migrations/0486_besoin_espace_client.sql) : un test
// vérifie qu'elles restent identiques.
// Handicap : on ne demande que « besoin d'adaptation oui ou non » et la personne à contacter, jamais le détail de
// santé, qui reste entre le stagiaire et le référent handicap.

export const MOTIFS = [
  { value: 'reglementation', label: 'Réglementation, obligation légale' },
  { value: 'accident', label: 'Suite à un accident ou un incident' },
  { value: 'renouvellement', label: 'Renouvellement de certificats' },
  { value: 'nouveaux_embauches', label: 'Nouveaux embauchés' },
  { value: 'evolution_risques', label: 'Évolution des risques' },
  { value: 'autre', label: 'Autre (préciser)' },
]

export const PROFILS = [
  { value: 'administratif', label: 'Administratif' },
  { value: 'production', label: 'Production' },
  { value: 'terrain', label: 'Terrain' },
  { value: 'encadrement', label: 'Encadrement' },
]

export const NIVEAUX = [
  { value: 'debutant', label: 'Débutant' },
  { value: 'intermediaire', label: 'Intermédiaire' },
  { value: 'avance', label: 'Avancé' },
]

export const ETATS_BESOIN = {
  a_completer: 'À remplir',
  a_valider: 'Envoyée, en relecture par votre organisme',
  validee: 'Validée par votre organisme',
  organisme: 'Réalisée avec votre organisme',
}

export const LONGUEURS = { objectives_description: 2000, context_stakes: 2000, other_constraints: 2000, company_equipment_details: 1000, context_other: 500, preferred_schedule: 500, psh_contact: 200 }

export function reponsesVides() {
  return {
    context_reasons: [], context_other: '', context_stakes: '', objectives_description: '', participants_count: '',
    participants_profiles: [], level: '', particularities_non_french: false, preferred_schedule: '',
    company_equipment: null, company_equipment_details: '', ppe_provided: null, other_constraints: '',
    psh_adaptation: null, psh_contact: '',
  }
}

// Reprend des réponses déjà envoyées (null devient vide pour les champs de saisie)
export function depuisReponses(r) {
  const base = reponsesVides()
  if (!r) return base
  const out = { ...base }
  for (const k of Object.keys(base)) {
    if (r[k] === null || r[k] === undefined) continue
    out[k] = k === 'participants_count' ? String(r[k]) : r[k]
  }
  return out
}

// Même contrôle que la base, pour dire tout de suite ce qui manque. Renvoie le premier message, ou null.
export function verifierReponses(r) {
  if (!r || !Array.isArray(r.context_reasons) || r.context_reasons.length === 0) return 'Indiquez au moins un motif de la formation'
  const n = Number(String(r.participants_count ?? '').trim())
  if (!/^\s*\d{1,3}\s*$/.test(String(r.participants_count ?? '')) || n < 1) return 'Indiquez le nombre de participants'
  if (!String(r.objectives_description || '').trim()) return 'Décrivez ce que vous attendez de la formation'
  if (typeof r.psh_adaptation !== 'boolean') return 'Répondez à la question sur le besoin d\'adaptation'
  if (r.psh_adaptation && !String(r.psh_contact || '').trim()) return 'Indiquez la personne à contacter pour l\'adaptation'
  for (const [k, max] of Object.entries(LONGUEURS)) {
    if (String(r[k] || '').trim().length > max) return `Texte trop long (${max} caractères au plus)`
  }
  return null
}

// Nombre d'analyses que l'entreprise doit encore remplir (accueil « À faire »)
export function besoinsARemplir(liste) {
  return (Array.isArray(liste) ? liste : []).filter((b) => b.modifiable && b.etat === 'a_completer').length
}

// Côté organisme : état de l'analyse d'une session
export function etatBesoinOrganisme(a) {
  if (!a) return 'absente'
  if (a.org_validated_at) return 'validee'
  if (a.client_submitted_at) return 'a_valider'
  if (a.filled_at) return 'remplie'
  return 'absente'
}

// Résumé lisible des réponses de l'entreprise (fiche de session, traitement des demandes) : [libellé, valeur]
const libelle = (liste, v) => liste.find((x) => x.value === v)?.label || v
const ouiNon = (v) => (v === true ? 'Oui' : v === false ? 'Non' : 'Non précisé')
export function lignesBesoin(a) {
  if (!a) return []
  return [
    ['Motifs', (a.context_reasons || []).map((r) => (r === 'autre' && a.context_other ? `Autre : ${a.context_other}` : libelle(MOTIFS, r))).join(', ')],
    ['Attentes', a.objectives_description],
    ['Enjeux', a.context_stakes],
    ['Participants', [a.participants_count, (a.participants_profiles || []).map((p) => libelle(PROFILS, p)).join(', ')].filter(Boolean).join(' · ')],
    ['Niveau', a.level ? libelle(NIVEAUX, a.level) : 'Non précisé'],
    ['Non francophones', a.particularities_non_french ? 'Oui' : 'Non'],
    ['Besoin d\'adaptation', a.psh_adaptation ? `Oui, contact : ${a.psh_contact || ''}` : ouiNon(a.psh_adaptation)],
    ['Matériel de l\'entreprise', a.company_equipment ? `Oui${a.company_equipment_details ? ` : ${a.company_equipment_details}` : ''}` : ouiNon(a.company_equipment)],
    ['Équipements de protection fournis', ouiNon(a.ppe_provided)],
    ['Horaires souhaités', a.preferred_schedule],
    ['Autres contraintes', a.other_constraints],
  ].filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
}

// Demande « Formation intra » portant un besoin, pas encore reliée à une session (0487)
export function demandeAvecBesoin(d) {
  return d?.kind === 'demande_intra' && !d.session_id && !!d.payload?.besoin && typeof d.payload.besoin === 'object'
}

// Contenu d'une demande « Formation intra » (0487). Besoin décrit : l'effectif est celui du besoin (« Nombre de participants »),
// un seul chiffre saisi ; sinon le « Nombre de personnes » de la demande.
export function contenuDemandeIntra(f, stagiaires = []) {
  const avecBesoin = !!f?.avecBesoin
  const effectif = avecBesoin ? f.besoin?.participants_count : f?.effectif
  return {
    stagiaires, periode: f?.periode || null,
    effectif: effectif === null || effectif === undefined || String(effectif).trim() === '' ? null : String(effectif).trim(),
    ...(avecBesoin ? { besoin: f.besoin } : {}),
  }
}

// src/lib/mailingVars.js
// ─────────────────────────────────────────────────────────────────────────────
// Variables de personnalisation des campagnes mailing — Access Campus
//
// Fichier SANS dépendance : utilisé à la fois par le navigateur (Mailing.jsx)
// et par l'envoi côté serveur (api/mailing-cron.js).
//
// Variables disponibles :
//   {entreprise}  nom affiché (groupe ou entreprise)
//   {ville}       ville
//   {prenom}      prénom (contact client ou dirigeant)
//   {nom}         nom
//   {bonjour}     « Bonjour Madame Dupont, » si civilité + nom connus,
//                 sinon « Bonjour, »
// ─────────────────────────────────────────────────────────────────────────────

export const MAILING_VARIABLES = [
  { key: 'bonjour',    label: 'Formule d’appel', example: 'Bonjour Madame Dupont,' },
  { key: 'entreprise', label: 'Entreprise',      example: 'CAMPING DES DUNES' },
  { key: 'ville',      label: 'Ville',           example: 'Quimper' },
  { key: 'prenom',     label: 'Prénom',          example: 'Claire' },
  { key: 'nom',        label: 'Nom',             example: 'Dupont' },
]

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const cap = (s) => {
  const t = String(s || '').trim().toLowerCase()
  return t.replace(/(^|[\s-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase())
}

function civiliteLongue(civ) {
  const c = String(civ || '').trim().toLowerCase().replace(/\./g, '')
  if (['mme', 'madame', 'mlle', 'mademoiselle'].includes(c)) return 'Madame'
  if (['m', 'mr', 'monsieur'].includes(c)) return 'Monsieur'
  return ''
}

/**
 * Construit les variables d'un destinataire (depuis une ligne de mailing_audience_v)
 */
export function buildRecipientVars(aud) {
  const civ = civiliteLongue(aud?.civilite)
  const nom = aud?.nom ? cap(aud.nom) : ''
  const prenom = aud?.prenom ? cap(aud.prenom) : ''
  return {
    entreprise: aud?.display_name || '',
    ville: aud?.city ? cap(aud.city) : '',
    prenom,
    nom,
    bonjour: civ && nom ? `Bonjour ${civ} ${nom},` : 'Bonjour,',
  }
}

/**
 * Remplace les {variables}. Une variable vide est remplacée par une chaîne vide
 * (sauf {bonjour} qui vaut toujours au moins « Bonjour, »).
 * @param {string} text
 * @param {object} vars
 * @param {object} opts { html: true } → valeurs échappées pour le HTML
 */
export function applyMailingVars(text, vars = {}, opts = {}) {
  if (!text) return text
  return String(text).replace(/\{(bonjour|entreprise|ville|prenom|nom)\}/gi, (m, k) => {
    const key = k.toLowerCase()
    let v = vars?.[key]
    if (key === 'bonjour' && !v) v = 'Bonjour,'
    v = v == null ? '' : String(v)
    return opts.html ? escapeHtml(v) : v
  })
}

/** Liste des variables utilisées dans un texte (pour avertir si une valeur manque) */
export function usedMailingVars(text) {
  const found = new Set()
  String(text || '').replace(/\{(bonjour|entreprise|ville|prenom|nom)\}/gi, (m, k) => { found.add(k.toLowerCase()); return m })
  return [...found]
}

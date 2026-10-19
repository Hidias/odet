// Source unique de vérité pour l'identité de l'organisme dans les documents (PDF, emails).
// Tout vient de la table organization_settings. Aucune valeur d'organisme n'est écrite ici :
// un champ absent reste vide, et les générateurs vérifient les champs obligatoires
// avec missingOrgFields() avant de produire un document.

import { hexToRgb } from '../branding/colors'
import { supabase } from '../supabase'

export function formatSiret(siret) {
  if (!siret) return ''
  const digits = String(siret).replace(/\s/g, '')
  if (digits.length !== 14) return siret
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9, 14)}`
}

export function formatNda(nda) {
  if (!nda) return ''
  const digits = String(nda).replace(/\s/g, '')
  if (digits.length !== 11) return nda
  return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 9)} ${digits.slice(9, 11)}`
}

export function formatIban(iban) {
  if (!iban) return ''
  return String(iban).replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim()
}

// Libellés des champs pour les messages d'erreur
export const ORG_FIELD_LABELS = {
  name: "Nom de l'organisme",
  legal_name: 'Raison sociale',
  address: 'Adresse',
  postal_code: 'Code postal',
  city: 'Ville',
  phone: 'Téléphone',
  email: 'Email',
  siret: 'SIRET',
  nda: "Numéro de déclaration d'activité",
  tva_intra: 'TVA intracommunautaire',
  iban: 'IBAN',
  bic: 'BIC',
  dirigeant_name: 'Nom du dirigeant',
  forme_juridique: 'Forme juridique',
  naf: 'Code NAF',
}

// Champs nécessaires selon le type de document
export const ORG_REQUIRED = {
  convention: ['name', 'address', 'postal_code', 'city', 'siret', 'email', 'phone', 'dirigeant_name'],
  convocation: ['name', 'address', 'postal_code', 'city', 'email', 'phone'],
  attestation: ['name', 'address', 'postal_code', 'city', 'siret', 'dirigeant_name'],
  facture: ['legal_name', 'address', 'postal_code', 'city', 'siret', 'iban', 'bic'],
  devis: ['legal_name', 'address', 'postal_code', 'city', 'siret', 'email', 'phone'],
  base: ['name', 'address', 'postal_code', 'city'],
}

const rgb = (hex, fallback) => {
  const c = hexToRgb(hex) || hexToRgb(fallback)
  return [Math.round(c.r), Math.round(c.g), Math.round(c.b)]
}

function emptyORG() {
  return buildORG({})
}

/**
 * Construit l'objet ORG consommé par les générateurs à partir de la ligne organization_settings.
 * Les champs absents sont des chaînes vides (jamais une valeur d'un autre organisme).
 */
export function buildORG(o) {
  const s = o || {}
  const name = s.name || ''
  const legalName = s.legal_name || name
  const siretFormatted = s.siret ? formatSiret(s.siret) : ''
  const ndaFormatted = s.nda ? formatNda(s.nda) : ''
  const city = s.city || ''
  const postal = s.postal_code || ''
  const street = s.address || ''
  const address = [street, [postal, city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const addressFull = [street, [postal, city].filter(Boolean).join(' '), 'France'].filter(Boolean).join(' - ')
  // Site d'exploitation (0049) : affiché avec le siège, qui reste l'adresse légale
  const exploitationFull = [s.exploitation_address || '', [s.exploitation_postal_code || '', s.exploitation_city || ''].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ')
  // Adresse mise en avant sur les documents : le site d'exploitation s'il existe, sinon le siège. Le siège reste
  // l'adresse légale : il figure en mention (« Siège social : ... ») et dans les blocs juridiques (parties, vendeur).
  const adressePrincipale = exploitationFull || address
  const siegeMention = exploitationFull && address ? `Siège social : ${address}` : ''
  const qualiopi = !!s.qualiopi_certified
  const legalWithForm = s.forme_juridique && !legalName.toLowerCase().includes(s.forme_juridique.toLowerCase())
    ? `${s.forme_juridique} ${legalName}`
    : legalName

  const primary = s.brand_primary || '#1C2024'
  const accent = s.brand_accent || '#C8102E'
  const highlight = s.brand_highlight || '#D9A62E'

  return {
    // Identité
    name,
    legal_name: legalName,
    nameFull: legalWithForm ? `${legalWithForm}${qualiopi ? ' - Organisme de formation certifié Qualiopi' : ''}` : '',
    forme_juridique: s.forme_juridique || '',
    capital_social: s.capital_social || '',
    qualiopi_certified: qualiopi,
    activity_kind: s.activity_kind || 'of',
    doc_prefix: s.doc_prefix || (s.app_short_name || name).replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase(),
    // Adresse
    address,
    addressFull,
    street,
    city,
    postal_code: postal,
    lieu_signature: s.lieu_signature || city,
    exploitationFull,
    adressePrincipale,
    siegeMention,
    // Contact
    phone: s.phone || '',
    email: s.email || '',
    website: s.website || '',
    // Identifiants
    siret: siretFormatted,
    siren: s.siren || (s.siret ? String(s.siret).replace(/\s/g, '').slice(0, 9) : ''),
    naf: s.naf || '',
    tva: s.tva_intra || '',
    tva_applicable: s.tva_applicable !== false,
    rcs: s.rcs || '',
    tribunal_competent: s.tribunal_competent || '',
    nda: ndaFormatted || (s.name ? 'en cours d\'enregistrement' : ''),
    // NDA pas encore attribué : mention explicite plutôt qu'un champ vide (un organisme peut former avant l'enregistrement)
    ndaFull: ndaFormatted ? `${ndaFormatted}${s.nda_region ? ` auprès du préfet de la région ${s.nda_region}` : ''}` : (s.name ? 'en cours d\'enregistrement' : ''),
    // Vrai quand le numéro est attribué. Sinon les documents de formation portent la mention obligatoire
    // « Déclaration d'activité en cours d'enregistrement » (décision de H du 19/10 à 23h20), via ligneNda().
    ndaAttribue: !!ndaFormatted,
    nda_region: s.nda_region || '',
    // Banque
    bank_name: s.bank_name || '',
    iban: formatIban(s.iban),
    bic: s.bic || '',
    // Représentant légal
    dirigeant: s.dirigeant_name || '',
    dirigeant_title: s.dirigeant_title || '',
    dirigeant_signature_url: s.dirigeant_signature_url || null,
    dirigeant_signature_base64: s.dirigeant_signature_base64 || null,
    // Référent handicap
    // Référent handicap : rôle qualité (referent_handicap_info, joint par prepareOrgForPDF et fetchOrganization)
    referent_handicap_nom: s.referent_handicap_info?.nom || s.referent_handicap_nom || '',
    referent_handicap_email: s.referent_handicap_info?.email || s.referent_handicap_email || '',
    referent_handicap_phone: s.referent_handicap_info?.phone || s.referent_handicap_phone || '',
    // Textes
    reglement_interieur: s.reglement_interieur || '',
    livret_accueil: s.livret_accueil || '',
    conditions_annulation: s.conditions_annulation || '',
    cgv_url: s.cgv_url || '',
    google_review_url: s.google_review_url || '',
    // Visuels
    logo_url: s.logo_url || null,
    logo_base64: s.logo_base64 || null,
    stamp_base64: s.stamp_base64 || null,
    // Thème des documents (dérivé de la marque)
    theme: {
      primaryHex: primary,
      accentHex: accent,
      highlightHex: highlight,
      primary: rgb(primary, '#1C2024'),
      accent: rgb(accent, '#C8102E'),
      highlight: rgb(highlight, '#D9A62E'),
      text: [22, 24, 29],
      muted: [107, 114, 128],
      line: [228, 231, 235],
      surface: [244, 245, 247],
    },
  }
}

/**
 * Liste des champs manquants pour un type de document (libellés lisibles).
 * @param {object} orgSettings ligne organization_settings
 * @param {string} docKind clé de ORG_REQUIRED
 */
export function missingOrgFields(orgSettings, docKind = 'base') {
  const required = ORG_REQUIRED[docKind] || ORG_REQUIRED.base
  const s = orgSettings || {}
  return required
    .filter((f) => (f === 'legal_name' ? !(s.legal_name || s.name) : !s[f]))
    .map((f) => ORG_FIELD_LABELS[f] || f)
}

/**
 * Lève une erreur explicite si des champs obligatoires manquent.
 */
export function assertOrgReady(orgSettings, docKind = 'base') {
  const missing = missingOrgFields(orgSettings, docKind)
  if (missing.length > 0) {
    throw new Error(`Paramètres de l'organisme incomplets : ${missing.join(', ')}. Complétez-les dans Paramètres avant de générer ce document.`)
  }
}

async function urlToDataUrl(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Précharge en base64 les images nécessaires aux PDF (logo, signature du dirigeant)
 * à partir de leurs URL de stockage. Idempotent ; une image absente n'empêche pas la génération.
 */
export async function prepareOrgForPDF(organization) {
  if (!organization) return null
  let out = organization
  if (!out.referent_handicap_info) {
    try {
      const { data } = await supabase.rpc('referent_handicap_info')
      if (data) out = { ...out, referent_handicap_info: data }
    } catch (err) { console.warn('Référent handicap introuvable :', err.message) }
  }
  if (!out.logo_base64 && out.logo_url) {
    try { out = { ...out, logo_base64: await urlToDataUrl(out.logo_url) } } catch (err) { console.warn('Logo introuvable :', err.message) }
  }
  if (!out.dirigeant_signature_base64 && out.dirigeant_signature_url) {
    try { out = { ...out, dirigeant_signature_base64: await urlToDataUrl(out.dirigeant_signature_url) } } catch (err) { console.warn('Signature du dirigeant introuvable :', err.message) }
  }
  return out
}

// Adresse publique de l'instance (liens dans les documents et les emails)
export function publicBaseUrl() {
  const fromEnv = import.meta.env.VITE_PUBLIC_URL
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

/**
 * Identité pour un document hors formation (maintenance, vente de matériel, DUERP, documents internes) :
 * ni numéro de déclaration d'activité, ni mention « Organisme de formation certifié Qualiopi ». Ces mentions ne
 * valent que pour les actions de formation ; sur un rapport de vérification ou un devis de matériel, elles
 * induiraient le client en erreur. Le reste de l'identité est inchangé.
 */
export function orgHorsFormation(ORG) {
  if (!ORG) return ORG
  const suffixe = ' - Organisme de formation certifié Qualiopi'
  const nameFull = ORG.nameFull && ORG.nameFull.endsWith(suffixe) ? ORG.nameFull.slice(0, -suffixe.length) : ORG.nameFull
  return { ...ORG, nameFull, nda: '', ndaFull: '', horsFormation: true }
}

// Ligne d'identification à imprimer sur un document de formation (en-tête, pied de page, parties d'une convention) :
// « NDA 53 29 10261 29 » quand le numéro est attribué, la mention obligatoire sinon, rien pour un document hors formation.
export function ligneNda(ORG, { complet = false } = {}) {
  if (!ORG || ORG.horsFormation || !ORG.nda) return ''
  if (ORG.ndaAttribue === false || /en cours/.test(ORG.nda)) return "Déclaration d'activité en cours d'enregistrement"
  return `NDA ${complet ? (ORG.ndaFull || ORG.nda) : ORG.nda}`
}

// Même chose dans une phrase : « , déclaration d'activité n° … » ou « , déclaration d'activité en cours d'enregistrement »
export function phraseNda(ORG) {
  if (!ORG || ORG.horsFormation || !ORG.nda) return ''
  if (ORG.ndaAttribue === false || /en cours/.test(ORG.nda)) return "déclaration d'activité en cours d'enregistrement"
  return `déclaration d'activité n° ${ORG.ndaFull || ORG.nda}`
}

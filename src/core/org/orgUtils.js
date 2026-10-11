// ═══════════════════════════════════════════════════════════════
// orgUtils.js — Source unique de vérité pour les infos organisation
// utilisées dans les générateurs PDF (factures, devis, conventions, etc.)
//
// Au lieu d'avoir chaque générateur qui hardcode ses propres valeurs
// ou qui maintient sa propre logique de fallback, tout passe par
// buildORG(orgSettings) qui retourne un objet complet et normalisé.
//
// `orgSettings` correspond à la ligne de la table `organization_settings`
// (chargée via store.fetchOrganization). Peut être null/undefined.
// ═══════════════════════════════════════════════════════════════

/**
 * Formate un SIRET de 14 chiffres en groupes typographiques 3-3-3-5.
 * Ex : "94356386600012" → "943 563 866 00012"
 * Si la chaîne ne fait pas 14 chiffres (format inconnu), retourne tel quel.
 *
 * En BDD le SIRET est stocké au format ISO (14 chars sans espace, varchar(14)),
 * mais à l'affichage on préfère la version groupée plus lisible.
 */
export function formatSiret(siret) {
  if (!siret) return ''
  const digits = String(siret).replace(/\s/g, '')
  if (digits.length !== 14) return siret
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9, 14)}`
}

/**
 * Formate un NDA (Numéro de Déclaration d'Activité formation pro)
 * de 11 chiffres en groupes 2-2-5-2.
 * Ex : "53291026129" → "53 29 10261 29"
 */
export function formatNda(nda) {
  if (!nda) return ''
  const digits = String(nda).replace(/\s/g, '')
  if (digits.length !== 11) return nda
  return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 9)} ${digits.slice(9, 11)}`
}

/**
 * Valeurs par défaut hardcoded — fallback ultime si orgSettings est absent
 * ou si un champ spécifique manque en base.
 */
export const ORG_DEFAULTS = {
  // Identité légale
  name: 'Access Formation',
  nameFull: 'SARL Access Formation - Organisme de formation certifié Qualiopi',
  // Adresse
  address: '24 rue Kerbleiz, 29900 Concarneau',
  addressFull: '24 Rue Kerbleiz - 29900 Concarneau - France',
  city: 'Concarneau',
  postal_code: '29900',
  // Contact
  phone: '02 98 90 30 24',
  email: 'contact@accessformation.pro',
  website: 'www.accessformation.pro',
  // Identifiants entreprise (formatés pour affichage)
  siret: '943 563 866 00012',
  siren: '943 563 866',
  naf: '8559A',
  tva: 'FR71943563866',
  rcs: '943 563 866 R.C.S. Quimper',
  capital_social: '2 500',
  // Numéro Déclaration d'Activité
  nda: '53 29 10261 29',
  ndaFull: '53 29 10261 29 auprès du préfet de la région Bretagne',
  // Bancaire
  iban: 'FR76 1558 9297 0600 0890 6894 048',
  bic: 'CMBRFR2BXXXX',
  // Représentant légal
  dirigeant: 'Hicham SAIDI',
  dirigeant_signature_url: null,
  dirigeant_signature_base64: null,
  // Visuels
  logo_base64: null,
  stamp_base64: null,
}

/**
 * Construit un objet ORG normalisé pour les PDFs depuis orgSettings (BDD).
 *
 * Règles :
 * - Champ présent en BDD non-vide → utilisé tel quel (avec formatage automatique
 *   pour SIRET et NDA via formatSiret/formatNda)
 * - Champ absent/vide en BDD → fallback ORG_DEFAULTS
 * - `name` contient déjà le nom légal complet (ex: "SARL Access Formation - ...")
 *   donc on ne préfixe PAS "SARL " devant pour nameFull (évite le doublon)
 *
 * @param {object|null} orgSettings - ligne de la table organization_settings
 * @returns {object} - objet ORG complet, prêt à être consommé par les générateurs PDF
 */
export function buildORG(orgSettings) {
  if (!orgSettings) return { ...ORG_DEFAULTS }

  // SIRET et NDA : on les formate à l'affichage (en BDD ils sont au format brut ISO)
  const siretFormatted = orgSettings.siret ? formatSiret(orgSettings.siret) : ORG_DEFAULTS.siret
  const ndaFormatted = orgSettings.nda ? formatNda(orgSettings.nda) : ORG_DEFAULTS.nda

  return {
    ...ORG_DEFAULTS,

    // Identité légale
    name: orgSettings.name || ORG_DEFAULTS.name,
    nameFull: orgSettings.name || ORG_DEFAULTS.nameFull,

    // Adresse — recomposée si address + postal_code + city dispo, sinon fallback
    address: orgSettings.address
      ? `${orgSettings.address}, ${orgSettings.postal_code} ${orgSettings.city}`
      : ORG_DEFAULTS.address,
    addressFull: orgSettings.address
      ? `${orgSettings.address} - ${orgSettings.postal_code} ${orgSettings.city} - France`
      : ORG_DEFAULTS.addressFull,
    city: orgSettings.city || ORG_DEFAULTS.city,
    postal_code: orgSettings.postal_code || ORG_DEFAULTS.postal_code,

    // Contact
    phone: orgSettings.phone || ORG_DEFAULTS.phone,
    email: orgSettings.email || ORG_DEFAULTS.email,
    website: orgSettings.website || ORG_DEFAULTS.website,

    // Identifiants entreprise — formatés pour affichage
    siret: siretFormatted,
    siren: orgSettings.siren || ORG_DEFAULTS.siren,
    naf: orgSettings.naf || orgSettings.naf_code || ORG_DEFAULTS.naf,
    tva: orgSettings.tva || ORG_DEFAULTS.tva,
    rcs: orgSettings.rcs || ORG_DEFAULTS.rcs,
    capital_social: orgSettings.capital_social || ORG_DEFAULTS.capital_social,

    // Numéro Déclaration d'Activité — formaté pour affichage
    nda: ndaFormatted,
    ndaFull: orgSettings.nda
      ? `${ndaFormatted} auprès du préfet de la région Bretagne`
      : ORG_DEFAULTS.ndaFull,

    // Bancaire
    iban: orgSettings.iban || ORG_DEFAULTS.iban,
    bic: orgSettings.bic || ORG_DEFAULTS.bic,

    // Représentant légal
    dirigeant: orgSettings.dirigeant_name || ORG_DEFAULTS.dirigeant,
    dirigeant_signature_url: orgSettings.dirigeant_signature_url || null,
    // Préchargé en amont par l'appelant (composant React) ; data URL base64
    dirigeant_signature_base64: orgSettings.dirigeant_signature_base64 || null,

    // Visuels
    logo_base64: orgSettings.logo_base64 || null,
    stamp_base64: orgSettings.stamp_base64 || null,
  }
}

/**
 * Précharge la signature manuscrite du dirigeant (URL → data URL base64).
 *
 * Pourquoi : les générateurs PDF (jsPDF) doivent recevoir l'image en base64
 * pour pouvoir l'embarquer dans le PDF (`doc.addImage(base64, ...)`).
 * Or `organization.dirigeant_signature_url` est une URL Supabase Storage,
 * il faut donc faire un fetch et convertir.
 *
 * Cette fonction est idempotente :
 * - Si organization a déjà un `dirigeant_signature_base64` non-vide, retourne tel quel
 * - Si pas d'URL ni de base64, retourne tel quel (signature absente)
 * - Sinon fetch + convert + retourne organization enrichi
 *
 * En cas d'erreur réseau ou de fetch, retourne organization tel quel sans signature
 * pour ne pas bloquer la génération du PDF (la signature est optionnelle).
 *
 * @param {object|null} organization - ligne de la table organization_settings
 * @returns {Promise<object|null>} organization enrichi avec dirigeant_signature_base64
 */
export async function prepareOrgForPDF(organization) {
  if (!organization) return null

  // Déjà préchargée → ne rien faire
  if (organization.dirigeant_signature_base64) return organization

  // Pas d'URL → rien à précharger
  if (!organization.dirigeant_signature_url) return organization

  try {
    const response = await fetch(organization.dirigeant_signature_url)
    if (!response.ok) {
      console.warn(`Signature dirigeant introuvable (HTTP ${response.status}):`, organization.dirigeant_signature_url)
      return organization
    }
    const blob = await response.blob()
    // Convertir le blob en data URL base64
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    return { ...organization, dirigeant_signature_base64: base64 }
  } catch (err) {
    console.warn('Erreur préchargement signature dirigeant:', err)
    return organization
  }
}

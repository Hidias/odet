// Accès synchrone à l'identité de l'organisme et à l'équipe, pour le code qui n'est pas
// un composant React (objets d'emails, prompts, valeurs par défaut de formulaires).
// Les valeurs viennent de la marque publique (get_public_branding) et de la table profiles ;
// aucune valeur d'un organisme particulier n'est écrite ici.

const BRANDING_CACHE_KEY = 'odet.branding.v1'
let brandingCache = null
let societeCache = null
let teamCache = []
let meCache = null

export function setOrgCache(b) { brandingCache = b }

// Identité de la société courante quand ce n'est pas la société de l'instance (C3) : elle remplace les champs
// juridiques et de contact de l'organisme pour les documents ; la marque de l'application reste celle du groupe.
export function setSocieteCache(identite) {
  societeCache = identite ? {
    org_name: identite.name || identite.legal_name, legal_name: identite.legal_name, email: identite.email,
    phone: identite.phone, website: identite.website, address: identite.address, postal_code: identite.postal_code,
    city: identite.city, siret: identite.siret, nda: identite.nda, doc_prefix: identite.doc_prefix,
  } : null
}
// Comptes qui ne font pas partie de l'équipe (22/10 : un compte de l'espace entreprise apparaissait parmi les
// interlocuteurs d'un devis) : clients et stagiaires ont un profil pour se connecter, ils ne sont jamais proposés
// comme membre de l'équipe. Filtre PostgREST à passer à .or() sur les lectures de profiles.
export const ROLES_HORS_EQUIPE = ['entreprise', 'stagiaire']
export const FILTRE_EQUIPE = `role.is.null,role.not.in.(${ROLES_HORS_EQUIPE.join(',')})`
export const estEquipe = (p) => !ROLES_HORS_EQUIPE.includes(p?.role)

export function setTeamCache(list) { teamCache = Array.isArray(list) ? list : [] }
export function setCurrentProfile(p) { meCache = p || null }

function brut() {
  if (brandingCache) return brandingCache
  try { return JSON.parse(localStorage.getItem(BRANDING_CACHE_KEY) || '{}') } catch { return {} }
}

function b() {
  if (!societeCache) return brut()
  const out = { ...brut() }
  for (const [k, v] of Object.entries(societeCache)) out[k] = v ?? null
  return out
}

export const orgName = () => b().org_name || ''
export const orgLegalName = () => b().legal_name || b().org_name || ''
export const orgEmail = () => b().email || ''
export const orgPhone = () => b().phone || ''
export const orgWebsite = () => b().website || ''
export const orgCity = () => b().city || ''
export const orgSiret = () => b().siret || ''
export const orgNda = () => b().nda || ''
export const orgDirigeant = () => b().dirigeant_name || ''
export const orgAddressLine = () => [b().address, [b().postal_code, b().city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
/** Identité juridique et adresse de la société courante (formulaires officiels : certificat de cession, constat) */
export const orgIdentite = () => {
  const o = b()
  return { legal_name: orgLegalName(), siret: o.siret || '', address: o.address || '', postal_code: o.postal_code || '', city: o.city || '', phone: o.phone || '', email: o.email || '' }
}
export const orgQualiopi = () => !!b().qualiopi_certified
export const appName = () => b().app_name || b().org_name || ''

/** Initiales de l'entreprise (Paramètres > Documents), en majuscules ; déduites du nom court à défaut */
export const orgDocPrefix = () => String(b().doc_prefix || b().app_short_name || b().org_name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase()

/** Code documentaire précédé des initiales de l'entreprise : docCode('PROG-SST') donne « ABC-PROG-SST » pour les initiales ABC */
export const docCode = (code) => [orgDocPrefix(), code].filter(Boolean).join('-')

/** Ligne de contact pour les textes générés : « email | téléphone | site » (champs absents omis) */
export const orgContactLine = () => [orgEmail(), orgPhone(), orgWebsite().replace(/^https?:\/\//, '')].filter(Boolean).join(' | ')

/** Nom affiché d'un profil */
export function profileName(p) {
  if (!p) return ''
  return p.display_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || ''
}

/** Prénom de l'utilisateur connecté (ou son nom affiché) */
export function currentUserFirstName() {
  return meCache?.first_name || profileName(meCache).split(' ')[0] || ''
}

/** Nom complet de l'utilisateur connecté */
export function currentUserName() {
  return profileName(meCache)
}

export function currentUserEmail() {
  return meCache?.sender_email || meCache?.email || ''
}

/** Membres actifs de l'équipe (hors comptable et lecture seule) : [{ id, name, firstName, email, role }] */
export function team() {
  return teamCache
}

/** Noms complets de l'équipe ; l'utilisateur connecté en premier */
export function teamNames() {
  const me = currentUserName()
  const names = teamCache.map((t) => t.name).filter(Boolean)
  return me ? [me, ...names.filter((n) => n !== me)] : names
}

/** Prénoms de l'équipe ; l'utilisateur connecté en premier */
export function teamFirstNames() {
  const me = currentUserFirstName()
  const names = teamCache.map((t) => t.firstName).filter(Boolean)
  return [...new Set(me ? [me, ...names] : names)]
}

/** Retrouve le membre de l'équipe par adresse email (prénom), sinon l'utilisateur connecté */
export function teamFirstNameByEmail(email) {
  const e = String(email || '').toLowerCase()
  const m = teamCache.find((t) => t.email && t.email.toLowerCase() === e)
  return m?.firstName || currentUserFirstName()
}

/** Nom complet d'un membre à partir de son prénom (repli : l'utilisateur connecté) */
export function teamNameByFirstName(first) {
  const m = teamCache.find((t) => t.firstName === first)
  return m?.name || currentUserName()
}

export const orgPostalCode = () => b().postal_code || ''
export const orgReferentHandicap = () => b().referent_handicap_nom || ''

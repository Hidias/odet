// api/_lib/redact.js : masquage des données personnelles dans les journaux.
// Règle (chantier F, écart 14) : aucune donnée personnelle dans les journaux des fonctions /api
// ni dans le suivi des erreurs. Ce fichier est la seule source de la règle : il sert aux routes /api
// (journaux Vercel et suivi des erreurs) et au navigateur (src/core/errors/reporter.js).
// Sans dépendance Node : utilisable des deux côtés.
//
// Masqué : adresses email, numéros de téléphone français, IBAN, numéros de sécurité sociale,
// jetons (JWT, « Bearer », paramètres access_token / refresh_token / code / password / secret).
// Les noms de personnes ne sont pas reconnaissables par motif : les journaux ne doivent pas en écrire
// (liste des journaux à reprendre : docs/journaux-sans-donnees-personnelles.md).

const RULES = [
  // Jetons d'authentification (avant les nombres, pour ne pas les découper)
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jeton]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [jeton]'],
  [/((?:access_token|refresh_token|id_token|client_secret|password|passwd|secret|token)["']?\s*[:=]\s*["']?)[^"'&\s,}]{4,}/gi, '$1[masqué]'],
  // Paramètres d'adresse sensibles (retour OAuth, liens de portail) : ?code=…&state=…
  [/([?&](?:code|state|jeton|t)=)[^&\s"']+/gi, '$1[masqué]'],
  // Emails
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  // IBAN (FR76 1234 ... ou sans espaces)
  [/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g, '[IBAN]'],
  // Numéro de sécurité sociale (13 chiffres, clé facultative, espaces possibles)
  [/\b[12][ .]?\d{2}[ .]?\d{2}[ .]?(?:\d{2}|2A|2B)[ .]?\d{3}[ .]?\d{3}(?:[ .]?\d{2})?\b/g, '[NIR]'],
  // Téléphones français : 06 12 34 56 78, 06.12.34.56.78, 0612345678, +33 6 12 34 56 78
  [/(?:\+33[ .-]?|\b0)[1-9](?:[ .-]?\d{2}){4}\b/g, '[téléphone]'],
]

/** Texte sans données personnelles reconnaissables. Toute autre valeur est rendue telle quelle. */
export function redact(value) {
  if (typeof value !== 'string' || !value) return value
  let out = value
  for (const [re, by] of RULES) out = out.replace(re, by)
  return out
}

/** Valeur quelconque (objet, erreur) transformée en texte puis masquée, pour un journal. */
export function redactAny(value) {
  if (value == null) return value
  if (typeof value === 'string') return redact(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Error) {
    const e = new Error(redact(value.message || ''))
    e.name = value.name
    e.stack = redact(value.stack || '')
    return e
  }
  try { return redact(JSON.stringify(value)) } catch { return '[valeur illisible]' }
}

let installed = false
/**
 * Masque les données personnelles de tous les journaux console de la fonction serveur.
 * Installé une fois par l'import de api/_lib/errors.js, donc par chaque route /api.
 */
export function installConsoleRedaction(target = globalThis.console) {
  if (installed || !target) return
  installed = true
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = target[level]
    if (typeof original !== 'function') continue
    target[level] = (...args) => original.apply(target, args.map(redactAny))
  }
}

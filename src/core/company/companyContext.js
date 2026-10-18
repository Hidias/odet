// Société courante et trace de l'accès de support (socle multi-sociétés, chantier C1a).
//
// 1. Société courante : quand une société a été choisie (écran de choix et sélecteur, chantier C3),
//    chaque requête vers la base porte l'en-tête x-company-id. La base le contrôle (app.current_company) :
//    une société non autorisée retombe sur la société par défaut du compte. Tant qu'aucune société n'est
//    choisie (une seule société aujourd'hui), aucun en-tête n'est envoyé : rien ne change.
//    Le choix est gardé par onglet (sessionStorage) : deux onglets peuvent travailler sur deux sociétés.
//
// 2. Trace de l'accès de support : la base lit les données en lecture seule et ne peut pas écrire au journal
//    pendant une lecture. Pour le super administrateur seulement, l'application note les tables lues et les
//    envoie par lots à la fonction support_trace, qui contrôle l'appelant et écrit au journal d'audit
//    (société, tables, page ; jamais de valeur lue). Toute erreur de trace est silencieuse et ne bloque rien ;
//    si la fonction n'existe pas encore en base, la trace s'arrête pour la session.

const CLE_SOCIETE = 'odet.societe_courante'
const DELAI_ENVOI_MS = 15000
const MAX_TABLES = 100

let societeMemoire = null
let traceActive = false
let traceCoupee = false
let envoyeur = null
let tablesLues = new Set()
let minuterie = null

function lireStockage() {
  try {
    return window.sessionStorage.getItem(CLE_SOCIETE)
  } catch {
    return null
  }
}

export function getCurrentCompanyId() {
  return societeMemoire || lireStockage() || null
}

// Appelé par l'écran de choix ou le sélecteur (C3). null = revenir à la société par défaut.
export function setCurrentCompanyId(id) {
  societeMemoire = id || null
  try {
    if (id) window.sessionStorage.setItem(CLE_SOCIETE, id)
    else window.sessionStorage.removeItem(CLE_SOCIETE)
  } catch {
    /* stockage indisponible : la valeur reste en mémoire */
  }
}

// Branché par supabase.js : fonction (tables, page) => promesse { error }
export function setTraceSender(fn) {
  envoyeur = fn
}

// Appelé par le store à chaque connexion ou déconnexion
export function configureCompanyContext({ role } = {}) {
  const avant = traceActive
  traceActive = role === 'superadmin'
  if (avant && !traceActive) {
    envoyerTrace()
  }
  if (!role) {
    tablesLues = new Set()
    setCurrentCompanyId(null)
  }
}

// Table lue par une requête de lecture vers l'API de la base (null si autre chose)
export function tableLue(url, method) {
  const m = String(method || 'GET').toUpperCase()
  if (m !== 'GET' && m !== 'HEAD') return null
  let chemin
  try {
    chemin = new URL(url, 'http://local').pathname
  } catch {
    return null
  }
  const i = chemin.indexOf('/rest/v1/')
  if (i < 0) return null
  const reste = chemin.slice(i + '/rest/v1/'.length)
  if (!reste || reste.startsWith('rpc/')) return null
  const nom = decodeURIComponent(reste.split('/')[0])
  return /^[a-z_][a-z0-9_]{0,62}$/.test(nom) ? nom : null
}

function pageCourante() {
  try {
    return (window.location.hash || '#/').split('?')[0].slice(0, 200)
  } catch {
    return null
  }
}

function noterLecture(table) {
  if (!traceActive || traceCoupee || !table) return
  tablesLues.add(table)
  if (tablesLues.size >= MAX_TABLES) {
    envoyerTrace()
    return
  }
  if (!minuterie) {
    minuterie = setTimeout(envoyerTrace, DELAI_ENVOI_MS)
  }
}

export async function envoyerTrace() {
  if (minuterie) {
    clearTimeout(minuterie)
    minuterie = null
  }
  if (!tablesLues.size || !envoyeur || traceCoupee) return
  const tables = [...tablesLues]
  tablesLues = new Set()
  try {
    const res = await envoyeur(tables, pageCourante())
    const code = res?.error?.code
    // Fonction absente de la base (migration non appliquée) : on arrête la trace pour cette session
    if (code === 'PGRST202' || code === '42883' || res?.status === 404) traceCoupee = true
  } catch {
    /* la trace ne bloque jamais l'application */
  }
}

// Enveloppe de fetch donnée au client Supabase
export function createCompanyFetch(baseFetch) {
  return (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || String(input)
    const methode = init.method || (typeof input === 'object' && input?.method) || 'GET'
    let options = init
    const societe = getCurrentCompanyId()
    if (societe && url.includes('/rest/v1/')) {
      const entetes = new Headers(init.headers || (typeof input === 'object' ? input?.headers : undefined) || {})
      entetes.set('x-company-id', societe)
      options = { ...init, headers: entetes }
    }
    if (traceActive) noterLecture(tableLue(url, methode))
    return baseFetch(input, options)
  }
}

// Envoi des lectures restantes quand l'onglet passe en arrière-plan
try {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') envoyerTrace()
  })
} catch {
  /* hors navigateur (tests) */
}

// Pour les tests
export function _etatTrace() {
  return { traceActive, traceCoupee, tables: [...tablesLues] }
}
export function _reinitialiser() {
  societeMemoire = null
  traceActive = false
  traceCoupee = false
  envoyeur = null
  tablesLues = new Set()
  if (minuterie) clearTimeout(minuterie)
  minuterie = null
}

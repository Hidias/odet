// Remontée des erreurs du navigateur vers la table error_logs (fonction log_error).
// Ne bloque jamais l'application : toute erreur d'envoi est ignorée.
// Garde-fous : erreurs de chargement après mise à jour ignorées (rechargement automatique),
// même erreur envoyée une seule fois par minute, 20 envois au plus par page ouverte.
import { supabase } from '../supabase'
import { APP_VERSION } from '../version'
import { CHUNK_ERROR } from './chunkReload'
// Règle commune aux routes /api : aucune donnée personnelle dans le suivi des erreurs
import { redact } from '../../../api/_lib/redact.js'

const IGNORED = [
  CHUNK_ERROR,
  /ResizeObserver loop/i, // bruit du navigateur, sans effet
  /^Script error\.?$/i, // erreur d'un script externe, sans détail exploitable
]

const sent = new Map()
let budget = 20

// Origine d'après l'adresse : portail stagiaire, espace entreprise, ou application
export function currentSource() {
  const h = (typeof window !== 'undefined' && window.location.hash) || ''
  if (h.startsWith('#/portail') || h.startsWith('#/reclamation')) return 'portail'
  if (h.startsWith('#/entreprise')) return 'entreprise'
  return 'app'
}

// Page sans identifiants ni jetons (« /sessions/:id », « /portail/:jeton »)
export function currentPage() {
  const h = (typeof window !== 'undefined' && window.location.hash) || ''
  const path = (h.replace(/^#/, '').split('?')[0] || '/')
  return path
    .replace(/^\/(portail|entreprise)\/[^/]+/, '/$1/:jeton')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
}

function normalize(err) {
  if (err instanceof Error) return { message: err.message || err.name || 'Erreur', stack: err.stack || '' }
  if (typeof err === 'string') return { message: err, stack: '' }
  try { return { message: JSON.stringify(err).slice(0, 500), stack: '' } } catch { return { message: String(err), stack: '' } }
}

export function reportError(err, extra = {}) {
  try {
    const { message, stack } = normalize(err)
    if (!message || IGNORED.some((re) => re.test(message))) return
    if (/chrome-extension:|moz-extension:|safari-extension:/.test(stack)) return // extension du navigateur
    const key = `${message}|${(stack.split('\n')[1] || '').trim()}`
    const last = sent.get(key) || 0
    if (Date.now() - last < 60000 || budget <= 0) return
    sent.set(key, Date.now())
    budget--
    const componentStack = extra.componentStack ? `\n\nComposants :${String(extra.componentStack).slice(0, 2000)}` : ''
    supabase.rpc('log_error', {
      p_source: currentSource(),
      p_message: redact(message),
      p_stack: redact(stack + componentStack) || null,
      p_page: currentPage(),
      p_user_agent: navigator.userAgent,
      p_app_version: APP_VERSION,
    }).then(() => {}, () => {})
  } catch { /* le signalement ne doit jamais provoquer d'erreur */ }
}

let installed = false
// Erreurs non gérées et promesses rejetées. S'ajoute aux écouteurs de rechargement de main.jsx sans les modifier.
export function installGlobalErrorHandlers() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => reportError(e?.error || e?.message || 'Erreur'))
  window.addEventListener('unhandledrejection', (e) => reportError(e?.reason || 'Promesse rejetée'))
}

import { supabase } from './supabase'
import { getCurrentCompanyId } from './company/companyContext'

// Appel d'une fonction serveur (api/) avec le jeton de l'utilisateur connecté
export async function callApi(path, body = {}, { method = 'POST' } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      // Société choisie dans cet onglet (C3) : les droits du serveur sont ceux de cette société
      ...(getCurrentCompanyId() ? { 'x-company-id': getCurrentCompanyId() } : {}),
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`)
  return json
}

/**
 * fetch() vers une fonction serveur (api/) avec le jeton de l'utilisateur connecté.
 * Même signature et même valeur de retour que fetch : à utiliser pour tous les appels /api/.
 */
export async function apiFetch(path, init = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(init.headers || {})
  if (session?.access_token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${session.access_token}`)
  if (getCurrentCompanyId() && !headers.has('x-company-id')) headers.set('x-company-id', getCurrentCompanyId())
  return fetch(path, { ...init, headers })
}

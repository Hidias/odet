import { supabase } from './supabase'

// Appel d'une fonction serveur (api/) avec le jeton de l'utilisateur connecté
export async function callApi(path, body = {}, { method = 'POST' } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`)
  return json
}

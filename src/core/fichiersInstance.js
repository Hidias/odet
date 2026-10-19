// Fichiers d'une autre instance : la base a été reprise d'un autre outil (Campus). Des formations et des documents
// de formation pointent encore vers le stockage Supabase de cet autre outil : leurs PDF portent l'identité d'un
// autre organisme (nom, SIREN, contacts). Ils ne doivent jamais être joints à un email ni montrés à un client.
//
// Règle : une adresse hébergée sur un AUTRE projet Supabase que celui de l'instance est écartée. Les adresses du
// stockage de l'instance et les adresses hors Supabase (site web saisi à la main) sont gardées.

const HOTE_SUPABASE = /(^|\.)supabase\.(co|in)$/i

function hote(url) {
  try { return new URL(url).hostname.toLowerCase() } catch { return null }
}

export function fichierDeLInstance(url, base = import.meta.env?.VITE_SUPABASE_URL) {
  if (!url || typeof url !== 'string') return null
  const h = hote(url)
  if (!h) return url // chemin relatif : stockage de l'instance
  if (!HOTE_SUPABASE.test(h)) return url
  const hb = hote(base || '')
  return hb && hb === h ? url : null
}

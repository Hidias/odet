// File locale des saisies du suivi formatif (coupures réseau en salle).
// Chaque geste est rangé ici d'abord, avec l'heure du téléphone, puis envoyé par save_formative_batch.
// Une saisie remplace la précédente pour le même stagiaire et la même séquence ; la base ignore une saisie
// plus ancienne que celle qu'elle a déjà (deux téléphones, ou file rejouée).

import { supabase } from '../../../core/supabase'

const keyFor = (sessionId) => `odet_suivi_queue_${sessionId}`

export function readQueue(sessionId) {
  try { return JSON.parse(localStorage.getItem(keyFor(sessionId)) || '[]') } catch { return [] }
}

function writeQueue(sessionId, items) {
  try { localStorage.setItem(keyFor(sessionId), JSON.stringify(items)) } catch { /* stockage plein ou indisponible */ }
}

const itemKey = (it) => `${it.type || 'trainee'}|${it.session_sequence_id}|${it.trainee_id || ''}`

/** Ajoute (ou remplace) une saisie dans la file et renvoie la file */
export function enqueue(sessionId, item) {
  const it = { ...item, client_updated_at: item.client_updated_at || new Date().toISOString() }
  const k = itemKey(it)
  const items = readQueue(sessionId).filter((x) => itemKey(x) !== k)
  items.push(it)
  writeQueue(sessionId, items)
  return items
}

/**
 * Envoie la file. Ne retire que les saisies envoyées sans qu'une plus récente ait été ajoutée entre-temps.
 * Renvoie { ok, sent, ignored, left, error }.
 */
export async function flush(sessionId) {
  const items = readQueue(sessionId)
  if (!items.length) return { ok: true, sent: 0, ignored: 0, left: 0 }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, sent: 0, ignored: 0, left: items.length, error: 'hors ligne' }
  const { data, error } = await supabase.rpc('save_formative_batch', { p_items: items })
  if (error) return { ok: false, sent: 0, ignored: 0, left: items.length, error: error.message }
  const sent = new Map(items.map((x) => [itemKey(x), x.client_updated_at]))
  const rest = readQueue(sessionId).filter((x) => {
    const at = sent.get(itemKey(x))
    return !at || x.client_updated_at > at
  })
  writeQueue(sessionId, rest)
  return { ok: true, sent: data?.saved || 0, ignored: data?.ignored || 0, left: rest.length }
}

/** Applique la file locale par-dessus les données lues en base (affichage immédiat, même hors ligne) */
export function applyQueue(sequences, evaluations, items) {
  const seqs = sequences.map((s) => ({ ...s }))
  const byId = new Map(seqs.map((s) => [s.id, s]))
  const evals = new Map(evaluations.map((e) => [`${e.session_sequence_id}|${e.trainee_id}`, { ...e }]))
  for (const it of items) {
    const s = byId.get(it.session_sequence_id)
    if (!s) continue
    if (it.type === 'group') {
      if (!s.group_updated_at || s.group_updated_at <= it.client_updated_at) {
        s.group_status = it.group_status || null
        s.group_remark = it.group_remark || null
        s.group_updated_at = it.client_updated_at
      }
    } else if (it.type === 'close') {
      s.closed_at = it.closed === false ? null : (s.closed_at || it.client_updated_at)
    } else {
      const k = `${it.session_sequence_id}|${it.trainee_id}`
      const cur = evals.get(k)
      if (cur && cur.client_updated_at > it.client_updated_at) continue
      if (it.clear) evals.delete(k)
      else evals.set(k, {
        ...(cur || {}),
        session_id: s.session_id,
        session_sequence_id: it.session_sequence_id,
        trainee_id: it.trainee_id,
        status: it.status || null,
        role: it.role || null,
        indicators_met: it.indicators_met || [],
        remark: it.remark || null,
        client_updated_at: it.client_updated_at,
      })
    }
  }
  return { sequences: seqs, evaluations: [...evals.values()] }
}

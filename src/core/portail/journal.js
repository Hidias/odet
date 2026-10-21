// Journal de l'espace client (0401) : connexions et documents téléchargés, avec l'empreinte SHA-256 du document remis.
// L'adresse IP et l'appareil sont relevés par le serveur. Une écriture du journal ne bloque jamais le téléchargement.

import { supabase } from '../supabase'

export const LIBELLES_DOCUMENT = {
  convention: 'Convention de formation',
  convention_signee: 'Convention signée et sa preuve',
  convocations: 'Convocations',
  emargement: "Feuille d'émargement",
  attestations: 'Attestations de présence',
  certificats: 'Certificats de réalisation',
  facture: 'Facture',
  devis: 'Devis',
  rapport: "Rapport d'intervention",
}

/** Empreinte SHA-256 (hexadécimal) d'un PDF fourni en base64 */
export async function empreinte(base64) {
  try {
    const bin = atob(base64)
    const octets = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i)
    const h = await crypto.subtle.digest('SHA-256', octets)
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch { return null }
}

/** Espace par lien et code */
export async function noterLien(token, code, { event, objectType = null, objectId = null, kind = null, label = null, base64 = null }) {
  try {
    const sha = base64 ? await empreinte(base64) : null
    await supabase.rpc('client_portal_journal', { p_token: token, p_code: code, p_event: event, p_object_type: objectType, p_object_id: objectId, p_kind: kind, p_label: label, p_sha256: sha })
  } catch { /* le journal ne bloque pas */ }
}

/** Espace par compte */
export async function noterCompte({ event, objectType = null, objectId = null, kind = null, label = null, base64 = null }) {
  try {
    const sha = base64 ? await empreinte(base64) : null
    await supabase.rpc('ent_journal', { p_event: event, p_object_type: objectType, p_object_id: objectId, p_kind: kind, p_label: label, p_sha256: sha })
  } catch { /* le journal ne bloque pas */ }
}

/** Une connexion notée par onglet et par jour (pas à chaque rechargement) */
export function premiereConnexionDuJour(cle) {
  try {
    const k = `odet.journal.${cle}`
    const jour = new Date().toISOString().slice(0, 10)
    if (sessionStorage.getItem(k) === jour) return false
    sessionStorage.setItem(k, jour)
    return true
  } catch { return true }
}

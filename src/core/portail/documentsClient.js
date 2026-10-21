// Documents mis à disposition dans l'espace client (0404) : dépôt par l'équipe (sans bloquer son geste), lecture par
// le client et par l'équipe. Le serveur vérifie les droits et range le fichier tel quel.

import { callApi } from '../api'

/** Met un PDF (base64) à disposition du client ; silencieux en cas d'échec (le geste de l'équipe n'est jamais bloqué) */
export async function mettreADisposition({ objectType, objectId, kind, label, base64 }) {
  try {
    return await callApi('/api/documents-client', { action: 'publier', object_type: objectType, object_id: objectId, kind, label, pdf_base64: base64 })
  } catch (e) {
    console.warn('Mise à disposition du document :', e.message)
    return null
  }
}

/** Contenu d'un document visible par le client (auth : { token, code } ou {} pour un compte), en ArrayBuffer */
export async function lireDocumentPortail(auth, documentId) {
  const { url } = await callApi('/api/documents-client', { ...auth, action: 'lire', document_id: documentId })
  const r = await fetch(url)
  if (!r.ok) throw new Error('Document indisponible')
  return r.arrayBuffer()
}

/** Contenu d'un document mis à disposition, lu par l'équipe (ArrayBuffer) */
export async function lireDocumentInterne(documentId) {
  const { url } = await callApi('/api/documents-client', { action: 'lire_interne', document_id: documentId })
  const r = await fetch(url)
  if (!r.ok) throw new Error('Document indisponible')
  return r.arrayBuffer()
}

export async function ouvrirDocumentInterne(documentId) {
  const { url } = await callApi('/api/documents-client', { action: 'lire_interne', document_id: documentId })
  window.open(url, '_blank', 'noopener')
}

/** Document signé à la main déposé par le client (0431) : cible { document_id } (devis) ou { session_id } (convention) */
export async function deposerSigne(auth, cible, { base64, avant, name }) {
  return callApi('/api/documents-client', { ...auth, ...cible, action: 'deposer_signe', pdf_base64: base64, original_bytes: avant, name })
}

/** Dépôt du client lu par l'équipe (lien de 5 minutes) */
export async function ouvrirDepot(depotId) {
  const { url } = await callApi('/api/documents-client', { action: 'lire_depot', depot_id: depotId })
  window.open(url, '_blank', 'noopener')
}

export function versBase64(buf) {
  const o = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000))
  return btoa(s)
}

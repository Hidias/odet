// Convention signée dans l'espace client (0402) : dépôt du PDF exact signé, puis lecture de la convention signée
// (en ligne : document déposé + page de preuve ; par e-mail : scan déposé par l'organisme).

import { callApi } from '../../../core/api'
import { documentAvecPreuve } from '../../../core/signature/preuve'
import { buildORG } from '../../../core/org/orgUtils'

const enBase64 = (buf) => {
  const o = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000))
  return btoa(s)
}

/** auth : { token, code } pour l'espace par lien, {} pour l'espace par compte */
export async function deposerConvention(auth, signatureId, base64) {
  try { await callApi('/api/convention-en-ligne', { ...auth, action: 'deposer', signature_id: signatureId, pdf_base64: base64 }) } catch { /* la signature est déjà enregistrée */ }
}

/**
 * Convention signée à télécharger : { base64, filename }, ou null si rien n'est déposé ni signé en ligne.
 * regenerer() sert de secours (convention avec la signature dessinée) si le dépôt du fichier a échoué.
 */
export async function conventionSignee(auth, session, sig, orgPdf, regenerer) {
  const filename = `Convention_${session.reference || 'formation'}_signee.pdf`
  let original = null
  try {
    const { url } = await callApi('/api/convention-en-ligne', { ...auth, action: 'lire', session_id: session.id })
    const r = await fetch(url)
    if (r.ok) original = await r.arrayBuffer()
  } catch { /* rien de déposé */ }
  if (original && sig) return { base64: await documentAvecPreuve(original, buildORG(orgPdf || {}), sig, { titre: 'Convention de formation', reference: session.reference, code: 'CONV' }), filename }
  if (original) return { base64: enBase64(original), filename }
  if (sig && regenerer) { const out = await regenerer(); return out ? { base64: out.base64, filename } : null }
  return null
}

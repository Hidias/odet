// Documents signés dans l'espace client (0406) : le fichier rangé, tel quel, suivi de sa page de preuve.

import { documentAvecPreuve } from '../../../core/signature/preuve'
import { buildORG } from '../../../core/org/orgUtils'
import { rubriqueDocument } from '../../../core/portail/typeDocument'
import { signeALaPlace } from '../../../core/portail/signataire'

export const NOMS_SIGNABLES = {
  devis: { titre: 'Signer le devis', nom: 'le devis' },
  contrat: { titre: 'Signer le contrat', nom: 'le contrat' },
  // Bon d'intervention signé à distance (0451)
  rapport: { titre: 'Signer le bon d\'intervention', nom: 'le bon d\'intervention' },
}

/** Titre et nom du document à signer ; la convention d'un groupe inter est publiée sous le type « contrat » (C4) */
export function nomSignable(doc) {
  if (rubriqueDocument(doc) === 'convention') return { titre: 'Signer la convention', nom: 'la convention' }
  return NOMS_SIGNABLES[doc?.kind] || { titre: 'Signer le document', nom: 'le document' }
}

// Signataire prévu par le document (0496) : règle commune dans core/portail/signataire.js
export { signeALaPlace }
export const mentionALaPlace = (nom, prevu) => (signeALaPlace(nom, prevu)
  ? ` Signataire prévu sur le document : ${String(prevu.name).trim()}${prevu.role ? ` (${String(prevu.role).trim()})` : ''} ; signé par ${String(nom).trim()}.`
  : '')

/** ArrayBuffer du document suivi de sa page de preuve */
export async function signeAvecPreuve(doc, buf, sig, orgPdf) {
  const b64 = await documentAvecPreuve(buf, buildORG(orgPdf || {}), sig, { titre: doc.label, reference: '', code: 'DOC' })
  const bin = atob(b64)
  const o = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i)
  return o.buffer
}

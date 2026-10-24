// Documents signés dans l'espace client (0406) : le fichier rangé, tel quel, suivi de sa page de preuve.

import { documentAvecPreuve } from '../../../core/signature/preuve'
import { buildORG } from '../../../core/org/orgUtils'

export const NOMS_SIGNABLES = {
  devis: { titre: 'Signer le devis', nom: 'le devis' },
  contrat: { titre: 'Signer le contrat', nom: 'le contrat' },
  // Bon d'intervention signé à distance (0451)
  rapport: { titre: 'Signer le bon d\'intervention', nom: 'le bon d\'intervention' },
}

/** ArrayBuffer du document suivi de sa page de preuve */
export async function signeAvecPreuve(doc, buf, sig, orgPdf) {
  const b64 = await documentAvecPreuve(buf, buildORG(orgPdf || {}), sig, { titre: doc.label, reference: '', code: 'DOC' })
  const bin = atob(b64)
  const o = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i)
  return o.buffer
}

// Document de l'espace client signé en ligne (0406), lu par l'équipe (C9, 05/11) : le PDF exact présenté au client,
// gardé tel quel, suivi de sa page de preuve calculée à la demande (rien n'est copié ni rangé une seconde fois).

import { supabase } from '../supabase'
import { lireDocumentInterne } from './documentsClient'
import { loadPdfOrg } from '../pdf/pdfOrg'
import { documentAvecPreuve } from '../signature/preuve'

/** Signature au format attendu par la page de preuve */
export const pourPreuve = (sig) => (sig ? { ...sig, consentement: sig.metadata?.consentement, canal: sig.metadata?.canal } : null)

/** Dernière signature en ligne valide du client pour chaque document : { [document_id]: signature } */
export async function signaturesDesDocuments(ids) {
  const liste = [...new Set((ids || []).filter(Boolean))]
  if (!liste.length) return {}
  const { data, error } = await supabase.from('document_signatures')
    .select('id, document_type, signer_name, signer_role, signature_data, document_hash, ip_address, user_agent, signed_at, metadata')
    .eq('signer_type', 'client').eq('status', 'valid').in('metadata->>document_id', liste).order('signed_at')
  if (error) return {}
  const m = {}
  ;(data || []).forEach((s) => { m[s.metadata?.document_id] = s })
  return m
}

const nomFichier = (t) => `${String(t || 'Document').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '')}_signe.pdf`

/** Télécharge le document signé avec sa page de preuve */
export async function telechargerAvecPreuve(doc, sig) {
  const buf = await lireDocumentInterne(doc.id)
  const ORG = await loadPdfOrg(true)
  const b64 = await documentAvecPreuve(buf, ORG, pourPreuve(sig), { titre: doc.label, reference: '', code: 'DOC' })
  const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichier(doc.label)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

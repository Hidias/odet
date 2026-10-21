// Convention signée en ligne par le client (0402) : qui, quand, depuis où, et son dossier de preuve en PDF.

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import jsPDF from 'jspdf'
import { PenLine, FileDown } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { ajouterPagePreuve, appareilLisible } from '../../../core/signature/preuve'

export default function SignatureEnLigne({ session }) {
  const [sig, setSig] = useState(null)
  useEffect(() => {
    supabase.from('document_signatures').select('*').eq('session_id', session.id).eq('document_type', 'convention')
      .eq('signer_type', 'client').eq('status', 'valid').order('signed_at', { ascending: false }).limit(1)
      .then(({ data }) => setSig(data?.[0] || null))
  }, [session.id, session.convention_signed])
  if (!sig) return null

  const preuve = async () => {
    try {
      const ORG = await loadPdfOrg(true)
      const doc = new jsPDF({ compress: true })
      ajouterPagePreuve(doc, ORG, { ...sig, consentement: sig.metadata?.consentement, canal: sig.metadata?.canal }, { titre: 'Convention de formation', reference: session.reference, code: 'CONV', nouvellePage: false })
      doc.save(`Preuve-signature-${session.reference || 'convention'}.pdf`)
    } catch (e) { toast.error(e.message) }
  }

  const quand = new Date(sig.signed_at)
  return (
    <div className="rounded border border-[rgb(var(--c-success)/0.3)] bg-white p-2 text-ui-sm text-gray-700 space-y-1">
      <p className="flex items-center gap-1.5 font-medium text-gray-900"><PenLine className="w-4 h-4 text-[rgb(var(--c-success))]" aria-hidden="true" />Signée en ligne depuis l'espace client</p>
      <p>{sig.signer_name}{sig.signer_role ? `, ${sig.signer_role}` : ''}, le {quand.toLocaleDateString('fr-FR')} à {quand.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
      <p className="text-gray-500">{[sig.ip_address ? `IP ${sig.ip_address}` : null, appareilLisible(sig.user_agent) || null].filter(Boolean).join(' · ')}</p>
      <button type="button" onClick={preuve} className="btn btn-secondary btn-sm w-full flex items-center justify-center gap-2 mt-1"><FileDown className="w-4 h-4" aria-hidden="true" />Dossier de preuve (PDF)</button>
    </div>
  )
}

// Demandes « Formation intra » du client qui portent déjà son besoin (0487) : quand la copie automatique n'a pas pu
// choisir (plusieurs demandes, session créée avant), l'organisme reprend les réponses de la bonne demande.
import { useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../core/supabase'
import { confirmer } from '../../../ui/Confirm'
import { demandeAvecBesoin } from '../lib/besoinClient'

const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '')

export default function BesoinDemandesReprise({ session, onReprise }) {
  const [demandes, setDemandes] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!session?.client_id) return
    supabase.from('client_requests').select('id, kind, session_id, created_at, payload, courses(title)')
      .eq('client_id', session.client_id).eq('kind', 'demande_intra').is('session_id', null)
      .order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => setDemandes((data || []).filter(demandeAvecBesoin)))
  }, [session?.client_id])
  if (!demandes.length) return null

  const reprendre = async (d) => {
    const ok = await confirmer({
      title: 'Reprendre ces réponses ?',
      message: `Les réponses de la demande du ${dateFr(d.created_at)} deviennent l'analyse du besoin de cette session, à relire et valider. La demande sera reliée à cette session.`,
      confirmLabel: 'Reprendre',
    })
    if (!ok) return
    setBusy(true)
    const { error } = await supabase.rpc('besoin_reprendre_demande', { p_session: session.id, p_request: d.id })
    setBusy(false)
    if (error) { toast.error(error.message || 'Reprise impossible'); return }
    toast.success('Réponses reprises : à relire et valider')
    onReprise?.()
  }

  return (
    <div className="rounded-ui-sm border border-[rgb(var(--c-info)/0.3)] bg-[rgb(var(--c-info-bg))] p-3 text-ui space-y-2">
      <div className="font-medium text-gray-900 flex items-center gap-2"><Inbox className="w-4 h-4" />Le client a déjà décrit son besoin dans une demande de formation intra</div>
      {demandes.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-2">
          <span className="flex-1 min-w-[12rem]">Demande du {dateFr(d.created_at)}{d.courses?.title ? ` · ${d.courses.title}` : ''} : {d.payload.besoin.participants_count} participant{d.payload.besoin.participants_count > 1 ? 's' : ''}</span>
          <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => reprendre(d)}>Reprendre ces réponses</button>
        </div>
      ))}
    </div>
  )
}

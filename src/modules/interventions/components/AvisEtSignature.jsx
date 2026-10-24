// Avis de passage et bon d'intervention signé à distance (0451).
//  - AvisPassage : avant la visite (passage prévu) ou client absent ; PDF à imprimer, mis à disposition dans l'espace
//    client, avis tracé sur la visite.
//  - SignatureADistance : visite terminée sans signature du client ; le rapport est envoyé à signer dans l'espace
//    client (même preuve qu'un devis signé en ligne).

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2, MailOpen, PenLine, BadgeCheck, Clock } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { mettreADisposition, versBase64 } from '../../../core/portail/documentsClient'
import { buildAvisPassagePDF } from '../pdf/avisPassagePDF'
import { Sheet } from './ui'

const aujourdhui = () => new Date().toISOString().slice(0, 10)
const maintenantHeure = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', ' h ')
const quand = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

export function AvisPassage({ visit, kindInitial = 'prevu' }) {
  const [ouvert, setOuvert] = useState(false)
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const [historique, setHistorique] = useState([])
  const charger = () => supabase.from('itv_visit_notices').select('id, kind, passage_on, window_text, created_at').eq('visit_id', visit.id).order('created_at', { ascending: false })
    .then(({ data }) => setHistorique(data || []))
  useEffect(() => { charger() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit.id])
  const ouvrir = (kind) => {
    setF({ kind, passageOn: kind === 'absent' ? aujourdhui() : (visit.planned_on || aujourdhui()), fenetre: kind === 'absent' ? maintenantHeure() : (visit.planned_time ? `à partir de ${String(visit.planned_time).slice(0, 5).replace(':', ' h ')}` : ''), message: '' })
    setOuvert(true)
  }
  const generer = async () => {
    setBusy(true)
    try {
      const { doc, filename } = await buildAvisPassagePDF({ visit, kind: f.kind, passageOn: f.passageOn, fenetre: f.fenetre, message: f.message })
      const label = `${f.kind === 'absent' ? 'Avis de passage (absent)' : 'Avis de passage'} du ${new Date(`${f.passageOn}T12:00:00`).toLocaleDateString('fr-FR')}${visit.reference ? `, ${visit.reference}` : ''}`
      const pub = await mettreADisposition({ objectType: 'itv_visit', objectId: visit.id, kind: 'avis_passage', label, base64: versBase64(doc.output('arraybuffer')) })
      const { error } = await supabase.from('itv_visit_notices').insert({ visit_id: visit.id, kind: f.kind, passage_on: f.passageOn, window_text: f.fenetre || null, message: f.message || null, document_id: pub?.id || null })
      if (error) throw error
      doc.save(filename)
      toast.success(pub?.id ? 'Avis prêt à imprimer, et disponible dans l\'espace du client' : 'Avis prêt à imprimer (espace client indisponible)')
      setOuvert(false); charger()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => ouvrir('prevu')}><MailOpen className="w-4 h-4" aria-hidden="true" />Avis de passage</button>
        <button type="button" className="btn btn-secondary" onClick={() => ouvrir(kindInitial === 'absent' ? 'absent' : 'absent')}><Clock className="w-4 h-4" aria-hidden="true" />Client absent</button>
      </div>
      {historique.length > 0 && <p className="text-ui-sm text-gray-500">{historique.map((h) => `${h.kind === 'absent' ? 'Absent' : 'Avis'} le ${new Date(`${h.passage_on}T12:00:00`).toLocaleDateString('fr-FR')}`).join(' · ')}</p>}
      {ouvert && f && (
        <Sheet title={f.kind === 'absent' ? 'Avis de passage : client absent' : 'Avis de passage'} onClose={() => setOuvert(false)}
          footer={<><button type="button" className="btn btn-secondary" onClick={() => setOuvert(false)}>Annuler</button><button type="button" className="btn btn-primary" onClick={generer} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Préparer l'avis</button></>}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={`btn ${f.kind === 'prevu' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setF({ ...f, kind: 'prevu' })}>Passage prévu</button>
              <button type="button" className={`btn ${f.kind === 'absent' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setF({ ...f, kind: 'absent', passageOn: aujourdhui(), fenetre: maintenantHeure() })}>Client absent</button>
            </div>
            <label className="block"><span className="label">{f.kind === 'absent' ? 'Passé le' : 'Passage le'}</span><input className="input" type="date" value={f.passageOn} onChange={(e) => setF({ ...f, passageOn: e.target.value })} /></label>
            <label className="block"><span className="label">{f.kind === 'absent' ? 'Heure' : 'Créneau'}</span><input className="input" value={f.fenetre} placeholder={f.kind === 'absent' ? '14 h 30' : 'entre 9 h et 12 h'} onChange={(e) => setF({ ...f, fenetre: e.target.value })} /></label>
            <label className="block"><span className="label">Message (facultatif)</span><textarea className="input min-h-[4rem]" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
            <p className="text-ui-sm text-gray-500">L'avis s'imprime pour la boîte aux lettres et arrive aussi dans l'espace du client. Aucun e-mail n'est envoyé.</p>
          </div>
        </Sheet>
      )}
    </div>
  )
}

export function SignatureADistance({ visit, publierRapport, reload }) {
  const [busy, setBusy] = useState(false)
  if (visit.client_signature) return null
  if (visit.remote_signed_at) {
    return <div className="card text-ui-sm flex items-center gap-2 text-[rgb(var(--c-success))]"><BadgeCheck className="w-4 h-4" aria-hidden="true" />Bon d'intervention signé à distance par le client le {quand(visit.remote_signed_at)}, avec sa preuve.</div>
  }
  if (visit.remote_signature_requested_at) {
    return <div className="card text-ui-sm flex items-center gap-2 text-gray-600"><Clock className="w-4 h-4" aria-hidden="true" />Envoyé à signer dans l'espace client le {quand(visit.remote_signature_requested_at)} : en attente de la signature.</div>
  }
  const demander = async () => {
    setBusy(true)
    try {
      const { error } = await supabase.from('itv_visits').update({ remote_signature_requested_at: new Date().toISOString() }).eq('id', visit.id)
      if (error) throw error
      await publierRapport()
      toast.success('Rapport envoyé à signer dans l\'espace du client')
      await reload()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  return (
    <div className="card space-y-2">
      <p className="text-ui-sm text-gray-600">Le client n'a pas signé sur place. Il peut signer le bon d'intervention dans son espace client, avec la même preuve qu'un devis signé en ligne.</p>
      <button type="button" className="btn btn-secondary w-full" onClick={demander} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />}Faire signer à distance</button>
    </div>
  )
}

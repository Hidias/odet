import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Globe, Check, X, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { demander, confirmer } from '../../../ui/Confirm'

// Inscriptions en ligne d'une session inter (0420) : déposées depuis le calendrier public, « en attente » jusqu'à
// la confirmation par l'organisme. Confirmer : la base crée ou retrouve le client, les stagiaires et le groupe, sans
// doublon. Refuser : avec un motif. Rien n'est envoyé au demandeur par l'outil.

const fmt = (d) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function InscriptionsEnLigne({ session, peutModifier, onConfirmee }) {
  const [liste, setListe] = useState(null)
  const [busy, setBusy] = useState(null)

  const charger = async () => {
    const { data, error } = await supabase.from('online_registrations').select('*').eq('session_id', session.id).order('created_at')
    setListe(error ? null : data || [])
  }
  useEffect(() => { if (session?.id) charger() }, [session?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!liste || liste.length === 0) return null
  const attente = liste.filter((r) => r.status === 'en_attente')
  const traitees = liste.filter((r) => r.status !== 'en_attente')

  const confirmerInscription = async (r) => {
    const n = (r.participants || []).length
    if (!(await confirmer({ title: 'Confirmer cette inscription ?', message: `${r.kind === 'entreprise' ? r.company_name : `${r.contact_first_name} ${r.contact_last_name}`} : ${n} participant${n > 1 ? 's' : ''}. Le client, les stagiaires et le groupe sont créés ou retrouvés, sans doublon.`, confirmLabel: 'Confirmer' }))) return
    setBusy(r.id)
    const { error } = await supabase.rpc('inscription_confirmer', { p_id: r.id })
    setBusy(null)
    if (error) return toast.error(error.message)
    toast.success('Inscription confirmée : le groupe est créé. Mettez la convention ou le contrat en signature en ligne.')
    await charger()
    onConfirmee?.()
  }
  const refuser = async (r) => {
    const motif = await demander('Motif du refus (gardé dans l\'outil, à communiquer au demandeur) :', { title: 'Refuser l\'inscription', placeholder: 'Session complète, prérequis…' })
    if (motif === null) return
    setBusy(r.id)
    const { error } = await supabase.rpc('inscription_refuser', { p_id: r.id, p_motif: motif })
    setBusy(null)
    if (error) return toast.error(error.message)
    charger()
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <Globe className="w-5 h-5 text-accent-600" aria-hidden="true" />
        <h3 className="font-semibold flex-1">Inscriptions en ligne</h3>
        {attente.length > 0 && <span className="badge badge-warning">{attente.length} en attente</span>}
      </div>
      {attente.map((r) => (
        <div key={r.id} className="border border-gray-200 rounded-ui p-3 space-y-1 text-ui">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-gray-900">{r.kind === 'entreprise' ? r.company_name : 'Particulier'}</span>
            {r.siret && <span className="text-ui-sm text-gray-500 font-mono">{r.siret}</span>}
            <span className="text-ui-sm text-gray-400">reçue le {fmt(r.created_at)}</span>
          </div>
          <div className="text-gray-700">{r.contact_first_name} {r.contact_last_name?.toUpperCase()}{r.contact_function ? `, ${r.contact_function}` : ''} · <a className="text-accent-700 underline" href={`mailto:${r.contact_email}`}>{r.contact_email}</a>{r.contact_phone ? ` · ${r.contact_phone}` : ''}</div>
          {(r.postal_code || r.city) && <div className="text-ui-sm text-gray-500">{[r.address, [r.postal_code, r.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</div>}
          <div className="text-ui-sm text-gray-700">Participants : {(r.participants || []).map((p) => `${p.first_name} ${(p.last_name || '').toUpperCase()}`).join(', ')}</div>
          {r.message && <div className="text-ui-sm text-gray-600 italic">« {r.message} »</div>}
          {peutModifier && (
            <div className="flex gap-2 pt-1">
              <button type="button" className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => confirmerInscription(r)}>{busy === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Confirmer</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy === r.id} onClick={() => refuser(r)}><X className="w-4 h-4" />Refuser</button>
            </div>
          )}
        </div>
      ))}
      {traitees.length > 0 && (
        <ul className="text-ui-sm text-gray-500 space-y-0.5">
          {traitees.map((r) => (
            <li key={r.id}>{r.kind === 'entreprise' ? r.company_name : `${r.contact_first_name} ${r.contact_last_name}`} : {r.status === 'confirmee' ? 'confirmée' : `refusée${r.response ? ` (${r.response})` : ''}`}{r.handled_at ? ` le ${fmt(r.handled_at)}` : ''}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Upload, ExternalLink, Check, X, Loader2 } from 'lucide-react'
import { supabase } from '../supabase'
import { ouvrirDepot } from '../portail/documentsClient'
import { demander, confirmer } from '../../ui/Confirm'

// Documents signés à la main et déposés par le client (0431) : l'organisme ouvre le scan, puis valide (devis accepté
// et session préparée, ou convention signée) ou refuse avec un motif que le client voit dans son espace.
export default function DepotsClient({ objectType, objectId, onChange }) {
  const [liste, setListe] = useState([])
  const [occupe, setOccupe] = useState(null)
  const charger = () => supabase.from('client_deposits').select('*').eq('object_type', objectType).eq('object_id', objectId)
    .order('deposited_at', { ascending: false }).then(({ data, error }) => { if (!error) setListe(data || []) })
  useEffect(() => { if (objectId) charger() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectType, objectId])
  if (!liste.length) return null

  const decider = async (d, decision) => {
    let motif = null
    if (decision === 'refuse') {
      motif = await demander('Motif du refus (le client le voit dans son espace) :', { title: 'Refuser le dépôt', placeholder: 'Par exemple : signature ou cachet manquant' })
      if (!motif) return
    } else if (!await confirmer({ title: 'Valider le dépôt', message: objectType === 'quote' ? 'Le devis passe en « accepté » et la session est préparée (à confirmer).' : 'La convention passe en « signée » avec ce fichier.', confirmLabel: 'Valider' })) return
    setOccupe(d.id)
    try {
      const { error } = await supabase.rpc('depot_client_decider', { p_depot: d.id, p_decision: decision, p_motif: motif })
      if (error) throw error
      toast.success(decision === 'valide' ? 'Dépôt validé' : 'Dépôt refusé : le client voit le motif')
      await charger(); await onChange?.()
    } catch (e) { toast.error(e.message || 'Décision impossible') } finally { setOccupe(null) }
  }

  const quand = (x) => new Date(x).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="mt-3 space-y-2">
      {liste.map((d) => (
        <div key={d.id} className={`rounded border p-2 text-ui-sm space-y-1 ${d.status === 'recu' ? 'border-accent-500/40 bg-accent-500/5' : 'border-gray-200 bg-white'}`}>
          <p className="flex items-center gap-1.5 font-medium text-gray-900"><Upload className="w-4 h-4 text-accent-600" aria-hidden="true" />
            {d.kind === 'devis' ? 'Devis signé déposé par le client' : 'Convention signée déposée par le client'}</p>
          <p className="text-gray-600">{d.depositor_name ? `${d.depositor_name}, ` : ''}le {quand(d.deposited_at)}{d.size_bytes ? ` · ${Math.max(1, Math.round(d.size_bytes / 1024))} Ko` : ''}</p>
          {d.status !== 'recu' && <p className={d.status === 'valide' ? 'text-[rgb(var(--c-success))]' : 'text-[rgb(var(--c-danger))]'}>
            {d.status === 'valide' ? 'Validé' : `Refusé${d.motif ? ` : ${d.motif}` : ''}`}{d.decided_name ? ` par ${d.decided_name}` : ''}{d.decided_at ? `, le ${quand(d.decided_at)}` : ''}</p>}
          <div className="flex gap-2 flex-wrap">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrirDepot(d.id).catch((e) => toast.error(e.message))}><ExternalLink className="w-4 h-4" aria-hidden="true" />Ouvrir</button>
            {d.status === 'recu' && <>
              <button type="button" className="btn btn-primary btn-sm" disabled={occupe === d.id} onClick={() => decider(d, 'valide')}>{occupe === d.id ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Check className="w-4 h-4" aria-hidden="true" />}Valider</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={occupe === d.id} onClick={() => decider(d, 'refuse')}><X className="w-4 h-4" aria-hidden="true" />Refuser</button>
            </>}
          </div>
        </div>
      ))}
    </div>
  )
}

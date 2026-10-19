import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2 } from 'lucide-react'
import { supabase } from '../../core/supabase'
import { Sheet } from '../../ui/Sheet'

// Réglages du pilote des sessions (fonction 13, 0160) : étape active ou non, délai. L'envoi automatique n'existe pas
// encore : tout passe par « Relances à valider ».

const ETAPES = [
  ['convocation', 'Convocation', 'jours avant la session'], ['rappel', 'Rappel', 'jour avant'], ['emargement', 'Émargement incomplet', null],
  ['eval_chaud', 'Évaluation à chaud', 'jours après la fin'], ['attestations', 'Attestations et certificats', null],
  ['eval_froid', 'Évaluation à froid', 'jours après la fin'], ['facture', 'Facture à préparer', null], ['impaye', 'Relance d\'impayé', 'paliers (jours après l\'échéance)'],
]

export default function PiloteReglages({ onClose }) {
  const [mod, setMod] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { supabase.from('org_modules').select('enabled, settings').eq('key', 'pilote').maybeSingle().then(({ data }) => setMod(data || { enabled: false, settings: {} })) }, [])
  const set = (k, champ, v) => setMod((m) => ({ ...m, settings: { ...m.settings, [k]: { ...(m.settings?.[k] || {}), [champ]: v } } }))
  const enregistrer = async () => {
    setBusy(true)
    const { error } = await supabase.from('org_modules').update({ enabled: mod.enabled, settings: mod.settings }).eq('key', 'pilote')
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Réglages du pilote enregistrés')
    onClose()
  }
  return (
    <Sheet title="Pilote des sessions" onClose={onClose} size="lg"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn btn-primary" onClick={enregistrer} disabled={busy || !mod}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer</button></>}>
      {!mod ? <Loader2 className="w-5 h-5 animate-spin text-gray-400" /> : (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-ui text-gray-800"><input type="checkbox" checked={!!mod.enabled} onChange={(e) => setMod((m) => ({ ...m, enabled: e.target.checked }))} /> Préparer chaque nuit les étapes des sessions</label>
          <p className="text-ui-sm text-gray-500">Rien n'est envoyé seul : chaque étape attend votre validation dans « Relances à valider ».</p>
          <div className="divide-y divide-gray-100">
            {ETAPES.map(([k, l, unite]) => {
              const r = mod.settings?.[k] || {}
              return (
                <div key={k} className="flex flex-wrap items-center gap-3 py-2">
                  <label className="flex items-center gap-2 text-ui text-gray-800 flex-1 min-w-[200px]"><input type="checkbox" checked={r.actif !== false} onChange={(e) => set(k, 'actif', e.target.checked)} /> {l}</label>
                  {unite && k !== 'impaye' && k !== 'rappel' && (
                    <span className="flex items-center gap-1.5 text-ui-sm text-gray-600">
                      <input className="input w-16" inputMode="numeric" value={r.jours ?? ''} onChange={(e) => set(k, 'jours', e.target.value.replace(/\D/g, '') ? Number(e.target.value.replace(/\D/g, '')) : null)} aria-label={`${l} : ${unite}`} /> {unite}
                    </span>
                  )}
                  {k === 'impaye' && (
                    <span className="flex items-center gap-1.5 text-ui-sm text-gray-600">
                      <input className="input w-24" value={(r.paliers || [7, 30]).join(', ')} onChange={(e) => set(k, 'paliers', e.target.value.split(/[,; ]+/).map((x) => parseInt(x, 10)).filter((x) => x > 0))} aria-label="Paliers de relance" /> {unite}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Sheet>
  )
}

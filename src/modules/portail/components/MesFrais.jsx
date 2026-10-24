// Notes de frais du formateur externe (0454), dans son espace : déclarer (photo du ticket), suivre la décision.
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Loader2, Camera, FileText, X } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { NATURES, ETATS_FRAIS, motifFrais, declarerFrais, ouvrirJustificatif, euros, totauxFrais } from '../../formation/lib/fraisFormateur'

const fmt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '')
const vide = () => ({ spent_on: new Date().toISOString().slice(0, 10), category: 'repas', amount: '', km: '', session_id: '', description: '', file: null })

export default function MesFrais({ sessions = [], Carte }) {
  const [d, setD] = useState(null)
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const charger = useCallback(async () => {
    const { data, error } = await supabase.rpc('ext_frais')
    setD(error ? { frais: [], erreur: true } : data)
  }, [])
  useEffect(() => { charger() }, [charger])
  if (!d) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
  if (d.erreur) return <Carte><p className="text-sm text-gray-500">Notes de frais indisponibles pour le moment.</p></Carte>

  const envoyer = async () => {
    const motif = motifFrais(f)
    if (motif) { toast.error(motif); return }
    setBusy(true)
    try {
      await declarerFrais({ companyId: d.company_id, trainerId: d.trainer_id, form: f })
      toast.success('Note de frais envoyée à l\'organisme')
      setF(null); charger()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  const annuler = async (e) => {
    const { error } = await supabase.rpc('ext_frais_annuler', { p_id: e.id })
    if (error) toast.error(error.message); else charger()
  }
  const t = totauxFrais(d.frais)
  // Sessions proposées : en cours, à venir ou terminées depuis moins de 3 mois
  const limite = new Date(); limite.setMonth(limite.getMonth() - 3)
  const choix = sessions.filter((s) => String(s.end_date || s.start_date || '') >= limite.toISOString().slice(0, 10))

  return (
    <div className="space-y-4">
      {!f && <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={() => setF(vide())}><Plus className="w-4 h-4" />Nouvelle note de frais</button>}
      {f && (
        <Carte className="space-y-3">
          <div className="flex items-center justify-between"><h3 className="font-semibold text-gray-900">Nouvelle note de frais</h3><button type="button" className="btn btn-ghost btn-icon" aria-label="Fermer" onClick={() => setF(null)}><X className="w-4 h-4" /></button></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Date de la dépense</span><input type="date" className="input" value={f.spent_on} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, spent_on: e.target.value })} /></label>
            <label className="block"><span className="label">Nature</span><select className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(NATURES).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></label>
            <label className="block"><span className="label">Montant TTC (€)</span><input className="input" inputMode="decimal" value={f.amount} placeholder="0,00" onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d,.]/g, '') })} /></label>
            {f.category === 'kilometres' && <label className="block"><span className="label">Kilomètres parcourus</span><input className="input" inputMode="decimal" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value.replace(/[^\d,.]/g, '') })} /></label>}
            <label className="block sm:col-span-2"><span className="label">Session concernée</span><select className="select" value={f.session_id} onChange={(e) => setF({ ...f, session_id: e.target.value })}><option value="">Aucune en particulier</option>{choix.map((s) => <option key={s.id} value={s.id}>{fmt(s.start_date)} · {s.courses?.title || 'Formation'}{s.client?.name ? ` · ${s.client.name}` : ''}</option>)}</select></label>
            <label className="block sm:col-span-2"><span className="label">Précision {f.category === 'autre' ? '' : '(facultatif)'}</span><input className="input" value={f.description} maxLength={500} placeholder={f.category === 'kilometres' ? 'Trajet : Quimper → Brest, aller-retour' : ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          </div>
          <label className="flex items-center gap-2 rounded-ui border border-dashed border-gray-300 px-3 py-3 min-h-[44px] cursor-pointer">
            <Camera className="w-5 h-5 text-gray-400" aria-hidden="true" />
            <span className="text-ui text-gray-700 flex-1 truncate">{f.file ? f.file.name : `Photo du ticket ou facture${f.category === 'kilometres' ? ' (facultatif)' : ''}`}</span>
            <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={(e) => setF({ ...f, file: e.target.files?.[0] || null })} />
          </label>
          <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={envoyer}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Envoyer à l'organisme</button>
        </Carte>
      )}
      {(t.aValider > 0 || t.aRembourser > 0) && (
        <p className="text-sm text-gray-600">{t.aValider > 0 && <>À valider : <strong>{euros(t.aValider)}</strong></>}{t.aValider > 0 && t.aRembourser > 0 && ' · '}{t.aRembourser > 0 && <>À vous rembourser : <strong>{euros(t.aRembourser)}</strong></>}</p>
      )}
      {(d.frais || []).length === 0 ? <p className="text-sm text-gray-500 text-center py-6">Aucune note de frais.</p> : (
        <ul className="space-y-2">
          {d.frais.map((e) => {
            const etat = ETATS_FRAIS[e.status] || ETATS_FRAIS.soumise
            return (
              <li key={e.id}>
                <Carte>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">{NATURES[e.category] || e.category} · {euros(e.amount_ttc)}{e.km ? ` · ${String(e.km).replace('.', ',')} km` : ''}</p>
                      <p className="text-sm text-gray-500">{fmt(e.spent_on)}{e.session?.title ? ` · ${e.session.title}` : ''}{e.description ? ` · ${e.description}` : ''}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${etat[0]}`}>{etat[1]}</span>
                  </div>
                  {e.status === 'refusee' && e.decision_note && <p className="mt-1 text-sm text-[rgb(var(--c-danger))]">Motif : {e.decision_note}</p>}
                  {e.status === 'remboursee' && e.paid_on && <p className="mt-1 text-sm text-gray-500">Remboursée le {fmt(e.paid_on)}</p>}
                  <div className="mt-2 flex gap-2">
                    {e.receipt_path && <button type="button" className="btn btn-ghost btn-sm" onClick={() => ouvrirJustificatif(e.receipt_path).catch((x) => toast.error(x.message))}><FileText className="w-4 h-4" />Justificatif</button>}
                    {e.status === 'soumise' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => annuler(e)}>Annuler</button>}
                  </div>
                </Carte>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

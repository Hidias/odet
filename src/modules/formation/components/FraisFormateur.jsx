// Notes de frais d'un formateur (0454), sur sa fiche : valider, refuser avec motif, noter le remboursement.
// Visible seulement avec le droit « Voir et saisir les coûts des sessions » (la base ne montre rien sinon).
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Receipt, FileText, Check, X, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { NATURES, ETATS_FRAIS, euros, totauxFrais, ouvrirJustificatif } from '../lib/fraisFormateur'

const fmt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '')

export default function FraisFormateur({ trainerId }) {
  const [l, setL] = useState(null)
  const [refus, setRefus] = useState(null) // { id, motif }
  const [busy, setBusy] = useState(null)
  const charger = useCallback(() => supabase.from('trainer_expenses')
    .select('id, spent_on, category, amount_ttc, km, description, receipt_path, status, decision_note, paid_on, session_id, sessions(reference, courses(title))')
    .eq('trainer_id', trainerId).neq('status', 'annulee').order('spent_on', { ascending: false }).limit(100)
    .then(({ data, error }) => setL(error ? [] : data || [])), [trainerId])
  useEffect(() => { charger() }, [charger])
  if (!l || l.length === 0) return null

  const changer = async (e, champs) => {
    setBusy(e.id)
    const { error } = await supabase.from('trainer_expenses').update(champs).eq('id', e.id)
    setBusy(null)
    if (error) { toast.error(error.message); return false }
    charger(); return true
  }
  const t = totauxFrais(l)
  return (
    <div className="px-6 pb-4 space-y-2">
      <h4 className="font-semibold text-ui flex items-center gap-2"><Receipt className="w-4 h-4 text-gray-400" aria-hidden="true" />Notes de frais</h4>
      <p className="text-ui-sm text-gray-500">À valider : {euros(t.aValider)} · À rembourser : {euros(t.aRembourser)} · Remboursé : {euros(t.rembourse)}</p>
      <ul className="divide-y divide-gray-100 text-ui-sm">
        {l.map((e) => {
          const etat = ETATS_FRAIS[e.status] || ETATS_FRAIS.soumise
          return (
            <li key={e.id} className="py-2 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{fmt(e.spent_on)} · {NATURES[e.category] || e.category} · {euros(e.amount_ttc)}{e.km ? ` · ${String(e.km).replace('.', ',')} km` : ''}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${etat[0]}`}>{etat[1]}</span>
              </div>
              {(e.description || e.sessions) && <p className="text-gray-500">{[e.sessions?.courses?.title && `${e.sessions.courses.title}${e.sessions.reference ? ` (${e.sessions.reference})` : ''}`, e.description].filter(Boolean).join(' · ')}</p>}
              {e.status === 'refusee' && e.decision_note && <p className="text-[rgb(var(--c-danger))]">Motif : {e.decision_note}</p>}
              {e.status === 'remboursee' && e.paid_on && <p className="text-gray-500">Remboursée le {fmt(e.paid_on)}</p>}
              <div className="flex flex-wrap gap-2">
                {e.receipt_path && <button type="button" className="btn btn-ghost btn-sm" onClick={() => ouvrirJustificatif(e.receipt_path).catch((x) => toast.error(x.message))}><FileText className="w-4 h-4" />Justificatif</button>}
                {e.status === 'soumise' && <>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy === e.id} onClick={() => changer(e, { status: 'validee' })}>{busy === e.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Valider</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRefus({ id: e.id, motif: '' })}><X className="w-4 h-4" />Refuser</button>
                </>}
                {e.status === 'validee' && <button type="button" className="btn btn-secondary btn-sm" disabled={busy === e.id} onClick={() => changer(e, { status: 'remboursee' })}>{busy === e.id && <Loader2 className="w-4 h-4 animate-spin" />}Remboursée aujourd'hui</button>}
                {(e.status === 'validee' || e.status === 'refusee') && <button type="button" className="btn btn-ghost btn-sm" onClick={() => changer(e, { status: 'soumise', decision_note: null })}>Revenir à « à valider »</button>}
              </div>
              {refus?.id === e.id && (
                <div className="flex flex-wrap gap-2 items-end">
                  <label className="block flex-1 min-w-[12rem]"><span className="label">Motif du refus (vu par le formateur)</span><input className="input" value={refus.motif} maxLength={500} onChange={(x) => setRefus({ ...refus, motif: x.target.value })} /></label>
                  <button type="button" className="btn btn-primary btn-sm" disabled={refus.motif.trim().length < 3 || busy === e.id} onClick={async () => { if (await changer(e, { status: 'refusee', decision_note: refus.motif.trim() })) setRefus(null) }}>Refuser</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRefus(null)}>Annuler</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

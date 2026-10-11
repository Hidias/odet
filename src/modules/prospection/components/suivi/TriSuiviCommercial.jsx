// ════════════════════════════════════════════════════════════════
// TriSuiviCommercial.jsx — Tri de départ (une seule fois)
// Anciens « RDV à prendre », RDV passés sans suite, anciens devis,
// rappels en retard de plus de 7 jours.
// La progression est enregistrée ligne par ligne (triaged_at) :
// on peut s'arrêter et reprendre à tout moment.
// ════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../../core/supabase'
import SuiteRdvModal from './SuiteRdvModal'
import { PlanifierRdvModal, ConvertirRappelModal, DeplacerRappelModal, SansSuiteInline } from './SuiviActionModals'
import DevisSuiviBlock from './DevisSuiviBlock'
import {
  callers, fmtDate, callbackLateDays, isCallbackToDecide, rdvRefDate,
} from './suiviUtils'

function Section({ title, count, hint, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl">
      <header className="flex items-baseline gap-2 px-4 pt-4 pb-2 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <span className="text-xs text-gray-500">{count} à trier</span>
        {hint && <p className="w-full text-xs text-gray-500">{hint}</p>}
      </header>
      <div className="px-4 pb-3">{children}</div>
    </section>
  )
}

export default function TriSuiviCommercial({
  oldAPrendre, oldPasses, oldQuoteGroups, callbacks, author,
  onBack, onChanged, onRelanceMail, relanceBusyId,
}) {
  const navigate = useNavigate()
  const [suiteRdv, setSuiteRdv] = useState(null)
  const [planRdv, setPlanRdv] = useState(null)
  const [rappelRdv, setRappelRdv] = useState(null)
  const [moveCb, setMoveCb] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [cbCaller, setCbCaller] = useState('all')

  const toDecide = useMemo(
    () => callbacks
      .filter(cb => isCallbackToDecide(cb))
      .filter(cb => cbCaller === 'all' || cb.called_by === cbCaller)
      .sort((a, b) => String(a.callback_date).localeCompare(String(b.callback_date))),
    [callbacks, cbCaller]
  )
  const callerCounts = useMemo(() => {
    const m = {}
    callbacks.filter(cb => isCallbackToDecide(cb)).forEach(cb => { m[cb.called_by || '—'] = (m[cb.called_by || '—'] || 0) + 1 })
    return m
  }, [callbacks])

  const total = oldAPrendre.length + oldPasses.length
    + oldQuoteGroups.reduce((s, g) => s + g.quotes.length, 0)
    + callbacks.filter(cb => isCallbackToDecide(cb)).length

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const transfers = oldAPrendre.filter(r => (r.source || '').includes('transfer'))
  const selectAllTransfers = () => setSelected(new Set(transfers.map(r => r.id)))

  const bulkSansSuite = async () => {
    if (selected.size === 0) return
    if (!confirm(`Classer ${selected.size} ligne(s) « sans suite — déjà traité » ?`)) return
    setBulkSaving(true)
    let done = 0
    try {
      const now = new Date().toISOString()
      for (const id of selected) {
        const { error } = await supabase.from('prospect_rdv').update({
          status: 'annule',
          outcome: 'sans_suite',
          outcome_reason: 'Déjà traité (tri de départ)',
          outcome_at: now,
          outcome_by: author,
          triaged_at: now,
          updated_at: now,
        }).eq('id', id)
        if (error) throw error
        done++
      }
      toast.success(`${done} ligne(s) classée(s)`)
    } catch (err) {
      toast.error(`Arrêt après ${done} ligne(s) : ${err.message}`)
    } finally {
      setSelected(new Set())
      setBulkSaving(false)
      onChanged?.()
    }
  }

  const keepRdv = async (rdv) => {
    const now = new Date().toISOString()
    const { error } = await supabase.from('prospect_rdv').update({ triaged_at: now, updated_at: now }).eq('id', rdv.id)
    if (error) { toast.error('Action impossible'); return }
    toast.success('Gardé dans le suivi')
    onChanged?.()
  }

  const pasEuLieu = async (rdv) => {
    if (!confirm('Ce RDV n\'a pas eu lieu : le passer en « Annulé » ?')) return
    const now = new Date().toISOString()
    const { error } = await supabase.from('prospect_rdv')
      .update({ status: 'annule', triaged_at: now, updated_at: now })
      .eq('id', rdv.id)
    if (error) { toast.error('Action impossible'); return }
    toast.success('RDV annulé')
    onChanged?.()
  }

  const done = () => { setSuiteRdv(null); setPlanRdv(null); setRappelRdv(null); setMoveCb(null); onChanged?.() }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onBack} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
          <ArrowLeft className="w-4 h-4" /> Retour au suivi
        </button>
        <div>
          <h2 className="text-base font-semibold text-gray-900">Tri de départ</h2>
          <p className="text-sm text-gray-500">
            {total === 0 ? 'Tout est trié.' : `${total} élément(s) à trier. Vous pouvez vous arrêter quand vous voulez : chaque décision est enregistrée.`}
          </p>
        </div>
      </div>

      {oldAPrendre.length > 0 && (
        <Section
          title="Anciens « RDV à prendre »"
          count={oldAPrendre.length}
          hint="Beaucoup sont des rappels ou des transferts déjà traités. Planifiez les vrais RDV, convertissez les rappels, classez le reste."
        >
          {transfers.length > 0 && (
            <div className="flex items-center gap-2 py-2 flex-wrap">
              <button onClick={selectAllTransfers} className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">
                Sélectionner les {transfers.length} transferts
              </button>
              {selected.size > 0 && (
                <>
                  <button onClick={bulkSansSuite} disabled={bulkSaving}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-gray-900 text-white rounded-lg disabled:opacity-50">
                    {bulkSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Classer les {selected.size} sélectionnés « déjà traité »
                  </button>
                  <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 underline">Tout désélectionner</button>
                </>
              )}
            </div>
          )}
          <div className="divide-y divide-gray-100">
            {oldAPrendre.map(r => (
              <div key={r.id} className="flex items-start gap-3 py-2.5 flex-wrap">
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="mt-1" aria-label="Sélectionner" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {r.clients?.name || 'Client inconnu'}
                    <span className="text-xs font-normal text-gray-500">
                      {' '}· créé le {fmtDate(rdvRefDate(r))}
                      {(r.source || '').includes('transfer') ? ' · transfert' : r.source ? ` · ${r.source.replace('phoning_', 'phoning ')}` : ''}
                    </span>
                  </p>
                  {(r.notes || r.notes_crm) && <p className="text-xs text-gray-600 line-clamp-2 whitespace-pre-line">{r.notes || r.notes_crm}</p>}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button onClick={() => setPlanRdv(r)} className="px-2.5 py-1.5 text-xs bg-gray-900 text-white rounded-lg hover:bg-gray-700">Planifier</button>
                  <button onClick={() => setRappelRdv(r)} className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">C'est un rappel</button>
                  <SansSuiteInline rdv={r} author={author} onDone={onChanged} />
                  <button onClick={() => navigate(`/prospection/${r.id}`)} className="p-1.5 text-gray-400 hover:text-gray-700" aria-label="Ouvrir le RDV">
                    <ExternalLink className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {oldPasses.length > 0 && (
        <Section title="Anciens RDV sans compte rendu" count={oldPasses.length} hint="Dites ce que chaque RDV a donné.">
          <div className="divide-y divide-gray-100">
            {oldPasses.map(r => (
              <div key={r.id} className="flex items-center gap-3 py-2.5 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{r.clients?.name || 'Client inconnu'}</p>
                  <p className="text-xs text-gray-500">
                    RDV du {fmtDate(r.rdv_date || rdvRefDate(r))}{r.conducted_by ? ` · ${r.conducted_by}` : ''}
                    {r.status === 'prevu' ? ' · encore marqué « planifié »' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button onClick={() => setSuiteRdv(r)} className="px-2.5 py-1.5 text-xs bg-gray-900 text-white rounded-lg hover:bg-gray-700">Donner la suite</button>
                  {r.status === 'prevu' && (
                    <button onClick={() => pasEuLieu(r)} className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">N'a pas eu lieu</button>
                  )}
                  <button onClick={() => keepRdv(r)} className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">Garder tel quel</button>
                  <button onClick={() => navigate(`/prospection/${r.id}`)} className="p-1.5 text-gray-400 hover:text-gray-700" aria-label="Ouvrir le RDV">
                    <ExternalLink className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {oldQuoteGroups.length > 0 && (
        <Section
          title="Anciens devis en attente"
          count={oldQuoteGroups.reduce((s, g) => s + g.quotes.length, 0)}
          hint="Cycles longs : rien n'est perdu d'office. Relance, veille, gagné ou perdu, ou « Garder en suivi »."
        >
          <DevisSuiviBlock
            groups={oldQuoteGroups}
            author={author}
            onChanged={onChanged}
            onRelanceMail={onRelanceMail}
            relanceBusyId={relanceBusyId}
            showTriage
          />
        </Section>
      )}

      {callbacks.some(cb => isCallbackToDecide(cb)) && (
        <Section
          title="Rappels en retard de plus de 7 jours"
          count={callbacks.filter(cb => isCallbackToDecide(cb)).length}
          hint="Un par un : déplacer, réattribuer ou abandonner. Les rappels restent au nom de la personne qui les a planifiés tant que vous ne les réattribuez pas."
        >
          <div className="flex gap-1.5 py-2 flex-wrap">
            {['all', ...callers()].map(c => (
              <button key={c} onClick={() => setCbCaller(c)}
                className={`px-2.5 py-1 rounded-md text-xs border ${cbCaller === c ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600 hover:border-gray-500'}`}>
                {c === 'all' ? 'Tous' : c} {c !== 'all' && callerCounts[c] ? `(${callerCounts[c]})` : ''}
              </button>
            ))}
          </div>
          <div className="divide-y divide-gray-100">
            {toDecide.map(cb => (
              <div key={cb.id} className="flex items-center gap-3 py-2.5 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {cb.clients?.name || 'Client inconnu'}
                    <span className="text-xs font-normal text-gray-500"> · {cb.called_by || '—'}</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {cb.callback_date ? `Prévu le ${fmtDate(cb.callback_date)} · ${callbackLateDays(cb)} j de retard` : 'Rappel sans date'}
                    {cb.contact_name ? ` · ${cb.contact_name}` : ''}
                    {cb.callback_reason ? ` · ${cb.callback_reason}` : ''}
                  </p>
                </div>
                <button onClick={() => setMoveCb(cb)} className="px-2.5 py-1.5 text-xs bg-gray-900 text-white rounded-lg hover:bg-gray-700">
                  Décider
                </button>
              </div>
            ))}
            {toDecide.length === 0 && <p className="text-sm text-gray-500 py-2">Rien pour ce filtre.</p>}
          </div>
        </Section>
      )}

      {suiteRdv && (
        <SuiteRdvModal rdv={suiteRdv} clientName={suiteRdv.clients?.name} author={author}
          onClose={() => setSuiteRdv(null)} onDone={done} />
      )}
      {planRdv && (
        <PlanifierRdvModal rdv={planRdv} clientName={planRdv.clients?.name} author={author}
          onClose={() => setPlanRdv(null)} onDone={done} />
      )}
      {rappelRdv && (
        <ConvertirRappelModal rdv={rappelRdv} clientName={rappelRdv.clients?.name} author={author}
          onClose={() => setRappelRdv(null)} onDone={done} />
      )}
      {moveCb && (
        <DeplacerRappelModal callback={moveCb} clientName={moveCb.clients?.name} author={author}
          onClose={() => setMoveCb(null)} onDone={done} />
      )}
    </div>
  )
}

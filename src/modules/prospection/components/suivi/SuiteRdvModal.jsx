// ════════════════════════════════════════════════════════════════
// SuiteRdvModal.jsx — Compte rendu d'un RDV en 4 choix
// Utilisé par SuiviCommercial.jsx, TriSuiviCommercial.jsx et ProspectRDVDetail.jsx
// ════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, FileText, Send, CalendarClock, Ban, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../../core/supabase'
import {
  OUTCOME_LABELS, SANS_SUITE_REASONS, quickDates, todayStr, fmtDate, fmtMoney, logInteraction,
} from './suiviUtils'

const CHOICES = [
  { id: 'devis_a_faire', icon: FileText, label: 'Devis à faire', hint: 'Le client attend une proposition' },
  { id: 'devis_envoye', icon: Send, label: 'Devis envoyé', hint: 'Le devis est déjà parti' },
  { id: 'a_recontacter', icon: CalendarClock, label: 'À recontacter', hint: 'On se reparle à une date précise' },
  { id: 'sans_suite', icon: Ban, label: 'Sans suite', hint: 'Pas d\'affaire pour le moment' },
]

export default function SuiteRdvModal({ rdv, clientName, author, onClose, onDone }) {
  const navigate = useNavigate()
  const [choice, setChoice] = useState(rdv?.outcome && rdv.outcome !== 'converti_rappel' ? rdv.outcome : null)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState(SANS_SUITE_REASONS[0])
  const [recontactDate, setRecontactDate] = useState(rdv?.next_action_date || '')
  const [recontactWhat, setRecontactWhat] = useState(rdv?.next_action || '')
  const [quotes, setQuotes] = useState([])
  const [quoteId, setQuoteId] = useState(rdv?.quote_id || '')
  const [openQuoteAfter, setOpenQuoteAfter] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!rdv?.client_id) return
    supabase
      .from('quotes')
      .select('id, reference, quote_date, status, total_ht, object')
      .eq('client_id', rdv.client_id)
      .order('quote_date', { ascending: false })
      .limit(20)
      .then(({ data }) => setQuotes(data || []))
  }, [rdv?.client_id])

  if (!rdv) return null

  const canSave =
    choice &&
    (choice !== 'a_recontacter' || recontactDate) &&
    (choice !== 'sans_suite' || reason)

  const handleSave = async () => {
    if (!canSave) {
      toast.error(choice === 'a_recontacter' ? 'Choisissez une date de recontact' : 'Choisissez une suite')
      return
    }
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const patch = {
        status: 'realise',
        outcome: choice,
        outcome_at: now,
        outcome_by: author,
        triaged_at: now,
        updated_at: now,
        outcome_reason: null,
      }
      if (!rdv.rdv_date) patch.rdv_date = todayStr()

      if (choice === 'devis_a_faire') {
        patch.next_action = 'Faire le devis'
        patch.next_action_date = null
        patch.outcome_reason = note.trim() || null
      }
      if (choice === 'devis_envoye') {
        patch.quote_id = quoteId || null
        patch.next_action = null
        patch.next_action_date = null
        patch.outcome_reason = note.trim() || null
      }
      if (choice === 'a_recontacter') {
        patch.next_action = recontactWhat.trim() || 'Recontacter'
        patch.next_action_date = recontactDate
        patch.outcome_reason = note.trim() || null
      }
      if (choice === 'sans_suite') {
        patch.next_action = null
        patch.next_action_date = null
        patch.outcome_reason = reason + (note.trim() ? ' — ' + note.trim() : '')
      }

      const { error } = await supabase.from('prospect_rdv').update(patch).eq('id', rdv.id)
      if (error) throw error

      const detail = [
        choice === 'a_recontacter' ? `À recontacter le ${fmtDate(recontactDate)} : ${patch.next_action}` : null,
        choice === 'sans_suite' ? `Motif : ${patch.outcome_reason}` : null,
        choice !== 'sans_suite' && note.trim() ? note.trim() : null,
      ].filter(Boolean).join('\n')

      await logInteraction(supabase, {
        clientId: rdv.client_id,
        type: 'meeting',
        title: `Suite du RDV — ${OUTCOME_LABELS[choice]}${clientName ? ' — ' + clientName : ''}`,
        content: detail,
        author,
      })

      toast.success(`Suite enregistrée : ${OUTCOME_LABELS[choice]}`)
      onDone?.({ ...rdv, ...patch })

      if (choice === 'devis_a_faire' && openQuoteAfter && rdv.client_id) {
        navigate(`/devis?client_id=${rdv.client_id}`)
      }
    } catch (err) {
      console.error(err)
      toast.error('Enregistrement impossible : ' + (err.message || 'erreur inconnue'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Suite du RDV</h3>
            <p className="text-sm text-gray-500">
              {clientName || 'Client'}
              {rdv.rdv_date ? ` · RDV du ${fmtDate(rdv.rdv_date)}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Fermer">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {CHOICES.map(c => {
              const Icon = c.icon
              const active = choice === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChoice(c.id)}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    active ? 'border-primary-600 bg-primary-50' : 'border-gray-200 hover:border-gray-400'
                  }`}
                >
                  <span className={`flex items-center gap-2 text-sm font-semibold ${active ? 'text-primary-700' : 'text-gray-800'}`}>
                    <Icon className="w-4 h-4" /> {c.label}
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">{c.hint}</span>
                </button>
              )
            })}
          </div>

          {choice === 'devis_a_faire' && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={openQuoteAfter} onChange={e => setOpenQuoteAfter(e.target.checked)} />
              Ouvrir la création du devis juste après
            </label>
          )}

          {choice === 'devis_envoye' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Devis principal (facultatif)</label>
              {quotes.length === 0 ? (
                <p className="text-sm text-gray-500">Aucun devis trouvé pour ce client.</p>
              ) : (
                <select
                  value={quoteId}
                  onChange={e => setQuoteId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">Aucun en particulier</option>
                  {quotes.map(q => (
                    <option key={q.id} value={q.id}>
                      {q.reference} · {fmtDate(q.quote_date)} · {fmtMoney(q.total_ht)}
                      {q.object ? ` · ${q.object.slice(0, 40)}` : ''}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Tous les devis du client restent suivis dans « Devis en cours », un par formation.
              </p>
            </div>
          )}

          {choice === 'a_recontacter' && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Quand ?</label>
              <div className="flex flex-wrap gap-1.5">
                {quickDates().map(q => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => setRecontactDate(q.value)}
                    className={`px-2.5 py-1 rounded-md text-xs border ${
                      recontactDate === q.value ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-700 hover:border-gray-500'
                    }`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <input
                type="date"
                value={recontactDate}
                min={todayStr()}
                onChange={e => setRecontactDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <input
                type="text"
                value={recontactWhat}
                onChange={e => setRecontactWhat(e.target.value)}
                placeholder="Pourquoi ? Ex. après leur budget 2027"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          )}

          {choice === 'sans_suite' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Motif</label>
              <select
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                {SANS_SUITE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}

          {choice && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Note rapide (facultatif)</label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                placeholder="Ce qu'il faut retenir du RDV"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !canSave}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Enregistrer la suite
          </button>
        </div>
      </div>
    </div>
  )
}

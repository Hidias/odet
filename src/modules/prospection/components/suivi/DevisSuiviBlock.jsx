// ════════════════════════════════════════════════════════════════
// DevisSuiviBlock.jsx - Devis en cours, une ligne par client
// Relance « faite » et mise en veille : pour tous les devis du client.
// Gagné / perdu : devis par devis (un devis = un besoin).
// ════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Phone, Mail, Moon, CheckCircle2, XCircle, ExternalLink, Loader2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../../core/supabase'
import { VeilleModal } from './SuiviActionModals'
import {
  LOST_REASONS, fmtDate, fmtMoney, quoteNextDue, todayStr, diffDays, logInteraction,
} from './suiviUtils'

const STATUS_LABELS = { sent: 'Envoyé', partial: 'Accepté en partie' }

function dueBadge(nextDue, today) {
  if (!nextDue) return null
  const late = diffDays(nextDue, today)
  if (late > 0) return { text: `relance due depuis ${late} j`, cls: 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]' }
  if (late === 0) return { text: 'relance aujourd\'hui', cls: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' }
  return { text: `prochaine relance le ${fmtDate(nextDue)}`, cls: 'bg-gray-100 text-gray-600' }
}

function PerduModal({ quote, author, onClose, onDone }) {
  const isPartial = quote.status === 'partial'
  const [reason, setReason] = useState(LOST_REASONS[0])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const lost = reason + (note.trim() ? ' - ' + note.trim() : '')
      const patch = { lost_reason: lost, triaged_at: now, updated_at: now }
      if (!isPartial) patch.status = 'refused'
      const { error } = await supabase.from('quotes').update(patch).eq('id', quote.id)
      if (error) throw error
      await logInteraction(supabase, {
        clientId: quote.client_id,
        type: 'devis',
        title: isPartial
          ? `Devis ${quote.reference} : refus définitif des lignes restantes`
          : `Devis ${quote.reference} perdu`,
        content: `Motif : ${lost}`,
        author,
      })
      toast.success(isPartial ? 'Lignes restantes classées' : 'Devis classé perdu')
      onDone?.()
    } catch (err) {
      toast.error('Action impossible : ' + err.message)
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-ui shadow-md w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {isPartial ? 'Refus définitif des lignes restantes' : 'Devis perdu'}
            </h3>
            <p className="text-ui text-gray-500">{quote.reference} · {fmtMoney(quote.total_ht)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-ui-sm hover:bg-gray-100" aria-label="Fermer">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {isPartial && (
            <p className="text-ui text-gray-600">
              La partie acceptée reste acquise. Le devis sort simplement du suivi des relances.
            </p>
          )}
          <label className="block text-ui font-medium text-gray-700">Motif</label>
          <select value={reason} onChange={e => setReason(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm text-ui">
            {LOST_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Précision (facultatif)"
            className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm text-ui" />
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-ui text-gray-600 border border-gray-200 rounded-ui-sm hover:bg-gray-50">
            Annuler
          </button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-ui font-medium bg-[rgb(var(--c-danger))] text-white rounded-ui-sm hover:bg-[rgb(var(--c-danger))] disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Confirmer
          </button>
        </div>
      </div>
    </div>
  )
}

export function QuoteGroupRow({ group, author, onChanged, onRelanceMail, relanceBusyId, showTriage = false }) {
  const navigate = useNavigate()
  const today = todayStr()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [veilleOpen, setVeilleOpen] = useState(false)
  const [perduQuote, setPerduQuote] = useState(null)

  const client = group.client || {}
  const badge = dueBadge(group.nextDue, today)
  const phone = client.contact_phone

  const relanceFaite = async () => {
    if (!confirm(`Noter une relance faite pour les ${group.quotes.length} devis de ${client.name || 'ce client'} ?`)) return
    setBusy(true)
    try {
      const now = new Date().toISOString()
      for (const q of group.quotes) {
        const patch = {
          relance_count: (q.relance_count || 0) + 1,
          last_relance_date: today,
          next_followup_date: null,
          followup_state: 'actif',
          veille_until: null,
          triaged_at: now,
          updated_at: now,
        }
        const { error } = await supabase.from('quotes').update(patch).eq('id', q.id)
        if (error) throw error
      }
      await logInteraction(supabase, {
        clientId: group.clientId,
        type: 'relance',
        title: `Relance devis (${group.quotes.length}) - ${client.name || ''}`,
        content: group.quotes.map(q => q.reference).join(', '),
        author,
      })
      toast.success('Relance notée')
      onChanged?.()
    } catch (err) {
      toast.error('Action impossible : ' + err.message)
    } finally { setBusy(false) }
  }

  const garder = async () => {
    setBusy(true)
    try {
      const now = new Date().toISOString()
      for (const q of group.quotes) {
        const { error } = await supabase.from('quotes').update({ triaged_at: now, updated_at: now }).eq('id', q.id)
        if (error) throw error
      }
      toast.success('Devis gardés en suivi')
      onChanged?.()
    } catch (err) {
      toast.error('Action impossible : ' + err.message)
    } finally { setBusy(false) }
  }

  const gagne = async (q) => {
    if (!confirm(`Passer le devis ${q.reference} en « Accepté » ?`)) return
    try {
      const now = new Date().toISOString()
      const { error } = await supabase.from('quotes')
        .update({ status: 'accepted', triaged_at: now, updated_at: now })
        .eq('id', q.id)
      if (error) throw error
      await logInteraction(supabase, {
        clientId: q.client_id, type: 'devis', title: `Devis ${q.reference} accepté`, author,
      })
      toast.success('Devis accepté')
      onChanged?.()
    } catch (err) {
      toast.error('Action impossible : ' + err.message)
    }
  }

  return (
    <div className="border-t border-gray-100 first:border-t-0">
      <div className="flex items-center gap-3 py-3 flex-wrap">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-left min-w-0 flex-1">
          {open ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
          <span className="min-w-0">
            <span className="block text-ui font-semibold text-gray-900 truncate">{client.name || 'Client inconnu'}</span>
            <span className="block text-ui-sm text-gray-500">
              {group.quotes.length} devis · {fmtMoney(group.total)} HT
              {client.contact_name ? ` · ${client.contact_name}` : ''}
            </span>
          </span>
        </button>
        {badge && <span className={`text-ui-sm px-2 py-0.5 rounded-ui-sm ${badge.cls}`}>{badge.text}</span>}
        <div className="flex items-center gap-1.5 flex-wrap">
          {phone && (
            <a href={`tel:${phone.replace(/\s/g, '')}`}
              className="flex items-center gap-1 px-2.5 py-1.5 text-ui-sm border border-gray-300 rounded-ui-sm hover:bg-gray-50">
              <Phone className="w-3.5 h-3.5" /> {phone}
            </a>
          )}
          <button onClick={relanceFaite} disabled={busy}
            className="px-2.5 py-1.5 text-ui-sm font-medium bg-gray-900 text-white rounded-ui-sm hover:bg-gray-700 disabled:opacity-50">
            Relance faite
          </button>
          <button onClick={() => setVeilleOpen(true)} disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1.5 text-ui-sm border border-gray-300 rounded-ui-sm hover:bg-gray-50">
            <Moon className="w-3.5 h-3.5" /> En veille
          </button>
          {showTriage && (
            <button onClick={garder} disabled={busy}
              className="px-2.5 py-1.5 text-ui-sm border border-gray-300 rounded-ui-sm hover:bg-gray-50">
              Garder en suivi
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="ml-6 mb-3 bg-gray-50 rounded-ui-sm divide-y divide-gray-200">
          {group.quotes.map(q => {
            const due = quoteNextDue(q)
            return (
              <div key={q.id} className="flex items-center gap-3 px-3 py-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-ui text-gray-900">
                    <span className="font-medium">{q.reference}</span>
                    <span className="text-gray-500"> · {fmtDate(q.quote_date)} · {fmtMoney(q.total_ht)}</span>
                  </p>
                  <p className="text-ui-sm text-gray-500 truncate">
                    {STATUS_LABELS[q.status] || q.status}
                    {q.object ? ` · ${q.object}` : ''}
                    {` · ${q.relance_count || 0} relance(s)`}
                    {due ? ` · prochaine le ${fmtDate(due)}` : ''}
                  </p>
                  {q.followup_notes && <p className="text-ui-sm text-gray-600 mt-0.5">{q.followup_notes}</p>}
                </div>
                <div className="flex items-center gap-1.5">
                  {q.status === 'sent' && (
                    <button onClick={() => onRelanceMail?.(q)} disabled={relanceBusyId === q.id}
                      className="flex items-center gap-1 px-2 py-1 text-ui-sm border border-gray-300 rounded-ui-sm hover:bg-white disabled:opacity-50">
                      {relanceBusyId === q.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                      Relance mail
                    </button>
                  )}
                  {q.status === 'sent' && (
                    <button onClick={() => gagne(q)}
                      className="flex items-center gap-1 px-2 py-1 text-ui-sm border border-[rgb(var(--c-success)/0.3)] text-[rgb(var(--c-success))] rounded-ui-sm hover:bg-[rgb(var(--c-success-bg))]">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Gagné
                    </button>
                  )}
                  <button onClick={() => setPerduQuote(q)}
                    className="flex items-center gap-1 px-2 py-1 text-ui-sm border border-[rgb(var(--c-danger)/0.3)] text-[rgb(var(--c-danger))] rounded-ui-sm hover:bg-[rgb(var(--c-danger-bg))]">
                    <XCircle className="w-3.5 h-3.5" /> {q.status === 'partial' ? 'Refus du reste' : 'Perdu'}
                  </button>
                  <button onClick={() => navigate('/devis')} title="Ouvrir la page Devis"
                    className="p-1 text-gray-400 hover:text-gray-700" aria-label="Ouvrir la page Devis">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
          {group.clientId && (
            <div className="px-3 py-2">
              <button onClick={() => navigate(`/clients/${group.clientId}`)} className="text-ui-sm text-primary-600 hover:underline">
                Ouvrir la fiche client
              </button>
            </div>
          )}
        </div>
      )}

      {veilleOpen && (
        <VeilleModal
          group={group}
          author={author}
          onClose={() => setVeilleOpen(false)}
          onDone={() => { setVeilleOpen(false); onChanged?.() }}
        />
      )}
      {perduQuote && (
        <PerduModal
          quote={perduQuote}
          author={author}
          onClose={() => setPerduQuote(null)}
          onDone={() => { setPerduQuote(null); onChanged?.() }}
        />
      )}
    </div>
  )
}

export default function DevisSuiviBlock({ groups, author, onChanged, onRelanceMail, relanceBusyId, emptyText, showTriage = false }) {
  if (!groups || groups.length === 0) {
    return <p className="text-ui text-gray-500 py-3">{emptyText || 'Aucun devis ici.'}</p>
  }
  return (
    <div>
      {groups.map(g => (
        <QuoteGroupRow
          key={g.clientId || 'sans-client'}
          group={g}
          author={author}
          onChanged={onChanged}
          onRelanceMail={onRelanceMail}
          relanceBusyId={relanceBusyId}
          showTriage={showTriage}
        />
      ))}
    </div>
  )
}

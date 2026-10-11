// ════════════════════════════════════════════════════════════════
// SuiviActionModals.jsx — Petites fenêtres d'action du Suivi commercial
//   PlanifierRdvModal  : « À planifier » → RDV planifié (date, heure, qui)
//   ConvertirRappelModal : faux RDV → vrai rappel dans la file de phoning
//   DeplacerRappelModal  : déplacer / réattribuer / abandonner un rappel
//   VeilleModal          : mettre les devis d'un client en veille
// Toutes les mises à jour se font par id (jamais par SIREN).
// ════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../../core/supabase'
import { callers, SANS_SUITE_REASONS, quickDates, todayStr, fmtDate, logInteraction } from './suiviUtils'

function ModalShell({ title, subtitle, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Fermer">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <div className="p-5 space-y-3">{children}</div>
        <div className="flex justify-end gap-2 px-5 pb-5">{footer}</div>
      </div>
    </div>
  )
}

function DatePicker({ value, onChange }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {quickDates().map(q => (
          <button
            key={q.label}
            type="button"
            onClick={() => onChange(q.value)}
            className={`px-2.5 py-1 rounded-md text-xs border ${
              value === q.value ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-700 hover:border-gray-500'
            }`}
          >
            {q.label}
          </button>
        ))}
      </div>
      <input
        type="date"
        value={value}
        min={todayStr()}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
      />
    </div>
  )
}

function SaveButton({ saving, onClick, label }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
    >
      {saving && <Loader2 className="w-4 h-4 animate-spin" />}
      {label}
    </button>
  )
}

function CancelButton({ onClick }) {
  return (
    <button onClick={onClick} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
      Annuler
    </button>
  )
}

// ── Planifier un RDV ───────────────────────────────────────────
export function PlanifierRdvModal({ rdv, clientName, author, onClose, onDone }) {
  const [date, setDate] = useState(rdv?.rdv_date && rdv.rdv_date >= todayStr() ? rdv.rdv_date : '')
  const [time, setTime] = useState(rdv?.rdv_time ? String(rdv.rdv_time).slice(0, 5) : '10:00')
  const [who, setWho] = useState(rdv?.conducted_by || author)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!date) { toast.error('Choisissez une date'); return }
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const patch = {
        status: 'prevu',
        rdv_date: date,
        rdv_time: time || null,
        conducted_by: who,
        is_urgent: false,
        triaged_at: now,
        updated_at: now,
      }
      const { error } = await supabase.from('prospect_rdv').update(patch).eq('id', rdv.id)
      if (error) throw error
      await logInteraction(supabase, {
        clientId: rdv.client_id,
        title: `RDV planifié le ${fmtDate(date)}${time ? ' à ' + time.replace(':', 'h') : ''} — ${who}`,
        author,
      })
      toast.success('RDV planifié')
      onDone?.({ ...rdv, ...patch })
    } catch (err) {
      toast.error('Planification impossible : ' + err.message)
    } finally { setSaving(false) }
  }

  return (
    <ModalShell
      title="Planifier le RDV"
      subtitle={clientName}
      onClose={onClose}
      footer={<><CancelButton onClick={onClose} /><SaveButton saving={saving} onClick={save} label="Planifier" /></>}
    >
      <label className="block text-sm font-medium text-gray-700">Date</label>
      <DatePicker value={date} onChange={setDate} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Heure</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Mené par</label>
          <select value={who} onChange={e => setWho(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {callers().map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
    </ModalShell>
  )
}

// ── Faux RDV → rappel dans la file de phoning ──────────────────
export function ConvertirRappelModal({ rdv, clientName, author, onClose, onDone }) {
  const [date, setDate] = useState(quickDates()[1].value)
  const [who, setWho] = useState(author)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!date) { toast.error('Choisissez une date'); return }
    if (!rdv.client_id) { toast.error('Ce RDV n\'a pas de client'); return }
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const { error: callError } = await supabase.from('prospect_calls').insert({
        client_id: rdv.client_id,
        called_by: who,
        call_result: 'a_rappeler',
        is_planned: true,
        contact_name: rdv.contact_name || null,
        contact_email: rdv.contact_email || null,
        contact_mobile: rdv.contact_phone || null,
        needs_callback: true,
        callback_date: date,
        callback_time: '10:00',
        callback_reason: reason.trim() || 'Converti depuis « RDV à planifier »',
        notes: 'Rappel créé depuis le suivi commercial (ce n\'était pas un RDV)',
        duration_seconds: 0,
      })
      if (callError) throw callError

      const patch = {
        status: 'annule',
        outcome: 'converti_rappel',
        outcome_reason: reason.trim() || null,
        outcome_at: now,
        outcome_by: author,
        triaged_at: now,
        updated_at: now,
      }
      const { error } = await supabase.from('prospect_rdv').update(patch).eq('id', rdv.id)
      if (error) throw error

      await logInteraction(supabase, {
        clientId: rdv.client_id,
        type: 'note',
        title: `Rappel prévu le ${fmtDate(date)} (${who})`,
        content: reason.trim(),
        author,
      })
      toast.success(`Rappel créé pour ${who} le ${fmtDate(date)}`)
      onDone?.({ ...rdv, ...patch })
    } catch (err) {
      toast.error('Conversion impossible : ' + err.message)
    } finally { setSaving(false) }
  }

  return (
    <ModalShell
      title="C'est un rappel, pas un RDV"
      subtitle={clientName}
      onClose={onClose}
      footer={<><CancelButton onClick={onClose} /><SaveButton saving={saving} onClick={save} label="Créer le rappel" /></>}
    >
      <p className="text-sm text-gray-600">
        Le contact rejoint la file de rappels du phoning. Le RDV disparaît du suivi.
      </p>
      <label className="block text-sm font-medium text-gray-700">Rappeler le</label>
      <DatePicker value={date} onChange={setDate} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Qui rappelle</label>
          <select value={who} onChange={e => setWho(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {callers().map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Pourquoi</label>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex. dirigeant absent"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
    </ModalShell>
  )
}

// ── Déplacer / réattribuer / abandonner un rappel ─────────────
export function DeplacerRappelModal({ callback, clientName, author, onClose, onDone }) {
  const [date, setDate] = useState(quickDates()[0].value)
  const [who, setWho] = useState(callback?.called_by || author)
  const [saving, setSaving] = useState(false)

  const move = async () => {
    if (!date) { toast.error('Choisissez une date'); return }
    setSaving(true)
    try {
      const patch = { callback_date: date, called_by: who, updated_at: new Date().toISOString() }
      const { error } = await supabase.from('prospect_calls').update(patch).eq('id', callback.id)
      if (error) throw error
      toast.success(`Rappel déplacé au ${fmtDate(date)}${who !== callback.called_by ? ' pour ' + who : ''}`)
      onDone?.({ ...callback, ...patch })
    } catch (err) {
      toast.error('Déplacement impossible : ' + err.message)
    } finally { setSaving(false) }
  }

  const abandon = async () => {
    if (!confirm('Abandonner ce rappel ? Le contact ne sera plus proposé.')) return
    setSaving(true)
    try {
      const stamp = `Rappel abandonné le ${new Date().toLocaleDateString('fr-FR')} par ${author}`
      const patch = {
        needs_callback: false,
        notes: callback.notes ? `${callback.notes}\n${stamp}` : stamp,
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase.from('prospect_calls').update(patch).eq('id', callback.id)
      if (error) throw error
      await logInteraction(supabase, { clientId: callback.client_id, type: 'note', title: stamp, author })
      toast.success('Rappel abandonné')
      onDone?.({ ...callback, ...patch })
    } catch (err) {
      toast.error('Action impossible : ' + err.message)
    } finally { setSaving(false) }
  }

  return (
    <ModalShell
      title="Déplacer le rappel"
      subtitle={`${clientName || 'Contact'} · ${callback?.callback_date ? 'prévu le ' + fmtDate(callback.callback_date) : 'sans date'} (${callback?.called_by || '—'})`}
      onClose={onClose}
      footer={
        <>
          <button onClick={abandon} disabled={saving}
            className="mr-auto px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50">
            Abandonner
          </button>
          <CancelButton onClick={onClose} />
          <SaveButton saving={saving} onClick={move} label="Déplacer" />
        </>
      }
    >
      {callback?.callback_reason && (
        <p className="text-sm text-gray-600">Motif : {callback.callback_reason}</p>
      )}
      <label className="block text-sm font-medium text-gray-700">Nouvelle date</label>
      <DatePicker value={date} onChange={setDate} />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Qui rappelle</label>
        <select value={who} onChange={e => setWho(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
          {callers().map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </ModalShell>
  )
}

// ── Mettre les devis d'un client en veille ─────────────────────
export function VeilleModal({ group, author, onClose, onDone }) {
  const [date, setDate] = useState(quickDates()[5].value)
  const [why, setWhy] = useState('')
  const [saving, setSaving] = useState(false)
  const clientName = group?.client?.name || 'Client'

  const save = async () => {
    if (!date) { toast.error('Choisissez une date de réveil'); return }
    setSaving(true)
    try {
      const now = new Date().toISOString()
      for (const q of group.quotes) {
        const patch = {
          followup_state: 'veille',
          veille_until: date,
          followup_notes: why.trim() || q.followup_notes || null,
          triaged_at: now,
          updated_at: now,
        }
        const { error } = await supabase.from('quotes').update(patch).eq('id', q.id)
        if (error) throw error
      }
      await logInteraction(supabase, {
        clientId: group.clientId,
        type: 'devis',
        title: `Devis en veille jusqu'au ${fmtDate(date)}`,
        content: [group.quotes.map(q => q.reference).join(', '), why.trim()].filter(Boolean).join('\n'),
        author,
      })
      toast.success(`${group.quotes.length} devis en veille jusqu'au ${fmtDate(date)}`)
      onDone?.()
    } catch (err) {
      toast.error('Mise en veille impossible : ' + err.message)
    } finally { setSaving(false) }
  }

  return (
    <ModalShell
      title="Mettre en veille"
      subtitle={`${clientName} · ${group?.quotes?.length || 0} devis`}
      onClose={onClose}
      footer={<><CancelButton onClick={onClose} /><SaveButton saving={saving} onClick={save} label="Mettre en veille" /></>}
    >
      <p className="text-sm text-gray-600">
        Les devis sortent de la liste et reviennent seuls à cette date. Rien n'est classé perdu.
      </p>
      <label className="block text-sm font-medium text-gray-700">Revenir le</label>
      <DatePicker value={date} onChange={setDate} />
      <input value={why} onChange={e => setWhy(e.target.value)}
        placeholder="Pourquoi ? Ex. décision après le budget 2027"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
    </ModalShell>
  )
}

// ── « Sans suite » en ligne (RDV à planifier) ─────────────────
export function SansSuiteInline({ rdv, author, onDone }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState(SANS_SUITE_REASONS[0])
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const patch = {
        status: 'annule', outcome: 'sans_suite', outcome_reason: reason,
        outcome_at: now, outcome_by: author, triaged_at: now, updated_at: now,
      }
      const { error } = await supabase.from('prospect_rdv').update(patch).eq('id', rdv.id)
      if (error) throw error
      toast.success('Classé sans suite')
      onDone?.()
    } catch (err) {
      toast.error('Action impossible : ' + err.message)
    } finally { setSaving(false) }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">
        Sans suite
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1">
      <select value={reason} onChange={e => setReason(e.target.value)}
        className="px-2 py-1 border border-gray-300 rounded-md text-xs">
        {SANS_SUITE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <button onClick={save} disabled={saving}
        className="px-2 py-1 text-xs bg-gray-900 text-white rounded-md disabled:opacity-50">OK</button>
      <button onClick={() => setOpen(false)} className="px-1.5 py-1 text-xs text-gray-500">Annuler</button>
    </span>
  )
}

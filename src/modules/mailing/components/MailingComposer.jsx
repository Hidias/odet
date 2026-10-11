// src/components/mailing/MailingComposer.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Mailing — Création d'une campagne sur un seul écran
//
//   Gauche : destinataires (MailingAudience)
//   Droite : message (modèles, variables, aide interactive, PJ), aperçu, test,
//            options d'envoi (programmé côté serveur ou depuis ce navigateur)
//
// Lancement :
//   • vérification finale des exclusions (données fraîches)
//   • récapitulatif à confirmer
//   • création campagne + pièce jointe stockée + destinataires personnalisés
// ─────────────────────────────────────────────────────────────────────────────

import { team, currentUserEmail, currentUserFirstName } from '../../../core/org/currentOrg'
import { apiFetch } from '../../../core/api'
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../../core/supabase'
import { sanitizeStorageKey } from '../../../core/storageUtils'
import { loadMailingExclusions, getAudienceExclusion, SOFT_EXCLUSIONS, EXCLUSION_LABELS } from '../lib/mailingExclusions'
import { MAILING_VARIABLES, buildRecipientVars, applyMailingVars, usedMailingVars } from '../lib/mailingVars'
import MailingAudience, { EMPTY_AUDIENCE_FILTERS } from './MailingAudience'
import {
  ArrowLeft, Loader2, Sparkles, Paperclip, X, Mail, Eye, Play, Save, Trash2, CalendarClock, Monitor, Server,
} from 'lucide-react'
import toast from 'react-hot-toast'

// Expéditeurs possibles : les membres de l'équipe (profils), avec leur adresse d'envoi
const sigOptions = () => team().filter((t) => t.email).map((t) => ({ value: t.firstName, label: t.name, email: t.email }))
export const senderEmailFor = (value) => sigOptions().find((s) => s.value === value)?.email || currentUserEmail()

const CADENCES = [
  { value: 90,  label: '90 s — 40 / heure' },
  { value: 180, label: '180 s — 20 / heure (recommandé)' },
  { value: 300, label: '300 s — 12 / heure (prudent)' },
]

const pad = (n) => String(n).padStart(2, '0')
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const fmtDateTime = (d) => d.toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function MailingComposer({ user, campaigns = [], initial = {}, onCancel, onLaunchBrowser, onScheduled }) {
  const [form, setForm] = useState({
    name: initial.name || '',
    subject: initial.subject || '',
    body_html: initial.body_html || '',
    signature_caller: initial.signature_caller || currentUserFirstName(),
  })
  const [attachment, setAttachment] = useState(initial.attachmentFile || null) // { filename, base64, contentType, size }
  const [selection, setSelection] = useState(new Map())
  const [audFilters, setAudFilters] = useState({ ...EMPTY_AUDIENCE_FILTERS, ...(initial.filters || {}) })

  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState('')
  const [showAI, setShowAI] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [previewEmail, setPreviewEmail] = useState('')

  const [mode, setMode] = useState('serveur')
  const [when, setWhen] = useState('now')
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60000)))
  const [cadence, setCadence] = useState(initial.cadence_seconds || 180)

  const [prepared, setPrepared] = useState(null) // récapitulatif avant confirmation
  const [preparing, setPreparing] = useState(false)
  const [launching, setLaunching] = useState(false)

  const bodyRef = useRef(null)
  const subjectRef = useRef(null)
  const fileRef = useRef(null)
  const lastFocus = useRef('body')

  useEffect(() => { loadTemplates() }, [])

  async function loadTemplates() {
    const { data } = await supabase.from('mailing_templates').select('*').order('name')
    setTemplates(data || [])
  }

  // ── Modèles ──
  function applyTemplate(id) {
    setTemplateId(id)
    const t = templates.find(x => x.id === id)
    if (!t) return
    if ((form.subject || form.body_html) && !confirm(`Remplacer l'objet et le message par le modèle « ${t.name} » ?`)) { setTemplateId(''); return }
    setForm(f => ({ ...f, subject: t.subject, body_html: t.body_html, signature_caller: t.signature_caller || f.signature_caller }))
  }
  async function saveTemplate(asNew) {
    if (!form.subject.trim() || !form.body_html.trim()) { toast.error('Objet et message requis'); return }
    const current = templates.find(t => t.id === templateId)
    if (!asNew && current) {
      const { error } = await supabase.from('mailing_templates')
        .update({ subject: form.subject, body_html: form.body_html, signature_caller: form.signature_caller, updated_at: new Date().toISOString() })
        .eq('id', current.id)
      if (error) { toast.error(error.message); return }
      toast.success(`Modèle « ${current.name} » mis à jour`)
    } else {
      const name = prompt('Nom du modèle :', form.name || '')
      if (!name?.trim()) return
      const { data, error } = await supabase.from('mailing_templates')
        .insert({ name: name.trim(), subject: form.subject, body_html: form.body_html, signature_caller: form.signature_caller, created_by: user?.email || null })
        .select().single()
      if (error) { toast.error(error.message); return }
      setTemplateId(data.id)
      toast.success('Modèle enregistré')
    }
    loadTemplates()
  }
  async function deleteTemplate() {
    const t = templates.find(x => x.id === templateId)
    if (!t || !confirm(`Supprimer le modèle « ${t.name} » ?`)) return
    await supabase.from('mailing_templates').delete().eq('id', t.id)
    setTemplateId('')
    loadTemplates()
  }

  // ── Variables ──
  function insertVar(key) {
    const token = `{${key}}`
    const target = lastFocus.current === 'subject' ? subjectRef.current : bodyRef.current
    const field = lastFocus.current === 'subject' ? 'subject' : 'body_html'
    if (!target) { setForm(f => ({ ...f, [field]: (f[field] || '') + token })); return }
    const start = target.selectionStart ?? target.value.length
    const end = target.selectionEnd ?? start
    const val = form[field] || ''
    const next = val.slice(0, start) + token + val.slice(end)
    setForm(f => ({ ...f, [field]: next }))
    requestAnimationFrame(() => { target.focus(); target.setSelectionRange(start + token.length, start + token.length) })
  }

  // ── Aide interactive ──
  async function generateWithAI() {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    try {
      const res = await apiFetch('/api/generate-mailing-body', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt }),
      })
      const data = await res.json()
      if (data.body_html) { setForm(f => ({ ...f, body_html: data.body_html })); setShowAI(false); setAiPrompt('') }
      else toast.error('Erreur génération')
    } catch { toast.error('Erreur génération') }
    finally { setAiLoading(false) }
  }

  // ── Pièce jointe ──
  function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 3 * 1024 * 1024) { toast.error('Fichier trop lourd (max 3 Mo)'); return }
    const reader = new FileReader()
    reader.onload = ev => {
      const base64 = String(ev.target.result).split(',')[1]
      setAttachment({ filename: file.name, base64, contentType: file.type || 'application/octet-stream', size: file.size })
    }
    reader.readAsDataURL(file)
  }

  // ── Aperçu ──
  const selectionList = useMemo(() => [...selection.values()], [selection])
  const previewRow = selection.get(previewEmail) || selectionList[0] || null
  const previewVars = previewRow ? buildRecipientVars(previewRow) : { bonjour: 'Bonjour,', entreprise: 'NOM DE L’ENTREPRISE', ville: 'Ville', prenom: '', nom: '' }
  const previewSubject = applyMailingVars(form.subject, previewVars)
  const previewBody = applyMailingVars(form.body_html, previewVars, { html: true })
  const previewSrc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:16px;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px}</style></head><body>${previewBody}</body></html>`

  const usedVars = usedMailingVars(`${form.subject} ${form.body_html}`)
  const missingVarCount = useMemo(() => {
    const need = usedVars.filter(v => v !== 'bonjour')
    if (!need.length) return 0
    return selectionList.filter(r => { const v = buildRecipientVars(r); return need.some(k => !v[k]) }).length
  }, [usedVars.join(','), selectionList])

  async function sendTest() {
    if (!form.subject.trim() || !form.body_html.trim()) { toast.error('Objet et message requis'); return }
    const toastId = toast.loading('Envoi du test…')
    try {
      const { data: fakeRow } = await supabase
        .from('mailing_sends')
        .insert({ campaign_id: null, source: 'test', source_id: null, email: user?.email || 'test@test.com', company_name: 'TEST', status: 'pending' })
        .select().single()
      const res = await apiFetch('/api/send-mailing-single', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          send_id: fakeRow?.id || 'test', to: user?.email,
          subject: `[TEST] ${previewSubject}`, body_html: previewBody,
          caller: form.signature_caller, unsubscribe_token: 'test-token',
          attachments: attachment ? [attachment] : [],
        }),
      })
      res.ok ? toast.success(`Test envoyé à ${user?.email}`, { id: toastId }) : toast.error('Erreur envoi test', { id: toastId })
    } catch { toast.error('Erreur envoi test', { id: toastId }) }
  }

  // ── Estimation ──
  const startDate = when === 'later' && mode === 'serveur' ? new Date(scheduledAt) : new Date()
  const endDate = new Date(startDate.getTime() + Math.max(0, selection.size - 1) * cadence * 1000)
  const durationMin = Math.ceil((selection.size * cadence) / 60)

  // ── Préparation (vérification finale) ──
  async function prepare() {
    if (!form.name.trim()) { toast.error('Nom de la campagne requis'); return }
    if (!form.subject.trim()) { toast.error('Objet requis'); return }
    if (!form.body_html.trim()) { toast.error('Message requis'); return }
    if (!selection.size) { toast.error('Aucun destinataire sélectionné'); return }
    if (mode === 'serveur' && when === 'later' && !(new Date(scheduledAt).getTime() > Date.now())) {
      toast.error('La date programmée doit être dans le futur'); return
    }
    setPreparing(true)
    try {
      const emails = [...selection.keys()]
      const fresh = new Map()
      for (let i = 0; i < emails.length; i += 200) {
        const { data, error } = await supabase.from('mailing_audience_v').select('*').in('email', emails.slice(i, i + 200))
        if (error) throw error
        ;(data || []).forEach(r => fresh.set(r.email, r))
      }
      const excl = await loadMailingExclusions()
      const opts = { includePartners: audFilters.includePartners, includeRgpd: audFilters.includeRgpd }
      const kept = []
      const removed = {}
      for (const [email, sel] of selection) {
        const r = fresh.get(email)
        if (!r) { removed.disparue = (removed.disparue || 0) + 1; continue }
        const reason = getAudienceExclusion(r, excl, opts)
        if (reason === 'hidden') { removed.bloque = (removed.bloque || 0) + 1; continue }
        if (reason && !(SOFT_EXCLUSIONS.includes(reason) && sel._forced)) { removed[reason] = (removed[reason] || 0) + 1; continue }
        kept.push(r)
      }
      const recent = kept.filter(r => r.last_sent_at && (Date.now() - new Date(r.last_sent_at).getTime()) < 30 * 86400000).length
      setPrepared({ kept, removed, recent })
    } catch (e) {
      toast.error('Vérification impossible : ' + e.message)
    }
    setPreparing(false)
  }

  // ── Lancement ──
  async function launch() {
    if (!prepared?.kept?.length) return
    setLaunching(true)
    let campaign = null
    try {
      const later = mode === 'serveur' && when === 'later'
      const start = later ? new Date(scheduledAt) : new Date()
      const nowIso = new Date().toISOString()

      const { data: camp, error: campErr } = await supabase.from('mailing_campaigns').insert({
        name: form.name.trim(),
        subject: form.subject,
        body_html: form.body_html,
        signature_caller: form.signature_caller,
        sender_email: senderEmailFor(form.signature_caller),
        target_source: 'audience',
        filters: { audience: audFilters },
        status: later ? 'planifiée' : 'en_cours',
        send_mode: mode,
        scheduled_at: start.toISOString(),
        next_send_at: start.toISOString(),
        started_at: later ? null : nowIso,
        cadence_seconds: cadence,
        total_recipients: prepared.kept.length,
        created_by: user?.email || 'admin',
        source_campaign_id: initial.source_campaign_id || null,
      }).select().single()
      if (campErr) throw campErr
      campaign = camp

      // Pièce jointe stockée (sert aussi aux reprises)
      if (attachment) {
        const path = `${camp.id}/${sanitizeStorageKey(attachment.filename)}`
        const bin = Uint8Array.from(atob(attachment.base64), c => c.charCodeAt(0))
        const { error: upErr } = await supabase.storage.from('mailing-attachments')
          .upload(path, new Blob([bin], { type: attachment.contentType }), { contentType: attachment.contentType, upsert: true })
        if (upErr) throw new Error('Pièce jointe : ' + upErr.message)
        const meta = { path, filename: attachment.filename, contentType: attachment.contentType, size: attachment.size || bin.length }
        const { error: metaErr } = await supabase.from('mailing_campaigns').update({ attachment: meta }).eq('id', camp.id)
        if (metaErr) throw metaErr
      }

      // Destinataires personnalisés
      const payload = prepared.kept.map(r => ({
        campaign_id: camp.id,
        source: r.send_source,
        source_id: r.source_id,
        email: r.email,
        company_name: r.display_name || null,
        status: 'pending',
        vars: buildRecipientVars(r),
      }))
      for (let i = 0; i < payload.length; i += 500) {
        const { error } = await supabase.from('mailing_sends').insert(payload.slice(i, i + 500))
        if (error) throw error
      }

      if (mode === 'serveur') {
        toast.success(later
          ? `Campagne programmée le ${fmtDateTime(start)} — ${payload.length} destinataires`
          : `Envoi lancé côté serveur — ${payload.length} destinataires. Vous pouvez fermer cette page.`, { duration: 6000 })
        onScheduled?.(camp)
      } else {
        const { data: sends, error: sErr } = await supabase
          .from('mailing_sends')
          .select('id, email, company_name, unsubscribe_token, vars')
          .eq('campaign_id', camp.id).eq('status', 'pending')
          .order('created_at')
        if (sErr) throw sErr
        onLaunchBrowser?.({
          campaign: camp,
          sends: sends || [],
          context: { body_html: form.body_html, subject: form.subject, signature_caller: form.signature_caller, cadence },
          attachment,
        })
      }
    } catch (e) {
      toast.error('Lancement impossible : ' + e.message, { duration: 8000 })
      if (campaign) {
        // Nettoyage : rien ne doit partir d'une campagne incomplète
        await supabase.from('mailing_sends').delete().eq('campaign_id', campaign.id)
        await supabase.from('mailing_campaigns').delete().eq('id', campaign.id)
        if (attachment) await supabase.storage.from('mailing-attachments').remove([`${campaign.id}/${sanitizeStorageKey(attachment.filename)}`])
      }
    }
    setLaunching(false)
  }

  const canPrepare = form.name.trim() && form.subject.trim() && form.body_html.trim() && selection.size > 0

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4">
      {/* ── En-tête ── */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onCancel} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="Nom de la campagne *"
          className="flex-1 min-w-[240px] text-lg font-semibold border-b border-transparent hover:border-gray-200 focus:border-blue-500 focus:outline-none px-1 py-1" />
        <span className="text-sm text-gray-500">{selection.size} destinataire{selection.size > 1 ? 's' : ''}</span>
        <button onClick={prepare} disabled={!canPrepare || preparing}
          className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold disabled:opacity-40">
          {preparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {mode === 'serveur' && when === 'later' ? 'Programmer…' : 'Lancer…'}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* ── Destinataires ── */}
        <div className="xl:col-span-7 bg-white rounded-xl border border-gray-200 p-4">
          <MailingAudience
            value={selection}
            onChange={setSelection}
            campaigns={campaigns}
            filters={audFilters}
            onFiltersChange={setAudFilters}
            user={user}
            preselectEmails={initial.preselectEmails || null}
          />
        </div>

        {/* ── Message ── */}
        <div className="xl:col-span-5 space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <select value={templateId} onChange={e => applyTemplate(e.target.value)} className="flex-1 min-w-[160px] border rounded-lg px-2 py-1.5 text-sm">
                <option value="">Modèle…</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {templateId && (
                <>
                  <button onClick={() => saveTemplate(false)} title="Mettre à jour ce modèle" className="p-1.5 border rounded-lg text-gray-600 hover:bg-gray-50"><Save className="w-4 h-4" /></button>
                  <button onClick={deleteTemplate} title="Supprimer ce modèle" className="p-1.5 border rounded-lg text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </>
              )}
              <button onClick={() => saveTemplate(true)} className="px-2.5 py-1.5 border rounded-lg text-xs text-gray-700 hover:bg-gray-50">Enregistrer comme modèle</button>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Objet *</label>
              <input ref={subjectRef} value={form.subject} onFocus={() => { lastFocus.current = 'subject' }}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                placeholder="Ex : Sécurité au travail — {entreprise}"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-1 mb-1">
                <label className="text-xs font-medium text-gray-600 mr-1">Message *</label>
                {MAILING_VARIABLES.map(v => (
                  <button key={v.key} type="button" onClick={() => insertVar(v.key)} title={`Ex : ${v.example}`}
                    className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[11px] hover:bg-blue-100">{`{${v.key}}`}</button>
                ))}
                <button onClick={() => setShowAI(s => !s)}
                  className="ml-auto flex items-center gap-1 text-[11px] px-2 py-0.5 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-full">
                  <Sparkles className="w-3 h-3" /> Aide interactive
                </button>
              </div>
              {showAI && (
                <div className="mb-2 bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2">
                  <textarea rows={3} value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
                    placeholder="Ex : mail de prospection pour des campings sur la formation SST et l'incendie, ton professionnel"
                    className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm bg-white" />
                  <div className="flex gap-2">
                    <button onClick={generateWithAI} disabled={aiLoading || !aiPrompt.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs disabled:opacity-50">
                      {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Générer
                    </button>
                    <button onClick={() => setShowAI(false)} className="px-3 py-1.5 text-xs text-gray-600">Fermer</button>
                  </div>
                </div>
              )}
              <textarea ref={bodyRef} rows={12} value={form.body_html} onFocus={() => { lastFocus.current = 'body' }}
                onChange={e => setForm(f => ({ ...f, body_html: e.target.value }))}
                placeholder={'{bonjour}\n\n...'}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-[11px] text-gray-400">HTML accepté. La signature et le lien de désabonnement sont ajoutés automatiquement.</p>
              {missingVarCount > 0 && (
                <p className="text-[11px] text-amber-700 mt-1">⚠️ {missingVarCount} destinataire{missingVarCount > 1 ? 's' : ''} sans valeur pour une variable utilisée ({usedVars.filter(v => v !== 'bonjour').map(v => `{${v}}`).join(', ')}) : elle sera laissée vide.</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Signature / expéditeur</label>
                <select value={form.signature_caller} onChange={e => setForm(f => ({ ...f, signature_caller: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm">
                  {sigOptions().map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Pièce jointe</label>
                {attachment ? (
                  <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-2 py-2">
                    <Paperclip className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="text-xs text-gray-700 truncate flex-1">{attachment.filename}</span>
                    <button onClick={() => setAttachment(null)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <>
                    <button onClick={() => fileRef.current?.click()}
                      className="w-full border border-dashed border-gray-300 hover:border-blue-400 rounded-lg px-2 py-2 text-xs text-gray-500 text-left">
                      + Fichier (max 3 Mo)
                    </button>
                    <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Aperçu ── */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-50 border-b text-xs text-gray-500">
              <Eye className="w-3.5 h-3.5" /> Aperçu pour
              <select value={previewRow?.email || ''} onChange={e => setPreviewEmail(e.target.value)} className="border rounded px-1 py-0.5 max-w-[220px]">
                {!selectionList.length && <option value="">(exemple)</option>}
                {selectionList.slice(0, 200).map(r => <option key={r.email} value={r.email}>{r.display_name}</option>)}
              </select>
              <button onClick={sendTest} className="ml-auto flex items-center gap-1 px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded">
                <Mail className="w-3.5 h-3.5" /> Test à {user?.email}
              </button>
            </div>
            <p className="px-3 pt-2 text-sm"><span className="text-gray-400">Objet :</span> <strong>{previewSubject || '—'}</strong></p>
            {form.body_html
              ? <iframe srcDoc={previewSrc} title="apercu" sandbox="allow-same-origin" className="w-full border-none" style={{ height: 300 }} />
              : <p className="p-6 text-center text-sm text-gray-400">Message vide</p>}
          </div>

          {/* ── Envoi ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMode('serveur')}
                className={`flex items-start gap-2 p-3 rounded-lg border text-left ${mode === 'serveur' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <Server className="w-4 h-4 mt-0.5 text-blue-600" />
                <span><span className="block text-sm font-medium">Par le serveur</span><span className="block text-[11px] text-gray-500">Pas besoin de laisser la page ouverte. Programmable.</span></span>
              </button>
              <button onClick={() => { setMode('navigateur'); setWhen('now') }}
                className={`flex items-start gap-2 p-3 rounded-lg border text-left ${mode === 'navigateur' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <Monitor className="w-4 h-4 mt-0.5 text-gray-600" />
                <span><span className="block text-sm font-medium">Depuis ce navigateur</span><span className="block text-[11px] text-gray-500">Immédiat, l'onglet doit rester ouvert.</span></span>
              </button>
            </div>

            {mode === 'serveur' && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5"><input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /> Maintenant</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={when === 'later'} onChange={() => setWhen('later')} /> Programmer le</label>
                {when === 'later' && (
                  <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className="border rounded-lg px-2 py-1 text-sm" />
                )}
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-gray-600 mb-1">Cadence</p>
              <div className="flex flex-wrap gap-2">
                {CADENCES.map(c => (
                  <button key={c.value} onClick={() => setCadence(c.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs border ${cadence === c.value ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:border-blue-300'}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {selection.size > 0 && (
              <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                <CalendarClock className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                {selection.size} mail{selection.size > 1 ? 's' : ''} · environ {durationMin >= 60 ? `${Math.floor(durationMin / 60)} h ${durationMin % 60} min` : `${durationMin} min`}
                {' '}· début {fmtDateTime(startDate)} · fin vers {fmtDateTime(endDate)}
                {selection.size > 400 && <span className="block text-amber-700 mt-1">⚠️ Plus de 400 mails : c'est au-delà de votre plus gros envoi journalier connu (457 le 15/05).</span>}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Confirmation ── */}
      {prepared && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4">
            <h3 className="text-lg font-bold">{mode === 'serveur' && when === 'later' ? 'Programmer la campagne' : 'Lancer la campagne'}</h3>
            <ul className="text-sm space-y-1.5 text-gray-700">
              <li><strong>{prepared.kept.length}</strong> destinataire{prepared.kept.length > 1 ? 's' : ''} — « {form.subject} »</li>
              {Object.keys(prepared.removed).length > 0 && (
                <li className="text-orange-700">
                  Retirés à la vérification finale : {Object.entries(prepared.removed).map(([k, n]) => `${EXCLUSION_LABELS[k] || (k === 'disparue' ? 'Adresse disparue' : k)} ${n}`).join(' · ')}
                </li>
              )}
              {prepared.recent > 0 && <li className="text-amber-700">⚠️ {prepared.recent} ont déjà reçu un mail il y a moins de 30 jours (envoi quand même)</li>}
              <li>Expéditeur : <strong>{senderEmailFor(form.signature_caller)}</strong></li>
              <li>Mode : <strong>{mode === 'serveur' ? 'serveur' : 'ce navigateur (ne pas fermer l’onglet)'}</strong> · cadence {cadence} s</li>
              <li>{mode === 'serveur' && when === 'later' ? 'Début' : 'Départ'} : <strong>{fmtDateTime(startDate)}</strong> · fin estimée {fmtDateTime(new Date(startDate.getTime() + Math.max(0, prepared.kept.length - 1) * cadence * 1000))}</li>
              {attachment && <li>Pièce jointe : <strong>{attachment.filename}</strong></li>}
              <li>Rapport de fin envoyé à <strong>{senderEmailFor(form.signature_caller)}</strong></li>
            </ul>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setPrepared(null)} disabled={launching} className="px-4 py-2 text-sm text-gray-600">Annuler</button>
              <button onClick={launch} disabled={launching || !prepared.kept.length}
                className="flex items-center gap-2 px-5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {launching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

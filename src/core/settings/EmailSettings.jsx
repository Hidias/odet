import { useState, useEffect } from 'react'
import { Mail, Save, Loader2, CheckCircle, PlugZap, Trash2, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { apiFetch } from '../api'
import { Field } from './shared'

import { confirmer } from '../../ui/Confirm'
// Comptes email d'envoi de l'utilisateur connecté (SMTP). Le mot de passe est chiffré côté serveur
// et n'est jamais relu par l'application.

const PRESETS = [
  { key: 'ionos-exchange', label: 'IONOS Exchange', host: 'smtp.exchange.ionos.eu', port: 587, secure: false },
  { key: 'ionos-basic', label: 'IONOS Mail Basic', host: 'smtp.ionos.fr', port: 587, secure: false },
  { key: 'ovh', label: 'OVH', host: 'ssl0.ovh.net', port: 587, secure: false },
  { key: 'outlook', label: 'Microsoft 365 / Outlook', host: 'smtp.office365.com', port: 587, secure: false },
  { key: 'gmail', label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 587, secure: false },
  { key: 'orange', label: 'Orange', host: 'smtp.orange.fr', port: 465, secure: true },
  { key: 'custom', label: 'Autre serveur', host: '', port: 587, secure: false },
]

const emptyForm = { email: '', password: '', preset: 'ionos-exchange', smtpHost: 'smtp.exchange.ionos.eu', smtpPort: 587, smtpSecure: false }

async function call(method, body, query = '') {
  const res = await apiFetch(`/api/user-email-config${query}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok && !json.error) json.error = `Erreur ${res.status}`
  return json
}

export default function EmailSettings({ embedded = false }) {
  const [loading, setLoading] = useState(true)
  const [configs, setConfigs] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState('')

  const load = async () => {
    setLoading(true)
    const r = await call('GET')
    if (r.error) toast.error(r.error)
    setConfigs(r.configs || [])
    setEditing((r.configs || []).length === 0)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const choosePreset = (key) => {
    const p = PRESETS.find((x) => x.key === key)
    setForm((f) => ({ ...f, preset: key, smtpHost: p.host || f.smtpHost, smtpPort: p.port, smtpSecure: p.secure }))
  }
  const payload = (extra) => ({ email: form.email, password: form.password, smtpHost: form.smtpHost, smtpPort: Number(form.smtpPort), smtpSecure: !!form.smtpSecure, preset: form.preset === 'custom' ? undefined : form.preset, ...extra })

  const test = async () => {
    if (!form.email || !form.password || !form.smtpHost) return toast.error('Email, mot de passe et serveur requis')
    setBusy('test')
    const r = await call('POST', payload({ testConnection: true }))
    setBusy('')
    if (r.success) toast.success('Connexion réussie')
    else toast.error(r.error || 'Connexion impossible')
  }
  const save = async () => {
    if (!form.email || !form.smtpHost) return toast.error('Email et serveur requis')
    setBusy('save')
    const r = await call('POST', payload({ testConnection: false }))
    setBusy('')
    if (r.success) {
      toast.success('Compte enregistré')
      setForm(emptyForm)
      await load()
    } else toast.error(r.error || 'Enregistrement impossible')
  }
  const remove = async (email) => {
    if (!await confirmer(`Retirer le compte ${email} ?`)) return
    const r = await call('DELETE', null, `?email=${encodeURIComponent(email)}`)
    if (r.success) { toast.success('Compte retiré'); load() } else toast.error(r.error || 'Suppression impossible')
  }

  const content = (
    <div className="space-y-5">
      <div>
        <h2 className="section-title flex items-center gap-2"><Mail className="w-5 h-5 text-accent-500" /> Comptes email d'envoi</h2>
        <p className="muted mt-1">Les emails (convocations, devis, factures, relances) partent depuis votre propre boîte. Le mot de passe est chiffré et n'est jamais affiché.</p>
      </div>

      {loading ? (
        <div className="py-6 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></div>
      ) : (
        <>
          {configs.length > 0 && (
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-ui">
              {configs.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                  <CheckCircle className="w-4 h-4 text-[rgb(var(--c-success))] flex-none" />
                  <div className="flex-1 min-w-0">
                    <div className="text-ui font-medium text-gray-900 truncate">{c.email}</div>
                    <div className="text-ui-sm text-gray-500">{c.smtp_host}:{c.smtp_port}{c.last_tested_at ? `, enregistré le ${new Date(c.last_tested_at).toLocaleDateString('fr-FR')}` : ''}</div>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setForm({ ...emptyForm, email: c.email, preset: 'custom', smtpHost: c.smtp_host, smtpPort: c.smtp_port, smtpSecure: c.smtp_secure }); setEditing(true) }}>Modifier</button>
                  <button type="button" className="btn btn-ghost btn-icon text-[rgb(var(--c-danger))]" onClick={() => remove(c.email)} aria-label="Retirer"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}

          {!editing ? (
            <button type="button" className="btn btn-secondary" onClick={() => { setForm(emptyForm); setEditing(true) }}><Plus className="w-4 h-4" /> Ajouter un compte</button>
          ) : (
            <div className="rounded-ui border border-gray-200 p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Adresse email"><input type="email" className="input" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="prenom.nom@exemple.fr" autoComplete="off" /></Field>
                <Field label="Mot de passe de la boîte" hint="Laissez vide pour garder le mot de passe enregistré"><input type="password" className="input" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" /></Field>
                <Field label="Fournisseur">
                  <select className="select" value={form.preset} onChange={(e) => choosePreset(e.target.value)}>
                    {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-[1fr_90px] gap-2">
                  <Field label="Serveur SMTP"><input className="input" value={form.smtpHost} onChange={(e) => set('smtpHost', e.target.value)} /></Field>
                  <Field label="Port"><input className="input" inputMode="numeric" value={form.smtpPort} onChange={(e) => set('smtpPort', e.target.value.replace(/\D/g, ''))} /></Field>
                </div>
              </div>
              <label className="flex items-center gap-2 text-ui cursor-pointer">
                <input type="checkbox" checked={!!form.smtpSecure} onChange={(e) => set('smtpSecure', e.target.checked)} className="w-4 h-4 accent-[rgb(var(--c-accent-500))]" />
                Connexion SSL directe (port 465). Décoché : STARTTLS (port 587)
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary" onClick={test} disabled={!!busy}>{busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />} Tester</button>
                <button type="button" className="btn btn-primary" onClick={save} disabled={!!busy}>{busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Enregistrer</button>
                {configs.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Annuler</button>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )

  if (embedded) return content
  return <div className="card max-w-3xl">{content}</div>
}

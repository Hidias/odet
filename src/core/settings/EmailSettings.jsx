import { useState, useEffect, useRef } from 'react'
import { Mail, Save, Loader2, CheckCircle, Send, Trash2, Plus, ChevronDown, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import { apiFetch } from '../api'
import { Field } from './shared'
import { confirmer } from '../../ui/Confirm'
import { oublierEtatBoite } from './etatBoite'

// Boîte d'envoi de l'utilisateur connecté (SMTP). Le mot de passe est chiffré côté serveur et n'est jamais relu par
// l'application. Refonte du 19/10 au soir (décision de H) : chacun configure sa propre boîte simplement. On saisit son
// adresse, le fournisseur est reconnu tout seul (Gmail, Google Workspace, Microsoft 365, IONOS, OVH, Orange), un guide
// pas à pas explique le mot de passe d'application de Gmail, et « Tester l'envoi » envoie un vrai email à soi-même.

const PRESETS = [
  { key: 'gmail', label: 'Gmail ou Google Workspace', host: 'smtp.gmail.com', port: 587, secure: false },
  { key: 'ionos-exchange', label: 'IONOS Exchange', host: 'smtp.exchange.ionos.eu', port: 587, secure: false },
  { key: 'ionos-basic', label: 'IONOS Mail Basic', host: 'smtp.ionos.fr', port: 587, secure: false },
  { key: 'ovh', label: 'OVH', host: 'ssl0.ovh.net', port: 587, secure: false },
  { key: 'outlook', label: 'Microsoft 365 ou Outlook', host: 'smtp.office365.com', port: 587, secure: false },
  { key: 'orange', label: 'Orange', host: 'smtp.orange.fr', port: 465, secure: true },
  { key: 'custom', label: 'Autre fournisseur', host: '', port: 587, secure: false },
]

const emptyForm = { email: '', password: '', preset: 'gmail', smtpHost: 'smtp.gmail.com', smtpPort: 587, smtpSecure: false }

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

function GuideGmail() {
  const [ouvert, setOuvert] = useState(true)
  return (
    <div className="rounded-ui border border-[rgb(var(--c-info)/0.3)] bg-[rgb(var(--c-info-bg))] p-3 text-ui">
      <button type="button" className="w-full flex items-center justify-between gap-2 font-medium text-gray-900 text-left" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}>
        <span>Gmail : créer le mot de passe d'application (5 minutes, une seule fois)</span>
        <ChevronDown className={`w-4 h-4 flex-none transition-transform ${ouvert ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {ouvert && (
        <ol className="mt-3 space-y-2.5 list-decimal pl-5 text-gray-700">
          <li>
            <span className="font-medium text-gray-900">Activez la validation en deux étapes</span> de votre compte Google (Google l'exige).
            Ouvrez <a className="text-accent-600 underline inline-flex items-center gap-1 break-all" href="https://myaccount.google.com/signinoptions/twosv" target="_blank" rel="noreferrer">myaccount.google.com, Validation en deux étapes<ExternalLink className="w-3.5 h-3.5 flex-none" /></a> et suivez les écrans (un code par SMS suffit). Si c'est déjà fait, passez à l'étape 2.
          </li>
          <li>
            <span className="font-medium text-gray-900">Ouvrez la page des mots de passe d'application</span> :
            {' '}<a className="text-accent-600 underline inline-flex items-center gap-1 break-all" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords<ExternalLink className="w-3.5 h-3.5 flex-none" /></a>.
            Google peut redemander votre mot de passe habituel.
          </li>
          <li><span className="font-medium text-gray-900">Donnez un nom</span>, par exemple « GLD Solutions », puis appuyez sur « Créer ».</li>
          <li><span className="font-medium text-gray-900">Copiez le code de 16 lettres</span> qui s'affiche (quatre groupes de quatre lettres). Les espaces n'ont pas d'importance.</li>
          <li><span className="font-medium text-gray-900">Collez-le ci-dessous</span> dans « Mot de passe d'application », puis appuyez sur « Tester l'envoi ». Vous recevez un email de test dans votre boîte : c'est prêt.</li>
        </ol>
      )}
      <p className="mt-2 text-ui-sm text-gray-600">Ce code ne sert qu'à l'outil. Il ne remplace pas votre mot de passe Google, et vous pouvez le supprimer à tout moment depuis la même page.</p>
    </div>
  )
}

export default function EmailSettings({ embedded = false }) {
  const [loading, setLoading] = useState(true)
  const [configs, setConfigs] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState(false)
  const [avance, setAvance] = useState(false)
  const [busy, setBusy] = useState('')
  const [testOk, setTestOk] = useState(false)
  const detection = useRef(0)

  const load = async () => {
    setLoading(true)
    const r = await call('GET')
    if (r.error) toast.error(r.error)
    setConfigs(r.configs || [])
    setEditing((r.configs || []).length === 0)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const set = (k, v) => { setTestOk(false); setForm((f) => ({ ...f, [k]: v })) }
  const choosePreset = (key) => {
    const p = PRESETS.find((x) => x.key === key)
    setTestOk(false)
    setForm((f) => ({ ...f, preset: key, smtpHost: p.host || f.smtpHost, smtpPort: p.port, smtpSecure: p.secure }))
    if (key === 'custom') setAvance(true)
  }
  // Fournisseur reconnu d'après l'adresse, dès qu'elle est complète
  const reconnaitre = async (email) => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return
    const n = ++detection.current
    const r = await call('GET', null, `?detect=${encodeURIComponent(email)}`)
    if (n !== detection.current || !r.preset) return
    choosePreset(r.preset)
  }
  const payload = (extra) => ({ email: form.email.trim(), password: form.password, smtpHost: form.smtpHost, smtpPort: Number(form.smtpPort), smtpSecure: !!form.smtpSecure, preset: form.preset === 'custom' ? undefined : form.preset, ...extra })

  const test = async () => {
    if (!form.email || !form.password || !form.smtpHost) return toast.error('Saisissez votre adresse et votre mot de passe')
    setBusy('test')
    const r = await call('POST', payload({ testConnection: true, sendTest: true }))
    setBusy('')
    if (r.success) { setTestOk(true); toast.success(r.message || 'Email de test envoyé') } else toast.error(r.error || 'Connexion impossible', { duration: 9000 })
  }
  const save = async () => {
    if (!form.email || !form.smtpHost) return toast.error('Adresse et serveur requis')
    setBusy('save')
    const r = await call('POST', payload({ testConnection: false }))
    setBusy('')
    if (r.success) {
      toast.success('Boîte enregistrée : vos emails partiront depuis cette adresse')
      oublierEtatBoite()
      setForm(emptyForm)
      setTestOk(false)
      await load()
    } else toast.error(r.error || 'Enregistrement impossible')
  }
  const remove = async (email) => {
    if (!await confirmer(`Retirer la boîte ${email} ? Vos emails ne pourront plus partir tant qu'aucune boîte n'est configurée.`)) return
    const r = await call('DELETE', null, `?email=${encodeURIComponent(email)}`)
    if (r.success) { toast.success('Boîte retirée'); oublierEtatBoite(); load() } else toast.error(r.error || 'Suppression impossible')
  }

  const estGmail = form.preset === 'gmail' || /smtp\.gmail\.com/i.test(form.smtpHost)

  const content = (
    <div className="space-y-5">
      <div>
        <h2 className="section-title flex items-center gap-2"><Mail className="w-5 h-5 text-accent-500" /> Ma boîte d'envoi</h2>
        <p className="muted mt-1">Les emails (devis, factures, convocations, relances) partent depuis votre propre adresse, et les réponses arrivent dans votre boîte. Le mot de passe est chiffré et n'est jamais affiché.</p>
      </div>

      {loading ? (
        <div className="py-6 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></div>
      ) : (
        <>
          {configs.length === 0 && !editing && (
            <div className="rounded-ui border border-[rgb(var(--c-warning)/0.4)] bg-[rgb(var(--c-warning-bg))] p-3 text-ui text-gray-800">Aucune boîte configurée : vos emails ne peuvent pas partir.</div>
          )}
          {configs.length > 0 && (
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-ui">
              {configs.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <CheckCircle className="w-4 h-4 text-[rgb(var(--c-success))] flex-none" />
                  <div className="flex-1 min-w-0">
                    <div className="text-ui font-medium text-gray-900 break-all">{c.email}</div>
                    <div className="text-ui-sm text-gray-500">Prête{c.last_tested_at ? `, enregistrée le ${new Date(c.last_tested_at).toLocaleDateString('fr-FR')}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { const p = PRESETS.find((x) => x.host === c.smtp_host); setForm({ ...emptyForm, email: c.email, preset: p?.key || 'custom', smtpHost: c.smtp_host, smtpPort: c.smtp_port, smtpSecure: c.smtp_secure }); setEditing(true) }}>Modifier</button>
                    <button type="button" className="btn btn-ghost btn-icon text-[rgb(var(--c-danger))]" onClick={() => remove(c.email)} aria-label="Retirer"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!editing ? (
            <button type="button" className="btn btn-secondary" onClick={() => { setForm(emptyForm); setEditing(true) }}><Plus className="w-4 h-4" /> Ajouter une boîte</button>
          ) : (
            <div className="rounded-ui border border-gray-200 p-4 space-y-4">
              <Field label="1. Votre adresse email">
                <input type="email" className="input" value={form.email} onChange={(e) => set('email', e.target.value)} onBlur={(e) => reconnaitre(e.target.value.trim())} placeholder="prenom.nom@exemple.fr" autoComplete="off" inputMode="email" />
              </Field>
              <Field label="Fournisseur" hint="Reconnu d'après votre adresse. Changez-le seulement s'il est faux.">
                <select className="select" value={form.preset} onChange={(e) => choosePreset(e.target.value)}>
                  {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </Field>
              {estGmail && <GuideGmail />}
              <Field label={estGmail ? "2. Mot de passe d'application (16 lettres)" : '2. Mot de passe de la boîte'} hint={configs.some((c) => c.email === form.email.trim().toLowerCase()) ? 'Laissez vide pour garder le mot de passe enregistré' : undefined}>
                <input type="password" className="input" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" placeholder={estGmail ? 'abcd efgh ijkl mnop' : ''} />
              </Field>

              <button type="button" className="text-ui-sm text-gray-500 underline-offset-2 hover:underline" onClick={() => setAvance((a) => !a)}>{avance ? 'Masquer les réglages du serveur' : 'Réglages du serveur (rarement utile)'}</button>
              {avance && (
                <div className="space-y-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-2">
                    <Field label="Serveur SMTP"><input className="input" value={form.smtpHost} onChange={(e) => set('smtpHost', e.target.value)} /></Field>
                    <Field label="Port"><input className="input" inputMode="numeric" value={form.smtpPort} onChange={(e) => set('smtpPort', e.target.value.replace(/\D/g, ''))} /></Field>
                  </div>
                  <label className="flex items-start gap-2 text-ui cursor-pointer">
                    <input type="checkbox" checked={!!form.smtpSecure} onChange={(e) => set('smtpSecure', e.target.checked)} className="w-4 h-4 mt-0.5 accent-[rgb(var(--c-accent-500))]" />
                    <span>Connexion SSL directe (port 465). Décoché : STARTTLS (port 587)</span>
                  </label>
                </div>
              )}

              <div>
                <div className="label">3. Vérifiez, puis enregistrez</div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-secondary" onClick={test} disabled={!!busy}>{busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Tester l'envoi</button>
                  <button type="button" className={`btn ${testOk ? 'btn-primary' : 'btn-secondary'}`} onClick={save} disabled={!!busy}>{busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Enregistrer</button>
                  {configs.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Annuler</button>}
                </div>
                <p className="text-ui-sm text-gray-500 mt-2">{testOk ? 'Test réussi : regardez votre boîte de réception, puis enregistrez.' : "« Tester l'envoi » vous envoie un email à vous-même, depuis cette boîte."}</p>
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

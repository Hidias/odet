import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Activity, Database, Layers, Mail, Users, Lock, Download, RefreshCw, Sparkles, FileText, Copy, CheckCircle, AlertTriangle, Loader2, ChevronDown, ChevronUp, Clock,
} from 'lucide-react'
import { useAuthStore, useDataStore } from '../store'
import { supabase } from '../supabase'
import { callApi } from '../api'
import { useBranding } from '../branding/BrandingProvider'
import { APP_VERSION } from '../version'
import { CHANGELOG } from '../changelog'
import { ModulesSection, Toggle } from '../settings/shared'

// Console technique de l'instance, réservée au super administrateur :
// état, migrations à appliquer, modules, mode démo, accès, exports, notes de version.

// Migrations livrées avec cette version de l'application (le SQL n'est chargé qu'à la demande)
const MIGRATION_FILES = import.meta.glob('../../../supabase/migrations/*.sql', { query: '?raw', import: 'default' })
const BUNDLED_MIGRATIONS = Object.keys(MIGRATION_FILES)
  .map((p) => ({ path: p, version: p.split('/').pop().replace(/\.sql$/, '') }))
  .sort((a, b) => a.version.localeCompare(b.version))

const CRONS = [
  { path: '/api/sync-sent-emails', schedule: 'Toutes les 30 min, 6h à 18h, lundi à vendredi', label: 'Synchronisation des emails envoyés' },
  { path: '/api/sync-google-calendar', schedule: 'Toutes les 2 h, 6h à 18h, lundi à samedi', label: 'Synchronisation Google Agenda' },
  { path: '/api/mailing-cron', schedule: 'Selon les campagnes', label: 'Envoi des campagnes email' },
  { path: '/api/mailing-replies-cron', schedule: 'Tous les jours à 5h', label: 'Réponses aux campagnes' },
  { path: '/api/social/cron-publish', schedule: 'Toutes les 5 min', label: 'Publication des posts programmés' },
  { path: '/api/signature-alert', schedule: 'Sur demande', label: 'Alertes de signature' },
]

const EXPORT_TABLES = ['clients', 'client_contacts', 'courses', 'trainers', 'trainees', 'sessions', 'session_trainees', 'attendance_halfdays', 'trainee_evaluations', 'evaluations_cold', 'quiz_attempts', 'quotes', 'quote_items', 'invoices', 'invoice_items', 'invoice_payments']

function Section({ icon: Icon, title, children, actions }) {
  return (
    <section className="card space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h2 className="section-title flex items-center gap-2"><Icon className="w-5 h-5 text-accent-500" /> {title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

export default function Console() {
  const navigate = useNavigate()
  const { userRole, refreshModules } = useAuthStore()
  const { organization, fetchOrganization, updateOrganization } = useDataStore()
  const { branding, refresh: refreshBranding } = useBranding()
  const [health, setHealth] = useState(null)
  const [healthError, setHealthError] = useState(null)
  const [applied, setApplied] = useState(null)
  const [counts, setCounts] = useState({})
  const [roles, setRoles] = useState([])
  const [openSql, setOpenSql] = useState({})
  const [sql, setSql] = useState({})
  const [exporting, setExporting] = useState(false)
  const [showChangelog, setShowChangelog] = useState(false)

  const isSuperadmin = userRole === 'superadmin'

  const load = async () => {
    fetchOrganization()
    const [{ data: migs }, { data: profiles }] = await Promise.all([
      supabase.from('schema_migrations').select('version, applied_at').order('version'),
      supabase.from('profiles').select('role, is_active'),
    ])
    setApplied(migs || [])
    const byRole = {}
    ;(profiles || []).forEach((p) => { if (p.is_active !== false) byRole[p.role] = (byRole[p.role] || 0) + 1 })
    setRoles(Object.entries(byRole))
    const c = {}
    for (const t of ['sessions', 'trainees', 'clients', 'invoices', 'quiz_attempts']) {
      const { count } = await supabase.from(t).select('*', { count: 'exact', head: true })
      c[t] = count ?? 0
    }
    setCounts(c)
    try {
      const h = await callApi('/api/health', {}, { method: 'GET' })
      if (!h || !Array.isArray(h.env)) throw new Error('réponse inattendue, fonctions serveur non déployées')
      setHealth(h)
      setHealthError(null)
    } catch (e) {
      setHealth(null)
      setHealthError(e.message)
    }
  }
  useEffect(() => { if (isSuperadmin) load() }, [isSuperadmin])

  const pending = useMemo(() => {
    if (!applied) return []
    const done = new Set(applied.map((m) => m.version))
    return BUNDLED_MIGRATIONS.filter((m) => !done.has(m.version))
  }, [applied])

  const showSql = async (m) => {
    if (!sql[m.version]) {
      const content = await MIGRATION_FILES[m.path]()
      setSql((s) => ({ ...s, [m.version]: content }))
    }
    setOpenSql((o) => ({ ...o, [m.version]: !o[m.version] }))
  }
  const copy = async (text, label = 'Copié') => {
    try { await navigator.clipboard.writeText(text); toast.success(label) } catch { toast.error('Copie impossible') }
  }

  const toggleDemo = async (v) => {
    const { error } = await updateOrganization({ demo_mode: v })
    if (error) return toast.error(error.message)
    toast.success(v ? 'Mode démonstration activé : les emails sont redirigés' : 'Mode démonstration désactivé')
  }

  const relaunchSetup = async () => {
    if (!confirm("Relancer l'assistant de configuration ? Les réglages actuels sont conservés et proposés à chaque étape.")) return
    const { error } = await updateOrganization({ setup_completed: false, setup_step: 0 })
    if (error) return toast.error(error.message)
    await refreshBranding()
    navigate('/setup')
  }

  const exportData = async () => {
    setExporting(true)
    try {
      const out = { exported_at: new Date().toISOString(), app_version: APP_VERSION, organization: organization?.name, tables: {} }
      for (const t of EXPORT_TABLES) {
        const rows = []
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.from(t).select('*').range(from, from + 999)
          if (error) { out.tables[t] = { error: error.message }; break }
          rows.push(...(data || []))
          if (!data || data.length < 1000) break
        }
        if (!out.tables[t]) out.tables[t] = rows
      }
      const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `export-${(organization?.app_short_name || 'instance').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      toast.success('Export téléchargé')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setExporting(false)
    }
  }

  if (!isSuperadmin) {
    return (
      <div className="card max-w-lg">
        <h1 className="section-title flex items-center gap-2"><Lock className="w-5 h-5" /> Console réservée au super administrateur</h1>
        <p className="muted mt-2">Les réglages de l'organisme sont dans <Link to="/parametres" className="text-accent-700 underline">Paramètres</Link>.</p>
      </div>
    )
  }

  const supabaseHost = (() => { try { return new URL(import.meta.env.VITE_SUPABASE_URL).host } catch { return '' } })()

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Console</h1>
          <p className="muted mt-1">État technique de l'instance, mises à jour et opérations réservées au super administrateur.</p>
        </div>
        <button type="button" onClick={load} className="btn btn-secondary"><RefreshCw className="w-4 h-4" /> Actualiser</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[['Version', APP_VERSION], ['Sessions', counts.sessions], ['Stagiaires', counts.trainees], ['Clients', counts.clients], ['Quiz joués', counts.quiz_attempts]].map(([k, v]) => (
          <div key={k} className="card"><div className="text-ui-sm muted">{k}</div><div className="font-display text-2xl font-bold text-gray-900">{v ?? '…'}</div></div>
        ))}
      </div>

      <Section icon={Activity} title="État de l'instance">
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-ui">
          <Row k="Base de données" v={supabaseHost || 'non configurée'} />
          <Row k="Configuration" v={branding.setup_completed ? 'terminée' : 'à terminer'} ok={branding.setup_completed} />
          <Row k="Migrations appliquées" v={applied ? `${applied.length} / ${BUNDLED_MIGRATIONS.length}` : '…'} ok={applied && pending.length === 0} />
          <Row k="Serveur (API)" v={health ? `${health.deployment ? `déploiement ${health.deployment}` : 'en ligne'}${health.deployed_branch ? `, branche ${health.deployed_branch}` : ''}${health.region ? `, région ${health.region}` : ''}` : healthError ? `indisponible (${healthError})` : '…'} ok={!!health} />
        </dl>
        {health && (
          <div>
            <div className="label">Variables d'environnement du serveur</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {health.env.map((e) => (
                <div key={e.key} className="flex items-center gap-2 text-ui">
                  {e.present ? <CheckCircle className="w-4 h-4 text-[rgb(var(--c-success))]" /> : <AlertTriangle className="w-4 h-4 text-[rgb(var(--c-warning))]" />}
                  <span className={e.present ? 'text-gray-900' : 'text-gray-500'}>{e.label}</span>
                  <code className="text-ui-sm text-gray-400 ml-auto">{e.key}</code>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section icon={Database} title="Mises à jour de la base" actions={pending.length > 0 ? <span className="badge badge-warning">{pending.length} à appliquer</span> : <span className="badge badge-success">À jour</span>}>
        <p className="muted text-ui">
          Chaque version de l'application embarque ses migrations. Quand une migration manque, copiez son SQL et exécutez-le dans l'éditeur SQL de Supabase, puis actualisez.
        </p>
        {pending.length > 0 && (
          <div className="space-y-2">
            {pending.map((m) => (
              <div key={m.version} className="rounded-ui border border-gray-200">
                <div className="flex items-center gap-3 p-3">
                  <AlertTriangle className="w-4 h-4 text-[rgb(var(--c-warning))]" />
                  <code className="text-ui font-medium flex-1">{m.version}</code>
                  <button type="button" onClick={() => showSql(m)} className="btn btn-ghost btn-sm">{openSql[m.version] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} SQL</button>
                  <button type="button" onClick={async () => { if (!sql[m.version]) { const c = await MIGRATION_FILES[m.path](); setSql((s) => ({ ...s, [m.version]: c })); copy(c, 'SQL copié') } else copy(sql[m.version], 'SQL copié') }} className="btn btn-secondary btn-sm"><Copy className="w-4 h-4" /> Copier</button>
                </div>
                {openSql[m.version] && <pre className="text-[12px] leading-relaxed bg-gray-900 text-gray-100 p-3 overflow-x-auto max-h-80 rounded-b-ui">{sql[m.version] || 'Chargement'}</pre>}
              </div>
            ))}
          </div>
        )}
        <details>
          <summary className="text-ui-sm text-gray-500 cursor-pointer">Historique des migrations appliquées</summary>
          <div className="mt-2 divide-y divide-gray-100">
            {(applied || []).map((m) => (
              <div key={m.version} className="flex items-center justify-between py-1.5 text-ui-sm"><code>{m.version}</code><span className="text-gray-400">{m.applied_at ? new Date(m.applied_at).toLocaleString('fr-FR') : ''}</span></div>
            ))}
          </div>
        </details>
      </Section>

      <Section icon={Layers} title="Modules">
        <ModulesSection compact onChanged={refreshModules} />
      </Section>

      <Section icon={Mail} title="Mode démonstration et emails">
        <Toggle checked={!!organization?.demo_mode} onChange={toggleDemo} label="Mode démonstration"
          hint={`Tous les emails sortants sont redirigés vers l'adresse MAIL_SINK du serveur${health ? (health.env.find((e) => e.key === 'MAIL_SINK')?.present ? ' (définie)' : ' (non définie : les envois seront refusés)') : ''}. Les destinataires réels ne reçoivent rien.`} />
        <div>
          <div className="label">Tâches planifiées</div>
          <div className="divide-y divide-gray-100">
            {CRONS.map((c) => (
              <div key={c.path} className="flex items-center gap-3 py-2 text-ui">
                <Clock className="w-4 h-4 text-gray-400 flex-none" />
                <div className="flex-1 min-w-0"><div className="font-medium text-gray-900">{c.label}</div><div className="text-ui-sm text-gray-500">{c.schedule}</div></div>
                <code className="text-ui-sm text-gray-400 hidden sm:block">{c.path}</code>
              </div>
            ))}
          </div>
          <p className="text-ui-sm text-gray-400 mt-2">Les tâches sont déclenchées par Vercel avec le secret CRON_SECRET. Un appel sans ce secret est refusé.</p>
        </div>
      </Section>

      <Section icon={Users} title="Accès" actions={<Link to="/parametres?section=utilisateurs" className="btn btn-secondary btn-sm">Gérer les utilisateurs</Link>}>
        <div className="flex flex-wrap gap-2">
          {roles.map(([r, n]) => <span key={r} className="badge badge-neutral">{r} : {n}</span>)}
          {roles.length === 0 && <span className="muted text-ui">Aucun profil</span>}
        </div>
        <div className="rounded-ui bg-gray-50 p-3 text-ui text-gray-700 flex gap-3">
          <Lock className="w-5 h-5 flex-none text-gray-500" />
          <div>
            <div className="font-medium text-gray-900">Évaluations verrouillées</div>
            Les évaluations à chaud, à froid et formateur ne peuvent être ni modifiées ni supprimées, sauf par un super administrateur. Les quiz terminés le sont aussi. Toute modification est tracée dans le <Link to="/audit-logs" className="text-accent-700 underline">journal d'audit</Link>.
          </div>
        </div>
      </Section>

      <Section icon={Download} title="Données" actions={<button type="button" onClick={exportData} disabled={exporting} className="btn btn-secondary btn-sm">{exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Exporter (JSON)</button>}>
        <p className="muted text-ui">Export complet des tables principales ({EXPORT_TABLES.length}) au format JSON, pour sauvegarde ou reprise. Les fichiers (PDF, signatures, logos) restent dans le stockage Supabase.</p>
      </Section>

      <DemoDataSection onPurged={load} />

      <Section icon={Sparkles} title="Assistant de configuration" actions={<button type="button" onClick={relaunchSetup} className="btn btn-secondary btn-sm">Relancer l'assistant</button>}>
        <p className="muted text-ui">Reparcourt les étapes (identité, contact, marque, modules, équipe) avec les valeurs actuelles. Utile après un changement de raison sociale, de locaux ou de marque.</p>
      </Section>

      <Section icon={FileText} title="Notes de version" actions={<button type="button" onClick={() => setShowChangelog((v) => !v)} className="btn btn-ghost btn-sm">{showChangelog ? 'Réduire' : 'Tout afficher'}</button>}>
        <div className="space-y-4">
          {(showChangelog ? CHANGELOG : CHANGELOG.slice(0, 1)).map((rel) => (
            <div key={rel.version}>
              <div className="flex items-baseline gap-3"><span className="font-display font-semibold text-gray-900">{rel.version}</span><span className="text-ui-sm text-gray-400">{rel.date}</span><span className="text-ui text-gray-600">{rel.title}</span></div>
              <ul className="mt-1.5 space-y-1 text-ui text-gray-700 list-disc pl-5">
                {rel.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

// Données fictives créées pour la démonstration : inventaire et effacement en un geste.
const DEMO_LABELS = {
  clients: 'clients', trainees: 'stagiaires', sessions: 'sessions', invoices: 'factures', quotes: 'devis',
  prospect_rdv: 'rendez-vous', trainers: 'formateurs', veille_qualiopi: 'veille',
}
const CONFIRM_WORD = 'EFFACER'

function DemoDataSection({ onPurged }) {
  const [summary, setSummary] = useState(null)
  const [confirmText, setConfirmText] = useState('')
  const [purging, setPurging] = useState(false)

  async function loadSummary() {
    const { data, error } = await supabase.rpc('demo_data_summary')
    setSummary(error ? {} : (data || {}))
  }
  useEffect(() => { loadSummary() }, [])

  async function purge() {
    if (confirmText.trim().toUpperCase() !== CONFIRM_WORD) return
    setPurging(true)
    try {
      const { data, error } = await supabase.rpc('purge_demo_data')
      if (error) throw error
      if (!data?.ok) throw new Error('Effacement non confirmé par la base')
      toast.success('Données de démonstration effacées')
      setConfirmText('')
      await loadSummary()
      onPurged?.()
    } catch (err) {
      toast.error('Effacement impossible : ' + (err.message || 'erreur inconnue'))
    } finally {
      setPurging(false)
    }
  }

  const entries = Object.entries(summary || {}).filter(([, n]) => n > 0)
  const total = entries.reduce((s, [, n]) => s + n, 0)

  return (
    <Section icon={Database} title="Données de démonstration">
      {summary === null ? (
        <p className="muted text-ui">Chargement</p>
      ) : total === 0 ? (
        <p className="muted text-ui">Aucune donnée de démonstration : l'instance ne contient que des données réelles.</p>
      ) : (
        <>
          <p className="muted text-ui">
            Ces enregistrements sont fictifs (entreprises, personnes et montants inventés). Les effacer supprime aussi tout ce qui en dépend
            (émargements, évaluations, certificats, lignes de facture, paiements). Le catalogue, les questions, les modèles, les paramètres et les
            données réelles ne sont pas touchés.
          </p>
          <div className="flex flex-wrap gap-2">
            {entries.map(([k, n]) => <span key={k} className="badge badge-neutral">{n} {DEMO_LABELS[k] || k}</span>)}
          </div>
          <div className="rounded-ui border border-gray-200 p-3 space-y-2">
            <label className="label" htmlFor="demo-confirm">Pour effacer, tapez {CONFIRM_WORD}</label>
            <div className="flex flex-wrap gap-2">
              <input id="demo-confirm" className="input max-w-xs" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={CONFIRM_WORD} autoComplete="off" />
              <button type="button" onClick={purge} disabled={purging || confirmText.trim().toUpperCase() !== CONFIRM_WORD} className="btn btn-danger">
                {purging ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Effacer les données de démonstration
              </button>
            </div>
            <p className="text-ui-sm text-gray-400">Définitif. Une sauvegarde est faite chaque nuit ; pour être prudent, lancez-en une juste avant.</p>
          </div>
        </>
      )}
    </Section>
  )
}

function Row({ k, v, ok }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-gray-100 py-1.5">
      <dt className="text-gray-500">{k}</dt>
      <dd className="font-medium text-gray-900 text-right flex items-center gap-1.5">
        {ok === true && <CheckCircle className="w-4 h-4 text-[rgb(var(--c-success))]" />}
        {ok === false && <AlertTriangle className="w-4 h-4 text-[rgb(var(--c-warning))]" />}
        {v}
      </dd>
    </div>
  )
}

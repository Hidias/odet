import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, ArrowLeft, Bug, CheckCircle, Copy, EyeOff, Loader2, Lock, RefreshCw, RotateCcw, X } from 'lucide-react'
import { useAuthStore } from '../store'
import { supabase } from '../supabase'

// Console > Erreurs : erreurs de l'application regroupées par empreinte (table error_logs),
// remontées par le navigateur, les portails publics et les routes /api. Réservé au super administrateur.

const SOURCES = { app: 'Application', portail: 'Portail stagiaire', entreprise: 'Espace entreprise', api: 'Serveur' }
const STATUTS = [
  { key: 'open', label: 'À traiter' },
  { key: 'resolved', label: 'Traitées' },
  { key: 'ignored', label: 'Ignorées' },
  { key: 'all', label: 'Toutes' },
]
const PERIODES = [
  { key: '1', label: '24 heures' },
  { key: '7', label: '7 derniers jours' },
  { key: '30', label: '30 jours' },
  { key: '90', label: '90 jours' },
]
const DAY = 86400000

function ilYa(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  if (min < 24 * 60) return `il y a ${Math.round(min / 60)} h`
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const dateHeure = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

function navigateur(ua) {
  if (!ua) return ''
  const appareil = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''
  const nav = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /node/i.test(ua) ? 'Serveur' : 'Navigateur'
  return [nav, appareil].filter(Boolean).join(' · ')
}

function etat(e) {
  if (e.status === 'resolved') return { label: 'Traitée', cls: 'badge-success', stripe: 'var(--c-success)' }
  if (e.status === 'ignored') return { label: 'Ignorée', cls: 'badge-neutral', stripe: 'var(--c-primary-300)' }
  if (Date.now() - new Date(e.first_seen).getTime() < DAY) return { label: 'Nouvelle', cls: 'badge-danger', stripe: 'var(--c-danger)' }
  return { label: 'À traiter', cls: 'badge-warning', stripe: 'var(--c-warning)' }
}

function texteClaude(e) {
  return [
    `Erreur odet (${SOURCES[e.source] || e.source}), ${e.occurrences} occurrence(s), ${(e.users || []).length} personne(s)`,
    `Message : ${e.message}`,
    `Page : ${e.page || 'inconnue'}`,
    `Version : ${e.app_version || 'inconnue'} · Navigateur : ${navigateur(e.user_agent) || 'inconnu'}`,
    `Première fois : ${dateHeure(e.first_seen)} · Dernière fois : ${dateHeure(e.last_seen)}`,
    '',
    'Pile :',
    e.stack || '(aucune)',
  ].join('\n')
}

function Detail({ e, onClose, onStatus, busy }) {
  const st = etat(e)
  const copier = async () => {
    try { await navigator.clipboard.writeText(texteClaude(e)); toast.success('Copié') } catch { toast.error('Copie impossible') }
  }
  return (
    <div className="fixed inset-0 z-40 overflow-auto p-4 bg-gray-50 md:static md:z-auto md:overflow-visible md:p-0 md:bg-transparent">
      <div className="card space-y-3" style={{ borderColor: 'rgb(var(--c-highlight-200))', background: 'rgb(var(--c-highlight-50))' }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap"><span className={`badge ${st.cls}`}>{st.label}</span><span className="text-ui-sm muted">{SOURCES[e.source] || e.source}</span></div>
            <div className="font-semibold text-gray-900 mt-1 break-words">{e.message}</div>
            <div className="text-ui-sm muted">Empreinte {e.fingerprint.slice(0, 8)} · première fois le {dateHeure(e.first_seen)}</div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm md:hidden" aria-label="Fermer"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex flex-wrap gap-2">
          {e.status === 'open'
            ? <button type="button" disabled={busy} onClick={() => onStatus(e, 'resolved')} className="btn btn-primary btn-sm"><CheckCircle className="w-4 h-4" /> Marquer comme traitée</button>
            : <button type="button" disabled={busy} onClick={() => onStatus(e, 'open')} className="btn btn-secondary btn-sm"><RotateCcw className="w-4 h-4" /> Rouvrir</button>}
          {e.status !== 'ignored' && <button type="button" disabled={busy} onClick={() => onStatus(e, 'ignored')} className="btn btn-secondary btn-sm"><EyeOff className="w-4 h-4" /> Ignorer</button>}
          <button type="button" onClick={copier} className="btn btn-secondary btn-sm"><Copy className="w-4 h-4" /> Copier pour Claude</button>
        </div>
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-ui">
          <div className="min-w-0"><dt className="text-ui-sm muted">Page</dt><dd className="font-medium break-words">{e.page || '-'}</dd></div>
          <div><dt className="text-ui-sm muted">Version</dt><dd className="font-medium">{e.app_version || '-'}</dd></div>
          <div><dt className="text-ui-sm muted">Navigateur</dt><dd className="font-medium">{navigateur(e.user_agent) || '-'}</dd></div>
          <div className="min-w-0"><dt className="text-ui-sm muted">Personnes ({(e.users || []).length})</dt><dd className="font-medium break-words">{(e.users || []).join(', ') || 'non connectées'}</dd></div>
        </dl>
        {e.stack && <pre className="text-[12px] leading-relaxed bg-gray-900 text-gray-100 p-3 overflow-x-auto max-h-72 rounded-ui">{e.stack}</pre>}
        {(e.recent || []).length > 0 && (
          <div>
            <div className="label">Dernières occurrences ({e.occurrences} au total)</div>
            <div className="divide-y divide-gray-100">
              {e.recent.map((r, i) => (
                <div key={i} className="flex flex-wrap gap-x-3 gap-y-0.5 py-1.5 text-ui-sm">
                  <span className="text-gray-900 tabular-nums">{dateHeure(r.at)}</span>
                  {r.page && <span className="muted break-all">{r.page}</span>}
                  {r.user && <span className="muted">{r.user}</span>}
                  {r.version && <span className="muted">v{r.version}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="text-ui-sm muted">« Ignorer » masque ce groupe sans le supprimer ; il réapparaît si l'erreur revient dans une nouvelle version. Une erreur traitée qui revient est rouverte automatiquement.</p>
      </div>
    </div>
  )
}

export default function ConsoleErreurs() {
  const { userRole, user } = useAuthStore()
  const isSuperadmin = userRole === 'superadmin'
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [statut, setStatut] = useState('open')
  const [source, setSource] = useState('')
  const [periode, setPeriode] = useState('30')
  const [version, setVersion] = useState('')
  const [q, setQ] = useState('')
  const [selId, setSelId] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setError(null)
    const { data, error: e } = await supabase.from('error_logs').select('*').order('last_seen', { ascending: false }).limit(500)
    if (e) { setError(e.message); setRows([]); return }
    setRows(data || [])
  }
  useEffect(() => { if (isSuperadmin) load() }, [isSuperadmin])

  const tiles = useMemo(() => {
    const r = rows || []
    const now = Date.now()
    return [
      ['Nouvelles (24 h)', r.filter((e) => e.status === 'open' && now - new Date(e.first_seen).getTime() < DAY).length, true],
      ['À traiter', r.filter((e) => e.status === 'open').length],
      ['Traitées (30 j)', r.filter((e) => e.status === 'resolved' && e.resolved_at && now - new Date(e.resolved_at).getTime() < 30 * DAY).length],
      ['Ignorées', r.filter((e) => e.status === 'ignored').length],
    ]
  }, [rows])

  const versions = useMemo(() => [...new Set((rows || []).map((e) => e.app_version).filter(Boolean))].sort().reverse(), [rows])

  const list = useMemo(() => {
    const since = Date.now() - Number(periode) * DAY
    const needle = q.trim().toLowerCase()
    return (rows || []).filter((e) =>
      (statut === 'all' || e.status === statut)
      && (!source || e.source === source)
      && (!version || e.app_version === version)
      && new Date(e.last_seen).getTime() >= since
      && (!needle || [e.message, e.page, ...(e.users || [])].some((v) => String(v || '').toLowerCase().includes(needle))))
  }, [rows, statut, source, periode, version, q])

  const selected = (rows || []).find((e) => e.id === selId) || null

  async function setStatus(e, status) {
    setBusy(true)
    const patch = status === 'resolved'
      ? { status, resolved_at: new Date().toISOString(), resolved_by: user?.email || null }
      : { status, resolved_at: null, resolved_by: null }
    const { error: err } = await supabase.from('error_logs').update(patch).eq('id', e.id)
    setBusy(false)
    if (err) { toast.error(err.message); return }
    setRows((rs) => rs.map((r) => (r.id === e.id ? { ...r, ...patch } : r)))
    toast.success(status === 'resolved' ? 'Marquée comme traitée' : status === 'ignored' ? 'Ignorée' : 'Rouverte')
  }

  if (!isSuperadmin) {
    return (
      <div className="card max-w-lg">
        <h1 className="section-title flex items-center gap-2"><Lock className="w-5 h-5" /> Réservé au super administrateur</h1>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link to="/console" className="text-ui-sm muted inline-flex items-center gap-1 hover:underline"><ArrowLeft className="w-3.5 h-3.5" /> Console</Link>
          <h1 className="page-title mt-1">Erreurs de l'application</h1>
          <p className="muted mt-1">Remontées automatiquement depuis l'application, les portails publics et le serveur. Conservées 90 jours.</p>
        </div>
        <button type="button" onClick={load} className="btn btn-secondary"><RefreshCw className="w-4 h-4" /> Actualiser</button>
      </div>

      {error && (
        <div className="card flex gap-2 items-start text-ui" style={{ background: 'rgb(var(--c-warning-bg))', color: 'rgb(var(--c-warning))' }}>
          <AlertTriangle className="w-5 h-5 flex-none" />
          <div>Lecture impossible ({error}). La mise à jour de la base 0070_suivi_erreurs est-elle appliquée ? Voir Console › Mises à jour de la base.</div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map(([k, v, alert]) => (
          <div key={k} className="card" style={alert && v > 0 ? { background: 'rgb(var(--c-accent-50))', borderColor: 'rgb(var(--c-accent-200))' } : undefined}>
            <div className="text-ui-sm muted">{k}</div>
            <div className="font-display text-2xl font-bold tabular-nums" style={alert && v > 0 ? { color: 'rgb(var(--c-accent-600))' } : undefined}>{rows ? v : '…'}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1.5 overflow-x-auto max-w-full pb-0.5">
          {STATUTS.map((s) => (
            <button key={s.key} type="button" onClick={() => setStatut(s.key)} className={`btn btn-sm ${statut === s.key ? 'btn-primary' : 'btn-secondary'}`}>{s.label}</button>
          ))}
        </div>
        <select id="err-source" aria-label="Origine" className="input w-auto" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Toutes origines</option>
          {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select id="err-periode" aria-label="Période" className="input w-auto" value={periode} onChange={(e) => setPeriode(e.target.value)}>
          {PERIODES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <select id="err-version" aria-label="Version" className="input w-auto" value={version} onChange={(e) => setVersion(e.target.value)}>
          <option value="">Toutes versions</option>
          {versions.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <input id="err-recherche" type="search" aria-label="Recherche" className="input flex-1 min-w-[12rem]" placeholder="Rechercher un message, une page, une personne" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {rows === null ? (
        <div className="card flex items-center gap-2 muted"><Loader2 className="w-4 h-4 animate-spin" /> Chargement</div>
      ) : list.length === 0 ? (
        <div className="card text-center py-10">
          <Bug className="w-8 h-8 mx-auto text-gray-300" />
          <div className="font-medium text-gray-900 mt-2">Aucune erreur pour ces filtres</div>
          <div className="text-ui-sm muted mt-1">Les erreurs apparaissent ici dès qu'une personne en rencontre une.</div>
        </div>
      ) : (
        <>
          {/* Ordinateur : tableau */}
          <div className="hidden md:block card card-flush overflow-x-auto">
            <table className="w-full text-ui">
              <thead>
                <tr className="text-left text-ui-sm muted border-b border-gray-200">
                  <th className="w-1 p-0" />
                  <th className="px-3 py-2 font-medium">Erreur</th>
                  <th className="px-3 py-2 font-medium">Origine</th>
                  <th className="px-3 py-2 font-medium text-right">Occur.</th>
                  <th className="px-3 py-2 font-medium text-right">Pers.</th>
                  <th className="px-3 py-2 font-medium">Dernière fois</th>
                  <th className="px-3 py-2 font-medium">État</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {list.map((e) => {
                  const st = etat(e)
                  return (
                    <tr key={e.id} onClick={() => setSelId(e.id === selId ? null : e.id)} className="border-b border-gray-100 last:border-0 cursor-pointer hover:bg-gray-50" style={e.id === selId ? { background: 'rgb(var(--c-highlight-50))' } : undefined}>
                      <td className="p-0 w-1"><div className="w-1 h-12" style={{ background: `rgb(${st.stripe})` }} /></td>
                      <td className="px-3 py-2.5 max-w-0 w-1/2">
                        <div className="font-medium text-gray-900 truncate">{e.message}</div>
                        <div className="text-ui-sm muted truncate">{e.page || '-'}</div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap"><span className="badge badge-neutral">{SOURCES[e.source] || e.source}</span></td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{e.occurrences}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{(e.users || []).length}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{ilYa(e.last_seen)}</td>
                      <td className="px-3 py-2.5"><span className={`badge ${st.cls}`}>{st.label}</span></td>
                      <td className="px-3 py-2.5 text-right">
                        {e.status === 'open' && <button type="button" disabled={busy} onClick={(ev) => { ev.stopPropagation(); setStatus(e, 'resolved') }} className="btn btn-secondary btn-sm">Traitée</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Téléphone : cartes */}
          <div className="md:hidden space-y-2.5">
            {list.map((e) => {
              const st = etat(e)
              return (
                <div key={e.id} className="card space-y-1.5" style={{ borderLeft: `4px solid rgb(${st.stripe})` }}>
                  <div className="flex items-center justify-between gap-2"><span className={`badge ${st.cls}`}>{st.label}</span><span className="text-ui-sm muted">{ilYa(e.last_seen)}</span></div>
                  <div className="font-medium text-gray-900 break-words">{e.message}</div>
                  <div className="text-ui-sm muted flex flex-wrap gap-x-3">
                    <span>{SOURCES[e.source] || e.source}</span>
                    {e.page && <span className="break-all">{e.page}</span>}
                    <span>{e.occurrences} fois · {(e.users || []).length} pers.</span>
                  </div>
                  <div className="flex gap-2 pt-1">
                    {e.status === 'open' && <button type="button" disabled={busy} onClick={() => setStatus(e, 'resolved')} className="btn btn-primary btn-sm">Traitée</button>}
                    <button type="button" onClick={() => setSelId(e.id)} className="btn btn-secondary btn-sm">Détail</button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {selected && <Detail e={selected} busy={busy} onClose={() => setSelId(null)} onStatus={setStatus} />}
    </div>
  )
}

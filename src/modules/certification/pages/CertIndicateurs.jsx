// Tableau des indicateurs du référentiel : preuves trouvées dans la base, ce qui manque,
// preuves ajoutées à la main, non applicable avec justification.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Plus, Trash2, Upload, Check, X } from 'lucide-react'
import { IndicatorTile, StatusBadge } from '../components/ui'
import { STATUS_LABEL } from '../lib/proofs'
import { addProof, removeProof, saveIndicatorStatus, saveSettings, signedUrl } from '../lib/certData'

const FILTERS = [
  ['tous', 'Tous'], ['a_traiter', 'À traiter'], ['modifies', 'Modifiés en 2026'], ['na', 'Non applicables'],
]

function ProofForm({ number, onDone }) {
  const [p, setP] = useState({ label: '', note: '', url: '', file: null })
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!p.label.trim()) return toast.error('Donner un titre à la preuve')
    if (!p.file && !p.url.trim() && !p.note.trim()) return toast.error('Joindre un fichier, un lien ou une explication')
    setBusy(true)
    try { await addProof(number, { ...p, label: p.label.trim(), url: p.url.trim() }); onDone(true) } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  return (
    <div className="space-y-2 border border-gray-200 rounded-ui-sm p-3">
      <label className="block"><span className="label">Titre</span><input className="input" value={p.label} onChange={(e) => setP({ ...p, label: e.target.value })} placeholder="Ex. : questionnaire donneur d'ordre retourné" /></label>
      <label className="block"><span className="label">Pour l'auditeur</span><textarea className="textarea" rows={2} value={p.note} onChange={(e) => setP({ ...p, note: e.target.value })} /></label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block"><span className="label">Lien</span><input className="input" type="url" value={p.url} onChange={(e) => setP({ ...p, url: e.target.value })} placeholder="https://" /></label>
        <label className="block"><span className="label">Fichier</span><input className="input" type="file" onChange={(e) => setP({ ...p, file: e.target.files?.[0] || null })} /></label>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn btn-ghost" onClick={() => onDone(false)}>Annuler</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}Ajouter</button>
      </div>
    </div>
  )
}

function Detail({ ind, refCode, canWrite, onChanged, onBack }) {
  const [adding, setAdding] = useState(false)
  const [na, setNa] = useState({ on: ind.status === 'non_applicable', reason: ind.naReason || '' })
  useEffect(() => { setNa({ on: ind.status === 'non_applicable', reason: ind.naReason || '' }); setAdding(false) }, [ind.number, ind.status, ind.naReason])

  const saveNa = async (on, reason) => {
    if (on && !String(reason || '').trim()) return toast.error('Une justification est obligatoire')
    try { await saveIndicatorStatus(refCode, ind.number, { not_applicable: on, na_justification: on ? reason.trim() : null }); onChanged() } catch (e) { toast.error(e.message) }
  }
  const resetNa = async () => {
    try { await saveIndicatorStatus(refCode, ind.number, { not_applicable: null, na_justification: null }); onChanged() } catch (e) { toast.error(e.message) }
  }
  const openProof = async (p) => {
    try { window.open(p.file_path ? await signedUrl(p.file_path) : p.url, '_blank', 'noopener') } catch (e) { toast.error(e.message) }
  }
  const delProof = async (p) => {
    if (!window.confirm(`Retirer la preuve « ${p.label} » ?`)) return
    try { await removeProof(p); onChanged() } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="space-y-4">
      {onBack && <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={onBack}><ChevronLeft className="w-4 h-4" />Indicateurs</button>}
      <div className="flex flex-wrap gap-2">
        <span className="badge badge-neutral">Critère {ind.criterion}</span>
        {ind.change_kind === 'modifie' && <span className="badge badge-warning">Modifié en 2026</span>}
        {ind.change_kind === 'nouveau' && <span className="badge badge-warning">Nouveau en 2026</span>}
        <StatusBadge status={ind.status} />
      </div>
      <h2 className="section-title text-lg">Indicateur {ind.number} : {ind.short_title}</h2>
      <p className="text-ui text-gray-700 leading-relaxed">{ind.text}</p>
      {ind.change_note && <p className="text-ui-sm muted">Changement 2026 : {ind.change_note}</p>}
      {(ind.major_only || ind.new_entrant_light) && (
        <ul className="text-ui-sm muted space-y-1">
          {ind.major_only && <li>Un écart sur cet indicateur ne peut donner lieu qu'à une non-conformité majeure.</li>}
          {ind.new_entrant_light && <li>Nouvel entrant : la formalisation suffit à l'audit initial, la mise en oeuvre est vérifiée à la surveillance.</li>}
        </ul>
      )}

      {ind.status === 'non_applicable' ? (
        <div className="rounded-ui-sm bg-gray-50 p-3 text-ui-sm space-y-2">
          <div className="font-semibold">Non applicable</div>
          <div>{ind.naReason}</div>
          {canWrite && !ind.naAuto && <button type="button" className="btn btn-secondary btn-sm" onClick={resetNa}>Revenir à la règle automatique</button>}
          {canWrite && ind.naAuto && <button type="button" className="btn btn-secondary btn-sm" onClick={() => saveNa(false, '')}>Rendre applicable</button>}
        </div>
      ) : (
        <>
          <div>
            <div className="text-ui-sm font-semibold text-gray-500 mb-1">TROUVÉ DANS LA BASE</div>
            {!ind.items.length && <p className="text-ui-sm muted">Rien ne se calcule pour cet indicateur : preuves à ajouter à la main.</p>}
            {ind.items.map((it, i) => (
              <div key={i} className="flex items-start gap-3 py-2 border-b border-gray-100 text-ui">
                {it.ok ? <Check className="w-4 h-4 mt-0.5 text-[rgb(var(--c-success))] flex-none" /> : <X className="w-4 h-4 mt-0.5 text-accent-600 flex-none" />}
                <span className="flex-1">{it.label}</span>
                {it.link && <Link to={it.link} className="text-ui-sm font-semibold flex-none">Ouvrir</Link>}
              </div>
            ))}
          </div>
          {ind.missing.length > 0 && (
            <div className="rounded-ui-sm border border-[rgb(var(--c-warning)/0.3)] bg-[rgb(var(--c-warning-bg))] p-3 text-ui-sm space-y-1">
              <div className="font-semibold">À préciser</div>
              {ind.missing.map((m, i) => <div key={i}>{m}</div>)}
              <div className="muted">Une preuve ajoutée ci-dessous lève ces points.</div>
            </div>
          )}
        </>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-ui-sm font-semibold text-gray-500">PREUVES AJOUTÉES À LA MAIN</span>
          {canWrite && !adding && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}><Plus className="w-4 h-4" />Ajouter une preuve</button>}
        </div>
        {!ind.manual.length && !adding && <p className="text-ui-sm muted">Aucune. Un fichier ou un lien, avec une phrase pour l'auditeur.</p>}
        {ind.manual.map((p) => (
          <div key={p.id} className="flex items-start gap-2 text-ui py-1">
            <div className="flex-1 min-w-0">
              <button type="button" className="font-semibold underline text-left" onClick={() => openProof(p)} disabled={!p.file_path && !p.url}>{p.label}</button>
              {p.note && <div className="text-ui-sm muted">{p.note}</div>}
            </div>
            {(p.file_path || p.url) && <ExternalLink className="w-4 h-4 text-gray-400 mt-1" />}
            {canWrite && <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Retirer ${p.label}`} onClick={() => delProof(p)}><Trash2 className="w-4 h-4" /></button>}
          </div>
        ))}
        {adding && <ProofForm number={ind.number} onDone={(changed) => { setAdding(false); if (changed) onChanged() }} />}
      </div>

      {canWrite && ind.status !== 'non_applicable' && (
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <label className="flex items-center gap-2 text-ui min-h-[44px]">
            <input type="checkbox" className="w-4 h-4" checked={na.on} onChange={(e) => setNa({ ...na, on: e.target.checked })} />Non applicable
          </label>
          {na.on && (
            <div className="space-y-2">
              <textarea className="textarea" rows={2} placeholder="Justification pour l'auditeur" value={na.reason} onChange={(e) => setNa({ ...na, reason: e.target.value })} />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => saveNa(true, na.reason)}>Enregistrer</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function CertIndicateurs({ referential: refData, evaluated, settings, canWrite, reloadIndicators, reloadSettings }) {
  const { num } = useParams()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('tous')
  const [crit, setCrit] = useState(null)
  const [wide, setWide] = useState(typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const h = () => setWide(mq.matches)
    mq.addEventListener?.('change', h)
    return () => mq.removeEventListener?.('change', h)
  }, [])

  const list = evaluated || []
  const counts = useMemo(() => ({
    preuves: list.filter((i) => i.status === 'preuves').length,
    a_completer: list.filter((i) => i.status === 'a_completer').length,
    manquant: list.filter((i) => i.status === 'manquant').length,
    non_applicable: list.filter((i) => i.status === 'non_applicable').length,
  }), [list])
  const applicable = list.length - counts.non_applicable

  if (!evaluated || !refData) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>

  const shown = list.filter((i) => {
    if (crit && i.criterion !== crit) return false
    if (filter === 'a_traiter') return i.status === 'a_completer' || i.status === 'manquant'
    if (filter === 'modifies') return i.change_kind === 'modifie' || i.change_kind === 'nouveau'
    if (filter === 'na') return i.status === 'non_applicable'
    return true
  })
  const selected = num ? list.find((i) => i.number === Number(num)) : (wide ? (shown[0] || list[0]) : null)
  const go = (n) => navigate(`/certification/indicateurs/${n}`)
  const changeRef = async (code) => {
    try { await saveSettings({ referential_code: code }); await reloadSettings(); await reloadIndicators(code) } catch (e) { toast.error(e.message) }
  }
  const onChanged = () => reloadIndicators(refData.code)

  // Téléphone : l'indicateur choisi occupe tout l'écran
  if (!wide && selected) {
    return <div className="card"><Detail ind={selected} refCode={refData.code} canWrite={canWrite} onChanged={onChanged} onBack={() => navigate('/certification/indicateurs')} /></div>
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <div className="flex flex-wrap items-end gap-4 justify-between">
          <div>
            <div className="font-display font-semibold text-2xl">{counts.preuves} / {applicable}</div>
            <div className="muted text-ui-sm">indicateurs prouvés</div>
          </div>
          <label className="block min-w-[260px]"><span className="label">Référentiel</span>
            <select className="select" value={refData.code} disabled={!canWrite} onChange={(e) => changeRef(e.target.value)}>
              {refData.referentials.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="Statut des indicateurs">
          {list.map((i, k) => (
            <span key={i.number} className={`inline-flex ${k > 0 && list[k - 1].criterion !== i.criterion ? 'ml-2' : ''}`}>
              <IndicatorTile ind={i} active={selected?.number === i.number} onClick={() => go(i.number)} />
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 text-ui-sm muted">
          {Object.entries(counts).map(([k, n]) => <span key={k}>{STATUS_LABEL[k]} : {n}</span>)}
        </div>
        {refData.referentials.find((r) => r.code === refData.code)?.notes && <p className="text-ui-sm muted">{refData.referentials.find((r) => r.code === refData.code).notes}</p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] items-start">
        <section className="card card-flush">
          <div className="flex flex-wrap gap-1.5 p-3 border-b border-gray-100">
            {FILTERS.map(([k, l]) => <button key={k} type="button" className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(k)}>{l}</button>)}
            <select className="select !w-auto btn-sm" aria-label="Critère" value={crit || ''} onChange={(e) => setCrit(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Tous les critères</option>
              {refData.criteria.map((c) => <option key={c.number} value={c.number}>Critère {c.number}</option>)}
            </select>
          </div>
          {refData.criteria.filter((c) => shown.some((i) => i.criterion === c.number)).map((c) => (
            <div key={c.number}>
              <div className="px-4 pt-3 pb-1 text-ui-sm font-semibold text-gray-500 uppercase">Critère {c.number} : {c.title}</div>
              {shown.filter((i) => i.criterion === c.number).map((i) => (
                <button key={i.number} type="button" onClick={() => go(i.number)}
                  className={`w-full text-left flex items-center gap-3 min-h-[52px] px-4 py-2 border-b border-gray-100 hover:bg-gray-50 ${selected?.number === i.number ? 'bg-gray-50' : ''}`}>
                  <IndicatorTile ind={i} />
                  <span className="flex-1 min-w-0">
                    <span className={`block text-ui font-semibold ${i.status === 'non_applicable' ? 'text-gray-500' : ''}`}>{i.short_title}</span>
                    {(i.change_kind === 'modifie' || i.change_kind === 'nouveau') && <span className="block text-ui-sm muted">{i.change_kind === 'nouveau' ? 'Nouveau en 2026' : 'Modifié en 2026'}</span>}
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-400 flex-none" />
                </button>
              ))}
            </div>
          ))}
          {!shown.length && <p className="p-4 muted text-ui-sm">Aucun indicateur pour ce filtre.</p>}
        </section>
        {wide && selected && <section className="card"><Detail ind={selected} refCode={refData.code} canWrite={canWrite} onChanged={onChanged} /></section>}
      </div>
      {settings?.referential_code === 'rnq-2019' && <p className="muted text-ui-sm">Le référentiel 2019 ne s'applique qu'aux audits réalisés jusqu'au 31 octobre 2026.</p>}
    </div>
  )
}

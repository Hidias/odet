// Visite sur téléphone : contrôle des appareils du site, puis clôture (pièces, photos, observations,
// signature du client) et rapport PDF. Chaque geste est enregistré tout de suite.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronLeft, Loader2, Camera, Plus, Minus, Check, FileDown, Share2, Receipt, FileText, Trash2, PenLine, Play, ListChecks } from 'lucide-react'
import FullscreenSignaturePad from '../../../ui/signature/FullscreenSignaturePad'
import { profileName } from '../../../core/org/currentOrg'
import { supabase } from '../../../core/supabase'
import {
  loadVisit, loadEquipmentForSite, loadVisitItems, loadVisitParts, loadDoneOperations, startVisit, saveVisitItem,
  addVisitItem, addVisitPart, updateVisitPart, removeVisitPart, updateVisit, closeVisit, uploadPhoto, shrinkImage,
  saveEquipment, photoUrl, createInvoiceDraft, createReplacementQuote, loadPrimaryContact,
} from '../lib/itvData'
import { RESULTS, suggestedOperation, summarize, frShort } from '../lib/schedule'
import { ResultBadge, VisitBadge, ScanButton, Sheet, Kpi } from '../components/ui'
import { buildRapportPDF } from '../pdf/rapportPDF'

const MAIN = RESULTS.slice(0, 3)
const OTHER = RESULTS.slice(3)

export default function Visite({ settings, types, parts: catalog, technicians, isManager, canWrite }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [visit, setVisit] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [items, setItems] = useState([])
  const [parts, setParts] = useState([])
  const [step, setStep] = useState('controle')
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [signing, setSigning] = useState(false)
  const [photoUrls, setPhotoUrls] = useState({})
  const [highlight, setHighlight] = useState(null)
  const fileRef = useRef(null)
  const itemFileRef = useRef(null)
  const [photoTarget, setPhotoTarget] = useState(null)
  const [freePart, setFreePart] = useState(null)
  const [confirmRest, setConfirmRest] = useState(false)
  const [noSignOk, setNoSignOk] = useState(false)

  const typesById = useMemo(() => Object.fromEntries((types || []).map((t) => [t.id, t])), [types])
  const equipmentById = useMemo(() => Object.fromEntries(equipment.map((e) => [e.id, e])), [equipment])
  const technician = technicians.find((t) => t.id === visit?.technician_id)
  const readOnly = !canWrite || visit?.status === 'terminee' || visit?.status === 'annulee'
  const started = visit?.status === 'en_cours' || visit?.status === 'terminee'

  const load = async () => {
    const v = await loadVisit(id)
    const eq = await loadEquipmentForSite(v.site_id)
    const [its, ps] = await Promise.all([loadVisitItems(id), loadVisitParts(id)])
    setVisit(v); setEquipment(eq || []); setItems(its || []); setParts(ps || [])
    if (v.status === 'terminee') setStep('termine')
    if (!v.signer_name && v.status !== 'terminee') {
      const c = await loadPrimaryContact(v.client_id)
      if (c) setVisit((x) => ({ ...x, signer_name: [c.name || [c.first_name, c.last_name].filter(Boolean).join(' '), c.fonction || c.role].filter(Boolean).join(', ') }))
    }
  }
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Photos de la visite : liens signés pour l'affichage
  useEffect(() => {
    const paths = [...(visit?.photos || []), ...items.map((i) => i.photo_path).filter(Boolean)]
    const missing = paths.filter((p) => !photoUrls[p])
    if (!missing.length) return
    Promise.all(missing.map(async (p) => [p, await photoUrl(p)])).then((rows) => setPhotoUrls((u) => ({ ...u, ...Object.fromEntries(rows) })))
  }, [visit?.photos, items]) // eslint-disable-line react-hooks/exhaustive-deps

  const begin = async () => {
    setBusy(true)
    try {
      const done = await loadDoneOperations(equipment.map((e) => e.id))
      const year = new Date().getFullYear()
      const withOps = equipment.map((e) => ({ ...e, suggested: suggestedOperation(typesById[e.type_id], e, year, done[e.id] || []) }))
      const its = await startVisit(visit, withOps)
      setItems(its)
      const nv = await loadVisit(id)
      setVisit((x) => ({ ...nv, signer_name: nv.signer_name || x?.signer_name || null }))
      toast.success('Visite démarrée, heure d\'arrivée notée')
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const patchItem = async (item, patch) => {
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, ...patch } : i)))
    try { await saveVisitItem(item.id, patch) } catch (e) { toast.error(`Non enregistré : ${e.message}`); load() }
  }

  const restConforme = async () => {
    const rest = items.filter((i) => !i.result)
    if (!rest.length) return
    if (!confirmRest) { setConfirmRest(true); return }
    setConfirmRest(false)
    setItems((list) => list.map((i) => (i.result ? i : { ...i, result: 'conforme' })))
    try {
      const now = new Date().toISOString()
      const { error } = await supabase.from('itv_visit_items').update({ result: 'conforme', checked_at: now }).in('id', rest.map((i) => i.id))
      if (error) throw error
      toast.success(`${rest.length} appareils conformes`)
    } catch (e) { toast.error(e.message); load() }
  }

  const onScan = (code) => {
    const e = equipment.find((x) => x.label_code.toUpperCase() === code)
    if (!e) { navigate(`/interventions/appareil/${encodeURIComponent(code)}`); return }
    setFilter('all')
    setHighlight(e.id)
    setTimeout(() => document.getElementById(`itv-eq-${e.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
  }

  const takePhoto = async (file, target) => {
    if (!file) return
    setBusy(true)
    try {
      const path = await uploadPhoto(visit.id, await shrinkImage(file))
      if (target === 'visit') {
        const photos = [...(visit.photos || []), path]
        await updateVisit(visit.id, { photos })
        setVisit((v) => ({ ...v, photos }))
      } else {
        await patchItem(target, { photo_path: path })
      }
    } catch (e) { toast.error(`Photo non enregistrée : ${e.message}`) } finally { setBusy(false) }
  }

  const s = summarize(items)
  const rows = useMemo(() => {
    const list = items.map((i) => ({ ...i, e: equipmentById[i.equipment_id] })).filter((r) => r.e)
    list.sort((a, b) => String(a.e.location || '').localeCompare(String(b.e.location || ''), 'fr', { numeric: true }))
    if (filter === 'todo') return list.filter((r) => !r.result)
    if (filter !== 'all') return list.filter((r) => r.e.itv_equipment_types?.family === filter)
    return list
  }, [items, equipmentById, filter])
  const families = [...new Set(equipment.map((e) => e.itv_equipment_types?.family).filter(Boolean))]

  if (!visit) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>

  const header = (
    <div className="flex items-center gap-2">
      <button type="button" className="btn btn-ghost btn-icon" onClick={() => (step === 'cloture' ? setStep('controle') : navigate(-1))} aria-label="Retour"><ChevronLeft className="w-5 h-5" /></button>
      <div className="flex-1 min-w-0">
        <h1 className="font-display font-semibold text-lg truncate">{visit.clients?.name}</h1>
        <div className="text-ui-sm text-gray-500 truncate">{[visit.sites?.name, visit.sites?.city, visit.reference].filter(Boolean).join(', ')}</div>
      </div>
      {step === 'controle' && started && !readOnly ? <ScanButton className="btn btn-primary btn-icon" label="" onCode={onScan} /> : <VisitBadge status={visit.status} />}
    </div>
  )

  // ─── Avant le démarrage ───
  if (!started) {
    return (
      <div className="space-y-3 max-w-xl">
        {header}
        <div className="card space-y-2">
          <div className="text-ui-sm text-gray-500">{visit.planned_on ? `Prévue le ${frShort(visit.planned_on)}` : 'Non planifiée'}{technician ? `, ${technician.name}` : ''}</div>
          <div className="font-semibold">{equipment.length} appareils sur ce site</div>
          {visit.sites?.access_notes && <div className="text-ui-sm text-gray-600">Accès : {visit.sites.access_notes}</div>}
          {visit.notes && <div className="text-ui-sm text-gray-600">{visit.notes}</div>}
        </div>
        {canWrite && <button type="button" className="btn btn-primary w-full" style={{ height: 52 }} onClick={begin} disabled={busy}>{busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}Démarrer la visite</button>}
        {!equipment.length && <p className="muted text-ui-sm">Aucun appareil enregistré : ajoutez-les pendant la visite avec « Appareil trouvé sur place ».</p>}
      </div>
    )
  }

  // ─── Visite terminée ───
  if (step === 'termine') {
    return <VisitDone visit={visit} items={items} parts={parts} equipmentById={equipmentById} settings={settings} technician={technician} isManager={isManager} reload={load} photoUrls={photoUrls} />
  }

  // ─── Clôture ───
  if (step === 'cloture') {
    const obs = new Set(visit.site_observations || [])
    const toggleObs = async (o) => {
      const next = obs.has(o) ? [...obs].filter((x) => x !== o) : [...obs, o]
      setVisit((v) => ({ ...v, site_observations: next }))
      await updateVisit(visit.id, { site_observations: next }).catch((e) => toast.error(e.message))
    }
    const finish = async () => {
      if (s.todo) { toast.error(`${s.todo} appareils ne sont pas encore contrôlés`); setStep('controle'); setFilter('todo'); return }
      if (!visit.client_signature && !noSignOk) { setNoSignOk(true); toast('Le client n\'a pas signé : appuyez encore une fois pour terminer sans signature'); return }
      setBusy(true)
      try {
        await updateVisit(visit.id, { signer_name: visit.signer_name || null, observations: visit.observations || null, finished_at: new Date().toISOString() })
        await closeVisit(visit.id)
        await load()
        setStep('termine')
        toast.success('Visite terminée, échéances mises à jour')
      } catch (e) { toast.error(e.message) } finally { setBusy(false) }
    }
    return (
      <div className="space-y-3 max-w-xl">
        {header}
        <div className="grid grid-cols-3 gap-2">
          <Kpi value={s.conforme} label="conformes" tone="success" />
          <Kpi value={s.a_remplacer} label="à remplacer" tone="warning" />
          <Kpi value={s.remplace} label="remplacés" tone="info" />
        </div>
        {(s.absent + s.inaccessible) > 0 && <p className="text-ui-sm text-[rgb(var(--c-danger))]">{s.absent + s.inaccessible} appareils absents ou inaccessibles : ils restent à vérifier.</p>}

        <section className="card space-y-2">
          <h2 className="section-title">Pièces fournies</h2>
          {parts.map((p) => (
            <div key={p.id} className="flex items-center gap-2 border-b border-gray-100 pb-2">
              <span className="flex-1">{p.label}</span>
              <button type="button" className="btn btn-secondary btn-icon btn-sm" aria-label="Retirer une" onClick={async () => {
                if (Number(p.quantity) <= 1) { await removeVisitPart(p.id); setParts((l) => l.filter((x) => x.id !== p.id)); return }
                const q = Number(p.quantity) - 1; await updateVisitPart(p.id, { quantity: q }); setParts((l) => l.map((x) => (x.id === p.id ? { ...x, quantity: q } : x)))
              }}><Minus className="w-4 h-4" /></button>
              <span className="w-6 text-center font-semibold">{Number(p.quantity)}</span>
              <button type="button" className="btn btn-secondary btn-icon btn-sm" aria-label="Ajouter une" onClick={async () => {
                const q = Number(p.quantity) + 1; await updateVisitPart(p.id, { quantity: q }); setParts((l) => l.map((x) => (x.id === p.id ? { ...x, quantity: q } : x)))
              }}><Plus className="w-4 h-4" /></button>
            </div>
          ))}
          <label className="sr-only" htmlFor="itv-part-add">Ajouter une pièce</label>
          <select id="itv-part-add" className="select" value="" onChange={async (e) => {
            const v = e.target.value
            if (!v) return
            let row
            if (v === '__libre') { setFreePart(''); return }
            {
              const p = catalog.find((x) => x.id === v)
              const ex = parts.find((x) => x.part_id === v)
              if (ex) { const q = Number(ex.quantity) + 1; await updateVisitPart(ex.id, { quantity: q }); setParts((l) => l.map((x) => (x.id === ex.id ? { ...x, quantity: q } : x))); return }
              row = { visit_id: visit.id, part_id: p.id, label: p.name, quantity: 1, unit_price_ht: p.price_ht }
            }
            try { const saved = await addVisitPart(row); setParts((l) => [...l, saved]) } catch (err) { toast.error(err.message) }
          }}>
            <option value="">Ajouter une pièce</option>
            {catalog.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="__libre">Autre pièce (saisie libre)</option>
          </select>
          {freePart !== null && (
            <form className="flex gap-2" onSubmit={async (e) => {
              e.preventDefault()
              if (!freePart.trim()) return
              try { const saved = await addVisitPart({ visit_id: visit.id, label: freePart.trim(), quantity: 1, unit_price_ht: 0 }); setParts((l) => [...l, saved]); setFreePart(null) } catch (err) { toast.error(err.message) }
            }}>
              <label className="sr-only" htmlFor="itv-free-part">Pièce fournie</label>
              <input id="itv-free-part" className="input flex-1" placeholder="Pièce fournie" value={freePart} onChange={(e) => setFreePart(e.target.value)} autoFocus />
              <button type="submit" className="btn btn-secondary">Ajouter</button>
            </form>
          )}
        </section>

        <section className="card space-y-2">
          <h2 className="section-title">Photos</h2>
          <div className="flex flex-wrap gap-2">
            {(visit.photos || []).map((p) => (
              <div key={p} className="relative">
                {photoUrls[p] ? <img src={photoUrls[p]} alt="Photo de la visite" className="w-20 h-20 rounded-ui-sm object-cover" /> : <div className="w-20 h-20 rounded-ui-sm bg-gray-100" />}
                <button type="button" className="absolute -top-2 -right-2 bg-white border border-gray-200 rounded-full w-7 h-7 flex items-center justify-center" aria-label="Retirer la photo"
                  onClick={async () => { const photos = visit.photos.filter((x) => x !== p); await updateVisit(visit.id, { photos }); setVisit((v) => ({ ...v, photos })) }}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            <button type="button" className="w-20 h-20 rounded-ui-sm border border-dashed border-gray-300 flex items-center justify-center" aria-label="Prendre une photo" onClick={() => { setPhotoTarget('visit'); fileRef.current?.click() }} disabled={busy}>
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-6 h-6 text-gray-600" />}
            </button>
          </div>
        </section>

        <section className="card space-y-2">
          <h2 className="section-title">Observations sur le site</h2>
          {(settings.site_observations || []).map((o) => (
            <label key={o} className="flex items-center gap-3 min-h-[40px]">
              <input type="checkbox" className="w-5 h-5" checked={obs.has(o)} onChange={() => toggleObs(o)} />
              <span>{o}</span>
            </label>
          ))}
          <label className="label" htmlFor="itv-obs">Autres observations</label>
          <textarea id="itv-obs" className="textarea" rows={3} value={visit.observations || ''} onChange={(e) => setVisit((v) => ({ ...v, observations: e.target.value }))}
            onBlur={() => updateVisit(visit.id, { observations: visit.observations || null }).catch(() => {})} />
        </section>

        <section className="card space-y-2">
          <h2 className="section-title">Signature du client</h2>
          <label className="label" htmlFor="itv-signer">Nom et fonction</label>
          <input id="itv-signer" className="input" value={visit.signer_name || ''} onChange={(e) => setVisit((v) => ({ ...v, signer_name: e.target.value }))}
            onBlur={() => updateVisit(visit.id, { signer_name: visit.signer_name || null }).catch(() => {})} />
          {visit.client_signature
            ? <div className="flex items-center gap-3"><img src={visit.client_signature} alt="Signature du client" className="h-20 border border-gray-200 rounded-ui-sm bg-white" /><button type="button" className="btn btn-secondary btn-sm" onClick={() => setSigning(true)}>Refaire</button></div>
            : <button type="button" className="btn btn-secondary w-full" style={{ height: 52 }} onClick={() => setSigning(true)}><PenLine className="w-5 h-5" />Faire signer le client</button>}
        </section>

        <div className="sticky bottom-0 -mx-3 bg-white border-t border-gray-200 p-3 z-30" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <div>
            <button type="button" className="btn btn-primary w-full" style={{ height: 52 }} onClick={finish} disabled={busy}>{busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}Terminer et produire le rapport</button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { takePhoto(e.target.files?.[0], photoTarget); e.target.value = '' }} />
        {signing && (
          <FullscreenSignaturePad title="Signature du client" subtitle={visit.signer_name || visit.clients?.name} confirmLabel="Valider la signature"
            onCancel={() => setSigning(false)}
            onValidate={async (img) => { setSigning(false); setVisit((v) => ({ ...v, client_signature: img })); await updateVisit(visit.id, { client_signature: img }).catch((e) => toast.error(e.message)) }} />
        )}
      </div>
    )
  }

  // ─── Contrôle des appareils ───
  return (
    <div className="space-y-3 max-w-xl">
      {header}
      <div className="text-ui-sm text-gray-500">{s.done} contrôlés sur {s.total}{visit.started_at ? `, arrivée ${new Date(visit.started_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}</div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrer les appareils">
        {[['all', `Tous ${s.total}`], ['todo', `À contrôler ${s.todo}`], ...families.map((f) => [f, f])].map(([k, l]) => (
          <button key={k} type="button" className={`badge whitespace-nowrap ${filter === k ? 'bg-gray-900 text-white' : 'badge-neutral'}`} style={{ height: 32, padding: '0 12px' }} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {rows.map((r) => {
        const t = typesById[r.e.type_id] || r.e.itv_equipment_types || {}
        const needsDetail = r.result && r.result !== 'conforme'
        return (
          <div key={r.id} id={`itv-eq-${r.e.id}`} className={`card space-y-2 ${needsDetail ? 'ring-1 ring-[rgb(var(--c-warning)/0.3)]' : ''} ${highlight === r.e.id ? 'ring-2 ring-accent-500' : ''}`}>
            <div className="flex gap-2 justify-between">
              <div className="min-w-0">
                <div className="font-semibold">{t.name}{r.e.details?.Capacité ? ` ${r.e.details.Capacité}` : ''}</div>
                <div className="text-ui-sm text-gray-500">{[r.e.location, r.e.label_code].filter(Boolean).join('. ')}</div>
                {r.operation !== 'verification' && <div className="text-ui-sm font-semibold text-[rgb(var(--c-warning))]">{settings.operation_labels[r.operation] || r.operation}</div>}
                {r.e.manufactured_year && <div className="text-ui-sm text-gray-500">Fabriqué en {r.e.manufactured_year}{r.e.brand ? `, ${r.e.brand}` : ''}</div>}
              </div>
              <ResultBadge result={r.result} />
            </div>
            {!readOnly && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {MAIN.map((res) => (
                    <button key={res.code} type="button" onClick={() => patchItem(r, { result: res.code })}
                      className={`rounded-ui-sm border text-ui-sm font-semibold ${r.result === res.code ? (res.code === 'conforme' ? 'bg-[rgb(var(--c-success))] border-[rgb(var(--c-success)/0.3)] text-white' : res.code === 'a_remplacer' ? 'bg-[rgb(var(--c-warning))] border-[rgb(var(--c-warning)/0.3)] text-white' : 'bg-[rgb(var(--c-info))] border-[rgb(var(--c-info)/0.3)] text-white') : 'bg-white border-gray-300 text-gray-900'}`}
                      style={{ height: 44 }} aria-pressed={r.result === res.code}>{res.label}</button>
                  ))}
                </div>
                <div className="flex gap-2">
                  {OTHER.map((res) => (
                    <button key={res.code} type="button" onClick={() => patchItem(r, { result: r.result === res.code ? null : res.code })}
                      className={`btn btn-sm flex-1 ${r.result === res.code ? 'bg-[rgb(var(--c-danger))] text-white border-[rgb(var(--c-danger)/0.3)]' : 'btn-ghost'}`} aria-pressed={r.result === res.code}>{res.label}</button>
                  ))}
                </div>
              </>
            )}
            {needsDetail && !readOnly && (
              <div className="space-y-2">
                {(t.defects || []).length > 0 && r.result !== 'absent' && (
                  <div>
                    <label className="label" htmlFor={`itv-def-${r.id}`}>Motif</label>
                    <select id={`itv-def-${r.id}`} className="select" value={r.defect || ''} onChange={(e) => patchItem(r, { defect: e.target.value || null })}>
                      <option value="">Choisir</option>
                      {t.defects.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="label" htmlFor={`itv-ob-${r.id}`}>Observation</label>
                  <input id={`itv-ob-${r.id}`} className="input" defaultValue={r.observation || ''} onBlur={(e) => e.target.value !== (r.observation || '') && patchItem(r, { observation: e.target.value || null })} />
                </div>
                <button type="button" className="btn btn-secondary w-full" onClick={() => { setPhotoTarget(r); itemFileRef.current?.click() }} disabled={busy}>
                  <Camera className="w-4 h-4" />{r.photo_path ? 'Remplacer la photo' : 'Photo de l\'appareil'}
                </button>
                {r.photo_path && photoUrls[r.photo_path] && <img src={photoUrls[r.photo_path]} alt="Photo de l'appareil" className="h-24 rounded-ui-sm object-cover" />}
              </div>
            )}
          </div>
        )
      })}

      {!readOnly && (
        <button type="button" className="btn btn-secondary w-full border-dashed" onClick={() => setAdding(true)}><Plus className="w-4 h-4" />Appareil trouvé sur place</button>
      )}

      {!readOnly && (
        <div className="sticky bottom-0 -mx-3 bg-white border-t border-gray-200 p-3 z-30 space-y-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <div className="space-y-2">
            {s.todo > 0 && (confirmRest
              ? <div className="flex gap-2"><button type="button" className="btn btn-success flex-1" onClick={restConforme}><Check className="w-4 h-4" />Confirmer : {s.todo} conformes</button><button type="button" className="btn btn-ghost" onClick={() => setConfirmRest(false)}>Annuler</button></div>
              : <button type="button" className="btn btn-secondary w-full" onClick={restConforme}><ListChecks className="w-4 h-4" />Tout le reste conforme ({s.todo})</button>)}
            <button type="button" className="btn btn-primary w-full" style={{ height: 50 }} onClick={() => { setStep('cloture'); window.scrollTo(0, 0) }}>Continuer vers la clôture</button>
          </div>
        </div>
      )}
      <input ref={itemFileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { takePhoto(e.target.files?.[0], photoTarget); e.target.value = '' }} />
      {adding && <AddOnSite visit={visit} types={types} onClose={() => setAdding(false)} onAdded={(eq, it) => { setEquipment((l) => [...l, eq]); setItems((l) => [...l, it]); setAdding(false) }} />}
    </div>
  )
}

function AddOnSite({ visit, types, onClose, onAdded }) {
  const [f, setF] = useState({ type_id: types.find((t) => t.is_active)?.id || '', location: '', brand: '', manufactured_year: '' })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!f.type_id) return
    setBusy(true)
    try {
      const eq = await saveEquipment({ client_id: visit.client_id, site_id: visit.site_id, type_id: f.type_id, location: f.location || null, brand: f.brand || null, manufactured_year: f.manufactured_year ? Number(f.manufactured_year) : null })
      const it = await addVisitItem({ visit_id: visit.id, equipment_id: eq.id, operation: 'mise_en_service' })
      const t = types.find((x) => x.id === eq.type_id)
      toast.success(`Ajouté au parc : ${eq.label_code}`)
      onAdded({ ...eq, itv_equipment_types: t }, it)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <Sheet title="Appareil trouvé sur place" onClose={onClose} footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn btn-primary" onClick={save} disabled={busy || !f.type_id}>Ajouter au parc</button></>}>
      <div><label className="label" htmlFor="aos-type">Type</label>
        <select id="aos-type" className="select" value={f.type_id} onChange={(e) => setF({ ...f, type_id: e.target.value })}>
          {types.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></div>
      <div><label className="label" htmlFor="aos-loc">Emplacement</label><input id="aos-loc" className="input" placeholder="Bâtiment, étage, pièce" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label" htmlFor="aos-brand">Marque</label><input id="aos-brand" className="input" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} /></div>
        <div><label className="label" htmlFor="aos-year">Année de fabrication</label><input id="aos-year" className="input" inputMode="numeric" value={f.manufactured_year} onChange={(e) => setF({ ...f, manufactured_year: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></div>
      </div>
      <p className="muted text-ui-sm">Un code d'étiquette est attribué tout de suite ; l'étiquette s'imprime depuis le parc du client.</p>
    </Sheet>
  )
}

function VisitDone({ visit, items, parts, equipmentById, settings, technician, isManager, reload, photoUrls }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(null)
  const s = summarize(items)

  const makePdf = async () => {
    const { data: tech } = visit.technician_id ? await supabase.from('profiles').select('first_name, last_name, display_name, email').eq('id', visit.technician_id).maybeSingle() : { data: null }
    return buildRapportPDF({ visit, items, parts, equipmentById, settings, technicianName: tech ? profileName(tech) : (technician?.name || '') })
  }
  const download = async () => {
    setBusy('pdf')
    try { const { doc, filename } = await makePdf(); doc.save(filename) } catch (e) { toast.error(e.message) } finally { setBusy(null) }
  }
  const share = async () => {
    setBusy('share')
    try {
      const { doc, filename } = await makePdf()
      const file = new File([doc.output('blob')], filename, { type: 'application/pdf' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: filename })
        await reload()
      } else { doc.save(filename); toast('Partage impossible sur cet appareil : le rapport a été téléchargé') }
    } catch (e) { if (e?.name !== 'AbortError') toast.error(e.message) } finally { setBusy(null) }
  }
  const invoice = async () => {
    if (visit.invoice_id) { navigate(`/factures?open=${visit.invoice_id}`); return }
    setBusy('inv')
    try { const inv = await createInvoiceDraft(visit, parts, settings); toast.success(`Facture ${inv.reference} préparée (brouillon)`); navigate(`/factures?open=${inv.id}`) } catch (e) { toast.error(e.message) } finally { setBusy(null) }
  }
  const quote = async () => {
    if (visit.quote_id) { navigate(`/devis?open=${visit.quote_id}`); return }
    setBusy('quote')
    try { const q = await createReplacementQuote(visit, items, equipmentById, settings); toast.success(`Devis ${q.reference} préparé : prix à compléter`); navigate(`/devis?open=${q.id}`) } catch (e) { toast.error(e.message) } finally { setBusy(null) }
  }

  const arr = visit.started_at ? new Date(visit.started_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null
  const dep = visit.finished_at ? new Date(visit.finished_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null
  return (
    <div className="space-y-3 max-w-xl">
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label="Retour"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-semibold text-lg truncate">{visit.clients?.name}</h1>
          <div className="text-ui-sm text-gray-500 truncate">{[visit.sites?.name, visit.reference].filter(Boolean).join(', ')}</div>
        </div>
        <VisitBadge status="terminee" />
      </div>
      <div className="card text-ui-sm text-gray-600">
        {frShort((visit.started_at || visit.planned_on || '').slice(0, 10))}{arr ? `, de ${arr}` : ''}{dep ? ` à ${dep}` : ''}{technician ? `, ${technician.name}` : ''}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Kpi value={s.conforme} label="conformes" tone="success" />
        <Kpi value={s.a_remplacer} label="à remplacer" tone="warning" />
        <Kpi value={s.remplace} label="remplacés" tone="info" />
      </div>
      <button type="button" className="btn btn-primary w-full" style={{ height: 50 }} onClick={download} disabled={!!busy}>{busy === 'pdf' ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileDown className="w-5 h-5" />}Rapport PDF</button>
      <button type="button" className="btn btn-secondary w-full" onClick={share} disabled={!!busy}><Share2 className="w-4 h-4" />Envoyer le rapport (email, messagerie)</button>
      {isManager && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button type="button" className="btn btn-secondary" onClick={invoice} disabled={!!busy}><Receipt className="w-4 h-4" />{visit.invoice_id ? 'Voir la facture' : 'Créer la facture'}</button>
          {(s.a_remplacer > 0 || visit.quote_id) && <button type="button" className="btn btn-secondary" onClick={quote} disabled={!!busy}><FileText className="w-4 h-4" />{visit.quote_id ? 'Voir le devis' : `Devis de remplacement (${s.a_remplacer})`}</button>}
        </div>
      )}
      <div className="card card-flush">
        {[...items].sort((a, b) => String(equipmentById[a.equipment_id]?.location || '').localeCompare(String(equipmentById[b.equipment_id]?.location || ''), 'fr', { numeric: true })).map((i) => {
          const e = equipmentById[i.equipment_id]
          if (!e) return null
          return (
            <div key={i.id} className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 last:border-b-0">
              <div className="flex-1 min-w-0">
                <div className="text-ui font-medium truncate">{e.itv_equipment_types?.name}</div>
                <div className="text-ui-sm text-gray-500 truncate">{[e.location, e.label_code, i.defect].filter(Boolean).join('. ')}</div>
              </div>
              <ResultBadge result={i.result} />
            </div>
          )
        })}
      </div>
      {visit.client_signature && <div className="card"><div className="text-ui-sm text-gray-500 mb-1">Signé par {visit.signer_name || 'le client'}</div><img src={visit.client_signature} alt="Signature du client" className="h-16" /></div>}
      {(visit.photos || []).length > 0 && <div className="flex gap-2 flex-wrap">{visit.photos.map((p) => photoUrls[p] && <img key={p} src={photoUrls[p]} alt="Photo de la visite" className="w-20 h-20 rounded-ui-sm object-cover" />)}</div>}
      <Link to="/interventions/journee" className="btn btn-ghost w-full">Retour à ma journée</Link>
    </div>
  )
}

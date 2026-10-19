// Réglages du module : techniciens, types de matériel (périodicités, opérations, motifs), pièces et tarifs,
// rapports et étiquettes. Tout est modifiable par l'organisme : rien n'est fixé dans le code.

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, Check, AlertTriangle, Loader2 } from 'lucide-react'
import { profileName } from '../../../core/org/currentOrg'
import { loadStaffProfiles, loadTechnicians, setTechnician, setTechnicianColor, saveType, removeType, loadTypes, savePart, loadParts, saveSettings, loadSettings } from '../lib/itvData'
import { DEFAULT_OPERATION_LABELS } from '../lib/schedule'
import { Sheet } from '../components/ui'

import { confirmer } from '../../../ui/Confirm'
const SECTIONS = [
  { id: 'types', label: 'Types de matériel' },
  { id: 'pieces', label: 'Pièces et tarifs' },
  { id: 'techniciens', label: 'Techniciens' },
  { id: 'rapports', label: 'Visites et rapports' },
]
const lines = (txt) => String(txt || '').split('\n').map((s) => s.trim()).filter(Boolean)

export default function Reglages({ settings, setSettings, types, setTypes, parts, setParts, reload }) {
  const [sec, setSec] = useState('types')
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap" role="tablist" aria-label="Réglages">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={sec === s.id} onClick={() => setSec(s.id)}
            className={`btn btn-sm ${sec === s.id ? 'bg-gray-900 text-white border-gray-900' : 'btn-secondary'}`}>{s.label}</button>
        ))}
      </div>
      {sec === 'types' && <TypesSection types={types} setTypes={setTypes} />}
      {sec === 'pieces' && <PartsSection parts={parts} setParts={setParts} types={types} />}
      {sec === 'techniciens' && <TechSection reload={reload} />}
      {sec === 'rapports' && <ReportSection settings={settings} setSettings={setSettings} />}
    </div>
  )
}

// ─── Types de matériel ───
function TypesSection({ types, setTypes }) {
  const [edit, setEdit] = useState(null)
  const toConfirm = types.filter((t) => !t.is_confirmed && t.is_active).length
  const refresh = async () => setTypes(await loadTypes())
  return (
    <section className="space-y-3">
      {toConfirm > 0 && (
        <div className="rounded-ui border border-[rgb(var(--c-warning)/0.3)] bg-[rgb(var(--c-warning-bg))] p-3 text-ui-sm text-[rgb(var(--c-warning))] flex gap-2">
          <AlertTriangle className="w-4 h-4 flex-none mt-0.5" />
          <span>{toConfirm} type{toConfirm > 1 ? 's' : ''} à confirmer. Les valeurs de départ viennent des textes et des normes (source indiquée sur chaque type) : vérifiez-les selon votre pratique, puis cochez « Valeurs confirmées ».</span>
        </div>
      )}
      <div className="flex justify-end"><button type="button" className="btn btn-primary" onClick={() => setEdit({})}><Plus className="w-4 h-4" />Nouveau type</button></div>
      <div className="card card-flush">
        {types.map((t) => (
          <button key={t.id} type="button" onClick={() => setEdit(t)} className="w-full text-left flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
            <div className="flex-1 min-w-[220px]">
              <div className={`font-semibold ${t.is_active ? '' : 'text-gray-400'}`}>{t.name}</div>
              <div className="text-ui-sm text-gray-500">
                {t.family}. Vérification tous les {t.verification_months} mois
                {(t.operations || []).length ? `. ${t.operations.map((o) => `${o.label} (${(o.years || []).join(', ')} ans)`).join(', ')}` : ''}
                {t.lifespan_years ? `. Durée de vie ${t.lifespan_years} ans` : ''}.
              </div>
            </div>
            {!t.is_active ? <span className="badge badge-neutral">Désactivé</span> : t.is_confirmed ? <span className="badge badge-success">Confirmé</span> : <span className="badge badge-warning">À confirmer</span>}
            <Pencil className="w-4 h-4 text-gray-400" />
          </button>
        ))}
      </div>
      {edit && <TypeForm type={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await refresh() }} />}
    </section>
  )
}

function TypeForm({ type, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    name: type.name || '', family: type.family || '', verification_months: type.verification_months || 12, lifespan_years: type.lifespan_years || '',
    operations: (type.operations || []).map((o) => ({ ...o, yearsText: (o.years || []).join(', ') })),
    defects: (type.defects || []).join('\n'), fields: (type.fields || []).join('\n'), source_note: type.source_note || '',
    is_confirmed: !!type.is_confirmed, is_active: type.is_active !== false, sort_order: type.sort_order ?? 100,
  }))
  const [busy, setBusy] = useState(false)
  const setOp = (i, patch) => setF((x) => ({ ...x, operations: x.operations.map((o, j) => (j === i ? { ...o, ...patch } : o)) }))
  const save = async () => {
    if (!f.name.trim()) { toast.error('Nom obligatoire'); return }
    setBusy(true)
    try {
      await saveType({
        ...(type.id ? { id: type.id } : {}), name: f.name.trim(), family: f.family.trim() || 'Autre', verification_months: Number(f.verification_months) || 12,
        lifespan_years: f.lifespan_years ? Number(f.lifespan_years) : null,
        operations: f.operations.filter((o) => o.label?.trim()).map((o) => ({ code: o.code || 'revision', label: o.label.trim(), years: String(o.yearsText || '').split(/[,; ]+/).map(Number).filter((n) => n > 0) })),
        defects: lines(f.defects), fields: lines(f.fields), source_note: f.source_note || null, is_confirmed: f.is_confirmed, is_active: f.is_active, sort_order: Number(f.sort_order) || 100,
      })
      toast.success('Type enregistré'); onSaved()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!await confirmer(`Supprimer le type « ${type.name} » ?`)) return
    try { await removeType(type.id); toast.success('Type supprimé'); onSaved() } catch (e) { toast.error(e.message) }
  }
  return (
    <Sheet title={type.id ? type.name : 'Nouveau type de matériel'} onClose={onClose} wide
      footer={<>
        {type.id && <button type="button" className="btn btn-ghost text-[rgb(var(--c-danger))] mr-auto" onClick={remove}>Supprimer</button>}
        <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer</button>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="ty-name">Nom</label><input id="ty-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="label" htmlFor="ty-fam">Famille (filtre et regroupement)</label><input id="ty-fam" className="input" placeholder="Extincteurs, Éclairage de sécurité..." value={f.family} onChange={(e) => setF({ ...f, family: e.target.value })} /></div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div><label className="label" htmlFor="ty-months">Vérification tous les (mois)</label><input id="ty-months" className="input" inputMode="numeric" value={f.verification_months} onChange={(e) => setF({ ...f, verification_months: e.target.value.replace(/\D/g, '') })} /></div>
        <div><label className="label" htmlFor="ty-life">Durée de vie (ans, facultatif)</label><input id="ty-life" className="input" inputMode="numeric" value={f.lifespan_years} onChange={(e) => setF({ ...f, lifespan_years: e.target.value.replace(/\D/g, '') })} /></div>
        <div><label className="label" htmlFor="ty-order">Ordre d'affichage</label><input id="ty-order" className="input" inputMode="numeric" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value.replace(/\D/g, '') })} /></div>
      </div>
      <fieldset className="space-y-2">
        <legend className="label">Opérations périodiques (années après la fabrication)</legend>
        {f.operations.map((o, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_120px_auto] gap-2 items-end">
            <div><label className="sr-only" htmlFor={`op-l-${i}`}>Libellé</label><input id={`op-l-${i}`} className="input" placeholder="Libellé" value={o.label} onChange={(e) => setOp(i, { label: e.target.value })} /></div>
            <div><label className="sr-only" htmlFor={`op-y-${i}`}>Années</label><input id={`op-y-${i}`} className="input" placeholder="5, 15" value={o.yearsText} onChange={(e) => setOp(i, { yearsText: e.target.value })} /></div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF((x) => ({ ...x, operations: x.operations.filter((_, j) => j !== i) }))}>Retirer</button>
          </div>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setF((x) => ({ ...x, operations: [...x.operations, { code: 'revision', label: '', yearsText: '' }] }))}><Plus className="w-4 h-4" />Ajouter une opération</button>
        <p className="muted text-ui-sm">L'opération est proposée au technicien l'année venue, à la place de la vérification simple.</p>
      </fieldset>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="ty-def">Motifs de non-conformité (un par ligne)</label><textarea id="ty-def" className="textarea" rows={8} value={f.defects} onChange={(e) => setF({ ...f, defects: e.target.value })} /></div>
        <div><label className="label" htmlFor="ty-fields">Champs de la fiche appareil (un par ligne)</label><textarea id="ty-fields" className="textarea" rows={8} placeholder="Capacité&#10;Agent" value={f.fields} onChange={(e) => setF({ ...f, fields: e.target.value })} /></div>
      </div>
      <div><label className="label" htmlFor="ty-src">Source des valeurs</label><textarea id="ty-src" className="textarea" rows={3} value={f.source_note} onChange={(e) => setF({ ...f, source_note: e.target.value })} /></div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_confirmed} onChange={(e) => setF({ ...f, is_confirmed: e.target.checked })} />Valeurs confirmées par l'organisme</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />Type utilisé</label>
      </div>
    </Sheet>
  )
}

// ─── Pièces ───
function PartsSection({ parts, setParts, types }) {
  const [draft, setDraft] = useState({ name: '', unit: 'unité', price_ht: '' })
  const refresh = async () => setParts(await loadParts())
  const upd = async (p, patch) => {
    setParts((l) => l.map((x) => (x.id === p.id ? { ...x, ...patch } : x)))
    try { await savePart({ id: p.id, ...patch }) } catch (e) { toast.error(e.message); refresh() }
  }
  const add = async () => {
    if (!draft.name.trim()) return
    try { await savePart({ name: draft.name.trim(), unit: draft.unit || 'unité', price_ht: Number(String(draft.price_ht).replace(',', '.')) || 0 }); setDraft({ name: '', unit: 'unité', price_ht: '' }); refresh() } catch (e) { toast.error(e.message) }
  }
  return (
    <section className="space-y-3">
      <p className="muted text-ui-sm">Pièces proposées au technicien à la clôture. Le prix sert à la facture préparée depuis la visite.</p>
      <div className="card card-flush overflow-x-auto">
        <table className="w-full">
          <thead><tr><th>Pièce</th><th style={{ width: 110 }}>Unité</th><th style={{ width: 120 }}>Prix HT</th><th style={{ width: 80 }}>Utilisée</th></tr></thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.id}>
                <td><input className="input" aria-label="Nom de la pièce" defaultValue={p.name} onBlur={(e) => e.target.value !== p.name && upd(p, { name: e.target.value })} /></td>
                <td><input className="input" aria-label="Unité" defaultValue={p.unit} onBlur={(e) => e.target.value !== p.unit && upd(p, { unit: e.target.value })} /></td>
                <td><input className="input" aria-label="Prix HT" inputMode="decimal" defaultValue={p.price_ht} onBlur={(e) => { const v = Number(e.target.value.replace(',', '.')) || 0; if (v !== Number(p.price_ht)) upd(p, { price_ht: v }) }} /></td>
                <td className="text-center"><input type="checkbox" aria-label="Pièce utilisée" checked={p.is_active} onChange={(e) => upd(p, { is_active: e.target.checked })} /></td>
              </tr>
            ))}
            <tr>
              <td><input className="input" placeholder="Nouvelle pièce" aria-label="Nouvelle pièce" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
              <td><input className="input" aria-label="Unité" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} /></td>
              <td><input className="input" aria-label="Prix HT" inputMode="decimal" value={draft.price_ht} onChange={(e) => setDraft({ ...draft, price_ht: e.target.value })} /></td>
              <td className="text-center"><button type="button" className="btn btn-primary btn-sm" onClick={add} aria-label="Ajouter la pièce"><Plus className="w-4 h-4" /></button></td>
            </tr>
          </tbody>
        </table>
      </div>
      {types.length === 0 && null}
    </section>
  )
}

// ─── Techniciens ───
const COLORS = ['#C8102E', '#1D4ED8', '#047857', '#7C3AED', '#B45309', '#0E7490', '#BE185D', '#374151']
function TechSection({ reload }) {
  const [profiles, setProfiles] = useState(null)
  const [techs, setTechs] = useState([])
  const load = async () => {
    const [p, t] = await Promise.all([loadStaffProfiles(), loadTechnicians({ all: true })])
    setProfiles((p || []).filter((x) => x.is_active)); setTechs(t || [])
  }
  useEffect(() => { load() }, [])
  if (!profiles) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  const byId = Object.fromEntries(techs.map((t) => [t.id, t]))
  const toggle = async (p, on) => {
    try {
      const used = new Set(techs.filter((t) => t.is_active).map((t) => t.color))
      await setTechnician(p.id, on, byId[p.id]?.color || COLORS.find((c) => !used.has(c)) || COLORS[0])
      await load(); await reload()
    } catch (e) { toast.error(e.message) }
  }
  return (
    <section className="space-y-3">
      <p className="muted text-ui-sm">Un technicien est un compte utilisateur : son nom et son téléphone viennent de son compte (Paramètres, Utilisateurs). Cochez les comptes qui font des visites ; ils voient « Ma journée » sur leur téléphone.</p>
      <div className="card card-flush">
        {profiles.map((p) => {
          const t = byId[p.id]
          const on = !!t?.is_active
          return (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0">
              <label className="flex items-center gap-3 flex-1 min-w-[220px]">
                <input type="checkbox" className="w-5 h-5" checked={on} onChange={(e) => toggle(p, e.target.checked)} />
                <span><span className="font-semibold">{profileName(p)}</span><span className="block text-ui-sm text-gray-500">{p.email}</span></span>
              </label>
              {on && (
                <div className="flex gap-1" role="group" aria-label={`Couleur de ${profileName(p)} sur la carte`}>
                  {COLORS.map((c) => (
                    <button key={c} type="button" aria-label={`Couleur ${c}`} aria-pressed={t.color === c} onClick={async () => { await setTechnicianColor(p.id, c); load(); reload() }}
                      className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: c }}>{t.color === c && <Check className="w-4 h-4 text-white" />}</button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── Visites et rapports ───
function ReportSection({ settings, setSettings }) {
  const [f, setF] = useState(() => ({
    label_prefix: settings.label_prefix || '', label_next: settings.label_next || 1, visit_fee_ht: settings.visit_fee_ht ?? 0, tva_rate: settings.tva_rate ?? 20,
    report_title: settings.report_title || '', report_intro: settings.report_intro || '', report_mentions: settings.report_mentions || '',
    site_observations: (settings.site_observations || []).join('\n'), operation_labels: { ...DEFAULT_OPERATION_LABELS, ...(settings.operation_labels || {}) },
  }))
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await saveSettings({
        label_prefix: f.label_prefix.trim().toUpperCase() || null, visit_fee_ht: Number(String(f.visit_fee_ht).replace(',', '.')) || 0, tva_rate: Number(String(f.tva_rate).replace(',', '.')) || 0,
        report_title: f.report_title.trim() || 'Rapport d\'intervention', report_intro: f.report_intro || null, report_mentions: f.report_mentions || null,
        site_observations: lines(f.site_observations), operation_labels: f.operation_labels,
      })
      setSettings(await loadSettings()); toast.success('Réglages enregistrés')
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <section className="space-y-4 max-w-3xl">
      <div className="card space-y-3">
        <h3 className="section-title">Étiquettes et facturation</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className="label" htmlFor="rg-prefix">Préfixe des étiquettes</label><input id="rg-prefix" className="input uppercase" placeholder="Initiales de l'entreprise" value={f.label_prefix} onChange={(e) => setF({ ...f, label_prefix: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 6) })} /></div>
          <div><label className="label" htmlFor="rg-next">Prochain numéro</label><input id="rg-next" className="input" value={f.label_next} disabled /></div>
          <div><label className="label" htmlFor="rg-fee">Forfait de visite HT</label><input id="rg-fee" className="input" inputMode="decimal" value={f.visit_fee_ht} onChange={(e) => setF({ ...f, visit_fee_ht: e.target.value })} /></div>
          <div><label className="label" htmlFor="rg-tva">TVA (%)</label><input id="rg-tva" className="input" inputMode="decimal" value={f.tva_rate} onChange={(e) => setF({ ...f, tva_rate: e.target.value })} /></div>
        </div>
        <p className="muted text-ui-sm">Le forfait de visite sert aux visites hors contrat ; une visite sous contrat reprend le prix du contrat.</p>
      </div>
      <div className="card space-y-3">
        <h3 className="section-title">Rapport d'intervention</h3>
        <div><label className="label" htmlFor="rg-title">Titre</label><input id="rg-title" className="input" value={f.report_title} onChange={(e) => setF({ ...f, report_title: e.target.value })} /></div>
        <div><label className="label" htmlFor="rg-intro">Phrase d'introduction (facultative)</label><textarea id="rg-intro" className="textarea" rows={2} value={f.report_intro} onChange={(e) => setF({ ...f, report_intro: e.target.value })} /></div>
        <div><label className="label" htmlFor="rg-ment">Mentions en fin de rapport (certification de l'entreprise, rappels au client)</label><textarea id="rg-ment" className="textarea" rows={3} value={f.report_mentions} onChange={(e) => setF({ ...f, report_mentions: e.target.value })} /></div>
        <div><label className="label" htmlFor="rg-obs">Observations de site proposées au technicien (une par ligne)</label><textarea id="rg-obs" className="textarea" rows={6} value={f.site_observations} onChange={(e) => setF({ ...f, site_observations: e.target.value })} /></div>
        <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <legend className="label">Libellés des opérations</legend>
          {Object.keys(DEFAULT_OPERATION_LABELS).map((k) => (
            <div key={k}><label className="sr-only" htmlFor={`rg-op-${k}`}>{DEFAULT_OPERATION_LABELS[k]}</label>
              <input id={`rg-op-${k}`} className="input" value={f.operation_labels[k] || ''} onChange={(e) => setF({ ...f, operation_labels: { ...f.operation_labels, [k]: e.target.value } })} /></div>
          ))}
        </fieldset>
      </div>
      <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer les réglages</button>
    </section>
  )
}

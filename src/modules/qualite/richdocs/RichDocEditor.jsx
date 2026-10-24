// Lecture, modification et validation d'un document qualité au nouveau modèle.
// Téléphone : lecture section par section (tableaux en cartes), modification possible ; la fiche du
// document s'ouvre par un bouton. Tablette et PC : sommaire, contenu, fiche du document côte à côte.

import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  ChevronLeft, Download, Save, CheckCircle, ArrowUp, ArrowDown, Trash2, Plus, RotateCcw,
  Eye, Pencil, Loader2, AlertTriangle, Info, X,
} from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'
import { docCode, currentUserName } from '../../../core/org/currentOrg'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import {
  richTokens, sectionChanged, resetSection, docStatus, bracketGaps, missingRoles, visibleSections,
  emptyBlock, BLOCK_LABEL, insertableFields, todayIso, plusOneYear, frDate,
} from './model'
import { buildRichDocPDF } from './richDocPDF'
import { exportDocx, importDocx, comparerSections } from './docxRichDoc'
import { champCasse, valeursEnDurPartout, remplacerEnDurPartout } from '../../../core/org/champsProteges'

import { confirmer } from '../../../ui/Confirm'
import CircuitDocument from './CircuitDocument'
export const VALIDATE_ROLES = ['superadmin', 'admin', 'direction']

const TONE = {
  gray: 'bg-gray-100 text-gray-700', blue: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]', green: 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]', amber: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]',
}
export function StatusChip({ status }) {
  return <span className={`inline-flex items-center h-6 px-2 rounded-full text-ui-sm font-semibold whitespace-nowrap ${TONE[status.tone]}`}>{status.label}</span>
}

/** Texte avec gras, champs remplis (bleu), rôles non désignés (rouge), passages à compléter (ambre) */
export function RichText({ text, ctx }) {
  return richTokens(text, ctx).map((tk, i) => {
    let cls = tk.bold ? 'font-semibold text-gray-900' : ''
    if (tk.field === 'ok') cls += ' bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))] rounded px-0.5'
    if (tk.field === 'missing') cls += ' bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))] rounded px-0.5'
    if (tk.gap) cls += ' bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] rounded px-0.5'
    return cls.trim() ? <span key={i} className={cls.trim()}>{tk.text}</span> : <span key={i}>{tk.text}</span>
  })
}

export function BlockView({ b, ctx }) {
  if (b.t === 'p') return <p className="text-ui leading-relaxed text-gray-700"><RichText text={b.text} ctx={ctx} /></p>
  if (b.t === 'h') return <h4 className="font-semibold text-ui text-gray-900 pt-1"><RichText text={b.text} ctx={ctx} /></h4>
  if (b.t === 'note') return <div className="rounded-ui-sm bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] p-3 text-ui text-gray-800"><RichText text={b.text} ctx={ctx} /></div>
  if (b.t === 'quote') return <div className="rounded-ui-sm bg-gray-50 border border-gray-200 p-3 space-y-2 text-ui text-gray-700">{(b.paras || []).map((p, i) => <p key={i}><RichText text={p} ctx={ctx} /></p>)}</div>
  if (b.t === 'ul' || b.t === 'ol' || b.t === 'check') {
    const Tag = b.t === 'ol' ? 'ol' : 'ul'
    return (
      <Tag start={b.start} className={`space-y-1.5 text-ui text-gray-700 ${b.t === 'ol' ? 'list-decimal pl-6' : b.t === 'ul' ? 'list-disc pl-5' : ''}`}>
        {(b.items || []).map((it, i) => (
          <li key={i} className={b.t === 'check' ? 'flex gap-2 items-start' : ''}>
            {b.t === 'check' && <span aria-hidden="true" className="mt-0.5 w-4 h-4 rounded border border-gray-400 shrink-0" />}
            <span><RichText text={it} ctx={ctx} /></span>
          </li>
        ))}
      </Tag>
    )
  }
  if (b.t === 'table') {
    const head = b.head || []
    return (
      <>
        <div className="hidden md:block overflow-x-auto border border-gray-200 rounded-ui-sm">
          <table className="w-full text-ui-sm">
            <thead className="bg-gray-800 text-white"><tr>{head.map((h, i) => <th key={i} className="text-left font-semibold px-3 py-2 align-bottom"><RichText text={h} ctx={null} /></th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {(b.rows || []).map((r, i) => (
                <tr key={i} className="align-top">{head.map((_, j) => <td key={j} className={`px-3 py-2 text-gray-700 ${j === 0 ? 'font-medium text-gray-900' : ''}`}><RichText text={r[j] ?? ''} ctx={ctx} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="md:hidden space-y-2">
          {(b.rows || []).map((r, i) => (
            <div key={i} className="border border-gray-200 rounded-ui-sm p-3 space-y-1">
              <div className="font-semibold text-ui text-gray-900"><RichText text={r[0] ?? ''} ctx={ctx} /></div>
              {head.slice(1).map((h, j) => (r[j + 1] ? <div key={j} className="text-ui-sm text-gray-700"><span className="text-gray-500">{h} : </span><RichText text={r[j + 1]} ctx={ctx} /></div> : null))}
            </div>
          ))}
        </div>
      </>
    )
  }
  return null
}

const rowsFor = (s) => Math.min(14, Math.max(2, Math.ceil(String(s || '').length / 85) + String(s || '').split('\n').length - 1))

export function BlockEdit({ b, onChange }) {
  if (b.t === 'p' || b.t === 'h' || b.t === 'note') {
    return <textarea className="input w-full leading-relaxed" rows={b.t === 'h' ? 1 : rowsFor(b.text)} value={b.text || ''} onChange={(e) => onChange({ ...b, text: e.target.value })} aria-label={BLOCK_LABEL[b.t]} />
  }
  if (b.t === 'quote') {
    const txt = (b.paras || []).join('\n\n')
    return <textarea className="input w-full leading-relaxed" rows={rowsFor(txt)} value={txt} onChange={(e) => onChange({ ...b, paras: e.target.value.split(/\n{2,}/) })} aria-label="Citation, paragraphes séparés par une ligne vide" />
  }
  if (b.t === 'ul' || b.t === 'ol' || b.t === 'check') {
    const txt = (b.items || []).join('\n')
    return (
      <div className="space-y-1">
        <textarea className="input w-full leading-relaxed" rows={rowsFor(txt) + 1} value={txt} onChange={(e) => onChange({ ...b, items: e.target.value.split('\n') })} aria-label={`${BLOCK_LABEL[b.t]}, un élément par ligne`} />
        <span className="text-ui-sm text-gray-500">Un élément par ligne.</span>
      </div>
    )
  }
  if (b.t === 'table') {
    const head = b.head || []
    const rows = b.rows || []
    const setCell = (i, j, v) => onChange({ ...b, rows: rows.map((r, ri) => (ri === i ? head.map((_, cj) => (cj === j ? v : r[cj] ?? '')) : r)) })
    const setHead = (j, v) => onChange({ ...b, head: head.map((h, hj) => (hj === j ? v : h)) })
    const cols = `repeat(${head.length}, minmax(120px, 1fr)) 36px`
    return (
      <div className="overflow-x-auto">
        <div className="space-y-1.5 min-w-fit">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: cols }}>
            {head.map((h, j) => <input key={j} className="input font-semibold text-ui-sm" value={h} onChange={(e) => setHead(j, e.target.value)} aria-label={`En-tête de colonne ${j + 1}`} />)}
            <span />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid gap-1.5 items-start" style={{ gridTemplateColumns: cols }}>
              {head.map((_, j) => <textarea key={j} className="input text-ui-sm" rows={Math.min(5, rowsFor(r[j]))} value={r[j] ?? ''} onChange={(e) => setCell(i, j, e.target.value)} aria-label={`Ligne ${i + 1}, ${head[j] || `colonne ${j + 1}`}`} />)}
              <button type="button" className="h-9 w-9 flex items-center justify-center text-gray-500 hover:text-[rgb(var(--c-danger))]" aria-label={`Supprimer la ligne ${i + 1}`} onClick={() => onChange({ ...b, rows: rows.filter((_, ri) => ri !== i) })}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <div className="flex flex-wrap gap-3 pt-1 text-ui-sm">
            <button type="button" className="text-primary-600 font-semibold" onClick={() => onChange({ ...b, rows: [...rows, head.map(() => '')] })}>Ajouter une ligne</button>
            <button type="button" className="text-primary-600 font-semibold" onClick={() => onChange({ ...b, head: [...head, `Colonne ${head.length + 1}`], rows: rows.map((r) => [...r, '']) })}>Ajouter une colonne</button>
            {head.length > 1 && <button type="button" className="text-gray-600 font-semibold" onClick={() => onChange({ ...b, head: head.slice(0, -1), rows: rows.map((r) => r.slice(0, head.length - 1)) })}>Retirer la dernière colonne</button>}
          </div>
        </div>
      </div>
    )
  }
  return null
}

const KV = ({ k, v }) => <div className="flex justify-between gap-3 py-1.5 border-b border-gray-100 text-ui-sm"><span className="text-gray-500">{k}</span><span className="text-right text-gray-900">{v}</span></div>

export default function RichDocEditor({ tpl, saved, ctx, onClose, onSaved }) {
  const { userRole, profile } = useAuthStore()
  const canEdit = ['superadmin', 'admin', 'direction', 'gestionnaire'].includes(userRole)
  const canValidate = VALIDATE_ROLES.includes(userRole)
  const [content, setContent] = useState(saved)
  const initial = useRef(JSON.stringify(saved))
  const [mode, setMode] = useState('lire')
  const [active, setActive] = useState(saved.sections[0]?.id)
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState(null)
  const [showFiche, setShowFiche] = useState(false)
  const [validating, setValidating] = useState(false)
  const [motif, setMotif] = useState('')
  // Circuit de validation (0455) : « direct » tant que rien n'est réglé ; relecture en cours = texte figé ici
  const [circuit, setCircuit] = useState({ mode: 'direct', ouvert: null })
  const code = docCode(tpl.code)
  const dirty = JSON.stringify(content) !== initial.current
  const status = docStatus(content)
  const gaps = useMemo(() => bracketGaps(content), [content])
  const missing = useMemo(() => missingRoles(content, ctx), [content, ctx])
  const sections = visibleSections(content)
  const sec = content.sections.find((s) => s.id === active) || content.sections[0]
  const nextVersion = (content.version || 0) + 1

  const loadHistory = async () => {
    const { data, error } = await supabase.from('quality_doc_versions').select('*').eq('doc_id', tpl.id).order('version', { ascending: false })
    if (!error) setHistory(data || [])
  }
  useEffect(() => { loadHistory() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setSec = (patch) => setContent((c) => ({ ...c, sections: c.sections.map((s) => (s.id === sec.id ? { ...s, ...patch } : s)) }))
  // Un champ {{...}} (adresse, téléphone, référent...) ne se modifie pas lettre par lettre : il s'insère ou se retire
  // en entier (sélectionné puis effacé). La frappe qui l'abîmerait est refusée.
  const setBlock = (i, nb) => {
    if (champCasse(JSON.stringify(sec.blocks[i]), JSON.stringify(nb))) {
      toast.error('Ce champ est rempli depuis Paramètres : sélectionnez-le en entier pour le retirer, il ne se modifie pas.', { id: 'champ-protege' })
      return
    }
    setSec({ blocks: sec.blocks.map((b, bi) => (bi === i ? nb : b)) })
  }

  // Avant d'enregistrer : coordonnées tapées à la main remplacées par leur champ (avec accord), traces d'un autre
  // organisme signalées. Renvoie le contenu à enregistrer, ou null si l'utilisateur annule.
  const verifierChamps = async (c) => {
    const enDur = valeursEnDurPartout(c.sections, ctx)
    const aRemplacer = enDur.filter((x) => x.champ)
    const aCorriger = enDur.filter((x) => !x.champ)
    let out = c
    if (aRemplacer.length) {
      const ok = await confirmer(`Coordonnées tapées à la main : ${aRemplacer.map((x) => `« ${x.texte} »`).join(', ')}.\n\nLes remplacer par les champs remplis depuis Paramètres ? Ainsi, une coordonnée qui change se met à jour dans tous les documents.`)
      if (ok) out = { ...c, sections: remplacerEnDurPartout(c.sections, ctx) }
    }
    if (aCorriger.length) toast(`À corriger à la main : ${aCorriger.map((x) => `« ${x.texte} »`).join(', ')} (identité d'un autre organisme).`, { duration: 8000, icon: '⚠️' })
    return out
  }
  const moveBlock = (i, d) => {
    const arr = [...sec.blocks]; const j = i + d
    if (j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]; setSec({ blocks: arr })
  }
  const addSection = () => {
    const id = `s-${Date.now().toString(36)}`
    setContent((c) => ({ ...c, sections: [...c.sections, { id, title: `${c.sections.filter((s) => s.title).length + 1}. Nouvelle section`, blocks: [{ t: 'p', text: '' }] }] }))
    setActive(id); setMode('modifier')
  }
  const removeSection = async () => {
    if (!await confirmer(`Retirer la section « ${sec.title || 'Introduction'} » de ce document ?`)) return
    const rest = content.sections.filter((s) => s.id !== sec.id)
    setContent((c) => ({ ...c, sections: rest })); setActive(rest[0]?.id)
  }

  const close = async () => { if (dirty && !await confirmer('Des modifications ne sont pas enregistrées. Fermer quand même ?')) return; onClose() }

  const persist = async (next) => {
    const { error } = await supabase.from('quality_documents').upsert({
      doc_id: tpl.id, code: tpl.code, name: tpl.name, content: next, version: String(next.version || 0),
      updated_at: new Date().toISOString(), updated_by: profile?.id || null,
    }, { onConflict: 'doc_id' })
    if (error) throw error
    initial.current = JSON.stringify(next)
    setContent(next)
    onSaved(tpl.id, next)
  }

  const saveDraft = async () => {
    setBusy('save')
    try { const c = await verifierChamps(content); await persist({ ...c, status: 'brouillon' }); toast.success('Brouillon enregistré') } catch (e) { toast.error(e.message) }
    setBusy(null)
  }

  const validate = async () => {
    if (!motif.trim()) { toast.error('Indiquez le motif de cette version'); return }
    setBusy('validate')
    try {
      const verifie = await verifierChamps(content)
      const today = todayIso()
      const nextReview = plusOneYear(today)
      const { error } = await supabase.from('quality_doc_versions').insert({
        doc_id: tpl.id, version: nextVersion, content: { sections: verifie.sections, options: verifie.options || {} },
        motif: motif.trim(), validated_by: profile?.id || null, validated_by_name: currentUserName() || null, next_review: nextReview,
      })
      if (error) throw error
      await persist({ ...verifie, status: 'valide', version: nextVersion, validated_at: today, next_review: nextReview, motif: null })
      await loadHistory()
      setValidating(false); setMotif('')
      toast.success(`Version ${nextVersion} validée`)
    } catch (e) { toast.error(e.message) }
    setBusy(null)
  }

  const pdf = async (versionRow = null) => {
    setBusy('pdf')
    try {
      const ORG = await loadPdfOrg(true)
      const c = versionRow
        ? { ...versionRow.content, status: 'valide', version: versionRow.version, validated_at: versionRow.validated_at, next_review: versionRow.next_review }
        : content
      const hist = versionRow ? history.filter((h) => h.version <= versionRow.version) : history
      const r = buildRichDocPDF(ORG, { tpl, code, content: c, ctx, history: hist })
      r.doc.save(r.filename)
    } catch (e) { console.error(e); toast.error('PDF impossible') }
    setBusy(null)
  }

  // Relecture par l'avocat (24/10) : export Word, réimport de la version relue, comparaison, brouillon
  const [relue, setRelue] = useState(null) // { sections, changes, fichier }
  const exporterWord = async () => {
    setBusy('word')
    try {
      const blob = await exportDocx({ tpl, content, code })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${code || tpl.id} ${tpl.name}${content.version ? ` v${content.version}` : ''}.docx`.replace(/[\\/:*?"<>|]+/g, '-')
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch (e) { toast.error(e.message || 'Export impossible') }
    setBusy(null)
  }
  const importerWord = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy('import')
    try {
      const imp = await importDocx(await f.arrayBuffer(), content.sections)
      setRelue({ sections: imp.sections, changes: comparerSections(content.sections, imp.sections), fichier: f.name })
    } catch (err) { toast.error(err.message || 'Fichier illisible') }
    setBusy(null)
  }
  const appliquerRelue = async () => {
    setBusy('save')
    try {
      await persist({ ...content, sections: relue.sections, status: 'brouillon', motif: `Relecture de l'avocat (${relue.fichier}), importée le ${frDate(todayIso())}` })
      setRelue(null)
      toast.success('Version relue enregistrée en brouillon : vérifiez-la, puis validez-la pour qu\'elle parte avec les devis.')
    } catch (err) { toast.error(err.message) }
    setBusy(null)
  }

  // Lancement de la relecture : le brouillon en cours est d'abord enregistré, c'est lui que l'équipe relit
  const avantLancement = async () => {
    if (!dirty) return content
    const c = await verifierChamps(content)
    await persist({ ...c, status: 'brouillon' })
    return c
  }

  const copyField = async (f) => {
    if (!f) return
    try { await navigator.clipboard.writeText(f); toast.success('Champ copié : collez-le dans le texte') } catch { toast(f) }
  }

  const fiche = (
    <div className="space-y-5">
      <section>
        <h2 className="font-semibold text-ui mb-1">Fiche du document</h2>
        <KV k="Code" v={code} />
        <KV k="Indicateurs" v={(tpl.indicators || []).join(', ') || 'Exigence légale'} />
        {tpl.pilote && <KV k="Pilote" v={tpl.pilote.replace(/^le |^la /, '')} />}
        <KV k="Version en vigueur" v={content.version ? `v${content.version} du ${frDate(history[0]?.validated_at || content.validated_at)}` : 'Aucune'} />
        <KV k="Prochaine revue" v={content.next_review ? frDate(content.next_review) : '-'} />
        {tpl.scope && <p className="text-ui-sm text-gray-500 pt-2">{tpl.scope}</p>}
      </section>
      {(tpl.sections || []).some((s) => s.cond === 'particuliers') && (
        <section>
          <h2 className="font-semibold text-ui mb-1">Options</h2>
          <label className="flex items-start gap-2 text-ui-sm min-h-[40px]">
            <input type="checkbox" className="w-4 h-4 mt-0.5" disabled={!canEdit} checked={!!content.options?.particuliers} onChange={(e) => setContent((c) => ({ ...c, options: { ...(c.options || {}), particuliers: e.target.checked } }))} />
            <span>Clients particuliers : affiche ici les articles qui leur sont réservés (rétractation, garanties légales, médiation de la consommation). Sur un devis, la bonne variante est jointe toute seule selon le client. Renseignez le médiateur avant de valider.</span>
          </label>
        </section>
      )}
      <CircuitDocument tpl={tpl} avantLancement={avantLancement} onMode={(mode, ouvert) => setCircuit({ mode, ouvert })} />
      {(tpl.family === 'commerce' || String(tpl.id).startsWith('cgv')) && (
        <section>
          <h2 className="font-semibold text-ui mb-1">Relecture hors circuit (secours)</h2>
          <p className="text-ui-sm text-gray-500 mb-2">Exportez en Word, faites relire, puis importez la version relue : l'outil montre chaque changement avant de l'enregistrer en brouillon. Le circuit de validation ci-dessus fait la même chose en gardant la trace de chaque avis.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy === 'word'} onClick={exporterWord}>{busy === 'word' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}Exporter en Word</button>
            {canEdit && (
              <label className="btn btn-secondary btn-sm cursor-pointer">{busy === 'import' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}Importer la version relue
                <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={importerWord} />
              </label>
            )}
          </div>
        </section>
      )}
      <section>
        <h2 className="font-semibold text-ui mb-1">Diffusion</h2>
        {[['equipe', 'Équipe'], ['formateurs', 'Formateurs et sous-traitants'], ['portail', 'Portail stagiaire']].map(([k, l]) => (
          <label key={k} className="flex items-center gap-2 text-ui-sm min-h-[36px]">
            <input type="checkbox" className="w-4 h-4" disabled={!canEdit} checked={!!content.diffusion?.[k]} onChange={(e) => setContent((c) => ({ ...c, diffusion: { ...(c.diffusion || {}), [k]: e.target.checked } }))} />{l}
          </label>
        ))}
      </section>
      {(gaps.length > 0 || missing.length > 0) && (
        <section className="rounded-ui-sm bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] p-3 space-y-1.5">
          <h2 className="font-semibold text-ui flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-[rgb(var(--c-warning))]" />À compléter</h2>
          {missing.length > 0 && <p className="text-ui-sm">Rôle non désigné : {missing.map((c) => ctx?.role?.[c]?.label || c).join(', ')}. Paramètres, Qualité.</p>}
          {gaps.length > 0 && <p className="text-ui-sm">{gaps.length} passage{gaps.length > 1 ? 's' : ''} entre crochets : {[...new Set(gaps.map((g) => g.gap))].slice(0, 6).join(', ')}{gaps.length > 6 ? '...' : ''}</p>}
        </section>
      )}
      <section>
        <h2 className="font-semibold text-ui mb-1">Historique</h2>
        {dirty || content.status === 'brouillon' ? <div className="py-1.5 border-b border-gray-100 text-ui-sm"><strong>v{nextVersion} brouillon</strong>{dirty && <span className="text-[rgb(var(--c-warning))]"> (non enregistré)</span>}</div> : null}
        {history.map((h) => (
          <div key={h.id} className="py-1.5 border-b border-gray-100 text-ui-sm flex items-start gap-2">
            <div className="flex-1"><strong>v{h.version} validée le {frDate(h.validated_at)}</strong><div className="text-gray-500">{[h.motif, h.validated_by_name].filter(Boolean).join(' · ')}</div></div>
            <button type="button" className="h-8 w-8 flex items-center justify-center text-gray-600 hover:text-gray-900" aria-label={`PDF de la version ${h.version}`} onClick={() => pdf(h)}><Download className="w-4 h-4" /></button>
          </div>
        ))}
        {!history.length && <p className="text-ui-sm text-gray-500 py-1.5">Modèle de l'outil, jamais validé.</p>}
      </section>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col" role="dialog" aria-modal="true" aria-label={tpl.name}>
      <header className="bg-white border-b border-gray-200 px-2 sm:px-4 py-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={close} className="h-11 w-11 flex items-center justify-center rounded-ui-sm hover:bg-gray-100" aria-label="Fermer"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex-1 min-w-[180px]">
          <div className="text-ui-sm text-gray-500">{code}</div>
          <h1 className="font-semibold text-base sm:text-lg leading-tight flex flex-wrap items-center gap-2">{tpl.name}<StatusChip status={dirty ? { label: 'Modifié', tone: 'blue' } : status} /></h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-ui-sm bg-gray-100 p-0.5" role="group" aria-label="Mode">
            <button type="button" className={`h-9 px-3 rounded-ui-sm text-ui-sm font-semibold flex items-center gap-1.5 ${mode === 'lire' ? 'bg-white shadow-sm' : 'text-gray-600'}`} onClick={() => setMode('lire')}><Eye className="w-4 h-4" />Lire</button>
            {canEdit && !circuit.ouvert && <button type="button" className={`h-9 px-3 rounded-ui-sm text-ui-sm font-semibold flex items-center gap-1.5 ${mode === 'modifier' ? 'bg-white shadow-sm' : 'text-gray-600'}`} onClick={() => setMode('modifier')}><Pencil className="w-4 h-4" />Modifier</button>}
          </div>
          <button type="button" className="btn btn-secondary xl:hidden" onClick={() => setShowFiche(true)}><Info className="w-4 h-4" />Fiche</button>
          <button type="button" className="btn btn-secondary" disabled={busy === 'pdf'} onClick={() => pdf()}>{busy === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}Aperçu PDF</button>
          {canEdit && dirty && <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={saveDraft}>{busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Enregistrer le brouillon</button>}
          {canValidate && circuit.mode === 'direct' && (dirty || content.status !== 'valide') && <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => setValidating(true)}><CheckCircle className="w-4 h-4" />Valider la version {nextVersion}</button>}
          {circuit.ouvert && <a href={`#/relectures/${circuit.ouvert.id}`} className="btn btn-primary"><CheckCircle className="w-4 h-4" />Relecture en cours</a>}
        </div>
      </header>

      <div className="flex-1 min-h-0 flex gap-4 p-2 sm:p-4">
        <nav aria-label="Sommaire" className="hidden md:flex w-60 shrink-0 flex-col card p-2 overflow-y-auto">
          <span className="text-ui-sm font-semibold text-gray-500 px-2 py-1.5">SOMMAIRE</span>
          {content.sections.map((s) => {
            const changed = sectionChanged(s, tpl)
            const hidden = s.cond && !(s.cond === 'particuliers' && content.options?.particuliers)
            return (
              <button key={s.id} type="button" onClick={() => { setActive(s.id); if (mode === 'lire') document.getElementById(`sec-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                className={`text-left min-h-[34px] px-2 py-1 rounded-ui-sm text-ui-sm flex items-center gap-2 ${active === s.id ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'} ${hidden ? 'opacity-50' : ''}`}>
                <span className="flex-1">{s.title || 'Introduction'}</span>
                {changed && <span className="w-2 h-2 rounded-full bg-primary-500 shrink-0" title="Modifiée par rapport au modèle" aria-label="modifiée" />}
              </button>
            )
          })}
          {canEdit && <button type="button" onClick={addSection} className="mt-2 text-left px-2 min-h-[34px] text-ui-sm font-semibold text-primary-600 flex items-center gap-1.5"><Plus className="w-4 h-4" />Ajouter une section</button>}
        </nav>

        <main className="flex-1 min-w-0 card p-4 sm:p-6 overflow-y-auto">
          <div className="md:hidden mb-3">
            <label className="label" htmlFor="rd-sommaire">Section</label>
            <select id="rd-sommaire" className="select w-full" value={active} onChange={(e) => { setActive(e.target.value); if (mode === 'lire') document.getElementById(`sec-${e.target.value}`)?.scrollIntoView({ block: 'start' }) }}>
              {content.sections.map((s) => <option key={s.id} value={s.id}>{s.title || 'Introduction'}</option>)}
            </select>
          </div>

          {mode === 'lire' && (
            <div className="space-y-6 max-w-4xl">
              {sections.map((s) => (
                <section key={s.id} id={`sec-${s.id}`} className="space-y-3 scroll-mt-4">
                  {s.title && <h2 className="font-semibold text-lg text-gray-900">{s.title}</h2>}
                  {s.blocks.map((b, i) => <BlockView key={i} b={b} ctx={ctx} />)}
                </section>
              ))}
            </div>
          )}

          {mode === 'modifier' && sec && (
            <div className="space-y-4 max-w-4xl">
              <div className="flex flex-wrap items-center gap-2">
                <input className="input flex-1 min-w-[200px] font-semibold" value={sec.title} placeholder="Introduction (sans titre)" onChange={(e) => setSec({ title: e.target.value })} aria-label="Titre de la section" />
                {sectionChanged(sec, tpl) && (tpl.sections || []).some((s) => s.id === sec.id) && (
                  <button type="button" className="btn btn-secondary" onClick={async () => { if (await confirmer('Remettre cette section dans son état du modèle ?')) setContent((c) => resetSection(c, sec.id, tpl)) }}><RotateCcw className="w-4 h-4" />Revenir au modèle</button>
                )}
                <button type="button" className="h-10 w-10 flex items-center justify-center text-gray-500 hover:text-[rgb(var(--c-danger))]" aria-label="Retirer la section" onClick={removeSection}><Trash2 className="w-4 h-4" /></button>
              </div>
              {sec.cond === 'particuliers' && <p className="text-ui-sm text-[rgb(var(--c-warning))] bg-[rgb(var(--c-warning-bg))] rounded-ui-sm p-2">Section publiée seulement si l'option « Vente aux particuliers » est cochée dans la fiche.</p>}

              {sec.blocks.map((b, i) => (
                <div key={i} className="border border-gray-200 rounded-ui-sm p-3 space-y-2">
                  <div className="flex items-center gap-1">
                    <span className="text-ui-sm font-semibold text-gray-500 flex-1">{BLOCK_LABEL[b.t] || b.t}</span>
                    <button type="button" className="h-8 w-8 flex items-center justify-center text-gray-500 hover:text-gray-900 disabled:opacity-30" disabled={i === 0} aria-label="Monter" onClick={() => moveBlock(i, -1)}><ArrowUp className="w-4 h-4" /></button>
                    <button type="button" className="h-8 w-8 flex items-center justify-center text-gray-500 hover:text-gray-900 disabled:opacity-30" disabled={i === sec.blocks.length - 1} aria-label="Descendre" onClick={() => moveBlock(i, 1)}><ArrowDown className="w-4 h-4" /></button>
                    <button type="button" className="h-8 w-8 flex items-center justify-center text-gray-500 hover:text-[rgb(var(--c-danger))]" aria-label="Supprimer le bloc" onClick={() => setSec({ blocks: sec.blocks.filter((_, bi) => bi !== i) })}><X className="w-4 h-4" /></button>
                  </div>
                  <BlockEdit b={b} onChange={(nb) => setBlock(i, nb)} />
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
                {['p', 'ul', 'table', 'note', 'h', 'check'].map((t) => (
                  <button key={t} type="button" className="btn btn-secondary btn-sm" onClick={() => setSec({ blocks: [...sec.blocks, emptyBlock(t)] })}><Plus className="w-4 h-4" />{BLOCK_LABEL[t]}</button>
                ))}
                <select className="select w-auto" value="" onChange={(e) => copyField(e.target.value)} aria-label="Insérer un champ rempli automatiquement">
                  <option value="">Insérer un champ...</option>
                  {insertableFields(ctx).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <p className="text-ui-sm text-gray-500">Texte en gras : entourez-le de deux astérisques, **comme ceci**. Les champs entre accolades sont remplis à l'affichage ; les passages entre crochets restent à compléter.</p>
            </div>
          )}
        </main>

        <aside className="hidden xl:block w-80 shrink-0 card p-4 overflow-y-auto">{fiche}</aside>
      </div>

      {showFiche && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex justify-end xl:hidden" onClick={() => setShowFiche(false)}>
          <div className="bg-white w-full max-w-sm h-full p-4 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end"><button type="button" className="h-10 w-10 flex items-center justify-center" aria-label="Fermer la fiche" onClick={() => setShowFiche(false)}><X className="w-5 h-5" /></button></div>
            {fiche}
          </div>
        </div>
      )}

      {relue && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="titre-relue">
          <div className="bg-white rounded-ui w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-gray-100">
              <h2 id="titre-relue" className="font-semibold text-lg">Version relue : {relue.fichier}</h2>
              <p className="text-ui-sm text-gray-600">{relue.changes.filter((c) => c.type !== 'identique').length} article{relue.changes.filter((c) => c.type !== 'identique').length > 1 ? 's' : ''} changé{relue.changes.filter((c) => c.type !== 'identique').length > 1 ? 's' : ''} sur {relue.changes.length}. En vert ce qui est ajouté, en rouge barré ce qui est retiré.</p>
            </div>
            <div className="p-5 overflow-y-auto space-y-3">
              {relue.changes.filter((c) => c.type !== 'identique').map((c, i) => (
                <div key={i} className="border border-gray-200 rounded-ui-sm p-3">
                  <p className="font-semibold text-ui">{c.type === 'ajout' ? 'Article ajouté : ' : c.type === 'retrait' ? 'Article retiré : ' : ''}{c.title || 'Introduction'}{c.cond ? ` [${c.cond}]` : ''}{c.titreAvant ? <span className="text-gray-500 font-normal"> (avant : {c.titreAvant})</span> : null}{c.condChange ? <span className="text-[rgb(var(--c-warning))] font-normal"> (destinataire changé)</span> : null}</p>
                  <p className="text-ui-sm leading-relaxed whitespace-pre-wrap mt-1">
                    {(c.diff || []).map((d, j) => (
                      <span key={j} className={d.t === '+' ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : d.t === '-' ? 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))] line-through' : 'text-gray-700'}>{d.s}</span>
                    ))}
                  </p>
                </div>
              ))}
              {relue.changes.every((c) => c.type === 'identique') && <p className="text-ui text-gray-600">Aucun changement par rapport au document actuel.</p>}
            </div>
            <div className="p-4 border-t border-gray-100 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setRelue(null)}>Annuler</button>
              <button type="button" className="btn btn-primary" disabled={busy === 'save' || !canEdit || relue.changes.every((c) => c.type === 'identique')} onClick={appliquerRelue}>{busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Enregistrer en brouillon</button>
            </div>
          </div>
        </div>
      )}

      {validating && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-ui w-full max-w-lg p-5 space-y-3">
            <h2 className="font-semibold text-lg">Valider la version {nextVersion}</h2>
            <p className="text-ui-sm text-gray-600">Le texte est figé avec la date, votre nom et le motif. Il devient la version en vigueur et sa prochaine revue est fixée à un an. Les versions précédentes restent consultables.</p>
            {(gaps.length > 0 || missing.length > 0) && (
              <div className="rounded-ui-sm bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] p-3 text-ui-sm space-y-1">
                {missing.length > 0 && <p>Rôle non désigné : {missing.map((c) => ctx?.role?.[c]?.label || c).join(', ')}.</p>}
                {gaps.length > 0 && <p>{gaps.length} passage{gaps.length > 1 ? 's' : ''} entre crochets à compléter (sauf s'il s'agit de champs laissés à remplir à la main).</p>}
              </div>
            )}
            <label className="block"><span className="label">Motif de cette version</span>
              <textarea className="input w-full" rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder={content.version ? 'Ce qui change par rapport à la version précédente' : 'Première version'} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setValidating(false)}>Annuler</button>
              <button type="button" className="btn btn-primary" disabled={busy === 'validate'} onClick={validate}>{busy === 'validate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}Valider</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

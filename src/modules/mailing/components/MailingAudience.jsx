// src/components/mailing/MailingAudience.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Mailing - Sélection des destinataires (1 ligne = 1 adresse e-mail)
//
//   • Source : vue mailing_audience_v (prospects + fiches CRM + clients + contacts)
//   • Filtres combinables, tri, pagination réglable
//   • Sélection : case, Maj+clic (plage), « tout sélectionner » (tous les filtrés)
//   • Exclusions visibles : désabonnés / bloqués / invalides (bloquants),
//     OF-OPCO partenaires et adresses RGPD (réintégrables à la main)
//   • Concurrents : jamais affichés
//   • Avertissement (non bloquant) si l'adresse a reçu un mail récemment
//   • Segments enregistrés, import d'une liste d'adresses, récapitulatif
//
// value    : Map(email → ligne d'audience, avec _forced = true si réintégrée)
// onChange : (nouvelle Map) => void
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../../core/supabase'
import {
  loadMailingExclusions, getAudienceExclusion, EXCLUSION_LABELS, SOFT_EXCLUSIONS,
  FLAG_LABELS, normEmail, normNaf,
} from '../lib/mailingExclusions'
import {
  Loader2, Search, X, Save, FolderOpen, Trash2, Upload, ChevronLeft, ChevronRight,
  AlertTriangle, RefreshCw, SlidersHorizontal,
} from 'lucide-react'
import toast from 'react-hot-toast'

const DEPARTEMENTS = {
  '22': "Côtes-d'Armor", '29': 'Finistère', '35': 'Ille-et-Vilaine', '56': 'Morbihan',
  '44': 'Loire-Atlantique', '49': 'Maine-et-Loire', '53': 'Mayenne', '72': 'Sarthe', '85': 'Vendée',
}

const EFFECTIFS = [
  { code: '01', label: '1-2' }, { code: '02', label: '3-5' }, { code: '03', label: '6-9' },
  { code: '11', label: '10-19' }, { code: '12', label: '20-49' }, { code: '21', label: '50-99' },
  { code: '22', label: '100-199' }, { code: '31', label: '200-249' }, { code: '32', label: '250-499' },
  { code: '41', label: '500-999' }, { code: '42', label: '1 000-1 999' }, { code: '51', label: '2 000-4 999' },
  { code: '52', label: '5 000-9 999' }, { code: '53', label: '10 000+' },
  { code: '__none', label: 'Non renseigné' },
]

// Préfixes NAF sans point (les NAF sont normalisés dans la vue)
const SECTEURS = [
  { code: '5530', label: 'Campings' }, { code: '5510', label: 'Hôtels' }, { code: '56', label: 'Restauration' },
  { code: '10', label: 'Agroalimentaire' }, { code: '41', label: 'Bâtiment' }, { code: '43', label: 'Travaux spécialisés' },
  { code: '49', label: 'Transport' }, { code: '52', label: 'Logistique' }, { code: '47', label: 'Commerce détail' },
  { code: '46', label: 'Commerce gros' }, { code: '81', label: 'Services bâtiment' }, { code: '93', label: 'Sport & loisirs' },
  { code: '86', label: 'Santé' }, { code: '87', label: 'Hébergement médico-social' }, { code: '88', label: 'Action sociale' },
  { code: '84', label: 'Administration' },
]

const SOURCES = [
  { v: 'prospect', l: 'Prospects' },
  { v: 'crm',      l: 'Prospects CRM' },
  { v: 'client',   l: 'Clients' },
  { v: 'contact',  l: 'Contacts clients' },
]

const STATUT_LABELS = {
  __none: 'Jamais appelé', a_appeler: 'À appeler', a_rappeler: 'À rappeler', rdv_pris: 'RDV pris',
  pas_interesse: 'Pas intéressé', ne_pas_rappeler: 'Ne pas rappeler', deja_client: 'Déjà client',
  redirige: 'Redirigé', numero_errone: 'Numéro erroné',
}

export const EMPTY_AUDIENCE_FILTERS = {
  q: '', sources: [], deps: [], effectifs: [], secteurs: [], etiquettes: [], statuts: [],
  mailed: 'tous', sinceDays: 30, campaignIn: '', campaignNotIn: '', replied: 'tous',
  includePartners: false, includeRgpd: false, showExcluded: false, onlyVerify: false,
}

const RECENT_DAYS = 30
const PAGE_SIZES = [50, 100, 200, 0] // 0 = tout

async function fetchAudience() {
  const cols = 'email, display_name, send_source, source_id, city, nb_lignes, source_types, noms, villes, departements, nafs, effectifs, etiquettes, statuts_prospection, statuts_client, types_client, do_not_mail, prenom, nom, civilite, email_status, email_flags, blocage, last_sent_at, nb_campagnes, campagnes, last_replied_at'
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('mailing_audience_v').select(cols).order('email').range(from, from + 999)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return all
}

const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : ''

function Chip({ active, onClick, children, color = 'blue' }) {
  const on = {
    blue: 'bg-blue-600 text-white border-blue-600',
    green: 'bg-green-600 text-white border-green-600',
    purple: 'bg-purple-600 text-white border-purple-600',
    gray: 'bg-gray-800 text-white border-gray-800',
  }[color]
  return (
    <button type="button" onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${active ? on : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
      {children}
    </button>
  )
}

const toggleIn = (arr, v) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]

export default function MailingAudience({ value, onChange, campaigns = [], filters, onFiltersChange, user, preselectEmails = null }) {
  const [rows, setRows] = useState([])
  const [excl, setExcl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState('nom')
  const [pageSize, setPageSize] = useState(100)
  const [page, setPage] = useState(0)
  const [showFilters, setShowFilters] = useState(true)
  const [segments, setSegments] = useState([])
  const [showImport, setShowImport] = useState(false)
  const [showSegments, setShowSegments] = useState(false)
  const [importText, setImportText] = useState('')
  const lastClick = useRef(null)
  const preselectDone = useRef(false)

  const f = filters || EMPTY_AUDIENCE_FILTERS
  const setF = (patch) => { onFiltersChange?.({ ...f, ...patch }); setPage(0) }

  useEffect(() => { reload(); loadSegments() }, [])

  async function reload() {
    setLoading(true)
    try {
      const [aud, ex] = await Promise.all([fetchAudience(), loadMailingExclusions()])
      setRows(aud)
      setExcl(ex)
    } catch (e) {
      toast.error('Erreur chargement des destinataires : ' + e.message)
    }
    setLoading(false)
  }

  async function loadSegments() {
    const { data } = await supabase.from('mailing_segments').select('*').order('name')
    setSegments(data || [])
  }

  // ── Motif d'exclusion par adresse ──
  const withReason = useMemo(() => {
    if (!excl) return []
    const opts = { includePartners: f.includePartners, includeRgpd: f.includeRgpd }
    const out = []
    for (const r of rows) {
      const reason = getAudienceExclusion(r, excl, opts)
      if (reason === 'hidden') continue
      out.push({ ...r, _reason: reason })
    }
    return out
  }, [rows, excl, f.includePartners, f.includeRgpd])

  // ── Présélection (duplication / relance des non-répondants) ──
  useEffect(() => {
    if (preselectDone.current || !preselectEmails?.length || !withReason.length) return
    preselectDone.current = true
    const wanted = new Set(preselectEmails.map(normEmail))
    const next = new Map(value)
    let added = 0, skipped = 0
    for (const r of withReason) {
      if (!wanted.has(r.email)) continue
      if (r._reason) { skipped++; continue }
      next.set(r.email, r); added++
    }
    onChange(next)
    toast(`${added} destinataire${added > 1 ? 's' : ''} repris${skipped ? ` · ${skipped} désormais exclu${skipped > 1 ? 's' : ''}` : ''}`, { icon: '' })
  }, [withReason, preselectEmails])

  // ── Valeurs disponibles pour les filtres ──
  const etiquetteOptions = useMemo(() => {
    const s = new Set(); withReason.forEach(r => (r.etiquettes || []).forEach(e => s.add(e))); return [...s].sort()
  }, [withReason])
  const statutOptions = useMemo(() => {
    const s = new Set(['__none']); withReason.forEach(r => (r.statuts_prospection || []).forEach(e => s.add(e))); return [...s]
  }, [withReason])
  const depOptions = useMemo(() => {
    const s = new Set(Object.keys(DEPARTEMENTS)); withReason.forEach(r => (r.departements || []).forEach(d => s.add(d))); return [...s].sort()
  }, [withReason])

  // ── Filtrage ──
  const matched = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return withReason.filter(r => {
      if (q) {
        const hay = `${r.email} ${r.display_name || ''} ${(r.noms || []).join(' ')} ${(r.villes || []).join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (f.sources.length && !(r.source_types || []).some(s => f.sources.includes(s))) return false
      if (f.deps.length && !(r.departements || []).some(d => f.deps.includes(d))) return false
      if (f.effectifs.length) {
        const eff = r.effectifs || []
        const ok = f.effectifs.some(c => c === '__none' ? eff.length === 0 : eff.includes(c))
        if (!ok) return false
      }
      if (f.secteurs.length && !(r.nafs || []).some(n => f.secteurs.some(p => normNaf(n).startsWith(p)))) return false
      if (f.etiquettes.length && !(r.etiquettes || []).some(e => f.etiquettes.includes(e))) return false
      if (f.statuts.length) {
        const st = r.statuts_prospection || []
        const ok = f.statuts.some(s => s === '__none' ? st.length === 0 : st.includes(s))
        if (!ok) return false
      }
      if (f.mailed === 'jamais' && r.last_sent_at) return false
      if (f.mailed === 'deja' && !r.last_sent_at) return false
      if (f.mailed === 'pas_depuis' && r.last_sent_at && daysSince(r.last_sent_at) < Number(f.sinceDays || 0)) return false
      if (f.campaignIn && !(r.campagnes || []).includes(f.campaignIn)) return false
      if (f.campaignNotIn && (r.campagnes || []).includes(f.campaignNotIn)) return false
      if (f.replied === 'oui' && !r.last_replied_at) return false
      if (f.replied === 'non' && r.last_replied_at) return false
      if (f.onlyVerify && r.email_status !== 'a_verifier') return false
      return true
    })
  }, [withReason, f])

  const excludedCounts = useMemo(() => {
    const c = {}
    matched.forEach(r => { if (r._reason) c[r._reason] = (c[r._reason] || 0) + 1 })
    return c
  }, [matched])

  const isSelectable = (r) => !r._reason || SOFT_EXCLUSIONS.includes(r._reason)

  const visible = useMemo(() => {
    const list = f.showExcluded ? matched : matched.filter(r => !r._reason || value.has(r.email))
    const sorted = [...list]
    if (sort === 'nom') sorted.sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), 'fr'))
    if (sort === 'ville') sorted.sort((a, b) => String(a.city || '').localeCompare(String(b.city || ''), 'fr'))
    if (sort === 'dernier') sorted.sort((a, b) => String(a.last_sent_at || '').localeCompare(String(b.last_sent_at || '')))
    if (sort === 'lignes') sorted.sort((a, b) => (b.nb_lignes || 0) - (a.nb_lignes || 0))
    return sorted
  }, [matched, f.showExcluded, sort, value])

  const totalPages = pageSize ? Math.max(1, Math.ceil(visible.length / pageSize)) : 1
  const pageRows = pageSize ? visible.slice(page * pageSize, (page + 1) * pageSize) : visible
  useEffect(() => { if (page >= totalPages) setPage(0) }, [totalPages])

  const selectableMatched = matched.filter(r => !r._reason)
  const selectedInMatched = selectableMatched.filter(r => value.has(r.email)).length

  // ── Sélection ──
  function setSelection(map) { onChange(map) }

  function toggleRow(r, index, shift) {
    if (!isSelectable(r)) return
    const next = new Map(value)
    if (shift && lastClick.current !== null) {
      const [a, b] = [Math.min(lastClick.current, index), Math.max(lastClick.current, index)]
      const target = !value.has(r.email)
      for (let i = a; i <= b; i++) {
        const row = visible[i]
        if (!row || row._reason) continue
        if (target) next.set(row.email, row); else next.delete(row.email)
      }
    } else if (next.has(r.email)) {
      next.delete(r.email)
    } else {
      next.set(r.email, r._reason ? { ...r, _forced: true } : r)
    }
    lastClick.current = index
    setSelection(next)
  }

  function selectAllMatched() {
    const next = new Map(value)
    selectableMatched.forEach(r => next.set(r.email, r))
    setSelection(next)
    toast.success(`${selectableMatched.length} adresse${selectableMatched.length > 1 ? 's' : ''} sélectionnée${selectableMatched.length > 1 ? 's' : ''}`)
  }
  function unselectAllMatched() {
    const next = new Map(value)
    matched.forEach(r => next.delete(r.email))
    setSelection(next)
  }
  function selectPage() {
    const next = new Map(value)
    pageRows.forEach(r => { if (!r._reason) next.set(r.email, r) })
    setSelection(next)
  }

  // ── Import d'une liste ──
  function applyImport() {
    const found = [...new Set((importText.match(/[^\s,;<>()"']+@[^\s,;<>()"']+\.[a-z]{2,}/gi) || []).map(normEmail))]
    if (!found.length) { toast.error('Aucune adresse détectée'); return }
    const byEmail = new Map(withReason.map(r => [r.email, r]))
    const next = new Map(value)
    let added = 0, excluded = 0, unknown = 0
    for (const e of found) {
      const r = byEmail.get(e)
      if (!r) { unknown++; continue }
      if (r._reason) { excluded++; continue }
      next.set(e, r); added++
    }
    setSelection(next)
    setShowImport(false); setImportText('')
    toast.success(`${added} ajoutée${added > 1 ? 's' : ''} · ${excluded} exclue${excluded > 1 ? 's' : ''} · ${unknown} inconnue${unknown > 1 ? 's' : ''} de Campus`, { duration: 6000 })
  }

  // ── Segments ──
  async function saveSegment() {
    const name = prompt('Nom du segment (les filtres actuels sont enregistrés) :')
    if (!name?.trim()) return
    const { error } = await supabase.from('mailing_segments').insert({ name: name.trim(), filters: f, created_by: user?.email || null })
    if (error) { toast.error(error.message); return }
    toast.success('Segment enregistré')
    loadSegments()
  }
  async function deleteSegment(s) {
    if (!confirm(`Supprimer le segment « ${s.name} » ?`)) return
    await supabase.from('mailing_segments').delete().eq('id', s.id)
    loadSegments()
  }
  function applySegment(s) {
    onFiltersChange?.({ ...EMPTY_AUDIENCE_FILTERS, ...(s.filters || {}) })
    setPage(0)
    toast.success(`Segment « ${s.name} » appliqué`)
  }

  // ── Récapitulatif de la sélection ──
  const selection = [...value.values()]
  const recapDeps = useMemo(() => {
    const c = {}
    selection.forEach(r => { const d = (r.departements || [])[0] || '-'; c[d] = (c[d] || 0) + 1 })
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [value])
  const recapSect = useMemo(() => {
    const c = {}
    selection.forEach(r => { const n = normNaf((r.nafs || [])[0] || ''); const k = n ? n.slice(0, 2) : '-'; c[k] = (c[k] || 0) + 1 })
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 12)
  }, [value])
  const recentCount = selection.filter(r => r.last_sent_at && daysSince(r.last_sent_at) < RECENT_DAYS).length
  const forcedCount = selection.filter(r => r._forced).length

  function removeWhere(pred, label) {
    const next = new Map(value)
    let n = 0
    for (const [k, r] of next) if (pred(r)) { next.delete(k); n++ }
    setSelection(next)
    toast(`${n} retiré${n > 1 ? 's' : ''} (${label})`)
  }

  const activeFilterCount = ['sources', 'deps', 'effectifs', 'secteurs', 'etiquettes', 'statuts'].reduce((s, k) => s + (f[k]?.length ? 1 : 0), 0)
    + (f.mailed !== 'tous' ? 1 : 0) + (f.campaignIn ? 1 : 0) + (f.campaignNotIn ? 1 : 0) + (f.replied !== 'tous' ? 1 : 0) + (f.q ? 1 : 0)

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-3">
      {/* ── Barre du haut ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={f.q} onChange={e => setF({ q: e.target.value })}
            placeholder="Entreprise, adresse, ville…"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button onClick={() => setShowFilters(s => !s)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border ${showFilters ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
          <SlidersHorizontal className="w-4 h-4" /> Filtres{activeFilterCount > 0 && ` (${activeFilterCount})`}
        </button>
        <div className="relative">
          <button onClick={() => setShowSegments(s => !s)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50">
            <FolderOpen className="w-4 h-4" /> Segments{segments.length > 0 && ` (${segments.length})`}
          </button>
          {showSegments && (
          <div className="absolute right-0 top-full mt-1 w-72 bg-white border rounded-lg shadow-lg z-20">
            <button onClick={() => { setShowSegments(false); saveSegment() }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 border-b">
              <Save className="w-4 h-4 text-blue-600" /> Enregistrer les filtres actuels
            </button>
            {segments.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">Aucun segment</p>}
            {segments.map(s => (
              <div key={s.id} className="flex items-center hover:bg-gray-50">
                <button onClick={() => { setShowSegments(false); applySegment(s) }} className="flex-1 text-left px-3 py-2 text-sm truncate">{s.name}</button>
                <button onClick={() => deleteSegment(s)} className="px-2 text-gray-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
          )}
        </div>
        <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50">
          <Upload className="w-4 h-4" /> Coller une liste
        </button>
        <button onClick={reload} title="Recharger" className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── Filtres ── */}
      {showFilters && (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 space-y-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-24 text-gray-500 font-medium">Source</span>
            {SOURCES.map(s => <Chip key={s.v} active={f.sources.includes(s.v)} onClick={() => setF({ sources: toggleIn(f.sources, s.v) })}>{s.l}</Chip>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-24 text-gray-500 font-medium">Département</span>
            {depOptions.map(d => <Chip key={d} active={f.deps.includes(d)} onClick={() => setF({ deps: toggleIn(f.deps, d) })}>{d}{DEPARTEMENTS[d] ? ` ${DEPARTEMENTS[d]}` : ''}</Chip>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-24 text-gray-500 font-medium">Secteur</span>
            {SECTEURS.map(s => <Chip key={s.code} color="green" active={f.secteurs.includes(s.code)} onClick={() => setF({ secteurs: toggleIn(f.secteurs, s.code) })}>{s.label}</Chip>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-24 text-gray-500 font-medium">Effectif</span>
            {EFFECTIFS.map(e => <Chip key={e.code} active={f.effectifs.includes(e.code)} onClick={() => setF({ effectifs: toggleIn(f.effectifs, e.code) })}>{e.label}</Chip>)}
          </div>
          {etiquetteOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-24 text-gray-500 font-medium">Liste importée</span>
              {etiquetteOptions.map(e => <Chip key={e} color="purple" active={f.etiquettes.includes(e)} onClick={() => setF({ etiquettes: toggleIn(f.etiquettes, e) })}> {e}</Chip>)}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-24 text-gray-500 font-medium">Phoning</span>
            {statutOptions.map(s => <Chip key={s} color="gray" active={f.statuts.includes(s)} onClick={() => setF({ statuts: toggleIn(f.statuts, s) })}>{STATUT_LABELS[s] || s}</Chip>)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-gray-500 font-medium">Mailing</span>
            <select value={f.mailed} onChange={e => setF({ mailed: e.target.value })} className="border rounded-lg px-2 py-1">
              <option value="tous">Tous</option>
              <option value="jamais">Jamais mailés</option>
              <option value="deja">Déjà mailés</option>
              <option value="pas_depuis">Pas mailés depuis…</option>
            </select>
            {f.mailed === 'pas_depuis' && (
              <span className="flex items-center gap-1">
                <input type="number" min="1" value={f.sinceDays} onChange={e => setF({ sinceDays: e.target.value })} className="w-16 border rounded-lg px-2 py-1" /> jours
              </span>
            )}
            <select value={f.campaignIn} onChange={e => setF({ campaignIn: e.target.value })} className="border rounded-lg px-2 py-1 max-w-[220px]">
              <option value="">A reçu la campagne…</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={f.campaignNotIn} onChange={e => setF({ campaignNotIn: e.target.value })} className="border rounded-lg px-2 py-1 max-w-[220px]">
              <option value="">N'a pas reçu la campagne…</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={f.replied} onChange={e => setF({ replied: e.target.value })} className="border rounded-lg px-2 py-1">
              <option value="tous">Réponse : peu importe</option>
              <option value="oui">A déjà répondu</option>
              <option value="non">N'a jamais répondu</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-gray-200">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={f.includePartners} onChange={e => setF({ includePartners: e.target.checked })} /> Inclure les OF / OPCO partenaires
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={f.includeRgpd} onChange={e => setF({ includeRgpd: e.target.checked })} /> Inclure les adresses RGPD
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={f.showExcluded} onChange={e => setF({ showExcluded: e.target.checked })} /> Afficher les exclus
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={f.onlyVerify} onChange={e => setF({ onlyVerify: e.target.checked })} /> Seulement les adresses à vérifier
            </label>
            {activeFilterCount > 0 && (
              <button onClick={() => onFiltersChange?.({ ...EMPTY_AUDIENCE_FILTERS, includePartners: f.includePartners, includeRgpd: f.includeRgpd })}
                className="ml-auto text-red-500 hover:text-red-700">Effacer les filtres</button>
            )}
          </div>
        </div>
      )}

      {/* ── Compteurs ── */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-700"><strong>{selectableMatched.length}</strong> adresse{selectableMatched.length > 1 ? 's' : ''} disponible{selectableMatched.length > 1 ? 's' : ''}</span>
        {Object.keys(excludedCounts).length > 0 && (
          <span className="text-xs text-gray-500">
            · exclues : {Object.entries(excludedCounts).map(([k, n]) => `${EXCLUSION_LABELS[k] || k} ${n}`).join(' · ')}
            {!f.showExcluded && <button onClick={() => setF({ showExcluded: true })} className="ml-1 text-blue-600 underline">voir</button>}
          </span>
        )}
        <div className="flex-1" />
        <button onClick={selectAllMatched} disabled={!selectableMatched.length}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium disabled:opacity-40">
          Tout sélectionner ({selectableMatched.length})
        </button>
        <button onClick={selectPage} className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-medium">
          Sélectionner la page
        </button>
        {selectedInMatched > 0 && (
          <button onClick={unselectAllMatched} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium">
            Désélectionner les filtrés ({selectedInMatched})
          </button>
        )}
      </div>

      {/* ── Tableau ── */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b text-xs text-gray-500">
            <span>Tri :</span>
            {[['nom', 'Nom'], ['ville', 'Ville'], ['dernier', 'Dernier mail'], ['lignes', 'Établissements']].map(([k, l]) => (
              <button key={k} onClick={() => setSort(k)} className={`px-2 py-0.5 rounded ${sort === k ? 'bg-white border font-medium text-gray-800' : 'hover:text-gray-800'}`}>{l}</button>
            ))}
            <span className="ml-auto">Maj + clic = sélection d'une plage</span>
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-gray-50">
                {pageRows.length === 0 && (
                  <tr><td className="px-3 py-8 text-center text-gray-400">Aucune adresse ne correspond</td></tr>
                )}
                {pageRows.map((r, i) => {
                  const index = (pageSize ? page * pageSize : 0) + i
                  const selected = value.has(r.email)
                  const selectable = isSelectable(r)
                  const recent = r.last_sent_at && daysSince(r.last_sent_at) < RECENT_DAYS
                  const hard = r._reason && !SOFT_EXCLUSIONS.includes(r._reason)
                  return (
                    <tr key={r.email}
                      onClick={e => toggleRow(r, index, e.shiftKey)}
                      className={`${selectable ? 'cursor-pointer' : 'cursor-not-allowed'} ${selected ? 'bg-blue-50 hover:bg-blue-100' : hard ? 'bg-gray-50 text-gray-400' : 'hover:bg-gray-50'}`}>
                      <td className="w-8 px-3 py-2 align-top">
                        <input type="checkbox" checked={selected} disabled={!selectable} readOnly
                          className="rounded border-gray-300 text-blue-600" />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className={`font-medium ${hard ? 'text-gray-400' : 'text-gray-900'}`} title={(r.noms || []).join(' / ')}>{r.display_name}</span>
                          {(r.source_types || []).includes('client') && <span className="px-1 rounded bg-green-100 text-green-700 text-[10px]">Client</span>}
                          {(r.source_types || []).includes('contact') && <span className="px-1 rounded bg-green-50 text-green-700 text-[10px]">Contact{r.prenom || r.nom ? ` · ${[r.prenom, r.nom].filter(Boolean).join(' ')}` : ''}</span>}
                          {(r.source_types || []).includes('crm') && <span className="px-1 rounded bg-blue-100 text-blue-700 text-[10px]">CRM</span>}
                          {r.nb_lignes > 1 && <span className="px-1 rounded bg-purple-100 text-purple-700 text-[10px]" title={(r.villes || []).join(', ')}>{r.nb_lignes} fiches · 1 envoi</span>}
                          {r.email_status === 'a_verifier' && <span className="px-1 rounded bg-amber-100 text-amber-700 text-[10px]"> à vérifier</span>}
                          {(r.email_flags || []).filter(x => x === 'service').map(x => <span key={x} className="px-1 rounded bg-gray-100 text-gray-500 text-[10px]">{FLAG_LABELS[x]}</span>)}
                        </div>
                        <div className="text-gray-400 break-all">{r.email}</div>
                      </td>
                      <td className="px-2 py-2 align-top text-gray-500 hidden md:table-cell whitespace-nowrap" title={(r.villes || []).join(', ')}>
                        {r.city || '-'}{(r.villes || []).length > 1 && <span className="text-gray-300"> +{r.villes.length - 1}</span>}
                        {(r.departements || [])[0] && <span className="text-gray-300"> ({r.departements[0]})</span>}
                      </td>
                      <td className="px-2 py-2 align-top text-gray-400 hidden lg:table-cell">{(r.nafs || [])[0] || '-'}</td>
                      <td className="px-2 py-2 align-top text-right whitespace-nowrap">
                        {r._reason ? (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${hard ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-700'}`}>
                            {EXCLUSION_LABELS[r._reason]}{!hard && (selected ? ' · réintégrée' : ' · cliquer pour réintégrer')}
                          </span>
                        ) : r.last_sent_at ? (
                          <span className={`text-[10px] ${recent ? 'text-amber-600 font-medium' : 'text-gray-400'}`} title={`${r.nb_campagnes} campagne(s) reçue(s)`}>
                            {recent && <AlertTriangle className="w-3 h-3 inline -mt-0.5 mr-0.5" />}
                            mailé le {fmtDate(r.last_sent_at)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-300">jamais mailé</span>
                        )}
                        {r.last_replied_at && <div className="text-[10px] text-green-600">↩ a répondu le {fmtDate(r.last_replied_at)}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-t text-xs text-gray-600">
            <span className="flex items-center gap-1">
              Afficher
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }} className="border rounded px-1 py-0.5">
                {PAGE_SIZES.map(n => <option key={n} value={n}>{n || 'Tout'}</option>)}
              </select>
              · {visible.length} ligne{visible.length > 1 ? 's' : ''}
            </span>
            {pageSize > 0 && totalPages > 1 && (
              <span className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                Page {page + 1} / {totalPages}
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Récapitulatif de la sélection ── */}
      {value.size > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-blue-900 text-sm">{value.size} destinataire{value.size > 1 ? 's' : ''} sélectionné{value.size > 1 ? 's' : ''}</strong>
            {recentCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800" title="Avertissement seulement : l'envoi reste possible">
                 {recentCount} déjà mailé{recentCount > 1 ? 's' : ''} il y a moins de {RECENT_DAYS} j
                <button onClick={() => removeWhere(r => r.last_sent_at && daysSince(r.last_sent_at) < RECENT_DAYS, 'mailés récemment')} className="ml-1 underline">retirer</button>
              </span>
            )}
            {forcedCount > 0 && <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-800">{forcedCount} réintégré{forcedCount > 1 ? 's' : ''} à la main</span>}
            <button onClick={() => setSelection(new Map())} className="ml-auto text-red-500 hover:text-red-700">Vider la sélection</button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-gray-500 w-24">Départements</span>
            {recapDeps.map(([d, n]) => (
              <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border">
                {d} : {n}
                <button onClick={() => removeWhere(r => ((r.departements || [])[0] || '-') === d, `département ${d}`)} className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-gray-500 w-24">NAF (division)</span>
            {recapSect.map(([k, n]) => (
              <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border">
                {k} : {n}
                <button onClick={() => removeWhere(r => { const x = normNaf((r.nafs || [])[0] || ''); return (x ? x.slice(0, 2) : '-') === k }, `NAF ${k}`)} className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Import ── */}
      {showImport && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Coller une liste d'adresses</h3>
              <button onClick={() => setShowImport(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <p className="text-xs text-gray-500">Collez des adresses (une par ligne, ou un copier-coller Excel). Seules celles présentes dans Campus et non exclues sont ajoutées.</p>
            <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={10}
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="contact@exemple.fr&#10;rh@entreprise.bzh" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowImport(false)} className="px-4 py-2 text-sm text-gray-600">Annuler</button>
              <button onClick={applyImport} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Ajouter à la sélection</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

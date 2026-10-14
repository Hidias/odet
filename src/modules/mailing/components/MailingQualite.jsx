// src/components/mailing/MailingQualite.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Mailing - Qualité des adresses & liste de blocage
//
// Règles :
//   • Aucune fiche n'est modifiée automatiquement
//   • Correction d'adresse = fiches PROSPECTS uniquement, sur clic, avec aperçu
//   • Adresses clients / contacts : à corriger depuis la fiche client
//   • Une décision manuelle n'est plus modifiée par l'analyse automatique
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'
import { FLAG_LABELS } from '../lib/mailingExclusions'
import {
  ArrowLeft, Loader2, RefreshCw, CheckCircle, XCircle, Pencil, RotateCcw,
  ShieldAlert, Ban, Plus, Trash2, Search, ExternalLink
} from 'lucide-react'
import toast from 'react-hot-toast'

const STATUS_STYLE = {
  ok:         { label: 'OK',          cls: 'bg-green-100 text-green-700' },
  a_verifier: { label: 'À vérifier',  cls: 'bg-amber-100 text-amber-700' },
  invalide:   { label: 'Invalide',    cls: 'bg-red-100 text-red-700' },
}

const CATEGORY_STYLE = {
  desabonne:  { label: 'Désabonné',  cls: 'bg-purple-100 text-purple-700' },
  concurrent: { label: 'Concurrent', cls: 'bg-gray-800 text-white' },
  manuel:     { label: 'Manuel',     cls: 'bg-gray-100 text-gray-700' },
}

const KIND_LABEL = { email: 'Adresse', domaine: 'Domaine', nom: 'Nom contient' }

// Indicateurs purement informatifs (n'apparaissent pas dans « à traiter »)
const INFO_FLAGS = ['multi_siren', 'service', 'rgpd']

export default function MailingQualite({ user, onBack }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState('qualite') // 'qualite' | 'blocage'

  // ── Qualité ──
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [analysing, setAnalysing] = useState(false)
  const [lastRun, setLastRun] = useState(null)
  const [filter, setFilter] = useState('a_traiter') // a_traiter | invalide | a_verifier | info | manuel | tout
  const [flagFilter, setFlagFilter] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // { email, value }
  const [busy, setBusy] = useState(null)

  // ── Blocage ──
  const [blocklist, setBlocklist] = useState([])
  const [loadingBl, setLoadingBl] = useState(true)
  const [blForm, setBlForm] = useState({ kind: 'domaine', value: '', category: 'concurrent', note: '' })
  const [blSearch, setBlSearch] = useState('')

  const by = user?.email || 'admin'

  useEffect(() => { loadStatus(); loadBlocklist() }, [])

  async function loadStatus() {
    setLoading(true)
    // fetchAll : pagination complète ; vue sans colonne id, email unique (clé de mailing_email_status)
    const { data, error } = await fetchAll(() => supabase
      .from('mailing_email_status_v')
      .select('*')
      .or('status.neq.ok,flags.neq.{},manual.eq.true')
      .order('email'), { orderBy: 'email' })
    if (error) toast.error('Erreur chargement : ' + error.message)
    setRows(data || [])
    setLoading(false)
  }

  async function loadBlocklist() {
    setLoadingBl(true)
    const { data, error } = await fetchAll(() => supabase
      .from('mailing_blocklist')
      .select('*')
      .order('created_at', { ascending: false }))
    if (error) toast.error('Erreur liste de blocage : ' + error.message)
    setBlocklist(data || [])
    setLoadingBl(false)
  }

  async function runAnalysis() {
    setAnalysing(true)
    const { data, error } = await supabase.rpc('mailing_refresh_email_status')
    setAnalysing(false)
    if (error) { toast.error('Erreur analyse : ' + error.message); return }
    setLastRun(data)
    toast.success(`Analyse terminée : ${data?.total ?? 0} adresses - ${data?.a_verifier ?? 0} à vérifier, ${data?.invalide ?? 0} invalides`)
    loadStatus()
  }

  // ── Actions qualité ──
  async function setStatus(row, status, note) {
    if (status === 'invalide' && row.is_protected) {
      if (!confirm(`${row.email} est utilisée par un client ou un contact.\n\nElle sera seulement exclue du mailing : la fiche client n'est pas modifiée.\n\nContinuer ?`)) return
    }
    setBusy(row.email)
    const { error } = await supabase
      .from('mailing_email_status')
      .update({ status, manual: true, decided_by: by, decided_at: new Date().toISOString(), note: note ?? row.note ?? null, updated_at: new Date().toISOString() })
      .eq('email', row.email)
    setBusy(null)
    if (error) { toast.error('Erreur : ' + error.message); return }
    toast.success(status === 'ok' ? 'Adresse validée' : 'Adresse invalidée (exclue du mailing)')
    loadStatus()
  }

  async function resetAuto(row) {
    setBusy(row.email)
    const { error } = await supabase
      .from('mailing_email_status')
      .update({ manual: false, decided_by: null, decided_at: null, updated_at: new Date().toISOString() })
      .eq('email', row.email)
    if (error) { setBusy(null); toast.error('Erreur : ' + error.message); return }
    await supabase.rpc('mailing_refresh_email_status')
    setBusy(null)
    toast.success('Décision annulée - statut recalculé automatiquement')
    loadStatus()
  }

  async function applyFix(row) {
    const newEmail = (editing?.value || '').trim()
    if (!newEmail) return
    if (row.is_protected) { toast.error('Adresse de client : à corriger depuis la fiche client'); return }
    const n = row.nb_prospects || 0
    if (!confirm(`Remplacer « ${row.email} » par « ${newEmail.toLowerCase()} » ?\n\nCela modifie ${n} fiche${n > 1 ? 's' : ''} prospect${n > 1 ? 's' : ''} (une note est ajoutée sur chaque fiche).`)) return
    setBusy(row.email)
    const { data, error } = await supabase.rpc('mailing_fix_email', { p_old: row.email, p_new: newEmail, p_by: by })
    setBusy(null)
    if (error) { toast.error(error.message); return }
    toast.success(`${data} fiche${data > 1 ? 's' : ''} corrigée${data > 1 ? 's' : ''}`)
    setEditing(null)
    loadStatus()
  }

  async function blockEmail(row) {
    const note = prompt(`Bloquer ${row.email} pour tous les mailings ?\nMotif (facultatif) :`, '')
    if (note === null) return
    const { error } = await supabase.from('mailing_blocklist').insert({
      kind: 'email', value: row.email, category: 'manuel', note: note || null, created_by: by,
    })
    if (error) { toast.error(error.code === '23505' ? 'Déjà dans la liste de blocage' : error.message); return }
    toast.success('Adresse ajoutée à la liste de blocage')
    loadBlocklist()
  }

  // ── Actions blocage ──
  async function addBlock() {
    let value = blForm.value.trim().toLowerCase()
    if (blForm.kind === 'domaine') value = value.replace(/^.*@/, '').replace(/^www\./, '')
    if (!value) { toast.error('Valeur requise'); return }
    if (blForm.kind === 'email' && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(value)) { toast.error('Adresse invalide'); return }
    if (blForm.kind === 'domaine' && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) { toast.error('Domaine invalide (ex : apave.com)'); return }
    if (blForm.kind === 'nom' && value.length < 3) { toast.error('3 caractères minimum'); return }
    if (blForm.kind === 'domaine' && ['gmail.com', 'orange.fr', 'wanadoo.fr', 'yahoo.fr', 'hotmail.fr', 'hotmail.com', 'outlook.fr', 'free.fr', 'laposte.net', 'sfr.fr'].includes(value)) {
      if (!confirm(`« ${value} » est un webmail utilisé par beaucoup d'entreprises différentes.\nBloquer tout le domaine ?`)) return
    }
    const { error } = await supabase.from('mailing_blocklist').insert({
      kind: blForm.kind, value, category: blForm.category, note: blForm.note.trim() || null, created_by: by,
    })
    if (error) { toast.error(error.code === '23505' ? 'Déjà dans la liste' : error.message); return }
    toast.success('Ajouté à la liste de blocage')
    setBlForm(f => ({ ...f, value: '', note: '' }))
    loadBlocklist()
  }

  async function removeBlock(b) {
    const msg = b.category === 'desabonne'
      ? `${b.value} s'est désabonné(e).\n\nNe le retirer QUE si cette personne a redonné son accord pour recevoir vos mails.\n\nRetirer quand même ?`
      : `Retirer « ${b.value} » de la liste de blocage ?`
    if (!confirm(msg)) return
    const { error } = await supabase.from('mailing_blocklist').delete().eq('id', b.id)
    if (error) { toast.error(error.message); return }
    toast.success('Retiré de la liste')
    loadBlocklist()
  }

  // ── Filtres ──
  const counts = useMemo(() => {
    const c = { a_traiter: 0, invalide: 0, a_verifier: 0, info: 0, manuel: 0, tout: rows.length }
    for (const r of rows) {
      if (r.status === 'invalide') c.invalide++
      if (r.status === 'a_verifier') c.a_verifier++
      if (!r.manual && r.status !== 'ok') c.a_traiter++
      if (r.status === 'ok' && (r.flags || []).some(f => INFO_FLAGS.includes(f))) c.info++
      if (r.manual) c.manuel++
    }
    return c
  }, [rows])

  const flagOptions = useMemo(() => {
    const s = new Set()
    rows.forEach(r => (r.flags || []).forEach(f => s.add(f)))
    return [...s].sort()
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (filter === 'a_traiter' && (r.manual || r.status === 'ok')) return false
      if (filter === 'invalide' && r.status !== 'invalide') return false
      if (filter === 'a_verifier' && r.status !== 'a_verifier') return false
      if (filter === 'info' && !(r.status === 'ok' && (r.flags || []).some(f => INFO_FLAGS.includes(f)))) return false
      if (filter === 'manuel' && !r.manual) return false
      if (flagFilter && !(r.flags || []).includes(flagFilter)) return false
      if (q && !`${r.email} ${r.noms_prospects || ''} ${r.noms_clients || ''} ${r.noms_contacts || ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, filter, flagFilter, search])

  const filteredBl = useMemo(() => {
    const q = blSearch.trim().toLowerCase()
    return blocklist.filter(b => !q || `${b.value} ${b.note || ''}`.toLowerCase().includes(q))
  }, [blocklist, blSearch])

  const clientIdOf = (r) => r.client_id_direct || r.client_id_contact

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">Qualité des adresses</h1>
          <p className="text-sm text-gray-500">Rien n'est modifié automatiquement : chaque correction se fait sur votre clic.</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('qualite')}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'qualite' ? 'bg-blue-600 text-white' : 'border text-gray-600 hover:bg-gray-50'}`}>
          <ShieldAlert className="w-4 h-4 inline mr-1.5 -mt-0.5" />Adresses à vérifier
          {counts.a_traiter > 0 && <span className="ml-2 text-xs bg-white/20 px-1.5 py-0.5 rounded-full">{counts.a_traiter}</span>}
        </button>
        <button onClick={() => setTab('blocage')}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'blocage' ? 'bg-gray-900 text-white' : 'border text-gray-600 hover:bg-gray-50'}`}>
          <Ban className="w-4 h-4 inline mr-1.5 -mt-0.5" />Liste de blocage
          <span className="ml-2 text-xs bg-black/10 px-1.5 py-0.5 rounded-full">{blocklist.length}</span>
        </button>
      </div>

      {/* ═══════════════════ QUALITÉ ═══════════════════ */}
      {tab === 'qualite' && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-4 border-b space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {[
                ['a_traiter', 'À traiter'], ['invalide', 'Invalides'], ['a_verifier', 'À vérifier'],
                ['info', 'Pour info'], ['manuel', 'Décisions manuelles'], ['tout', 'Tout'],
              ].map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border ${filter === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                  {l} ({counts[k]})
                </button>
              ))}
              <div className="flex-1" />
              <button onClick={runAnalysis} disabled={analysing}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-xs font-medium disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${analysing ? 'animate-spin' : ''}`} /> Relancer l'analyse
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Adresse, entreprise…"
                  className="border rounded-lg pl-8 pr-3 py-1.5 text-xs w-56" />
              </div>
              <select value={flagFilter} onChange={e => setFlagFilter(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs">
                <option value="">Tous les motifs</option>
                {flagOptions.map(f => <option key={f} value={f}>{FLAG_LABELS[f] || f}</option>)}
              </select>
              {lastRun && (
                <span className="text-xs text-gray-400">
                  Dernière analyse : {lastRun.total} adresses · {lastRun.ok} OK · {lastRun.a_verifier} à vérifier · {lastRun.invalide} invalides
                </span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-10 text-sm text-gray-400">
              {filter === 'a_traiter' ? ' Rien à traiter' : 'Aucune adresse'}
            </p>
          ) : (
            <div className="divide-y">
              {filtered.map(r => {
                const st = STATUS_STYLE[r.status] || STATUS_STYLE.ok
                const cid = clientIdOf(r)
                const isEditing = editing?.email === r.email
                return (
                  <div key={r.email} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="flex-1 min-w-[240px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-medium text-gray-900 break-all">{r.email}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                          {r.is_protected && <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-100 text-blue-700">Client / contact</span>}
                          {r.manual && <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600" title={r.decided_at ? `Par ${r.decided_by || '?'} le ${new Date(r.decided_at).toLocaleDateString('fr-FR')}` : ''}>Décision manuelle</span>}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(r.flags || []).map(f => (
                            <span key={f} className={`px-1.5 py-0.5 rounded text-[10px] ${INFO_FLAGS.includes(f) ? 'bg-gray-100 text-gray-500' : 'bg-orange-50 text-orange-700'}`}>
                              {FLAG_LABELS[f] || f}
                            </span>
                          ))}
                        </div>
                        <div className="text-xs text-gray-500 mt-1.5 space-y-0.5">
                          {r.noms_prospects && <p> {r.nb_prospects} fiche{r.nb_prospects > 1 ? 's' : ''} prospect : {r.noms_prospects}</p>}
                          {r.noms_clients && <p> Client : {r.noms_clients}</p>}
                          {r.noms_contacts && <p> Contact : {r.noms_contacts}</p>}
                          {r.note && <p className="italic"> {r.note}</p>}
                        </div>
                        {r.suggestion && !isEditing && (
                          <p className="text-xs mt-1.5">
                             Correction proposée : <span className="font-mono font-medium text-green-700">{r.suggestion}</span>
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {r.status !== 'ok' && (
                          <button onClick={() => setStatus(r, 'ok')} disabled={busy === r.email}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-green-50 text-green-700 hover:bg-green-100 rounded-lg disabled:opacity-50">
                            <CheckCircle className="w-3.5 h-3.5" /> Valider
                          </button>
                        )}
                        {r.status !== 'invalide' && (
                          <button onClick={() => setStatus(r, 'invalide')} disabled={busy === r.email}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-red-50 text-red-700 hover:bg-red-100 rounded-lg disabled:opacity-50">
                            <XCircle className="w-3.5 h-3.5" /> Invalider
                          </button>
                        )}
                        {r.is_protected ? (
                          cid && (
                            <button onClick={() => navigate(`/clients/${cid}`)}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg">
                              <ExternalLink className="w-3.5 h-3.5" /> Fiche client
                            </button>
                          )
                        ) : (
                          r.nb_prospects > 0 && (
                            <button onClick={() => setEditing(isEditing ? null : { email: r.email, value: r.suggestion || r.email })}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg">
                              <Pencil className="w-3.5 h-3.5" /> Corriger
                            </button>
                          )
                        )}
                        <button onClick={() => blockEmail(r)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg">
                          <Ban className="w-3.5 h-3.5" /> Bloquer
                        </button>
                        {r.manual && (
                          <button onClick={() => resetAuto(r)} disabled={busy === r.email} title="Annuler la décision manuelle"
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg disabled:opacity-50">
                            <RotateCcw className="w-3.5 h-3.5" /> Auto
                          </button>
                        )}
                      </div>
                    </div>

                    {isEditing && (
                      <div className="flex flex-wrap items-center gap-2 bg-gray-50 border rounded-lg p-2">
                        <input value={editing.value} onChange={e => setEditing({ ...editing, value: e.target.value })}
                          className="flex-1 min-w-[220px] border rounded px-2 py-1.5 text-sm font-mono" autoFocus />
                        <span className="text-xs text-gray-500">{r.nb_prospects} fiche{r.nb_prospects > 1 ? 's' : ''} prospect modifiée{r.nb_prospects > 1 ? 's' : ''}</span>
                        <button onClick={() => applyFix(r)} disabled={busy === r.email}
                          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                          {busy === r.email ? 'Correction…' : 'Appliquer'}
                        </button>
                        <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg">Annuler</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ BLOCAGE ═══════════════════ */}
      {tab === 'blocage' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <h3 className="font-semibold text-sm text-gray-800">Ajouter</h3>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
              <select value={blForm.kind} onChange={e => setBlForm(f => ({ ...f, kind: e.target.value }))} className="md:col-span-2 border rounded-lg px-2 py-2 text-sm">
                <option value="domaine">Domaine</option>
                <option value="email">Adresse</option>
                <option value="nom">Nom contient</option>
              </select>
              <input value={blForm.value} onChange={e => setBlForm(f => ({ ...f, value: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addBlock()}
                placeholder={blForm.kind === 'domaine' ? 'apave.com' : blForm.kind === 'email' ? 'contact@exemple.fr' : 'APAVE'}
                className="md:col-span-4 border rounded-lg px-3 py-2 text-sm" />
              <select value={blForm.category} onChange={e => setBlForm(f => ({ ...f, category: e.target.value }))} className="md:col-span-2 border rounded-lg px-2 py-2 text-sm">
                <option value="concurrent">Concurrent (invisible)</option>
                <option value="manuel">Autre (exclu)</option>
              </select>
              <input value={blForm.note} onChange={e => setBlForm(f => ({ ...f, note: e.target.value }))}
                placeholder="Note (facultatif)" className="md:col-span-3 border rounded-lg px-3 py-2 text-sm" />
              <button onClick={addBlock} className="md:col-span-1 flex items-center justify-center gap-1 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Un <strong>concurrent</strong> n'apparaît plus du tout dans le mailing. « Nom contient » s'applique au nom de l'entreprise.
              Les <strong>désabonnés</strong> sont ajoutés automatiquement.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-3 border-b">
              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400" />
                <input value={blSearch} onChange={e => setBlSearch(e.target.value)} placeholder="Rechercher…"
                  className="border rounded-lg pl-8 pr-3 py-1.5 text-xs w-full" />
              </div>
            </div>
            {loadingBl ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
            ) : filteredBl.length === 0 ? (
              <p className="text-center py-8 text-sm text-gray-400">Liste vide</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-left px-3 py-2">Valeur</th>
                    <th className="text-left px-3 py-2">Catégorie</th>
                    <th className="text-left px-3 py-2 hidden md:table-cell">Note</th>
                    <th className="text-left px-3 py-2 hidden md:table-cell">Ajouté le</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredBl.map(b => {
                    const c = CATEGORY_STYLE[b.category] || CATEGORY_STYLE.manuel
                    return (
                      <tr key={b.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-xs text-gray-500">{KIND_LABEL[b.kind] || b.kind}</td>
                        <td className="px-3 py-2 font-mono text-xs break-all">{b.value}</td>
                        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${c.cls}`}>{c.label}</span></td>
                        <td className="px-3 py-2 text-xs text-gray-500 hidden md:table-cell">{b.note || '-'}</td>
                        <td className="px-3 py-2 text-xs text-gray-400 hidden md:table-cell">{new Date(b.created_at).toLocaleDateString('fr-FR')}</td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => removeBlock(b)} className="p-1.5 text-gray-400 hover:text-red-600 rounded" title="Retirer">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

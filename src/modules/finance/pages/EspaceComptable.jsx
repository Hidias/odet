import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../core/supabase'
import { useAuthStore, useDataStore } from '../../../core/store'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx-js-style'
import {
  Calculator, AlertTriangle, CheckCircle, Clock, Lock, Unlock,
  Download, RefreshCw, Plus, X, ChevronDown, Search, Eye, EyeOff, LogOut, FileText
} from 'lucide-react'
import SearchSelect from '../../../ui/SearchSelect'

// ════════════════════════════════════════════════════════════
//  ESPACE COMPTABLE
//  Balance âgée | Encaissements | Rapprochement | Clôtures | Export | FEC
// ════

// ════════════════════════════════════════════════════════════
// EXERCICES COMPTABLES - calculés depuis organization_settings
//   exercice_start_month : mois de début d'exercice (1 à 12, défaut 1)
//   date_creation        : début du premier exercice
// ════════════════════════════════════════════════════════════

const pad2 = (x) => String(x).padStart(2, '0')
const fmtDMY = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
const fmtYMD = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`

/** Date SQL 'YYYY-MM-DD' en date locale (sans décalage UTC), sinon null */
function parseLocalDate(v) {
  const m = String(v || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Mois de début d'exercice (1 à 12), défaut janvier */
function exerciceStartMonth(org) {
  const m = parseInt(org?.exercice_start_month, 10)
  return m >= 1 && m <= 12 ? m : 1
}

/** Veille du 1er du mois de début d'exercice (1 à 12) de l'année donnée : dernier jour du mois précédent */
const closingBefore = (year, startMonth) => new Date(year, startMonth - 1, 0)

/** Libellé de la date de clôture standard : « 30 juin », « 31 décembre »... */
function closingDayLabel(org) {
  return closingBefore(2001, exerciceStartMonth(org)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

/** SIREN de l'organisme (repli : 9 premiers chiffres du SIRET), chaîne vide si inconnu */
function orgSiren(org) {
  const siren = String(org?.siren || '').replace(/\D/g, '')
  if (siren.length === 9) return siren
  const siret = String(org?.siret || '').replace(/\D/g, '')
  return siret.length >= 9 ? siret.slice(0, 9) : ''
}

const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)

/**
 * Exercices comptables.
 * - Premier exercice : de date_creation à la veille du début d'exercice de l'année suivante
 *   (fin du mois précédant exercice_start_month) si cela fait moins de 24 mois, sinon à la
 *   fin de la même année ; puis des exercices de 12 mois.
 * - Sans date_creation : premier exercice = exercice standard qui contient la première
 *   opération connue (ou la date du jour).
 * Nom du fichier FEC (format légal) : SIREN + 'FEC' + AAAAMMJJ de clôture, null sans SIREN.
 */
function getExercices(org, firstActivityDate) {
  const sm = exerciceStartMonth(org)
  const siren = orgSiren(org)
  const fileName = (end) => siren ? `${siren}FEC${fmtYMD(end)}.txt` : null
  const exos = []

  let start = parseLocalDate(org?.date_creation)
  let end
  if (start) {
    end = closingBefore(start.getFullYear() + 1, sm)
    if (monthsBetween(start, end) >= 24) {
      const sameYear = closingBefore(start.getFullYear(), sm)
      if (sameYear >= start) end = sameYear
    }
  } else {
    const ref = firstActivityDate || new Date()
    const y = (ref.getMonth() + 1) >= sm ? ref.getFullYear() : ref.getFullYear() - 1
    start = new Date(y, sm - 1, 1)
    end = closingBefore(y + 1, sm)
  }
  exos.push({ start, end: endOfDay(end) })

  // Exercices de 12 mois jusqu'à celui qui commence l'an prochain inclus
  const lastYear = new Date().getFullYear() + 2
  for (let guard = 0; guard < 100; guard++) {
    const prev = exos[exos.length - 1].end
    const s2 = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1)
    if (s2.getFullYear() >= lastYear) break
    exos.push({ start: s2, end: endOfDay(closingBefore(s2.getFullYear() + 1, sm)) })
  }

  return exos.map((e, idx) => ({
    ...e,
    label: `Ex. ${idx + 1} - ${fmtDMY(e.start)} → ${fmtDMY(e.end)}`,
    filename: fileName(e.end),
  }))
}

/** Libellé de la banque de l'organisme pour le journal et le compte 512000 */
function bankLabel(org) {
  const name = String(org?.bank_name || '').trim()
  return name ? `Banque ${name}` : 'Banque'
}

/** IBAN formaté par groupes de 4, ou mention à renseigner */
function formatIban(org) {
  const iban = String(org?.iban || '').replace(/\s+/g, '').toUpperCase()
  return iban ? iban.replace(/(.{4})/g, '$1 ').trim() : 'Non renseigné (Paramètres)'
}

/** Contexte comptable partagé par les onglets : organisme, exercices, début d'activité */
const FiscalContext = React.createContext({ org: null, exercices: [], companyStart: new Date(new Date().getFullYear(), 0, 1), closingLabel: '' })
const useFiscal = () => React.useContext(FiscalContext)

// ════════════════════════════════════════════════════════════

const TABS = [
  { key: 'balance', label: 'Balance âgée' },
  { key: 'encaissements', label: 'Encaissements' },
  { key: 'rapprochement', label: 'Rapprochement' },
  { key: 'annotations', label: 'Annotations' },
  { key: 'clotures', label: 'Clôtures' },
  { key: 'export', label: 'Export Excel' },
  { key: 'fec', label: 'FEC DGFiP' },
]

const fmt = (n) => {
  if (n == null) return '-'
  return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100

// Date du jour 'YYYY-MM-DD' en heure locale (pas de décalage UTC)
const todayISO = () => {
  const d = new Date()
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Recalcule payé / reste dû / statut d'une facture à partir de ses paiements
// (les factures annulées par avoir sont gérées par le trigger SQL)
async function recomputeInvoiceFromPayments(invoiceId) {
  const [{ data: inv }, { data: pays }] = await Promise.all([
    supabase.from('invoices').select('id, type, status, total_ttc, amount_credited, due_date').eq('id', invoiceId).single(),
    supabase.from('invoice_payments').select('amount').eq('invoice_id', invoiceId),
  ])
  if (!inv || inv.type !== 'invoice') return
  const paid = round2((pays || []).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0))
  const due = Math.max(0, round2((parseFloat(inv.total_ttc) || 0) - paid - (parseFloat(inv.amount_credited) || 0)))
  let status = inv.status
  if (!['draft', 'cancelled', 'credited'].includes(inv.status)) {
    if (due <= 0.01) status = 'paid'
    else if (paid > 0.01) status = 'partial'
    else status = (inv.due_date && String(inv.due_date).slice(0, 10) < todayISO()) ? 'overdue' : 'due'
  }
  const { error } = await supabase.from('invoices')
    .update({ amount_paid: paid, amount_due: due, status, updated_at: new Date().toISOString() })
    .eq('id', invoiceId)
  if (error) throw error
}

const STATUS_LABELS = {
  draft: 'Brouillon', sent: 'Envoyée', due: 'À régler',
  overdue: 'En retard', partial: 'Partiel', paid: 'Payée', cancelled: 'Annulée',
  credited: 'Annulée par avoir'
}
const STATUS_COLORS = {
  paid: 'text-green-600 bg-green-50', overdue: 'text-red-600 bg-red-50',
  partial: 'text-orange-600 bg-orange-50', sent: 'text-blue-600 bg-blue-50',
  due: 'text-yellow-700 bg-yellow-50', draft: 'text-gray-500 bg-gray-50',
  credited: 'text-gray-500 bg-gray-50'
}

function Badge({ status }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[status] || 'text-gray-500 bg-gray-50'}`}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

// ─── Calcul tranche d'âge d'une créance ───────────────────
function getAgingBucket(invoice) {
  if (invoice.status === 'paid') return 'payée'
  if (invoice.status === 'cancelled' || invoice.status === 'draft' || invoice.status === 'credited') return 'hors_scope'
  if (!invoice.due_date) return '0_30'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(invoice.due_date); due.setHours(0, 0, 0, 0)
  const daysDiff = Math.floor((today - due) / (1000 * 60 * 60 * 24))
  if (daysDiff <= 0) return 'not_due'
  if (daysDiff <= 30) return '0_30'
  if (daysDiff <= 60) return '31_60'
  if (daysDiff <= 90) return '61_90'
  return '90_plus'
}

const AGING_BUCKETS = [
  { key: 'not_due', label: 'Non échu', color: 'blue', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
  { key: '0_30', label: '0-30 jours', color: 'yellow', bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700' },
  { key: '31_60', label: '31-60 jours', color: 'orange', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' },
  { key: '61_90', label: '61-90 jours', color: 'red', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' },
  { key: '90_plus', label: '+ 90 jours', color: 'red', bg: 'bg-red-100', border: 'border-red-300', text: 'text-red-800' },
]

//  PostgREST plafonne toute requête à 1000 lignes sans plage explicite.
// Au-delà, les lignes les plus anciennes sont tronquées SILENCIEUSEMENT.
// fetchAll() pagine par tranches de 1000 jusqu'à tout récupérer.
async function fetchAll(buildQuery, pageSize = 1000) {
  let from = 0
  const all = []
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) { console.error('fetchAll:', error.message); break }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

export default function EspaceComptable() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const organization = useDataStore(s => s.organization)
  const fetchOrganization = useDataStore(s => s.fetchOrganization)
  useEffect(() => { if (!organization) fetchOrganization() }, [organization, fetchOrganization])

  async function handleLogout() {
    await logout()
    navigate('/login')
  }
  const [tab, setTab] = useState('balance')
  const [loading, setLoading] = useState(true)

  // Données globales
  const [invoices, setInvoices] = useState([])
  const [payments, setPayments] = useState([])
  const [transactions, setTransactions] = useState([])
  const [periods, setPeriods] = useState([])

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [invAll, payAll, txAll, perR] = await Promise.all([
      fetchAll(() => supabase
        .from('invoices')
        .select('*, clients!client_id(name, siret)')
        .not('status', 'in', '("draft","cancelled")')
        .order('invoice_date', { ascending: false })),
      fetchAll(() => supabase
        .from('invoice_payments')
        .select('*, invoices(reference, client_id, clients!client_id(name))')
        .order('payment_date', { ascending: false })),
      fetchAll(() => supabase
        .from('budget_transactions')
        .select('*')
        .eq('is_private', false)   // Transactions privées : jamais visibles côté comptable
        .order('date', { ascending: false })),
      supabase
        .from('accounting_periods')
        .select('*')
        .order('year', { ascending: false })
        .order('month', { ascending: false }),
    ])
    setInvoices(invAll)
    setPayments(payAll)
    setTransactions(txAll)
    setPeriods(perR.data || [])
    setLoading(false)
  }

  // ─── Exercices et début d'activité, depuis les paramètres de l'organisme ──
  const fiscal = useMemo(() => {
    // Première opération connue (utile seulement si date_creation est vide)
    let first = null
    const consider = (v) => { const d = parseLocalDate(v); if (d && (!first || d < first)) first = d }
    transactions.forEach(t => consider(t.date))
    invoices.forEach(i => consider(i.invoice_date))
    const exercices = getExercices(organization, first)
    const s0 = exercices[0]?.start || new Date(new Date().getFullYear(), 0, 1)
    return {
      org: organization,
      exercices,
      companyStart: new Date(s0.getFullYear(), s0.getMonth(), 1), // 1er du mois de début d'activité
      closingLabel: closingDayLabel(organization),
    }
  }, [organization, transactions, invoices])

  // ─── Vérifier si une date est dans une période clôturée ──
  const isDateLocked = useCallback((dateStr) => {
    if (!dateStr) return false
    const d = new Date(dateStr)
    const y = d.getFullYear(); const m = d.getMonth() + 1
    return periods.some(p => p.locked_at && p.year === y && p.month === m)
  }, [periods])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Chargement de l'espace comptable...</p>
        </div>
      </div>
    )
  }

  const orgDisplayName = organization?.name || organization?.legal_name || ''

  return (
    <FiscalContext.Provider value={fiscal}>
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Calculator className="w-7 h-7 text-violet-600" />
            Espace Comptable
          </h1>
          <p className="text-sm text-gray-500 mt-1">{orgDisplayName ? `${orgDisplayName} - ` : ''}{new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400 hidden sm:block">{user?.email}</span>
          <button onClick={loadAll} className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 transition-colors">
            <RefreshCw className="w-4 h-4" />
            Actualiser
          </button>
          <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 transition-colors">
            <LogOut className="w-4 h-4" />
            Déconnexion
          </button>
        </div>
      </div>

      {/* KPIs rapides */}
      <KPISummary invoices={invoices} />

      {/* Tabs */}
      <nav className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 transition ${
              tab === t.key ? 'bg-violet-600 text-white shadow' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Contenu */}
      {tab === 'balance' && <BalanceAgeeTab invoices={invoices} />}
      {tab === 'encaissements' && <EncaissementsTab invoices={invoices} payments={payments} loadAll={loadAll} isDateLocked={isDateLocked} />}
      {tab === 'rapprochement' && <RapprochementTab invoices={invoices} transactions={transactions} loadAll={loadAll} isDateLocked={isDateLocked} />}
      {tab === 'annotations' && <AnnotationsTab transactions={transactions} loadAll={loadAll} isDateLocked={isDateLocked} />}
      {tab === 'clotures' && <CloturesTab periods={periods} loadAll={loadAll} user={user} />}
      {tab === 'export' && <ExportTab invoices={invoices} payments={payments} transactions={transactions} />}
      {tab === 'fec' && <FecTab invoices={invoices} payments={payments} transactions={transactions} />}
    </div>
    </FiscalContext.Provider>
  )
}

// ════════════════════════════════════════════════════════════
// KPI SUMMARY
// ════════════════════════════════════════════════════════════
function KPISummary({ invoices }) {
  const { closingLabel } = useFiscal()
  const stats = useMemo(() => {
    const unpaid = invoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled' && i.status !== 'credited' && i.status !== 'draft' && i.type !== 'credit_note')
    const totalDue = unpaid.reduce((s, i) => s + (parseFloat(i.amount_due) || 0), 0)
    const overdue = unpaid.filter(i => i.status === 'overdue')
    const totalOverdue = overdue.reduce((s, i) => s + (parseFloat(i.amount_due) || 0), 0)
    const paid30 = invoices.filter(i => {
      if (i.status !== 'paid' || i.type === 'credit_note') return false
      const d = new Date(i.updated_at || i.invoice_date)
      return (new Date() - d) < 30 * 24 * 60 * 60 * 1000
    })
    const totalPaid30 = paid30.reduce((s, i) => s + (parseFloat(i.total_ttc) || 0), 0)
    return { totalDue, totalOverdue, nbOverdue: overdue.length, nbUnpaid: unpaid.length, totalPaid30 }
  }, [invoices])

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="bg-white rounded-xl border p-4">
        <p className="text-xs text-gray-500 font-medium">Créances totales</p>
        <p className="text-xl font-bold text-gray-900 mt-1">{fmt(stats.totalDue)}</p>
        <p className="text-xs text-gray-400 mt-1">{stats.nbUnpaid} facture(s) non soldée(s)</p>
      </div>
      <div className="bg-white rounded-xl border p-4 border-red-100">
        <p className="text-xs text-red-600 font-medium">En retard</p>
        <p className="text-xl font-bold text-red-700 mt-1">{fmt(stats.totalOverdue)}</p>
        <p className="text-xs text-red-400 mt-1">{stats.nbOverdue} facture(s)</p>
      </div>
      <div className="bg-white rounded-xl border p-4 border-green-100">
        <p className="text-xs text-green-600 font-medium">Encaissé (30j)</p>
        <p className="text-xl font-bold text-green-700 mt-1">{fmt(stats.totalPaid30)}</p>
        <p className="text-xs text-green-400 mt-1">Factures soldées</p>
      </div>
      <div className="bg-white rounded-xl border p-4">
        <p className="text-xs text-gray-500 font-medium">Exercice</p>
        <p className="text-xl font-bold text-gray-900 mt-1">{new Date().getFullYear()}</p>
        <p className="text-xs text-gray-400 mt-1">Clôture {closingLabel}</p>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// BALANCE ÂGÉE
// ════════════════════════════════════════════════════════════
function BalanceAgeeTab({ invoices }) {
  const [search, setSearch] = useState('')
  const [expandedClient, setExpandedClient] = useState(null)

  const unpaid = useMemo(() =>
    invoices.filter(i =>
      i.status !== 'paid' && i.status !== 'cancelled' && i.status !== 'credited' &&
      i.status !== 'draft' && i.type !== 'credit_note'
    ),
    [invoices]
  )

  const byClient = useMemo(() => {
    const map = {}
    unpaid.forEach(inv => {
      const name = inv.clients?.name || 'Client inconnu'
      if (!map[name]) map[name] = { name, invoices: [] }
      map[name].invoices.push({ ...inv, bucket: getAgingBucket(inv) })
    })
    // Tri : clients avec créances les plus anciennes en premier
    return Object.values(map).sort((a, b) => {
      const maxA = Math.max(...a.invoices.map(i => AGING_BUCKETS.findIndex(b => b.key === i.bucket)))
      const maxB = Math.max(...b.invoices.map(i => AGING_BUCKETS.findIndex(b => b.key === i.bucket)))
      return maxB - maxA
    })
  }, [unpaid])

  const filtered = useMemo(() => {
    if (!search) return byClient
    const s = search.toLowerCase()
    return byClient.filter(c => c.name.toLowerCase().includes(s))
  }, [byClient, search])

  // Totaux par tranche
  const totals = useMemo(() => {
    const t = {}
    AGING_BUCKETS.forEach(b => { t[b.key] = 0 })
    unpaid.forEach(inv => { t[getAgingBucket(inv)] = (t[getAgingBucket(inv)] || 0) + (parseFloat(inv.amount_due) || 0) })
    return t
  }, [unpaid])

  return (
    <div className="space-y-4">
      {/* Résumé par tranche */}
      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-gray-700 mb-3">Répartition des créances</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {AGING_BUCKETS.map(b => (
            <div key={b.key} className={`${b.bg} border ${b.border} rounded-lg p-3 text-center`}>
              <p className={`text-xs font-semibold ${b.text}`}>{b.label}</p>
              <p className={`text-lg font-bold ${b.text} mt-1`}>{fmt(totals[b.key] || 0)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tableau par client */}
      <div className="bg-white rounded-xl border">
        <div className="p-4 border-b flex items-center gap-3">
          <h3 className="font-semibold text-gray-700 flex-1">Détail par client</h3>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border rounded-lg pl-8 pr-3 py-2 text-sm w-48"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-400" />
            <p className="font-medium">Aucune créance en cours</p>
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map(client => {
              const totalClient = client.invoices.reduce((s, i) => s + (parseFloat(i.amount_due) || 0), 0)
              const worstBucket = AGING_BUCKETS.slice().reverse().find(b => client.invoices.some(i => i.bucket === b.key))
              const isOpen = expandedClient === client.name

              return (
                <div key={client.name}>
                  <button
                    onClick={() => setExpandedClient(isOpen ? null : client.name)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left"
                  >
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    <span className="font-medium text-gray-900 flex-1">{client.name}</span>
                    <span className="text-xs text-gray-500">{client.invoices.length} facture(s)</span>
                    {worstBucket && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${worstBucket.bg} ${worstBucket.text}`}>
                        {worstBucket.label}
                      </span>
                    )}
                    <span className="font-bold text-gray-900 ml-2 w-28 text-right">{fmt(totalClient)}</span>
                  </button>

                  {isOpen && (
                    <div className="bg-gray-50 px-4 py-2">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="text-left py-1.5 font-medium">Référence</th>
                            <th className="text-center py-1.5 font-medium">Date</th>
                            <th className="text-center py-1.5 font-medium">Échéance</th>
                            <th className="text-center py-1.5 font-medium">Statut</th>
                            <th className="text-right py-1.5 font-medium">Montant dû</th>
                            <th className="text-center py-1.5 font-medium">Ancienneté</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {client.invoices.map(inv => {
                            const bucket = AGING_BUCKETS.find(b => b.key === inv.bucket)
                            return (
                              <tr key={inv.id} className="bg-white">
                                <td className="py-1.5 font-mono font-bold">{inv.reference}</td>
                                <td className="py-1.5 text-center text-gray-600">{new Date(inv.invoice_date).toLocaleDateString('fr-FR')}</td>
                                <td className="py-1.5 text-center text-gray-600">{inv.due_date ? new Date(inv.due_date).toLocaleDateString('fr-FR') : '-'}</td>
                                <td className="py-1.5 text-center"><Badge status={inv.status} /></td>
                                <td className="py-1.5 text-right font-bold">{fmt(parseFloat(inv.amount_due))}</td>
                                <td className="py-1.5 text-center">
                                  {bucket && (
                                    <span className={`font-medium px-2 py-0.5 rounded-full text-xs ${bucket.bg} ${bucket.text}`}>
                                      {bucket.label}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// ENCAISSEMENTS
// ════════════════════════════════════════════════════════════
function EncaissementsTab({ invoices, payments, loadAll, isDateLocked }) {
  const { companyStart } = useFiscal()
  const [showForm, setShowForm] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [form, setForm] = useState({
    amount: '', payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'virement bancaire', payment_reference: '', notes: ''
  })
  const [saving, setSaving] = useState(false)
  const [filterClient, setFilterClient] = useState('')

  const unpaidInvoices = useMemo(() =>
    invoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled' && i.status !== 'credited' && i.status !== 'draft' && i.type !== 'credit_note')
      .sort((a, b) => new Date(a.due_date || a.invoice_date) - new Date(b.due_date || b.invoice_date)),
    [invoices]
  )

  const [historyMonth, setHistoryMonth] = useState(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` })
  const paymentMonthOptions = useMemo(() => {
    const opts = [{ value: 'all', label: 'Tous les encaissements' }]
    const now = new Date(); let cursor = new Date(now.getFullYear(), now.getMonth(), 1)
    const MN = ['','Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
    while (cursor >= companyStart) { const y = cursor.getFullYear(); const m = cursor.getMonth() + 1; opts.push({ value: `${y}-${String(m).padStart(2,'0')}`, label: `${MN[m]} ${y}` }); cursor = new Date(y, m - 2, 1) }
    return opts
  }, [companyStart])
  const recentPayments = useMemo(() => {
    if (historyMonth === 'all') return payments
    const [y, m] = historyMonth.split('-').map(Number)
    return payments.filter(p => { const d = new Date(p.payment_date); return d.getFullYear() === y && d.getMonth() + 1 === m })
  }, [payments, historyMonth])

  async function handleSavePayment() {
    if (!selectedInvoice) { toast.error('Sélectionnez une facture'); return }
    if (!form.amount || parseFloat(form.amount) <= 0) { toast.error('Montant invalide'); return }
    if (isDateLocked(form.payment_date)) {
      toast.error('Cette période est clôturée. Contactez l\'administrateur.')
      return
    }

    setSaving(true)
    try {
      const amount = parseFloat(form.amount)
      const { error } = await supabase.from('invoice_payments').insert([{
        invoice_id: selectedInvoice.id,
        amount,
        payment_date: form.payment_date,
        payment_method: form.payment_method,
        payment_reference: form.payment_reference || null,
        notes: form.notes || null,
        created_by: 'Comptable',
      }])
      if (error) throw error

      // Mise à jour du statut facture
      const newPaid = (parseFloat(selectedInvoice.amount_paid) || 0) + amount
      const newDue = Math.max(0, (parseFloat(selectedInvoice.total_ttc) || 0) - newPaid - (parseFloat(selectedInvoice.amount_credited) || 0))
      const newStatus = newDue <= 0.01 ? 'paid' : 'partial'
      await supabase.from('invoices').update({
        amount_paid: newPaid,
        amount_due: newDue,
        status: newStatus,
        updated_at: new Date().toISOString()
      }).eq('id', selectedInvoice.id)

      toast.success(`Encaissement de ${fmt(amount)} enregistré`)
      setShowForm(false)
      setSelectedInvoice(null)
      setForm({ amount: '', payment_date: new Date().toISOString().split('T')[0], payment_method: 'virement bancaire', payment_reference: '', notes: '' })
      loadAll()
    } catch (e) {
      toast.error('Erreur : ' + e.message)
    }
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      {/* Saisie encaissement */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-700">Saisir un encaissement</h3>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-3 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700"
          >
            <Plus className="w-4 h-4" />
            Nouvel encaissement
          </button>
        </div>

        {showForm && (
          <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Facture concernée</label>
              <SearchSelect
                value={selectedInvoice?.id || ''}
                onChange={v => setSelectedInvoice(unpaidInvoices.find(i => i.id === v) || null)}
                options={unpaidInvoices.map(inv => ({ value: inv.id, label: `${inv.reference} - ${inv.clients?.name || '-'}`, hint: `${fmt(parseFloat(inv.amount_due))} restant` }))}
                emptyLabel="- Sélectionner une facture -" searchPlaceholder="Référence ou client..." aria-label="Facture" />
              {selectedInvoice && (
                <div className="mt-2 text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded px-3 py-2">
                  Total TTC : {fmt(parseFloat(selectedInvoice.total_ttc))} •
                  Déjà payé : {fmt(parseFloat(selectedInvoice.amount_paid))} •
                  <strong> Restant dû : {fmt(parseFloat(selectedInvoice.amount_due))}</strong>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Montant encaissé (€)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder={selectedInvoice ? String(parseFloat(selectedInvoice.amount_due).toFixed(2)) : '0.00'}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Date d'encaissement</label>
                <input
                  type="date"
                  value={form.payment_date}
                  onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
                {isDateLocked(form.payment_date) && (
                  <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Période clôturée
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Mode de paiement</label>
                <select
                  value={form.payment_method}
                  onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="virement bancaire">Virement bancaire</option>
                  <option value="chèque">Chèque</option>
                  <option value="espèces">Espèces</option>
                  <option value="prélèvement">Prélèvement</option>
                  <option value="carte bancaire">Carte bancaire</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Référence paiement</label>
                <input
                  type="text"
                  value={form.payment_reference}
                  onChange={e => setForm(f => ({ ...f, payment_reference: e.target.value }))}
                  placeholder="ex: VIR-202606-001"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Notes</label>
              <input
                type="text"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Notes optionnelles..."
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSavePayment}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? ' Enregistrement...' : ' Enregistrer l\'encaissement'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Factures non soldées */}
      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-gray-700 mb-3">Factures en attente d'encaissement ({unpaidInvoices.length})</h3>
        {unpaidInvoices.length === 0 ? (
          <p className="text-center py-6 text-gray-400 text-sm"> Toutes les factures sont soldées</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Référence</th>
                  <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Client</th>
                  <th className="text-center px-3 py-2 text-xs text-gray-500 font-medium">Date</th>
                  <th className="text-center px-3 py-2 text-xs text-gray-500 font-medium">Échéance</th>
                  <th className="text-right px-3 py-2 text-xs text-gray-500 font-medium">Total TTC</th>
                  <th className="text-right px-3 py-2 text-xs text-gray-500 font-medium">Payé</th>
                  <th className="text-right px-3 py-2 text-xs text-gray-500 font-medium">Restant</th>
                  <th className="text-center px-3 py-2 text-xs text-gray-500 font-medium">Statut</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {unpaidInvoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono font-bold text-xs">{inv.reference}</td>
                    <td className="px-3 py-2 text-gray-700 truncate max-w-32">{inv.clients?.name || '-'}</td>
                    <td className="px-3 py-2 text-center text-gray-500 text-xs">{new Date(inv.invoice_date).toLocaleDateString('fr-FR')}</td>
                    <td className="px-3 py-2 text-center text-xs">
                      {inv.due_date ? (
                        <span className={new Date(inv.due_date) < new Date() ? 'text-red-600 font-medium' : 'text-gray-500'}>
                          {new Date(inv.due_date).toLocaleDateString('fr-FR')}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{fmt(parseFloat(inv.total_ttc))}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-green-600">{fmt(parseFloat(inv.amount_paid))}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-bold">{fmt(parseFloat(inv.amount_due))}</td>
                    <td className="px-3 py-2 text-center"><Badge status={inv.status} /></td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => {
                          setSelectedInvoice(inv)
                          setForm(f => ({ ...f, amount: parseFloat(inv.amount_due).toFixed(2) }))
                          setShowForm(true)
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                        className="text-xs text-violet-600 hover:text-violet-800 font-medium"
                      >
                        Encaisser
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Historique encaissements */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center gap-3 mb-3">
          <h3 className="font-semibold text-gray-700 flex-1">Historique des encaissements</h3>
          <select value={historyMonth} onChange={e => setHistoryMonth(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm">
            {paymentMonthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {recentPayments.length === 0 ? (
          <p className="text-center py-4 text-gray-400 text-sm">Aucun encaissement enregistré</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Date</th>
                  <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Facture</th>
                  <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Client</th>
                  <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Mode</th>
                  <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Référence</th>
                  <th className="text-right px-3 py-2 text-xs text-gray-500 font-medium">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentPayments.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-600 text-xs">{new Date(p.payment_date).toLocaleDateString('fr-FR')}</td>
                    <td className="px-3 py-2 font-mono text-xs font-bold">{p.invoices?.reference || '-'}</td>
                    <td className="px-3 py-2 text-gray-700 text-xs truncate max-w-32">{p.invoices?.clients?.name || '-'}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs capitalize">{p.payment_method}</td>
                    <td className="px-3 py-2 text-gray-400 text-xs">{p.payment_reference || '-'}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-green-700 text-xs">{fmt(parseFloat(p.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// RAPPROCHEMENT BANCAIRE
// ════════════════════════════════════════════════════════════
function RapprochementTab({ invoices, transactions, loadAll, isDateLocked }) {
  const { companyStart } = useFiscal()
  const [selectedTx, setSelectedTx] = useState(null)
  const [linking, setLinking] = useState(false)
  const [unlinking, setUnlinking] = useState(null) // id en cours de déliage
  const [viewMode, setViewMode] = useState('unmatched') // 'unmatched' | 'matched'
  const [searchMatched, setSearchMatched] = useState('')
  const [confirmUnlink, setConfirmUnlink] = useState(null) // tx à délier

  // Transactions non rapprochées (entrées crédit uniquement)
  const [unmatchedMonth, setUnmatchedMonth] = useState('all')
  const rapprochMonthOptions = useMemo(() => {
    const opts = [{ value: 'all', label: 'Tous les mois' }]; const now = new Date(); let cursor = new Date(now.getFullYear(), now.getMonth(), 1)
    const MN = ['','Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']
    while (cursor >= companyStart) { const y = cursor.getFullYear(); const m = cursor.getMonth() + 1; opts.push({ value: `${y}-${String(m).padStart(2,'0')}`, label: `${MN[m]} ${y}` }); cursor = new Date(y, m - 2, 1) }
    return opts
  }, [companyStart])
  const unmatched = useMemo(() => {
    let base = transactions.filter(tx => !tx.linked_invoice_id && !tx.is_personal && tx.credit > 0)
    if (unmatchedMonth !== 'all') { const [y, m] = unmatchedMonth.split('-').map(Number); base = base.filter(tx => { const d = new Date(tx.date); return d.getFullYear() === y && d.getMonth() + 1 === m }) }
    return base.sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [transactions, unmatchedMonth])

  // Transactions déjà rapprochées
  const matched = useMemo(() => {
    const base = transactions.filter(tx => tx.linked_invoice_id)
      .sort((a, b) => new Date(b.reconciled_at || b.date) - new Date(a.reconciled_at || a.date))
    if (!searchMatched) return base
    const s = searchMatched.toLowerCase()
    return base.filter(tx =>
      tx.description?.toLowerCase().includes(s) ||
      tx.linked_invoice_id?.toLowerCase().includes(s)
    )
  }, [transactions, searchMatched])

  // Enrichir les transactions rapprochées avec les infos facture
  const matchedEnriched = useMemo(() => {
    const invMap = {}
    invoices.forEach(i => { invMap[i.id] = i })
    return matched.map(tx => ({
      ...tx,
      invoice: invMap[tx.linked_invoice_id] || null
    }))
  }, [matched, invoices])

  const [searchInvoice, setSearchInvoice] = useState('')
  const allInvoices = useMemo(() => {
    let base = invoices.filter(i => i.status !== 'cancelled' && i.status !== 'draft' && i.type !== 'credit_note')
      .sort((a, b) => new Date(b.invoice_date) - new Date(a.invoice_date))
    if (searchInvoice.trim()) {
      const s = searchInvoice.toLowerCase()
      base = base.filter(i => i.reference?.toLowerCase().includes(s) || i.clients?.name?.toLowerCase().includes(s) || String(i.total_ttc).includes(s))
    }
    return base
  }, [invoices, searchInvoice])

  // Rapprocher un virement à une facture :
  //   1. enregistre le paiement (dans la limite du reste dû) et met à jour la facture
  //   2. lie la transaction à la facture
  // Le paiement porte la mention [tx:<id>] pour pouvoir être annulé au déliage.
  async function handleLink(invoiceId) {
    if (!selectedTx) return
    if (isDateLocked(selectedTx.date)) {
      toast.error("Période clôturée - contactez l'administrateur")
      return
    }
    const inv = invoices.find(i => i.id === invoiceId)
    if (!inv) { toast.error('Facture introuvable'); return }
    setLinking(true)
    const tx = selectedTx
    const tag = `[tx:${tx.id}]`
    let createdPaymentId = null
    try {
      const credit = round2(tx.credit)
      const due = Math.max(0, round2((parseFloat(inv.total_ttc) || 0) - (parseFloat(inv.amount_paid) || 0) - (parseFloat(inv.amount_credited) || 0)))
      const applied = round2(Math.min(credit, due))

      // 1. Paiement + facture
      if (applied > 0.01) {
        const { data: pay, error: payErr } = await supabase.from('invoice_payments').insert({
          invoice_id: inv.id,
          amount: applied,
          payment_date: tx.date,
          payment_method: 'virement bancaire',
          payment_reference: (tx.description || '').substring(0, 100),
          notes: `Rapprochement bancaire ${tag}`,
          created_by: 'Rapprochement bancaire',
        }).select('id').single()
        if (payErr) throw payErr
        createdPaymentId = pay?.id || null
        await recomputeInvoiceFromPayments(inv.id)
      }

      // 2. Lien transaction ↔ facture
      const { error } = await supabase
        .from('budget_transactions')
        .update({ linked_invoice_id: invoiceId, reconciled_at: new Date().toISOString() })
        .eq('id', tx.id)
      if (error) throw error

      // 3. Lien détaillé (non bloquant)
      const { error: linkErr } = await supabase.from('budget_transaction_invoices').insert({
        transaction_id: tx.id,
        invoice_id: inv.id,
        amount_applied: applied,
        reconciled_at: new Date().toISOString(),
        reconciled_by: 'Espace comptable',
        notes: 'Rapprochement manuel',
      })
      if (linkErr) console.warn('Lien détaillé non enregistré :', linkErr.message)

      if (applied > 0.01) {
        toast.success(`Rapproché - paiement de ${fmt(applied)} enregistré sur ${inv.reference}`)
      } else {
        toast.success(`Rapproché - ${inv.reference} était déjà soldée, aucun paiement ajouté`)
      }
      if (credit - applied > 0.01) {
        toast(`ℹ ${fmt(round2(credit - applied))} du virement non affectés à ${inv.reference} (virement groupé ?)`, { duration: 6000 })
      }
      setSelectedTx(null)
      loadAll()
    } catch (e) {
      // Annuler le paiement créé si le lien a échoué
      if (createdPaymentId) {
        try {
          await supabase.from('invoice_payments').delete().eq('id', createdPaymentId)
          await recomputeInvoiceFromPayments(inv.id)
        } catch (_) { /* rien de plus à faire */ }
      }
      toast.error('Erreur : ' + e.message)
    }
    setLinking(false)
  }

  async function handleUnlink(tx) {
    if (isDateLocked(tx.date)) {
      toast.error("Période clôturée - contactez l'administrateur")
      setConfirmUnlink(null)
      return
    }
    setUnlinking(tx.id)
    try {
      // Factures concernées : lien principal + liens détaillés (virements groupés)
      const { data: links } = await supabase
        .from('budget_transaction_invoices')
        .select('invoice_id, amount_applied')
        .eq('transaction_id', tx.id)
      const targets = new Map()
      if (tx.linked_invoice_id) targets.set(tx.linked_invoice_id, null)
      for (const l of (links || [])) {
        targets.set(l.invoice_id, l.amount_applied != null ? parseFloat(l.amount_applied) : null)
      }

      // Paiements issus de ce virement : marqués [tx:id], ou créés à l'import
      // (même date et même libellé), dans la limite du montant du virement
      const ref100 = (tx.description || '').substring(0, 100)
      let removed = 0
      for (const [invId, cap] of targets) {
        const { data: pays } = await supabase
          .from('invoice_payments')
          .select('id, amount, notes, payment_reference, payment_date, created_at')
          .eq('invoice_id', invId)
          .order('created_at', { ascending: true })
        const tagged = (pays || []).filter(p => (p.notes || '').includes(`[tx:${tx.id}]`))
        const imported = (pays || []).filter(p =>
          !tagged.includes(p) &&
          String(p.payment_date || '').slice(0, 10) === String(tx.date || '').slice(0, 10) &&
          (p.payment_reference || '') === ref100
        )
        let budget = cap != null ? cap : round2(tx.credit)
        const toDelete = []
        for (const p of [...tagged, ...imported]) {
          const amt = parseFloat(p.amount) || 0
          if (amt <= budget + 0.01) { toDelete.push(p.id); budget -= amt }
        }
        if (toDelete.length > 0) {
          const { error: delErr } = await supabase.from('invoice_payments').delete().in('id', toDelete)
          if (delErr) throw delErr
          removed += toDelete.length
          await recomputeInvoiceFromPayments(invId)
        }
      }

      await supabase.from('budget_transaction_invoices').delete().eq('transaction_id', tx.id)
      const { error } = await supabase
        .from('budget_transactions')
        .update({ linked_invoice_id: null, reconciled_at: null })
        .eq('id', tx.id)
      if (error) throw error
      toast.success(removed > 0
        ? ` Rapprochement supprimé - ${removed} paiement(s) annulé(s), facture(s) recalculée(s)`
        : ' Rapprochement supprimé')
      setConfirmUnlink(null)
      loadAll()
    } catch (e) {
      toast.error('Erreur : ' + e.message)
    }
    setUnlinking(null)
  }

  return (
    <div className="space-y-4">
      {/* Onglets vue */}
      <div className="flex gap-2">
        <button
          onClick={() => setViewMode('unmatched')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            viewMode === 'unmatched'
              ? 'bg-violet-600 text-white'
              : 'border text-gray-600 hover:bg-gray-50'
          }`}
        >
           À rapprocher
          {unmatched.length > 0 && (
            <span className="ml-2 bg-white/20 text-xs px-1.5 py-0.5 rounded-full">
              {unmatched.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setViewMode('matched')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            viewMode === 'matched'
              ? 'bg-green-600 text-white'
              : 'border text-gray-600 hover:bg-gray-50'
          }`}
        >
           Déjà rapprochés
          <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${viewMode === 'matched' ? 'bg-white/20' : 'bg-gray-100'}`}>
            {matched.length}
          </span>
        </button>
      </div>

      {/* ─── Vue : à rapprocher ─── */}
      {viewMode === 'unmatched' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Transactions non rapprochées */}
          <div className="bg-white rounded-xl border">
            <div className="p-4 border-b">
              <h3 className="font-semibold text-gray-700">Transactions non rapprochées</h3>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-gray-400 flex-1">{unmatched.length} entrée(s) crédit sans facture liée</p>
                <select value={unmatchedMonth} onChange={e => setUnmatchedMonth(e.target.value)} className="border rounded px-2 py-1 text-xs">
                  {rapprochMonthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div className="max-h-[480px] overflow-y-auto divide-y">
              {unmatched.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <div className="text-3xl mb-2"></div>
                  <p className="font-medium">Tout est rapproché</p>
                </div>
              ) : (
                unmatched.map(tx => (
                  <button
                    key={tx.id}
                    onClick={() => setSelectedTx(selectedTx?.id === tx.id ? null : tx)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                      selectedTx?.id === tx.id ? 'bg-violet-50 border-l-4 border-violet-500' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{tx.description}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(tx.date).toLocaleDateString('fr-FR')} • {tx.category_name || 'Non classé'}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-green-700 shrink-0">+{fmt(tx.credit)}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Factures à lier - toutes statuts */}
          <div className="bg-white rounded-xl border">
            <div className="p-4 border-b space-y-2">
              <h3 className="font-semibold text-gray-700">Factures à rapprocher</h3>
              {selectedTx ? (
                <p className="text-xs text-violet-600">Facture correspondant à <strong>{fmt(selectedTx.credit)}</strong> du {new Date(selectedTx.date).toLocaleDateString('fr-FR')} ?</p>
              ) : (
                <p className="text-xs text-gray-400">Sélectionnez d'abord une transaction à gauche</p>
              )}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400" />
                <input type="text" placeholder="Référence, client, montant..." value={searchInvoice} onChange={e => setSearchInvoice(e.target.value)} className="w-full border rounded-lg pl-8 pr-3 py-2 text-xs" />
              </div>
            </div>
            <div className="max-h-[440px] overflow-y-auto divide-y">
              {allInvoices.length === 0 ? (
                <p className="text-center py-8 text-gray-400 text-sm">Aucune facture trouvée</p>
              ) : (
                allInvoices.map(inv => (
                  <div key={inv.id} className={`flex items-center gap-3 px-4 py-2.5 ${inv.status === 'paid' ? 'opacity-60' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-mono font-bold">{inv.reference}</p>
                        <Badge status={inv.status} />
                      </div>
                      <p className="text-xs text-gray-400">{inv.clients?.name || '-'} • {new Date(inv.invoice_date).toLocaleDateString('fr-FR')}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs font-medium text-gray-600 block">{fmt(parseFloat(inv.total_ttc))}</span>
                      {inv.status !== 'paid' && parseFloat(inv.amount_due) > 0.01 && Math.abs(parseFloat(inv.amount_due) - parseFloat(inv.total_ttc)) > 0.01 && (
                        <span className="text-[10px] text-red-600">reste {fmt(parseFloat(inv.amount_due))}</span>
                      )}
                    </div>
                    {selectedTx && (
                      <button onClick={() => handleLink(inv.id)} disabled={linking} className="text-xs px-2.5 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 shrink-0">Lier</button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Vue : déjà rapprochés ─── */}
      {viewMode === 'matched' && (
        <div className="bg-white rounded-xl border">
          <div className="p-4 border-b flex items-center gap-3">
            <h3 className="font-semibold text-gray-700 flex-1">
              Transactions rapprochées ({matched.length})
            </h3>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={searchMatched}
                onChange={e => setSearchMatched(e.target.value)}
                className="border rounded-lg pl-8 pr-3 py-2 text-sm w-52"
              />
            </div>
          </div>

          {matchedEnriched.length === 0 ? (
            <p className="text-center py-8 text-gray-400 text-sm">Aucun rapprochement effectué</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2.5 text-xs text-gray-500 font-medium">Date tx</th>
                    <th className="text-left px-3 py-2.5 text-xs text-gray-500 font-medium">Description</th>
                    <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">Montant</th>
                    <th className="text-left px-3 py-2.5 text-xs text-gray-500 font-medium">Facture liée</th>
                    <th className="text-left px-3 py-2.5 text-xs text-gray-500 font-medium">Client</th>
                    <th className="text-center px-3 py-2.5 text-xs text-gray-500 font-medium">Rapproché le</th>
                    <th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y max-h-[500px] overflow-y-auto">
                  {matchedEnriched.map(tx => (
                    <tr key={tx.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">
                        {new Date(tx.date).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="px-3 py-2.5 text-gray-900 truncate max-w-48">{tx.description}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-green-700 whitespace-nowrap">
                        {tx.credit > 0 ? `+${fmt(tx.credit)}` : `-${fmt(tx.debit)}`}
                      </td>
                      <td className="px-3 py-2.5 font-mono font-bold text-xs whitespace-nowrap">
                        {tx.invoice?.reference || <span className="text-orange-500"> Facture introuvable</span>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs truncate max-w-32">
                        {tx.invoice?.clients?.name || '-'}
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-gray-400 whitespace-nowrap">
                        {tx.reconciled_at
                          ? new Date(tx.reconciled_at).toLocaleDateString('fr-FR')
                          : '-'
                        }
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => setConfirmUnlink(tx)}
                          disabled={unlinking === tx.id}
                          className="text-xs px-2.5 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {unlinking === tx.id ? '' : ' Délier'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── Modal confirmation déliage ─── */}
      {confirmUnlink && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="font-bold text-gray-900 text-lg mb-2">Confirmer le déliage</h3>
            <p className="text-sm text-gray-600 mb-4">
              Vous allez supprimer le rapprochement entre :
            </p>
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1 mb-4">
              <p><span className="text-gray-500">Transaction :</span> <strong>{confirmUnlink.description}</strong></p>
              <p><span className="text-gray-500">Montant :</span> <strong className="text-green-700">{fmt(confirmUnlink.credit || confirmUnlink.debit)}</strong></p>
              <p><span className="text-gray-500">Date :</span> {new Date(confirmUnlink.date).toLocaleDateString('fr-FR')}</p>
              <p><span className="text-gray-500">Facture liée :</span> <strong>{confirmUnlink.invoice?.reference || confirmUnlink.linked_invoice_id}</strong></p>
            </div>
            <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg p-2 mb-4">
              Le paiement enregistré sur la facture pour ce virement sera aussi annulé, et la facture repassera « À régler » s'il ne reste pas d'autre paiement.
            </p>
            {isDateLocked(confirmUnlink.date) && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4 flex items-center gap-2">
                <Lock className="w-4 h-4 shrink-0" />
                Cette période est clôturée. Seul l'administrateur peut modifier ce rapprochement.
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmUnlink(null)}
                className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={() => handleUnlink(confirmUnlink)}
                disabled={unlinking === confirmUnlink.id || isDateLocked(confirmUnlink.date)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
              >
                {unlinking === confirmUnlink.id ? ' Suppression...' : 'Supprimer le rapprochement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// ANNOTATIONS
// ════════════════════════════════════════════════════════════
function AnnotationsTab({ transactions, loadAll, isDateLocked }) {
  const { companyStart } = useFiscal()
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('all') // 'all' | 'annotated' | 'pending'

  const [annoMonth, setAnnoMonth] = useState(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` })
  const annoMonthOptions = useMemo(() => {
    const opts = [{ value: 'all', label: 'Tous les mois' }]; const now = new Date(); let cursor = new Date(now.getFullYear(), now.getMonth(), 1)
    const MN = ['','Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']
    while (cursor >= companyStart) { const y = cursor.getFullYear(); const m = cursor.getMonth() + 1; opts.push({ value: `${y}-${String(m).padStart(2,'0')}`, label: `${MN[m]} ${y}` }); cursor = new Date(y, m - 2, 1) }
    return opts
  }, [companyStart])
  const filtered = useMemo(() => {
    let base = transactions.filter(tx => !tx.is_personal)
    if (annoMonth !== 'all') { const [y, m] = annoMonth.split('-').map(Number); base = base.filter(tx => { const d = new Date(tx.date); return d.getFullYear() === y && d.getMonth() + 1 === m }) }
    if (filter === 'annotated') return base.filter(tx => tx.note_comptable)
    if (filter === 'pending') return base.filter(tx => !tx.note_comptable)
    return base
  }, [transactions, filter, annoMonth])

  async function saveNote(txId, date) {
    if (isDateLocked(date)) {
      toast.error('Période clôturée')
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('budget_transactions')
      .update({ note_comptable: editValue || null })
      .eq('id', txId)
    if (error) { toast.error('Erreur : ' + error.message) }
    else { toast.success('Note sauvegardée'); loadAll() }
    setEditingId(null)
    setSaving(false)
  }

  return (
    <div className="bg-white rounded-xl border">
      <div className="p-4 border-b flex items-center gap-3">
        <h3 className="font-semibold text-gray-700 flex-1">Notes comptables sur les transactions</h3>
        <select value={annoMonth} onChange={e => setAnnoMonth(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs mr-2">
          {annoMonthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="flex gap-1">
          {[['all', 'Toutes'], ['annotated', 'Annotées'], ['pending', 'À annoter']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                filter === key ? 'bg-violet-600 text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y max-h-[600px] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-center py-8 text-gray-400 text-sm">Aucune transaction</p>
        ) : (
          filtered.map(tx => (
            <div key={tx.id} className="flex items-start gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">{tx.description}</span>
                  <span className="text-xs text-gray-400 shrink-0">{new Date(tx.date).toLocaleDateString('fr-FR')}</span>
                  {tx.note_comptable && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full shrink-0"> annoté</span>
                  )}
                </div>
                <p className="text-xs text-gray-400">{tx.category_name || 'Non classé'}</p>

                {editingId === tx.id ? (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveNote(tx.id, tx.date)}
                      placeholder="Note comptable..."
                      autoFocus
                      className="flex-1 border rounded px-2 py-1 text-sm"
                    />
                    <button
                      onClick={() => saveNote(tx.id, tx.date)}
                      disabled={saving}
                      className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                    >Enregistrer</button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1 border rounded text-sm hover:bg-gray-50"
                    >Annuler</button>
                  </div>
                ) : (
                  tx.note_comptable && (
                    <p className="text-xs text-blue-700 mt-1 italic">{tx.note_comptable}</p>
                  )
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-sm font-bold ${tx.credit > 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {tx.credit > 0 ? `+${fmt(tx.credit)}` : `-${fmt(tx.debit)}`}
                </span>
                {editingId !== tx.id && (
                  <button
                    onClick={() => { setEditingId(tx.id); setEditValue(tx.note_comptable || '') }}
                    className="text-xs text-gray-400 hover:text-violet-600 transition-colors p-1"
                    title="Annoter"
                  >Note</button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// CLÔTURES COMPTABLES
// ════════════════════════════════════════════════════════════
function CloturesTab({ periods, loadAll, user }) {
  const { companyStart, closingLabel, org } = useFiscal()
  const [locking, setLocking] = useState(false)
  const [note, setNote] = useState('')

  const MONTH_NAMES = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

  // Générer les 24 derniers mois
  const months = useMemo(() => {
    const result = []; const now = new Date(); let cursor = new Date(now.getFullYear(), now.getMonth(), 1)
    while (cursor >= companyStart) {
      const y = cursor.getFullYear(); const m = cursor.getMonth() + 1
      const period = periods.find(p => p.year === y && p.month === m)
      result.push({ year: y, month: m, label: `${String(m).padStart(2,'0')}/${y}`, period })
      cursor = new Date(y, m - 2, 1)
    }
    return result
  }, [periods, companyStart])

  async function toggleLock(item) {
    setLocking(true)
    try {
      if (item.period?.locked_at) {
        // Déverrouiller
        const { error } = await supabase
          .from('accounting_periods')
          .update({ locked: false, locked_at: null, locked_by: null })
          .eq('id', item.period.id)
        if (error) throw error
        toast.success(`${MONTH_NAMES[item.month]} ${item.year} déverrouillé`)
      } else {
        // Verrouiller
        // Colonnes réelles de accounting_periods : label, year, month, locked
        const payload = {
          label: item.label,
          year: item.year,
          month: item.month,
          locked: true,
          locked_at: new Date().toISOString(),
          locked_by: user?.email || 'Comptable',
          notes: note || null,
        }
        const { error } = item.period
          ? await supabase.from('accounting_periods').update(payload).eq('id', item.period.id)
          : await supabase.from('accounting_periods').insert([payload])
        if (error) throw error
        toast.success(`${MONTH_NAMES[item.month]} ${item.year} clôturé`)
        setNote('')
      }
      loadAll()
    } catch (e) {
      toast.error('Erreur : ' + e.message)
    }
    setLocking(false)
  }

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        <strong>Clôture annuelle :</strong> {org?.name || org?.legal_name || "L'organisme"} clôture son exercice comptable au <strong>{closingLabel}</strong>.
        Une période clôturée bloque la saisie d'encaissements et d'annotations sur cette période.
        Les admins restent maîtres des données - seule la saisie depuis l'espace comptable est bloquée.
      </div>

      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-gray-700 mb-4">Gestion des périodes</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {months.map(item => {
            const isLocked = !!item.period?.locked_at
            return (
              <div
                key={item.label}
                className={`border rounded-lg p-3 flex items-center justify-between gap-3 ${
                  isLocked ? 'bg-gray-50 border-gray-300' : 'bg-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isLocked
                    ? <Lock className="w-4 h-4 text-gray-500" />
                    : <Unlock className="w-4 h-4 text-green-500" />
                  }
                  <div>
                    <p className={`text-sm font-medium ${isLocked ? 'text-gray-600' : 'text-gray-900'}`}>
                      {MONTH_NAMES[item.month]} {item.year}
                    </p>
                    {isLocked && item.period?.locked_by && (
                      <p className="text-xs text-gray-400">{item.period.locked_by.split('@')[0]}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isLocked ? (
                    <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-medium">Clôturé</span>
                  ) : (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Ouvert</span>
                  )}
                  <button
                    onClick={() => toggleLock(item)}
                    disabled={locking}
                    className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition disabled:opacity-50 ${
                      isLocked
                        ? 'border border-gray-300 text-gray-600 hover:bg-gray-100'
                        : 'bg-amber-500 text-white hover:bg-amber-600'
                    }`}
                  >
                    {isLocked ? 'Déverrouiller' : 'Clôturer'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// EXPORT EXCEL
// ════════════════════════════════════════════════════════════
function ExportTab({ invoices, payments, transactions }) {
  const { companyStart, org } = useFiscal()
  const [exporting, setExporting] = useState(false)
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()))

  const years = useMemo(() => {
    const s = new Set()
    invoices.forEach(i => { const y = new Date(i.invoice_date).getFullYear(); if (y >= companyStart.getFullYear()) s.add(y) })
    transactions.forEach(t => { const y = new Date(t.date).getFullYear(); if (y >= companyStart.getFullYear()) s.add(y) })
    return [...s].sort((a, b) => b - a).map(String)
  }, [invoices, transactions, companyStart])

  async function handleExport(type) {
    setExporting(true)
    try {
      const year = parseInt(filterYear)
      const wb = XLSX.utils.book_new()

      if (type === 'factures' || type === 'all') {
        const invData = invoices
          .filter(i => new Date(i.invoice_date).getFullYear() === year)
          .map(i => ({
            'Référence': i.reference,
            'Date': new Date(i.invoice_date).toLocaleDateString('fr-FR'),
            'Échéance': i.due_date ? new Date(i.due_date).toLocaleDateString('fr-FR') : '',
            'Client': i.clients?.name || '',
            'Type': i.type === 'credit_note' ? 'Avoir' : 'Facture',
            'Total HT': parseFloat(i.total_ht) || 0,
            'TVA': parseFloat(i.total_tva) || 0,
            'Total TTC': parseFloat(i.total_ttc) || 0,
            'Payé': parseFloat(i.amount_paid) || 0,
            'Restant': parseFloat(i.amount_due) || 0,
            'Statut': STATUS_LABELS[i.status] || i.status,
          }))
        const ws = XLSX.utils.json_to_sheet(invData)
        ws['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 30 }, { wch: 10 },
          { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }]
        XLSX.utils.book_append_sheet(wb, ws, 'Factures')
      }

      if (type === 'paiements' || type === 'all') {
        const payData = payments
          .filter(p => new Date(p.payment_date).getFullYear() === year)
          .map(p => ({
            'Date': new Date(p.payment_date).toLocaleDateString('fr-FR'),
            'Facture': p.invoices?.reference || '',
            'Client': p.invoices?.clients?.name || '',
            'Mode': p.payment_method,
            'Référence': p.payment_reference || '',
            'Montant': parseFloat(p.amount) || 0,
            'Notes': p.notes || '',
          }))
        const ws = XLSX.utils.json_to_sheet(payData)
        ws['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 30 }, { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 30 }]
        XLSX.utils.book_append_sheet(wb, ws, 'Encaissements')
      }

      if (type === 'transactions' || type === 'all') {
        const txData = transactions
          .filter(t => new Date(t.date).getFullYear() === year && !t.is_personal)
          .map(t => ({
            'Date': new Date(t.date).toLocaleDateString('fr-FR'),
            'Description': t.description,
            'Catégorie': t.category_name || '',
            'Débit': t.debit || 0,
            'Crédit': t.credit || 0,
            'Note comptable': t.note_comptable || '',
            'Facture liée': t.linked_invoice_id ? 'Oui' : '',
            'Manuel': t.is_manual ? 'Oui' : 'Non',
          }))
        const ws = XLSX.utils.json_to_sheet(txData)
        ws['!cols'] = [{ wch: 12 }, { wch: 40 }, { wch: 25 }, { wch: 12 }, { wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 10 }]
        XLSX.utils.book_append_sheet(wb, ws, 'Transactions')
      }

      const orgSlug = String(org?.name || org?.legal_name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      const filename = `${orgSlug ? orgSlug + '_' : ''}Compta_${filterYear}_${type}_${new Date().toISOString().split('T')[0]}.xlsx`
      XLSX.writeFile(wb, filename)
      toast.success(`Export ${filename} téléchargé`)
    } catch (e) {
      console.error('Export error:', e)
      toast.error('Erreur export : ' + e.message)
    }
    setExporting(false)
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-6">
        <h3 className="font-semibold text-gray-700 mb-2">Export comptable Excel</h3>
        <p className="text-sm text-gray-500 mb-6">Téléchargez les données comptables au format Excel (.xlsx) pour votre logiciel de comptabilité.</p>

        <div className="mb-6">
          <label className="text-sm font-medium text-gray-700 block mb-2">Exercice comptable</label>
          <select
            value={filterYear}
            onChange={e => setFilterYear(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm w-40"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { type: 'all', label: 'Export complet', desc: 'Factures + encaissements + transactions', color: 'bg-violet-600 hover:bg-violet-700 text-white' },
            { type: 'factures', label: 'Factures', desc: 'Liste des factures et avoirs', color: 'bg-blue-600 hover:bg-blue-700 text-white' },
            { type: 'paiements', label: 'Encaissements', desc: 'Journal des paiements reçus', color: 'bg-green-600 hover:bg-green-700 text-white' },
            { type: 'transactions', label: 'Transactions', desc: 'Relevé bancaire avec annotations', color: 'bg-amber-500 hover:bg-amber-600 text-white' },
          ].map(btn => (
            <button
              key={btn.type}
              onClick={() => handleExport(btn.type)}
              disabled={exporting}
              className={`${btn.color} rounded-xl p-4 text-left transition disabled:opacity-50`}
            >
              <div className="flex items-start gap-2">
                <Download className="w-5 h-5 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-sm">{btn.label}</p>
                  <p className="text-xs opacity-80 mt-1">{btn.desc}</p>
                  <p className="text-xs opacity-70 mt-1">Exercice {filterYear}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {exporting && (
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-violet-600"></div>
            Génération en cours...
          </div>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <strong>Format :</strong> Les fichiers Excel exportés sont compatibles avec Sage, Ciel Compta, EBP et tous les logiciels comptables standard.
        L'export FEC normalisé DGFiP est disponible dans l'onglet <strong> FEC DGFiP</strong>.
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// FEC DGFIP - Fichier des Écritures Comptables
// Format normalisé DGFiP - Art. L47 A LPF
// Identité de l'organisme (SIREN, banque) : organization_settings
// ════════════════════════════════════════════════════════════

// Mapping catégories → comptes PCG
const CATEGORY_ACCOUNT = {
  'CA Formations':                    { num: '706000', lib: 'Prestations de services - Formations' },
  'CA Sous-traitance':                { num: '706000', lib: 'Prestations de services - Sous-traitance' },
  'Frais bancaires':                  { num: '627000', lib: 'Services bancaires' },
  'Assurances santé/prévoyance':      { num: '646000', lib: 'Charges de prevoyance' },
  'Assurances véhicule':              { num: '616000', lib: 'Primes assurance vehicule' },
  'Télécoms':                         { num: '626000', lib: 'Frais postaux et telecom' },
  'Charges sociales (URSSAF)':        { num: '645000', lib: 'Charges securite sociale' },
  'Logiciels & SaaS':                 { num: '618500', lib: 'Logiciels et abonnements' },
  'Remboursements reçus':             { num: '758000', lib: 'Produits divers gestion' },
  'Sous-traitance':                   { num: '604000', lib: 'Achats prestations services' },
  'Restauration pro':                 { num: '625100', lib: 'Frais repas' },
  'Trésorerie interne':               { num: '580000', lib: 'Virements internes' },
  'Prêts (réception)':               { num: '163000', lib: 'Autres emprunts' },
  'Apports associés':                 { num: '455000', lib: 'Associes comptes courants' },
  'Salaires':                         { num: '641000', lib: 'Salaires et traitements' },
  'Carburant':                        { num: '624100', lib: 'Frais de deplacement' },
  'Matériel formation':               { num: '606000', lib: 'Achats materiel formation' },
  'Autre / Non classé':               { num: '658000', lib: 'Charges diverses' },
}

function getCategoryAccount(categoryName) {
  if (!categoryName) return { num: '658000', lib: 'Charges diverses' }
  // Correspondance exacte d'abord
  if (CATEGORY_ACCOUNT[categoryName]) return CATEGORY_ACCOUNT[categoryName]
  // Correspondance partielle
  for (const [key, val] of Object.entries(CATEGORY_ACCOUNT)) {
    if (categoryName.includes(key) || key.includes(categoryName)) return val
  }
  return { num: '658000', lib: 'Charges diverses' }
}

function fecDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`
}

function fecAmt(n) {
  return Math.abs(parseFloat(n) || 0).toFixed(2)
}

function sanitize(s) {
  if (!s) return ''
  // Supprimer les pipes et caractères problématiques
  return String(s).replace(/[|\n\r]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 100)
}

function generateFEC(invoices, payments, transactions, exercice, org) {
  const { start, end } = exercice
  const BANK_LIB = sanitize(bankLabel(org)) // JournalLib du journal BQ et CompteLib du 512000
  const lines = []
  let ecritureNum = 1

  // En-tête FEC (18 colonnes)
  const HEADER = 'JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|EcritureLet|DateLet|ValidDate|Montantdevise|Idevise'
  lines.push(HEADER)

  const inRange = (d) => { const dt = new Date(d); return dt >= start && dt <= end }

  // ── JOURNAL VT : Ventes (factures émises) ──────────────────
  const filteredInvoices = invoices.filter(i =>
    i.invoice_date && inRange(i.invoice_date) &&
    i.status !== 'draft' && i.status !== 'cancelled'
  ).sort((a, b) => new Date(a.invoice_date) - new Date(b.invoice_date))

  for (const inv of filteredInvoices) {
    const dateStr = fecDate(inv.invoice_date)
    const validDate = fecDate(inv.invoice_date)
    const pieceRef = sanitize(inv.reference)
    const clientName = sanitize(inv.clients?.name || 'CLIENT INCONNU')
    const clientCode = `C${(inv.client_id || '').replace(/-/g,'').substring(0,8).toUpperCase()}`
    const htAmt = parseFloat(inv.total_ht) || 0
    const tvaAmt = parseFloat(inv.total_tva) || 0
    const ttcAmt = parseFloat(inv.total_ttc) || 0
    const isCreditNote = inv.type === 'credit_note'
    const lib = sanitize(isCreditNote ? `Avoir ${pieceRef}` : `Facture ${pieceRef} - ${clientName}`)

    // Ligne 1 : Débit client (411000) ou Crédit si avoir
    lines.push([
      'VT', 'Ventes',
      `VT${String(ecritureNum).padStart(6,'0')}`,
      dateStr,
      '411000', 'Clients',
      clientCode, clientName,
      pieceRef, dateStr,
      lib,
      isCreditNote ? '0.00' : fecAmt(ttcAmt),
      isCreditNote ? fecAmt(ttcAmt) : '0.00',
      '', '', validDate, '', ''
    ].join('|'))

    // Ligne 2 : Crédit prestations (706000) ou Débit si avoir
    lines.push([
      'VT', 'Ventes',
      `VT${String(ecritureNum).padStart(6,'0')}`,
      dateStr,
      '706000', 'Prestations de services',
      '', '',
      pieceRef, dateStr,
      lib,
      isCreditNote ? fecAmt(htAmt) : '0.00',
      isCreditNote ? '0.00' : fecAmt(htAmt),
      '', '', validDate, '', ''
    ].join('|'))

    // Ligne 3 : TVA si applicable
    if (inv.tva_applicable && tvaAmt > 0) {
      lines.push([
        'VT', 'Ventes',
        `VT${String(ecritureNum).padStart(6,'0')}`,
        dateStr,
        '445711', 'TVA collectee 20%',
        '', '',
        pieceRef, dateStr,
        lib,
        isCreditNote ? fecAmt(tvaAmt) : '0.00',
        isCreditNote ? '0.00' : fecAmt(tvaAmt),
        '', '', validDate, '', ''
      ].join('|'))
    }

    ecritureNum++
  }

  // ── JOURNAL BQ : Encaissements (invoice_payments) ──────────
  const filteredPayments = payments.filter(p =>
    p.payment_date && inRange(p.payment_date)
  ).sort((a, b) => new Date(a.payment_date) - new Date(b.payment_date))

  for (const p of filteredPayments) {
    const dateStr = fecDate(p.payment_date)
    const amt = parseFloat(p.amount) || 0
    const invRef = sanitize(p.invoices?.reference || 'ENCAISSEMENT')
    const clientName = sanitize(p.invoices?.clients?.name || '')
    const clientCode = p.invoices?.client_id
      ? `C${(p.invoices.client_id || '').replace(/-/g,'').substring(0,8).toUpperCase()}`
      : ''
    const payRef = sanitize(p.payment_reference || p.payment_method || 'VIR')
    const lib = sanitize(`Encaissement ${invRef}${clientName ? ' - ' + clientName : ''}`)

    // Débit banque
    lines.push([
      'BQ', BANK_LIB,
      `BQ${String(ecritureNum).padStart(6,'0')}`,
      dateStr,
      '512000', BANK_LIB,
      '', '',
      payRef, dateStr,
      lib,
      fecAmt(amt), '0.00',
      '', '', dateStr, '', ''
    ].join('|'))

    // Crédit client
    lines.push([
      'BQ', BANK_LIB,
      `BQ${String(ecritureNum).padStart(6,'0')}`,
      dateStr,
      '411000', 'Clients',
      clientCode, clientName,
      payRef, dateStr,
      lib,
      '0.00', fecAmt(amt),
      '', '', dateStr, '', ''
    ].join('|'))

    ecritureNum++
  }

  // ── JOURNAL BQ : Transactions bancaires (budget_transactions) ─
  const filteredTx = transactions.filter(t =>
    t.date && inRange(t.date) && !t.is_personal
  ).sort((a, b) => new Date(a.date) - new Date(b.date))

  for (const tx of filteredTx) {
    const dateStr = fecDate(tx.date)
    const isDebit = (tx.debit || 0) > 0
    const isCredit = (tx.credit || 0) > 0
    const amt = isDebit ? parseFloat(tx.debit) : parseFloat(tx.credit)
    if (!amt || amt <= 0) continue

    const account = getCategoryAccount(tx.category_name)
    const lib = sanitize(tx.note_comptable || tx.description || 'Transaction bancaire')
    const pieceRef = sanitize(tx.description || 'TX')

    if (isDebit) {
      // Charge : Débit compte charge, Crédit banque
      lines.push([
        'BQ', BANK_LIB,
        `BQ${String(ecritureNum).padStart(6,'0')}`,
        dateStr,
        account.num, sanitize(account.lib),
        '', '',
        pieceRef, dateStr, lib,
        fecAmt(amt), '0.00',
        '', '', dateStr, '', ''
      ].join('|'))
      lines.push([
        'BQ', BANK_LIB,
        `BQ${String(ecritureNum).padStart(6,'0')}`,
        dateStr,
        '512000', BANK_LIB,
        '', '',
        pieceRef, dateStr, lib,
        '0.00', fecAmt(amt),
        '', '', dateStr, '', ''
      ].join('|'))
    } else if (isCredit && !tx.linked_invoice_id) {
      // Encaissement non lié à une facture : Débit banque, Crédit compte
      lines.push([
        'BQ', BANK_LIB,
        `BQ${String(ecritureNum).padStart(6,'0')}`,
        dateStr,
        '512000', BANK_LIB,
        '', '',
        pieceRef, dateStr, lib,
        fecAmt(amt), '0.00',
        '', '', dateStr, '', ''
      ].join('|'))
      lines.push([
        'BQ', BANK_LIB,
        `BQ${String(ecritureNum).padStart(6,'0')}`,
        dateStr,
        account.num, sanitize(account.lib),
        '', '',
        pieceRef, dateStr, lib,
        '0.00', fecAmt(amt),
        '', '', dateStr, '', ''
      ].join('|'))
    }
    // Si linked_invoice_id = déjà traité dans les paiements → on skip

    ecritureNum++
  }

  return lines.join('\n')
}

function FecTab({ invoices, payments, transactions }) {
  const { org, exercices, closingLabel } = useFiscal()
  const [selectedExo, setSelectedExo] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [preview, setPreview] = useState(null)

  const exercice = exercices[selectedExo]
  const siren = orgSiren(org)
  const siret = String(org?.siret || '').replace(/\D/g, '')
  const fecDisabled = !siren

  // Stats de l'exercice sélectionné
  const stats = useMemo(() => {
    if (!exercice) return {}
    const { start, end } = exercice
    const inRange = (d) => { const dt = new Date(d); return dt >= start && dt <= end }
    const invs = invoices.filter(i => i.invoice_date && inRange(i.invoice_date) && i.status !== 'draft' && i.status !== 'cancelled')
    const pays = payments.filter(p => p.payment_date && inRange(p.payment_date))
    const txs = transactions.filter(t => t.date && inRange(t.date) && !t.is_personal)
    const totalVentes = invs.reduce((s, i) => s + (i.type === 'credit_note' ? -1 : 1) * (parseFloat(i.total_ttc) || 0), 0)
    const totalEncaisse = pays.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
    return { nbInvoices: invs.length, nbPayments: pays.length, nbTx: txs.length, totalVentes, totalEncaisse }
  }, [invoices, payments, transactions, exercice])

  async function handleGenerate() {
    if (!exercice || !exercice.filename) { toast.error('Renseignez le SIREN dans Paramètres'); return }
    setGenerating(true)
    try {
      const fecContent = generateFEC(invoices, payments, transactions, exercice, org)
      // Aperçu des 5 premières lignes (hors header)
      const lines = fecContent.split('\n')
      setPreview(lines.slice(1, 6))
      // Téléchargement
      const blob = new Blob([fecContent], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = exercice.filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`${exercice.filename} téléchargé`)
    } catch (e) {
      console.error('FEC error:', e)
      toast.error('Erreur FEC : ' + e.message)
    }
    setGenerating(false)
  }

  return (
    <div className="space-y-4">
      {/* Info légale */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <h3 className="font-semibold text-amber-800 flex items-center gap-2 mb-1">
          <FileText className="w-4 h-4" />
          Fichier des Écritures Comptables - Format DGFiP
        </h3>
        <p className="text-sm text-amber-700">
          Obligatoire en cas de contrôle fiscal (art. L47 A LPF). Amende minimum <strong>5 000 €</strong> si non produit.
          Ce fichier au format texte pipe-séparé est compatible avec tous les logiciels comptables français (Sage, Ciel, EBP, ACD...).
        </p>
      </div>

      {/* Identité société */}
      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-gray-700 mb-3">Identification{(org?.legal_name || org?.name) ? ` - ${String(org.legal_name || org.name).toUpperCase()}` : ''}</h3>
        {!org ? (
          <p className="text-sm text-gray-400">Chargement des paramètres de l'organisme...</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div><p className="text-xs text-gray-400">SIREN</p><p className="font-mono font-bold">{siren ? siren.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : 'Non renseigné'}</p></div>
            <div><p className="text-xs text-gray-400">SIRET</p><p className="font-mono font-bold">{siret.length === 14 ? siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, '$1 $2 $3 $4') : (siret || 'Non renseigné')}</p></div>
            <div><p className="text-xs text-gray-400">Forme</p><p className="font-bold">{org.forme_juridique || '-'}</p></div>
            <div><p className="text-xs text-gray-400">Clôture</p><p className="font-bold">{closingLabel}</p></div>
            <div><p className="text-xs text-gray-400">Banque</p><p className="font-bold">{org.bank_name || 'Non renseignée (Paramètres)'}</p></div>
            <div className="col-span-3"><p className="text-xs text-gray-400">IBAN</p><p className="font-mono">{formatIban(org)}</p></div>
          </div>
        )}
        {org && fecDisabled && (
          <div className="mt-3 flex items-center gap-2 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Renseignez le SIREN dans Paramètres : le nom légal du fichier FEC en dépend, l'export est désactivé.
          </div>
        )}
      </div>

      {/* Sélection exercice + stats */}
      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-gray-700 mb-3">Exercice comptable</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {exercices.map((exo, idx) => {
            const isCurrent = new Date() >= exo.start && new Date() <= exo.end
            return (
              <button
                key={idx}
                onClick={() => setSelectedExo(idx)}
                className={`p-3 rounded-xl border-2 text-left transition ${
                  selectedExo === idx ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-gray-900">{exo.label}</span>
                  {isCurrent && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">En cours</span>}
                </div>
                <p className="text-xs text-gray-400 font-mono">{exo.filename || 'SIREN manquant'}</p>
              </button>
            )
          })}
        </div>

        {/* Stats de l'exercice */}
        {exercice && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
            {[
              { label: 'Factures', value: stats.nbInvoices || 0, unit: 'lignes' },
              { label: 'Encaissements', value: stats.nbPayments || 0, unit: 'lignes' },
              { label: 'Transactions', value: stats.nbTx || 0, unit: 'lignes' },
              { label: 'CA total TTC', value: new Intl.NumberFormat('fr-FR', {style:'currency',currency:'EUR'}).format(stats.totalVentes || 0), unit: '' },
              { label: 'Encaissé', value: new Intl.NumberFormat('fr-FR', {style:'currency',currency:'EUR'}).format(stats.totalEncaisse || 0), unit: '' },
            ].map(s => (
              <div key={s.label} className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className="font-bold text-gray-900 mt-1">{s.value}</p>
                {s.unit && <p className="text-xs text-gray-400">{s.unit}</p>}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={generating || fecDisabled || !exercice}
          className="w-full flex items-center justify-center gap-3 py-3 bg-violet-600 text-white rounded-xl font-semibold hover:bg-violet-700 disabled:opacity-50 transition"
        >
          <Download className="w-5 h-5" />
          {generating ? 'Génération en cours...' : fecDisabled ? 'Export FEC indisponible : SIREN manquant' : `Générer et télécharger ${exercice?.filename || ''}`}
        </button>
      </div>

      {/* Aperçu */}
      {preview && (
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-gray-700 mb-2">Aperçu des premières lignes</h3>
          <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
            <p className="text-gray-400 text-xs font-mono mb-1">JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|...</p>
            {preview.map((line, i) => (
              <p key={i} className="text-green-400 text-xs font-mono whitespace-nowrap">{line.substring(0, 120)}{line.length > 120 ? '...' : ''}</p>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">Format : pipe-séparé | UTF-8 | 18 colonnes | Conforme DGFiP art. L47 A LPF</p>
        </div>
      )}

      {/* Plan comptable utilisé */}
      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-gray-700 mb-3">Plan comptable utilisé</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {[
            ['411000', 'Clients'],
            ['706000', 'Prestations de services'],
            ['445711', 'TVA collectée 20%'],
            ['512000', bankLabel(org)],
            ['604000', 'Achats prestations (sous-traitance)'],
            ['616000', 'Primes assurance'],
            ['618500', 'Logiciels & abonnements'],
            ['624100', 'Frais de déplacement'],
            ['625100', 'Frais repas'],
            ['626000', 'Frais télécom'],
            ['627000', 'Services bancaires'],
            ['641000', 'Salaires'],
            ['645000', 'Charges sociales URSSAF'],
            ['646000', 'Charges prévoyance'],
            ['163000', 'Autres emprunts'],
            ['455000', 'Associés - comptes courants'],
            ['580000', 'Virements internes'],
            ['658000', 'Charges diverses'],
          ].map(([num, lib]) => (
            <div key={num} className="flex items-center gap-2">
              <span className="font-mono text-violet-700 font-bold w-16 shrink-0">{num}</span>
              <span className="text-gray-600">{lib}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Ces comptes peuvent être remappés par votre comptable dans son logiciel sans modifier le FEC.
        </p>
      </div>
    </div>
  )
}

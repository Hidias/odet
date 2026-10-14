import { apiFetch } from '../../../core/api'
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../../../core/supabase'
import toast from 'react-hot-toast'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area } from 'recharts'
import { generateInvoicePDF, generateFacturXPDF, calcInvoiceTotals } from '../../commercial/pdf/invoiceGenerator'
import { useDataStore, useAuthStore } from '../../../core/store'
import { team, currentUserName, currentUserEmail, orgLegalName, orgName } from '../../../core/org/currentOrg'
import SirenConflictModal from '../../commercial/components/SirenConflictModal'
import { useSirenCheck } from '../../commercial/lib/useSirenCheck'

// ════════════════════════════════════════════════════════════
//  BUDGET MODULE v4
//  + Catégorisation IA intelligente + Prévisionnel 50k€
// ════════════════════════════════════════════════════════════

const TABS = [
  { key: 'transactions', label: 'Transactions' },
  { key: 'saisie', label: 'Saisie' },
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'categorisation', label: 'Catégorisation' },
  { key: 'previsionnel', label: 'Prévisionnel' },
  { key: 'comptable', label: 'Comptable' },
  { key: 'categories', label: 'Catégories' },
  { key: 'rules', label: 'Règles' },
  { key: 'import', label: 'Import' },
  { key: 'releves', label: 'Relevés' },
]

// Transactions privées : réservées au dirigeant (rôle superadmin).
// Elles restent comptées dans les KPI, mais n'apparaissent dans aucune liste
// des autres comptes. Le propriétaire enregistré (private_owner) est l'email
// de connexion du dirigeant qui masque la ligne (contrôlé par la policy RLS).
const PRIVATE_ROLE = 'superadmin'


const ML = {
  '01/2025':'Jan 25','02/2025':'Fév 25','03/2025':'Mar 25','04/2025':'Avr 25',
  '05/2025':'Mai 25','06/2025':'Jun 25','07/2025':'Jul 25','08/2025':'Aoû 25',
  '09/2025':'Sep 25','10/2025':'Oct 25','11/2025':'Nov 25','12/2025':'Déc 25',
  '01/2026':'Jan 26','02/2026':'Fév 26','03/2026':'Mar 26',
}


const fmt = (n) => n ? (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : '-'
const fmtS = (n) => { if (!n) return '-'; const a = Math.abs(n); return a >= 1000 ? (a/1000).toFixed(1)+'k€' : Math.round(a)+'€' }

//  PostgREST plafonne toute requête à 1000 lignes quand aucune plage n'est
// demandée. Passé ce seuil, les lignes les plus anciennes disparaissent
// SILENCIEUSEMENT : pas d'erreur, juste un tableau tronqué - et donc des KPI,
// un dashboard et un prévisionnel faux.
// fetchAll() pagine par tranches de 1000 jusqu'à avoir tout récupéré.
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

// Formate une date SQL 'YYYY-MM-DD' sans passer par new Date() :
// évite le décalage UTC/Paris qui décale l'affichage d'un jour.
const fmtDateFR = (d) => {
  if (!d) return '-'
  const [y, m, day] = String(d).slice(0, 10).split('-')
  return (y && m && day) ? `${day}/${m}/${y}` : '-'
}

// ════════════════════════════════════════════════════════════
//  ASSOCIÉS (dirigeants) - dérivés de l'équipe, rien en dur
// ════════════════════════════════════════════════════════════
// Associé = membre de l'équipe de rôle superadmin ou admin.
// Payeur d'une dépense personnelle : 'perso_<id du profil>'.
// Anciennes valeurs en base : '<prénom>_perso' (lues, jamais réécrites).
// Clés budget_settings / KPI : '<préfixe>_<slug du prénom>'.
const ASSOCIATE_ROLES = ['superadmin', 'admin']
const PAYER_COMPANY = 'entreprise'
const LEGACY_PERSO_SUFFIX = '_perso'
const PERSO_PREFIX = 'perso_'

const slugify = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : ''

/** Associés : [{ id, slug, firstName, name, email, role, payer, legacyPayer }] */
function getAssociates() {
  const used = new Set()
  return team()
    .filter(m => ASSOCIATE_ROLES.includes(m.role))
    .map(m => {
      const first = m.firstName || String(m.name || '').split(' ')[0] || ''
      let slug = slugify(first) || slugify(String(m.email || '').split('@')[0]) || String(m.id || '').slice(0, 8)
      if (used.has(slug)) slug = `${slug}_${String(m.id || '').slice(0, 4)}`
      used.add(slug)
      return {
        id: m.id, slug,
        firstName: first || m.name || m.email || '',
        name: m.name || first, email: m.email, role: m.role,
        payer: `${PERSO_PREFIX}${m.id}`,
        legacyPayer: `${slug}${LEGACY_PERSO_SUFFIX}`,
      }
    })
}

const isLegacyPersoPayer = (p) => typeof p === 'string' && p.endsWith(LEGACY_PERSO_SUFFIX) && p !== LEGACY_PERSO_SUFFIX

/** Associé correspondant à une valeur de payeur (nouvelle ou ancienne), sinon null */
function associateForPayer(payer, associates) {
  if (!payer || payer === PAYER_COMPANY) return null
  return associates.find(a => a.payer === payer || a.legacyPayer === payer) || null
}

/** Libellé d'un payeur : prénom de l'associé, ou déduit d'une ancienne valeur ('x_perso' donne 'X') */
function payerLabel(payer, associates) {
  if (!payer || payer === PAYER_COMPANY) return 'Entreprise'
  const a = associateForPayer(payer, associates)
  if (a) return a.firstName
  if (isLegacyPersoPayer(payer)) return capitalize(payer.slice(0, -LEGACY_PERSO_SUFFIX.length))
  return 'Associé'
}

/** Options de payeur : entreprise puis un bouton par associé */
function payerOptions(associates) {
  return [{ v: PAYER_COMPANY, l: 'Entreprise' }, ...associates.map(a => ({ v: a.payer, l: a.firstName }))]
}

/** Deux valeurs de payeur désignent-elles la même personne (nouvelle ou ancienne valeur) ? */
function samePayer(a, b, associates) {
  if (a === b) return true
  const x = associateForPayer(a, associates), y = associateForPayer(b, associates)
  return !!x && x === y
}

/**
 * Titulaires de comptes courants d'associés : les associés, plus toute ancienne
 * valeur de payeur trouvée en base qui ne correspond à aucun associé actuel.
 * Retour : [{ key, slug, label, payers: [...], legacyPayer }]
 */
function ccaHolders(associates, transactions, serverPayers = []) {
  const holders = associates.map(a => ({ key: a.id, slug: a.slug, label: a.firstName, payers: [a.payer, a.legacyPayer], legacyPayer: a.legacyPayer }))
  const known = new Set(holders.flatMap(h => h.payers))
  const seen = [...(transactions || []).filter(t => t.is_personal).map(t => t.payer), ...serverPayers]
  seen.forEach(p => {
    if (!p || p === PAYER_COMPANY || known.has(p)) return
    known.add(p)
    if (isLegacyPersoPayer(p)) {
      const slug = p.slice(0, -LEGACY_PERSO_SUFFIX.length)
      holders.push({ key: p, slug, label: capitalize(slug), payers: [p], legacyPayer: p })
    } else {
      holders.push({ key: p, slug: slugify(p), label: 'Associé', payers: [p], legacyPayer: null })
    }
  })
  return holders
}

/** Membre de repas par défaut : l'utilisateur connecté s'il est associé, sinon le premier associé */
function defaultAssociateSlug(associates) {
  const me = currentUserEmail().toLowerCase()
  const mine = associates.find(a => a.email && a.email.toLowerCase() === me)
  return (mine || associates[0])?.slug || ''
}

function defaultAssociateFirstName(associates) {
  const me = currentUserEmail().toLowerCase()
  const mine = associates.find(a => a.email && a.email.toLowerCase() === me)
  return (mine || associates[0])?.firstName || ''
}

/** Clé budget_settings du salaire d'un associé ('charge_salaire_<slug>') */
const SALARY_KEY_PREFIX = 'charge_salaire_'
const salaryKeyFor = (slug) => `${SALARY_KEY_PREFIX}${slug}`
/** Nom de catégorie du salaire d'un associé */
const salaryNameFor = (firstName) => `Salaire ${firstName}`

/** Nom de l'organisme pour les prompts IA : raison sociale + forme juridique */
function orgLabelForAI(organization) {
  const name = organization?.legal_name || organization?.name || orgLegalName() || orgName() || "l'organisme"
  const forme = organization?.forme_juridique ? ` (${organization.forme_juridique})` : ''
  return `${name}${forme}`
}

/** Activité de l'organisme pour les prompts IA */
function orgActivityForAI(organization) {
  const kind = organization?.activity_kind || 'of'
  const base = kind === 'entreprise' ? 'entreprise' : kind === 'mixte' ? 'organisme de formation professionnelle et entreprise de services' : 'organisme de formation professionnelle'
  return organization?.naf ? `${base}, code NAF ${organization.naf}` : base
}

/** Nom de la banque de l'organisme (repli : « banque ») */
const bankName = (organization) => (organization?.bank_name || '').trim() || 'banque'

/** Libellé de compte par défaut : banque + 4 derniers chiffres de l'IBAN, sinon vide */
function defaultAccountLabel(organization) {
  const iban = String(organization?.iban || '').replace(/\s+/g, '')
  if (!iban) return ''
  return [(organization?.bank_name || '').trim(), iban.slice(-4)].filter(Boolean).join(' - ')
}

export default function BudgetModule() {
  const { organization, fetchOrganization } = useDataStore()
  // Découvert autorisé : Paramètres > Banque (0 = aucun découvert autorisé)
  const DECOUVERT_AUTORISE = Number(organization?.bank_overdraft) || 0
  useEffect(() => { if (!organization) fetchOrganization() }, [])

  const [tab, setTab] = useState('transactions')
  const [transactions, setTransactions] = useState([])
  const [categories, setCategories] = useState([])
  const [rules, setRules] = useState([])
  const [receipts, setReceipts] = useState({})
  const [loading, setLoading] = useState(true)
  const [filterMonth, setFilterMonth] = useState('all')
  const [filterCat, setFilterCat] = useState('all')
  const [filterDir, setFilterDir] = useState('all')
  const [filterSearch, setFilterSearch] = useState('')
  const [showPerso, setShowPerso] = useState(true)
  const [editingTx, setEditingTx] = useState(null)

  // Données partagées pour Import + Saisie
  const [invoicesList, setInvoicesList] = useState([])
  const [clientsList, setClientsList] = useState([])

  // Modal invités repas (rétroactif)
  const [mealGuestTxId, setMealGuestTxId] = useState(null)

  // ── Transactions privées : réservées au dirigeant (rôle PRIVATE_ROLE) ──
  const [userEmail, setUserEmail] = useState(null) // null = session pas encore lue
  const userRole = useAuthStore(s => s.userRole)
  const canSeePrivate = !!userEmail && userRole === PRIVATE_ROLE

  // ── Associés (dirigeants) : comptes courants et dépenses personnelles ──
  const associates = useMemo(() => getAssociates(), [userRole])

  // ── Relevés bancaires ──
  const [statements, setStatements] = useState([])

  // ── KPI agrégés côté serveur ──
  // Depuis la policy RLS, les lignes privées ne parviennent plus au
  // navigateur des autres comptes : leurs totaux seraient minorés.
  // La RPC les calcule en base (SECURITY DEFINER) et ne renvoie que
  // des agrégats - le détail des lignes reste protégé.
  const [serverKpis, setServerKpis] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail((data?.user?.email || '').toLowerCase())
    })
  }, [])

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [txAll, catR, ruleR, rcpAll, invAll, cliAll, stmtR] = await Promise.all([
      // Tables volumineuses → pagination obligatoire (voir fetchAll)
      fetchAll(() => supabase.from('budget_transactions').select('*').order('date', { ascending: false })),
      supabase.from('budget_categories').select('*').order('sort_order'),
      supabase.from('budget_rules').select('*, budget_categories(name, icon)').order('keyword'),
      fetchAll(() => supabase.from('budget_receipts').select('*')),
      fetchAll(() => supabase.from('invoices').select('*, clients!invoices_client_id_fkey(name)').order('invoice_date', { ascending: false })),
      fetchAll(() => supabase.from('clients').select('*').order('name')),
      supabase.from('bank_statements').select('*').order('period_end', { ascending: false }),
    ])

    // KPI serveur - non bloquant : en cas d'échec on retombe sur le calcul local
    const kpiR = await supabase.rpc('get_budget_kpis')
    if (kpiR.error) {
      console.warn('get_budget_kpis indisponible, calcul local utilisé :', kpiR.error.message)
      setServerKpis(null)
    } else {
      setServerKpis(Array.isArray(kpiR.data) ? kpiR.data[0] : kpiR.data)
    }
    setTransactions(txAll)
    if (catR.data) setCategories(catR.data)
    if (ruleR.data) setRules(ruleR.data)
    {
      const map = {}
      rcpAll.forEach(r => { if (!map[r.transaction_id]) map[r.transaction_id] = []; map[r.transaction_id].push(r) })
      setReceipts(map)
    }
    setInvoicesList(invAll)
    setClientsList(cliAll)
    if (stmtR.data) setStatements(stmtR.data)
    setLoading(false)
  }

  const months = useMemo(() => [...new Set(transactions.map(tx => tx.month).filter(Boolean))].sort(), [transactions])

  const filtered = useMemo(() => transactions.filter(tx => {
    if (tx.linked_transaction_id) return false // Ligne bancaire absorbée par une saisie manuelle - masquée
    if (tx.is_private && !(canSeePrivate && String(tx.private_owner || '').toLowerCase() === userEmail)) return false // Transaction privée : invisible hors propriétaire
    if (filterMonth !== 'all' && tx.month !== filterMonth) return false
    if (filterCat !== 'all' && tx.category_name !== filterCat) return false
    if (filterDir === 'debit' && !(tx.debit > 0)) return false
    if (filterDir === 'credit' && !(tx.credit > 0)) return false
    if (!showPerso && tx.is_personal) return false
    if (filterSearch) { const s = filterSearch.toLowerCase(); if (!tx.description?.toLowerCase().includes(s) && !tx.category_name?.toLowerCase().includes(s)) return false }
    return true
  }), [transactions, filterMonth, filterCat, filterDir, filterSearch, showPerso, canSeePrivate, userEmail])

  const stats = useMemo(() => {
    // Entrées / Sorties : une seule ligne par mouvement.
    // On exclut les lignes bancaires absorbées par une saisie manuelle
    // (linked_transaction_id) - sinon le mouvement est compté deux fois.
    // Les transactions privées SONT incluses : masquées en liste, comptées ici.
    const co = transactions.filter(tx => !tx.is_personal && !tx.linked_transaction_id)

    // Solde réel = vérité bancaire = imports uniquement.
    // Population volontairement différente de `co` : ici on garde la ligne
    // bancaire et on écarte la saisie manuelle, l'inverse de ci-dessus.
    const imports = transactions.filter(tx => !tx.is_manual)

    // Date du dernier mouvement bancaire connu (≠ date du jour)
    const bankDates = imports.map(t => t.date).filter(Boolean).sort()
    const soldeDate = bankDates.length ? bankDates[bankDates.length - 1] : null

    const byMonth = {}, byCat = {}
    co.forEach(tx => {
      if (!byMonth[tx.month]) byMonth[tx.month] = { debit: 0, credit: 0 }
      byMonth[tx.month].debit += tx.debit || 0; byMonth[tx.month].credit += tx.credit || 0
      const c = tx.category_name || 'Non classé'
      if (!byCat[c]) byCat[c] = { debit: 0, credit: 0, count: 0 }
      byCat[c].debit += tx.debit || 0; byCat[c].credit += tx.credit || 0; byCat[c].count++
    })
    const perso = transactions.filter(tx => tx.is_personal)
    // Calcul local - sert de repli si la RPC est indisponible
    const localDebit = co.reduce((s, t) => s + (t.debit || 0), 0)
    const localCredit = co.reduce((s, t) => s + (t.credit || 0), 0)
    const localSolde = Math.round(imports.reduce((s, t) => s + (t.credit || 0) - (t.debit || 0), 0) * 100) / 100
    const sumPerso = (payers) => perso.filter(t => payers.includes(t.payer)).reduce((s, t) => s + (t.debit || 0) - (t.credit || 0), 0)

    // Les agrégats serveur incluent les lignes privées que ce compte ne reçoit
    // pas (RLS) : ils font autorité dès qu'ils sont disponibles.
    const K = serverKpis
    const num = (v, fallback) => (v === null || v === undefined || Number.isNaN(Number(v))) ? fallback : Number(v)

    // Comptes courants d'associés. La RPC renvoie un total par valeur de payeur
    // (K.cca : { '<payeur>': montant }), lignes privées comprises ; repli : calcul local.
    const serverCca = K && K.cca && typeof K.cca === 'object' ? K.cca : null
    const cca = ccaHolders(associates, transactions, serverCca ? Object.keys(serverCca) : []).map(h => {
      const value = serverCca
        ? h.payers.reduce((s, p) => s + num(serverCca[p], 0), 0)
        : sumPerso(h.payers)
      return { key: h.key, label: h.label, value }
    })

    return {
      totalDebit: num(K?.total_debit, localDebit),
      totalCredit: num(K?.total_credit, localCredit),
      soldeCompte: num(K?.solde_compte, localSolde),
      soldeDate: K?.solde_date || soldeDate,
      nbPrivees: transactions.filter(t => t.is_private).length,
      kpiSource: K ? 'serveur' : 'local',
      byMonth, byCat,
      unclassified: co.filter(t => t.category_name === 'Autre / Non classé').length,
      cca,
      notSent: transactions.filter(t => !t.sent_to_comptable && (Object.keys(receipts).includes(t.id) || t.is_manual)).length,
      toInvoice: co.filter(t => t.credit > 0 && !t.linked_invoice_id && !t.is_personal).length,
    }
  }, [transactions, receipts, serverKpis, associates])

  async function changeCategory(txId, name) {
    const cat = categories.find(c => c.name === name)
    if (!cat) return
    await supabase.from('budget_transactions').update({ category_id: cat.id, category_name: cat.name }).eq('id', txId)
    setTransactions(p => p.map(t => t.id === txId ? { ...t, category_id: cat.id, category_name: cat.name } : t))
    toast.success(`→ ${cat.icon} ${cat.name}`); setEditingTx(null)
  }

  // Masque / démasque une transaction pour tous les autres comptes.
  // La ligne reste comptée dans les KPI (Solde, Entrées, Sorties).
  async function togglePrivate(tx) {
    if (!canSeePrivate) return
    const next = !tx.is_private
    const { error } = await supabase
      .from('budget_transactions')
      .update({ is_private: next, private_owner: next ? userEmail : null })
      .eq('id', tx.id)
    if (error) { toast.error('Erreur : ' + error.message); return }
    setTransactions(p => p.map(t => t.id === tx.id
      ? { ...t, is_private: next, private_owner: next ? userEmail : null }
      : t))
    toast.success(next ? ' Masquée pour les autres comptes' : ' Visible par tous')
  }

  async function deleteTx(txId) {
    if (!confirm('Supprimer ?')) return
    await supabase.from('budget_transactions').delete().eq('id', txId)
    setTransactions(p => p.filter(t => t.id !== txId))
    toast.success('Supprimée'); loadAll()
  }

  if (loading) return <div className="p-8 text-center text-gray-400"> Chargement...</div>

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border p-4 mb-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-xl font-bold text-gray-800"> Budget & Trésorerie</h2>
          <span className="text-xs text-gray-400">
            {serverKpis?.nb_transactions ?? transactions.length} opérations
            {serverKpis && Number(serverKpis.nb_transactions) > transactions.length && (
              <span className="ml-1 text-slate-400" title="Des opérations privées ne vous sont pas visibles, mais restent comptées dans les totaux"></span>
            )}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-8 gap-2">
          <KPI label="Entrées" value={fmt(stats.totalCredit)} color="green" />
          <KPI label="Sorties" value={fmt(stats.totalDebit)} color="red" />
          <KPI
            label="Solde compte"
            value={fmt(stats.soldeCompte)}
            color={stats.soldeCompte >= 0 ? 'green' : 'red'}
            sub={stats.soldeDate ? `au ${fmtDateFR(stats.soldeDate)}` : 'aucun import'}
          />
          <KPI
            label="Découvert"
            value={stats.soldeCompte < 0 ? fmt(Math.abs(stats.soldeCompte)) : '-'}
            color={stats.soldeCompte >= 0 ? 'green' : (!DECOUVERT_AUTORISE || Math.abs(stats.soldeCompte) >= DECOUVERT_AUTORISE * 0.8 ? 'red' : 'amber')}
            sub={DECOUVERT_AUTORISE ? `autorisé ${fmtS(DECOUVERT_AUTORISE)}` : 'aucun découvert autorisé'}
          />
          <KPI label="Non classés" value={stats.unclassified} color="amber" />
          {stats.cca.map(c => (
            <KPI key={c.key} label={`CCA ${c.label}`} value={fmt(c.value)} color="purple" sub="dette gérant" />
          ))}
          <KPI label="À envoyer" value={stats.notSent} color="blue" sub="comptable" />
        </div>

        {stats.soldeCompte < 0 && DECOUVERT_AUTORISE > 0 && Math.abs(stats.soldeCompte) >= DECOUVERT_AUTORISE * 0.8 && (
          <div className="mt-2 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
             Découvert à {Math.round(Math.abs(stats.soldeCompte) / DECOUVERT_AUTORISE * 100)}% de l'autorisation
            ({fmt(Math.abs(stats.soldeCompte))} / {fmt(DECOUVERT_AUTORISE)})
          </div>
        )}

        {stats.kpiSource === 'local' && (
          <div className="mt-2 text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2">
             Totaux calculés localement - si des opérations privées existent, ces montants peuvent être incomplets.
          </div>
        )}

        {canSeePrivate && stats.nbPrivees > 0 && (
          <div className="mt-2 text-xs bg-slate-50 border border-slate-200 text-slate-600 rounded-lg px-3 py-2">
             {stats.nbPrivees} transaction(s) privée(s) - visibles uniquement sur votre compte,
            mais comptées dans les totaux ci-dessus.
          </div>
        )}
      </div>

      {/* Tabs */}
      <nav className="flex gap-1 overflow-x-auto mb-4 pb-1 -mx-1 px-1">{TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 transition
              ${tab === t.key ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
            {t.key === 'comptable' && stats.notSent > 0 && <span className="ml-1 bg-blue-500 text-white text-xs rounded-full px-1.5">{stats.notSent}</span>}
            {t.key === 'categorisation' && stats.unclassified > 0 && <span className="ml-1 bg-amber-500 text-white text-xs rounded-full px-1.5">{stats.unclassified}</span>}
          </button>
        ))}</nav>

      {tab === 'transactions' && <TransactionsTab {...{ filtered, categories, months, filterMonth, setFilterMonth, filterCat, setFilterCat, filterDir, setFilterDir, filterSearch, setFilterSearch, showPerso, setShowPerso, editingTx, setEditingTx, changeCategory, deleteTx, receipts, onMealGuest: setMealGuestTxId, canSeePrivate, togglePrivate }} />}
      {tab === 'saisie' && <SaisieTab categories={categories} rules={rules} loadAll={loadAll} clients={clientsList} associates={associates} organization={organization} />}
      {tab === 'dashboard' && <DashboardTab stats={stats} months={months} categories={categories} transactions={transactions} invoices={invoicesList} clients={clientsList} />}
      {tab === 'categorisation' && <CategorisationIATab transactions={transactions} categories={categories} rules={rules} loadAll={loadAll} associates={associates} organization={organization} />}
      {tab === 'previsionnel' && <PrevisionnelTab transactions={transactions} categories={categories} invoices={invoicesList} clients={clientsList} associates={associates} />}
      {tab === 'comptable' && <ComptableTab transactions={transactions} receipts={receipts} loadAll={loadAll} />}
      {tab === 'categories' && <CategoriesTab categories={categories} loadAll={loadAll} />}
      {tab === 'rules' && <RulesTab rules={rules} categories={categories} loadAll={loadAll} />}
      {tab === 'import' && <ImportTab loadAll={loadAll} categories={categories} rules={rules} invoices={invoicesList} clients={clientsList} transactions={transactions} organization={organization} />}
      {tab === 'releves' && <RelevesTab statements={statements} transactions={transactions} loadAll={loadAll} organization={organization} />}

      {/* Modal invités repas (rétroactif) */}
      {mealGuestTxId && (
        <MealGuestModal
          transactionId={mealGuestTxId}
          transaction={transactions.find(t => t.id === mealGuestTxId)}
          clients={clientsList}
          associates={associates}
          onClose={() => setMealGuestTxId(null)}
          onSaved={() => { setMealGuestTxId(null); loadAll() }}
        />
      )}
    </div>
  )
}

function KPI({ label, value, color = 'blue', sub }) {
  return <div className={`bg-${color}-50 rounded-lg p-2 border border-${color}-100`}><div className={`text-xs text-${color}-600 font-medium`}>{label}</div><div className={`text-lg font-bold text-${color}-700 truncate`}>{value}</div>{sub && <div className="text-xs text-gray-400">{sub}</div>}</div>
}
// ════════════════════════════════════════
// TRANSACTIONS - avec  invités + badge rapprochement
// ════════════════════════════════════════
function TransactionsTab({ filtered, categories, months, filterMonth, setFilterMonth, filterCat, setFilterCat, filterDir, setFilterDir, filterSearch, setFilterSearch, showPerso, setShowPerso, editingTx, setEditingTx, changeCategory, deleteTx, receipts, onMealGuest, canSeePrivate, togglePrivate }) {
  const [filterSpecial, setFilterSpecial] = useState('')

  const displayed = useMemo(() => {
    if (filterSpecial === 'privees') return filtered.filter(tx => tx.is_private)
    if (!filterSpecial) return filtered
    if (filterSpecial === 'resto_no_guest') return filtered.filter(tx => tx.category_name === 'Restauration pro' && tx.debit > 0)
    if (filterSpecial === 'credit_no_invoice') return filtered.filter(tx => tx.credit > 0 && !tx.linked_invoice_id && !tx.is_personal)
    if (filterSpecial === 'manual_non_rapproche') return filtered.filter(tx => tx.is_manual && !tx.reconciled_at)
    if (filterSpecial === 'manual_rapproche') return filtered.filter(tx => tx.is_manual && !!tx.reconciled_at)
    return filtered
  }, [filtered, filterSpecial])

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl shadow-sm border p-3">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            <option value="all">Tous les mois</option>
            {months.map(m => <option key={m} value={m}>{ML[m]||m}</option>)}
          </select>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            <option value="all">Toutes catégories</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
          </select>
          <select value={filterDir} onChange={e => setFilterDir(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            <option value="all">Tout</option><option value="debit">Sorties</option><option value="credit">Entrées</option>
          </select>
          <input type="text" value={filterSearch} onChange={e => setFilterSearch(e.target.value)} placeholder=" Rechercher..." className="border rounded-lg px-3 py-2 text-sm" />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={showPerso} onChange={e => setShowPerso(e.target.checked)} className="rounded" /> Perso
            </label>
            <select value={filterSpecial} onChange={e => setFilterSpecial(e.target.value)} className="border rounded px-2 py-1 text-xs flex-1">
              <option value="">Filtres rapides</option>
              <option value="resto_no_guest"> Restos sans invités</option>
              <option value="credit_no_invoice"> Crédits non rapprochés</option>
              <option value="manual_non_rapproche"> Saisies sans rapprochement banque</option>
              <option value="manual_rapproche"> Saisies rapprochées banque</option>
              {canSeePrivate && <option value="privees"> Transactions privées</option>}
            </select>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 text-xs text-gray-500">Date</th>
                <th className="text-left px-3 py-2 text-xs text-gray-500">Description</th>
                <th className="text-left px-3 py-2 text-xs text-gray-500">Catégorie</th>
                <th className="text-right px-3 py-2 text-xs text-gray-500">Débit</th>
                <th className="text-right px-3 py-2 text-xs text-gray-500">Crédit</th>
                <th className="text-center px-2 py-2 text-xs text-gray-500">PJ</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {displayed.map(tx => (
                <tr key={tx.id} className={`border-t hover:bg-blue-50/30 ${tx.is_private ? 'bg-slate-100' : (tx.is_personal ? 'bg-purple-50/30' : '')} ${tx.is_manual ? 'border-l-2 border-l-blue-400' : ''}`}>
                  <td className="px-3 py-1.5 text-gray-500 text-xs whitespace-nowrap">
                    {tx.date ? new Date(tx.date).toLocaleDateString('fr-FR') : '-'}
                    {tx.is_manual && <span className="ml-1 text-blue-500"></span>}
                    {tx.is_personal && <span className="ml-1 text-purple-500"></span>}
                    {tx.sent_to_comptable && <span className="ml-1 text-green-500" title="Envoyé au comptable"></span>}
                    {tx.linked_invoice_id && <span className="ml-1 text-blue-500" title="Rapproché avec facture"></span>}
                    {tx.is_manual && tx.reconciled_at && <span className="ml-1 text-violet-500" title={`Rapproché banque le ${new Date(tx.reconciled_at).toLocaleDateString('fr-FR')}`}></span>}
                    {tx.is_private && <span className="ml-1 text-slate-600" title="Privée - invisible pour les autres comptes, mais comptée dans les totaux"></span>}
                  </td>
                  <td className="px-3 py-1.5 max-w-xs"><div className="truncate text-gray-800 text-xs" title={tx.description}>{tx.description}</div></td>
                  <td className="px-3 py-1.5">
                    {editingTx === tx.id ? (
                      <select autoFocus onChange={e => { if (e.target.value) changeCategory(tx.id, e.target.value) }} onBlur={() => setEditingTx(null)} className="border rounded px-1 py-0.5 text-xs w-full" defaultValue="">
                        <option value="">Choisir...</option>
                        {categories.map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
                      </select>
                    ) : (
                      <button onClick={() => setEditingTx(tx.id)} className={`text-xs px-2 py-0.5 rounded-full hover:ring-2 hover:ring-blue-300 ${tx.category_name === 'Autre / Non classé' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                        {categories.find(c => c.name === tx.category_name)?.icon || ''} {tx.category_name || 'Non classé'}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs text-red-600">{tx.debit > 0 ? fmt(tx.debit) : ''}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs text-green-600">{tx.credit > 0 ? fmt(tx.credit) : ''}</td>
                  <td className="px-2 py-1.5 text-center text-xs">{receipts[tx.id]?.length > 0 && <span title={`${receipts[tx.id].length} fichier(s)`}>{receipts[tx.id].length}</span>}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-0.5">
                      {tx.category_name === 'Restauration pro' && tx.debit > 0 && (
                        <button onClick={() => onMealGuest && onMealGuest(tx.id)} className="text-amber-400 hover:text-amber-600 text-xs" title="Registre invités">Invités</button>
                      )}
                      {canSeePrivate && (
                        <button
                          onClick={() => togglePrivate(tx)}
                          className={`text-xs ${tx.is_private ? 'text-slate-700' : 'text-gray-300 hover:text-slate-600'}`}
                          title={tx.is_private ? 'Rendre visible par tous' : 'Masquer pour les autres comptes'}
                        >{tx.is_private ? 'Privé' : 'Masquer'}</button>
                      )}
                      {tx.is_manual && <button onClick={() => deleteTx(tx.id)} className="text-red-300 hover:text-red-600 text-xs">Supprimer</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {displayed.length === 0 && <div className="text-center py-12 text-gray-400">Aucune transaction</div>}
        </div>
      </div>
    </div>
  )
}

// Nettoyer les noms de fichiers pour Supabase Storage (pas d'accents, pas de caractères spéciaux)
// Recalcule payé / reste dû / statut d'une facture à partir de ses paiements
// (tient compte des avoirs ; les factures annulées par avoir sont gérées par le trigger SQL)
async function recomputeInvoiceFromPayments(invoiceId) {
  const r2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100
  const [{ data: inv }, { data: pays }] = await Promise.all([
    supabase.from('invoices').select('id, type, status, total_ttc, amount_credited, due_date').eq('id', invoiceId).single(),
    supabase.from('invoice_payments').select('amount').eq('invoice_id', invoiceId),
  ])
  if (!inv || inv.type !== 'invoice') return
  const paid = r2((pays || []).reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0))
  const due = Math.max(0, r2((parseFloat(inv.total_ttc) || 0) - paid - (parseFloat(inv.amount_credited) || 0)))
  let status = inv.status
  if (!['draft', 'cancelled', 'credited'].includes(inv.status)) {
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (due <= 0.01) status = 'paid'
    else if (paid > 0.01) status = 'partial'
    else status = (inv.due_date && String(inv.due_date).slice(0, 10) < today) ? 'overdue' : 'due'
  }
  await supabase.from('invoices')
    .update({ amount_paid: paid, amount_due: due, status, updated_at: new Date().toISOString() })
    .eq('id', invoiceId)
}

function sanitizeFileName(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // supprimer les accents
    .replace(/[^a-zA-Z0-9._-]/g, '_') // remplacer tout caractère spécial par _
    .replace(/_+/g, '_') // éviter les __ multiples
}

// ════════════════════════════════════════
// SAISIE - avec registre invités repas
// ════════════════════════════════════════
function SaisieTab({ categories, rules, loadAll, clients, associates = [], organization }) {
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], description: '', amount: '', type: 'debit', category_id: '', payer: 'entreprise', notes: '', note_comptable: '' })
  const [files, setFiles] = useState([])
  const [previews, setPreviews] = useState([])
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiResult, setAiResult] = useState(null)
  const [aiResults, setAiResults] = useState([]) // multi-fichiers
  const [aiCurrentIdx, setAiCurrentIdx] = useState(0)
  const [aiProgress, setAiProgress] = useState({ current: 0, total: 0 })
  const [dragOver, setDragOver] = useState(false)
  const allFilesRef = useRef([])
  const [editingTxId, setEditingTxId] = useState(null)
  const [recent, setRecent] = useState([])

  // Repas / Invités
  const [mealFor, setMealFor] = useState(() => defaultAssociateSlug(associates))
  const [guests, setGuests] = useState([])
  const [nbConvives, setNbConvives] = useState(2)
  const [showProspectModal, setShowProspectModal] = useState(false)
  const [prospectInitial, setProspectInitial] = useState({})

  const isRestaurant = useMemo(() => {
    const cat = categories.find(c => c.id === form.category_id)
    return cat?.name === 'Restauration pro'
  }, [form.category_id, categories])

  useEffect(() => {
    supabase.from('budget_transactions').select('*').eq('is_manual', true).order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => { if (data) setRecent(data) })
  }, [])

  // Supprimer une transaction récente
  async function deleteTxLocal(txId) {
    if (!confirm('Supprimer cette transaction ?')) return
    await supabase.from('budget_receipts').delete().eq('transaction_id', txId)
    await supabase.from('budget_meal_guests').delete().eq('transaction_id', txId)
    await supabase.from('budget_transactions').delete().eq('id', txId)
    setRecent(prev => prev.filter(t => t.id !== txId))
    toast.success('Supprimée')
    loadAll()
  }

  // Modifier le payeur rapidement
  async function changePayer(txId, newPayer) {
    const isPerso = newPayer !== 'entreprise'
    const { error } = await supabase.from('budget_transactions').update({ payer: newPayer, is_personal: isPerso }).eq('id', txId)
    if (error) { toast.error('Erreur: ' + error.message); return }
    setRecent(prev => prev.map(t => t.id === txId ? { ...t, payer: newPayer, is_personal: isPerso } : t))
    toast.success('Payeur modifié')
    loadAll()
  }

  // Charger une transaction dans le formulaire pour édition
  function editTxInForm(tx) {
    setForm({
      date: tx.date,
      description: tx.description,
      amount: (tx.debit > 0 ? tx.debit : tx.credit).toString().replace('.', ','),
      type: tx.debit > 0 ? 'debit' : 'credit',
      category_id: tx.category_id || '',
      payer: tx.payer || 'entreprise',
      notes: tx.notes || '',
      note_comptable: tx.note_comptable || '',
    })
    setEditingTxId(tx.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    toast('Chargée - modifiez puis cliquez Enregistrer', { icon: '' })
  }

  // Auto-catégorisation par règles
  useEffect(() => {
    if (!form.description || form.category_id) return
    const d = form.description.toUpperCase()
    for (const r of rules) { if (d.includes(r.keyword?.toUpperCase())) { const c = categories.find(x => x.id === r.category_id); if (c) { setForm(f => ({ ...f, category_id: c.id })); break } } }
  }, [form.description])

  function handleFiles(e) {
    const newFiles = Array.from(e.target.files)
    addFiles(newFiles)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const newFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
    if (newFiles.length === 0) { toast.error('Formats acceptés : PDF, JPG, PNG'); return }
    addFiles(newFiles)
  }

  function addFiles(newFiles) {
    setFiles(prev => [...prev, ...newFiles])
    newFiles.forEach(f => {
      if (f.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = ev => setPreviews(prev => [...prev, { name: f.name, url: ev.target.result }])
        reader.readAsDataURL(f)
      } else {
        setPreviews(prev => [...prev, { name: f.name, url: null }])
      }
    })
  }

  function removeFile(idx) {
    setFiles(prev => prev.filter((_, i) => i !== idx))
    setPreviews(prev => prev.filter((_, i) => i !== idx))
  }

  // Analyse IA de la facture - MULTI-FICHIERS (batch de 5 max)
  async function analyzeWithAI() {
    if (files.length === 0) { toast.error('Ajoutez une facture d\'abord'); return }
    setAnalyzing(true)
    setAiResults([])
    setAiCurrentIdx(0)
    setAiResult(null)
    allFilesRef.current = [...files]
    const results = []
    const maxBatch = 5
    const filesToProcess = files.slice(0, maxBatch)
    const total = filesToProcess.length
    setAiProgress({ current: 0, total })
    if (files.length > maxBatch) {
      toast(`Analyse des ${maxBatch} premiers fichiers (${files.length - maxBatch} en attente)`, { icon: 'ℹ' })
    }

    for (let i = 0; i < filesToProcess.length; i++) {
      setAiProgress({ current: i + 1, total })
      // Délai entre les appels pour éviter le rate-limit (429)
      if (i > 0) await new Promise(r => setTimeout(r, 5000))
      try {
        const file = filesToProcess[i]
        const { base64, mediaType } = await prepareFileForAI(file)
        const catList = categories.map(c => `${c.icon} ${c.name} (${c.direction})`).join(', ')
        const persoTypes = associates.map(a => `"perso_${a.slug}"`)
        const typeChoices = ['"entreprise"', ...persoTypes].join(' ou ')
        const persoRule = associates.length > 0
          ? `\n- Si c'est un achat personnel d'un associé (courses alimentaires, vêtements perso, loisirs) → ${persoTypes.join(' ou ')} (associés : ${associates.map(a => `${a.name || a.firstName} = "perso_${a.slug}"`).join(', ')} ; par défaut ${persoTypes[0]})`
          : ''
        const invoicePrompt = `Analyse cette facture/ticket pour ${orgLabelForAI(organization)}, ${orgActivityForAI(organization)}.\n\nExtrais en JSON strict (pas de markdown) :\n{\n  "fournisseur": "nom du fournisseur",\n  "montant": 123.45,\n  "date": "2026-02-19",\n  "description": "description courte",\n  "categorie_suggestion": "nom de la catégorie la plus proche",\n  "type_depense": ${typeChoices},\n  "explication": "pourquoi cette classification",\n  "note_comptable": "explication courte pour la comptable"\n}\n\nCatégories disponibles : ${catList}\n\nRègles :\n- Si c'est un achat clairement professionnel (matériel, logiciel, assurance, carburant, restaurant business) → "entreprise"${persoRule}\n- En cas de doute → "entreprise"`

        // Retry jusqu'à 3 fois en cas de 429
        let data = null
        for (let attempt = 0; attempt < 3; attempt++) {
          const response = await apiFetch('/api/ai-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-sonnet-4-6',
              max_tokens: 500,
              messages: [{ role: 'user', content: [
                { type: mediaType.startsWith('image/') ? 'image' : 'document', source: { type: 'base64', media_type: mediaType, data: base64 } },
                { type: 'text', text: invoicePrompt }
              ]}]
            })
          })
          if (response.status === 429) {
            const wait = (attempt + 1) * 5000
            console.warn(`429 sur fichier ${i}, retry dans ${wait/1000}s...`)
            await new Promise(r => setTimeout(r, wait))
            continue
          }
          data = await response.json()
          break
        }
        if (!data) throw new Error('Rate limit persistant')
        const text = data.content?.[0]?.text || ''
        const json = JSON.parse(text.replace(/```json|```/g, '').trim())
        results.push({ ...json, _fileIndex: i, _fileName: file.name, _file: file })
      } catch (e) {
        console.error(`Erreur analyse fichier ${i}:`, e)
        results.push({ _fileIndex: i, _fileName: filesToProcess[i].name, _file: filesToProcess[i], _error: true, fournisseur: filesToProcess[i].name, montant: 0, description: filesToProcess[i].name, explication: 'Erreur d\'analyse' })
      }
    }

    setAiResults(results)
    setAiCurrentIdx(0)
    if (results.length >= 1) {
      applyResult(results[0])
    }
    setAnalyzing(false)
    const ok = results.filter(r => !r._error).length
    const msg = ok === total ? ` ${ok} fichier(s) analysé(s)` : ` ${ok}/${total} analysé(s), ${total - ok} en erreur`
    toast.success(msg)
    if (files.length > maxBatch) {
      toast(`Relancez l'analyse pour les ${files.length - maxBatch} fichiers restants`, { icon: '', duration: 5000 })
    }
  }

  // Appliquer un résultat IA au formulaire
  function applyResult(json) {
    if (!json || json._error) return
    setAiResult(json)
    if (json.fournisseur) setForm(f => ({ ...f, description: json.description || json.fournisseur }))
    if (json.montant) setForm(f => ({ ...f, amount: json.montant.toString().replace('.', ',') }))
    if (json.date) setForm(f => ({ ...f, date: json.date }))
    if (json.note_comptable) setForm(f => ({ ...f, note_comptable: json.note_comptable }))
    const persoMatch = typeof json.type_depense === 'string' && json.type_depense.startsWith(PERSO_PREFIX)
      ? associates.find(a => `${PERSO_PREFIX}${a.slug}` === json.type_depense)
      : null
    if (persoMatch) setForm(f => ({ ...f, payer: persoMatch.payer }))
    else setForm(f => ({ ...f, payer: PAYER_COMPANY }))
    if (json.categorie_suggestion) {
      const match = categories.find(c => c.name.toLowerCase().includes(json.categorie_suggestion.toLowerCase()) || json.categorie_suggestion.toLowerCase().includes(c.name.toLowerCase()))
      if (match) setForm(f => ({ ...f, category_id: match.id }))
    }
  }

  // Naviguer dans les résultats multi-fichiers
  function goToResult(idx) {
    if (idx < 0 || idx >= aiResults.length) return
    setAiCurrentIdx(idx)
    applyResult(aiResults[idx])
    // Mettre le fichier correspondant en premier pour la sauvegarde
    const targetFile = aiResults[idx]._file
    if (targetFile) {
      setFiles([targetFile])
      if (targetFile.type?.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = ev => setPreviews([{ name: targetFile.name, url: ev.target.result }])
        reader.readAsDataURL(targetFile)
      } else {
        setPreviews([{ name: targetFile.name, url: null }])
      }
    }
  }

  // Sauvegarder le résultat courant et passer au suivant (sans reset du flow multi)
  async function validateAndNext() {
    if (!form.description || !form.amount || !form.date) { toast.error('Date, description et montant requis'); return }
    setSaving(true)
    try {
      const amount = parseFloat(form.amount.replace(',', '.'))
      if (isNaN(amount) || amount <= 0) { toast.error('Montant invalide'); setSaving(false); return }
      const cat = categories.find(c => c.id === form.category_id)
      const dp = form.date.split('-')
      const isPerso = form.payer !== 'entreprise'

      const row = {
        date: form.date, description: form.description,
        debit: form.type === 'debit' ? amount : 0, credit: form.type === 'credit' ? amount : 0,
        category_id: form.category_id || null, category_name: cat?.name || 'Autre / Non classé',
        month: `${dp[1]}/${dp[0]}`, year: parseInt(dp[0]),
        source_file: 'saisie_manuelle', is_manual: true, is_personal: isPerso, payer: form.payer,
        notes: form.notes || null, note_comptable: form.note_comptable || null,
      }

      const { data: txData, error } = await supabase.from('budget_transactions').insert(row).select().single()
      if (error) { toast.error('Erreur: ' + error.message); setSaving(false); return }

      // Upload du fichier associé
      if (files.length > 0 && txData) {
        let uploaded = 0
        for (const file of files) {
          const safeName = sanitizeFileName(file.name)
          const path = `${txData.id}/${Date.now()}_${safeName}`
          const { error: upErr } = await supabase.storage.from('budget-receipts').upload(path, file)
          if (upErr) { console.error('Upload error:', upErr); toast.error(`Erreur upload ${file.name}`); continue }
          const { error: dbErr } = await supabase.from('budget_receipts').insert({
            transaction_id: txData.id, file_name: file.name, file_path: path, file_type: file.type, file_size: file.size
          })
          if (dbErr) { console.error('DB insert error:', dbErr); continue }
          uploaded++
        }
        if (uploaded > 0) toast.success(`${uploaded} PJ uploadée(s)`)
      }

      toast.success(`Sauvegardé : ${form.description}`)
      setRecent(prev => [txData, ...prev].slice(0, 10))

      // Passer au fichier suivant
      const nextIdx = aiCurrentIdx + 1
      if (nextIdx < aiResults.length) {
        goToResult(nextIdx)
        toast.success(`Suivant : ${nextIdx + 1}/${aiResults.length}`)
      } else {
        // Batch terminé - vérifier s'il reste des fichiers
        const allOriginal = allFilesRef.current
        const processedCount = Math.min(allOriginal.length, 5)
        const remaining = allOriginal.slice(processedCount)
        setForm({ date: new Date().toISOString().split('T')[0], description: '', amount: '', type: 'debit', category_id: '', payer: 'entreprise', notes: '', note_comptable: '' })
        setAiResult(null); setAiResults([]); setAiCurrentIdx(0)
        if (remaining.length > 0) {
          setFiles(remaining)
          setPreviews(remaining.map(f => ({ name: f.name, url: null })))
          toast.success(`Batch terminé - ${remaining.length} fichier(s) restant(s), relancez l'analyse`)
        } else {
          setFiles([]); setPreviews([])
          toast.success('Tous les fichiers ont été traités !')
        }
        loadAll()
      }
    } catch (e) {
      console.error(e)
      toast.error('Erreur sauvegarde')
    }
    setSaving(false)
  }

  // Passer sans sauvegarder
  function skipResult() {
    const nextIdx = aiCurrentIdx + 1
    if (nextIdx < aiResults.length) {
      goToResult(nextIdx)
    } else {
      // S'il reste des fichiers non analysés (batch > 5), les garder
      const allOriginal = allFilesRef.current
      const processedCount = Math.min(allOriginal.length, 5)
      const remaining = allOriginal.slice(processedCount)
      setAiResults([])
      setAiCurrentIdx(0)
      setAiResult(null)
      if (remaining.length > 0) {
        setFiles(remaining)
        setPreviews(remaining.map(f => ({ name: f.name, url: null })))
        toast.success(`Batch terminé - ${remaining.length} fichier(s) restant(s), relancez l'analyse`)
      } else {
        setFiles([]); setPreviews([])
        toast.success('Terminé')
      }
    }
  }

  // Gestion invités
  function addGuest() { setGuests(prev => [...prev, { name: '', company: '', client_id: '' }]) }
  function updateGuest(idx, field, value) { setGuests(prev => prev.map((g, i) => i === idx ? { ...g, [field]: value } : g)) }
  function removeGuest(idx) { setGuests(prev => prev.filter((_, i) => i !== idx)) }

  async function handleSave() {
    if (!form.description || !form.amount || !form.date) { toast.error('Date, description et montant requis'); return }
    setSaving(true)
    const amount = parseFloat(form.amount.replace(',', '.'))
    if (isNaN(amount) || amount <= 0) { toast.error('Montant invalide'); setSaving(false); return }
    const cat = categories.find(c => c.id === form.category_id)
    const dp = form.date.split('-')
    const isPerso = form.payer !== 'entreprise'

    const row = {
      date: form.date, description: form.description,
      debit: form.type === 'debit' ? amount : 0, credit: form.type === 'credit' ? amount : 0,
      category_id: form.category_id || null, category_name: cat?.name || 'Autre / Non classé',
      month: `${dp[1]}/${dp[0]}`, year: parseInt(dp[0]),
      source_file: 'saisie_manuelle', is_manual: true, is_personal: isPerso, payer: form.payer,
      notes: form.notes || null, note_comptable: form.note_comptable || null,
    }

    let txData
    const isEditing = !!editingTxId
    if (isEditing) {
      // Mode édition - update
      const { data, error } = await supabase.from('budget_transactions').update(row).eq('id', editingTxId).select().single()
      if (error) { toast.error('Erreur: ' + error.message); setSaving(false); return }
      txData = data
      setRecent(prev => prev.map(t => t.id === editingTxId ? txData : t))
      toast.success(`Transaction modifiée`)
      setEditingTxId(null)
    } else {
      // Mode création - insert
      const { data, error } = await supabase.from('budget_transactions').insert(row).select().single()
      if (error) { toast.error('Erreur: ' + error.message); setSaving(false); return }
      txData = data
      setRecent(prev => [txData, ...prev].slice(0, 10))
      toast.success(`${form.type === 'debit' ? 'Dépense' : 'Entrée'}: ${fmt(amount)}`)
    }

    // Upload des fichiers (création ET édition)
    if (files.length > 0 && txData) {
      let uploaded = 0
      let errors = 0
      for (const file of files) {
        const safeName = sanitizeFileName(file.name)
        const path = `${txData.id}/${Date.now()}_${safeName}`
        const { error: upErr } = await supabase.storage.from('budget-receipts').upload(path, file)
        if (upErr) { console.error('Upload error:', upErr); errors++; continue }
        const { error: dbErr } = await supabase.from('budget_receipts').insert({
          transaction_id: txData.id, file_name: file.name, file_path: path, file_type: file.type, file_size: file.size
        })
        if (dbErr) { console.error('DB insert error:', dbErr); errors++; continue }
        uploaded++
      }
      if (uploaded > 0) toast.success(`${uploaded} fichier(s) uploadé(s)`)
      if (errors > 0) toast.error(`${errors} fichier(s) en erreur d'upload`)
    }

    // Sauvegarder les invités si c'est un repas
    if (isRestaurant && txData) {
      const guestRows = guests.filter(g => g.name.trim()).map(g => ({
        transaction_id: txData.id,
        ...(mealFor ? { meal_for: mealFor } : {}),
        guest_name: g.name.trim(),
        guest_company: g.company.trim() || null,
        guest_first_name: null,
        client_id: g.client_id || null,
        nb_convives: nbConvives,
        motif: form.notes || null,
      }))
      // Si pas d'invités nommés, juste sauvegarder le meal_for
      if (guestRows.length === 0) {
        await supabase.from('budget_meal_guests').insert({
          transaction_id: txData.id, ...(mealFor ? { meal_for: mealFor } : {}), nb_convives: nbConvives, motif: form.notes || null,
        })
      } else {
        await supabase.from('budget_meal_guests').insert(guestRows)
      }
    }

    setForm({ date: new Date().toISOString().split('T')[0], description: '', amount: '', type: 'debit', category_id: '', payer: 'entreprise', notes: '', note_comptable: '' })
    setFiles([]); setPreviews([]); setAiResult(null); setAiResults([]); setAiCurrentIdx(0); setEditingTxId(null)
    setGuests([]); setNbConvives(2); setMealFor(defaultAssociateSlug(associates))
    setSaving(false)
    loadAll()
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-xl shadow-sm border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-700">{editingTxId ? ' Modifier l\'opération' : ' Nouvelle opération'}</h3>
          {editingTxId && (
            <button onClick={() => {
              setEditingTxId(null)
              setForm({ date: new Date().toISOString().split('T')[0], description: '', amount: '', type: 'debit', category_id: '', payer: 'entreprise', notes: '', note_comptable: '' })
            }} className="text-xs text-gray-500 hover:text-red-500"> Annuler</button>
          )}
        </div>

        {/* Upload zone */}
        <div>
          <label className="text-xs text-gray-500 font-medium"> Facture(s) / Justificatif(s)</label>
          <div className={`mt-1 border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400'}`}
            onClick={() => document.getElementById('file-input').click()}
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}>
            <input id="file-input" type="file" multiple accept="image/*,.pdf" onChange={handleFiles} className="hidden" />
            <p className="text-sm text-gray-500">{dragOver ? ' Lâchez pour ajouter' : ' Cliquez ou glissez vos fichiers ici'}</p>
            <p className="text-xs text-gray-400 mt-1">PDF, JPG, PNG - plusieurs fichiers possibles</p>
          </div>
          {previews.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {previews.map((p, i) => (
                <div key={i} className="relative group">
                  {p.url ? <img src={p.url} alt={p.name} className="w-16 h-16 object-cover rounded border" /> : <div className="w-16 h-16 bg-gray-100 rounded border flex items-center justify-center text-xs"> PDF</div>}
                  <button onClick={() => removeFile(i)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 text-xs leading-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100">×</button>
                </div>
              ))}
            </div>
          )}
          {files.length > 0 && !analyzing && aiResults.length === 0 && (
            <button onClick={analyzeWithAI} disabled={analyzing}
              className="mt-2 w-full bg-purple-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
              {files.length > 1 ? ` Analyser ${Math.min(files.length, 5)} fichier${Math.min(files.length, 5) > 1 ? 's' : ''} avec IA${files.length > 5 ? ` (sur ${files.length})` : ''}` : ' Analyser avec IA'}
            </button>
          )}
          {analyzing && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2 text-sm text-purple-700 font-medium">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-purple-600 border-t-transparent"></div>
                Analyse {aiProgress.current}/{aiProgress.total}...
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-purple-600 h-2 rounded-full transition-all duration-300" style={{ width: `${(aiProgress.current / aiProgress.total) * 100}%` }}></div>
              </div>
            </div>
          )}
        </div>

        {/* Résultat IA - mode multi-fichiers */}
        {aiResults.length > 1 && !analyzing && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-purple-800"> Fichier {aiCurrentIdx + 1}/{aiResults.length}</span>
              <span className="text-purple-600 text-[10px]">{aiResults[aiCurrentIdx]?._fileName}</span>
            </div>
            {aiResults[aiCurrentIdx]?._error ? (
              <div className="text-red-600"> Erreur d'analyse pour ce fichier</div>
            ) : (
              <>
                <div>Fournisseur : <b>{aiResults[aiCurrentIdx]?.fournisseur}</b></div>
                <div>Montant : <b>{aiResults[aiCurrentIdx]?.montant} €</b></div>
                <div>Catégorie : <b>{aiResults[aiCurrentIdx]?.categorie_suggestion}</b></div>
                <div className="text-gray-600 italic">{aiResults[aiCurrentIdx]?.explication}</div>
              </>
            )}
            {/* Sélecteur Payé par - bien visible dans le carousel */}
            <div>
              <label className="text-[10px] text-gray-500 font-medium">Payé par :</label>
              <div className="flex gap-1 mt-1">
                {payerOptions(associates).map(p => (
                  <button key={p.v} onClick={() => setForm(f => ({ ...f, payer: p.v }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${samePayer(form.payer, p.v, associates) ? (p.v === 'entreprise' ? 'bg-blue-500 text-white border-blue-600 ring-2 ring-blue-300' : 'bg-purple-500 text-white border-purple-600 ring-2 ring-purple-300') : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{p.l}</button>
                ))}
              </div>
              {form.payer !== 'entreprise' && <p className="text-[10px] text-purple-600 mt-0.5"> Sera comptabilisé en dette gérant</p>}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={validateAndNext} disabled={saving || !form.description || !form.amount}
                className="flex-1 bg-green-600 text-white py-2 rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50">
                {saving ? '...' : ` Valider & ${aiCurrentIdx + 1 < aiResults.length ? 'Suivant' : 'Terminer'}`}
              </button>
              <button onClick={skipResult}
                className="px-4 bg-gray-200 text-gray-700 py-2 rounded-lg text-xs font-medium hover:bg-gray-300">
                Passer ▶
              </button>
            </div>
          </div>
        )}

        {/* Résultat IA - mode fichier unique */}
        {aiResult && aiResults.length <= 1 && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs space-y-1">
            <div className="font-bold text-purple-800"> Résultat IA :</div>
            <div>Fournisseur : <b>{aiResult.fournisseur}</b></div>
            <div>Montant : <b>{aiResult.montant} €</b></div>
            <div>Catégorie : <b>{aiResult.categorie_suggestion}</b></div>
            <div>Type : <b className={aiResult.type_depense === 'entreprise' ? 'text-blue-600' : 'text-purple-600'}>{aiResult.type_depense}</b></div>
            <div className="text-gray-600 italic">{aiResult.explication}</div>
          </div>
        )}

        {/* Direction */}
        <div className="flex gap-2">
          <button onClick={() => setForm(f => ({ ...f, type: 'debit' }))} className={`flex-1 py-2 rounded-lg text-sm font-medium ${form.type === 'debit' ? 'bg-red-500 text-white' : 'bg-gray-100'}`}> Dépense</button>
          <button onClick={() => setForm(f => ({ ...f, type: 'credit' }))} className={`flex-1 py-2 rounded-lg text-sm font-medium ${form.type === 'credit' ? 'bg-green-500 text-white' : 'bg-gray-100'}`}> Entrée</button>
        </div>
        <div><label className="text-xs text-gray-500">Date</label><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
        <div><label className="text-xs text-gray-500">Description</label><input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Fournisseur / description" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
        <div><label className="text-xs text-gray-500">Montant (€)</label><input type="text" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0,00" className="w-full border rounded-lg px-3 py-2 text-sm mt-1 font-mono text-lg" /></div>
        <div><label className="text-xs text-gray-500">Catégorie</label>
          <select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
            <option value="">Auto / Non classé</option>
            {categories.filter(c => form.type === 'debit' ? c.direction !== 'recette' : c.direction !== 'depense').map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500">Payé par</label>
          <div className="flex gap-2 mt-1">
            {payerOptions(associates).map(p => (
              <button key={p.v} onClick={() => setForm(f => ({ ...f, payer: p.v }))}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border ${samePayer(form.payer, p.v, associates) ? (p.v === 'entreprise' ? 'bg-blue-500 text-white border-blue-600' : 'bg-purple-500 text-white border-purple-600') : 'bg-white text-gray-600'}`}>{p.l}</button>
            ))}
          </div>
          {form.payer !== 'entreprise' && <p className="text-xs text-purple-600 mt-1"> Hors budget entreprise → dette gérant</p>}
        </div>

        {/* ══ SECTION REPAS / INVITÉS ══ */}
        {isRestaurant && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-amber-800"> Registre repas professionnel</span>
            </div>

            {/* Repas pour qui */}
            {associates.length > 0 && (
              <div>
                <label className="text-xs text-gray-600">Repas pour</label>
                <div className="flex gap-2 mt-1">
                  {associates.map(a => (
                    <button key={a.slug} onClick={() => setMealFor(a.slug)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium border ${mealFor === a.slug ? 'bg-blue-500 text-white' : 'bg-white text-gray-600'}`}>{a.firstName}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Nombre de convives */}
            <div>
              <label className="text-xs text-gray-600">Nombre de convives</label>
              <input type="number" min="1" max="20" value={nbConvives} onChange={e => setNbConvives(parseInt(e.target.value) || 1)} className="w-full border rounded-lg px-3 py-1.5 text-sm mt-1" />
            </div>

            {/* Invités */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-600">Invités ({guests.length})</label>
                <button onClick={addGuest} className="text-xs text-blue-600 hover:text-blue-800">+ Ajouter un invité</button>
              </div>
              {guests.map((g, idx) => (
                <div key={idx} className="flex gap-1.5 mt-1.5 items-center">
                  <input
                    type="text" value={g.name} onChange={e => updateGuest(idx, 'name', e.target.value)}
                    placeholder="Nom Prénom" className="flex-1 border rounded px-2 py-1.5 text-xs"
                  />
                  <div className="relative flex-1">
                    <input
                      type="text" value={g.company} onChange={e => { updateGuest(idx, 'company', e.target.value); updateGuest(idx, 'client_id', '') }}
                      placeholder="Entreprise" className="w-full border rounded px-2 py-1.5 text-xs"
                      list={`guest-clients-${idx}`}
                    />
                    <datalist id={`guest-clients-${idx}`}>
                      {clients.filter(c => g.company && c.name.toUpperCase().includes(g.company.toUpperCase())).slice(0, 10).map(c => (
                        <option key={c.id} value={c.name} />
                      ))}
                    </datalist>
                  </div>
                  {g.company && !clients.find(c => c.name.toUpperCase() === g.company.toUpperCase()) && (
                    <button
                      onClick={() => { setProspectInitial({ name: g.company, contact_name: g.name }); setShowProspectModal(true) }}
                      className="text-xs text-emerald-600 hover:text-emerald-800 whitespace-nowrap" title="Créer comme prospect"
                    >+</button>
                  )}
                  <button onClick={() => removeGuest(idx)} className="text-red-400 hover:text-red-600 text-xs">Retirer</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div><label className="text-xs text-gray-500">Note comptable</label><input type="text" value={form.note_comptable} onChange={e => setForm(f => ({ ...f, note_comptable: e.target.value }))} placeholder="Explication pour le comptable..." className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
        <div><label className="text-xs text-gray-500">Notes internes</label><input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="N° facture, détail..." className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>

        <button onClick={handleSave} disabled={saving} className={`w-full py-3 rounded-lg font-medium disabled:opacity-50 ${editingTxId ? 'bg-amber-600 text-white hover:bg-amber-700' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
          {saving ? '...' : editingTxId ? ' Modifier' : ' Enregistrer'}
        </button>
      </div>

      {/* Colonne droite */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <h3 className="font-bold text-gray-700 mb-3"> Dernières saisies</h3>
        {recent.length === 0 ? <div className="text-center py-8 text-gray-400">Aucune saisie</div> : (
          <div className="space-y-2">{recent.map(tx => (
            <div key={tx.id} className={`p-2 rounded-lg border ${tx.is_personal ? 'bg-purple-50 border-purple-200' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{tx.description}</div>
                  <div className="text-xs text-gray-500">
                    {new Date(tx.date).toLocaleDateString('fr-FR')} • {tx.category_name}
                    {tx.is_personal && <span className="ml-1 text-purple-600">• {payerLabel(tx.payer, associates)}</span>}
                    {!tx.is_personal && <span className="ml-1 text-blue-600">• Ent.</span>}
                  </div>
                </div>
                <div className={`font-mono text-sm font-bold whitespace-nowrap ${tx.debit > 0 ? 'text-red-600' : 'text-green-600'}`}>{tx.debit > 0 ? '-' : '+'}{fmt(tx.debit > 0 ? tx.debit : tx.credit)}</div>
              </div>
              {/* Actions rapides */}
              <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-gray-200">
                <div className="flex gap-0.5 flex-1">
                  {payerOptions(associates).map(p => ({ ...p, l: p.v === PAYER_COMPANY ? 'Ent.' : p.l, icon: '' })).map(p => (
                    <button key={p.v} onClick={() => changePayer(tx.id, p.v)}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${samePayer(tx.payer, p.v, associates) ? (p.v === 'entreprise' ? 'bg-blue-500 text-white' : 'bg-purple-500 text-white') : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                      {p.icon} {p.l}
                    </button>
                  ))}
                </div>
                <button onClick={() => editTxInForm(tx)} className="text-blue-500 hover:text-blue-700 text-xs px-1" title="Modifier">Modifier</button>
                <button onClick={() => deleteTxLocal(tx.id)} className="text-red-400 hover:text-red-600 text-xs px-1" title="Supprimer">Supprimer</button>
              </div>
            </div>
          ))}</div>
        )}
      </div>

      {/* Modal création prospect */}
      {showProspectModal && (
        <ProspectCreateModal
          initial={prospectInitial}
          onClose={() => setShowProspectModal(false)}
          onCreated={(newClient) => {
            setShowProspectModal(false)
            // Mettre à jour le guest avec le nouveau client
            const gIdx = guests.findIndex(g => g.company === prospectInitial.name || !g.company)
            if (gIdx >= 0) {
              updateGuest(gIdx, 'company', newClient.name)
              updateGuest(gIdx, 'client_id', newClient.id)
            }
            loadAll()
            toast.success(`Prospect "${newClient.name}" créé`)
          }}
        />
      )}
    </div>
  )
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Prépare un fichier pour l'analyse IA.
// Les requêtes passent désormais par notre serveur (/api/ai-proxy), limité à ~4,5 Mo.
// On ne touche pas aux fichiers normaux : seuls les PHOTOS volumineuses (> 3,5 Mo)
// sont redimensionnées/compressées - Anthropic redimensionne de toute façon les
// images au-delà de ~1568px, donc aucune perte de qualité utile pour la lecture.
function prepareFileForAI(file) {
  const type = file.type || 'image/jpeg'
  if (!type.startsWith('image/') || file.size <= 3.5 * 1024 * 1024) {
    return fileToBase64(file).then(base64 => ({ base64, mediaType: type }))
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const maxEdge = 1568
        let width = img.width
        let height = img.height
        if (width > maxEdge || height > maxEdge) {
          const ratio = Math.min(maxEdge / width, maxEdge / height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        URL.revokeObjectURL(url)
        resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' })
      } catch (e) {
        URL.revokeObjectURL(url)
        fileToBase64(file).then(base64 => resolve({ base64, mediaType: type }))
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      fileToBase64(file).then(base64 => resolve({ base64, mediaType: type }))
    }
    img.src = url
  })
}

// ════════════════════════════════════════
// RELEVÉS BANCAIRES - dépôt PDF + contrôle de cohérence
// ════════════════════════════════════════
function RelevesTab({ statements, transactions, loadAll, organization }) {
  const [uploading, setUploading] = useState(false)
  const [draft, setDraft] = useState(null)        // résultat d'extraction en attente de validation
  const [draftFile, setDraftFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [manual, setManual] = useState(false)     // saisie manuelle si extraction en échec
  const [sendingId, setSendingId] = useState(null)
  const fileRef = useRef(null)

  // Solde calculé à la date de fin d'un relevé = cumul des lignes bancaires
  // jusqu'à cette date incluse. Valide car le compte est importé depuis
  // son ouverture (solde initial 0).
  function campusBalanceAt(dateStr) {
    if (!dateStr) return null
    const cutoff = String(dateStr).slice(0, 10)
    const total = transactions
      .filter(tx => !tx.is_manual && tx.date && String(tx.date).slice(0, 10) <= cutoff)
      .reduce((s, tx) => s + (tx.credit || 0) - (tx.debit || 0), 0)
    return Math.round(total * 100) / 100
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') { toast.error('PDF uniquement'); return }
    if (file.size > 10 * 1024 * 1024) { toast.error('Fichier trop lourd (max 10 Mo)'); return }

    setUploading(true)
    setDraft(null)
    setManual(false)
    try {
      const base64 = await fileToBase64(file)
      const res = await apiFetch('/api/parse-bank-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, fileName: file.name })
      })
      const data = await res.json()

      if (!res.ok || !data.statement) {
        toast.error(data.error || 'Lecture impossible')
        setDraftFile(file)
        setManual(true)
        setDraft({
          statement_number: '', statement_year: new Date().getFullYear(),
          period_start: '', period_end: '', account_label: defaultAccountLabel(organization),
          opening_balance: '', closing_balance: '', total_debits: '', total_credits: '',
        })
        return
      }

      setDraftFile(file)
      setDraft({ ...data.statement, _arithmetic_ok: data.arithmetic_ok, _delta: data.arithmetic_delta, _detail: data.arithmetic_detail })
      if (data.warning) toast(data.warning, { icon: '', duration: 6000 })
      if (data.arithmetic_ok) toast.success('Relevé lu et vérifié')
      else toast.error(`Contrôle arithmétique en échec (${data.arithmetic_delta} €) - vérifiez les valeurs`)
    } catch (err) {
      toast.error('Erreur : ' + err.message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function saveDraft() {
    if (!draft || !draftFile) return
    const opening = parseFloat(draft.opening_balance)
    const closing = parseFloat(draft.closing_balance)
    const debits = parseFloat(draft.total_debits) || 0
    const credits = parseFloat(draft.total_credits) || 0
    if (!draft.period_end) { toast.error('Date d\u2019arrêté obligatoire'); return }
    if (!Number.isFinite(opening) || !Number.isFinite(closing)) { toast.error('Soldes obligatoires'); return }

    const expected = Math.round((opening - debits + credits) * 100) / 100
    const delta = Math.round((expected - closing) * 100) / 100
    const ok = Math.abs(delta) < 0.01
    if (!ok && !confirm(`Le contrôle arithmétique ne tombe pas juste (écart de ${delta.toFixed(2)} €).\n\nEnregistrer quand même ?`)) return

    setSaving(true)
    try {
      const safeName = sanitizeFileName(draftFile.name)
      const path = `${draft.period_end}_${safeName}`
      const { error: upErr } = await supabase.storage
        .from('bank-statements')
        .upload(path, draftFile, { contentType: 'application/pdf', upsert: false })
      if (upErr) throw new Error('Envoi du PDF : ' + upErr.message)

      const campus = campusBalanceAt(draft.period_end)
      const { data: { user } } = await supabase.auth.getUser()

      const { error: insErr } = await supabase.from('bank_statements').insert({
        statement_number: draft.statement_number ? parseInt(draft.statement_number, 10) : null,
        statement_year: draft.statement_year ? parseInt(draft.statement_year, 10) : null,
        period_start: draft.period_start || null,
        period_end: draft.period_end,
        account_label: draft.account_label || defaultAccountLabel(organization) || null,
        opening_balance: opening,
        closing_balance: closing,
        total_debits: debits,
        total_credits: credits,
        arithmetic_ok: ok,
        arithmetic_delta: delta,
        campus_balance: campus,
        campus_delta: campus === null ? null : Math.round((campus - closing) * 100) / 100,
        file_name: draftFile.name,
        file_path: path,
        file_size: draftFile.size,
        parse_source: manual ? 'manual' : 'auto',
        uploaded_by: user?.email || null,
      })
      if (insErr) {
        await supabase.storage.from('bank-statements').remove([path])
        if (insErr.message?.includes('duplicate') || insErr.code === '23505') {
          throw new Error('Ce relevé a déjà été importé.')
        }
        throw new Error(insErr.message)
      }

      toast.success('Relevé enregistré')
      setDraft(null); setDraftFile(null); setManual(false)
      loadAll()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function openPdf(st) {
    const { data, error } = await supabase.storage.from('bank-statements').createSignedUrl(st.file_path, 120)
    if (error) { toast.error('PDF introuvable'); return }
    window.open(data.signedUrl, '_blank')
  }

  async function sendToComptable(st) {
    if (st.sent_to_comptable && !confirm('Ce relevé a déjà été envoyé. Le renvoyer ?')) return
    setSendingId(st.id)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Session expirée')
      const res = await apiFetch('/api/send-statement-comptable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, statementId: st.id })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Envoi impossible')
      toast.success(data.message || 'Relevé envoyé')
      loadAll()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSendingId(null)
    }
  }

  async function deleteStatement(st) {
    if (!confirm(`Supprimer le relevé du ${fmtDateFR(st.period_end)} ?`)) return
    await supabase.storage.from('bank-statements').remove([st.file_path])
    await supabase.from('bank_statements').delete().eq('id', st.id)
    toast.success('Relevé supprimé')
    loadAll()
  }

  const setD = (k, v) => setDraft(d => ({ ...d, [k]: v }))

  return (
    <div className="space-y-4">
      {/* ── Dépôt ── */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <h3 className="font-bold text-gray-700 mb-1"> Relevés bancaires</h3>
        <p className="text-xs text-gray-500 mb-3">
          Déposez le PDF du relevé {bankName(organization)} à chaque début de mois. Les soldes sont lus automatiquement
          puis comparés au solde calculé par l'application : tout écart signale une ligne manquante ou un doublon.
        </p>
        <input ref={fileRef} type="file" accept="application/pdf" onChange={handleFile} disabled={uploading || saving}
          className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
        {uploading && <div className="mt-2 text-sm text-gray-500"> Lecture du relevé...</div>}
      </div>

      {/* ── Validation avant enregistrement ── */}
      {draft && (
        <div className={`bg-white rounded-xl shadow-sm border-2 p-4 ${draft._arithmetic_ok === false || manual ? 'border-amber-300' : 'border-green-300'}`}>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-bold text-gray-700">
              {manual ? ' Saisie manuelle' : (draft._arithmetic_ok ? ' Relevé vérifié' : ' Contrôle en échec')}
            </h4>
            <button onClick={() => { setDraft(null); setDraftFile(null); setManual(false) }} className="text-xs text-gray-400 hover:text-gray-600">Annuler</button>
          </div>

          {draft._detail && (
            <div className="mb-3 text-xs bg-gray-50 border rounded-lg p-3 font-mono space-y-0.5">
              <div>Ancien solde : {fmt(draft._detail.opening)}</div>
              <div>− débits : {fmt(draft._detail.debits)}</div>
              <div>+ crédits : {fmt(draft._detail.credits)}</div>
              <div className="border-t pt-0.5 mt-0.5">= attendu : {fmt(draft._detail.expected_closing)}</div>
              <div>déclaré : {fmt(draft._detail.declared_closing)}</div>
              <div className={draft._arithmetic_ok ? 'text-green-600' : 'text-red-600'}>
                écart : {fmt(draft._delta)} {draft._arithmetic_ok ? '' : ''}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><label className="text-xs text-gray-500">N° relevé</label>
              <input type="number" value={draft.statement_number ?? ''} onChange={e => setD('statement_number', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
            <div><label className="text-xs text-gray-500">Année</label>
              <input type="number" value={draft.statement_year ?? ''} onChange={e => setD('statement_year', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
            <div><label className="text-xs text-gray-500">Début de période</label>
              <input type="date" value={draft.period_start || ''} onChange={e => setD('period_start', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
            <div><label className="text-xs text-gray-500">Arrêté au *</label>
              <input type="date" value={draft.period_end || ''} onChange={e => setD('period_end', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
            <div><label className="text-xs text-gray-500">Ancien solde *</label>
              <input type="number" step="0.01" value={draft.opening_balance ?? ''} onChange={e => setD('opening_balance', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
            <div><label className="text-xs text-gray-500">Nouveau solde *</label>
              <input type="number" step="0.01" value={draft.closing_balance ?? ''} onChange={e => setD('closing_balance', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
            <div><label className="text-xs text-gray-500">Total débits</label>
              <input type="number" step="0.01" value={draft.total_debits ?? ''} onChange={e => setD('total_debits', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
            <div><label className="text-xs text-gray-500">Total crédits</label>
              <input type="number" step="0.01" value={draft.total_credits ?? ''} onChange={e => setD('total_credits', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
          </div>

          <p className="text-xs text-gray-400 mt-2">
            Rappel : un solde débiteur (à découvert) doit être saisi en négatif.
          </p>

          {draft.period_end && (
            <div className="mt-3 text-xs bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              Solde calculé au {fmtDateFR(draft.period_end)} : <strong>{fmt(campusBalanceAt(draft.period_end))}</strong>
              {Number.isFinite(parseFloat(draft.closing_balance)) && (
                <> - écart avec le relevé : <strong>{fmt(Math.round((campusBalanceAt(draft.period_end) - parseFloat(draft.closing_balance)) * 100) / 100)}</strong></>
              )}
            </div>
          )}

          <button onClick={saveDraft} disabled={saving}
            className="mt-3 w-full bg-green-600 text-white py-2.5 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50">
            {saving ? ' Enregistrement...' : ' Enregistrer le relevé'}
          </button>
        </div>
      )}

      {/* ── Historique ── */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h4 className="font-bold text-gray-700 text-sm">Historique ({statements.length})</h4>
        </div>
        {statements.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">Aucun relevé déposé</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 text-xs text-gray-500">Arrêté au</th>
                  <th className="text-left px-3 py-2 text-xs text-gray-500">N°</th>
                  <th className="text-right px-3 py-2 text-xs text-gray-500">Ancien solde</th>
                  <th className="text-right px-3 py-2 text-xs text-gray-500">Nouveau solde</th>
                  <th className="text-right px-3 py-2 text-xs text-gray-500">Solde calculé</th>
                  <th className="text-center px-3 py-2 text-xs text-gray-500">Écart</th>
                  <th className="text-center px-3 py-2 text-xs text-gray-500">Comptable</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {statements.map(st => {
                  const campusNow = campusBalanceAt(st.period_end)
                  const delta = campusNow === null ? null : Math.round((campusNow - st.closing_balance) * 100) / 100
                  const aligned = delta !== null && Math.abs(delta) < 0.01
                  return (
                    <tr key={st.id} className="border-t hover:bg-blue-50/30">
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDateFR(st.period_end)}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{st.statement_number ? `${st.statement_number}/${st.statement_year}` : '-'}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(st.opening_balance)}</td>
                      <td className={`px-3 py-2 text-right font-mono text-xs font-bold ${st.closing_balance < 0 ? 'text-red-600' : 'text-green-700'}`}>{fmt(st.closing_balance)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-gray-600">{fmt(campusNow)}</td>
                      <td className="px-3 py-2 text-center text-xs">
                        {aligned
                          ? <span className="text-green-600" title="Le solde calculé correspond au relevé"> 0,00 €</span>
                          : <span className="text-red-600 font-bold" title="Ligne manquante ou doublon dans les opérations importées">{fmt(delta)}</span>}
                        {!st.arithmetic_ok && <span className="ml-1 text-amber-500" title="Le relevé lui-même ne se vérifie pas"></span>}
                        {st.parse_source === 'manual' && <span className="ml-1 text-gray-400" title="Saisi manuellement"></span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {st.sent_to_comptable ? (
                          <span className="text-xs text-green-600" title={st.sent_to_comptable_at ? `Envoyé le ${fmtDateFR(st.sent_to_comptable_at)}` : 'Envoyé'}> envoyé</span>
                        ) : (
                          <button
                            onClick={() => sendToComptable(st)}
                            disabled={sendingId === st.id}
                            className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            {sendingId === st.id ? '' : ' Envoyer'}
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {st.sent_to_comptable && (
                          <button onClick={() => sendToComptable(st)} disabled={sendingId === st.id}
                            className="text-gray-300 hover:text-green-600 text-xs mr-2" title="Renvoyer au comptable">Renvoyer</button>
                        )}
                        <button onClick={() => openPdf(st)} className="text-blue-500 hover:text-blue-700 text-xs mr-2" title="Ouvrir le PDF">PDF</button>
                        <button onClick={() => deleteStatement(st)} className="text-red-300 hover:text-red-600 text-xs" title="Supprimer">Supprimer</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-2 text-xs text-gray-400 border-t">
          « Solde calculé » = cumul des lignes bancaires importées jusqu'à la date d'arrêté.
          Un écart non nul signale une opération manquante ou importée en double.
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════
// COMPTABLE TAB
// ════════════════════════════════════════
function ComptableTab({ transactions, receipts, loadAll }) {
  const { organization } = useDataStore()
  const [sending, setSending] = useState(false)
  const [notes, setNotes] = useState('')
  const [history, setHistory] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [showResend, setShowResend] = useState(false)
  const [resendSelected, setResendSelected] = useState(new Set())
  const [resetting, setResetting] = useState(false)
  // ─── Factures clients ───
  const [invMonth, setInvMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [invLoading, setInvLoading] = useState(false)
  const [invSending, setInvSending] = useState(false)
  const [invProgress, setInvProgress] = useState(null)
  const [invNotes, setInvNotes] = useState('')
  const [invoicesData, setInvoicesData] = useState([])
  const [invSelected, setInvSelected] = useState(new Set())
  const [invHistory, setInvHistory] = useState([])
  const [showInvResend, setShowInvResend] = useState(false)
  const [invResendSelected, setInvResendSelected] = useState(new Set())

  // Destinataire comptable - lu dans les paramètres de l'organisme (plus aucune adresse en dur)
  const [comptable, setComptable] = useState({ name: '', email: '' })
  useEffect(() => {
    supabase.from('organization_settings').select('comptable_name, comptable_email').limit(1).maybeSingle()
      .then(({ data }) => {
        if (data) setComptable({ name: data.comptable_name || '', email: data.comptable_email || '' })
      })
  }, [])
  const comptableLabel = comptable.email || 'aucun comptable configuré'

  // Transactions pas encore envoyées qui ont des PJ ou sont manuelles.
  // Les transactions privées ne partent jamais chez le comptable.
  const toSend = useMemo(() => transactions.filter(tx => !tx.is_private && !tx.sent_to_comptable && (tx.is_manual || receipts[tx.id]?.length > 0)), [transactions, receipts])

  // Transactions déjà envoyées (manuelles uniquement, les 30 derniers jours)
  const alreadySent = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    return transactions.filter(tx => !tx.is_private && tx.sent_to_comptable && tx.is_manual && new Date(tx.date) >= cutoff)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [transactions])

  useEffect(() => {
    setSelected(new Set(toSend.map(t => t.id)))
    supabase.from('budget_emails_sent').select('*').order('sent_at', { ascending: false }).limit(20)
      .then(({ data }) => { if (data) setHistory(data) })
    supabase.from('invoice_emails_sent').select('*').order('sent_at', { ascending: false }).limit(20)
      .then(({ data }) => { if (data) setInvHistory(data) })
  }, [toSend.length])

  // ─── Charger factures du mois sélectionné ───
  useEffect(() => { loadInvoices() }, [invMonth])

  async function loadInvoices() {
    setInvLoading(true)
    const [year, month] = invMonth.split('-').map(Number)
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const endDate = month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, '0')}-01`

    const { data: invoices } = await supabase
      .from('invoices')
      .select('*, clients!client_id(id, name, siret, address, postal_code, city, tva)')
      .gte('invoice_date', startDate)
      .lt('invoice_date', endDate)
      .not('status', 'in', '("draft","cancelled")')
      .order('invoice_date', { ascending: true })

    if (!invoices || invoices.length === 0) {
      setInvoicesData([])
      setInvSelected(new Set())
      setInvLoading(false)
      return
    }

    const invIds = invoices.map(i => i.id)
    const { data: allItems } = await supabase
      .from('invoice_items')
      .select('*')
      .in('invoice_id', invIds)
      .order('position')

    const contactIds = [...new Set(invoices.filter(i => i.contact_id).map(i => i.contact_id))]
    let contactsMap = {}
    if (contactIds.length > 0) {
      const { data: contacts } = await supabase
        .from('client_contacts')
        .select('*')
        .in('id', contactIds)
      ;(contacts || []).forEach(c => { contactsMap[c.id] = c })
    }

    const enriched = invoices.map(inv => {
      const items = (allItems || []).filter(it => it.invoice_id === inv.id)
      const totals = calcInvoiceTotals(items, inv.discount_percent, inv.tva_applicable)
      return {
        invoice: inv,
        items,
        client: inv.clients || null,
        contact: inv.contact_id ? contactsMap[inv.contact_id] || null : null,
        tvaByRate: totals.tvaByRate,
        totals
      }
    })

    setInvoicesData(enriched)
    setInvSelected(new Set(enriched.filter(d => !d.invoice.sent_to_comptable).map(d => d.invoice.id)))
    setInvLoading(false)
  }

  const invToSend = useMemo(() => invoicesData.filter(d => !d.invoice.sent_to_comptable), [invoicesData])
  const invAlreadySent = useMemo(() => invoicesData.filter(d => d.invoice.sent_to_comptable), [invoicesData])

  const invTotals = useMemo(() => {
    const sel = invoicesData.filter(d => invSelected.has(d.invoice.id))
    const facts = sel.filter(d => d.invoice.type !== 'credit_note')
    const avoirs = sel.filter(d => d.invoice.type === 'credit_note')
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const overdue = sel.filter(d => {
      if (d.invoice.type === 'credit_note') return false
      const due = d.invoice.due_date ? new Date(d.invoice.due_date) : null
      return d.invoice.status === 'overdue' || (due && due < today && d.invoice.status !== 'paid')
    })
    return {
      nbFacts: facts.length,
      nbAvoirs: avoirs.length,
      ht: facts.reduce((s, d) => s + (parseFloat(d.invoice.total_ht) || 0), 0),
      tva: facts.reduce((s, d) => s + (parseFloat(d.invoice.total_tva) || 0), 0),
      ttc: facts.reduce((s, d) => s + (parseFloat(d.invoice.total_ttc) || 0), 0),
      overdue: overdue.length,
      overdueAmount: overdue.reduce((s, d) => s + (parseFloat(d.invoice.amount_due) || 0), 0),
    }
  }, [invoicesData, invSelected])

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleResend(id) {
    setResendSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleInvSelect(id) {
    setInvSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleInvResend(id) {
    setInvResendSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function handleRequeue() {
    if (resendSelected.size === 0) return
    setResetting(true)
    try {
      const ids = [...resendSelected]
      const { error } = await supabase
        .from('budget_transactions')
        .update({ sent_to_comptable: false, sent_to_comptable_at: null })
        .in('id', ids)
      if (error) { toast.error('Erreur: ' + error.message); setResetting(false); return }
      toast.success(`${ids.length} opération(s) remise(s) en file d'envoi`)
      setResendSelected(new Set())
      setShowResend(false)
      loadAll()
    } catch (e) {
      toast.error('Erreur: ' + e.message)
    }
    setResetting(false)
  }

  async function handleInvRequeue() {
    if (invResendSelected.size === 0) return
    setResetting(true)
    try {
      const ids = [...invResendSelected]
      const { error } = await supabase
        .from('invoices')
        .update({ sent_to_comptable: false, sent_to_comptable_at: null })
        .in('id', ids)
      if (error) { toast.error('Erreur: ' + error.message); setResetting(false); return }
      toast.success(`${ids.length} facture(s) remise(s) en file d'envoi`)
      setInvResendSelected(new Set())
      setShowInvResend(false)
      loadInvoices()
    } catch (e) {
      toast.error('Erreur: ' + e.message)
    }
    setResetting(false)
  }

  async function handleSend() {
    if (selected.size === 0) { toast.error('Sélectionnez des transactions'); return }
    setSending(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const resp = await apiFetch('/api/send-budget-comptable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, transactionIds: [...selected], notes })
      })
      const result = await resp.json()
      if (result.success) {
        toast.success(`${result.message}`)
        setNotes('')
        loadAll()
      } else {
        toast.error('Erreur: ' + (result.error || 'Envoi échoué'))
      }
    } catch (e) {
      toast.error('Erreur envoi: ' + e.message)
    }
    setSending(false)
  }

  // ─── Envoi factures : génération PDFs + envoi API ───
  async function handleSendInvoices() {
    if (invSelected.size === 0) { toast.error('Sélectionnez des factures'); return }
    setInvSending(true)

    const selectedData = invoicesData.filter(d => invSelected.has(d.invoice.id))
    const total = selectedData.length
    setInvProgress({ current: 0, total, step: 'Génération Factur-X...' })

    try {
      // ── Préparer les données enrichies (parentRef, sessionRef, billingClient) ──
      const enriched = await Promise.all(selectedData.map(async (d) => {
        const { invoice, items, client, contact } = d
        let parentRef = invoice.parent_reference || ''
        let parentDate = ''
        // Avoir : référence et date de la facture d'origine (mention sur le PDF)
        if (invoice.type === 'credit_note' && invoice.parent_invoice_id) {
          const { data: pinv } = await supabase.from('invoices').select('reference, invoice_date').eq('id', invoice.parent_invoice_id).single()
          parentRef = pinv?.reference || parentRef
          parentDate = pinv?.invoice_date || ''
        }
        if (!parentRef && invoice.quote_id) {
          const { data: q } = await supabase.from('quotes').select('reference').eq('id', invoice.quote_id).single()
          parentRef = q?.reference || ''
        }
        let sessionRef = ''
        if (invoice.session_id) {
          const { data: s } = await supabase.from('sessions').select('reference').eq('id', invoice.session_id).single()
          sessionRef = s?.reference || ''
        }
        let billingClient = null
        if (invoice.is_subrogation && invoice.billing_client_id) {
          const { data: bc } = await supabase.from('clients').select('*').eq('id', invoice.billing_client_id).single()
          billingClient = bc
        }
        return { invoice: { ...invoice, parent_reference: parentRef, parent_invoice_date: parentDate, session_reference: sessionRef }, items, client, contact, billingClient }
      }))

      // ── Génération Factur-X en batch de 5 parallèles ──
      const BATCH = 5
      const attachments = []
      let done = 0

      for (let i = 0; i < enriched.length; i += BATCH) {
        const batch = enriched.slice(i, i + BATCH)
        const results = await Promise.allSettled(batch.map(({ invoice, items, client, contact, billingClient }) =>
          generateFacturXPDF(invoice, items, client, contact, { returnBase64: true, billingClient, orgSettings: organization }, billingClient)
            .then(base64 => ({ ok: true, invoice, base64 }))
            .catch(err => ({ ok: false, invoice, err }))
        ))

        for (const r of results) {
          done++
          setInvProgress({ current: done, total, step: `Factur-X ${done}/${total}...` })
          if (r.status === 'fulfilled' && r.value.ok) {
            attachments.push({
              filename: `${r.value.invoice.reference}_facturx.pdf`,
              base64: r.value.base64,
              contentType: 'application/pdf'
            })
          } else {
            const inv = r.value?.invoice || r.reason
            const ref = inv?.reference || '?'
            console.error(`Erreur Factur-X ${ref}:`, r.value?.err || r.reason)
            toast.error(`Erreur Factur-X ${ref} - facture ignorée`)
          }
        }
      }

      if (attachments.length === 0) {
        toast.error('Aucun PDF généré'); setInvSending(false); setInvProgress(null); return
      }

      setInvProgress({ current: total, total, step: 'Envoi email...' })

      const [year, month] = invMonth.split('-').map(Number)
      const monthNames = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
      const monthLabel = `${monthNames[month]} ${year}`

      const invoicesPayload = selectedData.map(d => ({
        id: d.invoice.id,
        reference: d.invoice.reference,
        type: d.invoice.type,
        client_name: d.client?.name || '-',
        invoice_date: d.invoice.invoice_date,
        due_date: d.invoice.due_date,
        total_ht: parseFloat(d.invoice.total_ht) || 0,
        total_tva: parseFloat(d.invoice.total_tva) || 0,
        total_ttc: parseFloat(d.invoice.total_ttc) || 0,
        amount_paid: parseFloat(d.invoice.amount_paid) || 0,
        amount_due: parseFloat(d.invoice.amount_due) || 0,
        status: d.invoice.status,
        tva_applicable: d.invoice.tva_applicable,
        tvaByRate: d.tvaByRate
      }))

      const { data: { user } } = await supabase.auth.getUser()
      const resp = await apiFetch('/api/send-invoices-comptable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          invoices: invoicesPayload,
          attachments,
          monthLabel,
          notes: invNotes || null
        })
      })
      const result = await resp.json()

      if (result.success) {
        toast.success(`${result.message}`)
        setInvNotes('')
        loadInvoices()
        supabase.from('invoice_emails_sent').select('*').order('sent_at', { ascending: false }).limit(20)
          .then(({ data }) => { if (data) setInvHistory(data) })
      } else {
        toast.error('Erreur: ' + (result.error || 'Envoi échoué'))
      }
    } catch (e) {
      console.error('Erreur envoi factures:', e)
      toast.error('Erreur envoi: ' + e.message)
    }

    setInvSending(false)
    setInvProgress(null)
  }

  // ─── Month options (12 derniers mois) ───
  const monthOptions = useMemo(() => {
    const opts = []
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const mNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
      opts.push({ value: val, label: `${mNames[d.getMonth()]} ${d.getFullYear()}` })
    }
    return opts
  }, [])

  const STATUS_LABELS = { draft: 'Brouillon', sent: 'Envoyée', due: 'À régler', overdue: 'En retard', partial: 'Partiel', paid: 'Payée', cancelled: 'Annulée', credited: 'Annulée par avoir' }
  const STATUS_COLORS = { paid: 'text-green-600', overdue: 'text-red-600', partial: 'text-orange-600', sent: 'text-blue-600', due: 'text-yellow-600', draft: 'text-gray-500', credited: 'text-gray-500' }

  // Tableau réutilisable pour les transactions budget
  function TxTable({ items, selectedSet, onToggle, selectAll }) {
    return (
      <div className="max-h-60 overflow-y-auto border rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-2 py-1.5 text-left">
                <input type="checkbox" checked={selectedSet.size === items.length && items.length > 0}
                  onChange={() => selectAll(selectedSet.size === items.length ? new Set() : new Set(items.map(t => t.id)))} />
              </th>
              <th className="px-2 py-1.5 text-left text-gray-500">Date</th>
              <th className="px-2 py-1.5 text-left text-gray-500">Description</th>
              <th className="px-2 py-1.5 text-left text-gray-500">Catégorie</th>
              <th className="px-2 py-1.5 text-right text-gray-500">Montant</th>
              <th className="px-2 py-1.5 text-center text-gray-500">Type</th>
              <th className="px-2 py-1.5 text-center text-gray-500">PJ</th>
            </tr>
          </thead>
          <tbody>
            {items.map(tx => (
              <tr key={tx.id} className={`border-t ${selectedSet.has(tx.id) ? 'bg-blue-50' : ''}`}>
                <td className="px-2 py-1"><input type="checkbox" checked={selectedSet.has(tx.id)} onChange={() => onToggle(tx.id)} /></td>
                <td className="px-2 py-1">{new Date(tx.date).toLocaleDateString('fr-FR')}</td>
                <td className="px-2 py-1 truncate max-w-40">{tx.description}</td>
                <td className="px-2 py-1">{tx.category_name}</td>
                <td className="px-2 py-1 text-right font-mono">{tx.debit > 0 ? <span className="text-red-600">-{fmt(tx.debit)}</span> : <span className="text-green-600">+{fmt(tx.credit)}</span>}</td>
                <td className="px-2 py-1 text-center">{tx.is_personal ? <span className="text-purple-600">Perso</span> : <span className="text-blue-600">Ent.</span>}</td>
                <td className="px-2 py-1 text-center">{receipts[tx.id]?.length > 0 ? `${receipts[tx.id].length}` : <span className="text-orange-400"></span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ═══════════════ SECTION 1 : Pièces comptables (transactions budget) ═══════════════ */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-700"> Pièces comptables (justificatifs)</h3>
          <div className={`text-xs ${comptable.email ? 'text-gray-400' : 'text-amber-600 font-medium'}`}>→ {comptableLabel}</div>
        </div>

        {toSend.length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-sm"> Tous les justificatifs ont été envoyés</div>
        ) : (
          <>
            <TxTable items={toSend} selectedSet={selected} onToggle={toggleSelect} selectAll={setSelected} />
            <div className="mt-3 space-y-2">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes pour le comptable (optionnel)..." className="w-full border rounded-lg px-3 py-2 text-sm h-16 resize-y" />
              <button onClick={handleSend} disabled={sending || selected.size === 0}
                className="w-full bg-green-600 text-white py-2.5 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50">
                {sending ? ' Envoi en cours...' : ` Envoyer ${selected.size} justificatif(s)`}
              </button>
            </div>
          </>
        )}

        {alreadySent.length > 0 && (
          <div className="mt-3 pt-3 border-t">
            <button onClick={() => { setShowResend(!showResend); setResendSelected(new Set()) }}
              className="text-xs text-blue-600 hover:text-blue-800">
              {showResend ? '▲ Masquer' : ` Renvoyer des justificatifs (${alreadySent.length} déjà envoyé(s))`}
            </button>
            {showResend && (
              <div className="mt-2">
                <TxTable items={alreadySent} selectedSet={resendSelected} onToggle={toggleResend} selectAll={setResendSelected} />
                <button onClick={handleRequeue} disabled={resetting || resendSelected.size === 0}
                  className="mt-2 w-full bg-amber-500 text-white py-2 rounded-lg font-medium hover:bg-amber-600 disabled:opacity-50 text-sm">
                  {resetting ? '...' : ` Remettre ${resendSelected.size} en file d'envoi`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════ SECTION 2 : Factures clients ═══════════════ */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-700"> Factures clients (récap mensuel + PDFs)</h3>
          <div className={`text-xs ${comptable.email ? 'text-gray-400' : 'text-amber-600 font-medium'}`}>→ {comptableLabel}</div>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <select value={invMonth} onChange={e => setInvMonth(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm font-medium">
            {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {invLoading && <span className="text-xs text-gray-400"> Chargement...</span>}
          {!invLoading && <span className="text-xs text-gray-500">
            {invoicesData.length} facture(s) • {invToSend.length} à envoyer • {invAlreadySent.length} déjà envoyée(s)
          </span>}
        </div>

        {invLoading ? (
          <div className="text-center py-8 text-gray-400"> Chargement des factures...</div>
        ) : invToSend.length === 0 && invAlreadySent.length === 0 ? (
          <div className="text-center py-8 text-gray-400">Aucune facture pour ce mois</div>
        ) : invToSend.length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-sm"> Toutes les factures du mois ont été envoyées</div>
        ) : (
          <>
            <div className="max-h-72 overflow-y-auto border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left">
                      <input type="checkbox"
                        checked={invSelected.size === invToSend.length && invToSend.length > 0}
                        onChange={() => setInvSelected(invSelected.size === invToSend.length ? new Set() : new Set(invToSend.map(d => d.invoice.id)))} />
                    </th>
                    <th className="px-2 py-1.5 text-left text-gray-500">Référence</th>
                    <th className="px-2 py-1.5 text-left text-gray-500">Client</th>
                    <th className="px-2 py-1.5 text-center text-gray-500">Date</th>
                    <th className="px-2 py-1.5 text-center text-gray-500">Échéance</th>
                    <th className="px-2 py-1.5 text-right text-gray-500">HT</th>
                    <th className="px-2 py-1.5 text-right text-gray-500">TVA</th>
                    <th className="px-2 py-1.5 text-right text-gray-500">TTC</th>
                    <th className="px-2 py-1.5 text-center text-gray-500">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {invToSend.map(d => {
                    const inv = d.invoice
                    const isCr = inv.type === 'credit_note'
                    return (
                      <tr key={inv.id} className={`border-t ${invSelected.has(inv.id) ? 'bg-blue-50' : ''}`}>
                        <td className="px-2 py-1"><input type="checkbox" checked={invSelected.has(inv.id)} onChange={() => toggleInvSelect(inv.id)} /></td>
                        <td className="px-2 py-1 font-mono font-bold whitespace-nowrap">{inv.reference}</td>
                        <td className="px-2 py-1 truncate max-w-32">{d.client?.name || '-'}</td>
                        <td className="px-2 py-1 text-center">{new Date(inv.invoice_date).toLocaleDateString('fr-FR')}</td>
                        <td className="px-2 py-1 text-center">{inv.due_date ? new Date(inv.due_date).toLocaleDateString('fr-FR') : '-'}</td>
                        <td className={`px-2 py-1 text-right font-mono ${isCr ? 'text-purple-600' : ''}`}>{fmt(inv.total_ht)}</td>
                        <td className="px-2 py-1 text-right font-mono">{fmt(inv.total_tva)}</td>
                        <td className="px-2 py-1 text-right font-mono font-bold">{fmt(inv.total_ttc)}</td>
                        <td className="px-2 py-1 text-center">
                          <span className={`font-bold ${isCr ? 'text-purple-600' : (STATUS_COLORS[inv.status] || 'text-gray-500')}`}>
                            {isCr ? 'Avoir' : (STATUS_LABELS[inv.status] || inv.status)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {invSelected.size > 0 && (
              <div className="mt-3 bg-gray-50 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div><span className="text-gray-500">Factures :</span> <span className="font-bold">{invTotals.nbFacts}</span>{invTotals.nbAvoirs > 0 && <span className="text-purple-600"> + {invTotals.nbAvoirs} avoir(s)</span>}</div>
                <div><span className="text-gray-500">Total HT :</span> <span className="font-bold">{fmt(invTotals.ht)}</span></div>
                <div><span className="text-gray-500">TVA :</span> <span className="font-bold">{fmt(invTotals.tva)}</span></div>
                <div><span className="text-gray-500">TTC :</span> <span className="font-bold text-green-700">{fmt(invTotals.ttc)}</span></div>
                {invTotals.overdue > 0 && (
                  <div className="col-span-full"><span className="text-red-600 font-bold"> {invTotals.overdue} en retard - {fmt(invTotals.overdueAmount)} impayé</span></div>
                )}
              </div>
            )}

            <div className="mt-3 space-y-2">
              <textarea value={invNotes} onChange={e => setInvNotes(e.target.value)}
                placeholder="Notes pour le comptable (optionnel)..."
                className="w-full border rounded-lg px-3 py-2 text-sm h-16 resize-y" />
              <button onClick={handleSendInvoices} disabled={invSending || invSelected.size === 0}
                className="w-full bg-indigo-600 text-white py-3 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50">
                {invSending
                  ? ` ${invProgress?.step || 'Envoi...'} (${invProgress?.current || 0}/${invProgress?.total || 0})`
                  : ` Envoyer ${invSelected.size} facture(s) + PDFs au comptable`}
              </button>
            </div>
          </>
        )}

        {invAlreadySent.length > 0 && (
          <div className="mt-3 pt-3 border-t">
            <button onClick={() => { setShowInvResend(!showInvResend); setInvResendSelected(new Set()) }}
              className="text-xs text-blue-600 hover:text-blue-800">
              {showInvResend ? '▲ Masquer' : ` Renvoyer des factures (${invAlreadySent.length} déjà envoyée(s))`}
            </button>
            {showInvResend && (
              <div className="mt-2">
                <div className="max-h-48 overflow-y-auto border rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left">
                          <input type="checkbox"
                            checked={invResendSelected.size === invAlreadySent.length && invAlreadySent.length > 0}
                            onChange={() => setInvResendSelected(invResendSelected.size === invAlreadySent.length ? new Set() : new Set(invAlreadySent.map(d => d.invoice.id)))} />
                        </th>
                        <th className="px-2 py-1.5 text-left text-gray-500">Référence</th>
                        <th className="px-2 py-1.5 text-left text-gray-500">Client</th>
                        <th className="px-2 py-1.5 text-right text-gray-500">TTC</th>
                        <th className="px-2 py-1.5 text-center text-gray-500">Envoyé le</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invAlreadySent.map(d => (
                        <tr key={d.invoice.id} className={`border-t ${invResendSelected.has(d.invoice.id) ? 'bg-blue-50' : ''}`}>
                          <td className="px-2 py-1"><input type="checkbox" checked={invResendSelected.has(d.invoice.id)} onChange={() => toggleInvResend(d.invoice.id)} /></td>
                          <td className="px-2 py-1 font-mono font-bold">{d.invoice.reference}</td>
                          <td className="px-2 py-1 truncate max-w-32">{d.client?.name || '-'}</td>
                          <td className="px-2 py-1 text-right font-mono">{fmt(d.invoice.total_ttc)}</td>
                          <td className="px-2 py-1 text-center text-green-600">{d.invoice.sent_to_comptable_at ? new Date(d.invoice.sent_to_comptable_at).toLocaleDateString('fr-FR') : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={handleInvRequeue} disabled={resetting || invResendSelected.size === 0}
                  className="mt-2 w-full bg-amber-500 text-white py-2 rounded-lg font-medium hover:bg-amber-600 disabled:opacity-50 text-sm">
                  {resetting ? '...' : ` Remettre ${invResendSelected.size} facture(s) en file d'envoi`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════ SECTION 3 : Historique combiné ═══════════════ */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <h3 className="font-bold text-gray-700 mb-3"> Historique des envois</h3>

        {history.length > 0 && (
          <div className="mb-4">
            <h4 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Justificatifs / pièces comptables</h4>
            <div className="space-y-1.5">
              {history.map(h => (
                <div key={h.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg border text-sm">
                  <span className="text-green-500"></span>
                  <div className="flex-1">
                    <div className="font-medium">{new Date(h.sent_at).toLocaleDateString('fr-FR')} à {new Date(h.sent_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                    <div className="text-xs text-gray-500">{h.nb_transactions} opérations • {h.nb_receipts} PJ • par {h.sent_by}</div>
                    {h.notes && <div className="text-xs text-gray-400 italic mt-0.5">{h.notes}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {invHistory.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Factures clients</h4>
            <div className="space-y-1.5">
              {invHistory.map(h => (
                <div key={h.id} className="flex items-center gap-3 p-2 bg-indigo-50 rounded-lg border border-indigo-100 text-sm">
                  <span className="text-indigo-500"></span>
                  <div className="flex-1">
                    <div className="font-medium">{new Date(h.sent_at).toLocaleDateString('fr-FR')} à {new Date(h.sent_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                    <div className="text-xs text-gray-500">
                      {h.month_label} • {h.nb_invoices} facture(s) • HT {fmt(h.total_ht)} • TTC {fmt(h.total_ttc)}
                      {h.nb_overdue > 0 && <span className="text-red-500 ml-1">• {h.nb_overdue} en retard</span>}
                    </div>
                    {h.notes && <div className="text-xs text-gray-400 italic mt-0.5">{h.notes}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {history.length === 0 && invHistory.length === 0 && (
          <div className="text-center py-6 text-gray-400">Aucun envoi</div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════
function DashboardTab({ stats, months, categories, transactions, invoices: invoicesProp, clients }) {
  // ── Mois courant par défaut ──
  const now = new Date()
  const curMonthKey = String(now.getMonth() + 1).padStart(2, '0') + '/' + now.getFullYear() // "03/2026"
  const defaultMonth = months.includes(curMonthKey) ? curMonthKey : (months[months.length - 1] || curMonthKey)
  const [selMonth, setSelMonth] = useState(defaultMonth)

  // Charger les factures localement (invoicesProp peut arriver vide - pattern identique aux autres tabs)
  const [localInvoices, setLocalInvoices] = useState(null)
  useEffect(() => {
    supabase.from('invoices')
      .select('id, invoice_date, type, status, total_ttc, total_tva, amount_due, due_date')
      .order('invoice_date', { ascending: false })
      .then(({ data }) => { if (data) setLocalInvoices(data) })
  }, [])
  const invoices = localInvoices ?? invoicesProp ?? []

  const EXCLUDE = ['Trésorerie interne', 'Prêts (réception)', 'Apports associés']
  const CA_CATS = ['CA Formations', 'CA Sous-traitance']
  const TVA_RATE = 0.20

  // ── Calculs pour le mois sélectionné ──
  const txMois = transactions.filter(tx => !tx.is_personal && tx.month === selMonth)

  // Mois précédent
  const sortedMonths = months.slice().sort()
  const selIdx = sortedMonths.indexOf(selMonth)
  const prevMonth = selIdx > 0 ? sortedMonths[selIdx - 1] : null
  const txPrev = prevMonth ? transactions.filter(tx => !tx.is_personal && tx.month === prevMonth) : []

  function computeMonthStats(txList) {
    const caEnc = txList.filter(tx => CA_CATS.includes(tx.category_name)).reduce((s, tx) => s + (tx.credit || 0), 0)
    const charges = txList.filter(tx => {
      if (EXCLUDE.includes(tx.category_name)) return false
      const cat = categories.find(c => c.name === tx.category_name)
      return (tx.debit || 0) > 0 && cat?.direction !== 'recette'
    }).reduce((s, tx) => s + (tx.debit || 0), 0)
    const totalCredit = txList.filter(tx => !EXCLUDE.includes(tx.category_name)).reduce((s, tx) => s + (tx.credit || 0), 0)
    const resultat = caEnc - charges
    const ratioCharges = caEnc > 0 ? (charges / caEnc) * 100 : 0
    const tvaEstimee = caEnc > 0 ? caEnc - (caEnc / (1 + TVA_RATE)) : 0
    return { caEnc, charges, resultat, ratioCharges, tvaEstimee, totalCredit }
  }

  const mCur = computeMonthStats(txMois)
  const mPrev = prevMonth ? computeMonthStats(txPrev) : null

  // ── CA facturé ce mois (depuis invoices) ──
  // invoice_date = "YYYY-MM-DD" → convertir en "MM/YYYY"
  const invMois = invoices.filter(inv => {
    if (!inv.invoice_date || inv.type !== 'invoice') return false
    const d = inv.invoice_date
    const mKey = d.substring(5, 7) + '/' + d.substring(0, 4)
    return mKey === selMonth
  })
  const caFacture = invMois.reduce((s, inv) => s + (parseFloat(inv.total_ttc) || 0), 0)
  const tvaFacturee = invMois.reduce((s, inv) => s + (parseFloat(inv.total_tva) || 0), 0)

  // Factures en retard
  const facturesRetard = invoices.filter(inv =>
    inv.type === 'invoice' &&
    ['due', 'overdue', 'partial'].includes(inv.status) &&
    inv.due_date && new Date(inv.due_date) < now
  )
  const montantRetard = facturesRetard.reduce((s, inv) => s + (parseFloat(inv.amount_due) || 0), 0)
  const maxRetardJours = facturesRetard.length > 0
    ? Math.max(...facturesRetard.map(inv => Math.floor((now - new Date(inv.due_date)) / 86400000)))
    : 0

  // ── Projection fin de mois ──
  const isCurrentMonth = selMonth === curMonthKey
  const joursMois = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const joursEcoules = now.getDate()
  const joursRestants = joursMois - joursEcoules
  const projCA = isCurrentMonth && joursEcoules > 0 ? (mCur.caEnc / joursEcoules) * joursMois : 0
  const projCharges = isCurrentMonth && joursEcoules > 0 ? (mCur.charges / joursEcoules) * joursMois : 0

  // ── Top dépenses du mois ──
  const depMois = {}
  txMois.filter(tx => {
    if (EXCLUDE.includes(tx.category_name)) return false
    const cat = categories.find(c => c.name === tx.category_name)
    return (tx.debit || 0) > 0 && cat?.direction !== 'recette'
  }).forEach(tx => {
    const n = tx.category_name || 'Non classé'
    depMois[n] = (depMois[n] || 0) + (tx.debit || 0)
  })
  const topDep = Object.entries(depMois).sort((a, b) => b[1] - a[1])
  const maxDep = topDep[0]?.[1] || 1

  // ── Top revenus du mois ──
  const revMois = {}
  txMois.filter(tx => {
    if (EXCLUDE.includes(tx.category_name)) return false
    const cat = categories.find(c => c.name === tx.category_name)
    return (tx.credit || 0) > 0 && cat?.direction === 'recette'
  }).forEach(tx => {
    const n = tx.category_name || 'Autre'
    revMois[n] = (revMois[n] || 0) + (tx.credit || 0)
  })
  const topRev = Object.entries(revMois).sort((a, b) => b[1] - a[1])
  const maxRev = topRev[0]?.[1] || 1

  // ── Flux mensuels (vue globale) ──
  const sm = months.slice().sort()
  const mx = Math.max(...sm.map(m => Math.max(stats.byMonth[m]?.debit || 0, stats.byMonth[m]?.credit || 0)), 1)

  // ── Helpers d'affichage ──
  function pctDiff(cur, prev) {
    if (!prev || prev === 0) return null
    const d = ((cur - prev) / prev) * 100
    return { val: d, up: d >= 0 }
  }
  function PctBadge({ cur, prev, inverse = false }) {
    const d = pctDiff(cur, prev)
    if (!d) return null
    const good = inverse ? !d.up : d.up
    return (
      <span className={`text-xs font-medium ml-1 ${good ? 'text-green-600' : 'text-red-500'}`}>
        {d.up ? '▲' : '▼'} {Math.abs(d.val).toFixed(0)}%
      </span>
    )
  }
  function KpiCard({ label, value, sub, color = 'gray', prev, prevLabel, inverse = false, large = false }) {
    const colors = {
      green: 'bg-green-50 border-green-200 text-green-700',
      red: 'bg-red-50 border-red-200 text-red-700',
      blue: 'bg-blue-50 border-blue-200 text-blue-700',
      orange: 'bg-orange-50 border-orange-200 text-orange-700',
      purple: 'bg-purple-50 border-purple-200 text-purple-700',
      gray: 'bg-gray-50 border-gray-200 text-gray-700',
      amber: 'bg-amber-50 border-amber-200 text-amber-700',
    }
    return (
      <div className={`rounded-xl border p-3 ${colors[color]}`}>
        <div className="text-xs font-medium opacity-70 mb-1">{label}</div>
        <div className={`font-bold ${large ? 'text-xl' : 'text-lg'}`}>
          {value}
          {prev !== undefined && <PctBadge cur={parseFloat(value)} prev={prev} inverse={inverse} />}
        </div>
        {sub && <div className="text-xs opacity-60 mt-0.5">{sub}</div>}
        {prevLabel && <div className="text-xs opacity-50 mt-0.5">{prevLabel}</div>}
      </div>
    )
  }

  const ratioColor = mCur.ratioCharges > 85 ? 'red' : mCur.ratioCharges > 70 ? 'orange' : 'green'

  return (
    <div className="space-y-4">

      {/* ── Sélecteur de mois ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-600">Mois analysé :</span>
        <div className="flex flex-wrap gap-1.5">
          {sm.map(m => (
            <button
              key={m}
              onClick={() => setSelMonth(m)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                m === selMonth
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {ML[m] || m}
            </button>
          ))}
        </div>
      </div>

      {/* ── Alertes ── */}
      {(facturesRetard.length > 0 || mCur.resultat < 0 || (isCurrentMonth && mCur.caEnc === 0)) && (
        <div className="space-y-2">
          {facturesRetard.length > 0 && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
              <span className="text-lg leading-none"></span>
              <div>
                <span className="font-semibold">{facturesRetard.length} facture{facturesRetard.length > 1 ? 's' : ''} en retard</span>
                {' '}- {fmt(montantRetard)} impayé{facturesRetard.length > 1 ? 's' : ''}, jusqu'à <strong>{maxRetardJours} jours</strong> de retard
              </div>
            </div>
          )}
          {mCur.resultat < 0 && (
            <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-xl p-3 text-sm text-orange-700">
              <span></span>
              <span><strong>Mois déficitaire</strong> - les charges ({fmt(mCur.charges)}) dépassent le CA encaissé ({fmt(mCur.caEnc)})</span>
            </div>
          )}
          {isCurrentMonth && mCur.caEnc === 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">
              <span></span>
              <span><strong>Aucun CA encaissé</strong> ce mois pour l'instant</span>
            </div>
          )}
        </div>
      )}

      {/* ── KPIs principaux ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="CA encaissé"
          value={fmt(mCur.caEnc)}
          color="green"
          sub={prevMonth ? `vs ${ML[prevMonth] || prevMonth} : ${fmt(mPrev.caEnc)}` : undefined}
          prevLabel={mPrev ? undefined : undefined}
        />
        <KpiCard
          label="Charges"
          value={fmt(mCur.charges)}
          color="red"
          sub={prevMonth ? `vs ${ML[prevMonth] || prevMonth} : ${fmt(mPrev.charges)}` : undefined}
        />
        <KpiCard
          label="Résultat net"
          value={fmt(mCur.resultat)}
          color={mCur.resultat >= 0 ? 'blue' : 'red'}
          sub={prevMonth ? `vs ${ML[prevMonth] || prevMonth} : ${fmt(mPrev.resultat)}` : undefined}
        />
        <KpiCard
          label="Ratio charges/CA"
          value={mCur.caEnc > 0 ? mCur.ratioCharges.toFixed(0) + '%' : '-'}
          color={ratioColor}
          sub={mCur.caEnc > 0 ? (mCur.ratioCharges > 85 ? ' Critique' : mCur.ratioCharges > 70 ? ' Élevé' : ' Sain') : undefined}
        />
      </div>

      {/* ── CA encaissé vs CA facturé + TVA ── */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-bold text-gray-700 mb-3"> CA encaissé vs facturé</h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>CA encaissé (transactions)</span>
                <span className="font-semibold text-green-700">{fmt(mCur.caEnc)}</span>
              </div>
              <div className="bg-gray-100 rounded-full h-2">
                <div className="bg-green-500 rounded-full h-2" style={{width: caFacture > 0 ? `${Math.min((mCur.caEnc / Math.max(mCur.caEnc, caFacture)) * 100, 100)}%` : '100%'}} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>CA facturé (factures émises)</span>
                <span className="font-semibold text-blue-700">{fmt(caFacture)}</span>
              </div>
              <div className="bg-gray-100 rounded-full h-2">
                <div className="bg-blue-400 rounded-full h-2" style={{width: mCur.caEnc > 0 ? `${Math.min((caFacture / Math.max(mCur.caEnc, caFacture)) * 100, 100)}%` : (caFacture > 0 ? '100%' : '0%')}} />
              </div>
            </div>
            {caFacture > mCur.caEnc && (
              <div className="text-xs text-orange-600 bg-orange-50 rounded-lg px-3 py-1.5">
                 {fmt(caFacture - mCur.caEnc)} facturé mais pas encore encaissé ce mois
              </div>
            )}
            {invMois.length > 0 && (
              <div className="text-xs text-gray-400">{invMois.length} facture{invMois.length > 1 ? 's' : ''} émise{invMois.length > 1 ? 's' : ''} ce mois</div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-bold text-gray-700 mb-3"> TVA - estimation indicative</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">TVA sur encaissements (20%)</span>
              <span className="font-bold text-orange-700">{fmt(mCur.tvaEstimee)}</span>
            </div>
            {tvaFacturee > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">TVA facturée (factures émises)</span>
                <span className="font-semibold text-blue-700">{fmt(tvaFacturee)}</span>
              </div>
            )}
            <div className="border-t pt-2 text-xs text-gray-400">
               Estimation basée sur 20% du CA TTC encaissé. Certains clients peuvent être exonérés. Vérifier avec votre comptable.
            </div>
          </div>
        </div>
      </div>

      {/* ── Projection fin de mois ── */}
      {isCurrentMonth && joursEcoules >= 3 && projCA > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <h3 className="font-bold text-blue-700 mb-2"> Projection fin de mois - {joursRestants} jours restants</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-xs text-gray-500 mb-1">CA projeté</div>
              <div className="text-lg font-bold text-blue-700">{fmt(projCA)}</div>
              <div className="text-xs text-gray-400">base : {fmt(mCur.caEnc)} en {joursEcoules}j</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Charges projetées</div>
              <div className="text-lg font-bold text-red-600">{fmt(projCharges)}</div>
              <div className="text-xs text-gray-400">base : {fmt(mCur.charges)} en {joursEcoules}j</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Résultat projeté</div>
              <div className={`text-lg font-bold ${projCA - projCharges >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(projCA - projCharges)}</div>
              <div className="text-xs text-gray-400">sur {joursMois} jours</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Comparaison mois courant vs précédent ── */}
      {prevMonth && (
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-bold text-gray-700 mb-3"> Comparaison {ML[selMonth] || selMonth} vs {ML[prevMonth] || prevMonth}</h3>
          <div className="space-y-2">
            {[
              { label: 'CA encaissé', cur: mCur.caEnc, prev: mPrev.caEnc, color: 'green' },
              { label: 'Charges', cur: mCur.charges, prev: mPrev.charges, color: 'red' },
              { label: 'Résultat', cur: mCur.resultat, prev: mPrev.resultat, color: mCur.resultat >= 0 ? 'blue' : 'red' },
            ].map(({ label, cur, prev, color }) => {
              const maxVal = Math.max(Math.abs(cur), Math.abs(prev), 1)
              const colorMap = { green: '#22c55e', red: '#f87171', blue: '#60a5fa' }
              const diff = cur - prev
              const diffPct = prev !== 0 ? ((diff / Math.abs(prev)) * 100).toFixed(0) : null
              return (
                <div key={label}>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{label}</span>
                    <span className={`font-medium ${diff >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {diff >= 0 ? '+' : ''}{fmt(diff)}
                      {diffPct && <span className="ml-1 opacity-70">({diff >= 0 ? '+' : ''}{diffPct}%)</span>}
                    </span>
                  </div>
                  <div className="flex gap-1 items-center">
                    <div className="flex-1 bg-gray-100 rounded h-3 overflow-hidden flex">
                      <div className="h-full rounded" style={{width: `${(Math.abs(prev) / maxVal) * 100}%`, backgroundColor: colorMap[color], opacity: 0.4}} />
                    </div>
                    <span className="text-xs w-16 text-right text-gray-400">{fmtS(prev)}</span>
                  </div>
                  <div className="flex gap-1 items-center mt-0.5">
                    <div className="flex-1 bg-gray-100 rounded h-3 overflow-hidden flex">
                      <div className="h-full rounded" style={{width: `${(Math.abs(cur) / maxVal) * 100}%`, backgroundColor: colorMap[color]}} />
                    </div>
                    <span className="text-xs w-16 text-right font-medium" style={{color: colorMap[color]}}>{fmtS(cur)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Top dépenses + revenus du mois ── */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-bold text-gray-700 mb-3"> Dépenses du mois</h3>
          {topDep.length === 0
            ? <div className="text-center py-6 text-gray-400 text-sm">Aucune dépense ce mois</div>
            : <div className="space-y-1.5">
                {topDep.map(([n, v]) => {
                  const cat = categories.find(c => c.name === n)
                  const pct = ((v / mCur.charges) * 100).toFixed(0)
                  return (
                    <div key={n} className="flex items-center gap-2">
                      <span className="text-sm w-5">{cat?.icon || ''}</span>
                      <div className="flex-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-700 truncate">{n}</span>
                          <span className="text-red-600 font-medium ml-2">{fmtS(v)} <span className="text-gray-400">({pct}%)</span></span>
                        </div>
                        <div className="bg-gray-100 rounded-full h-1.5 mt-0.5">
                          <div className="bg-red-400 rounded-full h-1.5" style={{width: `${(v / maxDep) * 100}%`}} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
          }
        </div>
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-bold text-gray-700 mb-3"> Revenus du mois</h3>
          {topRev.length === 0
            ? <div className="text-center py-6 text-gray-400 text-sm">Aucun revenu ce mois</div>
            : <div className="space-y-1.5">
                {topRev.map(([n, v]) => {
                  const cat = categories.find(c => c.name === n)
                  return (
                    <div key={n} className="flex items-center gap-2">
                      <span className="text-sm w-5">{cat?.icon || ''}</span>
                      <div className="flex-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-700 truncate">{n}</span>
                          <span className="text-green-600 font-medium ml-2">{fmtS(v)}</span>
                        </div>
                        <div className="bg-gray-100 rounded-full h-1.5 mt-0.5">
                          <div className="bg-green-400 rounded-full h-1.5" style={{width: `${(v / maxRev) * 100}%`}} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
          }
        </div>
      </div>

      {/* ── Flux mensuels historique ── */}
      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-bold text-gray-700 mb-3"> Historique des flux</h3>
        <div className="space-y-2">
          {sm.map(m => {
            const d = stats.byMonth[m] || { debit: 0, credit: 0 }
            const isSel = m === selMonth
            return (
              <div key={m} className={`flex items-center gap-2 rounded-lg px-2 py-1 cursor-pointer transition-colors ${isSel ? 'bg-blue-50' : 'hover:bg-gray-50'}`} onClick={() => setSelMonth(m)}>
                <div className={`w-16 text-xs font-medium ${isSel ? 'text-blue-700' : 'text-gray-500'}`}>{ML[m] || m}</div>
                <div className="flex-1 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1">
                    <div className="bg-green-400 rounded-sm h-2.5" style={{width: `${(d.credit / mx) * 100}%`, minWidth: d.credit > 0 ? '2px' : 0}} />
                    <span className="text-xs text-green-700">{fmtS(d.credit)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="bg-red-400 rounded-sm h-2.5" style={{width: `${(d.debit / mx) * 100}%`, minWidth: d.debit > 0 ? '2px' : 0}} />
                    <span className="text-xs text-red-600">{fmtS(d.debit)}</span>
                  </div>
                </div>
                <div className={`w-20 text-right text-xs font-bold ${d.credit - d.debit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {d.credit - d.debit >= 0 ? '+' : ''}{fmtS(d.credit - d.debit)}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── CCA gérants ── */}
      {(stats.cca || []).some(c => c.value > 0) && (
        <div className="bg-purple-50 rounded-xl border border-purple-200 p-4">
          <h3 className="font-bold text-purple-800 mb-2"> Comptes courants associés</h3>
          <div className="grid md:grid-cols-2 gap-3">
            {stats.cca.map(c => (
              <div key={c.key} className="bg-white rounded-lg p-3 border border-purple-100"><div className="text-sm text-gray-600">{c.label}</div><div className="text-xl font-bold text-purple-700">{fmt(c.value)}</div></div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════
// CATEGORIES
// ════════════════════════════════════════
function CategoriesTab({ categories, loadAll }) {
  const [nw, setNw] = useState({ name:'', direction:'depense', type:'variable', icon:'' })
  const [editId, setEditId] = useState(null)
  const [ef, setEf] = useState({})
  const icons = ['','','','','','','','','','','','','','','','','','','','','','','','','↩','']
  async function add() { if(!nw.name.trim()){toast.error('Nom requis');return}; const ms=Math.max(...categories.map(c=>c.sort_order||0),0); const{error}=await supabase.from('budget_categories').insert({...nw,color:'gray',sort_order:ms+1}); if(error){toast.error(error.code==='23505'?'Existe déjà':'Erreur');return}; toast.success('Créée'); setNw({name:'',direction:'depense',type:'variable',icon:''}); loadAll() }
  async function upd() { if(!ef.name?.trim())return; await supabase.from('budget_categories').update(ef).eq('id',editId); toast.success('Modifié'); setEditId(null); loadAll() }
  async function del(id,n) { const{count}=await supabase.from('budget_transactions').select('id',{count:'exact',head:true}).eq('category_id',id); if(count>0){toast.error(`${count} transactions utilisent "${n}"`);return}; if(!confirm(`Supprimer "${n}" ?`))return; await supabase.from('budget_categories').delete().eq('id',id); toast.success('Supprimé'); loadAll() }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <h3 className="font-bold text-gray-700 mb-3"> Nouvelle catégorie</h3>
        <div className="flex gap-2 flex-wrap">
          <select value={nw.icon} onChange={e=>setNw(n=>({...n,icon:e.target.value}))} className="border rounded-lg px-2 py-2 text-lg w-14">{icons.map(i=><option key={i} value={i}>{i}</option>)}</select>
          <input type="text" value={nw.name} onChange={e=>setNw(n=>({...n,name:e.target.value}))} placeholder="Nom" className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-40"/>
          <select value={nw.direction} onChange={e=>setNw(n=>({...n,direction:e.target.value}))} className="border rounded-lg px-3 py-2 text-sm"><option value="depense">Dépense</option><option value="recette">Recette</option><option value="neutre">Neutre</option></select>
          <select value={nw.type} onChange={e=>setNw(n=>({...n,type:e.target.value}))} className="border rounded-lg px-3 py-2 text-sm"><option value="fixe">Fixe</option><option value="variable">Variable</option><option value="exceptionnel">Exceptionnel</option></select>
          <button onClick={add} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Créer</button>
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full text-sm"><thead className="bg-gray-50"><tr><th className="text-left px-3 py-2 text-xs text-gray-500"></th><th className="text-left px-3 py-2 text-xs text-gray-500">Nom</th><th className="text-left px-3 py-2 text-xs text-gray-500">Dir.</th><th className="text-left px-3 py-2 text-xs text-gray-500">Type</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>{categories.map(cat=><tr key={cat.id} className="border-t hover:bg-gray-50">
            {editId===cat.id?(<>
              <td className="px-3 py-1"><select value={ef.icon} onChange={e=>setEf(f=>({...f,icon:e.target.value}))} className="border rounded px-1 py-0.5 text-lg w-12">{icons.map(i=><option key={i} value={i}>{i}</option>)}</select></td>
              <td className="px-3 py-1"><input type="text" value={ef.name} onChange={e=>setEf(f=>({...f,name:e.target.value}))} className="border rounded px-2 py-1 text-sm w-full"/></td>
              <td className="px-3 py-1"><select value={ef.direction} onChange={e=>setEf(f=>({...f,direction:e.target.value}))} className="border rounded px-2 py-1 text-xs"><option value="depense">Dépense</option><option value="recette">Recette</option><option value="neutre">Neutre</option></select></td>
              <td className="px-3 py-1"><select value={ef.type} onChange={e=>setEf(f=>({...f,type:e.target.value}))} className="border rounded px-2 py-1 text-xs"><option value="fixe">Fixe</option><option value="variable">Variable</option><option value="exceptionnel">Exceptionnel</option></select></td>
              <td className="px-3 py-1 text-right"><button onClick={upd} className="text-green-600 text-xs mr-2">OK</button><button onClick={()=>setEditId(null)} className="text-gray-400 text-xs">Annuler</button></td>
            </>):(<>
              <td className="px-3 py-1.5 text-lg">{cat.icon}</td>
              <td className="px-3 py-1.5 font-medium text-gray-700">{cat.name}</td>
              <td className="px-3 py-1.5"><span className={`text-xs px-2 py-0.5 rounded-full ${cat.direction==='recette'?'bg-green-100 text-green-700':cat.direction==='depense'?'bg-red-100 text-red-700':'bg-gray-100'}`}>{cat.direction}</span></td>
              <td className="px-3 py-1.5 text-xs text-gray-500">{cat.type}</td>
              <td className="px-3 py-1.5 text-right"><button onClick={()=>{setEditId(cat.id);setEf({name:cat.name,icon:cat.icon,direction:cat.direction,type:cat.type})}} className="text-blue-500 text-xs mr-2">Modifier</button><button onClick={()=>del(cat.id,cat.name)} className="text-red-400 text-xs">Suppr</button></td>
            </>)}
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

// ════════════════════════════════════════
// RULES - avec édition inline, recherche, filtres
// ════════════════════════════════════════
function RulesTab({ rules, categories, loadAll }) {
  const [nw, setNw] = useState({ keyword:'', category_id:'', direction:'both' })
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [filterDir, setFilterDir] = useState('')
  const [editId, setEditId] = useState(null)
  const [editData, setEditData] = useState({})
  const [saving, setSaving] = useState(false)

  async function add() {
    if (!nw.keyword || !nw.category_id) { toast.error('Mot-clé et catégorie requis'); return }
    setSaving(true)
    const { error } = await supabase.from('budget_rules').insert({ keyword: nw.keyword.toUpperCase().trim(), category_id: nw.category_id, direction: nw.direction })
    setSaving(false)
    if (error) { toast.error(error.code === '23505' ? 'Ce mot-clé existe déjà' : 'Erreur: ' + error.message); return }
    toast.success('Règle ajoutée')
    setNw({ keyword: '', category_id: '', direction: 'both' })
    loadAll()
  }

  async function del(id, keyword) {
    if (!confirm(`Supprimer la règle "${keyword}" ?`)) return
    await supabase.from('budget_rules').delete().eq('id', id)
    toast.success('Règle supprimée')
    loadAll()
  }

  function startEdit(r) {
    setEditId(r.id)
    setEditData({ keyword: r.keyword, category_id: r.category_id, direction: r.direction })
  }

  async function saveEdit() {
    if (!editData.keyword || !editData.category_id) { toast.error('Mot-clé et catégorie requis'); return }
    setSaving(true)
    const { error } = await supabase.from('budget_rules').update({
      keyword: editData.keyword.toUpperCase().trim(),
      category_id: editData.category_id,
      direction: editData.direction,
    }).eq('id', editId)
    setSaving(false)
    if (error) { toast.error(error.code === '23505' ? 'Ce mot-clé existe déjà' : 'Erreur: ' + error.message); return }
    toast.success('Règle modifiée')
    setEditId(null)
    setEditData({})
    loadAll()
  }

  function cancelEdit() { setEditId(null); setEditData({}) }

  // Filtrage
  const filtered = useMemo(() => {
    let f = [...rules]
    if (search) {
      const s = search.toUpperCase()
      f = f.filter(r => r.keyword?.toUpperCase().includes(s) || r.budget_categories?.name?.toUpperCase().includes(s))
    }
    if (filterCat) f = f.filter(r => r.category_id === filterCat)
    if (filterDir) f = f.filter(r => r.direction === filterDir)
    return f
  }, [rules, search, filterCat, filterDir])

  // Stats par catégorie
  const catStats = useMemo(() => {
    const map = {}
    rules.forEach(r => {
      const name = r.budget_categories?.name || 'Sans catégorie'
      if (!map[name]) map[name] = 0
      map[name]++
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [rules])

  const dirLabel = { both: ' Tous', debit: ' Débit', credit: ' Crédit' }

  return (
    <div className="space-y-4">
      {/* Stats rapides */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl shadow-sm border p-3">
          <div className="text-xs text-gray-500">Total règles</div>
          <div className="text-2xl font-bold text-gray-800">{rules.length}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-3">
          <div className="text-xs text-gray-500">Catégories utilisées</div>
          <div className="text-2xl font-bold text-blue-600">{catStats.length}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-3">
          <div className="text-xs text-gray-500">Débit uniquement</div>
          <div className="text-2xl font-bold text-red-600">{rules.filter(r => r.direction === 'debit').length}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-3">
          <div className="text-xs text-gray-500">Crédit uniquement</div>
          <div className="text-2xl font-bold text-emerald-600">{rules.filter(r => r.direction === 'credit').length}</div>
        </div>
      </div>

      {/* Formulaire ajout */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <h3 className="font-bold text-gray-700 mb-3"> Nouvelle règle</h3>
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            value={nw.keyword}
            onChange={e => setNw(r => ({ ...r, keyword: e.target.value.toUpperCase() }))}
            placeholder="Mot-clé (ex: RESTAURANT)"
            className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-40 font-mono"
            onKeyDown={e => e.key === 'Enter' && add()}
          />
          <select value={nw.category_id} onChange={e => setNw(r => ({ ...r, category_id: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-48">
            <option value="">Catégorie...</option>
            {categories.sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
          <select value={nw.direction} onChange={e => setNw(r => ({ ...r, direction: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm">
            <option value="both"> Les deux</option>
            <option value="debit"> Débit</option>
            <option value="credit"> Crédit</option>
          </select>
          <button onClick={add} disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? '...' : 'Ajouter'}
          </button>
        </div>
      </div>

      {/* Recherche et filtres */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-48">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder=" Rechercher mot-clé ou catégorie..."
              className="w-full border rounded-lg px-3 py-2 text-sm pr-8"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">×</button>
            )}
          </div>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="border rounded-lg px-3 py-2 text-sm min-w-48">
            <option value="">Toutes les catégories</option>
            {catStats.map(([name, count]) => {
              const cat = categories.find(c => c.name === name)
              return <option key={name} value={cat?.id || ''}>{cat?.icon || ''} {name} ({count})</option>
            })}
          </select>
          <select value={filterDir} onChange={e => setFilterDir(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            <option value="">Toutes directions</option>
            <option value="both"> Les deux</option>
            <option value="debit"> Débit</option>
            <option value="credit"> Crédit</option>
          </select>
          {(search || filterCat || filterDir) && (
            <button onClick={() => { setSearch(''); setFilterCat(''); setFilterDir('') }} className="text-sm text-blue-600 hover:text-blue-800">
              Réinitialiser
            </button>
          )}
          <span className="text-xs text-gray-400">{filtered.length}/{rules.length} règles</span>
        </div>
      </div>

      {/* Tableau des règles */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="text-left px-3 py-2.5 text-xs text-gray-500 uppercase tracking-wider">Mot-clé</th>
                <th className="text-left px-3 py-2.5 text-xs text-gray-500 uppercase tracking-wider">→ Catégorie</th>
                <th className="text-left px-3 py-2.5 text-xs text-gray-500 uppercase tracking-wider w-24">Dir.</th>
                <th className="px-3 py-2.5 text-xs text-gray-500 uppercase tracking-wider w-24 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className={`border-t hover:bg-gray-50 transition ${editId === r.id ? 'bg-blue-50' : ''}`}>
                  {editId === r.id ? (
                    <>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={editData.keyword}
                          onChange={e => setEditData(d => ({ ...d, keyword: e.target.value.toUpperCase() }))}
                          className="w-full border rounded px-2 py-1 text-xs font-mono bg-white"
                          autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <select
                          value={editData.category_id}
                          onChange={e => setEditData(d => ({ ...d, category_id: e.target.value }))}
                          className="w-full border rounded px-2 py-1 text-xs bg-white"
                        >
                          {categories.sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                            <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        <select
                          value={editData.direction}
                          onChange={e => setEditData(d => ({ ...d, direction: e.target.value }))}
                          className="w-full border rounded px-2 py-1 text-xs bg-white"
                        >
                          <option value="both"> Tous</option>
                          <option value="debit"> Débit</option>
                          <option value="credit"> Crédit</option>
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <div className="flex gap-1 justify-end">
                          <button onClick={saveEdit} disabled={saving} className="px-2 py-1 bg-emerald-500 text-white rounded text-xs hover:bg-emerald-600 disabled:opacity-50">{saving ? '...' : 'OK'}</button>
                          <button onClick={cancelEdit} className="px-2 py-1 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300">Annuler</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-1.5 font-mono text-xs">{r.keyword}</td>
                      <td className="px-3 py-1.5">
                        <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">
                          {r.budget_categories?.icon} {r.budget_categories?.name}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        {r.direction === 'debit' ? ' Débit' : r.direction === 'credit' ? ' Crédit' : ' Tous'}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <div className="flex gap-1 justify-end [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100" style={{ opacity: 1 }}>
                          <button onClick={() => startEdit(r)} className="px-2 py-1 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded text-xs transition" title="Modifier">Modifier</button>
                          <button onClick={() => del(r.id, r.keyword)} className="px-2 py-1 text-red-300 hover:text-red-600 hover:bg-red-50 rounded text-xs transition" title="Supprimer">Supprimer</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              {rules.length === 0 ? 'Aucune règle configurée' : 'Aucune règle ne correspond aux filtres'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// IMPORT - Texte brut du relevé bancaire + Matching factures
// ════════════════════════════════════════════════════════════
function ImportTab({ loadAll, categories, rules, invoices, clients, transactions, organization }) {
  const [imp, setImp] = useState(false)
  const [csv, setCsv] = useState('')
  const [pre, setPre] = useState([])
  const [selectedRows, setSelectedRows] = useState(new Set())
  const [csvDragOver, setCsvDragOver] = useState(false)
  const [searchOpenRow, setSearchOpenRow] = useState(null) // Index de la ligne avec panneau recherche ouvert
  const [searchQuery, setSearchQuery] = useState('')
  const [localInvoices, setLocalInvoices] = useState(null)
  const [localClients, setLocalClients] = useState(null)

  useEffect(() => {
    async function loadInvoicesAndClients() {
      const [invR, cliR] = await Promise.all([
        fetchAll(() => supabase.from('invoices').select('*').order('invoice_date', { ascending: false })),
        fetchAll(() => supabase.from('clients').select('*').order('name')),
      ])
      setLocalInvoices(invR)
      setLocalClients(cliR)
    }
    loadInvoicesAndClients()
  }, [])

  // Nouveau : collage rapide texte brut
  const [rawText, setRawText] = useState('')
  const [rawDirection, setRawDirection] = useState('credit')
  const [rawParsed, setRawParsed] = useState(null)
  const [rawSaving, setRawSaving] = useState(false)

  // Matching factures
  const [showMatchModal, setShowMatchModal] = useState(false)
  const [matchTx, setMatchTx] = useState(null)
  const [matchClient, setMatchClient] = useState(null)
  const [matchCandidates, setMatchCandidates] = useState([])
  const [matchSelected, setMatchSelected] = useState(new Set())
  const [matchAllocations, setMatchAllocations] = useState({})
  const [matchStep, setMatchStep] = useState('auto') // auto | select_client | select_invoices

  // Factures non payées
  // Préférer les données chargées localement (invoicesList du parent arrive souvent vide)
  const effectiveInvoices = localInvoices ?? invoices ?? []
  const effectiveClients = localClients ?? clients ?? []

  // Plus ancienne échéance en premier : à montant égal, le virement règle la facture la plus ancienne
  const unpaidInvoices = useMemo(() =>
    effectiveInvoices
      .filter(inv => inv.type !== 'credit_note' && ['sent', 'due', 'overdue', 'partial'].includes(inv.status) && parseFloat(inv.amount_due) > 0)
      .slice()
      .sort((a, b) => {
        const da = String(a.due_date || a.invoice_date || '9999'), db = String(b.due_date || b.invoice_date || '9999')
        if (da !== db) return da.localeCompare(db)
        return String(a.invoice_date || '').localeCompare(String(b.invoice_date || ''))
      }),
    [effectiveInvoices]
  )

  // ── Parser CSV amélioré + déduplication ──
  function parse(text) {
    const lines = text.trim().split('\n').filter(l => l.trim())
    const txs = []
    for (const line of lines) {
      const p = line.split(';')
      if (p.length < 4) continue
      if (p[0]?.trim() === 'Date operation' || p[0]?.trim() === 'Date opération') continue
      const ds = p[0].trim(); const desc = p[2]?.trim() || ''
      const db = p[3]?.trim().replace(/\s/g, '').replace(',', '.') || ''
      const cr = p[4]?.trim().replace(/\s/g, '').replace(',', '.') || ''
      if (!ds || !desc) continue
      const dp = ds.split('/')
      if (dp.length !== 3) continue
      const yr = dp[2].length === 2 ? '20' + dp[2] : dp[2]
      const d = db ? Math.abs(parseFloat(db)) : 0
      const c = cr ? Math.abs(parseFloat(cr)) : 0
      if (isNaN(d) && isNaN(c)) continue
      let cn = 'Autre / Non classé'
      const du = desc.toUpperCase()
      for (const r of rules) {
        if (r.direction === 'debit' && !(d > 0)) continue
        if (r.direction === 'credit' && !(c > 0)) continue
        if (du.includes(r.keyword?.toUpperCase())) { cn = r.budget_categories?.name || cn; break }
      }
      txs.push({ date: `${yr}-${dp[1]}-${dp[0]}`, description: desc, debit: d || 0, credit: c || 0, category_name: cn, month: `${dp[1]}/${yr}`, year: parseInt(yr) })
    }
    return txs
  }

  // Détection de doublons : compare date + description normalisée + montant
  function checkDuplicates(parsedTxs) {
    // Normalise : accents, apostrophes multiples, espaces
    const normDesc = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
      .replace(/[''`´"]+/g, '').replace(/\s+/g, ' ').replace(/[^A-Z0-9 ]/g, '').trim()

    // Saisies manuelles non encore rapprochées (cibles de rapprochement)
    const manualTxs = (transactions || []).filter(ex => ex.is_manual && !ex.linked_transaction_id && !ex.reconciled_at)

    return parsedTxs.map(tx => {
      const txDesc = normDesc(tx.description)
      const txAmount = tx.debit > 0 ? tx.debit : tx.credit
      const txDate = new Date(tx.date)

      // ── Doublon exact banque↔banque ──
      const isDuplicate = (transactions || []).some(ex => {
        // Check 1 : même date + description normalisée + montant
        const descMatch = ex.date === tx.date && normDesc(ex.description) === txDesc &&
          Math.abs((ex.debit || 0) - tx.debit) < 0.01 && Math.abs((ex.credit || 0) - tx.credit) < 0.01
        if (descMatch) return true

        // Check 2 : même date + même montant + description contient les 15 premiers chars
        const exAmount = (ex.debit || 0) > 0 ? (ex.debit || 0) : (ex.credit || 0)
        if (ex.date === tx.date && Math.abs(exAmount - txAmount) < 0.01 && txAmount > 0) {
          const short = txDesc.substring(0, 15)
          if (short.length >= 10 && normDesc(ex.description).includes(short)) return true
        }

        return false
      })

      // ── Match saisie manuelle : même montant + même sens + date ±3 jours ──
      let manualMatch = null
      if (!isDuplicate) {
        const txIsDebit = tx.debit > 0
        manualMatch = manualTxs.find(ex => {
          const exIsDebit = (ex.debit || 0) > 0
          if (exIsDebit !== txIsDebit) return false
          const exAmount = exIsDebit ? (ex.debit || 0) : (ex.credit || 0)
          if (Math.abs(exAmount - txAmount) > 0.01) return false
          const exDate = new Date(ex.date)
          const diffDays = Math.abs((txDate - exDate) / 86400000)
          return diffDays <= 3
        }) || null
      }

      return { ...tx, isDuplicate, hasManualMatch: !!manualMatch, manualMatch: manualMatch || null, absorbManual: !!manualMatch }
    })
  }

  function handleCsvFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      setCsv(text)
      processCSV(text)
    }
    reader.readAsText(file, 'utf-8')
  }

  function handleCsvDrop(e) { e.preventDefault(); setCsvDragOver(false); if (e.dataTransfer.files[0]) handleCsvFile(e.dataTransfer.files[0]) }
  function handleCsvPaste() {
    if (!csv.trim()) return
    processCSV(csv)
  }

  function toggleRow(idx) { setSelectedRows(prev => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n }) }
  function selectAllNew() { const s = new Set(); pre.forEach((tx, i) => { if (!tx.isDuplicate) s.add(i) }); setSelectedRows(s) }
  function selectNone() { setSelectedRows(new Set()) }
  function toggleAbsorb(idx) { setPre(prev => prev.map((tx, i) => i === idx ? { ...tx, absorbManual: !tx.absorbManual } : tx)) }

  function changePreCategory(idx, catName) {
    setPre(prev => prev.map((tx, i) => i === idx ? { ...tx, category_name: catName } : tx))
  }

  // Détacher le match facture d'une ligne
  function detachMatch(idx) {
    setPre(prev => prev.map((tx, i) => i === idx ? { ...tx, matchedInvoices: [], matchConfidence: 'none', matchType: '' } : tx))
  }

  // Attacher manuellement des factures à une ligne crédit
  function attachInvoices(idx, invIds) {
    const invs = invIds.map(id => unpaidInvoices.find(inv => inv.id === id)).filter(Boolean).map(inv => {
      const cli = (clients || []).find(c => c.id === inv.client_id)
      return { id: inv.id, reference: inv.reference, client_name: cli?.name || '?', total_ttc: parseFloat(inv.total_ttc), amount_due: parseFloat(inv.amount_due) }
    })
    setPre(prev => prev.map((tx, i) => i === idx ? { ...tx, matchedInvoices: invs, matchConfidence: 'manual', matchType: 'Manuel' } : tx))
  }

  // ══ Auto-matching factures pour les lignes crédit ══
  function autoMatchInvoices(parsedTxs) {
    const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
    // Factures déjà affectées à une ligne précédente du même import :
    // une facture ne peut être rapprochée qu'une seule fois par fichier
    const allUnpaid = unpaidInvoices
    const consumed = new Set()

    return parsedTxs.map(tx => {
      if (tx.credit <= 0 || tx.isDuplicate) return { ...tx, matchedInvoices: [], matchConfidence: 'none', matchType: '' }
      const unpaidInvoices = allUnpaid.filter(u => !consumed.has(u.id))

      const descUp = norm(tx.description)
      const amount = tx.credit
      let matchedInvoices = []
      let matchConfidence = 'none'
      let matchType = ''

      // Stratégie 1 : référence facture dans le libellé (FACT-YYYYMMDD-XXXXX)
      const refMatch = tx.description.match(/FACT[-_]?\d{6,8}[-_]?\d{3,5}/i)
      if (refMatch) {
        const ref = refMatch[0].toUpperCase().replace(/[_]/g, '-')
        const inv = unpaidInvoices.find(u => u.reference?.toUpperCase().includes(ref.replace(/-/g, '').slice(-5)) || u.reference?.toUpperCase() === ref)
        if (inv) {
          const cli = effectiveClients.find(c => c.id === inv.client_id)
          matchedInvoices = [{ id: inv.id, reference: inv.reference, client_name: cli?.name || '?', total_ttc: parseFloat(inv.total_ttc), amount_due: parseFloat(inv.amount_due) }]
          matchConfidence = Math.abs(parseFloat(inv.amount_due) - amount) < 0.01 ? 'high' : 'medium'
          matchType = 'Référence'
        }
      }

      // Stratégie 2 : montant exact unique
      if (matchedInvoices.length === 0) {
        const amountMatches = unpaidInvoices.filter(u => Math.abs(parseFloat(u.amount_due) - amount) < 0.01)
        if (amountMatches.length === 1) {
          const inv = amountMatches[0]
          const cli = effectiveClients.find(c => c.id === inv.client_id)
          matchedInvoices = [{ id: inv.id, reference: inv.reference, client_name: cli?.name || '?', total_ttc: parseFloat(inv.total_ttc), amount_due: parseFloat(inv.amount_due) }]
          matchConfidence = 'high'
          matchType = 'Montant exact'
        } else if (amountMatches.length > 1) {
          // Plusieurs factures au même montant → chercher nom client dans description
          const bestMatch = amountMatches.find(u => {
            const cli = (clients || []).find(c => c.id === u.client_id)
            if (!cli) return false
            const cliWords = norm(cli.name).split(/\s+/).filter(w => w.length > 3)
            return cliWords.some(w => descUp.includes(w))
          })
          if (bestMatch) {
            const cli = (clients || []).find(c => c.id === bestMatch.client_id)
            matchedInvoices = [{ id: bestMatch.id, reference: bestMatch.reference, client_name: cli?.name || '?', total_ttc: parseFloat(bestMatch.total_ttc), amount_due: parseFloat(bestMatch.amount_due) }]
            matchConfidence = 'high'
            matchType = 'Montant + client'
          } else {
            // Ambiguïté
            matchedInvoices = amountMatches.slice(0, 3).map(inv => {
              const cli = effectiveClients.find(c => c.id === inv.client_id)
              return { id: inv.id, reference: inv.reference, client_name: cli?.name || '?', total_ttc: parseFloat(inv.total_ttc), amount_due: parseFloat(inv.amount_due) }
            })
            matchConfidence = 'ambiguous'
            matchType = `${amountMatches.length} factures au même montant`
          }
        }
      }

      // Stratégie 3 : nom client dans le libellé → ses factures impayées
      if (matchedInvoices.length === 0) {
        for (const cli of (clients || [])) {
          const cliWords = norm(cli.name).split(/\s+/).filter(w => w.length > 3)
          const descWords = descUp.split(/\s+/).filter(w => w.length > 3)
          const clientMatch = cliWords.some(w => descUp.includes(w)) || descWords.some(w => norm(cli.name).includes(w))
          if (clientMatch) {
            const cliInvoices = unpaidInvoices.filter(u => u.client_id === cli.id)
            if (cliInvoices.length > 0) {
              // Chercher combinaison qui atteint le montant exact
              const exactSingle = cliInvoices.find(u => Math.abs(parseFloat(u.amount_due) - amount) < 0.01)
              if (exactSingle) {
                matchedInvoices = [{ id: exactSingle.id, reference: exactSingle.reference, client_name: cli.name, total_ttc: parseFloat(exactSingle.total_ttc), amount_due: parseFloat(exactSingle.amount_due) }]
                matchConfidence = 'high'
                matchType = 'Client + montant'
              } else {
                // Toutes les factures du client comme candidats
                matchedInvoices = cliInvoices.slice(0, 5).map(inv => ({
                  id: inv.id, reference: inv.reference, client_name: cli.name, total_ttc: parseFloat(inv.total_ttc), amount_due: parseFloat(inv.amount_due)
                }))
                matchConfidence = 'medium'
                matchType = `Client détecté (${cli.name})`
              }
              break
            }
          }
        }
      }

      // Réserver les factures d'un rapprochement sûr pour les lignes suivantes
      if (matchConfidence === 'high') matchedInvoices.forEach(m => consumed.add(m.id))

      return { ...tx, matchedInvoices, matchConfidence, matchType }
    })
  }

  // Sélection d'une facture parmi les candidats ambigus
  function pickInvoice(rowIdx, invoiceId) {
    setPre(prev => prev.map((tx, i) => {
      if (i !== rowIdx) return tx
      const picked = tx.matchedInvoices.find(m => m.id === invoiceId)
      if (!picked) return tx
      return { ...tx, matchedInvoices: [picked], matchConfidence: 'high', matchType: 'Sélection manuelle' }
    }))
    setSearchOpenRow(null)
  }

  // Ouvrir/fermer le panneau de recherche inline
  function toggleSearchPanel(idx) {
    if (searchOpenRow === idx) { setSearchOpenRow(null); setSearchQuery('') }
    else { setSearchOpenRow(idx); setSearchQuery('') }
  }

  // Scoring intelligent des factures pour une ligne crédit
  function scoreInvoicesForRow(tx, query) {
    const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
    const descUp = norm(tx.description)
    const descWords = descUp.split(/\s+/).filter(w => w.length > 3)
    const amount = tx.credit
    const qUp = norm(query)

    return unpaidInvoices.map(inv => {
      const cli = (clients || []).find(c => c.id === inv.client_id)
      const cliName = cli?.name || ''
      const cliNorm = norm(cliName)
      const cliWords = cliNorm.split(/\s+/).filter(w => w.length > 3)
      const due = parseFloat(inv.amount_due)
      const ref = inv.reference || ''
      let score = 0
      const reasons = []

      // Montant exact
      if (Math.abs(due - amount) < 0.01) { score += 100; reasons.push('Montant exact') }
      // Montant proche (< 10%)
      else if (amount > 0 && Math.abs(due - amount) / amount < 0.10) { score += 50; reasons.push('Montant ~' + Math.round(Math.abs(due - amount) / amount * 100) + '%') }
      // Montant proche (< 30%)
      else if (amount > 0 && Math.abs(due - amount) / amount < 0.30) { score += 20; reasons.push('Montant ~' + Math.round(Math.abs(due - amount) / amount * 100) + '%') }

      // Mots du libellé bancaire dans le nom client
      for (const w of descWords) { if (cliNorm.includes(w)) { score += 80; reasons.push('Libellé → client'); break } }
      // Mots du nom client dans le libellé bancaire
      for (const w of cliWords) { if (descUp.includes(w)) { score += 80; reasons.push('Client → libellé'); break } }

      // Référence facture dans le libellé
      if (ref && descUp.includes(norm(ref).slice(-5))) { score += 90; reasons.push('Ref facture') }

      // Même mois
      if (inv.invoice_date && tx.date) {
        const invMonth = inv.invoice_date.substring(0, 7)
        const txMonth = tx.date.substring(0, 7)
        if (invMonth === txMonth) { score += 10; reasons.push('Même mois') }
      }

      // Filtre par query de recherche
      if (qUp) {
        const matchQuery = norm(ref).includes(qUp) || cliNorm.includes(qUp) || norm(inv.object).includes(qUp)
        if (!matchQuery) return null // Exclure si pas dans la recherche
        score += 50
      }

      return {
        id: inv.id, reference: ref, client_name: cliName, client_id: inv.client_id,
        total_ttc: parseFloat(inv.total_ttc), amount_due: due,
        invoice_date: inv.invoice_date, object: inv.object,
        score, reasons: [...new Set(reasons)]
      }
    }).filter(Boolean).sort((a, b) => b.score - a.score)
  }

  // Multi-sélection de factures pour un row
  function toggleInvoiceForRow(rowIdx, inv) {
    setPre(prev => prev.map((tx, i) => {
      if (i !== rowIdx) return tx
      const current = tx.matchedInvoices || []
      const exists = current.find(m => m.id === inv.id)
      let updated
      if (exists) {
        updated = current.filter(m => m.id !== inv.id)
      } else {
        updated = [...current, { id: inv.id, reference: inv.reference, client_name: inv.client_name, total_ttc: inv.total_ttc, amount_due: inv.amount_due }]
      }
      const totalMatched = updated.reduce((s, m) => s + m.amount_due, 0)
      const confidence = updated.length > 0 ? (Math.abs(totalMatched - tx.credit) < 0.01 ? 'high' : 'medium') : 'none'
      return { ...tx, matchedInvoices: updated, matchConfidence: confidence, matchType: updated.length > 0 ? 'Sélection manuelle' : '' }
    }))
  }

  // ══ Process complet : parse → dedup → match ══
  function processCSV(text) {
    const parsed = autoMatchInvoices(checkDuplicates(parse(text)))
    setPre(parsed)
    const newSet = new Set()
    parsed.forEach((tx, i) => { if (!tx.isDuplicate) newSet.add(i) })
    setSelectedRows(newSet)
    const newCount = parsed.filter(t => !t.isDuplicate).length
    const dupCount = parsed.filter(t => t.isDuplicate).length
    const matchedCount = parsed.filter(t => t.matchConfidence === 'high').length
    if (parsed.length > 0) toast.success(`${parsed.length} lignes - ${newCount} nouvelles, ${matchedCount} rapprochements`)
    else toast.error('Aucune transaction détectée')
    return parsed
  }

  async function doImport() {
    const toImport = pre.filter((_, i) => selectedRows.has(i))
    if (!toImport.length) { toast.error('Aucune ligne sélectionnée'); return }
    setImp(true)
    let imported = 0, reconciled = 0, absorbed = 0, errors = []
    try {
      for (const tx of toImport) {
        const cat = categories.find(c => c.name === tx.category_name)
        const hasMatch = tx.credit > 0 && tx.matchConfidence === 'high' && tx.matchedInvoices?.length > 0
        const isAbsorb = tx.hasManualMatch && tx.absorbManual && tx.manualMatch?.id

        // 1. Créer la transaction budget
        const txRow = {
          date: tx.date, description: tx.description, debit: tx.debit, credit: tx.credit,
          category_id: cat?.id || null, category_name: tx.category_name,
          month: tx.month, year: tx.year, source_file: 'import_csv_banque',
          payer: 'entreprise', is_manual: false, is_personal: false,
          linked_invoice_id: hasMatch ? tx.matchedInvoices[0].id : null,
          linked_transaction_id: isAbsorb ? tx.manualMatch.id : null,
          reconciled_at: (hasMatch || isAbsorb) ? new Date().toISOString() : null,
          sent_to_comptable: isAbsorb ? true : false,
        }
        const { data: insertedTx, error: txErr } = await supabase.from('budget_transactions').insert(txRow).select('id').single()
        if (txErr) { errors.push(`TX ${tx.description}: ${txErr.message}`); continue }
        imported++

        // 2. Si absorption : marquer la saisie manuelle comme rapprochée
        if (isAbsorb) {
          const { error: reconcileErr } = await supabase.from('budget_transactions')
            .update({ reconciled_at: new Date().toISOString() })
            .eq('id', tx.manualMatch.id)
          if (reconcileErr) errors.push(`Rapprochement saisie: ${reconcileErr.message}`)
          else absorbed++
        }

        // 3. Si match haute confiance facture → rapprocher les factures
        if (hasMatch) {
          let remaining = tx.credit
          for (const inv of tx.matchedInvoices) {
            if (remaining <= 0) break
            const payAmount = Math.min(remaining, inv.amount_due)
            remaining -= payAmount

            // Créer le paiement
            const { error: payErr } = await supabase.from('invoice_payments').insert({
              invoice_id: inv.id,
              amount: payAmount,
              payment_date: tx.date,
              payment_method: 'virement bancaire',
              payment_reference: tx.description.substring(0, 100),
              notes: `Import CSV - ${tx.description.substring(0, 80)} [tx:${insertedTx.id}]`,
              created_by: `Import CSV ${bankName(organization)}`,
            })
            if (payErr) { errors.push(`Paiement ${inv.reference}: ${payErr.message}`); continue }

            // Mettre à jour la facture (payé = somme des paiements, avoirs déduits)
            await recomputeInvoiceFromPayments(inv.id)

            reconciled++
          }
        }
      }

      const msg = [` ${imported} transactions importées`]
      if (absorbed > 0) msg.push(` ${absorbed} saisie(s) rapprochée(s)`)
      if (reconciled > 0) msg.push(` ${reconciled} facture(s) rapprochée(s)`)
      if (errors.length > 0) msg.push(` ${errors.length} erreur(s)`)
      toast.success(msg.join(' - '))
      if (errors.length > 0) console.warn('Import errors:', errors)
      setCsv(''); setPre([]); setSelectedRows(new Set()); loadAll()
    } catch (e) { toast.error('Erreur: ' + (e.message || '')) }
    setImp(false)
  }

  // ══ Parser texte brut du relevé bancaire ══
  // Format: "20/02\n20/02\nVIR SOFIS 684,42  VIR SOFIS FACT-20251120-00047..."
  function parseRawText(text) {
    if (!text.trim()) return null
    const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) return null

    // Ligne 1 et 2 = dates (date opération / date valeur)
    let dateOp = '', dateVal = ''
    const today = new Date()
    const currentYear = today.getFullYear()

    for (let i = 0; i < Math.min(2, lines.length); i++) {
      const dm = lines[i].match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/)
      if (dm) {
        const day = dm[1].padStart(2, '0')
        const month = dm[2].padStart(2, '0')
        const year = dm[3] ? (dm[3].length === 2 ? '20' + dm[3] : dm[3]) : String(currentYear)
        const dateStr = `${year}-${month}-${day}`
        if (!dateOp) dateOp = dateStr
        else dateVal = dateStr
      }
    }

    if (!dateOp) return null

    // Reste = description + montant
    const descLines = lines.slice(dateOp && dateVal ? 2 : 1)
    let fullDesc = descLines.join(' ').replace(/\s+/g, ' ').trim()

    // Extraire le montant (cherche un nombre avec virgule ou point, en fin ou au milieu)
    let amount = 0
    // Pattern: nombre avec séparateur milliers (point) et décimales (virgule) ou simple
    const amountMatch = fullDesc.match(/(\d[\d\s.]*,\d{2})/)
    if (amountMatch) {
      amount = parseFloat(amountMatch[1].replace(/\s/g, '').replace('.', '').replace(',', '.'))
    }

    // Auto-catégoriser
    let catName = 'Autre / Non classé'
    const descUp = fullDesc.toUpperCase()
    for (const r of rules) {
      if (r.direction === 'debit' && rawDirection === 'credit') continue
      if (r.direction === 'credit' && rawDirection === 'debit') continue
      if (descUp.includes(r.keyword?.toUpperCase())) {
        catName = r.budget_categories?.name || catName
        break
      }
    }

    // Extraire le nom du client (pour matching factures)
    let detectedClient = null
    if (rawDirection === 'credit') {
      // Stratégie 1 : mots du nom client dans le libellé bancaire
      for (const cli of (clients || [])) {
        const cliUp = cli.name.toUpperCase()
        const words = cliUp.split(/[\s\-_]+/).filter(w => w.length > 3)
        for (const w of words) {
          if (descUp.includes(w)) { detectedClient = cli; break }
        }
        if (detectedClient) break
      }

      // Stratégie 2 : mots du libellé bancaire dans le nom client (ex: OPCO → OPERATEUR DE COMPETENCES)
      if (!detectedClient) {
        const descWords = descUp.replace(/VIR|CHQ|PRLV|REM|\d+[,\.]\d+/g, '').split(/[\s\-_]+/).filter(w => w.length > 3)
        for (const cli of (clients || [])) {
          const cliUp = cli.name.toUpperCase()
          for (const w of descWords) {
            if (cliUp.includes(w)) { detectedClient = cli; break }
          }
          if (detectedClient) break
        }
      }

      // Stratégie 3 : chercher dans les références factures (client_reference, reference)
      if (!detectedClient) {
        const invs = (invoices || [])
        for (const inv of invs) {
          const ref = (inv.reference || '').toUpperCase()
          const cliRef = (inv.client_reference || '').toUpperCase()
          const obj = (inv.object || '').toUpperCase()
          if ((ref && descUp.includes(ref)) || (cliRef && cliRef.length > 2 && descUp.includes(cliRef))) {
            detectedClient = (clients || []).find(c => c.id === inv.client_id)
            break
          }
        }
      }
    }

    const dp = dateOp.split('-')
    return {
      date: dateOp,
      description: fullDesc,
      amount,
      direction: rawDirection,
      debit: rawDirection === 'debit' ? amount : 0,
      credit: rawDirection === 'credit' ? amount : 0,
      category_name: catName,
      month: `${dp[1]}/${dp[0]}`,
      year: parseInt(dp[0]),
      detectedClient,
    }
  }

  function handleParseRaw() {
    const result = parseRawText(rawText)
    if (!result) { toast.error(`Format non reconnu. Collez date + libellé du relevé ${bankName(organization)}`); return }
    setRawParsed(result)

    // Si c'est un crédit → lancer le matching
    if (result.direction === 'credit' && result.amount > 0) {
      startInvoiceMatching(result)
    }
    toast.success(`Détecté: ${result.amount > 0 ? fmt(result.amount) : 'Montant non détecté'} - ${result.direction === 'credit' ? 'Entrée' : 'Sortie'}`)
  }

  // ══ Matching factures ══
  function startInvoiceMatching(txData) {
    setMatchTx(txData)
    setMatchSelected(new Set())
    setMatchAllocations({})

    let candidates = []
    let foundClient = txData.detectedClient

    if (foundClient) {
      // Factures de ce client
      candidates = unpaidInvoices.filter(inv => inv.client_id === foundClient.id)
    }

    if (candidates.length > 0) {
      setMatchClient(foundClient)
      setMatchCandidates(candidates)

      // Auto-sélectionner si montant exact
      const exactMatch = candidates.filter(inv => Math.abs(parseFloat(inv.amount_due) - txData.amount) < 0.01)
      if (exactMatch.length === 1) {
        const inv = exactMatch[0]
        setMatchSelected(new Set([inv.id]))
        setMatchAllocations({ [inv.id]: parseFloat(inv.amount_due) })
      } else {
        // Essayer une combinaison de factures
        autoMatchCombination(candidates, txData.amount)
      }
      setMatchStep('select_invoices')
    } else {
      // Client non trouvé → demander
      setMatchClient(null)
      setMatchCandidates([])
      setMatchStep('select_client')
    }
    setShowMatchModal(true)
  }

  function autoMatchCombination(candidates, targetAmount) {
    // Essayer de trouver une combinaison exacte (simple: 1, 2 ou 3 factures)
    const sorted = [...candidates].sort((a, b) => parseFloat(b.amount_due) - parseFloat(a.amount_due))

    // 1 facture exacte
    for (const inv of sorted) {
      if (Math.abs(parseFloat(inv.amount_due) - targetAmount) < 0.01) {
        setMatchSelected(new Set([inv.id]))
        setMatchAllocations({ [inv.id]: parseFloat(inv.amount_due) })
        return
      }
    }

    // 2 factures
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const sum = parseFloat(sorted[i].amount_due) + parseFloat(sorted[j].amount_due)
        if (Math.abs(sum - targetAmount) < 0.01) {
          const sel = new Set([sorted[i].id, sorted[j].id])
          const alloc = { [sorted[i].id]: parseFloat(sorted[i].amount_due), [sorted[j].id]: parseFloat(sorted[j].amount_due) }
          setMatchSelected(sel)
          setMatchAllocations(alloc)
          return
        }
      }
    }

    // 3 factures
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        for (let k = j + 1; k < sorted.length; k++) {
          const sum = parseFloat(sorted[i].amount_due) + parseFloat(sorted[j].amount_due) + parseFloat(sorted[k].amount_due)
          if (Math.abs(sum - targetAmount) < 0.01) {
            const sel = new Set([sorted[i].id, sorted[j].id, sorted[k].id])
            const alloc = { [sorted[i].id]: parseFloat(sorted[i].amount_due), [sorted[j].id]: parseFloat(sorted[j].amount_due), [sorted[k].id]: parseFloat(sorted[k].amount_due) }
            setMatchSelected(sel)
            setMatchAllocations(alloc)
            return
          }
        }
      }
    }
  }

  function handleSelectClient(clientId) {
    const cli = (clients || []).find(c => c.id === clientId)
    if (!cli) return
    setMatchClient(cli)
    const candidates = unpaidInvoices.filter(inv => inv.client_id === clientId)
    setMatchCandidates(candidates)
    if (matchTx) autoMatchCombination(candidates, matchTx.amount)
    setMatchStep('select_invoices')
  }

  function toggleInvoice(invId) {
    const next = new Set(matchSelected)
    if (next.has(invId)) {
      next.delete(invId)
      const alloc = { ...matchAllocations }
      delete alloc[invId]
      setMatchAllocations(alloc)
    } else {
      next.add(invId)
      const inv = matchCandidates.find(i => i.id === invId)
      if (inv) {
        setMatchAllocations(prev => ({ ...prev, [invId]: parseFloat(inv.amount_due) }))
      }
    }
    setMatchSelected(next)
  }

  const matchTotal = useMemo(() =>
    Object.values(matchAllocations).reduce((s, v) => s + (parseFloat(v) || 0), 0),
    [matchAllocations]
  )

  const matchDiff = matchTx ? Math.abs(matchTotal - matchTx.amount) : 0
  const matchExact = matchDiff < 0.01

  // ══ Sauvegarder le rapprochement ══
  async function saveReconciliation() {
    if (!rawParsed || matchSelected.size === 0) return
    setRawSaving(true)

    try {
      const cat = categories.find(c => c.name === rawParsed.category_name)
      const dp = rawParsed.date.split('-')

      // 1. Créer la transaction
      const txRow = {
        date: rawParsed.date,
        description: rawParsed.description,
        debit: rawParsed.debit,
        credit: rawParsed.credit,
        category_id: cat?.id || null,
        category_name: rawParsed.category_name,
        month: `${dp[1]}/${dp[0]}`,
        year: parseInt(dp[0]),
        source_file: 'import_rapide_banque',
        is_manual: false,
        is_personal: false,
        payer: 'entreprise',
        reconciled_at: new Date().toISOString(),
        linked_invoice_id: matchSelected.size === 1 ? [...matchSelected][0] : null,
      }

      const { data: txData, error: txErr } = await supabase.from('budget_transactions').insert(txRow).select().single()
      if (txErr) throw txErr

      // 2. Créer les liens dans budget_transaction_invoices
      const links = [...matchSelected].map(invId => ({
        transaction_id: txData.id,
        invoice_id: invId,
        amount_applied: matchAllocations[invId] || 0,
        reconciled_by: currentUserName() || '',
      }))
      const { error: linkErr } = await supabase.from('budget_transaction_invoices').insert(links)
      if (linkErr) throw linkErr

      // 3. Mettre à jour chaque facture (amount_paid, status)
      for (const invId of matchSelected) {
        const inv = unpaidInvoices.find(i => i.id === invId)
        if (!inv) continue
        const applied = matchAllocations[invId] || 0

        // Enregistrer le paiement puis recalculer la facture (avoirs déduits)
        const { error: payErr } = await supabase.from('invoice_payments').insert({
          invoice_id: invId,
          amount: applied,
          payment_date: rawParsed.date,
          payment_method: 'virement bancaire',
          payment_reference: rawParsed.description.substring(0, 100),
          notes: `Rapprochement bancaire du ${new Date().toLocaleDateString('fr-FR')} [tx:${txData.id}]`,
          created_by: currentUserName() || '',
        })
        if (payErr) throw payErr
        await recomputeInvoiceFromPayments(invId)
      }

      toast.success(`Transaction importée + ${matchSelected.size} facture(s) marquée(s) payée(s)`)
      setShowMatchModal(false)
      setRawText('')
      setRawParsed(null)
      setMatchTx(null)
      loadAll()
    } catch (err) {
      toast.error('Erreur: ' + err.message)
    }
    setRawSaving(false)
  }

  // ══ Sauvegarder sans matching (débit ou crédit sans facture) ══
  async function saveWithoutMatch() {
    if (!rawParsed) return
    setRawSaving(true)
    try {
      const cat = categories.find(c => c.name === rawParsed.category_name)
      const dp = rawParsed.date.split('-')
      const txRow = {
        date: rawParsed.date,
        description: rawParsed.description,
        debit: rawParsed.debit,
        credit: rawParsed.credit,
        category_id: cat?.id || null,
        category_name: rawParsed.category_name,
        month: `${dp[1]}/${dp[0]}`,
        year: parseInt(dp[0]),
        source_file: 'import_rapide_banque',
        is_manual: false,
        is_personal: false,
        payer: 'entreprise',
      }
      const { error } = await supabase.from('budget_transactions').insert(txRow)
      if (error) throw error
      toast.success(`Transaction importée`)
      setRawText(''); setRawParsed(null)
      loadAll()
    } catch (err) { toast.error('Erreur: ' + err.message) }
    setRawSaving(false)
  }

  return (
    <div className="space-y-4">
      {/* ══ IMPORT RAPIDE - Texte brut du relevé bancaire ══ */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <h3 className="font-bold text-gray-700 mb-2"> Import rapide - Copier/coller {bankName(organization)}</h3>
        <p className="text-xs text-gray-500 mb-3">Collez le texte brut copié depuis votre relevé {bankName(organization)} (date + libellé). Ex: "20/02\n20/02\nVIR SOFIS 684,42..."</p>

        <div className="flex gap-2 mb-2">
          <button onClick={() => setRawDirection('credit')} className={`flex-1 py-2 rounded-lg text-sm font-medium ${rawDirection === 'credit' ? 'bg-green-500 text-white' : 'bg-gray-100'}`}> Entrée (encaissement)</button>
          <button onClick={() => setRawDirection('debit')} className={`flex-1 py-2 rounded-lg text-sm font-medium ${rawDirection === 'debit' ? 'bg-red-500 text-white' : 'bg-gray-100'}`}> Sortie (paiement)</button>
        </div>

        <textarea value={rawText} onChange={e => setRawText(e.target.value)}
          placeholder={"20/02\n20/02\nVIR SOFIS 684,42  VIR SOFIS FACT-20251120-00047..."}
          className="w-full h-28 border rounded-lg p-3 text-xs font-mono resize-y" />

        <div className="flex gap-2 mt-2">
          <button onClick={handleParseRaw} disabled={!rawText.trim()} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 flex-1">
             Analyser
          </button>
          {rawParsed && rawDirection === 'debit' && (
            <button onClick={saveWithoutMatch} disabled={rawSaving} className="bg-gray-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
              {rawSaving ? '...' : ' Importer (sortie)'}
            </button>
          )}
          {rawParsed && rawDirection === 'credit' && !showMatchModal && (
            <button onClick={() => startInvoiceMatching(rawParsed)} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm">
               Rapprocher factures
            </button>
          )}
          {rawParsed && rawDirection === 'credit' && (
            <button onClick={saveWithoutMatch} disabled={rawSaving} className="bg-gray-400 text-white px-3 py-2 rounded-lg text-xs disabled:opacity-50" title="Importer sans lier à une facture">
              Sans facture
            </button>
          )}
        </div>

        {/* Résultat du parsing */}
        {rawParsed && (
          <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between items-center">
              <span className="font-medium text-blue-800"> Résultat :</span>
              {rawParsed.detectedClient && (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Client détecté : {rawParsed.detectedClient.name}</span>
              )}
            </div>
            <div className="text-xs">Date : <b>{rawParsed.date}</b></div>
            <div className="text-xs">Description : <b className="break-all">{rawParsed.description}</b></div>
            <div className="text-xs">Montant : <b className={rawDirection === 'credit' ? 'text-green-700' : 'text-red-700'}>{fmt(rawParsed.amount)}</b></div>
            <div className="text-xs">Catégorie : <b>{rawParsed.category_name}</b></div>
          </div>
        )}
      </div>

      {/* ══ MODAL MATCHING FACTURES ══ */}
      {showMatchModal && matchTx && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b bg-green-50 rounded-t-xl">
              <div>
                <h3 className="font-bold text-green-800"> Rapprochement bancaire</h3>
                <p className="text-xs text-green-600 mt-0.5">Montant reçu : <b>{fmt(matchTx.amount)}</b></p>
              </div>
              <button onClick={() => setShowMatchModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">Fermer</button>
            </div>

            <div className="overflow-y-auto flex-1 p-4 space-y-4">
              {/* Étape : sélection client */}
              {matchStep === 'select_client' && (
                <ClientSearchForMatch
                  clients={clients || []}
                  invoices={invoices || []}
                  unpaidInvoices={unpaidInvoices}
                  bankDescription={matchTx?.description || ''}
                  onSelect={handleSelectClient}
                />
              )}

              {/* Étape : sélection factures */}
              {matchStep === 'select_invoices' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-sm font-medium text-gray-700">Factures de </span>
                      <span className="text-sm font-bold text-blue-700">{matchClient?.name}</span>
                    </div>
                    <button onClick={() => setMatchStep('select_client')} className="text-xs text-blue-600 hover:underline">Changer de client</button>
                  </div>

                  {matchCandidates.length === 0 ? (
                    <div className="text-center py-6 text-gray-400">
                      <p className="text-sm">Aucune facture en attente pour ce client</p>
                      <button onClick={() => { setShowMatchModal(false); saveWithoutMatch() }} className="mt-2 text-blue-600 text-sm hover:underline">Importer sans rapprochement</button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {matchCandidates.map(inv => {
                        const isSelected = matchSelected.has(inv.id)
                        const due = parseFloat(inv.amount_due)
                        return (
                          <div key={inv.id}
                            onClick={() => toggleInvoice(inv.id)}
                            className={`p-3 border rounded-lg cursor-pointer transition-all ${isSelected ? 'bg-green-50 border-green-400 ring-1 ring-green-300' : 'hover:bg-gray-50'}`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${isSelected ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300'}`}>
                                  {isSelected && <span className="text-xs"></span>}
                                </div>
                                <div>
                                  <span className="font-medium text-sm">{inv.reference}</span>
                                  <span className="text-xs text-gray-500 ml-2">{inv.object ? inv.object.substring(0, 40) : ''}</span>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="font-bold text-sm">{fmt(due)}</div>
                                <div className="text-xs text-gray-400">TTC: {fmt(inv.total_ttc)}</div>
                              </div>
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('fr-FR') : ''} - 
                              <span className={inv.status === 'overdue' ? 'text-red-600 font-medium' : ''}>{inv.status === 'overdue' ? 'En retard' : inv.status === 'partial' ? 'Paiement partiel' : 'À régler'}</span>
                            </div>

                            {/* Allocation manuelle si sélectionnée */}
                            {isSelected && matchSelected.size > 1 && (
                              <div className="mt-2 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                <label className="text-xs text-gray-500">Montant imputé :</label>
                                <input
                                  type="number" step="0.01"
                                  value={matchAllocations[inv.id] || ''}
                                  onChange={e => setMatchAllocations(prev => ({ ...prev, [inv.id]: parseFloat(e.target.value) || 0 }))}
                                  className="w-28 border rounded px-2 py-1 text-xs text-right"
                                />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Barre de total */}
                  {matchSelected.size > 0 && (
                    <div className={`mt-3 p-3 rounded-lg border-2 ${matchExact ? 'bg-green-50 border-green-400' : 'bg-amber-50 border-amber-400'}`}>
                      <div className="flex justify-between items-center text-sm">
                        <span className="font-medium">Total sélectionné :</span>
                        <span className="font-bold text-lg">{fmt(matchTotal)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm mt-1">
                        <span>Montant du virement :</span>
                        <span className="font-bold">{fmt(matchTx.amount)}</span>
                      </div>
                      {!matchExact && (
                        <div className="mt-2 flex items-center gap-2 text-amber-700">
                          <span className="text-lg"></span>
                          <span className="text-xs font-medium">Écart de {fmt(matchDiff)} - {matchTotal > matchTx.amount ? 'Factures > Virement' : 'Virement > Factures'}</span>
                        </div>
                      )}
                      {matchExact && (
                        <div className="mt-1 text-green-700 text-xs font-medium"> Montants correspondants</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
              <button onClick={() => setShowMatchModal(false)} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-100">
                Annuler
              </button>
              <div className="flex-1" />
              {matchSelected.size > 0 && (
                <button onClick={saveReconciliation} disabled={rawSaving}
                  className={`px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 ${matchExact ? 'bg-green-600 hover:bg-green-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
                  {rawSaving ? '...' : ` Rapprocher ${matchSelected.size} facture(s)${!matchExact ? ' (écart)' : ''}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ IMPORT CSV Crédit Mutuel - Drag & Drop ══ */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <h3 className="font-bold text-gray-700 mb-3"> Import CSV Crédit Mutuel</h3>

        {/* Zone drag & drop */}
        <div
          onDragOver={e => { e.preventDefault(); setCsvDragOver(true) }}
          onDragLeave={() => setCsvDragOver(false)}
          onDrop={handleCsvDrop}
          className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer
            ${csvDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/50'}`}
          onClick={() => document.getElementById('csv-file-input')?.click()}
        >
          <input id="csv-file-input" type="file" accept=".csv,.txt,.CSV" className="hidden"
            onChange={e => { if (e.target.files[0]) handleCsvFile(e.target.files[0]); e.target.value = '' }} />
          <div className="text-3xl mb-2"></div>
          <p className="text-sm font-medium text-gray-700">Glisser-déposer votre fichier CSV ici</p>
          <p className="text-xs text-gray-400 mt-1">ou cliquer pour sélectionner - export CSV de votre banque (Date opération;Date valeur;Libellé;Débit;Crédit)</p>
        </div>

        {/* Ou coller manuellement */}
        <details className="mt-3">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">Ou coller les données CSV manuellement...</summary>
          <textarea value={csv} onChange={e => setCsv(e.target.value)}
            placeholder="Date operation;Date valeur;Libelle;Debit;Credit&#10;20/02/2026;20/02/2026;VIR OPCO 2I;;834,00"
            className="w-full h-32 border rounded-lg p-3 text-xs font-mono resize-y mt-2" />
          <button onClick={handleCsvPaste} disabled={!csv.trim()}
            className="mt-2 bg-gray-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 hover:bg-gray-700">
             Analyser
          </button>
        </details>
      </div>

      {/* Résultats de l'analyse */}
      {pre.length > 0 && (() => {
        const newCount = pre.filter(t => !t.isDuplicate).length
        const dupCount = pre.filter(t => t.isDuplicate).length
        const matchedCount = pre.filter(t => t.matchConfidence === 'high').length
        const ambiguousCount = pre.filter(t => t.matchConfidence === 'ambiguous' || t.matchConfidence === 'medium').length
        const manualMatchCount = pre.filter(t => t.hasManualMatch && !t.isDuplicate).length
        const selectedCount = selectedRows.size
        return (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            {/* Header avec stats */}
            <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-green-50 border-b flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-gray-700"> {pre.length} transactions</span>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{newCount} nouvelles</span>
                {dupCount > 0 && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{dupCount} doublons</span>}
                {manualMatchCount > 0 && <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full"> {manualMatchCount} saisie(s) à rapprocher</span>}
                {matchedCount > 0 && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full"> {matchedCount} rapprochées</span>}
                {ambiguousCount > 0 && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full"> {ambiguousCount} à vérifier</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={selectAllNew} className="text-xs text-blue-600 hover:underline">Sélectionner nouvelles</button>
                <button onClick={selectNone} className="text-xs text-gray-400 hover:underline">Tout désélectionner</button>
              </div>
            </div>

            {/* Table */}
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left w-8"></th>
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-left">Description</th>
                    <th className="px-2 py-1.5 text-left">Catégorie</th>
                    <th className="px-2 py-1.5 text-right">Débit</th>
                    <th className="px-2 py-1.5 text-right">Crédit</th>
                    <th className="px-2 py-1.5 text-center">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {pre.map((tx, i) => (
                    <React.Fragment key={i}>
                      <tr onClick={() => toggleRow(i)}
                        className={`border-t cursor-pointer transition-colors
                          ${tx.isDuplicate ? 'bg-amber-50/50 opacity-60' : tx.hasManualMatch ? 'bg-violet-50/40' : selectedRows.has(i) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                        <td className="px-2 py-1">
                          <input type="checkbox" checked={selectedRows.has(i)} onChange={() => toggleRow(i)}
                            className="rounded text-blue-600" />
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">{tx.date}</td>
                        <td className="px-2 py-1 truncate max-w-xs" title={tx.description}>{tx.description}</td>
                        <td className="px-2 py-1" onClick={e => e.stopPropagation()}>
                          <select value={tx.category_name} onChange={e => changePreCategory(i, e.target.value)}
                            className={`text-xs rounded px-1 py-0.5 border-0 cursor-pointer ${tx.category_name === 'Autre / Non classé' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'}`}>
                            {categories.map(cat => <option key={cat.id} value={cat.name}>{cat.icon} {cat.name}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-right text-red-600 font-mono">{tx.debit > 0 ? tx.debit.toFixed(2) : ''}</td>
                        <td className="px-2 py-1 text-right text-green-600 font-mono">{tx.credit > 0 ? tx.credit.toFixed(2) : ''}</td>
                        <td className="px-2 py-1 text-center" onClick={e => e.stopPropagation()}>
                          {tx.isDuplicate
                            ? <span className="text-xs bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded">doublon</span>
                            : tx.hasManualMatch
                              ? <button onClick={() => toggleAbsorb(i)}
                                  className={`text-xs px-1.5 py-0.5 rounded font-medium transition-colors ${tx.absorbManual ? 'bg-violet-200 text-violet-800 hover:bg-violet-300' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                                  title={tx.absorbManual ? 'Cliquer pour importer séparément' : 'Cliquer pour absorber la saisie'}>
                                  {tx.absorbManual ? ' absorber' : '↔ séparer'}
                                </button>
                              : tx.matchConfidence === 'high'
                                ? <button onClick={() => toggleSearchPanel(i)} className="text-xs bg-blue-200 text-blue-800 px-1.5 py-0.5 rounded hover:bg-blue-300"> rapprochée</button>
                                : tx.matchConfidence === 'medium' || tx.matchConfidence === 'ambiguous'
                                  ? <button onClick={() => toggleSearchPanel(i)} className="text-xs bg-purple-200 text-purple-800 px-1.5 py-0.5 rounded hover:bg-purple-300"> à vérifier</button>
                                  : tx.credit > 0
                                    ? <button onClick={() => toggleSearchPanel(i)} className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-300 cursor-pointer"> matcher</button>
                                    : <span className="text-xs bg-green-200 text-green-800 px-1.5 py-0.5 rounded">nouvelle</span>
                          }
                        </td>
                      </tr>

                      {/* Sous-ligne : saisie manuelle détectée */}
                      {tx.hasManualMatch && !tx.isDuplicate && tx.manualMatch && (
                        <tr className="bg-violet-50/60 border-t border-violet-100">
                          <td></td>
                          <td colSpan="6" className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-2 flex-wrap text-xs">
                              <span className="text-violet-500 font-medium"> Saisie manuelle existante :</span>
                              <span className="text-violet-700 font-medium">{tx.manualMatch.date ? new Date(tx.manualMatch.date).toLocaleDateString('fr-FR') : tx.manualMatch.date}</span>
                              <span className="text-violet-700 truncate max-w-xs" title={tx.manualMatch.description}>{tx.manualMatch.description}</span>
                              <span className="bg-violet-100 text-violet-700 px-2 py-0.5 rounded">{tx.manualMatch.category_name}</span>
                              {tx.manualMatch.description !== tx.description && (
                                <span className="text-gray-400 italic">descriptions différentes</span>
                              )}
                              {tx.absorbManual
                                ? <span className="text-violet-600 font-medium">→ La saisie sera conservée, la ligne banque liée en arrière-plan</span>
                                : <span className="text-gray-500">→ Deux lignes séparées seront créées</span>
                              }
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Ligne de détail match pour les crédits - résumé compact */}
                      {tx.credit > 0 && !tx.isDuplicate && tx.matchedInvoices?.length > 0 && searchOpenRow !== i && (
                        <tr className="bg-blue-50/30">
                          <td></td>
                          <td colSpan="6" className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-gray-500">
                                {tx.matchConfidence === 'high' ? '' : ''} {tx.matchType} →
                              </span>
                              {tx.matchedInvoices.map(inv => (
                                <span key={inv.id} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium">
                                  {inv.reference} - {inv.client_name} - {fmt(inv.amount_due)}
                                </span>
                              ))}
                              {(() => {
                                const totalM = tx.matchedInvoices.reduce((s, m) => s + m.amount_due, 0)
                                return Math.abs(totalM - tx.credit) < 0.01
                                  ? <span className="text-xs text-green-600"> exact</span>
                                  : <span className="text-xs text-amber-600"> écart {fmt(Math.abs(totalM - tx.credit))}</span>
                              })()}
                              <button onClick={() => detachMatch(i)} className="text-xs text-red-400 hover:text-red-600" title="Détacher">Détacher</button>
                              <button onClick={() => toggleSearchPanel(i)} className="text-xs text-blue-500 hover:text-blue-700">Chercher</button>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Panneau de recherche inline pour matcher une facture */}
                      {tx.credit > 0 && !tx.isDuplicate && searchOpenRow === i && (() => {
                        const scored = scoreInvoicesForRow(tx, searchQuery)
                        const selectedInvIds = new Set((tx.matchedInvoices || []).map(m => m.id))
                        const totalSelected = (tx.matchedInvoices || []).reduce((s, m) => s + m.amount_due, 0)
                        const diff = tx.credit - totalSelected
                        return (
                          <tr className="bg-gradient-to-r from-blue-50 to-indigo-50">
                            <td></td>
                            <td colSpan="6" className="p-3" onClick={e => e.stopPropagation()}>
                              <div className="space-y-2">
                                {/* Header du panneau */}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-700"> Rapprocher {fmt(tx.credit)}</span>
                                    {totalSelected > 0 && (
                                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                                        Math.abs(diff) < 0.01 ? 'bg-green-100 text-green-700' :
                                        diff > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                                      }`}>
                                        {Math.abs(diff) < 0.01 ? ' Correspondance exacte' :
                                         diff > 0 ? ` Reste ${fmt(diff)} non couvert` :
                                         ` Dépasse de ${fmt(Math.abs(diff))}`}
                                      </span>
                                    )}
                                  </div>
                                  <button onClick={() => { setSearchOpenRow(null); setSearchQuery('') }}
                                    className="text-gray-400 hover:text-gray-600 text-sm"> Fermer</button>
                                </div>

                                {/* Recherche */}
                                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                                  placeholder=" Filtrer par client, référence, objet..."
                                  className="w-full border rounded-lg px-3 py-1.5 text-xs focus:border-blue-400 focus:ring-1 focus:ring-blue-400" />

                                {/* Liste des factures scorées */}
                                <div className="max-h-48 overflow-y-auto space-y-1">
                                  {scored.length === 0 ? (
                                    <div className="text-center py-3 text-xs text-gray-400">Aucune facture impayée trouvée</div>
                                  ) : scored.slice(0, 15).map(inv => {
                                    const isSelected = selectedInvIds.has(inv.id)
                                    return (
                                      <div key={inv.id} onClick={() => toggleInvoiceForRow(i, inv)}
                                        className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors text-xs
                                          ${isSelected ? 'bg-blue-100 border-blue-400' : inv.score >= 80 ? 'bg-green-50 border-green-200 hover:bg-green-100' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>
                                        <input type="checkbox" checked={isSelected} readOnly className="rounded text-blue-600 pointer-events-none" />
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2">
                                            <span className="font-medium text-gray-800">{inv.reference}</span>
                                            <span className="text-gray-500">-</span>
                                            <span className="text-gray-700 truncate">{inv.client_name}</span>
                                          </div>
                                          {inv.object && <div className="text-gray-400 truncate">{inv.object}</div>}
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                          <div className={`font-bold ${Math.abs(inv.amount_due - tx.credit) < 0.01 ? 'text-green-700' : 'text-gray-700'}`}>
                                            {fmt(inv.amount_due)}
                                          </div>
                                          <div className="text-gray-400">{inv.invoice_date}</div>
                                        </div>
                                        {inv.score >= 50 && (
                                          <div className="flex-shrink-0">
                                            <span className={`text-xs px-1.5 py-0.5 rounded ${inv.score >= 100 ? 'bg-green-200 text-green-800' : inv.score >= 50 ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-600'}`}>
                                              {inv.reasons[0]}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>

                                {/* Barre de total si sélection */}
                                {(tx.matchedInvoices || []).length > 0 && (
                                  <div className={`flex items-center justify-between p-2 rounded-lg border-2 text-xs font-medium ${
                                    Math.abs(diff) < 0.01 ? 'bg-green-50 border-green-400 text-green-700' :
                                    diff > 0 ? 'bg-amber-50 border-amber-400 text-amber-700' : 'bg-red-50 border-red-400 text-red-700'
                                  }`}>
                                    <span>{(tx.matchedInvoices || []).length} facture(s) = {fmt(totalSelected)}</span>
                                    <span>Virement : {fmt(tx.credit)}</span>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })()}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer import */}
            <div className="px-4 py-3 bg-gray-50 border-t">
              {/* Récap rapprochement */}
              {matchedCount > 0 && (
                <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 space-y-1">
                  <div className="font-medium"> Rapprochement automatique :</div>
                  {pre.filter(t => selectedRows.has(pre.indexOf(t)) && t.matchConfidence === 'high' && t.matchedInvoices?.length > 0).map((tx, j) => (
                    <div key={j} className="flex justify-between">
                      <span>{tx.matchedInvoices[0]?.reference} - {tx.matchedInvoices[0]?.client_name}</span>
                      <span className="font-medium">{fmt(tx.credit)} {Math.abs((tx.matchedInvoices[0]?.amount_due || 0) - tx.credit) < 0.01 ? '→ Payée ' : '→ Partiel'}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{selectedCount} ligne(s) sélectionnée(s)</span>
                <div className="flex gap-2">
                  <button onClick={() => { setPre([]); setCsv(''); setSelectedRows(new Set()) }}
                    className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-100">Annuler</button>
                  <button onClick={doImport} disabled={imp || selectedCount === 0}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700">
                    {imp ? ' Import en cours...' : ` Importer ${selectedCount} transaction(s)${matchedCount > 0 ? ` + ${matchedCount} rapprochement(s)` : ''}${pre.filter((t,i) => selectedRows.has(i) && t.hasManualMatch && t.absorbManual).length > 0 ? ` + ${pre.filter((t,i) => selectedRows.has(i) && t.hasManualMatch && t.absorbManual).length} absorption(s)` : ''}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
// ════════════════════════════════════════════════════════════
// CATÉGORISATION IA
// ════════════════════════════════════════════════════════════
function CategorisationIATab({ transactions, categories, rules, loadAll, associates = [], organization }) {
  const [analyzing, setAnalyzing] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [applied, setApplied] = useState(new Set())
  const [ignored, setIgnored] = useState(new Set())

  // Transactions non classées ou potentiellement mal classées
  const candidates = useMemo(() => {
    return transactions.filter(tx => !tx.is_personal).sort((a, b) => (b.debit || 0) - (a.debit || 0))
  }, [transactions])

  async function analyzeAll() {
    setAnalyzing(true)
    setSuggestions([])
    setApplied(new Set())
    setIgnored(new Set())

    // Préparer les données pour l'IA - par lots de 40
    const catList = categories.map(c => c.name).join(', ')
    const rulesList = rules.map(r => `${r.keyword} → ${r.budget_categories?.name || '?'}`).join(', ')
    // Virements au nom des associés : NOM Prénom tel qu'il apparaît sur un libellé bancaire
    const associateLines = associates.map(a => {
      const parts = String(a.name || a.firstName || '').trim().split(/\s+/).filter(Boolean)
      const first = parts.length > 1 ? parts[0] : a.firstName
      const last = parts.length > 1 ? parts.slice(1).join(' ') : ''
      const holder = [last.toUpperCase(), first].filter(Boolean).join(' ')
      return `- Un virement au nom de ${holder} = rémunération ou remboursement d'un associé`
    }).join('\n')
    const allSuggestions = []
    const batchSize = 50
    const batches = []

    for (let i = 0; i < candidates.length; i += batchSize) {
      batches.push(candidates.slice(i, i + batchSize))
    }

    setProgress({ done: 0, total: batches.length })

    for (let b = 0; b < batches.length; b++) {
      // Throttle : 2s entre chaque appel pour éviter 429
      if (b > 0) await new Promise(r => setTimeout(r, 2000))
      const batch = batches[b]
      const txList = batch.map((tx, i) => `${i}|${tx.id}|${tx.description}|${tx.debit > 0 ? 'DEBIT ' + tx.debit : 'CREDIT ' + tx.credit}|${tx.category_name}`).join('\n')

      try {
        const response = await apiFetch('/api/ai-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 4000,
            messages: [{ role: 'user', content: `Tu es un expert-comptable. Analyse ces transactions bancaires de ${orgLabelForAI(organization)}, ${orgActivityForAI(organization)}.

Pour chaque transaction, vérifie si la catégorie actuelle est correcte. Réponds UNIQUEMENT avec un JSON array des transactions MAL CLASSÉES (pas celles qui sont correctes).

Catégories disponibles : ${catList}

Règles existantes : ${rulesList}

Contexte métier important :
${associateLines ? associateLines + '\n' : ''}- ECH PRET = remboursement d'emprunt
- Restaurants = souvent déplacements professionnels
- Tout VIR d'un client ou d'un financeur (OPCO, etc.) = chiffre d'affaires (CA Formations ou CA Sous-traitance)

Format JSON strict (pas de markdown, pas d'icônes dans les noms de catégorie) :
[{"id":"uuid","description":"...","current":"catégorie actuelle","suggested":"catégorie suggérée","confidence":0.95,"reason":"explication courte","keyword":"MOT_CLE pour future règle"}]

Si toutes les transactions sont bien classées, réponds : []

Transactions :
${txList}` }]
          })
        })

        const data = await response.json()
        const text = data.content?.[0]?.text || '[]'
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
        if (Array.isArray(parsed)) {
          allSuggestions.push(...parsed)
        }
      } catch (e) {
        console.error('Erreur batch', b, e)
      }
      setProgress({ done: b + 1, total: batches.length })
    }

    setSuggestions(allSuggestions)
    setAnalyzing(false)
  }

  async function applySuggestion(s) {
    // Matching flexible : exact d'abord, puis includes, puis strip icônes/espaces
    const suggested = (s.suggested || '').trim()
    const cat = categories.find(c => c.name === suggested)
      || categories.find(c => suggested.includes(c.name))
      || categories.find(c => c.name.includes(suggested))
      || categories.find(c => suggested.replace(/^[\p{Emoji}\p{Emoji_Presentation}\s]+/u, '').trim() === c.name)
    if (!cat) { toast.error('Catégorie non trouvée: ' + suggested); return }

    // Update transaction
    await supabase.from('budget_transactions').update({ category_id: cat.id, category_name: cat.name }).eq('id', s.id)

    // Auto-create rule if keyword provided
    if (s.keyword && s.keyword.length > 2) {
      const existingRule = rules.find(r => r.keyword?.toUpperCase() === s.keyword.toUpperCase())
      if (!existingRule) {
        await supabase.from('budget_rules').insert({
          keyword: s.keyword.toUpperCase(),
          category_id: cat.id,
          direction: s.current_was_debit ? 'debit' : 'both'
        }).then(() => {})
      }
    }

    setApplied(prev => new Set([...prev, s.id]))
    toast.success(`${s.description?.substring(0, 30)} → ${cat.icon} ${cat.name}`)
  }

  async function applyAll() {
    const pending = suggestions.filter(s => !applied.has(s.id) && !ignored.has(s.id))
    for (const s of pending) {
      await applySuggestion(s)
    }
    loadAll()
    toast.success(`${pending.length} corrections appliquées`)
  }

  const pending = suggestions.filter(s => !applied.has(s.id) && !ignored.has(s.id))
  const highConf = pending.filter(s => s.confidence >= 0.8)

  return (
    <div className="space-y-4">
      {/* Header + Launch */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold text-gray-700"> Catégorisation intelligente</h3>
            <p className="text-xs text-gray-500 mt-1">L'IA analyse {candidates.length} transactions et propose des corrections de catégorie</p>
          </div>
          <button onClick={analyzeAll} disabled={analyzing}
            className="bg-purple-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
            {analyzing ? ` Analyse... ${progress.done}/${progress.total}` : ' Lancer l\'analyse'}
          </button>
        </div>

        {analyzing && (
          <div className="mt-3">
            <div className="bg-gray-200 rounded-full h-2">
              <div className="bg-purple-500 rounded-full h-2 transition-all" style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <p className="text-xs text-gray-500 mt-1">Lot {progress.done}/{progress.total} - {candidates.length} transactions analysées</p>
          </div>
        )}
      </div>

      {/* Résultats */}
      {suggestions.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-bold text-gray-700"> {suggestions.length} correction(s) suggérée(s)</h3>
              <p className="text-xs text-gray-500">{applied.size} appliquées • {ignored.size} ignorées • {pending.length} en attente</p>
            </div>
            {highConf.length > 0 && (
              <button onClick={applyAll} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
                 Tout valider ({pending.length})
              </button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-gray-500">Description</th>
                  <th className="text-left px-3 py-2 text-gray-500">Montant</th>
                  <th className="text-left px-3 py-2 text-gray-500">Actuelle</th>
                  <th className="text-left px-3 py-2 text-gray-500">→ Suggestion IA</th>
                  <th className="text-center px-2 py-2 text-gray-500">Confiance</th>
                  <th className="text-left px-3 py-2 text-gray-500">Raison</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s, i) => {
                  const done = applied.has(s.id)
                  const skip = ignored.has(s.id)
                  const tx = transactions.find(t => t.id === s.id)
                  return (
                    <tr key={i} className={`border-t ${done ? 'bg-green-50 opacity-60' : skip ? 'bg-gray-50 opacity-40' : 'hover:bg-blue-50/30'}`}>
                      <td className="px-3 py-1.5 max-w-48"><div className="truncate" title={s.description}>{s.description}</div></td>
                      <td className="px-3 py-1.5 font-mono whitespace-nowrap">{tx?.debit > 0 ? <span className="text-red-600">{fmt(tx.debit)}</span> : <span className="text-green-600">{fmt(tx?.credit)}</span>}</td>
                      <td className="px-3 py-1.5"><span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-xs">{s.current}</span></td>
                      <td className="px-3 py-1.5"><span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded text-xs font-medium">{s.suggested}</span></td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${s.confidence >= 0.9 ? 'bg-green-200 text-green-800' : s.confidence >= 0.7 ? 'bg-amber-200 text-amber-800' : 'bg-red-200 text-red-800'}`}>
                          {Math.round(s.confidence * 100)}%
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-gray-600 max-w-48"><div className="truncate" title={s.reason}>{s.reason}</div></td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {!done && !skip && (
                          <>
                            <button onClick={() => applySuggestion(s)} className="text-green-600 hover:text-green-800 text-sm mr-1" title="Valider">Valider</button>
                            <button onClick={() => setIgnored(prev => new Set([...prev, s.id]))} className="text-gray-400 hover:text-gray-600 text-sm" title="Ignorer">Ignorer</button>
                          </>
                        )}
                        {done && <span className="text-green-500"></span>}
                        {skip && <span className="text-gray-400">-</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {applied.size > 0 && (
            <div className="mt-3 flex justify-end">
              <button onClick={loadAll} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
                 Rafraîchir les données
              </button>
            </div>
          )}
        </div>
      )}

      {suggestions.length === 0 && !analyzing && (
        <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-400">
          <div className="text-4xl mb-3"></div>
          <p>Cliquez "Lancer l'analyse" pour que l'IA vérifie toutes vos catégorisations</p>
          <p className="text-xs mt-2">L'IA détecte les erreurs de classement et propose des corrections avec auto-création de règles</p>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// PRÉVISIONNEL & OBJECTIF 50K€
// ════════════════════════════════════════════════════════════

function PrevisionnelTab({ transactions, categories, invoices, clients, associates = [] }) {
  // ══ CHART COLORS ══
  const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1']
  const ML = { '01':'Jan','02':'Fév','03':'Mar','04':'Avr','05':'Mai','06':'Jun','07':'Jul','08':'Aoû','09':'Sep','10':'Oct','11':'Nov','12':'Déc' }

  const now = new Date()
  const currentMonthKey = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // ══ STATE ══
  const [config, setConfig] = useState({ objectif: 10000, marge_securite: 2000, solde_override: '' })
  const [chargesFixes, setChargesFixes] = useState({})
  const [configLoaded, setConfigLoaded] = useState(false)
  const [actions, setActions] = useState([])
  const [actionsLoaded, setActionsLoaded] = useState(false)
  const [pipeline, setPipeline] = useState([])
  const [pipeLoaded, setPipeLoaded] = useState(false)
  const [sessions, setSessions] = useState([])
  const [courses, setCourses] = useState([])
  const [showPipeForm, setShowPipeForm] = useState(false)
  const [newPipe, setNewPipe] = useState(() => ({ client: '', amount_ttc: '', expected_month: '', type: 'previsionnel', trainer: defaultAssociateFirstName(associates), description: '' }))
  const [showActionForm, setShowActionForm] = useState(false)
  const [newAction, setNewAction] = useState({ title: '', detail: '', category: 'general', impact_monthly: '', due_date: '' })
  const [actionFilter, setActionFilter] = useState('active') // all, active, done
  const [chartPeriod, setChartPeriod] = useState('6') // 6 or 12 months
  const [localInvoices, setLocalInvoices] = useState(null) // null = pas encore chargé
  const [localClients, setLocalClients] = useState(null)

  // Catégories « Salaire <prénom> » : associés actuels + anciennes clés en base
  const salaryNames = useMemo(() => [...new Set([
    ...associates.map(a => salaryNameFor(a.firstName)),
    ...Object.entries(chargesFixes).filter(([, v]) => v.salary).map(([name]) => name),
  ])], [associates, chargesFixes])

  // ══ LOAD SETTINGS ══
  useEffect(() => {
    loadSettings()
    loadActions()
    loadPipeline()
    loadSessionsAndCourses()
    loadInvoicesAndClients()
  }, [])

  async function loadInvoicesAndClients() {
    const [invR, cliR] = await Promise.all([
      fetchAll(() => supabase.from('invoices').select('*').order('invoice_date', { ascending: false })),
      fetchAll(() => supabase.from('clients').select('*').order('name')),
    ])
    setLocalInvoices(invR)
    setLocalClients(cliR)
  }

  async function loadSettings() {
    const { data } = await supabase.from('budget_settings').select('*')
    if (data) {
      const map = {}
      data.forEach(r => { map[r.key] = r.value })
      setConfig({
        objectif: parseFloat(map.objectif || '10000'),
        marge_securite: parseFloat(map.marge_securite || '2000'),
        solde_override: map.solde_override || '',
      })
      // Charges fixes réelles validées.
      // Salaires : une ligne par associé (clé 'charge_salaire_<slug>'), plus toute
      // clé 'charge_salaire_*' déjà en base sans associé correspondant.
      const salaries = {}
      associates.forEach(a => {
        const key = salaryKeyFor(a.slug)
        salaries[salaryNameFor(a.firstName)] = { icon: '', montant: parseFloat(map[key] || '0'), key, salary: true }
      })
      Object.keys(map).filter(k => k.startsWith(SALARY_KEY_PREFIX)).forEach(key => {
        if (associates.some(a => salaryKeyFor(a.slug) === key)) return
        const name = salaryNameFor(capitalize(key.slice(SALARY_KEY_PREFIX.length)))
        if (!salaries[name]) salaries[name] = { icon: '', montant: parseFloat(map[key] || '0'), key, salary: true }
      })
      setChargesFixes({
        ...salaries,
        'Loyer siège': { icon: '', montant: parseFloat(map.charge_loyer || '0'), key: 'charge_loyer' },
        'URSSAF': { icon: '', montant: parseFloat(map.charge_urssaf || '0'), key: 'charge_urssaf' },
        'Prêts': { icon: '', montant: parseFloat(map.charge_prets || '0'), key: 'charge_prets' },
        'Comptable': { icon: '', montant: parseFloat(map.charge_comptable || '0'), key: 'charge_comptable' },
        'Crédit auto': { icon: '', montant: parseFloat(map.charge_credit_auto || '0'), key: 'charge_credit_auto' },
        'Télécoms': { icon: '', montant: parseFloat(map.charge_telecoms || '0'), key: 'charge_telecoms' },
        'Assurances véhicule': { icon: '', montant: parseFloat(map.charge_assurance_vehicule || '0'), key: 'charge_assurance_vehicule' },
        'Assurances santé': { icon: '', montant: parseFloat(map.charge_assurance_sante || '0'), key: 'charge_assurance_sante' },
        'Logiciels & SaaS': { icon: '', montant: parseFloat(map.charge_logiciels || '0'), key: 'charge_logiciels' },
        'Frais bancaires': { icon: '', montant: parseFloat(map.charge_frais_bancaires || '0'), key: 'charge_frais_bancaires' },
      })
    }
    setConfigLoaded(true)
  }

  async function saveConfig(key, value) {
    await supabase.from('budget_settings').upsert({ key, value: String(value), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  }

  function updateConfig(key, value) {
    setConfig(c => ({ ...c, [key]: value }))
    saveConfig(key, value)
  }

  // ══ LOAD ACTIONS ══
  async function loadActions() {
    const { data } = await supabase.from('budget_actions').select('*').order('created_at', { ascending: false })
    if (data) setActions(data)
    setActionsLoaded(true)
  }

  async function addAction() {
    if (!newAction.title) { toast.error('Titre requis'); return }
    const { error } = await supabase.from('budget_actions').insert({
      title: newAction.title, detail: newAction.detail, type: 'manual',
      impact_monthly: newAction.impact_monthly ? parseFloat(newAction.impact_monthly) : null,
      due_date: newAction.due_date || null,
      status: 'todo'
    })
    if (error) { toast.error(error.message); return }
    toast.success('Action ajoutée')
    setNewAction({ title: '', detail: '', category: 'general', impact_monthly: '', due_date: '' })
    setShowActionForm(false)
    loadActions()
  }

  async function updateActionStatus(id, status) {
    await supabase.from('budget_actions').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    setActions(prev => prev.map(a => a.id === id ? { ...a, status } : a))
  }

  async function updateActionNote(id, note) {
    await supabase.from('budget_actions').update({ note, updated_at: new Date().toISOString() }).eq('id', id)
    setActions(prev => prev.map(a => a.id === id ? { ...a, note } : a))
  }

  async function deleteAction(id) {
    if (!confirm('Supprimer cette action ?')) return
    await supabase.from('budget_actions').delete().eq('id', id)
    setActions(prev => prev.filter(a => a.id !== id))
    toast.success('Supprimée')
  }

  // ══ LOAD PIPELINE ══
  async function loadPipeline() {
    // Charger les entrées manuelles
    const { data: manualData } = await supabase.from('budget_pipeline').select('*').not('status', 'eq', 'annule').order('expected_month')
    
    // Charger les devis (envoyés, acceptés = pipeline auto)
    const { data: quotesData } = await supabase.from('quotes')
      .select('id, reference, client_id, quote_date, validity_date, status, total_ht, total_ttc, session_id, object, created_by, clients(name)')
      .in('status', ['accepted'])
      .order('quote_date', { ascending: false })
    
    // Charger les sessions liées pour avoir les dates
    const sessionIds = (quotesData || []).filter(q => q.session_id).map(q => q.session_id)
    let sessionsMap = {}
    if (sessionIds.length > 0) {
      const { data: sesData } = await supabase.from('sessions').select('id, start_date, trainer_id').in('id', sessionIds)
      if (sesData) sesData.forEach(s => { sessionsMap[s.id] = s })
    }

    // Transformer les devis en entrées pipeline
    const quotePipeline = (quotesData || []).map(q => {
      const session = q.session_id ? sessionsMap[q.session_id] : null
      const expectedDate = session?.start_date || q.validity_date || q.quote_date
      const expectedMonth = expectedDate ? expectedDate.substring(0, 7) : null
      return {
        id: `quote_${q.id}`,
        quote_id: q.id,
        client: q.clients?.name || '?',
        description: q.object || q.reference,
        amount_ht: q.total_ht || 0,
        amount_ttc: q.total_ttc || 0,
        expected_month: expectedMonth,
        type: 'devis',
        status: q.status === 'accepted' ? 'confirme' : 'prevu',
        trainer: q.created_by || '',
        source: 'auto',
        quote_ref: q.reference,
        quote_status: q.status,
      }
    })

    // Fusionner : devis auto + manuels
    const manual = (manualData || []).map(p => ({ ...p, source: 'manual' }))
    setPipeline([...quotePipeline, ...manual])
    setPipeLoaded(true)
  }

  async function loadSessionsAndCourses() {
    const [sesR, couR] = await Promise.all([
      supabase.from('sessions').select('id, reference, start_date, end_date, status, custom_price_ht, total_price, session_type, is_intra, client_id, course_id, day_type, subcontract_daily_rate, subcontract_course_title').not('status', 'eq', 'cancelled').order('start_date'),
      supabase.from('courses').select('id, title, code, duration_days, price_ht'),
    ])
    if (sesR.data) setSessions(sesR.data)
    if (couR.data) setCourses(couR.data)
  }

  async function addPipeEntry() {
    if (!newPipe.client || !newPipe.amount_ttc || !newPipe.expected_month) { toast.error('Client, montant et mois requis'); return }
    const ht = parseFloat(newPipe.amount_ttc) / 1.2
    const { error } = await supabase.from('budget_pipeline').insert({
      client: newPipe.client.toUpperCase(), description: newPipe.description,
      amount_ht: Math.round(ht * 100) / 100, amount_ttc: parseFloat(newPipe.amount_ttc),
      expected_month: newPipe.expected_month, type: newPipe.type, status: 'prevu', trainer: newPipe.trainer,
    })
    if (error) { toast.error(error.message); return }
    toast.success('Ajouté au pipeline')
    setNewPipe({ client: '', amount_ttc: '', expected_month: '', type: 'previsionnel', trainer: defaultAssociateFirstName(associates), description: '' })
    setShowPipeForm(false)
    loadPipeline()
  }

  async function updatePipeStatus(id, status) {
    await supabase.from('budget_pipeline').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    loadPipeline()
  }

  async function deletePipe(id) {
    if (!confirm('Supprimer ?')) return
    await supabase.from('budget_pipeline').delete().eq('id', id)
    loadPipeline()
  }

  // ══ HELPERS ══
  function normalizeDesc(s) { return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 20) }
  function monthLabel(m) { const parts = m.split('/'); return `${ML[parts[0]] || parts[0]} ${(parts[1] || '').slice(-2)}` }

  // ══ Factures impayées ══
  // Préférer les données chargées localement (invoicesList du parent arrive souvent vide)
  const effectiveInvoices = localInvoices ?? invoices ?? []
  const effectiveClients = localClients ?? clients ?? []

  const unpaidInvoices = useMemo(() =>
    effectiveInvoices.filter(inv => inv.type !== 'credit_note' && ['sent', 'due', 'overdue', 'partial'].includes(inv.status) && parseFloat(inv.amount_due) > 0),
    [effectiveInvoices]
  )

  // ══ ANALYSE PRINCIPALE ══
  const analysis = useMemo(() => {
    try {
      // Même population que les KPI Entrées/Sorties : on écarte les lignes
      // bancaires absorbées pour ne pas compter deux fois le même mouvement.
      const co = transactions.filter(tx => !tx.is_personal && !tx.linked_transaction_id)
      const catMap = {}
      categories.forEach(c => { catMap[c.name] = { type: c.type, direction: c.direction, icon: c.icon } })

      // Solde auto = vérité bancaire, identique au KPI "Solde compte" de l'en-tête.
      // Avant : somme de TOUTES les transactions (perso + saisies manuelles déjà
      // absorbées par une ligne bancaire) → mouvements comptés deux fois.
      const bankLines = transactions.filter(tx => !tx.is_manual)
      const totalCredits = bankLines.reduce((s, tx) => s + (tx.credit || 0), 0)
      const totalDebits = bankLines.reduce((s, tx) => s + (tx.debit || 0), 0)
      const soldeAuto = Math.round((totalCredits - totalDebits) * 100) / 100
      const solde = config.solde_override !== '' ? parseFloat(config.solde_override) : soldeAuto

      // Grouper par mois
      const byMonth = {}
      co.forEach(tx => {
        if (!tx.month) return
        if (!byMonth[tx.month]) byMonth[tx.month] = { debit: 0, credit: 0, cats: {} }
        byMonth[tx.month].debit += tx.debit || 0
        byMonth[tx.month].credit += tx.credit || 0
        const c = tx.category_name || 'Non classé'
        if (!byMonth[tx.month].cats[c]) byMonth[tx.month].cats[c] = { debit: 0, credit: 0 }
        byMonth[tx.month].cats[c].debit += tx.debit || 0
        byMonth[tx.month].cats[c].credit += tx.credit || 0
      })
      const months = Object.keys(byMonth).sort()
      const nbMonths = months.length || 1

      // ── Mois en cours ──
      const curTxs = co.filter(tx => tx.month === currentMonthKey)
      const curEntrees = curTxs.filter(tx => (tx.credit || 0) > 0 && catMap[tx.category_name]?.direction === 'recette')
      const curSorties = curTxs.filter(tx => (tx.debit || 0) > 0)
      const totalEntreesRealisees = curEntrees.reduce((s, tx) => s + tx.credit, 0)
      const totalSortiesRealisees = curSorties.reduce((s, tx) => s + tx.debit, 0)

      // Entrées à venir : factures impayées échéance ce mois ou avant
      const entreesAVenir = unpaidInvoices.filter(inv => {
        const due = inv.due_date || inv.invoice_date
        return due && due.substring(0, 7) <= currentYearMonth
      })
      const totalEntreesAVenir = entreesAVenir.reduce((s, inv) => s + parseFloat(inv.amount_due), 0)

      // Pipeline du mois en cours
      const pipeThisMonth = pipeline.filter(p => p.expected_month === currentYearMonth && p.status !== 'annule')
      const totalPipeMois = pipeThisMonth.reduce((s, p) => s + (p.amount_ht || 0), 0)

      // Sorties à venir : charges fixes validées - ce qui est déjà débité
      const catToChargeKey = {
        ...Object.fromEntries(salaryNames.map(n => [n, n])),
        'Loyer siège': 'Loyer siège', 'Charges sociales (URSSAF)': 'URSSAF',
        'Prêts (remboursement)': 'Prêts', 'Comptable': 'Comptable',
        'Véhicules (crédit auto)': 'Crédit auto', 'Télécoms': 'Télécoms',
        'Assurances véhicule': 'Assurances véhicule', 'Assurances santé/prévoyance': 'Assurances santé',
        'Logiciels & SaaS': 'Logiciels & SaaS', 'Frais bancaires': 'Frais bancaires',
      }
      // Total charges fixes attendues ce mois
      const totalChargesFixesMois = Object.values(chargesFixes).reduce((s, v) => s + (v.montant || 0), 0)
      // Ce qui est déjà débité dans les catégories de charges fixes
      const dejaDebiteChargesFixes = curSorties
        .filter(tx => catToChargeKey[tx.category_name])
        .reduce((s, tx) => s + tx.debit, 0)
      const totalSortiesAVenir = Math.max(0, totalChargesFixesMois - dejaDebiteChargesFixes)
      // Détail pour affichage
      const sortiesAVenir = Object.entries(chargesFixes)
        .filter(([, v]) => v.montant > 0)
        .map(([name, v]) => {
          const cats = Object.entries(catToChargeKey).filter(([, k]) => k === name).map(([c]) => c)
          const deja = curSorties.filter(tx => cats.includes(tx.category_name)).reduce((s, tx) => s + tx.debit, 0)
          const reste = v.montant - deja
          return { description: name, montant: reste, icon: v.icon, deja, attendu: v.montant }
        })
        .filter(r => r.montant > 50)

      const totalEntreesMois = totalEntreesRealisees + totalEntreesAVenir + totalPipeMois
      const totalSortiesMois = totalSortiesRealisees + totalSortiesAVenir
      const netMois = totalEntreesMois - totalSortiesMois
      const soldeProjeteFin = solde + netMois
      const budgetLibre = soldeProjeteFin - config.marge_securite

      // ── CA par catégorie et mois ──
      let totalCAFormations = 0, totalCASousTrait = 0
      const caByMonth = {}
      months.forEach(m => {
        let caF = 0, caS = 0
        Object.entries(byMonth[m].cats).forEach(([cat, vals]) => {
          if (cat === 'CA Formations') caF += vals.credit
          if (cat === 'CA Sous-traitance') caS += vals.credit
        })
        caByMonth[m] = { formations: caF, soustraitance: caS, total: caF + caS }
        totalCAFormations += caF
        totalCASousTrait += caS
      })

      const activeMonths = months.filter(m => (caByMonth[m]?.total || 0) > 100)
      const nbActive = activeMonths.length || 1

      // ── Tendances 3 derniers mois ──
      const last3 = activeMonths.slice(-3)
      const prev3 = activeMonths.slice(-6, -3)
      const caLast3 = last3.reduce((s, m) => s + (caByMonth[m]?.total || 0), 0) / (last3.length || 1)
      const caPrev3 = prev3.reduce((s, m) => s + (caByMonth[m]?.total || 0), 0) / (prev3.length || 1)
      const caTrend = caPrev3 > 0 ? ((caLast3 - caPrev3) / caPrev3) * 100 : 0

      const depLast3 = last3.reduce((s, m) => s + (byMonth[m]?.debit || 0), 0) / (last3.length || 1)
      const depPrev3 = prev3.reduce((s, m) => s + (byMonth[m]?.debit || 0), 0) / (prev3.length || 1)
      const depTrend = depPrev3 > 0 ? ((depLast3 - depPrev3) / depPrev3) * 100 : 0
      const margeLast3 = caLast3 - depLast3

      // ── Charges fixes : utiliser les montants validés de budget_settings ──
      const fixedDetail = Object.entries(chargesFixes)
        .filter(([, v]) => v.montant > 0)
        .map(([name, v]) => ({ name, icon: v.icon, monthly: v.montant }))
      const avgFixed = fixedDetail.reduce((s, d) => s + d.monthly, 0)

      // ── Dépenses par catégorie (pour camembert + optimisation) ──
      const depByCat = {}
      months.forEach(m => {
        Object.entries(byMonth[m].cats).forEach(([cat, vals]) => {
          if (vals.debit > 0) {
            if (!depByCat[cat]) depByCat[cat] = { total: 0, months: [], icon: catMap[cat]?.icon || '' }
            depByCat[cat].total += vals.debit
            depByCat[cat].months.push({ m, amount: vals.debit })
          }
        })
      })
      Object.values(depByCat).forEach(d => {
        d.monthly = d.total / nbMonths
        d.last3 = d.months.filter(x => last3.includes(x.m)).reduce((s, x) => s + x.amount, 0) / (last3.length || 1)
      })

      // ── Budget par catégorie pour le mois en cours (variable uniquement) ──
      const fixedCatNames = new Set([
        ...salaryNames, 'Loyer siège', 'Charges sociales (URSSAF)',
        'Prêts (remboursement)', 'Comptable', 'Véhicules (crédit auto)', 'Télécoms',
        'Assurances véhicule', 'Assurances santé/prévoyance', 'Logiciels & SaaS',
        'Frais bancaires', 'Impôts / TVA',
      ])
      const excludedCats = new Set([
        'Véhicules (achat)', 'Trésorerie interne', 'Apports associés',
      ])
      const budgetByCat = Object.entries(depByCat)
        .filter(([name, d]) => d.monthly >= 50 && !fixedCatNames.has(name) && !excludedCats.has(name))
        .map(([name, d]) => {
          const spent = curSorties.filter(tx => tx.category_name === name).reduce((s, tx) => s + tx.debit, 0)
          return { name, icon: d.icon, budget: Math.round(d.monthly), spent: Math.round(spent), remaining: Math.round(d.monthly - spent) }
        })
        .sort((a, b) => b.budget - a.budget)

      // ── Données graphiques ══
      // Barres entrées/sorties par mois
      const nbChartMonths = parseInt(chartPeriod) || 6
      const chartMonths = months.slice(-nbChartMonths)
      const barData = chartMonths.map(m => ({
        name: monthLabel(m),
        month: m,
        entrees: Math.round(byMonth[m].credit),
        sorties: Math.round(byMonth[m].debit),
        net: Math.round(byMonth[m].credit - byMonth[m].debit),
        isCurrent: m === currentMonthKey,
      }))

      // Camembert sorties (exclure one-shots et transferts internes)
      const pieExclude = new Set(['Véhicules (achat)', 'Trésorerie interne', 'Apports associés'])
      const pieData = Object.entries(depByCat)
        .filter(([name]) => !pieExclude.has(name))
        .map(([name, d]) => ({ name, value: Math.round(d.total), icon: d.icon }))
        .sort((a, b) => b.value - a.value)
      // Regrouper les petits (<3%)
      const totalDep = pieData.reduce((s, p) => s + p.value, 0)
      const pieMain = []
      let autresVal = 0
      pieData.forEach(p => {
        if (p.value / totalDep >= 0.03) pieMain.push(p)
        else autresVal += p.value
      })
      if (autresVal > 0) pieMain.push({ name: 'Autres', value: autresVal, icon: '' })

      // Donut CA
      const caDonut = [
        { name: 'Formations directes', value: Math.round(totalCAFormations) },
        { name: 'Sous-traitance', value: Math.round(totalCASousTrait) },
      ]

      // Sparklines (6 derniers mois)
      const sparkCA = activeMonths.slice(-6).map(m => ({ m, v: caByMonth[m]?.total || 0 }))
      const sparkDep = months.slice(-6).map(m => ({ m, v: byMonth[m]?.debit || 0 }))
      const sparkNet = months.slice(-6).map(m => ({ m, v: (byMonth[m]?.credit || 0) - (byMonth[m]?.debit || 0) }))

      // ── Sessions & Formations à venir ──
      const courseMap = {}
      courses.forEach(c => { courseMap[c.id] = c })

      const today = new Date().toISOString().substring(0, 10)
      const futureSessions = sessions.filter(s => s.start_date >= today && s.status !== 'cancelled' && s.status !== 'draft')

      // Calcul prix session : sous-traitance = daily_rate × nb_jours, sinon custom/total/catalogue
      const calcSessionPrice = (s) => {
        if (s.custom_price_ht) return parseFloat(s.custom_price_ht)
        if (s.total_price) return parseFloat(s.total_price)
        if (s.subcontract_daily_rate) {
          const start = new Date(s.start_date)
          const end = new Date(s.end_date || s.start_date)
          const diffMs = end - start
          const nbJours = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1
          const halfDay = s.day_type === 'half' ? 0.5 : 1
          return parseFloat(s.subcontract_daily_rate) * nbJours * halfDay
        }
        const course = courseMap[s.course_id] || {}
        return parseFloat(course.price_ht) || 0
      }

      // Grouper par mois
      const sessionsByMonth = {}
      futureSessions.forEach(s => {
        const ym = s.start_date.substring(0, 7)
        if (!sessionsByMonth[ym]) sessionsByMonth[ym] = []
        const course = courseMap[s.course_id] || {}
        const prix = calcSessionPrice(s)
        const cli = effectiveClients.find(c => c.id === s.client_id)
        sessionsByMonth[ym].push({ ...s, prix, courseName: s.subcontract_course_title || course.title || '?', courseCode: course.code || '?', clientName: cli?.name || '?' })
      })

      const sessionsTotal = futureSessions.reduce((s, ses) => s + calcSessionPrice(ses), 0)

      // Classement formations par rentabilité
      const formationsRank = courses.map(c => {
        const sesDone = sessions.filter(s => s.course_id === c.id && s.status !== 'cancelled' && s.status !== 'draft' && s.start_date < today)
        const nbDone = sesDone.length
        // Session sans prix surchargé = prix catalogue (même règle que la convention et la facture)
        const caDone = sesDone.reduce((sum, s) => sum + (parseFloat(s.custom_price_ht) || parseFloat(s.total_price) || parseFloat(c.price_ht) || 0), 0)
        const prixMoyenRealise = nbDone > 0 ? caDone / nbDone : 0
        const prixCatalogue = c.price_ht || 0
        const margeDirecte = prixCatalogue
        return {
          ...c,
          nbDone, caDone, prixMoyenRealise, prixCatalogue, margeDirecte,
          sesFutures: futureSessions.filter(s => s.course_id === c.id).length
        }
      }).sort((a, b) => b.prixCatalogue - a.prixCatalogue)

      // ── Projection trimestre ──
      const trimProjection = []
      let soldeCumul = solde
      const depFixesValidees = Object.values(chargesFixes).reduce((s, v) => s + (v.montant || 0), 0)
      for (let i = 0; i < 3; i++) {
        const futureDate = new Date(now.getFullYear(), now.getMonth() + i, 1)
        const mLabel = `${ML[String(futureDate.getMonth() + 1).padStart(2, '0')]} ${futureDate.getFullYear()}`
        const mYM = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}`

        // Pipeline prévu pour ce mois
        const pipeMois = pipeline.filter(p => p.expected_month === mYM && p.status !== 'annule')
        const caPipe = pipeMois.reduce((s, p) => s + (p.amount_ht || 0), 0)

        // Sessions planifiées ce mois (si pas déjà dans pipeline)
        const sesMois = (sessionsByMonth[mYM] || []).reduce((s, ses) => s + ses.prix, 0)

        const caProj = i === 0 ? totalEntreesMois : Math.max(caLast3, caPipe + sesMois)
        const depProj = i === 0 ? totalSortiesMois : depFixesValidees
        const net = caProj - depProj
        soldeCumul += (i === 0 ? netMois : net)

        trimProjection.push({ label: mLabel, ca: caProj, dep: depProj, net: i === 0 ? netMois : net, solde: soldeCumul, isCurrent: i === 0, caPipe, sesMois })
      }
      const moisTendu = trimProjection.reduce((min, m) => m.solde < min.solde ? m : min, trimProjection[0])

      // ── Cash flow détaillé ──
      const cashFlowItems = []
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      const endStr = endOfMonth.toISOString().substring(0, 10)

      // Charges fixes validées - vérifier lesquelles sont déjà débitées ce mois
      const chargesFixesMap = {
        ...Object.fromEntries(salaryNames.map(n => [n, { date: endStr, cats: [n] }])),
        'Loyer siège': { date: `${currentYearMonth}-05`, cats: ['Loyer siège'] },
        'URSSAF': { date: `${currentYearMonth}-20`, cats: ['Charges sociales (URSSAF)'] },
        'Prêts': { date: `${currentYearMonth}-09`, cats: ['Prêts (remboursement)'] },
        'Comptable': { date: `${currentYearMonth}-25`, cats: ['Comptable'] },
        'Crédit auto': { date: `${currentYearMonth}-30`, cats: ['Véhicules (crédit auto)'] },
        'Télécoms': { date: `${currentYearMonth}-26`, cats: ['Télécoms'] },
        'Assurances véhicule': { date: `${currentYearMonth}-05`, cats: ['Assurances véhicule'] },
        'Assurances santé': { date: `${currentYearMonth}-05`, cats: ['Assurances santé/prévoyance'] },
        'Logiciels & SaaS': { date: `${currentYearMonth}-15`, cats: ['Logiciels & SaaS'] },
        'Frais bancaires': { date: `${currentYearMonth}-10`, cats: ['Frais bancaires'] },
      }

      Object.entries(chargesFixes).forEach(([name, { montant, icon }]) => {
        if (!montant || montant <= 0) return
        const mapping = chargesFixesMap[name]
        if (!mapping) return
        // Vérifier si déjà débité ce mois (par catégorie)
        const dejaDebite = curSorties
          .filter(tx => mapping.cats.includes(tx.category_name))
          .reduce((s, tx) => s + tx.debit, 0)
        const reste = montant - dejaDebite
        if (reste > 50) { // seuil pour éviter les centimes
          cashFlowItems.push({ date: mapping.date >= today ? mapping.date : endStr, label: `${icon} ${name}`, montant: -reste, type: 'sortie' })
        }
      })

      // Factures attendues (entrées)
      entreesAVenir.forEach(inv => {
        const cli = effectiveClients.find(c => c.id === inv.client_id)
        const isOverdue = inv.due_date && inv.due_date < today
        cashFlowItems.push({ date: inv.due_date || inv.invoice_date, label: `${inv.reference} - ${cli?.name || '?'}`, montant: parseFloat(inv.amount_due), type: isOverdue ? 'retard' : 'entree' })
      })

      cashFlowItems.sort((a, b) => a.date.localeCompare(b.date))

      // Solde glissant
      let soldeGlissant = solde
      cashFlowItems.forEach(item => {
        soldeGlissant += item.montant
        item.soldeApres = soldeGlissant
      })

      // ── Recommandations auto ──
      const recos = generateRecommendations({
        unpaidInvoices, clients, depByCat, totalCAFormations, totalCASousTrait,
        budgetLibre, config, last3, caLast3, depLast3, catMap, moisTendu, solde,
        nbActive, pipeline, formationsRank, futureSessions, sessionsTotal,
        chargesFixes, totalEntreesMois, totalSortiesMois, cashFlowItems
      })

      // ── Bilan mois précédent ──
      const prevMonth = months.length >= 2 ? months[months.length - 2] : null
      let bilanPrev = null
      if (prevMonth && prevMonth !== currentMonthKey) {
        const pm = byMonth[prevMonth]
        bilanPrev = {
          month: monthLabel(prevMonth),
          entrees: pm.credit,
          sorties: pm.debit,
          net: pm.credit - pm.debit,
          ca: caByMonth[prevMonth]?.total || 0,
        }
      }

      return {
        solde, soldeAuto, byMonth, months, nbMonths,
        totalEntreesRealisees, totalSortiesRealisees, totalEntreesAVenir, totalSortiesAVenir,
        totalPipeMois, totalEntreesMois, totalSortiesMois,
        entreesAVenir, sortiesAVenir,
        netMois, soldeProjeteFin, budgetLibre,
        caByMonth, totalCAFormations, totalCASousTrait,
        caLast3, caPrev3, caTrend, depLast3, depPrev3, depTrend, margeLast3,
        fixedDetail, avgFixed, depByCat, budgetByCat,
        barData, pieMain, caDonut, sparkCA, sparkDep, sparkNet,
        trimProjection, moisTendu, recos, bilanPrev, last3, nbActive,
        sessionsByMonth, sessionsTotal, formationsRank, cashFlowItems
      }
    } catch (err) {
      console.error('PrevisionnelTab analysis error:', err)
      return {
        solde: 0, soldeAuto: 0, byMonth: {}, months: [], nbMonths: 0,
        totalEntreesRealisees: 0, totalSortiesRealisees: 0, totalEntreesAVenir: 0, totalSortiesAVenir: 0,
        totalPipeMois: 0, totalEntreesMois: 0, totalSortiesMois: 0,
        entreesAVenir: [], sortiesAVenir: [],
        netMois: 0, soldeProjeteFin: 0, budgetLibre: 0,
        caByMonth: {}, totalCAFormations: 0, totalCASousTrait: 0,
        caLast3: 0, caPrev3: 0, caTrend: 0, depLast3: 0, depPrev3: 0, depTrend: 0, margeLast3: 0,
        fixedDetail: [], avgFixed: 0, depByCat: {}, budgetByCat: [],
        barData: [], pieMain: [], caDonut: [], sparkCA: [], sparkDep: [], sparkNet: [],
        trimProjection: [], moisTendu: null, recos: [], bilanPrev: null, last3: [], nbActive: 0,
        sessionsByMonth: {}, sessionsTotal: 0, formationsRank: [], cashFlowItems: []
      }
    }
  }, [transactions, categories, unpaidInvoices, config, currentMonthKey, pipeline, chartPeriod, chargesFixes, salaryNames, sessions, courses, effectiveClients, effectiveInvoices])

  function detectRecurringCharges(txs, months, curMonth) {
    const descMap = {}
    txs.forEach(tx => {
      if ((tx.debit || 0) <= 0) return
      const key = normalizeDesc(tx.description)
      if (!descMap[key]) descMap[key] = { description: tx.description, months: new Set(), amounts: [], catName: tx.category_name }
      descMap[key].months.add(tx.month)
      descMap[key].amounts.push(tx.debit)
    })
    return Object.values(descMap)
      .filter(d => d.months.size >= 3)
      .map(d => ({ description: d.description, montant: d.amounts.reduce((s, a) => s + a, 0) / d.amounts.length, catName: d.catName, frequence: d.months.size }))
      .sort((a, b) => b.montant - a.montant)
  }

  function generateRecommendations({ unpaidInvoices, clients, depByCat, totalCAFormations, totalCASousTrait, budgetLibre, config, last3, caLast3, depLast3, catMap, moisTendu, solde, nbActive, pipeline, formationsRank, futureSessions, sessionsTotal, chargesFixes, totalEntreesMois, totalSortiesMois, cashFlowItems }) {
    const recos = []
    const today = new Date().toISOString().substring(0, 10)
    const totalChargesFixes = Object.values(chargesFixes || {}).reduce((s, v) => s + (v.montant || 0), 0)

    // ══ URGENCE TRÉSORERIE ══
    if (totalChargesFixes > 0 && solde < totalChargesFixes) {
      recos.push({ type: 'alert', icon: '', priority: 110,
        title: `Trésorerie critique : ${fmt(solde)}`,
        detail: `Charges fixes = ${fmt(totalChargesFixes)}/mois. Le solde ne couvre pas 1 mois complet. Priorité : encaisser les factures.` })
    }

    // Solde projeté négatif
    const lastCF = (cashFlowItems || []).length > 0 ? cashFlowItems[cashFlowItems.length - 1] : null
    if (lastCF && lastCF.soldeApres < 0) {
      recos.push({ type: 'alert', icon: '', priority: 105,
        title: `Risque de solde négatif fin de mois : ${fmt(lastCF.soldeApres)}`,
        detail: `Sans encaissement supplémentaire, le compte passe dans le rouge. Relancer les impayés EN URGENCE.` })
    }

    // ══ FACTURES EN RETARD ══
    const overdue = unpaidInvoices.filter(inv => inv.status === 'overdue' || (inv.due_date && inv.due_date < today))
    if (overdue.length > 0) {
      const totalO = overdue.reduce((s, inv) => s + parseFloat(inv.amount_due), 0)
      const details = overdue.map(inv => {
        const cli = effectiveClients.find(c => c.id === inv.client_id)
        const jours = Math.floor((new Date() - new Date(inv.due_date)) / 86400000)
        return `${cli?.name || '?'} ${fmt(parseFloat(inv.amount_due))} (+${jours}j)`
      }).join(' · ')
      recos.push({ type: 'alert', icon: '', priority: 100, title: `${overdue.length} facture(s) en retard - ${fmt(totalO)}`, detail: details })
    }

    // Factures dues ce mois
    const curYM = new Date().toISOString().substring(0, 7)
    const dueThisMonth = unpaidInvoices.filter(inv => !overdue.includes(inv) && inv.due_date && inv.due_date.substring(0, 7) <= curYM)
    if (dueThisMonth.length > 0) {
      const totalD = dueThisMonth.reduce((s, inv) => s + parseFloat(inv.amount_due), 0)
      recos.push({ type: 'info', icon: '', priority: 70, title: `${dueThisMonth.length} facture(s) échéance ce mois - ${fmt(totalD)}`, detail: 'Suivre les virements de près' })
    }

    // ══ FORMATIONS À POUSSER ══
    if (formationsRank && formationsRank.length > 0) {
      const top = formationsRank.filter(f => f.prixCatalogue >= 690).slice(0, 3)
      if (top.length > 0) {
        const detail = top.map(f => `${f.code} = ${fmt(f.prixCatalogue)}`).join(' · ')
        const nbFutur = (futureSessions || []).length
        recos.push({ type: 'levier', icon: '', priority: 85,
          title: 'Formations directes les plus rentables',
          detail: `${detail}. Actuellement ${nbFutur} session(s) planifiée(s) = ${fmt(sessionsTotal || 0)} HT. Une formation vendue en direct dégage nettement plus de marge qu'une session sous-traitée.` })
      }
    }

    // Sessions insuffisantes
    if ((futureSessions || []).length < 5) {
      recos.push({ type: 'levier', icon: '', priority: 82,
        title: `Seulement ${(futureSessions || []).length} session(s) planifiée(s)`,
        detail: `CA sessions prévu : ${fmt(sessionsTotal || 0)} HT. Planning trop vide → remplir via la prospection directe.` })
    }

    // ══ RATIO SOUS-TRAITANCE ══
    const totalCA = totalCAFormations + totalCASousTrait
    if (totalCA > 0 && totalCASousTrait / totalCA > 0.5) {
      const ratio = ((totalCASousTrait / totalCA) * 100).toFixed(0)
      recos.push({ type: 'levier', icon: '', priority: 78,
        title: `Sous-traitance = ${ratio}% du CA`,
        detail: `Marge réduite. Une session vendue en direct rapporte autant net que plusieurs sessions sous-traitées. La prospection doit cibler les entreprises clientes finales plutôt que d'autres organismes de formation.` })
    }

    // ══ CHARGES VARIABLES EN HAUSSE (ignorer les fixes et one-shots) ══
    const ignoreCats = new Set([
      ...salaryNames, 'Loyer siège', 'Charges sociales (URSSAF)',
      'Prêts (remboursement)', 'Comptable', 'Véhicules (crédit auto)', 'Télécoms',
      'Assurances véhicule', 'Assurances santé/prévoyance', 'Logiciels & SaaS',
      'Frais bancaires', 'Impôts / TVA', 'Véhicules (achat)', 'Trésorerie interne',
      'Apports associés',
    ])
    Object.entries(depByCat).forEach(([cat, data]) => {
      if (data.monthly < 80 || !last3.length) return
      if (ignoreCats.has(cat)) return
      const info = catMap[cat] || {}
      if (info.direction === 'recette' || info.direction === 'neutre') return
      if (data.last3 > data.monthly * 1.3 && data.last3 > 150) {
        recos.push({ type: 'optimisation', icon: '', priority: 65,
          title: `${data.icon} ${cat} en hausse`,
          detail: `${fmt(data.last3)}/mois récent vs ${fmt(data.monthly)} moyenne (+${((data.last3 / data.monthly - 1) * 100).toFixed(0)}%)` })
      }
    })

    // Budget libre
    if (budgetLibre < 0) {
      recos.push({ type: 'alert', icon: '', priority: 90,
        title: `Budget libre négatif : ${fmt(budgetLibre)}`,
        detail: `Il manque ${fmt(Math.abs(budgetLibre))} pour rester au-dessus de la marge de sécurité (${fmt(config.marge_securite)}).` })
    }

    // Mois tendu
    if (moisTendu && moisTendu.solde < config.marge_securite && !moisTendu.isCurrent) {
      recos.push({ type: 'alert', icon: '', priority: 80,
        title: `${moisTendu.label} sera serré - solde ${fmt(moisTendu.solde)}`,
        detail: 'Anticiper les encaissements et limiter les dépenses.' })
    }

    // Objectif
    if (config.objectif > 0 && caLast3 > 0) {
      const gap = config.objectif - solde
      const netMens = caLast3 - depLast3
      if (gap > 0 && netMens > 0) {
        const mois = Math.ceil(gap / netMens)
        recos.push({ type: 'info', icon: '', priority: 45,
          title: `Objectif ${fmt(config.objectif)} en ~${mois} mois`,
          detail: `Au rythme actuel (net ${fmt(netMens)}/mois)` })
      }
    }

    return recos.sort((a, b) => b.priority - a.priority)
  }

  // ── Chart helpers ──
  const trendArrow = (pct) => pct > 5 ? '↗' : pct < -5 ? '↘' : '→'
  const trendColor = (pct, inverse = false) => {
    const good = inverse ? pct < -5 : pct > 5
    return good ? 'text-green-600' : (inverse ? pct > 5 : pct < -5) ? 'text-red-600' : 'text-gray-600'
  }

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload) return null
    return (
      <div className="bg-white p-2 rounded shadow border text-xs">
        <div className="font-bold">{label}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ color: p.color }}>{p.name}: {fmt(p.value)}</div>
        ))}
      </div>
    )
  }

  const MiniSparkline = ({ data, color }) => (
    <ResponsiveContainer width={80} height={24}>
      <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <Area type="monotone" dataKey="v" stroke={color} fill={color} fillOpacity={0.15} strokeWidth={1.5} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )

  const statusIcons = { todo: '', in_progress: '', done: '', partial: '', not_applicable: '' }
  const statusLabels = { todo: 'À faire', in_progress: 'En cours', done: 'Fait', partial: 'Partiel', not_applicable: 'N/A' }
  const statusCycle = ['todo', 'in_progress', 'partial', 'done', 'not_applicable']

  const filteredActions = actions.filter(a => {
    if (actionFilter === 'active') return !['done', 'not_applicable'].includes(a.status)
    if (actionFilter === 'done') return ['done', 'not_applicable'].includes(a.status)
    return true
  })
  const doneCount = actions.filter(a => a.status === 'done').length

  // ══ RENDU ══
  return (
    <div className="space-y-4">

      {/* ══ BLOC 1 - Situation actuelle ══ */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-4 text-white">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg"> Situation - {ML[currentMonthKey.split('/')[0]]} {now.getFullYear()}</h3>
          <span className={`px-3 py-1 rounded-full text-sm font-bold ${
            analysis.budgetLibre > 1000 ? 'bg-green-400/30 text-green-100' :
            analysis.budgetLibre > 0 ? 'bg-amber-400/30 text-amber-100' :
            'bg-red-400/30 text-red-100'
          }`}>
            {analysis.budgetLibre > 1000 ? ' Confortable' : analysis.budgetLibre > 0 ? ' Attention' : ' Critique'}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-xs opacity-70">Solde {config.solde_override !== '' ? '(manuel)' : '(calculé)'}</div>
            <div className="font-bold text-xl">{fmt(analysis.solde)}</div>
            {config.solde_override !== '' && <div className="text-xs opacity-50">Auto : {fmt(analysis.soldeAuto)}</div>}
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-xs opacity-70">Solde projeté fin de mois</div>
            <div className={`font-bold text-xl ${analysis.soldeProjeteFin >= config.marge_securite ? '' : 'text-red-300'}`}>{fmt(analysis.soldeProjeteFin)}</div>
          </div>
          <div className={`rounded-lg p-3 ${analysis.budgetLibre > 1000 ? 'bg-green-500/30' : analysis.budgetLibre > 0 ? 'bg-amber-500/30' : 'bg-red-500/30'}`}>
            <div className="text-xs opacity-70"> Budget libre</div>
            <div className="font-bold text-xl">{fmt(analysis.budgetLibre)}</div>
            <div className="text-xs opacity-60">Dépensable sans risque</div>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-xs opacity-70"> Objectif</div>
            <div className="font-bold text-xl">{fmt(config.objectif)}</div>
          </div>
        </div>
        {config.objectif > 0 && (
          <div className="mt-3">
            <div className="flex justify-between text-xs mb-1 opacity-70">
              <span>{fmt(analysis.solde)}</span>
              <span>Gap : {fmt(Math.max(0, config.objectif - analysis.solde))}</span>
              <span>{fmt(config.objectif)}</span>
            </div>
            <div className="bg-white/20 rounded-full h-2.5">
              <div className="rounded-full h-2.5 bg-green-400 transition-all"
                style={{ width: `${Math.min(100, Math.max(2, (analysis.solde / config.objectif) * 100))}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Paramètres */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <details>
          <summary className="font-bold text-gray-700 cursor-pointer hover:text-blue-600"> Paramètres</summary>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <div>
              <label className="text-xs text-gray-500">Solde réel (€) <span className="text-gray-300">vide = auto</span></label>
              <input type="number" value={config.solde_override} placeholder={`Auto: ${analysis.soldeAuto}`}
                onChange={e => updateConfig('solde_override', e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1 font-mono" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Objectif fin d'année (€)</label>
              <input type="number" value={config.objectif} onChange={e => updateConfig('objectif', +e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1 font-mono" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Marge de sécurité (€)</label>
              <input type="number" value={config.marge_securite} onChange={e => updateConfig('marge_securite', +e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1 font-mono" />
            </div>
          </div>
        </details>
      </div>

      {/* ══ BLOC 2 - Mois en cours ══ */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b">
          <h3 className="font-bold text-gray-700"> {ML[currentMonthKey.split('/')[0]]} {now.getFullYear()} - Réalisé vs À venir</h3>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-4 gap-4 text-center text-sm">
            <div></div>
            <div className="font-medium text-gray-500"> Réalisé</div>
            <div className="font-medium text-gray-500"> À venir</div>
            <div className="font-medium text-gray-700">Total mois</div>

            <div className="text-left font-medium text-green-700"> Entrées</div>
            <div className="font-mono text-green-600">{fmt(analysis.totalEntreesRealisees)}</div>
            <div className="font-mono text-green-500">{fmt(analysis.totalEntreesAVenir + analysis.totalPipeMois)}</div>
            <div className="font-mono font-bold text-green-700">{fmt(analysis.totalEntreesMois)}</div>

            <div className="text-left font-medium text-red-700"> Sorties</div>
            <div className="font-mono text-red-600">{fmt(analysis.totalSortiesRealisees)}</div>
            <div className="font-mono text-red-500">{fmt(analysis.totalSortiesAVenir)}</div>
            <div className="font-mono font-bold text-red-700">{fmt(analysis.totalSortiesMois)}</div>

            <div className="text-left font-bold text-gray-700 border-t pt-2">Net</div>
            <div className={`font-mono font-bold border-t pt-2 ${(analysis.totalEntreesRealisees - analysis.totalSortiesRealisees) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {fmt(analysis.totalEntreesRealisees - analysis.totalSortiesRealisees)}
            </div>
            <div className="font-mono border-t pt-2 text-gray-500">
              {fmt((analysis.totalEntreesAVenir + analysis.totalPipeMois) - analysis.totalSortiesAVenir)}
            </div>
            <div className={`font-mono font-bold text-lg border-t pt-2 ${analysis.netMois >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {analysis.netMois >= 0 ? '+' : ''}{fmt(analysis.netMois)}
            </div>
          </div>

          {/* Détails dépliables */}
          {analysis.entreesAVenir.length > 0 && (
            <details className="mt-4">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600"> {analysis.entreesAVenir.length} facture(s) en attente</summary>
              <div className="mt-2 space-y-1">
                {analysis.entreesAVenir.map(inv => {
                  const cli = effectiveClients.find(c => c.id === inv.client_id)
                  const isOD = inv.due_date && inv.due_date < new Date().toISOString().substring(0, 10)
                  return (
                    <div key={inv.id} className={`flex justify-between text-xs px-2 py-1 rounded ${isOD ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                      <span>{inv.reference} - {cli?.name || '?'} {isOD && <b> RETARD</b>}</span>
                      <span className="font-mono font-bold">{fmt(parseFloat(inv.amount_due))}</span>
                    </div>
                  )
                })}
              </div>
            </details>
          )}

          {analysis.sortiesAVenir.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600"> {analysis.sortiesAVenir.length} charge(s) fixe(s) restante(s) ce mois</summary>
              <div className="mt-2 space-y-1">
                {analysis.sortiesAVenir.map((r, i) => (
                  <div key={i} className="flex justify-between text-xs px-2 py-1 rounded bg-red-50 text-red-700">
                    <span>{r.icon} {r.description} <span className="text-gray-400">(débité {fmt(r.deja)} / {fmt(r.attendu)})</span></span>
                    <span className="font-mono font-medium">reste ~{fmt(r.montant)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Budget par catégorie */}
          {analysis.budgetByCat.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600"> Budget par catégorie ce mois</summary>
              <div className="mt-2 space-y-1.5">
                {analysis.budgetByCat.slice(0, 8).map((b, i) => (
                  <div key={i} className="text-xs">
                    <div className="flex justify-between mb-0.5">
                      <span>{b.icon} {b.name}</span>
                      <span className={`font-mono ${b.remaining < 0 ? 'text-red-600 font-bold' : 'text-gray-600'}`}>
                        {fmt(b.spent)} / ~{fmt(b.budget)} {b.remaining < 0 && ''}
                      </span>
                    </div>
                    <div className="bg-gray-100 rounded-full h-1.5">
                      <div className={`rounded-full h-1.5 ${b.remaining < 0 ? 'bg-red-500' : b.spent / b.budget > 0.8 ? 'bg-amber-400' : 'bg-green-400'}`}
                        style={{ width: `${Math.min(100, (b.spent / b.budget) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Bilan mois précédent */}
      {analysis.bilanPrev && (
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-gray-700"> Bilan {analysis.bilanPrev.month}</h4>
            <span className={`text-sm font-bold ${analysis.bilanPrev.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              Net : {analysis.bilanPrev.net >= 0 ? '+' : ''}{fmt(analysis.bilanPrev.net)}
            </span>
          </div>
          <div className="flex gap-4 mt-2 text-xs text-gray-500">
            <span>CA : {fmt(analysis.bilanPrev.ca)}</span>
            <span>Entrées : {fmt(analysis.bilanPrev.entrees)}</span>
            <span>Sorties : {fmt(analysis.bilanPrev.sorties)}</span>
          </div>
        </div>
      )}

      {/* ══ CASH FLOW - Mouvements prévus ══ */}
      {analysis.cashFlowItems.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b">
            <h3 className="font-bold text-gray-700"> Cash flow - mouvements prévus</h3>
          </div>
          <div className="p-4">
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400 px-2 mb-1">
                <span>Solde actuel</span>
                <span className="font-mono font-bold text-gray-700">{fmt(analysis.solde)}</span>
              </div>
              {analysis.cashFlowItems.map((item, i) => (
                <div key={i} className={`flex items-center justify-between text-xs px-2 py-1.5 rounded ${
                  item.type === 'retard' ? 'bg-red-50 border-l-2 border-red-400' :
                  item.type === 'entree' ? 'bg-green-50 border-l-2 border-green-400' :
                  'bg-gray-50 border-l-2 border-gray-300'
                }`}>
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-gray-400 w-16">{item.date.substring(5)}</span>
                    <span className={item.type === 'retard' ? 'text-red-700 font-medium' : ''}>{item.label}</span>
                    {item.type === 'retard' && <span className="text-red-500 text-xs"> retard</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`font-mono font-medium ${item.montant >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {item.montant >= 0 ? '+' : ''}{fmt(item.montant)}
                    </span>
                    <span className={`font-mono text-xs w-20 text-right ${item.soldeApres < 0 ? 'text-red-700 font-bold' : item.soldeApres < 2000 ? 'text-amber-600' : 'text-gray-500'}`}>
                      → {fmt(item.soldeApres)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {analysis.cashFlowItems.some(i => i.soldeApres < 0) && (
              <div className="mt-3 p-2 bg-red-100 rounded-lg text-xs text-red-800 font-medium text-center">
                 Le solde passe dans le rouge - les encaissements doivent arriver AVANT les prélèvements
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ BLOC 3 - Tendances & Graphiques ══ */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-700"> Tendances</h3>
          <div className="flex gap-1">
            {['6', '12'].map(p => (
              <button key={p} onClick={() => setChartPeriod(p)}
                className={`text-xs px-2 py-1 rounded ${chartPeriod === p ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-400 hover:bg-gray-100'}`}>
                {p} mois
              </button>
            ))}
          </div>
        </div>

        {/* KPIs avec sparklines */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="p-3 bg-green-50 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-500">CA moyen</div>
                <div className="font-bold text-lg text-green-700">{fmt(analysis.caLast3)}</div>
                <div className={`text-xs font-medium ${trendColor(analysis.caTrend)}`}>
                  {trendArrow(analysis.caTrend)} {analysis.caTrend > 0 ? '+' : ''}{analysis.caTrend.toFixed(0)}%
                </div>
              </div>
              <MiniSparkline data={analysis.sparkCA} color="#16a34a" />
            </div>
          </div>
          <div className="p-3 bg-red-50 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-500">Dépenses</div>
                <div className="font-bold text-lg text-red-700">{fmt(analysis.depLast3)}</div>
                <div className={`text-xs font-medium ${trendColor(analysis.depTrend, true)}`}>
                  {trendArrow(analysis.depTrend)} {analysis.depTrend > 0 ? '+' : ''}{analysis.depTrend.toFixed(0)}%
                </div>
              </div>
              <MiniSparkline data={analysis.sparkDep} color="#dc2626" />
            </div>
          </div>
          <div className={`p-3 rounded-lg ${analysis.margeLast3 >= 0 ? 'bg-blue-50' : 'bg-amber-50'}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-500">Marge nette</div>
                <div className={`font-bold text-lg ${analysis.margeLast3 >= 0 ? 'text-blue-700' : 'text-red-700'}`}>{fmt(analysis.margeLast3)}</div>
                <div className="text-xs text-gray-400">/mois</div>
              </div>
              <MiniSparkline data={analysis.sparkNet} color={analysis.margeLast3 >= 0 ? '#2563eb' : '#dc2626'} />
            </div>
          </div>
        </div>

        {/* Graphique barres */}
        {analysis.barData.length > 0 && (
          <div className="mb-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={analysis.barData} barCategoryGap="20%">
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="entrees" name="Entrées" fill="#22c55e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="sorties" name="Sorties" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Donut charts côte à côte */}
        <div className="grid grid-cols-2 gap-4">
          {/* Camembert dépenses */}
          {analysis.pieMain.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1 text-center">Répartition sorties</div>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={analysis.pieMain} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {analysis.pieMain.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          {/* Donut CA */}
          {(analysis.caDonut[0]?.value > 0 || analysis.caDonut[1]?.value > 0) && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1 text-center">Répartition CA</div>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={analysis.caDonut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    <Cell fill="#22c55e" />
                    <Cell fill="#3b82f6" />
                  </Pie>
                  <Tooltip formatter={(v) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="text-center text-xs mt-1">
                <span className="text-green-600 font-medium">Direct {analysis.totalCAFormations + analysis.totalCASousTrait > 0 ? ((analysis.totalCAFormations / (analysis.totalCAFormations + analysis.totalCASousTrait)) * 100).toFixed(0) : 0}%</span>
                {' '}/{' '}
                <span className="text-blue-600 font-medium">Sous-traitance {analysis.totalCAFormations + analysis.totalCASousTrait > 0 ? ((analysis.totalCASousTrait / (analysis.totalCAFormations + analysis.totalCASousTrait)) * 100).toFixed(0) : 0}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Projection trimestre */}
        <div className="mt-4 pt-4 border-t">
          <h4 className="text-sm font-bold text-gray-700 mb-2"> Projection trimestre</h4>
          <div className="grid grid-cols-3 gap-2">
            {analysis.trimProjection.map((m, i) => (
              <div key={i} className={`p-3 rounded-lg border ${m.isCurrent ? 'border-blue-400 bg-blue-50' : 'border-gray-200'} ${m === analysis.moisTendu && m.solde < config.marge_securite ? 'ring-2 ring-red-300' : ''}`}>
                <div className="text-xs font-medium text-gray-500">{m.label} {m.isCurrent && <span className="text-blue-600">← en cours</span>}</div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-green-600">CA: {fmt(m.ca)}</span>
                  <span className="text-xs text-red-600">Dép: {fmt(m.dep)}</span>
                </div>
                {m.caPipe > 0 && <div className="text-xs text-purple-500">dont pipeline: {fmt(m.caPipe)}</div>}
                <div className={`font-bold text-sm mt-1 ${m.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  Net: {m.net >= 0 ? '+' : ''}{fmt(m.net)}
                </div>
                <div className={`text-xs mt-0.5 ${m.solde >= config.marge_securite ? 'text-blue-600' : 'text-red-600'}`}>
                  Solde: {fmt(m.solde)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══ BLOC 4 - Pipeline ══ */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-gray-700"> Pipeline - CA prévu</h3>
            <span className="text-xs text-gray-400">
              {pipeline.filter(p => p.source === 'auto').length} devis · {pipeline.filter(p => p.source === 'manual').length} manuels
            </span>
          </div>
          <button onClick={() => setShowPipeForm(f => !f)} className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded-lg hover:bg-blue-200">
            {showPipeForm ? ' Fermer' : '+ Manuel'}
          </button>
        </div>

        {showPipeForm && (
          <div className="mb-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <input type="text" placeholder="Client" value={newPipe.client} onChange={e => setNewPipe(p => ({ ...p, client: e.target.value }))}
                className="border rounded px-2 py-1.5 text-xs" />
              <input type="number" placeholder="Montant TTC" value={newPipe.amount_ttc} onChange={e => setNewPipe(p => ({ ...p, amount_ttc: e.target.value }))}
                className="border rounded px-2 py-1.5 text-xs" />
              <input type="month" value={newPipe.expected_month} onChange={e => setNewPipe(p => ({ ...p, expected_month: e.target.value }))}
                className="border rounded px-2 py-1.5 text-xs" />
              {associates.length > 0 ? (
                <select value={newPipe.trainer} onChange={e => setNewPipe(p => ({ ...p, trainer: e.target.value }))}
                  className="border rounded px-2 py-1.5 text-xs">
                  {associates.map(a => <option key={a.slug} value={a.firstName}>{a.firstName}</option>)}
                </select>
              ) : (
                <input type="text" placeholder="Responsable" value={newPipe.trainer} onChange={e => setNewPipe(p => ({ ...p, trainer: e.target.value }))}
                  className="border rounded px-2 py-1.5 text-xs" />
              )}
              <button onClick={addPipeEntry} className="bg-blue-600 text-white rounded px-3 py-1.5 text-xs hover:bg-blue-700">Ajouter</button>
            </div>
            <input type="text" placeholder="Description (optionnel)" value={newPipe.description} onChange={e => setNewPipe(p => ({ ...p, description: e.target.value }))}
              className="border rounded px-2 py-1.5 text-xs w-full mt-2" />
          </div>
        )}

        {pipeline.length === 0 ? (
          <div className="text-center py-4 text-gray-400 text-xs">Les devis envoyés/acceptés apparaîtront ici automatiquement</div>
        ) : (
          <div className="space-y-1">
            {pipeline.sort((a, b) => (a.expected_month || '').localeCompare(b.expected_month || '')).map(p => (
              <div key={p.id} className={`flex items-center justify-between p-2 rounded-lg text-xs ${
                p.source === 'auto' ? 'bg-blue-50/50' : 'bg-gray-50'
              }`}>
                <div className="flex items-center gap-2 flex-1">
                  <span className={`w-2 h-2 rounded-full ${
                    p.status === 'facture' ? 'bg-green-500' : 
                    p.status === 'confirme' ? 'bg-blue-500' : 
                    'bg-amber-500'
                  }`} />
                  {p.source === 'auto' && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      p.quote_status === 'accepted' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {p.quote_status === 'accepted' ? '' : ''} {p.quote_ref}
                    </span>
                  )}
                  {p.source === 'manual' && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500"> manuel</span>
                  )}
                  <span className="font-medium">{p.client}</span>
                  {p.description && <span className="text-gray-400 truncate max-w-48">- {p.description}</span>}
                  <span className="text-gray-400">{p.expected_month || '?'}</span>
                  {p.trainer && <span className="text-gray-400">{p.trainer}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold">{fmt(p.amount_ht)} HT</span>
                  {p.source === 'manual' ? (
                    <>
                      <select value={p.status} onChange={e => updatePipeStatus(p.id, e.target.value)}
                        className="border rounded px-1 py-0.5 text-xs bg-white">
                        <option value="prevu">Prévu</option>
                        <option value="confirme">Confirmé</option>
                        <option value="facture">Facturé</option>
                        <option value="annule">Annulé</option>
                      </select>
                      <button onClick={() => deletePipe(p.id)} className="text-red-400 hover:text-red-600">Supprimer</button>
                    </>
                  ) : (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      p.quote_status === 'accepted' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                    }`}>{p.quote_status === 'accepted' ? 'Accepté' : 'Envoyé'}</span>
                  )}
                </div>
              </div>
            ))}
            <div className="text-right text-xs text-gray-500 pt-1">
              Total pipeline : <b>{fmt(pipeline.reduce((s, p) => s + (p.amount_ht || 0), 0))} HT</b>
              {pipeline.filter(p => p.source === 'auto').length > 0 && (
                <span className="ml-2">
                  (dont <span className="text-green-600">{fmt(pipeline.filter(p => p.source === 'auto').reduce((s, p) => s + (p.amount_ht || 0), 0))}</span> devis acceptés)
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ══ BLOC 5 - Recommandations auto ══ */}
      {analysis.recos.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <h3 className="font-bold text-gray-700 mb-3"> Recommandations</h3>
          <div className="space-y-2">
            {analysis.recos.map((reco, i) => (
              <div key={i} className={`p-3 rounded-lg border-l-4 ${
                reco.type === 'alert' ? 'bg-red-50 border-red-500' :
                reco.type === 'optimisation' ? 'bg-amber-50 border-amber-500' :
                reco.type === 'levier' ? 'bg-blue-50 border-blue-500' :
                'bg-green-50 border-green-500'
              }`}>
                <div className="flex items-start gap-2">
                  <span className="text-lg">{reco.icon}</span>
                  <div>
                    <div className="font-medium text-sm text-gray-800">{reco.title}</div>
                    <div className="text-xs text-gray-600 mt-0.5">{reco.detail}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ BLOC 5b - Formations à pousser ══ */}
      {analysis.formationsRank.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <h3 className="font-bold text-gray-700 mb-3"> Formations - Classement rentabilité</h3>
          <div className="space-y-2">
            {analysis.formationsRank.map((f, i) => {
              const ratio = f.prixCatalogue > 0 && f.prixMoyenRealise > 0 ? ((f.prixMoyenRealise / f.prixCatalogue) * 100).toFixed(0) : null
              const isTop = f.prixCatalogue >= 690
              return (
                <div key={f.id || i} className={`p-3 rounded-lg border ${isTop ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${isTop ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-600'}`}>{f.code}</span>
                      <span className="text-sm font-medium text-gray-800">{f.title}</span>
                    </div>
                    <span className="font-mono font-bold text-green-700">{fmt(f.prixCatalogue)} HT</span>
                  </div>
                  <div className="flex gap-4 mt-1 text-xs text-gray-500">
                    <span>{f.nbDone} session(s) réalisée(s)</span>
                    {f.nbDone > 0 && <span>Prix moyen réalisé : {fmt(f.prixMoyenRealise)} {ratio && ratio < 80 ? <span className="text-amber-600">( {ratio}% du tarif)</span> : ''}</span>}
                    {f.sesFutures > 0 && <span className="text-blue-600">{f.sesFutures} à venir</span>}
                    {isTop && f.sesFutures === 0 && f.nbDone < 3 && <span className="text-red-500 font-medium">→ À développer !</span>}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200 text-xs text-blue-800">
             <b>Stratégie :</b> Prioriser en vente directe les formations au tarif catalogue le plus élevé (classement ci-dessus).
            Les formations courtes à petit tarif sont idéales en pack combiné pour augmenter le panier moyen.
          </div>
        </div>
      )}

      {/* ══ BLOC 5c - Sessions planifiées ══ */}
      {Object.keys(analysis.sessionsByMonth).length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-700"> Sessions planifiées</h3>
            <span className="text-sm font-mono font-bold text-green-700">{fmt(analysis.sessionsTotal)} HT</span>
          </div>
          {Object.entries(analysis.sessionsByMonth).sort(([a], [b]) => a.localeCompare(b)).map(([ym, sesList]) => {
            const [y, m] = ym.split('-')
            const total = sesList.reduce((s, ses) => s + ses.prix, 0)
            return (
              <div key={ym} className="mb-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-gray-600">{ML[m]} {y}</span>
                  <span className="text-xs font-mono text-gray-500">{sesList.length} session(s) - {fmt(total)} HT</span>
                </div>
                <div className="space-y-1">
                  {sesList.map(ses => (
                    <div key={ses.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-gray-50">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">{ses.start_date.substring(5)}</span>
                        <span className="font-medium">{ses.courseCode}</span>
                        <span className="text-gray-500">- {ses.clientName}</span>
                      </div>
                      <span className="font-mono font-medium text-green-600">{fmt(ses.prix)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ══ BLOC 6 - Plan d'action ══ */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-gray-700"> Plan d'action</h3>
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{doneCount}/{actions.length} fait{doneCount > 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {[{ k: 'active', l: 'En cours' }, { k: 'done', l: 'Faits' }, { k: 'all', l: 'Tous' }].map(f => (
                <button key={f.k} onClick={() => setActionFilter(f.k)}
                  className={`text-xs px-2 py-1 rounded ${actionFilter === f.k ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100'}`}>{f.l}</button>
              ))}
            </div>
            <button onClick={() => setShowActionForm(f => !f)}
              className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded-lg hover:bg-blue-200">
              {showActionForm ? '' : '+ Ajouter'}
            </button>
          </div>
        </div>

        {showActionForm && (
          <div className="mb-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <input type="text" placeholder="Titre de l'action" value={newAction.title} onChange={e => setNewAction(a => ({ ...a, title: e.target.value }))}
                className="border rounded px-2 py-1.5 text-xs col-span-2" />
              <select value={newAction.category} onChange={e => setNewAction(a => ({ ...a, category: e.target.value }))}
                className="border rounded px-2 py-1.5 text-xs">
                <option value="general">Général</option>
                <option value="tresorerie">Trésorerie</option>
                <option value="charges">Charges</option>
                <option value="ca">CA / Ventes</option>
              </select>
              <input type="number" placeholder="Impact €/mois" value={newAction.impact_monthly} onChange={e => setNewAction(a => ({ ...a, impact_monthly: e.target.value }))}
                className="border rounded px-2 py-1.5 text-xs" />
            </div>
            <div className="flex gap-2 mt-2">
              <input type="text" placeholder="Détail (optionnel)" value={newAction.detail} onChange={e => setNewAction(a => ({ ...a, detail: e.target.value }))}
                className="border rounded px-2 py-1.5 text-xs flex-1" />
              <input type="date" value={newAction.due_date} onChange={e => setNewAction(a => ({ ...a, due_date: e.target.value }))}
                className="border rounded px-2 py-1.5 text-xs" />
              <button onClick={addAction} className="bg-blue-600 text-white rounded px-4 py-1.5 text-xs hover:bg-blue-700">Ajouter</button>
            </div>
          </div>
        )}

        {filteredActions.length === 0 ? (
          <div className="text-center py-4 text-gray-400 text-xs">
            {actionFilter === 'done' ? 'Aucune action terminée' : 'Aucune action en cours - ajoutez-en !'}
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredActions.map(action => (
              <div key={action.id} className={`p-3 rounded-lg border transition-all ${
                action.status === 'done' ? 'bg-green-50/50 border-green-200 opacity-60' :
                action.status === 'in_progress' ? 'bg-blue-50 border-blue-200' :
                action.status === 'not_applicable' ? 'bg-gray-50 border-gray-200 opacity-40' :
                'bg-white border-gray-200'
              }`}>
                <div className="flex items-start gap-2">
                  <button onClick={() => {
                    const idx = statusCycle.indexOf(action.status)
                    const next = statusCycle[(idx + 1) % statusCycle.length]
                    updateActionStatus(action.id, next)
                  }} className="text-lg mt-0.5 hover:scale-110 transition-transform" title="Cliquer pour changer le statut">
                    {statusIcons[action.status]}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${action.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800'}`}>{action.title}</span>
                      <span className="text-xs text-gray-300">{statusLabels[action.status]}</span>
                      {action.impact_monthly > 0 && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{fmt(action.impact_monthly)}/mois</span>}
                      {action.due_date && <span className="text-xs text-gray-400">{action.due_date}</span>}
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        action.category === 'tresorerie' ? 'bg-purple-100 text-purple-600' :
                        action.category === 'charges' ? 'bg-red-100 text-red-600' :
                        action.category === 'ca' ? 'bg-green-100 text-green-600' :
                        'bg-gray-100 text-gray-500'
                      }`}>{action.category}</span>
                    </div>
                    {action.detail && <div className="text-xs text-gray-500 mt-0.5">{action.detail}</div>}
                    {/* Mini note éditable */}
                    <input type="text" placeholder="Ajouter un commentaire..." value={action.note || ''}
                      onChange={e => updateActionNote(action.id, e.target.value)}
                      className="text-xs border-0 border-b border-transparent hover:border-gray-200 focus:border-blue-300 w-full mt-1 px-0 py-0.5 bg-transparent focus:outline-none focus:ring-0" />
                  </div>
                  <button onClick={() => deleteAction(action.id)} className="text-gray-300 hover:text-red-500 text-xs">Supprimer</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Résumé impact */}
        {actions.filter(a => a.status === 'done' && a.impact_monthly > 0).length > 0 && (
          <div className="mt-3 p-2 bg-green-50 rounded-lg border border-green-200 text-xs text-green-700 flex justify-between">
            <span> Impact des actions réalisées</span>
            <span className="font-bold">{fmt(actions.filter(a => a.status === 'done' && a.impact_monthly > 0).reduce((s, a) => s + a.impact_monthly, 0))}/mois</span>
          </div>
        )}
      </div>

      {/* ══ Détail charges fixes ══ */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <details>
          <summary className="font-bold text-gray-700 cursor-pointer hover:text-blue-600">
             Charges fixes validées - {fmt(analysis.avgFixed)}/mois
          </summary>
          <p className="text-xs text-gray-400 mt-2 mb-3">Montants réels validés. Cliquer sur un montant pour modifier.</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {analysis.fixedDetail.map((c) => {
              const dbKey = chargesFixes[c.name]?.key || null
              return (
                <div key={c.name} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                  <span>{c.icon}</span>
                  <div className="flex-1 text-xs text-gray-700">{c.name}</div>
                  <input type="number" value={c.monthly} 
                    onChange={e => {
                      const val = +e.target.value
                      setChargesFixes(prev => ({ ...prev, [c.name]: { ...prev[c.name], montant: val } }))
                      if (dbKey) saveConfig(dbKey, val)
                    }}
                    className="w-20 text-right font-mono text-sm font-bold text-red-600 bg-transparent border-0 border-b border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none px-1 py-0.5" />
                </div>
              )
            })}
          </div>
          <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200 flex justify-between items-center">
            <span className="font-bold text-red-800">Total charges fixes mensuelles</span>
            <span className="font-mono text-xl font-bold text-red-700">{fmt(analysis.avgFixed)}</span>
          </div>
        </details>
      </div>
    </div>
  )
}

// CLIENT SEARCH - Recherche intelligente pour rapprochement
// ════════════════════════════════════════════════════════════
function ClientSearchForMatch({ clients: clientsProp, invoices: invoicesProp, unpaidInvoices, bankDescription, onSelect }) {
  const [search, setSearch] = useState('')
  const [localClients, setLocalClients] = useState([])
  const [localInvoices, setLocalInvoices] = useState([])
  const [loaded, setLoaded] = useState(false)

  // Fallback : charger les données directement si les props sont vides
  useEffect(() => {
    async function loadDirect() {
      if (clientsProp?.length > 0 && invoicesProp?.length > 0) {
        setLocalClients(clientsProp)
        setLocalInvoices(invoicesProp)
        setLoaded(true)
        return
      }
      console.log('[ClientSearch] Props vides, chargement direct...', { clientsProp: clientsProp?.length, invoicesProp: invoicesProp?.length })
      const [cR, iR] = await Promise.all([
        fetchAll(() => supabase.from('clients').select('*').order('name')),
        fetchAll(() => supabase.from('invoices').select('*').order('invoice_date', { ascending: false })),
      ])
      setLocalClients(cR)
      setLocalInvoices(iR)
      setLoaded(true)
      console.log('[ClientSearch] Chargé:', cR.length, 'clients,', iR.length, 'factures')
    }
    loadDirect()
  }, [clientsProp, invoicesProp])

  const clients = localClients.length > 0 ? localClients : (clientsProp || [])
  const invoices = localInvoices.length > 0 ? localInvoices : (invoicesProp || [])

  const localUnpaid = useMemo(() =>
    invoices.filter(inv => inv.type !== 'credit_note' && ['sent', 'due', 'overdue', 'partial'].includes(inv.status) && parseFloat(inv.amount_due) > 0),
    [invoices]
  )

  // Normalise accents + majuscules : "opé" → "OPE", "OPÉRATEUR" → "OPERATEUR"
  const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()

  // Extraire des mots-clés utiles du libellé bancaire
  const bankWords = useMemo(() => {
    const desc = norm(bankDescription)
    return desc
      .replace(/VIR\b|CHQ\b|PRLV\b|REM\b|SEPA|INST|BRET|FACT[-\d]*|\d{5,}|[,.]?\d+[,.]\d+|\b\d+\b/g, ' ')
      .split(/[\s\-_\/]+/)
      .filter(w => w.length >= 3)
      .filter((w, i, arr) => arr.indexOf(w) === i)
  }, [bankDescription])

  // Scoring de pertinence pour chaque client
  const scoredClients = useMemo(() => {
    const s = norm(search)
    const searchWords = s ? s.split(/\s+/).filter(w => w.length >= 2) : []

    return clients.map(c => {
      const name = norm(c.name)
      const nameWords = name.split(/[\s\-_]+/)
      let score = 0

      // Score basé sur la recherche utilisateur
      if (s) {
        if (name.includes(s)) score += 100
        if (name.startsWith(s)) score += 50
        for (const sw of searchWords) {
          if (name.includes(sw)) score += 30
          if (sw.length >= 3 && nameWords.some(nw => nw.startsWith(sw))) score += 20
        }
      }

      // Score basé sur les mots du libellé bancaire
      for (const bw of bankWords) {
        if (name.includes(bw)) score += 20
        if (nameWords.some(nw => nw === bw)) score += 10
      }

      // Bonus si factures
      const unpaidCount = localUnpaid.filter(inv => inv.client_id === c.id).length
      const allInvCount = invoices.filter(inv => inv.client_id === c.id).length
      if (unpaidCount > 0) score += 15
      if (allInvCount > 0) score += 5

      return { ...c, score, unpaidCount, allInvCount }
    })
    .filter(c => {
      if (!s) return c.allInvCount > 0 || c.score > 0
      return c.score > 0
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
  }, [clients, search, bankWords, invoices, localUnpaid])

  return (
    <div>
      <p className="text-sm text-gray-700 mb-2">Sélectionnez le client : <span className="text-xs text-gray-400">({clients.length} clients chargés)</span></p>

      {!loaded && <div className="text-center py-4 text-gray-400 text-sm"> Chargement des clients...</div>}

      {bankWords.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          <span className="text-xs text-gray-400">Mots détectés :</span>
          {bankWords.slice(0, 8).map((w, i) => (
            <button key={i} onClick={() => setSearch(w)}
              className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded hover:bg-blue-100 cursor-pointer">{w}</button>
          ))}
        </div>
      )}

      <input type="text" value={search} onChange={e => setSearch(e.target.value)}
        placeholder=" Rechercher un client (nom, mot-clé)..."
        className="w-full border-2 border-blue-300 rounded-lg px-3 py-2 text-sm mb-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500" autoFocus />

      <div className="max-h-64 overflow-y-auto space-y-1">
        {scoredClients.length === 0 ? (
          <div className="text-center py-6 text-gray-400">
            <p className="text-sm">{search ? `Aucun client trouvé pour "${search}"` : 'Aucun client trouvé'}</p>
            <p className="text-xs mt-1">Tapez un nom ou un mot du libellé bancaire</p>
          </div>
        ) : (
          scoredClients.map(c => (
            <button key={c.id} onClick={() => onSelect(c.id)}
              className={`w-full text-left p-2.5 border rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors text-sm
                ${c.score >= 20 ? 'border-blue-200 bg-blue-50/50' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{c.name}</span>
                <div className="flex gap-1">
                  {c.score >= 20 && !search && <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded"> suggestion</span>}
                  {c.unpaidCount > 0 && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{c.unpaidCount} en attente</span>}
                  {c.unpaidCount === 0 && c.allInvCount > 0 && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{c.allInvCount} fact.</span>}
                </div>
              </div>
              {c.city && <span className="text-xs text-gray-400">{c.city}</span>}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function MealGuestModal({ transactionId, transaction, clients, associates = [], onClose, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mealFor, setMealFor] = useState(() => defaultAssociateSlug(associates))
  const [nbConvives, setNbConvives] = useState(2)
  const [motif, setMotif] = useState('')
  const [guests, setGuests] = useState([])
  const [existing, setExisting] = useState([])
  const [showProspect, setShowProspect] = useState(false)
  const [prospectInit, setProspectInit] = useState({})

  useEffect(() => {
    loadExisting()
  }, [transactionId])

  async function loadExisting() {
    setLoading(true)
    const { data } = await supabase.from('budget_meal_guests').select('*').eq('transaction_id', transactionId)
    if (data && data.length > 0) {
      setExisting(data)
      setMealFor(data[0].meal_for || defaultAssociateSlug(associates))
      setNbConvives(data[0].nb_convives || 2)
      setMotif(data[0].motif || '')
      setGuests(data.filter(g => g.guest_name).map(g => ({
        id: g.id,
        name: g.guest_name || '',
        company: g.guest_company || '',
        client_id: g.client_id || '',
      })))
    }
    setLoading(false)
  }

  function addGuest() { setGuests(prev => [...prev, { name: '', company: '', client_id: '' }]) }
  function updateGuest(idx, field, value) { setGuests(prev => prev.map((g, i) => i === idx ? { ...g, [field]: value } : g)) }
  function removeGuest(idx) { setGuests(prev => prev.filter((_, i) => i !== idx)) }

  async function handleSave() {
    setSaving(true)
    try {
      // Supprimer les anciens
      await supabase.from('budget_meal_guests').delete().eq('transaction_id', transactionId)

      // Insérer les nouveaux
      const guestRows = guests.filter(g => g.name.trim()).map(g => ({
        transaction_id: transactionId,
        ...(mealFor ? { meal_for: mealFor } : {}),
        guest_name: g.name.trim(),
        guest_company: g.company.trim() || null,
        guest_first_name: null,
        client_id: g.client_id || null,
        nb_convives: nbConvives,
        motif: motif || null,
      }))

      if (guestRows.length === 0) {
        // Sauvegarder au moins le meal_for + nb_convives
        await supabase.from('budget_meal_guests').insert({
          transaction_id: transactionId,
          ...(mealFor ? { meal_for: mealFor } : {}),
          nb_convives: nbConvives,
          motif: motif || null,
        })
      } else {
        await supabase.from('budget_meal_guests').insert(guestRows)
      }

      toast.success('Registre invités mis à jour')
      onSaved()
    } catch (err) {
      toast.error('Erreur: ' + err.message)
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-4 border-b bg-amber-50 rounded-t-xl">
          <div>
            <h3 className="font-bold text-amber-800"> Registre repas professionnel</h3>
            {transaction && (
              <p className="text-xs text-amber-600 mt-0.5">
                {new Date(transaction.date).toLocaleDateString('fr-FR')} - {transaction.description?.substring(0, 50)} - <b>{fmt(transaction.debit)}</b>
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">Fermer</button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400"> Chargement...</div>
        ) : (
          <div className="p-4 space-y-3">
            {/* Repas pour qui (associés ; une ancienne valeur en base reste affichée) */}
            {(associates.length > 0 || mealFor) && (
              <div>
                <label className="text-xs text-gray-600 font-medium">Repas pour</label>
                <div className="flex gap-2 mt-1">
                  {[...associates.map(a => ({ v: a.slug, l: a.firstName })),
                    ...(mealFor && !associates.some(a => a.slug === mealFor) ? [{ v: mealFor, l: capitalize(mealFor) }] : [])
                  ].map(o => (
                    <button key={o.v} onClick={() => setMealFor(o.v)} className={`flex-1 py-2 rounded-lg text-sm font-medium border ${mealFor === o.v ? 'bg-blue-500 text-white' : 'bg-white text-gray-600'}`}>{o.l}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Nb convives */}
            <div>
              <label className="text-xs text-gray-600 font-medium">Nombre de convives</label>
              <input type="number" min="1" max="20" value={nbConvives} onChange={e => setNbConvives(parseInt(e.target.value) || 1)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>

            {/* Motif */}
            <div>
              <label className="text-xs text-gray-600 font-medium">Motif du repas</label>
              <input type="text" value={motif} onChange={e => setMotif(e.target.value)} placeholder="Réunion commerciale, prospection, partenariat..." className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>

            {/* Invités */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-600 font-medium">Invités ({guests.length})</label>
                <button onClick={addGuest} className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ Ajouter un invité</button>
              </div>
              <div className="space-y-2 mt-2">
                {guests.map((g, idx) => (
                  <div key={idx} className="flex gap-1.5 items-center">
                    <input type="text" value={g.name} onChange={e => updateGuest(idx, 'name', e.target.value)}
                      placeholder="Nom Prénom" className="flex-1 border rounded px-2 py-1.5 text-sm" />
                    <div className="relative flex-1">
                      <input type="text" value={g.company}
                        onChange={e => { updateGuest(idx, 'company', e.target.value); updateGuest(idx, 'client_id', '') }}
                        placeholder="Entreprise" className="w-full border rounded px-2 py-1.5 text-sm"
                        list={`modal-guest-cli-${idx}`} />
                      <datalist id={`modal-guest-cli-${idx}`}>
                        {(clients || []).filter(c => g.company && c.name.toUpperCase().includes(g.company.toUpperCase())).slice(0, 10).map(c => (
                          <option key={c.id} value={c.name} />
                        ))}
                      </datalist>
                    </div>
                    {g.company && !(clients || []).find(c => c.name.toUpperCase() === g.company.toUpperCase()) && (
                      <button onClick={() => { setProspectInit({ name: g.company, contact_name: g.name }); setShowProspect(true) }}
                        className="text-xs text-emerald-600 hover:text-emerald-800 whitespace-nowrap" title="Créer comme prospect">+</button>
                    )}
                    <button onClick={() => removeGuest(idx)} className="text-red-400 hover:text-red-600">Retirer</button>
                  </div>
                ))}
                {guests.length === 0 && (
                  <p className="text-xs text-gray-400 italic py-2">Aucun invité ajouté - vous pouvez en ajouter maintenant ou plus tard</p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-100">Annuler</button>
          <div className="flex-1" />
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50">
            {saving ? '...' : ' Enregistrer'}
          </button>
        </div>

        {/* Sous-modal prospect */}
        {showProspect && (
          <ProspectCreateModal
            initial={prospectInit}
            onClose={() => setShowProspect(false)}
            onCreated={(newClient) => {
              setShowProspect(false)
              const gIdx = guests.findIndex(g => g.company === prospectInit.name || !g.company)
              if (gIdx >= 0) {
                updateGuest(gIdx, 'company', newClient.name)
                updateGuest(gIdx, 'client_id', newClient.id)
              }
              toast.success(`Prospect "${newClient.name}" créé`)
            }}
          />
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// MODAL CRÉATION PROSPECT (depuis invités ou autre)
// ════════════════════════════════════════════════════════════
function ProspectCreateModal({ initial, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    siret: '',
    address: '',
    postal_code: '',
    city: '',
    phone: '',
    contact_email: '',
    contact_name: initial?.contact_name || '',
    notes: '',
    status: 'prospect',
  })
  const [saving, setSaving] = useState(false)
  const { checkSiren, clearSirenCheck } = useSirenCheck()
  const [sirenConflict, setSirenConflict] = useState(null)

  async function doInsert(formData) {
    setSaving(true)
    try {
      const { data, error } = await supabase.from('clients').insert({
        name: formData.name.trim().toUpperCase(),
        siret: formData.siret || null,
        address: formData.address || null,
        postal_code: formData.postal_code || null,
        city: formData.city || null,
        contact_phone: formData.phone || null,
        contact_email: formData.contact_email || null,
        contact_name: formData.contact_name || null,
        notes: formData.notes || null,
        status: 'prospect',
      }).select().single()
      if (error) throw error
      onCreated(data)
    } catch (err) {
      toast.error('Erreur: ' + err.message)
    }
    setSaving(false)
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Nom requis'); return }
    const cleanSiret = form.siret?.replace(/\s/g, '') || ''
    const cleanSiren = cleanSiret.length >= 9 && !cleanSiret.startsWith('MANUAL_') ? cleanSiret.slice(0, 9) : null
    if (cleanSiren) {
      const matches = await checkSiren(cleanSiren)
      if (matches.length > 0) {
        setSirenConflict({ matches, formData: form })
        return
      }
    }
    await doInsert(form)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b bg-emerald-50 rounded-t-xl">
          <h3 className="font-bold text-emerald-800"> Créer un prospect</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">Fermer</button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs text-gray-600 font-medium">Nom de l'entreprise *</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600">SIRET</label>
              <input type="text" value={form.siret} onChange={e => setForm(f => ({ ...f, siret: e.target.value }))}
                placeholder="XXX XXX XXX XXXXX" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-600">Téléphone</label>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600">Adresse</label>
            <input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600">Code postal</label>
              <input type="text" value={form.postal_code} onChange={e => setForm(f => ({ ...f, postal_code: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-600">Ville</label>
              <input type="text" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600">Nom du contact</label>
              <input type="text" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-600">Email</label>
              <input type="email" value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Contexte, origine du contact..." className="w-full border rounded-lg px-3 py-2 text-sm mt-1" rows={2} />
          </div>
        </div>

        <div className="flex gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-100">Annuler</button>
          <div className="flex-1" />
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
            {saving ? '...' : ' Créer le prospect'}
          </button>
        </div>
      </div>
      {sirenConflict && (
        <SirenConflictModal
          matches={sirenConflict.matches}
          newName={sirenConflict.formData?.name}
          newSiret={sirenConflict.formData?.siret}
          newCity={sirenConflict.formData?.city}
          onUseExisting={async (clientId) => {
            setSirenConflict(null)
            clearSirenCheck()
            const { data } = await supabase.from('clients').select().eq('id', clientId).single()
            if (data) onCreated(data)
          }}
          onCreateAnyway={async () => {
            const formData = sirenConflict.formData
            setSirenConflict(null)
            clearSirenCheck()
            await doInsert(formData)
          }}
          onCancel={() => {
            setSirenConflict(null)
            clearSirenCheck()
          }}
        />
      )}
    </div>
  )
}

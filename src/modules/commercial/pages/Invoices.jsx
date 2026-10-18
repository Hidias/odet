import { toneStyle } from '../../../ui/StatusBadge'
import { orgName, currentUserName, teamNames } from '../../../core/org/currentOrg'
import { apiFetch } from '../../../core/api'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../../core/supabase'
import { fetchAll, fetchAllIn } from '../../../core/fetchAll'
import { useDataStore, useAuthStore } from '../../../core/store'
import { generateFacturXPDF, generateInvoicePDF, calcInvoiceTotals, isDraftDoc } from '../pdf/invoiceGenerator'
import { Sheet } from '../../../ui/Sheet'
import { parseRate } from '../../../core/billing/totals'
import { format, addDays } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import {
  Plus, Search, FileText, Download, Send, Pencil, Trash2, X, ChevronLeft,
  CreditCard, AlertTriangle, CheckCircle, Clock, Ban, Copy, Receipt, Mail, Eye, Stamp
} from 'lucide-react'
import { money, fmtDate as fmtDateShort, calcLineTotal as calcItemTotal } from '../../../core/utils'
import SearchSelect, { clientOptions } from '../../../ui/SearchSelect'
import PickerMenu from '../../../ui/PickerMenu'
import { calcDueDate } from '../lib/echeances'

// sent retiré - dès l'envoi on passe directement en "due"
const STATUS_MAP = {
  draft:    { label: 'Brouillon',  color: 'gray',   icon: FileText },
  due:      { label: 'À régler',   color: 'yellow', icon: Clock },
  overdue:  { label: 'En retard',  color: 'red',    icon: AlertTriangle },
  partial:  { label: 'Partiel',    color: 'orange', icon: CreditCard },
  paid:     { label: 'Payée',      color: 'green',  icon: CheckCircle },
  cancelled:{ label: 'Annulée',    color: 'gray',   icon: Ban },
  credited: { label: 'Annulée par avoir', color: 'gray', icon: Ban },
}
// Statuts affichés pour un avoir (gérés par le trigger SQL trg_invoices_credit_sync)
//   draft → brouillon (aucun effet) | due → reste à rembourser | paid → imputé ou remboursé
const CREDIT_STATUS_MAP = {
  draft: { label: 'Brouillon',    color: 'gray',   icon: FileText },
  due:   { label: 'À rembourser', color: 'orange', icon: Clock },
  paid:  { label: 'Imputé',       color: 'green',  icon: CheckCircle },
}
const getStatusInfo = (inv) => {
  if (inv?.type === 'credit_note') {
    if (inv.status === 'paid' && (parseFloat(inv.amount_paid) || 0) > 0.01) return { label: 'Remboursé', color: 'green', icon: CheckCircle }
    return CREDIT_STATUS_MAP[inv.status] || CREDIT_STATUS_MAP.draft
  }
  return STATUS_MAP[inv?.status] || STATUS_MAP.draft
}
// Statuts d'une facture émise sur laquelle un avoir peut être établi
const CREDITABLE_STATUSES = ['sent', 'due', 'overdue', 'partial', 'paid']
const PAYMENT_METHODS = ['virement bancaire','chèque','prélèvement','carte bancaire','espèces']
const PAYMENT_TERMS = ['À réception de facture','à 30 jours','à 30 jours fin de mois','à 45 jours','à 45 jours fin de mois','à 60 jours','à 60 jours fin de mois']
//  BUG UTC : new Date('2026-08-17') est interprété comme MINUIT UTC.
// Comparé à new Date() (heure locale Paris, UTC+1/+2), une facture due
// AUJOURD'HUI ressort systématiquement "en retard" dès 2h du matin.
// Les dates SQL étant des chaînes 'YYYY-MM-DD', on les compare entre chaînes :
// exact, insensible au fuseau, et l'ordre alphabétique = l'ordre chronologique.
const todayISO = () => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// true seulement si l'échéance est STRICTEMENT passée (hier ou avant)
const isOverdue = (dueDate) => !!dueDate && String(dueDate).slice(0, 10) < todayISO()

// Nombre de jours de retard, calculé sur des dates calendaires (pas d'heures)
const daysLate = (dueDate) => {
  if (!dueDate) return 0
  const [y, m, d] = String(dueDate).slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = todayISO().split('-').map(Number)
  const diff = Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)
  return Math.max(0, Math.round(diff / 86400000))
}

const TVA_RATES = [0,2.1,5.5,8.5,10,20]
const emptyItem = () => ({code:'',description_title:'',description_detail:'',quantity:1,unit:'unité',unit_price_ht:0,tva_rate:20,course_id:null})

// ─── Templates email selon rang de relance ───
function getEmailTemplate(inv, relanceNumber, org = {}) {
  const ref = inv.reference || ''
  const ttc = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(parseFloat(inv.total_ttc) || 0) + ' €'

  // Avoir : un seul modèle (pas de relance)
  if (inv.type === 'credit_note') {
    const parentRef = inv.parent_reference || ''
    const refundDue = parseFloat(inv.amount_due) || 0
    const refundTxt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(refundDue) + ' €'
    const refundMethod = inv.payment_method || 'virement bancaire'
    const detail = refundDue > 0.01
      ? `Le montant de ${refundTxt} TTC vous sera remboursé par ${refundMethod} dans les meilleurs délais.`
      : `Ce montant vient en déduction des sommes dues au titre de cette facture.`
    return {
      subject: `Avoir N° ${ref} - ${orgName()}`,
      body: `Madame, Monsieur,

Veuillez trouver ci-joint notre avoir N° ${ref} d'un montant de ${ttc} TTC, émis en régularisation de la facture N° ${parentRef}.

${detail}

Restant à votre disposition pour tout renseignement complémentaire,`
    }
  }

  const dueDate = inv.due_date
    ? String(inv.due_date).slice(0, 10).split('-').reverse().join('/')
    : 'l\'échéance'
  const paymentTerms = inv.payment_terms || 'à 30 jours'
  const paymentMethod = inv.payment_method || 'virement bancaire'
  const objet = inv.object || 'prestation de formation'
  // Coordonnées bancaires lues dans Paramètres > Banque et facturation ; ligne absente si l'IBAN n'est pas saisi
  const iban = String(org?.iban || '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
  const rib = iban
    ? `RIB : ${iban}${org?.bic ? ` - BIC : ${org.bic}` : ''}${org?.bank_name ? ` (${org.bank_name})` : ''}`
    : ''

  if (relanceNumber === 1) {
    return {
      subject: `Facture N° ${ref} - ${orgName()}`,
      body: `Madame, Monsieur,

Veuillez trouver ci-joint notre facture N° ${ref} d'un montant de ${ttc} TTC au titre de : ${objet}.

Conformément à nos conditions de règlement (${paymentTerms}), nous vous remercions de bien vouloir procéder au règlement par ${paymentMethod} avant le ${dueDate}.${rib ? `\n\n${rib}` : ''}

Restant à votre disposition pour tout renseignement complémentaire,`
    }
  } else if (relanceNumber === 2) {
    return {
      subject: `Relance - Facture N° ${ref} - ${orgName()}`,
      body: `Madame, Monsieur,

Sauf erreur de notre part, la facture N° ${ref} d'un montant de ${ttc} TTC, dont l'échéance était fixée au ${dueDate}, n'a pas encore été réglée.

Nous vous remercions de bien vouloir procéder au règlement dans les meilleurs délais par ${paymentMethod}.${rib ? `\n\n${rib}` : ''}

Restant à votre disposition,`
    }
  } else if (relanceNumber === 3) {
    return {
      subject: `2ème relance - Facture N° ${ref} - ${orgName()}`,
      body: `Madame, Monsieur,

Nous revenons vers vous concernant la facture N° ${ref} d'un montant de ${ttc} TTC, échue le ${dueDate}, qui demeure à ce jour impayée malgré notre première relance.

Nous vous demandons de bien vouloir régulariser cette situation dans un délai de 8 jours.${rib ? `\n\n${rib}` : ''}

Dans l'attente de votre règlement,`
    }
  } else {
    const nRelance = relanceNumber - 1
    return {
      subject: `URGENT - ${nRelance}ème relance - Facture N° ${ref} impayée`,
      body: `Madame, Monsieur,

En l'absence de règlement de la facture N° ${ref} d'un montant de ${ttc} TTC échue le ${dueDate}, et malgré nos ${nRelance - 1} précédentes relances restées sans suite, nous nous voyons contraints de vous adresser cette mise en demeure de payer.

Sans retour de votre part sous 5 jours ouvrés, nous serons dans l'obligation d'engager une procédure de recouvrement dont les frais vous seraient imputés.

${rib}`
    }
  }
}

export default function Invoices() {
  const { organization, fetchOrganization } = useDataStore()
  useEffect(() => { if (!organization) fetchOrganization() }, [])
  const [searchParams, setSearchParams] = useSearchParams()
  const [mode, setMode] = useState('list')
  const [invoices, setInvoices] = useState([])
  const [clients, setClients] = useState([])
  const [contacts, setContacts] = useState([])
  const [quotes, setQuotes] = useState([])
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Émission (Facturation fiable) : numéro donné par la base, contenu figé ensuite
  // Droits connus : ils décident ; inconnus (avant C1b) : boutons affichés, la base refuse ce qui n'est pas permis
  const canDroit = useAuthStore((st) => st.can)
  useAuthStore((st) => st.rights)
  const droitOuRepli = (code) => canDroit(code) !== false
  const droitsFac = { valider: droitOuRepli('facturation.factures.valider'), avoir: droitOuRepli('facturation.avoirs.emettre'), modifier: droitOuRepli('facturation.factures.modifier') }
  const [emission, setEmission] = useState(null) // { inv, items, totaux, verifie, enCours }
  const [exporting, setExporting] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [relanceFilter, setRelanceFilter] = useState(false)
  const [current, setCurrent] = useState(null)
  const [items, setItems] = useState([emptyItem()])
  const [payments, setPayments] = useState([])
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [paymentForm, setPaymentForm] = useState({amount:'',payment_date:format(new Date(),'yyyy-MM-dd'),payment_method:'virement bancaire',payment_reference:'',notes:''})
  const [showQuoteSelector, setShowQuoteSelector] = useState(false)
  const [quoteSearch, setQuoteSearch] = useState('')
  const [showSessionSelector, setShowSessionSelector] = useState(false)
  const [sessionSearch, setSessionSearch] = useState('')
  const [completedSessions, setCompletedSessions] = useState([])
  const [selectedSessionIds, setSelectedSessionIds] = useState([])
  const [sortField, setSortField] = useState('invoice_date')
  const [sortDir, setSortDir] = useState('desc')
  const [showGroupedModal, setShowGroupedModal] = useState(false)
  const [groupedSessions, setGroupedSessions] = useState([])
  const [groupedClientId, setGroupedClientId] = useState('')
  const [groupedMonth, setGroupedMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [groupedClientSearch, setGroupedClientSearch] = useState('')
  const [groupedClientOpen, setGroupedClientOpen] = useState(false)
  // ─── Envoi / relance email ───
  const [invoiceRelancesMap, setInvoiceRelancesMap] = useState({})
  const [showSendModal, setShowSendModal] = useState(false)
  const [sendModalInv, setSendModalInv] = useState(null)
  const [sendModalRelances, setSendModalRelances] = useState([])
  const [sendModalItems, setSendModalItems] = useState([])
  const [sendModalContact, setSendModalContact] = useState(null)
  const [sendForm, setSendForm] = useState({ to: '', caller: currentUserName(), subject: '', body: '' })
  const [sendingEmail, setSendingEmail] = useState(false)

  // ─── Load ───
  const loadAll = useCallback(async () => {
    setLoading(true)
    const [invR, cliR, courseR, quoteR, relR] = await Promise.all([
      // fetchAll : pagination complète (PostgREST tronque à 1 000 lignes sans erreur)
      fetchAll(() => supabase.from('invoices').select('*, clients!client_id(name,siret,address,postal_code,city), client_contacts!contact_id(name,email,civilite,first_name,last_name)').order('invoice_date', {ascending: false})),
      fetchAll(() => supabase.from('clients').select('id,name,siret,address,postal_code,city,contact_name,contact_email,status,billing_mode,default_payment_terms,client_type').order('name')),
      fetchAll(() => supabase.from('courses').select('id,title,code,price_ht,duration_hours,description').order('title')),
      fetchAll(() => supabase.from('quotes').select('id,reference,client_id,contact_id,object,client_reference,discount_percent,discount_label,tva_applicable,tva_rate,payment_method,payment_terms,session_id,status,total_ht,total_ttc').order('quote_date', {ascending: false})),
      fetchAll(() => supabase.from('invoice_relances').select('invoice_id,relance_number,sent_at,to_email,sent_by').order('sent_at', {ascending: false})),
    ])

    // Construire la map des relances par facture
    const relMap = {}
    for (const r of (relR.data || [])) {
      if (!relMap[r.invoice_id]) relMap[r.invoice_id] = []
      relMap[r.invoice_id].push(r)
    }
    setInvoiceRelancesMap(relMap)

    // Convertir sent → due ou overdue selon due_date
    // (comparaison par chaînes : une facture due aujourd'hui n'est PAS en retard)
    const toUp = (invR.data || []).filter(i =>
      i.type !== 'credit_note' && (i.status === 'sent' || i.status === 'due') && isOverdue(i.due_date)
    )
    // Convertir les anciens statuts sent non échus → due
    const sentToDue = (invR.data || []).filter(i =>
      i.type !== 'credit_note' && i.status === 'sent' && !isOverdue(i.due_date)
    )

    // Garde : seul un compte qui peut modifier les factures fait cette mise à jour à l'ouverture (droits inconnus :
    // comme avant). Les autres voient les statuts tenus à jour chaque nuit par la base (0376, daily_maintenance).
    const peutEcrire = useAuthStore.getState().can('facturation.factures.modifier') !== false
    const updates = []
    if (peutEcrire && toUp.length > 0) updates.push(...toUp.map(i => supabase.from('invoices').update({ status: 'overdue', updated_at: new Date().toISOString() }).eq('id', i.id)))
    if (peutEcrire && sentToDue.length > 0) updates.push(...sentToDue.map(i => supabase.from('invoices').update({ status: 'due', updated_at: new Date().toISOString() }).eq('id', i.id)))

    if (updates.length > 0) {
      await Promise.all(updates)
      const { data: refreshed } = await fetchAll(() => supabase.from('invoices').select('*, clients!client_id(name,siret,address,postal_code,city), client_contacts!contact_id(name,email,civilite,first_name,last_name)').order('invoice_date', {ascending: false}))
      setInvoices(refreshed || [])
    } else {
      setInvoices(invR.data || [])
    }

    setClients(cliR.data || [])
    setCourses(courseR.data || [])
    setQuotes(quoteR.data || [])
    setLoading(false)
    return { quotes: quoteR.data || [], clients: cliR.data || [] }
  }, [])

  useEffect(() => {
    loadAll().then(({ quotes: qs }) => {
      const fq = searchParams.get('from_quote')
      const fs = searchParams.get('from_session')
      const fo = searchParams.get('open')
      if (fo) {
        // Brouillon préparé ailleurs (ex. visite d'intervention) : ouvert directement
        supabase.from('invoices').select('*').eq('id', fo).maybeSingle().then(({ data }) => { if (data) handleEdit(data) })
        setSearchParams({})
      } else if (fq && qs.length > 0) {
        const q = qs.find(x => x.id === fq)
        if (q) { handleFromQuote(q); setSearchParams({}) }
      } else if (fs) {
        handleFromSession(fs); setSearchParams({})
      }
    })
  }, []) // eslint-disable-line

  const loadContacts = async (cid) => {
    if (!cid) { setContacts([]); return }
    const { data } = await supabase.from('client_contacts').select('*').eq('client_id', cid).order('is_primary', {ascending: false})
    setContacts(data || [])
  }
  const loadItems = async (iid) => {
    const { data } = await supabase.from('invoice_items').select('*').eq('invoice_id', iid).order('position')
    setItems(data && data.length > 0 ? data : [emptyItem()])
  }
  // Relit une facture/avoir depuis la base (montants et statut recalculés par le trigger)
  const refreshCurrent = async (iid) => {
    const { data } = await supabase.from('invoices').select('*').eq('id', iid).single()
    if (data) setCurrent(prev => ({...prev, ...data}))
  }
  const loadPayments = async (iid) => {
    const { data } = await supabase.from('invoice_payments').select('*').eq('invoice_id', iid).order('payment_date', {ascending: false})
    setPayments(data || [])
  }

  // ─── Ouvrir modal d'envoi ───
  const openSendModal = async (invArg, e) => {
    if (e) e.stopPropagation()
    setSendingEmail(false)

    // Avoir : référence + date de la facture d'origine (mail et PDF)
    let inv = invArg
    if (invArg.type === 'credit_note' && invArg.parent_invoice_id) {
      const parentInv = invoices.find(i => i.id === invArg.parent_invoice_id)
      inv = { ...invArg, parent_reference: parentInv?.reference || invArg.parent_reference || '', parent_invoice_date: parentInv?.invoice_date || '' }
    }

    // Charger items et contact si pas déjà chargés
    const [itemsR, contactR] = await Promise.all([
      supabase.from('invoice_items').select('*').eq('invoice_id', inv.id).order('position'),
      inv.contact_id ? supabase.from('client_contacts').select('*').eq('id', inv.contact_id).single() : Promise.resolve({ data: null }),
    ])

    // Charger les relances de cette facture
    const { data: relances } = await supabase
      .from('invoice_relances')
      .select('*')
      .eq('invoice_id', inv.id)
      .order('sent_at', { ascending: true })

    const relancesList = relances || []
    const nextRelanceNumber = relancesList.length + 1
    const template = getEmailTemplate(inv, nextRelanceNumber, organization || {})

    // Destinataire : billing contact > contact facture > contact principal > email client
    const contact = contactR.data
    const client = clients.find(c => c.id === inv.client_id)
    let toEmail = ''
    if (contact?.email) toEmail = contact.email
    else if (client?.billing_email) toEmail = client.billing_email
    else if (client?.contact_email) toEmail = client.contact_email
    else if (client?.email) toEmail = client.email

    setSendModalInv(inv)
    setSendModalRelances(relancesList)
    setSendModalItems(itemsR.data || [])
    setSendModalContact(contact)
    setSendForm({
      to: toEmail,
      caller: currentUserName(),
      subject: template.subject,
      body: template.body,
    })
    setShowSendModal(true)
  }

  // ─── Envoyer la facture / relance ───
  const handleSendInvoice = async () => {
    if (!sendForm.to) { toast.error('Destinataire requis'); return }
    if (!sendModalInv) return

    setSendingEmail(true)
    try {
      toast.loading('Génération Factur-X…', { id: 'send-inv' })

      const client = clients.find(c => c.id === sendModalInv.client_id)
      const billingClient = sendModalInv.is_subrogation && sendModalInv.billing_client_id
        ? clients.find(c => c.id === sendModalInv.billing_client_id)
        : null

      // Générer Factur-X en base64 (sans téléchargement)
      const pdfBase64 = await generateFacturXPDF(
        sendModalInv,
        sendModalItems,
        client,
        sendModalContact,
        { returnBase64: true, billingClient, orgSettings: organization },
        billingClient
      )

      toast.loading('Envoi en cours…', { id: 'send-inv' })

      const nextRelanceNumber = sendModalRelances.length + 1

      const res = await apiFetch('/api/send-invoice-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_id: sendModalInv.id,
          to: sendForm.to,
          subject: sendForm.subject,
          body: sendForm.body,
          caller: sendForm.caller,
          relance_number: nextRelanceNumber,
          invoice_ref: sendModalInv.reference,
          pdf_base64: pdfBase64,
        }),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Erreur envoi')


      const label = sendModalInv.type === 'credit_note'
        ? 'Avoir envoyé'
        : (nextRelanceNumber === 1 ? 'Facture envoyée' : `Relance ${nextRelanceNumber - 1} envoyée`)
      toast.success(`${label} à ${sendForm.to}`, { id: 'send-inv', duration: 4000 })
      setShowSendModal(false)
      loadAll()
    } catch (err) {
      console.error('Erreur envoi facture:', err)
      toast.error('Erreur : ' + err.message, { id: 'send-inv' })
    } finally {
      setSendingEmail(false)
    }
  }

  // ─── Référence d'un brouillon ───
  // Aucun numéro avant l'émission (décision du 17/10) : la base remplace cette référence provisoire par
  // « BROUILLON-… » (0362) et donne le numéro définitif à l'émission (billing_issue, 0361).
  const generateReference = async () => 'BROUILLON-' + Math.random().toString(36).slice(2, 12).toUpperCase()

  // ─── New invoice ───
  const handleNew = async (type = 'invoice') => {
    const ref = await generateReference(type), dd = format(addDays(new Date(), 30), 'yyyy-MM-dd')
    setCurrent({
      reference: ref, type, client_id: '', contact_id: '', quote_id: '', session_id: '',
      sellsy_reference: '', client_reference: '',
      invoice_date: format(new Date(), 'yyyy-MM-dd'), service_start_date: '', service_end_date: '', due_date: dd,
      object: '', payment_method: 'virement bancaire', payment_terms: 'à 30 jours', discount_percent: 0, discount_label: '',
      tva_applicable: true, notes: '', created_by: currentUserName(), status: 'draft',
      parent_reference: '', parent_invoice_id: null, amount_paid: 0, is_formation_pro: true,
      is_subrogation: false, billing_client_id: ''
    })
    setItems([emptyItem()]); setPayments([]); setContacts([]); setMode('create')
  }

  // ─── From quote ───
  const handleFromQuote = async (quote) => {
    const ref = await generateReference('invoice'), dd = format(addDays(new Date(), 30), 'yyyy-MM-dd')
    const { data: qItems } = await supabase.from('quote_items').select('*').eq('quote_id', quote.id).order('position')
    let sStart = '', sEnd = '', sRef = ''
    if (quote.session_id) {
      const { data: s } = await supabase.from('sessions').select('start_date,end_date,reference').eq('id', quote.session_id).single()
      if (s) { sStart = s.start_date || ''; sEnd = s.end_date || ''; sRef = s.reference || '' }
    }
    const { data: ccs } = await supabase.from('client_contacts').select('*').eq('client_id', quote.client_id)
    const bc = ccs?.find(c => c.is_billing) || ccs?.find(c => c.is_primary)
    setContacts(ccs || [])
    setCurrent({
      reference: ref, type: 'invoice', client_id: quote.client_id, contact_id: bc?.id || quote.contact_id || '',
      quote_id: quote.id, session_id: quote.session_id || '', sellsy_reference: '', client_reference: quote.client_reference || '',
      invoice_date: format(new Date(), 'yyyy-MM-dd'), service_start_date: sStart, service_end_date: sEnd, due_date: dd,
      object: quote.object || '', payment_method: quote.payment_method || 'virement bancaire', payment_terms: quote.payment_terms || 'à 30 jours',
      discount_percent: quote.discount_percent || 0, discount_label: quote.discount_label || '', tva_applicable: quote.tva_applicable !== false,
      notes: '', created_by: currentUserName(), status: 'draft', parent_reference: quote.reference, parent_invoice_id: null,
      amount_paid: 0, is_formation_pro: true, session_reference: sRef, is_subrogation: false, billing_client_id: '',
      _from_quote: true
    })
    setItems((qItems || []).map((it, i) => ({...it, id: undefined, quote_id: undefined, invoice_id: undefined, position: i})))
    setPayments([]); setShowQuoteSelector(false); setMode('create')
  }

  // ─── Load completed sessions for selector ───
  const openSessionSelector = async () => {
    setSessionSearch('')
    setSelectedSessionIds([])
    const { data } = await supabase.from('sessions')
      .select('id,reference,start_date,end_date,status,is_intra,session_type,client_id,clients(name),courses(title),quote_id')
      .in('status', ['completed', 'in_progress'])
      .order('end_date', {ascending: false})
      .limit(100)
    // Sessions déjà facturées (garde-fou contre la double facturation) : la
    // recherche est faite côté base sur les seules sessions affichées, par lots
    // et sans troncature. Erreur → on bloque plutôt que d'afficher « non facturée ».
    const displayedIds = (data || []).map(s => s.id)
    const { data: existingInvs, error: invErr } = await fetchAllIn(() => supabase.from('invoices').select('session_id'), 'session_id', displayedIds)
    // Factures multi-sessions : table de liaison invoice_sessions (sans colonne id)
    const { data: linkedInvs, error: linkErr } = await fetchAllIn(() => supabase.from('invoice_sessions').select('session_id'), 'session_id', displayedIds, { orderBy: ['invoice_id', 'session_id'] })
    if (invErr || linkErr) { toast.error('Impossible de vérifier les sessions déjà facturées : ' + (invErr || linkErr).message); return }
    const invoicedSessionIds = new Set([...(existingInvs || []), ...(linkedInvs || [])].map(i => i.session_id))
    setCompletedSessions((data || []).map(s => ({...s, already_invoiced: invoicedSessionIds.has(s.id)})))
    setShowSessionSelector(true)
  }

  // ─── From session ───
  const handleFromSession = async (sessionId) => {
    const { data: sess } = await supabase.from('sessions')
      .select('*, clients(id,name,siret,address,postal_code,city,contact_name,contact_email,billing_mode,default_payment_terms,billing_email), courses(title,code,price_ht,duration_hours)')
      .eq('id', sessionId).single()
    if (!sess) { toast.error('Session introuvable'); return }

    const isSubcontract = sess.session_type === 'subcontract'
    if (isSubcontract && sess.subcontract_invoiced) { toast.error('Cette session a déjà été facturée'); return }
    if (sess.clients?.billing_mode === 'monthly') {
      if (!confirm(`Ce client préfère la facturation groupée (fin de mois).\n\nCréer quand même une facture individuelle ?`)) return
    }

    const ref = await generateReference('invoice')
    const clientPaymentTerms = sess.clients?.default_payment_terms || 'à 30 jours'
    const dd = calcDueDate(clientPaymentTerms)
    const { data: ccs } = await supabase.from('client_contacts').select('*').eq('client_id', sess.client_id)
    const bc = ccs?.find(c => c.is_billing) || ccs?.find(c => c.is_primary)
    setContacts(ccs || [])

    const { data: stData } = await supabase.from('session_trainees')
      .select('trainee_id, trainees(first_name,last_name,client_id,clients(name))')
      .eq('session_id', sessionId)
    const traineeNames = (stData || []).map(st => st.trainees).filter(Boolean)
      .map(t => {
        const fullName = `${t.first_name} ${(t.last_name || '').toUpperCase()}`
        if (!sess.is_intra && t.clients?.name) return `${fullName} (${t.clients.name})`
        return fullName
      })
    const traineeSuffix = traineeNames.length > 0 ? `\nStagiaires (${traineeNames.length}) : ${traineeNames.join(', ')}` : ''

    let invoiceItems = []
    if (isSubcontract) {
      const days = Math.max(1, Math.round((new Date(sess.end_date) - new Date(sess.start_date)) / 86400000) + 1)
      const rate = parseFloat(sess.subcontract_daily_rate) || 0
      const courseTitle = sess.subcontract_course_title || 'Formation'
      invoiceItems = [{
        code: '', description_title: `Prestation de formation - ${courseTitle}`,
        description_detail: `Formation du ${fmtDateShort(sess.start_date)}${sess.end_date !== sess.start_date ? ' au ' + fmtDateShort(sess.end_date) : ''}${sess.subcontract_nb_trainees ? ` - ${sess.subcontract_nb_trainees} stagiaire(s)` : ''}${sess.location_name ? ` - ${sess.location_name}` : ''}`,
        quantity: days, unit: 'jour', unit_price_ht: rate, tva_rate: 20, course_id: null, position: 0
      }]
    } else {
      // Prix de la session (net, remise devis incluse) sinon prix formation - même règle que la convention (pdfGenerator)
      // Les lignes du devis ne sont plus recopiées : un devis peut couvrir plusieurs sessions et sa remise
      // est déjà intégrée dans le prix de chaque session créée depuis le devis.
      if (sess.courses) {
        const price = parseFloat(sess.total_price) || parseFloat(sess.courses.price_ht) || 0
        invoiceItems = [{
          code: sess.courses.code || '', description_title: sess.courses.title || '',
          description_detail: `Formation ${sess.is_intra ? 'intra' : 'inter'} du ${fmtDateShort(sess.start_date)}${sess.end_date !== sess.start_date ? ' au ' + fmtDateShort(sess.end_date) : ''}`,
          quantity: 1, unit: 'forfait', unit_price_ht: price, tva_rate: 20, course_id: sess.course_id, position: 0
        }]
      }
    }

    if (traineeSuffix && invoiceItems.length > 0) {
      invoiceItems[0].description_detail = (invoiceItems[0].description_detail || '') + traineeSuffix
    }

    const objectTitle = isSubcontract ? (sess.subcontract_course_title || 'Prestation de formation') : (sess.courses?.title || '')
    const clientRef = isSubcontract ? (sess.subcontract_client_ref || '') : ''

    setCurrent({
      reference: ref, type: 'invoice', client_id: sess.client_id, contact_id: bc?.id || sess.contact_id || '',
      quote_id: isSubcontract ? '' : (sess.quote_id || ''), session_id: sess.id, sellsy_reference: '', client_reference: clientRef,
      invoice_date: format(new Date(), 'yyyy-MM-dd'), service_start_date: sess.start_date || '', service_end_date: sess.end_date || '', due_date: dd,
      object: objectTitle, payment_method: 'virement bancaire', payment_terms: clientPaymentTerms,
      discount_percent: 0, discount_label: '', tva_applicable: true,
      notes: '', created_by: currentUserName(), status: 'draft', parent_reference: '', parent_invoice_id: null, amount_paid: 0, is_formation_pro: true,
      is_subrogation: false, billing_client_id: ''
    })
    setItems(invoiceItems.length > 0 ? invoiceItems : [emptyItem()])
    setPayments([]); setMode('create')
    toast.success(`Facture pré-remplie depuis ${isSubcontract ? 'sous-traitance' : 'la session'} ${objectTitle}`)
  }

  // ─── From several sessions (facture globale, même client) ───
  const handleFromSessions = async (sessionIds) => {
    if (!sessionIds || sessionIds.length === 0) return
    if (sessionIds.length === 1) { handleFromSession(sessionIds[0]); return }
    const { data: sessList } = await supabase.from('sessions')
      .select('*, clients(id,name,billing_mode,default_payment_terms), courses(title,code,price_ht,duration_hours)')
      .in('id', sessionIds)
    const sessionsSorted = (sessList || []).slice().sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')))
    if (sessionsSorted.length !== sessionIds.length) { toast.error('Session introuvable'); return }
    const clientIds = [...new Set(sessionsSorted.map(s => s.client_id))]
    if (clientIds.length > 1) { toast.error('Les sessions sélectionnées doivent appartenir au même client'); return }
    if (sessionsSorted.some(s => s.session_type === 'subcontract')) { toast.error('Sous-traitance : utilisez « Sous-traitance groupée »'); return }
    if (sessionsSorted.some(s => !s.courses)) { toast.error('Une session sélectionnée n\'a pas de formation associée'); return }

    const first = sessionsSorted[0]
    const ref = await generateReference('invoice')
    const clientPaymentTerms = first.clients?.default_payment_terms || 'à 30 jours'
    const dd = calcDueDate(clientPaymentTerms)
    const { data: ccs } = await supabase.from('client_contacts').select('*').eq('client_id', first.client_id)
    const bc = ccs?.find(c => c.is_billing) || ccs?.find(c => c.is_primary)
    setContacts(ccs || [])

    const { data: stData } = await supabase.from('session_trainees')
      .select('session_id, trainee_id, trainees(first_name,last_name,client_id,clients(name))')
      .in('session_id', sessionIds)

    const invoiceItems = sessionsSorted.map((sess, i) => {
      const names = (stData || []).filter(st => st.session_id === sess.id).map(st => st.trainees).filter(Boolean)
        .map(t => {
          const fullName = `${t.first_name} ${(t.last_name || '').toUpperCase()}`
          if (!sess.is_intra && t.clients?.name) return `${fullName} (${t.clients.name})`
          return fullName
        })
      const suffix = names.length > 0 ? `\nStagiaires (${names.length}) : ${names.join(', ')}` : ''
      const price = parseFloat(sess.total_price) || parseFloat(sess.courses.price_ht) || 0
      return {
        code: sess.courses.code || '', description_title: sess.courses.title || '',
        description_detail: `Formation ${sess.is_intra ? 'intra' : 'inter'} du ${fmtDateShort(sess.start_date)}${sess.end_date !== sess.start_date ? ' au ' + fmtDateShort(sess.end_date) : ''}${suffix}`,
        quantity: 1, unit: 'forfait', unit_price_ht: price, tva_rate: 20, course_id: sess.course_id, position: i
      }
    })

    const allDates = sessionsSorted.flatMap(s => [s.start_date, s.end_date]).filter(Boolean).sort()
    const titles = [...new Set(sessionsSorted.map(s => s.courses?.title).filter(Boolean))]
    const objectTitle = `${titles.length === 1 ? titles[0] : 'Formations'} - ${sessionsSorted.length} sessions`
    setCurrent({
      reference: ref, type: 'invoice', client_id: first.client_id, contact_id: bc?.id || first.contact_id || '',
      quote_id: '', session_id: first.id, _session_ids: sessionsSorted.map(s => s.id),
      sellsy_reference: '', client_reference: '',
      invoice_date: format(new Date(), 'yyyy-MM-dd'),
      service_start_date: allDates[0] || '', service_end_date: allDates[allDates.length - 1] || '', due_date: dd,
      object: objectTitle, payment_method: 'virement bancaire', payment_terms: clientPaymentTerms,
      discount_percent: 0, discount_label: '', tva_applicable: true,
      notes: '', created_by: currentUserName(), status: 'draft', parent_reference: '', parent_invoice_id: null, amount_paid: 0, is_formation_pro: true,
      is_subrogation: false, billing_client_id: ''
    })
    setItems(invoiceItems)
    setPayments([]); setMode('create')
    toast.success(`Facture globale pré-remplie : ${sessionsSorted.length} sessions`)
  }

  // ─── Facture groupée sous-traitance ───
  const loadGroupedSessions = async (clientId, month) => {
    if (!clientId || !month) { setGroupedSessions([]); return }
    const [year, m] = month.split('-')
    const startOfMonth = `${year}-${m}-01`
    const lastDay = new Date(parseInt(year), parseInt(m), 0)
    const endOfMonth = `${lastDay.getFullYear()}-${String(lastDay.getMonth()+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`
    const { data } = await supabase.from('sessions')
      .select('id,reference,start_date,end_date,start_time,end_time,subcontract_course_title,subcontract_daily_rate,subcontract_nb_trainees,subcontract_client_ref,subcontract_invoiced,location_name,session_type')
      .eq('client_id', clientId).eq('session_type', 'subcontract')
      .gte('start_date', startOfMonth).lte('start_date', endOfMonth)
      .neq('status', 'cancelled').order('start_date')
    setGroupedSessions(data || [])
  }

  const handleGroupedInvoice = async () => {
    const toInvoice = groupedSessions.filter(s => !s.subcontract_invoiced)
    if (toInvoice.length === 0) { toast.error('Aucune session à facturer'); return }
    const { data: clientData } = await supabase.from('clients').select('id,name,siret,address,postal_code,city,contact_name,contact_email,default_payment_terms').eq('id', groupedClientId).single()
    if (!clientData) { toast.error('Client introuvable'); return }
    const ref = await generateReference('invoice')
    const clientPaymentTerms = clientData.default_payment_terms || 'à 30 jours'
    const dd = calcDueDate(clientPaymentTerms)
    const { data: ccs } = await supabase.from('client_contacts').select('*').eq('client_id', groupedClientId)
    const bc = ccs?.find(c => c.is_billing) || ccs?.find(c => c.is_primary)
    setContacts(ccs || [])
    const invoiceItems = toInvoice.map((sess, i) => {
      const days = Math.max(1, Math.round((new Date(sess.end_date) - new Date(sess.start_date)) / 86400000) + 1)
      const rate = parseFloat(sess.subcontract_daily_rate) || 0
      const courseTitle = sess.subcontract_course_title || 'Formation'
      return {
        code: '', description_title: courseTitle,
        description_detail: `${fmtDateShort(sess.start_date)}${sess.end_date !== sess.start_date ? ' au ' + fmtDateShort(sess.end_date) : ''}${sess.subcontract_nb_trainees ? ` - ${sess.subcontract_nb_trainees} stagiaire(s)` : ''}${sess.location_name ? ` - ${sess.location_name}` : ''}${sess.subcontract_client_ref ? ` - Réf: ${sess.subcontract_client_ref}` : ''}`,
        quantity: days, unit: 'jour', unit_price_ht: rate, tva_rate: 20, course_id: null, position: i
      }
    })
    const allDates = toInvoice.flatMap(s => [s.start_date, s.end_date]).sort()
    const [ym, mm] = groupedMonth.split('-')
    const monthLabel = format(new Date(parseInt(ym), parseInt(mm) - 1), 'MMMM yyyy', { locale: fr })
    setCurrent({
      reference: ref, type: 'invoice', client_id: groupedClientId,
      contact_id: bc?.id || '', quote_id: '', session_id: '',
      _grouped_session_ids: toInvoice.map(s => s.id),
      sellsy_reference: '', client_reference: '',
      invoice_date: format(new Date(), 'yyyy-MM-dd'),
      service_start_date: allDates[0] || '', service_end_date: allDates[allDates.length - 1] || '',
      due_date: dd,
      object: `Prestations de formation - ${monthLabel} (${toInvoice.length} session${toInvoice.length > 1 ? 's' : ''})`,
      payment_method: 'virement bancaire', payment_terms: clientPaymentTerms,
      discount_percent: 0, discount_label: '', tva_applicable: true,
      notes: '', created_by: currentUserName(), status: 'draft',
      parent_reference: '', parent_invoice_id: null, amount_paid: 0,
      is_formation_pro: true, is_subrogation: false, billing_client_id: ''
    })
    setItems(invoiceItems)
    setPayments([])
    setShowGroupedModal(false)
    setMode('create')
    toast.success(`Facture groupée pré-remplie : ${toInvoice.length} session(s) de ${monthLabel}`)
  }

  // ─── Credit note ───
  // Montant TTC déjà crédité (avoirs validés) sur une facture, hors avoir en cours d'édition
  const creditedOf = (invId, excludeId = null) => invoices
    .filter(i => i.type === 'credit_note' && i.parent_invoice_id === invId && i.status !== 'draft' && i.id !== excludeId)
    .reduce((s, i) => s + (parseFloat(i.total_ttc) || 0), 0)
  const creditableOf = (inv, excludeId = null) => Math.max(0, Math.round(((parseFloat(inv?.total_ttc) || 0) - creditedOf(inv?.id, excludeId)) * 100) / 100)

  const handleCreateCreditNote = async (inv, keepRef = null) => {
    const ref = keepRef || await generateReference('credit_note')
    const { data: invItems } = await supabase.from('invoice_items').select('*').eq('invoice_id', inv.id).order('position')
    await loadContacts(inv.client_id)
    setCurrent({
      reference: ref, type: 'credit_note', client_id: inv.client_id, contact_id: inv.contact_id || '', quote_id: inv.quote_id || '',
      session_id: inv.session_id || '', sellsy_reference: '', client_reference: inv.client_reference || '',
      invoice_date: format(new Date(), 'yyyy-MM-dd'), service_start_date: inv.service_start_date || '', service_end_date: inv.service_end_date || '', due_date: '',
      object: 'Avoir sur facture ' + inv.reference, payment_method: inv.payment_method, payment_terms: inv.payment_terms,
      discount_percent: inv.discount_percent || 0, discount_label: inv.discount_label || '', tva_applicable: inv.tva_applicable !== false,
      notes: '', created_by: currentUserName(), status: 'draft', parent_reference: inv.reference, parent_invoice_id: inv.id, amount_paid: 0, amount_due: 0, amount_credited: 0,
      is_formation_pro: inv.is_formation_pro !== false,
      is_subrogation: inv.is_subrogation || false, billing_client_id: inv.billing_client_id || ''
    })
    setItems((invItems || []).map((it, i) => ({...it, id: undefined, invoice_id: undefined, position: i})))
    setPayments([]); setMode('create')
  }

  // ─── Edit / View ───
  const handleEdit = async (inv) => {
    setCurrent({...inv, parent_reference: inv.parent_invoice_id ? (invoices.find(i => i.id === inv.parent_invoice_id)?.reference || '') : ''})
    await loadContacts(inv.client_id); await loadItems(inv.id); await loadPayments(inv.id); setMode('edit')
  }
  const handleView = async (inv) => {
    setCurrent({...inv, parent_reference: inv.parent_invoice_id ? (invoices.find(i => i.id === inv.parent_invoice_id)?.reference || '') : ''})
    await loadContacts(inv.client_id); await loadItems(inv.id); await loadPayments(inv.id); setMode('view')
  }

  // ─── Save ───
  const handleSave = async () => {
    if (!current.client_id) { toast.error('Sélectionnez un client'); return }
    if (!items.some(it => it.description_title)) { toast.error('Ajoutez au moins une ligne'); return }
    const isCreditNote = current.type === 'credit_note'
    if (isCreditNote) {
      if (!current.parent_invoice_id) { toast.error("Un avoir doit être rattaché à sa facture d'origine"); return }
      const parentInv = invoices.find(i => i.id === current.parent_invoice_id)
      const crTotals = calcInvoiceTotals(items, current.discount_percent, current.tva_applicable)
      if (crTotals.totalTtc <= 0) { toast.error("Le montant de l'avoir doit être supérieur à 0"); return }
      if (parentInv && current.status !== 'draft') {
        const maxCredit = creditableOf(parentInv, current.id || null)
        if (crTotals.totalTtc > maxCredit + 0.01) {
          toast.error(`Avoir de ${money(crTotals.totalTtc)} supérieur au montant encore créditable de ${parentInv.reference} (${money(maxCredit)})`)
          return
        }
      }
    }
    setSaving(true)
    const totals = calcInvoiceTotals(items, current.discount_percent, current.tva_applicable)
    const ap = parseFloat(current.amount_paid) || 0
    const credited = parseFloat(current.amount_credited) || 0
    // Avoir : reste à rembourser recalculé par le trigger SQL à la validation
    // Facture : TTC − payé − avoirs (le trigger recalcule si des avoirs existent)
    const amountDue = isCreditNote
      ? (current.status === 'draft' ? 0 : (parseFloat(current.amount_due) || 0))
      : Math.max(0, totals.totalTtc - ap - credited)
    const invData = {
      reference: current.reference, type: current.type || 'invoice', client_id: current.client_id,
      contact_id: current.contact_id || null, quote_id: current.quote_id || null, session_id: current.session_id || null,
      parent_invoice_id: current.parent_invoice_id || null, sellsy_reference: current.sellsy_reference || null,
      client_reference: current.client_reference || '', invoice_date: current.invoice_date,
      service_start_date: current.service_start_date || null, service_end_date: current.service_end_date || null,
      due_date: current.due_date || null, object: current.object || '', payment_method: current.payment_method,
      payment_terms: current.payment_terms, discount_percent: parseFloat(current.discount_percent) || 0,
      discount_label: current.discount_label || '', tva_applicable: current.tva_applicable,
      total_ht: totals.subtotalHt, total_discount: totals.discountAmt, total_net_ht: totals.netHt,
      total_tva: totals.totalTva, total_ttc: totals.totalTtc, amount_paid: ap, amount_due: amountDue,
      status: 'draft', notes: current.notes || '', created_by: current.created_by, is_formation_pro: current.is_formation_pro !== false,
      is_subrogation: current.is_subrogation || false, billing_client_id: current.is_subrogation ? current.billing_client_id || null : null,
      updated_at: new Date().toISOString(),
    }
    try {
      let iid
      if (mode === 'create') {
        const { data, error } = await supabase.from('invoices').insert(invData).select().single()
        if (error) throw error; iid = data.id
      } else {
        const { error } = await supabase.from('invoices').update(invData).eq('id', current.id)
        if (error) throw error; iid = current.id
        await supabase.from('invoice_items').delete().eq('invoice_id', iid)
      }
      const toIns = items.filter(it => it.description_title).map((it, i) => ({
        invoice_id: iid, position: i, code: it.code || '', description_title: it.description_title,
        description_detail: it.description_detail || '', quantity: parseFloat(it.quantity) || 1, unit: it.unit || 'unité',
        unit_price_ht: parseFloat(it.unit_price_ht) || 0, tva_rate: parseRate(it.tva_rate),
        total_ht: calcItemTotal(it), course_id: it.course_id || null,
      }))
      if (toIns.length > 0) { const { error: ie } = await supabase.from('invoice_items').insert(toIns); if (ie) throw ie }
      // Devis → « facturé » uniquement quand la facture est créée depuis le devis
      // (un devis peut couvrir plusieurs sessions facturées séparément)
      if (current.quote_id && current._from_quote && mode === 'create' && !isCreditNote) { await supabase.from('quotes').update({status: 'invoiced'}).eq('id', current.quote_id) }
      // Liaison facture ↔ sessions (mono, globale ou groupée sous-traitance)
      if (mode === 'create' && !isCreditNote) {
        const linkIds = [...new Set([current.session_id, ...(current._session_ids || []), ...(current._grouped_session_ids || [])].filter(Boolean))]
        if (linkIds.length > 0) {
          const { error: le } = await supabase.from('invoice_sessions')
            .upsert(linkIds.map(sid => ({ invoice_id: iid, session_id: sid })), { onConflict: 'invoice_id,session_id', ignoreDuplicates: true })
          if (le) console.error('Liaison invoice_sessions:', le)
        }
      }
      if (mode === 'create' && current.session_id && !isCreditNote) {
        const { data: sessCheck } = await supabase.from('sessions').select('session_type').eq('id', current.session_id).single()
        if (sessCheck?.session_type === 'subcontract') {
          await supabase.from('sessions').update({ subcontract_invoiced: true, subcontract_invoice_id: iid, updated_at: new Date().toISOString() }).eq('id', current.session_id)
        }
      }
      if (mode === 'create' && current._grouped_session_ids?.length > 0) {
        await Promise.all(current._grouped_session_ids.map(sid =>
          supabase.from('sessions').update({ subcontract_invoiced: true, subcontract_invoice_id: iid, updated_at: new Date().toISOString() }).eq('id', sid)
        ))
      }
      toast.success(mode === 'create' ? (current.type === 'credit_note' ? 'Avoir créé' : 'Facture créée') : 'Mise à jour')
      setMode('list'); loadAll()
    } catch (err) { toast.error('Erreur: ' + err.message) }
    setSaving(false)
  }

  // ─── Delete ───
  const handleDelete = async (id) => {
    if (!confirm('Supprimer ?')) return
    await supabase.from('invoice_items').delete().eq('invoice_id', id)
    await supabase.from('invoice_payments').delete().eq('invoice_id', id)
    await supabase.from('invoice_relances').delete().eq('invoice_id', id)
    await supabase.from('invoices').delete().eq('id', id)
    toast.success('Supprimée'); loadAll()
  }

  // ─── Status ───
  const handleStatus = async (id, s) => {
    const inv = invoices.find(i => i.id === id)
    const updateData = { status: s, updated_at: new Date().toISOString() }
    const creditedAmt = parseFloat(inv?.amount_credited) || 0
    if (s === 'paid' && inv) {
      const ttc = parseFloat(inv.total_ttc) || 0
      const alreadyPaid = parseFloat(inv.amount_paid) || 0
      const remaining = ttc - alreadyPaid - creditedAmt
      updateData.amount_paid = alreadyPaid + Math.max(0, remaining); updateData.amount_due = 0
      if (remaining > 0.01) {
        await supabase.from('invoice_payments').insert({
          invoice_id: id, amount: remaining, payment_date: format(new Date(), 'yyyy-MM-dd'),
          payment_method: inv.payment_method || 'virement bancaire', payment_reference: '',
          notes: 'Marquée payée manuellement', created_by: inv.created_by || currentUserName(),
        })
      }
    }
    if (['draft', 'due'].includes(s) && inv?.status === 'paid') {
      updateData.amount_paid = 0; updateData.amount_due = Math.max(0, (parseFloat(inv.total_ttc) || 0) - creditedAmt)
    }
    await supabase.from('invoices').update(updateData).eq('id', id)
    toast.success('Statut mis à jour'); loadAll()
  }

  // ─── Payment ───
  const handleAddPayment = async () => {
    const amt = parseFloat(paymentForm.amount); if (!amt || amt <= 0) { toast.error('Montant invalide'); return }
    const { error } = await supabase.from('invoice_payments').insert({
      invoice_id: current.id, amount: amt, payment_date: paymentForm.payment_date,
      payment_method: paymentForm.payment_method, payment_reference: paymentForm.payment_reference || null,
      notes: paymentForm.notes || null, created_by: current.created_by
    })
    if (error) { toast.error('Erreur: ' + error.message); return }
    const np = (parseFloat(current.amount_paid) || 0) + amt
    if (current.type === 'credit_note') {
      // Remboursement : le trigger SQL recalcule reste à rembourser et statut
      await supabase.from('invoices').update({ amount_paid: np, updated_at: new Date().toISOString() }).eq('id', current.id)
      toast.success('Remboursement enregistré')
    } else {
      const nd = (parseFloat(current.total_ttc) || 0) - np - (parseFloat(current.amount_credited) || 0)
      const ns = nd <= 0.01 ? 'paid' : 'partial'
      await supabase.from('invoices').update({ amount_paid: np, amount_due: Math.max(0, nd), status: ns, updated_at: new Date().toISOString() }).eq('id', current.id)
      toast.success('Paiement enregistré')
    }
    await refreshCurrent(current.id)
    await loadPayments(current.id); setShowPaymentForm(false)
    setPaymentForm({amount: '', payment_date: format(new Date(), 'yyyy-MM-dd'), payment_method: 'virement bancaire', payment_reference: '', notes: ''})
    loadAll()
  }

  // ─── Factur-X (download) ───
  const handleFacturX = async (inv, itemsList) => {
    const client = clients.find(c => c.id === inv.client_id)
    const billingClient = inv.is_subrogation && inv.billing_client_id ? clients.find(c => c.id === inv.billing_client_id) : null
    let contact = null
    if (inv.contact_id) { const { data } = await supabase.from('client_contacts').select('*').eq('id', inv.contact_id).single(); contact = data }
    let pRef = inv.parent_reference || ''
    if (!pRef && inv.parent_invoice_id) { pRef = invoices.find(i => i.id === inv.parent_invoice_id)?.reference || '' }
    if (!pRef && inv.quote_id) { pRef = quotes.find(q => q.id === inv.quote_id)?.reference || '' }
    const pDate = inv.parent_invoice_id ? (invoices.find(i => i.id === inv.parent_invoice_id)?.invoice_date || '') : ''
    let sRef = ''
    if (inv.session_id) { const { data: s } = await supabase.from('sessions').select('reference').eq('id', inv.session_id).single(); sRef = s?.reference || '' }
    try {
      toast.loading('Génération Factur-X…', { id: 'facturx' })
      await generateFacturXPDF({...inv, parent_reference: pRef, parent_invoice_date: pDate, session_reference: sRef}, itemsList || items, client, contact, { billingClient, orgSettings: organization }, billingClient)
      toast.success('Factur-X téléchargé', { id: 'facturx' })
    } catch (e) {
      toast.error('Erreur Factur-X : ' + e.message, { id: 'facturx' })
    }
  }

  // ─── Aperçu d'un brouillon (PDF avec la mention brouillon, sans numéro) ───
  const apercuBrouillon = async (inv, itemsList) => {
    const client = clients.find(c => c.id === inv.client_id)
    const billingClient = inv.is_subrogation && inv.billing_client_id ? clients.find(c => c.id === inv.billing_client_id) : null
    let contact = null
    if (inv.contact_id) { const { data } = await supabase.from('client_contacts').select('*').eq('id', inv.contact_id).single(); contact = data }
    try {
      await generateInvoicePDF(inv, itemsList || items, client, contact, { billingClient, orgSettings: organization })
    } catch (e) { toast.error('Aperçu impossible : ' + e.message) }
  }

  // ─── Émission : double confirmation bienveillante, puis numéro donné par la base ───
  const ouvrirEmission = async (inv, itemsList) => {
    const lignes = itemsList || items
    const js = calcInvoiceTotals(lignes, inv.discount_percent, inv.tva_applicable)
    let totaux = { total_net_ht: js.netHt, total_tva: js.totalTva, total_ttc: js.totalTtc, base: false }
    const { data } = await supabase.rpc('billing_compute_totals', { p_invoice: inv.id })
    if (data && data.total_ttc !== undefined) totaux = { ...data, base: true }
    let prochain = null
    const { data: n } = await supabase.rpc('billing_next_number', { p_type: inv.type || 'invoice' })
    if (typeof n === 'string') prochain = n
    setEmission({ inv, items: lignes, totaux, prochain, verifie: false, enCours: false })
  }
  const emettre = async () => {
    if (!emission?.verifie) return
    setEmission((e) => ({ ...e, enCours: true }))
    const { data, error } = await supabase.rpc('billing_issue', { p_invoice: emission.inv.id })
    if (error) {
      setEmission((e) => ({ ...e, enCours: false }))
      toast.error(error.message || "Émission refusée")
      return
    }
    toast.success(`${emission.inv.type === 'credit_note' ? 'Avoir émis' : 'Facture émise'} : ${data?.reference || ''}`)
    setEmission(null)
    await loadAll()
    if (emission.inv.id) { await refreshCurrent(emission.inv.id); await loadPayments(emission.inv.id) }
  }

  // ─── Items ───
  const updateItem = (i, f, v) => { const n = [...items]; n[i] = {...n[i], [f]: v}; setItems(n) }
  const addItem = () => setItems([...items, emptyItem()])
  const removeItem = (i) => setItems(items.filter((_, x) => x !== i))
  const addFromCourse = (c) => setItems([...items.filter(it => it.description_title), {code: c.code || '', description_title: c.title, description_detail: c.description || '', quantity: 1, unit: 'unité', unit_price_ht: c.price_ht || 0, tva_rate: 20, course_id: c.id}])

  // ─── Sort ───
  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }
  const SortIcon = ({ field }) => sortField !== field ? <span className="text-gray-300 ml-1">↕</span> : <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>

  // ─── Filtered ───
  const filtered = useMemo(() => {
    let result = invoices.filter(inv => {
      const s = search.toLowerCase()
      const matchSearch = (!s || inv.reference?.toLowerCase().includes(s) || inv.clients?.name?.toLowerCase().includes(s) || inv.object?.toLowerCase().includes(s) || inv.client_reference?.toLowerCase().includes(s))
      const matchStatus = !statusFilter || inv.status === statusFilter
      const matchType = !typeFilter || inv.type === typeFilter
      const matchRelance = !relanceFilter || (
        ['due', 'overdue', 'partial'].includes(inv.status) &&
        inv.type === 'invoice' &&
        isOverdue(inv.due_date)
      )
      return matchSearch && matchStatus && matchType && matchRelance
    })
    result.sort((a, b) => {
      let va, vb
      switch (sortField) {
        case 'reference': va = a.reference || ''; vb = b.reference || ''; break
        case 'client': va = a.clients?.name || ''; vb = b.clients?.name || ''; break
        case 'total_ht': va = parseFloat(a.total_net_ht) || 0; vb = parseFloat(b.total_net_ht) || 0; break
        case 'total_ttc': va = parseFloat(a.total_ttc) || 0; vb = parseFloat(b.total_ttc) || 0; break
        case 'status': va = a.status || ''; vb = b.status || ''; break
        case 'due_date': va = a.due_date || ''; vb = b.due_date || ''; break
        default: va = a.invoice_date || ''; vb = b.invoice_date || ''
      }
      if (typeof va === 'number') return sortDir === 'asc' ? va - vb : vb - va
      return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
    })
    return result
  }, [invoices, search, statusFilter, typeFilter, sortField, sortDir, relanceFilter])

  // ─── Stats ───
  const stats = useMemo(() => {
    const inv = invoices.filter(i => i.type === 'invoice'), cr = invoices.filter(i => i.type === 'credit_note')
    return {
      paid: inv.filter(i => i.status === 'paid').reduce((s, i) => s + (parseFloat(i.total_ttc) || 0), 0),
      pending: inv.filter(i => ['sent', 'due', 'partial'].includes(i.status)).reduce((s, i) => s + (parseFloat(i.amount_due) || 0), 0),
      overdue: inv.filter(i => i.status === 'overdue').reduce((s, i) => s + (parseFloat(i.amount_due) || 0), 0),
      credits: cr.filter(i => i.status !== 'draft').reduce((s, i) => s + (parseFloat(i.total_ttc) || 0), 0),
      invCount: inv.length, crCount: cr.length,
      toRelance: inv.filter(i => ['due', 'overdue', 'partial'].includes(i.status) && isOverdue(i.due_date)).length,
    }
  }, [invoices])

  const currentTotals = useMemo(() => current ? calcInvoiceTotals(items, current.discount_percent, current.tva_applicable) : null, [items, current?.discount_percent, current?.tva_applicable])
  const handleClientChange = async (cid) => { setCurrent(p => ({...p, client_id: cid, contact_id: ''})); await loadContacts(cid) }

  // ─── Badge relances ───
  const RelanceBadge = ({ inv }) => {
    const relances = invoiceRelancesMap[inv?.id] || []
    if (relances.length === 0 || inv?.type === 'credit_note') return null
    const count = relances.length
    const colorClass = count >= 3 ? 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]' : count === 2 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-gray-100 text-gray-600'
    return (
      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-ui-sm font-medium ml-1 ${colorClass}`}>
        <Mail size={10} />
        {count}
      </span>
    )
  }

  // ═══════════════════════════════════════
  // LIST
  // ═══════════════════════════════════════
  if (mode === 'list') return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title">Facturation</h1>
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={() => setShowQuoteSelector(true)} className="btn btn-secondary flex items-center gap-2 text-ui"><Receipt size={16} />Depuis un devis</button>
          <button onClick={openSessionSelector} className="btn btn-secondary flex items-center gap-2 text-ui"><CheckCircle size={16} />Depuis une session</button>
          <button onClick={() => handleNew('invoice')} className="btn btn-primary flex items-center gap-2 text-ui"><Plus size={16} />Facture libre</button>
          <button onClick={() => { setGroupedClientSearch(''); setGroupedClientId(''); setGroupedClientOpen(false); setShowGroupedModal(true) }} className="btn btn-secondary flex items-center gap-2 text-ui"><Receipt size={16} />Sous-traitance groupée</button>
          <button onClick={() => handleNew('credit_note')} className="btn btn-secondary flex items-center gap-2 text-ui"><Plus size={16} />Avoir</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white border rounded-ui p-4 border-[rgb(var(--c-success)/0.3)]"><p className="text-ui-sm text-gray-500">CA Payé</p><p className="text-xl font-bold text-[rgb(var(--c-success))] mt-1">{money(stats.paid)}</p><p className="text-ui-sm text-gray-400 mt-1">{stats.invCount} factures</p></div>
        <div className="bg-white border rounded-ui p-4 border-[rgb(var(--c-info)/0.3)]"><p className="text-ui-sm text-gray-500">En attente</p><p className="text-xl font-bold text-[rgb(var(--c-info))] mt-1">{money(stats.pending)}</p></div>
        <div className="bg-white border rounded-ui p-4 border-[rgb(var(--c-danger)/0.3)]"><p className="text-ui-sm text-gray-500">En retard</p><p className="text-xl font-bold text-[rgb(var(--c-danger))] mt-1">{money(stats.overdue)}</p></div>
        <div className="bg-white border rounded-ui p-4 border-[rgb(var(--c-warning)/0.3)]"><p className="text-ui-sm text-gray-500">Avoirs</p><p className="text-xl font-bold text-[rgb(var(--c-warning))] mt-1">{money(stats.credits)}</p><p className="text-ui-sm text-gray-400 mt-1">{stats.crCount} avoirs</p></div>
        <div
          className={`bg-white border rounded-ui p-4 cursor-pointer transition-colors ${relanceFilter ? 'border-gray-400 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'}`}
          onClick={() => setRelanceFilter(f => !f)}
        >
          <p className="text-ui-sm text-gray-500">À relancer</p>
          <p className="text-xl font-bold text-gray-800 mt-1">{stats.toRelance}</p>
          <p className="text-ui-sm text-gray-800 mt-1">{relanceFilter ? ' Filtre actif' : 'Cliquer pour filtrer'}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
          <input type="text" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 border rounded-ui-sm text-ui" />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="border rounded-ui-sm px-3 py-2 text-ui">
          <option value="">Tous types</option>
          <option value="invoice">Factures</option>
          <option value="credit_note">Avoirs</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border rounded-ui-sm px-3 py-2 text-ui">
          <option value="">Tous statuts</option>
          {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {relanceFilter && (
          <button onClick={() => setRelanceFilter(false)} className="px-3 py-2 bg-gray-100 text-gray-800 rounded-ui-sm text-ui flex items-center gap-1">
            <X size={14} />À relancer
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? <p className="text-center py-8 text-gray-400">Chargement...</p> : filtered.length === 0 ? <p className="text-center py-8 text-gray-500">{search || statusFilter || typeFilter || relanceFilter ? 'Aucun résultat' : 'Aucune facture'}</p> : (
        <div className="bg-white rounded-ui border overflow-x-auto">
          <table className="w-full text-ui">
            <thead>
              <tr className="border-b bg-gray-50 text-gray-500 text-ui-sm uppercase">
                <th className="px-4 py-3 text-left cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort('reference')}>Référence<SortIcon field="reference" /></th>
                <th className="px-4 py-3 text-left cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort('client')}>Client<SortIcon field="client" /></th>
                <th className="px-4 py-3 text-left">Objet</th>
                <th className="px-4 py-3 text-right cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort('total_ht')}>HT<SortIcon field="total_ht" /></th>
                <th className="px-4 py-3 text-right cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort('total_ttc')}>TTC<SortIcon field="total_ttc" /></th>
                <th className="px-4 py-3 text-right">Dû</th>
                <th className="px-4 py-3 text-center cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort('status')}>Statut<SortIcon field="status" /></th>
                <th className="px-4 py-3 text-center cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort('due_date')}>Échéance<SortIcon field="due_date" /></th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const st = getStatusInfo(inv)
                const isCr = inv.type === 'credit_note'
                const odDays = inv.status === 'overdue' ? daysLate(inv.due_date) : 0
                const relances = invoiceRelancesMap[inv.id] || []
                return (
                  <tr key={inv.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => handleView(inv)}>
                    <td className="px-4 py-3 font-medium">
                      <span className={isCr ? 'text-[rgb(var(--c-warning))]' : 'text-gray-900'}>{inv.reference}</span>
                      {isCr && <span className="ml-2 text-ui-sm bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] px-1.5 py-0.5 rounded">Avoir</span>}
                      {inv.is_subrogation && <span className="ml-2 text-ui-sm bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] px-1.5 py-0.5 rounded">OPCO</span>}
                      <RelanceBadge inv={inv} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">{inv.clients?.name || '-'}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">{inv.object || '-'}</td>
                    <td className="px-4 py-3 text-right">{money(inv.total_net_ht)}</td>
                    <td className="px-4 py-3 text-right font-medium">{money(inv.total_ttc)}</td>
                    <td className="px-4 py-3 text-right font-medium">{parseFloat(inv.amount_due) > 0 ? <span className="text-[rgb(var(--c-danger))]">{money(inv.amount_due)}</span> : '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-ui-sm font-medium whitespace-nowrap`} style={toneStyle(st.color)}>{st.label}</span>
                      {odDays > 0 && <span className="text-ui-sm text-[rgb(var(--c-danger))] block">+{odDays}j</span>}
                    </td>
                    <td className="px-4 py-3 text-center text-ui-sm text-gray-500">{inv.due_date ? fmtDateShort(inv.due_date) : '-'}</td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        {!isDraftDoc(inv) && (isCr || !['paid', 'cancelled', 'credited'].includes(inv.status)) && (
                          <button
                            onClick={e => openSendModal(inv, e)}
                            className={`p-1.5 rounded transition-colors ${isCr ? 'hover:bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]' : relances.length >= 3 ? 'hover:bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]' : relances.length >= 1 ? 'hover:bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'hover:bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]'}`}
                            title={isCr ? (relances.length === 0 ? "Envoyer l'avoir" : "Renvoyer l'avoir") : (relances.length === 0 ? 'Envoyer la facture' : `Relance ${relances.length} - Renvoyer`)}
                          >
                            <Mail size={14} />
                          </button>
                        )}
                        {isDraftDoc(inv) && droitsFac.modifier && <button onClick={() => handleEdit(inv)} className="p-1.5 hover:bg-gray-100 rounded" title="Modifier"><Pencil size={14} /></button>}
                        {!isDraftDoc(inv) && <button
                          onClick={async e => { e.stopPropagation(); const { data: ii } = await supabase.from('invoice_items').select('*').eq('invoice_id', inv.id).order('position'); handleFacturX(inv, ii) }}
                          className="p-1.5 hover:bg-gray-100 text-gray-800 rounded"
                          title={isCr ? "Télécharger l'avoir (Factur-X)" : 'Télécharger Factur-X'}
                        >
                          <Download size={14} />
                        </button>}
                        {isDraftDoc(inv) && droitsFac.modifier && <button onClick={() => handleDelete(inv.id)} className="p-1.5 hover:bg-[rgb(var(--c-danger-bg))] rounded text-[rgb(var(--c-danger))]" title="Supprimer"><Trash2 size={14} /></button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Modal envoi / relance ─── */}
      {showSendModal && sendModalInv && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-ui shadow-md w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Mail size={18} className="text-[rgb(var(--c-info))]" />
                {sendModalInv.type === 'credit_note'
                  ? `${sendModalRelances.length === 0 ? 'Envoyer' : 'Renvoyer'} l'avoir ${sendModalInv.reference}`
                  : (sendModalRelances.length === 0 ? `Envoyer ${sendModalInv.reference}` : `Relance ${sendModalRelances.length} - ${sendModalInv.reference}`)}
              </h3>
              <button onClick={() => setShowSendModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            {/* Historique */}
            {sendModalRelances.length > 0 && (
              <div className="px-4 pt-3 pb-0">
                <div className="flex flex-wrap gap-2 text-ui-sm">
                  {sendModalRelances.map((r, i) => (
                    <span key={r.id || i} className="bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                      {i === 0 ? 'Envoi' : (sendModalInv.type === 'credit_note' ? `Renvoi ${i}` : `Relance ${i}`)} le {format(new Date(r.sent_at), 'dd/MM/yyyy')} → {r.to_email}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {/* Expéditeur */}
              <div>
                <label className="text-ui-sm font-medium text-gray-500 block mb-1">Expéditeur</label>
                <select
                  value={sendForm.caller}
                  onChange={e => setSendForm(f => ({...f, caller: e.target.value}))}
                  className="w-full border rounded-ui-sm px-3 py-2 text-ui"
                >
                  {teamNames().map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>

              {/* Destinataire */}
              <div>
                <label className="text-ui-sm font-medium text-gray-500 block mb-1">Destinataire</label>
                <input
                  type="email"
                  value={sendForm.to}
                  onChange={e => setSendForm(f => ({...f, to: e.target.value}))}
                  className="w-full border rounded-ui-sm px-3 py-2 text-ui"
                  placeholder="email@entreprise.fr"
                />
              </div>

              {/* Objet */}
              <div>
                <label className="text-ui-sm font-medium text-gray-500 block mb-1">Objet</label>
                <input
                  type="text"
                  value={sendForm.subject}
                  onChange={e => setSendForm(f => ({...f, subject: e.target.value}))}
                  className="w-full border rounded-ui-sm px-3 py-2 text-ui"
                />
              </div>

              {/* Corps */}
              <div>
                <label className="text-ui-sm font-medium text-gray-500 block mb-1">Message</label>
                <textarea
                  value={sendForm.body}
                  onChange={e => setSendForm(f => ({...f, body: e.target.value}))}
                  className="w-full border rounded-ui-sm px-3 py-2 text-ui font-mono"
                  rows={12}
                />
              </div>

              {/* PJ */}
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-ui-sm px-3 py-2 text-ui text-gray-800">
                <Download size={14} />
                <span>Pièce jointe : <strong>{sendModalInv.reference}_facturx.pdf</strong></span>
              </div>
            </div>

            <div className="p-4 border-t flex justify-end gap-3">
              <button onClick={() => setShowSendModal(false)} className="px-4 py-2 border rounded-ui-sm text-ui text-gray-600 hover:bg-gray-50" disabled={sendingEmail}>
                Annuler
              </button>
              <button
                onClick={handleSendInvoice}
                disabled={sendingEmail || !sendForm.to}
                className="btn btn-secondary text-ui font-medium hover:bg-[rgb(var(--c-info))] disabled:opacity-50 flex items-center gap-2"
              >
                {sendingEmail ? (
                  <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />Envoi…</>
                ) : (
                  <><Mail size={14} />{sendModalInv.type === 'credit_note' ? (sendModalRelances.length === 0 ? "Envoyer l'avoir" : "Renvoyer l'avoir") : (sendModalRelances.length === 0 ? 'Envoyer' : `Envoyer la relance ${sendModalRelances.length}`)}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quote selector modal */}
      {showQuoteSelector && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-ui shadow-md w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b"><h3 className="font-semibold text-lg">Créer une facture depuis un devis</h3><button onClick={() => setShowQuoteSelector(false)}><X size={20} /></button></div>
            <div className="p-4"><div className="relative"><Search className="absolute left-3 top-2.5 text-gray-400" size={16} /><input type="text" placeholder="Rechercher un devis..." value={quoteSearch} onChange={e => setQuoteSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 border rounded-ui-sm text-ui" autoFocus /></div></div>
            <div className="overflow-y-auto flex-1 px-4 pb-4">
              {quotes.filter(q => {
                if (!quoteSearch) return q.status === 'accepted' || q.status === 'sent'
                const s = quoteSearch.toLowerCase()
                return q.reference?.toLowerCase().includes(s) || q.object?.toLowerCase().includes(s) || clients.find(c => c.id === q.client_id)?.name?.toLowerCase().includes(s)
              }).map(q => {
                const cli = clients.find(c => c.id === q.client_id)
                return (
                  <button key={q.id} onClick={() => handleFromQuote(q)} className="w-full text-left p-3 border rounded-ui-sm mb-2 hover:bg-[rgb(var(--c-info-bg))] hover:border-[rgb(var(--c-info)/0.3)] transition-colors">
                    <div className="flex justify-between items-start"><div><span className="font-medium text-ui">{q.reference}</span><span className="text-gray-500 text-ui ml-2">{cli?.name}</span></div><span className="font-semibold text-ui">{money(q.total_ttc)}</span></div>
                    {q.object && <p className="text-ui-sm text-gray-400 mt-1 truncate">{q.object}</p>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Session selector modal */}
      {showSessionSelector && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-ui shadow-md w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b"><h3 className="font-semibold text-lg">Créer une facture depuis une session</h3><button onClick={() => setShowSessionSelector(false)}><X size={20} /></button></div>
            <div className="p-4"><div className="relative"><Search className="absolute left-3 top-2.5 text-gray-400" size={16} /><input type="text" placeholder="Rechercher une session..." value={sessionSearch} onChange={e => setSessionSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 border rounded-ui-sm text-ui" autoFocus /></div></div>
            <div className="overflow-y-auto flex-1 px-4 pb-4">
              {completedSessions.filter(s => {
                if (!sessionSearch) return true
                const q = sessionSearch.toLowerCase()
                return s.reference?.toLowerCase().includes(q) || s.clients?.name?.toLowerCase().includes(q) || s.courses?.title?.toLowerCase().includes(q)
              }).map(s => {
                const isChecked = selectedSessionIds.includes(s.id)
                const toggle = () => setSelectedSessionIds(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])
                return (
                <div key={s.id} className={`w-full flex items-stretch border rounded-ui-sm mb-2 transition-colors ${isChecked ? 'border-[rgb(var(--c-success)/0.3)] bg-[rgb(var(--c-success-bg))]' : s.already_invoiced ? 'border-[rgb(var(--c-warning)/0.3)] bg-[rgb(var(--c-warning-bg))] hover:bg-[rgb(var(--c-warning-bg))]' : 'hover:bg-[rgb(var(--c-success-bg))] hover:border-[rgb(var(--c-success)/0.3)]'}`}>
                  {s.session_type !== 'subcontract' && (
                    <label className="flex items-center px-3 cursor-pointer border-r" title="Sélectionner pour une facture globale" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={isChecked} onChange={toggle} className="w-4 h-4 rounded text-[rgb(var(--c-success))]" />
                    </label>
                  )}
                  <button onClick={() => { if (s.already_invoiced) { if (!confirm('Cette session a déjà une facture associée. Créer quand même ?')) return }; setShowSessionSelector(false); handleFromSession(s.id) }}
                    className="flex-1 text-left p-3 min-w-0">
                  <div className="flex justify-between items-start">
                    <div><span className="font-medium text-ui">{s.reference}</span><span className="text-gray-500 text-ui ml-2">{s.clients?.name}</span></div>
                    <div className="flex items-center gap-2">
                      {s.already_invoiced && <span className="text-ui-sm bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] px-1.5 py-0.5 rounded">Déjà facturée</span>}
                      <span className={`text-ui-sm px-1.5 py-0.5 rounded ${s.status === 'completed' ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]'}`}>{s.status === 'completed' ? 'Terminée' : 'En cours'}</span>
                    </div>
                  </div>
                  <p className="text-ui-sm text-gray-400 mt-1 truncate">{s.courses?.title} - {fmtDateShort(s.start_date)}{s.end_date !== s.start_date ? ' au ' + fmtDateShort(s.end_date) : ''}</p>
                  </button>
                </div>
                )
              })}
              {completedSessions.length === 0 && <p className="text-center text-gray-400 py-8">Aucune session terminée ou en cours</p>}
            </div>
            {selectedSessionIds.length > 0 && (
              <div className="p-4 border-t flex items-center justify-between gap-3">
                <span className="text-ui text-gray-600">{selectedSessionIds.length} session{selectedSessionIds.length > 1 ? 's' : ''} sélectionnée{selectedSessionIds.length > 1 ? 's' : ''} - facture globale (même client)</span>
                <div className="flex gap-2">
                  <button onClick={() => setSelectedSessionIds([])} className="px-3 py-1.5 text-ui border rounded-ui-sm hover:bg-gray-50">Vider</button>
                  <button onClick={() => {
                    const chosen = completedSessions.filter(x => selectedSessionIds.includes(x.id))
                    if (new Set(chosen.map(x => x.client_id)).size > 1) { toast.error('Les sessions sélectionnées doivent appartenir au même client'); return }
                    const already = chosen.filter(x => x.already_invoiced)
                    if (already.length > 0 && !confirm(`${already.map(x => x.reference).join(', ')} ${already.length > 1 ? 'ont' : 'a'} déjà une facture associée. Créer quand même ?`)) return
                    setShowSessionSelector(false); handleFromSessions(selectedSessionIds)
                  }} className="px-3 py-1.5 text-ui bg-[rgb(var(--c-success))] text-white rounded-ui-sm hover:bg-[rgb(var(--c-success))]">Facturer la sélection</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Facture groupée sous-traitance */}
      {showGroupedModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-ui shadow-md w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b shrink-0">
              <h2 className="text-lg font-semibold flex items-center gap-2"><Receipt size={18} className="text-[rgb(var(--c-warning))]" />Facture groupée sous-traitance</h2>
              <button onClick={() => setShowGroupedModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <label className="text-ui-sm text-gray-500 block mb-1">Client (OF)</label>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                    <input type="text" value={groupedClientSearch}
                      onChange={e => { setGroupedClientSearch(e.target.value); setGroupedClientOpen(true); if (!e.target.value) { setGroupedClientId(''); loadGroupedSessions('', groupedMonth) } }}
                      onFocus={() => setGroupedClientOpen(true)}
                      placeholder="Rechercher..."
                      className="w-full border rounded-ui-sm pl-9 pr-8 py-2 text-ui"
                    />
                    {groupedClientId && (
                      <button onClick={() => { setGroupedClientSearch(''); setGroupedClientId(''); setGroupedClientOpen(false); loadGroupedSessions('', groupedMonth) }} className="absolute right-2 top-2 p-0.5 hover:bg-gray-100 rounded">
                        <X size={14} className="text-gray-400" />
                      </button>
                    )}
                  </div>
                  {groupedClientOpen && groupedClientSearch && !groupedClientId && (
                    <div className="absolute z-10 mt-1 w-full bg-white border rounded-ui-sm shadow-md max-h-48 overflow-y-auto">
                      {clients.filter(c => c.status !== 'inactif' && c.name?.toLowerCase().includes(groupedClientSearch.toLowerCase())).length === 0
                        ? <p className="px-3 py-2 text-ui text-gray-400">Aucun résultat</p>
                        : clients.filter(c => c.status !== 'inactif' && c.name?.toLowerCase().includes(groupedClientSearch.toLowerCase())).slice(0, 8).map(c => (
                          <button key={c.id} type="button" onClick={() => { setGroupedClientId(c.id); setGroupedClientSearch(c.name); setGroupedClientOpen(false); loadGroupedSessions(c.id, groupedMonth) }}
                            className="w-full text-left px-3 py-2 text-ui hover:bg-[rgb(var(--c-warning-bg))] flex items-center justify-between border-b last:border-0">
                            <span className="font-medium">{c.name}</span>
                            {c.client_type === 'organisme_formation' && <span className="text-ui-sm bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] px-1.5 py-0.5 rounded">OF</span>}
                          </button>
                        ))
                      }
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-ui-sm text-gray-500 block mb-1">Mois</label>
                  <input type="month" value={groupedMonth} onChange={e => { setGroupedMonth(e.target.value); loadGroupedSessions(groupedClientId, e.target.value) }} className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                </div>
              </div>
              {groupedSessions.length > 0 ? (
                <div className="border rounded-ui-sm overflow-hidden">
                  <table className="w-full text-ui">
                    <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Formation</th><th className="px-3 py-2 text-right">Montant</th><th className="px-3 py-2 text-center">Statut</th></tr></thead>
                    <tbody>
                      {groupedSessions.map(s => {
                        const days = Math.max(1, Math.round((new Date(s.end_date) - new Date(s.start_date)) / 86400000) + 1)
                        const total = days * (parseFloat(s.subcontract_daily_rate) || 0)
                        return (
                          <tr key={s.id} className={`border-t ${s.subcontract_invoiced ? 'bg-[rgb(var(--c-success-bg))] opacity-60' : ''}`}>
                            <td className="px-3 py-2 whitespace-nowrap">{fmtDateShort(s.start_date)}</td>
                            <td className="px-3 py-2 truncate max-w-[180px]">{s.subcontract_course_title || 'Formation'}</td>
                            <td className="px-3 py-2 text-right font-mono">{total.toFixed(2)} €</td>
                            <td className="px-3 py-2 text-center">
                              {s.subcontract_invoiced
                                ? <span className="text-ui-sm bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] px-2 py-0.5 rounded-full">Facturée</span>
                                : <span className="text-ui-sm bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] px-2 py-0.5 rounded-full">À facturer</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 font-semibold">
                      <tr className="border-t">
                        <td colSpan={2} className="px-3 py-2">{groupedSessions.filter(s => !s.subcontract_invoiced).length} session(s) à facturer</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {groupedSessions.filter(s => !s.subcontract_invoiced).reduce((sum, s) => {
                            const d = Math.max(1, Math.round((new Date(s.end_date) - new Date(s.start_date)) / 86400000) + 1)
                            return sum + d * (parseFloat(s.subcontract_daily_rate) || 0)
                          }, 0).toFixed(2)} € HT
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : groupedClientId ? (
                <p className="text-ui text-gray-500 text-center py-4">Aucune session sous-traitance pour ce client sur ce mois</p>
              ) : null}
            </div>
            <div className="flex justify-end gap-3 p-4 border-t shrink-0">
              <button onClick={() => setShowGroupedModal(false)} className="px-4 py-2 text-ui text-gray-600 hover:text-gray-800">Annuler</button>
              <button onClick={handleGroupedInvoice} disabled={!groupedSessions.some(s => !s.subcontract_invoiced)}
                className="btn btn-secondary text-ui font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                <Receipt size={16} />Générer la facture
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // ═══════════════════════════════════════
  // FORM (create / edit / view)
  // ═══════════════════════════════════════
  const ro = mode === 'view'
  const isCr = current?.type === 'credit_note'
  const client = clients.find(c => c.id === current?.client_id)

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => { setMode('list'); loadAll() }} className="p-2 hover:bg-gray-100 rounded-ui-sm"><ChevronLeft size={20} /></button>
        <h1 className="text-xl font-bold flex-1">{mode === 'create' ? (isCr ? 'Nouvel avoir' : 'Nouvelle facture') : mode === 'view' ? current?.reference : 'Modifier ' + current?.reference}</h1>
        <div className="flex gap-2 flex-wrap justify-end">
          {mode === 'view' && !isDraftDoc(current) && (isCr || !['paid', 'cancelled', 'credited'].includes(current?.status)) && (
            <button
              onClick={() => openSendModal(current)}
              className="btn btn-secondary text-ui flex items-center gap-1 hover:bg-[rgb(var(--c-info))]"
            >
              <Mail size={14} />
              {isCr
                ? ((invoiceRelancesMap[current?.id] || []).length === 0 ? "Envoyer l'avoir" : "Renvoyer l'avoir")
                : ((invoiceRelancesMap[current?.id] || []).length === 0 ? 'Envoyer' : `Relance ${(invoiceRelancesMap[current?.id] || []).length}`)}
            </button>
          )}
          {mode === 'view' && isDraftDoc(current) && (
            <>
              <button onClick={() => apercuBrouillon(current, items)} className="btn btn-secondary text-ui flex items-center gap-1" title="Aperçu du PDF, avec la mention brouillon">
                <Eye size={14} />Aperçu
              </button>
              {droitsFac.modifier && <button onClick={() => handleEdit(current)} className="btn btn-secondary text-ui flex items-center gap-1"><Pencil size={14} />Modifier</button>}
              {(isCr ? droitsFac.avoir : droitsFac.valider) && (
                <button onClick={() => ouvrirEmission(current, items)} className="btn btn-primary text-ui flex items-center gap-1">
                  <Stamp size={14} />{isCr ? "Émettre l'avoir" : 'Émettre la facture'}
                </button>
              )}
            </>
          )}
          {mode === 'view' && !isDraftDoc(current) && (
            <>
              <button onClick={() => handleFacturX(current, items)} className="px-3 py-2 bg-gray-100 text-gray-800 rounded-ui-sm text-ui flex items-center gap-1" title={isCr ? "Télécharger l'avoir (Factur-X)" : 'Télécharger Factur-X'}>
                <Download size={14} />{isCr ? 'PDF avoir' : 'Factur-X'}
              </button>
              {current?.type === 'invoice' && CREDITABLE_STATUSES.includes(current.status) && creditableOf(current) > 0.01 && (
                <button onClick={() => handleCreateCreditNote(current)} className="px-3 py-2 bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] rounded-ui-sm text-ui flex items-center gap-1">
                  <Copy size={14} />Avoir
                </button>
              )}
            </>
          )}
          {(mode === 'create' || mode === 'edit') && (
            <button onClick={handleSave} disabled={saving} className="btn btn-secondary text-ui disabled:opacity-50">
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {/* Info principale */}
        <div className="bg-white rounded-ui border p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><label className="text-ui-sm text-gray-500 block mb-1">Référence</label><input type="text" value={isDraftDoc(current) ? '' : (current?.reference || '')} placeholder="Attribuée à l'émission" className="w-full border rounded-ui-sm px-3 py-2 text-ui bg-gray-50" readOnly /></div>
            <div><label className="text-ui-sm text-gray-500 block mb-1">Date</label><input type="date" value={current?.invoice_date || ''} onChange={e => setCurrent({...current, invoice_date: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui" readOnly={ro} /></div>
            <div>
              <label className="text-ui-sm text-gray-500 block mb-1">Statut</label>
              {ro
                ? <span className={`inline-flex items-center px-3 py-2 rounded-ui-sm text-ui font-medium`} style={toneStyle(getStatusInfo(current).color)}>{getStatusInfo(current).label}</span>
                : <span className="inline-flex items-center px-3 py-2 rounded-ui-sm text-ui font-medium" style={toneStyle('gray')}>Brouillon, numéro attribué à l'émission</span>
              }
            </div>
            <div><label className="text-ui-sm text-gray-500 block mb-1">Créé par</label><select value={current?.created_by || ''} onChange={e => setCurrent({...current, created_by: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui" disabled={ro}>{teamNames().map(n => <option key={n} value={n}>{n}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div className="col-span-2">
              <label className="text-ui-sm text-gray-500 block mb-1">Client</label>
              {ro
                ? <p className="text-ui font-medium">{client?.name || '-'}</p>
                : <SearchSelect value={current?.client_id || ''} onChange={v => handleClientChange(v)}
                    options={clientOptions(clients.filter(c => c.status !== 'inactif'))}
                    emptyLabel="- Sélectionner -" searchPlaceholder="Nom, ville, SIRET..." aria-label="Client" />
              }
            </div>
            <div>
              <label className="text-ui-sm text-gray-500 block mb-1">Contact facturation</label>
              {ro
                ? <p className="text-ui">{contacts.find(c => c.id === current?.contact_id)?.name || '-'}</p>
                : <select value={current?.contact_id || ''} onChange={e => setCurrent({...current, contact_id: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui">
                    <option value="">- Aucun -</option>
                    {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.is_billing ? ' ' : c.is_primary ? ' ' : ''}</option>)}
                  </select>
              }
            </div>
            <div><label className="text-ui-sm text-gray-500 block mb-1">Réf. client</label><input type="text" value={current?.client_reference || ''} onChange={e => setCurrent({...current, client_reference: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui" readOnly={ro} placeholder="Ex: DUC, OPCO2i" /></div>
          </div>

          {/* Subrogation OPCO */}
          <div className="mt-4 border-t pt-4">
            <div className="flex items-center gap-3 mb-3">
              <input type="checkbox" id="is_subrogation" checked={current?.is_subrogation || false} onChange={e => setCurrent({...current, is_subrogation: e.target.checked, ...(!e.target.checked && {billing_client_id: ''})})} disabled={ro} className="w-4 h-4 rounded text-[rgb(var(--c-warning))]" />
              <label htmlFor="is_subrogation" className="text-ui font-medium text-gray-700"> Subrogation OPCO <span className="text-ui-sm text-gray-400 font-normal">- Facturer à un tiers payeur (OPCO, organisme financeur)</span></label>
            </div>
            {current?.is_subrogation && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pl-7 border-l-2 border-[rgb(var(--c-warning)/0.3)]">
                <div className="col-span-2">
                  <label className="text-ui-sm text-gray-500 block mb-1">Client de facturation (OPCO)</label>
                  {ro
                    ? <p className="text-ui font-medium text-[rgb(var(--c-warning))]">{clients.find(c => c.id === current?.billing_client_id)?.name || '-'}</p>
                    : <SearchSelect value={current?.billing_client_id || ''} onChange={v => setCurrent({...current, billing_client_id: v})}
                        options={[
                          ...clientOptions(clients.filter(c => c.status !== 'inactif' && c.client_type === 'opco')).map(o => ({ ...o, group: 'OPCO' })),
                          ...clientOptions(clients.filter(c => c.status !== 'inactif' && c.client_type !== 'opco')).map(o => ({ ...o, group: 'Autres payeurs' })),
                        ]}
                        emptyLabel="- Sélectionner l'OPCO -" searchPlaceholder="Rechercher un OPCO ou un payeur..." aria-label="Client de facturation" />
                  }
                </div>
                <div className="col-span-2 flex items-end">
                  <p className="text-ui-sm text-[rgb(var(--c-warning))]">La facture sera adressée à l'OPCO avec la mention « Formation réalisée pour le compte de {client?.name || '...'} »</p>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div><label className="text-ui-sm text-gray-500 block mb-1">Réf. Sellsy</label><input type="text" value={current?.sellsy_reference || ''} onChange={e => setCurrent({...current, sellsy_reference: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui" readOnly={ro} placeholder="FACT-..." /></div>
            {isCr && !ro ? (
              <div>
                <label className="text-ui-sm text-gray-500 block mb-1">Facture d'origine *</label>
                <select
                  value={current?.parent_invoice_id || ''}
                  onChange={async e => {
                    const pinv = invoices.find(i => i.id === e.target.value)
                    if (!pinv) { setCurrent({...current, parent_invoice_id: null, parent_reference: ''}); return }
                    if (mode === 'create') { await handleCreateCreditNote(pinv, current.reference) }
                    else { setCurrent({...current, parent_invoice_id: pinv.id, parent_reference: pinv.reference}) }
                  }}
                  className={`w-full border rounded-ui-sm px-3 py-2 text-ui ${current?.parent_invoice_id ? '' : 'border-[rgb(var(--c-warning)/0.3)] bg-[rgb(var(--c-warning-bg))]'}`}
                >
                  <option value="">- Sélectionner la facture -</option>
                  {invoices
                    .filter(i => i.type === 'invoice' && (i.id === current?.parent_invoice_id || (CREDITABLE_STATUSES.includes(i.status) && creditableOf(i, current?.id || null) > 0.01 && (!current?.client_id || i.client_id === current.client_id))))
                    .map(i => <option key={i.id} value={i.id}>{i.reference} - {i.clients?.name || ''} - créditable {money(creditableOf(i, current?.id || null))}</option>)}
                </select>
              </div>
            ) : (
              <div><label className="text-ui-sm text-gray-500 block mb-1">{isCr ? "Facture d'origine" : 'Document parent'}</label><input type="text" value={current?.parent_reference || ''} readOnly className="w-full border rounded-ui-sm px-3 py-2 text-ui bg-gray-50" placeholder="Devis ou facture" /></div>
            )}
            <div><label className="text-ui-sm text-gray-500 block mb-1">Début prestation</label><input type="date" value={current?.service_start_date || ''} onChange={e => setCurrent({...current, service_start_date: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui" readOnly={ro} /></div>
            <div><label className="text-ui-sm text-gray-500 block mb-1">Fin prestation</label><input type="date" value={current?.service_end_date || ''} onChange={e => setCurrent({...current, service_end_date: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui" readOnly={ro} /></div>
          </div>
          <div className="mt-4"><label className="text-ui-sm text-gray-500 block mb-1">Objet</label><input type="text" value={current?.object || ''} onChange={e => setCurrent({...current, object: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui" readOnly={ro} placeholder="Formation SST du..." /></div>
        </div>

        {/* Lignes */}
        <div className="bg-white rounded-ui border p-5">
          <h3 className="font-semibold text-ui mb-3">Lignes</h3>
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-start border-b pb-3">
                <div className="col-span-2"><input type="text" value={item.code} onChange={e => updateItem(idx, 'code', e.target.value)} className="w-full border rounded px-2 py-1.5 text-ui" placeholder="Code" readOnly={ro} /></div>
                <div className="col-span-4">
                  <input type="text" value={item.description_title} onChange={e => updateItem(idx, 'description_title', e.target.value)} className="w-full border rounded px-2 py-1.5 text-ui" placeholder="Description" readOnly={ro} />
                  <input type="text" value={item.description_detail || ''} onChange={e => updateItem(idx, 'description_detail', e.target.value)} className="w-full border rounded px-2 py-1 text-ui-sm mt-1 text-gray-500" placeholder="Détail" readOnly={ro} />
                </div>
                <div className="col-span-1"><input type="number" value={item.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} className="w-full border rounded px-2 py-1.5 text-ui text-center" readOnly={ro} step="0.01" /></div>
                <div className="col-span-2"><input type="number" value={item.unit_price_ht} onChange={e => updateItem(idx, 'unit_price_ht', e.target.value)} className="w-full border rounded px-2 py-1.5 text-ui text-right" readOnly={ro} step="0.01" /></div>
                <div className="col-span-1"><select value={item.tva_rate} onChange={e => updateItem(idx, 'tva_rate', e.target.value)} className="w-full border rounded px-1 py-1.5 text-ui-sm" disabled={ro}>{TVA_RATES.map(r => <option key={r} value={r}>{r}%</option>)}</select></div>
                <div className="col-span-1 text-right pt-2 text-ui font-medium">{money(calcItemTotal(item))}</div>
                {!ro && <div className="col-span-1 text-center pt-1"><button onClick={() => removeItem(idx)} className="p-1 text-[rgb(var(--c-danger))] hover:text-[rgb(var(--c-danger))]"><X size={16} /></button></div>}
              </div>
            ))}
          </div>
          {!ro && (
            <div className="flex gap-2 mt-3">
              <button onClick={addItem} className="px-3 py-1.5 text-ui-sm border rounded-ui-sm hover:bg-gray-50">+ Ligne</button>
              <PickerMenu
                buttonClassName="px-3 py-1.5 text-ui-sm border rounded-ui-sm hover:bg-gray-50"
                searchPlaceholder="Rechercher une formation..."
                emptyText="Aucune formation"
                items={courses.map(c => ({ key: c.id, label: c.title, hint: [c.code, c.price_ht ? money(c.price_ht) : 'Prix à définir'].filter(Boolean).join(' · '), course: c }))}
                onPick={it => addFromCourse(it.course)}
              >+ Depuis formation</PickerMenu>
            </div>
          )}
        </div>

        {/* Conditions & Totaux */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-ui border p-5">
            <h3 className="font-semibold text-ui mb-3">Conditions</h3>
            <div className="space-y-3">
              <div><label className="text-ui-sm text-gray-500">Moyen de règlement</label><select value={current?.payment_method || ''} onChange={e => setCurrent({...current, payment_method: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui mt-1" disabled={ro}>{PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
              <div><label className="text-ui-sm text-gray-500">Délai de règlement</label><select value={current?.payment_terms || ''} onChange={e => {
                const t = e.target.value; let d = 30
                if (t.includes('réception')) d = 0; else if (t.includes('45')) d = 45; else if (t.includes('60')) d = 60
                let dueD = addDays(new Date(current.invoice_date || new Date()), d)
                if (t.includes('fin de mois')) { dueD = new Date(dueD.getFullYear(), dueD.getMonth() + 1, 0) }
                setCurrent({...current, payment_terms: t, due_date: format(dueD, 'yyyy-MM-dd')})
              }} className="w-full border rounded-ui-sm px-3 py-2 text-ui mt-1" disabled={ro}>{PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
              <div><label className="text-ui-sm text-gray-500">Date d'échéance</label><input type="date" value={current?.due_date || ''} onChange={e => setCurrent({...current, due_date: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui mt-1" readOnly={ro} /></div>
              <div><label className="text-ui-sm text-gray-500">Remise globale (%)</label><input type="number" value={current?.discount_percent || 0} onChange={e => setCurrent({...current, discount_percent: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui mt-1" readOnly={ro} step="0.01" min="0" max="100" /></div>
              <div><label className="text-ui-sm text-gray-500">Notes</label><textarea value={current?.notes || ''} onChange={e => setCurrent({...current, notes: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui mt-1" rows={2} readOnly={ro} /></div>
              <div className="flex items-center gap-2 mt-1">
                <input type="checkbox" id="is_formation_pro" checked={current?.is_formation_pro !== false} onChange={e => setCurrent({...current, is_formation_pro: e.target.checked})} disabled={ro} className="w-4 h-4 rounded" />
                <label htmlFor="is_formation_pro" className="text-ui text-gray-700">Formation professionnelle <span className="text-ui-sm text-gray-400">(incluse dans le BPF)</span></label>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-ui border p-5">
            <h3 className="font-semibold text-ui mb-3">Totaux</h3>
            {currentTotals && (
              <div className="space-y-2 text-ui">
                <div className="flex justify-between"><span>Total HT</span><span>{money(currentTotals.subtotalHt)}</span></div>
                {currentTotals.discountAmt > 0 && <>
                  <div className="flex justify-between text-[rgb(var(--c-warning))]"><span>Remise ({current.discount_percent}%)</span><span>-{money(currentTotals.discountAmt)}</span></div>
                  <div className="flex justify-between"><span>Net après remise</span><span>{money(currentTotals.netHt)}</span></div>
                </>}
                <div className="flex justify-between font-semibold border-t pt-2"><span>Net HT</span><span>{money(currentTotals.netHt)}</span></div>
                {Object.entries(currentTotals.tvaByRate).map(([r, d]) => <div key={r} className="flex justify-between text-gray-500"><span>TVA {r}%</span><span>{money(d.tva)}</span></div>)}
                <div className="flex justify-between font-bold text-lg border-t pt-2"><span>TTC</span><span>{money(currentTotals.totalTtc)}</span></div>
                {isCr ? (
                  current?.id && current?.status !== 'draft' && <>
                    <div className="flex justify-between text-[rgb(var(--c-warning))]"><span>Imputé sur la facture</span><span>{money(current.amount_credited || 0)}</span></div>
                    {parseFloat(current?.amount_paid) > 0.01 && <div className="flex justify-between text-[rgb(var(--c-success))]"><span>Déjà remboursé</span><span>{money(current.amount_paid)}</span></div>}
                    {parseFloat(current?.amount_due) > 0.01 && <div className="flex justify-between font-bold text-[rgb(var(--c-danger))] border-t pt-2"><span>Reste à rembourser</span><span>{money(current.amount_due)}</span></div>}
                  </>
                ) : (
                  (parseFloat(current?.amount_paid) > 0 || parseFloat(current?.amount_due) > 0.01 || parseFloat(current?.amount_credited) > 0.01) && <>
                    <div className="flex justify-between text-[rgb(var(--c-success))]"><span>Déjà payé</span><span>{money(current.amount_paid || 0)}</span></div>
                    {parseFloat(current?.amount_credited) > 0.01 && <div className="flex justify-between text-[rgb(var(--c-warning))]"><span>Avoirs</span><span>-{money(current.amount_credited)}</span></div>}
                    {parseFloat(current?.amount_due) > 0.01 && <div className="flex justify-between font-bold text-[rgb(var(--c-danger))] border-t pt-2"><span>Reste dû</span><span>{money(current.amount_due)}</span></div>}
                  </>
                )}
                {!isCr && current?.id && invoices.some(i => i.type === 'credit_note' && i.parent_invoice_id === current.id) && (
                  <div className="border-t pt-2 mt-2 space-y-1">
                    <p className="text-ui-sm text-gray-500">Avoirs liés</p>
                    {invoices.filter(i => i.type === 'credit_note' && i.parent_invoice_id === current.id).map(a => (
                      <button key={a.id} onClick={() => handleView(a)} className="w-full flex justify-between text-ui-sm text-[rgb(var(--c-warning))] hover:underline">
                        <span>{a.reference} · {getStatusInfo(a).label}</span><span>-{money(a.total_ttc)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Paiements */}
        {current?.id && (
          <div className="bg-white rounded-ui border p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-ui">{isCr ? 'Remboursements' : 'Paiements'}</h3>
              {(isCr
                ? (current.status === 'due' && parseFloat(current.amount_due) > 0.01)
                : (!['cancelled', 'credited'].includes(current.status) && (current.status !== 'paid' || parseFloat(current.amount_due) > 0.01))
              ) && (
                <button onClick={() => { setPaymentForm({...paymentForm, amount: parseFloat(current.amount_due) > 0.01 ? current.amount_due : ''}); setShowPaymentForm(true) }} className="btn btn-secondary text-ui-sm flex items-center gap-1">
                  <CreditCard size={14} />{isCr ? 'Enregistrer un remboursement' : 'Enregistrer un paiement'}
                </button>
              )}
            </div>
            {payments.length === 0
              ? <p className="text-ui text-gray-400">{isCr ? 'Aucun remboursement enregistré' : 'Aucun paiement enregistré'}</p>
              : <div className="space-y-2">
                  {payments.map(p => (
                    <div key={p.id} className="flex items-center justify-between border rounded-ui-sm p-3 text-ui">
                      <div><span className="font-medium text-[rgb(var(--c-success))]">{money(p.amount)}</span><span className="text-gray-500 ml-3">{fmtDateShort(p.payment_date)}</span><span className="text-gray-400 ml-3">{p.payment_method}</span></div>
                      {p.payment_reference && <span className="text-ui-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{p.payment_reference}</span>}
                    </div>
                  ))}
                </div>
            }
            {showPaymentForm && (
              <div className="mt-4 border-t pt-4">
                <h4 className="text-ui font-medium mb-3">{isCr ? 'Nouveau remboursement' : 'Nouveau paiement'}</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div><label className="text-ui-sm text-gray-500">Montant</label><input type="number" value={paymentForm.amount} onChange={e => setPaymentForm({...paymentForm, amount: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui mt-1" step="0.01" autoFocus /></div>
                  <div><label className="text-ui-sm text-gray-500">Date</label><input type="date" value={paymentForm.payment_date} onChange={e => setPaymentForm({...paymentForm, payment_date: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui mt-1" /></div>
                  <div><label className="text-ui-sm text-gray-500">Moyen</label><select value={paymentForm.payment_method} onChange={e => setPaymentForm({...paymentForm, payment_method: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui mt-1">{PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
                  <div><label className="text-ui-sm text-gray-500">Référence</label><input type="text" value={paymentForm.payment_reference} onChange={e => setPaymentForm({...paymentForm, payment_reference: e.target.value})} className="w-full border rounded-ui-sm px-3 py-2 text-ui mt-1" placeholder="N° virement..." /></div>
                </div>
                <div className="flex gap-2 mt-3 justify-end">
                  <button onClick={() => setShowPaymentForm(false)} className="px-3 py-1.5 border rounded-ui-sm text-ui">Annuler</button>
                  <button onClick={handleAddPayment} className="btn btn-secondary text-ui">Valider</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Changer le statut (view) */}
        {mode === 'view' && current?.type === 'invoice' && current?.status !== 'credited' && !isDraftDoc(current) && droitsFac.modifier && (
          <div className="bg-white rounded-ui border p-5">
            <h3 className="font-semibold text-ui mb-3">Changer le statut</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(STATUS_MAP).filter(([k]) => k !== current.status && !['credited', 'draft', 'cancelled'].includes(k)).map(([k, v]) => (
                <button key={k} onClick={async () => {
                  await handleStatus(current.id, k)
                  if (current.id) { await refreshCurrent(current.id); await loadPayments(current.id) }
                }} className={`px-3 py-1.5 rounded-ui-sm text-ui-sm font-medium`} style={toneStyle(v.color)}>{v.label}</button>
              ))}
            </div>
          </div>
        )}

        {/* Historique envois (view) */}
        {mode === 'view' && current?.id && (invoiceRelancesMap[current.id] || []).length > 0 && (
          <div className="bg-white rounded-ui border p-5">
            <h3 className="font-semibold text-ui mb-3 flex items-center gap-2"><Mail size={16} className="text-[rgb(var(--c-info))]" />Historique des envois</h3>
            <div className="space-y-2">
              {(invoiceRelancesMap[current.id] || []).map((r, i) => (
                <div key={r.id || i} className="flex items-center justify-between text-ui border-b pb-2 last:border-0 last:pb-0">
                  <div>
                    <span className={`font-medium ${i === 0 ? 'text-[rgb(var(--c-info))]' : i >= 2 ? 'text-[rgb(var(--c-danger))]' : 'text-[rgb(var(--c-warning))]'}`}>
                      {i === 0 ? 'Envoi initial' : (isCr ? `Renvoi ${i}` : `Relance ${i}`)}
                    </span>
                    <span className="text-gray-500 ml-3">{r.to_email}</span>
                    <span className="text-gray-400 ml-3">par {r.sent_by}</span>
                  </div>
                  <span className="text-ui-sm text-gray-400">{format(new Date(r.sent_at), 'dd/MM/yyyy HH:mm')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Émission : récapitulatif, aperçu, confirmation */}
      {emission && (
        <Sheet title={emission.inv.type === 'credit_note' ? "Émettre l'avoir" : 'Émettre la facture'} size="md" onClose={() => !emission.enCours && setEmission(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" disabled={emission.enCours} onClick={() => setEmission(null)}>Revenir</button>
            <button type="button" className="btn btn-primary" disabled={!emission.verifie || emission.enCours} onClick={emettre}>
              {emission.enCours ? 'Émission…' : 'Émettre définitivement'}
            </button>
          </>}>
          <p className="text-gray-700">Une fois émis, le document reçoit son numéro définitif et ne se modifie plus. Une erreur se corrigera par un avoir.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ui">
            <dt className="text-gray-500">Client</dt><dd className="font-medium">{clients.find(c => c.id === emission.inv.client_id)?.name || '-'}</dd>
            {emission.inv.parent_reference && <><dt className="text-gray-500">Facture d'origine</dt><dd>{emission.inv.parent_reference}</dd></>}
            <dt className="text-gray-500">Total HT</dt><dd className="tabular-nums">{money(emission.totaux.total_net_ht)}</dd>
            {(emission.totaux.par_taux || []).flatMap((t) => [<dt key={'t' + t.taux} className="text-gray-500">TVA {Number(t.taux)} %</dt>, <dd key={'v' + t.taux} className="tabular-nums">{money(t.tva)}</dd>])}
            {!emission.totaux.par_taux && <><dt className="text-gray-500">TVA</dt><dd className="tabular-nums">{money(emission.totaux.total_tva)}</dd></>}
            <dt className="text-gray-500">Total TTC</dt><dd className="tabular-nums font-semibold">{money(emission.totaux.total_ttc)}</dd>
            {emission.inv.due_date && <><dt className="text-gray-500">Échéance</dt><dd>{fmtDateShort(emission.inv.due_date)} (décalée si la date de facture change)</dd></>}
            {emission.prochain && <><dt className="text-gray-500">Numéro prévu</dt><dd>{emission.prochain}</dd></>}
          </dl>
          <button type="button" className="btn btn-secondary justify-self-start" onClick={() => apercuBrouillon(emission.inv, emission.items)}><Eye size={14} />Voir l'aperçu du PDF</button>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={emission.verifie} onChange={(e) => setEmission((x) => ({ ...x, verifie: e.target.checked }))} />
            <span>J'ai vérifié le client, les lignes et les montants.</span>
          </label>
        </Sheet>
      )}

      {/* Modal envoi depuis vue détail */}
      {showSendModal && sendModalInv && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-ui shadow-md w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Mail size={18} className="text-[rgb(var(--c-info))]" />
                {sendModalInv.type === 'credit_note'
                  ? `${sendModalRelances.length === 0 ? 'Envoyer' : 'Renvoyer'} l'avoir ${sendModalInv.reference}`
                  : (sendModalRelances.length === 0 ? `Envoyer ${sendModalInv.reference}` : `Relance ${sendModalRelances.length} - ${sendModalInv.reference}`)}
              </h3>
              <button onClick={() => setShowSendModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            {sendModalRelances.length > 0 && (
              <div className="px-4 pt-3 pb-0">
                <div className="flex flex-wrap gap-2 text-ui-sm">
                  {sendModalRelances.map((r, i) => (
                    <span key={r.id || i} className="bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                      {i === 0 ? 'Envoi' : (sendModalInv.type === 'credit_note' ? `Renvoi ${i}` : `Relance ${i}`)} le {format(new Date(r.sent_at), 'dd/MM/yyyy')} → {r.to_email}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="text-ui-sm font-medium text-gray-500 block mb-1">Expéditeur</label>
                <select value={sendForm.caller} onChange={e => setSendForm(f => ({...f, caller: e.target.value}))} className="w-full border rounded-ui-sm px-3 py-2 text-ui">
                  {teamNames().map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="text-ui-sm font-medium text-gray-500 block mb-1">Destinataire</label>
                <input type="email" value={sendForm.to} onChange={e => setSendForm(f => ({...f, to: e.target.value}))} className="w-full border rounded-ui-sm px-3 py-2 text-ui" placeholder="email@entreprise.fr" />
              </div>
              <div>
                <label className="text-ui-sm font-medium text-gray-500 block mb-1">Objet</label>
                <input type="text" value={sendForm.subject} onChange={e => setSendForm(f => ({...f, subject: e.target.value}))} className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
              </div>
              <div>
                <label className="text-ui-sm font-medium text-gray-500 block mb-1">Message</label>
                <textarea value={sendForm.body} onChange={e => setSendForm(f => ({...f, body: e.target.value}))} className="w-full border rounded-ui-sm px-3 py-2 text-ui font-mono" rows={12} />
              </div>
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-ui-sm px-3 py-2 text-ui text-gray-800">
                <Download size={14} />
                <span>Pièce jointe : <strong>{sendModalInv.reference}_facturx.pdf</strong></span>
              </div>
            </div>
            <div className="p-4 border-t flex justify-end gap-3">
              <button onClick={() => setShowSendModal(false)} className="px-4 py-2 border rounded-ui-sm text-ui text-gray-600 hover:bg-gray-50" disabled={sendingEmail}>Annuler</button>
              <button onClick={handleSendInvoice} disabled={sendingEmail || !sendForm.to} className="btn btn-secondary text-ui font-medium hover:bg-[rgb(var(--c-info))] disabled:opacity-50 flex items-center gap-2">
                {sendingEmail
                  ? <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />Envoi…</>
                  : <><Mail size={14} />{sendModalInv.type === 'credit_note' ? (sendModalRelances.length === 0 ? "Envoyer l'avoir" : "Renvoyer l'avoir") : (sendModalRelances.length === 0 ? 'Envoyer' : `Envoyer la relance ${sendModalRelances.length}`)}</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

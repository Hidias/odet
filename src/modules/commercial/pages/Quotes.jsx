import { toneStyle } from '../../../ui/StatusBadge'
import { orgName, currentUserName, teamNames } from '../../../core/org/currentOrg'
import { apiFetch } from '../../../core/api'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { generateQuotePDF, generatePartialAcceptancePDF } from '../pdf/quoteGenerator'
import { generatePDF, setOrganization } from '../../formation/pdf/pdfGenerator'
import { fichierDeLInstance } from '../../../core/fichiersInstance'
import { useDataStore } from '../../../core/store'
import {
  Plus, Search, FileText, ArrowLeft, Trash2, Save, Send, Copy,
  ChevronDown, ChevronUp, Eye, MoreHorizontal, Check, X, Edit2,
  Download, RefreshCw, Building2, GripVertical, Pen, Mail, Loader2, Paperclip,
  GraduationCap, Calendar, MapPin, Users
} from 'lucide-react'
import { money } from '../../../core/utils'
import SearchSelect, { clientOptions } from '../../../ui/SearchSelect'
import PickerMenu from '../../../ui/PickerMenu'
import { useOuvrirSiDemande } from '../../../ui/useOuvrirSiDemande'
import { calcItemTotal, calcTotals } from '../lib/quoteTotals'
import { parseRate } from '../../../core/billing/totals'
import { quoteDay, nextQuoteReference } from '../lib/references'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRelanceIA } from '../lib/useRelanceIA'
import { publishedDocPDF } from '../../qualite/richdocs/published'
import AcompteDevis from '../components/AcompteDevis'

import { confirmer } from '../../../ui/Confirm'
import { BadgeTest, BandeauTest } from '../../../core/demo/BadgeTest'
const STATUS_CONFIG = {
  draft: { label: 'Brouillon', class: 'bg-gray-100 text-gray-700', icon: '' },
  sent: { label: 'Envoyé', class: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]', icon: '' },
  accepted: { label: 'Accepté', class: 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]', icon: '' },
  refused: { label: 'Refusé', class: 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]', icon: '' },
  expired: { label: 'Expiré', class: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]', icon: '' },
  partial: { label: 'Partiellement accepté', class: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]', icon: '' },
  invoiced: { label: 'Facturé', class: 'bg-gray-100 text-gray-800', icon: '' }
}

const PAYMENT_METHODS = [
  'virement bancaire',
  'chèque, virement bancaire',
  'virement bancaire, prélèvement',
  'chèque'
]

const PAYMENT_TERMS = [
  'À réception de facture',
  'À la commande',
  'à 30 jours',
  'à 30 jours fin de mois',
  'à 45 jours',
  'à 45 jours fin de mois',
  'à 60 jours',
  'à 60 jours fin de mois'
]


// ============================================================
// SIGNATURE PAD COMPONENT
// ============================================================
function SignaturePad({ value, onChange, onClear }) {
  const canvasRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(!!value)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * 2
    canvas.height = rect.height * 2
    ctx.scale(2, 2)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    if (value) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height)
      img.src = value
    }
    ctx.strokeStyle = '#1a1a2e'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  const getPos = useCallback((e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return { x: clientX - rect.left, y: clientY - rect.top }
  }, [])

  const startDraw = useCallback((e) => {
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(getPos(e).x, getPos(e).y)
    setIsDrawing(true)
    setHasDrawn(true)
  }, [getPos])

  const draw = useCallback((e) => {
    if (!isDrawing) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    ctx.strokeStyle = '#1a1a2e'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineTo(getPos(e).x, getPos(e).y)
    ctx.stroke()
  }, [isDrawing, getPos])

  const endDraw = useCallback(() => {
    if (!isDrawing) return
    setIsDrawing(false)
    onChange(canvasRef.current.toDataURL('image/png'))
  }, [isDrawing, onChange])

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width * 2, rect.height * 2)
    setHasDrawn(false)
    onClear()
  }, [onClear])

  return (
    <div>
      <div className="border-2 border-dashed border-gray-300 rounded-ui-sm overflow-hidden bg-white relative">
        <canvas ref={canvasRef} className="w-full cursor-crosshair"
          style={{ height: '120px', touchAction: 'none' }}
          onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
          onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
        {!hasDrawn && !value && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-gray-300 text-ui flex items-center gap-2"><Pen size={16} /> Signez ici</p>
          </div>
        )}
      </div>
      {(hasDrawn || value) && (
        <button onClick={clearCanvas} className="mt-1 text-ui-sm text-[rgb(var(--c-danger))] hover:text-[rgb(var(--c-danger))] flex items-center gap-1">
          <X size={12} /> Effacer la signature
        </button>
      )}
    </div>
  )
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function Quotes() {
  const { createSession, trainers: storeTrainers, fetchTrainers, organization, fetchOrganization } = useDataStore()
  useEffect(() => { if (!organization) fetchOrganization() }, [])
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [quotes, setQuotes] = useState([])
  const [clients, setClients] = useState([])
  const [contacts, setContacts] = useState([])
  // Client combobox
  const [clientSearchTerm, setClientSearchTerm] = useState('')
  const [showClientDropdown, setShowClientDropdown] = useState(false)
  const clientComboRef = useRef(null)
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [mode, setMode] = useState('list') // list | view | create | edit
  const [currentQuote, setCurrentQuote] = useState(null)
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [generatingPartialPdf, setGeneratingPartialPdf] = useState(false)
  const [actionMenuId, setActionMenuId] = useState(null)
  const [acompteDevis, setAcompteDevis] = useState(null) // devis dont on facture un acompte (0368)
  const actionMenuRef = useRef(null)

  // === Relance IA ===
  const { relanceQuote, generating: relanceGenerating, previewData, confirmSend, cancelPreview } = useRelanceIA()
  const [relanceEdit, setRelanceEdit] = useState({ subject: '', body: '' })
  const [relanceConfirmed, setRelanceConfirmed] = useState(false)

  // === Send Wizard State ===
  const [sendWizard, setSendWizard] = useState(null) // { quote, client, contact, items, pdfBlobUrl, pdfBase64 }
  const [sendStep, setSendStep] = useState(1) // 1=aperçu PDF, 2=texte email, 3=recap+envoi
  const [sendEmail, setSendEmail] = useState({ to: '', subject: '', body: '', customInstructions: '' })
  const [sendLoading, setSendLoading] = useState(false)
  const [sendSending, setSendSending] = useState(false)
  const [sendAttachments, setSendAttachments] = useState([]) // [{filename, base64, type:'program'|'manual', courseTitle?, enabled:true}]

  // === Session Generation State ===
  const [sessionWizard, setSessionWizard] = useState(null) // { quote, client, formations: [{item, course}] }
  const [sessionSelections, setSessionSelections] = useState([]) // [{courseId, selected, startDate, endDate, trainerId, location, nbParticipants}]
  const [sessionCreating, setSessionCreating] = useState(false)

  const emptyQuote = {
    client_id: '', contact_id: '', session_id: '',
    quote_date: format(new Date(), 'yyyy-MM-dd'), validity_date: '', object: '',
    client_reference: '', status: 'draft', payment_method: 'virement bancaire',
    payment_terms: 'à 30 jours', payment_deadline: '', discount_percent: 0,
    discount_label: '', tva_rate: 20, tva_applicable: true, notes: '',
    created_by: currentUserName(), signature_base64: null
  }

  const emptyItem = {
    code: '', description_title: '', description_detail: '',
    quantity: 1, unit: 'unité', unit_price_ht: 0, tva_rate: 20, course_id: '', nature: 'service', vat_regime: 'normal'
  }

  // Lignes prêtes à l'emploi (bouton « Matériel et frais ») : matériel de formation et forfaits de déplacement.
  // Zones de déplacement : tarifs 2 et 3 à fixer (le prix reste modifiable sur la ligne).
  const predefinedMaterials = [
    { code: 'DEP-Z1', description_title: 'Forfait frais de déplacement zone 1', description_detail: '', unit_price_ht: 30, unit: 'forfait', nature: 'service' },
    { code: 'DEP-Z2', description_title: 'Forfait frais de déplacement zone 2', description_detail: 'Tarif à fixer', unit_price_ht: 0, unit: 'forfait', nature: 'service' },
    { code: 'DEP-Z3', description_title: 'Forfait frais de déplacement zone 3', description_detail: 'Tarif à fixer', unit_price_ht: 0, unit: 'forfait', nature: 'service' },
    { code: 'MAT-EXT-EAU', description_title: 'Extincteur de formation à eau', description_detail: '1 pour 3 personnes', unit_price_ht: 20, unit: 'unité' },
    { code: 'MAT-EXT-CO2', description_title: 'Extincteur CO2', description_detail: '1 pour 2 personnes', unit_price_ht: 20, unit: 'unité' }
  ]

  useEffect(() => { loadAll() }, [])

  // Synchro édition relance quand IA a généré le brouillon
  useEffect(() => {
    if (previewData) {
      setRelanceEdit({ subject: previewData.subject || '', body: previewData.body || '' })
      setRelanceConfirmed(false)
    }
  }, [previewData])

  // « + Nouveau › Devis » (barre du haut)
  useOuvrirSiDemande(() => openCreate())

  // Devis préparé ailleurs (ex. remplacements relevés pendant une visite d'intervention) : ?open=<id>
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || mode !== 'list') return
    supabase.from('quotes').select('*').eq('id', openId).maybeSingle().then(({ data }) => {
      if (data) openEdit(data)
      setSearchParams({}, { replace: true })
    })
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open create mode if ?client_id=xxx in URL (from RDV "Créer devis")
  useEffect(() => {
    const clientIdParam = searchParams.get('client_id')
    if (clientIdParam && clients.length > 0 && mode === 'list') {
      const client = clients.find(c => c.id === clientIdParam)
      if (client) {
        (async () => {
          const ref = await generateReference()
          const qDate = format(new Date(), 'yyyy-MM-dd')
          const vDate = calcValidityDate(qDate)
          setCurrentQuote({ ...emptyQuote, reference: ref, quote_date: qDate, validity_date: vDate, payment_deadline: vDate, client_id: client.id })
          await loadClientContacts(client.id)
          setItems([])
          setMode('create')
          // Clean URL params
          setSearchParams({}, { replace: true })
          toast.success(`Nouveau devis pour ${client.name}`)
        })()
      }
    }
  }, [clients, searchParams])

  async function loadAll() {
    setLoading(true)
    const [quotesRes, clientsRes, coursesRes] = await Promise.all([
      // fetchAll : pagination complète (PostgREST tronque à 1 000 lignes sans erreur)
      fetchAll(() => supabase.from('quotes').select('*, clients(name, siret, address, postal_code, city, contact_name, contact_phone, contact_email)').order('quote_date', { ascending: false })),
      fetchAll(() => supabase.from('clients').select('id, name, siret, siren, address, postal_code, city, contact_name, contact_phone, contact_email, status').order('name')),
      fetchAll(() => supabase.from('courses').select('id, title, code, price_ht, duration_hours, duration_days, description').order('title'))
    ])
    setQuotes(quotesRes.data || [])
    setClients(clientsRes.data || [])
    setCourses(coursesRes.data || [])
    setLoading(false)
  }

  async function loadQuoteItems(quoteId) {
    const { data } = await supabase.from('quote_items').select('*').eq('quote_id', quoteId).order('position')
    return data || []
  }

  async function loadClientContacts(clientId) {
    if (!clientId) { setContacts([]); return }
    const { data } = await supabase.from('client_contacts').select('*').eq('client_id', clientId)
      .order('is_primary', { ascending: false }).order('name')
    setContacts(data || [])
  }

  async function generateReference() {
    const now = new Date(), today = quoteDay(now)
    const { data } = await supabase.from('quotes').select('reference')
      .like('reference', `DEV-${today}%`).order('reference', { ascending: false }).limit(1)
    return nextQuoteReference(data && data.length > 0 ? data[0].reference : null, now)
  }

  function calcValidityDate(quoteDate) {
    const d = new Date(quoteDate); d.setDate(d.getDate() + 30)
    return format(d, 'yyyy-MM-dd')
  }

  async function openCreate() {
    const ref = await generateReference()
    const qDate = format(new Date(), 'yyyy-MM-dd')
    const vDate = calcValidityDate(qDate)
    setCurrentQuote({ ...emptyQuote, reference: ref, quote_date: qDate, validity_date: vDate, payment_deadline: vDate })
    setItems([])
    setContacts([])
    setMode('create')
  }

  async function openEdit(quote) {
    const loadedItems = await loadQuoteItems(quote.id)
    await loadClientContacts(quote.client_id)
    setCurrentQuote({
      ...quote, quote_date: quote.quote_date || '', validity_date: quote.validity_date || '',
      payment_deadline: quote.payment_deadline || '', discount_percent: quote.discount_percent || 0,
      discount_label: quote.discount_label || '', tva_rate: quote.tva_rate || 20,
      tva_applicable: quote.tva_applicable !== false, signature_base64: quote.signature_base64 || null,
    })
    setItems(loadedItems)
    setMode('edit')
  }

  async function openView(quote) {
    const loadedItems = await loadQuoteItems(quote.id)
    setCurrentQuote({
      ...quote, quote_date: quote.quote_date || '', validity_date: quote.validity_date || '',
      payment_deadline: quote.payment_deadline || '', discount_percent: quote.discount_percent || 0,
      discount_label: quote.discount_label || '', tva_rate: quote.tva_rate || 20,
      tva_applicable: quote.tva_applicable !== false, signature_base64: quote.signature_base64 || null,
    })
    setItems(loadedItems)
    setMode('view')
  }

  useEffect(() => {
    function handleClickOutside(e) {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target)) setActionMenuId(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function duplicateQuote(quote) {
    if (!await confirmer(`Dupliquer le devis ${quote.reference} ?`)) return
    const ref = await generateReference()
    const qDate = format(new Date(), 'yyyy-MM-dd')
    const vDate = calcValidityDate(qDate)
    const loadedItems = await loadQuoteItems(quote.id)
    await loadClientContacts(quote.client_id)
    setCurrentQuote({
      ...quote, id: undefined, reference: ref, quote_date: qDate, validity_date: vDate,
      payment_deadline: vDate, status: 'draft', created_at: undefined, updated_at: undefined,
      clients: undefined, signature_base64: null,
    })
    setItems(loadedItems.map((it, i) => ({ ...it, id: undefined, quote_id: undefined, position: i })))
    setMode('create')
  }

  async function saveQuote() {
    if (!currentQuote.client_id) return toast.error('Sélectionnez un client')
    if (items.length === 0 || !items[0].description_title) return toast.error('Ajoutez au moins une ligne')
    setSaving(true)
    const totals = calcTotals(items, currentQuote.discount_percent, currentQuote.tva_rate, currentQuote.tva_applicable)
    const quoteData = {
      reference: currentQuote.reference, client_id: currentQuote.client_id,
      contact_id: currentQuote.contact_id || null, session_id: currentQuote.session_id || null,
      quote_date: currentQuote.quote_date, validity_date: currentQuote.validity_date || null,
      object: currentQuote.object || '', client_reference: currentQuote.client_reference || '',
      status: currentQuote.status, payment_method: currentQuote.payment_method,
      payment_terms: currentQuote.payment_terms, payment_deadline: currentQuote.payment_deadline || null,
      discount_percent: parseFloat(currentQuote.discount_percent) || 0,
      discount_label: currentQuote.discount_label || '',
      tva_rate: parseRate(currentQuote.tva_rate), tva_applicable: currentQuote.tva_applicable,
      total_ht: totals.totalHt, total_tva: totals.totalTva, total_ttc: totals.totalTtc,
      notes: currentQuote.notes || '', created_by: currentQuote.created_by,
      signature_base64: currentQuote.signature_base64 || null,
      updated_at: new Date().toISOString()
    }
    try {
      let quoteId
      if (mode === 'create') {
        const { data, error } = await supabase.from('quotes').insert(quoteData).select().single()
        if (error) throw error
        quoteId = data.id
      } else {
        const { error } = await supabase.from('quotes').update(quoteData).eq('id', currentQuote.id)
        if (error) throw error
        quoteId = currentQuote.id
        await supabase.from('quote_items').delete().eq('quote_id', quoteId)
      }
      const itemsToInsert = items.filter(it => it.description_title).map((it, i) => ({
        quote_id: quoteId, position: i, code: it.code || '',
        description_title: it.description_title, description_detail: it.description_detail || '',
        quantity: parseFloat(it.quantity) || 1, unit: it.unit || 'unité',
        unit_price_ht: parseFloat(it.unit_price_ht) || 0, tva_rate: parseRate(it.tva_rate),
        total_ht: calcItemTotal(it), course_id: it.course_id || null,
        // Nature et régime de TVA de la ligne (0363), repris sur la facture
        nature: it.nature === 'bien' ? 'bien' : 'service', vat_regime: it.vat_regime || 'normal'
      }))
      if (itemsToInsert.length > 0) {
        const { error: itemsError } = await supabase.from('quote_items').insert(itemsToInsert)
        if (itemsError) throw itemsError
      }
      toast.success(mode === 'create' ? 'Devis créé' : 'Devis mis à jour')
      setMode('list')
      loadAll()
    } catch (err) { toast.error('Erreur: ' + err.message) }
    setSaving(false)
  }

  async function deleteQuote(id) {
    if (!await confirmer('Supprimer ce devis ?')) return
    await supabase.from('quote_items').delete().eq('quote_id', id)
    await supabase.from('quotes').delete().eq('id', id)
    toast.success('Devis supprimé')
    loadAll()
  }

  async function updateStatus(id, newStatus) {
    if (!await confirmer(`Passer ce devis en "${STATUS_CONFIG[newStatus].label}" ?`)) return
    await supabase.from('quotes').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', id)
    toast.success(`Statut → ${STATUS_CONFIG[newStatus].label}`)
    if (currentQuote && currentQuote.id === id) setCurrentQuote(prev => ({ ...prev, status: newStatus }))
    loadAll()
  }

  // === PDF from list ===
  async function downloadPDF(quote) {
    setGeneratingPdf(true)
    try {
      const loadedItems = await loadQuoteItems(quote.id)
      const clientData = clients.find(c => c.id === quote.client_id) || quote.clients || {}
      let contactData = null
      if (quote.contact_id) {
        const { data } = await supabase.from('client_contacts').select('*').eq('id', quote.contact_id).single()
        contactData = data
      }
      await generateQuotePDF(quote, loadedItems, clientData, contactData, { orgSettings: organization })
      toast.success('PDF généré !')
    } catch (err) { console.error(err); toast.error('Erreur PDF: ' + err.message) }
    setGeneratingPdf(false)
  }

  // === PDF from form ===
  async function downloadCurrentPDF() {
    setGeneratingPdf(true)
    try {
      const clientData = clients.find(c => c.id === currentQuote.client_id) || {}
      const contactData = currentQuote.contact_id ? contacts.find(c => c.id === currentQuote.contact_id) || null : null
      const itemsForPdf = items.filter(it => it.description_title).map(it => ({ ...it, total_ht: calcItemTotal(it) }))
      await generateQuotePDF(currentQuote, itemsForPdf, clientData, contactData, { orgSettings: organization })
      toast.success('PDF généré !')
    } catch (err) { console.error(err); toast.error('Erreur PDF: ' + err.message) }
    setGeneratingPdf(false)
  }

  // ============================================================
  // SEND WIZARD
  // ============================================================
  async function openSendWizard(quote) {
    setSendLoading(true)
    try {
      // Load quote items
      const loadedItems = await loadQuoteItems(quote.id)
      // Client data
      const clientData = clients.find(c => c.id === quote.client_id) || quote.clients || {}
      // Contact data
      let contactData = null
      if (quote.contact_id) {
        const { data } = await supabase.from('client_contacts').select('*').eq('id', quote.contact_id).single()
        contactData = data
      }
      // All contacts for this client (for recipient selection)
      let clientContacts = []
      if (quote.client_id) {
        const { data } = await supabase.from('client_contacts').select('*').eq('client_id', quote.client_id)
          .order('is_primary', { ascending: false }).order('name')
        clientContacts = data || []
      }

      // Generate PDF without downloading
      const doc = await generateQuotePDF(quote, loadedItems, clientData, contactData, { skipSave: true, orgSettings: organization })
      const pdfBlob = doc.output('blob')
      const pdfBlobUrl = URL.createObjectURL(pdfBlob)

      // Convert blob to base64 (doc.output('base64') is unreliable)
      const pdfBase64 = await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result
          resolve(dataUrl.split(',')[1]) // Remove "data:application/pdf;base64," prefix
        }
        reader.readAsDataURL(pdfBlob)
      })

      console.log('PDF généré pour envoi, taille base64:', pdfBase64?.length || 0)

      // Find default recipient email
      let defaultTo = ''
      if (contactData?.email) {
        defaultTo = contactData.email
      } else if (clientData?.contact_email) {
        defaultTo = clientData.contact_email
      }

      setSendWizard({
        quote, client: clientData, contact: contactData, items: loadedItems,
        pdfBlobUrl, pdfBase64, clientContacts
      })
      setSendEmail({ to: defaultTo, subject: '', body: '', customInstructions: '' })
      setSendStep(1)

      // Programme de chaque formation du devis : PDF déposé dans le stockage de l'instance s'il existe, sinon
      // programme généré par l'outil depuis la fiche de la formation. Jamais un fichier d'un autre outil
      // (fichierDeLInstance) : il porterait l'identité d'un autre organisme.
      const programAttachments = []
      const courseIds = [...new Set(loadedItems.filter(it => it.course_id).map(it => it.course_id))]
      if (courseIds.length > 0) {
        const { data: coursesData } = await supabase
          .from('courses')
          .select('*')
          .in('id', courseIds)
        if (organization) setOrganization(organization)

        for (const course of (coursesData || [])) {
          const filename = `Programme_${course.code || course.title.replace(/\s+/g, '_')}.pdf`
          const url = fichierDeLInstance(course.program_url)
          if (url) {
            programAttachments.push({ filename, url, type: 'program', courseTitle: course.title, enabled: true })
          } else {
            try {
              const genere = await generatePDF('programme', { courses: course, reference: quote.reference })
              if (genere?.base64) {
                programAttachments.push({ filename, base64: genere.base64, type: 'program', courseTitle: course.title, enabled: true })
              }
            } catch (e) {
              console.error('Programme non généré :', e)
            }
          }
        }
      }
      // Conditions générales de vente : document qualité « CGV » dans sa version publiée (Qualité > Documents)
      const cgv = await publishedDocPDF('cgv')
      if (cgv) {
        programAttachments.push({
          filename: cgv.filename,
          base64: cgv.base64,
          type: 'manual',
          kind: 'cgv',
          courseTitle: cgv.source === 'valide' ? 'Conditions générales de vente' : 'Conditions générales de vente (version non validée)',
          enabled: cgv.source === 'valide',
        })
      }
      setSendAttachments(programAttachments)
    } catch (err) {
      console.error('Erreur ouverture envoi:', err)
      toast.error('Erreur: ' + err.message)
    }
    setSendLoading(false)
  }

  function closeSendWizard() {
    if (sendWizard?.pdfBlobUrl) URL.revokeObjectURL(sendWizard.pdfBlobUrl)
    setSendWizard(null)
    setSendStep(1)
    setSendEmail({ to: '', subject: '', body: '', customInstructions: '' })
    setSendAttachments([])
  }


  // ============================================================
  // ACCEPTATION PARTIELLE - VALIDATION LIGNE PAR LIGNE
  // ============================================================
  async function toggleItemAccepted(itemId, acceptedValue) {
    const { error } = await supabase.from('quote_items').update({ accepted: acceptedValue }).eq('id', itemId)
    if (error) { toast.error('Erreur: ' + error.message); return }

    const updatedItems = items.map(it => it.id === itemId ? { ...it, accepted: acceptedValue } : it)
    setItems(updatedItems)

    // Recalcul statut quote
    const decisions = updatedItems.map(it => it.accepted)
    const hasSomeDecision = decisions.some(d => d !== null && d !== undefined)
    if (!hasSomeDecision) return // aucune décision → statut inchangé

    const allTrue = decisions.every(d => d === true)
    const allFalse = decisions.every(d => d === false)
    let newStatus = 'partial'
    if (allTrue) newStatus = 'accepted'
    else if (allFalse) newStatus = 'refused'

    if (newStatus !== currentQuote.status) {
      await supabase.from('quotes').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', currentQuote.id)
      setCurrentQuote(prev => ({ ...prev, status: newStatus }))
      setQuotes(prev => prev.map(q => q.id === currentQuote.id ? { ...q, status: newStatus } : q))
      toast.success(`Statut → ${STATUS_CONFIG[newStatus]?.label || newStatus}`)
    }
  }

  async function downloadPartialPDF() {
    if (!items.some(it => it.accepted === true)) {
      return toast.error('Aucune ligne acceptée')
    }
    setGeneratingPartialPdf(true)
    try {
      const clientData = clients.find(c => c.id === currentQuote.client_id) || currentQuote.clients || {}
      const contactData = currentQuote.contact_id ? contacts.find(c => c.id === currentQuote.contact_id) || null : null
      const itemsForPdf = items.filter(it => it.description_title).map(it => ({ ...it, total_ht: calcItemTotal(it) }))
      await generatePartialAcceptancePDF(currentQuote, itemsForPdf, clientData, contactData, { orgSettings: organization })
      toast.success('Bon de commande partiel généré !')
    } catch (err) { console.error(err); toast.error('Erreur PDF: ' + err.message) }
    setGeneratingPartialPdf(false)
  }

  // ============================================================
  // SESSION GENERATION FROM ACCEPTED QUOTE
  // ============================================================
  async function openSessionWizard(quote) {
    try {
      // Ensure trainers are loaded
      if (!storeTrainers?.length) await fetchTrainers()
      const currentTrainers = useDataStore.getState().trainers

      const loadedItems = await loadQuoteItems(quote.id)
      // Si des décisions d'acceptation existent, filtrer sur les lignes acceptées uniquement
      const hasPartialAcceptance = loadedItems.some(it => it.accepted !== null)
      const eligibleItems = hasPartialAcceptance ? loadedItems.filter(it => it.accepted === true) : loadedItems
      const formationItems = eligibleItems.filter(it => it.course_id)
      if (formationItems.length === 0) {
        return toast.error(hasPartialAcceptance ? 'Aucune formation acceptée dans ce devis' : 'Aucune formation dans ce devis')
      }
      const client = clients.find(c => c.id === quote.client_id) || {}
      const formations = formationItems.map(item => {
        const course = courses.find(c => c.id === item.course_id)
        return { item, course }
      }).filter(f => f.course)

      setSessionWizard({ quote, client, formations })
      const defaultTrainer = currentTrainers?.[0]
      setSessionSelections(formations.map(f => ({
        courseId: f.course.id,
        itemId: f.item.id,
        selected: true,
        startDate: '',
        endDate: '',
        startTime: '09:00',
        endTime: '17:00',
        preset: 'perso',
        trainerId: defaultTrainer?.id || '',
        location: [client.address, client.postal_code, client.city].filter(Boolean).join(', ') || client.city || '',
        isIntra: true,
        nbParticipants: parseInt(f.item.quantity) || 1,
        // Prix NET : la remise globale du devis s'applique (sinon convention et facture sortent au prix brut)
        totalPriceHt: Math.round((parseFloat(f.item.total_ht) || 0) * (1 - (parseFloat(quote.discount_percent) || 0) / 100) * 100) / 100,
      })))
    } catch (err) {
      console.error('Erreur ouverture session wizard:', err)
      toast.error('Erreur: ' + err.message)
    }
  }

  function updateSessionSelection(index, field, value) {
    setSessionSelections(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }

  async function handleCreateSessions() {
    const selected = sessionSelections.filter(s => s.selected)
    if (selected.length === 0) return toast.error('Sélectionnez au moins une formation')
    const missing = selected.filter(s => !s.startDate || !s.endDate)
    if (missing.length > 0) return toast.error('Renseignez les dates pour chaque formation sélectionnée')

    setSessionCreating(true)
    try {
      const { quote, client } = sessionWizard
      const createdSessions = []

      for (const sel of selected) {
        const formation = sessionWizard.formations.find(f => f.course.id === sel.courseId)
        if (!formation) continue
        const course = formation.course
        const trainer = storeTrainers?.find(t => t.id === sel.trainerId) || null

        // Use store's createSession (handles reference, token, refresh)
        const { data: newSession, error } = await createSession({
          course_id: course.id,
          client_id: quote.client_id,
          contact_id: quote.contact_id || null,
          trainer_ids: trainer ? [trainer.id] : [],
          start_date: sel.startDate,
          end_date: sel.endDate,
          start_time: sel.startTime || '09:00',
          end_time: sel.endTime || '17:00',
          location: sel.location || client.city || '',
          location_city: sel.location || client.city || null,
          is_intra: sel.isIntra !== false,
          status: 'planned',
          day_type: (() => {
            const [sh, sm] = (sel.startTime || '09:00').split(':').map(Number)
            const [eh, em] = (sel.endTime || '17:00').split(':').map(Number)
            let startMins = sh * 60 + sm
            let endMins = eh * 60 + em
            if (endMins <= startMins) endMins += 24 * 60 // nuit
            return (endMins - startMins) <= 270 ? 'half' : 'full' // <= 4h30 = demi-journée
          })(),
          notes: `Créée depuis devis ${quote.reference}`,
          funding_type: 'none',
        })

        if (error) {
          console.error('Erreur création session:', error)
          toast.error(`Erreur pour ${course.title}: ${error.message}`)
          continue
        }

        // Set total_price and max_participants (not in store's createSession)
        if (newSession?.id) {
          // Lier la session à son devis d'origine
          const extraUpdates = { quote_id: quote.id }
          if (sel.totalPriceHt) extraUpdates.total_price = sel.totalPriceHt
          if (sel.nbParticipants) extraUpdates.max_participants = sel.nbParticipants
          if (Object.keys(extraUpdates).length > 0) {
            await supabase.from('sessions').update(extraUpdates).eq('id', newSession.id)
          }
          createdSessions.push({ ...newSession, courseTitle: course.title })
        }
      }

      if (createdSessions.length > 0) {
        // Add note to quote with session references
        await supabase.from('quotes').update({
          notes: (quote.notes ? quote.notes + '\n' : '') + `Sessions créées le ${format(new Date(), 'dd/MM/yyyy')} : ${createdSessions.map(s => s.reference).join(', ')}`,
          updated_at: new Date().toISOString()
        }).eq('id', quote.id)

        toast.success(`${createdSessions.length} session${createdSessions.length > 1 ? 's' : ''} créée${createdSessions.length > 1 ? 's' : ''} !`, { duration: 4000 })
        setSessionWizard(null)
        loadAll()
      }
    } catch (err) {
      console.error('Erreur création sessions:', err)
      toast.error('Erreur: ' + err.message)
    }
    setSessionCreating(false)
  }

  async function generateEmailText() {
    if (!sendWizard) return
    setSendLoading(true)
    try {
      const { quote, client, contact, items } = sendWizard
      const enabledPrograms = sendAttachments.filter(a => a.type === 'program' && a.enabled)
      const resp = await apiFetch('/api/generate-quote-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quote, client, contact, items,
          senderName: quote.created_by || currentUserName(),
          customInstructions: sendEmail.customInstructions || '',
          hasPrograms: enabledPrograms.length > 0,
          programTitles: enabledPrograms.map(p => p.courseTitle)
        })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Erreur génération')
      setSendEmail(prev => ({ ...prev, subject: data.subject || '', body: data.body || '' }))
      toast.success('Texte généré !')
    } catch (err) {
      console.error('Erreur génération email:', err)
      toast.error('Erreur: ' + err.message)
      // Fallback text
      const { quote, client } = sendWizard
      const hasProgs = sendAttachments.some(a => a.type === 'program' && a.enabled)
      const pjText = hasProgs 
        ? 'notre devis ainsi que les programmes de formation correspondants'
        : 'notre devis'
      setSendEmail(prev => ({
        ...prev,
        subject: `Devis ${quote.reference} - ${orgName()}`,
        body: `Bonjour,\n\nSuite à notre échange, veuillez trouver ci-joint ${pjText} (réf. ${quote.reference}).\n\nNous restons à votre disposition pour tout complément d'information.`
      }))
    }
    setSendLoading(false)
  }

  async function handleSendQuoteEmail() {
    if (!sendWizard || !sendEmail.to || !sendEmail.subject || !sendEmail.body) {
      return toast.error('Veuillez remplir tous les champs')
    }
    setSendSending(true)
    try {
      // Get userId from supabase auth
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser?.id) {
        throw new Error('Session expirée. Reconnectez-vous.')
      }
      const { quote, pdfBase64 } = sendWizard
      // Programs: send URLs only (server downloads them). Manual: send base64.
      const programUrls = sendAttachments
        .filter(att => att.type === 'program' && att.enabled && att.url)
        .map(att => ({ filename: att.filename, url: att.url }))
      const manualAttachments = sendAttachments
        .filter(att => (att.type === 'manual' || (att.type === 'program' && !att.url)) && att.enabled && att.base64)
        .map(att => ({ filename: att.filename, base64: att.base64 }))

      const resp = await apiFetch('/api/send-quote-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: authUser.id,
          to: sendEmail.to,
          subject: sendEmail.subject,
          body: sendEmail.body,
          pdfBase64: pdfBase64,
          pdfFilename: `${quote.reference}.pdf`,
          programUrls,
          extraAttachments: manualAttachments,
          quoteId: quote.id,
          clientId: quote.client_id,
          createdBy: quote.created_by
        })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Erreur envoi')
      toast.success('Devis envoyé par email !')
      closeSendWizard()
      loadAll() // Refresh pour voir le nouveau statut
    } catch (err) {
      console.error('Erreur envoi email:', err)
      toast.error('Erreur: ' + err.message)
    }
    setSendSending(false)
  }

  function updateItem(index, field, value) {
    const updated = [...items]
    updated[index] = { ...updated[index], [field]: value }
    setItems(updated)
  }
  function addItem() { setItems([...items, { ...emptyItem, position: items.length }]) }
  function removeItem(index) {
    if (items.length <= 1) return toast.error('Au moins une ligne requise')
    setItems(items.filter((_, i) => i !== index))
  }
  function addFromCourse(course) {
    setItems([...items, {
      ...emptyItem, code: course.code || '', description_title: course.title,
      description_detail: course.description || '', unit_price_ht: course.price_ht || 0,
      course_id: course.id, position: items.length
    }])
  }
  function addFromMaterial(mat) {
    setItems([...items, {
      ...emptyItem, code: mat.code, description_title: mat.description_title,
      description_detail: mat.description_detail, unit_price_ht: mat.unit_price_ht,
      unit: mat.unit, position: items.length, nature: mat.nature || 'bien'
    }])
  }
  function handleClientChange(clientId) {
    setCurrentQuote(prev => ({ ...prev, client_id: clientId, contact_id: '' }))
    loadClientContacts(clientId)
  }
  function handleDateChange(date) {
    const vDate = calcValidityDate(date)
    setCurrentQuote(prev => ({ ...prev, quote_date: date, validity_date: vDate, payment_deadline: vDate }))
  }

  // ─── Client Combobox logic ────────────────────────────────────────────
  useEffect(() => {
    function handleClickOutside(e) {
      if (clientComboRef.current && !clientComboRef.current.contains(e.target)) {
        setShowClientDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Sync search term with selected client name
  useEffect(() => {
    if (!currentQuote) { setClientSearchTerm(''); return }
    if (currentQuote.client_id) {
      const c = clients.find(x => x.id === currentQuote.client_id)
      setClientSearchTerm(c?.name || '')
    } else {
      setClientSearchTerm('')
    }
  }, [currentQuote?.client_id, clients])

  const clientComboResults = useMemo(() => {
    const term = clientSearchTerm.trim().toLowerCase()
    if (!term) {
      // Show recent: clients that have quotes, sorted by most recent quote
      const clientIdsWithQuotes = [...new Set(quotes.map(q => q.client_id).filter(Boolean))]
      return clientIdsWithQuotes.slice(0, 8).map(id => clients.find(c => c.id === id)).filter(Boolean)
    }
    return clients.filter(c => {
      const haystack = [c.name, c.city, c.siret, c.siren, c.contact_name, c.postal_code]
        .filter(Boolean).join(' ').toLowerCase()
      return term.split(/\s+/).every(word => haystack.includes(word))
    }).slice(0, 12)
  }, [clientSearchTerm, clients, quotes])

  function selectClient(client) {
    handleClientChange(client.id)
    setClientSearchTerm(client.name)
    setShowClientDropdown(false)
  }

  function clearClientSelection() {
    handleClientChange('')
    setClientSearchTerm('')
    setShowClientDropdown(false)
  }

  const filteredQuotes = useMemo(() => {
    return quotes.filter(q => {
      const s = search.toLowerCase()
      const matchSearch = !search ||
        q.reference?.toLowerCase().includes(s) ||
        q.clients?.name?.toLowerCase().includes(s) ||
        q.clients?.city?.toLowerCase().includes(s) ||
        q.clients?.siret?.includes(search) ||
        q.object?.toLowerCase().includes(s) ||
        q.created_by?.toLowerCase().includes(s)
      return matchSearch && (!statusFilter || q.status === statusFilter)
    })
  }, [quotes, search, statusFilter])

  // Devis envoyés > 7j sans réponse
  const quotesRelance = useMemo(() => {
    const now = Date.now()
    return quotes
      .filter(q => q.status === 'sent' || q.status === 'pending')
      .map(q => {
        const sentDate = q.updated_at || q.quote_date || q.created_at
        const days = sentDate ? Math.floor((now - new Date(sentDate).getTime()) / 86400000) : 0
        return { ...q, daysSinceSent: days }
      })
      .filter(q => q.daysSinceSent >= 7)
      .sort((a, b) => b.daysSinceSent - a.daysSinceSent)
  }, [quotes])

  // money() → importé depuis ../lib/utils

  // ==================== RENDER ====================
  return (
    <>
      {mode === 'list' ? renderList() : mode === 'view' ? renderView() : renderForm()}
      {sendWizard && renderSendWizard()}
      {sessionWizard && renderSessionWizard()}
      {acompteDevis && <AcompteDevis quote={acompteDevis} onClose={() => setAcompteDevis(null)} />}

      {/* Modale relance IA - preview + édition avant envoi */}
      {previewData && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-ui-lg shadow-md w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {previewData.relanceNum === 1 ? '1ère' : previewData.relanceNum === 2 ? '2ème' : '3ème'} relance - {previewData.quote?.clients?.name || previewData.quote?.reference}
                </h2>
                <p className="text-ui text-gray-500 mt-0.5">
                  {previewData.isFallback ? ' Généré sans IA (fallback)' : ` Généré par IA · ton ${previewData.tone || 'courtois'}`}
                </p>
              </div>
              <button onClick={cancelPreview} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-ui font-medium text-gray-700 mb-1">Destinataire</label>
                <p className="text-ui text-gray-600 bg-gray-50 px-3 py-2 rounded-ui-sm">{previewData.clientEmail}</p>
              </div>

              <div>
                <label className="block text-ui font-medium text-gray-700 mb-1">Objet</label>
                <input
                  type="text"
                  value={relanceEdit.subject}
                  onChange={e => setRelanceEdit(prev => ({ ...prev, subject: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-ui-sm text-ui focus:ring-2 focus:ring-primary-300 focus:border-primary-400"
                />
              </div>

              <div>
                <label className="block text-ui font-medium text-gray-700 mb-1">Corps du message</label>
                <textarea
                  value={relanceEdit.body}
                  onChange={e => setRelanceEdit(prev => ({ ...prev, body: e.target.value }))}
                  rows={12}
                  className="w-full px-3 py-2 border border-gray-200 rounded-ui-sm text-ui font-sans focus:ring-2 focus:ring-primary-300 focus:border-primary-400"
                />
              </div>

              <p className="text-ui-sm text-gray-400">La signature sera ajoutée automatiquement depuis votre compte email.</p>
            </div>

            <div className="p-6 border-t border-gray-100 space-y-3">
              {!relanceConfirmed ? (
                <div className="flex items-center justify-between gap-3">
                  <button onClick={cancelPreview} className="px-4 py-2 text-ui text-gray-600 hover:text-gray-800 border border-gray-200 rounded-ui-sm hover:bg-gray-50">
                    Annuler
                  </button>
                  <button
                    onClick={() => setRelanceConfirmed(true)}
                    className="btn btn-secondary text-ui font-medium rounded-ui-sm hover:bg-[rgb(var(--c-warning))] flex items-center gap-2"
                  >
                    <Send size={15} /> Préparer l'envoi…
                  </button>
                </div>
              ) : (
                <div className="bg-[rgb(var(--c-danger-bg))] border border-[rgb(var(--c-danger)/0.3)] rounded-ui-sm p-3 space-y-3">
                  <p className="text-ui font-semibold text-[rgb(var(--c-danger))]"> Confirmer l'envoi vers <span className="underline">{previewData.clientEmail}</span> ?</p>
                  <p className="text-ui-sm text-[rgb(var(--c-danger))]">L'email sera envoyé immédiatement et ne pourra pas être annulé.</p>
                  <div className="flex items-center justify-between gap-3">
                    <button onClick={() => setRelanceConfirmed(false)} className="px-4 py-2 text-ui text-gray-600 hover:text-gray-800 border border-gray-200 rounded-ui-sm hover:bg-gray-50">
                      ← Modifier
                    </button>
                    <button
                      onClick={async () => {
                        const ok = await confirmSend(relanceEdit.subject, relanceEdit.body)
                        if (ok) { setRelanceConfirmed(false); loadAll() }
                      }}
                      className="px-6 py-2 bg-[rgb(var(--c-danger))] text-white text-ui font-bold rounded-ui-sm hover:bg-[rgb(var(--c-danger))] flex items-center gap-2"
                    >
                      <Send size={15} /> OUI - Envoyer maintenant
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )

  function renderList() {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="page-title">Devis</h1>
            <p className="text-ui text-gray-500 mt-1">{filteredQuotes.length} devis</p>
          </div>
          <button onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-ui-sm hover:bg-primary-700 transition-colors font-medium">
            <Plus size={18} /> Nouveau devis
          </button>
        </div>
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Référence, client, ville, SIRET, objet..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-ui-sm focus:ring-2 focus:ring-primary-500" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2.5 border border-gray-200 rounded-ui-sm focus:ring-2 focus:ring-primary-500">
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Brouillons', status: 'draft', color: 'gray' },
            { label: 'Envoyés', status: 'sent', color: 'blue' },
            { label: 'Acceptés', status: 'accepted', color: 'green' },
            { label: 'CA potentiel', status: null, color: 'indigo' }
          ].map((s, i) => {
            const count = s.status ? quotes.filter(q => q.status === s.status).length : null
            const ca = !s.status ? quotes.filter(q => q.status === 'sent' || q.status === 'accepted')
              .reduce((sum, q) => sum + (q.total_ttc || 0), 0) : null
            return (
              <div key={i} className={`bg-white p-4 rounded-ui border`} style={toneStyle(s.color, { bg: false, text: false, border: true })}>
                <p className="text-ui-sm text-gray-500 mb-1">{s.label}</p>
                <p className={`text-xl font-bold`} style={toneStyle(s.color, { bg: false })}>
                  {s.status !== null ? count : money(ca)}
                </p>
              </div>
            )
          })}
        </div>
        {/* Bandeau relance devis > 7j */}
        {quotesRelance.length > 0 && (
          <div className="bg-[rgb(var(--c-warning-bg))] border-2 border-[rgb(var(--c-warning)/0.3)] rounded-ui px-4 py-3 mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-ui font-bold text-[rgb(var(--c-warning))]"> {quotesRelance.length} devis envoyé{quotesRelance.length > 1 ? 's' : ''} sans réponse depuis plus de 7 jours</h3>
              <button onClick={() => setStatusFilter('sent')} className="text-ui-sm text-[rgb(var(--c-warning))] hover:text-[rgb(var(--c-warning))] underline">Voir tous les envoyés</button>
            </div>
            <div className="space-y-1.5">
              {quotesRelance.slice(0, 5).map(q => (
                <div key={q.id} className="flex items-center justify-between bg-white rounded-ui-sm px-3 py-2 border border-[rgb(var(--c-warning)/0.3)]">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-ui-sm font-mono text-gray-400">{q.reference}</span>
                    <BadgeTest tbl="quotes" id={q.id} />
                    <span className="font-medium text-gray-900 text-ui truncate">{q.clients?.name || '?'}</span>
                    <span className="text-ui font-semibold text-gray-700">{money(q.total_ht)} HT</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`text-ui-sm font-medium px-2 py-0.5 rounded-full ${q.daysSinceSent >= 15 ? 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]' : 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]'}`}>
                      {q.daysSinceSent}j
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); relanceQuote(q, { senderName: q.created_by || currentUserName() }) }}
                      disabled={relanceGenerating === q.id}
                      className="text-ui-sm btn btn-secondary font-medium flex items-center gap-1 disabled:opacity-60">
                      {relanceGenerating === q.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Relancer
                    </button>
                  </div>
                </div>
              ))}
              {quotesRelance.length > 5 && <p className="text-ui-sm text-[rgb(var(--c-warning))] text-center">+{quotesRelance.length - 5} autre(s)</p>}
            </div>
          </div>
        )}
        {loading ? (
          <div className="text-center py-12 text-gray-400">Chargement...</div>
        ) : filteredQuotes.length === 0 ? (
          <div className="text-center py-12">
            <FileText size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">{search || statusFilter ? 'Aucun résultat' : 'Aucun devis - Créez-en un !'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredQuotes.map(q => (
              <div key={q.id} onClick={() => openView(q)} className="bg-white rounded-ui border border-gray-200 p-4 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-ui font-mono text-gray-500">{q.reference}</span>
                      <BadgeTest tbl="quotes" id={q.id} />
                      <span className={`px-2 py-0.5 rounded text-ui-sm font-medium ${STATUS_CONFIG[q.status]?.class || 'bg-gray-100'}`}>
                        {STATUS_CONFIG[q.status]?.icon} {STATUS_CONFIG[q.status]?.label || q.status}
                      </span>
                      {(() => {
                        if (q.status !== 'sent' && q.status !== 'pending') return null
                        const sentDate = q.updated_at || q.quote_date || q.created_at
                        const days = sentDate ? Math.floor((Date.now() - new Date(sentDate).getTime()) / 86400000) : 0
                        if (days < 7) return null
                        return <span className={`px-2 py-0.5 rounded-full text-ui-sm font-medium ${days >= 15 ? 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]' : 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]'}`}> {days}j sans réponse</span>
                      })()}
                    </div>
                    <h3 className="font-semibold text-gray-900">{q.clients?.name || 'Client inconnu'}</h3>
                    {q.object && <p className="text-ui text-gray-500 truncate mt-0.5">{q.object}</p>}
                    <div className="flex items-center gap-4 mt-2 text-ui-sm text-gray-400">
                      <span> {q.quote_date ? format(new Date(q.quote_date), 'dd MMM yyyy', { locale: fr }) : '-'}</span>
                      {q.validity_date && <span> Valide jusqu'au {format(new Date(q.validity_date), 'dd/MM/yyyy')}</span>}
                      <span> {q.created_by}</span>
                    </div>
                  </div>
                  <div className="text-right ml-4 flex-shrink-0">
                    <p className="text-lg font-bold text-gray-900">{money(q.total_ttc)}</p>
                    <p className="text-ui-sm text-gray-400">{money(q.total_ht)} HT</p>
                    <div className="relative mt-2 flex justify-end" ref={actionMenuId === q.id ? actionMenuRef : null}>
                      <button onClick={(e) => { e.stopPropagation(); setActionMenuId(actionMenuId === q.id ? null : q.id) }}
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors">
                        <MoreHorizontal size={18} />
                      </button>
                      {actionMenuId === q.id && (
                        <div className="absolute right-0 top-8 z-50 bg-white rounded-ui-sm shadow-md border border-gray-200 py-1 w-52 animate-in fade-in" onClick={e => e.stopPropagation()}>
                          <button onClick={() => { setActionMenuId(null); downloadPDF(q) }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-ui text-gray-700 hover:bg-gray-50">
                            <Download size={15} /> Télécharger PDF
                          </button>
                          <button onClick={() => { setActionMenuId(null); openEdit(q) }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-ui text-gray-700 hover:bg-gray-50">
                            <Edit2 size={15} /> Modifier
                          </button>
                          <button onClick={() => { setActionMenuId(null); duplicateQuote(q) }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-ui text-gray-700 hover:bg-gray-50">
                            <Copy size={15} /> Dupliquer
                          </button>
                          {(q.status === 'draft' || q.status === 'sent') && (
                            <button onClick={() => { setActionMenuId(null); q.status === 'sent' ? relanceQuote(q, { senderName: q.created_by || currentUserName() }) : openSendWizard(q) }}
                              disabled={relanceGenerating === q.id}
                              className="w-full flex items-center gap-2 px-3 py-2 text-ui text-[rgb(var(--c-success))] hover:bg-[rgb(var(--c-success-bg))] disabled:opacity-60">
                              {relanceGenerating === q.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {q.status === 'sent' ? 'Relancer par email' : 'Envoyer par email'}
                            </button>
                          )}
                          {(q.status === 'draft' || q.status === 'sent') && (
                            <button onClick={() => { setActionMenuId(null); openView(q) }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-ui text-[rgb(var(--c-warning))] hover:bg-[rgb(var(--c-warning-bg))]">
                              <span></span> Acceptation partielle
                            </button>
                          )}
                          <div className="border-t border-gray-100 my-1" />
                          {q.status === 'draft' && (
                            <button onClick={() => { setActionMenuId(null); updateStatus(q.id, 'sent') }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-ui text-[rgb(var(--c-info))] hover:bg-[rgb(var(--c-info-bg))]">
                              <Send size={15} /> Marquer envoyé
                            </button>
                          )}
                          {(q.status === 'sent' || q.status === 'draft') && (
                            <button onClick={() => { setActionMenuId(null); updateStatus(q.id, 'accepted') }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-ui text-[rgb(var(--c-success))] hover:bg-[rgb(var(--c-success-bg))]">
                              <Check size={15} /> Marquer accepté
                            </button>
                          )}
                          {(q.status === 'sent' || q.status === 'draft') && (
                            <button onClick={() => { setActionMenuId(null); updateStatus(q.id, 'refused') }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-ui text-[rgb(var(--c-danger))] hover:bg-[rgb(var(--c-danger-bg))]">
                              <X size={15} /> Marquer refusé
                            </button>
                          )}
                          {q.status === 'accepted' && (
                            <button onClick={async () => { setActionMenuId(null); if (await confirmer('Créer une facture depuis ce devis ?')) navigate('/factures?from_quote=' + q.id) }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-ui text-gray-800 hover:bg-gray-50">
                              <FileText size={15} /> Créer une facture
                            </button>
                          )}
                          {(q.status === 'accepted' || q.status === 'partial') && (
                            <button onClick={() => { setActionMenuId(null); setAcompteDevis(q) }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-ui text-gray-800 hover:bg-gray-50">
                              <FileText size={15} /> Facture d'acompte
                            </button>
                          )}
                          {(q.status === 'accepted' || q.status === 'partial') && (
                            <button onClick={() => { setActionMenuId(null); openSessionWizard(q) }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-ui text-[rgb(var(--c-success))] hover:bg-[rgb(var(--c-success-bg))]">
                              <GraduationCap size={15} /> Générer une session
                            </button>
                          )}
                          {q.status === 'sent' && (
                            <button onClick={async () => { setActionMenuId(null); if (await confirmer('Créer une facture depuis ce devis ?')) navigate('/factures?from_quote=' + q.id) }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-ui text-gray-800 hover:bg-gray-50">
                              <FileText size={15} /> Créer une facture
                            </button>
                          )}
                          <div className="border-t border-gray-100 my-1" />
                          <button onClick={() => { setActionMenuId(null); deleteQuote(q.id) }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-ui text-[rgb(var(--c-danger))] hover:bg-[rgb(var(--c-danger-bg))]">
                            <Trash2 size={15} /> Supprimer
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  function renderView() {
    if (!currentQuote) return null
    const totals = calcTotals(items, currentQuote.discount_percent, currentQuote.tva_rate, currentQuote.tva_applicable)
    const st = STATUS_CONFIG[currentQuote.status] || STATUS_CONFIG.draft
    const q = currentQuote
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <BandeauTest tbl="quotes" id={q.id} />
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setMode('list')} className="p-2 hover:bg-gray-100 rounded-ui-sm transition-colors">
              <ArrowLeft size={20} />
            </button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-gray-900">Devis {q.reference}</h1>
                <BadgeTest tbl="quotes" id={q.id} />
                <span className={`px-2.5 py-1 rounded text-ui-sm font-medium ${st.class}`}>{st.icon} {st.label}</span>
              </div>
              <p className="text-ui text-gray-500">
                {q.quote_date && format(new Date(q.quote_date), 'dd MMMM yyyy', { locale: fr })}
                {q.created_by && ` · par ${q.created_by}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => downloadPDF(q)} disabled={generatingPdf}
              className="flex items-center gap-1.5 px-3 py-2 bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] border border-[rgb(var(--c-warning)/0.3)] rounded-ui-sm hover:bg-[rgb(var(--c-warning-bg))] text-ui disabled:opacity-50">
              <Download size={15} /> PDF
            </button>
            {(q.status === 'partial' || (q.status === 'accepted' && items.some(it => it.accepted === true))) && (
              <button onClick={downloadPartialPDF} disabled={generatingPartialPdf}
                className="flex items-center gap-1.5 px-3 py-2 bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] border border-[rgb(var(--c-warning)/0.3)] rounded-ui-sm hover:bg-[rgb(var(--c-warning-bg))] text-ui disabled:opacity-50">
                <Download size={15} /> PDF partiel
              </button>
            )}
            <button onClick={() => openEdit(q)}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-ui-sm hover:bg-primary-700 text-ui">
              <Edit2 size={15} /> Modifier
            </button>
            <div className="relative" ref={actionMenuId === 'view' ? actionMenuRef : null}>
              <button onClick={() => setActionMenuId(actionMenuId === 'view' ? null : 'view')}
                className="p-2 hover:bg-gray-100 rounded-ui-sm transition-colors">
                <MoreHorizontal size={20} />
              </button>
              {actionMenuId === 'view' && (
                <div className="absolute right-0 top-10 z-50 bg-white rounded-ui-sm shadow-md border border-gray-200 py-1 w-52">
                  <button onClick={() => { setActionMenuId(null); duplicateQuote(q) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-ui text-gray-700 hover:bg-gray-50">
                    <Copy size={15} /> Dupliquer
                  </button>
                  {(q.status === 'draft' || q.status === 'sent') && (
                    <button onClick={() => { setActionMenuId(null); q.status === 'sent' ? relanceQuote(q, { senderName: q.created_by || currentUserName() }) : openSendWizard(q) }}
                      disabled={relanceGenerating === q.id}
                      className="w-full flex items-center gap-2 px-3 py-2 text-ui text-[rgb(var(--c-success))] hover:bg-[rgb(var(--c-success-bg))] disabled:opacity-60">
                      {relanceGenerating === q.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {q.status === 'sent' ? 'Relancer' : 'Envoyer'} par email
                    </button>
                  )}
                  {(q.status === 'draft' || q.status === 'sent') && (
                    <button onClick={() => setActionMenuId(null)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-ui text-[rgb(var(--c-warning))] hover:bg-[rgb(var(--c-warning-bg))]">
                      <span></span> Acceptation partielle
                    </button>
                  )}
                  <div className="border-t border-gray-100 my-1" />
                  {q.status === 'draft' && (
                    <button onClick={() => { setActionMenuId(null); updateStatus(q.id, 'sent') }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-ui text-[rgb(var(--c-info))] hover:bg-[rgb(var(--c-info-bg))]">
                      <Send size={15} /> Marquer envoyé
                    </button>
                  )}
                  {(q.status === 'sent' || q.status === 'draft') && (
                    <button onClick={() => { setActionMenuId(null); updateStatus(q.id, 'accepted') }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-ui text-[rgb(var(--c-success))] hover:bg-[rgb(var(--c-success-bg))]">
                      <Check size={15} /> Marquer accepté
                    </button>
                  )}
                  {(q.status === 'sent' || q.status === 'draft') && (
                    <button onClick={() => { setActionMenuId(null); updateStatus(q.id, 'refused') }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-ui text-[rgb(var(--c-danger))] hover:bg-[rgb(var(--c-danger-bg))]">
                      <X size={15} /> Marquer refusé
                    </button>
                  )}
                  {(q.status === 'accepted' || q.status === 'partial') && (
                    <button onClick={() => { setActionMenuId(null); setAcompteDevis(q) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-ui text-gray-800 hover:bg-gray-50">
                      <FileText size={15} /> Facture d'acompte
                    </button>
                  )}
                  {q.status === 'accepted' && (
                    <button onClick={async () => { setActionMenuId(null); if (await confirmer('Créer une facture depuis ce devis ?')) navigate('/factures?from_quote=' + q.id) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-ui text-gray-800 hover:bg-gray-50">
                      <FileText size={15} /> Créer une facture
                    </button>
                  )}
                  {(q.status === 'accepted' || q.status === 'partial') && (
                    <button onClick={() => { setActionMenuId(null); openSessionWizard(q) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-ui text-[rgb(var(--c-success))] hover:bg-[rgb(var(--c-success-bg))]">
                      <GraduationCap size={15} /> Générer une session
                    </button>
                  )}
                  {q.status === 'sent' && (
                    <button onClick={async () => { setActionMenuId(null); if (await confirmer('Créer une facture depuis ce devis ?')) navigate('/factures?from_quote=' + q.id) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-ui text-gray-800 hover:bg-gray-50">
                      <FileText size={15} /> Créer une facture
                    </button>
                  )}
                  <div className="border-t border-gray-100 my-1" />
                  <button onClick={() => { setActionMenuId(null); deleteQuote(q.id); setMode('list') }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-ui text-[rgb(var(--c-danger))] hover:bg-[rgb(var(--c-danger-bg))]">
                    <Trash2 size={15} /> Supprimer
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Objet */}
            {q.object && (
              <div className="bg-white rounded-ui border p-4">
                <p className="text-ui-sm font-semibold text-gray-400 uppercase mb-1">Objet</p>
                <p className="text-gray-900">{q.object}</p>
              </div>
            )}

            {/* Lignes */}
            <div className="bg-white rounded-ui border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-ui-sm text-gray-500 uppercase">
                    <th className="text-left px-4 py-3">Désignation</th>
                    <th className="text-center px-2 py-3 w-16">Qté</th>
                    <th className="text-center px-2 py-3 w-20">Unité</th>
                    <th className="text-right px-2 py-3 w-24">P.U. HT</th>
                    <th className="text-right px-4 py-3 w-28">Total HT</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 text-ui">{item.description_title}</p>
                        {item.description_detail && <p className="text-ui-sm text-gray-500 mt-0.5 whitespace-pre-line">{item.description_detail}</p>}
                      </td>
                      <td className="text-center px-2 py-3 text-ui">{item.quantity}</td>
                      <td className="text-center px-2 py-3 text-ui-sm text-gray-500">{item.unit || '-'}</td>
                      <td className="text-right px-2 py-3 text-ui">{money(item.unit_price_ht)}</td>
                      <td className="text-right px-4 py-3 text-ui font-medium">{money((item.quantity || 0) * (item.unit_price_ht || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Panneau validation client ligne par ligne */}
            {(currentQuote.status === 'sent' || currentQuote.status === 'partial' || currentQuote.status === 'accepted') && items.length > 0 && (
              <div className="bg-white rounded-ui border border-[rgb(var(--c-warning)/0.3)] overflow-hidden">
                <div className="bg-[rgb(var(--c-warning-bg))] px-4 py-3 border-b border-[rgb(var(--c-warning)/0.3)]">
                  <h3 className="font-semibold text-[rgb(var(--c-warning))] flex items-center gap-2"> Validation client ligne par ligne</h3>
                  <p className="text-ui-sm text-[rgb(var(--c-warning))] mt-0.5">Enregistrez les décisions du client pour chaque ligne du devis</p>
                </div>
                <div className="divide-y divide-[rgb(var(--c-warning)/0.3)]">
                  {items.map(item => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-ui font-medium text-gray-900 truncate">{item.description_title}</p>
                        <p className="text-ui-sm text-gray-400">{money((item.quantity || 0) * (item.unit_price_ht || 0))}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => toggleItemAccepted(item.id, item.accepted === true ? null : true)}
                          className={`px-2.5 py-1.5 rounded-ui-sm text-ui-sm font-medium border transition-colors ${item.accepted === true ? 'bg-[rgb(var(--c-success))] text-white border-[rgb(var(--c-success)/0.3)]' : 'bg-white text-[rgb(var(--c-success))] border-[rgb(var(--c-success)/0.3)] hover:bg-[rgb(var(--c-success-bg))]'}`}>
                           Accepté
                        </button>
                        <button onClick={() => toggleItemAccepted(item.id, item.accepted === false ? null : false)}
                          className={`px-2.5 py-1.5 rounded-ui-sm text-ui-sm font-medium border transition-colors ${item.accepted === false ? 'bg-[rgb(var(--c-danger))] text-white border-[rgb(var(--c-danger)/0.3)]' : 'bg-white text-[rgb(var(--c-danger))] border-[rgb(var(--c-danger)/0.3)] hover:bg-[rgb(var(--c-danger-bg))]'}`}>
                           Refusé
                        </button>
                        <button onClick={() => toggleItemAccepted(item.id, null)}
                          className={`px-2.5 py-1.5 rounded-ui-sm text-ui-sm font-medium border transition-colors ${(item.accepted === null || item.accepted === undefined) ? 'bg-[rgb(var(--c-warning))] text-white border-[rgb(var(--c-warning)/0.3)]' : 'bg-white text-[rgb(var(--c-warning))] border-[rgb(var(--c-warning)/0.3)] hover:bg-[rgb(var(--c-warning-bg))]'}`}>
                           En attente
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {items.some(it => it.accepted === true) && (
                  <div className="px-4 py-3 bg-[rgb(var(--c-warning-bg))] border-t border-[rgb(var(--c-warning)/0.3)] flex items-center gap-3 flex-wrap">
                    <button onClick={downloadPartialPDF} disabled={generatingPartialPdf}
                      className="flex items-center gap-2 btn btn-secondary text-ui font-medium hover:bg-[rgb(var(--c-warning))] disabled:opacity-50">
                      <Download size={14} /> Bon de commande partiel (PDF)
                    </button>
                    {items.some(it => it.accepted === true && it.course_id) && (
                      <button onClick={() => openSessionWizard(currentQuote)}
                        className="flex items-center gap-2 btn btn-secondary text-ui font-medium hover:bg-[rgb(var(--c-success))]">
                        <GraduationCap size={14} /> Générer session(s)
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Totaux */}
            <div className="bg-white rounded-ui border p-4">
              <div className="flex justify-end">
                <div className="w-64 space-y-1.5 text-ui">
                  <div className="flex justify-between"><span className="text-gray-500">Total HT</span><span className="font-medium">{money(totals.totalHt)}</span></div>
                  {currentQuote.discount_percent > 0 && (
                    <div className="flex justify-between text-[rgb(var(--c-danger))]"><span>Remise {currentQuote.discount_percent}%{currentQuote.discount_label ? ` (${currentQuote.discount_label})` : ''}</span><span>-{money(totals.discountAmount)}</span></div>
                  )}
                  {currentQuote.tva_applicable !== false && (
                    <div className="flex justify-between"><span className="text-gray-500">TVA {currentQuote.tva_rate || 20}%</span><span>{money(totals.totalTva)}</span></div>
                  )}
                  <div className="flex justify-between border-t pt-2 text-base font-bold"><span>Total TTC</span><span>{money(totals.totalTtc)}</span></div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar infos */}
          <div className="space-y-4">
            <div className="bg-white rounded-ui border p-4 space-y-3">
              <h3 className="font-semibold text-gray-900 text-ui flex items-center gap-2"><Building2 size={15} /> Client</h3>
              <p className="font-medium text-gray-900">{q.clients?.name || '-'}</p>
              {q.clients?.address && <p className="text-ui text-gray-500">{q.clients.address}</p>}
              {q.clients?.siret && <p className="text-ui-sm text-gray-400 font-mono">SIRET {q.clients.siret}</p>}
            </div>
            <div className="bg-white rounded-ui border p-4 space-y-2">
              <h3 className="font-semibold text-gray-900 text-ui">Détails</h3>
              <div className="text-ui space-y-1.5">
                {q.client_reference && <div className="flex justify-between"><span className="text-gray-500">Réf. client</span><span>{q.client_reference}</span></div>}
                <div className="flex justify-between"><span className="text-gray-500">Paiement</span><span className="text-right text-ui-sm">{q.payment_method || '-'}</span></div>
                {q.validity_date && <div className="flex justify-between"><span className="text-gray-500">Validité</span><span>{format(new Date(q.validity_date), 'dd/MM/yyyy')}</span></div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderForm() {
    const totals = calcTotals(items, currentQuote.discount_percent, currentQuote.tva_rate, currentQuote.tva_applicable)
    const selectedClient = clients.find(c => c.id === currentQuote.client_id)
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setMode('list')} className="p-2 hover:bg-gray-100 rounded-ui-sm transition-colors">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {mode === 'create' ? 'Nouveau devis' : `Devis ${currentQuote.reference}`}
                {mode !== 'create' && <BadgeTest tbl="quotes" id={currentQuote.id} className="ml-2" />}
              </h1>
              <p className="text-ui text-gray-500">
                {mode === 'create' ? currentQuote.reference : `Créé le ${currentQuote.created_at ? format(new Date(currentQuote.created_at), 'dd/MM/yyyy', { locale: fr }) : ''}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'edit' && (
              <>
                <select value={currentQuote.status}
                  onChange={(e) => setCurrentQuote(prev => ({ ...prev, status: e.target.value }))}
                  className="px-3 py-2 border border-gray-200 rounded-ui-sm text-ui">
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.icon} {v.label}</option>
                  ))}
                </select>
                <button onClick={downloadCurrentPDF} disabled={generatingPdf}
                  className="flex items-center gap-1.5 px-3 py-2 bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] border border-[rgb(var(--c-warning)/0.3)] rounded-ui-sm hover:bg-[rgb(var(--c-warning-bg))] transition-colors text-ui disabled:opacity-50">
                  <Download size={15} /> {generatingPdf ? 'Génération...' : 'PDF'}
                </button>
              </>
            )}
            <button onClick={() => setMode('list')}
              className="px-4 py-2 border border-gray-200 rounded-ui-sm hover:bg-gray-50 transition-colors">Annuler</button>
            <button onClick={saveQuote} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-ui-sm hover:bg-primary-700 transition-colors disabled:opacity-50">
              <Save size={16} /> {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-6">
            {/* Client + Contact */}
            <BandeauTest tbl="clients" id={currentQuote.client_id} />
            <div className="bg-white rounded-ui border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Building2 size={18} /> Client</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-ui font-medium text-gray-700 mb-1">Client *</label>
                  <SearchSelect
                    value={currentQuote.client_id || ''}
                    onChange={v => handleClientChange(v)}
                    options={(() => {
                      const recentIds = [...new Set(quotes.map(q => q.client_id).filter(Boolean))].slice(0, 8)
                      const recent = clientOptions(recentIds.map(id => clients.find(c => c.id === id)).filter(Boolean)).map(o => ({ ...o, group: 'Clients récents' }))
                      const rest = clientOptions(clients.filter(c => !recentIds.includes(c.id))).map(o => ({ ...o, group: 'Tous les clients' }))
                      return [...recent, ...rest]
                    })()}
                    emptyLabel="- Sélectionner un client -"
                    searchPlaceholder="Nom, ville, SIRET, contact..."
                    aria-label="Client"
                  />
                </div>
                <div>
                  <label className="block text-ui font-medium text-gray-700 mb-1">Contact</label>
                  <select value={currentQuote.contact_id || ''}
                    onChange={(e) => setCurrentQuote(prev => ({ ...prev, contact_id: e.target.value || null }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-ui-sm focus:ring-2 focus:ring-primary-500">
                    <option value="">- Aucun -</option>
                    {contacts.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.civilite ? c.civilite + ' ' : ''}{c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim()} {c.role ? `(${c.role})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {selectedClient && (
                <div className="mt-3 p-3 bg-gray-50 rounded-ui-sm text-ui text-gray-600">
                  {selectedClient.address && <p>{selectedClient.address}</p>}
                  {(selectedClient.postal_code || selectedClient.city) && <p>{selectedClient.postal_code} {selectedClient.city}</p>}
                  {selectedClient.siret && <p className="text-ui-sm text-gray-400 mt-1">SIRET : {selectedClient.siret}</p>}
                </div>
              )}
            </div>

            {/* Objet + Réf */}
            <div className="bg-white rounded-ui border border-gray-200 p-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-ui font-medium text-gray-700 mb-1">Objet du devis</label>
                  <input type="text" value={currentQuote.object}
                    onChange={(e) => setCurrentQuote(prev => ({ ...prev, object: e.target.value }))}
                    placeholder="Ex : Formation SST en intra"
                    className="w-full px-3 py-2 border border-gray-200 rounded-ui-sm focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-ui font-medium text-gray-700 mb-1">Réf. client</label>
                  <input type="text" value={currentQuote.client_reference}
                    onChange={(e) => setCurrentQuote(prev => ({ ...prev, client_reference: e.target.value }))}
                    placeholder="Optionnel"
                    className="w-full px-3 py-2 border border-gray-200 rounded-ui-sm focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-ui font-medium text-gray-700 mb-1">Votre interlocuteur</label>
                  <select value={currentQuote.created_by}
                    onChange={(e) => setCurrentQuote(prev => ({ ...prev, created_by: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-ui-sm focus:ring-2 focus:ring-primary-500">
                    {teamNames().map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
            </div>


            {/* Dates + Conditions + TVA - inline compact */}
            <div className="bg-white rounded-ui border border-gray-200 p-4">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <div>
                  <label className="block text-ui-sm text-gray-500 mb-1">Date devis</label>
                  <input type="date" value={currentQuote.quote_date} onChange={(e) => handleDateChange(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-ui-sm text-ui" />
                </div>
                <div>
                  <label className="block text-ui-sm text-gray-500 mb-1">Validité</label>
                  <input type="date" value={currentQuote.validity_date}
                    onChange={(e) => setCurrentQuote(prev => ({ ...prev, validity_date: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-ui-sm text-ui" />
                </div>
                <div>
                  <label className="block text-ui-sm text-gray-500 mb-1">Moyen de règlement</label>
                  <select value={currentQuote.payment_method}
                    onChange={(e) => setCurrentQuote(prev => ({ ...prev, payment_method: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-ui-sm text-ui">
                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-ui-sm text-gray-500 mb-1">Délai règlement</label>
                  <select value={currentQuote.payment_terms}
                    onChange={(e) => setCurrentQuote(prev => ({ ...prev, payment_terms: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-ui-sm text-ui">
                    {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-ui-sm text-gray-500 mb-1">TVA</label>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={currentQuote.tva_applicable}
                      onChange={(e) => setCurrentQuote(prev => ({ ...prev, tva_applicable: e.target.checked }))}
                      className="rounded" id="tva-check" />
                    {currentQuote.tva_applicable && (
                      <input type="text" inputMode="decimal" value={currentQuote.tva_rate}
                        onChange={(e) => setCurrentQuote(prev => ({ ...prev, tva_rate: e.target.value }))}
                        className="w-16 px-2 py-1.5 border border-gray-200 rounded-ui-sm text-ui text-center" />
                    )}
                    {currentQuote.tva_applicable && <span className="text-ui-sm text-gray-400">%</span>}
                    {!currentQuote.tva_applicable && <span className="text-ui-sm text-gray-400">Non applicable</span>}
                  </div>
                </div>
                <div>
                  <label className="block text-ui-sm text-gray-500 mb-1">Remise</label>
                  <div className="flex items-center gap-1">
                    <input type="text" inputMode="decimal" value={currentQuote.discount_percent}
                      onChange={(e) => setCurrentQuote(prev => ({ ...prev, discount_percent: e.target.value }))}
                      className="w-16 px-2 py-1.5 border border-gray-200 rounded-ui-sm text-ui text-center" />
                    <span className="text-ui-sm text-gray-400">%</span>
                    {parseFloat(currentQuote.discount_percent) > 0 && (
                      <input type="text" value={currentQuote.discount_label}
                        onChange={(e) => setCurrentQuote(prev => ({ ...prev, discount_label: e.target.value }))}
                        placeholder="Libellé"
                        className="flex-1 px-2 py-1.5 border border-gray-200 rounded-ui-sm text-ui" />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Line items - compact */}
            <div className="bg-white rounded-ui border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Lignes du devis</h2>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="border border-gray-100 rounded-ui-sm p-3 bg-gray-50">
                    {/* Row 1: Code + Title + Description inline */}
                    <div className="flex items-start gap-2 mb-2">
                      <input type="text" value={item.code} onChange={(e) => updateItem(idx, 'code', e.target.value)}
                        placeholder="Code" className="w-24 px-2 py-1.5 border border-gray-200 rounded text-ui-sm font-mono flex-shrink-0" />
                      <input type="text" value={item.description_title} onChange={(e) => updateItem(idx, 'description_title', e.target.value)}
                        placeholder="Titre de la ligne *"
                        className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-ui font-medium" />
                      <button onClick={() => removeItem(idx)}
                        className="p-1.5 text-gray-300 hover:text-[rgb(var(--c-danger))] transition-colors flex-shrink-0"><Trash2 size={14} /></button>
                    </div>
                    {/* Row 2: Description (collapsible - shown if has content or on focus) */}
                    <input type="text" value={item.description_detail} onChange={(e) => updateItem(idx, 'description_detail', e.target.value)}
                      placeholder="Description détaillée (optionnel)"
                      className="w-full px-2 py-1 border border-gray-200 rounded text-ui-sm text-gray-600 mb-2" />
                    <div className="flex flex-wrap gap-2 mb-2">
                      <select value={item.nature || 'service'} onChange={(e) => updateItem(idx, 'nature', e.target.value)} className="border border-gray-200 rounded px-1 py-0.5 text-ui-sm text-gray-600" aria-label="Nature de la ligne">
                        <option value="service">Service</option><option value="bien">Bien</option>
                      </select>
                      <select value={item.vat_regime || 'normal'} onChange={(e) => { const v = e.target.value; const n = [...items]; n[idx] = { ...n[idx], vat_regime: v, tva_rate: v === 'normal' ? (n[idx].tva_rate || 20) : 0 }; setItems(n) }} className="border border-gray-200 rounded px-1 py-0.5 text-ui-sm text-gray-600" aria-label="Régime de TVA de la ligne">
                        <option value="normal">TVA normale</option><option value="exonere">Exonérée</option><option value="autoliquidation">Autoliquidation</option>
                      </select>
                    </div>
                    {/* Row 3: Qté + Unité + PU HT + TVA% + Total = tout sur une ligne */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <label className="text-ui-sm text-gray-400 whitespace-nowrap">Qté</label>
                        <input type="text" inputMode="decimal" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                          className="w-14 px-2 py-1 border border-gray-200 rounded text-ui text-center" />
                      </div>
                      <div className="flex items-center gap-1">
                        <label className="text-ui-sm text-gray-400">Unité</label>
                        <input type="text" value={item.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)}
                          className="w-16 px-2 py-1 border border-gray-200 rounded text-ui" />
                      </div>
                      <div className="flex items-center gap-1">
                        <label className="text-ui-sm text-gray-400">PU HT</label>
                        <input type="text" inputMode="decimal" value={item.unit_price_ht} onChange={(e) => updateItem(idx, 'unit_price_ht', e.target.value)}
                          className="w-20 px-2 py-1 border border-gray-200 rounded text-ui text-right" />
                      </div>
                      <div className="flex items-center gap-1">
                        <label className="text-ui-sm text-gray-400">TVA%</label>
                        <input type="text" inputMode="decimal" value={item.tva_rate} onChange={(e) => updateItem(idx, 'tva_rate', e.target.value)}
                          className="w-14 px-2 py-1 border border-gray-200 rounded text-ui text-center" />
                      </div>
                      <div className="ml-auto text-right">
                        <span className="text-ui font-semibold text-gray-900">{money(calcItemTotal(item))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Add buttons - always at bottom after lines */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                <PickerMenu
                  buttonClassName="text-ui px-3 py-1.5 bg-gray-100 text-gray-600 rounded-ui-sm hover:bg-gray-200 transition-colors flex items-center gap-1"
                  searchPlaceholder="Rechercher une formation..."
                  emptyText="Aucune formation"
                  items={courses.map(c => ({ key: c.id, label: c.title, hint: [c.code, c.price_ht ? money(c.price_ht) : 'Prix à définir'].filter(Boolean).join(' · '), course: c }))}
                  onPick={it => addFromCourse(it.course)}
                >
                  <Plus size={14} /> Depuis formation
                </PickerMenu>
                <PickerMenu
                  buttonClassName="text-ui px-3 py-1.5 bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] rounded-ui-sm hover:bg-[rgb(var(--c-warning-bg))] transition-colors flex items-center gap-1"
                  searchPlaceholder="Rechercher du matériel ou des frais..."
                  emptyText="Aucune ligne"
                  items={predefinedMaterials.map((mat, i) => ({ key: i, label: mat.description_title, hint: [mat.code, mat.description_detail, money(mat.unit_price_ht)].filter(Boolean).join(' · '), mat }))}
                  onPick={it => addFromMaterial(it.mat)}
                >
                  <Plus size={14} /> Matériel et frais
                </PickerMenu>
                <button onClick={addItem}
                  className="text-ui px-3 py-1.5 bg-primary-50 text-primary-600 rounded-ui-sm hover:bg-primary-100 transition-colors flex items-center gap-1">
                  <Plus size={14} /> Ligne libre
                </button>
              </div>
              {/* Totals */}
              <div className="mt-4 pt-4 border-t border-gray-200 flex justify-end">
                <div className="w-72 space-y-1.5 text-ui">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total HT</span>
                    <span className="font-medium">{money(totals.subtotalHt)}</span>
                  </div>
                  {parseFloat(currentQuote.discount_percent) > 0 && (
                    <>
                      <div className="flex justify-between text-[rgb(var(--c-warning))]">
                        <span>Remise {currentQuote.discount_percent}%{currentQuote.discount_label ? ` (${currentQuote.discount_label})` : ''}</span>
                        <span>-{money(totals.discountAmount)}</span>
                      </div>
                      <div className="flex justify-between border-t pt-1">
                        <span className="text-gray-500">Net HT</span>
                        <span className="font-medium">{money(totals.totalHt)}</span>
                      </div>
                    </>
                  )}
                  {currentQuote.tva_applicable ? (
                    <div className="flex justify-between">
                      <span className="text-gray-500">TVA {currentQuote.tva_rate}%</span>
                      <span>{money(totals.totalTva)}</span>
                    </div>
                  ) : (
                    <div className="text-ui-sm text-gray-400 italic">TVA non applicable (art. 261 CGI)</div>
                  )}
                  <div className="flex justify-between text-base font-bold border-t pt-2 text-primary-700">
                    <span>Total TTC</span><span>{money(totals.totalTtc)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Notes + Signature - side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white rounded-ui border border-gray-200 p-4">
                <label className="block text-ui font-medium text-gray-700 mb-2">Notes</label>
                <textarea value={currentQuote.notes}
                  onChange={(e) => setCurrentQuote(prev => ({ ...prev, notes: e.target.value }))}
                  rows={3} placeholder="Notes visibles sur le devis (ex: 5% remise BNI)"
                  className="w-full px-3 py-2 border border-gray-200 rounded-ui-sm text-ui resize-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div className="bg-white rounded-ui border border-gray-200 p-4">
                <h2 className="font-semibold text-gray-900 mb-2 flex items-center gap-2"><Pen size={16} /> Signature client</h2>
                <p className="text-ui-sm text-gray-400 mb-2">
                  Mention "Lu et approuvé, bon pour accord". Vide = zone de signature à imprimer.
                </p>
                <SignaturePad
                  value={currentQuote.signature_base64}
                  onChange={(data) => setCurrentQuote(prev => ({ ...prev, signature_base64: data }))}
                  onClear={() => setCurrentQuote(prev => ({ ...prev, signature_base64: null }))}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ============================================================
  // SEND WIZARD MODAL
  // ============================================================
  function renderSendWizard() {
    const { quote, client, contact, pdfBlobUrl, clientContacts } = sendWizard
    const steps = [
      { num: 1, label: 'Aperçu PDF' },
      { num: 2, label: 'Texte email' },
      { num: 3, label: 'Envoyer' }
    ]

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-ui-lg shadow-md w-full max-w-4xl max-h-[92vh] flex flex-col mx-4">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                <Mail className="inline w-5 h-5 mr-2 text-primary-600" />
                Envoyer le devis {quote.reference}
              </h2>
              <p className="text-ui text-gray-500">{client?.name}</p>
            </div>
            <button onClick={closeSendWizard} className="p-2 hover:bg-gray-100 rounded-ui-sm">
              <X size={20} />
            </button>
          </div>

          {/* Steps indicator */}
          <div className="flex items-center justify-center gap-2 px-6 py-3 bg-gray-50 border-b">
            {steps.map((s, i) => (
              <div key={s.num} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-ui font-bold transition-colors ${
                  sendStep === s.num ? 'bg-primary-600 text-white' : 
                  sendStep > s.num ? 'bg-[rgb(var(--c-success))] text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  {sendStep > s.num ? <Check size={16} /> : s.num}
                </div>
                <span className={`text-ui ${sendStep === s.num ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                  {s.label}
                </span>
                {i < steps.length - 1 && <div className="w-8 h-px bg-gray-300 mx-1" />}
              </div>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* STEP 1: Aperçu PDF */}
            {sendStep === 1 && (
              <div>
                <p className="text-ui text-gray-600 mb-3">Vérifiez le devis avant envoi :</p>
                <iframe
                  src={pdfBlobUrl}
                  className="w-full rounded-ui-sm border border-gray-200"
                  style={{ height: '40vh' }}
                  title="Aperçu du devis"
                />

                {/* ─── Pièces jointes ─────────────────── */}
                <div className="mt-4 bg-gray-50 rounded-ui p-4 border">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-ui font-semibold text-gray-700 flex items-center gap-2">
                      <Paperclip size={16} /> Pièces jointes
                    </h3>
                    <label className="px-3 py-1.5 bg-primary-50 text-primary-700 border border-primary-200 rounded-ui-sm text-ui-sm font-medium cursor-pointer hover:bg-primary-100 transition-colors">
                      + Ajouter un fichier
                      <input type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          if (file.size > 5 * 1024 * 1024) return toast.error('Fichier trop lourd (max 5 Mo)')
                          const base64 = await new Promise((resolve) => {
                            const reader = new FileReader()
                            reader.onload = () => resolve(reader.result.split(',')[1])
                            reader.readAsDataURL(file)
                          })
                          setSendAttachments(prev => [...prev, {
                            filename: file.name,
                            base64,
                            type: 'manual',
                            enabled: true
                          }])
                          e.target.value = ''
                          toast.success(`${file.name} ajouté`)
                        }}
                      />
                    </label>
                  </div>

                  {/* Devis (toujours inclus) */}
                  <div className="flex items-center gap-3 py-2 px-3 bg-white rounded-ui-sm border border-gray-200 mb-2">
                    <FileText size={16} className="text-[rgb(var(--c-warning))] flex-shrink-0" />
                    <span className="text-ui font-medium text-gray-800 flex-1">{quote.reference}.pdf</span>
                    <span className="text-ui-sm text-gray-400">Devis</span>
                    <Check size={14} className="text-[rgb(var(--c-success))]" />
                  </div>

                  {/* Programmes auto-détectés + manuels */}
                  {sendAttachments.map((att, idx) => (
                    <div key={idx} className={`flex items-center gap-3 py-2 px-3 rounded-ui-sm border mb-2 ${
                      att.enabled ? 'bg-white border-gray-200' : 'bg-gray-100 border-gray-200 opacity-60'
                    }`}>
                      <FileText size={16} className={att.type === 'program' ? 'text-[rgb(var(--c-info))] flex-shrink-0' : 'text-gray-800 flex-shrink-0'} />
                      <div className="flex-1 min-w-0">
                        <p className="text-ui font-medium text-gray-800 truncate">{att.filename}</p>
                        {att.courseTitle && <p className="text-ui-sm text-gray-400 truncate">{att.courseTitle}</p>}
                      </div>
                      <span className="text-ui-sm text-gray-400 flex-shrink-0">
                        {att.kind === 'cgv' ? 'CGV' : att.type === 'program' ? 'Programme' : 'Manuel'}
                      </span>
                      <button
                        onClick={() => setSendAttachments(prev => prev.map((a, i) => i === idx ? { ...a, enabled: !a.enabled } : a))}
                        className={`w-7 h-7 flex items-center justify-center rounded-ui-sm border transition-colors ${
                          att.enabled ? 'bg-[rgb(var(--c-success-bg))] border-[rgb(var(--c-success)/0.3)] text-[rgb(var(--c-success))]' : 'bg-gray-100 border-gray-300 text-gray-400'
                        }`}
                        title={att.enabled ? 'Désactiver' : 'Activer'}
                      >
                        {att.enabled ? <Check size={14} /> : <X size={14} />}
                      </button>
                      {att.type === 'manual' && (
                        <button
                          onClick={() => setSendAttachments(prev => prev.filter((_, i) => i !== idx))}
                          className="w-7 h-7 flex items-center justify-center rounded-ui-sm text-[rgb(var(--c-danger))] hover:bg-[rgb(var(--c-danger-bg))] hover:text-[rgb(var(--c-danger))] transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}

                  {sendAttachments.length === 0 && (
                    <p className="text-ui-sm text-gray-400 mt-1">Aucun programme détecté. Ajoutez des fichiers manuellement si besoin.</p>
                  )}
                </div>
              </div>
            )}

            {/* STEP 2: Texte email IA */}
            {sendStep === 2 && (
              <div className="space-y-4">
                {/* Destinataire */}
                <div>
                  <label className="block text-ui font-medium text-gray-700 mb-1">Destinataire</label>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={sendEmail.to}
                      onChange={(e) => setSendEmail(prev => ({ ...prev, to: e.target.value }))}
                      placeholder="email@entreprise.fr"
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-ui-sm text-ui"
                    />
                    {clientContacts && clientContacts.length > 0 && (
                      <select
                        className="px-3 py-2 border border-gray-200 rounded-ui-sm text-ui bg-white"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) setSendEmail(prev => ({ ...prev, to: e.target.value }))
                        }}
                      >
                        <option value="">Contacts...</option>
                        {clientContacts.filter(c => c.email).map(c => (
                          <option key={c.id} value={c.email}>
                            {c.first_name || ''} {c.last_name || c.name || ''} - {c.email}
                          </option>
                        ))}
                        {client?.contact_email && (
                          <option value={client.contact_email}>Contact principal - {client.contact_email}</option>
                        )}
                      </select>
                    )}
                  </div>
                </div>

                {/* Objet */}
                <div>
                  <label className="block text-ui font-medium text-gray-700 mb-1">Objet</label>
                  <input
                    type="text"
                    value={sendEmail.subject}
                    onChange={(e) => setSendEmail(prev => ({ ...prev, subject: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-ui-sm text-ui"
                  />
                </div>

                {/* Corps */}
                <div>
                  <label className="block text-ui font-medium text-gray-700 mb-1">Corps du message</label>
                  <textarea
                    value={sendEmail.body}
                    onChange={(e) => setSendEmail(prev => ({ ...prev, body: e.target.value }))}
                    rows={10}
                    className="w-full px-3 py-2 border border-gray-200 rounded-ui-sm text-ui font-sans"
                  />
                </div>

                {/* Régénérer avec instructions */}
                <div className="bg-[rgb(var(--c-info-bg))] rounded-ui-sm p-3">
                  <label className="block text-ui-sm font-medium text-[rgb(var(--c-info))] mb-1">
                    Instructions pour régénérer (optionnel)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={sendEmail.customInstructions}
                      onChange={(e) => setSendEmail(prev => ({ ...prev, customInstructions: e.target.value }))}
                      placeholder="Ex: ton plus formel, mentionner une date limite..."
                      className="flex-1 px-3 py-2 border border-[rgb(var(--c-info)/0.3)] rounded-ui-sm text-ui bg-white"
                    />
                    <button
                      onClick={generateEmailText}
                      disabled={sendLoading}
                      className="btn btn-secondary text-ui font-medium hover:bg-[rgb(var(--c-info))] disabled:opacity-50 flex items-center gap-2"
                    >
                      {sendLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      {sendEmail.body ? 'Régénérer' : 'Générer'}
                    </button>
                  </div>
                </div>

                <p className="text-ui-sm text-gray-400">
                  La signature sera ajoutée automatiquement selon votre compte email.
                </p>
              </div>
            )}

            {/* STEP 3: Récap & envoi */}
            {sendStep === 3 && (
              <div className="space-y-4">
                <div className="bg-[rgb(var(--c-success-bg))] border border-[rgb(var(--c-success)/0.3)] rounded-ui p-5 space-y-3">
                  <h3 className="font-semibold text-[rgb(var(--c-success))]">Récapitulatif</h3>
                  <div className="grid grid-cols-[120px_1fr] gap-y-2 text-ui">
                    <span className="text-gray-500">De :</span>
                    <span className="font-medium">{quote.created_by} ({orgName()})</span>
                    <span className="text-gray-500">À :</span>
                    <span className="font-medium">{sendEmail.to}</span>
                    <span className="text-gray-500">Objet :</span>
                    <span className="font-medium">{sendEmail.subject}</span>
                    <span className="text-gray-500">Pièces jointes :</span>
                    <div className="space-y-1">
                      <span className="flex items-center gap-1 text-[rgb(var(--c-warning))]">
                        <FileText size={14} /> {quote.reference}.pdf
                      </span>
                      {sendAttachments.filter(a => a.enabled).map((att, i) => (
                        <span key={i} className="flex items-center gap-1 text-[rgb(var(--c-info))]">
                          <FileText size={14} /> {att.filename}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-ui p-5">
                  <h4 className="text-ui font-medium text-gray-700 mb-2">Aperçu du message :</h4>
                  <div className="text-ui text-gray-600 whitespace-pre-wrap bg-white rounded-ui-sm border p-4">
                    {sendEmail.body}
                  </div>
                  <p className="text-ui-sm text-gray-400 mt-2 italic">+ signature automatique</p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
            <button
              onClick={() => sendStep > 1 ? setSendStep(sendStep - 1) : closeSendWizard()}
              className="px-4 py-2 text-ui font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-ui-sm transition-colors"
            >
              {sendStep === 1 ? 'Annuler' : '← Retour'}
            </button>
            <div className="flex gap-2">
              {sendStep === 1 && (
                <button
                  onClick={() => { setSendStep(2); if (!sendEmail.body) generateEmailText() }}
                  className="px-6 py-2.5 bg-primary-600 text-white rounded-ui-sm text-ui font-medium hover:bg-primary-700 transition-colors flex items-center gap-2"
                >
                  PDF OK, continuer <ChevronDown size={14} className="-rotate-90" />
                </button>
              )}
              {sendStep === 2 && (
                <button
                  onClick={() => {
                    if (!sendEmail.to) return toast.error('Indiquez un destinataire')
                    if (!sendEmail.subject) return toast.error('Indiquez un objet')
                    if (!sendEmail.body) return toast.error('Générez ou rédigez le texte')
                    setSendStep(3)
                  }}
                  className="px-6 py-2.5 bg-primary-600 text-white rounded-ui-sm text-ui font-medium hover:bg-primary-700 transition-colors flex items-center gap-2"
                >
                  Continuer <ChevronDown size={14} className="-rotate-90" />
                </button>
              )}
              {sendStep === 3 && (
                <button
                  onClick={handleSendQuoteEmail}
                  disabled={sendSending}
                  className="btn btn-secondary text-ui font-medium hover:bg-[rgb(var(--c-success))] transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {sendSending ? (
                    <><Loader2 size={16} className="animate-spin" /> Envoi en cours...</>
                  ) : (
                    <><Send size={16} /> Envoyer le devis</>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ============================================================
  // SESSION GENERATION WIZARD MODAL
  // ============================================================
  function renderSessionWizard() {
    const { quote, client, formations } = sessionWizard
    const selectedCount = sessionSelections.filter(s => s.selected).length

    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-ui-lg shadow-md w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <GraduationCap size={22} className="text-[rgb(var(--c-success))]" />
                Générer des sessions
              </h2>
              <p className="text-ui text-gray-500 mt-0.5">
                Devis {quote.reference} - {client.name}
              </p>
            </div>
            <button onClick={() => setSessionWizard(null)} className="p-2 hover:bg-gray-100 rounded-ui-sm transition-colors">
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {formations.map((f, idx) => {
              const sel = sessionSelections[idx]
              if (!sel) return null
              const course = f.course
              return (
                <div key={f.item.id}
                  className={`border rounded-ui transition-all ${sel.selected ? 'border-[rgb(var(--c-success)/0.3)] bg-[rgb(var(--c-success-bg))] shadow-sm' : 'border-gray-200 bg-gray-50/50 opacity-60'}`}
                >
                  {/* Formation header + checkbox */}
                  <div className="px-4 py-3 flex items-center gap-3 cursor-pointer"
                    onClick={() => updateSessionSelection(idx, 'selected', !sel.selected)}>
                    <input type="checkbox" checked={sel.selected} readOnly
                      className="w-5 h-5 rounded border-gray-300 text-[rgb(var(--c-success))] focus:ring-[rgb(var(--c-success)/0.3)]" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900">{course.title}</p>
                      <div className="flex items-center gap-3 text-ui-sm text-gray-500 mt-0.5">
                        <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{course.code}</span>
                        {course.duration_days && <span>{course.duration_days}j ({course.duration_hours}h)</span>}
                        <span className="flex items-center gap-1"><Users size={12} /> {sel.nbParticipants} stagiaire{sel.nbParticipants > 1 ? 's' : ''}</span>
                        <span className="font-medium text-[rgb(var(--c-success))]">{money(sel.totalPriceHt)} HT</span>
                      </div>
                    </div>
                  </div>

                  {/* Configuration (visible si sélectionné) */}
                  {sel.selected && (
                    <div className="px-4 pb-4 pt-1 border-t border-[rgb(var(--c-success)/0.3)]">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-ui-sm font-medium text-gray-600 mb-1">
                            <Calendar size={12} className="inline mr-1" />Date début *
                          </label>
                          <input type="date" value={sel.startDate}
                            onChange={(e) => {
                              updateSessionSelection(idx, 'startDate', e.target.value)
                              // Auto-calc end date based on duration
                              if (e.target.value && course.duration_days) {
                                const start = new Date(e.target.value)
                                let daysToAdd = parseInt(course.duration_days) - 1
                                // Skip weekends
                                let current = new Date(start)
                                while (daysToAdd > 0) {
                                  current.setDate(current.getDate() + 1)
                                  if (current.getDay() !== 0 && current.getDay() !== 6) daysToAdd--
                                }
                                updateSessionSelection(idx, 'endDate', format(current, 'yyyy-MM-dd'))
                              }
                            }}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-ui-sm text-ui focus:ring-2 focus:ring-[rgb(var(--c-success)/0.3)]" />
                        </div>
                        <div>
                          <label className="block text-ui-sm font-medium text-gray-600 mb-1">Date fin *</label>
                          <input type="date" value={sel.endDate}
                            onChange={(e) => updateSessionSelection(idx, 'endDate', e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-ui-sm text-ui focus:ring-2 focus:ring-[rgb(var(--c-success)/0.3)]" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-ui-sm font-medium text-gray-600 mb-1">Créneau</label>
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { key: 'matin',    label: 'Matin',      start: '08:00', end: '12:00' },
                              { key: 'aprem',    label: 'Après-midi', start: '13:00', end: '17:00' },
                              { key: 'soiree',   label: 'Soirée',     start: '18:00', end: '22:00' },
                              { key: 'nuit',     label: 'Nuit',       start: '21:00', end: '05:00' },
                              { key: 'journee',  label: 'Journée',    start: '09:00', end: '17:00' },
                              { key: 'perso',    label: 'Perso',      start: null,    end: null    },
                            ].map(p => (
                              <button
                                key={p.key}
                                type="button"
                                onClick={() => {
                                  setSessionSelections(prev => prev.map((s, i) => {
                                    if (i !== idx) return s
                                    return {
                                      ...s,
                                      preset: p.key,
                                      startTime: p.start || s.startTime,
                                      endTime: p.end || s.endTime,
                                    }
                                  }))
                                }}
                                className={`px-2.5 py-1 rounded-ui-sm text-ui-sm font-medium border transition-all ${
                                  sel.preset === p.key
                                    ? 'bg-[rgb(var(--c-success))] text-white border-[rgb(var(--c-success)/0.3)]'
                                    : 'bg-white text-gray-600 border-gray-200 hover:border-[rgb(var(--c-success)/0.3)]'
                                }`}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                          {sel.preset === 'perso' && (
                            <div className="flex gap-2 mt-2">
                              <div className="flex-1">
                                <input type="time" value={sel.startTime}
                                  onChange={(e) => updateSessionSelection(idx, 'startTime', e.target.value)}
                                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-ui-sm text-ui focus:ring-2 focus:ring-[rgb(var(--c-success)/0.3)]" />
                              </div>
                              <span className="self-center text-gray-400 text-ui">→</span>
                              <div className="flex-1">
                                <input type="time" value={sel.endTime}
                                  onChange={(e) => updateSessionSelection(idx, 'endTime', e.target.value)}
                                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-ui-sm text-ui focus:ring-2 focus:ring-[rgb(var(--c-success)/0.3)]" />
                              </div>
                            </div>
                          )}
                          {sel.preset !== 'perso' && (
                            <p className="text-ui-sm text-gray-400 mt-1">{sel.startTime} → {sel.endTime}</p>
                          )}
                          {/* Indicateur durée calculée */}
                          {sel.startDate && sel.endDate && sel.startTime && sel.endTime && (() => {
                            const start = new Date(sel.startDate)
                            const end = new Date(sel.endDate)
                            const nbJours = Math.max(1, Math.round((end - start) / 86400000) + 1)
                            const [sh, sm] = sel.startTime.split(':').map(Number)
                            const [eh, em] = sel.endTime.split(':').map(Number)
                            let mins = (eh * 60 + em) - (sh * 60 + sm)
                            if (mins <= 0) mins += 24 * 60
                            const hParJour = Math.round(mins / 60 * 10) / 10
                            const hTotal = Math.round(hParJour * nbJours * 10) / 10
                            const isDemi = mins <= 270
                            return (
                              <div className={`mt-1.5 px-2 py-1 rounded text-ui-sm font-medium flex items-center gap-1.5 ${isDemi ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]'}`}>
                                <span>{isDemi ? '' : ''}</span>
                                <span>{nbJours === 1 ? '1 jour' : `${nbJours} jours`} - {hTotal}h au total ({hParJour}h/jour)</span>
                              </div>
                            )
                          })()}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                        <div>
                          <label className="block text-ui-sm font-medium text-gray-600 mb-1">Formateur</label>
                          <select value={sel.trainerId}
                            onChange={(e) => updateSessionSelection(idx, 'trainerId', e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-ui-sm text-ui focus:ring-2 focus:ring-[rgb(var(--c-success)/0.3)]">
                            <option value="">- Choisir -</option>
                            {(storeTrainers || []).map(t => (
                              <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-ui-sm font-medium text-gray-600 mb-1">
                            <Users size={12} className="inline mr-1" />Stagiaires
                          </label>
                          <input type="number" min="1" max="20" value={sel.nbParticipants}
                            onChange={(e) => updateSessionSelection(idx, 'nbParticipants', parseInt(e.target.value) || 1)}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-ui-sm text-ui focus:ring-2 focus:ring-[rgb(var(--c-success)/0.3)]" />
                        </div>
                        <div>
                          <label className="block text-ui-sm font-medium text-gray-600 mb-1">
                            <MapPin size={12} className="inline mr-1" />Lieu de formation
                          </label>
                          <input type="text" value={sel.location}
                            onChange={(e) => updateSessionSelection(idx, 'location', e.target.value)}
                            placeholder="Adresse complète du lieu..."
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-ui-sm text-ui focus:ring-2 focus:ring-[rgb(var(--c-success)/0.3)]" />
                          <label className="flex items-center gap-1.5 mt-1 cursor-pointer">
                            <input type="checkbox" checked={sel.isIntra !== false}
                              onChange={(e) => updateSessionSelection(idx, 'isIntra', e.target.checked)}
                              className="w-3 h-3 rounded text-[rgb(var(--c-success))]" />
                            <span className="text-ui-sm text-gray-500">Formation intra (chez le client)</span>
                          </label>
                        </div>
                        <div>
                          <label className="block text-ui-sm font-medium text-gray-600 mb-1">Prix HT session</label>
                          <input type="number" step="0.01" value={sel.totalPriceHt}
                            onChange={(e) => updateSessionSelection(idx, 'totalPriceHt', parseFloat(e.target.value) || 0)}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-ui-sm text-ui focus:ring-2 focus:ring-[rgb(var(--c-success)/0.3)]" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
            <button onClick={() => setSessionWizard(null)}
              className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-ui-sm text-ui transition-colors">
              Annuler
            </button>
            <div className="flex items-center gap-3">
              <span className="text-ui text-gray-500">
                {selectedCount} formation{selectedCount > 1 ? 's' : ''} sélectionnée{selectedCount > 1 ? 's' : ''}
              </span>
              <button onClick={handleCreateSessions} disabled={sessionCreating || selectedCount === 0}
                className="btn btn-secondary text-ui font-medium hover:bg-[rgb(var(--c-success))] transition-colors disabled:opacity-50 flex items-center gap-2">
                {sessionCreating ? (
                  <><Loader2 size={16} className="animate-spin" /> Création...</>
                ) : (
                  <><GraduationCap size={16} /> Créer {selectedCount} session{selectedCount > 1 ? 's' : ''}</>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}

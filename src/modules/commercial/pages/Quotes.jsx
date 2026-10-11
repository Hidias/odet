import { apiFetch } from '../../../core/api'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../../../core/supabase'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { generateQuotePDF, generatePartialAcceptancePDF } from '../pdf/quoteGenerator'
import { useDataStore } from '../../../core/store'
import {
  Plus, Search, FileText, ArrowLeft, Trash2, Save, Send, Copy,
  ChevronDown, ChevronUp, Eye, MoreHorizontal, Check, X, Edit2,
  Download, RefreshCw, Building2, GripVertical, Pen, Mail, Loader2, Paperclip,
  GraduationCap, Calendar, MapPin, Users
} from 'lucide-react'
import { money } from '../../../core/utils'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRelanceIA } from '../lib/useRelanceIA'

const STATUS_CONFIG = {
  draft: { label: 'Brouillon', class: 'bg-gray-100 text-gray-700', icon: '📝' },
  sent: { label: 'Envoyé', class: 'bg-blue-100 text-blue-700', icon: '📤' },
  accepted: { label: 'Accepté', class: 'bg-green-100 text-green-700', icon: '✅' },
  refused: { label: 'Refusé', class: 'bg-red-100 text-red-700', icon: '❌' },
  expired: { label: 'Expiré', class: 'bg-orange-100 text-orange-700', icon: '⏰' },
  partial: { label: 'Partiellement accepté', class: 'bg-yellow-100 text-yellow-700', icon: '⚡' },
  invoiced: { label: 'Facturé', class: 'bg-purple-100 text-purple-700', icon: '🧾' }
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

const CONTACTS_LABEL = { 'Hicham Saidi': 'Hicham Saidi', 'Maxime Langlais': 'Maxime Langlais' }

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
      <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden bg-white relative">
        <canvas ref={canvasRef} className="w-full cursor-crosshair"
          style={{ height: '120px', touchAction: 'none' }}
          onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
          onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
        {!hasDrawn && !value && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-gray-300 text-sm flex items-center gap-2"><Pen size={16} /> Signez ici</p>
          </div>
        )}
      </div>
      {(hasDrawn || value) && (
        <button onClick={clearCanvas} className="mt-1 text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
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
    created_by: 'Hicham Saidi', signature_base64: null
  }

  const emptyItem = {
    code: '', description_title: '', description_detail: '',
    quantity: 1, unit: 'unité', unit_price_ht: 0, tva_rate: 20, course_id: ''
  }

  const predefinedMaterials = [
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
          toast.success(`📝 Nouveau devis pour ${client.name}`)
        })()
      }
    }
  }, [clients, searchParams])

  async function loadAll() {
    setLoading(true)
    const [quotesRes, clientsRes, coursesRes] = await Promise.all([
      supabase.from('quotes').select('*, clients(name, siret, address, postal_code, city, contact_name, contact_phone, contact_email)').order('quote_date', { ascending: false }),
      supabase.from('clients').select('id, name, siret, siren, address, postal_code, city, contact_name, contact_phone, contact_email, status').order('name'),
      supabase.from('courses').select('id, title, code, price_ht, duration_hours, duration_days, description').order('title')
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
    const today = format(new Date(), 'yyyyMMdd')
    const { data } = await supabase.from('quotes').select('reference')
      .like('reference', `DEV-${today}%`).order('reference', { ascending: false }).limit(1)
    let nextNum = 1
    if (data && data.length > 0) {
      const parts = data[0].reference.split('-')
      nextNum = parseInt(parts[2] || '0') + 1
    }
    return `DEV-${today}-${String(nextNum).padStart(5, '0')}`
  }

  function calcItemTotal(item) {
    return parseFloat(item.quantity || 0) * parseFloat(item.unit_price_ht || 0)
  }

  function calcTotals(itemsList, discountPercent, tvaRate, tvaApplicable) {
    const subtotalHt = itemsList.reduce((sum, item) => sum + calcItemTotal(item), 0)
    const discountAmount = subtotalHt * (parseFloat(discountPercent || 0) / 100)
    const totalHt = subtotalHt - discountAmount
    const totalTva = tvaApplicable ? totalHt * (parseFloat(tvaRate || 20) / 100) : 0
    return { subtotalHt, discountAmount, totalHt, totalTva, totalTtc: totalHt + totalTva }
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
    if (!confirm(`Dupliquer le devis ${quote.reference} ?`)) return
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
      tva_rate: parseFloat(currentQuote.tva_rate) || 20, tva_applicable: currentQuote.tva_applicable,
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
        unit_price_ht: parseFloat(it.unit_price_ht) || 0, tva_rate: parseFloat(it.tva_rate) || 20,
        total_ht: calcItemTotal(it), course_id: it.course_id || null
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
    if (!confirm('Supprimer ce devis ?')) return
    await supabase.from('quote_items').delete().eq('quote_id', id)
    await supabase.from('quotes').delete().eq('id', id)
    toast.success('Devis supprimé')
    loadAll()
  }

  async function updateStatus(id, newStatus) {
    if (!confirm(`Passer ce devis en "${STATUS_CONFIG[newStatus].label}" ?`)) return
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

      // Auto-detect programs for items with course_id
      const programAttachments = []
      const courseIds = [...new Set(loadedItems.filter(it => it.course_id).map(it => it.course_id))]
      if (courseIds.length > 0) {
        const { data: coursesData } = await supabase
          .from('courses')
          .select('id, title, code, program_url')
          .in('id', courseIds)
        
        for (const course of (coursesData || [])) {
          if (course.program_url) {
            programAttachments.push({
              filename: `Programme_${course.code || course.title.replace(/\s+/g, '_')}.pdf`,
              url: course.program_url,
              type: 'program',
              courseTitle: course.title,
              enabled: true
            })
          }
        }
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
  // ACCEPTATION PARTIELLE — VALIDATION LIGNE PAR LIGNE
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
          senderName: quote.created_by || 'Hicham Saidi',
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
        subject: `Devis ${quote.reference} - Access Formation`,
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
        .filter(att => att.type === 'manual' && att.enabled && att.base64)
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
      unit: mat.unit, position: items.length
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

      {/* Modale relance IA — preview + édition avant envoi */}
      {previewData && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {previewData.relanceNum === 1 ? '1ère' : previewData.relanceNum === 2 ? '2ème' : '3ème'} relance — {previewData.quote?.clients?.name || previewData.quote?.reference}
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {previewData.isFallback ? '⚠️ Généré sans IA (fallback)' : `✨ Généré par IA · ton ${previewData.tone || 'courtois'}`}
                </p>
              </div>
              <button onClick={cancelPreview} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Destinataire</label>
                <p className="text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded-lg">{previewData.clientEmail}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Objet</label>
                <input
                  type="text"
                  value={relanceEdit.subject}
                  onChange={e => setRelanceEdit(prev => ({ ...prev, subject: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-300 focus:border-primary-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Corps du message</label>
                <textarea
                  value={relanceEdit.body}
                  onChange={e => setRelanceEdit(prev => ({ ...prev, body: e.target.value }))}
                  rows={12}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-sans focus:ring-2 focus:ring-primary-300 focus:border-primary-400"
                />
              </div>

              <p className="text-xs text-gray-400">La signature sera ajoutée automatiquement. BCC : contact@accessformation.pro</p>
            </div>

            <div className="p-6 border-t border-gray-100 space-y-3">
              {!relanceConfirmed ? (
                <div className="flex items-center justify-between gap-3">
                  <button onClick={cancelPreview} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50">
                    Annuler
                  </button>
                  <button
                    onClick={() => setRelanceConfirmed(true)}
                    className="px-6 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 flex items-center gap-2"
                  >
                    <Send size={15} /> Préparer l'envoi…
                  </button>
                </div>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-3">
                  <p className="text-sm font-semibold text-red-700">⚠️ Confirmer l'envoi vers <span className="underline">{previewData.clientEmail}</span> ?</p>
                  <p className="text-xs text-red-600">L'email sera envoyé immédiatement et ne pourra pas être annulé.</p>
                  <div className="flex items-center justify-between gap-3">
                    <button onClick={() => setRelanceConfirmed(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50">
                      ← Modifier
                    </button>
                    <button
                      onClick={async () => {
                        const ok = await confirmSend(relanceEdit.subject, relanceEdit.body)
                        if (ok) { setRelanceConfirmed(false); loadAll() }
                      }}
                      className="px-6 py-2 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700 flex items-center gap-2"
                    >
                      <Send size={15} /> OUI — Envoyer maintenant
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
            <h1 className="text-2xl font-bold text-gray-900">Devis</h1>
            <p className="text-sm text-gray-500 mt-1">{filteredQuotes.length} devis</p>
          </div>
          <button onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium">
            <Plus size={18} /> Nouveau devis
          </button>
        </div>
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Référence, client, ville, SIRET, objet..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500">
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
              <div key={i} className={`bg-white p-4 rounded-xl border border-${s.color}-100`}>
                <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                <p className={`text-xl font-bold text-${s.color}-600`}>
                  {s.status !== null ? count : money(ca)}
                </p>
              </div>
            )
          })}
        </div>
        {/* Bandeau relance devis > 7j */}
        {quotesRelance.length > 0 && (
          <div className="bg-orange-50 border-2 border-orange-300 rounded-xl px-4 py-3 mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-orange-800">⏰ {quotesRelance.length} devis envoyé{quotesRelance.length > 1 ? 's' : ''} sans réponse depuis plus de 7 jours</h3>
              <button onClick={() => setStatusFilter('sent')} className="text-xs text-orange-600 hover:text-orange-800 underline">Voir tous les envoyés</button>
            </div>
            <div className="space-y-1.5">
              {quotesRelance.slice(0, 5).map(q => (
                <div key={q.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-orange-200">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-mono text-gray-400">{q.reference}</span>
                    <span className="font-medium text-gray-900 text-sm truncate">{q.clients?.name || '?'}</span>
                    <span className="text-sm font-semibold text-gray-700">{money(q.total_ht)} HT</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${q.daysSinceSent >= 15 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                      {q.daysSinceSent}j
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); relanceQuote(q, { senderName: q.created_by || 'Hicham Saidi' }) }}
                      disabled={relanceGenerating === q.id}
                      className="text-xs px-3 py-1.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium flex items-center gap-1 disabled:opacity-60">
                      {relanceGenerating === q.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Relancer
                    </button>
                  </div>
                </div>
              ))}
              {quotesRelance.length > 5 && <p className="text-xs text-orange-500 text-center">+{quotesRelance.length - 5} autre(s)</p>}
            </div>
          </div>
        )}
        {loading ? (
          <div className="text-center py-12 text-gray-400">Chargement...</div>
        ) : filteredQuotes.length === 0 ? (
          <div className="text-center py-12">
            <FileText size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">{search || statusFilter ? 'Aucun résultat' : 'Aucun devis — Créez-en un !'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredQuotes.map(q => (
              <div key={q.id} onClick={() => openView(q)} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-sm font-mono text-gray-500">{q.reference}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CONFIG[q.status]?.class || 'bg-gray-100'}`}>
                        {STATUS_CONFIG[q.status]?.icon} {STATUS_CONFIG[q.status]?.label || q.status}
                      </span>
                      {(() => {
                        if (q.status !== 'sent' && q.status !== 'pending') return null
                        const sentDate = q.updated_at || q.quote_date || q.created_at
                        const days = sentDate ? Math.floor((Date.now() - new Date(sentDate).getTime()) / 86400000) : 0
                        if (days < 7) return null
                        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${days >= 15 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>⏰ {days}j sans réponse</span>
                      })()}
                    </div>
                    <h3 className="font-semibold text-gray-900">{q.clients?.name || 'Client inconnu'}</h3>
                    {q.object && <p className="text-sm text-gray-500 truncate mt-0.5">{q.object}</p>}
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                      <span>📅 {q.quote_date ? format(new Date(q.quote_date), 'dd MMM yyyy', { locale: fr }) : '-'}</span>
                      {q.validity_date && <span>⏳ Valide jusqu'au {format(new Date(q.validity_date), 'dd/MM/yyyy')}</span>}
                      <span>👤 {q.created_by}</span>
                    </div>
                  </div>
                  <div className="text-right ml-4 flex-shrink-0">
                    <p className="text-lg font-bold text-gray-900">{money(q.total_ttc)}</p>
                    <p className="text-xs text-gray-400">{money(q.total_ht)} HT</p>
                    <div className="relative mt-2 flex justify-end" ref={actionMenuId === q.id ? actionMenuRef : null}>
                      <button onClick={(e) => { e.stopPropagation(); setActionMenuId(actionMenuId === q.id ? null : q.id) }}
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors">
                        <MoreHorizontal size={18} />
                      </button>
                      {actionMenuId === q.id && (
                        <div className="absolute right-0 top-8 z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 w-52 animate-in fade-in" onClick={e => e.stopPropagation()}>
                          <button onClick={() => { setActionMenuId(null); downloadPDF(q) }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                            <Download size={15} /> Télécharger PDF
                          </button>
                          <button onClick={() => { setActionMenuId(null); openEdit(q) }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                            <Edit2 size={15} /> Modifier
                          </button>
                          <button onClick={() => { setActionMenuId(null); duplicateQuote(q) }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                            <Copy size={15} /> Dupliquer
                          </button>
                          {(q.status === 'draft' || q.status === 'sent') && (
                            <button onClick={() => { setActionMenuId(null); q.status === 'sent' ? relanceQuote(q, { senderName: q.created_by || 'Hicham Saidi' }) : openSendWizard(q) }}
                              disabled={relanceGenerating === q.id}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-green-700 hover:bg-green-50 disabled:opacity-60">
                              {relanceGenerating === q.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {q.status === 'sent' ? 'Relancer par email' : 'Envoyer par email'}
                            </button>
                          )}
                          {(q.status === 'draft' || q.status === 'sent') && (
                            <button onClick={() => { setActionMenuId(null); openView(q) }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-700 hover:bg-amber-50">
                              <span>⚡</span> Acceptation partielle
                            </button>
                          )}
                          <div className="border-t border-gray-100 my-1" />
                          {q.status === 'draft' && (
                            <button onClick={() => { setActionMenuId(null); updateStatus(q.id, 'sent') }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50">
                              <Send size={15} /> Marquer envoyé
                            </button>
                          )}
                          {(q.status === 'sent' || q.status === 'draft') && (
                            <button onClick={() => { setActionMenuId(null); updateStatus(q.id, 'accepted') }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-green-700 hover:bg-green-50">
                              <Check size={15} /> Marquer accepté
                            </button>
                          )}
                          {(q.status === 'sent' || q.status === 'draft') && (
                            <button onClick={() => { setActionMenuId(null); updateStatus(q.id, 'refused') }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-700 hover:bg-red-50">
                              <X size={15} /> Marquer refusé
                            </button>
                          )}
                          {q.status === 'accepted' && (
                            <button onClick={() => { setActionMenuId(null); if (confirm('Créer une facture depuis ce devis ?')) navigate('/factures?from_quote=' + q.id) }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-purple-700 hover:bg-purple-50">
                              <FileText size={15} /> Créer une facture
                            </button>
                          )}
                          {(q.status === 'accepted' || q.status === 'partial') && (
                            <button onClick={() => { setActionMenuId(null); openSessionWizard(q) }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50">
                              <GraduationCap size={15} /> Générer une session
                            </button>
                          )}
                          {q.status === 'sent' && (
                            <button onClick={() => { setActionMenuId(null); if (confirm('Créer une facture depuis ce devis ?')) navigate('/factures?from_quote=' + q.id) }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-purple-700 hover:bg-purple-50">
                              <FileText size={15} /> Créer une facture
                            </button>
                          )}
                          <div className="border-t border-gray-100 my-1" />
                          <button onClick={() => { setActionMenuId(null); deleteQuote(q.id) }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
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
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setMode('list')} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <ArrowLeft size={20} />
            </button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-gray-900">Devis {q.reference}</h1>
                <span className={`px-2.5 py-1 rounded text-xs font-medium ${st.class}`}>{st.icon} {st.label}</span>
              </div>
              <p className="text-sm text-gray-500">
                {q.quote_date && format(new Date(q.quote_date), 'dd MMMM yyyy', { locale: fr })}
                {q.created_by && ` · par ${q.created_by}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => downloadPDF(q)} disabled={generatingPdf}
              className="flex items-center gap-1.5 px-3 py-2 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg hover:bg-orange-100 text-sm disabled:opacity-50">
              <Download size={15} /> PDF
            </button>
            {(q.status === 'partial' || (q.status === 'accepted' && items.some(it => it.accepted === true))) && (
              <button onClick={downloadPartialPDF} disabled={generatingPartialPdf}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100 text-sm disabled:opacity-50">
                <Download size={15} /> PDF partiel
              </button>
            )}
            <button onClick={() => openEdit(q)}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">
              <Edit2 size={15} /> Modifier
            </button>
            <div className="relative" ref={actionMenuId === 'view' ? actionMenuRef : null}>
              <button onClick={() => setActionMenuId(actionMenuId === 'view' ? null : 'view')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <MoreHorizontal size={20} />
              </button>
              {actionMenuId === 'view' && (
                <div className="absolute right-0 top-10 z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 w-52">
                  <button onClick={() => { setActionMenuId(null); duplicateQuote(q) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    <Copy size={15} /> Dupliquer
                  </button>
                  {(q.status === 'draft' || q.status === 'sent') && (
                    <button onClick={() => { setActionMenuId(null); q.status === 'sent' ? relanceQuote(q, { senderName: q.created_by || 'Hicham Saidi' }) : openSendWizard(q) }}
                      disabled={relanceGenerating === q.id}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-green-700 hover:bg-green-50 disabled:opacity-60">
                      {relanceGenerating === q.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {q.status === 'sent' ? 'Relancer' : 'Envoyer'} par email
                    </button>
                  )}
                  {(q.status === 'draft' || q.status === 'sent') && (
                    <button onClick={() => setActionMenuId(null)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-700 hover:bg-amber-50">
                      <span>⚡</span> Acceptation partielle
                    </button>
                  )}
                  <div className="border-t border-gray-100 my-1" />
                  {q.status === 'draft' && (
                    <button onClick={() => { setActionMenuId(null); updateStatus(q.id, 'sent') }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50">
                      <Send size={15} /> Marquer envoyé
                    </button>
                  )}
                  {(q.status === 'sent' || q.status === 'draft') && (
                    <button onClick={() => { setActionMenuId(null); updateStatus(q.id, 'accepted') }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-green-700 hover:bg-green-50">
                      <Check size={15} /> Marquer accepté
                    </button>
                  )}
                  {(q.status === 'sent' || q.status === 'draft') && (
                    <button onClick={() => { setActionMenuId(null); updateStatus(q.id, 'refused') }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-700 hover:bg-red-50">
                      <X size={15} /> Marquer refusé
                    </button>
                  )}
                  {q.status === 'accepted' && (
                    <button onClick={() => { setActionMenuId(null); if (confirm('Créer une facture depuis ce devis ?')) navigate('/factures?from_quote=' + q.id) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-purple-700 hover:bg-purple-50">
                      <FileText size={15} /> Créer une facture
                    </button>
                  )}
                  {(q.status === 'accepted' || q.status === 'partial') && (
                    <button onClick={() => { setActionMenuId(null); openSessionWizard(q) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50">
                      <GraduationCap size={15} /> Générer une session
                    </button>
                  )}
                  {q.status === 'sent' && (
                    <button onClick={() => { setActionMenuId(null); if (confirm('Créer une facture depuis ce devis ?')) navigate('/factures?from_quote=' + q.id) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-purple-700 hover:bg-purple-50">
                      <FileText size={15} /> Créer une facture
                    </button>
                  )}
                  <div className="border-t border-gray-100 my-1" />
                  <button onClick={() => { setActionMenuId(null); deleteQuote(q.id); setMode('list') }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
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
              <div className="bg-white rounded-xl border p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Objet</p>
                <p className="text-gray-900">{q.object}</p>
              </div>
            )}

            {/* Lignes */}
            <div className="bg-white rounded-xl border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
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
                        <p className="font-medium text-gray-900 text-sm">{item.description_title}</p>
                        {item.description_detail && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-line">{item.description_detail}</p>}
                      </td>
                      <td className="text-center px-2 py-3 text-sm">{item.quantity}</td>
                      <td className="text-center px-2 py-3 text-xs text-gray-500">{item.unit || '-'}</td>
                      <td className="text-right px-2 py-3 text-sm">{money(item.unit_price_ht)}</td>
                      <td className="text-right px-4 py-3 text-sm font-medium">{money((item.quantity || 0) * (item.unit_price_ht || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Panneau validation client ligne par ligne */}
            {(currentQuote.status === 'sent' || currentQuote.status === 'partial' || currentQuote.status === 'accepted') && items.length > 0 && (
              <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
                <div className="bg-amber-50 px-4 py-3 border-b border-amber-200">
                  <h3 className="font-semibold text-amber-900 flex items-center gap-2">⚡ Validation client ligne par ligne</h3>
                  <p className="text-xs text-amber-700 mt-0.5">Enregistrez les décisions du client pour chaque ligne du devis</p>
                </div>
                <div className="divide-y divide-amber-100">
                  {items.map(item => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.description_title}</p>
                        <p className="text-xs text-gray-400">{money((item.quantity || 0) * (item.unit_price_ht || 0))}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => toggleItemAccepted(item.id, item.accepted === true ? null : true)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${item.accepted === true ? 'bg-green-600 text-white border-green-600' : 'bg-white text-green-700 border-green-300 hover:bg-green-50'}`}>
                          ✅ Accepté
                        </button>
                        <button onClick={() => toggleItemAccepted(item.id, item.accepted === false ? null : false)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${item.accepted === false ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-700 border-red-300 hover:bg-red-50'}`}>
                          ❌ Refusé
                        </button>
                        <button onClick={() => toggleItemAccepted(item.id, null)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${(item.accepted === null || item.accepted === undefined) ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-amber-700 border-amber-300 hover:bg-amber-50'}`}>
                          ⏳ En attente
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {items.some(it => it.accepted === true) && (
                  <div className="px-4 py-3 bg-amber-50 border-t border-amber-200 flex items-center gap-3 flex-wrap">
                    <button onClick={downloadPartialPDF} disabled={generatingPartialPdf}
                      className="flex items-center gap-2 px-3 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50">
                      <Download size={14} /> Bon de commande partiel (PDF)
                    </button>
                    {items.some(it => it.accepted === true && it.course_id) && (
                      <button onClick={() => openSessionWizard(currentQuote)}
                        className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700">
                        <GraduationCap size={14} /> Générer session(s)
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Totaux */}
            <div className="bg-white rounded-xl border p-4">
              <div className="flex justify-end">
                <div className="w-64 space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Total HT</span><span className="font-medium">{money(totals.totalHt)}</span></div>
                  {currentQuote.discount_percent > 0 && (
                    <div className="flex justify-between text-red-600"><span>Remise {currentQuote.discount_percent}%{currentQuote.discount_label ? ` (${currentQuote.discount_label})` : ''}</span><span>-{money(totals.discountAmount)}</span></div>
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
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><Building2 size={15} /> Client</h3>
              <p className="font-medium text-gray-900">{q.clients?.name || '—'}</p>
              {q.clients?.address && <p className="text-sm text-gray-500">{q.clients.address}</p>}
              {q.clients?.siret && <p className="text-xs text-gray-400 font-mono">SIRET {q.clients.siret}</p>}
            </div>
            <div className="bg-white rounded-xl border p-4 space-y-2">
              <h3 className="font-semibold text-gray-900 text-sm">Détails</h3>
              <div className="text-sm space-y-1.5">
                {q.client_reference && <div className="flex justify-between"><span className="text-gray-500">Réf. client</span><span>{q.client_reference}</span></div>}
                <div className="flex justify-between"><span className="text-gray-500">Paiement</span><span className="text-right text-xs">{q.payment_method || '—'}</span></div>
                {q.validity_date && <div className="flex justify-between"><span className="text-gray-500">Validité</span><span>{format(new Date(q.validity_date), 'dd/MM/yyyy')}</span></div>}
                {q.payment_deadline && <div className="flex justify-between"><span className="text-gray-500">Échéance</span><span>{format(new Date(q.payment_deadline), 'dd/MM/yyyy')}</span></div>}
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
            <button onClick={() => setMode('list')} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {mode === 'create' ? 'Nouveau devis' : `Devis ${currentQuote.reference}`}
              </h1>
              <p className="text-sm text-gray-500">
                {mode === 'create' ? currentQuote.reference : `Créé le ${currentQuote.created_at ? format(new Date(currentQuote.created_at), 'dd/MM/yyyy', { locale: fr }) : ''}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'edit' && (
              <>
                <select value={currentQuote.status}
                  onChange={(e) => setCurrentQuote(prev => ({ ...prev, status: e.target.value }))}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.icon} {v.label}</option>
                  ))}
                </select>
                <button onClick={downloadCurrentPDF} disabled={generatingPdf}
                  className="flex items-center gap-1.5 px-3 py-2 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors text-sm disabled:opacity-50">
                  <Download size={15} /> {generatingPdf ? 'Génération...' : 'PDF'}
                </button>
              </>
            )}
            <button onClick={() => setMode('list')}
              className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Annuler</button>
            <button onClick={saveQuote} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50">
              <Save size={16} /> {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-6">
            {/* Client + Contact */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Building2 size={18} /> Client</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client *</label>
                  <div className="relative" ref={clientComboRef}>
                    <div className="relative">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="text"
                        value={clientSearchTerm}
                        onChange={(e) => {
                          setClientSearchTerm(e.target.value)
                          setShowClientDropdown(true)
                          if (currentQuote.client_id) {
                            // User is re-typing → clear selection
                            const match = clients.find(c => c.id === currentQuote.client_id)
                            if (match && e.target.value !== match.name) {
                              setCurrentQuote(prev => ({ ...prev, client_id: '', contact_id: '' }))
                              setContacts([])
                            }
                          }
                        }}
                        onFocus={() => setShowClientDropdown(true)}
                        placeholder="Rechercher un client..."
                        className={`w-full pl-9 pr-9 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 text-sm ${
                          currentQuote.client_id ? 'border-green-300 bg-green-50/30' : 'border-gray-200'
                        }`}
                      />
                      {currentQuote.client_id && (
                        <button onClick={clearClientSelection}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-red-500 transition-colors">
                          <X size={16} />
                        </button>
                      )}
                    </div>
                    {showClientDropdown && (
                      <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl max-h-72 overflow-y-auto">
                        {!clientSearchTerm.trim() && (
                          <div className="px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-50 border-b">
                            Clients récents
                          </div>
                        )}
                        {clientComboResults.length === 0 ? (
                          <div className="px-4 py-6 text-center text-sm text-gray-400">
                            Aucun client trouvé pour "{clientSearchTerm}"
                          </div>
                        ) : (
                          clientComboResults.map(c => (
                            <button key={c.id}
                              onClick={() => selectClient(c)}
                              className={`w-full text-left px-3 py-2.5 hover:bg-primary-50 transition-colors border-b border-gray-50 last:border-0 ${
                                currentQuote.client_id === c.id ? 'bg-primary-50' : ''
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-gray-900 text-sm">{c.name}</span>
                                {c.city && (
                                  <span className="text-xs text-gray-400 ml-2 flex-shrink-0">{c.postal_code?.slice(0,2)} {c.city}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-0.5">
                                {c.contact_name && (
                                  <span className="text-xs text-gray-500">👤 {c.contact_name}</span>
                                )}
                                {c.siret && (
                                  <span className="text-xs text-gray-400 font-mono">{c.siret}</span>
                                )}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
                  <select value={currentQuote.contact_id || ''}
                    onChange={(e) => setCurrentQuote(prev => ({ ...prev, contact_id: e.target.value || null }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500">
                    <option value="">— Aucun —</option>
                    {contacts.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.civilite ? c.civilite + ' ' : ''}{c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim()} {c.role ? `(${c.role})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {selectedClient && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
                  {selectedClient.address && <p>{selectedClient.address}</p>}
                  {(selectedClient.postal_code || selectedClient.city) && <p>{selectedClient.postal_code} {selectedClient.city}</p>}
                  {selectedClient.siret && <p className="text-xs text-gray-400 mt-1">SIRET : {selectedClient.siret}</p>}
                </div>
              )}
            </div>

            {/* Objet + Réf */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Objet du devis</label>
                  <input type="text" value={currentQuote.object}
                    onChange={(e) => setCurrentQuote(prev => ({ ...prev, object: e.target.value }))}
                    placeholder="Ex : Formation SST en intra"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Réf. client</label>
                  <input type="text" value={currentQuote.client_reference}
                    onChange={(e) => setCurrentQuote(prev => ({ ...prev, client_reference: e.target.value }))}
                    placeholder="Optionnel"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Access Formation</label>
                  <select value={currentQuote.created_by}
                    onChange={(e) => setCurrentQuote(prev => ({ ...prev, created_by: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500">
                    {Object.entries(CONTACTS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
            </div>


            {/* Dates + Conditions + TVA — inline compact */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date devis</label>
                  <input type="date" value={currentQuote.quote_date} onChange={(e) => handleDateChange(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Validité</label>
                  <input type="date" value={currentQuote.validity_date}
                    onChange={(e) => setCurrentQuote(prev => ({ ...prev, validity_date: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Moyen de règlement</label>
                  <select value={currentQuote.payment_method}
                    onChange={(e) => setCurrentQuote(prev => ({ ...prev, payment_method: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm">
                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Délai règlement</label>
                  <select value={currentQuote.payment_terms}
                    onChange={(e) => setCurrentQuote(prev => ({ ...prev, payment_terms: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm">
                    {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">TVA</label>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={currentQuote.tva_applicable}
                      onChange={(e) => setCurrentQuote(prev => ({ ...prev, tva_applicable: e.target.checked }))}
                      className="rounded" id="tva-check" />
                    {currentQuote.tva_applicable && (
                      <input type="text" inputMode="decimal" value={currentQuote.tva_rate}
                        onChange={(e) => setCurrentQuote(prev => ({ ...prev, tva_rate: e.target.value }))}
                        className="w-16 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center" />
                    )}
                    {currentQuote.tva_applicable && <span className="text-xs text-gray-400">%</span>}
                    {!currentQuote.tva_applicable && <span className="text-xs text-gray-400">Non applicable</span>}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Remise</label>
                  <div className="flex items-center gap-1">
                    <input type="text" inputMode="decimal" value={currentQuote.discount_percent}
                      onChange={(e) => setCurrentQuote(prev => ({ ...prev, discount_percent: e.target.value }))}
                      className="w-16 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center" />
                    <span className="text-xs text-gray-400">%</span>
                    {parseFloat(currentQuote.discount_percent) > 0 && (
                      <input type="text" value={currentQuote.discount_label}
                        onChange={(e) => setCurrentQuote(prev => ({ ...prev, discount_label: e.target.value }))}
                        placeholder="Libellé"
                        className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Line items — compact */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Lignes du devis</h2>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="border border-gray-100 rounded-lg p-3 bg-gray-50">
                    {/* Row 1: Code + Title + Description inline */}
                    <div className="flex items-start gap-2 mb-2">
                      <input type="text" value={item.code} onChange={(e) => updateItem(idx, 'code', e.target.value)}
                        placeholder="Code" className="w-24 px-2 py-1.5 border border-gray-200 rounded text-xs font-mono flex-shrink-0" />
                      <input type="text" value={item.description_title} onChange={(e) => updateItem(idx, 'description_title', e.target.value)}
                        placeholder="Titre de la ligne *"
                        className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-sm font-medium" />
                      <button onClick={() => removeItem(idx)}
                        className="p-1.5 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"><Trash2 size={14} /></button>
                    </div>
                    {/* Row 2: Description (collapsible — shown if has content or on focus) */}
                    <input type="text" value={item.description_detail} onChange={(e) => updateItem(idx, 'description_detail', e.target.value)}
                      placeholder="Description détaillée (optionnel)"
                      className="w-full px-2 py-1 border border-gray-200 rounded text-xs text-gray-600 mb-2" />
                    {/* Row 3: Qté + Unité + PU HT + TVA% + Total = tout sur une ligne */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <label className="text-[10px] text-gray-400 whitespace-nowrap">Qté</label>
                        <input type="text" inputMode="decimal" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                          className="w-14 px-2 py-1 border border-gray-200 rounded text-sm text-center" />
                      </div>
                      <div className="flex items-center gap-1">
                        <label className="text-[10px] text-gray-400">Unité</label>
                        <input type="text" value={item.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)}
                          className="w-16 px-2 py-1 border border-gray-200 rounded text-sm" />
                      </div>
                      <div className="flex items-center gap-1">
                        <label className="text-[10px] text-gray-400">PU HT</label>
                        <input type="text" inputMode="decimal" value={item.unit_price_ht} onChange={(e) => updateItem(idx, 'unit_price_ht', e.target.value)}
                          className="w-20 px-2 py-1 border border-gray-200 rounded text-sm text-right" />
                      </div>
                      <div className="flex items-center gap-1">
                        <label className="text-[10px] text-gray-400">TVA%</label>
                        <input type="text" inputMode="decimal" value={item.tva_rate} onChange={(e) => updateItem(idx, 'tva_rate', e.target.value)}
                          className="w-14 px-2 py-1 border border-gray-200 rounded text-sm text-center" />
                      </div>
                      <div className="ml-auto text-right">
                        <span className="text-sm font-semibold text-gray-900">{money(calcItemTotal(item))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Add buttons — always at bottom after lines */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                <div className="relative group">
                  <button className="text-sm px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1">
                    <Plus size={14} /> Depuis formation
                  </button>
                  <div className="absolute left-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 hidden group-hover:block max-h-64 overflow-y-auto">
                    {courses.map(c => (
                      <button key={c.id} onClick={() => addFromCourse(c)}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-100 last:border-0">
                        <p className="text-sm font-medium text-gray-800">{c.title}</p>
                        <p className="text-xs text-gray-400">{c.code} · {c.price_ht ? money(c.price_ht) : 'Prix à définir'}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative group">
                  <button className="text-sm px-3 py-1.5 bg-orange-50 text-orange-600 rounded-lg hover:bg-orange-100 transition-colors flex items-center gap-1">
                    <Plus size={14} /> Matériel
                  </button>
                  <div className="absolute left-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 hidden group-hover:block">
                    {predefinedMaterials.map((mat, i) => (
                      <button key={i} onClick={() => addFromMaterial(mat)}
                        className="w-full text-left px-4 py-2.5 hover:bg-orange-50 border-b border-gray-100 last:border-0">
                        <p className="text-sm font-medium text-gray-800">{mat.description_title}</p>
                        <p className="text-xs text-gray-400">{mat.code} · {mat.description_detail} · {money(mat.unit_price_ht)}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={addItem}
                  className="text-sm px-3 py-1.5 bg-primary-50 text-primary-600 rounded-lg hover:bg-primary-100 transition-colors flex items-center gap-1">
                  <Plus size={14} /> Ligne libre
                </button>
              </div>
              {/* Totals */}
              <div className="mt-4 pt-4 border-t border-gray-200 flex justify-end">
                <div className="w-72 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total HT</span>
                    <span className="font-medium">{money(totals.subtotalHt)}</span>
                  </div>
                  {parseFloat(currentQuote.discount_percent) > 0 && (
                    <>
                      <div className="flex justify-between text-orange-600">
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
                    <div className="text-xs text-gray-400 italic">TVA non applicable (art. 261 CGI)</div>
                  )}
                  <div className="flex justify-between text-base font-bold border-t pt-2 text-primary-700">
                    <span>Total TTC</span><span>{money(totals.totalTtc)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Notes + Signature — side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                <textarea value={currentQuote.notes}
                  onChange={(e) => setCurrentQuote(prev => ({ ...prev, notes: e.target.value }))}
                  rows={3} placeholder="Notes visibles sur le devis (ex: 5% remise BNI)"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h2 className="font-semibold text-gray-900 mb-2 flex items-center gap-2"><Pen size={16} /> Signature client</h2>
                <p className="text-xs text-gray-400 mb-2">
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
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col mx-4">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                <Mail className="inline w-5 h-5 mr-2 text-primary-600" />
                Envoyer le devis {quote.reference}
              </h2>
              <p className="text-sm text-gray-500">{client?.name}</p>
            </div>
            <button onClick={closeSendWizard} className="p-2 hover:bg-gray-100 rounded-lg">
              <X size={20} />
            </button>
          </div>

          {/* Steps indicator */}
          <div className="flex items-center justify-center gap-2 px-6 py-3 bg-gray-50 border-b">
            {steps.map((s, i) => (
              <div key={s.num} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  sendStep === s.num ? 'bg-primary-600 text-white' : 
                  sendStep > s.num ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  {sendStep > s.num ? <Check size={16} /> : s.num}
                </div>
                <span className={`text-sm ${sendStep === s.num ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
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
                <p className="text-sm text-gray-600 mb-3">Vérifiez le devis avant envoi :</p>
                <iframe
                  src={pdfBlobUrl}
                  className="w-full rounded-lg border border-gray-200"
                  style={{ height: '40vh' }}
                  title="Aperçu du devis"
                />

                {/* ─── Pièces jointes ─────────────────── */}
                <div className="mt-4 bg-gray-50 rounded-xl p-4 border">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                      <Paperclip size={16} /> Pièces jointes
                    </h3>
                    <label className="px-3 py-1.5 bg-primary-50 text-primary-700 border border-primary-200 rounded-lg text-xs font-medium cursor-pointer hover:bg-primary-100 transition-colors">
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
                  <div className="flex items-center gap-3 py-2 px-3 bg-white rounded-lg border border-gray-200 mb-2">
                    <FileText size={16} className="text-orange-500 flex-shrink-0" />
                    <span className="text-sm font-medium text-gray-800 flex-1">{quote.reference}.pdf</span>
                    <span className="text-xs text-gray-400">Devis</span>
                    <Check size={14} className="text-green-500" />
                  </div>

                  {/* Programmes auto-détectés + manuels */}
                  {sendAttachments.map((att, idx) => (
                    <div key={idx} className={`flex items-center gap-3 py-2 px-3 rounded-lg border mb-2 ${
                      att.enabled ? 'bg-white border-gray-200' : 'bg-gray-100 border-gray-200 opacity-60'
                    }`}>
                      <FileText size={16} className={att.type === 'program' ? 'text-blue-500 flex-shrink-0' : 'text-purple-500 flex-shrink-0'} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{att.filename}</p>
                        {att.courseTitle && <p className="text-xs text-gray-400 truncate">{att.courseTitle}</p>}
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {att.type === 'program' ? 'Programme' : 'Manuel'}
                      </span>
                      <button
                        onClick={() => setSendAttachments(prev => prev.map((a, i) => i === idx ? { ...a, enabled: !a.enabled } : a))}
                        className={`w-7 h-7 flex items-center justify-center rounded-md border transition-colors ${
                          att.enabled ? 'bg-green-50 border-green-300 text-green-600' : 'bg-gray-100 border-gray-300 text-gray-400'
                        }`}
                        title={att.enabled ? 'Désactiver' : 'Activer'}
                      >
                        {att.enabled ? <Check size={14} /> : <X size={14} />}
                      </button>
                      {att.type === 'manual' && (
                        <button
                          onClick={() => setSendAttachments(prev => prev.filter((_, i) => i !== idx))}
                          className="w-7 h-7 flex items-center justify-center rounded-md text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}

                  {sendAttachments.length === 0 && (
                    <p className="text-xs text-gray-400 mt-1">Aucun programme détecté. Ajoutez des fichiers manuellement si besoin.</p>
                  )}
                </div>
              </div>
            )}

            {/* STEP 2: Texte email IA */}
            {sendStep === 2 && (
              <div className="space-y-4">
                {/* Destinataire */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Destinataire</label>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={sendEmail.to}
                      onChange={(e) => setSendEmail(prev => ({ ...prev, to: e.target.value }))}
                      placeholder="email@entreprise.fr"
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    />
                    {clientContacts && clientContacts.length > 0 && (
                      <select
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) setSendEmail(prev => ({ ...prev, to: e.target.value }))
                        }}
                      >
                        <option value="">Contacts...</option>
                        {clientContacts.filter(c => c.email).map(c => (
                          <option key={c.id} value={c.email}>
                            {c.first_name || ''} {c.last_name || c.name || ''} — {c.email}
                          </option>
                        ))}
                        {client?.contact_email && (
                          <option value={client.contact_email}>Contact principal — {client.contact_email}</option>
                        )}
                      </select>
                    )}
                  </div>
                </div>

                {/* Objet */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Objet</label>
                  <input
                    type="text"
                    value={sendEmail.subject}
                    onChange={(e) => setSendEmail(prev => ({ ...prev, subject: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                </div>

                {/* Corps */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Corps du message</label>
                  <textarea
                    value={sendEmail.body}
                    onChange={(e) => setSendEmail(prev => ({ ...prev, body: e.target.value }))}
                    rows={10}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-sans"
                  />
                </div>

                {/* Régénérer avec instructions */}
                <div className="bg-blue-50 rounded-lg p-3">
                  <label className="block text-xs font-medium text-blue-700 mb-1">
                    Instructions pour régénérer (optionnel)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={sendEmail.customInstructions}
                      onChange={(e) => setSendEmail(prev => ({ ...prev, customInstructions: e.target.value }))}
                      placeholder="Ex: ton plus formel, mentionner une date limite..."
                      className="flex-1 px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white"
                    />
                    <button
                      onClick={generateEmailText}
                      disabled={sendLoading}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                    >
                      {sendLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      {sendEmail.body ? 'Régénérer' : 'Générer'}
                    </button>
                  </div>
                </div>

                <p className="text-xs text-gray-400">
                  La signature sera ajoutée automatiquement selon votre compte email.
                  BCC : contact@accessformation.pro
                </p>
              </div>
            )}

            {/* STEP 3: Récap & envoi */}
            {sendStep === 3 && (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-xl p-5 space-y-3">
                  <h3 className="font-semibold text-green-900">Récapitulatif</h3>
                  <div className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
                    <span className="text-gray-500">De :</span>
                    <span className="font-medium">{quote.created_by} (Access Formation)</span>
                    <span className="text-gray-500">À :</span>
                    <span className="font-medium">{sendEmail.to}</span>
                    <span className="text-gray-500">BCC :</span>
                    <span className="text-gray-400">contact@accessformation.pro</span>
                    <span className="text-gray-500">Objet :</span>
                    <span className="font-medium">{sendEmail.subject}</span>
                    <span className="text-gray-500">Pièces jointes :</span>
                    <div className="space-y-1">
                      <span className="flex items-center gap-1 text-orange-600">
                        <FileText size={14} /> {quote.reference}.pdf
                      </span>
                      {sendAttachments.filter(a => a.enabled).map((att, i) => (
                        <span key={i} className="flex items-center gap-1 text-blue-600">
                          <FileText size={14} /> {att.filename}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-5">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Aperçu du message :</h4>
                  <div className="text-sm text-gray-600 whitespace-pre-wrap bg-white rounded-lg border p-4">
                    {sendEmail.body}
                  </div>
                  <p className="text-xs text-gray-400 mt-2 italic">+ signature automatique</p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
            <button
              onClick={() => sendStep > 1 ? setSendStep(sendStep - 1) : closeSendWizard()}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {sendStep === 1 ? 'Annuler' : '← Retour'}
            </button>
            <div className="flex gap-2">
              {sendStep === 1 && (
                <button
                  onClick={() => { setSendStep(2); if (!sendEmail.body) generateEmailText() }}
                  className="px-6 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors flex items-center gap-2"
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
                  className="px-6 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors flex items-center gap-2"
                >
                  Continuer <ChevronDown size={14} className="-rotate-90" />
                </button>
              )}
              {sendStep === 3 && (
                <button
                  onClick={handleSendQuoteEmail}
                  disabled={sendSending}
                  className="px-6 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-2"
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
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b bg-gradient-to-r from-emerald-50 to-green-50 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <GraduationCap size={22} className="text-emerald-600" />
                Générer des sessions
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Devis {quote.reference} — {client.name}
              </p>
            </div>
            <button onClick={() => setSessionWizard(null)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
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
                  className={`border rounded-xl transition-all ${sel.selected ? 'border-emerald-300 bg-emerald-50/30 shadow-sm' : 'border-gray-200 bg-gray-50/50 opacity-60'}`}
                >
                  {/* Formation header + checkbox */}
                  <div className="px-4 py-3 flex items-center gap-3 cursor-pointer"
                    onClick={() => updateSessionSelection(idx, 'selected', !sel.selected)}>
                    <input type="checkbox" checked={sel.selected} readOnly
                      className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900">{course.title}</p>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                        <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{course.code}</span>
                        {course.duration_days && <span>{course.duration_days}j ({course.duration_hours}h)</span>}
                        <span className="flex items-center gap-1"><Users size={12} /> {sel.nbParticipants} stagiaire{sel.nbParticipants > 1 ? 's' : ''}</span>
                        <span className="font-medium text-emerald-700">{money(sel.totalPriceHt)} HT</span>
                      </div>
                    </div>
                  </div>

                  {/* Configuration (visible si sélectionné) */}
                  {sel.selected && (
                    <div className="px-4 pb-4 pt-1 border-t border-emerald-200/50">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
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
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Date fin *</label>
                          <input type="date" value={sel.endDate}
                            onChange={(e) => updateSessionSelection(idx, 'endDate', e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Créneau</label>
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { key: 'matin',    label: '🌅 Matin',      start: '08:00', end: '12:00' },
                              { key: 'aprem',    label: '🌇 Après-midi', start: '13:00', end: '17:00' },
                              { key: 'soiree',   label: '🌆 Soirée',     start: '18:00', end: '22:00' },
                              { key: 'nuit',     label: '🌙 Nuit',       start: '21:00', end: '05:00' },
                              { key: 'journee',  label: '☀️ Journée',    start: '09:00', end: '17:00' },
                              { key: 'perso',    label: '✏️ Perso',      start: null,    end: null    },
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
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                                  sel.preset === p.key
                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                    : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-400'
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
                                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500" />
                              </div>
                              <span className="self-center text-gray-400 text-sm">→</span>
                              <div className="flex-1">
                                <input type="time" value={sel.endTime}
                                  onChange={(e) => updateSessionSelection(idx, 'endTime', e.target.value)}
                                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500" />
                              </div>
                            </div>
                          )}
                          {sel.preset !== 'perso' && (
                            <p className="text-[11px] text-gray-400 mt-1">{sel.startTime} → {sel.endTime}</p>
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
                              <div className={`mt-1.5 px-2 py-1 rounded text-xs font-medium flex items-center gap-1.5 ${isDemi ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                <span>{isDemi ? '🌗' : '☀️'}</span>
                                <span>{nbJours === 1 ? '1 jour' : `${nbJours} jours`} — {hTotal}h au total ({hParJour}h/jour)</span>
                              </div>
                            )
                          })()}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Formateur</label>
                          <select value={sel.trainerId}
                            onChange={(e) => updateSessionSelection(idx, 'trainerId', e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500">
                            <option value="">— Choisir —</option>
                            {(storeTrainers || []).map(t => (
                              <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            <Users size={12} className="inline mr-1" />Stagiaires
                          </label>
                          <input type="number" min="1" max="20" value={sel.nbParticipants}
                            onChange={(e) => updateSessionSelection(idx, 'nbParticipants', parseInt(e.target.value) || 1)}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            <MapPin size={12} className="inline mr-1" />Lieu de formation
                          </label>
                          <input type="text" value={sel.location}
                            onChange={(e) => updateSessionSelection(idx, 'location', e.target.value)}
                            placeholder="Adresse complète du lieu..."
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500" />
                          <label className="flex items-center gap-1.5 mt-1 cursor-pointer">
                            <input type="checkbox" checked={sel.isIntra !== false}
                              onChange={(e) => updateSessionSelection(idx, 'isIntra', e.target.checked)}
                              className="w-3 h-3 rounded text-emerald-600" />
                            <span className="text-[11px] text-gray-500">Formation intra (chez le client)</span>
                          </label>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Prix HT session</label>
                          <input type="number" step="0.01" value={sel.totalPriceHt}
                            onChange={(e) => updateSessionSelection(idx, 'totalPriceHt', parseFloat(e.target.value) || 0)}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500" />
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
              className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm transition-colors">
              Annuler
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">
                {selectedCount} formation{selectedCount > 1 ? 's' : ''} sélectionnée{selectedCount > 1 ? 's' : ''}
              </span>
              <button onClick={handleCreateSessions} disabled={sessionCreating || selectedCount === 0}
                className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-2">
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

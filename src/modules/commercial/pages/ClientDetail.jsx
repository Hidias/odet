import { toneStyle } from '../../../ui/StatusBadge'
import { currentUserFirstName, teamFirstNames } from '../../../core/org/currentOrg'
import { apiFetch } from '../../../core/api'
import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'
import { ArrowLeft, Building2, MapPin, Phone, Mail, Globe, Edit, Save, X, Plus, Trash2, User, Clock, MessageSquare, Calendar, FileText, GraduationCap, Star, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Send, StickyNote, Receipt, RefreshCw, Briefcase, FileSignature, Smartphone, Loader2, Search, CreditCard, Paperclip, KeyRound, Copy, Power } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import SpeechToTextButton from '../../../ui/SpeechToTextButton'
import { useAuthStore } from '../../../core/store'
import { authorFromEmail } from '../../prospection/components/suivi/suiviUtils'
import { canExportVCard, buildVCard, buildVCards, clientAsContact, vcfFilename, downloadVCard } from '../lib/vcard'
import { publicBaseUrl } from '../../../core/org/orgUtils'
import { tvaFromSiren, pappersUrl } from '../../../core/org/tva'
import { useDroits } from '../../../core/rights/useDroit'

// ═══════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════
const STATUS_OPTIONS = [
  { value: 'prospect', label: 'Prospect', color: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' },
  { value: 'en_discussion', label: 'En discussion', color: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]' },
  { value: 'actif', label: 'Actif', color: 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' },
  { value: 'a_completer', label: 'À compléter', color: 'bg-gray-100 text-gray-800' },
  { value: 'inactif', label: 'Inactif', color: 'bg-gray-100 text-gray-500' },
]

const INTERACTION_TYPES = [
  { value: 'call', label: 'Appel', icon: Phone, color: 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' },
  { value: 'email', label: 'Email', icon: Mail, color: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]' },
  { value: 'sms', label: 'SMS', icon: Smartphone, color: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]' },
  { value: 'meeting', label: 'Réunion', icon: Calendar, color: 'bg-gray-100 text-gray-800' },
  { value: 'note', label: 'Note interne', icon: StickyNote, color: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' },
  { value: 'devis', label: 'Devis', icon: FileText, color: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]' },
  { value: 'facture', label: 'Facture', icon: Receipt, color: 'bg-gray-100 text-gray-800' },
  { value: 'relance', label: 'Relance', icon: RefreshCw, color: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' },
]


const OPCO_LIST = [
  'AFDAS', 'AKTO', 'ATLAS', 'Constructys', "L'Opcommerce",
  'OCAPIAT', 'OPCO 2i', 'OPCO EP', 'OPCO Mobilités', 'OPCO Santé', 'Uniformation'
]

// ═══════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ═══════════════════════════════════════════════════════════
export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [client, setClient] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [detectingOpco, setDetectingOpco] = useState(false)
  const { user, userRole } = useAuthStore()
  const vcardAllowed = canExportVCard(userRole)
  // Gardes des boutons d'écriture (la base refuse de toute façon ce qui n'est pas permis)
  const d = useDroits({
    modifier: 'clients.fiches.modifier',
    supprimer: 'clients.fiches.supprimer',
    historique: 'clients.historique.ecrire',
    espace: 'clients.espace.gerer',
    prospection: 'commercial.prospection.gerer',
    devis: 'commercial.devis.modifier',
    session: 'formation.sessions.creer',
  })

  function exportContactVCard(contact) {
    if (!vcardAllowed) return
    downloadVCard(buildVCard(contact, client), vcfFilename(`${contact.name || 'contact'}_${client?.name || ''}`))
  }

  function exportAllContactsVCard() {
    if (!vcardAllowed) return
    const entries = contacts.map(contact => ({ contact, client }))
    if (entries.length === 0) {
      const generic = clientAsContact(client)
      if (generic) entries.push({ contact: generic, client })
    }
    if (entries.length === 0) { toast.error('Aucun contact à exporter'); return }
    downloadVCard(buildVCards(entries), vcfFilename(`contacts_${client?.name || 'client'}`))
    toast.success(`${entries.length} contact${entries.length > 1 ? 's' : ''} exporté${entries.length > 1 ? 's' : ''}`)
  }

  // Navigation entre clients (A→Z)
  const [allClientIds, setAllClientIds] = useState([])


  // Contacts
  const [contacts, setContacts] = useState([])
  const [showContactForm, setShowContactForm] = useState(false)
  const [editingContact, setEditingContact] = useState(null)
  const [contactForm, setContactForm] = useState({ name: '', role: '', email: '', phone: '', is_primary: false, is_document_contact: false, is_billing: false })

  // Timeline
  const [interactions, setInteractions] = useState([])
  const [phoningCalls, setPhoningCalls] = useState([])
  const [emailLogs, setEmailLogs] = useState([])
  const [showInteractionForm, setShowInteractionForm] = useState(false)
  const [interactionForm, setInteractionForm] = useState({ type: 'call', title: '', content: '', author: currentUserFirstName() })

  // Email direct
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [emailForm, setEmailForm] = useState({ to: '', subject: '', body: '', brief: '', sender: currentUserFirstName() })
  const [emailAttachments, setEmailAttachments] = useState([]) // { file, name, size, base64 }
  const [emailGenerating, setEmailGenerating] = useState(false)
  const [emailSending, setEmailSending] = useState(false)

  // Formations
  const [formations, setFormations] = useState([])

  // Devis client (pour contexte IA)
  const [clientQuotes, setClientQuotes] = useState([])

  // Factures
  const [clientInvoices, setClientInvoices] = useState([])

  // Emails de session (convocations, bilans, etc.)
  const [sessionEmailsSent, setSessionEmailsSent] = useState([])

  // RDV
  const [rdvs, setRdvs] = useState([])

  // Prospection enrichment
  const [prospectionData, setProspectionData] = useState(null) // best prospect for import
  const [prospectionLoading, setProspectionLoading] = useState(false)
  const [clientLinks, setClientLinks] = useState(null) // résultat detect_client_links RPC
  const [linksExpanded, setLinksExpanded] = useState(false) // détails dépliés
  // Sections dépliées
  const [sections, setSections] = useState({ contacts: true, timeline: true, formations: true })

  // Accès entreprise (lien + code) : table client_portal_access
  const [portalAccess, setPortalAccess] = useState(null)
  const [portalBusy, setPortalBusy] = useState(false)
  const portalUrl = portalAccess ? `${publicBaseUrl()}/#/entreprise/${portalAccess.token}` : ''
  const newCode = () => String(Math.floor(100000 + Math.random() * 900000))

  async function loadPortalAccess() {
    const { data } = await supabase.from('client_portal_access').select('*').eq('client_id', id).maybeSingle()
    setPortalAccess(data || null)
  }
  async function createPortalAccess() {
    setPortalBusy(true)
    try {
      const { data, error } = await supabase.from('client_portal_access')
        .insert({ client_id: id, access_code: newCode(), contact_email: client?.contact_email || null })
        .select().single()
      if (error) throw error
      setPortalAccess(data)
      toast.success('Accès entreprise créé')
    } catch (err) { toast.error('Création impossible : ' + (err.message || '')) } finally { setPortalBusy(false) }
  }
  async function updatePortalAccess(patch, msg) {
    if (!portalAccess) return
    setPortalBusy(true)
    try {
      const { data, error } = await supabase.from('client_portal_access')
        .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', portalAccess.id).select().single()
      if (error) throw error
      setPortalAccess(data)
      if (msg) toast.success(msg)
    } catch (err) { toast.error('Mise à jour impossible : ' + (err.message || '')) } finally { setPortalBusy(false) }
  }
  async function copyText(text, label) {
    try { await navigator.clipboard.writeText(text); toast.success(`${label} copié`) } catch { toast.error('Copie impossible') }
  }


  useEffect(() => { if (id) loadAll() }, [id])

  // Charger la liste de tous les clients (A→Z) pour navigation
  useEffect(() => {
    async function loadClientIds() {
      // fetchAll : navigation précédent/suivant sur TOUS les clients (tri secondaire id stable)
      const { data } = await fetchAll(() => supabase.from('clients').select('id, name').order('name'))
      if (data) setAllClientIds(data.map(c => c.id))
    }
    loadClientIds()
  }, [])

  // Calculer précédent/suivant
  const currentIndex = allClientIds.indexOf(id)
  const prevClientId = currentIndex > 0 ? allClientIds[currentIndex - 1] : null
  const nextClientId = currentIndex >= 0 && currentIndex < allClientIds.length - 1 ? allClientIds[currentIndex + 1] : null

  function navigateToClient(targetId) {
    if (!targetId) return
    navigate(`/clients/${targetId}`)
    // Le mode édition n'est ouvert qu'aux comptes qui peuvent modifier les clients
    if (d.modifier) setEditing(true)
  }

  // Raccourcis clavier Alt+← / Alt+→
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.altKey && e.key === 'ArrowLeft' && prevClientId) {
        e.preventDefault()
        navigateToClient(prevClientId)
      }
      if (e.altKey && e.key === 'ArrowRight' && nextClientId) {
        e.preventDefault()
        navigateToClient(nextClientId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [prevClientId, nextClientId, d.modifier])

  // ═══════════════════════════════════════════════════════════
  // CHARGEMENT DONNÉES
  // ═══════════════════════════════════════════════════════════
  async function loadAll() {
    setLoading(true)
    await Promise.all([loadClient(), loadContacts(), loadInteractions(), loadFormations(), loadRdvs(), loadQuotes(), loadInvoices(), loadSessionEmails(), loadPortalAccess()])
    setLoading(false)
  }

  // Lookup liens prospect multi-sources après loadClient
  useEffect(() => {
    if (client?.id) loadClientLinks(client)
  }, [client?.id, client?.siret, client?.group_name])

  async function loadClientLinks(c) {
    if (!c?.id) return
    setProspectionLoading(true)
    try {
      // Appel RPC multi-sources
      const { data: linksResult, error } = await supabase.rpc('detect_client_links', { p_client_id: c.id })
      if (error) throw error
      setClientLinks(linksResult)

      // Pour compatibilité import/markDejaClient : extraire le meilleur prospect SIREN
      const sirenMatches = linksResult?.siren_matches || []
      if (sirenMatches.length > 0) {
        const best = sirenMatches.find(d => d.contacted) || sirenMatches[0]
        setProspectionData({ ...best, totalSiblings: sirenMatches.length, allProspects: sirenMatches })
      } else {
        setProspectionData(null)
      }
    } catch (err) {
      console.error('Erreur detect_client_links:', err)
      setClientLinks(null)
      setProspectionData(null)
    } finally {
      setProspectionLoading(false)
    }
  }

  async function loadClient() {
    const { data, error } = await supabase.from('clients').select('*').eq('id', id).single()
    if (error) { toast.error('Client introuvable'); return }
    setClient(data)
    setEditForm(data)
  }

  async function loadContacts() {
    const { data } = await supabase.from('client_contacts').select('*').eq('client_id', id)
      .order('is_primary', { ascending: false }).order('is_document_contact', { ascending: false }).order('name')
    setContacts(data || [])
  }

  async function loadInteractions() {
    const { data: manual } = await supabase.from('client_interactions').select('*').eq('client_id', id).order('interaction_date', { ascending: false })
    setInteractions(manual || [])
    const { data: calls } = await supabase.from('prospect_calls').select('*').eq('client_id', id).order('called_at', { ascending: false })
    setPhoningCalls(calls || [])
    const { data: emails } = await supabase.from('prospect_email_logs').select('*').eq('client_id', id).order('sent_at', { ascending: false })
    setEmailLogs(emails || [])
  }

  async function loadFormations() {
    const { data, error } = await supabase.from('sessions').select(`
      id, reference, start_date, end_date, status, notes,
      courses(id, title, code, duration_hours),
      session_trainees(id, trainee_id, result, trainees(first_name, last_name))
    `).eq('client_id', id).order('start_date', { ascending: false })
    if (error) console.error('loadFormations error:', error)
    setFormations(data || [])
  }

  async function loadRdvs() {
    const { data } = await supabase.from('prospect_rdv').select('*').eq('client_id', id).order('rdv_date', { ascending: false })
    setRdvs(data || [])
  }

  async function loadQuotes() {
    const { data } = await supabase.from('quotes').select('id, reference, object, status, total_ht, quote_date, validity_date')
      .eq('client_id', id).order('quote_date', { ascending: false }).limit(10)
    setClientQuotes(data || [])
  }

  async function loadInvoices() {
    const { data } = await supabase.from('invoices')
      .select('id, reference, type, status, total_ht, total_ttc, invoice_date, object')
      .eq('client_id', id).order('invoice_date', { ascending: false }).limit(30)
    setClientInvoices(data || [])
  }

  async function loadSessionEmails() {
    const { data } = await supabase.from('session_emails_sent')
      .select('id, session_id, email_type, to_email, subject, status, created_at, sessions!inner(client_id, reference, courses(title))')
      .eq('sessions.client_id', id)
      .order('created_at', { ascending: false })
    setSessionEmailsSent(data || [])
  }

  // Importer les données de prospection_massive → remplir champs vides du client
  async function importFromProspection() {
    if (!prospectionData || !client) return
    const p = prospectionData
    const updates = {}
    // Remplir uniquement les champs vides du client
    if (!client.contact_phone && p.phone) updates.contact_phone = p.phone
    if (!client.contact_email && p.email) updates.contact_email = p.email
    if (!client.website && p.site_web) updates.website = p.site_web
    if (!client.opco_name && p.opco_name) updates.opco_name = p.opco_name
    if (!client.taille_entreprise && p.effectif) updates.taille_entreprise = String(p.effectif)
    if (!client.siren && p.siren) updates.siren = p.siren
    if (!client.contact_name && p.dirigeant_nom) updates.contact_name = [p.dirigeant_prenom, p.dirigeant_nom].filter(Boolean).join(' ')
    if (!client.contact_function && p.dirigeant_fonction) updates.contact_function = p.dirigeant_fonction
    // Notes enrichies - concaténer
    const extraNotes = [p.enrichment_notes, p.ai_summary, p.prospection_notes].filter(Boolean).join(' | ')
    if (extraNotes) {
      updates.notes = client.notes ? client.notes + '\n\n Enrichissement prospection:\n' + extraNotes : ' Enrichissement prospection:\n' + extraNotes
    }

    if (Object.keys(updates).length === 0 && !extraNotes) {
      // Rien à importer, mais marquer quand même
      await markDejaClient()
      toast.success('Prospect marqué "déjà client" - aucun champ à importer')
      return
    }

    try {
      const { error } = await supabase.from('clients').update(updates).eq('id', id)
      if (error) throw error
      // Marquer les prospects comme deja_client
      await markDejaClient()
      // Rafraîchir
      const { data: fresh } = await supabase.from('clients').select('*').eq('id', id).single()
      if (fresh) { setClient(fresh); setEditForm(fresh) }
      const imported = Object.keys(updates).filter(k => k !== 'notes').length
      toast.success(`${imported} champ(s) importé(s) - prospect retiré de la file de prospection`)
    } catch (err) {
      toast.error('Erreur import: ' + err.message)
    }
  }

  // Marquer tous les prospects liés (tous SIREN détectés) comme "deja_client"
  async function markDejaClient(specificSirens) {
    // Collecter tous les SIREN à marquer
    const sirens = new Set()
    if (specificSirens) {
      specificSirens.forEach(s => sirens.add(s))
    } else if (clientLinks) {
      // Tous les SIREN de toutes les sources
      const allMatches = [
        ...(clientLinks.siren_matches || []),
        ...(clientLinks.domain_matches || []),
        ...(clientLinks.dirigeant_matches || []),
        ...(clientLinks.group_prospect_matches || []),
      ]
      allMatches.forEach(m => { if (m.siren) sirens.add(m.siren) })
      // Ajouter le SIREN du client lui-même
      if (clientLinks.client_siren) sirens.add(clientLinks.client_siren)
    } else if (prospectionData?.siren) {
      sirens.add(prospectionData.siren)
    }
    if (sirens.size === 0) return
    try {
      for (const siren of sirens) {
        await supabase.from('prospection_massive').update({
          prospection_status: 'deja_client',
          updated_at: new Date().toISOString(),
        }).eq('siren', siren)
      }
      // Rafraîchir les liens
      if (client) loadClientLinks(client)
      toast.success(`${sirens.size} SIREN marqué(s) "déjà client"`)
    } catch (err) {
      console.error('Erreur marquage deja_client:', err)
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CRUD CLIENT
  // ═══════════════════════════════════════════════════════════
  async function autoDetectOpco() {
    const siret = (editForm.siret || '').replace(/\s/g, '')
    if (!siret || siret.length < 9) return toast.error('SIRET requis (min 9 chiffres)')
    setDetectingOpco(true)
    try {
      const res = await apiFetch(`/api/detect-opco?siret=${siret}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur API')

      // Enrichir les champs depuis les données entreprise
      const updates = {}
      const ent = data.entreprise
      if (ent) {
        if (ent.address && !editForm.address) updates.address = ent.address
        if (ent.postal_code && !editForm.postal_code) updates.postal_code = ent.postal_code
        if (ent.city && !editForm.city) updates.city = ent.city.toUpperCase()
        // Si les champs sont vides OU identiques aux anciens (= pas modifiés manuellement), on écrase
        if (ent.address) updates.address = ent.address
        if (ent.postal_code) updates.postal_code = ent.postal_code
        if (ent.city) updates.city = ent.city.toUpperCase()
      }

      if (data.status === 'OK' && data.opco_name) {
        updates.opco_name = data.opco_name
        setEditForm(prev => ({ ...prev, ...updates }))
        toast.success(`OPCO : ${data.opco_name}${data.convention ? ' (' + data.convention + ')' : ''}`)
      } else if (data.status === 'IDCC_FOUND_NO_OPCO') {
        setEditForm(prev => ({ ...prev, ...updates }))
        toast.error(data.message || `IDCC ${data.idcc} trouvé mais OPCO non référencé`)
      } else {
        // Même sans OPCO, on enrichit l'adresse si dispo
        if (Object.keys(updates).length > 0) {
          setEditForm(prev => ({ ...prev, ...updates }))
          toast('Adresse enrichie depuis le SIRET', { icon: '' })
        } else {
          toast.error(data.message || 'Aucune convention collective trouvée')
        }
      }
    } catch (err) {
      toast.error('Erreur détection : ' + err.message)
    } finally {
      setDetectingOpco(false)
    }
  }

  async function saveClient() {
    const sirenVal = editForm.siren || (editForm.siret ? editForm.siret.slice(0, 9) : null)
    
    // Auto-promotion : si status = 'a_completer' et champs clés remplis → passer en 'prospect'
    let finalStatus = editForm.status
    const wasAutoPromoted = finalStatus === 'a_completer' && (() => {
      const hasName = !!editForm.name?.trim()
      const hasContact = !!(editForm.contact_email?.trim() || editForm.contact_phone?.trim())
      const hasSiret = !!editForm.siret?.trim()
      if (hasName && hasContact && hasSiret) { finalStatus = 'prospect'; return true }
      return false
    })()
    
    const { error } = await supabase.from('clients').update({
      name: editForm.name, siret: editForm.siret, siren: sirenVal,
      address: editForm.address,
      postal_code: editForm.postal_code, city: editForm.city,
      contact_email: editForm.contact_email, contact_phone: editForm.contact_phone,
      contact_name: editForm.contact_name, contact_function: editForm.contact_function,
      website: editForm.website, notes: editForm.notes, status: finalStatus,
      opco_name: editForm.opco_name || null,
      client_type: editForm.client_type || 'entreprise',
      group_name: editForm.group_name || null,
      billing_mode: editForm.billing_mode || 'per_session',
      default_payment_terms: editForm.default_payment_terms || 'à 30 jours',
      billing_email: editForm.billing_email || null,
      satisfaction_mode: editForm.satisfaction_mode || 'after_session',
      tva: editForm.vat_exempt ? null : (editForm.tva || null),
      vat_exempt: !!editForm.vat_exempt,
      // Client public (Chorus Pro, 0363) : code service par défaut, engagement exigé
      chorus_service_code: editForm.client_type === 'public' ? (editForm.chorus_service_code || null) : null,
      chorus_engagement_required: editForm.client_type === 'public' ? !!editForm.chorus_engagement_required : false,
    }).eq('id', id)
    if (error) return toast.error('Erreur sauvegarde')
    toast.success(wasAutoPromoted ? 'Fiche complétée → statut passé en Prospect ' : 'Client mis à jour', wasAutoPromoted ? { icon: '' } : {})
    // Marquer prospect deja_client si des liens détectés
    if (sirenVal && clientLinks) {
      const hasUnmarked = [
        ...(clientLinks.siren_matches || []),
        ...(clientLinks.domain_matches || []),
        ...(clientLinks.dirigeant_matches || []),
        ...(clientLinks.group_prospect_matches || []),
      ].some(m => m.prospection_status !== 'deja_client')
      if (hasUnmarked) await markDejaClient([sirenVal])
    }
    // Recharger les données fraîches mais rester en mode édition
    const { data: fresh } = await supabase.from('clients').select('*').eq('id', id).single()
    if (fresh) { setClient(fresh); setEditForm(fresh) }
    // On reste en mode édition pour permettre la navigation
  }

  // ── Toggle do_not_mail (sans passer par le mode édition) ──
  async function toggleDoNotMail() {
    const newVal = !client.do_not_mail
    const { error } = await supabase
      .from('clients')
      .update({ do_not_mail: newVal })
      .eq('id', id)
    if (error) { toast.error('Erreur mise à jour'); return }
    setClient(c => ({ ...c, do_not_mail: newVal }))
    toast.success(newVal ? ' Mailing désactivé pour ce client' : ' Mailing réactivé')
  }

  // ═══════════════════════════════════════════════════════════
  // CRUD CONTACTS
  // ═══════════════════════════════════════════════════════════
  async function saveContact() {
    if (!contactForm.name) return toast.error('Nom requis')

    // Si ce contact est marqué "documents", retirer le flag des autres
    if (contactForm.is_document_contact) {
      const othersWithFlag = contacts.filter(c => c.is_document_contact && (!editingContact || c.id !== editingContact.id))
      for (const other of othersWithFlag) {
        await supabase.from('client_contacts').update({ is_document_contact: false }).eq('id', other.id)
      }
    }

    // Si ce contact est marqué "facturation", retirer le flag des autres
    if (contactForm.is_billing) {
      const othersWithBilling = contacts.filter(c => c.is_billing && (!editingContact || c.id !== editingContact.id))
      for (const other of othersWithBilling) {
        await supabase.from('client_contacts').update({ is_billing: false }).eq('id', other.id)
      }
    }

    if (editingContact) {
      const { error } = await supabase.from('client_contacts').update(contactForm).eq('id', editingContact.id)
      if (error) return toast.error('Erreur: ' + error.message)
      toast.success('Contact modifié')
    } else {
      const { error } = await supabase.from('client_contacts').insert({ ...contactForm, client_id: id })
      if (error) return toast.error('Erreur: ' + error.message)
      toast.success('Contact ajouté')
    }
    // Le contact principal alimente les champs contact de la fiche (base, migration 0037)
    await supabase.rpc('client_contact_sync_primary', { p_client_id: id }).then(() => {}, () => {})
    closeContactForm()
    loadContacts()
    loadClient()
  }

  async function deleteContact(contactId) {
    if (!confirm('Supprimer ce contact ?')) return
    await supabase.from('client_contacts').delete().eq('id', contactId)
    await supabase.rpc('client_contact_sync_primary', { p_client_id: id }).then(() => {}, () => {})
    toast.success('Contact supprimé')
    loadContacts()
    loadClient()
  }

  function openEditContact(c) {
    setContactForm({ name: c.name, role: c.role || '', email: c.email || '', phone: c.phone || '', is_primary: c.is_primary || false, is_document_contact: c.is_document_contact || false, is_billing: c.is_billing || false })
    setEditingContact(c)
    setShowContactForm(true)
  }

  function closeContactForm() {
    setShowContactForm(false)
    setEditingContact(null)
    setContactForm({ name: '', role: '', email: '', phone: '', is_primary: false, is_document_contact: false, is_billing: false })
  }

  // ═══════════════════════════════════════════════════════════
  // CRUD INTERACTIONS
  // ═══════════════════════════════════════════════════════════
  async function saveInteraction() {
    if (!interactionForm.content && !interactionForm.title) return toast.error('Contenu requis')
    const { error } = await supabase.from('client_interactions').insert({
      client_id: id, type: interactionForm.type,
      title: interactionForm.title || INTERACTION_TYPES.find(t => t.value === interactionForm.type)?.label || '',
      content: interactionForm.content, author: interactionForm.author,
    })
    if (error) return toast.error('Erreur: ' + error.message)
    toast.success('Interaction ajoutée')
    setShowInteractionForm(false)
    setInteractionForm({ type: 'call', title: '', content: '', author: currentUserFirstName() })
    loadInteractions()
  }

  async function deleteInteraction(intId) {
    if (!confirm('Supprimer cette interaction ?')) return
    await supabase.from('client_interactions').delete().eq('id', intId)
    toast.success('Supprimé')
    loadInteractions()
  }

  // ═══════════════════════════════════════════════════════════
  // EMAIL DIRECT CLIENT
  // ═══════════════════════════════════════════════════════════

  // Gestion pièces jointes
  function handleEmailAttachments(e) {
    const files = Array.from(e.target.files)
    const maxSize = 10 * 1024 * 1024 // 10 MB par fichier
    files.forEach(file => {
      if (file.size > maxSize) {
        toast.error(`${file.name} trop volumineux (max 10 Mo)`)
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = reader.result.split(',')[1]
        setEmailAttachments(prev => [...prev, {
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          base64,
        }])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = '' // reset input
  }

  function removeAttachment(index) {
    setEmailAttachments(prev => prev.filter((_, i) => i !== index))
  }

  async function generateEmailIA() {
    if (!emailForm.brief?.trim()) return toast.error('Décrivez ce que vous voulez dire')
    setEmailGenerating(true)
    try {
      const timeline = getMergedTimeline()
      const selectedContact = contacts.find(c => c.email === emailForm.to)

      const res = await apiFetch('/api/generate-client-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: emailForm.brief,
          clientName: client?.name,
          contactName: selectedContact?.name || client?.contact_name,
          contactFunction: selectedContact?.fonction || selectedContact?.role || client?.contact_function,
          senderName: emailForm.sender,
          clientInfo: {
            city: client?.city,
            effectif: client?.effectif,
            naf_label: client?.naf_label,
            opco_name: client?.opco_name,
            status: client?.status,
          },
          sessions: formations.slice(0, 8).map(f => ({
            courseTitle: f.courses?.title || f.courses?.code || 'Formation',
            startDate: f.start_date ? new Date(f.start_date).toLocaleDateString('fr-FR') : '',
            endDate: f.end_date ? new Date(f.end_date).toLocaleDateString('fr-FR') : '',
            nbTrainees: f.session_trainees?.length || 0,
            status: f.status,
          })),
          quotes: clientQuotes.slice(0, 5).map(q => ({
            reference: q.reference,
            object: q.object,
            totalHt: q.total_ht,
            status: q.status,
            sentDate: q.quote_date ? new Date(q.quote_date).toLocaleDateString('fr-FR') : '',
          })),
          rdvs: rdvs.slice(0, 3),
          emailHistory: emailLogs.slice(0, 5).map(e => ({
            date: e.sent_at ? new Date(e.sent_at).toLocaleDateString('fr-FR') : '',
            subject: e.subject,
            to: e.to_email,
          })),
          recentInteractions: timeline.filter(i => i.type !== 'email').slice(0, 5).map(i => ({
            date: i.date ? new Date(i.date).toLocaleDateString('fr-FR') : '',
            type: i.type,
            title: i.title,
            content: i.content,
          })),
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      // Convertir HTML → texte lisible pour le textarea
      let bodyText = (data.body || '')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<p[^>]*>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      setEmailForm(f => ({ ...f, subject: data.subject || f.subject, body: bodyText || f.body }))
      toast.success('Email généré !')
    } catch (err) {
      toast.error('Erreur IA : ' + err.message)
    }
    setEmailGenerating(false)
  }

  async function sendClientEmail() {
    if (!emailForm.to || !emailForm.subject || !emailForm.body) return toast.error('Destinataire, objet et corps requis')
    setEmailSending(true)
    try {
      // Convertir le texte brut en HTML si pas déjà du HTML
      let htmlBody = emailForm.body
      if (!htmlBody.includes('<p>') && !htmlBody.includes('<br')) {
        htmlBody = htmlBody.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
      }

      const res = await apiFetch('/api/send-prospect-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: emailForm.to,
          subject: emailForm.subject,
          body: htmlBody,
          caller: emailForm.sender,
          clientId: id,
          prospectName: client?.name,
          templateType: 'client_direct',
          attachments: emailAttachments.map(a => ({
            filename: a.name,
            base64: a.base64,
            contentType: a.type,
          })),
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      toast.success(`Email envoyé !${emailAttachments.length > 0 ? ` (${emailAttachments.length} PJ)` : ''}`)
      setShowEmailForm(false)
      setEmailForm({ to: '', subject: '', body: '', brief: '', sender: currentUserFirstName() })
      setEmailAttachments([])
      loadInteractions()
    } catch (err) {
      toast.error('Erreur envoi : ' + err.message)
    }
    setEmailSending(false)
  }

  function openEmailForm() {
    // Pré-remplir le destinataire avec le contact principal ou le premier contact avec email
    const primary = contacts.find(c => c.is_primary && c.email)
    const firstWithEmail = contacts.find(c => c.email)
    const defaultTo = primary?.email || firstWithEmail?.email || client?.contact_email || ''
    setEmailForm({ to: defaultTo, subject: '', body: '', brief: '', sender: currentUserFirstName() })
    setEmailAttachments([])
    setShowEmailForm(true)
  }

  // ═══════════════════════════════════════════════════════════
  // TIMELINE FUSIONNÉE
  // ═══════════════════════════════════════════════════════════
  function getMergedTimeline() {
    const items = []

    // ── Interactions manuelles
    interactions.forEach(i => items.push({
      id: 'int-' + i.id, type: i.type, title: i.title, content: i.content,
      author: i.author, date: i.interaction_date, source: 'manual', deletable: true, rawId: i.id,
    }))

    // ── Appels de prospection
    phoningCalls.forEach(c => {
      const resultLabels = { chaud: ' Intéressé', tiede: ' Tiède', froid: ' Pas intéressé', no_answer: ' Injoignable', blocked: ' Barrage', wrong_number: ' N° erroné' }
      items.push({
        id: 'call-' + c.id, type: 'call',
        title: (resultLabels[c.call_result] || c.call_result || 'Appel') + ' (phoning)',
        content: [
          c.contact_name ? ' ' + c.contact_name + (c.contact_function ? ' - ' + c.contact_function : '') : '',
          c.formations_mentioned?.length ? ' ' + c.formations_mentioned.join(', ') : '',
          c.notes || ''
        ].filter(Boolean).join('\n'),
        author: c.called_by, date: c.called_at, source: 'phoning', deletable: false,
      })
    })

    // ── Emails prospect
    emailLogs.forEach(e => {
      const tplLabels = { suite_echange: 'Suite échange', nrp: 'NRP', relance: 'Relance' }
      items.push({
        id: 'email-' + e.id, type: 'email',
        title: 'Email "' + (tplLabels[e.template_type] || e.template_type) + '" envoyé',
        content: ['À : ' + e.to_email, 'Objet : ' + (e.subject || ''), e.body_preview ? e.body_preview.substring(0, 150) + '...' : ''].filter(Boolean).join('\n'),
        author: e.sent_by || 'Système', date: e.sent_at, source: 'email', deletable: false,
      })
    })

    // ── Sessions / Formations
    formations.forEach(f => {
      if (!f.start_date) return
      const statusLabels = { planned: ' Session planifiée', in_progress: ' Session en cours', completed: ' Session terminée', cancelled: ' Session annulée', draft: ' Session brouillon' }
      items.push({
        id: 'ses-' + f.id, type: 'meeting',
        title: (statusLabels[f.status] || ' Session') + (f.courses?.title ? ' - ' + f.courses.title : ''),
        content: [
          format(new Date(f.start_date), 'dd/MM/yyyy', { locale: fr }) + (f.end_date && f.end_date !== f.start_date ? ' → ' + format(new Date(f.end_date), 'dd/MM/yyyy', { locale: fr }) : ''),
          f.session_trainees?.length ? f.session_trainees.length + ' stagiaire(s)' : '',
        ].filter(Boolean).join(' · '),
        author: null, date: f.start_date + 'T09:00:00', source: 'session', deletable: false, link: '/sessions/' + f.id,
      })
    })

    // ── RDV commerciaux
    rdvs.forEach(r => {
      if (!r.rdv_date) return
      const statusLabels = { prevu: ' RDV prévu', realise: ' RDV réalisé', annule: ' RDV annulé' }
      items.push({
        id: 'rdv-' + r.id, type: 'meeting',
        title: (statusLabels[r.status] || 'RDV') + (r.conducted_by ? ' - ' + r.conducted_by : ''),
        content: r.notes ? r.notes.substring(0, 200) : '',
        author: r.conducted_by, date: r.rdv_date + 'T' + (r.rdv_time || '09:00:00'), source: 'rdv', deletable: false,
      })
    })

    // ── Devis
    clientQuotes.forEach(q => {
      if (!q.quote_date) return
      const statusLabels = { draft: ' Devis brouillon', sent: ' Devis envoyé', signed: ' Devis accepté', rejected: ' Devis refusé', expired: ' Devis expiré' }
      items.push({
        id: 'qte-' + q.id, type: 'devis',
        title: (statusLabels[q.status] || ' Devis') + ' ' + q.reference,
        content: [q.object || '', q.total_ht ? parseFloat(q.total_ht).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) + ' HT' : ''].filter(Boolean).join(' · '),
        author: null, date: q.quote_date + 'T12:00:00', source: 'quote', deletable: false,
      })
    })

    // ── Emails de session (convocations, bilans, évaluations...)
    const emailTypeLabels = {
      before: ' Convocation envoyée',
      after: ' Bilan/évaluation envoyé',
      reminder: ' Rappel envoyé',
      certificate: ' Attestation envoyée',
      convention: ' Convention envoyée',
    }
    sessionEmailsSent.forEach(e => {
      if (!e.created_at) return
      const sessionTitle = e.sessions?.courses?.title || e.sessions?.reference || 'session'
      items.push({
        id: 'smail-' + e.id, type: 'email',
        title: (emailTypeLabels[e.email_type] || ' Email envoyé') + ' - ' + sessionTitle,
        content: ['À : ' + e.to_email, e.subject ? 'Objet : ' + e.subject : ''].filter(Boolean).join('\n'),
        author: null, date: e.created_at, source: 'session_email', deletable: false,
      })
    })

    // ── Factures & avoirs
    clientInvoices.forEach(inv => {
      if (!inv.invoice_date) return
      const statusLabels = { draft: ' Brouillon', sent: ' Envoyée', due: ' Émise', paid: ' Payée', overdue: ' En retard', cancelled: ' Annulée', credited: '↩ Annulée par avoir' }
      const typeLabel = inv.type === 'credit_note' ? 'Avoir' : 'Facture'
      items.push({
        id: 'inv-' + inv.id, type: 'facture',
        title: (inv.type === 'credit_note' ? ' Avoir' : (statusLabels[inv.status] || typeLabel)) + ' ' + inv.reference,
        content: [inv.object || '', inv.total_ttc ? parseFloat(inv.total_ttc).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) + ' TTC' : ''].filter(Boolean).join(' · '),
        author: null, date: inv.invoice_date + 'T12:00:00', source: 'invoice', deletable: false,
      })
    })

    return items.sort((a, b) => new Date(b.date) - new Date(a.date))
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  const statusInfo = STATUS_OPTIONS.find(s => s.value === client?.status) || STATUS_OPTIONS[0]

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
  if (!client) return <div className="p-6"><Link to="/clients" className="text-primary-600 hover:underline flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Retour</Link><p className="mt-4 text-gray-500">Client introuvable</p></div>

  const timeline = getMergedTimeline()
  const upcomingSessions = formations.filter(f => f.status === 'planned' || f.status === 'in_progress' || f.status === 'draft')
  const pastSessions = formations.filter(f => f.status === 'completed' || f.status === 'cancelled')
  const docContact = contacts.find(c => c.is_document_contact)
  const billingContact = contacts.find(c => c.is_billing)

  // KPI enrichis
  // Factures émises − avoirs validés
  const caFacture = clientInvoices
    .filter(i => ['paid', 'due', 'overdue', 'partial', 'credited'].includes(i.status))
    .reduce((sum, i) => sum + (i.type === 'credit_note' ? -1 : 1) * (parseFloat(i.total_ttc) || 0), 0)
  const lastActivity = timeline.find(i => i.source !== 'session' && i.source !== 'rdv')
  const daysSinceLastContact = lastActivity
    ? Math.floor((Date.now() - new Date(lastActivity.date).getTime()) / (1000 * 60 * 60 * 24))
    : null
  const inactivityAlert = daysSinceLastContact !== null && daysSinceLastContact > 90 && upcomingSessions.length === 0

  // Prochaine action (RDV non annulé avec next_action renseigné)
  const nextActionRdv = rdvs.find(r => r.status !== 'annule' && r.next_action)

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">

      {/* ══════ HEADER ══════ */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link to="/clients" className="text-ui text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Retour aux clients</span><span className="sm:hidden">Retour</span>
        </Link>
        <div className="flex items-center gap-2">
          {/* Navigation précédent/suivant */}
          <div className="flex items-center gap-1 mr-1 sm:mr-2">
            <button onClick={() => navigateToClient(prevClientId)} disabled={!prevClientId}
              className="p-2 rounded-ui-sm border border-gray-300 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Client précédent (Alt+←)">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-ui-sm text-gray-400 tabular-nums min-w-[3rem] sm:min-w-[4rem] text-center hidden sm:inline">
              {currentIndex >= 0 ? `${currentIndex + 1} / ${allClientIds.length}` : ''}
            </span>
            <button onClick={() => navigateToClient(nextClientId)} disabled={!nextClientId}
              className="p-2 rounded-ui-sm border border-gray-300 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Client suivant (Alt+→)">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          {!editing ? (
            d.modifier && (
              <button onClick={() => setEditing(true)} className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-primary-600 text-white rounded-ui-sm hover:bg-primary-700 text-ui">
                <Edit className="w-4 h-4" /> <span className="hidden sm:inline">Modifier</span>
              </button>
            )
          ) : (
            <>
              <button onClick={() => { setEditing(false); setEditForm(client) }} className="px-3 sm:px-4 py-2 border border-gray-300 rounded-ui-sm text-ui hover:bg-gray-50">Annuler</button>
              {d.modifier && (
                <button onClick={saveClient} className="flex items-center gap-2 px-3 sm:btn btn-secondary text-ui">
                  <Save className="w-4 h-4" /> <span className="hidden sm:inline">Enregistrer</span><span className="sm:hidden">OK</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ══════ BANNIÈRE FICHE À COMPLÉTER ══════ */}
      {client.status === 'a_completer' && (
        <div className="bg-gray-50 border border-gray-200 rounded-ui px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-gray-700 rounded-ui-sm flex items-center justify-center flex-shrink-0 mt-0.5">
              <Edit className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-ui font-bold text-gray-800">Fiche à compléter</p>
              <p className="text-ui-sm text-gray-800 mt-0.5">
                Complétez les informations manquantes ci-dessous. La fiche passera automatiquement en statut "Prospect" une fois les champs clés remplis.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {!client.siret && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-800 rounded-full text-ui-sm font-medium">
                    <CreditCard className="w-3 h-3" /> SIRET manquant
                  </span>
                )}
                {!client.contact_email && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-800 rounded-full text-ui-sm font-medium">
                    <Mail className="w-3 h-3" /> Email manquant
                  </span>
                )}
                {!client.contact_phone && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-800 rounded-full text-ui-sm font-medium">
                    <Phone className="w-3 h-3" /> Téléphone manquant
                  </span>
                )}
                {!client.address && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-800 rounded-full text-ui-sm font-medium">
                    <MapPin className="w-3 h-3" /> Adresse manquante
                  </span>
                )}
                {!client.contact_name && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-800 rounded-full text-ui-sm font-medium">
                    <User className="w-3 h-3" /> Contact manquant
                  </span>
                )}
                {client.siret && client.contact_email && client.contact_phone && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] rounded-full text-ui-sm font-bold">
                     Champs clés remplis - enregistrez pour valider
                  </span>
                )}
              </div>
              {!editing && d.modifier && (
                <button onClick={() => setEditing(true)}
                  className="mt-2 px-3 py-1.5 bg-gray-700 text-white text-ui-sm font-medium rounded-ui-sm hover:bg-gray-700 transition-colors inline-flex items-center gap-1">
                  <Edit className="w-3.5 h-3.5" /> Compléter maintenant
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════ FICHE CLIENT ══════ */}
      <div className="bg-white rounded-ui border border-gray-200 overflow-hidden">
        <div className="bg-gray-50/50 px-4 sm:px-6 py-4 border-b">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary-600 rounded-ui-sm flex items-center justify-center shadow-sm flex-shrink-0">
                <Building2 className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                {editing ? (
                  <input value={editForm.name || ''} onChange={e => setEditForm({ ...editForm, name: e.target.value.toUpperCase() })}
                    className="text-lg sm:text-xl font-bold bg-white border rounded px-2 py-1 w-full sm:w-80" />
                ) : (
                  <h1 className="page-title truncate">{client.name}</h1>
                )}
                {client.siret && <p className="text-ui-sm sm:text-sm text-gray-500 font-mono mt-0.5">SIRET {client.siret}</p>}
                {client.vat_exempt ? <p className="text-ui-sm text-gray-400 mt-0.5">Non assujetti à la TVA</p> : client.tva && <p className="text-ui-sm text-gray-400 font-mono mt-0.5">TVA {client.tva}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              {docContact && !editing && (
                <div className="text-right hidden lg:block">
                  <p className="text-ui-sm text-gray-400">Contact documents</p>
                  <p className="text-ui font-medium text-gray-700">{docContact.name}{docContact.role ? ' - ' + docContact.role : ''}</p>
                </div>
              )}
              {billingContact && !editing && (
                <div className="text-right hidden lg:block">
                  <p className="text-ui-sm text-gray-400"> Facturation</p>
                  <p className="text-ui font-medium text-gray-700">{billingContact.name}{billingContact.email ? ' - ' + billingContact.email : ''}</p>
                </div>
              )}
              {editing ? (
                <select value={editForm.status || 'prospect'} onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                  className="px-3 py-1.5 border rounded-ui-sm text-ui">
                  {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              ) : (
                <span className={'px-3 py-1.5 rounded-full text-ui font-medium ' + statusInfo.color}>{statusInfo.label}</span>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {/* ══════ BANDEAU DÉTECTION LIENS MULTI-SOURCES ══════ */}
          {clientLinks && (() => {
            const siren = clientLinks.siren_matches || []
            const domain = clientLinks.domain_matches || []
            const dirigeant = clientLinks.dirigeant_matches || []
            const groupClients = clientLinks.group_clients || []
            const groupProspects = clientLinks.group_prospect_matches || []
            const totalLinks = siren.length + domain.length + dirigeant.length + groupProspects.length
            const hasGroupClients = groupClients.length > 0
            const allDejaMark = totalLinks === 0 // rien à marquer
            const hasSomethingToShow = totalLinks > 0 || hasGroupClients

            if (!hasSomethingToShow && !prospectionLoading) return null

            // Collecter les SIREN uniques non-marqués
            const allProspects = [...siren, ...domain, ...dirigeant, ...groupProspects]
            const uniqueSirens = [...new Set(allProspects.map(p => p.siren).filter(Boolean))]

            // Champs importables depuis le meilleur prospect SIREN
            const importable = []
            if (prospectionData) {
              const p = prospectionData
              if (!client.contact_phone && p.phone) importable.push({ label: 'Téléphone', value: p.phone })
              if (!client.contact_email && p.email) importable.push({ label: 'Email', value: p.email })
              if (!client.website && p.site_web) importable.push({ label: 'Site web', value: p.site_web })
              if (!client.opco_name && p.opco_name) importable.push({ label: 'OPCO', value: p.opco_name })
              if (!client.taille_entreprise && p.effectif) importable.push({ label: 'Effectif', value: String(p.effectif) })
              if (!client.contact_name && p.dirigeant_nom) importable.push({ label: 'Dirigeant', value: [p.dirigeant_prenom, p.dirigeant_nom].filter(Boolean).join(' ') })
            }

            // Sources à afficher
            const sources = [
              siren.length > 0 && { icon: '', label: 'SIREN', detail: `${siren.length} établissement(s)`, count: siren.length, color: 'blue', items: siren },
              domain.length > 0 && { icon: '', label: 'Domaine', detail: `${clientLinks.client_domain}`, count: domain.length, color: 'cyan', items: domain },
              dirigeant.length > 0 && { icon: '', label: 'Dirigeant', detail: `${clientLinks.client_dirigeant}`, count: dirigeant.length, color: 'purple', items: dirigeant },
              groupProspects.length > 0 && { icon: '', label: 'Groupe', detail: `"${clientLinks.client_group}"`, count: groupProspects.length, color: 'amber', items: groupProspects },
              groupClients.length > 0 && { icon: '', label: 'Clients liés', detail: `${groupClients.length} client(s)`, count: groupClients.length, color: 'green', items: groupClients, isClients: true },
            ].filter(Boolean)

            return (
              <div className="mb-4 bg-[rgb(var(--c-info-bg))] border-2 border-[rgb(var(--c-info)/0.3)] rounded-ui p-3 sm:p-4">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg"></span>
                    <h3 className="font-bold text-[rgb(var(--c-info))] text-ui">Liens détectés</h3>
                    {sources.map((s, i) => (
                      <span key={i} className={`text-ui-sm px-2 py-0.5 rounded-full font-medium`} style={toneStyle(s.color)}>
                        {s.icon} {s.label}: {s.count}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {totalLinks > 0 && d.prospection && (
                      <>
                        {importable.length > 0 && d.modifier && (
                          <button onClick={importFromProspection}
                            className="flex items-center gap-1.5 btn btn-secondary text-ui-sm font-medium transition-colors">
                            <Save className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Importer & lier tout</span><span className="sm:hidden">Importer</span>
                          </button>
                        )}
                        <button onClick={() => markDejaClient()}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 text-gray-700 rounded-ui-sm hover:bg-gray-300 text-ui-sm font-medium transition-colors">
                           Marquer {uniqueSirens.length}
                        </button>
                      </>
                    )}
                    <button onClick={() => setLinksExpanded(!linksExpanded)}
                      className="p-1.5 hover:bg-[rgb(var(--c-info-bg))] rounded-ui-sm transition-colors text-[rgb(var(--c-info))]">
                      {linksExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Champs importables (SIREN) */}
                {importable.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {importable.map((item, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-ui-sm bg-white border border-[rgb(var(--c-info)/0.3)] rounded-full px-2.5 py-1 text-[rgb(var(--c-info))]">
                        <span className="font-medium text-[rgb(var(--c-info))]">{item.label}:</span> {item.value}
                      </span>
                    ))}
                  </div>
                )}

                {/* Détails dépliés */}
                {linksExpanded && (
                  <div className="space-y-3 pt-2 border-t border-[rgb(var(--c-info)/0.3)]">
                    {sources.map((source, si) => (
                      <div key={si}>
                        <p className="text-ui-sm font-bold text-gray-700 mb-1.5">
                          {source.icon} {source.label} - {source.detail}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {source.items.slice(0, 10).map((item, ii) => (
                            <div key={ii} className={`flex items-center justify-between bg-white rounded-ui-sm px-3 py-1.5 border text-ui-sm`} style={toneStyle(source.color, { bg: false, text: false, border: true })}>
                              <div className="min-w-0 flex-1">
                                <span className="font-medium text-gray-900 truncate block">
                                  {source.isClients ? (
                                    <Link to={`/clients/${item.id}`} className="text-primary-600 hover:underline">{item.name}</Link>
                                  ) : item.name}
                                </span>
                                <span className="text-gray-400">{item.city || item.postal_code || ''}{item.siren ? ` · ${item.siren}` : ''}</span>
                              </div>
                              {!source.isClients && item.phone && (
                                <span className="text-gray-500 ml-2">{item.phone}</span>
                              )}
                              {!source.isClients && d.prospection && (
                                <button onClick={() => markDejaClient([item.siren])}
                                  className="ml-2 text-[rgb(var(--c-success))] hover:text-[rgb(var(--c-success))] font-medium whitespace-nowrap">Déjà client</button>
                              )}
                            </div>
                          ))}
                          {source.items.length > 10 && (
                            <p className="text-ui-sm text-gray-400 col-span-full">+{source.items.length - 10} autre(s)</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {/* ══════ BANDEAU DÉJÀ LIÉ (si aucun lien restant) ══════ */}
          {clientLinks && !prospectionLoading && (() => {
            const total = (clientLinks.siren_matches?.length || 0) + (clientLinks.domain_matches?.length || 0) +
              (clientLinks.dirigeant_matches?.length || 0) + (clientLinks.group_prospect_matches?.length || 0)
            if (total > 0) return null // le bandeau ci-dessus gère
            const siren = clientLinks.client_siren
            if (!siren) return null
            return (
              <div className="mb-4 bg-[rgb(var(--c-success-bg))] border border-[rgb(var(--c-success)/0.3)] rounded-ui-sm px-4 py-2 flex items-center gap-2">
                <span className="text-ui"></span>
                <span className="text-ui-sm text-[rgb(var(--c-success))] font-medium">Tous les prospects liés sont marqués - file de prospection à jour</span>
              </div>
            )
          })()}

          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="text-ui-sm font-medium text-gray-500 mb-1 block">SIRET</label>
                <div className="flex gap-2">
                  <input value={editForm.siret || ''} onChange={e => setEditForm({ ...editForm, siret: e.target.value })} className="flex-1 px-3 py-2 border rounded-ui-sm text-ui" placeholder="SIRET" />
                  <button onClick={autoDetectOpco} disabled={detectingOpco || !(editForm.siret || '').replace(/\s/g, '')}
                    className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 text-white rounded-ui-sm hover:bg-primary-700 text-ui disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    title="Détecter OPCO et enrichir l'adresse">
                    {detectingOpco ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Détecter
                  </button>
                </div>
              </div>
              <div><label className="text-ui-sm font-medium text-gray-500 mb-1 flex items-center justify-between">N° TVA intracommunautaire
                  {pappersUrl(editForm.siret) && <a href={pappersUrl(editForm.siret)} target="_blank" rel="noopener noreferrer" className="text-ui-sm font-semibold text-primary-600 hover:underline">Voir sur Pappers</a>}
                </label>
                <div className="flex gap-2">
                  <input value={editForm.vat_exempt ? '' : (editForm.tva || '')} disabled={!!editForm.vat_exempt} onChange={e => setEditForm({ ...editForm, tva: e.target.value.toUpperCase() })} className="flex-1 min-w-0 px-3 py-2 border rounded-ui-sm text-ui font-mono disabled:bg-gray-50" placeholder={editForm.vat_exempt ? 'Non assujetti' : 'FR00000000000'} />
                  {!editForm.vat_exempt && tvaFromSiren(editForm.siret) && tvaFromSiren(editForm.siret) !== editForm.tva && (
                    <button type="button" onClick={() => setEditForm({ ...editForm, tva: tvaFromSiren(editForm.siret) })} className="px-3 py-2 border rounded-ui-sm text-ui-sm font-semibold hover:bg-gray-50 whitespace-nowrap">Calculer</button>
                  )}
                </div>
                <label className="flex items-center gap-2 mt-2 text-ui-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={!!editForm.vat_exempt} onChange={e => setEditForm({ ...editForm, vat_exempt: e.target.checked })} />
                  Non assujetti à la TVA
                </label></div>
              <div><label className="text-ui-sm font-medium text-gray-500 mb-1 block">Site web</label>
                <input value={editForm.website || ''} onChange={e => setEditForm({ ...editForm, website: e.target.value })} className="w-full px-3 py-2 border rounded-ui-sm text-ui" placeholder="www.example.fr" /></div>
              <div className="col-span-2"><label className="text-ui-sm font-medium text-gray-500 mb-1 block">Adresse</label>
                <input value={editForm.address || ''} onChange={e => setEditForm({ ...editForm, address: e.target.value })} className="w-full px-3 py-2 border rounded-ui-sm text-ui" /></div>
              <div><label className="text-ui-sm font-medium text-gray-500 mb-1 block">Code postal</label>
                <input value={editForm.postal_code || ''} onChange={e => setEditForm({ ...editForm, postal_code: e.target.value })} className="w-full px-3 py-2 border rounded-ui-sm text-ui" /></div>
              <div><label className="text-ui-sm font-medium text-gray-500 mb-1 block">Ville</label>
                <input value={editForm.city || ''} onChange={e => setEditForm({ ...editForm, city: e.target.value })} className="w-full px-3 py-2 border rounded-ui-sm text-ui" /></div>
              <div><label className="text-ui-sm font-medium text-gray-500 mb-1 block">Téléphone (contact principal)</label>
                <input value={editForm.contact_phone || ''} onChange={e => setEditForm({ ...editForm, contact_phone: e.target.value })} className="w-full px-3 py-2 border rounded-ui-sm text-ui" /></div>
              <div><label className="text-ui-sm font-medium text-gray-500 mb-1 block">Email (contact principal)</label>
                <input type="email" value={editForm.contact_email || ''} onChange={e => setEditForm({ ...editForm, contact_email: e.target.value })} className="w-full px-3 py-2 border rounded-ui-sm text-ui" /></div>
              <div className="col-span-2"><label className="text-ui-sm font-medium text-gray-500 mb-1 flex items-center justify-between">Notes <SpeechToTextButton onTranscript={(text) => setEditForm(f => ({ ...f, notes: f.notes ? f.notes + ' ' + text : text }))} /></label>
                <textarea value={editForm.notes || ''} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} rows={3} className="w-full px-3 py-2 border rounded-ui-sm text-ui" /></div>
              <div className="col-span-2"><label className="text-ui-sm font-medium text-gray-500 mb-1 block">OPCO</label>
                <select value={editForm.opco_name || ''} onChange={e => setEditForm({ ...editForm, opco_name: e.target.value || null })}
                  className="w-full px-3 py-2 border rounded-ui-sm text-ui">
                  <option value="">- Aucun OPCO -</option>
                  {OPCO_LIST.map(o => <option key={o} value={o}>{o}</option>)}
                  {editForm.opco_name && !OPCO_LIST.includes(editForm.opco_name) && (
                    <option value={editForm.opco_name}>{editForm.opco_name} (détecté)</option>
                  )}
                </select>
              </div>
              
              {/* Groupe */}
              <div className="col-span-2">
                <label className="text-ui-sm font-medium text-gray-500 mb-1 block"> Groupe (pour lier des sociétés distinctes)</label>
                <div className="flex gap-2">
                  <input value={editForm.group_name || ''} onChange={e => setEditForm({ ...editForm, group_name: e.target.value || null })}
                    className="flex-1 px-3 py-2 border rounded-ui-sm text-ui" placeholder="Ex: Groupe Vert, Westerly Sport Group..." />
                  {editForm.group_name && (
                    <button onClick={() => setEditForm({ ...editForm, group_name: null })}
                      className="px-2 py-1 text-[rgb(var(--c-danger))] hover:text-[rgb(var(--c-danger))] transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <p className="text-ui-sm text-gray-400 mt-0.5">Clients avec le même nom de groupe sont liés automatiquement. Les prospects contenant ce nom dans prospection_massive sont aussi détectés.</p>
              </div>

              {/* Type de client */}
              <div className="col-span-2">
                <label className="text-ui-sm font-medium text-gray-500 mb-2 block">Type de client</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: 'entreprise', label: 'Entreprise', active: 'bg-[rgb(var(--c-info))] text-white', inactive: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))] hover:bg-[rgb(var(--c-info-bg))]' },
                    { value: 'organisme_formation', label: 'Organisme de formation', active: 'bg-gray-700 text-white', inactive: 'bg-gray-50 text-gray-800 hover:bg-gray-100' },
                    { value: 'public', label: 'Établissement public', active: 'bg-gray-700 text-white', inactive: 'bg-gray-50 text-gray-800 hover:bg-gray-100' },
                    { value: 'opco', label: 'OPCO', active: 'bg-[rgb(var(--c-warning))] text-white', inactive: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] hover:bg-[rgb(var(--c-warning-bg))]' },
                    { value: 'particulier', label: 'Particulier', active: 'bg-gray-700 text-white', inactive: 'bg-gray-100 text-gray-700 hover:bg-gray-200' },
                  ].map(s => (
                    <button key={s.value} type="button" onClick={() => setEditForm(s.value === 'particulier' ? { ...editForm, client_type: s.value, vat_exempt: true } : { ...editForm, client_type: s.value })}
                      className={`px-3 py-1.5 rounded-full text-ui font-medium transition-colors ${editForm.client_type === s.value ? s.active : s.inactive}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Préférences facturation */}
              <div className="col-span-2 bg-gray-50 rounded-ui-sm p-4 space-y-3">
                <h4 className="text-ui-sm font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5" /> Préférences de facturation
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-ui-sm text-gray-500 mb-1 block">Mode de facturation</label>
                    <select value={editForm.billing_mode || 'per_session'} onChange={e => setEditForm({ ...editForm, billing_mode: e.target.value })}
                      className="w-full px-3 py-2 border rounded-ui-sm text-ui">
                      <option value="per_session"> Après chaque session</option>
                      <option value="monthly"> Fin de mois (groupée)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-ui-sm text-gray-500 mb-1 block">Délai de paiement</label>
                    <select value={editForm.default_payment_terms || 'à 30 jours'} onChange={e => setEditForm({ ...editForm, default_payment_terms: e.target.value })}
                      className="w-full px-3 py-2 border rounded-ui-sm text-ui">
                      <option value="À réception de facture">À réception</option>
                      <option value="à 30 jours">30 jours</option>
                      <option value="à 45 jours">45 jours</option>
                      <option value="à 60 jours">60 jours</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-ui-sm text-gray-500 mb-1 block">Email facturation <span className="text-gray-400">(si différent)</span></label>
                    <input type="email" value={editForm.billing_email || ''} onChange={e => setEditForm({ ...editForm, billing_email: e.target.value })}
                      className="w-full px-3 py-2 border rounded-ui-sm text-ui" placeholder="compta@client.fr" />
                  </div>
                  {editForm.client_type === 'public' && (
                    <div>
                      <label className="text-ui-sm text-gray-500 mb-1 block">Code service Chorus Pro <span className="text-gray-400">(si l'entité l'exige)</span></label>
                      <input value={editForm.chorus_service_code || ''} onChange={e => setEditForm({ ...editForm, chorus_service_code: e.target.value })}
                        className="w-full px-3 py-2 border rounded-ui-sm text-ui font-mono" placeholder="Annuaire Chorus Pro" />
                      <label className="flex items-center gap-2 mt-2 text-ui-sm text-gray-600">
                        <input type="checkbox" checked={!!editForm.chorus_engagement_required} onChange={e => setEditForm({ ...editForm, chorus_engagement_required: e.target.checked })} />
                        Numéro d'engagement ou bon de commande exigé
                      </label>
                    </div>
                  )}
                  {editForm.client_type === 'organisme_formation' && (
                    <div>
                      <label className="text-ui-sm text-gray-500 mb-1 block">Envoi satisfaction donneur d'ordre</label>
                      <select value={editForm.satisfaction_mode || 'after_session'} onChange={e => setEditForm({ ...editForm, satisfaction_mode: e.target.value })}
                        className="w-full px-3 py-2 border rounded-ui-sm text-ui">
                        <option value="after_session">Après chaque session</option>
                        <option value="monthly">Fin de mois</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-y-3 gap-x-6 text-ui">
              {client.address && (
                <div className="flex items-start gap-2"><MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <span className="text-gray-700">{client.address}{(client.postal_code || client.city) ? ', ' + [client.postal_code, client.city].filter(Boolean).join(' ') : ''}</span></div>
              )}
              {client.contact_phone && (
                <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-gray-400 shrink-0" />
                  <a href={'tel:' + client.contact_phone} className="text-primary-600 hover:underline">{client.contact_phone}</a></div>
              )}
              {client.contact_email && (
                <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-gray-400 shrink-0" />
                  <a href={'mailto:' + client.contact_email} className="text-primary-600 hover:underline truncate">{client.contact_email}</a></div>
              )}
              {/* Badge + toggle do_not_mail */}
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleDoNotMail}
                  disabled={!d.modifier}
                  title={client.do_not_mail ? 'Cliquer pour réactiver le mailing' : 'Cliquer pour désactiver le mailing'}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-ui-sm font-medium border transition-colors disabled:cursor-default ${
                    client.do_not_mail
                      ? 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))] border-[rgb(var(--c-danger)/0.3)] hover:bg-[rgb(var(--c-danger-bg))]'
                      : 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] border-[rgb(var(--c-success)/0.3)] hover:bg-[rgb(var(--c-success-bg))]'
                  }`}
                >
                  {client.do_not_mail ? ' Mailing désactivé' : ' Mailing actif'}
                </button>
              </div>
              {client.website && (
                <div className="flex items-center gap-2"><Globe className="w-4 h-4 text-gray-400 shrink-0" />
                  <a href={client.website.startsWith('http') ? client.website : 'https://' + client.website} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline truncate">{client.website}</a></div>
              )}
              {client.notes && (
                <div className="col-span-full mt-2 bg-gray-50 rounded-ui-sm p-3 text-gray-600"><p className="whitespace-pre-wrap">{client.notes}</p></div>
              )}
              {client.opco_name && (
                <div className="flex items-center gap-2"><Briefcase className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="text-gray-700">OPCO : <strong>{client.opco_name}</strong></span></div>
              )}
              {client.group_name && (
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-ui-sm font-medium bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]"> {client.group_name}</span>
                </div>
              )}
              {client.client_type && client.client_type !== 'entreprise' && (
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-ui-sm font-medium ${
                    client.client_type === 'organisme_formation' ? 'bg-gray-100 text-gray-800' :
                    client.client_type === 'public' ? 'bg-gray-100 text-gray-800' :
                    client.client_type === 'opco' ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {client.client_type === 'organisme_formation' ? ' Organisme de formation' :
                     client.client_type === 'public' ? ' Établissement public' :
                     client.client_type === 'opco' ? ' OPCO' :
                     client.client_type === 'particulier' ? ' Particulier' : client.client_type}
                  </span>
                </div>
              )}
              {/* Préférences facturation - toujours affichées si non par défaut */}
              {(client.billing_mode === 'monthly' || client.default_payment_terms !== 'à 30 jours' || client.billing_email) && (
                <div className="col-span-full mt-2 bg-[rgb(var(--c-info-bg))] rounded-ui-sm p-3 text-ui">
                  <p className="text-ui-sm font-semibold text-[rgb(var(--c-info))] mb-1.5 flex items-center gap-1"><CreditCard className="w-3.5 h-3.5" /> Facturation</p>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-[rgb(var(--c-info))]">
                    <span>{client.billing_mode === 'monthly' ? ' Fin de mois (groupée)' : ' Après chaque session'}</span>
                    <span>Délai : {client.default_payment_terms || '30 jours'}</span>
                    {client.billing_email && <span>Email compta : {client.billing_email}</span>}
                    {client.client_type === 'organisme_formation' && client.satisfaction_mode === 'monthly' && (
                      <span>Satisfaction : fin de mois</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t bg-gray-50/50 px-4 sm:px-6 py-3">
          {inactivityAlert && (
            <div className="mb-3 flex items-center gap-2 text-ui-sm text-[rgb(var(--c-warning))] bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] rounded-ui-sm px-3 py-2">
              <span className="text-base"></span>
              <span>Inactif depuis <strong>{daysSinceLastContact} jours</strong> - aucune session prévue</span>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-center text-ui">
            <div>
              <span className="text-xl font-bold text-primary-600">{contacts.length}</span>
              <p className="text-gray-500 text-ui-sm mt-0.5">Contacts</p>
            </div>
            <div>
              <span className="text-xl font-bold text-[rgb(var(--c-success))]">{formations.length}</span>
              <p className="text-gray-500 text-ui-sm mt-0.5">Sessions</p>
            </div>
            <div>
              <span className="text-xl font-bold text-[rgb(var(--c-warning))]">{rdvs.length}</span>
              <p className="text-gray-500 text-ui-sm mt-0.5">RDV</p>
            </div>
            <div>
              <span className="text-xl font-bold text-[rgb(var(--c-info))]">{clientQuotes.length}</span>
              <p className="text-gray-500 text-ui-sm mt-0.5">Devis</p>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <span className="text-xl font-bold text-gray-800">
                {caFacture > 0 ? caFacture.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }) : '-'}
              </span>
              <p className="text-gray-500 text-ui-sm mt-0.5">CA facturé TTC</p>
            </div>
          </div>
        </div>
      </div>

      {/* ══════ PROCHAINE ACTION STICKY ══════ */}
      {nextActionRdv && (
        <div className="bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] rounded-ui px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg flex-shrink-0"></span>
            <div className="min-w-0">
              <p className="text-ui-sm font-semibold text-[rgb(var(--c-warning))] uppercase tracking-wide">Prochaine action</p>
              <p className="text-ui font-medium text-[rgb(var(--c-warning))] truncate">{nextActionRdv.next_action}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {nextActionRdv.next_action_date && (
              <span className="text-ui-sm bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] px-2.5 py-1 rounded-full font-medium">
                {format(new Date(nextActionRdv.next_action_date), 'dd MMM yyyy', { locale: fr })}
              </span>
            )}
            <Link to={`/prospection/${nextActionRdv.id}`}
              className="text-ui-sm text-[rgb(var(--c-warning))] hover:text-[rgb(var(--c-warning))] underline">
              Voir RDV →
            </Link>
          </div>
        </div>
      )}

      {/* ══════ ACTIONS RAPIDES ══════ */}
      {(d.devis || d.prospection || d.session) && (
      <div className="flex flex-wrap gap-2">
        {d.devis && (
          <button
            onClick={() => navigate(`/devis?client_id=${id}`)}
            className="flex items-center gap-1.5 btn btn-secondary text-ui font-medium shadow-sm transition-colors">
            <FileText className="w-4 h-4" /> Nouveau devis
          </button>
        )}
        {d.prospection && (
          <button
            onClick={() => navigate('/prospection/nouveau?client_id=' + id)}
            className="flex items-center gap-1.5 btn btn-secondary text-ui font-medium shadow-sm transition-colors">
            <Calendar className="w-4 h-4" /> Nouveau RDV
          </button>
        )}
        {d.session && (
          <button
            onClick={() => navigate('/sessions', { state: { openNew: true, client_id: id } })}
            className="flex items-center gap-1.5 btn btn-secondary text-ui font-medium shadow-sm transition-colors">
            <GraduationCap className="w-4 h-4" /> Créer une session
          </button>
        )}
      </div>
      )}

      {/* ══════ 2 COLONNES ══════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">

        {/* ──── GAUCHE : Contacts + RDV ──── */}
        <div className="lg:col-span-1 space-y-6">

          <div className="bg-white rounded-ui border border-gray-200">
            <button onClick={() => setSections(s => ({ ...s, contacts: !s.contacts }))}
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 rounded-t-xl">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-primary-600" />
                <h2 className="font-semibold text-gray-900">Contacts</h2>
                <span className="text-ui-sm bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{contacts.length}</span>
              </div>
              {sections.contacts ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>

            {sections.contacts && (
              <div className="px-5 pb-4 space-y-2">
                {contacts.map(c => (
                  <div key={c.id} className="group relative flex items-start justify-between p-3 bg-gray-50 rounded-ui-sm hover:bg-gray-100 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-medium text-gray-900">{c.name}</p>
                        {c.is_primary && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] text-ui-sm rounded font-medium" title="Contact principal">
                            <Star className="w-3 h-3 fill-[rgb(var(--c-warning))]" /> Principal
                          </span>
                        )}
                        {c.is_document_contact && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))] text-ui-sm rounded font-medium" title="Apparaît sur les documents">
                            <FileSignature className="w-3 h-3" /> Documents
                          </span>
                        )}
                        {c.is_billing && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] text-ui-sm rounded font-medium" title="Contact facturation">
                             Facturation
                          </span>
                        )}
                      </div>
                      {c.role && <p className="text-ui-sm text-primary-600 font-medium mt-0.5">{c.role}</p>}
                      <div className="flex flex-col gap-0.5 mt-1">
                        {c.email && <a href={'mailto:' + c.email} className="text-ui-sm text-gray-500 hover:text-primary-600 truncate"> {c.email}</a>}
                        {c.phone && <a href={'tel:' + c.phone} className="text-ui-sm text-gray-500 hover:text-primary-600"> {c.phone}</a>}
                      </div>
                    </div>
                    <div className="flex gap-0.5 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0 ml-2">
                      {vcardAllowed && <button onClick={() => exportContactVCard(c)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded hover:bg-white" title="Enregistrer sur le téléphone (vCard)"><Smartphone className="w-3.5 h-3.5" /></button>}
                      {d.modifier && <button onClick={() => openEditContact(c)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded hover:bg-white" title="Modifier"><Edit className="w-3.5 h-3.5" /></button>}
                      {d.modifier && <button onClick={() => deleteContact(c.id)} className="p-1.5 text-gray-400 hover:text-[rgb(var(--c-danger))] rounded hover:bg-white" title="Supprimer"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>
                ))}

                {contacts.length === 0 && <p className="text-ui text-gray-400 text-center py-3">Aucun contact enregistré</p>}

                {vcardAllowed && (contacts.length > 0 || clientAsContact(client)) && (
                  <button onClick={exportAllContactsVCard}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-ui text-gray-600 hover:bg-gray-100 rounded-ui-sm border border-gray-200 transition-colors">
                    <Smartphone className="w-4 h-4" /> Exporter vers le téléphone (vCard)
                  </button>
                )}

                {d.modifier && (
                  <button onClick={() => { setEditingContact(null); setContactForm({ name: '', role: '', email: '', phone: '', is_primary: false, is_document_contact: false, is_billing: false }); setShowContactForm(true) }}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 text-ui text-primary-600 hover:bg-primary-50 rounded-ui-sm border border-dashed border-primary-300 transition-colors">
                    <Plus className="w-4 h-4" /> Ajouter un contact
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ──── Accès entreprise : lien + code pour consulter les documents ──── */}
          <div className="bg-white rounded-ui border border-gray-200">
            <div className="flex items-center gap-2 px-5 py-3.5">
              <KeyRound className="w-5 h-5 text-primary-600" />
              <h2 className="font-semibold text-gray-900">Accès entreprise</h2>
              {portalAccess && (
                <span className={`text-ui-sm px-2 py-0.5 rounded-full ${portalAccess.is_active ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : 'bg-gray-100 text-gray-500'}`}>
                  {portalAccess.is_active ? 'Actif' : 'Désactivé'}
                </span>
              )}
            </div>
            <div className="px-5 pb-4">
              {!portalAccess ? (
                <>
                  <p className="text-ui-sm text-gray-500 mb-3">Donne au client un lien et un code pour consulter ses sessions et télécharger ses documents (convention, convocations, émargement, attestations, certificats).</p>
                  {d.espace && (
                    <button onClick={createPortalAccess} disabled={portalBusy}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 text-ui text-primary-600 hover:bg-primary-50 rounded-ui-sm border border-dashed border-primary-300 transition-colors">
                      {portalBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Créer l'accès
                    </button>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-ui-sm">
                    <span className="text-ui-sm text-gray-500 w-10 shrink-0">Lien</span>
                    <a href={portalUrl} target="_blank" rel="noopener noreferrer" className="text-ui-sm text-primary-600 truncate flex-1 hover:underline">{portalUrl}</a>
                    <button onClick={() => copyText(portalUrl, 'Lien')} className="p-1.5 text-gray-400 hover:text-primary-600 rounded hover:bg-white" title="Copier le lien"><Copy className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-ui-sm">
                    <span className="text-ui-sm text-gray-500 w-10 shrink-0">Code</span>
                    <span className="font-mono text-base tracking-[0.3em] text-gray-900 flex-1">{portalAccess.access_code}</span>
                    <button onClick={() => copyText(portalAccess.access_code, 'Code')} className="p-1.5 text-gray-400 hover:text-primary-600 rounded hover:bg-white" title="Copier le code"><Copy className="w-3.5 h-3.5" /></button>
                    {d.espace && <button onClick={() => updatePortalAccess({ access_code: newCode(), attempts: 0, locked_until: null }, 'Nouveau code généré')} disabled={portalBusy} className="p-1.5 text-gray-400 hover:text-primary-600 rounded hover:bg-white" title="Générer un nouveau code"><RefreshCw className="w-3.5 h-3.5" /></button>}
                  </div>
                  <div className="flex items-center justify-between text-ui-sm text-gray-400 pt-1">
                    <span>{portalAccess.last_access_at ? `Dernier accès le ${format(new Date(portalAccess.last_access_at), 'd MMM yyyy à HH:mm', { locale: fr })}` : 'Jamais consulté'}{portalAccess.locked_until && new Date(portalAccess.locked_until) > new Date() ? ' (verrouillé après 5 échecs)' : ''}</span>
                    {d.espace && (
                      <button onClick={() => updatePortalAccess({ is_active: !portalAccess.is_active }, portalAccess.is_active ? 'Accès désactivé' : 'Accès réactivé')} disabled={portalBusy}
                        className={`flex items-center gap-1 ${portalAccess.is_active ? 'text-[rgb(var(--c-danger))] hover:text-[rgb(var(--c-danger))]' : 'text-[rgb(var(--c-success))] hover:text-[rgb(var(--c-success))]'}`}>
                        <Power className="w-3.5 h-3.5" /> {portalAccess.is_active ? 'Désactiver' : 'Réactiver'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {rdvs.length > 0 && (
            <div className="bg-white rounded-ui border border-gray-200">
              <div className="flex items-center gap-2 px-5 py-3.5">
                <Briefcase className="w-5 h-5 text-[rgb(var(--c-warning))]" />
                <h2 className="font-semibold text-gray-900">RDV commerciaux</h2>
                <span className="text-ui-sm bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] px-2 py-0.5 rounded-full">{rdvs.length}</span>
              </div>
              <div className="px-5 pb-4 space-y-2">
                {rdvs.map(r => (
                  <Link key={r.id} to={`/prospection/${r.id}`} className="block p-3 bg-gray-50 rounded-ui-sm hover:bg-gray-100 transition-colors text-ui">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{r.rdv_date ? format(new Date(r.rdv_date), 'dd MMM yyyy', { locale: fr }) : 'Date à fixer'}</span>
                      <span className={'px-2 py-0.5 rounded text-ui-sm font-medium ' + (r.status === 'realise' ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : r.status === 'annule' ? 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]' : 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]')}>
                        {r.status === 'realise' ? ' Réalisé' : r.status === 'annule' ? ' Annulé' : ' À prendre'}
                      </span>
                    </div>
                    {r.conducted_by && <p className="text-gray-500 text-ui-sm mt-1">Par {r.conducted_by}</p>}
                    {r.notes && <p className="text-gray-600 text-ui-sm mt-1 line-clamp-2">{r.notes}</p>}
                    {r.next_action && <p className="text-[rgb(var(--c-warning))] text-ui-sm mt-1 font-medium"> {r.next_action}</p>}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ──── DROITE : Timeline + Formations ──── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Timeline CRM */}
          <div className="bg-white rounded-ui border border-gray-200">
            <button onClick={() => setSections(s => ({ ...s, timeline: !s.timeline }))}
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 rounded-t-xl">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-[rgb(var(--c-info))]" />
                <h2 className="font-semibold text-gray-900">Historique des échanges</h2>
                <span className="text-ui-sm bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))] px-2 py-0.5 rounded-full">{timeline.length}</span>
              </div>
              {sections.timeline ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>

            {sections.timeline && (
              <div className="px-5 pb-4">
                {(d.historique || d.prospection) && (
                <div className="flex gap-2 mb-3">
                  {d.historique && (
                    <button onClick={() => { setShowInteractionForm(!showInteractionForm); setShowEmailForm(false) }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-ui text-[rgb(var(--c-info))] hover:bg-[rgb(var(--c-info-bg))] rounded-ui-sm border border-dashed border-[rgb(var(--c-info)/0.3)] transition-colors">
                      <Plus className="w-4 h-4" /> Ajouter une interaction
                    </button>
                  )}
                  {/* Envoi par la route des emails de prospection (mêmes rôles que « Prospecter ») */}
                  {d.prospection && (
                    <button onClick={() => { openEmailForm(); setShowInteractionForm(false) }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-ui text-[rgb(var(--c-success))] hover:bg-[rgb(var(--c-success-bg))] rounded-ui-sm border border-dashed border-[rgb(var(--c-success)/0.3)] transition-colors">
                      <Mail className="w-4 h-4" /> Envoyer un email
                    </button>
                  )}
                </div>
                )}

                {/* ── Formulaire email direct ── */}
                {showEmailForm && (
                  <div className="bg-[rgb(var(--c-success-bg))] border border-[rgb(var(--c-success)/0.3)] rounded-ui-sm p-4 mb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-ui font-semibold text-[rgb(var(--c-success))]"> Envoyer un email</h3>
                      <button onClick={() => setShowEmailForm(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                    </div>

                    {/* Destinataire */}
                    <div>
                      <label className="text-ui-sm font-medium text-gray-500 mb-1 block">Destinataire</label>
                      {contacts.filter(c => c.email).length > 0 ? (
                        <select value={emailForm.to} onChange={e => setEmailForm(f => ({ ...f, to: e.target.value }))}
                          className="w-full px-3 py-2 border rounded-ui-sm text-ui bg-white">
                          <option value="">- Choisir un contact -</option>
                          {contacts.filter(c => c.email).map(c => (
                            <option key={c.id} value={c.email}>{c.name} - {c.email} {c.is_primary ? '' : ''}</option>
                          ))}
                          {client?.contact_email && !contacts.find(c => c.email === client.contact_email) && (
                            <option value={client.contact_email}>{client.contact_email} (fiche client)</option>
                          )}
                        </select>
                      ) : (
                        <input type="email" value={emailForm.to} onChange={e => setEmailForm(f => ({ ...f, to: e.target.value }))}
                          placeholder="email@exemple.com" className="w-full px-3 py-2 border rounded-ui-sm text-ui" />
                      )}
                    </div>

                    {/* Expéditeur */}
                    <div>
                      <label className="text-ui-sm font-medium text-gray-500 mb-1.5 block">Expéditeur</label>
                      <div className="flex gap-1.5">
                        {teamFirstNames().map(name => (
                          <button key={name} onClick={() => setEmailForm(f => ({ ...f, sender: name }))}
                            className={'px-3 py-1.5 rounded-ui-sm text-ui-sm font-medium border transition-all ' +
                              (emailForm.sender === name ? 'bg-[rgb(var(--c-success))] text-white border-[rgb(var(--c-success)/0.3)]' : 'bg-white text-gray-600 border-gray-200 hover:border-[rgb(var(--c-success)/0.3)]')}>
                            {name}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Brief IA */}
                    <div>
                      <label className="text-ui-sm font-medium text-gray-500 mb-1 flex items-center justify-between">
                         Décrivez votre email en quelques mots
                        <SpeechToTextButton onTranscript={(text) => setEmailForm(f => ({ ...f, brief: f.brief ? f.brief + ' ' + text : text }))} />
                      </label>
                      <div className="flex gap-2">
                        <textarea value={emailForm.brief} onChange={e => setEmailForm(f => ({ ...f, brief: e.target.value }))}
                          placeholder="Ex: Relancer pour le devis SST, proposer une date en mars..."
                          rows={2} className="flex-1 px-3 py-2 border rounded-ui-sm text-ui" />
                        <button onClick={generateEmailIA} disabled={emailGenerating}
                          className="px-4 py-2 bg-gray-50 text-white rounded-ui-sm text-ui-sm font-medium hover:from-purple-600 hover:to-indigo-600 disabled:opacity-50 whitespace-nowrap flex items-center gap-1.5">
                          {emailGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : ''} Générer
                        </button>
                      </div>
                    </div>

                    {/* Objet */}
                    <div>
                      <label className="text-ui-sm font-medium text-gray-500 mb-1 block">Objet</label>
                      <input value={emailForm.subject} onChange={e => setEmailForm(f => ({ ...f, subject: e.target.value }))}
                        placeholder="Objet de l'email..." className="w-full px-3 py-2 border rounded-ui-sm text-ui" />
                    </div>

                    {/* Corps */}
                    <div>
                      <label className="text-ui-sm font-medium text-gray-500 mb-1 flex items-center justify-between">
                        Corps du message
                        <SpeechToTextButton onTranscript={(text) => setEmailForm(f => ({ ...f, body: f.body ? f.body + ' ' + text : text }))} />
                      </label>
                      <textarea value={emailForm.body} onChange={e => setEmailForm(f => ({ ...f, body: e.target.value }))}
                        placeholder="Le contenu de votre email..."
                        rows={6} className="w-full px-3 py-2 border rounded-ui-sm text-ui" />
                      <p className="text-ui-sm text-gray-400 mt-1">La signature sera ajoutée automatiquement depuis votre compte email.</p>
                    </div>

                    {/* Pièces jointes */}
                    <div>
                      <label className="text-ui-sm font-medium text-gray-500 mb-1 flex items-center gap-1.5">
                        <Paperclip className="w-3.5 h-3.5" /> Pièces jointes
                      </label>
                      <div className="space-y-1.5">
                        {emailAttachments.map((att, idx) => (
                          <div key={idx} className="flex items-center gap-2 bg-white border rounded-ui-sm px-3 py-1.5 text-ui-sm">
                            <Paperclip className="w-3 h-3 text-gray-400 flex-shrink-0" />
                            <span className="truncate flex-1">{att.name}</span>
                            <span className="text-gray-400 flex-shrink-0">{(att.size / 1024).toFixed(0)} Ko</span>
                            <button onClick={() => removeAttachment(idx)} className="text-[rgb(var(--c-danger))] hover:text-[rgb(var(--c-danger))] flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ))}
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-ui-sm text-gray-500 bg-white border border-dashed border-gray-300 rounded-ui-sm cursor-pointer hover:border-[rgb(var(--c-success)/0.3)] hover:text-[rgb(var(--c-success))] transition-colors">
                          <Plus className="w-3.5 h-3.5" /> Ajouter un fichier
                          <input type="file" multiple onChange={handleEmailAttachments} className="hidden"
                            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.zip" />
                        </label>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button onClick={() => setShowEmailForm(false)} className="px-3 py-1.5 text-ui text-gray-500 hover:text-gray-700">Annuler</button>
                      <button onClick={sendClientEmail} disabled={emailSending || !emailForm.to || !emailForm.subject || !emailForm.body}
                        className="flex items-center gap-1.5 btn btn-secondary text-ui hover:bg-[rgb(var(--c-success))] shadow-sm disabled:opacity-50">
                        {emailSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Envoyer
                      </button>
                    </div>
                  </div>
                )}

                {showInteractionForm && (
                  <div className="bg-[rgb(var(--c-info-bg))] border border-[rgb(var(--c-info)/0.3)] rounded-ui-sm p-4 mb-4 space-y-3">
                    <div>
                      <label className="text-ui-sm font-medium text-gray-500 mb-1.5 block">Type</label>
                      <div className="flex gap-1.5 flex-wrap">
                        {INTERACTION_TYPES.map(t => (
                          <button key={t.value} onClick={() => setInteractionForm(f => ({ ...f, type: t.value }))}
                            className={'px-3 py-1.5 rounded-ui-sm text-ui-sm font-medium border transition-all ' +
                              (interactionForm.type === t.value ? 'bg-[rgb(var(--c-info))] text-white border-[rgb(var(--c-info)/0.3)] shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-[rgb(var(--c-info)/0.3)]')}>
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-500 mb-1 block">Titre (optionnel)</label>
                      <input value={interactionForm.title} onChange={e => setInteractionForm(f => ({ ...f, title: e.target.value }))}
                        placeholder="Ex: Relance devis SST, Appel RH, ..." className="w-full px-3 py-2 border rounded-ui-sm text-ui" />
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-500 mb-1 flex items-center justify-between">Détails <SpeechToTextButton onTranscript={(text) => setInteractionForm(f => ({ ...f, content: f.content ? f.content + ' ' + text : text }))} /></label>
                      <textarea value={interactionForm.content} onChange={e => setInteractionForm(f => ({ ...f, content: e.target.value }))}
                        placeholder="Résumé de l'échange, décisions prises, prochaines étapes..." rows={4} className="w-full px-3 py-2 border rounded-ui-sm text-ui" />
                    </div>
                    <div className="flex items-end justify-between pt-1">
                      <div>
                        <label className="text-ui-sm font-medium text-gray-500 mb-1.5 block">Saisi par</label>
                        <div className="flex gap-1.5">
                          {teamFirstNames().map(name => (
                            <button key={name} onClick={() => setInteractionForm(f => ({ ...f, author: name }))}
                              className={'px-3 py-1.5 rounded-ui-sm text-ui-sm font-medium border transition-all ' +
                                (interactionForm.author === name ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300')}>
                              {name}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setShowInteractionForm(false)} className="px-3 py-1.5 text-ui text-gray-500 hover:text-gray-700">Annuler</button>
                        <button onClick={saveInteraction} className="flex items-center gap-1.5 btn btn-secondary text-ui hover:bg-[rgb(var(--c-info))] shadow-sm">
                          <Send className="w-3.5 h-3.5" /> Enregistrer
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {timeline.length === 0 ? (
                  <p className="text-ui text-gray-400 text-center py-6">Aucun échange enregistré</p>
                ) : (
                  <div className="relative">
                    <div className="absolute left-[13px] top-3 bottom-3 w-px bg-gray-200" />
                    <div className="space-y-0.5">
                      {timeline.map(item => {
                        const typeInfo = INTERACTION_TYPES.find(t => t.value === item.type) || INTERACTION_TYPES[0]
                        const IconComp = typeInfo.icon
                        const sourceBadge = {
                          phoning: { label: 'Prospection', cls: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' },
                          email: { label: 'Application', cls: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]' },
                          session_email: { label: 'Email session', cls: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]' },
                          session: { label: 'Formation', cls: 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' },
                          rdv: { label: 'RDV', cls: 'bg-gray-100 text-gray-800' },
                          quote: { label: 'Devis', cls: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]' },
                          invoice: { label: 'Facture', cls: 'bg-gray-100 text-gray-800' },
                        }[item.source]
                        return (
                          <div key={item.id} className="group relative flex gap-3 py-2.5 pl-0.5">
                            <div className={'relative z-10 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ring-2 ring-white ' + typeInfo.color}>
                              <IconComp className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {item.link ? (
                                  <Link to={item.link} className="font-medium text-ui text-primary-700 hover:underline">{item.title}</Link>
                                ) : (
                                  <span className="font-medium text-ui text-gray-900">{item.title}</span>
                                )}
                                {sourceBadge && (
                                  <span className={'text-ui-sm px-1.5 py-0.5 rounded font-medium ' + sourceBadge.cls}>{sourceBadge.label}</span>
                                )}
                                <span className="text-ui-sm text-gray-400 ml-auto shrink-0">
                                  {item.author && <span className="font-medium text-gray-500">{item.author}</span>}
                                  {item.author && ' · '}
                                  {item.date && !isNaN(new Date(item.date)) ? format(new Date(item.date), 'dd MMM yyyy', { locale: fr }) : ''}
                                </span>
                              </div>
                              {item.content && <p className="text-ui text-gray-600 mt-0.5 whitespace-pre-line leading-relaxed">{item.content}</p>}
                            </div>
                            {item.deletable && d.supprimer && (
                              <button onClick={() => deleteInteraction(item.rawId)} className="p-1 text-gray-300 hover:text-[rgb(var(--c-danger))] shrink-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Formations */}
          <div className="bg-white rounded-ui border border-gray-200">
            <button onClick={() => setSections(s => ({ ...s, formations: !s.formations }))}
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 rounded-t-xl">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-[rgb(var(--c-success))]" />
                <h2 className="font-semibold text-gray-900">Formations</h2>
                <span className="text-ui-sm bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] px-2 py-0.5 rounded-full">{formations.length}</span>
              </div>
              {sections.formations ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>

            {sections.formations && (
              <div className="px-5 pb-4 space-y-4">
                {upcomingSessions.length > 0 && (
                  <div>
                    <h3 className="text-ui-sm font-semibold text-[rgb(var(--c-success))] uppercase tracking-wide mb-2"> À venir / En cours</h3>
                    <div className="space-y-2">
                      {upcomingSessions.map(s => (
                        <Link key={s.id} to={'/sessions/' + s.id} className="block p-3 bg-[rgb(var(--c-success-bg))] border border-[rgb(var(--c-success)/0.3)] rounded-ui-sm hover:bg-[rgb(var(--c-success-bg))] transition-colors">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-gray-900 text-ui">{s.courses?.title || s.reference}</p>
                              <p className="text-ui-sm text-gray-500 mt-0.5">
                                {s.start_date ? format(new Date(s.start_date), 'dd MMM', { locale: fr }) : '?'} - {s.end_date ? format(new Date(s.end_date), 'dd MMM yyyy', { locale: fr }) : '?'}
                              </p>
                            </div>
                            <div className="text-right">
                              <span className={'px-2 py-0.5 rounded text-ui-sm font-medium ' + (s.status === 'in_progress' ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : s.status === 'draft' ? 'bg-gray-100 text-gray-600' : 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]')}>
                                {s.status === 'in_progress' ? ' En cours' : s.status === 'draft' ? ' Brouillon' : ' Planifiée'}
                              </span>
                              {s.session_trainees?.length > 0 && <p className="text-ui-sm text-gray-400 mt-1">{s.session_trainees.length} stagiaire{s.session_trainees.length > 1 ? 's' : ''}</p>}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {pastSessions.length > 0 && (
                  <div>
                    <h3 className="text-ui-sm font-semibold text-gray-500 uppercase tracking-wide mb-2"> Historique</h3>
                    <div className="space-y-2">
                      {pastSessions.map(s => (
                        <Link key={s.id} to={'/sessions/' + s.id} className="block p-3 bg-gray-50 rounded-ui-sm hover:bg-gray-100 transition-colors">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-gray-900 text-ui">{s.courses?.title || s.reference}</p>
                              <p className="text-ui-sm text-gray-500 mt-0.5">
                                {s.start_date ? format(new Date(s.start_date), 'dd MMM', { locale: fr }) : '?'} - {s.end_date ? format(new Date(s.end_date), 'dd MMM yyyy', { locale: fr }) : '?'}
                              </p>
                              {s.session_trainees?.length > 0 && (
                                <p className="text-ui-sm text-gray-400 mt-0.5">
                                  {s.session_trainees.map(st => st.trainees ? st.trainees.first_name + ' ' + st.trainees.last_name : '').filter(Boolean).join(', ')}
                                </p>
                              )}
                            </div>
                            <span className={'px-2 py-0.5 rounded text-ui-sm font-medium ' + (s.status === 'completed' ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]')}>
                              {s.status === 'completed' ? ' Terminée' : ' Annulée'}
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {formations.length === 0 && <p className="text-ui text-gray-400 text-center py-4">Aucune formation</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══════ MODAL CONTACT ══════ */}
      {showContactForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={closeContactForm} />
          <div className="relative bg-white rounded-ui shadow-md w-full max-w-md p-4 sm:p-6 mx-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">{editingContact ? 'Modifier le contact' : 'Nouveau contact'}</h3>
              <button onClick={closeContactForm} className="p-1 hover:bg-gray-100 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-ui-sm font-medium text-gray-500 mb-1 block">Nom complet *</label>
                <input value={contactForm.name} onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-ui-sm text-ui" placeholder="Mme Dupont, M. Martin..." autoFocus />
              </div>
              <div>
                <label className="text-ui-sm font-medium text-gray-500 mb-1 block">Fonction / Rôle</label>
                <input value={contactForm.role} onChange={e => setContactForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-ui-sm text-ui" placeholder="RH, Dirigeant, QSE, Comptable, Resp. formation..." />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-ui-sm font-medium text-gray-500 mb-1 block">Email</label>
                  <input type="email" value={contactForm.email} onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-ui-sm text-ui" placeholder="email@..." />
                </div>
                <div>
                  <label className="text-ui-sm font-medium text-gray-500 mb-1 block">Téléphone</label>
                  <input type="tel" value={contactForm.phone} onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-ui-sm text-ui" placeholder="06 ..." />
                </div>
              </div>

              <div className="border-t pt-3 space-y-2">
                <label className="flex items-center gap-2.5 text-ui cursor-pointer p-2 rounded-ui-sm hover:bg-[rgb(var(--c-warning-bg))] transition-colors">
                  <input type="checkbox" checked={contactForm.is_primary} onChange={e => setContactForm(f => ({ ...f, is_primary: e.target.checked }))} className="rounded border-gray-300 text-[rgb(var(--c-warning))] focus:ring-[rgb(var(--c-warning)/0.3)]" />
                  <Star className="w-4 h-4 text-[rgb(var(--c-warning))]" />
                  <div>
                    <p className="font-medium text-gray-700">Contact principal</p>
                    <p className="text-ui-sm text-gray-400">Interlocuteur par défaut pour ce client</p>
                  </div>
                </label>
                <label className="flex items-center gap-2.5 text-ui cursor-pointer p-2 rounded-ui-sm hover:bg-[rgb(var(--c-info-bg))] transition-colors">
                  <input type="checkbox" checked={contactForm.is_document_contact} onChange={e => setContactForm(f => ({ ...f, is_document_contact: e.target.checked }))} className="rounded border-gray-300 text-[rgb(var(--c-info))] focus:ring-[rgb(var(--c-info)/0.3)]" />
                  <FileSignature className="w-4 h-4 text-[rgb(var(--c-info))]" />
                  <div>
                    <p className="font-medium text-gray-700">Contact documents</p>
                    <p className="text-ui-sm text-gray-400">Apparaît sur conventions, convocations, attestations</p>
                  </div>
                </label>
                <label className="flex items-center gap-2.5 text-ui cursor-pointer p-2 rounded-ui-sm hover:bg-[rgb(var(--c-success-bg))] transition-colors">
                  <input type="checkbox" checked={contactForm.is_billing} onChange={e => setContactForm(f => ({ ...f, is_billing: e.target.checked }))} className="rounded border-gray-300 text-[rgb(var(--c-success))] focus:ring-[rgb(var(--c-success)/0.3)]" />
                  <span className="text-lg"></span>
                  <div>
                    <p className="font-medium text-gray-700">Contact facturation</p>
                    <p className="text-ui-sm text-gray-400">Reçoit les factures et avoirs</p>
                  </div>
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={closeContactForm} className="px-4 py-2 border rounded-ui-sm text-ui hover:bg-gray-50">Annuler</button>
              <button onClick={saveContact} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-ui-sm text-ui hover:bg-primary-700">
                <Save className="w-4 h-4" /> {editingContact ? 'Enregistrer' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

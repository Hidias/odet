import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useDataStore, useAuthStore } from '../../../core/store'
import { supabase } from '../../../core/supabase'
import { Plus, Search, Edit, Trash2, X, Save, Building2, Mail, Phone, MapPin, User, Eye, Users, Upload, FileSpreadsheet, FileText, RefreshCw, CheckCircle, AlertCircle, Archive, MoreVertical, Smartphone, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import SirenConflictModal from '../components/SirenConflictModal'
import RechercheRepertoire from '../components/RechercheRepertoire'
import { useSirenCheck } from '../lib/useSirenCheck'
import { canExportVCard, buildVCards, clientAsContact, vcfFilename, downloadVCard } from '../lib/vcard'
import { tvaFromSiren, pappersUrl } from '../../../core/org/tva'
import { useDroits } from '../../../core/rights/useDroit'
import { useOuvrirSiDemande } from '../../../ui/useOuvrirSiDemande'

import { confirmer } from '../../../ui/Confirm'
// Formatage nom entreprise (majuscules)
const formatCompanyName = (value) => {
  if (!value) return ''
  return value.toUpperCase()
}

// ═══════════════════════════════════════════════════════════
// ENRICHISSEMENT AUTOMATIQUE VIA API ANNUAIRE ENTREPRISES (GRATUITE)
// ═══════════════════════════════════════════════════════════
const enrichProspectWithAPI = async (name, city) => {
  try {
    const query = `${name} ${city}`.trim()
    const url = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(query)}&per_page=1`
    
    const response = await fetch(url)
    if (!response.ok) return null
    
    const data = await response.json()
    
    if (data.results && data.results.length > 0) {
      const company = data.results[0]
      const siege = company.siege || {}
      
      // Construire l'adresse complète
      const addressParts = [
        siege.numero_voie,
        siege.type_voie,
        siege.libelle_voie,
        siege.code_postal,
        siege.libelle_commune
      ].filter(Boolean)
      
      return {
        enriched: true,
        siret: siege.siret || '',
        name: company.nom_complet || company.nom_raison_sociale || name,
        address: addressParts.join(' '),
        city: siege.libelle_commune || city,
        postal_code: siege.code_postal || '',
        phone: siege.telephone || '',
        email: siege.email || '',
        website: siege.site_internet || '',
        tva: tvaFromSiren(company.siren || siege.siret),
        legal_form: company.forme_juridique || '',
        activity: company.activite_principale || '',
        naf_code: company.activite_principale || '',
        employees: company.tranche_effectif_salarie || '',
        created_date: company.date_creation || ''
      }
    }
    
    return null
  } catch (error) {
    console.error('Erreur enrichissement API:', error)
    return null
  }
}

// Parser CSV Sellsy (séparateur ;, encodage ISO-8859-1)
const parseSellsyCSV = (csvText) => {
  const lines = csvText.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  
  // Parser l'en-tête
  const headers = lines[0].split(';').map(h => h.replace(/"/g, '').trim())
  
  // Trouver les index des colonnes importantes
  const getIdx = (name) => headers.findIndex(h => h.includes(name))
  const idx = {
    id: getIdx('ID SOCIETE SELLSY'),
    name: getIdx('NOM SOCIETE'),
    siret: getIdx('SIRET SOCIETE'),
    emailSociete: getIdx('EMAIL SOCIETE'),
    telSociete: getIdx('TELEPHONE SOCIETE'),
    adresse1: getIdx('ADRESSE PARTIE 1'),
    ville: getIdx('VILLE'),
    cp: getIdx('CODE POSTAL'),
    nomContact: getIdx('NOM CONTACT'),
    prenomContact: getIdx('PRENOM CONTACT'),
    emailContact: getIdx('EMAIL CONTACT'),
    telContact: getIdx('TELEPHONE CONTACT'),
    mobileContact: getIdx('MOBILE CONTACT'),
    fonctionContact: getIdx('FONCTION CONTACT'),
    contactPrincipal: getIdx('CONTACT PRINCIPAL'),
  }
  
  // Parser les lignes de données
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(';').map(v => v.replace(/"/g, '').trim())
    if (values.length < 5) continue
    
    rows.push({
      sellsy_id: values[idx.id] || '',
      name: values[idx.name] || '',
      siret: values[idx.siret]?.replace(/\s/g, '') || '',
      email_societe: values[idx.emailSociete] || '',
      tel_societe: values[idx.telSociete] || '',
      adresse: values[idx.adresse1] || '',
      ville: values[idx.ville] || '',
      cp: values[idx.cp] || '',
      contact_nom: values[idx.nomContact] || '',
      contact_prenom: values[idx.prenomContact] || '',
      contact_email: values[idx.emailContact] || '',
      contact_tel: values[idx.telContact] || values[idx.mobileContact] || '',
      contact_fonction: values[idx.fonctionContact] || '',
      contact_principal: values[idx.contactPrincipal] === 'Y',
    })
  }
  
  // Grouper par société (ID Sellsy)
  const societes = new Map()
  for (const row of rows) {
    if (!row.sellsy_id || !row.name) continue
    
    if (!societes.has(row.sellsy_id)) {
      societes.set(row.sellsy_id, {
        name: row.name.toUpperCase(),
        siret: row.siret,
        contact_email: row.email_societe,
        contact_phone: row.tel_societe,
        address: row.adresse,
        city: row.ville,
        postal_code: row.cp,
        contacts: []
      })
    }
    
    // Ajouter le contact si nom présent
    if (row.contact_nom) {
      societes.get(row.sellsy_id).contacts.push({
        name: `${row.contact_nom} ${row.contact_prenom}`.trim(),
        email: row.contact_email,
        phone: row.contact_tel,
        role: row.contact_fonction,
        is_primary: row.contact_principal
      })
    }
  }
  
  return Array.from(societes.values())
}

// Parser texte libre (Pappers, Infogreffe, etc.)
const parseProspectText = (text) => {
  const prospects = []
  
  // Pattern pour détecter les entreprises
  // Supporte : Pappers, Infogreffe, Societe.com, etc.
  const lines = text.split('\n').map(l => l.trim()).filter(l => l)
  
  let currentProspect = null
  let lastKey = null
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // Détecter un nouveau prospect (nom en majuscules au début ou après un ensemble de données)
    // Un nom d'entreprise est généralement en majuscules et ne contient pas de ":" ni de chiffres au début
    const isLikelyCompanyName = 
      /^[A-ZÀ-ÿ][A-ZÀ-ÿ\s&'\-]{2,}$/.test(line) && 
      !line.includes(':') &&
      !line.match(/^\d/) &&
      line.length > 3 &&
      line.length < 100
    
    if (isLikelyCompanyName && 
        (currentProspect === null || 
         (currentProspect.ville && currentProspect.activity))) {
      // Sauvegarder le prospect précédent
      if (currentProspect && currentProspect.name && currentProspect.ville) {
        prospects.push(currentProspect)
      }
      
      // Nouveau prospect
      currentProspect = {
        name: line.toUpperCase(),
        legal_form: '',
        activity: '',
        naf_code: '',
        ville: '',
        postal_code: '',
        effectif: '',
        capital: ''
      }
      lastKey = 'name'
      continue
    }
    
    if (!currentProspect) continue
    
    // Forme juridique
    if (line.match(/Forme Juridique/i)) {
      lastKey = 'legal_form'
      continue
    }
    
    // Activité
    if (line.match(/Activité/i)) {
      lastKey = 'activity'
      continue
    }
    
    // Code NAF
    const nafMatch = line.match(/Code NAF\s*:?\s*(\d{2}\.\d{2}[A-Z]?)/i)
    if (nafMatch) {
      currentProspect.naf_code = nafMatch[1]
      continue
    }
    
    // Lieu / Ville
    if (line.match(/Lieu/i)) {
      lastKey = 'ville'
      continue
    }
    
    // Code postal
    const cpMatch = line.match(/Code postal\s*:?\s*(\d{5})/i)
    if (cpMatch) {
      currentProspect.postal_code = cpMatch[1]
      continue
    }
    
    // Effectif
    const effectifMatch = line.match(/Effectif\s*:?\s*(.*salariés?|.*\d+\s*et\s*\d+)/i)
    if (effectifMatch) {
      currentProspect.effectif = effectifMatch[1]
      continue
    }
    
    // Capital
    const capitalMatch = line.match(/Capital\s*:?\s*([\d\s,\.]+\s*€)/i)
    if (capitalMatch) {
      currentProspect.capital = capitalMatch[1].trim()
      continue
    }
    
    // Remplir le champ actuel
    if (lastKey && line.length > 2 && line.length < 200) {
      if (lastKey === 'legal_form' && !currentProspect.legal_form && 
          line.match(/(EURL|SARL|SAS|SA|SCI|SASU|Auto-entrepreneur|Micro)/i)) {
        currentProspect.legal_form = line
        lastKey = null
      } else if (lastKey === 'activity' && !currentProspect.activity && 
                 !line.match(/Code NAF|Lieu|Effectif/i)) {
        currentProspect.activity = line
        lastKey = null
      } else if (lastKey === 'ville' && !currentProspect.ville && 
                 !line.match(/Code postal|Effectif/i)) {
        currentProspect.ville = line
        lastKey = null
      }
    }
  }
  
  // Ajouter le dernier prospect
  if (currentProspect && currentProspect.name && currentProspect.ville) {
    prospects.push(currentProspect)
  }
  
  // Nettoyer et formater
  return prospects.map(p => ({
    name: p.name.toUpperCase(),
    city: p.ville,
    postal_code: p.postal_code,
    parsed_data: {
      legal_form: p.legal_form,
      activity: p.activity,
      naf_code: p.naf_code,
      effectif: p.effectif,
      capital: p.capital
    },
    enriched: false,
    enriching: false
  }))
}

// Modal de confirmation
const ConfirmModal = ({ show, onConfirm, onCancel, message, description, confirmLabel = 'Confirmer', confirmColor = 'bg-[rgb(var(--c-danger))] hover:bg-[rgb(var(--c-danger))]' }) => {
  if (!show) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white rounded-ui shadow-md p-6 max-w-sm mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-accent-100 rounded-full flex items-center justify-center">
            <span className="text-accent-600 font-bold text-lg">C</span>
          </div>
          <div>
            <p className="text-gray-900 font-medium">{message}</p>
            {description && <p className="text-ui text-gray-500 mt-1">{description}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn btn-secondary">Annuler</button>
          <button onClick={onConfirm} className={`btn text-white ${confirmColor}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

export default function Clients() {
  const { clients, fetchClients, createClient, updateClient, deleteClient } = useDataStore()
  // Gardes des boutons d'écriture (la base refuse de toute façon ce qui n'est pas permis)
  const d = useDroits({
    modifier: 'clients.fiches.modifier',
    supprimer: 'clients.fiches.supprimer',
    prospection: 'commercial.prospection.gerer',
  })
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  // Entreprises (tous les professionnels) ou particuliers : deux listes séparées
  const [clientKind, setClientKind] = useState('pro')
  const [sortField, setSortField] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [showForm, setShowForm] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [selectedClient, setSelectedClient] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [confirmArchive, setConfirmArchive] = useState(null)
  const [actionMenuId, setActionMenuId] = useState(null)
  const actionMenuRef = useRef(null)
  const [contacts, setContacts] = useState([])
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState(null)
  const [showTextImport, setShowTextImport] = useState(false)
  const [textImportValue, setTextImportValue] = useState('')
  const [enriching, setEnriching] = useState(false)
  const fileInputRef = useRef(null)
  const [form, setForm] = useState({
    name: '', siret: '', address: '', postal_code: '', city: '', tva: '', vat_exempt: false, email: '', phone: '', contact_name: '', contact_function: '', notes: '', status: 'prospect', client_type: 'entreprise'
  })

  const [autoFilled, setAutoFilled] = useState(false)
  const [siretEnriching, setSiretEnriching] = useState(false)

  // ── Enrichissement automatique par SIRET (14 chiffres) ──
  const enrichBySiret = async (siretVal) => {
    const clean = siretVal.replace(/\s/g, '')
    if (clean.length !== 14 || !/^\d{14}$/.test(clean)) return
    setSiretEnriching(true)
    try {
      const url = `https://recherche-entreprises.api.gouv.fr/search?q=${clean}&per_page=1`
      const res = await fetch(url)
      if (!res.ok) return
      const data = await res.json()
      if (data.results && data.results.length > 0) {
        const company = data.results[0]
        const siege = company.siege || {}
        const addrParts = [siege.numero_voie, siege.type_voie, siege.libelle_voie].filter(Boolean)
        setForm(f => ({
          ...f,
          name: f.name || (company.nom_complet || company.nom_raison_sociale || '').toUpperCase(),
          address: addrParts.join(' ') || f.address,
          postal_code: siege.code_postal || f.postal_code,
          city: (siege.libelle_commune || f.city || '').toUpperCase(),
          tva: f.vat_exempt ? '' : (tvaFromSiren(company.siren || clean) || f.tva),
          phone: siege.telephone || f.phone,
          email: siege.email || f.email,
        }))
        setAutoFilled(true)
        toast.success('Fiche pré-remplie depuis l\u2019INSEE', { duration: 3000 })
      }
    } catch (e) {
      console.error('Enrichissement SIRET:', e)
    } finally {
      setSiretEnriching(false)
    }
  }

  // ── Vérification doublons SIREN ──
  const { checkSiren, clearSirenCheck } = useSirenCheck()
  const [sirenConflict, setSirenConflict] = useState(null) // { matches, formData }
  
  useEffect(() => { fetchClients() }, [])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target)) setActionMenuId(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  
  const userRole = useAuthStore(state => state.userRole)
  const vcardAllowed = canExportVCard(userRole)
  const [exportingVcf, setExportingVcf] = useState(false)

  // Export groupé des contacts des clients affichés (filtre et recherche appliqués) en un seul fichier .vcf
  async function exportContactsVCard() {
    if (!vcardAllowed || filtered.length === 0) return
    setExportingVcf(true)
    try {
      const ids = filtered.map(c => c.id)
      const entries = []
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase.from('client_contacts').select('*').in('client_id', ids.slice(i, i + 200))
        if (error) throw error
        ;(data || []).forEach(contact => {
          const client = filtered.find(c => c.id === contact.client_id)
          entries.push({ contact, client })
        })
      }
      // Clients sans contact détaillé : contact générique de la fiche
      filtered.forEach(client => {
        if (entries.some(e => e.client?.id === client.id)) return
        const generic = clientAsContact(client)
        if (generic) entries.push({ contact: generic, client })
      })
      if (entries.length === 0) { toast.error('Aucun contact à exporter'); return }
      downloadVCard(buildVCards(entries), vcfFilename(`contacts_${filtered.length}_clients`))
      toast.success(`${entries.length} contact${entries.length > 1 ? 's' : ''} exporté${entries.length > 1 ? 's' : ''}`)
    } catch (err) {
      console.error('Export vCard :', err)
      toast.error("Export impossible : " + (err.message || 'erreur inconnue'))
    } finally {
      setExportingVcf(false)
    }
  }

  const isParticulier = (c) => c.client_type === 'particulier'
  const kindClients = clients.filter(c => clientKind === 'particulier' ? isParticulier(c) : !isParticulier(c))
  const filtered = kindClients.filter(c => {
    const searchFields = `${c.name || ''} ${c.siret || ''} ${c.contact_name || ''} ${c.address || ''} ${c.email || ''} ${c.contact_email || ''}`.toLowerCase()
    const matchSearch = !search || searchFields.includes(search.toLowerCase())
    const matchStatus = filterStatus === 'all' ? c.status !== 'archive' : c.status === filterStatus
    return matchSearch && matchStatus
  }).sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortField === 'name') return dir * (a.name || '').localeCompare(b.name || '')
    if (sortField === 'city') return dir * (a.city || '').localeCompare(b.city || '')
    if (sortField === 'status') return dir * (a.status || '').localeCompare(b.status || '')
    if (sortField === 'updated_at') return dir * (new Date(a.updated_at || 0) - new Date(b.updated_at || 0))
    return 0
  })
  
  const openForm = (client = null) => {
    if (client) {
      setForm({
        name: client.name || '',
        siret: client.siret || '',
        address: client.address || '',
        postal_code: client.postal_code || '',
        city: client.city || '',
        tva: client.tva || '',
        vat_exempt: !!client.vat_exempt,
        email: client.contact_email || client.email || '',
        phone: client.contact_phone || client.phone || '',
        contact_name: client.contact_name || '',
        contact_function: client.contact_function || '',
        notes: client.notes || '',
        status: client.status || 'prospect',
        client_type: client.client_type || 'entreprise',
      })
      setSelectedClient(client)
    } else {
      setForm({ name: '', siret: '', address: '', postal_code: '', city: '', tva: '', vat_exempt: false, email: '', phone: '', contact_name: '', contact_function: '', notes: '', status: 'prospect', client_type: 'entreprise' })
      setAutoFilled(false)
      setSelectedClient(null)
    }
    setShowForm(true)
  }
  
  // « + Nouveau › Client » (barre du haut)
  useOuvrirSiDemande(() => openForm())

  const openPreview = async (client) => {
    setSelectedClient(client)
    // Charger les contacts
    const { data } = await supabase.from('client_contacts').select('*').eq('client_id', client.id).order('is_primary', { ascending: false })
    setContacts(data || [])
    setShowPreview(true)
  }
  
  const doCreateClient = async (formData) => {
    await createClient({
      ...formData,
      name: formatCompanyName(formData.name),
      contact_email: formData.email,
      contact_phone: formData.phone,
      tva: formData.vat_exempt ? null : (formData.tva || null),
      vat_exempt: !!formData.vat_exempt,
      postal_code: formData.postal_code || null,
      city: formData.city ? formData.city.toUpperCase() : null,
    })
    toast.success('Client créé')
    setShowForm(false)
    setAutoFilled(false)
  }

  const handleSave = async () => {
    if (!form.name) return toast.error('Nom requis')
    if (selectedClient) {
      // Modification : pas de vérif SIREN (client déjà existant)
      await updateClient(selectedClient.id, {
        ...form,
        name: formatCompanyName(form.name),
        contact_email: form.email,
        contact_phone: form.phone,
        tva: form.vat_exempt ? null : (form.tva || null),
        vat_exempt: !!form.vat_exempt,
        postal_code: form.postal_code || null,
        city: form.city ? form.city.toUpperCase() : null,
      })
      toast.success('Client mis à jour')
      setShowForm(false)
    } else {
      // Création : vérifier doublon SIREN
      const cleanSiret = form.siret?.replace(/\s/g, '') || ''
      const cleanSiren = cleanSiret.length >= 9 ? cleanSiret.slice(0, 9) : null
      if (cleanSiren && !cleanSiret.startsWith('MANUAL_')) {
        const matches = await checkSiren(cleanSiren)
        if (matches.length > 0) {
          setSirenConflict({ matches, formData: form })
          return // bloqué, attend la réponse de la modale
        }
      }
      await doCreateClient(form)
    }
  }
  
  const handleDeleteClick = (client) => setConfirmDelete(client)
  
  const handleDelete = async () => {
    if (confirmDelete) {
      const { error } = await deleteClient(confirmDelete.id)
      if (error) {
        // 23503 : des factures, des devis ou des emails envoyés gardent ce client (obligation de conservation)
        toast.error(error.code === '23503'
          ? 'Ce client a des factures ou des devis : il ne peut pas être supprimé. Vous pouvez l\'archiver.'
          : 'La suppression a échoué. Réessayez ou signalez-le.', { duration: 6000 })
        return
      }
      toast.success('Client supprimé')
      setConfirmDelete(null)
    }
  }

  const handleArchive = async () => {
    if (!confirmArchive) return
    const newStatus = confirmArchive.status === 'archive' ? 'actif' : 'archive'
    await supabase.from('clients').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', confirmArchive.id)
    toast.success(newStatus === 'archive' ? 'Client archivé' : 'Client restauré')
    setConfirmArchive(null)
    fetchClients()
  }
  
  const handleFileSelect = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    
    setImporting(true)
    
    try {
      const text = await file.text()
      const societes = parseSellsyCSV(text)
      
      if (societes.length === 0) {
        toast.error('Aucune société détectée dans le CSV')
        return
      }
      
      setImportPreview(societes)
    } catch (err) {
      console.error('Erreur parsing CSV:', err)
      toast.error('Erreur lors de la lecture du fichier')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }
  
  const handleTextImportAnalyze = async () => {
    if (!textImportValue.trim()) {
      return toast.error('Veuillez coller du texte')
    }
    
    try {
      const prospects = parseProspectText(textImportValue)
      
      if (prospects.length === 0) {
        toast.error('Aucune entreprise détectée dans le texte')
        return
      }
      
      setShowTextImport(false)
      setTextImportValue('')
      
      // ═══════════════════════════════════════════════════════════
      // ENRICHISSEMENT AUTOMATIQUE
      // ═══════════════════════════════════════════════════════════
      toast.loading('Enrichissement automatique en cours...', { id: 'enriching' })
      setEnriching(true)
      
      const enrichedProspects = []
      for (const prospect of prospects) {
        const enriched = await enrichProspectWithAPI(prospect.name, prospect.city)
        
        if (enriched) {
          // Fusionner les données parsées avec les données enrichies
          const notes = [
            enriched.legal_form && `Forme juridique: ${enriched.legal_form}`,
            enriched.activity && `Activité: ${enriched.activity}`,
            enriched.naf_code && `Code NAF: ${enriched.naf_code}`,
            enriched.employees && `Effectif: ${enriched.employees}`,
            enriched.created_date && `Créé le: ${enriched.created_date}`,
            prospect.parsed_data.capital && `Capital: ${prospect.parsed_data.capital}`
          ].filter(Boolean).join('\n')
          
          enrichedProspects.push({
            ...enriched,
            notes,
            contacts: [],
            selected: true // Sélectionné par défaut si enrichi
          })
        } else {
          // Prospect non enrichi - NON sélectionné par défaut
          enrichedProspects.push({
            name: prospect.name,
            city: prospect.city,
            postal_code: prospect.postal_code,
            address: `${prospect.city}${prospect.postal_code ? ' ' + prospect.postal_code : ''}`,
            enriched: false,
            siret: '',
            phone: '',
            email: '',
            website: '',
            tva: '',
            notes: [
              prospect.parsed_data.legal_form && `Forme juridique: ${prospect.parsed_data.legal_form}`,
              prospect.parsed_data.activity && `Activité: ${prospect.parsed_data.activity}`,
              prospect.parsed_data.naf_code && `Code NAF: ${prospect.parsed_data.naf_code}`,
              prospect.parsed_data.effectif && `Effectif: ${prospect.parsed_data.effectif}`,
              prospect.parsed_data.capital && `Capital: ${prospect.parsed_data.capital}`
            ].filter(Boolean).join('\n'),
            contacts: [],
            selected: false // NON sélectionné si non enrichi
          })
        }
      }
      
      setEnriching(false)
      toast.dismiss('enriching')
      
      const enrichedCount = enrichedProspects.filter(p => p.enriched).length
      const notEnrichedCount = enrichedProspects.filter(p => !p.enriched).length
      
      toast.success(`${enrichedCount} enrichi(s) •  ${notEnrichedCount} non enrichi(s)`)
      
      setImportPreview(enrichedProspects)
    } catch (err) {
      console.error('Erreur parsing texte:', err)
      toast.error('Erreur lors de l\'analyse du texte')
      setEnriching(false)
      toast.dismiss('enriching')
    }
  }
  
  // ═══════════════════════════════════════════════════════════
  // RÉESSAYER ENRICHISSEMENT
  // ═══════════════════════════════════════════════════════════
  const retryEnrichment = async (index) => {
    const prospect = importPreview[index]
    if (!prospect || prospect.enriching) return
    
    const newPreview = [...importPreview]
    newPreview[index] = { ...prospect, enriching: true }
    setImportPreview(newPreview)
    
    const enriched = await enrichProspectWithAPI(prospect.name, prospect.city)
    
    if (enriched) {
      const notes = [
        enriched.legal_form && `Forme juridique: ${enriched.legal_form}`,
        enriched.activity && `Activité: ${enriched.activity}`,
        enriched.naf_code && `Code NAF: ${enriched.naf_code}`,
        enriched.employees && `Effectif: ${enriched.employees}`,
        enriched.created_date && `Créé le: ${enriched.created_date}`
      ].filter(Boolean).join('\n')
      
      newPreview[index] = {
        ...enriched,
        notes: notes || prospect.notes,
        contacts: [],
        selected: true,
        enriching: false
      }
      toast.success('Enrichissement réussi !')
    } else {
      newPreview[index] = { ...prospect, enriching: false }
      toast.error('Enrichissement échoué')
    }
    
    setImportPreview(newPreview)
  }
  
  // ═══════════════════════════════════════════════════════════
  // COCHER / DÉCOCHER UN PROSPECT
  // ═══════════════════════════════════════════════════════════
  const toggleProspectSelection = (index) => {
    const newPreview = [...importPreview]
    newPreview[index] = { ...newPreview[index], selected: !newPreview[index].selected }
    setImportPreview(newPreview)
  }
  
  const executeImport = async () => {
    if (!importPreview || importing) return
    
    // Importer uniquement les prospects sélectionnés
    const toImport = importPreview.filter(p => p.selected !== false)
    
    if (toImport.length === 0) {
      return toast.error('Aucun prospect sélectionné')
    }
    
    setImporting(true)
    let created = 0
    let skipped = 0
    
    try {
      for (const societe of toImport) {
        // Vérifier si existe déjà (SIRET ou nom exact)
        const exists = (societe.siret && clients.find(c => c.siret === societe.siret)) ||
                       clients.find(c => c.name?.toUpperCase() === societe.name?.toUpperCase())
        
        if (exists) {
          skipped++
          continue
        }
        
        // Créer le client avec statut "À compléter"
        const { data: newClient, error: clientError } = await supabase
          .from('clients')
          .insert({
            name: societe.name,
            siret: societe.siret || null,
            address: societe.address || null,
            // Avec une liste de contacts, ce sont eux qui alimentent les champs contact (contact principal)
            contact_email: societe.contacts?.length ? null : (societe.email || null),
            contact_phone: societe.contacts?.length ? null : (societe.phone || null),
            notes: societe.notes || null,
            status: 'a_completer',
            city: societe.city || null,
            postal_code: societe.postal_code || null
          })
          .select()
          .single()
        
        if (clientError) {
          console.error('Erreur création client:', clientError)
          continue
        }
        
        // Créer les contacts associés si présents
        if (societe.contacts && societe.contacts.length > 0 && newClient) {
          const contactsToInsert = societe.contacts.map(c => ({
            client_id: newClient.id,
            name: c.name,
            email: c.email || null,
            phone: c.phone || null,
            role: c.role || null,
            is_primary: c.is_primary || false
          }))
          
          const { error: contactsError } = await supabase
            .from('client_contacts')
            .insert(contactsToInsert)
          
          if (contactsError) {
            console.error('Erreur création contacts:', contactsError)
          }
          await supabase.rpc('client_contact_sync_primary', { p_client_id: newClient.id }).then(() => {}, () => {})
        }
        
        created++
      }
      
      // Recharger les clients
      await fetchClients()
      
      toast.success(`${created} prospect(s) importé(s)${skipped > 0 ? ` • ${skipped} ignoré(s) (doublons)` : ''}`)
      setImportPreview(null)
    } catch (err) {
      console.error('Erreur import:', err)
      toast.error('Erreur lors de l\'import')
    } finally {
      setImporting(false)
    }
  }
  
  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-6">
        <div className="min-w-0">
          <h1 className="page-title">Clients</h1>
          <p className="text-gray-600 text-ui mt-1">{filtered.length} client{filtered.length > 1 ? 's' : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {vcardAllowed && (
            <button
              onClick={exportContactsVCard}
              className="btn btn-secondary flex items-center gap-2"
              disabled={exportingVcf || filtered.length === 0}
              title="Exporter les contacts des clients affichés vers le téléphone (fichier vCard)"
            >
              <Smartphone className="w-4 h-4" />
              {exportingVcf ? 'Export...' : <><span className="hidden sm:inline">Contacts vCard</span><span className="sm:hidden">vCard</span></>}
            </button>
          )}
          {/* L'import de prospects crée des fiches clients : il faut aussi le droit de modifier les clients */}
          {d.prospection && d.modifier && (
            <button 
              onClick={() => setShowTextImport(true)} 
              className="btn btn-secondary flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Import prospects</span><span className="sm:hidden">Prospects</span>
            </button>
          )}
          {d.modifier && (
            <>
              <button 
                onClick={() => fileInputRef.current?.click()} 
                className="btn btn-secondary flex items-center gap-2"
                disabled={importing}
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span className="hidden sm:inline">Import CSV</span><span className="sm:hidden">CSV</span>
              </button>
              <input 
                ref={fileInputRef} 
                type="file" 
                accept=".csv,.txt" 
                className="hidden" 
                onChange={handleFileSelect}
              />
              <button onClick={() => openForm()} className="btn btn-primary">
                <Plus className="w-4 h-4 mr-2" /><span className="hidden sm:inline">Nouveau client</span><span className="sm:hidden">Nouveau</span>
              </button>
            </>
          )}
        </div>
      </div>
      
      <div className="flex gap-1 mb-3 border-b border-gray-200" role="tablist" aria-label="Type de client">
        {[
          { key: 'pro', label: 'Entreprises', count: clients.filter(c => !isParticulier(c) && c.status !== 'archive').length },
          { key: 'particulier', label: 'Particuliers', count: clients.filter(c => isParticulier(c) && c.status !== 'archive').length },
        ].map(tab => (
          <button key={tab.key} type="button" role="tab" aria-selected={clientKind === tab.key}
            onClick={() => { setClientKind(tab.key); setFilterStatus('all') }}
            className={'px-4 py-2.5 -mb-px text-ui font-semibold border-b-2 transition-colors ' + (clientKind === tab.key ? 'border-accent-600 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800')}>
            {tab.label} <span className="ml-1 text-ui-sm font-medium text-gray-400">{tab.count}</span>
          </button>
        ))}
      </div>

      <div className="card mb-4">
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input 
              type="text" 
              placeholder="Rechercher par nom, SIRET, ville, email..." 
              className="input pl-10 w-full" 
              value={search} 
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex bg-gray-100 rounded-ui-sm p-1 gap-0.5">
            {[
              { key: 'all', label: 'Tous', count: kindClients.filter(c => c.status !== 'archive').length },
              { key: 'actif', label: 'Actif', count: kindClients.filter(c => c.status === 'actif').length, cls: 'text-[rgb(var(--c-success))]' },
              { key: 'en_discussion', label: 'Discussion', count: kindClients.filter(c => c.status === 'en_discussion').length, cls: 'text-[rgb(var(--c-info))]' },
              { key: 'prospect', label: 'Prospect', count: kindClients.filter(c => c.status === 'prospect').length, cls: 'text-[rgb(var(--c-warning))]' },
              { key: 'a_completer', label: 'À compléter', count: kindClients.filter(c => c.status === 'a_completer').length, cls: 'text-gray-800' },
              { key: 'archive', label: 'Archivé', count: kindClients.filter(c => c.status === 'archive').length, cls: 'text-gray-500' },
            ].map(tab => (
              <button key={tab.key} onClick={() => setFilterStatus(tab.key)}
                className={'px-3 py-1.5 rounded-ui-sm text-ui font-medium transition-colors whitespace-nowrap ' + (filterStatus === tab.key ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900')}>
                {tab.label} <span className="text-ui-sm opacity-60">{tab.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-ui-sm text-gray-400 mb-2">{filtered.length} résultat{filtered.length > 1 ? 's' : ''}</p>

      <div className="bg-white rounded-ui border border-gray-200">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b text-ui-sm text-gray-500 uppercase tracking-wider rounded-t-xl [&>th:first-child]:rounded-tl-xl [&>th:last-child]:rounded-tr-xl">
              {[
                { key: 'name', label: 'Entreprise', cls: 'pl-4 pr-2 py-3 text-left' },
                { key: 'city', label: 'Ville', cls: 'px-2 py-3 text-left hidden lg:table-cell' },
                { key: 'status', label: 'Statut', cls: 'px-2 py-3 text-left' },
                { key: null, label: 'Contact', cls: 'px-2 py-3 text-left hidden md:table-cell' },
                { key: null, label: 'Tél', cls: 'px-2 py-3 text-left hidden md:table-cell' },
                { key: 'updated_at', label: 'Modifié', cls: 'px-2 py-3 text-left hidden xl:table-cell' },
                { key: null, label: '', cls: 'px-4 py-3 w-12' },
              ].map(col => (
                <th key={col.label || 'actions'} className={col.cls + (col.key ? ' cursor-pointer hover:text-gray-700 select-none' : '')}
                  onClick={() => col.key && (sortField === col.key ? setSortDir(d => d === 'asc' ? 'desc' : 'asc') : (setSortField(col.key), setSortDir('asc')))}>
                  {col.label} {col.key && sortField === col.key && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(client => {
              const statusMap = {
                actif: { label: 'Actif', cls: 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' },
                en_discussion: { label: 'Discussion', cls: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]' },
                prospect: { label: 'Prospect', cls: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' },
                a_completer: { label: 'À compléter', cls: 'bg-gray-100 text-gray-800' },
                archive: { label: 'Archivé', cls: 'bg-gray-100 text-gray-500' },
              }
              const st = statusMap[client.status] || statusMap.prospect
              return (
                <tr key={client.id} className="hover:bg-gray-50 transition-colors group">
                  <td className="pl-4 pr-2 py-3">
                    <Link to={`/clients/${client.id}`} className="font-medium text-gray-900 hover:text-accent-600 hover:underline text-ui">
                      {client.name}
                    </Link>
                    {client.siren && <span className="text-ui-sm text-gray-400 ml-2 font-mono">{client.siren}</span>}
                  </td>
                  <td className="px-2 py-3 text-ui text-gray-600 hidden lg:table-cell">
                    {client.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-gray-400" />{client.city}</span>}
                  </td>
                  <td className="px-2 py-3">
                    <span className={'px-2 py-0.5 rounded-full text-ui-sm font-medium ' + st.cls}>{st.label}</span>
                  </td>
                  <td className="px-2 py-3 text-ui text-gray-600 hidden md:table-cell truncate max-w-[200px]">
                    {client.contact_email && <span className="flex items-center gap-1"><Mail className="w-3 h-3 text-gray-400 flex-shrink-0" /><span className="truncate">{client.contact_email}</span></span>}
                  </td>
                  <td className="px-2 py-3 text-ui text-gray-600 hidden md:table-cell whitespace-nowrap">
                    {client.contact_phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3 text-gray-400" />{client.contact_phone}</span>}
                  </td>
                  <td className="px-2 py-3 text-ui-sm text-gray-400 hidden xl:table-cell whitespace-nowrap">
                    {client.updated_at && new Date(client.updated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="relative">
                      <button onClick={(e) => { e.stopPropagation(); setActionMenuId(actionMenuId === client.id ? null : client.id) }}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {actionMenuId === client.id && (
                        <div ref={actionMenuRef} className="absolute right-0 top-8 bg-white border border-gray-200 rounded-ui-sm shadow-md py-1 z-50 min-w-[180px]">
                          <Link to={`/clients/${client.id}`}
                            className="flex items-center gap-2 px-4 py-2 text-ui text-gray-700 hover:bg-gray-50 w-full">
                            <Eye className="w-4 h-4 text-gray-400" /> Voir la fiche
                          </Link>
                          {d.modifier && (
                            <button onClick={() => { setActionMenuId(null); openForm(client) }}
                              className="flex items-center gap-2 px-4 py-2 text-ui text-gray-700 hover:bg-gray-50 w-full text-left">
                              <Edit className="w-4 h-4 text-gray-400" /> Modifier
                            </button>
                          )}
                          {(d.modifier || d.supprimer) && <div className="border-t border-gray-100 my-1" />}
                          {d.modifier && (
                            <button onClick={() => { setActionMenuId(null); setConfirmArchive(client) }}
                              className="flex items-center gap-2 px-4 py-2 text-ui text-gray-700 hover:bg-[rgb(var(--c-warning-bg))] w-full text-left">
                              <Archive className="w-4 h-4 text-[rgb(var(--c-warning))]" /> {client.status === 'archive' ? 'Restaurer' : 'Archiver'}
                            </button>
                          )}
                          {d.supprimer && (
                            <button onClick={() => { setActionMenuId(null); setConfirmDelete(client) }}
                              className="flex items-center gap-2 px-4 py-2 text-ui text-[rgb(var(--c-danger))] hover:bg-[rgb(var(--c-danger-bg))] w-full text-left">
                              <Trash2 className="w-4 h-4" /> Supprimer
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Building2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Aucun client trouvé</p>
          </div>
        )}
      </div>
      
      {/* Modal Preview */}
      {showPreview && selectedClient && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowPreview(false)} />
          <div className="relative min-h-full flex items-center justify-center p-4">
            <div className="relative bg-white rounded-ui shadow-md w-full max-w-2xl">
              <div className="flex items-center justify-between p-4 border-b">
                <h2 className="text-lg font-semibold">{selectedClient.name}</h2>
                <button onClick={() => setShowPreview(false)}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                {selectedClient.siret && (
                  <div>
                    <label className="text-ui font-medium text-gray-700">SIRET</label>
                    <p className="text-gray-900 font-mono">{selectedClient.siret}</p>
                  </div>
                )}
                {selectedClient.address && (
                  <div>
                    <label className="text-ui font-medium text-gray-700">Adresse</label>
                    <p className="text-gray-900">{selectedClient.address}</p>
                  </div>
                )}
                {(selectedClient.contact_email || selectedClient.contact_phone) && (
                  <div>
                    <label className="text-ui font-medium text-gray-700">Contact</label>
                    {selectedClient.contact_email && <p className="text-gray-900">{selectedClient.contact_email}</p>}
                    {selectedClient.contact_phone && <p className="text-gray-900">{selectedClient.contact_phone}</p>}
                  </div>
                )}
                {selectedClient.notes && (
                  <div>
                    <label className="text-ui font-medium text-gray-700">Notes</label>
                    <p className="text-gray-900 whitespace-pre-wrap">{selectedClient.notes}</p>
                  </div>
                )}
                
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium text-gray-700">Contacts ({contacts.length})</h4>
                    {d.modifier && <ContactForm onAdd={async (contactData) => {
                      const { error } = await supabase.from('client_contacts').insert({ ...contactData, client_id: selectedClient.id })
                      await supabase.rpc('client_contact_sync_primary', { p_client_id: selectedClient.id }).then(() => {}, () => {})
                      if (error) return toast.error('Erreur')
                      const { data } = await supabase.from('client_contacts').select('*').eq('client_id', selectedClient.id).order('is_primary', { ascending: false })
                      setContacts(data || [])
                      toast.success('Contact ajouté')
                    }} />}
                  </div>
                  {contacts.length === 0 ? (
                    <p className="text-gray-500 text-ui">Aucun contact</p>
                  ) : (
                    <div className="space-y-2">
                      {contacts.map(c => (
                        <div key={c.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-ui-sm">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-gray-900">{c.name}</p>
                              {c.is_primary && <span className="px-2 py-0.5 bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))] text-ui-sm rounded">Principal</span>}
                            </div>
                            {c.role && <p className="text-ui text-gray-600">{c.role}</p>}
                            {c.email && <p className="text-ui text-gray-600">{c.email}</p>}
                            {c.phone && <p className="text-ui text-gray-600">{c.phone}</p>}
                          </div>
                          {d.modifier && (
                          <div className="flex gap-1">
                            <ContactForm 
                              contact={c}
                              buttonLabel={<Edit className="w-4 h-4" />}
                              onEdit={async (id, contactData) => {
                                const { error } = await supabase.from('client_contacts').update(contactData).eq('id', id)
                                await supabase.rpc('client_contact_sync_primary', { p_client_id: selectedClient.id }).then(() => {}, () => {})
                                if (error) return toast.error('Erreur')
                                const { data } = await supabase.from('client_contacts').select('*').eq('client_id', selectedClient.id).order('is_primary', { ascending: false })
                                setContacts(data || [])
                                toast.success('Contact modifié')
                              }}
                            />
                            <button
                              onClick={async () => {
                                if (!await confirmer('Supprimer ce contact ?')) return
                                const { error } = await supabase.from('client_contacts').delete().eq('id', c.id)
                                await supabase.rpc('client_contact_sync_primary', { p_client_id: selectedClient.id }).then(() => {}, () => {})
                                if (error) return toast.error('Erreur')
                                const { data } = await supabase.from('client_contacts').select('*').eq('client_id', selectedClient.id).order('is_primary', { ascending: false })
                                setContacts(data || [])
                                toast.success('Contact supprimé')
                              }}
                              className="p-1.5 text-gray-400 hover:text-[rgb(var(--c-danger))]"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowForm(false)} />
          <div className="relative min-h-full flex items-center justify-center p-4">
            <div className="relative bg-white rounded-ui shadow-md w-full max-w-2xl">
              <div className="flex items-center justify-between p-4 border-b">
                <h2 className="text-lg font-semibold">{selectedClient ? 'Modifier' : 'Nouveau'} client</h2>
                <button onClick={() => setShowForm(false)}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                {!selectedClient && form.client_type !== 'particulier' && (
                  <RechercheRepertoire clientsExistants={clients}
                    onChoisir={(v) => { setForm((f) => ({ ...f, ...v, tva: f.vat_exempt ? '' : v.tva })); setAutoFilled(true) }} />
                )}
                <div>
                  <label className="label">{form.client_type === 'particulier' ? 'Nom et prénom *' : "Nom de l'entreprise *"}</label>
                  <input className="input" value={form.name} onChange={(e) => setForm({...form, name: formatCompanyName(e.target.value)})} />
                </div>
                
                {form.client_type !== 'particulier' && (
                <div>
                  <label className="label flex items-center justify-between gap-2">
                    SIRET
                    <span className="flex items-center gap-3">
                      {siretEnriching && <span className="text-ui-sm text-[rgb(var(--c-info))] font-normal flex items-center gap-1"><span className="animate-spin inline-block"></span> Recherche INSEE...</span>}
                      {autoFilled && !siretEnriching && <span className="text-ui-sm text-[rgb(var(--c-success))] font-normal"> Pré-rempli auto</span>}
                      {pappersUrl(form.siret) && (
                        <a href={pappersUrl(form.siret)} target="_blank" rel="noopener noreferrer" className="text-ui-sm font-semibold text-accent-600 hover:underline">Voir sur Pappers</a>
                      )}
                    </span>
                  </label>
                  <input className="input font-mono" value={form.siret}
                    onChange={(e) => {
                      const val = e.target.value
                      const computed = tvaFromSiren(val)
                      setForm({...form, siret: val, tva: form.vat_exempt ? '' : (computed || form.tva)})
                      if (val.replace(/\s/g, '').length === 14) enrichBySiret(val)
                    }}
                    placeholder="14 chiffres → pré-remplissage auto"
                  />
                </div>
                )}
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="label">Adresse</label>
                    <input className="input" value={form.address} onChange={(e) => setForm({...form, address: e.target.value})} placeholder="Numéro et nom de voie" />
                  </div>
                  <div>
                    <label className="label">Code postal</label>
                    <input className="input" value={form.postal_code} onChange={(e) => setForm({...form, postal_code: e.target.value})} placeholder="29000" />
                  </div>
                  <div>
                    <label className="label">Ville</label>
                    <input className="input" value={form.city} onChange={(e) => setForm({...form, city: e.target.value.toUpperCase()})} placeholder="VILLE" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Téléphone</label>
                    <input type="tel" className="input" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} />
                  </div>
                  <div>
                    <label className="label">Email</label>
                    <input type="email" className="input" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} />
                  </div>
                </div>
                {form.client_type !== 'particulier' && (
                <div>
                  <label className="label">N° TVA intracommunautaire</label>
                  <input className="input font-mono disabled:bg-gray-50 disabled:text-gray-400" value={form.vat_exempt ? '' : form.tva} disabled={form.vat_exempt}
                    onChange={(e) => setForm({...form, tva: e.target.value.toUpperCase()})} placeholder={form.vat_exempt ? 'Non assujetti' : 'FR00000000000'} />
                  <p className="text-ui-sm text-gray-400 mt-1">Calculé depuis le SIREN pour une entreprise française. Saisie libre pour un client étranger.</p>
                  <label className="flex items-center gap-2 mt-2 text-ui text-gray-700 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4" checked={!!form.vat_exempt}
                      onChange={(e) => setForm({...form, vat_exempt: e.target.checked, tva: e.target.checked ? '' : (tvaFromSiren(form.siret) || form.tva)})} />
                    Non assujetti à la TVA (aucun numéro sur les factures)
                  </label>
                </div>
                )}
                
                {form.client_type !== 'particulier' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Contact principal</label>
                    <input className="input" placeholder="Nom du contact" value={form.contact_name} onChange={(e) => setForm({...form, contact_name: e.target.value})} />
                  </div>
                  <div>
                    <label className="label">Fonction</label>
                    <input className="input" placeholder="Ex: Directeur" value={form.contact_function} onChange={(e) => setForm({...form, contact_function: e.target.value})} />
                  </div>
                </div>
                )}
                
                <div className="border-t pt-4">
                  <h4 className="font-medium text-gray-700 mb-3">Statut</h4>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { value: 'prospect', label: 'Prospect', active: 'bg-[rgb(var(--c-warning))] text-white', inactive: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] hover:bg-[rgb(var(--c-warning-bg))]' },
                      { value: 'en_discussion', label: 'En discussion', active: 'bg-[rgb(var(--c-info))] text-white', inactive: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))] hover:bg-[rgb(var(--c-info-bg))]' },
                      { value: 'actif', label: 'Actif', active: 'bg-[rgb(var(--c-success))] text-white', inactive: 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] hover:bg-[rgb(var(--c-success-bg))]' },
                      { value: 'a_completer', label: 'À compléter', active: 'bg-gray-700 text-white', inactive: 'bg-gray-50 text-gray-800 hover:bg-gray-100' },
                      { value: 'archive', label: 'Archivé', active: 'bg-gray-500 text-white', inactive: 'bg-gray-50 text-gray-500 hover:bg-gray-100' }
                    ].map(s => (
                      <button key={s.value} type="button" onClick={() => setForm({...form, status: s.value})}
                        className={`px-3 py-1.5 rounded-full text-ui font-medium transition-colors ${form.status === s.value ? s.active : s.inactive}`}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-gray-700 mb-3">Type de client <span className="text-ui-sm text-gray-400 font-normal">(pour le BPF)</span></h4>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { value: 'entreprise', label: 'Entreprise', active: 'bg-[rgb(var(--c-info))] text-white', inactive: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))] hover:bg-[rgb(var(--c-info-bg))]' },
                      { value: 'organisme_formation', label: 'Organisme de formation', active: 'bg-gray-700 text-white', inactive: 'bg-gray-50 text-gray-800 hover:bg-gray-100' },
                      { value: 'public', label: 'Établissement public', active: 'bg-gray-700 text-white', inactive: 'bg-gray-50 text-gray-800 hover:bg-gray-100' },
                      { value: 'opco', label: 'OPCO', active: 'bg-[rgb(var(--c-warning))] text-white', inactive: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] hover:bg-[rgb(var(--c-warning-bg))]' },
                      { value: 'particulier', label: 'Particulier', active: 'bg-gray-700 text-white', inactive: 'bg-gray-100 text-gray-700 hover:bg-gray-200' },
                    ].map(s => (
                      <button key={s.value} type="button" onClick={() => setForm(s.value === 'particulier'
                        ? {...form, client_type: s.value, vat_exempt: true, tva: '', siret: ''}
                        : {...form, client_type: s.value, vat_exempt: form.client_type === 'particulier' ? false : form.vat_exempt})}
                        className={`px-3 py-1.5 rounded-full text-ui font-medium transition-colors ${form.client_type === s.value ? s.active : s.inactive}`}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="label">Notes</label>
                  <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-4 border-t">
                <button onClick={() => setShowForm(false)} className="btn btn-secondary">Annuler</button>
                <button onClick={handleSave} className="btn btn-primary"><Save className="w-4 h-4 mr-2" />Enregistrer</button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal Import Texte */}
      {showTextImport && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => !enriching && setShowTextImport(false)} />
          <div className="relative min-h-full flex items-center justify-center p-4">
            <div className="relative bg-white rounded-ui shadow-md w-full max-w-3xl max-h-[90vh] overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                <div className="flex items-center gap-3">
                  <FileText className="w-6 h-6 text-gray-800" />
                  <div>
                    <h2 className="text-lg font-semibold">Import prospects en masse</h2>
                    <p className="text-ui text-gray-600">Pappers, Infogreffe +  Enrichissement auto </p>
                  </div>
                </div>
                {!enriching && <button onClick={() => setShowTextImport(false)}><X className="w-5 h-5" /></button>}
              </div>
              
              <div className="p-4">
                <label className="label mb-2">Collez ici les données d'entreprises</label>
                <textarea 
                  className="input w-full font-mono text-ui"
                  rows={20}
                  value={textImportValue}
                  onChange={(e) => setTextImportValue(e.target.value)}
                  placeholder="GARDEN CONCEPTS&#10;Forme Juridique&#10;EURL&#10;Activité&#10;Services d'aménagement paysager&#10;Code NAF : 81.30Z&#10;Lieu&#10;PLOUDALMEZEAU&#10;Code postal : 29830&#10;Effectif : Entre 10 et 19 salariés&#10;..."
                  disabled={enriching}
                />
              </div>
              
              <div className="flex items-center justify-between p-4 border-t bg-gray-50">
                <p className="text-ui text-gray-600">
                  {enriching ? ' Enrichissement automatique en cours...' : ' API Gratuite • SIRET, Tel, Email, Site web'}
                </p>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setShowTextImport(false)} 
                    className="btn btn-secondary"
                    disabled={enriching}
                  >
                    Annuler
                  </button>
                  <button 
                    onClick={handleTextImportAnalyze} 
                    className="btn btn-primary flex items-center gap-2"
                    disabled={enriching}
                  >
                    {enriching ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Enrichissement...
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4" /> Analyser & Enrichir
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal Import Preview AVEC ENRICHISSEMENT */}
      {importPreview && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => !importing && setImportPreview(null)} />
          <div className="relative min-h-full flex items-center justify-center p-4">
            <div className="relative bg-white rounded-ui shadow-md w-full max-w-4xl max-h-[90vh] overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b bg-[rgb(var(--c-info-bg))]">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-6 h-6 text-[rgb(var(--c-info))]" />
                  <div>
                    <h2 className="text-lg font-semibold">Prévisualisation import</h2>
                    <p className="text-ui text-gray-600">
                      {importPreview.length} prospect(s) • 
                      {' '}{importPreview.filter(p => p.enriched).length} enrichi(s)  • 
                      {' '}{importPreview.filter(p => !p.enriched).length} non enrichi(s) 
                    </p>
                  </div>
                </div>
                {!importing && <button onClick={() => setImportPreview(null)}><X className="w-5 h-5" /></button>}
              </div>
              
              <div className="p-4 overflow-y-auto max-h-[60vh]">
                <table className="w-full text-ui">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-center py-2 px-2 font-medium w-10">
                        <input 
                          type="checkbox" 
                          checked={importPreview.every(p => p.selected !== false)}
                          onChange={(e) => {
                            const newPreview = importPreview.map(p => ({ ...p, selected: e.target.checked }))
                            setImportPreview(newPreview)
                          }}
                        />
                      </th>
                      <th className="text-left py-2 px-3 font-medium">Société</th>
                      <th className="text-left py-2 px-3 font-medium">SIRET</th>
                      <th className="text-left py-2 px-3 font-medium">Contact</th>
                      <th className="text-center py-2 px-3 font-medium">Statut</th>
                      <th className="text-center py-2 px-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {importPreview.map((societe, idx) => {
                      const exists = (societe.siret && clients.find(c => c.siret === societe.siret)) ||
                                     clients.find(c => c.name?.toUpperCase() === societe.name?.toUpperCase())
                      return (
                        <tr key={idx} className={
                          exists ? 'bg-[rgb(var(--c-warning-bg))]' : 
                          societe.enriched ? 'bg-[rgb(var(--c-success-bg))]' : 
                          'bg-[rgb(var(--c-danger-bg))]'
                        }>
                          <td className="py-2 px-2 text-center">
                            <input 
                              type="checkbox" 
                              checked={societe.selected !== false}
                              onChange={() => toggleProspectSelection(idx)}
                              disabled={exists || societe.enriching}
                            />
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-medium">{societe.name}</div>
                            {societe.city && <div className="text-ui-sm text-gray-500">{societe.postal_code} {societe.city}</div>}
                            {societe.website && <div className="text-ui-sm text-[rgb(var(--c-info))]"> {societe.website}</div>}
                            {exists && <span className="text-ui-sm text-[rgb(var(--c-warning))]"> Existe déjà</span>}
                          </td>
                          <td className="py-2 px-3 text-gray-600 font-mono text-ui-sm">{societe.siret || '-'}</td>
                          <td className="py-2 px-3 text-ui-sm">
                            {societe.phone && <div className="text-gray-600"> {societe.phone}</div>}
                            {societe.email && <div className="text-gray-600"> {societe.email}</div>}
                            {!societe.phone && !societe.email && <span className="text-gray-400">-</span>}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {societe.enriching ? (
                              <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-ui-sm">
                                <span className="animate-spin inline-block"></span>
                              </span>
                            ) : societe.enriched ? (
                              <span className="px-2 py-1 bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] rounded text-ui-sm font-medium inline-flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" /> Enrichi
                              </span>
                            ) : (
                              <span className="px-2 py-1 bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))] rounded text-ui-sm font-medium inline-flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" /> Non enrichi
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {!societe.enriched && !societe.enriching && !exists && (
                              <button
                                onClick={() => retryEnrichment(idx)}
                                className="p-1 text-[rgb(var(--c-info))] hover:bg-[rgb(var(--c-info-bg))] rounded"
                                title="Réessayer enrichissement"
                              >
                                <RefreshCw className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              
              <div className="flex items-center justify-between p-4 border-t bg-gray-50">
                <div className="text-ui">
                  <p className="text-gray-600">
                     Enrichis : Sélectionnés par défaut (SIRET trouvé)
                  </p>
                  <p className="text-gray-600">
                     Non enrichis : Non sélectionnés (SIRET manquant)
                  </p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setImportPreview(null)} 
                    className="btn btn-secondary"
                    disabled={importing}
                  >
                    Annuler
                  </button>
                  <button 
                    onClick={executeImport} 
                    className="btn btn-primary flex items-center gap-2"
                    disabled={importing || !importPreview.some(p => p.selected !== false)}
                  >
                    {importing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Import en cours...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" /> Importer {importPreview.filter(p => p.selected !== false).length} prospect(s)
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <ConfirmModal show={!!confirmArchive}
        message={confirmArchive?.status === 'archive' ? `Restaurer ${confirmArchive?.name} ?` : `Archiver ${confirmArchive?.name} ?`}
        description={confirmArchive?.status === 'archive' ? 'Le client réapparaîtra dans la liste.' : 'Le client sera masqué de la liste principale.'}
        confirmLabel={confirmArchive?.status === 'archive' ? 'Restaurer' : 'Archiver'}
        confirmColor={confirmArchive?.status === 'archive' ? 'bg-[rgb(var(--c-success))] hover:bg-[rgb(var(--c-success))]' : 'bg-[rgb(var(--c-warning))] hover:bg-[rgb(var(--c-warning))]'}
        onConfirm={handleArchive} onCancel={() => setConfirmArchive(null)} />
      <ConfirmModal show={!!confirmDelete}
        message={`Supprimer ${confirmDelete?.name} ?`}
        description="Cette action est irréversible. Les factures et sessions liées pourraient empêcher la suppression."
        confirmLabel="Supprimer"
        onConfirm={handleDelete} onCancel={() => setConfirmDelete(null)} />

      {/* Modale doublon SIREN */}
      {sirenConflict && (
        <SirenConflictModal
          matches={sirenConflict.matches}
          newName={sirenConflict.formData?.name}
          newSiret={sirenConflict.formData?.siret}
          newCity={sirenConflict.formData?.city}
          onUseExisting={(clientId) => {
            setSirenConflict(null)
            clearSirenCheck()
            setShowForm(false)
            // Sélectionner et afficher le client existant
            const existing = clients.find(c => c.id === clientId)
            if (existing) { setSelectedClient(existing); setShowPreview(true) }
            toast.success('Client existant sélectionné')
          }}
          onCreateAnyway={async () => {
            const formData = sirenConflict.formData
            setSirenConflict(null)
            clearSirenCheck()
            await doCreateClient(formData)
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

// Composant pour ajouter un contact
function ContactForm({ onAdd, onEdit, contact = null, buttonLabel = '+ Ajouter' }) {
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ name: '', role: '', email: '', phone: '', is_primary: false })
  
  const openForm = () => {
    if (contact) {
      setForm({
        name: contact.name || '',
        role: contact.role || '',
        email: contact.email || '',
        phone: contact.phone || '',
        is_primary: contact.is_primary || false
      })
    } else {
      setForm({ name: '', role: '', email: '', phone: '', is_primary: false })
    }
    setShow(true)
  }
  
  const handleSubmit = () => {
    if (!form.name) return toast.error('Nom requis')
    if (contact && onEdit) {
      onEdit(contact.id, form)
    } else {
      onAdd(form)
    }
    setForm({ name: '', role: '', email: '', phone: '', is_primary: false })
    setShow(false)
  }
  
  if (!show) return <button onClick={openForm} className="text-ui text-primary hover:underline">{buttonLabel}</button>
  
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/30" onClick={() => setShow(false)} />
      <div className="relative bg-white rounded-ui-sm shadow-md p-4 w-80">
        <h4 className="font-medium mb-3">{contact ? 'Modifier' : 'Nouveau'} contact</h4>
        <div className="space-y-2">
          <input type="text" placeholder="Nom *" className="input text-ui" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
          <input type="text" placeholder="Fonction" className="input text-ui" value={form.role} onChange={e => setForm({...form, role: e.target.value})} />
          <input type="email" placeholder="Email" className="input text-ui" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
          <input type="tel" placeholder="Téléphone" className="input text-ui" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
          <label className="flex items-center gap-2 text-ui"><input type="checkbox" checked={form.is_primary} onChange={e => setForm({...form, is_primary: e.target.checked})} />Contact principal</label>
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={() => setShow(false)} className="btn btn-secondary btn-sm">Annuler</button>
          <button onClick={handleSubmit} className="btn btn-primary btn-sm">{contact ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </div>
    </div>
  )
}

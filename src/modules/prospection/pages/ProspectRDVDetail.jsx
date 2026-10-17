import { teamFirstNames } from '../../../core/org/currentOrg'
import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'
import { useAuthStore } from '../../../core/store'
import {
  Save, ArrowLeft, Calendar, Clock, MapPin, User, Phone, Mail,
  Building2, FileText, Trash2, Plus, X, Send, CheckCircle,
  MessageSquare, Zap, ExternalLink, ChevronDown, ChevronUp
} from 'lucide-react'
import toast from 'react-hot-toast'
import SpeechToTextButton from '../../../ui/SpeechToTextButton'
import ProspectNeedsAnalysis from '../components/ProspectNeedsAnalysis'
import CompteRenduModal from '../../formation/components/CompteRenduModal'
import SuiteRdvModal from '../components/suivi/SuiteRdvModal'
import PrepRdvModal from '../components/suivi/PrepRdvModal'
import { OUTCOME_LABELS, authorFromEmail, todayStr, fmtDate as fmtDateLocal } from '../components/suivi/suiviUtils'
import SearchSelect, { clientOptions } from '../../../ui/SearchSelect'

const RESULT_LABELS = {
  chaud: ' Intéressé', tiede: ' Tiède', froid: ' Refus',
  no_answer: ' Injoignable', blocked: ' Barrage', wrong_number: ' N° erroné',
  a_rappeler: ' À rappeler',
}
const RESULT_COLORS = {
  chaud: 'bg-[rgb(var(--c-danger-bg))] border-[rgb(var(--c-danger)/0.3)] text-[rgb(var(--c-danger))]',
  tiede: 'bg-[rgb(var(--c-warning-bg))] border-[rgb(var(--c-warning)/0.3)] text-[rgb(var(--c-warning))]',
  froid: 'bg-[rgb(var(--c-info-bg))] border-[rgb(var(--c-info)/0.3)] text-[rgb(var(--c-info))]',
  no_answer: 'bg-gray-50 border-gray-200 text-gray-700',
  blocked: 'bg-[rgb(var(--c-warning-bg))] border-[rgb(var(--c-warning)/0.3)] text-[rgb(var(--c-warning))]',
  wrong_number: 'bg-gray-50 border-gray-200 text-gray-800',
}
const INTERACTION_COLORS = {
  phoning: 'bg-gray-50 border-gray-200',
  email: 'bg-[rgb(var(--c-info-bg))] border-[rgb(var(--c-info)/0.3)]',
  meeting: 'bg-[rgb(var(--c-success-bg))] border-[rgb(var(--c-success)/0.3)]',
  call: 'bg-[rgb(var(--c-info-bg))] border-[rgb(var(--c-info)/0.3)]',
  devis: 'bg-[rgb(var(--c-warning-bg))] border-[rgb(var(--c-warning)/0.3)]',
  relance: 'bg-[rgb(var(--c-danger-bg))] border-[rgb(var(--c-danger)/0.3)]',
  note: 'bg-gray-50 border-gray-200',
}

function fmtDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtDateTime(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' à ' +
    new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export default function ProspectRDVDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuthStore()
  const isNew = id === 'nouveau'

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [clients, setClients] = useState([])
  const [contacts, setContacts] = useState([])
  const [selectedClient, setSelectedClient] = useState(null)
  const [showNewClientModal, setShowNewClientModal] = useState(false)
  const [showCompteRendu, setShowCompteRendu] = useState(false)
  const [showFullNotes, setShowFullNotes] = useState(false)
  const [showSuite, setShowSuite] = useState(false)
  const [showPrep, setShowPrep] = useState(false)
  const [outcomeInfo, setOutcomeInfo] = useState(null)

  // CRM fil
  const [marineCalls, setMarineCalls] = useState([])
  const [interactions, setInteractions] = useState([])
  const [crmLoading, setCrmLoading] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  const [newClientData, setNewClientData] = useState({
    name: '', siret: '', address: '', postal_code: '', city: '', contact_phone: '', email: ''
  })

  const [formData, setFormData] = useState({
    client_id: '',
    rdv_date: new Date().toISOString().split('T')[0],
    rdv_time: '09:00',
    rdv_type: 'decouverte',
    rdv_location: 'leurs_locaux',
    rdv_address: '',
    contact_id: null,
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    conducted_by: '',
    status: 'prevu',
    notes: '',
    notes_crm: '',
    next_action: '',
    next_action_date: '',
    is_urgent: false,
    formations_interet: [],
    temperature: '',
    source: '',
  })

  useEffect(() => {
    loadClients()
    if (!isNew) {
      loadRdv()
    } else {
      const clientIdParam = searchParams.get('client_id')
      if (clientIdParam) setFormData(f => ({ ...f, client_id: clientIdParam }))
    }
  }, [id])

  useEffect(() => {
    if (formData.client_id) {
      loadClientContacts(formData.client_id)
      loadClientData(formData.client_id)
      loadCrmData(formData.client_id)
    }
  }, [formData.client_id])

  const loadClients = async () => {
    // fetchAll : liste complète des clients (sinon tronquée à 1 000)
    const { data } = await fetchAll(() => supabase.from('clients').select('*').order('name'))
    setClients(data || [])
  }

  const loadClientData = async (clientId) => {
    const { data } = await supabase.from('clients').select('*').eq('id', clientId).single()
    setSelectedClient(data)
  }

  const loadClientContacts = async (clientId) => {
    const { data } = await supabase.from('client_contacts').select('*')
      .eq('client_id', clientId).order('is_primary', { ascending: false })
    setContacts(data || [])
  }

  const loadCrmData = useCallback(async (clientId) => {
    if (!clientId) return
    setCrmLoading(true)
    try {
      const [{ data: calls }, { data: inters }] = await Promise.all([
        supabase.from('prospect_calls')
          .select('*')
          .eq('client_id', clientId)
          .order('called_at', { ascending: false })
          .limit(30),
        supabase.from('client_interactions')
          .select('*')
          .eq('client_id', clientId)
          .order('interaction_date', { ascending: false })
          .limit(50),
      ])
      setMarineCalls(calls || [])
      setInteractions(inters || [])
    } catch (err) { console.error('CRM load error:', err) }
    finally { setCrmLoading(false) }
  }, [])

  const loadRdv = async () => {
    try {
      const { data, error } = await supabase
        .from('prospect_rdv')
        .select('*, clients (*)')
        .eq('id', id)
        .single()
      if (error) throw error
      setFormData({
        id: data.id,
        client_id: data.client_id,
        rdv_date: data.rdv_date || '',
        rdv_time: data.rdv_time || '09:00',
        rdv_type: data.rdv_type || 'decouverte',
        rdv_location: data.rdv_location || 'leurs_locaux',
        rdv_address: data.rdv_address || '',
        contact_id: data.contact_id,
        contact_name: data.contact_name || '',
        contact_email: data.contact_email || '',
        contact_phone: data.contact_phone || '',
        conducted_by: data.conducted_by || '',
        status: data.status || 'prevu',
        notes: data.notes || '',
        notes_crm: data.notes_crm || '',
        next_action: data.next_action || '',
        next_action_date: data.next_action_date || '',
        is_urgent: data.is_urgent || false,
        formations_interet: data.formations_interet || [],
        temperature: data.temperature || '',
        source: data.source || '',
      })
      setSelectedClient(data.clients)
      setOutcomeInfo({
        outcome: data.outcome || null,
        outcome_reason: data.outcome_reason || null,
        outcome_at: data.outcome_at || null,
        outcome_by: data.outcome_by || null,
        quote_id: data.quote_id || null,
      })
    } catch (error) {
      console.error('Erreur:', error)
      toast.error('Erreur lors du chargement')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!formData.client_id) { toast.error('Client obligatoire'); return }
    if (formData.status !== 'a_prendre' && !formData.rdv_date) {
      toast.error('Date obligatoire (ou choisir "À prendre")')
      return
    }
    setSaving(true)
    try {
      const { id: _id, ...rest } = formData
      const dataToSave = {
        ...rest,
        rdv_date: formData.status === 'a_prendre' ? null : formData.rdv_date || null,
        rdv_time: formData.status === 'a_prendre' ? null : (formData.rdv_time || null),
        next_action_date: formData.next_action_date || null,
        rdv_address: formData.rdv_address || null,
        contact_id: formData.contact_id || null,
        contact_name: formData.contact_name || null,
        contact_email: formData.contact_email || null,
        contact_phone: formData.contact_phone || null,
        notes: formData.notes || null,
        notes_crm: formData.notes_crm || null,
        next_action: formData.next_action || null,
        is_urgent: formData.status === 'a_prendre' ? true : formData.is_urgent,
        formations_interet: formData.formations_interet?.length > 0 ? formData.formations_interet : null,
      }
      if (!dataToSave.next_action_date && dataToSave.rdv_date) {
        const d = new Date(dataToSave.rdv_date)
        d.setDate(d.getDate() + 2)
        dataToSave.next_action_date = d.toISOString().split('T')[0]
      }
      if (isNew) {
        const { data, error } = await supabase.from('prospect_rdv').insert([dataToSave]).select().single()
        if (error) throw error
        toast.success('RDV créé')
        navigate(`/prospection/${data.id}`)
      } else {
        const { error } = await supabase.from('prospect_rdv').update(dataToSave).eq('id', id)
        if (error) throw error
        toast.success('RDV mis à jour')
      }
    } catch (error) {
      console.error('Erreur:', error)
      toast.error('Erreur lors de la sauvegarde')
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirm('Supprimer ce RDV ?')) return
    try {
      const { error } = await supabase.from('prospect_rdv').delete().eq('id', id)
      if (error) throw error
      toast.success('RDV supprimé')
      navigate('/prospection')
    } catch (error) {
      toast.error('Erreur lors de la suppression')
    }
  }

  const handleQuickStatus = async (newStatus) => {
    setSaving(true)
    try {
      const patch = { status: newStatus, updated_at: new Date().toISOString() }
      if (newStatus === 'realise' && !formData.rdv_date) {
        patch.rdv_date = new Date().toISOString().split('T')[0]
      }
      await supabase.from('prospect_rdv').update(patch).eq('id', id)
      setFormData(f => ({ ...f, ...patch }))
      // Log interaction
      if (formData.client_id) {
        const label = newStatus === 'realise' ? ' RDV réalisé' : newStatus === 'annule' ? ' RDV annulé' : newStatus
        const { data: inter } = await supabase.from('client_interactions').insert({
          client_id: formData.client_id,
          type: 'meeting',
          title: label + ' - ' + (selectedClient?.name || ''),
          content: formData.notes || '',
          author: authorFromEmail(user?.email),
          interaction_date: new Date().toISOString(),
        }).select().single()
        if (inter) setInteractions(prev => [inter, ...prev])
      }
      toast.success('Statut mis à jour')
    } catch (err) { toast.error('Erreur: ' + err.message) }
    finally { setSaving(false) }
  }

  const addNote = async () => {
    if (!newNote.trim() || !formData.client_id) return
    setSavingNote(true)
    try {
      const author = authorFromEmail(user?.email)
      const { data: inter, error } = await supabase.from('client_interactions').insert({
        client_id: formData.client_id,
        type: 'note',
        title: 'Note ' + author,
        content: newNote.trim(),
        author,
        interaction_date: new Date().toISOString(),
      }).select().single()
      if (error) throw error
      setInteractions(prev => [inter, ...prev])
      setNewNote('')
      toast.success('Note ajoutée')
    } catch (err) { toast.error('Erreur: ' + err.message) }
    finally { setSavingNote(false) }
  }

  const handleCreateClient = async () => {
    if (!newClientData.name) { toast.error('Le nom du client est obligatoire'); return }
    try {
      const siretVal = (newClientData.siret || '').trim() || null
      const sirenVal = siretVal ? siretVal.slice(0, 9) : null
      const { data, error } = await supabase.from('clients').insert([{
        name: newClientData.name.toUpperCase(),
        siret: siretVal, siren: sirenVal,
        address: newClientData.address, postal_code: newClientData.postal_code,
        city: newClientData.city, contact_phone: newClientData.contact_phone,
        contact_email: newClientData.email, status: 'prospect', client_type: 'entreprise',
      }]).select().single()
      if (error) throw error
      if (sirenVal) {
        await supabase.from('prospection_massive').update({
          prospection_status: 'deja_client', updated_at: new Date().toISOString(),
        }).eq('siren', sirenVal)
      }
      toast.success('Client créé')
      setClients([...clients, data])
      setFormData({ ...formData, client_id: data.id })
      setShowNewClientModal(false)
      setNewClientData({ name: '', siret: '', address: '', postal_code: '', city: '', contact_phone: '', email: '' })
    } catch (error) { toast.error('Erreur lors de la création du client') }
  }

  // Appels de prospection + interactions en un seul fil chronologique
  const crmFil = [
    ...marineCalls.map(c => ({
      _type: 'call',
      id: c.id,
      date: c.called_at,
      author: c.called_by || '',
      result: c.call_result,
      contact_name: c.contact_name,
      contact_function: c.contact_function,
      contact_email: c.contact_email,
      contact_mobile: c.contact_mobile,
      formations: c.formations_mentioned,
      notes: c.notes,
      duration: c.duration_seconds,
    })),
    ...interactions.map(i => ({
      _type: 'interaction',
      id: i.id,
      date: i.interaction_date,
      author: i.author,
      title: i.title,
      content: i.content,
      type: i.type,
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date))

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
    </div>
  )

  const isTransfer = formData.source?.includes('transfer')
  const isFromPhoning = formData.source?.includes('marine')
  const initialNotes = formData.notes || ''

  return (
    <div className="space-y-6">

      {showPrep && (
        <PrepRdvModal rdvId={id} clientName={selectedClient?.name} onClose={() => setShowPrep(false)} />
      )}

      {showSuite && (
        <SuiteRdvModal
          rdv={{ ...formData, id, ...(outcomeInfo || {}) }}
          clientName={selectedClient?.name}
          author={authorFromEmail(user?.email)}
          onClose={() => setShowSuite(false)}
          onDone={(updated) => {
            setShowSuite(false)
            setFormData(f => ({
              ...f,
              status: updated.status,
              rdv_date: updated.rdv_date || f.rdv_date,
              next_action: updated.next_action || '',
              next_action_date: updated.next_action_date || '',
            }))
            setOutcomeInfo({
              outcome: updated.outcome,
              outcome_reason: updated.outcome_reason,
              outcome_at: updated.outcome_at,
              outcome_by: updated.outcome_by,
              quote_id: updated.quote_id || null,
            })
          }}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/prospection')}
            className="p-2 hover:bg-gray-100 rounded-ui-sm">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">
                {isNew ? 'Nouveau RDV' : (selectedClient?.name || 'RDV')}
              </h1>
              {isTransfer && (
                <span className="px-2 py-0.5 rounded-full text-ui-sm font-medium bg-gray-100 text-gray-800 border border-gray-200">
                  Transfert
                </span>
              )}
              {isFromPhoning && !isTransfer && (
                <span className="px-2 py-0.5 rounded-full text-ui-sm font-medium bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] border border-[rgb(var(--c-warning)/0.3)]">
                  Prospect chaud
                </span>
              )}
              {formData.formations_interet?.length > 0 && formData.formations_interet.map(f => (
                <span key={f} className="px-2 py-0.5 rounded-full text-ui-sm font-medium bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))] border border-[rgb(var(--c-info)/0.3)]">
                   {f}
                </span>
              ))}
            </div>
            {selectedClient?.city && (
              <p className="text-ui text-gray-500 mt-0.5">{selectedClient.city}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <button onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-2 text-ui bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))] rounded-ui-sm hover:bg-[rgb(var(--c-danger-bg))] border border-[rgb(var(--c-danger)/0.3)]">
              <Trash2 className="w-4 h-4" /> Supprimer
            </button>
          )}
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-ui-sm hover:bg-primary-700 disabled:opacity-50 text-ui font-medium">
            <Save className="w-4 h-4" />
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {/* ── Quick actions (si RDV existant) ─────────────────────────────── */}
      {!isNew && (
        <div className="flex items-center gap-2 flex-wrap bg-gray-50 rounded-ui p-3 border border-gray-200">
          <span className="text-ui-sm font-semibold text-gray-500 uppercase mr-1">Action rapide</span>
          {formData.status !== 'prevu' && formData.status !== 'a_prendre' ? null : (
            <button onClick={() => setFormData(f => ({ ...f, status: 'prevu' }))}
              className={'px-3 py-1.5 rounded-ui-sm text-ui font-medium border transition-colors ' +
                (formData.status === 'prevu' ? 'bg-[rgb(var(--c-info))] text-white border-[rgb(var(--c-info)/0.3)]' : 'bg-white text-gray-700 border-gray-300 hover:bg-[rgb(var(--c-info-bg))]')}>
               Prévu
            </button>
          )}
          <button onClick={() => setFormData(f => ({ ...f, status: 'a_prendre', rdv_date: '', rdv_time: '' }))}
            className={'px-3 py-1.5 rounded-ui-sm text-ui font-medium border transition-colors ' +
              (formData.status === 'a_prendre' ? 'bg-[rgb(var(--c-danger))] text-white border-[rgb(var(--c-danger)/0.3)]' : 'bg-white text-gray-700 border-gray-300 hover:bg-[rgb(var(--c-danger-bg))]')}>
             À planifier
          </button>
          <button onClick={() => handleQuickStatus('realise')}
            className={'px-3 py-1.5 rounded-ui-sm text-ui font-medium border transition-colors ' +
              (formData.status === 'realise' ? 'bg-[rgb(var(--c-success))] text-white border-[rgb(var(--c-success)/0.3)]' : 'bg-white text-gray-700 border-gray-300 hover:bg-[rgb(var(--c-success-bg))]')}>
             Réalisé
          </button>
          <button onClick={() => handleQuickStatus('annule')}
            className={'px-3 py-1.5 rounded-ui-sm text-ui font-medium border transition-colors ' +
              (formData.status === 'annule' ? 'bg-gray-600 text-white border-gray-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50')}>
             Annulé
          </button>
          {(formData.status === 'realise' || (formData.status === 'prevu' && formData.rdv_date && formData.rdv_date < todayStr())) && (
            <button onClick={() => setShowSuite(true)}
              className="px-3 py-1.5 rounded-ui-sm text-ui font-medium bg-gray-900 text-white hover:bg-gray-700 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" /> Suite du RDV
            </button>
          )}
          {(formData.status === 'prevu' || formData.status === 'a_prendre') && (
            <button onClick={() => setShowPrep(true)}
              className="px-3 py-1.5 rounded-ui-sm text-ui font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 flex items-center gap-1.5">
              <FileText className="w-4 h-4" /> Préparer le RDV
            </button>
          )}
          {outcomeInfo?.outcome && (
            <span className="px-2.5 py-1 rounded-ui-sm text-ui-sm font-medium bg-white border border-gray-300 text-gray-700">
              Suite : {OUTCOME_LABELS[outcomeInfo.outcome] || outcomeInfo.outcome}
              {outcomeInfo.outcome === 'a_recontacter' && formData.next_action_date ? ` le ${fmtDateLocal(formData.next_action_date)}` : ''}
              {outcomeInfo.outcome_by ? ` · ${outcomeInfo.outcome_by}` : ''}
            </span>
          )}
          {formData.client_id && formData.status === 'realise' && (
            <button onClick={() => navigate(`/devis?client_id=${formData.client_id}`)}
              className="ml-auto px-3 py-1.5 rounded-ui-sm text-ui font-medium bg-[rgb(var(--c-warning))] text-white hover:bg-[rgb(var(--c-warning))] flex items-center gap-1.5">
              <FileText className="w-4 h-4" /> Créer devis
            </button>
          )}
          {formData.client_id && (
            <button onClick={() => navigate(`/clients/${formData.client_id}`)}
              className="px-3 py-1.5 rounded-ui-sm text-ui font-medium bg-white text-gray-600 border border-gray-300 hover:bg-gray-50 flex items-center gap-1.5">
              <ExternalLink className="w-4 h-4" /> Fiche client
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Colonne gauche : formulaire ─────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Infos RDV */}
          <div className="bg-white rounded-ui border border-gray-200 p-5">
            <h2 className="text-base font-semibold mb-4 flex items-center gap-2 text-gray-800">
              <Calendar className="w-4 h-4 text-primary-600" /> Informations du RDV
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              <div className="md:col-span-2">
                <label className="block text-ui font-medium text-gray-700 mb-1">Client *</label>
                <div className="flex gap-2">
                  <SearchSelect value={formData.client_id} className="flex-1"
                    onChange={v => setFormData({ ...formData, client_id: v })}
                    options={clientOptions(clients)} emptyLabel="Sélectionner un client" searchPlaceholder="Rechercher un client..." aria-label="Client" />
                  <button onClick={() => setShowNewClientModal(true)}
                    className="px-3 py-2 border border-gray-300 rounded-ui-sm text-ui text-primary-600 hover:bg-primary-50 flex items-center gap-1">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Statut */}
              <div className="md:col-span-2">
                <label className="block text-ui font-medium text-gray-700 mb-2">Statut</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: 'a_prendre', label: 'À planifier' },
                    { value: 'prevu', label: 'Prévu' },
                    { value: 'realise', label: 'Réalisé' },
                    { value: 'annule', label: 'Annulé' },
                  ].map(s => (
                    <button key={s.value} type="button"
                      onClick={() => setFormData({ ...formData, status: s.value })}
                      className={'px-3 py-1.5 rounded-ui-sm border text-ui font-medium transition-colors ' +
                        (formData.status === s.value ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400')}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {formData.status !== 'a_prendre' && (<>
                <div>
                  <label className="block text-ui font-medium text-gray-700 mb-1">Date</label>
                  <input type="date" value={formData.rdv_date}
                    onChange={e => setFormData({ ...formData, rdv_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm focus:ring-2 focus:ring-primary-500 text-ui" />
                </div>
                <div>
                  <label className="block text-ui font-medium text-gray-700 mb-1">Heure</label>
                  <input type="time" value={formData.rdv_time}
                    onChange={e => setFormData({ ...formData, rdv_time: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm focus:ring-2 focus:ring-primary-500 text-ui" />
                </div>
                <div>
                  <label className="block text-ui font-medium text-gray-700 mb-1">Type</label>
                  <select value={formData.rdv_type}
                    onChange={e => setFormData({ ...formData, rdv_type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm focus:ring-2 focus:ring-primary-500 text-ui">
                    <option value="decouverte">Découverte</option>
                    <option value="suivi">Suivi</option>
                    <option value="signature">Signature</option>
                    <option value="relance">Relance</option>
                    <option value="telephone">Téléphone</option>
                    <option value="autre">Autre</option>
                  </select>
                </div>
                <div>
                  <label className="block text-ui font-medium text-gray-700 mb-1">Lieu</label>
                  <select value={formData.rdv_location}
                    onChange={e => setFormData({ ...formData, rdv_location: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm focus:ring-2 focus:ring-primary-500 text-ui">
                    <option value="leurs_locaux"> Leurs locaux</option>
                    <option value="nos_locaux"> Nos locaux</option>
                    <option value="visio"> Visio</option>
                    <option value="telephone"> Téléphone</option>
                  </select>
                </div>
              </>)}

              <div>
                <label className="block text-ui font-medium text-gray-700 mb-1">Mené par</label>
                <select value={formData.conducted_by}
                  onChange={e => setFormData({ ...formData, conducted_by: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm focus:ring-2 focus:ring-primary-500 text-ui">
                  <option value="">Sélectionner</option>
                  {teamFirstNames().map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input type="checkbox" id="urgent" checked={formData.is_urgent}
                  onChange={e => setFormData({ ...formData, is_urgent: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-[rgb(var(--c-danger))]" />
                <label htmlFor="urgent" className="text-ui text-gray-700 cursor-pointer"> Urgent</label>
              </div>
            </div>
          </div>

          {/* Contact */}
          <div className="bg-white rounded-ui border border-gray-200 p-5">
            <h2 className="text-base font-semibold mb-4 flex items-center gap-2 text-gray-800">
              <User className="w-4 h-4 text-primary-600" /> Contact
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {contacts.length > 0 && (
                <div className="md:col-span-2">
                  <label className="block text-ui font-medium text-gray-700 mb-1">Contact existant</label>
                  <select value={formData.contact_id || ''}
                    onChange={e => {
                      const c = contacts.find(c => c.id === e.target.value)
                      if (c) setFormData({ ...formData, contact_id: c.id, contact_name: c.name || '', contact_email: c.email || '', contact_phone: c.phone || c.mobile || '' })
                      else setFormData({ ...formData, contact_id: null, contact_name: '', contact_email: '', contact_phone: '' })
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm focus:ring-2 focus:ring-primary-500 text-ui">
                    <option value="">- Saisie manuelle -</option>
                    {contacts.map(c => <option key={c.id} value={c.id}>{c.name} {c.is_primary && '(Principal)'}</option>)}
                  </select>
                </div>
              )}
              <div className="md:col-span-2">
                <label className="block text-ui font-medium text-gray-700 mb-1">Nom</label>
                <input type="text" value={formData.contact_name}
                  onChange={e => setFormData({ ...formData, contact_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm focus:ring-2 focus:ring-primary-500 text-ui" />
              </div>
              <div>
                <label className="block text-ui font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={formData.contact_email}
                  onChange={e => setFormData({ ...formData, contact_email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm focus:ring-2 focus:ring-primary-500 text-ui" />
              </div>
              <div>
                <label className="block text-ui font-medium text-gray-700 mb-1">Téléphone</label>
                <input type="tel" value={formData.contact_phone}
                  onChange={e => setFormData({ ...formData, contact_phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm focus:ring-2 focus:ring-primary-500 text-ui" />
              </div>
            </div>
          </div>

          {/* Prochaine action */}
          <div className="bg-white rounded-ui border border-gray-200 p-5">
            <h2 className="text-base font-semibold mb-4 flex items-center gap-2 text-gray-800">
              <Zap className="w-4 h-4 text-[rgb(var(--c-warning))]" /> Prochaine action
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-ui font-medium text-gray-700 mb-1">Action</label>
                <input type="text" value={formData.next_action}
                  onChange={e => setFormData({ ...formData, next_action: e.target.value })}
                  placeholder="Ex: Envoyer devis SST"
                  className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm focus:ring-2 focus:ring-primary-500 text-ui" />
              </div>
              <div>
                <label className="block text-ui font-medium text-gray-700 mb-1">Date</label>
                <input type="date" value={formData.next_action_date}
                  onChange={e => setFormData({ ...formData, next_action_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm focus:ring-2 focus:ring-primary-500 text-ui" />
              </div>
            </div>
          </div>

          {/* Analyse des besoins */}
          {formData.client_id && (
            <div className="bg-white rounded-ui border border-gray-200 p-5">
              <h2 className="text-base font-semibold mb-4 flex items-center gap-2 text-gray-800">
                <FileText className="w-4 h-4 text-primary-600" /> Analyse des besoins
              </h2>
              <ProspectNeedsAnalysis clientId={formData.client_id} rdvId={id !== 'nouveau' ? id : null} onClose={() => {}} />
            </div>
          )}

          {/* Compte-rendu */}
          {formData.client_id && (
            <button onClick={() => setShowCompteRendu(true)}
              className="w-full flex items-center justify-center gap-2 btn btn-secondary text-ui font-medium">
              <Mail className="w-4 h-4" /> Générer Compte-Rendu
            </button>
          )}
        </div>

        {/* ── Colonne droite : Fil CRM ─────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Info client */}
          {selectedClient && (
            <div className="bg-white rounded-ui border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900 mb-3 text-ui flex items-center gap-2">
                <Building2 className="w-4 h-4 text-gray-400" /> {selectedClient.name}
              </h3>
              <div className="space-y-1.5 text-ui">
                {selectedClient.city && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    {selectedClient.postal_code} {selectedClient.city}
                  </div>
                )}
                {(selectedClient.contact_phone || selectedClient.mobile) && (
                  <a href={'tel:' + (selectedClient.contact_phone || selectedClient.mobile)}
                    className="flex items-center gap-2 text-primary-600 hover:underline">
                    <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                    {selectedClient.contact_phone || selectedClient.mobile}
                  </a>
                )}
                {selectedClient.email && (
                  <div className="flex items-center gap-2 text-gray-600 text-ui-sm truncate">
                    <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                    {selectedClient.email}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Fil CRM ─────────────────────────────────────────── */}
          <div className="bg-white rounded-ui border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 text-ui flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary-500" />
                Fil CRM
                {crmFil.length > 0 && (
                  <span className="bg-primary-100 text-primary-700 text-ui-sm px-1.5 py-0.5 rounded-full">
                    {crmFil.length}
                  </span>
                )}
              </h3>
              {crmLoading && <div className="w-4 h-4 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />}
            </div>

            <div className="p-3 space-y-3 max-h-[600px] overflow-y-auto">

              {/* Ajouter note */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  <textarea value={newNote} onChange={e => setNewNote(e.target.value)}
                    rows={2} placeholder="Ajouter une note, un compte-rendu d'appel..."
                    className="flex-1 border border-gray-200 rounded-ui-sm px-2.5 py-2 text-ui resize-none focus:ring-2 focus:ring-primary-400 focus:border-transparent" />
                </div>
                <button onClick={addNote} disabled={!newNote.trim() || savingNote || !formData.client_id}
                  className="w-full py-1.5 rounded-ui-sm text-ui font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  {savingNote ? 'Ajout...' : 'Ajouter note'}
                </button>
              </div>

              <hr className="border-gray-100" />

              {/* Fil */}
              {crmFil.length === 0 && !crmLoading && (
                <p className="text-ui-sm text-gray-400 italic text-center py-3">Aucune interaction enregistrée</p>
              )}

              {crmFil.map((item, i) => (
                <div key={item.id + '-' + i}>
                  {item._type === 'call' ? (
                    /* ── Appel de prospection ── */
                    <div className={'rounded-ui-sm border p-3 text-ui-sm space-y-1.5 ' + (RESULT_COLORS[item.result] || 'bg-gray-50 border-gray-200')}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">
                           {item.author} - {RESULT_LABELS[item.result] || item.result}
                        </span>
                        <span className="opacity-60 whitespace-nowrap">{fmtDateTime(item.date)}</span>
                      </div>
                      {item.contact_name && (
                        <div className="flex items-center gap-1.5 opacity-90">
                          <User className="w-3 h-3" />
                          <span className="font-medium">{item.contact_name}</span>
                          {item.contact_function && <span className="opacity-70">- {item.contact_function}</span>}
                        </div>
                      )}
                      {item.contact_mobile && (
                        <a href={'tel:' + item.contact_mobile}
                          className="flex items-center gap-1.5 hover:underline">
                          <Phone className="w-3 h-3" /> {item.contact_mobile}
                        </a>
                      )}
                      {item.contact_email && (
                        <div className="flex items-center gap-1.5 opacity-80 break-all">
                          <Mail className="w-3 h-3 flex-shrink-0" /> {item.contact_email}
                        </div>
                      )}
                      {item.formations?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.formations.map(f => (
                            <span key={f} className="px-1.5 py-0.5 bg-white/60 rounded border border-current/20 font-medium">
                               {f}
                            </span>
                          ))}
                        </div>
                      )}
                      {item.notes && (
                        <p className="opacity-90 whitespace-pre-line leading-snug mt-1 border-t border-current/10 pt-1.5">
                          {item.notes}
                        </p>
                      )}
                      {item.duration > 0 && (
                        <p className="opacity-50 text-ui-sm">
                           {Math.floor(item.duration / 60)}min {item.duration % 60}s
                        </p>
                      )}
                    </div>
                  ) : (
                    /* ── Interaction (note, email, meeting…) ── */
                    <div className={'rounded-ui-sm border p-3 text-ui-sm space-y-1 ' + (INTERACTION_COLORS[item.type] || INTERACTION_COLORS.note)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{item.title || item.type}</span>
                        <span className="text-gray-500 whitespace-nowrap">{item.author} · {fmtDateTime(item.date)}</span>
                      </div>
                      {item.content && (
                        <p className="text-gray-700 whitespace-pre-line leading-snug">{item.content}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Note initiale RDV (contexte de la prise de rendez-vous) si elle n'est pas dans les appels */}
              {initialNotes && marineCalls.length === 0 && (
                <div className="rounded-ui-sm border border-gray-200 bg-gray-50 p-3 text-ui-sm">
                  <p className="font-semibold text-gray-800 mb-1">Note initiale</p>
                  <p className="text-gray-800 whitespace-pre-line leading-snug">{initialNotes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Notes brutes du RDV (champ éditable, en bas) */}
          <div className="bg-white rounded-ui border border-gray-200 p-4">
            <button onClick={() => setShowFullNotes(!showFullNotes)}
              className="w-full flex items-center justify-between text-ui font-medium text-gray-700 mb-2">
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-400" /> Notes du RDV (brutes)
              </span>
              {showFullNotes ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {showFullNotes && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-ui-sm text-gray-400">Contenu brut - figé sauf modification volontaire</span>
                  <SpeechToTextButton onTranscript={text => setFormData(f => ({ ...f, notes: f.notes ? f.notes + ' ' + text : text }))} />
                </div>
                <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm focus:ring-2 focus:ring-primary-500 text-ui resize-none"
                  placeholder="Notes brutes..." />
              </div>
            )}
            {!showFullNotes && formData.notes && (
              <p className="text-ui-sm text-gray-500 line-clamp-2 whitespace-pre-line">{formData.notes}</p>
            )}
          </div>

        </div>
      </div>

      {/* ── Modal création client ─────────────────────────────────────────── */}
      {showNewClientModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-ui max-w-lg w-full">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-bold">Créer un client</h2>
              <button onClick={() => setShowNewClientModal(false)} className="p-2 hover:bg-gray-100 rounded-ui-sm">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {[
                { label: "Nom *", field: 'name', placeholder: 'ENTREPRISE ABC' },
                { label: "SIRET", field: 'siret', placeholder: '12345678901234' },
                { label: "Email", field: 'email', placeholder: 'contact@entreprise.fr' },
                { label: "Téléphone", field: 'contact_phone', placeholder: '01 23 45 67 89' },
                { label: "Adresse", field: 'address', placeholder: '12 rue Example' },
              ].map(({ label, field, placeholder }) => (
                <div key={field}>
                  <label className="block text-ui font-medium text-gray-700 mb-1">{label}</label>
                  <input type="text" value={newClientData[field]}
                    onChange={e => setNewClientData({ ...newClientData, [field]: e.target.value })}
                    placeholder={placeholder}
                    className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm text-ui" />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-ui font-medium text-gray-700 mb-1">Code postal</label>
                  <input type="text" value={newClientData.postal_code}
                    onChange={e => setNewClientData({ ...newClientData, postal_code: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm text-ui" />
                </div>
                <div>
                  <label className="block text-ui font-medium text-gray-700 mb-1">Ville</label>
                  <input type="text" value={newClientData.city}
                    onChange={e => setNewClientData({ ...newClientData, city: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm text-ui" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowNewClientModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-ui-sm text-ui hover:bg-gray-50">
                  Annuler
                </button>
                <button onClick={handleCreateClient}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-ui-sm text-ui hover:bg-primary-700">
                  Créer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Compte-Rendu ────────────────────────────────────────────── */}
      {showCompteRendu && (
        <CompteRenduModal rdv={formData} client={selectedClient} analysisData={null}
          onClose={() => setShowCompteRendu(false)} />
      )}
    </div>
  )
}

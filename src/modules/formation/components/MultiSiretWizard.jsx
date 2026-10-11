import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Building2, Users, FileCheck, ChevronRight, ChevronLeft, Search, CheckCircle, AlertCircle, Loader2, Euro } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { useDataStore as useStore } from '../../../core/store'
import toast from 'react-hot-toast'

const FUNDING_TYPES = [
  { value: 'none', label: 'Aucun (pas de mention)' },
  { value: 'opco', label: 'OPCO' },
  { value: 'cpf', label: 'CPF' },
  { value: 'faf', label: 'FAF' },
  { value: 'region', label: 'Région' },
  { value: 'france_travail', label: 'France Travail' },
  { value: 'ptp', label: 'PTP' },
  { value: 'fne', label: 'FNE' },
  { value: 'direct', label: 'Financement direct' },
  { value: 'other', label: 'Autre' },
]

const EMPTY_GROUP = () => ({
  id: crypto.randomUUID(),
  company_name: '',
  siret: '',
  address: '',
  postal_code: '',
  city: '',
  matched_client: null, // Client existant trouvé par SIRET
  client_contacts: [],  // Contacts du client existant (chargés au match SIRET)
  // Signataire propre à cette entreprise (vide = signataire par défaut de l'étape 1)
  signatory_name: '',
  signatory_role: '',
  // Contact convocations propre à cette entreprise
  contact_id: '',       // contact existant choisi dans la fiche client
  contact_name: '',     // ou nouveau contact saisi (vide = contact par défaut de l'étape 1)
  contact_role: '',
  contact_email: '',
  contact_phone: '',
  trainees: [EMPTY_TRAINEE()],
})

// Libellé lisible d'un contact client (name ou prénom + nom)
const contactLabel = (c) => {
  if (!c) return ''
  const name = c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim()
  const role = c.role || c.fonction
  return role ? `${name} (${role})` : name
}
const contactName = (c) => (c ? (c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim()) : '')

const EMPTY_TRAINEE = () => ({
  id: crypto.randomUUID(),
  last_name: '',
  first_name: '',
  birth_date: '',
  birth_place: '',
  social_security_number: '',
  gender: '',
  matched_trainee: null, // Stagiaire existant trouvé
})

export default function MultiSiretWizard({ onClose, onCreated }) {
  const { courses, trainers, clients, trainees: allTrainees, fetchSessions, fetchClients, fetchTrainees } = useStore()
  
  const [step, setStep] = useState(1)
  const [creating, setCreating] = useState(false)
  const [creationLog, setCreationLog] = useState([])
  
  // Step 1: Common session info
  const [common, setCommon] = useState({
    course_id: '',
    start_date: '',
    end_date: '',
    start_time: '09:00',
    end_time: '17:00',
    location: '',
    trainer_id: '',
    is_intra: false,
    funding_type: 'none',
    funding_details: '',
    signatory_name: '',
    signatory_role: '',
    contact_name: '',
    contact_role: '',
    contact_email: '',
    contact_phone: '',
    price_mode: 'global',    // 'global' = prix total réparti | 'per_trainee' = prix unitaire
    price_amount: '',        // montant saisi (total ou unitaire selon mode)
  })
  
  // Step 2: Groups (one per SIRET)
  const [groups, setGroups] = useState([EMPTY_GROUP()])
  
  // Auto-set end_date when start_date changes (1 jour par défaut)
  useEffect(() => {
    if (common.start_date && !common.end_date) {
      setCommon(c => ({ ...c, end_date: c.start_date }))
    }
  }, [common.start_date])
  
  // ──────────────────────────────────────────────
  // SIRET auto-match
  // ──────────────────────────────────────────────
  const handleSiretChange = (groupIdx, siret) => {
    const updated = [...groups]
    updated[groupIdx].siret = siret
    const previousClientId = updated[groupIdx].matched_client?.id || null

    // Chercher client existant par SIRET (nettoyé)
    const cleanSiret = siret.replace(/\s/g, '')
    let found = null
    if (cleanSiret.length >= 9) {
      found = clients.find(c => c.siret && c.siret.replace(/\s/g, '') === cleanSiret) || null
      if (found) {
        updated[groupIdx].matched_client = found
        updated[groupIdx].company_name = found.name || ''
        updated[groupIdx].address = found.address || ''
        updated[groupIdx].postal_code = found.postal_code || ''
        updated[groupIdx].city = found.city || ''
      } else {
        updated[groupIdx].matched_client = null
      }
    } else {
      updated[groupIdx].matched_client = null
    }

    // Client changé → on oublie les contacts de l'ancien client
    const newClientId = found?.id || null
    if (newClientId !== previousClientId) {
      updated[groupIdx].client_contacts = []
      updated[groupIdx].contact_id = ''
    }

    setGroups(updated)

    // Charger les contacts du client existant (pour choisir signataire / contact)
    if (newClientId && newClientId !== previousClientId) {
      loadClientContacts(updated[groupIdx].id, newClientId)
    }
  }

  const loadClientContacts = async (groupId, clientId) => {
    const { data, error } = await supabase
      .from('client_contacts')
      .select('*')
      .eq('client_id', clientId)
      .order('is_primary', { ascending: false })
    if (error) return
    setGroups(prev => prev.map(g => (
      g.id === groupId && g.matched_client?.id === clientId
        ? { ...g, client_contacts: data || [] }
        : g
    )))
  }

  // Mise à jour d'un champ simple d'une entreprise
  const updateGroupField = (groupIdx, field, value) => {
    setGroups(prev => prev.map((g, i) => (i === groupIdx ? { ...g, [field]: value } : g)))
  }

  // Choix du signataire parmi les contacts du client
  const pickSignatoryFromContact = (groupIdx, contactIdValue) => {
    const g = groups[groupIdx]
    const c = (g.client_contacts || []).find(x => x.id === contactIdValue)
    if (!c) return
    setGroups(prev => prev.map((grp, i) => (
      i === groupIdx
        ? { ...grp, signatory_name: contactName(c), signatory_role: c.role || c.fonction || '' }
        : grp
    )))
  }

  // Signataire / contact effectifs d'une entreprise (sinon valeurs par défaut de l'étape 1)
  const effectiveSignatory = (g) => {
    if (g.signatory_name) return { name: g.signatory_name, role: g.signatory_role || '' }
    return { name: common.signatory_name || '', role: common.signatory_role || '' }
  }
  const effectiveContact = (g) => {
    if (g.contact_id) {
      const c = (g.client_contacts || []).find(x => x.id === g.contact_id)
      return { existingId: g.contact_id, name: contactName(c), role: c?.role || c?.fonction || '', email: c?.email || '', phone: c?.phone || c?.mobile || '' }
    }
    if (g.contact_name) {
      return { existingId: null, name: g.contact_name, role: g.contact_role || '', email: g.contact_email || '', phone: g.contact_phone || '' }
    }
    return { existingId: null, name: common.contact_name || '', role: common.contact_role || '', email: common.contact_email || '', phone: common.contact_phone || '' }
  }
  
  // Trainee auto-match by last_name
  const handleTraineeNameChange = (groupIdx, traineeIdx, field, value) => {
    const updated = [...groups]
    updated[groupIdx].trainees[traineeIdx][field] = value
    
    // Auto-match quand on a nom + prénom
    const t = updated[groupIdx].trainees[traineeIdx]
    if (t.last_name.length >= 2 && t.first_name.length >= 2) {
      const found = allTrainees.find(at => 
        at.last_name?.toLowerCase() === t.last_name.toLowerCase() &&
        at.first_name?.toLowerCase() === t.first_name.toLowerCase()
      )
      if (found) {
        updated[groupIdx].trainees[traineeIdx].matched_trainee = found
        // Auto-fill empty fields
        if (!t.birth_date && found.birth_date) updated[groupIdx].trainees[traineeIdx].birth_date = found.birth_date?.split('T')[0] || ''
        if (!t.social_security_number && found.social_security_number) updated[groupIdx].trainees[traineeIdx].social_security_number = found.social_security_number
        if (!t.gender && found.gender) updated[groupIdx].trainees[traineeIdx].gender = found.gender
      } else {
        updated[groupIdx].trainees[traineeIdx].matched_trainee = null
      }
    }
    
    setGroups(updated)
  }
  
  // ──────────────────────────────────────────────
  // Group management
  // ──────────────────────────────────────────────
  const addGroup = () => setGroups([...groups, EMPTY_GROUP()])
  
  const removeGroup = (idx) => {
    if (groups.length <= 1) return
    setGroups(groups.filter((_, i) => i !== idx))
  }
  
  const addTrainee = (groupIdx) => {
    const updated = [...groups]
    updated[groupIdx].trainees.push(EMPTY_TRAINEE())
    setGroups(updated)
  }
  
  const removeTrainee = (groupIdx, traineeIdx) => {
    const updated = [...groups]
    if (updated[groupIdx].trainees.length <= 1) return
    updated[groupIdx].trainees = updated[groupIdx].trainees.filter((_, i) => i !== traineeIdx)
    setGroups(updated)
  }
  
  // ──────────────────────────────────────────────
  // Validation
  // ──────────────────────────────────────────────
  const validateStep1 = () => {
    if (!common.course_id) return 'Sélectionnez une formation'
    if (!common.start_date) return 'Date de début requise'
    if (!common.end_date) return 'Date de fin requise'
    if (!common.funding_type) return 'Type de financement requis'
    return null
  }
  
  const validateStep2 = () => {
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]
      if (!g.company_name) return `Groupe ${i + 1}: Raison sociale requise`
      if (!g.siret) return `Groupe ${i + 1}: SIRET requis`
      for (let j = 0; j < g.trainees.length; j++) {
        if (!g.trainees[j].last_name || !g.trainees[j].first_name) {
          return `Groupe ${i + 1}, Stagiaire ${j + 1}: Nom et prénom requis`
        }
        if (!g.trainees[j].matched_trainee && !g.trainees[j].gender) {
          return `Groupe ${i + 1}, Stagiaire ${j + 1}: Genre requis`
        }
      }
    }
    return null
  }
  
  const handleNext = () => {
    if (step === 1) {
      const err = validateStep1()
      if (err) return toast.error(err)
      setStep(2)
    } else if (step === 2) {
      const err = validateStep2()
      if (err) return toast.error(err)
      setStep(3)
    }
  }
  
  // ──────────────────────────────────────────────
  // CREATION
  // ──────────────────────────────────────────────
  const handleCreate = async () => {
    setCreating(true)
    setCreationLog([])
    const log = (msg, ok = true) => setCreationLog(prev => [...prev, { msg, ok }])
    
    try {
      const selectedCourse = courses.find(c => c.id === common.course_id)
      
      // ─── Calcul des prix inter ───────────────────────────────
      const interGroupId = crypto.randomUUID()
      const totalTraineesAll = groups.reduce((sum, g) => sum + g.trainees.length, 0)
      const priceAmount = parseFloat(common.price_amount) || 0
      
      let interTotalPrice, pricePerHead
      if (common.price_mode === 'global') {
        interTotalPrice = priceAmount
        pricePerHead = totalTraineesAll > 0 ? priceAmount / totalTraineesAll : 0
      } else {
        pricePerHead = priceAmount
        interTotalPrice = priceAmount * totalTraineesAll
      }
      
      // Arrondi intelligent : le dernier groupe récupère le centime
      const groupPrices = groups.map((g, i) => {
        const raw = pricePerHead * g.trainees.length
        return Math.round(raw * 100) / 100
      })
      // Ajuster le dernier pour que la somme tombe juste
      const sumPrices = groupPrices.reduce((a, b) => a + b, 0)
      const diff = Math.round((interTotalPrice - sumPrices) * 100) / 100
      if (groupPrices.length > 0) groupPrices[groupPrices.length - 1] += diff
      
      for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi]
        const groupLabel = `${group.company_name} (${group.siret})`
        const signatory = effectiveSignatory(group)
        const contact = effectiveContact(group)

        // 1. Client: trouver ou créer
        let clientId = group.matched_client?.id
        if (!clientId) {
          const { data: newClient, error: clientErr } = await supabase
            .from('clients')
            .insert([{
              name: group.company_name,
              siret: group.siret.replace(/\s/g, ''),
              address: group.address || null,
              postal_code: group.postal_code || null,
              city: group.city || null,
              contact_name: contact.name || null,
              contact_function: contact.role || null,
              contact_email: contact.email || null,
              contact_phone: contact.phone || null,
              status: 'actif',
            }])
            .select()
            .single()
          
          if (clientErr) {
            log(`❌ Erreur création client ${groupLabel}: ${clientErr.message}`, false)
            continue
          }
          clientId = newClient.id
          log(`✅ Client créé: ${groupLabel}`)
        } else {
          log(`🔗 Client existant: ${groupLabel}`)
        }
        
        // 2. Contact convocations : contact existant choisi, sinon ajouter si renseigné et pas déjà présent
        let contactId = null
        if (contact.existingId) {
          contactId = contact.existingId
          log(`🔗 Contact existant: ${contact.name} → ${group.company_name}`)
        } else if (contact.name) {
          // Vérifier si ce contact existe déjà pour ce client
          const { data: existingContacts } = await supabase
            .from('client_contacts')
            .select('*')
            .eq('client_id', clientId)
            .ilike('name', contact.name)

          if (existingContacts && existingContacts.length > 0) {
            contactId = existingContacts[0].id
            log(`🔗 Contact existant: ${contact.name}`)
          } else {
            const { data: newContact, error: contactErr } = await supabase
              .from('client_contacts')
              .insert([{
                client_id: clientId,
                name: contact.name,
                role: contact.role || null,
                email: contact.email || null,
                phone: contact.phone || null,
                is_primary: true,
              }])
              .select()
              .single()

            if (!contactErr && newContact) {
              contactId = newContact.id
              log(`✅ Contact ajouté: ${contact.name} → ${group.company_name}`)
            }
          }
        }
        
        // 3. Stagiaires: trouver ou créer
        const traineeIds = []
        for (const t of group.trainees) {
          if (t.matched_trainee?.id) {
            traineeIds.push(t.matched_trainee.id)
            // Mettre à jour le client_id si différent
            if (t.matched_trainee.client_id !== clientId) {
              await supabase.from('trainees').update({ client_id: clientId }).eq('id', t.matched_trainee.id)
            }
            log(`🔗 Stagiaire existant: ${t.first_name} ${t.last_name}`)
          } else {
            const traineeData = {
              first_name: t.first_name,
              last_name: t.last_name,
              birth_date: t.birth_date || null,
              social_security_number: t.social_security_number || null,
              gender: t.gender || null,
              client_id: clientId,
            }
            const { data: newTrainee, error: traineeErr } = await supabase
              .from('trainees')
              .insert([traineeData])
              .select()
              .single()
            
            if (traineeErr) {
              log(`❌ Erreur stagiaire ${t.first_name} ${t.last_name}: ${traineeErr.message}`, false)
              continue
            }
            traineeIds.push(newTrainee.id)
            log(`✅ Stagiaire créé: ${t.first_name} ${t.last_name}`)
          }
        }
        
        // 4. Session: créer (colonnes alignées sur store.js createSession)
        const reference = `SES-${Date.now().toString(36).toUpperCase()}-${gi + 1}`
        const generateHexToken = (bytes = 32) => {
          const arr = new Uint8Array(bytes)
          crypto.getRandomValues(arr)
          return [...arr].map(b => b.toString(16).padStart(2, '0')).join('')
        }
        
        const sessionData = {
          course_id: common.course_id,
          client_id: clientId,
          contact_id: contactId,
          trainer_id: common.trainer_id || null,
          start_date: common.start_date,
          end_date: common.end_date,
          start_time: common.start_time,
          end_time: common.end_time,
          location_name: common.location || null,
          is_intra: common.is_intra,
          is_remote: false,
          day_type: (() => {
            const [sh, sm] = (common.start_time || '09:00').split(':').map(Number)
            const [eh, em] = (common.end_time || '17:00').split(':').map(Number)
            const duration = (eh * 60 + em) - (sh * 60 + sm)
            return duration <= 270 ? 'half' : 'full'
          })(),
          status: 'planned',
          notes: null,
          signatory_name: signatory.name || null,
          signatory_role: signatory.role || null,
          reference,
          attendance_token: generateHexToken(32),
          // Prix inter-entreprises
          total_price: groupPrices[gi] || null,
          inter_group_id: groups.length > 1 ? interGroupId : null,
          inter_total_price: groups.length > 1 ? interTotalPrice : null,
          price_mode: common.price_mode,
        }
        
        const { data: newSession, error: sessionErr } = await supabase
          .from('sessions')
          .insert([sessionData])
          .select()
          .single()
        
        if (sessionErr) {
          log(`❌ Erreur session ${groupLabel}: ${sessionErr.message}`, false)
          continue
        }
        
        // 5. Inscrire les stagiaires
        if (traineeIds.length > 0) {
          const { error: stErr } = await supabase
            .from('session_trainees')
            .insert(traineeIds.map(tid => ({
              session_id: newSession.id,
              trainee_id: tid,
              registration_date: new Date().toISOString(),
            })))
          
          if (stErr) {
            log(`⚠️ Erreur inscription stagiaires ${groupLabel}: ${stErr.message}`, false)
          }
        }
        
        log(`✅ Session créée: ${selectedCourse?.title} — ${group.company_name} (${traineeIds.length} stagiaires • ${groupPrices[gi]?.toFixed(2) || '0.00'}€ HT)`)
      }
      
      log(`🎉 Terminé ! ${groups.length} sessions créées`)
      
      // Rafraîchir les données
      await Promise.all([fetchSessions(), fetchClients(), fetchTrainees()])
      
    } catch (err) {
      log(`❌ Erreur inattendue: ${err.message}`, false)
    }
    
    setCreating(false)
  }
  
  // ──────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────
  const selectedCourse = courses.find(c => c.id === common.course_id)
  const totalTrainees = groups.reduce((sum, g) => sum + g.trainees.length, 0)
  
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-full flex items-start justify-center p-4 pt-8">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
          
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white z-10">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Building2 className="w-5 h-5 text-purple-600" />
                Session multi-SIRET
              </h2>
              <p className="text-sm text-gray-500">Créer plusieurs sessions pour des entreprises d'un même groupe</p>
            </div>
            <button onClick={onClose}><X className="w-5 h-5" /></button>
          </div>
          
          {/* Step indicators */}
          <div className="flex items-center gap-2 px-6 py-3 bg-gray-50 border-b">
            {[
              { n: 1, label: 'Formation', icon: FileCheck },
              { n: 2, label: 'Entreprises & Stagiaires', icon: Building2 },
              { n: 3, label: 'Récapitulatif', icon: CheckCircle },
            ].map((s, i) => (
              <div key={s.n} className="flex items-center gap-2">
                {i > 0 && <ChevronRight className="w-4 h-4 text-gray-300" />}
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  step === s.n ? 'bg-purple-100 text-purple-700' : 
                  step > s.n ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
                }`}>
                  <s.icon className="w-4 h-4" />
                  {s.label}
                </div>
              </div>
            ))}
          </div>
          
          <div className="p-6">
            
            {/* ═══════════════════ STEP 1: Formation ═══════════════════ */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="label">Formation *</label>
                    <select className="input" value={common.course_id} onChange={e => setCommon({...common, course_id: e.target.value})}>
                      <option value="">Sélectionner...</option>
                      {courses.filter(c => c.is_active !== false).map(c => (
                        <option key={c.id} value={c.id}>{c.code ? `[${c.code}] ` : ''}{c.title}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="label">Date début *</label>
                    <input type="date" className="input" value={common.start_date} onChange={e => setCommon({...common, start_date: e.target.value, end_date: common.end_date || e.target.value})} />
                  </div>
                  <div>
                    <label className="label">Date fin *</label>
                    <input type="date" className="input" value={common.end_date} onChange={e => setCommon({...common, end_date: e.target.value})} />
                  </div>
                  <div>
                    <label className="label">Heure début</label>
                    <input type="time" className="input" value={common.start_time} onChange={e => setCommon({...common, start_time: e.target.value})} />
                  </div>
                  <div>
                    <label className="label">Heure fin</label>
                    <input type="time" className="input" value={common.end_time} onChange={e => setCommon({...common, end_time: e.target.value})} />
                  </div>
                  
                  <div>
                    <label className="label">Lieu</label>
                    <input type="text" className="input" value={common.location} onChange={e => setCommon({...common, location: e.target.value})} placeholder="Ex: Intersport Concarneau" />
                  </div>
                  <div>
                    <label className="label">Formateur</label>
                    <select className="input" value={common.trainer_id} onChange={e => setCommon({...common, trainer_id: e.target.value})}>
                      <option value="">-- Non assigné --</option>
                      {trainers.map(t => (
                        <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="label">Financement *</label>
                    <select className="input" value={common.funding_type} onChange={e => setCommon({...common, funding_type: e.target.value})}>
                      {FUNDING_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Précisions financement</label>
                    <input type="text" className="input" value={common.funding_details} onChange={e => setCommon({...common, funding_details: e.target.value})} placeholder="Ex: OPCO Atlas..." />
                  </div>
                </div>
                
                {/* Tarification inter */}
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg space-y-3">
                  <p className="font-medium text-green-800 text-sm flex items-center gap-2">
                    <Euro className="w-4 h-4" /> Tarification de la session
                  </p>
                  <div className="flex gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setCommon({...common, price_mode: 'global'})}
                      className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border-2 transition-colors ${
                        common.price_mode === 'global' 
                          ? 'border-green-500 bg-green-100 text-green-800' 
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      💰 Prix global session
                      <span className="block text-xs font-normal mt-0.5 opacity-75">Réparti entre les entreprises</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCommon({...common, price_mode: 'per_trainee'})}
                      className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border-2 transition-colors ${
                        common.price_mode === 'per_trainee' 
                          ? 'border-green-500 bg-green-100 text-green-800' 
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      👤 Prix par stagiaire
                      <span className="block text-xs font-normal mt-0.5 opacity-75">Multiplié par le nombre</span>
                    </button>
                  </div>
                  <div>
                    <label className="label text-xs">
                      {common.price_mode === 'global' ? 'Prix total de la session HT (€)' : 'Prix par stagiaire HT (€)'}
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input pr-8"
                        value={common.price_amount}
                        onChange={e => setCommon({...common, price_amount: e.target.value})}
                        placeholder={common.price_mode === 'global' ? 'Ex: 600' : 'Ex: 120'}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€ HT</span>
                    </div>
                    {common.price_amount && groups.length > 0 && (
                      <p className="text-xs text-green-700 mt-1.5">
                        {(() => {
                          const amount = parseFloat(common.price_amount) || 0
                          const totalTraineesCount = groups.reduce((sum, g) => sum + g.trainees.length, 0)
                          if (common.price_mode === 'global' && totalTraineesCount > 0) {
                            const perHead = amount / totalTraineesCount
                            return `→ ${perHead.toFixed(2)}€ par stagiaire × ${totalTraineesCount} stagiaires = ${amount.toFixed(2)}€ HT`
                          } else if (common.price_mode === 'per_trainee' && totalTraineesCount > 0) {
                            return `→ ${amount.toFixed(2)}€ × ${totalTraineesCount} stagiaires = ${(amount * totalTraineesCount).toFixed(2)}€ HT total`
                          }
                          return ''
                        })()}
                      </p>
                    )}
                  </div>
                </div>
                
                {/* Signataire par défaut */}
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
                  <p className="font-medium text-amber-800 text-sm">✍️ Signataire des conventions par défaut</p>
                  <p className="text-xs text-amber-700 -mt-2">Utilisé pour les entreprises sans signataire propre (modifiable par entreprise à l'étape suivante).</p>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <label className="label text-xs">Nom du signataire</label>
                      <input type="text" className="input" value={common.signatory_name} onChange={e => setCommon({...common, signatory_name: e.target.value})} placeholder="Ex: Frédéric LE REGENT" />
                    </div>
                    <div>
                      <label className="label text-xs">Fonction</label>
                      <input type="text" className="input" value={common.signatory_role} onChange={e => setCommon({...common, signatory_role: e.target.value})} placeholder="Ex: Dirigeant" />
                    </div>
                  </div>
                </div>
                
                {/* Contact par défaut */}
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                  <p className="font-medium text-blue-800 text-sm">📧 Contact opérationnel par défaut (convocations)</p>
                  <p className="text-xs text-blue-700 -mt-2">Ajouté aux entreprises sans contact propre (modifiable par entreprise à l'étape suivante).</p>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <label className="label text-xs">Nom du contact</label>
                      <input type="text" className="input" value={common.contact_name} onChange={e => setCommon({...common, contact_name: e.target.value})} placeholder="Ex: Aénor POUCH LEDUC" />
                    </div>
                    <div>
                      <label className="label text-xs">Fonction</label>
                      <input type="text" className="input" value={common.contact_role} onChange={e => setCommon({...common, contact_role: e.target.value})} placeholder="Ex: Responsable RH" />
                    </div>
                    <div>
                      <label className="label text-xs">Email</label>
                      <input type="email" className="input" value={common.contact_email} onChange={e => setCommon({...common, contact_email: e.target.value})} placeholder="email@example.com" />
                    </div>
                    <div>
                      <label className="label text-xs">Téléphone</label>
                      <input type="tel" className="input" value={common.contact_phone} onChange={e => setCommon({...common, contact_phone: e.target.value})} placeholder="06 00 00 00 00" />
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* ═══════════════════ STEP 2: Entreprises & Stagiaires ═══════════════════ */}
            {step === 2 && (
              <div className="space-y-6">
                {groups.map((group, gi) => (
                  <div key={group.id} className="border-2 border-gray-200 rounded-xl overflow-hidden">
                    {/* Group header */}
                    <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-purple-600" />
                        <span className="font-semibold text-gray-700">Entreprise {gi + 1}</span>
                        {group.matched_client && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Client existant
                          </span>
                        )}
                      </div>
                      {groups.length > 1 && (
                        <button onClick={() => removeGroup(gi)} className="text-red-500 hover:text-red-700 p-1">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    
                    <div className="p-4 space-y-4">
                      {/* Company info */}
                      <div className="grid md:grid-cols-3 gap-3">
                        <div>
                          <label className="label text-xs">SIRET *</label>
                          <input
                            type="text"
                            className={`input ${group.matched_client ? 'border-green-400 bg-green-50' : ''}`}
                            value={group.siret}
                            onChange={e => handleSiretChange(gi, e.target.value)}
                            placeholder="323 970 764 000 29"
                          />
                        </div>
                        <div>
                          <label className="label text-xs">Raison sociale *</label>
                          <input
                            type="text"
                            className={`input ${group.matched_client ? 'bg-green-50' : ''}`}
                            value={group.company_name}
                            onChange={e => { const u = [...groups]; u[gi].company_name = e.target.value; setGroups(u) }}
                            placeholder="SAS KERA SPORT"
                          />
                        </div>
                        <div>
                          <label className="label text-xs">Ville</label>
                          <input
                            type="text"
                            className={`input ${group.matched_client ? 'bg-green-50' : ''}`}
                            value={group.city}
                            onChange={e => { const u = [...groups]; u[gi].city = e.target.value; setGroups(u) }}
                            placeholder="CONCARNEAU"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="label text-xs">Adresse</label>
                          <input
                            type="text"
                            className={`input ${group.matched_client ? 'bg-green-50' : ''}`}
                            value={group.address}
                            onChange={e => { const u = [...groups]; u[gi].address = e.target.value; setGroups(u) }}
                            placeholder="ZA KERAMPERU, 3 RUE RENE MADEC"
                          />
                        </div>
                        <div>
                          <label className="label text-xs">Code postal</label>
                          <input
                            type="text"
                            className={`input ${group.matched_client ? 'bg-green-50' : ''}`}
                            value={group.postal_code}
                            onChange={e => { const u = [...groups]; u[gi].postal_code = e.target.value; setGroups(u) }}
                            placeholder="29900"
                          />
                        </div>
                      </div>

                      {/* Signataire & contact propres à cette entreprise */}
                      <div className="grid md:grid-cols-2 gap-3">
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                          <p className="text-xs font-medium text-amber-800">✍️ Signataire de la convention</p>
                          {group.client_contacts?.length > 0 && (
                            <select
                              className="input text-sm py-1"
                              value=""
                              onChange={e => pickSignatoryFromContact(gi, e.target.value)}
                            >
                              <option value="">Choisir parmi les contacts du client...</option>
                              {group.client_contacts.map(c => (
                                <option key={c.id} value={c.id}>{contactLabel(c)}</option>
                              ))}
                            </select>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="text"
                              className="input text-sm py-1"
                              value={group.signatory_name}
                              onChange={e => updateGroupField(gi, 'signatory_name', e.target.value)}
                              placeholder={common.signatory_name ? `Par défaut : ${common.signatory_name}` : 'Nom du signataire'}
                            />
                            <input
                              type="text"
                              className="input text-sm py-1"
                              value={group.signatory_role}
                              onChange={e => updateGroupField(gi, 'signatory_role', e.target.value)}
                              placeholder={common.signatory_role ? `Par défaut : ${common.signatory_role}` : 'Fonction'}
                            />
                          </div>
                        </div>

                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                          <p className="text-xs font-medium text-blue-800">📧 Contact convocations</p>
                          {group.client_contacts?.length > 0 && (
                            <select
                              className="input text-sm py-1"
                              value={group.contact_id}
                              onChange={e => updateGroupField(gi, 'contact_id', e.target.value)}
                            >
                              <option value="">{group.contact_name ? 'Nouveau contact (saisi ci-dessous)' : (common.contact_name ? `Par défaut : ${common.contact_name}` : '— Aucun —')}</option>
                              {group.client_contacts.map(c => (
                                <option key={c.id} value={c.id}>{contactLabel(c)}</option>
                              ))}
                            </select>
                          )}
                          {!group.contact_id && (
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="text"
                                className="input text-sm py-1"
                                value={group.contact_name}
                                onChange={e => updateGroupField(gi, 'contact_name', e.target.value)}
                                placeholder={common.contact_name ? `Par défaut : ${common.contact_name}` : 'Nom du contact'}
                              />
                              <input
                                type="text"
                                className="input text-sm py-1"
                                value={group.contact_role}
                                onChange={e => updateGroupField(gi, 'contact_role', e.target.value)}
                                placeholder="Fonction"
                              />
                              <input
                                type="email"
                                className="input text-sm py-1"
                                value={group.contact_email}
                                onChange={e => updateGroupField(gi, 'contact_email', e.target.value)}
                                placeholder="Email"
                              />
                              <input
                                type="tel"
                                className="input text-sm py-1"
                                value={group.contact_phone}
                                onChange={e => updateGroupField(gi, 'contact_phone', e.target.value)}
                                placeholder="Téléphone"
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Trainees */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="label text-xs flex items-center gap-1">
                            <Users className="w-4 h-4" /> Stagiaires ({group.trainees.length})
                          </label>
                          <button onClick={() => addTrainee(gi)} className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1">
                            <Plus className="w-3 h-3" /> Ajouter
                          </button>
                        </div>
                        
                        <div className="space-y-2">
                          {group.trainees.map((t, ti) => (
                            <div key={t.id} className={`flex items-start gap-2 p-2 rounded-lg ${t.matched_trainee ? 'bg-green-50 border border-green-200' : 'bg-gray-50'}`}>
                              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 flex-1">
                                <input
                                  type="text"
                                  className="input text-sm py-1"
                                  value={t.last_name}
                                  onChange={e => handleTraineeNameChange(gi, ti, 'last_name', e.target.value)}
                                  placeholder="NOM *"
                                />
                                <input
                                  type="text"
                                  className="input text-sm py-1"
                                  value={t.first_name}
                                  onChange={e => handleTraineeNameChange(gi, ti, 'first_name', e.target.value)}
                                  placeholder="Prénom *"
                                />
                                <select
                                  className="input text-sm py-1"
                                  value={t.gender || ''}
                                  onChange={e => { const u = [...groups]; u[gi].trainees[ti].gender = e.target.value; setGroups(u) }}
                                  title="Genre"
                                >
                                  <option value="">Genre *</option>
                                  <option value="male">Homme</option>
                                  <option value="female">Femme</option>
                                  <option value="non_binary">Non genré</option>
                                </select>
                                <input
                                  type="date"
                                  className="input text-sm py-1"
                                  value={t.birth_date}
                                  onChange={e => { const u = [...groups]; u[gi].trainees[ti].birth_date = e.target.value; setGroups(u) }}
                                  title="Date de naissance"
                                />
                                <input
                                  type="text"
                                  className="input text-sm py-1"
                                  value={t.birth_place}
                                  onChange={e => { const u = [...groups]; u[gi].trainees[ti].birth_place = e.target.value; setGroups(u) }}
                                  placeholder="Lieu naissance"
                                />
                                <input
                                  type="text"
                                  className="input text-sm py-1"
                                  value={t.social_security_number}
                                  onChange={e => { const u = [...groups]; u[gi].trainees[ti].social_security_number = e.target.value; setGroups(u) }}
                                  placeholder="N° SS"
                                />
                              </div>
                              {t.matched_trainee && <CheckCircle className="w-4 h-4 text-green-600 mt-2 shrink-0" title="Stagiaire existant" />}
                              {group.trainees.length > 1 && (
                                <button onClick={() => removeTrainee(gi, ti)} className="text-red-400 hover:text-red-600 mt-2 shrink-0">
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                
                <button onClick={addGroup} className="w-full py-3 border-2 border-dashed border-purple-300 rounded-xl text-purple-600 hover:bg-purple-50 flex items-center justify-center gap-2 transition-colors">
                  <Plus className="w-5 h-5" /> Ajouter une entreprise
                </button>
              </div>
            )}
            
            {/* ═══════════════════ STEP 3: Récapitulatif ═══════════════════ */}
            {step === 3 && !creating && creationLog.length === 0 && (
              <div className="space-y-4">
                <div className="bg-purple-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-purple-800 mb-2">Formation</h3>
                  <p className="text-sm">{selectedCourse?.title || '—'}</p>
                  <p className="text-sm text-gray-600">{common.start_date} → {common.end_date} | {common.start_time} - {common.end_time}</p>
                  {common.location && <p className="text-sm text-gray-600">📍 {common.location}</p>}
                </div>
                
                <h3 className="font-semibold">Ce qui va être créé :</h3>
                
                {groups.map((group, gi) => (
                  <div key={group.id} className="border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Building2 className="w-4 h-4 text-purple-600" />
                      <span className="font-medium">{group.company_name}</span>
                      <span className="text-xs text-gray-500">SIRET: {group.siret}</span>
                      {group.matched_client ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Client existant</span>
                      ) : (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Nouveau client</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mb-2">→ 1 convention + 1 session + {group.trainees.length} convocation{group.trainees.length > 1 ? 's' : ''}</p>
                    {(() => {
                      const s = effectiveSignatory(group)
                      const c = effectiveContact(group)
                      return (
                        <>
                          <p className={`text-sm mb-1 ${s.name ? 'text-gray-600' : 'text-amber-700'}`}>
                            ✍️ Signataire : {s.name ? `${s.name}${s.role ? ` (${s.role})` : ''}` : 'non renseigné'}
                          </p>
                          <p className="text-sm text-gray-600 mb-2">
                            📧 Contact : {c.name || 'aucun'}
                          </p>
                        </>
                      )
                    })()}
                    {/* Prix de cette entreprise */}
                    {common.price_amount && (() => {
                      const amount = parseFloat(common.price_amount) || 0
                      const perHead = common.price_mode === 'global' 
                        ? (totalTrainees > 0 ? amount / totalTrainees : 0)
                        : amount
                      const groupTotal = Math.round(perHead * group.trainees.length * 100) / 100
                      return (
                        <p className="text-sm font-medium text-green-700 mb-2">
                          💰 {groupTotal.toFixed(2)}€ HT ({group.trainees.length} × {perHead.toFixed(2)}€/stagiaire)
                        </p>
                      )
                    })()}
                    <div className="flex flex-wrap gap-1">
                      {group.trainees.map(t => (
                        <span key={t.id} className={`text-xs px-2 py-1 rounded-full ${t.matched_trainee ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                          {t.first_name} {t.last_name}
                          {t.matched_trainee ? ' ✓' : ' (nouveau)'}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-sm text-amber-800 font-medium">
                    Résumé : {groups.length} session{groups.length > 1 ? 's' : ''} • {groups.length} convention{groups.length > 1 ? 's' : ''} • {totalTrainees} stagiaire{totalTrainees > 1 ? 's' : ''}
                    {common.price_amount && (() => {
                      const amount = parseFloat(common.price_amount) || 0
                      const total = common.price_mode === 'global' ? amount : amount * totalTrainees
                      return ` • ${total.toFixed(2)}€ HT total`
                    })()}
                  </p>
                </div>
              </div>
            )}
            
            {/* Creation log */}
            {(creating || creationLog.length > 0) && step === 3 && (
              <div className="space-y-2">
                {creating && (
                  <div className="flex items-center gap-2 text-purple-700 mb-4">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="font-medium">Création en cours...</span>
                  </div>
                )}
                <div className="bg-gray-900 text-green-400 rounded-lg p-4 font-mono text-sm max-h-80 overflow-y-auto">
                  {creationLog.map((entry, i) => (
                    <div key={i} className={entry.ok ? '' : 'text-red-400'}>
                      {entry.msg}
                    </div>
                  ))}
                </div>
                {!creating && creationLog.length > 0 && (
                  <div className="flex justify-end gap-2 mt-4">
                    <button onClick={onClose} className="btn btn-primary">Fermer</button>
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Footer navigation */}
          {!(creating || creationLog.length > 0) && (
            <div className="flex justify-between items-center p-4 border-t sticky bottom-0 bg-white">
              <div>
                {step > 1 && (
                  <button onClick={() => setStep(step - 1)} className="btn btn-secondary flex items-center gap-1">
                    <ChevronLeft className="w-4 h-4" /> Retour
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={onClose} className="btn btn-secondary">Annuler</button>
                {step < 3 ? (
                  <button onClick={handleNext} className="btn btn-primary flex items-center gap-1">
                    Suivant <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button onClick={handleCreate} className="btn bg-purple-600 text-white hover:bg-purple-700 flex items-center gap-1">
                    <CheckCircle className="w-4 h-4" /> Créer {groups.length} sessions
                  </button>
                )}
              </div>
            </div>
          )}
          
        </div>
      </div>
    </div>
  )
}

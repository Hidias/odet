import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../core/supabase'
import { FileCheck, Printer, Download, Save, AlertCircle, CheckCircle, Calendar, Eraser } from 'lucide-react'
import toast from 'react-hot-toast'
import SignatureCanvas from 'react-signature-canvas'
import { downloadNeedsAnalysisPDF } from '../../formation/pdf/needsAnalysisPDF'

const CONTEXT_REASONS = [
  { value: 'reglementation', label: 'Réglementation / Obligations légales' },
  { value: 'accident', label: 'Suite à un accident / incident' },
  { value: 'renouvellement', label: 'Renouvellement de certificats' },
  { value: 'nouveaux_embauches', label: 'Nouveaux embauchés' },
  { value: 'evolution_risques', label: 'Évolution des risques' },
  { value: 'autre', label: 'Autre (préciser)' }
]

const PROFILES = [
  { value: 'administratif', label: 'Administratif' },
  { value: 'production', label: 'Production' },
  { value: 'terrain', label: 'Terrain' },
  { value: 'encadrement', label: 'Encadrement' }
]

export default function ProspectNeedsAnalysis({ clientId, rdvId, onClose }) {
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [organization, setOrganization] = useState(null)
  const [client, setClient] = useState(null)
  const [formData, setFormData] = useState({
    analysis_date: new Date().toISOString().split('T')[0], // Date du jour par défaut
    context_reasons: [],
    context_other: '',
    context_stakes: '',
    objectives_description: '',
    objectives_measurable: '',
    participants_count: '',
    participants_profiles: [],
    prerequisites_validated: null,
    level: '',
    particularities_psh: '',
    particularities_non_french: false,
    particularities_other: '',
    location_type: '',
    location_client_address: '',
    preferred_schedule: '',
    preferred_dates: '',
    company_equipment: null,
    company_equipment_details: '',
    ppe_provided: null,
    other_constraints: ''
  })

  // Refs pour les canvas de signature
  const signatureTrainerRef = useRef(null)
  const signatureClientRef = useRef(null)
  
  // États pour stocker les signatures en base64 (pour les restaurer)
  const [savedSignatureTrainer, setSavedSignatureTrainer] = useState(null)
  const [savedSignatureClient, setSavedSignatureClient] = useState(null)

  useEffect(() => {
    if (clientId) {
      loadAnalysis()
    }
  }, [clientId])

  // Restaurer les signatures automatiquement à chaque render
  useEffect(() => {
    const timer = setTimeout(() => {
      if (savedSignatureTrainer && signatureTrainerRef.current && signatureTrainerRef.current.isEmpty()) {
        signatureTrainerRef.current.fromDataURL(savedSignatureTrainer)
      }
      if (savedSignatureClient && signatureClientRef.current && signatureClientRef.current.isEmpty()) {
        signatureClientRef.current.fromDataURL(savedSignatureClient)
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [savedSignatureTrainer, savedSignatureClient, showForm])

  const loadAnalysis = async () => {
    try {
      // Charger organization settings
      const { data: orgData } = await supabase
        .from('organization_settings')
        .select('*')
        .single()
      setOrganization(orgData)

      // Charger client
      const { data: clientData } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single()
      setClient(clientData)

      const { data, error } = await supabase
        .from('prospect_needs_analysis')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle()

      if (error) throw error

      if (data) {
        setAnalysis(data)
        
        // Auto-fill adresse client si location_type = "client" et adresse vide
        let clientAddress = data.location_client_address || ''
        if (data.location_type === 'client' && !clientAddress && clientData) {
          clientAddress = [
            clientData.address,
            clientData.postal_code,
            clientData.city
          ].filter(Boolean).join(', ')
        }
        
        setFormData({
          analysis_date: data.analysis_date || new Date().toISOString().split('T')[0],
          context_reasons: data.context_reasons || [],
          context_other: data.context_other || '',
          context_stakes: data.context_stakes || '',
          objectives_description: data.objectives_description || '',
          objectives_measurable: data.objectives_measurable || '',
          participants_count: data.participants_count || '',
          participants_profiles: data.participants_profiles || [],
          prerequisites_validated: data.prerequisites_validated,
          level: data.level || '',
          particularities_psh: data.particularities_psh || '',
          particularities_non_french: data.particularities_non_french || false,
          particularities_other: data.particularities_other || '',
          location_type: data.location_type || '',
          location_client_address: clientAddress,
          preferred_schedule: data.preferred_schedule || '',
          preferred_dates: data.preferred_dates || '',
          company_equipment: data.company_equipment,
          company_equipment_details: data.company_equipment_details || '',
          ppe_provided: data.ppe_provided,
          other_constraints: data.other_constraints || ''
        })

        // Charger les signatures si elles existent
        if (data.signature_trainer) {
          setSavedSignatureTrainer(data.signature_trainer)
        }
        if (data.signature_client) {
          setSavedSignatureClient(data.signature_client)
        }
        
        setTimeout(() => {
          if (data.signature_trainer && signatureTrainerRef.current) {
            signatureTrainerRef.current.fromDataURL(data.signature_trainer)
          }
          if (data.signature_client && signatureClientRef.current) {
            signatureClientRef.current.fromDataURL(data.signature_client)
          }
        }, 100)
      } else {
        // Pas d'analyse existante : auto-fill adresse si clientData disponible
        if (clientData) {
          const clientAddress = [
            clientData.address,
            clientData.postal_code,
            clientData.city
          ].filter(Boolean).join(', ')
          
          if (clientAddress) {
            setFormData(prev => ({ ...prev, location_client_address: clientAddress }))
          }
        }
      }
    } catch (error) {
      console.error('Erreur chargement analyse:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      
      // Récupérer les signatures
      const signatureTrainer = signatureTrainerRef.current && !signatureTrainerRef.current.isEmpty()
        ? signatureTrainerRef.current.toDataURL()
        : null
      
      const signatureClient = signatureClientRef.current && !signatureClientRef.current.isEmpty()
        ? signatureClientRef.current.toDataURL()
        : null

      const dataToSave = {
        ...formData,
        client_id: clientId,
        rdv_id: rdvId,
        filled_by: userData?.user?.id,
        filled_at: new Date().toISOString(),
        signature_trainer: signatureTrainer,
        signature_client: signatureClient,
        signed_at: (signatureTrainer || signatureClient) ? new Date().toISOString() : null
      }

      if (analysis) {
        const { error } = await supabase
          .from('prospect_needs_analysis')
          .update(dataToSave)
          .eq('id', analysis.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('prospect_needs_analysis')
          .insert([dataToSave])

        if (error) throw error
      }

      toast.success('Analyse du besoin enregistrée')
      await loadAnalysis()
      setShowForm(false)
    } catch (error) {
      console.error('Erreur sauvegarde:', error)
      toast.error('Erreur lors de la sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  const handleCheckbox = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter(v => v !== value)
        : [...prev[field], value]
    }))
  }

  // Auto-fill adresse client quand on change location_type vers "client"
  useEffect(() => {
    if (formData.location_type === 'client' && !formData.location_client_address && client) {
      const clientAddress = [
        client.address,
        client.postal_code,
        client.city
      ].filter(Boolean).join(', ')
      
      if (clientAddress) {
        setFormData(prev => ({ ...prev, location_client_address: clientAddress }))
      }
    }
  }, [formData.location_type, client])

  const clearSignatureTrainer = () => {
    if (signatureTrainerRef.current) {
      signatureTrainerRef.current.clear()
      setSavedSignatureTrainer(null)
    }
  }

  const clearSignatureClient = () => {
    if (signatureClientRef.current) {
      signatureClientRef.current.clear()
      setSavedSignatureClient(null)
    }
  }

  const handlePrintBlank = () => {
    downloadNeedsAnalysisPDF(client || { id: clientId, reference: 'PROSPECT' }, null, true, organization)
  }

  const handlePrintFilled = () => {
    if (!analysis) {
      toast.error('Veuillez d\'abord remplir l\'analyse')
      return
    }
    downloadNeedsAnalysisPDF(client || { id: clientId, reference: 'PROSPECT' }, analysis, false, organization)
  }

  if (loading) {
    return <div className="text-center py-4 text-gray-500">Chargement...</div>
  }

  return (
    <div className="space-y-4">
      {/* Header avec boutons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileCheck className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold">Analyse du besoin</h3>
          {analysis ? (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded flex items-center gap-1">
              <CheckCircle className="w-3 h-3" />
              Complétée
            </span>
          ) : (
            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              À remplir
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handlePrintBlank}
            className="btn btn-sm btn-secondary flex items-center gap-1"
          >
            <Printer className="w-4 h-4" />
            Imprimer vierge
          </button>
          
          {analysis && (
            <button
              onClick={handlePrintFilled}
              className="btn btn-sm btn-secondary flex items-center gap-1"
            >
              <Download className="w-4 h-4" />
              Télécharger PDF
            </button>
          )}

          <button
            onClick={() => setShowForm(!showForm)}
            className="btn btn-sm btn-primary flex items-center gap-1"
          >
            <FileCheck className="w-4 h-4" />
            {showForm ? 'Masquer' : analysis ? 'Modifier' : 'Remplir'}
          </button>
        </div>
      </div>

      {/* Formulaire */}
      {showForm && (
        <div className="border rounded-lg p-6 space-y-6 bg-white">
          {/* Date de l'analyse */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <label className="block text-sm font-medium mb-2 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600" />
              Date de l'analyse
            </label>
            <input
              type="date"
              value={formData.analysis_date}
              onChange={(e) => setFormData({ ...formData, analysis_date: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
            <p className="text-xs text-gray-500 mt-1">
              Cette date apparaîtra sur le document PDF
            </p>
          </div>

          {/* Section 1 : Contexte et enjeux */}
          <div className="space-y-4">
            <h4 className="font-semibold text-lg border-b pb-2">1. Contexte et enjeux</h4>
            
            <div>
              <label className="block text-sm font-medium mb-2">
                Pourquoi cette formation maintenant ?
              </label>
              <div className="space-y-2">
                {CONTEXT_REASONS.map(reason => (
                  <label key={reason.value} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.context_reasons.includes(reason.value)}
                      onChange={() => handleCheckbox('context_reasons', reason.value)}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm">{reason.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {formData.context_reasons.includes('autre') && (
              <div>
                <label className="block text-sm font-medium mb-1">Précisez :</label>
                <input
                  type="text"
                  value={formData.context_other}
                  onChange={(e) => setFormData({ ...formData, context_other: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Autre raison..."
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">
                Enjeux spécifiques
                <span className="text-xs text-gray-500 ml-2">(Quels sont les enjeux pour l'entreprise ?)</span>
              </label>
              <textarea
                value={formData.context_stakes}
                onChange={(e) => setFormData({ ...formData, context_stakes: e.target.value })}
                rows={4}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="Ex: Réduire les accidents du travail, Mise en conformité réglementaire..."
              />
            </div>
          </div>

          {/* Section 2 : Objectifs attendus */}
          <div className="space-y-4">
            <h4 className="font-semibold text-lg border-b pb-2">2. Objectifs attendus</h4>
            
            <div>
              <label className="block text-sm font-medium mb-1">
                Que souhaitez-vous que les stagiaires sachent faire à l'issue ?
              </label>
              <textarea
                value={formData.objectives_description}
                onChange={(e) => setFormData({ ...formData, objectives_description: e.target.value })}
                rows={4}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="Ex: Être capable de porter secours à une victime, Savoir utiliser un extincteur..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Résultats mesurables attendus
                <span className="text-xs text-gray-500 ml-2">(Comment mesurerez-vous l'efficacité ?)</span>
              </label>
              <textarea
                value={formData.objectives_measurable}
                onChange={(e) => setFormData({ ...formData, objectives_measurable: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="Ex: 100% des participants certifiés, Réduction de 50% des incidents..."
              />
            </div>
          </div>

          {/* Section 3 : Public concerné */}
          <div className="space-y-4">
            <h4 className="font-semibold text-lg border-b pb-2">3. Public concerné</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nombre de participants</label>
                <input
                  type="number"
                  value={formData.participants_count}
                  onChange={(e) => setFormData({ ...formData, participants_count: parseInt(e.target.value) || '' })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Ex: 12"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Niveau</label>
                <select
                  value={formData.level}
                  onChange={(e) => setFormData({ ...formData, level: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="">Sélectionner</option>
                  <option value="debutant">Débutant</option>
                  <option value="intermediaire">Intermédiaire</option>
                  <option value="avance">Avancé</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Profils des participants</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PROFILES.map(profile => (
                  <label key={profile.value} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.participants_profiles.includes(profile.value)}
                      onChange={() => handleCheckbox('participants_profiles', profile.value)}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm">{profile.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Prérequis déjà validés ?</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={formData.prerequisites_validated === true}
                    onChange={() => setFormData({ ...formData, prerequisites_validated: true })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Oui</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={formData.prerequisites_validated === false}
                    onChange={() => setFormData({ ...formData, prerequisites_validated: false })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Non</span>
                </label>
              </div>
            </div>

            <div className="space-y-3 bg-gray-50 p-4 rounded-lg">
              <label className="block text-sm font-medium">Particularités</label>
              
              <div>
                <label className="block text-xs text-gray-600 mb-1">PSH (Personnes en Situation de Handicap)</label>
                <input
                  type="text"
                  value={formData.particularities_psh}
                  onChange={(e) => setFormData({ ...formData, particularities_psh: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  placeholder="Précisez les adaptations nécessaires..."
                />
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.particularities_non_french}
                  onChange={(e) => setFormData({ ...formData, particularities_non_french: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm">Public non francophone</span>
              </label>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Autres particularités</label>
                <input
                  type="text"
                  value={formData.particularities_other}
                  onChange={(e) => setFormData({ ...formData, particularities_other: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  placeholder="Autres particularités..."
                />
              </div>
            </div>
          </div>

          {/* Section 4 : Contraintes et moyens */}
          <div className="space-y-4">
            <h4 className="font-semibold text-lg border-b pb-2">4. Contraintes et moyens</h4>
            
            <div>
              <label className="block text-sm font-medium mb-2">Lieu de formation</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={formData.location_type === 'access_formation'}
                    onChange={() => setFormData({ ...formData, location_type: 'access_formation' })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Dans nos locaux (Access Formation)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={formData.location_type === 'client'}
                    onChange={() => setFormData({ ...formData, location_type: 'client' })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Chez le client</span>
                </label>
              </div>

              {formData.location_type === 'client' && (
                <div className="mt-2">
                  <input
                    type="text"
                    value={formData.location_client_address}
                    onChange={(e) => setFormData({ ...formData, location_client_address: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="Adresse complète..."
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Horaires souhaités</label>
                <input
                  type="text"
                  value={formData.preferred_schedule}
                  onChange={(e) => setFormData({ ...formData, preferred_schedule: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Ex: 9h-17h"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Dates préférentielles</label>
                <input
                  type="text"
                  value={formData.preferred_dates}
                  onChange={(e) => setFormData({ ...formData, preferred_dates: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Ex: Semaine du 15/02"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Matériel spécifique entreprise</label>
              <div className="flex gap-4 mb-2">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={formData.company_equipment === true}
                    onChange={() => setFormData({ ...formData, company_equipment: true })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Oui</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={formData.company_equipment === false}
                    onChange={() => setFormData({ ...formData, company_equipment: false })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Non</span>
                </label>
              </div>

              {formData.company_equipment && (
                <input
                  type="text"
                  value={formData.company_equipment_details}
                  onChange={(e) => setFormData({ ...formData, company_equipment_details: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Précisez le matériel..."
                />
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Équipements de protection fournis</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={formData.ppe_provided === true}
                    onChange={() => setFormData({ ...formData, ppe_provided: true })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Oui</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={formData.ppe_provided === false}
                    onChange={() => setFormData({ ...formData, ppe_provided: false })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Non</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Autres contraintes</label>
              <textarea
                value={formData.other_constraints}
                onChange={(e) => setFormData({ ...formData, other_constraints: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="Ex: Contraintes d'accès, besoins spécifiques..."
              />
            </div>
          </div>

          {/* SIGNATURES */}
          <div className="space-y-4 bg-gradient-to-br from-blue-50 to-indigo-50 p-6 rounded-lg border-2 border-blue-200">
            <div className="flex items-center gap-2">
              <div className="w-1 h-6 bg-blue-600 rounded"></div>
              <h4 className="font-semibold text-lg">Signatures (optionnel)</h4>
            </div>
            <p className="text-sm text-gray-700">
              Signez directement sur l'écran. Les signatures apparaîtront sur le PDF généré.
              <br />
              <span className="text-blue-700 font-medium">✓ Fonctionne sur tablette tactile et souris</span>
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Signature formateur */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">
                  🖊️ Signature formateur (vous)
                </label>
                <div className="border-2 border-gray-400 rounded-lg bg-white shadow-sm">
                  <SignatureCanvas
                    ref={signatureTrainerRef}
                    canvasProps={{
                      className: 'w-full',
                      style: { width: '100%', height: '120px' }
                    }}
                    backgroundColor="white"
                  />
                </div>
                <button
                  type="button"
                  onClick={clearSignatureTrainer}
                  className="btn btn-xs btn-secondary flex items-center gap-1"
                >
                  <Eraser className="w-3 h-3" />
                  Effacer
                </button>
              </div>

              {/* Signature client */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">
                  ✍️ Signature client (sur place uniquement)
                </label>
                <div className="border-2 border-gray-400 rounded-lg bg-white shadow-sm">
                  <SignatureCanvas
                    ref={signatureClientRef}
                    canvasProps={{
                      className: 'w-full',
                      style: { width: '100%', height: '120px' }
                    }}
                    backgroundColor="white"
                  />
                </div>
                <button
                  type="button"
                  onClick={clearSignatureClient}
                  className="btn btn-xs btn-secondary flex items-center gap-1"
                >
                  <Eraser className="w-3 h-3" />
                  Effacer
                </button>
                <p className="text-xs text-gray-600 bg-white/70 p-2 rounded border border-gray-300">
                  💡 <strong>À distance ?</strong> Laissez vide. Vous signerez, téléchargerez le PDF, et l'enverrez au client pour signature manuelle.
                </p>
              </div>
            </div>
          </div>

          {/* Boutons d'action */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              onClick={() => setShowForm(false)}
              className="btn btn-secondary"
              disabled={saving}
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn btn-primary flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      {/* Résumé compact si rempli et formulaire masqué */}
      {!showForm && analysis && (
        <div className="border rounded-lg p-4 bg-gray-50 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <span className="font-medium">Date de l'analyse :</span> {
                analysis.analysis_date 
                  ? new Date(analysis.analysis_date).toLocaleDateString('fr-FR')
                  : 'Non définie'
              }
            </div>
            <div>
              <span className="font-medium">Participants :</span> {analysis.participants_count || 'N/A'}
            </div>
            <div>
              <span className="font-medium">Lieu :</span> {
                analysis.location_type === 'client' ? 'Chez le client' : 'Access Formation'
              }
            </div>
            <div>
              <span className="font-medium">Signatures :</span> {
                analysis.signature_trainer && analysis.signature_client ? '✓ Formateur + Client' :
                analysis.signature_trainer ? '✓ Formateur uniquement' :
                analysis.signature_client ? '✓ Client uniquement' :
                'Aucune'
              }
            </div>
          </div>
          {analysis.filled_at && (
            <div className="mt-2 text-xs text-gray-500">
              Remplie le {new Date(analysis.filled_at).toLocaleDateString('fr-FR')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

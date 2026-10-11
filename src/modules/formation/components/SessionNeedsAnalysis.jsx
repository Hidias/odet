import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../core/supabase'
import { FileCheck, Printer, Download, Save, AlertCircle, CheckCircle, Calendar, Eraser, Upload, Eye, Trash2, Paperclip } from 'lucide-react'
import toast from 'react-hot-toast'
import SignatureCanvas from 'react-signature-canvas'
import { downloadNeedsAnalysisPDF } from '../pdf/needsAnalysisPDF'
import { sanitizeStorageKey } from '../../../core/storageUtils'

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

export default function SessionNeedsAnalysis({ session, organization }) {
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [scanDoc, setScanDoc] = useState(null) // document scan uploadé
  const [uploadingScan, setUploadingScan] = useState(false)
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

  useEffect(() => {
    if (session) {
      loadAnalysis()
    }
  }, [session])

  const loadAnalysis = async () => {
    try {
      // Chercher l'analyse de session existante
      const { data, error } = await supabase
        .from('session_needs_analysis')
        .select('*')
        .eq('session_id', session.id)
        .maybeSingle()

      if (error) throw error

      if (data) {
        // Analyse de session existe déjà
        setAnalysis(data)
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
          location_client_address: data.location_client_address || '',
          preferred_schedule: data.preferred_schedule || '',
          preferred_dates: data.preferred_dates || '',
          company_equipment: data.company_equipment,
          company_equipment_details: data.company_equipment_details || '',
          ppe_provided: data.ppe_provided,
          other_constraints: data.other_constraints || ''
        })

        // Charger les signatures si elles existent
        setTimeout(() => {
          if (data.signature_trainer && signatureTrainerRef.current) {
            signatureTrainerRef.current.fromDataURL(data.signature_trainer)
          }
          if (data.signature_client && signatureClientRef.current) {
            signatureClientRef.current.fromDataURL(data.signature_client)
          }
        }, 100)
      } else {
        // Pas d'analyse de session → Chercher une analyse prospect
        const { data: prospectAnalysis } = await supabase
          .from('prospect_needs_analysis')
          .select('*')
          .eq('client_id', session.client_id)
          .maybeSingle()

        if (prospectAnalysis) {
          // Analyse prospect trouvée → Copie automatique
          toast.success('Analyse prospect récupérée automatiquement')
          
          const prospectData = {
            session_id: session.id,
            analysis_date: prospectAnalysis.analysis_date || new Date().toISOString().split('T')[0],
            context_reasons: prospectAnalysis.context_reasons || [],
            context_other: prospectAnalysis.context_other || '',
            context_stakes: prospectAnalysis.context_stakes || '',
            objectives_description: prospectAnalysis.objectives_description || '',
            objectives_measurable: prospectAnalysis.objectives_measurable || '',
            participants_count: prospectAnalysis.participants_count || '',
            participants_profiles: prospectAnalysis.participants_profiles || [],
            prerequisites_validated: prospectAnalysis.prerequisites_validated,
            level: prospectAnalysis.level || '',
            particularities_psh: prospectAnalysis.particularities_psh || '',
            particularities_non_french: prospectAnalysis.particularities_non_french || false,
            particularities_other: prospectAnalysis.particularities_other || '',
            location_type: prospectAnalysis.location_type || '',
            location_client_address: prospectAnalysis.location_client_address || '',
            preferred_schedule: prospectAnalysis.preferred_schedule || '',
            preferred_dates: prospectAnalysis.preferred_dates || '',
            company_equipment: prospectAnalysis.company_equipment,
            company_equipment_details: prospectAnalysis.company_equipment_details || '',
            ppe_provided: prospectAnalysis.ppe_provided,
            other_constraints: prospectAnalysis.other_constraints || '',
            signature_trainer: prospectAnalysis.signature_trainer,
            signature_client: prospectAnalysis.signature_client,
            signed_at: prospectAnalysis.signed_at,
            filled_by: prospectAnalysis.filled_by,
            filled_at: prospectAnalysis.filled_at
          }

          // Insérer dans session_needs_analysis
          const { data: newAnalysis, error: insertError } = await supabase
            .from('session_needs_analysis')
            .insert([prospectData])
            .select()
            .single()

          if (insertError) throw insertError

          setAnalysis(newAnalysis)
          setFormData({
            analysis_date: newAnalysis.analysis_date || new Date().toISOString().split('T')[0],
            context_reasons: newAnalysis.context_reasons || [],
            context_other: newAnalysis.context_other || '',
            context_stakes: newAnalysis.context_stakes || '',
            objectives_description: newAnalysis.objectives_description || '',
            objectives_measurable: newAnalysis.objectives_measurable || '',
            participants_count: newAnalysis.participants_count || '',
            participants_profiles: newAnalysis.participants_profiles || [],
            prerequisites_validated: newAnalysis.prerequisites_validated,
            level: newAnalysis.level || '',
            particularities_psh: newAnalysis.particularities_psh || '',
            particularities_non_french: newAnalysis.particularities_non_french || false,
            particularities_other: newAnalysis.particularities_other || '',
            location_type: newAnalysis.location_type || '',
            location_client_address: newAnalysis.location_client_address || '',
            preferred_schedule: newAnalysis.preferred_schedule || '',
            preferred_dates: newAnalysis.preferred_dates || '',
            company_equipment: newAnalysis.company_equipment,
            company_equipment_details: newAnalysis.company_equipment_details || '',
            ppe_provided: newAnalysis.ppe_provided,
            other_constraints: newAnalysis.other_constraints || ''
          })

          // Charger les signatures si elles existent
          setTimeout(() => {
            if (newAnalysis.signature_trainer && signatureTrainerRef.current) {
              signatureTrainerRef.current.fromDataURL(newAnalysis.signature_trainer)
            }
            if (newAnalysis.signature_client && signatureClientRef.current) {
              signatureClientRef.current.fromDataURL(newAnalysis.signature_client)
            }
          }, 100)
        }
      }
    } catch (error) {
      console.error('Erreur chargement analyse:', error)
    } finally {
      setLoading(false)
      // Charger le scan uploadé (indépendant de l'analyse formulaire)
      try {
        const { data: scanData } = await supabase
          .from('session_documents')
          .select('*')
          .eq('session_id', session.id)
          .eq('document_type', 'needs_analysis')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        setScanDoc(scanData || null)
      } catch (e) {
        console.error('Erreur chargement scan analyse:', e)
      }
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
        session_id: session.id,
        filled_by: userData?.user?.id,
        filled_at: new Date().toISOString(),
        signature_trainer: signatureTrainer,
        signature_client: signatureClient,
        signed_at: (signatureTrainer || signatureClient) ? new Date().toISOString() : null
      }

      if (analysis) {
        const { error } = await supabase
          .from('session_needs_analysis')
          .update(dataToSave)
          .eq('id', analysis.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('session_needs_analysis')
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

  const clearSignatureTrainer = () => {
    if (signatureTrainerRef.current) {
      signatureTrainerRef.current.clear()
    }
  }

  const clearSignatureClient = () => {
    if (signatureClientRef.current) {
      signatureClientRef.current.clear()
    }
  }

  const handlePrintBlank = () => {
    downloadNeedsAnalysisPDF(session, null, true, organization)
  }

  const handlePrintFilled = () => {
    if (!analysis) {
      toast.error('Veuillez d\'abord remplir l\'analyse')
      return
    }
    downloadNeedsAnalysisPDF(session, analysis, false, organization)
  }

  // ── Scan upload/view/delete ──
  const handleScanUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const maxSize = 15 * 1024 * 1024
    if (file.size > maxSize) {
      toast.error('Fichier trop volumineux (max 15 Mo)')
      return
    }
    setUploadingScan(true)
    try {
      //  Supabase Storage refuse les clés avec accents / espaces → chemin sanitisé,
      // nom d'origine conservé en base pour l'affichage
      const ts = Date.now()
      const fileName = `${ts}_analyse_besoin_${file.name}`
      const safeFileName = `${ts}_analyse_besoin_${sanitizeStorageKey(file.name)}`
      const filePath = `sessions/${session.id}/${safeFileName}`

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file)
      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage
        .from('documents')
        .getPublicUrl(filePath)

      const { data: docRecord, error: insertError } = await supabase
        .from('session_documents')
        .insert([{
          session_id: session.id,
          document_type: 'needs_analysis',
          file_path: filePath,
          file_name: fileName,
          file_url: urlData?.publicUrl || null,
        }])
        .select()
        .single()
      if (insertError) throw insertError

      setScanDoc(docRecord)
      toast.success('Scan importé')
    } catch (err) {
      console.error('Erreur upload scan:', err)
      toast.error('Erreur lors de l\'upload')
    } finally {
      setUploadingScan(false)
      e.target.value = ''
    }
  }

  const handleViewScan = async () => {
    if (!scanDoc?.file_path) return
    const { data } = await supabase.storage
      .from('documents')
      .createSignedUrl(scanDoc.file_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else toast.error('Impossible d\'ouvrir le fichier')
  }

  const handleDeleteScan = async () => {
    if (!scanDoc) return
    if (!confirm('Supprimer ce scan ?')) return
    try {
      await supabase.storage.from('documents').remove([scanDoc.file_path])
      await supabase.from('session_documents').delete().eq('id', scanDoc.id)
      setScanDoc(null)
      toast.success('Scan supprimé')
    } catch (err) {
      toast.error('Erreur suppression')
    }
  }

  if (loading) {
    return <div className="text-center py-4 text-gray-500">Chargement...</div>
  }

  return (
    <div className="space-y-4">
      {/* Header avec boutons */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FileCheck className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold">Analyse du besoin</h3>
          {analysis ? (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded flex items-center gap-1">
              <CheckCircle className="w-3 h-3" />
              Complétée
            </span>
          ) : scanDoc ? (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded flex items-center gap-1">
              <Paperclip className="w-3 h-3" />
              Scan importé
            </span>
          ) : (
            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              À remplir
            </span>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
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

          {/* Bouton import scan */}
          <label className={`btn btn-sm btn-secondary flex items-center gap-1 cursor-pointer ${uploadingScan ? 'opacity-50 pointer-events-none' : ''}`}>
            <Upload className="w-4 h-4" />
            {uploadingScan ? 'Upload...' : 'Importer un scan'}
            <input type="file" className="hidden" onChange={handleScanUpload} disabled={uploadingScan}
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.tiff" />
          </label>

          <button
            onClick={() => setShowForm(!showForm)}
            className="btn btn-sm btn-primary flex items-center gap-1"
          >
            <FileCheck className="w-4 h-4" />
            {showForm ? 'Masquer' : analysis ? 'Modifier' : 'Remplir'}
          </button>
        </div>
      </div>

      {/* Scan importé - affichage compact */}
      {scanDoc && !showForm && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
          <Paperclip className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-blue-800 truncate">
              {scanDoc.file_name?.replace(/^\d+_/, '') || 'Scan analyse du besoin'}
            </p>
            <p className="text-xs text-blue-500">
              Importé le {new Date(scanDoc.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <button onClick={handleViewScan} className="btn btn-sm btn-secondary flex items-center gap-1" title="Ouvrir">
            <Eye className="w-4 h-4" /> Voir
          </button>
          <button onClick={handleDeleteScan} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Supprimer">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

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
            
            <div className="grid grid-cols-2 gap-4">
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
              <div className="grid grid-cols-2 gap-2">
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
                  <span className="text-sm">Dans nos locaux</span>
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

            <div className="grid grid-cols-2 gap-4">
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
              <span className="text-blue-700 font-medium"> Fonctionne sur tablette tactile et souris</span>
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Signature formateur */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">
                   Signature formateur (vous)
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
                   Signature client (sur place uniquement)
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
                   <strong>À distance ?</strong> Laissez vide. Vous signerez, téléchargerez le PDF, et l'enverrez au client pour signature manuelle.
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
          <div className="grid grid-cols-2 gap-4">
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
                analysis.location_type === 'client' ? 'Chez le client' : 'Dans nos locaux'
              }
            </div>
            <div>
              <span className="font-medium">Signatures :</span> {
                analysis.signature_trainer && analysis.signature_client ? ' Formateur + Client' :
                analysis.signature_trainer ? ' Formateur uniquement' :
                analysis.signature_client ? ' Client uniquement' :
                'Aucune'
              }
            </div>
            {scanDoc && (
              <div>
                <span className="font-medium">Scan :</span>{' '}
                <button onClick={handleViewScan} className="text-blue-600 hover:underline">
                   Voir le scan importé
                </button>
              </div>
            )}
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

import { orgName } from '../../../core/org/currentOrg'
import { useState, useEffect } from 'react'
import { supabase } from '../../../core/supabase'
import { 
  Plus, Calendar, Trash2, Edit, Download, BookOpen, 
  Users, Award, FileText, CheckCircle, XCircle 
} from 'lucide-react'
import toast from 'react-hot-toast'
import { jsPDF } from 'jspdf'
import 'jspdf-autotable'

const TRAINING_TYPES = {
  externe: { label: 'Formation externe', color: 'blue', icon: '🎓' },
  interne: { label: 'Formation interne', color: 'green', icon: '🏢' },
  echange_pratiques: { label: 'Échange de pratiques', color: 'purple', icon: '💬' }
}

const INTERVIEW_TYPES = {
  annuel: { label: 'Entretien annuel', color: 'blue' },
  semestriel: { label: 'Entretien semestriel', color: 'green' },
  ponctuel: { label: 'Entretien ponctuel', color: 'gray' }
}

export default function TrainerDevelopment({ trainerId, trainerName }) {
  const [activeTab, setActiveTab] = useState('trainings') // 'trainings' | 'interviews'
  
  // Trainings
  const [trainings, setTrainings] = useState([])
  const [loadingTrainings, setLoadingTrainings] = useState(true)
  const [showTrainingForm, setShowTrainingForm] = useState(false)
  const [editingTraining, setEditingTraining] = useState(null)
  
  // Interviews
  const [interviews, setInterviews] = useState([])
  const [loadingInterviews, setLoadingInterviews] = useState(true)
  const [showInterviewForm, setShowInterviewForm] = useState(false)
  const [editingInterview, setEditingInterview] = useState(null)
  
  // Forms
  const [trainingForm, setTrainingForm] = useState({
    training_date: '',
    training_name: '',
    training_type: 'externe',
    organizer: '',
    duration_days: '',
    duration_hours: '',
    certificate_obtained: false,
    notes: ''
  })
  
  const [interviewForm, setInterviewForm] = useState({
    interview_date: '',
    interviewer_name: '',
    interview_type: 'annuel',
    themes_discussed: '',
    identified_needs: '',
    actions_planned: '',
    next_interview_date: '',
    notes: ''
  })

  useEffect(() => {
    if (trainerId) {
      loadTrainings()
      loadInterviews()
    }
  }, [trainerId])

  // ============================================
  // TRAININGS - LOAD
  // ============================================
  const loadTrainings = async () => {
    try {
      const { data, error } = await supabase
        .from('trainer_trainings')
        .select('*')
        .eq('trainer_id', trainerId)
        .order('training_date', { ascending: false })

      if (error) throw error
      setTrainings(data || [])
    } catch (error) {
      console.error('Erreur chargement formations:', error)
      toast.error('Erreur lors du chargement des formations')
    } finally {
      setLoadingTrainings(false)
    }
  }

  // ============================================
  // TRAININGS - SAVE
  // ============================================
  const saveTraining = async (e) => {
    e.preventDefault()
    
    try {
      const { data: userData } = await supabase.auth.getUser()
      
      const trainingData = {
        trainer_id: trainerId,
        training_date: trainingForm.training_date,
        training_name: trainingForm.training_name,
        training_type: trainingForm.training_type,
        organizer: trainingForm.organizer || null,
        duration_days: trainingForm.duration_days ? parseFloat(trainingForm.duration_days) : null,
        duration_hours: trainingForm.duration_hours ? parseFloat(trainingForm.duration_hours) : null,
        certificate_obtained: trainingForm.certificate_obtained,
        notes: trainingForm.notes || null,
        created_by: userData?.user?.id
      }

      if (editingTraining) {
        // Update
        const { error } = await supabase
          .from('trainer_trainings')
          .update(trainingData)
          .eq('id', editingTraining.id)

        if (error) throw error
        toast.success('Formation mise à jour')
      } else {
        // Insert
        const { error } = await supabase
          .from('trainer_trainings')
          .insert([trainingData])

        if (error) throw error
        toast.success('Formation ajoutée')
      }

      loadTrainings()
      resetTrainingForm()
    } catch (error) {
      console.error('Erreur sauvegarde formation:', error)
      toast.error('Erreur lors de la sauvegarde')
    }
  }

  // ============================================
  // TRAININGS - DELETE
  // ============================================
  const deleteTraining = async (id) => {
    if (!confirm('Supprimer cette formation ?')) return

    try {
      const { error } = await supabase
        .from('trainer_trainings')
        .delete()
        .eq('id', id)

      if (error) throw error
      toast.success('Formation supprimée')
      loadTrainings()
    } catch (error) {
      console.error('Erreur suppression:', error)
      toast.error('Erreur lors de la suppression')
    }
  }

  // ============================================
  // INTERVIEWS - LOAD
  // ============================================
  const loadInterviews = async () => {
    try {
      const { data, error } = await supabase
        .from('trainer_interviews')
        .select('*')
        .eq('trainer_id', trainerId)
        .order('interview_date', { ascending: false })

      if (error) throw error
      setInterviews(data || [])
    } catch (error) {
      console.error('Erreur chargement entretiens:', error)
      toast.error('Erreur lors du chargement des entretiens')
    } finally {
      setLoadingInterviews(false)
    }
  }

  // ============================================
  // INTERVIEWS - SAVE
  // ============================================
  const saveInterview = async (e) => {
    e.preventDefault()
    
    try {
      const { data: userData } = await supabase.auth.getUser()
      
      const interviewData = {
        trainer_id: trainerId,
        interview_date: interviewForm.interview_date,
        interviewer_name: interviewForm.interviewer_name,
        interview_type: interviewForm.interview_type,
        themes_discussed: interviewForm.themes_discussed || null,
        identified_needs: interviewForm.identified_needs || null,
        actions_planned: interviewForm.actions_planned || null,
        next_interview_date: interviewForm.next_interview_date || null,
        notes: interviewForm.notes || null,
        created_by: userData?.user?.id
      }

      if (editingInterview) {
        // Update
        const { error } = await supabase
          .from('trainer_interviews')
          .update(interviewData)
          .eq('id', editingInterview.id)

        if (error) throw error
        toast.success('Entretien mis à jour')
      } else {
        // Insert
        const { error } = await supabase
          .from('trainer_interviews')
          .insert([interviewData])

        if (error) throw error
        toast.success('Entretien ajouté')
      }

      loadInterviews()
      resetInterviewForm()
    } catch (error) {
      console.error('Erreur sauvegarde entretien:', error)
      toast.error('Erreur lors de la sauvegarde')
    }
  }

  // ============================================
  // INTERVIEWS - DELETE
  // ============================================
  const deleteInterview = async (id) => {
    if (!confirm('Supprimer cet entretien ?')) return

    try {
      const { error } = await supabase
        .from('trainer_interviews')
        .delete()
        .eq('id', id)

      if (error) throw error
      toast.success('Entretien supprimé')
      loadInterviews()
    } catch (error) {
      console.error('Erreur suppression:', error)
      toast.error('Erreur lors de la suppression')
    }
  }

  // ============================================
  // EXPORT PDF
  // ============================================
  const exportPDF = () => {
    const doc = new jsPDF()

    // Title
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text('Plan de Développement des Compétences', 14, 50)
    
    doc.setFontSize(12)
    doc.setFont('helvetica', 'normal')
    doc.text(`Formateur : ${trainerName}`, 14, 58)
    doc.text(`Date d'édition : ${new Date().toLocaleDateString('fr-FR')}`, 14, 64)

    let yPos = 75

    // FORMATIONS
    if (trainings.length > 0) {
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.text('📚 Formations suivies et planifiées', 14, yPos)
      yPos += 8

      const trainingRows = trainings.map(t => [
        new Date(t.training_date).toLocaleDateString('fr-FR'),
        t.training_name,
        TRAINING_TYPES[t.training_type]?.label || t.training_type,
        t.organizer || '-',
        t.duration_days ? `${t.duration_days}j` : t.duration_hours ? `${t.duration_hours}h` : '-',
        t.certificate_obtained ? 'Oui' : 'Non'
      ])

      doc.autoTable({
        startY: yPos,
        head: [['Date', 'Formation', 'Type', 'Organisme', 'Durée', 'Certificat']],
        body: trainingRows,
        theme: 'grid',
        headStyles: { fillColor: [59, 130, 246], fontSize: 9 },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
          0: { cellWidth: 25 },
          1: { cellWidth: 60 },
          2: { cellWidth: 35 },
          3: { cellWidth: 35 },
          4: { cellWidth: 15 },
          5: { cellWidth: 20 }
        }
      })

      yPos = doc.lastAutoTable.finalY + 15
    }

    // ENTRETIENS
    if (interviews.length > 0) {
      if (yPos > 250) {
        doc.addPage()
        yPos = 20
      }

      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.text('💼 Entretiens professionnels', 14, yPos)
      yPos += 8

      const interviewRows = interviews.map(i => [
        new Date(i.interview_date).toLocaleDateString('fr-FR'),
        INTERVIEW_TYPES[i.interview_type]?.label || i.interview_type,
        i.interviewer_name,
        i.themes_discussed || '-',
        i.identified_needs || '-'
      ])

      doc.autoTable({
        startY: yPos,
        head: [['Date', 'Type', 'Réalisé par', 'Thèmes', 'Besoins identifiés']],
        body: interviewRows,
        theme: 'grid',
        headStyles: { fillColor: [34, 197, 94], fontSize: 9 },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
          0: { cellWidth: 25 },
          1: { cellWidth: 35 },
          2: { cellWidth: 35 },
          3: { cellWidth: 45 },
          4: { cellWidth: 50 }
        }
      })
    }

    // Footer
    const pageCount = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(8)
      doc.setFont('helvetica', 'normal')
      doc.text(
        `${orgName()} - Plan de développement - ${trainerName} - Page ${i}/${pageCount}`,
        14,
        doc.internal.pageSize.height - 10
      )
    }

    doc.save(`Plan-Formation-${trainerName.replace(/\s/g, '-')}.pdf`)
    toast.success('PDF généré avec succès')
  }

  // ============================================
  // HELPERS
  // ============================================
  const resetTrainingForm = () => {
    setTrainingForm({
      training_date: '',
      training_name: '',
      training_type: 'externe',
      organizer: '',
      duration_days: '',
      duration_hours: '',
      certificate_obtained: false,
      notes: ''
    })
    setEditingTraining(null)
    setShowTrainingForm(false)
  }

  const resetInterviewForm = () => {
    setInterviewForm({
      interview_date: '',
      interviewer_name: '',
      interview_type: 'annuel',
      themes_discussed: '',
      identified_needs: '',
      actions_planned: '',
      next_interview_date: '',
      notes: ''
    })
    setEditingInterview(null)
    setShowInterviewForm(false)
  }

  const editTraining = (training) => {
    setTrainingForm({
      training_date: training.training_date,
      training_name: training.training_name,
      training_type: training.training_type,
      organizer: training.organizer || '',
      duration_days: training.duration_days || '',
      duration_hours: training.duration_hours || '',
      certificate_obtained: training.certificate_obtained,
      notes: training.notes || ''
    })
    setEditingTraining(training)
    setShowTrainingForm(true)
  }

  const editInterview = (interview) => {
    setInterviewForm({
      interview_date: interview.interview_date,
      interviewer_name: interview.interviewer_name,
      interview_type: interview.interview_type,
      themes_discussed: interview.themes_discussed || '',
      identified_needs: interview.identified_needs || '',
      actions_planned: interview.actions_planned || '',
      next_interview_date: interview.next_interview_date || '',
      notes: interview.notes || ''
    })
    setEditingInterview(interview)
    setShowInterviewForm(true)
  }

  // ============================================
  // RENDER
  // ============================================
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-600" />
            Développement des compétences
          </h3>
          <p className="text-sm text-gray-600">Plan de formation et entretiens professionnels</p>
        </div>
        <button
          onClick={exportPDF}
          className="btn btn-secondary flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Export PDF
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setActiveTab('trainings')}
          className={`px-4 py-2 font-medium transition-colors border-b-2 ${
            activeTab === 'trainings'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4" />
            Formations ({trainings.length})
          </div>
        </button>
        <button
          onClick={() => setActiveTab('interviews')}
          className={`px-4 py-2 font-medium transition-colors border-b-2 ${
            activeTab === 'interviews'
              ? 'border-green-500 text-green-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Entretiens ({interviews.length})
          </div>
        </button>
      </div>

      {/* TAB: TRAININGS */}
      {activeTab === 'trainings' && (
        <div className="space-y-4">
          {/* Add button */}
          {!showTrainingForm && (
            <button
              onClick={() => setShowTrainingForm(true)}
              className="btn btn-primary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Ajouter une formation
            </button>
          )}

          {/* Form */}
          {showTrainingForm && (
            <form onSubmit={saveTraining} className="bg-gray-50 rounded-lg p-4 space-y-4">
              <h4 className="font-medium">
                {editingTraining ? 'Modifier la formation' : 'Nouvelle formation'}
              </h4>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Date *</label>
                  <input
                    type="date"
                    value={trainingForm.training_date}
                    onChange={(e) => setTrainingForm({...trainingForm, training_date: e.target.value})}
                    className="input w-full"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Type *</label>
                  <select
                    value={trainingForm.training_type}
                    onChange={(e) => setTrainingForm({...trainingForm, training_type: e.target.value})}
                    className="input w-full"
                    required
                  >
                    {Object.entries(TRAINING_TYPES).map(([key, val]) => (
                      <option key={key} value={key}>
                        {val.icon} {val.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">Nom de la formation *</label>
                  <input
                    type="text"
                    value={trainingForm.training_name}
                    onChange={(e) => setTrainingForm({...trainingForm, training_name: e.target.value})}
                    className="input w-full"
                    placeholder="Ex: Formation INRS SST"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Organisme</label>
                  <input
                    type="text"
                    value={trainingForm.organizer}
                    onChange={(e) => setTrainingForm({...trainingForm, organizer: e.target.value})}
                    className="input w-full"
                    placeholder="Ex : INRS, organisme interne"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">Durée (jours)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={trainingForm.duration_days}
                      onChange={(e) => setTrainingForm({...trainingForm, duration_days: e.target.value})}
                      className="input w-full"
                      placeholder="3"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">ou (heures)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={trainingForm.duration_hours}
                      onChange={(e) => setTrainingForm({...trainingForm, duration_hours: e.target.value})}
                      className="input w-full"
                      placeholder="2"
                    />
                  </div>
                </div>

                <div className="col-span-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={trainingForm.certificate_obtained}
                      onChange={(e) => setTrainingForm({...trainingForm, certificate_obtained: e.target.checked})}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm font-medium">Certificat obtenu</span>
                  </label>
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">Notes</label>
                  <textarea
                    value={trainingForm.notes}
                    onChange={(e) => setTrainingForm({...trainingForm, notes: e.target.value})}
                    className="input w-full"
                    rows={2}
                    placeholder="Remarques, observations..."
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button type="submit" className="btn btn-primary">
                  {editingTraining ? 'Mettre à jour' : 'Ajouter'}
                </button>
                <button
                  type="button"
                  onClick={resetTrainingForm}
                  className="btn btn-secondary"
                >
                  Annuler
                </button>
              </div>
            </form>
          )}

          {/* List */}
          {loadingTrainings ? (
            <div className="text-center py-8 text-gray-500">Chargement...</div>
          ) : trainings.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Award className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Aucune formation enregistrée</p>
            </div>
          ) : (
            <div className="space-y-3">
              {trainings.map(training => {
                const typeInfo = TRAINING_TYPES[training.training_type]
                const isPast = new Date(training.training_date) < new Date()

                return (
                  <div key={training.id} className="bg-white border rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Calendar className="w-4 h-4 text-gray-400" />
                          <span className="font-medium">
                            {new Date(training.training_date).toLocaleDateString('fr-FR', { 
                              year: 'numeric', 
                              month: 'long', 
                              day: 'numeric' 
                            })}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded bg-${typeInfo.color}-100 text-${typeInfo.color}-700`}>
                            {typeInfo.icon} {typeInfo.label}
                          </span>
                          {isPast && (
                            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                              ✓ Réalisée
                            </span>
                          )}
                        </div>

                        <h4 className="font-semibold text-gray-900 mb-1">{training.training_name}</h4>

                        <div className="text-sm text-gray-600 space-y-1">
                          {training.organizer && (
                            <p>Organisme : {training.organizer}</p>
                          )}
                          {(training.duration_days || training.duration_hours) && (
                            <p>
                              Durée : {training.duration_days ? `${training.duration_days} jour(s)` : `${training.duration_hours}h`}
                            </p>
                          )}
                          {training.certificate_obtained && (
                            <p className="flex items-center gap-1 text-green-600">
                              <CheckCircle className="w-4 h-4" />
                              Certificat obtenu
                            </p>
                          )}
                          {training.notes && (
                            <p className="text-xs text-gray-500 mt-2 italic">{training.notes}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => editTraining(training)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="Modifier"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteTraining(training.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB: INTERVIEWS */}
      {activeTab === 'interviews' && (
        <div className="space-y-4">
          {/* Add button */}
          {!showInterviewForm && (
            <button
              onClick={() => setShowInterviewForm(true)}
              className="btn btn-primary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Ajouter un entretien
            </button>
          )}

          {/* Form */}
          {showInterviewForm && (
            <form onSubmit={saveInterview} className="bg-gray-50 rounded-lg p-4 space-y-4">
              <h4 className="font-medium">
                {editingInterview ? 'Modifier l\'entretien' : 'Nouvel entretien professionnel'}
              </h4>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Date entretien *</label>
                  <input
                    type="date"
                    value={interviewForm.interview_date}
                    onChange={(e) => setInterviewForm({...interviewForm, interview_date: e.target.value})}
                    className="input w-full"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Type *</label>
                  <select
                    value={interviewForm.interview_type}
                    onChange={(e) => setInterviewForm({...interviewForm, interview_type: e.target.value})}
                    className="input w-full"
                    required
                  >
                    {Object.entries(INTERVIEW_TYPES).map(([key, val]) => (
                      <option key={key} value={key}>{val.label}</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">Réalisé par *</label>
                  <input
                    type="text"
                    value={interviewForm.interviewer_name}
                    onChange={(e) => setInterviewForm({...interviewForm, interviewer_name: e.target.value})}
                    className="input w-full"
                    placeholder="Nom de la personne qui a mené l'entretien"
                    required
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">Thèmes abordés</label>
                  <textarea
                    value={interviewForm.themes_discussed}
                    onChange={(e) => setInterviewForm({...interviewForm, themes_discussed: e.target.value})}
                    className="input w-full"
                    rows={2}
                    placeholder="Ex: Évolution compétences, Besoins formation, Perspectives..."
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">Besoins identifiés</label>
                  <textarea
                    value={interviewForm.identified_needs}
                    onChange={(e) => setInterviewForm({...interviewForm, identified_needs: e.target.value})}
                    className="input w-full"
                    rows={2}
                    placeholder="Formations souhaitées, ressources nécessaires..."
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">Actions prévues</label>
                  <textarea
                    value={interviewForm.actions_planned}
                    onChange={(e) => setInterviewForm({...interviewForm, actions_planned: e.target.value})}
                    className="input w-full"
                    rows={2}
                    placeholder="Inscriptions formations, achats matériel..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Prochain entretien</label>
                  <input
                    type="date"
                    value={interviewForm.next_interview_date}
                    onChange={(e) => setInterviewForm({...interviewForm, next_interview_date: e.target.value})}
                    className="input w-full"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">Notes</label>
                  <textarea
                    value={interviewForm.notes}
                    onChange={(e) => setInterviewForm({...interviewForm, notes: e.target.value})}
                    className="input w-full"
                    rows={2}
                    placeholder="Remarques complémentaires..."
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button type="submit" className="btn btn-primary">
                  {editingInterview ? 'Mettre à jour' : 'Ajouter'}
                </button>
                <button
                  type="button"
                  onClick={resetInterviewForm}
                  className="btn btn-secondary"
                >
                  Annuler
                </button>
              </div>
            </form>
          )}

          {/* List */}
          {loadingInterviews ? (
            <div className="text-center py-8 text-gray-500">Chargement...</div>
          ) : interviews.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Aucun entretien enregistré</p>
            </div>
          ) : (
            <div className="space-y-3">
              {interviews.map(interview => {
                const typeInfo = INTERVIEW_TYPES[interview.interview_type]

                return (
                  <div key={interview.id} className="bg-white border rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Calendar className="w-4 h-4 text-gray-400" />
                          <span className="font-medium">
                            {new Date(interview.interview_date).toLocaleDateString('fr-FR', { 
                              year: 'numeric', 
                              month: 'long', 
                              day: 'numeric' 
                            })}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded bg-${typeInfo.color}-100 text-${typeInfo.color}-700`}>
                            {typeInfo.label}
                          </span>
                        </div>

                        <p className="text-sm text-gray-600 mb-2">
                          Réalisé par : <strong>{interview.interviewer_name}</strong>
                        </p>

                        {interview.themes_discussed && (
                          <div className="mb-2">
                            <p className="text-xs font-medium text-gray-700 mb-1">Thèmes abordés :</p>
                            <p className="text-sm text-gray-600">{interview.themes_discussed}</p>
                          </div>
                        )}

                        {interview.identified_needs && (
                          <div className="mb-2">
                            <p className="text-xs font-medium text-gray-700 mb-1">Besoins identifiés :</p>
                            <p className="text-sm text-gray-600">{interview.identified_needs}</p>
                          </div>
                        )}

                        {interview.actions_planned && (
                          <div className="mb-2">
                            <p className="text-xs font-medium text-gray-700 mb-1">Actions prévues :</p>
                            <p className="text-sm text-gray-600">{interview.actions_planned}</p>
                          </div>
                        )}

                        {interview.next_interview_date && (
                          <p className="text-xs text-gray-500 mt-2">
                            Prochain entretien : {new Date(interview.next_interview_date).toLocaleDateString('fr-FR')}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => editInterview(interview)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="Modifier"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteInterview(interview.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

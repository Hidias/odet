import { orgName, orgEmail, orgWebsite, orgCity } from '../../../core/org/currentOrg'
import { apiFetch } from '../../../core/api'
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../../core/supabase'
import { X, Send, Loader, CheckCircle, AlertCircle, Mail, FileText, Upload, Trash2, Eye, ChevronLeft, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { generatePDF } from '../pdf/pdfGenerator'

// ── Constantes ──────────────────────────────────────────────────────────────
const SST_LINE = '- Certificat SST (INRS / Forprev)'

// Normalise : supprime accents, minuscules, remplace séparateurs par espace
const normalize = (str) => (str || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[_\s\-.]+/g, ' ')
  .trim()

// Slugifie un nom de fichier pour les chemins Storage (accents, espaces, apostrophes → tiret)
const slugify = (name) => (name || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '')

// Tente de matcher un fichier SST sur UN SEUL stagiaire (match unique nom + prénom)
// Retourne l'id du stagiaire si match unique, null sinon
const matchSstFile = (file, traineeList) => {
  const normalizedFilename = normalize(file.name.replace(/\.[^.]+$/, ''))
  const matches = traineeList.filter(t =>
    normalizedFilename.includes(normalize(t.last_name)) &&
    normalizedFilename.includes(normalize(t.first_name))
  )
  return matches.length === 1 ? matches[0].id : null
}

// ── Composant ────────────────────────────────────────────────────────────────
export default function StageEmailModal({ session, onClose }) {
  const [trainees, setTrainees] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [emailBody, setEmailBody] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [step, setStep] = useState('composition') // 'composition' | 'preview' | 'sending' | 'done'
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)

  // Zone 1 — Fichiers SST (un par stagiaire)
  const [sstFiles, setSstFiles] = useState([])            // { id, name, base64, size }
  const [sstAttributions, setSstAttributions] = useState({}) // { traineeId: sstFileId }
  const sstLineInserted = useRef(false)

  // Zone 2 — Fichiers communs (tous les stagiaires sélectionnés)
  const [commonFiles, setCommonFiles] = useState([])       // { id, name, base64, size, mimeType }

  // Compte rendu IA
  const [evals, setEvals] = useState([])
  const [evalsLoaded, setEvalsLoaded] = useState(false)
  const [compteRendu, setCompteRendu] = useState('')
  const [crGenerating, setCrGenerating] = useState(false)
  const [crError, setCrError] = useState(null)

  // Document stagiaire lié à la formation
  const [docStagiaire, setDocStagiaire] = useState(null)

  const trainer = session?.trainers || null
  const ref = session?.reference || ''
  const courseTitle = session?.courses?.title || ''
  const startDate = session?.start_date
    ? new Date(session.start_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : ''
  const endDate = session?.end_date
    ? new Date(session.end_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : ''
  const formateur = trainer ? `${trainer.first_name} ${trainer.last_name}` : orgName()

  // ── Chargement données ────────────────────────────────────────────────────

  useEffect(() => {
    if (!session?.id) return
    supabase
      .from('trainee_evaluations')
      .select('*')
      .eq('session_id', session.id)
      .eq('eval_type', 'chaud')
      .then(({ data }) => { setEvals(data || []); setEvalsLoaded(true) })
  }, [session?.id])

  useEffect(() => {
    if (!session?.course_id) return
    supabase
      .from('course_documents')
      .select('*')
      .eq('course_id', session.course_id)
      .eq('type', 'document_stagiaire')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => { if (data?.length) setDocStagiaire(data[0]) })
  }, [session?.course_id])

  useEffect(() => {
    const list = session?.session_trainees?.map(st => ({
      ...st.trainees,
      result: st.result || null
    })) || []
    setTrainees(list)
    setSelectedIds(new Set(list.filter(t => t.email).map(t => t.id)))
  }, [session])

  // ── Template email ────────────────────────────────────────────────────────

  const buildTemplate = useCallback((prenom) =>
    `Bonjour ${prenom},\n\nNous vous remercions d'avoir participé à la formation « ${courseTitle} » dispensée du ${startDate} au ${endDate}.\n\nNous espérons que cette formation vous a été bénéfique et vous a permis d'acquérir les compétences nécessaires.\n\nVeuillez trouver ci-joint les documents suivants :\n- Certificat de réalisation\n- Attestation de présence\n- Évaluation à froid${docStagiaire ? `\n- ${docStagiaire.title}` : ''}\n\nConcernant l'évaluation à froid ci-jointe, nous vous invitons à la compléter et à nous la renvoyer à l'adresse ${orgEmail()}.\nCela nous permettra de mesurer les apports concrets de cette formation pour vous.\n\nPar ailleurs, vous pouvez également visiter notre site ${orgWebsite().replace(/^https?:\/\//, '')} pour découvrir l'ensemble de nos formations disponibles.\n\nN'hésitez pas à nous contacter si vous avez des questions.\n\nCordialement,\n${formateur}\n${orgName()}`,
    [courseTitle, startDate, endDate, formateur, docStagiaire])

  useEffect(() => {
    setEmailSubject(`Documents de formation – ${courseTitle} (${ref})`)
    setEmailBody(buildTemplate('[Prénom]'))
    sstLineInserted.current = false
  }, [courseTitle, ref, buildTemplate])

  // ── Gestion automatique ligne SST dans le corps du mail ──────────────────

  useEffect(() => {
    const selectedTrainees = trainees.filter(t => selectedIds.has(t.id))
    const hasAnySst = selectedTrainees.some(t => sstAttributions[t.id])

    if (hasAnySst && !sstLineInserted.current) {
      setEmailBody(prev =>
        prev.includes('- Évaluation à froid')
          ? prev.replace('- Évaluation à froid', `- Évaluation à froid\n${SST_LINE}`)
          : prev + `\n${SST_LINE}`
      )
      sstLineInserted.current = true
    } else if (!hasAnySst && sstLineInserted.current) {
      setEmailBody(prev =>
        prev.replace(`\n${SST_LINE}`, '').replace(`${SST_LINE}\n`, '').replace(SST_LINE, '')
      )
      sstLineInserted.current = false
    }
  }, [sstAttributions, selectedIds, trainees])

  // ── Handlers SST ─────────────────────────────────────────────────────────

  const handleSstUpload = (e) => {
    Array.from(e.target.files).forEach(file => {
      if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name} trop volumineux (max 10 MB)`); return }
      const reader = new FileReader()
      reader.onload = (event) => {
        const newFile = { id: Date.now() + Math.random(), name: file.name, base64: event.target.result.split(',')[1], size: file.size }
        setSstFiles(prev => [...prev, newFile])
        // Auto-match : attribue uniquement si match unique et stagiaire pas déjà attribué
        const matchedTraineeId = matchSstFile(newFile, trainees)
        if (matchedTraineeId) {
          setSstAttributions(prev =>
            prev[matchedTraineeId] ? prev : { ...prev, [matchedTraineeId]: newFile.id }
          )
        }
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  // Attribution d'un fichier SST à un stagiaire depuis la zone SST (colonne fichier → stagiaire)
  // Garantit qu'un fichier n'est attribué qu'à un seul stagiaire à la fois
  const handleSstFileAttribution = (fileId, newTraineeId) => {
    setSstAttributions(prev => {
      const updated = { ...prev }
      // Supprimer tout trainee qui pointait vers ce fichier
      Object.keys(updated).forEach(tid => { if (updated[tid] === fileId) delete updated[tid] })
      // Attribuer au nouveau stagiaire (écrase son éventuelle attribution précédente)
      if (newTraineeId) updated[newTraineeId] = fileId
      return updated
    })
  }

  // Attribution depuis la prévisualisation (colonne stagiaire → fichier)
  const handleTraineeSstAttribution = (traineeId, newFileId) => {
    setSstAttributions(prev => {
      const updated = { ...prev }
      // Supprimer ce fichier de tout autre stagiaire
      if (newFileId) {
        Object.keys(updated).forEach(tid => { if (updated[tid] === newFileId && tid !== traineeId) delete updated[tid] })
      }
      // Attribuer ou supprimer
      if (newFileId) updated[traineeId] = newFileId
      else delete updated[traineeId]
      return updated
    })
  }

  const handleRemoveSstFile = (fileId) => {
    setSstFiles(prev => prev.filter(f => f.id !== fileId))
    setSstAttributions(prev => {
      const updated = { ...prev }
      Object.keys(updated).forEach(tid => { if (updated[tid] === fileId) delete updated[tid] })
      return updated
    })
  }

  // ── Handlers fichiers communs ─────────────────────────────────────────────

  const handleCommonUpload = (e) => {
    Array.from(e.target.files).forEach(file => {
      if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name} trop volumineux (max 10 MB)`); return }
      const reader = new FileReader()
      reader.onload = (event) => {
        setCommonFiles(prev => [...prev, {
          id: Date.now() + Math.random(),
          name: file.name,
          base64: event.target.result.split(',')[1],
          size: file.size,
          mimeType: file.type || 'application/octet-stream'
        }])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const formatSize = (size) =>
    size > 1024 * 1024 ? (size / (1024 * 1024)).toFixed(1) + ' MB' : (size / 1024).toFixed(0) + ' KB'

  // ── Upload Storage ────────────────────────────────────────────────────────

  const uploadBase64 = async (base64, storagePath, contentType = 'application/pdf') => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const { error } = await supabase.storage.from('documents').upload(storagePath, bytes, { contentType, upsert: true })
    if (error) throw error
  }

  // Upload des fichiers communs — une seule fois avant la boucle d'envoi
  const uploadCommonFiles = async () => {
    if (commonFiles.length === 0) return []
    const basePath = `stagiaire-emails/${session.id}/commun/${Date.now()}`
    const uploads = []
    for (const file of commonFiles) {
      try {
        const path = `${basePath}/${slugify(file.name)}`
        await uploadBase64(file.base64, path, file.mimeType)
        uploads.push({ path, filename: file.name }) // filename original → email
      } catch (e) {
        console.error(`Upload commun échoué : ${file.name}`, e)
        toast.error(`Impossible d'uploader ${file.name}`)
      }
    }
    return uploads
  }

  // Upload des PDFs générés automatiquement pour un stagiaire
  const uploadAttachments = async (trainee) => {
    const uploads = []
    const basePath = `stagiaire-emails/${session.id}/${trainee.id}`

    const cert = await generatePDF('certificat', session, { trainee, trainer })
    if (cert) {
      const filename = `Certificat_${ref}_${trainee.last_name}.pdf`
      const path = `${basePath}/${slugify(filename)}`
      await uploadBase64(cert.base64, path)
      uploads.push({ path, filename })
    }

    const att = await generatePDF('attestation', session, { trainee, trainer })
    if (att) {
      const filename = `Attestation_${ref}_${trainee.last_name}.pdf`
      const path = `${basePath}/${slugify(filename)}`
      await uploadBase64(att.base64, path)
      uploads.push({ path, filename })
    }

    const evalF = await generatePDF('evaluationFroid', session, { trainee })
    if (evalF) {
      const filename = `EvaluationFroid_${ref}_${trainee.last_name}.pdf`
      const path = `${basePath}/${slugify(filename)}`
      await uploadBase64(evalF.base64, path)
      uploads.push({ path, filename })
    }

    if (docStagiaire) {
      try {
        const response = await fetch(docStagiaire.file_url)
        if (response.ok) {
          const blob = await response.blob()
          const path = `${basePath}/${slugify(docStagiaire.file_name)}`
          await supabase.storage.from('documents').upload(path, blob, { contentType: blob.type || 'application/pdf', upsert: true })
          uploads.push({ path, filename: docStagiaire.file_name })
        }
      } catch (e) { console.error('Erreur doc stagiaire:', e) }
    }

    return uploads
  }

  // Upload du certificat SST propre au stagiaire
  const uploadSstForTrainee = async (trainee) => {
    const sstFileId = sstAttributions[trainee.id]
    if (!sstFileId) return null
    const sstFile = sstFiles.find(f => f.id === sstFileId)
    if (!sstFile) return null

    const path = `stagiaire-emails/${session.id}/${trainee.id}/${slugify(sstFile.name)}`
    try {
      await uploadBase64(sstFile.base64, path)
      return { path, filename: sstFile.name } // nom original pour l'email
    } catch (e) {
      console.error(`Upload SST échoué pour ${trainee.last_name}:`, e)
      return null
    }
  }

  // ── Envoi ─────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    setLoading(true)
    setStep('sending')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Non authentifié'); setStep('preview'); setLoading(false); return }

    const targets = trainees.filter(t => selectedIds.has(t.id))
    setResults(targets.map(t => ({ trainee: t, status: 'pending', error: null })))

    // Upload fichiers communs une seule fois
    const commonPaths = await uploadCommonFiles()

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]
      try {
        const personalizedBody = emailBody.replace(/\[Prénom\]/g, t.first_name)
        const individualPaths = await uploadAttachments(t)
        const sstPath = await uploadSstForTrainee(t)
        const attachmentPaths = [...individualPaths, ...(sstPath ? [sstPath] : []), ...commonPaths]

        const response = await apiFetch('/api/send-email-stagiaire', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            to: t.email,
            subject: emailSubject,
            body: personalizedBody,
            attachmentPaths,
            sessionId: session.id,
            traineeId: t.id
          })
        })

        const result = await response.json()
        setResults(prev => prev.map((r, idx) =>
          idx === i ? { ...r, status: response.ok ? 'sent' : 'error', error: response.ok ? null : result.error } : r
        ))

        // Nettoyage Storage individuel + SST après chaque envoi (pas les communs)
        const toRemove = [...individualPaths, ...(sstPath ? [sstPath] : [])].map(a => a.path)
        if (toRemove.length > 0) await supabase.storage.from('documents').remove(toRemove)

        if (i < targets.length - 1) await new Promise(r => setTimeout(r, 1500))
      } catch (err) {
        console.error(`Erreur ${t.first_name}:`, err)
        setResults(prev => prev.map((r, idx) =>
          idx === i ? { ...r, status: 'error', error: err.message } : r
        ))
      }
    }

    // Nettoyage fichiers communs après la boucle
    if (commonPaths.length > 0) {
      await supabase.storage.from('documents').remove(commonPaths.map(p => p.path))
    }

    setStep('done')
    setLoading(false)
  }

  // ── Helpers prévisualisation ──────────────────────────────────────────────

  const getTraineePreviewFiles = (trainee) => {
    const files = []
    files.push({ label: `Certificat_${ref}_${trainee.last_name}.pdf`, type: 'auto' })
    files.push({ label: `Attestation_${ref}_${trainee.last_name}.pdf`, type: 'auto' })
    files.push({ label: `EvaluationFroid_${ref}_${trainee.last_name}.pdf`, type: 'auto' })
    if (docStagiaire) files.push({ label: docStagiaire.file_name, type: 'auto' })
    const sstFile = sstFiles.find(f => f.id === sstAttributions[trainee.id])
    if (sstFile) files.push({ label: sstFile.name, type: 'sst' })
    commonFiles.forEach(f => files.push({ label: f.name, type: 'common' }))
    return files
  }

  // Fichiers SST non attribués
  const unmatchedSstFiles = sstFiles.filter(f => !Object.values(sstAttributions).includes(f.id))

  // ── Compte rendu IA ───────────────────────────────────────────────────────

  const Q_LABELS = {
    q_org_documents: 'Organisation — Documents préparés', q_org_accueil: 'Organisation — Accueil',
    q_org_locaux: 'Organisation — Locaux', q_org_materiel: 'Organisation — Matériel',
    q_contenu_organisation: 'Contenu — Organisation', q_contenu_supports: 'Contenu — Supports',
    q_contenu_duree: 'Contenu — Durée', q_contenu_programme: 'Contenu — Programme',
    q_formateur_pedagogie: 'Formateur — Pédagogie', q_formateur_expertise: 'Formateur — Expertise',
    q_formateur_progression: 'Formateur — Progression', q_formateur_moyens: 'Formateur — Moyens',
    q_global_adequation: 'Global — Adéquation', q_global_competences: 'Global — Compétences acquises',
  }
  const Q_KEYS = Object.keys(Q_LABELS)

  const computeEvalData = () => {
    if (!evals.length) return null
    const scores = {}
    Q_KEYS.forEach(key => {
      const vals = evals.map(e => e[key]).filter(v => v !== null && v !== undefined).map(Number)
      scores[key] = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null
    })
    const allScores = Q_KEYS.flatMap(key => evals.map(e => e[key]).filter(v => v !== null && v !== undefined).map(Number))
    const globalScore = allScores.length ? (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(2) : null
    const withReco = evals.filter(e => e.would_recommend !== null && e.would_recommend !== undefined)
    const tauxReco = withReco.length ? Math.round((withReco.filter(e => e.would_recommend).length / withReco.length) * 100) : null
    const comments = evals.map(e => (e.comments || e.comment || '').trim()).filter(c => c.length > 0)
    return { scores, globalScore, tauxReco, comments, total: evals.length, totalTrainees: trainees.length }
  }

  const generateCompteRendu = async () => {
    const evalData = computeEvalData()
    if (!evalData) return
    setCrGenerating(true); setCrError(null)
    const scoresText = Q_KEYS.filter(k => evalData.scores[k] !== null).map(k => `- ${Q_LABELS[k]} : ${evalData.scores[k]}/5`).join('\n')
    const commentsText = evalData.comments.length ? evalData.comments.map((c, i) => `${i + 1}. « ${c} »`).join('\n') : 'Aucun commentaire libre.'
    const prompt = `Tu es l'assistant de l'organisme de formation ${orgName()}${orgCity() ? ` (${orgCity()})` : ''}.\nFormation : ${courseTitle} — Référence : ${ref}\nDates : du ${startDate} au ${endDate} — Formateur : ${formateur}\nStagiaires ayant répondu : ${evalData.total} sur ${evalData.totalTrainees}\nScore moyen global : ${evalData.globalScore}/5 — Taux de recommandation : ${evalData.tauxReco !== null ? evalData.tauxReco + '%' : 'non calculé'}\n\nScores :\n${scoresText}\n\nCommentaires :\n${commentsText}\n\nÉcris un compte rendu professionnel de 80-150 mots. Réponds uniquement avec le texte, sans titre ni introduction.`
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] })
      })
      const data = await response.json()
      setCompteRendu(data.content?.[0]?.text || '')
    } catch (e) { setCrError('Erreur lors de la génération. Réessaie.') }
    setCrGenerating(false)
  }

  // ── Valeurs dérivées ──────────────────────────────────────────────────────

  const selectedCount = selectedIds.size
  const selectedTrainees = trainees.filter(t => selectedIds.has(t.id))

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between bg-primary-600 text-white flex-shrink-0">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Envoyer documents aux stagiaires
            {step === 'preview' && <span className="text-sm font-normal opacity-75 ml-1">— Prévisualisation</span>}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-primary-700 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1">

          {/* ══════ COMPOSITION ══════ */}
          {step === 'composition' && (
            <div className="space-y-5">

              {/* Destinataires */}
              <div className="bg-gray-50 border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-gray-700">
                    Destinataires — {selectedIds.size} sélectionné{selectedIds.size > 1 ? 's' : ''} / {trainees.length}
                  </p>
                  <button
                    onClick={() => {
                      const allWithEmail = new Set(trainees.filter(t => t.email).map(t => t.id))
                      const allSelected = trainees.filter(t => t.email).every(t => selectedIds.has(t.id))
                      setSelectedIds(allSelected ? new Set() : allWithEmail)
                    }}
                    className="text-xs text-primary-600 hover:underline"
                  >
                    {trainees.filter(t => t.email).every(t => selectedIds.has(t.id)) ? 'Tout désélectionner' : 'Tout sélectionner'}
                  </button>
                </div>
                <div className="space-y-1.5">
                  {trainees.map(t => {
                    const hasSst = !!sstAttributions[t.id]
                    return (
                      <label
                        key={t.id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                          !t.email ? 'opacity-50 cursor-not-allowed' :
                          selectedIds.has(t.id) ? 'bg-green-50 border border-green-200' : 'bg-white border border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={t.email ? selectedIds.has(t.id) : false}
                          disabled={!t.email}
                          onChange={() => {
                            if (!t.email) return
                            setSelectedIds(prev => { const n = new Set(prev); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n })
                          }}
                          className="w-4 h-4 rounded accent-green-600"
                        />
                        <span className="text-sm font-medium text-gray-800">{t.first_name} {t.last_name}</span>
                        {hasSst && (
                          <span className="flex items-center gap-0.5 text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                            <ShieldCheck className="w-3 h-3" /> SST
                          </span>
                        )}
                        {t.email
                          ? <span className="text-xs text-gray-400 ml-auto truncate max-w-[180px]">{t.email}</span>
                          : <span className="text-xs text-amber-600 italic ml-auto">pas d'email</span>
                        }
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Objet */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Objet</label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>

              {/* Corps du mail */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Corps du mail
                  <span className="ml-2 text-xs text-gray-400 font-normal">[Prénom] sera remplacé par le prénom de chaque stagiaire</span>
                </label>
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className="w-full h-64 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono resize-none"
                />
              </div>

              {/* PJ auto-générées */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm font-semibold text-blue-800 mb-1.5 flex items-center gap-1.5">
                  <FileText className="w-4 h-4" /> Pièces jointes générées automatiquement (par stagiaire)
                </p>
                <ul className="text-sm text-blue-700 space-y-0.5 ml-4 list-disc">
                  <li>Certificat de réalisation — <em>Certificat_{ref}_[Nom].pdf</em></li>
                  <li>Attestation de présence — <em>Attestation_{ref}_[Nom].pdf</em></li>
                  <li>Évaluation à froid — <em>EvaluationFroid_{ref}_[Nom].pdf</em></li>
                  {docStagiaire && <li>{docStagiaire.title} — <em>{docStagiaire.file_name}</em></li>}
                </ul>
              </div>

              {/* ── ZONE 1 : Certificats SST ── */}
              <div className="border border-green-200 rounded-lg overflow-hidden">
                <div className="bg-green-50 px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-green-800 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4" /> Certificats SST Forprev (par stagiaire)
                    </p>
                    <p className="text-xs text-green-600 mt-0.5">
                      Attribution automatique par nom — vérifiez et corrigez si nécessaire
                    </p>
                  </div>
                  {sstFiles.length > 0 && (
                    <button
                      onClick={() => { setSstFiles([]); setSstAttributions({}) }}
                      className="text-xs text-red-500 hover:text-red-700 underline flex-shrink-0"
                    >
                      Tout effacer
                    </button>
                  )}
                </div>

                <div className="p-3 space-y-2">
                  {/* Zone d'upload */}
                  <label className="flex items-center justify-center gap-2 border-2 border-dashed border-green-300 rounded-lg p-3 cursor-pointer hover:border-green-400 hover:bg-green-50/40 transition-colors">
                    <Upload className="w-4 h-4 text-green-500" />
                    <span className="text-sm text-green-600">Choisir les certificats SST (PDF)</span>
                    <input type="file" multiple onChange={handleSstUpload} className="hidden" accept=".pdf" />
                  </label>

                  {/* Fichiers uploadés avec attribution */}
                  {sstFiles.length > 0 && (
                    <div className="space-y-1.5">
                      {sstFiles.map(file => {
                        const attributedEntry = Object.entries(sstAttributions).find(([, fid]) => fid === file.id)
                        const attributedTraineeId = attributedEntry?.[0] || ''
                        const isUnmatched = !attributedEntry

                        return (
                          <div
                            key={file.id}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
                              isUnmatched ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'
                            }`}
                          >
                            {isUnmatched
                              ? <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                              : <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                            }
                            <span className="truncate flex-1 text-xs text-gray-700 min-w-0">{file.name}</span>
                            <select
                              value={attributedTraineeId}
                              onChange={(e) => handleSstFileAttribution(file.id, e.target.value || null)}
                              className={`text-xs border rounded px-1.5 py-1 bg-white flex-shrink-0 max-w-[170px] ${
                                isUnmatched ? 'border-amber-300 text-amber-700' : 'border-gray-300 text-gray-700'
                              }`}
                            >
                              <option value="">— Non attribué —</option>
                              {trainees.map(t => (
                                <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
                              ))}
                            </select>
                            <button onClick={() => handleRemoveSstFile(file.id)} className="p-1 hover:bg-gray-100 rounded flex-shrink-0">
                              <Trash2 className="w-3.5 h-3.5 text-red-400" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Avertissement fichiers non attribués */}
                  {unmatchedSstFiles.length > 0 && (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700">
                        {unmatchedSstFiles.length} fichier{unmatchedSstFiles.length > 1 ? 's' : ''} non attribué{unmatchedSstFiles.length > 1 ? 's' : ''} — vérifiez les listes déroulantes ci-dessus.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* ── ZONE 2 : Fichiers communs ── */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-3">
                  <p className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                    <FileText className="w-4 h-4" /> Fichiers communs
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">Envoyés à tous les stagiaires sélectionnés (notices, supports…)</p>
                </div>
                <div className="p-3 space-y-2">
                  <label className="flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-lg p-3 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-colors">
                    <Upload className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-500">Choisir des fichiers</span>
                    <input type="file" multiple onChange={handleCommonUpload} className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" />
                  </label>
                  {commonFiles.length > 0 && (
                    <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
                      {commonFiles.map(file => (
                        <div key={file.id} className="flex items-center gap-2 px-3 py-2">
                          <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <span className="text-sm text-gray-700 truncate flex-1">{file.name}</span>
                          <span className="text-xs text-gray-400 flex-shrink-0">{formatSize(file.size)}</span>
                          <button onClick={() => setCommonFiles(prev => prev.filter(f => f.id !== file.id))} className="p-1 hover:bg-gray-100 rounded flex-shrink-0">
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Compte rendu IA */}
              {evalsLoaded && (() => {
                const evalData = computeEvalData()
                return (
                  <div className="border border-purple-200 rounded-lg overflow-hidden">
                    <div className="bg-purple-50 px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-purple-800">📋 Compte rendu de formation</p>
                        <p className="text-xs text-purple-600 mt-0.5">
                          {evals.length > 0
                            ? `${evals.length} éval${evals.length > 1 ? 's' : ''} — Score : ${evalData?.globalScore || '—'}/5 — Reco : ${evalData?.tauxReco !== null ? evalData.tauxReco + '%' : '—'}`
                            : 'Aucune évaluation à chaud disponible'}
                        </p>
                      </div>
                      {evals.length > 0 && (
                        <button onClick={generateCompteRendu} disabled={crGenerating}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50">
                          {crGenerating ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <span>✨</span>}
                          {crGenerating ? 'Génération…' : (compteRendu ? 'Regénérer' : "Générer avec l'IA")}
                        </button>
                      )}
                    </div>
                    {crError && <div className="mx-4 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{crError}</div>}
                    {evals.length > 0 && evalData?.comments.length > 0 && (
                      <div className="px-4 pt-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Commentaires</p>
                        <div className="space-y-1.5">
                          {evalData.comments.map((c, i) => (
                            <p key={i} className="text-xs text-gray-600 italic bg-gray-50 border border-gray-200 rounded px-3 py-2">« {c} »</p>
                          ))}
                        </div>
                      </div>
                    )}
                    {compteRendu && (
                      <div className="px-4 py-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Texte généré</p>
                          <button
                            onClick={() => { setEmailBody(prev => prev + '\n\n--- Compte rendu de la formation ---\n' + compteRendu); toast.success('Compte rendu ajouté') }}
                            className="text-xs text-purple-600 hover:text-purple-800 font-medium underline"
                          >+ Ajouter au mail</button>
                        </div>
                        <textarea
                          value={compteRendu} onChange={e => setCompteRendu(e.target.value)}
                          className="w-full px-3 py-2 border border-purple-200 rounded-lg text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-purple-300"
                          rows={Math.max(3, compteRendu.split('\n').length + 1)}
                        />
                      </div>
                    )}
                    {evals.length === 0 && (
                      <p className="px-4 py-3 text-xs text-gray-500 italic">Les évaluations à chaud ne sont pas encore disponibles.</p>
                    )}
                  </div>
                )
              })()}

              {/* Bouton Prévisualiser */}
              <button
                onClick={() => setStep('preview')}
                disabled={selectedCount === 0}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
              >
                <Eye className="w-5 h-5" />
                Prévisualiser avant envoi — {selectedCount} stagiaire{selectedCount > 1 ? 's' : ''}
              </button>
            </div>
          )}

          {/* ══════ PRÉVISUALISATION ══════ */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                <p className="text-sm font-semibold text-blue-800">👁 Vérifiez les documents avant envoi</p>
                <p className="text-xs text-blue-600 mt-0.5">Vous pouvez encore modifier les attributions SST depuis cette vue.</p>
              </div>

              {/* Carte par stagiaire */}
              {selectedTrainees.map(t => {
                const previewFiles = getTraineePreviewFiles(t)
                return (
                  <div key={t.id} className="border border-gray-200 rounded-lg overflow-hidden">
                    {/* En-tête stagiaire */}
                    <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between">
                      <div className="min-w-0">
                        <span className="text-sm font-semibold text-gray-800">{t.first_name} {t.last_name}</span>
                        <span className="text-xs text-gray-500 ml-2">{t.email}</span>
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0 ml-2">{previewFiles.length} fichier{previewFiles.length > 1 ? 's' : ''}</span>
                    </div>
                    {/* Liste des fichiers */}
                    <div className="px-4 py-2 space-y-1">
                      {previewFiles.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          {f.type === 'sst'
                            ? <ShieldCheck className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                            : <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${f.type === 'common' ? 'text-gray-400' : 'text-blue-400'}`} />
                          }
                          <span className={f.type === 'sst' ? 'text-green-700 font-medium' : 'text-gray-600'}>{f.label}</span>
                          <span className={`ml-auto text-xs flex-shrink-0 ${f.type === 'sst' ? 'text-green-400' : f.type === 'common' ? 'text-gray-300' : 'text-gray-300'}`}>
                            {f.type === 'sst' ? 'SST' : f.type === 'common' ? 'commun' : 'auto'}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Correction attribution SST si des fichiers SST ont été chargés */}
                    {sstFiles.length > 0 && (
                      <div className="px-4 pb-3 flex items-center gap-2 border-t border-gray-100 pt-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                        <span className="text-xs text-gray-500 flex-shrink-0">Certificat SST :</span>
                        <select
                          value={sstAttributions[t.id] || ''}
                          onChange={(e) => handleTraineeSstAttribution(t.id, e.target.value || null)}
                          className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white flex-1 min-w-0"
                        >
                          <option value="">— Aucun —</option>
                          {sstFiles.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Avertissement fichiers SST non attribués */}
              {unmatchedSstFiles.length > 0 && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">
                      {unmatchedSstFiles.length} fichier{unmatchedSstFiles.length > 1 ? 's' : ''} SST non attribué{unmatchedSstFiles.length > 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-amber-700 mt-0.5">{unmatchedSstFiles.map(f => f.name).join(' · ')}</p>
                  </div>
                </div>
              )}

              {/* Boutons */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setStep('composition')}
                  className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
                >
                  <ChevronLeft className="w-4 h-4" /> Retour
                </button>
                <button
                  onClick={handleSend}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                >
                  <Send className="w-4 h-4" />
                  Confirmer et envoyer à {selectedCount} stagiaire{selectedCount > 1 ? 's' : ''}
                </button>
              </div>
            </div>
          )}

          {/* ══════ ENVOI EN COURS ══════ */}
          {step === 'sending' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <Loader className="w-6 h-6 text-primary-600 animate-spin" />
                <p className="text-gray-700 font-medium">Envoi en cours...</p>
              </div>
              <div className="space-y-2">
                {results.map((r, i) => (
                  <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
                    r.status === 'sent' ? 'bg-green-50' : r.status === 'error' ? 'bg-red-50' : 'bg-blue-50'
                  }`}>
                    {r.status === 'sent' && <CheckCircle className="w-4 h-4 text-green-600" />}
                    {r.status === 'error' && <AlertCircle className="w-4 h-4 text-red-600" />}
                    {r.status === 'pending' && <Loader className="w-4 h-4 text-blue-600 animate-spin" />}
                    <span className={`font-medium ${r.status === 'sent' ? 'text-green-800' : r.status === 'error' ? 'text-red-800' : 'text-blue-800'}`}>
                      {r.trainee.first_name} {r.trainee.last_name}
                    </span>
                    {r.status === 'sent' && <span className="text-green-600 text-xs ml-auto">Envoyé ✓</span>}
                    {r.status === 'error' && <span className="text-red-600 text-xs ml-auto">{r.error}</span>}
                    {r.status === 'pending' && <span className="text-blue-600 text-xs ml-auto">En attente...</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══════ TERMINÉ ══════ */}
          {step === 'done' && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <CheckCircle className="w-14 h-14 text-green-600 mx-auto mb-3" />
                <p className="text-lg font-semibold text-gray-900">Envoi terminé</p>
                <p className="text-sm text-gray-600 mt-1">
                  {results.filter(r => r.status === 'sent').length} email{results.filter(r => r.status === 'sent').length > 1 ? 's' : ''} envoyé{results.filter(r => r.status === 'sent').length > 1 ? 's' : ''} avec succès
                </p>
              </div>
              <div className="space-y-2">
                {results.map((r, i) => (
                  <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${r.status === 'sent' ? 'bg-green-50' : 'bg-red-50'}`}>
                    {r.status === 'sent' ? <CheckCircle className="w-4 h-4 text-green-600" /> : <AlertCircle className="w-4 h-4 text-red-600" />}
                    <span className="font-medium">{r.trainee.first_name} {r.trainee.last_name}</span>
                    {r.status === 'sent' && <span className="text-green-600 text-xs ml-auto">Envoyé ✓</span>}
                    {r.status === 'error' && <span className="text-red-600 text-xs ml-auto">{r.error}</span>}
                  </div>
                ))}
              </div>
              <button onClick={onClose} className="w-full mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
                Fermer
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

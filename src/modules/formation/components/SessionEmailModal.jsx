import { orgName, orgCity } from '../../../core/org/currentOrg'
import { apiFetch } from '../../../core/api'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../core/supabase'
import { X, FileText, Send, Loader, CheckCircle, AlertCircle, Upload, Trash2, Eye, Edit3, History, Mail, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { preparerDocuments } from '../lib/documentsEmis'
import { generatePDF, generateAllPDF, setOrganization } from '../pdf/pdfGenerator'
import { getNeedsAnalysisPDFBytes } from '../pdf/needsAnalysisPDF'
import { generateSatisfactionEntreprisePDF } from '../pdf/satisfactionEntreprisePDF'
import { useDataStore } from '../../../core/store'
import { generatePasseportPreventionPDF } from '../../prevention/pdf/pdfPasseportPrevention'
import { prepareOrgForPDF } from '../../../core/org/orgUtils'
import { lienEspaceClient } from '../../../core/portail/lienEspace'
import { ouvrirFichier, readableUrl } from '../../../core/storageUtils'
import { fichierDeLInstance } from '../../../core/fichiersInstance'

// ════════════════════════════════════════════════════════════
// MiniSignaturePad - Mini canvas signature inline pour formateur
// Génère un PNG data URL via callback onValidate(dataUrl)
// ════════════════════════════════════════════════════════════
function MiniSignaturePad({ onValidate, onCancel }) {
  const canvasRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1f2937'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, [])

  const getCoords = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if (e.touches && e.touches.length > 0) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY
      }
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    }
  }

  const startDraw = (e) => {
    e.preventDefault()
    const { x, y } = getCoords(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(x, y)
    setIsDrawing(true)
  }

  const moveDraw = (e) => {
    if (!isDrawing) return
    e.preventDefault()
    const { x, y } = getCoords(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.lineTo(x, y)
    ctx.stroke()
    if (!hasDrawn) setHasDrawn(true)
  }

  const endDraw = () => setIsDrawing(false)

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
  }

  const validate = () => {
    if (!hasDrawn) return
    const dataUrl = canvasRef.current.toDataURL('image/png')
    onValidate(dataUrl)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-ui-sm max-w-lg w-full p-5 space-y-3 shadow-md">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900"> Signature du formateur</h3>
          <button onClick={onCancel} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <p className="text-ui-sm text-gray-500">
          Signez ci-dessous avec votre souris ou votre doigt. Cette signature sera enregistrée
          dans votre profil formateur et utilisée pour vos prochaines feuilles d'émargement.
        </p>
        <canvas
          ref={canvasRef}
          width={600}
          height={200}
          className="border-2 border-dashed border-gray-300 rounded-ui-sm w-full bg-white touch-none cursor-crosshair"
          onMouseDown={startDraw}
          onMouseMove={moveDraw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={moveDraw}
          onTouchEnd={endDraw}
        />
        <div className="flex justify-between gap-2 pt-1">
          <button
            onClick={clear}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-ui-sm text-ui hover:bg-gray-50"
          >
            Effacer
          </button>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-ui-sm text-ui hover:bg-gray-50"
            >
              Annuler
            </button>
            <button
              onClick={validate}
              disabled={!hasDrawn}
              className="btn btn-secondary text-ui font-medium hover:bg-[rgb(var(--c-info))] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Valider
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SessionEmailModal({ session, emailType, sessionCosts, questions, traineeResults, onClose }) {
  // Stagiaires notés absents sur toute la session (feuille d'émargement)
  const absentTraineeIds = () => (session?.session_trainees || []).filter(st => st.absent).map(st => st.trainee_id)

  const { organization, fetchOrganization } = useDataStore()
  useEffect(() => {
    if (!organization) fetchOrganization()
    if (organization) setOrganization(organization)
  }, [organization])

  const [step, setStep] = useState('generating') // 'generating', 'compose', 'sending', 'sent'
  const [generatedFiles, setGeneratedFiles] = useState([])
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [generationLog, setGenerationLog] = useState([])

  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [toEmail, setToEmail] = useState('')
  // Convocation envoyée aussi à chaque stagiaire qui a un e-mail (22/10, décision de H)
  const [envoyerAuxStagiaires, setEnvoyerAuxStagiaires] = useState(true)
  const stagiairesAvecMail = (session?.session_trainees || []).filter((st) => !st.absent && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(st.trainees?.email || '').trim()))

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [userEmail, setUserEmail] = useState(null)

  // ── Compte rendu post-formation ──
  const [evals, setEvals] = useState([])
  const [evalsLoaded, setEvalsLoaded] = useState(false)
  const [compteRendu, setCompteRendu] = useState('')
  const [crGenerating, setCrGenerating] = useState(false)
  const [crError, setCrError] = useState(null)

  // ── Signature formateur ──
  const [trainerSignatureBase64, setTrainerSignatureBase64] = useState(null)
  const [trainerData, setTrainerData] = useState(null)
  const [showSignaturePad, setShowSignaturePad] = useState(false)
  const [savingSignature, setSavingSignature] = useState(false)

  // ── Aperçu PDF ──
  const [previewFile, setPreviewFile] = useState(null)

  // ── Cases à cocher (exclusion d'envoi) ──
  const [excludedFileIds, setExcludedFileIds] = useState(new Set())

  // ── Historique des envois précédents pour cette session ──
  const [emailHistory, setEmailHistory] = useState([])
  const [historyExpanded, setHistoryExpanded] = useState(false)

  // ── Données émargement pour le tableau de bord complétude ──
  const [attendanceStatus, setAttendanceStatus] = useState(null)

  // ── Test envoi à soi-même ──
  const [sendingTest, setSendingTest] = useState(false)

  useEffect(() => {
    loadUserEmail()
    initializeEmail()
    loadTrainerSignature()
    loadEmailHistory()
    generateAllDocuments()
    // Charger les évals à chaud uniquement pour « après formation »
    if (emailType === 'after' && session?.id) {
      // D'abord récupérer les trainee_id valides de la session
      supabase
        .from('session_trainees')
        .select('trainee_id')
        .eq('session_id', session.id)
        .then(({ data: stData }) => {
          const validIds = (stData || []).map(st => st.trainee_id)
          // Puis charger les évals et filtrer sur ces IDs uniquement
          supabase
            .from('trainee_evaluations')
            .select('*')
            .eq('session_id', session.id)
            .then(({ data }) => {
              const filtered = (data || []).filter(e => validIds.includes(e.trainee_id))
              setEvals(filtered)
              setEvalsLoaded(true)
            })
        })
    }
  }, [])

  const loadUserEmail = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('user_email_configs')
      .select('email')
      .eq('user_id', user.id)
      .maybeSingle()
    if (data) setUserEmail(data.email)
  }

  // ── Charger la signature du formateur de la session depuis Storage ──
  // Retourne le data URL base64 (ou null) afin d'être utilisable sans dépendance au state
  const loadTrainerSignature = async () => {
    const trainer = session?.trainers
    if (!trainer?.id) return null
    // Récupérer le trainer complet (la session peut ne pas avoir signature_url joint)
    const { data: trainerFull } = await supabase
      .from('trainers')
      .select('id, first_name, last_name, signature_url')
      .eq('id', trainer.id)
      .maybeSingle()
    if (!trainerFull) return null
    setTrainerData(trainerFull)
    if (!trainerFull.signature_url) {
      console.log('Pas de signature formateur en base - bouton "Signer" affiché')
      return null
    }
    try {
      // Bucket privé : lien signé de courte durée
      const signed = await readableUrl(trainerFull.signature_url)
      if (!signed) return null
      const resp = await fetch(signed)
      const blob = await resp.blob()
      const b64 = await blobToBase64WithPrefix(blob)
      setTrainerSignatureBase64(b64)
      console.log('Signature formateur préchargée')
      return b64
    } catch (e) {
      console.warn('Erreur chargement signature formateur:', e)
      return null
    }
  }

  // Helper : blob → data URL complet (avec préfixe data:image/...;base64,)
  const blobToBase64WithPrefix = (blob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  // ── Charger l'historique des envois pour cette session ──
  const loadEmailHistory = async () => {
    if (!session?.id) return
    const { data, error } = await supabase
      .from('session_emails_sent')
      .select('id, email_type, to_email, subject, created_at, status, attachments')
      .eq('session_id', session.id)
      .eq('email_type', emailType)
      .order('created_at', { ascending: false })
      .limit(5)
    if (error) {
      console.warn('Erreur chargement historique emails:', error)
      return
    }
    setEmailHistory(data || [])
  }

  // ── Sauvegarder la signature dessinée par le formateur ──
  // Politique : sauvegarder dans Storage + UPDATE trainers.signature_url
  // SEULEMENT si vide en base (ne pas écraser une signature existante)
  const handleSaveSignature = async (dataUrl) => {
    setSavingSignature(true)
    try {
      const trainer = trainerData || session?.trainers
      if (!trainer?.id) throw new Error('Formateur introuvable')

      // Re-vérifier en base que la signature est toujours vide (sécurité anti-écrasement)
      const { data: fresh } = await supabase
        .from('trainers')
        .select('signature_url')
        .eq('id', trainer.id)
        .maybeSingle()

      if (fresh?.signature_url) {
        // Signature ajoutée entretemps depuis ailleurs → utiliser quand même celle dessinée
        // pour ce mail mais NE PAS écraser
        console.log('Signature en base entretemps → utilisée localement seulement')
        setTrainerSignatureBase64(dataUrl)
        setShowSignaturePad(false)
        toast.success('Signature utilisée pour cet envoi')
        await regenerateEmargementWithSignature(dataUrl)
        return
      }

      // Convertir dataUrl → blob pour upload Storage
      const fetchRes = await fetch(dataUrl)
      const blob = await fetchRes.blob()

      const fileName = `signature_${Date.now()}.png`
      const filePath = `${trainer.id}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('trainer-signatures')
        .upload(filePath, blob, {
          contentType: 'image/png',
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('trainer-signatures')
        .getPublicUrl(filePath)

      const { error: updateError } = await supabase
        .from('trainers')
        .update({ signature_url: publicUrl })
        .eq('id', trainer.id)

      if (updateError) throw updateError

      setTrainerSignatureBase64(dataUrl)
      setTrainerData({ ...trainer, signature_url: publicUrl })
      setShowSignaturePad(false)
      toast.success('Signature enregistrée dans votre profil')

      // Régénérer le PDF émargement avec la nouvelle signature
      await regenerateEmargementWithSignature(dataUrl)
    } catch (err) {
      console.error('Erreur sauvegarde signature:', err)
      toast.error('Erreur lors de l\'enregistrement : ' + err.message)
    } finally {
      setSavingSignature(false)
    }
  }

  // ── Régénérer le PDF émargement avec la nouvelle signature ──
  const regenerateEmargementWithSignature = async (signatureB64) => {
    if (emailType !== 'after') return
    // Trouver l'émargement dans les fichiers générés
    const existing = generatedFiles.find(f => f.id === 'emargement')
    if (!existing) {
      // Pas d'émargement (peut-être incomplet) → on ne fait rien
      return
    }

    const trainer = session?.trainers
    const traineesWithResult = session?.session_trainees?.map(st => ({
      ...st.trainees,
      result: st.result || (traineeResults && traineeResults[st.trainee_id]) || null,
      access_code: st.access_code
    })) || []

    // Refetch des données d'émargement
    const [{ data: signatures }, { data: halfDays }, { data: digitalSigs }, { data: proxies }] = await Promise.all([
      supabase.from('attendances').select('*').eq('session_id', session.id),
      supabase.from('attendance_halfdays').select('*').eq('session_id', session.id),
      supabase.from('document_signatures').select('*').eq('session_id', session.id).eq('document_type', 'emargement').eq('status', 'valid'),
      supabase.from('attendance_proxy_signatures').select('*').eq('session_id', session.id)
    ])

    const emargement = await generatePDF('emargement', session, {
      trainees: traineesWithResult,
      trainer,
      isBlank: false,
      attendanceData: {
        signatures: signatures || [],
        halfdays: halfDays || [],
        digitalSignatures: digitalSigs || [],
        proxies: proxies || [],
        absents: absentTraineeIds(),
        trainerSignatureBase64: signatureB64
      }
    })

    if (emargement) {
      setGeneratedFiles(prev => prev.map(f =>
        f.id === 'emargement'
          ? { ...f, base64: emargement.base64, size: emargement.size }
          : f
      ))
      toast.success('Feuille d\'émargement régénérée avec votre signature')
    }
  }

  const initializeEmail = async () => {
    const espace = emailType === 'before' ? await lienEspaceClient(session?.client_id) : null
    const sessionContact = session?.contact
    const primaryContact = session?.clients?.contacts?.find(c => c.is_primary)
    const firstContact = session?.clients?.contacts?.[0]
    const contactEmail = sessionContact?.email || primaryContact?.email || firstContact?.email || session?.clients?.email || ''
    setToEmail(contactEmail)

    const ref = session?.reference || ''
    const courseTitle = session?.courses?.title || ''

    if (emailType === 'before') {
      setEmailSubject(`${courseTitle} - Documents de formation - ${ref}`)
      setEmailBody(`Bonjour,

Veuillez trouver ci-joints les documents relatifs à la formation "${courseTitle}" :

- Convention de formation
- Programme de formation
- Convocations des stagiaires
- Analyse du besoin de formation
- Notice stagiaire - Passeport de Prévention
- Notice employeur - Passeport de Prévention
- Décharge de refus de communication du NIR

Merci de nous retourner la convention signée ainsi que l'analyse du besoin complétée et signée avant le début de la formation.

Concernant le Passeport de Prévention : conformément au Décret n° 2025-748 du 1er août 2025, nous déclarons les formations santé-sécurité dans le Passeport de prévention national. La notice stagiaire est à remettre à chaque participant. Si un salarié refuse de communiquer son NIR, merci de lui faire signer la décharge jointe.

Concernant les convocations, chacune contient un QR code et un lien permettant aux stagiaires de se connecter à notre portail en ligne. Ils pourront y renseigner leurs informations personnelles, indiquer leurs attentes et participer à un test de positionnement avant le début de la formation. Ce test n'a aucun caractère certificatif : il vise uniquement à évaluer leur niveau de connaissances préalable afin de mieux adapter la formation à leur niveau.${espace ? "\n\nLa convention peut aussi être signée en ligne depuis votre espace client : l'adresse, le QR code et votre code d'accès figurent dans l'encadré « Signer en ligne » en fin de convention." : ''}

Restant à votre disposition pour toute information complémentaire.`)
    } else {
      setEmailSubject(`${courseTitle} - Documents de fin de formation - ${ref}`)
      setEmailBody(`Bonjour,

Suite à la formation "${courseTitle}", veuillez trouver ci-joints :

- Les certificats de réalisation
- Les attestations de présence
- La feuille d'émargement signée
- Les questionnaires d'évaluation à froid (à compléter d'ici 90 jours)
- Le questionnaire de satisfaction entreprise

Nous vous serions reconnaissants de bien vouloir compléter et nous retourner le questionnaire de satisfaction entreprise afin de nous permettre d'améliorer continuellement la qualité de nos prestations.

Nous vous remercions pour votre confiance et restons à votre disposition.`)
    }
  }

  // ─── Génération automatique de tous les documents ───
  const generateAllDocuments = async () => {
    const trainer = session?.trainers || null
    const traineesWithResult = session?.session_trainees?.map(st => ({
      ...st.trainees,
      result: st.result || (traineeResults && traineeResults[st.trainee_id]) || null,
      access_code: st.access_code
    })) || []

    const files = []
    const addLog = (msg) => setGenerationLog(prev => [...prev, msg])

    try {
      if (emailType === 'before') {
        // ── CONVENTION ──
        addLog('Convention...')
        const convention = await generatePDF('convention', session, {
          trainees: traineesWithResult,
          trainer,
          costs: sessionCosts || []
        })
        if (convention) {
          files.push({ id: 'convention', name: convention.filename, base64: convention.base64, size: convention.size })
          addLog('Convention générée')
        }

        // ── PROGRAMME : PDF déposé dans le stockage de l'instance s'il existe, sinon généré par l'outil depuis la
        // fiche de la formation ; jamais un fichier d'un autre outil (fichierDeLInstance) ──
        addLog('Programme...')
        try {
          const { data: course } = await supabase
            .from('courses')
            .select('*')
            .eq('id', session.course_id)
            .single()
          const programmeName = `Programme_${course?.title || 'formation'}.pdf`
          const url = fichierDeLInstance(course?.program_url)
          let ajoute = false
          if (url) {
            const response = await fetch(await readableUrl(url))
            if (response.ok) {
              const blob = await response.blob()
              const base64 = await blobToBase64(blob)
              files.push({ id: 'programme', name: programmeName, base64, size: base64.length })
              addLog('Programme récupéré')
              ajoute = true
            }
          }
          if (!ajoute && course) {
            const genere = await generatePDF('programme', { ...session, courses: course }, { trainer })
            if (genere?.base64) {
              files.push({ id: 'programme', name: programmeName, base64: genere.base64, size: genere.size })
              addLog('Programme généré')
            }
          }
        } catch (e) {
          console.error('Erreur récupération programme:', e)
          addLog('Erreur récupération programme')
        }

        // ── CONVOCATIONS INDIVIDUELLES (un PDF par stagiaire) ──
        addLog(`Convocations individuelles (${traineesWithResult.length} stagiaires)...`)
        for (const trainee of traineesWithResult) {
          try {
            const convoc = await generatePDF('convocation', session, { trainee, trainer })
            if (convoc) {
              files.push({ id: `convocation_${trainee.id}`, name: convoc.filename, base64: convoc.base64, size: convoc.size })
            }
          } catch (err) {
            console.error(`Erreur convocation ${trainee.last_name}:`, err)
            addLog(`Erreur convocation ${trainee.first_name} ${trainee.last_name}`)
          }
        }
        addLog(`${traineesWithResult.length} convocation(s) générée(s)`)

        // ── ANALYSE DU BESOIN (préfillée) ──
        addLog('Analyse du besoin...')
        try {
          const startDate = session?.start_date ? new Date(session.start_date).toLocaleDateString('fr-FR') : ''
          const endDate = session?.end_date ? new Date(session.end_date).toLocaleDateString('fr-FR') : ''
          const analysisData = {
            analysis_date: new Date().toISOString().split('T')[0],
            location_type: session?.is_intra ? 'client' : 'nos_locaux',
            location_client_address: session?.is_intra ? (session?.clients?.address || '') : '',
            location_name: session?.location_name || '',
            preferred_dates: startDate === endDate ? startDate : `${startDate} au ${endDate}`
          }
          const analyseBytes = await getNeedsAnalysisPDFBytes(session, analysisData, false, organization)
          if (analyseBytes) {
            files.push({ id: 'analyseBesoin', name: `Analyse_Besoin_${session?.reference || 'session'}.pdf`, arrayBuffer: analyseBytes, size: analyseBytes.byteLength })
            addLog('Analyse du besoin générée')
          }
        } catch (e) {
          console.error('Erreur génération analyse besoin:', e)
          addLog('Erreur génération analyse du besoin')
        }

        // ── DOCUMENTS PASSEPORT PRÉVENTION (3 PDF depuis Storage) ──
        addLog('Documents Passeport Prévention...')
        // Notices et décharge générées aux couleurs de l'organisme
        try {
          const orgForPP = (await prepareOrgForPDF(organization)) || organization
          // Décharge « NIR non communiqué » générée elle aussi (22/10 : le fichier du stockage manquait)
          ;[['notice_stagiaire_pp', 'stagiaire', 'Notice_Stagiaire_Passeport_Prevention.pdf'], ['notice_employeur_pp', 'entreprise', 'Notice_Employeur_Passeport_Prevention.pdf'], ['decharge_nir_pp', 'decharge', 'Decharge_NIR_non_communique_Passeport_Prevention.pdf']].forEach(([id, version, name]) => {
            const base64 = generatePasseportPreventionPDF(version, orgForPP).output('datauristring').split(',')[1]
            files.push({ id, name, base64, size: base64.length })
          })
        } catch (e) {
          console.error('Erreur notices Passeport Prévention:', e)
          addLog('Notices Passeport Prévention non générées')
        }
        addLog('Documents Passeport Prévention ajoutés')

      } else {
        // ── CERTIFICATS ──
        addLog(`Certificats (${traineesWithResult.length} stagiaires)...`)
        // Heures réellement suivies et documents figés une fois émis (0398, 0399)
        const pourCertificats = await preparerDocuments(session, 'certificat', traineesWithResult)
        if (!pourCertificats) throw new Error('Correction d\'un certificat émis sans motif : envoi arrêté')
        const certificats = await generateAllPDF('certificat', session, pourCertificats, { trainer })
        if (certificats) {
          files.push({ id: 'certificats', name: certificats.filename, base64: certificats.base64, size: certificats.size })
          addLog('Certificats générés')
        }

        // ── ATTESTATIONS ──
        addLog(`Attestations (${traineesWithResult.length} stagiaires)...`)
        const pourAttestations = await preparerDocuments(session, 'attestation', traineesWithResult)
        if (!pourAttestations) throw new Error('Correction d\'une attestation émise sans motif : envoi arrêté')
        const attestations = await generateAllPDF('attestation', session, pourAttestations, { trainer })
        if (attestations) {
          files.push({ id: 'attestations', name: attestations.filename, base64: attestations.base64, size: attestations.size })
          addLog('Attestations générées')
        }

        // ── ÉMARGEMENT (signatures stagiaires + signature formateur) ──
        addLog('Vérification feuille d\'émargement...')
        try {
          // On charge la signature formateur en parallèle pour éviter la race condition
          // (le state trainerSignatureBase64 peut ne pas être encore mis à jour ici)
          const [{ data: signatures }, { data: halfDays }, { data: digitalSigs }, freshTrainerSig, { data: proxies }] = await Promise.all([
            supabase.from('attendances').select('*').eq('session_id', session.id),
            supabase.from('attendance_halfdays').select('*').eq('session_id', session.id),
            supabase.from('document_signatures').select('*').eq('session_id', session.id).eq('document_type', 'emargement').eq('status', 'valid'),
            trainerSignatureBase64 ? Promise.resolve(trainerSignatureBase64) : loadTrainerSignature(),
            supabase.from('attendance_proxy_signatures').select('*').eq('session_id', session.id)
          ])

          // Vérification de complétude : tous les stagiaires × toutes les demi-journées prévues
          const completeness = checkAttendanceCompleteness(
            session,
            traineesWithResult,
            signatures || [],
            halfDays || [],
            digitalSigs || []
          )
          setAttendanceStatus(completeness)

          if (completeness.isComplete) {
            // Émargement 100% signé → générer et joindre
            const emargement = await generatePDF('emargement', session, {
              trainees: traineesWithResult,
              trainer,
              isBlank: false,
              attendanceData: {
                signatures: signatures || [],
                halfdays: halfDays || [],
                digitalSignatures: digitalSigs || [],
                proxies: proxies || [],
                absents: absentTraineeIds(),
                trainerSignatureBase64: freshTrainerSig // valeur garantie fraîche
              }
            })
            if (emargement) {
              files.push({ id: 'emargement', name: emargement.filename, base64: emargement.base64, size: emargement.size })
              addLog(freshTrainerSig
                ? ' Feuille d\'émargement signée générée (avec signature formateur)'
                : ' Feuille d\'émargement signée générée (sans signature formateur)')
            }
          } else {
            // Incomplet → skip silencieux + log explicite
            addLog(`Émargement non joint : ${completeness.missing} demi-journée(s) non signée(s)`)
          }
        } catch (e) {
          console.error('Erreur génération émargement:', e)
          addLog('Erreur génération feuille d\'émargement')
        }

        // ── EVALUATIONS À FROID ──
        addLog(`Évaluations à froid (${traineesWithResult.length} stagiaires)...`)
        const evaluationsFroid = await generateAllPDF('evaluationFroid', session, traineesWithResult, { trainer })
        if (evaluationsFroid) {
          files.push({ id: 'evaluationsFroid', name: evaluationsFroid.filename, base64: evaluationsFroid.base64, size: evaluationsFroid.size })
          addLog('Évaluations à froid générées')
        }

        // ── QUESTIONNAIRE SATISFACTION ENTREPRISE ──
        addLog('Questionnaire satisfaction entreprise...')
        try {
          const satisfactionPDF = await generateSatisfactionEntreprisePDF(session, session?.clients)
          if (satisfactionPDF) {
            files.push({ id: 'satisfactionEntreprise', name: satisfactionPDF.filename, base64: satisfactionPDF.base64, size: satisfactionPDF.size })
            addLog('Questionnaire satisfaction entreprise généré')
          }
        } catch (e) {
          console.error('Erreur génération questionnaire satisfaction:', e)
          addLog('Erreur génération questionnaire satisfaction')
        }
      }

      setGeneratedFiles(files)
      setStep('compose')

    } catch (err) {
      console.error('Erreur génération documents:', err)
      setError('Erreur lors de la génération : ' + err.message)
      setGeneratedFiles(files)
      setStep('compose')
    }
  }

  const blobToBase64 = (blob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result.split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  // ── Vérification complétude émargement (100% requis) ──
  // Pour chaque (stagiaire × jour × demi-journée prévue) on vérifie qu'au moins une
  // signature existe dans les 3 sources : attendances, attendance_halfdays, document_signatures
  const checkAttendanceCompleteness = (sess, trainees, signatures, halfdays, digitalSigs) => {
    if (!sess?.start_date || !sess?.end_date || !trainees || trainees.length === 0) {
      return { isComplete: false, missing: 0, total: 0, reason: 'Pas de date ou stagiaire' }
    }
    const start = new Date(sess.start_date + 'T00:00:00')
    const end = new Date(sess.end_date + 'T00:00:00')
    const dayMs = 24 * 60 * 60 * 1000
    const daysCount = Math.round((end - start) / dayMs) + 1

    const isHalf = sess.day_type === 'half'
    const halfPeriod = isHalf && sess.start_time
      ? (parseInt(sess.start_time.split(':')[0], 10) >= 12 ? 'afternoon' : 'morning')
      : 'morning'

    // Construction de toutes les cellules attendues (stagiaire × jour × période)
    const expected = []
    for (let d = 0; d < daysCount; d++) {
      const date = new Date(start.getTime() + d * dayMs)
      const yyyy = date.getFullYear()
      const mm = String(date.getMonth() + 1).padStart(2, '0')
      const dd = String(date.getDate()).padStart(2, '0')
      const dateStr = `${yyyy}-${mm}-${dd}`
      for (const t of trainees) {
        if (!t.id) continue
        if (isHalf) {
          expected.push({ traineeId: t.id, date: dateStr, period: halfPeriod })
        } else {
          expected.push({ traineeId: t.id, date: dateStr, period: 'morning' })
          expected.push({ traineeId: t.id, date: dateStr, period: 'afternoon' })
        }
      }
    }

    // Pour chaque cellule attendue, vérifier qu'au moins une source confirme la présence
    const periodMap = { morning: 'am', afternoon: 'pm' }
    let missing = 0
    for (const cell of expected) {
      // 1) table attendances
      const sig = signatures.find(s =>
        s.trainee_id === cell.traineeId &&
        s.date === cell.date &&
        (s.period === periodMap[cell.period] || s.period === 'full')
      )
      if (sig) continue
      // 2) table attendance_halfdays
      const hd = halfdays.find(h => h.trainee_id === cell.traineeId && h.date === cell.date)
      if (hd) {
        const isPresent = cell.period === 'morning' ? hd.morning : hd.afternoon
        if (isPresent) continue
      }
      // 3) table document_signatures (signature globale stagiaire pour la session)
      // Note : ces signatures ne sont pas datées par demi-journée, on les accepte si elles
      // couvrent au moins le stagiaire pour la session (politique permissive)
      const ds = digitalSigs.find(d => d.trainee_id === cell.traineeId)
      if (ds) continue
      // Aucune source → cellule manquante
      missing++
    }

    return {
      isComplete: missing === 0,
      missing,
      total: expected.length,
      reason: missing === 0 ? 'OK' : `${missing}/${expected.length} demi-journées non signées`
    }
  }

  // ─── Mise à jour automatique checklist après envoi ───
  const updateChecklistItems = async (codes) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const now = new Date().toISOString()
      const today = now.split('T')[0]

      for (const code of codes) {
        const { data: existing } = await supabase
          .from('session_checklists')
          .select('id', 'is_checked')
          .eq('session_id', session.id)
          .eq('item_code', code)
          .maybeSingle()

        if (existing) {
          if (!existing.is_checked) {
            await supabase
              .from('session_checklists')
              .update({
                is_checked: true,
                checked_at: now,
                checked_by: user?.id,
                date_realized: today
              })
              .eq('id', existing.id)
          }
        } else {
          await supabase
            .from('session_checklists')
            .insert({
              session_id: session.id,
              item_code: code,
              is_checked: true,
              checked_at: now,
              checked_by: user?.id,
              date_realized: today
            })
        }
      }

      // Sync aussi les colonnes sur la table sessions (utilisées par le bloc "Suivi Convention")
      if (codes.includes('convention_envoyee')) {
        await supabase
          .from('sessions')
          .update({ convention_sent: true, convention_sent_date: now })
          .eq('id', session.id)
      }
    } catch (err) {
      console.error('Erreur mise à jour checklist:', err)
    }
  }

  // ─── Upload manuel supplémentaire ───
  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files)
    files.forEach(file => {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} est trop volumineux (max 10MB)`)
        return
      }
      const reader = new FileReader()
      reader.onload = (event) => {
        setUploadedFiles(prev => [...prev, {
          id: Date.now() + Math.random(),
          name: file.name,
          size: file.size,
          base64: event.target.result.split(',')[1]
        }])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const handleRemoveFile = (fileId, isGenerated) => {
    if (isGenerated) {
      setGeneratedFiles(prev => prev.filter(f => f.id !== fileId))
    } else {
      setUploadedFiles(prev => prev.filter(f => f.id !== fileId))
    }
  }

  // ─── Envoi test à soi-même (utilisateur connecté) ───
  const handleSendTest = async () => {
    if (!userEmail) {
      toast.error('Configurez votre email dans Paramètres pour utiliser le test')
      return
    }
    if (!emailSubject || !emailBody) {
      toast.error('Objet et corps obligatoires')
      return
    }
    const allFiles = [...generatedFiles, ...uploadedFiles].filter(f => !excludedFileIds.has(f.id))
    if (allFiles.length === 0) {
      toast.error('Aucun document à envoyer')
      return
    }
    if (compteRendu && !emailBody.includes(compteRendu)) {
      toast.error('Le compte rendu IA a été généré mais n\'a pas été ajouté au mail. Cliquez sur "+ Ajouter au mail" avant d\'envoyer.', { duration: 5000 })
      return
    }

    setSendingTest(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      // Upload des fichiers dans Storage (même flow que handleSend)
      const prefix = `${session.id}/test_${Date.now()}`
      const uploadedPaths = []
      const slugify = (name) => name
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .replace(/-+/g, '-')

      for (const file of allFiles) {
        const blob = file.arrayBuffer
          ? new Blob([file.arrayBuffer], { type: 'application/pdf' })
          : new Blob([Uint8Array.from(atob(file.base64), c => c.charCodeAt(0))], { type: 'application/pdf' })
        const safeFileName = slugify(file.name)
        const storagePath = `${prefix}/${safeFileName}`
        const { error: uploadError } = await supabase.storage
          .from('session-email-docs')
          .upload(storagePath, blob, { upsert: true })
        if (uploadError) throw new Error(`Erreur upload : ${file.name}`)
        uploadedPaths.push({ path: storagePath, filename: file.name })
      }

      // Envoi test : destinataire = userEmail, pas de tracking session_emails_sent
      const response = await apiFetch('/api/send-email-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          to: userEmail,
          subject: '[TEST] ' + emailSubject,
          body: ' Email de test envoyé à vous-même pour vérification du rendu.\n\n' + emailBody,
          attachmentPaths: uploadedPaths,
          sessionId: session.id,
          emailType: 'test'
        })
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || result.details)
      toast.success(`Test envoyé à ${userEmail}`)
    } catch (err) {
      console.error('Erreur envoi test:', err)
      toast.error('Erreur test : ' + err.message)
    } finally {
      setSendingTest(false)
    }
  }

  // ─── Toggle exclusion d'un fichier ───
  const toggleFileExclusion = (fileId) => {
    setExcludedFileIds(prev => {
      const next = new Set(prev)
      if (next.has(fileId)) next.delete(fileId)
      else next.add(fileId)
      return next
    })
  }

  // ─── Envoi ───
  const handleSend = async () => {
    if (!toEmail || !emailSubject || !emailBody) {
      toast.error('Email, objet et corps obligatoires')
      return
    }
    if (!userEmail) {
      toast.error('Configurez votre email dans Paramètres')
      return
    }

    // Avertir si un compte rendu IA a été généré mais pas encore inséré dans le corps du mail
    if (compteRendu && !emailBody.includes(compteRendu)) {
      toast.error('Le compte rendu IA a été généré mais n\'a pas été ajouté au mail. Cliquez sur "+ Ajouter au mail" avant d\'envoyer.', { duration: 5000 })
      return
    }

    // Filtrer les fichiers exclus via checkbox
    const allFiles = [...generatedFiles, ...uploadedFiles].filter(f => !excludedFileIds.has(f.id))
    if (allFiles.length === 0) {
      toast.error('Aucun document à envoyer (tous exclus ou absents)')
      return
    }

    setLoading(true)
    setStep('sending')

    try {
      const { data: { user } } = await supabase.auth.getUser()

      // 1) Upload chaque fichier dans Supabase Storage
      const prefix = `${session.id}/${Date.now()}`
      const uploadedPaths = []

      // Slugify pour le chemin storage (pas d'accents, espaces, apostrophes)
      const slugify = (name) => name
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accents → base
        .replace(/[^a-zA-Z0-9._-]/g, '-')                // caractères spéciaux → tiret
        .replace(/-+/g, '-')                              // tirets multiples → un seul

      for (const file of allFiles) {
        const blob = file.arrayBuffer
          ? new Blob([file.arrayBuffer], { type: 'application/pdf' })
          : new Blob([Uint8Array.from(atob(file.base64), c => c.charCodeAt(0))], { type: 'application/pdf' })
        const safeFileName = slugify(file.name)
        const storagePath = `${prefix}/${safeFileName}`

        const { error: uploadError } = await supabase.storage
          .from('session-email-docs')
          .upload(storagePath, blob, { upsert: true })

        if (uploadError) {
          console.error('Upload échoué pour', file.name, uploadError)
          throw new Error(`Erreur upload : ${file.name}`)
        }

        uploadedPaths.push({ path: storagePath, filename: file.name, fileId: file.id })
      }
      const convocationsStagiaires = emailType === 'before' && envoyerAuxStagiaires
        ? uploadedPaths.filter((u) => String(u.fileId).startsWith('convocation_'))
          .map((u) => ({ traineeId: String(u.fileId).slice('convocation_'.length), path: u.path }))
          .filter((c) => stagiairesAvecMail.some((st) => st.trainee_id === c.traineeId))
        : []

      // 2) Appeler l'API avec les chemins (léger)
      const response = await apiFetch('/api/send-email-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          to: toEmail,
          subject: emailSubject,
          body: emailBody,
          attachmentPaths: uploadedPaths.map(({ path, filename }) => ({ path, filename })),
          sessionId: session.id,
          emailType,
          convocationsStagiaires,
        })
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || result.details)

      // 3) Mise à jour automatique checklist
      const checklistCodes = emailType === 'before'
        ? ['convention_envoyee', 'convocations_envoyees']
        : ['certificats_envoyes']
      await updateChecklistItems(checklistCodes)
      // Convocations jointes et vraiment envoyées : « envoyée » noté ici seulement (plus au simple téléchargement, 21/10)
      if (emailType === 'before' && session?.id && generatedFiles.some((f) => String(f.id).startsWith('convocation_'))) {
        const ids = generatedFiles.filter((f) => String(f.id).startsWith('convocation_')).map((f) => String(f.id).slice('convocation_'.length))
        await supabase.from('session_trainees').update({ convocation_sent_at: new Date().toISOString() })
          .eq('session_id', session.id).in('trainee_id', ids).is('convocation_sent_at', null)
      }

      setStep('sent')
      const st = result.stagiaires
      if (st?.envoyes) toast.success(`Convocation envoyée aussi à ${st.envoyes} stagiaire${st.envoyes > 1 ? 's' : ''}`)
      if (st?.echecs?.length) toast.error(`Convocation non envoyée à : ${st.echecs.join(', ')}`, { duration: 8000 })
      toast.success('Email envoyé avec succès !')
      setTimeout(() => onClose(true), 2000)

    } catch (err) {
      console.error('Erreur envoi:', err)
      setError(err.message)
      toast.error('Erreur lors de l\'envoi : ' + err.message)
      setStep('compose')
    } finally {
      setLoading(false)
    }
  }

  // ─── Compte rendu : calcul + génération IA ───
  const Q_LABELS = {
    q_org_documents:          'Organisation - Documents préparés',
    q_org_accueil:            'Organisation - Accueil',
    q_org_locaux:             'Organisation - Locaux',
    q_org_materiel:           'Organisation - Matériel',
    q_contenu_organisation:   'Contenu - Organisation',
    q_contenu_supports:       'Contenu - Supports',
    q_contenu_duree:          'Contenu - Durée',
    q_contenu_programme:      'Contenu - Programme',
    q_formateur_pedagogie:    'Formateur - Pédagogie',
    q_formateur_expertise:    'Formateur - Expertise',
    q_formateur_progression:  'Formateur - Progression',
    q_formateur_moyens:       'Formateur - Moyens',
    q_global_adequation:      'Global - Adéquation',
    q_global_competences:     'Global - Compétences acquises',
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
    const tauxReco = withReco.length ? Math.round((withReco.filter(e => e.would_recommend === true).length / withReco.length) * 100) : null
    const TEST_WORDS = ['test', 'test123', 'aaa', 'bbb', 'ccc', 'xxx', 'asdf', 'qwerty', 'blah', 'ok', 'oui', 'non']
    const comments = evals.flatMap(e => [
      (e.comments || '').trim(),
      (e.comment_general || '').trim(),
      (e.comment_projet || '').trim()
    ]).filter(c => {
      if (c.length < 15) return false
      if (TEST_WORDS.includes(c.toLowerCase())) return false
      return true
    })
    return { scores, globalScore, tauxReco, comments, total: evals.length }
  }

  const generateCompteRendu = async () => {
    const evalData = computeEvalData()
    if (!evalData) return
    setCrGenerating(true)
    setCrError(null)

    const ref = session?.reference || ''
    const courseTitle = session?.courses?.title || ''
    const startDate = session?.start_date ? new Date(session.start_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
    const endDate = session?.end_date ? new Date(session.end_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
    const trainer = session?.trainers
    const formateur = trainer ? `${trainer.first_name} ${trainer.last_name}` : orgName()

    const scoresText = Q_KEYS
      .filter(k => evalData.scores[k] !== null)
      .map(k => `- ${Q_LABELS[k]} : ${evalData.scores[k]}/5`)
      .join('\n')

    const commentsText = evalData.comments.length
      ? evalData.comments.map((c, i) => `${i + 1}. « ${c} »`).join('\n')
      : 'Aucun commentaire libre.'

    const prompt = `Tu es l'assistant de l'organisme de formation ${orgName()}${orgCity() ? ` (${orgCity()})` : ''}.
Une session de formation s'est terminée. Voici les données d'évaluation à chaud remontées par les stagiaires :

Formation : ${courseTitle}
Référence : ${ref}
Dates : du ${startDate} au ${endDate}
Formateur : ${formateur}
Stagiaires ayant répondu : ${evalData.total} sur ${evalData.total}
Score moyen global : ${evalData.globalScore}/5
Taux de recommandation : ${evalData.tauxReco !== null ? evalData.tauxReco + '%' : 'non calculé'}

Scores détaillés par question :
${scoresText}

Commentaires libres des stagiaires :
${commentsText}

Écris un compte rendu professionnel et synthétique de cette session de formation.
Le compte rendu doit :
- Être écrit en première personne (« j'ai animé », « les stagiaires ont bien accueilli », etc.) comme si c'est le formateur lui-même qui écrivait
- Rester modeste : éviter les supérlatifs sur le formateur, ne pas se vanter
- Reprendre les points forts identifiés grâce aux scores (les dimensions avec les meilleurs résultats)
- Mentionner les points à améliorer si des scores sont nettement plus bas (< 3.5)
- Refléter la teneur des commentaires des stagiaires de façon naturelle, sans les citer mot pour mot
- Être concis et direct : entre 80 et 120 mots, pas de remplissage
- Ne pas mentionner les chiffres bruts sauf le score global et le taux de recommandation

Réponds uniquement avec le texte du compte rendu, sans titre ni introduction.`

    try {
      const response = await apiFetch('/api/generate-compte-rendu-formation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Erreur génération')
      setCompteRendu(data.text || '')
    } catch (e) {
      console.error('Erreur génération compte rendu:', e)
      setCrError('Erreur lors de la génération. Réessaie.')
    }
    setCrGenerating(false)
  }

  // ─── Calcul complétude pour le tableau de bord ───
  const computeCompleteness = () => {
    const trainees = session?.session_trainees || []
    const traineesCount = trainees.length

    // Émargement
    let emargement = { status: 'na', label: 'N/A' }
    if (emailType === 'after') {
      if (attendanceStatus === null) {
        emargement = { status: 'loading', label: 'Vérification…' }
      } else if (attendanceStatus.isComplete) {
        emargement = { status: 'ok', label: 'Complet (100% signé)' }
      } else if (attendanceStatus.total === 0) {
        emargement = { status: 'warn', label: 'Aucune donnée' }
      } else {
        const signedCount = attendanceStatus.total - attendanceStatus.missing
        emargement = { status: 'warn', label: `${signedCount}/${attendanceStatus.total} demi-journées signées` }
      }
    }

    // Signature formateur
    let signature = { status: 'na', label: 'N/A' }
    if (emailType === 'after') {
      if (trainerSignatureBase64) {
        signature = { status: 'ok', label: 'Signature en base' }
      } else if (trainerData && !trainerData.signature_url) {
        signature = { status: 'warn', label: 'Non renseignée - bouton "Signer" disponible' }
      } else {
        signature = { status: 'loading', label: 'Chargement…' }
      }
    }

    // Résultats stagiaires
    let results = { status: 'na', label: 'N/A' }
    if (emailType === 'after' && traineesCount > 0) {
      const withResult = trainees.filter(st => {
        const r = st.result || (traineeResults && traineeResults[st.trainee_id])
        return r !== null && r !== undefined && r !== ''
      }).length
      if (withResult === traineesCount) {
        results = { status: 'ok', label: `${withResult}/${traineesCount} renseignés` }
      } else {
        results = { status: 'warn', label: `${withResult}/${traineesCount} renseignés` }
      }
    }

    // Évaluations à chaud
    let evaluations = { status: 'na', label: 'N/A' }
    if (emailType === 'after' && evalsLoaded && traineesCount > 0) {
      const ev = evals.length
      if (ev === traineesCount) {
        evaluations = { status: 'ok', label: `${ev}/${traineesCount} complétées` }
      } else if (ev > 0) {
        evaluations = { status: 'warn', label: `${ev}/${traineesCount} complétées` }
      } else {
        evaluations = { status: 'warn', label: 'Aucune évaluation' }
      }
    }

    return { emargement, signature, results, evaluations }
  }

  // ─── Render ───
  const isBefore = emailType === 'before'
  const headerBg = isBefore ? 'bg-[rgb(var(--c-info))]' : 'bg-[rgb(var(--c-success))]'
  const btnBg = isBefore ? 'bg-[rgb(var(--c-info))] hover:bg-[rgb(var(--c-info))]' : 'bg-[rgb(var(--c-success))] hover:bg-[rgb(var(--c-success))]'
  const icon = isBefore ? '' : ''
  const title = isBefore ? 'Documents avant formation' : 'Documents après formation'

  const formatSize = (size) => {
    if (size > 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB'
    return (size / 1024).toFixed(0) + ' KB'
  }

  // Fichiers actifs (non exclus) et stats
  const allFilesNow = [...generatedFiles, ...uploadedFiles]
  const activeFiles = allFilesNow.filter(f => !excludedFileIds.has(f.id))
  const totalFiles = activeFiles.length
  const totalSize = activeFiles.reduce((sum, f) => sum + (f.size || 0), 0)

  // Indicateur statut → classes Tailwind
  const statusBadge = (status) => {
    if (status === 'ok') return { dot: 'bg-[rgb(var(--c-success))]', text: 'text-[rgb(var(--c-success))]', bg: 'bg-[rgb(var(--c-success-bg))]', border: 'border-[rgb(var(--c-success)/0.3)]' }
    if (status === 'warn') return { dot: 'bg-[rgb(var(--c-warning))]', text: 'text-[rgb(var(--c-warning))]', bg: 'bg-[rgb(var(--c-warning-bg))]', border: 'border-[rgb(var(--c-warning)/0.3)]' }
    if (status === 'loading') return { dot: 'bg-gray-400 animate-pulse', text: 'text-gray-500', bg: 'bg-gray-50', border: 'border-gray-200' }
    return { dot: 'bg-gray-300', text: 'text-gray-500', bg: 'bg-gray-50', border: 'border-gray-200' }
  }

  const completeness = computeCompleteness()
  const showSignButton = emailType === 'after' && trainerData && !trainerData.signature_url && !trainerSignatureBase64

  // Warnings d'envoi
  const computeWarnings = () => {
    const warns = []
    if (!toEmail) warns.push('Destinataire vide')
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) warns.push('Format email destinataire invalide')
    if (emailType === 'after' && !generatedFiles.find(f => f.id === 'certificats')) {
      warns.push('Aucun certificat dans les PJ (résultats stagiaires manquants ?)')
    }
    if (emailType === 'after' && completeness.emargement.status === 'warn' && attendanceStatus && attendanceStatus.total > 0) {
      warns.push(`Émargement incomplet - ${attendanceStatus.reason}`)
    }
    return warns
  }
  const sendWarnings = computeWarnings()

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-ui-sm max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-md">

        {/* Header */}
        <div className={`${headerBg} text-white p-4 flex items-center justify-between flex-shrink-0`}>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <span>{icon}</span> {title}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body - scrollable */}
        <div className="p-5 overflow-y-auto flex-1">

          {/* ── GÉNÉRATION EN COURS ── */}
          {step === 'generating' && (
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
              <Loader className="w-12 h-12 text-[rgb(var(--c-info))] animate-spin" />
              <p className="text-lg font-semibold text-gray-800">Génération des documents…</p>
              <div className="w-full max-w-sm bg-gray-50 rounded-ui-sm border border-gray-200 p-3 space-y-1">
                {generationLog.map((msg, i) => (
                  <p key={i} className={`text-ui ${/erreur|non trouv|impossible/i.test(msg) ? 'text-[rgb(var(--c-warning))]' : /(généré|récupéré|envoy|prêt|ok)/i.test(msg) ? 'text-[rgb(var(--c-success))]' : 'text-gray-500'}`}>
                    {msg}
                  </p>
                ))}
                {generationLog.length === 0 && <p className="text-ui text-gray-400 italic">En attente…</p>}
              </div>
            </div>
          )}

          {/* ── COMPOSITION ── */}
          {step === 'compose' && (
            <div className="space-y-4">

              {/* ═══ HISTORIQUE DES ENVOIS PRÉCÉDENTS ═══ */}
              {emailHistory.length > 0 && (
                <div className="border border-[rgb(var(--c-warning)/0.3)] bg-[rgb(var(--c-warning-bg))] rounded-ui-sm overflow-hidden">
                  <button
                    onClick={() => setHistoryExpanded(v => !v)}
                    className="w-full px-3 py-2 flex items-center justify-between hover:bg-[rgb(var(--c-warning-bg))] transition-colors"
                  >
                    <div className="flex items-center gap-2 text-ui text-[rgb(var(--c-warning))]">
                      <History className="w-4 h-4" />
                      <span className="font-semibold">
                         Déjà envoyé {emailHistory.length} fois pour cette session
                      </span>
                    </div>
                    <span className="text-ui-sm text-[rgb(var(--c-warning))]">
                      {historyExpanded ? 'Masquer' : 'Voir détails'}
                    </span>
                  </button>
                  {historyExpanded && (
                    <div className="px-3 pb-3 space-y-1.5 border-t border-[rgb(var(--c-warning)/0.3)] pt-2">
                      {emailHistory.map(h => (
                        <div key={h.id} className="text-ui-sm text-[rgb(var(--c-warning))] bg-white rounded px-2 py-1.5 border border-[rgb(var(--c-warning)/0.3)]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium truncate">{h.to_email}</span>
                            <span className="text-[rgb(var(--c-warning))] flex-shrink-0">
                              {new Date(h.created_at).toLocaleString('fr-FR', {
                                day: '2-digit', month: '2-digit', year: 'numeric',
                                hour: '2-digit', minute: '2-digit'
                              })}
                            </span>
                          </div>
                          <div className="text-[rgb(var(--c-warning))] truncate mt-0.5">{h.subject}</div>
                          {Array.isArray(h.attachments) && (
                            <div className="text-[rgb(var(--c-warning))] mt-0.5">{h.attachments.length} pièce(s) jointe(s)</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ═══ TABLEAU DE BORD COMPLÉTUDE (uniquement after) ═══ */}
              {emailType === 'after' && (
                <div className="border border-gray-200 rounded-ui-sm overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                    <p className="text-ui-sm font-semibold text-gray-700 uppercase tracking-wide">
                       Tableau de bord complétude
                    </p>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {[
                      { key: 'emargement', label: 'Émargement', data: completeness.emargement },
                      { key: 'signature', label: 'Signature formateur', data: completeness.signature },
                      { key: 'results', label: 'Résultats stagiaires', data: completeness.results },
                      { key: 'evaluations', label: 'Évaluations à chaud', data: completeness.evaluations },
                    ].map(row => {
                      const b = statusBadge(row.data.status)
                      return (
                        <div key={row.key} className="px-3 py-2 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${b.dot}`} />
                            <span className="text-ui text-gray-800 truncate">{row.label}</span>
                          </div>
                          <span className={`text-ui-sm ${b.text} flex-shrink-0`}>{row.data.label}</span>
                        </div>
                      )
                    })}
                  </div>
                  {showSignButton && (
                    <div className="px-3 py-2 bg-[rgb(var(--c-info-bg))] border-t border-[rgb(var(--c-info)/0.3)] flex items-center justify-between gap-2">
                      <p className="text-ui-sm text-[rgb(var(--c-info))]">
                        Pas de signature formateur en base.
                      </p>
                      <button
                        onClick={() => setShowSignaturePad(true)}
                        className="flex items-center gap-1.5 btn btn-secondary text-ui-sm font-semibold rounded hover:bg-[rgb(var(--c-info))]"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Signer maintenant
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Destinataire */}
              <div>
                <label className="block text-ui font-medium text-gray-700 mb-1">Destinataire</label>
                <input
                  type="email"
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm text-ui"
                  placeholder="email@exemple.fr"
                />
                {emailType === 'before' && (stagiairesAvecMail.length > 0 ? (
                  <label className="mt-2 flex items-start gap-2 text-ui-sm text-gray-700">
                    <input type="checkbox" className="mt-0.5 rounded" checked={envoyerAuxStagiaires} onChange={(e) => setEnvoyerAuxStagiaires(e.target.checked)} />
                    <span>Envoyer aussi à chaque stagiaire sa propre convocation, dans un message à part ({stagiairesAvecMail.length} avec e-mail : {stagiairesAvecMail.map((st) => `${st.trainees?.first_name || ''} ${(st.trainees?.last_name || '').toUpperCase()}`.trim()).join(', ')}).</span>
                  </label>
                ) : (session?.session_trainees || []).length > 0 && (
                  <p className="mt-2 text-ui-sm text-gray-500">Aucun stagiaire n'a d'e-mail : seule l'entreprise reçoit les convocations.</p>
                ))}
              </div>

              {/* Objet */}
              <div>
                <label className="block text-ui font-medium text-gray-700 mb-1">Objet</label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm text-ui"
                />
              </div>

              {/* Corps */}
              <div>
                <label className="block text-ui font-medium text-gray-700 mb-1">Message</label>
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm text-ui resize-none"
                />
              </div>

              {/* Compte rendu post-formation - uniquement « après formation » */}
              {!isBefore && evalsLoaded && (() => {
                const evalData = computeEvalData()
                return (
                  <div className="border border-gray-200 rounded-ui-sm overflow-hidden">
                    {/* Header */}
                    <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-ui font-semibold text-gray-800"> Compte rendu de formation</p>
                        <p className="text-ui-sm text-gray-800 mt-0.5">
                          {evals.length > 0
                            ? `${evals.length} stagiaire${evals.length > 1 ? 's' : ''} - Score moyen : ${evalData?.globalScore || '-'}/5 - Recommandation : ${evalData?.tauxReco !== null ? evalData.tauxReco + '%' : '-'}`
                            : 'Aucune évaluation à chaud pour cette session'
                          }
                        </p>
                      </div>
                      {evals.length > 0 && (
                        <button
                          onClick={generateCompteRendu}
                          disabled={crGenerating}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 text-white text-ui-sm font-semibold rounded-ui-sm hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {crGenerating ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <span></span>}
                          {crGenerating ? 'Génération…' : (compteRendu ? 'Regénérer' : "Générer avec l'IA")}
                        </button>
                      )}
                    </div>

                    {/* Erreur */}
                    {crError && (
                      <div className="mx-4 mt-3 px-3 py-2 bg-[rgb(var(--c-danger-bg))] border border-[rgb(var(--c-danger)/0.3)] rounded text-ui-sm text-[rgb(var(--c-danger))]">
                        {crError}
                      </div>
                    )}

                    {/* Commentaires verbatim */}
                    {evals.length > 0 && evalData?.comments.length > 0 && (
                      <div className="px-4 pt-3">
                        <p className="text-ui-sm font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Commentaires des stagiaires</p>
                        <div className="space-y-1.5">
                          {evalData.comments.map((c, i) => (
                            <p key={i} className="text-ui-sm text-gray-600 italic bg-gray-50 border border-gray-200 rounded px-3 py-2">
                              « {c} »
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Texte généré - éditable */}
                    {compteRendu && (
                      <div className="px-4 py-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-ui-sm font-semibold text-gray-500 uppercase tracking-wide">Texte généré</p>
                          <button
                            onClick={() => {
                              setEmailBody(prev => prev + '\n\n--- Compte rendu de la formation ---\n' + compteRendu)
                              toast.success('Compte rendu ajouté au corps du mail')
                            }}
                            className="text-ui-sm text-gray-800 hover:text-gray-800 font-medium underline"
                          >
                            + Ajouter au mail
                          </button>
                        </div>
                        <textarea
                          value={compteRendu}
                          onChange={e => setCompteRendu(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-200 rounded-ui-sm text-ui text-gray-800 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-gray-200"
                          rows={Math.max(3, compteRendu.split('\n').length + 1)}
                        />
                      </div>
                    )}

                    {/* Pas d'évals */}
                    {evals.length === 0 && (
                      <p className="px-4 py-3 text-ui-sm text-gray-500 italic">
                        Les évaluations à chaud ne sont pas encore disponibles pour cette session.
                      </p>
                    )}
                  </div>
                )
              })()}

              {/* Documents générés */}
              {generatedFiles.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-ui font-medium text-gray-700">
                       Documents générés ({generatedFiles.length - generatedFiles.filter(f => excludedFileIds.has(f.id)).length}/{generatedFiles.length})
                    </p>
                    <p className="text-ui-sm text-gray-500">
                      Total : {formatSize(activeFiles.reduce((s, f) => s + (f.size || 0), 0))}
                    </p>
                  </div>
                  <div className="bg-[rgb(var(--c-success-bg))] border border-[rgb(var(--c-success)/0.3)] rounded-ui-sm divide-y divide-[rgb(var(--c-success)/0.3)]">
                    {generatedFiles.map(file => {
                      const isExcluded = excludedFileIds.has(file.id)
                      return (
                        <div
                          key={file.id}
                          className={`flex items-center justify-between px-3 py-2 ${isExcluded ? 'opacity-50' : ''}`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={() => toggleFileExclusion(file.id)}
                              className="w-4 h-4 rounded border-gray-300 text-[rgb(var(--c-success))] focus:ring-[rgb(var(--c-success)/0.3)] flex-shrink-0"
                              title={isExcluded ? 'Inclure dans l\'envoi' : 'Exclure de l\'envoi'}
                            />
                            <CheckCircle className="w-4 h-4 text-[rgb(var(--c-success))] flex-shrink-0" />
                            <span className={`text-ui text-gray-800 truncate ${isExcluded ? 'line-through' : ''}`}>
                              {file.name}
                            </span>
                            <span className="text-ui-sm text-gray-400 flex-shrink-0">{formatSize(file.size)}</span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => setPreviewFile(file)}
                              className="p-1 hover:bg-[rgb(var(--c-success-bg))] rounded text-gray-600 hover:text-[rgb(var(--c-success))]"
                              title="Aperçu"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleRemoveFile(file.id, true)}
                              className="p-1 hover:bg-[rgb(var(--c-success-bg))] rounded"
                              title="Supprimer"
                            >
                              <Trash2 className="w-4 h-4 text-[rgb(var(--c-danger))]" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Avertissement programme manquant */}
              {isBefore && generatedFiles.every(f => f.id !== 'programme') && (
                <div className="bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] rounded-ui-sm px-3 py-2 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-[rgb(var(--c-warning))] flex-shrink-0 mt-0.5" />
                  <p className="text-ui-sm text-[rgb(var(--c-warning))]">
                    Le programme n'a pas été trouvé dans <strong>Documents de formation</strong>. 
                    Uploadez-le manuellement ci-dessous ou dans la page du cours.
                  </p>
                </div>
              )}

              {/* Upload supplémentaire */}
              <div>
                <label className="block text-ui font-medium text-gray-700 mb-2">
                  Ajouter des fichiers supplémentaires
                </label>
                <label className="flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-ui-sm p-3 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-colors">
                  <Upload className="w-5 h-5 text-gray-400" />
                  <span className="text-ui text-gray-500">Choisir des fichiers</span>
                  <input
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                  />
                </label>

                {uploadedFiles.length > 0 && (
                  <div className="mt-2 bg-gray-50 border border-gray-200 rounded-ui-sm divide-y divide-gray-200">
                    {uploadedFiles.map(file => {
                      const isExcluded = excludedFileIds.has(file.id)
                      const isPdf = file.name && file.name.toLowerCase().endsWith('.pdf')
                      return (
                        <div
                          key={file.id}
                          className={`flex items-center justify-between px-3 py-2 ${isExcluded ? 'opacity-50' : ''}`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={() => toggleFileExclusion(file.id)}
                              className="w-4 h-4 rounded border-gray-300 text-[rgb(var(--c-info))] focus:ring-[rgb(var(--c-info)/0.3)] flex-shrink-0"
                            />
                            <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <span className={`text-ui text-gray-800 truncate ${isExcluded ? 'line-through' : ''}`}>
                              {file.name}
                            </span>
                            <span className="text-ui-sm text-gray-400 flex-shrink-0">{formatSize(file.size)}</span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {isPdf && (
                              <button
                                onClick={() => setPreviewFile(file)}
                                className="p-1 hover:bg-gray-200 rounded text-gray-600 hover:text-[rgb(var(--c-info))]"
                                title="Aperçu"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleRemoveFile(file.id, false)}
                              className="p-1 hover:bg-gray-200 rounded"
                              title="Supprimer"
                            >
                              <Trash2 className="w-4 h-4 text-[rgb(var(--c-danger))]" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Warnings de complétude (bonus) */}
              {sendWarnings.length > 0 && (
                <div className="bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] rounded-ui-sm px-3 py-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-[rgb(var(--c-warning))] flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-ui-sm font-semibold text-[rgb(var(--c-warning))] mb-1">Vérifications avant envoi</p>
                      <ul className="text-ui-sm text-[rgb(var(--c-warning))] space-y-0.5 list-disc list-inside">
                        {sendWarnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Erreur */}
              {error && (
                <div className="bg-[rgb(var(--c-danger-bg))] border border-[rgb(var(--c-danger)/0.3)] rounded-ui-sm px-3 py-2 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-[rgb(var(--c-danger))] flex-shrink-0 mt-0.5" />
                  <p className="text-ui-sm text-[rgb(var(--c-danger))]">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* ── ENVOI EN COURS ── */}
          {step === 'sending' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <Loader className="w-10 h-10 text-[rgb(var(--c-info))] animate-spin" />
              <p className="text-gray-600">Envoi de l'email avec {totalFiles} document(s)…</p>
            </div>
          )}

          {/* ── ENVOYÉ ── */}
          {step === 'sent' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-2">
              <CheckCircle className="w-14 h-14 text-[rgb(var(--c-success))]" />
              <p className="text-lg font-semibold text-gray-900">Email envoyé !</p>
              <p className="text-ui text-gray-500">Il apparaîtra dans vos messages envoyés.</p>
            </div>
          )}
        </div>

        {/* Footer - boutons fixes en bas */}
        {step === 'compose' && (
          <div className="px-5 py-3 border-t bg-gray-50 flex items-center justify-between gap-3 flex-shrink-0">
            <button
              onClick={handleSendTest}
              disabled={sendingTest || totalFiles === 0 || !userEmail}
              className="flex items-center gap-1.5 px-3 py-2 border border-[rgb(var(--c-info)/0.3)] text-[rgb(var(--c-info))] bg-white rounded-ui-sm text-ui hover:bg-[rgb(var(--c-info-bg))] disabled:opacity-40 disabled:cursor-not-allowed"
              title={userEmail ? `Envoyer un test à ${userEmail}` : 'Configurez votre email dans Paramètres'}
            >
              {sendingTest ? <Loader className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Test à moi
            </button>
            <div className="flex gap-3">
              <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-ui-sm text-ui hover:bg-gray-100">
                Annuler
              </button>
              <button
                onClick={handleSend}
                disabled={totalFiles === 0}
                className={`${btnBg} text-white px-5 py-2 rounded-ui-sm text-ui font-medium flex items-center gap-2 disabled:opacity-40`}
              >
                <Send className="w-4 h-4" />
                Envoyer · {totalFiles} doc{totalFiles !== 1 ? 's' : ''}
                {totalSize > 0 && <span className="text-ui-sm opacity-75">({formatSize(totalSize)})</span>}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ MODAL APERÇU PDF ═══ */}
      {previewFile && (
        <div className="fixed inset-0 bg-black/70 z-[55] flex items-center justify-center p-4">
          <div className="bg-white rounded-ui-sm w-full max-w-5xl h-[90vh] flex flex-col shadow-md">
            <div className="px-4 py-3 border-b flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <span className="text-ui font-medium text-gray-800 truncate">{previewFile.name}</span>
                <span className="text-ui-sm text-gray-400 flex-shrink-0">{formatSize(previewFile.size)}</span>
              </div>
              <button
                onClick={() => setPreviewFile(null)}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <iframe
              src={`data:application/pdf;base64,${previewFile.base64}`}
              className="flex-1 w-full border-0 rounded-b-lg"
              title={previewFile.name}
            />
          </div>
        </div>
      )}

      {/* ═══ MINI SIGNATURE PAD (formateur) ═══ */}
      {showSignaturePad && (
        savingSignature ? (
          <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center">
            <div className="bg-white rounded-ui-sm px-6 py-4 flex items-center gap-3">
              <Loader className="w-5 h-5 animate-spin text-[rgb(var(--c-info))]" />
              <span className="text-ui text-gray-700">Enregistrement de la signature…</span>
            </div>
          </div>
        ) : (
          <MiniSignaturePad
            onValidate={handleSaveSignature}
            onCancel={() => setShowSignaturePad(false)}
          />
        )
      )}
    </div>
  )
}

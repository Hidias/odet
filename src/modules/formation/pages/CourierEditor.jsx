import { apiFetch } from '../../../core/api'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useDataStore } from '../../../core/store'
import { 
  Sparkles, Download, RefreshCw, FileText, Send, 
  Minus, Plus, Eye, Save, Loader2, Wand2, ArrowRight, Mic, MicOff
} from 'lucide-react'
import toast from 'react-hot-toast'
import { buildCourierPDF } from '../pdf/courierPDF'
import { supabase } from '../../../core/supabase'
import { buildORG } from '../../../core/org/orgUtils'

const DOC_TYPES = [
  { id: 'attestation', label: 'Attestation libre', description: "Attestation officielle de l'organisme" },
  { id: 'note_interne', label: 'Note interne', description: 'Note de service ou compte-rendu' },
  { id: 'courrier', label: 'Courrier', description: 'Courrier officiel avec en-tête' },
]

export default function CourierEditor() {
  const { organization } = useDataStore()
  // Identité de l'organisme : uniquement depuis organization_settings (aucun repli)
  const base = buildORG(organization || {})
  const org = { ...(organization || {}), ...base, dirigeant: base.dirigeant }
  
  const [docType, setDocType] = useState('courrier')
  const [destinataire, setDestinataire] = useState('')
  const [objet, setObjet] = useState('')
  const [lieu, setLieu] = useState('')
  const [docDate, setDocDate] = useState(new Date().toISOString().split('T')[0])
  const [body, setBody] = useState('')
  const [signataire, setSignataire] = useState('')
  const [context, setContext] = useState('')

  useEffect(() => {
    if (!lieu && base.lieu_signature) setLieu(base.lieu_signature)
    if (!signataire && base.dirigeant) setSignataire([base.dirigeant, base.dirigeant_title].filter(Boolean).join(' - '))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization])
  
  const [generating, setGenerating] = useState(false)
  const [generatingAction, setGeneratingAction] = useState(null)
  const [pdfUrl, setPdfUrl] = useState(null)
  const [saving, setSaving] = useState(false)
  const [listening, setListening] = useState(false)
  
  const previewTimeout = useRef(null)
  const recognitionRef = useRef(null)

  // Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.lang = 'fr-FR'
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event) => {
      let finalTranscript = ''
      let interimTranscript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscript += transcript
        } else {
          interimTranscript = transcript
        }
      }
      if (finalTranscript) {
        setBody(prev => prev + (prev && !prev.endsWith('\n') && !prev.endsWith(' ') ? ' ' : '') + finalTranscript)
      }
    }

    recognition.onerror = (event) => {
      console.error('Speech error:', event.error)
      setListening(false)
      if (event.error === 'not-allowed') {
        toast.error('Autorisez l\'accès au micro dans votre navigateur')
      }
    }

    recognition.onend = () => {
      if (listening) {
        try { recognition.start() } catch {}
      } else {
        setListening(false)
      }
    }

    recognitionRef.current = recognition
    return () => { try { recognition.stop() } catch {} }
  }, [listening])

  function toggleMic() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast.error('Votre navigateur ne supporte pas la dictée vocale')
      return
    }
    if (listening) {
      setListening(false)
      try { recognitionRef.current?.stop() } catch {}
    } else {
      setListening(true)
      try { recognitionRef.current?.start() } catch {}
    }
  }

  // Générer l'aperçu PDF avec debounce
  useEffect(() => {
    if (previewTimeout.current) clearTimeout(previewTimeout.current)
    previewTimeout.current = setTimeout(() => {
      generatePreview()
    }, 500)
    return () => clearTimeout(previewTimeout.current)
  }, [docType, destinataire, objet, lieu, docDate, body, signataire])

  function buildPDF() {
    return buildCourierPDF(org, { docType, destinataire, objet, lieu, docDate, body, signataire })
  }

  function generatePreview() {
    try {
      const doc = buildPDF()
      const blob = doc.output('blob')
      const url = URL.createObjectURL(blob)
      
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
      setPdfUrl(url)
    } catch (err) {
      console.error('Erreur aperçu PDF:', err)
    }
  }

  // IA : générer / reformuler / raccourcir / allonger
  async function handleAI(action) {
    setGenerating(true)
    setGeneratingAction(action)
    try {
      const res = await apiFetch('/api/generate-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          docType,
          destinataire,
          objet,
          context,
          currentText: body,
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')

      setBody(data.text)
      toast.success(
        action === 'generate' ? ' Texte généré' :
        action === 'reformulate' ? ' Texte reformulé' :
        action === 'shorter' ? ' Texte raccourci' :
        ' Texte enrichi'
      )
    } catch (err) {
      console.error('Erreur IA:', err)
      toast.error('Erreur : ' + err.message)
    } finally {
      setGenerating(false)
      setGeneratingAction(null)
    }
  }

  // Télécharger le PDF
  function handleDownload() {
    try {
      const doc = buildPDF()
      const dateStr = docDate ? docDate.replace(/-/g, '') : 'undated'
      const typeStr = docType === 'attestation' ? 'Attestation' : docType === 'note_interne' ? 'Note_interne' : 'Courrier'
      doc.save(typeStr + '_' + (org.name || 'document').replace(/[^a-zA-Z0-9]+/g, '_') + '_' + dateStr + '.pdf')
      toast.success('PDF téléchargé')
    } catch (err) {
      console.error('Erreur download:', err)
      toast.error('Erreur lors du téléchargement')
    }
  }

  // Sauvegarder dans Documents uploadés
  async function handleSave() {
    if (!body.trim()) {
      toast.error('Le document est vide')
      return
    }
    setSaving(true)
    try {
      const dateStr = docDate ? docDate.replace(/-/g, '') : 'undated'
      const typeStr = docType === 'attestation' ? 'Attestation' : docType === 'note_interne' ? 'Note_interne' : 'Courrier'
      const fileName = typeStr + '_' + (org.name || 'document').replace(/[^a-zA-Z0-9]+/g, '_') + '_' + dateStr + '.pdf'

      // Générer le blob directement depuis le PDF actuel
      // On regenere pour obtenir un blob frais (pdfUrl blob peut être expiré)
      const pdfDoc = buildPDF()
      const blob = pdfDoc.output('blob')
      
      // Upload vers Supabase Storage
      const storagePath = 'courriers/' + Date.now() + '_' + fileName
      console.log('Upload path:', storagePath, 'Blob size:', blob.size)
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, blob, { contentType: 'application/pdf', upsert: true })

      if (uploadError) {
        console.error('Upload error details:', uploadError)
        throw uploadError
      }

      // Enregistrer dans la table uploaded_files
      const { data: publicUrl } = supabase.storage.from('documents').getPublicUrl(uploadData.path)

      const { error: dbError } = await supabase
        .from('uploaded_files')
        .insert({
          name: (objet || typeStr).substring(0, 100),
          filename: fileName,
          file_path: uploadData.path,
          file_url: publicUrl.publicUrl,
          mime_type: 'application/pdf',
          file_size: blob.size,
          category: docType === 'attestation' ? 'attestation' : 'autre',
          notes: 'Créé depuis l\'éditeur de courriers',
        })

      if (dbError) throw dbError

      toast.success('Document sauvegardé dans vos fichiers')
    } catch (err) {
      console.error('Erreur sauvegarde:', err)
      toast.error('Erreur : ' + (err.message || 'Échec sauvegarde'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-280px)] min-h-[600px]">
      {/* Colonne gauche : formulaire */}
      <div className="w-1/2 space-y-4 overflow-y-auto pr-2">
        
        {/* Type de document */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Type de document</label>
          <div className="grid grid-cols-3 gap-2">
            {DOC_TYPES.map(t => (
              <button key={t.id} onClick={() => setDocType(t.id)}
                className={'px-3 py-2 rounded-lg border text-sm text-center transition-colors ' +
                  (docType === t.id ? 'bg-primary-50 border-primary-300 text-primary-700 font-medium' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Destinataire */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Destinataire</label>
          <textarea value={destinataire} onChange={(e) => setDestinataire(e.target.value)}
            placeholder={"M. / Mme ...\nEntreprise\nAdresse"}
            rows="3" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none" />
        </div>

        {/* Date et Lieu */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lieu</label>
            <input type="text" value={lieu} onChange={(e) => setLieu(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
          </div>
        </div>

        {/* Objet */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Objet</label>
          <input type="text" value={objet} onChange={(e) => setObjet(e.target.value)}
            placeholder={docType === 'attestation' ? "Attestation de formation SST" : "Objet du courrier..."}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
        </div>

        {/* Contexte IA (optionnel) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <Sparkles className="w-3.5 h-3.5 inline mr-1 text-amber-500" />
            Contexte pour l'IA <span className="text-gray-400 font-normal">(optionnel)</span>
          </label>
          <input type="text" value={context} onChange={(e) => setContext(e.target.value)}
            placeholder="Ex: Formation SST de 14h pour 8 salariés de l'entreprise X..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-amber-50 focus:ring-2 focus:ring-amber-300 focus:border-transparent" />
        </div>

        {/* Corps du document */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700">Corps du document</label>
            <div className="flex gap-1">
              <button onClick={() => handleAI('generate')} disabled={generating || !objet}
                title="Générer le texte avec l'IA"
                className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-md text-xs font-medium flex items-center gap-1 disabled:opacity-40 transition-colors">
                {generatingAction === 'generate' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Générer
              </button>
              <button onClick={() => handleAI('reformulate')} disabled={generating || !body}
                title="Reformuler le texte"
                className="px-2.5 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-md text-xs font-medium flex items-center gap-1 disabled:opacity-40 transition-colors">
                {generatingAction === 'reformulate' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                Reformuler
              </button>
              <button onClick={() => handleAI('shorter')} disabled={generating || !body}
                title="Raccourcir"
                className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md text-xs disabled:opacity-40 transition-colors">
                {generatingAction === 'shorter' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Minus className="w-3 h-3" />}
              </button>
              <button onClick={() => handleAI('longer')} disabled={generating || !body}
                title="Enrichir"
                className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md text-xs disabled:opacity-40 transition-colors">
                {generatingAction === 'longer' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              </button>
              <div className="w-px h-5 bg-gray-300 mx-1" />
              <button onClick={toggleMic}
                title={listening ? 'Arrêter la dictée' : 'Dicter (micro)'}
                className={'px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-colors ' +
                  (listening ? 'bg-red-100 text-red-600 animate-pulse hover:bg-red-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-600')}>
                {listening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                {listening ? 'Stop' : 'Dicter'}
              </button>
            </div>
          </div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Rédigez votre texte ici ou utilisez le bouton  Générer pour que l'IA vous propose un brouillon..."
            rows="10" className={'w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y leading-relaxed ' +
              (listening ? 'border-red-400 ring-2 ring-red-200 bg-red-50/30' : 'border-gray-300')} />
          {listening && (
            <div className="flex items-center gap-2 text-xs text-red-600 mt-1">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              Dictée en cours... parlez maintenant
            </div>
          )}
        </div>

        {/* Signataire */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Signataire</label>
          <input type="text" value={signataire} onChange={(e) => setSignataire(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
        </div>

        {/* Actions */}
        <div className="flex gap-3 pb-4">
          <button onClick={handleDownload} disabled={!body.trim()}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 font-medium text-sm transition-colors">
            <Download className="w-4 h-4" /> Télécharger PDF
          </button>
          <button onClick={handleSave} disabled={!body.trim() || saving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 font-medium text-sm transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Sauvegarder
          </button>
        </div>
      </div>

      {/* Colonne droite : aperçu PDF en direct */}
      <div className="w-1/2 bg-gray-100 rounded-xl border border-gray-200 overflow-hidden flex flex-col">
        <div className="bg-gray-200 px-4 py-2 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Eye className="w-4 h-4" /> Aperçu en direct
          </span>
          <span className="text-xs text-gray-500">Mise à jour automatique</span>
        </div>
        <div className="flex-1">
          {pdfUrl ? (
            <iframe src={pdfUrl} className="w-full h-full border-0" title="Aperçu PDF" />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              <div className="text-center">
                <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Commencez à rédiger pour voir l'aperçu</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

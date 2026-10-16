// ═══════════════════════════════════════════════════════════════
// RelancePreviewModal.jsx - Preview et édition email relance IA
// Affiche le brouillon IA, permet d'éditer avant envoi
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react'
import { X, Send, Edit2, Loader2, Sparkles, AlertTriangle } from 'lucide-react'

export default function RelancePreviewModal({ previewData, onConfirm, onCancel, sending }) {
  if (!previewData) return null

  const { quote, clientEmail, subject, body, tone, relanceNum, isFallback } = previewData
  const [editMode, setEditMode] = useState(false)
  const [editSubject, setEditSubject] = useState(subject)
  const [editBody, setEditBody] = useState(body)

  const toneLabels = { courtois: ' Courtois', direct: ' Direct', ferme: ' Ferme' }
  const relanceLabel = relanceNum === 1 ? '1ère relance' : relanceNum === 2 ? '2ème relance' : '3ème relance'

  const handleSend = () => {
    onConfirm(editMode ? editSubject : subject, editMode ? editBody : body)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-ui shadow-md max-w-2xl w-full max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="bg-gray-50 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Sparkles className="w-4 h-4" />
            <span className="font-semibold text-ui">Relance IA - {relanceLabel}</span>
            {isFallback && (
              <span className="text-ui-sm bg-[rgb(var(--c-warning))] text-[rgb(var(--c-warning))] px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Fallback (IA indisponible)
              </span>
            )}
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-white/20 rounded-ui-sm transition-colors">
            <X className="w-4 h-4 text-white" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(90vh-120px)]">

          {/* Infos contexte */}
          <div className="flex flex-wrap gap-3 text-ui-sm">
            <div className="px-2 py-1 bg-gray-100 rounded-full">
              <span className="text-gray-500">Client:</span> <span className="font-semibold">{quote.clients?.name}</span>
            </div>
            <div className="px-2 py-1 bg-gray-100 rounded-full">
              <span className="text-gray-500">Devis:</span> <span className="font-semibold">{quote.reference}</span>
            </div>
            <div className="px-2 py-1 bg-gray-100 rounded-full">
              <span className="text-gray-500">Montant:</span> <span className="font-semibold">{parseFloat(quote.total_ht).toLocaleString('fr')}€ HT</span>
            </div>
            <div className="px-2 py-1 bg-gray-100 rounded-full">
              <span className="text-gray-500">À:</span> <span className="font-semibold">{clientEmail}</span>
            </div>
            {tone && <div className="px-2 py-1 bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))] rounded-full font-medium">{toneLabels[tone] || tone}</div>}
          </div>

          {/* Objet */}
          <div>
            <label className="text-ui-sm font-semibold text-gray-500 mb-1 block">Objet</label>
            {editMode ? (
              <input
                type="text"
                value={editSubject}
                onChange={e => setEditSubject(e.target.value)}
                className="w-full border rounded-ui-sm px-3 py-2 text-ui focus:ring-2 focus:ring-[rgb(var(--c-info)/0.3)] outline-none"
              />
            ) : (
              <div className="bg-gray-50 rounded-ui-sm px-3 py-2 text-ui font-medium">{subject}</div>
            )}
          </div>

          {/* Corps de l'email */}
          <div>
            <label className="text-ui-sm font-semibold text-gray-500 mb-1 block">Corps de l'email</label>
            {editMode ? (
              <textarea
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                rows={8}
                className="w-full border rounded-ui-sm px-3 py-2 text-ui focus:ring-2 focus:ring-[rgb(var(--c-info)/0.3)] outline-none resize-none leading-relaxed"
              />
            ) : (
              <div className="bg-gray-50 rounded-ui-sm px-4 py-3 text-ui whitespace-pre-line leading-relaxed">
                {body}
              </div>
            )}
          </div>

          {/* Note signature */}
          <p className="text-ui-sm text-gray-400 italic">
            La signature email sera ajoutée automatiquement à l'envoi (depuis votre compte email).
          </p>
        </div>

        {/* Actions */}
        <div className="border-t px-5 py-3 flex items-center justify-between bg-gray-50">
          <button
            onClick={() => {
              if (!editMode) {
                setEditSubject(subject)
                setEditBody(body)
              }
              setEditMode(!editMode)
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-ui-sm font-medium text-gray-600 hover:bg-gray-200 rounded-ui-sm transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
            {editMode ? 'Aperçu' : 'Modifier'}
          </button>

          <div className="flex gap-2">
            <button onClick={onCancel} disabled={sending}
              className="px-4 py-2 text-ui border rounded-ui-sm hover:bg-gray-100 font-medium text-gray-600 transition-colors">
              Annuler
            </button>
            <button onClick={handleSend} disabled={sending}
              className="px-4 py-2 text-ui bg-[rgb(var(--c-info))] text-white rounded-ui-sm hover:bg-[rgb(var(--c-info))] font-medium shadow-sm flex items-center gap-2 disabled:opacity-50 transition-colors">
              {sending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Envoi...</>
              ) : (
                <><Send className="w-4 h-4" /> Envoyer la relance</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

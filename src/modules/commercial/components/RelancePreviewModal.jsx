// ═══════════════════════════════════════════════════════════════
// RelancePreviewModal.jsx — Preview et édition email relance IA
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

  const toneLabels = { courtois: '🤝 Courtois', direct: '📌 Direct', ferme: '⚡ Ferme' }
  const relanceLabel = relanceNum === 1 ? '1ère relance' : relanceNum === 2 ? '2ème relance' : '3ème relance'

  const handleSend = () => {
    onConfirm(editMode ? editSubject : subject, editMode ? editBody : body)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Sparkles className="w-4 h-4" />
            <span className="font-semibold text-sm">Relance IA — {relanceLabel}</span>
            {isFallback && (
              <span className="text-xs bg-yellow-400 text-yellow-900 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Fallback (IA indisponible)
              </span>
            )}
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
            <X className="w-4 h-4 text-white" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(90vh-120px)]">

          {/* Infos contexte */}
          <div className="flex flex-wrap gap-3 text-xs">
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
            {tone && <div className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-medium">{toneLabels[tone] || tone}</div>}
          </div>

          {/* Objet */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Objet</label>
            {editMode ? (
              <input
                type="text"
                value={editSubject}
                onChange={e => setEditSubject(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none"
              />
            ) : (
              <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm font-medium">{subject}</div>
            )}
          </div>

          {/* Corps de l'email */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Corps de l'email</label>
            {editMode ? (
              <textarea
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                rows={8}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none resize-none leading-relaxed"
              />
            ) : (
              <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm whitespace-pre-line leading-relaxed">
                {body}
              </div>
            )}
          </div>

          {/* Note signature */}
          <p className="text-[10px] text-gray-400 italic">
            La signature email sera ajoutée automatiquement à l'envoi (expéditeur : hicham.saidi@accessformation.pro).
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
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
            {editMode ? 'Aperçu' : 'Modifier'}
          </button>

          <div className="flex gap-2">
            <button onClick={onCancel} disabled={sending}
              className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-100 font-medium text-gray-600 transition-colors">
              Annuler
            </button>
            <button onClick={handleSend} disabled={sending}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm flex items-center gap-2 disabled:opacity-50 transition-colors">
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

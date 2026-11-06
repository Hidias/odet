import { X } from 'lucide-react'
import { useState, useEffect } from 'react'
import { format } from 'date-fns'

import toast from 'react-hot-toast'
// Date d'un fait déjà passé (convention envoyée, convention signée reçue) : une date future est refusée,
// une faute de frappe sur l'année (2029 au lieu de 2026) ne doit pas s'enregistrer.
export default function DateTimePickerModal({ isOpen, onClose, onSave, title, currentDate = null }) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')

  useEffect(() => {
    if (isOpen) {
      if (currentDate) {
        // Si une date existe déjà, l'utiliser
        const d = new Date(currentDate)
        setDate(format(d, 'yyyy-MM-dd'))
        setTime(format(d, 'HH:mm'))
      } else {
        // Sinon, utiliser la date/heure actuelle
        const now = new Date()
        setDate(format(now, 'yyyy-MM-dd'))
        setTime(format(now, 'HH:mm'))
      }
    }
  }, [isOpen, currentDate])

  const handleSave = () => {
    if (!date || !time) {
      toast.error('Veuillez sélectionner une date et une heure')
      return
    }

    // Combiner date et heure
    const datetime = new Date(`${date}T${time}:00`)
    if (Number.isNaN(datetime.getTime())) {
      toast.error('Date ou heure invalide')
      return
    }
    if (datetime.getTime() > Date.now() + 5 * 60 * 1000) {
      toast.error('Cette date est dans le futur : vérifiez le jour et l\'année')
      return
    }
    onSave(datetime.toISOString())
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-2 -m-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          {/* Date */}
          <div>
            <label htmlFor="dtp-date" className="block text-sm font-medium text-gray-700 mb-1">
              Date
            </label>
            <input
              id="dtp-date"
              type="date"
              max={format(new Date(), 'yyyy-MM-dd')}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Heure */}
          <div>
            <label htmlFor="dtp-heure" className="block text-sm font-medium text-gray-700 mb-1">
              Heure
            </label>
            <input
              id="dtp-heure"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Preview */}
          {date && time && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-900">
                <span className="font-medium">Aperçu :</span>{' '}
                {format(new Date(`${date}T${time}`), 'dd/MM/yyyy à HH:mm')}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}

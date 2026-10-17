// ═══════════════════════════════════════════════════════════════
// SirenConflictModal.jsx - Alerte doublon SIREN avant création client
// Affiche les établissements existants du même groupe
// Permet : rattacher à l'existant | marquer décideur | créer quand même
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react'
import { AlertTriangle, Building2, X, Check, ChevronRight, Plus } from 'lucide-react'

/**
 * @param {Object} props
 * @param {Array}  props.matches        - résultat check_siren_exists (clients existants)
 * @param {string} props.newName        - nom du client qu'on essaie de créer
 * @param {string} props.newSiret       - SIRET du client qu'on essaie de créer
 * @param {string} props.newCity        - ville du client qu'on essaie de créer
 * @param {Function} props.onUseExisting  - (clientId) → utiliser un client existant
 * @param {Function} props.onCreateAnyway → créer quand même (établissement secondaire légitime)
 * @param {Function} props.onCancel     → annuler
 */
export default function SirenConflictModal({
  matches = [],
  newName,
  newSiret,
  newCity,
  onUseExisting,
  onCreateAnyway,
  onCancel,
}) {
  const [selected, setSelected] = useState(null)
  const [confirmCreate, setConfirmCreate] = useState(false)

  if (!matches.length) return null

  const siren = matches[0]?.siret?.slice(0, 9) || ''
  const decisionnaire = matches.find(m => m.is_decisionnaire) || null

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-ui-lg shadow-md w-full max-w-lg">

        {/* Header */}
        <div className="p-5 border-b border-[rgb(var(--c-warning)/0.3)] bg-[rgb(var(--c-warning-bg))] rounded-t-2xl flex items-start gap-3">
          <div className="p-2 bg-[rgb(var(--c-warning-bg))] rounded-ui-sm flex-shrink-0">
            <AlertTriangle size={20} className="text-[rgb(var(--c-warning))]" />
          </div>
          <div className="flex-1">
            <h2 className="font-bold text-gray-900 text-base">Doublon SIREN détecté</h2>
            <p className="text-ui text-[rgb(var(--c-warning))] mt-0.5">
              Le SIREN <span className="font-mono font-semibold">{siren}</span> existe déjà
              dans {matches.length === 1 ? 'un client' : `${matches.length} clients`}.
            </p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">

          {/* Nouveau client qu'on essaie de créer */}
          <div className="bg-gray-50 rounded-ui-sm px-4 py-3">
            <p className="text-ui-sm text-gray-500 font-medium mb-1">Vous essayez de créer :</p>
            <p className="font-semibold text-gray-900">{newName || '-'}</p>
            <p className="text-ui-sm text-gray-500">
              {newCity || ''}{newCity && newSiret ? ' · ' : ''}{newSiret ? `SIRET ${newSiret}` : ''}
            </p>
          </div>

          {/* Clients existants */}
          <div>
            <p className="text-ui-sm font-semibold text-gray-500 uppercase mb-2">
              Établissements existants du même groupe :
            </p>
            <div className="space-y-2">
              {matches.map(m => (
                <button
                  key={m.id}
                  onClick={() => setSelected(selected === m.id ? null : m.id)}
                  className={`w-full text-left px-4 py-3 rounded-ui-sm border-2 transition-all ${
                    selected === m.id
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 size={15} className="text-gray-400 flex-shrink-0" />
                      <div>
                        <span className="font-semibold text-gray-900 text-ui">{m.name}</span>
                        {m.city && <span className="text-gray-500 text-ui ml-2">· {m.city}</span>}
                        {m.is_decisionnaire && (
                          <span className="ml-2 text-ui-sm bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] px-1.5 py-0.5 rounded-full font-medium">
                             Décideur
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      {(m.sessions_count > 0 || m.invoices_count > 0) && (
                        <span className="text-ui-sm text-gray-400">
                          {m.sessions_count > 0 && `${m.sessions_count} session(s)`}
                          {m.sessions_count > 0 && m.invoices_count > 0 && ' · '}
                          {m.invoices_count > 0 && `${m.invoices_count} facture(s)`}
                        </span>
                      )}
                      <p className="text-ui-sm text-gray-400 font-mono">{m.siret}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Message si un décideur existe */}
          {decisionnaire && !selected && (
            <p className="text-ui-sm text-[rgb(var(--c-success))] bg-[rgb(var(--c-success-bg))] px-3 py-2 rounded-ui-sm">
               <strong>{decisionnaire.name} ({decisionnaire.city})</strong> est marqué comme décideur pour ce groupe.
              Sélectionnez-le pour rattacher l'activité.
            </p>
          )}

          {/* Confirmation création quand même */}
          {confirmCreate && (
            <div className="bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] rounded-ui-sm p-3 space-y-2">
              <p className="text-ui font-semibold text-[rgb(var(--c-warning))]">
                 Créer un {matches.length + 1}ème établissement pour ce SIREN ?
              </p>
              <p className="text-ui-sm text-[rgb(var(--c-warning))]">
                À utiliser uniquement si cet établissement a un interlocuteur différent et une activité distincte.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 space-y-2">

          {/* Bouton principal : utiliser l'existant sélectionné */}
          {selected && (
            <button
              onClick={() => onUseExisting(selected)}
              className="w-full py-2.5 bg-primary-600 text-white text-ui font-semibold rounded-ui-sm hover:bg-primary-700 flex items-center justify-center gap-2"
            >
              <Check size={16} /> Utiliser cet établissement
            </button>
          )}

          {/* Bouton : créer quand même */}
          {!confirmCreate ? (
            <button
              onClick={() => setConfirmCreate(true)}
              className="w-full py-2 text-ui text-gray-500 hover:text-gray-700 border border-gray-200 rounded-ui-sm hover:bg-gray-50 flex items-center justify-center gap-1.5"
            >
              <Plus size={14} /> Créer quand même (établissement distinct)
            </button>
          ) : (
            <button
              onClick={onCreateAnyway}
              className="w-full py-2.5 bg-[rgb(var(--c-warning))] text-white text-ui font-semibold rounded-ui-sm hover:bg-[rgb(var(--c-warning))] flex items-center justify-center gap-2"
            >
              <ChevronRight size={16} /> Confirmer - créer un nouvel établissement
            </button>
          )}

          <button
            onClick={onCancel}
            className="w-full py-2 text-ui text-gray-400 hover:text-gray-600"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  )
}

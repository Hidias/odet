// Page plein écran du suivi formatif, ouverte sur le téléphone du formateur (lien ou QR code depuis la session).
// Module activable (org_modules, clé « suivi_formatif »). Le formateur ne voit que ses sessions (règles en base).

import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ClipboardList } from 'lucide-react'
import { useAuthStore } from '../../../core/store'
import { SF_MODULE, loadSessionFormative, initSession, canWriteSession } from '../lib/sfData'
import SuiviSaisie, { SuiviLoader } from '../components/SuiviSaisie'

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '')

export default function SuiviTelephone() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { modules, userRole, profile } = useAuthStore()
  const enabled = (modules || []).includes(SF_MODULE)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const isTrainer = !!(data?.session?.trainer_id && profile?.trainer_id && data.session.trainer_id === profile.trainer_id)
  const canWrite = canWriteSession(userRole, isTrainer || userRole === 'formateur')

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      let d = await loadSessionFormative(sessionId)
      if (!d.session) throw new Error('Session introuvable ou non accessible')
      if (!d.sequences.length && ['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur'].includes(userRole)) {
        try {
          const n = await initSession(sessionId)
          if (n) d = await loadSessionFormative(sessionId)
        } catch { /* pas le droit de préparer : affichage en lecture */ }
      }
      setData(d)
      setError(null)
    } catch (e) {
      setError(e.message || String(e))
    }
    setLoading(false)
  }, [sessionId, userRole])

  useEffect(() => { if (enabled) load() }, [enabled, load])

  const s = data?.session
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-900">
      <header className="bg-nav text-nav-fg px-4 pt-3 pb-3 space-y-1">
        <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(`/sessions/${sessionId}`))}
          className="flex items-center gap-1.5 text-[13px] min-h-[40px] opacity-90" aria-label="Retour">
          <ArrowLeft className="w-[18px] h-[18px]" aria-hidden="true" />
          {s ? [s.courses?.code || s.courses?.title, [fr(s.start_date), s.end_date && s.end_date !== s.start_date ? fr(s.end_date) : null].filter(Boolean).join(' au '), s.location_city].filter(Boolean).join(' · ') : 'Session'}
        </button>
        <h1 className="font-display text-xl font-semibold">Suivi formatif</h1>
      </header>

      <main className="flex-1 flex flex-col">
        {!enabled && (
          <div className="p-6 text-center text-gray-600">
            <ClipboardList className="w-10 h-10 mx-auto mb-3 text-gray-300" aria-hidden="true" />
            Le module Suivi formatif n'est pas activé (Console, Modules).
          </div>
        )}
        {enabled && loading && <SuiviLoader />}
        {enabled && !loading && error && <div className="p-6 text-center text-red-700">{error}</div>}
        {enabled && !loading && !error && data && data.sequences.length === 0 && (
          <div className="p-6 text-center text-gray-600 space-y-2">
            <ClipboardList className="w-10 h-10 mx-auto text-gray-300" aria-hidden="true" />
            <p>Aucune séquence pour cette formation.</p>
            <p className="text-sm">Elles se définissent dans le catalogue, fiche de la formation, bouton « Séquences ».</p>
          </div>
        )}
        {enabled && !loading && !error && data && data.sequences.length > 0 && (
          <SuiviSaisie data={data} canWrite={canWrite} onReload={load} />
        )}
      </main>
    </div>
  )
}

// Demi-journées sans émargement (0398) : à décider avant l'attestation et le certificat de réalisation.
// « Présent, a oublié de signer » ou « Absent » (heures retirées), toujours avec un motif ; chaque décision est gardée
// (qui, quand, pourquoi) et une correction ajoute une nouvelle décision.

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, CheckCircle, History } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { currentUserName } from '../../../core/org/currentOrg'
import { demander } from '../../../ui/Confirm'
import { controleEmargement, libelleDemiJournee } from '../lib/presence'
import { chargerEmargement } from '../lib/emargementControle'

export default function RegularisationEmargements({ session, sessionTrainees, peutGerer, refreshKey }) {
  const [donnees, setDonnees] = useState(null)
  const [voirHistorique, setVoirHistorique] = useState(false)

  const charger = useCallback(async () => { if (session?.id) setDonnees(await chargerEmargement(session.id)) }, [session?.id])
  useEffect(() => { charger() }, [charger, refreshKey])

  if (!donnees) return null
  const course = session?.courses || {}
  // Un stagiaire noté absent sur toute la session n'a ni attestation ni certificat : rien à régulariser
  const absentsSession = new Set((session?.session_trainees || []).filter((st) => st.absent).map((st) => st.trainee_id))
  const lignes = (sessionTrainees || []).filter((t) => !absentsSession.has(t.id))
    .map((t) => ({ t, c: controleEmargement({ session, course, traineeId: t.id, ...donnees }) }))
  if (!lignes.some((l) => l.c.controle)) return null
  const aFaire = lignes.filter((l) => l.c.aRegulariser.length)
  const decides = lignes.filter((l) => l.c.absents.length || l.c.presentsSansSignature.length)

  const decider = async (t, hd, decision) => {
    const question = decision === 'absent'
      ? `${t.first_name} ${t.last_name?.toUpperCase()} absent le ${libelleDemiJournee(hd)} : les heures de cette demi-journée seront retirées de l'attestation et du certificat.\n\nMotif :`
      : `${t.first_name} ${t.last_name?.toUpperCase()} présent le ${libelleDemiJournee(hd)} mais n'a pas signé.\n\nComment le savez-vous ? (exemple : vu par le formateur, signé sur papier)`
    const motif = await demander(question, { title: decision === 'absent' ? 'Absence' : 'Présence sans signature' })
    if (motif === null) return
    if (motif.trim().length < 3) { toast.error('Le motif est obligatoire'); return }
    const { error } = await supabase.from('attendance_regularisations').insert({
      session_id: session.id, trainee_id: t.id, date: hd.date, period: hd.period, decision, reason: motif.trim(), decided_by_name: currentUserName() || null,
    })
    if (error) { toast.error(error.message); return }
    toast.success('Décision enregistrée')
    charger()
  }

  const nom = (t) => `${t.first_name || ''} ${(t.last_name || '').toUpperCase()}`.trim()
  const historique = [...donnees.regularisations].reverse()
  const nomDe = (id) => { const t = (sessionTrainees || []).find((x) => x.id === id); return t ? nom(t) : '' }

  return (
    <div className={`card mb-4 border ${aFaire.length ? 'border-amber-300' : 'border-green-200'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            {aFaire.length ? <AlertTriangle className="w-5 h-5 text-amber-600" aria-hidden="true" /> : <CheckCircle className="w-5 h-5 text-[rgb(var(--c-success))]" aria-hidden="true" />}
            {aFaire.length ? `Émargements à régulariser (${aFaire.reduce((n, l) => n + l.c.aRegulariser.length, 0)})` : 'Émargements complets'}
          </h3>
          <p className="text-ui text-gray-500">L'attestation et le certificat portent les heures réellement suivies. Une demi-journée sans signature se décide ici, avec un motif.</p>
        </div>
        {historique.length > 0 && (
          <button type="button" className="btn btn-secondary btn-sm flex items-center gap-1" onClick={() => setVoirHistorique((v) => !v)}>
            <History className="w-4 h-4" aria-hidden="true" /> {voirHistorique ? 'Masquer' : 'Voir'} l'historique
          </button>
        )}
      </div>

      {aFaire.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100">
          {aFaire.flatMap(({ t, c }) => c.aRegulariser.map((hd) => (
            <li key={`${t.id}_${hd.date}_${hd.period}`} className="py-2 flex items-center justify-between gap-2 flex-wrap">
              <div>
                <span className="font-medium">{nom(t)}</span>
                <span className="text-gray-600"> · {libelleDemiJournee(hd)}</span>
                {hd.notePresent && <span className="text-ui-sm text-gray-500"> · noté présent par le formateur, sans signature</span>}
              </div>
              {peutGerer && (
                <div className="flex gap-2">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => decider(t, hd, 'present_oubli')}>Présent, a oublié de signer</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => decider(t, hd, 'absent')}>Absent</button>
                </div>
              )}
            </li>
          )))}
        </ul>
      )}

      {decides.length > 0 && (
        <ul className="mt-3 text-ui-sm text-gray-600 space-y-1">
          {decides.map(({ t, c }) => (
            <li key={t.id}>
              <span className="font-medium text-gray-800">{nom(t)}</span>
              {c.absents.length > 0 && ` · absent : ${c.absents.map(libelleDemiJournee).join(', ')}`}
              {c.presentsSansSignature.length > 0 && ` · présent sans signature : ${c.presentsSansSignature.map(libelleDemiJournee).join(', ')}`}
              {peutGerer && <span className="text-gray-400"> (pour corriger, décidez à nouveau depuis l'historique)</span>}
            </li>
          ))}
        </ul>
      )}

      {voirHistorique && (
        <ul className="mt-3 text-ui-sm border-t border-gray-100 pt-2 space-y-1">
          {historique.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-2">
              <span className="text-gray-500">{new Date(r.decided_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
              <span className="font-medium">{nomDe(r.trainee_id)}</span>
              <span>{libelleDemiJournee({ date: String(r.date).slice(0, 10), period: r.period })} :</span>
              <span className={r.decision === 'absent' ? 'text-amber-700' : 'text-green-700'}>{r.decision === 'absent' ? 'absent' : 'présent sans signature'}</span>
              <span className="text-gray-500">« {r.reason} »{r.decided_by_name ? `, par ${r.decided_by_name}` : ''}</span>
              {peutGerer && (() => {
                const t = (sessionTrainees || []).find((x) => x.id === r.trainee_id)
                const hd = { date: String(r.date).slice(0, 10), period: r.period }
                const autre = r.decision === 'absent' ? 'present_oubli' : 'absent'
                return t ? <button type="button" className="underline text-[rgb(var(--c-primary))]" onClick={() => decider(t, hd, autre)}>Corriger en « {autre === 'absent' ? 'absent' : 'présent'} »</button> : null
              })()}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

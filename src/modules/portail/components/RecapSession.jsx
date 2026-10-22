import { Clock, GraduationCap, Backpack, CalendarPlus } from 'lucide-react'
import { telechargerIcs } from '../../../core/fichiers/agenda'

// Récapitulatif d'une session à venir dans l'espace client (0437, décision de H du 22/10) : horaires, formateur,
// ce que les participants apportent, et ajout au calendrier.
const h = (t) => String(t || '').slice(0, 5).replace(':', 'h')

/** sansHoraires : la carte affiche déjà horaires et formateur */
export default function RecapSession({ s, lieu = '', organisme = '', sansHoraires = false }) {
  if (!s) return null
  const materiel = s.courses?.material
  return (
    <div className="mt-3 rounded-ui border border-gray-200 bg-white p-3 text-sm text-gray-700 space-y-1.5">
      {!sansHoraires && s.start_time && <p className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />De {h(s.start_time)} à {h(s.end_time)}</p>}
      {!sansHoraires && s.trainers && <p className="flex items-center gap-1.5"><GraduationCap className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />Formateur : {s.trainers.first_name} {s.trainers.last_name}</p>}
      {materiel && <p className="flex items-start gap-1.5"><Backpack className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" aria-hidden="true" /><span>À prévoir : {materiel}</span></p>}
      <button type="button" onClick={() => telechargerIcs(s, { lieu, organisme })} className="btn btn-secondary btn-sm gap-1.5 mt-1">
        <CalendarPlus className="w-4 h-4" aria-hidden="true" />Ajouter à mon agenda
      </button>
    </div>
  )
}

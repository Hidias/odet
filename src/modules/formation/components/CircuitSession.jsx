import { useState } from 'react'
import toast from 'react-hot-toast'
import { CalendarCheck, Send, Users, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'

// Circuit devis signé → session → participants → convention → convocations (0430, décisions de H du 21/10) :
//  - session préparée depuis un devis signé en ligne : dates, lieu et formateur à confirmer, puis le client saisit ses
//    participants dans son espace ;
//  - participants saisis par le client : date de la dernière saisie ;
//  - convention signée : convocations et documents à vérifier puis envoyer (rien ne part sans l'organisme).
export default function CircuitSession({ session, peutModifier, onChange, onEnvoyer }) {
  const [occupe, setOccupe] = useState(false)
  if (!session) return null
  const stagiaires = session.session_trainees || []
  const aConvoquer = stagiaires.filter((st) => !st.convocation_sent_at && !st.absent).length

  const confirmer = async () => {
    setOccupe(true)
    try {
      const { error } = await supabase.rpc('session_preparee_valider', { p_session: session.id })
      if (error) throw error
      toast.success('Session confirmée : le client peut saisir ses participants.')
      await onChange?.()
    } catch (e) { toast.error(e.message || 'Confirmation impossible') } finally { setOccupe(false) }
  }

  return (
    <div className="space-y-2 mb-4">
      {session.validation_requise && (
        <div className="rounded-ui border border-[rgb(var(--c-warning)/0.4)] bg-[rgb(var(--c-warning-bg))] p-3 flex items-start gap-3 flex-wrap">
          <CalendarCheck className="w-5 h-5 text-[rgb(var(--c-warning))] shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-[14rem] text-ui text-gray-800">
            <p className="font-medium">Session préparée depuis le devis signé</p>
            <p className="text-ui-sm text-gray-600">Vérifiez les dates, les horaires, le lieu et le formateur, puis confirmez : le client pourra alors saisir ses participants dans son espace.</p>
          </div>
          {peutModifier && (
            <button type="button" className="btn btn-primary btn-sm" onClick={confirmer} disabled={occupe}>
              {occupe ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CalendarCheck className="w-4 h-4" aria-hidden="true" />}Confirmer la session
            </button>
          )}
        </div>
      )}
      {session.participants_saisis_le && !session.validation_requise && (
        <p className="text-ui-sm text-gray-600 flex items-center gap-1.5"><Users className="w-4 h-4 text-gray-400" aria-hidden="true" />
          Participants saisis par le client le {new Date(session.participants_saisis_le).toLocaleDateString('fr-FR')} à {new Date(session.participants_saisis_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.</p>
      )}
      {session.quote_id && session.convention_signed && aConvoquer > 0 && (
        <div className="rounded-ui border border-accent-500/30 bg-accent-500/5 p-3 flex items-start gap-3 flex-wrap">
          <Send className="w-5 h-5 text-accent-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-[14rem] text-ui text-gray-800">
            <p className="font-medium">Convention signée : convocations à valider</p>
            <p className="text-ui-sm text-gray-600">{aConvoquer} participant{aConvoquer > 1 ? 's' : ''} sans convocation. Vérifiez les convocations et les documents habituels, puis envoyez-les.</p>
          </div>
          {peutModifier && <button type="button" className="btn btn-primary btn-sm" onClick={onEnvoyer}><Send className="w-4 h-4" aria-hidden="true" />Vérifier et envoyer</button>}
        </div>
      )}
    </div>
  )
}

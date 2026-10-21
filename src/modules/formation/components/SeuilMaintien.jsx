import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, Copy, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { confirmer } from '../../../ui/Confirm'

// Seuil de maintien d'une session inter (0421, série du 21/10 n° 29). À 10 jours ou moins du début, si le minimum
// d'inscrits n'est pas atteint : bandeau avec la décision à prendre (maintenir, reporter, annuler), les contacts des
// inscrits et un message prêt à copier proposant les prochaines dates. L'outil n'envoie rien : la décision est notée
// dans la session, le message part par l'organisme.

const JOURS_AVANT = 10
const fmtJour = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const LIBELLES = { maintenue: 'Session maintenue', reportee: 'Session reportée', annulee: 'Session annulée' }

export function joursAvant(debut, aujourdhui = new Date()) {
  const a = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate())
  const d = new Date(`${String(debut).slice(0, 10)}T00:00:00`)
  return Math.round((d - a) / 86400000)
}

export function messageMaintien({ decision, titre, debut, prochaines = [] }) {
  const date = fmtJour(debut)
  if (decision === 'maintenue') return `Bonjour,\n\nNous vous confirmons le maintien de la formation « ${titre} » du ${date}. Vous recevrez la convocation avec les informations pratiques.\n\nCordialement`
  const autres = prochaines.length
    ? `\n\nProchaines dates proposées :\n${prochaines.map((p) => `- ${fmtJour(p.start_date)}${p.location_city ? ` à ${p.location_city}` : ''}`).join('\n')}\n\nDites-nous laquelle vous convient, l'inscription est reportée sans nouvelle démarche.`
    : '\n\nNous revenons vers vous dès qu\'une nouvelle date est programmée.'
  const verbe = decision === 'annulee' ? 'est annulée' : 'est reportée'
  return `Bonjour,\n\nFaute d'un nombre suffisant de participants, la formation « ${titre} » du ${date} ${verbe}.${autres}\n\nNous vous prions de nous excuser pour ce changement.\n\nCordialement`
}

export default function SeuilMaintien({ session, peutModifier }) {
  const [etat, setEtat] = useState(null)
  const [busy, setBusy] = useState(false)

  const j = session?.start_date ? joursAvant(session.start_date) : null
  const concerne = session?.session_type === 'inter' && (session?.min_participants || 0) > 0 && j != null && j >= 0 && j <= JOURS_AVANT
    && !['cancelled', 'annulee'].includes(session?.status || '')

  const charger = async () => {
    const [{ data: s }, { data: st }, { data: proch }] = await Promise.all([
      supabase.from('sessions').select('maintien_decision, maintien_decision_at').eq('id', session.id).maybeSingle(),
      supabase.from('session_trainees').select('absent, trainees(first_name, last_name, email, phone)').eq('session_id', session.id),
      session.course_id
        ? supabase.from('sessions').select('id, start_date, location_city, status').eq('course_id', session.course_id).eq('session_type', 'inter')
          .gt('start_date', session.start_date).order('start_date').limit(3)
        : Promise.resolve({ data: [] }),
    ])
    const inscrits = (st || []).filter((x) => !x.absent).map((x) => x.trainees).filter(Boolean)
    setEtat({
      decision: s?.maintien_decision || null,
      decisionAt: s?.maintien_decision_at || null,
      inscrits,
      prochaines: (proch || []).filter((p) => !['cancelled', 'annulee'].includes(p.status || '')),
    })
  }
  useEffect(() => { if (concerne) charger() }, [concerne, session?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!concerne || !etat) return null
  const n = etat.inscrits.length
  if (n >= session.min_participants && !etat.decision) return null

  const titre = session.courses?.title || session.course?.title || 'la formation'
  const decider = async (decision) => {
    const msgs = {
      maintenue: 'La session est maintenue malgré le nombre d\'inscrits.',
      reportee: 'La session est notée reportée. Pensez à créer la nouvelle date si elle n\'existe pas encore.',
      annulee: 'La session est notée annulée. Le statut de la session se change ensuite dans « Modifier ».',
    }
    if (!(await confirmer({ title: `${LIBELLES[decision]} ?`, message: msgs[decision], confirmLabel: 'Confirmer' }))) return
    setBusy(true)
    const { error } = await supabase.from('sessions').update({ maintien_decision: decision, maintien_decision_at: new Date().toISOString() }).eq('id', session.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Décision enregistrée')
    await charger()
  }
  const copier = async (texte) => {
    try { await navigator.clipboard.writeText(texte); toast.success('Copié') } catch { toast.error('Copie impossible : sélectionnez le texte') }
  }

  const contacts = etat.inscrits.map((t) => [`${t.first_name || ''} ${t.last_name || ''}`.trim(), t.email, t.phone].filter(Boolean).join(' · '))
  const emails = etat.inscrits.map((t) => t.email).filter(Boolean).join(', ')

  return (
    <div className={`card border ${etat.decision ? 'border-gray-200' : 'border-[rgb(var(--c-warning))]'} space-y-3`} role="region" aria-label="Seuil de maintien">
      <div className="flex items-start gap-2">
        <AlertTriangle className={`w-5 h-5 shrink-0 ${etat.decision ? 'text-gray-400' : 'text-[rgb(var(--c-warning))]'}`} aria-hidden="true" />
        <div className="flex-1 text-ui">
          {etat.decision ? (
            <p className="font-medium text-gray-900">{LIBELLES[etat.decision]}{etat.decisionAt ? ` (décidé le ${new Date(etat.decisionAt).toLocaleDateString('fr-FR')})` : ''}</p>
          ) : (
            <p className="font-medium text-gray-900">Seuil de maintien non atteint : {n} inscrit{n > 1 ? 's' : ''} pour un minimum de {session.min_participants}, à J-{j}</p>
          )}
          <p className="text-gray-600">Les inscrits sont prévenus par l'organisme, avec le message ci-dessous. L'outil n'envoie rien.</p>
        </div>
      </div>

      {!etat.decision && peutModifier && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => decider('maintenue')}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Maintenir</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => decider('reportee')}>Reporter</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => decider('annulee')}>Annuler</button>
        </div>
      )}

      {n > 0 && (
        <div className="text-ui-sm space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-800">Inscrits à prévenir</span>
            {emails && <button type="button" className="btn btn-ghost btn-sm" onClick={() => copier(emails)}><Copy className="w-4 h-4" />Copier les emails</button>}
          </div>
          <ul className="text-gray-700">{contacts.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}

      {['maintenue', 'reportee', 'annulee'].filter((x) => !etat.decision || x === etat.decision).map((x) => {
        const texte = messageMaintien({ decision: x, titre, debut: session.start_date, prochaines: etat.prochaines })
        return (
          <details key={x} className="text-ui-sm" open={!!etat.decision}>
            <summary className="cursor-pointer text-accent-700">Message « {LIBELLES[x].toLowerCase()} »</summary>
            <pre className="whitespace-pre-wrap font-sans bg-gray-50 rounded-ui p-2 mt-1 text-gray-700">{texte}</pre>
            <button type="button" className="btn btn-ghost btn-sm mt-1" onClick={() => copier(texte)}><Copy className="w-4 h-4" />Copier le message</button>
          </details>
        )
      })}
    </div>
  )
}

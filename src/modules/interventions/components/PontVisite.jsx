import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Users, Loader2, CalendarCheck, GraduationCap } from 'lucide-react'
import { supabase } from '../../../core/supabase'

// Pont formation et maintenance (fonction 10, 0130), étape clôture d'une visite : le personnel du site en nombres
// (jamais de noms, jamais de prix), et deux gestes : « Le client a fait un exercice » et « Signaler un besoin de
// formation ». Des faits, pas un taux de conformité (le code du travail impose de désigner les personnes et de faire
// des exercices, R4227-38 et R4227-39).

const mois = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : null)
const jour = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : null)

export default function PontVisite({ visitId, readOnly }) {
  const [r, setR] = useState(null)
  const [indispo, setIndispo] = useState(false)
  const [geste, setGeste] = useState(null)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { data, error } = await supabase.rpc('itv_site_training_summary', { p_visit: visitId })
    if (error) { setIndispo(true); return }
    setR(data)
  }
  useEffect(() => { load() }, [visitId])

  if (indispo) return null
  if (!r) return <section className="card"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></section>

  const exercice = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('pont_declarer_exercice', { p_visit: visitId, p_date: date })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Exercice enregistré')
    setGeste(null)
    load()
  }

  const signaler = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('pont_signaler_besoin', { p_visit: visitId, p_note: note || null })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Besoin transmis au bureau')
    setGeste(null)
    setNote('')
    load()
  }

  const domaine = (r.domaines || []).join(', ')
  return (
    <section className="card space-y-2">
      <h2 className="section-title flex items-center gap-2"><Users className="w-4 h-4" />Personnel du site</h2>
      <p className="text-ui text-gray-800">
        {r.connus > 0
          ? <>{r.formes} salarié{r.formes > 1 ? 's' : ''} formé{r.formes > 1 ? 's' : ''} ({domaine}) sur {r.connus} connu{r.connus > 1 ? 's' : ''}</>
          : <>Effectif du site inconnu</>}
        {r.prochaine_echeance ? <>, prochaine échéance {mois(r.prochaine_echeance)}</> : null}
      </p>
      {r.sans_site > 0 && <p className="text-ui-sm text-gray-500">{r.sans_site} salarié{r.sans_site > 1 ? 's' : ''} du client sans site renseigné ({r.formes_sans_site} formé{r.formes_sans_site > 1 ? 's' : ''}).</p>}
      <p className="text-ui-sm text-gray-600">Dernier exercice d'évacuation : {r.dernier_exercice ? jour(r.dernier_exercice) : 'non renseigné'}</p>
      {r.piste_ouverte && <p className="text-ui-sm text-[rgb(var(--c-info))]">Un besoin de formation est déjà transmis au bureau : un nouveau signalement s'ajoute en note.</p>}

      {!readOnly && geste === null && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} onClick={() => setGeste('exercice')}><CalendarCheck className="w-4 h-4" />Le client a fait un exercice</button>
          <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} onClick={() => setGeste('besoin')}><GraduationCap className="w-4 h-4" />Signaler un besoin de formation</button>
        </div>
      )}
      {geste === 'exercice' && (
        <div className="space-y-2">
          <label className="label" htmlFor="pont-date">Date de l'exercice déclarée par le client</label>
          <input id="pont-date" type="date" className="input" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost flex-1" onClick={() => setGeste(null)}>Annuler</button>
            <button type="button" className="btn btn-primary flex-1" onClick={exercice} disabled={busy || !date}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button>
          </div>
        </div>
      )}
      {geste === 'besoin' && (
        <div className="space-y-2">
          <label className="label" htmlFor="pont-note">Ce que le client a dit (facultatif)</label>
          <textarea id="pont-note" className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nouveaux embauchés, personne à désigner…" />
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost flex-1" onClick={() => setGeste(null)}>Annuler</button>
            <button type="button" className="btn btn-primary flex-1" onClick={signaler} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Transmettre au bureau</button>
          </div>
        </div>
      )}
    </section>
  )
}

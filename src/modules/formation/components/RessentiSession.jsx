import { useEffect, useState } from 'react'
import { Smile } from 'lucide-react'
import { supabase } from '../../../core/supabase'

// Ressenti au fil de la formation (0414), côté organisme : par jour, la moyenne, les difficultés (notes de 1 ou 2)
// et les remarques des stagiaires, pour adapter la suite de la formation. Lecture seulement.

const fr = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const virgule = (n) => String(Math.round(n * 10) / 10).replace('.', ',')

// Ressentis regroupés par jour (le plus récent d'abord), avec le nom du stagiaire
export function parJour(ressentis, noms) {
  const jours = {}
  for (const r of ressentis || []) {
    const j = (jours[r.jour] = jours[r.jour] || { jour: r.jour, notes: [], remarques: [] })
    j.notes.push(r.note)
    if (r.note <= 2 || (r.commentaire || '').trim()) {
      j.remarques.push({ id: r.id, nom: noms[r.trainee_id] || 'Stagiaire', note: r.note, commentaire: (r.commentaire || '').trim() })
    }
  }
  return Object.values(jours)
    .map((j) => ({ ...j, moyenne: j.notes.reduce((a, b) => a + b, 0) / j.notes.length, difficultes: j.notes.filter((n) => n <= 2).length }))
    .sort((a, b) => (a.jour < b.jour ? 1 : -1))
}

export default function RessentiSession({ sessionId, inscrits }) {
  const [ressentis, setRessentis] = useState(null)

  useEffect(() => {
    if (!sessionId) return
    let actif = true
    supabase.from('session_ressentis').select('id, trainee_id, jour, note, commentaire').eq('session_id', sessionId)
      .then(({ data, error }) => { if (actif) setRessentis(error ? [] : data || []) })
    return () => { actif = false }
  }, [sessionId])

  if (!ressentis || ressentis.length === 0) return null
  // inscrits : stagiaires de la session (fiche stagiaire, avec id)
  const noms = Object.fromEntries((inscrits || []).map((t) => [t.id, [t.first_name, (t.last_name || '').toUpperCase()].filter(Boolean).join(' ')]))
  const jours = parJour(ressentis, noms)
  return (
    <div className="card space-y-3">
      <div>
        <h3 className="font-semibold flex items-center gap-2"><Smile className="w-5 h-5 text-accent-600" aria-hidden="true" />Ressenti au fil de la formation</h3>
        <p className="text-ui text-gray-500 mt-1">Donné par les stagiaires sur le portail, chaque jour de formation (de 1, difficile, à 5, très bien).</p>
      </div>
      {jours.map((j) => (
        <div key={j.jour} className="border-t border-gray-100 pt-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-medium text-gray-900 first-letter:uppercase">{fr(j.jour)}</span>
            <span className="text-ui text-gray-700">{j.notes.length} ressenti{j.notes.length > 1 ? 's' : ''}, {virgule(j.moyenne)} sur 5</span>
            {j.difficultes > 0 && <span className="text-ui-sm font-medium text-[rgb(var(--c-danger))]">{j.difficultes} difficulté{j.difficultes > 1 ? 's' : ''}</span>}
          </div>
          {j.remarques.length > 0 && (
            <ul className="mt-1 space-y-1">
              {j.remarques.map((r) => (
                <li key={r.id} className="text-ui text-gray-700">
                  <span className="font-medium">{r.nom}</span>
                  <span className={`ml-1 text-ui-sm ${r.note <= 2 ? 'text-[rgb(var(--c-danger))]' : 'text-gray-500'}`}>({r.note}/5)</span>
                  {r.commentaire && <span className="ml-1 italic">« {r.commentaire} »</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

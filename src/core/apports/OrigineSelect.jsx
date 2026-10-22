import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { valeurOrigine } from './apports'
import { FILTRE_EQUIPE } from '../org/currentOrg'

// Choix de l'origine (0409) : un membre de l'équipe ou un apporteur extérieur. Valeur « p:<id> » ou « c:<id> ».
let cache = null
export async function chargerOrigines(force = false) {
  if (cache && !force) return cache
  const [p, c] = await Promise.all([
    supabase.from('profiles').select('id, display_name, first_name, last_name, email, is_active').or(FILTRE_EQUIPE).order('display_name'),
    supabase.from('business_contributors').select('id, name, kind, active, introduced_by_profile, introduced_by_contributor').order('name'),
  ])
  // equipe : comptes actifs (choix) ; tous : aussi les comptes désactivés, pour nommer l'historique
  cache = { equipe: (p.data || []).filter((x) => x.email && x.is_active !== false), tous: p.data || [], apporteurs: c.error ? [] : c.data || [], disponible: !c.error }
  return cache
}

const nom = (p) => p.display_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email

export function useOrigines() {
  const [o, setO] = useState(cache || { equipe: [], tous: [], apporteurs: [], disponible: false })
  useEffect(() => { chargerOrigines().then(setO) }, [])
  return o
}

export default function OrigineSelect({ id, value, onChange, origines, vide = '—', membresSeulement = false }) {
  const o = origines || { equipe: [], apporteurs: [] }
  const actifs = o.apporteurs.filter((a) => a.active !== false || valeurOrigine(null, a.id) === value)
  return (
    <select id={id} className="select" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{vide}</option>
      <optgroup label="Équipe">
        {o.equipe.map((p) => <option key={p.id} value={`p:${p.id}`}>{nom(p)}</option>)}
      </optgroup>
      {!membresSeulement && actifs.length > 0 && (
        <optgroup label="Apporteurs extérieurs">
          {actifs.map((a) => <option key={a.id} value={`c:${a.id}`}>{a.name}</option>)}
        </optgroup>
      )}
    </select>
  )
}

// Choix d'affichage d'une page : « Liste » ou « Colonnes » (Kanban). Le choix est retenu sur cet appareil, par page.

import { useState } from 'react'
import { List, KanbanSquare } from 'lucide-react'

const lire = (cle) => { try { return localStorage.getItem(`odet_vue_${cle}`) } catch { return null } }
const ecrire = (cle, v) => { try { localStorage.setItem(`odet_vue_${cle}`, v) } catch { /* stockage indisponible : rien de grave */ } }

export function useVue(cle, defaut = 'liste') {
  const [vue, setVue] = useState(() => (['liste', 'colonnes'].includes(lire(cle)) ? lire(cle) : defaut))
  return [vue, (v) => { setVue(v); ecrire(cle, v) }]
}

export function ChoixVue({ vue, onChange }) {
  const bouton = (v, Icone, texte) => (
    <button type="button" aria-pressed={vue === v} onClick={() => onChange(v)}
      className={`btn btn-sm ${vue === v ? 'bg-gray-900 text-white border-gray-900' : 'btn-secondary'}`}>
      <Icone className="w-4 h-4" aria-hidden="true" />{texte}
    </button>
  )
  return (
    <div className="inline-flex gap-1" role="group" aria-label="Affichage">
      {bouton('liste', List, 'Liste')}
      {bouton('colonnes', KanbanSquare, 'Colonnes')}
    </div>
  )
}

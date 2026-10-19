import { useAuthStore } from '../store'
import { multiSocietes, nomSociete } from './societes'

// « Pour quelle société ? » d'une fiche partageable (clients, formateurs, catalogue ; chantier C3) : la fiche
// n'apparaît que dans les sociétés cochées. La société courante reste cochée (sinon la fiche sortirait de l'écran
// en cours) ; les sociétés du compte seulement. Rien ne s'affiche avec une seule société.
export default function ChoixSocietesFiche({ value, onChange }) {
  const ctx = useAuthStore((s) => s.societes)
  if (!multiSocietes(ctx) || ctx.vue_groupe) return null
  const coches = Array.isArray(value) ? value : (ctx.current ? [ctx.current] : [])
  const basculer = (id, on) => {
    const next = on ? [...new Set([...coches, id])] : coches.filter((x) => x !== id)
    onChange(next)
  }
  return (
    <fieldset className="grid gap-1">
      <legend className="text-ui-sm font-medium text-gray-500 mb-1">Pour quelle société ?</legend>
      {(ctx.societes || []).map((s) => (
        <label key={s.id} className="flex items-center gap-2 text-ui">
          <input type="checkbox" checked={coches.includes(s.id)} disabled={s.id === ctx.current}
            onChange={(e) => basculer(s.id, e.target.checked)} />
          <span>{nomSociete(s)}</span>
        </label>
      ))}
      <span className="text-ui-sm text-gray-400">La fiche n'apparaît que dans les sociétés cochées ; ses factures et devis restent séparés par société.</span>
    </fieldset>
  )
}

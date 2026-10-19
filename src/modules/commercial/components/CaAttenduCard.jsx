import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp } from 'lucide-react'
import { chargerPrevisionnel, parMois, totaux, euros, libMois } from '../lib/previsionnel'

// Tableau de bord : chiffre d'affaires attendu sur 12 mois (fonction 12, 0150), barres par mois (formation et
// maintenance), part déjà devisée. Rien si la vue n'existe pas ou n'a aucune ligne.

export default function CaAttenduCard() {
  const [lignes, setLignes] = useState(null)
  useEffect(() => { chargerPrevisionnel().then(setLignes).catch(() => setLignes([])) }, [])
  if (!lignes || lignes.length === 0) return null
  const mois = parMois(lignes)
  const t = totaux(lignes)
  const max = Math.max(1, ...mois.map((m) => m.attendu))
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-primary-600" />
        <h2 className="font-semibold text-gray-900 flex-1">Chiffre d'affaires attendu</h2>
        <Link to="/previsionnel" className="text-ui-sm text-accent-700 hover:underline">Détail</Link>
      </div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-2xl font-display font-semibold text-gray-900">{euros(t.attendu)}</span>
        <span className="text-ui-sm text-gray-500">sur 12 mois, dont {euros(t.devise)} déjà devisé{t.sansPrix ? `, ${t.sansPrix} échéance${t.sansPrix > 1 ? 's' : ''} sans prix` : ''}</span>
      </div>
      <div className="flex items-end gap-1 h-24" role="img" aria-label="Chiffre d'affaires attendu par mois">
        {mois.map((m) => (
          <div key={m.mois} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${libMois(m.mois)} : ${euros(m.attendu)}`}>
            <div className="w-full flex flex-col justify-end h-20">
              <div className="w-full bg-accent-300 rounded-t" style={{ height: `${(m.maintenance + m.contrat) / max * 100}%` }} />
              <div className="w-full bg-accent-600" style={{ height: `${m.formation / max * 100}%` }} />
            </div>
            <span className="text-[10px] text-gray-500 truncate">{libMois(m.mois, true)}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 text-ui-sm text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-accent-600 rounded-sm" /> Formation</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-accent-300 rounded-sm" /> Maintenance et contrats</span>
      </div>
    </div>
  )
}

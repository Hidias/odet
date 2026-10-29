import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, TrendingUp } from 'lucide-react'
import { PageHeader } from '../../../ui/PageHeader'
import { Banner } from '../../../ui/Banner'
import { EmptyState, Spinner } from '../../../ui/EmptyState'
import { chargerPrevisionnel, parMois, totaux, euros, libMois, exporterCsv, NATURES } from '../lib/previsionnel'
import ScenariosPrevisionnel from '../components/ScenariosPrevisionnel'

// Prévisionnel récurrent (fonction 12, 0150) : chiffre d'affaires attendu sur 12 mois à partir des échéances connues
// (recyclages, vérifications hors contrat, renouvellements de contrats), avec la part déjà devisée et planifiée.
// Aucun montant inventé : les échéances sans prix sont comptées à part. Les relances sont préparées dans
// « Relances à valider ».

export default function Previsionnel() {
  const [lignes, setLignes] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [nature, setNature] = useState('')
  const [ouvert, setOuvert] = useState(null)

  useEffect(() => {
    chargerPrevisionnel().then(setLignes).catch(() => { setErreur('Le prévisionnel n\'est pas encore disponible. Prévenez le support.'); setLignes([]) })
  }, [])

  const mois = useMemo(() => parMois(lignes || [], nature), [lignes, nature])
  const t = useMemo(() => totaux(lignes || [], nature), [lignes, nature])
  const max = Math.max(1, ...mois.map((m) => m.attendu))
  const detail = (k) => (lignes || []).filter((l) => String(l.mois).slice(0, 10) === k && (!nature || l.nature === nature))

  if (lignes === null) return <Spinner />

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader title="Prévisionnel" meta={<span>Chiffre d'affaires attendu sur 12 mois, à partir des échéances connues. Montants hors taxes.</span>}
        actions={lignes.length ? <button type="button" className="btn btn-secondary" onClick={() => exporterCsv(lignes.filter((l) => !nature || l.nature === nature))}><Download className="w-4 h-4" /> Exporter</button> : null} />
      {erreur && <Banner tone="warning">{erreur}</Banner>}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Nature">
        {[['', 'Tout'], ...Object.entries(NATURES)].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={nature === k} onClick={() => setNature(k)} className={`btn btn-sm ${nature === k ? 'btn-primary' : 'btn-secondary'}`}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card"><div className="text-ui-sm text-gray-500">Attendu sur 12 mois</div><div className="text-xl font-display font-semibold text-gray-900">{euros(t.attendu)}</div></div>
        <div className="card"><div className="text-ui-sm text-gray-500">Déjà devisé</div><div className="text-xl font-display font-semibold text-gray-900">{euros(t.devise)}</div></div>
        <div className="card"><div className="text-ui-sm text-gray-500">Déjà planifié</div><div className="text-xl font-display font-semibold text-gray-900">{euros(t.planifie)}</div></div>
        <div className="card"><div className="text-ui-sm text-gray-500">Échéances sans prix</div><div className={`text-xl font-display font-semibold ${t.sansPrix ? 'text-[rgb(var(--c-warning))]' : 'text-gray-900'}`}>{t.sansPrix}</div></div>
      </div>
      {t.sansPrix > 0 && <Banner tone="info">{t.sansPrix} échéance{t.sansPrix > 1 ? 's' : ''} sans prix : renseignez le prix des formations au catalogue ou le tarif de visite dans les réglages Interventions. Rien n'est estimé.</Banner>}

      {lignes.length === 0 ? <EmptyState icon={TrendingUp} title="Aucune échéance dans les 12 mois" compact>Les recyclages, vérifications et fins de contrat apparaissent ici dès qu'ils sont connus.</EmptyState> : (
        <div className="card space-y-1.5">
          {mois.map((m) => (
            <div key={m.mois}>
              <button type="button" className="w-full grid grid-cols-[90px_1fr_110px] items-center gap-2 text-left hover:bg-gray-50 rounded px-1 py-1" onClick={() => setOuvert(ouvert === m.mois ? null : m.mois)} aria-expanded={ouvert === m.mois}>
                <span className="text-ui-sm text-gray-600 capitalize">{libMois(m.mois)}</span>
                <span className="relative h-5 bg-gray-100 rounded overflow-hidden" aria-hidden="true">
                  <span className="absolute inset-y-0 left-0 bg-accent-200" style={{ width: `${(m.attendu / max) * 100}%` }} />
                  <span className="absolute inset-y-0 left-0 bg-accent-500" style={{ width: `${(Math.min(m.attendu, m.devise + m.planifie) / max) * 100}%` }} />
                </span>
                <span className="text-ui-sm text-right tabular-nums text-gray-900">{euros(m.attendu)}{m.sansPrix ? <span className="text-[rgb(var(--c-warning))]"> +{m.sansPrix}</span> : null}</span>
              </button>
              {ouvert === m.mois && (
                <div className="pl-2 sm:pl-24 pb-2 space-y-1">
                  {detail(m.mois).length === 0 ? <p className="text-ui-sm text-gray-500">Rien ce mois-ci.</p> : detail(m.mois).map((l, i) => (
                    <div key={i} className="flex items-start justify-between gap-2 text-ui-sm border-b border-gray-100 pb-1">
                      <span className="min-w-0">
                        <Link to={`/clients/${l.client_id}`} className="text-accent-700 hover:underline">{l.client_name}</Link>
                        <span className="text-gray-500"> · {l.label} · {l.nb_echeances} échéance{l.nb_echeances > 1 ? 's' : ''}{l.nb_planifies ? `, ${l.nb_planifies} planifiée${l.nb_planifies > 1 ? 's' : ''}` : ''}{l.client_a_ne_pas_solliciter ? ' · ne pas solliciter' : ''}</span>
                      </span>
                      <span className="tabular-nums text-gray-900 shrink-0">{Number(l.montant_attendu) ? euros(l.montant_attendu) : 'sans prix'}{Number(l.montant_devise) ? <span className="text-gray-500"> (devisé {euros(l.montant_devise)})</span> : null}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <p className="text-ui-sm text-gray-500 pt-1">Barre claire : attendu ; barre foncée : déjà devisé ou planifié. Chiffre orange : échéances sans prix.</p>
        </div>
      )}
      <p className="text-ui-sm text-gray-500">Les propositions de recyclage, de renouvellement de contrat et de visite sont préparées chaque nuit dans <Link to="/a-valider" className="underline">Relances à valider</Link>.</p>
      <ScenariosPrevisionnel />
    </div>
  )
}

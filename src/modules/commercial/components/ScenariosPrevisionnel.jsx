import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../core/supabase'
import { calculerScenarios, SCENARIOS } from '../lib/scenarios'
import { euros, libMois } from '../lib/previsionnel'

// Prévisionnel en trois scénarios (0474), réservé à la direction (droit « voir le cockpit de direction ») : chiffre
// d'affaires par mois, encaissements et solde, charge des techniciens, hypothèses ajustables et tracées, prévu face au
// réalisé. Sans le droit, la section ne s'affiche pas.

const ORIGINES = { historique: 'calculé sur l\'historique', defaut: 'valeur par défaut', direction: 'réglé par la direction' }
const LIBELLES = {
  certain: ['Échéances de contrats et devis acceptés', '%'], devis: ['Devis en cours', '%'], recurrent: ['Recyclages, visites, fins de contrat', '%'],
  delai_signature_j: ['Délai de signature d\'un devis', 'jours'], retard_paiement_j: ['Retard de paiement', 'jours'],
}

export default function ScenariosPrevisionnel() {
  const [data, setData] = useState(undefined)
  const [long, setLong] = useState(false)
  const [saisie, setSaisie] = useState({})
  const charger = () => supabase.rpc('previsionnel_scenarios').then(({ data: d, error }) => setData(error ? null : d), () => setData(null))
  useEffect(() => { charger() }, [])
  const r = useMemo(() => (data ? calculerScenarios(data) : null), [data])
  if (data === undefined || data === null || !r) return null

  const regler = async (cle, retour = false) => {
    const v = saisie[cle] || {}
    const num = (k) => (v[k] === undefined || v[k] === '' ? Number(data.hypotheses[cle][k]) : Number(String(v[k]).replace(',', '.')))
    const { error } = await supabase.rpc('previsionnel_hypothese_regler', retour
      ? { p_cle: cle, p_pess: null, p_reel: null, p_opt: null }
      : { p_cle: cle, p_pess: num('pessimiste'), p_reel: num('realiste'), p_opt: num('optimiste') })
    if (error) return toast.error(error.message)
    toast.success(retour ? 'Hypothèse remise au calcul' : 'Hypothèse enregistrée')
    setSaisie({ ...saisie, [cle]: {} })
    charger()
  }
  const lignes = r.lignes.slice(0, long ? 36 : 12)
  const passe = (data.passe || []).filter((p) => p.prevu)
  const hpv = r.heuresParVisite

  return (
    <section className="space-y-3">
      <h2 className="section-title">Trois scénarios (direction)</h2>
      <div className="grid grid-cols-3 gap-3">
        {SCENARIOS.map(([s, l]) => (
          <div key={s} className="card"><div className="text-ui-sm text-gray-500">{l}, 12 mois</div><div className="text-xl font-display font-semibold text-gray-900">{euros(r.total12[s])}</div><div className="text-ui-sm text-gray-500">36 mois : {euros(r.total36[s])}</div></div>
        ))}
      </div>
      <div className="card card-flush overflow-x-auto">
        <table className="w-full text-ui-sm">
          <thead><tr><th className="text-left">Mois</th><th className="text-right">Certain</th><th className="text-right">Devis</th><th className="text-right">Récurrent</th>
            {SCENARIOS.map(([s, l]) => <th key={s} className="text-right">{l}</th>)}<th className="text-right">Encaissé (réaliste)</th><th className="text-right">Solde (réaliste)</th><th className="text-right">Visites</th></tr></thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.mois}>
                <td className="capitalize">{libMois(String(l.mois).slice(0, 10))}</td>
                <td className="text-right tabular-nums">{euros(l.certain)}</td><td className="text-right tabular-nums">{euros(l.devis)}</td><td className="text-right tabular-nums">{euros(l.recurrent)}</td>
                {SCENARIOS.map(([s]) => <td key={s} className="text-right tabular-nums">{euros(l.ca[s])}</td>)}
                <td className="text-right tabular-nums">{euros(l.encaissement.realiste)}</td>
                <td className={`text-right tabular-nums ${l.solde && l.solde.realiste < 0 ? 'text-[rgb(var(--c-danger))]' : ''}`}>{l.solde ? euros(l.solde.realiste) : ''}</td>
                <td className="text-right tabular-nums">{l.visites ? `${l.visites}${hpv ? ` (${Math.round(l.visites * hpv)} h)` : ''}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-3 py-2"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setLong(!long)}>{long ? 'Voir 12 mois' : 'Voir 3 ans'}</button></div>
      </div>
      <ul className="text-ui-sm text-gray-500 list-disc pl-5">
        <li>Chiffre d'affaires hors taxes. Encaissements et solde en {r.ratioTtc ? 'TTC (rapport TTC / HT constaté sur vos factures)' : 'HT : pas encore assez de factures pour passer en TTC'}, au mois probable de paiement (échéance usuelle de 30 jours plus le retard du scénario).</li>
        <li>{r.charges == null ? 'Aucune dépense au Budget sur les trois derniers mois : les charges ne sont pas déduites, le solde n\'est pas calculé.' : `Charges : ${euros(r.charges)} par mois, moyenne des dépenses du Budget sur les trois derniers mois.`}</li>
        <li>Au-delà de 12 mois, seuls les échéanciers des contrats et les devis comptent : les recyclages et visites ne sont connus que sur 12 mois.</li>
        {hpv ? <li>Charge des techniciens : visites à planifier ou planifiées, à {String(hpv).replace('.', ',')} h par visite en moyenne constatée.</li> : null}
      </ul>

      <div className="card space-y-2">
        <h3 className="font-medium text-gray-900">Hypothèses</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-ui-sm">
            <thead><tr><th className="text-left">Source</th>{SCENARIOS.map(([s, l]) => <th key={s} className="text-right">{l}</th>)}<th className="text-left">Origine</th><th /></tr></thead>
            <tbody>
              {Object.entries(LIBELLES).map(([cle, [lib, unite]]) => {
                const hh = data.hypotheses[cle] || {}
                return (
                  <tr key={cle}>
                    <td>{lib} <span className="text-gray-400">({unite})</span></td>
                    {SCENARIOS.map(([s]) => (
                      <td key={s} className="text-right"><input className="input w-20 text-right" inputMode="decimal" aria-label={`${lib}, ${s}`} value={saisie[cle]?.[s] ?? String(hh[s] ?? '')}
                        onChange={(e) => setSaisie({ ...saisie, [cle]: { ...(saisie[cle] || {}), [s]: e.target.value } })} /></td>
                    ))}
                    <td className="text-gray-500">{ORIGINES[hh.origine] || ''}</td>
                    <td className="whitespace-nowrap"><button type="button" className="btn btn-ghost btn-sm" onClick={() => regler(cle)}>Enregistrer</button>
                      {hh.origine === 'direction' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => regler(cle, true)}>Revenir au calcul</button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-ui-sm text-gray-500">Historique : {data.historique.devis_tranches || 0} devis tranchés sur 12 mois, dont {data.historique.devis_signes || 0} signés{data.historique.devis_tranches >= 5 ? '' : ' (moins de 5 : taux de signature par défaut)'} ; {data.historique.factures_payees || 0} factures payées{data.historique.factures_payees >= 3 ? `, retard moyen ${String(data.historique.retard_moyen_j).replace('.', ',')} jours` : ' (moins de 3 : retard par défaut)'}. Chaque réglage est tracé.</p>
      </div>

      <div className="card space-y-2">
        <h3 className="font-medium text-gray-900">Prévu face au réalisé</h3>
        {passe.length === 0 ? <p className="text-ui-sm text-gray-500">La prévision est photographiée le 1er de chaque mois : la comparaison apparaît à partir du mois prochain.</p> : (
          <table className="w-full text-ui-sm">
            <thead><tr><th className="text-left">Mois</th><th className="text-right">Pessimiste</th><th className="text-right">Réaliste</th><th className="text-right">Optimiste</th><th className="text-right">Facturé</th></tr></thead>
            <tbody>{passe.map((p) => (
              <tr key={p.mois}><td className="capitalize">{libMois(String(p.mois).slice(0, 10))}</td>
                <td className="text-right tabular-nums">{euros(p.prevu.pessimiste)}</td><td className="text-right tabular-nums">{euros(p.prevu.realiste)}</td><td className="text-right tabular-nums">{euros(p.prevu.optimiste)}</td>
                <td className={`text-right tabular-nums ${Number(p.realise) < Number(p.prevu.pessimiste) ? 'text-[rgb(var(--c-danger))]' : ''}`}>{euros(p.realise)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </section>
  )
}

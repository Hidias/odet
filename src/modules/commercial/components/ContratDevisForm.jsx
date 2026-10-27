import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../core/supabase'
import { metierDevis, metiersDesLignes } from '../lib/metierDevis'
import { DUREES, PERIODICITES, conditionsDevis, phraseConditions, lignesAvecFrais, fraisEtablissement, devisAvecContrat, CODE_FRAIS_CONTRAT } from '../../interventions/lib/contrat'

// Contrat de maintenance proposé par le devis (0460) : durée, reconduction, préavis, facturation. Saisi une fois ici,
// imprimé sur le devis (le client signe ces conditions) puis repris tel quel par le contrat préparé à la signature.
// Frais d'établissement : ligne ajoutée selon la durée quand un montant est réglé (Paramètres › Devis), modifiable.

export function useReglagesContrat() {
  const [r, setR] = useState(null)
  useEffect(() => {
    supabase.from('billing_settings').select('contrat_frais_etablissement, contrat_preavis_mois, contrat_reconduction_ans').limit(1).maybeSingle()
      .then(({ data }) => setR(data || {}), () => setR({}))
  }, [])
  return r
}

const champ = 'w-full px-3 py-2 border border-gray-200 rounded-ui-sm text-ui bg-white focus:ring-2 focus:ring-primary-500'

export default function ContratDevisForm({ quote, setQuote, items, setItems, client, reglages, emptyItem, verrouille = false }) {
  const concerne = devisAvecContrat(quote, items, metierDevis, metiersDesLignes)
  const c = conditionsDevis(quote.contrat, reglages || {}, client)
  const presente = (items || []).some((it) => it.code === CODE_FRAIS_CONTRAT)
  // Première apparition du bloc sur un devis sans conditions : conditions par défaut posées, frais ajoutés une fois.
  // Ensuite, une ligne de frais supprimée à la main n'est jamais remise toute seule.
  const pose = useRef(false)
  useEffect(() => {
    if (!concerne || !reglages || verrouille || pose.current || quote.contrat) return
    pose.current = true
    setQuote((prev) => ({ ...prev, contrat: conditionsDevis(prev.contrat, reglages, client) }))
    if (!quote.id) setItems((prev) => lignesAvecFrais(prev, reglages, conditionsDevis(null, reglages, client).duree_ans, { base: emptyItem }))
  }, [concerne, reglages]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!concerne || !reglages) return null

  const set = (k, v) => {
    const suivant = { ...c, [k]: v }
    setQuote((prev) => ({ ...prev, contrat: suivant }))
    if (k === 'duree_ans' && !verrouille && presente) setItems((prev) => lignesAvecFrais(prev, reglages, v, { base: emptyItem }))
  }
  const frais = fraisEtablissement(reglages, c.duree_ans)

  return (
    <div className="bg-white rounded-ui border border-gray-200 p-5 space-y-3">
      <h2 className="font-semibold text-gray-900">Contrat de maintenance</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label htmlFor="ct-duree" className="block text-ui-sm text-gray-500 mb-1">Durée</label>
          <select id="ct-duree" className={champ} disabled={verrouille} value={c.duree_ans} onChange={(e) => set('duree_ans', Number(e.target.value))}>
            {DUREES.map((d) => <option key={d} value={d}>{d} an{d > 1 ? 's' : ''}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ct-reconduction" className="block text-ui-sm text-gray-500 mb-1">À l'échéance</label>
          <select id="ct-reconduction" className={champ} disabled={verrouille} value={c.reconduction ? `oui-${c.reconduction_ans}` : 'non'}
            onChange={(e) => { const v = e.target.value; setQuote((prev) => ({ ...prev, contrat: { ...c, reconduction: v !== 'non', reconduction_ans: v === 'non' ? c.reconduction_ans : Number(v.split('-')[1]) } })) }}>
            {[1, 3, 5].map((n) => <option key={n} value={`oui-${n}`}>Reconduit {n} an{n > 1 ? 's' : ''}</option>)}
            <option value="non">Prend fin</option>
          </select>
        </div>
        <div>
          <label htmlFor="ct-preavis" className="block text-ui-sm text-gray-500 mb-1">Préavis (mois)</label>
          <input id="ct-preavis" type="number" min={0} max={12} className={champ} disabled={verrouille || !c.reconduction} value={c.preavis_mois}
            onChange={(e) => set('preavis_mois', Math.max(0, Math.min(12, Number(e.target.value) || 0)))} />
        </div>
        <div>
          <label htmlFor="ct-periode" className="block text-ui-sm text-gray-500 mb-1">Facturation</label>
          <select id="ct-periode" className={champ} disabled={verrouille} value={c.periodicite} onChange={(e) => set('periodicite', e.target.value)}>
            {PERIODICITES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>
      <p className="text-ui-sm text-gray-600">{phraseConditions(c)}</p>
      {frais === null
        ? <p className="text-ui-sm text-gray-500">Aucuns frais d'établissement réglés pour cette durée (Paramètres › Devis).</p>
        : !presente && <button type="button" className="text-ui-sm text-primary-600 hover:underline" onClick={() => setItems((prev) => lignesAvecFrais(prev, reglages, c.duree_ans, { base: emptyItem }))}>Remettre les frais d'établissement ({frais.toLocaleString('fr-FR')} € HT)</button>}
      <p className="text-ui-sm text-gray-500">À la signature, le contrat est préparé avec ces conditions : la direction le valide en un clic.</p>
    </div>
  )
}

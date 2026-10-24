import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { metiersPourPieces } from '../lib/metierDevis'
import { mentionsDevis, chargerMentionsDevis, INFOS_DISTANCE } from '../lib/mentionsDevis'

// Conditions du devis (0444) : devis établi à distance, particulier démarché, délai, acompte, déchets des travaux.
// Les mentions qui en découlent sont imprimées sur le devis ; ce qui manque est signalé ici, avant l'envoi.

export default function MentionsDevisForm({ quote, setQuote, items, client }) {
  const [md, setMd] = useState({ textes: {}, pieces: [] })
  useEffect(() => { chargerMentionsDevis().then(setMd).catch(() => {}) }, [])
  const metiers = metiersPourPieces(quote, items)
  const a = (m) => metiers.includes(m)
  const particulier = client?.client_type === 'particulier'
  const infos = Array.isArray(quote.a_distance_infos) ? quote.a_distance_infos : []
  const set = (k, v) => setQuote((prev) => ({ ...prev, [k]: v }))
  const basculerInfo = (i) => set('a_distance_infos', infos.includes(i) ? infos.filter((x) => x !== i) : [...infos, i])
  const { avertissements, legal, signature } = mentionsDevis({ quote, items, client, textes: md.textes, pieces: md.pieces })
  const ventesOuTravaux = a('vente') || a('installation')

  return (
    <div className="bg-white rounded-ui border border-gray-200 p-5 space-y-4">
      <h2 className="font-semibold text-gray-900">Conditions du devis</h2>
      <label className="flex items-start gap-2 text-ui text-gray-700">
        <input type="checkbox" className="mt-1 rounded" checked={!!quote.a_distance} onChange={(e) => set('a_distance', e.target.checked)} />
        <span><span className="font-medium">Devis établi à distance</span>, d'après les informations transmises par le client, sous réserve de vérification (tout écart fera l'objet d'un avenant)</span>
      </label>
      {quote.a_distance && (
        <div className="pl-6 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label htmlFor="devis-distance-le" className="block text-ui-sm text-gray-500 mb-1">Informations reçues le</label>
            <input id="devis-distance-le" type="date" className="w-full px-2 py-1.5 border border-gray-200 rounded-ui-sm text-ui" value={quote.a_distance_le || ''} onChange={(e) => set('a_distance_le', e.target.value || null)} />
          </div>
          <fieldset>
            <legend className="block text-ui-sm text-gray-500 mb-1">Informations reçues</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {INFOS_DISTANCE.map((i) => (
                <label key={i} className="flex items-center gap-1.5 text-ui"><input type="checkbox" className="rounded" checked={infos.includes(i)} onChange={() => basculerInfo(i)} />{i}</label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
      {particulier && (
        <label className="flex items-start gap-2 text-ui text-gray-700">
          <input type="checkbox" className="mt-1 rounded" checked={!!quote.hors_etablissement} onChange={(e) => set('hors_etablissement', e.target.checked)} />
          <span><span className="font-medium">Contrat conclu hors établissement ou à distance</span> (chez le client, après démarchage, par téléphone ou en ligne) : rétractation de 14 jours, formulaire joint au devis, aucun paiement avant 7 jours pour un démarchage</span>
        </label>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label htmlFor="devis-delai" className="block text-ui-sm text-gray-500 mb-1">Délai de livraison ou d'intervention</label>
          <input id="devis-delai" className="w-full px-2 py-1.5 border border-gray-200 rounded-ui-sm text-ui" value={quote.delai_execution || ''} onChange={(e) => set('delai_execution', e.target.value)} placeholder="Ex : 3 semaines après la commande" maxLength={200} />
        </div>
        {ventesOuTravaux && (
          <div>
            <label htmlFor="devis-acompte" className="block text-ui-sm text-gray-500 mb-1">Acompte à la commande (%)</label>
            <input id="devis-acompte" inputMode="decimal" className="w-full px-2 py-1.5 border border-gray-200 rounded-ui-sm text-ui" value={quote.acompte_pct ?? ''} onChange={(e) => set('acompte_pct', e.target.value.replace(',', '.'))} placeholder="Vide : aucun acompte annoncé" />
          </div>
        )}
        {a('installation') && (
          <div className="md:col-span-2">
            <label htmlFor="devis-dechets" className="block text-ui-sm text-gray-500 mb-1">Déchets de chantier (quantité estimée, gestion, point de collecte, coût)</label>
            <textarea id="devis-dechets" rows={2} className="w-full px-2 py-1.5 border border-gray-200 rounded-ui-sm text-ui" value={quote.dechets || ''} onChange={(e) => set('dechets', e.target.value)} maxLength={1000} />
          </div>
        )}
      </div>
      {(signature.length > 0 || legal.length > 0) && (
        <details className="text-ui-sm text-gray-600">
          <summary className="cursor-pointer font-medium text-gray-700">Mentions imprimées sur ce devis ({signature.length + legal.length})</summary>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">{[...signature, ...legal].map((m) => <li key={m}>{m}</li>)}</ul>
        </details>
      )}
      {avertissements.length > 0 && (
        <div className="rounded-ui-sm bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] p-3 text-ui-sm">
          <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-[rgb(var(--c-warning))]" aria-hidden="true" />À compléter avant l'envoi</p>
          <ul className="list-disc pl-5 mt-1">{avertissements.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

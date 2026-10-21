import { useMemo } from 'react'
import { subrogationPossible } from '../../../core/financement/subrogation'
import { FINANCEURS_DEVIS } from '../lib/financementDevis'

// Financement prévu dans le devis (0397) : le financeur, son accord et la subrogation, avec la règle du 1er octobre 2026
// expliquée au moment de la saisie. Repris par la session créée depuis le devis.

const TON = {
  possible: 'bg-green-50 border-green-200 text-green-800',
  sur_demande: 'bg-blue-50 border-blue-200 text-blue-800',
  impossible: 'bg-amber-50 border-amber-200 text-amber-900',
  a_verifier: 'bg-amber-50 border-amber-200 text-amber-900',
}

export default function FinancementDevis({ quote, setQuote, clients }) {
  const opcos = useMemo(() => (clients || []).filter((c) => c.client_type === 'opco'), [clients])
  const client = (clients || []).find((c) => c.id === quote.client_id) || null
  const opco = opcos.find((c) => c.id === quote.funding_client_id) || null
  const type = quote.funding_type || ''
  const regle = type === 'opco'
    ? subrogationPossible({ client, dateAccord: quote.funding_agreement_date || quote.quote_date, finOpco: opco?.opco_subrogation_end || null })
    : null
  const maj = (champs) => setQuote((prev) => ({ ...prev, ...champs }))
  const champ = 'w-full px-2 py-1.5 border border-gray-200 rounded-ui-sm text-ui'

  return (
    <div className="bg-white rounded-ui border border-gray-200 p-4">
      <h2 className="font-semibold text-gray-900 mb-1">Financement prévu <span className="font-normal text-ui-sm text-gray-400">(facultatif)</span></h2>
      <p className="text-ui-sm text-gray-500 mb-3">Repris par la session créée depuis ce devis.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-ui-sm text-gray-500 mb-1">Qui paie la formation ?</label>
          <select value={type} className={champ}
            onChange={(e) => maj({ funding_type: e.target.value, ...(e.target.value === 'opco' ? {} : { funding_client_id: '', funding_subrogation: false }) })}>
            {FINANCEURS_DEVIS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        {type === 'opco' && (
          <div>
            <label className="block text-ui-sm text-gray-500 mb-1">OPCO</label>
            {opcos.length ? (
              <select value={quote.funding_client_id || ''} className={champ}
                onChange={(e) => { const o = opcos.find((c) => c.id === e.target.value); maj({ funding_client_id: e.target.value, funding_name: o?.name || '' }) }}>
                <option value="">Choisir l'OPCO</option>
                {opcos.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            ) : (
              <input type="text" value={quote.funding_name || ''} placeholder="Nom de l'OPCO" className={champ}
                onChange={(e) => maj({ funding_name: e.target.value })} />
            )}
          </div>
        )}
        {type && type !== 'opco' && (
          <div>
            <label className="block text-ui-sm text-gray-500 mb-1">Nom du financeur</label>
            <input type="text" value={quote.funding_name || ''} className={champ} onChange={(e) => maj({ funding_name: e.target.value })} />
          </div>
        )}
        {type && (
          <>
            <div>
              <label className="block text-ui-sm text-gray-500 mb-1">N° de dossier ou d'accord</label>
              <input type="text" value={quote.funding_agreement_ref || ''} className={champ} onChange={(e) => maj({ funding_agreement_ref: e.target.value })} />
            </div>
            <div>
              <label className="block text-ui-sm text-gray-500 mb-1">Date de l'accord</label>
              <input type="date" value={quote.funding_agreement_date || ''} className={champ} onChange={(e) => maj({ funding_agreement_date: e.target.value })} />
            </div>
            <div>
              <label className="block text-ui-sm text-gray-500 mb-1">Montant pris en charge (HT)</label>
              <input type="text" inputMode="decimal" value={quote.funding_amount_ht ?? ''} placeholder="Laisser vide si inconnu" className={champ}
                onChange={(e) => maj({ funding_amount_ht: e.target.value })} />
            </div>
          </>
        )}
      </div>
      {regle && (
        <div className={`mt-3 border rounded-ui-sm p-3 text-ui-sm ${TON[regle.etat]}`}>
          <p>{regle.message}{!quote.funding_agreement_date && ' (date du devis prise faute de date d\'accord)'}</p>
          {regle.etat !== 'impossible' && (
            <label className="flex items-center gap-2 mt-2 font-medium">
              <input type="checkbox" checked={!!quote.funding_subrogation} onChange={(e) => maj({ funding_subrogation: e.target.checked })} className="rounded" />
              Subrogation demandée : l'OPCO paie l'organisme directement
            </label>
          )}
        </div>
      )}
    </div>
  )
}

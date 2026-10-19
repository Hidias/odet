import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../../core/supabase'
import { money, fmtDate } from '../../../core/utils'
import { Sheet } from '../../../ui/Sheet'

// Factures d'acompte d'un devis accepté (Facturation fiable, 0368) : suivi (facturé, déduit, restant) et préparation
// d'un brouillon de facture d'acompte par la base, en pourcentage ou en montant TTC réparti par taux de TVA.
// La facture de solde se prépare ensuite depuis « Créer une facture » : les acomptes émis y sont déduits.

export default function AcompteDevis({ quote, onClose }) {
  const navigate = useNavigate()
  const [suivi, setSuivi] = useState(null)
  const [mode, setMode] = useState('pourcentage')
  const [valeur, setValeur] = useState('30')
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    supabase.rpc('billing_deposit_summary', { p_quote: quote.id }).then(({ data, error }) => {
      if (error) { toast.error(error.message); onClose(); return }
      setSuivi(data)
    })
  }, [quote.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const v = parseFloat(String(valeur).replace(',', '.'))
  const restant = suivi ? Math.max(0, Math.round((Number(suivi.devis_ttc) - Number(suivi.acomptes_ttc)) * 100) / 100) : 0
  const montant = !Number.isFinite(v) || v <= 0 ? 0 : mode === 'pourcentage' ? Math.round(Number(suivi?.devis_ttc || 0) * v) / 100 : v
  const ok = montant > 0 && montant <= restant + 0.01 && (mode !== 'pourcentage' || v <= 100)

  const preparer = async () => {
    setEnCours(true)
    const { data, error } = await supabase.rpc('billing_create_deposit', {
      p_quote: quote.id, p_percent: mode === 'pourcentage' ? v : null, p_amount_ttc: mode === 'montant' ? v : null,
    })
    setEnCours(false)
    if (error) { toast.error(error.message); return }
    toast.success("Brouillon de facture d'acompte préparé : vérifiez puis émettez")
    onClose()
    navigate('/factures?open=' + data)
  }

  return (
    <Sheet title={`Acompte sur le devis ${quote.reference}`} size="md" onClose={() => !enCours && onClose()}
      footer={<>
        <button type="button" className="btn btn-secondary" disabled={enCours} onClick={onClose}>Revenir</button>
        <button type="button" className="btn btn-primary" disabled={!suivi || !ok || enCours} onClick={preparer}>{enCours ? 'Préparation…' : "Préparer la facture d'acompte"}</button>
      </>}>
      {!suivi ? <p className="text-gray-500">Chargement…</p> : (
        <>
          <p className="text-gray-700">Tout acompte reçu avant la prestation se facture. Il sera déduit de la facture de solde, préparée ensuite depuis « Créer une facture ».</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ui">
            <dt className="text-gray-500">Devis TTC</dt><dd className="tabular-nums">{money(suivi.devis_ttc)}</dd>
            <dt className="text-gray-500">Acomptes facturés</dt><dd className="tabular-nums">{money(suivi.acomptes_ttc)}</dd>
            <dt className="text-gray-500">Restant</dt><dd className="tabular-nums font-semibold">{money(restant)}</dd>
          </dl>
          {(suivi.acomptes || []).length > 0 && (
            <ul className="divide-y hairline text-ui-sm">
              {suivi.acomptes.map((a) => (
                <li key={a.id} className="py-1.5 flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.emise ? a.reference : 'Brouillon'}</span>
                  <span className="text-gray-500">{fmtDate(a.date)}</span>
                  <span className="tabular-nums">{money(a.ttc)}</span>
                  {a.deduite && <span className="badge badge-success">Déduit du solde</span>}
                  {Number(a.credite) > 0.01 && <span className="badge badge-warning">Annulé par avoir</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-2" role="radiogroup" aria-label="Montant de l'acompte">
            <label className="flex items-center gap-2">
              <input type="radio" name="mode-acompte" checked={mode === 'pourcentage'} onChange={() => { setMode('pourcentage'); setValeur('30') }} />
              <span>Pourcentage du devis</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="mode-acompte" checked={mode === 'montant'} onChange={() => { setMode('montant'); setValeur('') }} />
              <span>Montant TTC encaissé</span>
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="number" min="0" step="0.01" className="input" style={{ width: 140 }} value={valeur} aria-label={mode === 'pourcentage' ? 'Pourcentage' : 'Montant TTC'}
              onChange={(e) => setValeur(e.target.value)} />
            <span>{mode === 'pourcentage' ? '%' : '€ TTC'}</span>
            {mode === 'pourcentage' && montant > 0 && <span className="text-ui-sm text-gray-500">soit {money(montant)} TTC</span>}
          </label>
          {montant > restant + 0.01 && <p className="text-ui-sm text-[rgb(var(--c-danger))]">Au-delà du restant du devis.</p>}
        </>
      )}
    </Sheet>
  )
}

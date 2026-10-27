import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../supabase'
import { Field } from '../shared'

// Contrats de maintenance (0460) : frais d'établissement par durée (ligne ajoutée au devis), préavis et période de
// reconduction proposés par défaut. Aucun montant par défaut : l'entreprise saisit les siens.

export default function ReglagesContrats() {
  const [r, setR] = useState(null)
  const [f, setF] = useState({ 1: '', 3: '', 5: '', preavis: 3, reconduction: 1 })
  const [occupe, setOccupe] = useState(false)
  useEffect(() => {
    supabase.from('billing_settings').select('company_id, contrat_frais_etablissement, contrat_preavis_mois, contrat_reconduction_ans').limit(1).maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) return
        setR(data)
        const fe = data.contrat_frais_etablissement || {}
        setF({ 1: fe['1'] ?? '', 3: fe['3'] ?? '', 5: fe['5'] ?? '', preavis: data.contrat_preavis_mois ?? 3, reconduction: data.contrat_reconduction_ans ?? 1 })
      }, () => {})
  }, [])
  if (!r) return null

  const montant = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null }
  const enregistrer = async () => {
    const frais = Object.fromEntries([1, 3, 5].map((d) => [String(d), montant(f[d])]).filter(([, v]) => v !== null))
    setOccupe(true)
    const { error } = await supabase.from('billing_settings').update({
      contrat_frais_etablissement: frais, contrat_preavis_mois: Math.max(0, Math.min(12, Number(f.preavis) || 0)),
      contrat_reconduction_ans: [1, 3, 5].includes(Number(f.reconduction)) ? Number(f.reconduction) : 1, updated_at: new Date().toISOString(),
    }).eq('company_id', r.company_id)
    setOccupe(false)
    if (error) return toast.error(error.message)
    toast.success('Réglages des contrats enregistrés')
  }

  return (
    <>
      <h2 className="section-title">Contrats de maintenance</h2>
      <p className="text-ui-sm text-gray-500 -mt-2 mb-3">Frais d'établissement ajoutés au devis selon la durée du contrat (laisser vide : aucune ligne). Préavis et reconduction proposés sur chaque nouveau devis, modifiables devis par devis.</p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[1, 3, 5].map((d) => (
          <Field key={d} label={`Frais, contrat de ${d} an${d > 1 ? 's' : ''} (€ HT)`}>
            <input className="input" inputMode="decimal" value={f[d]} onChange={(e) => setF({ ...f, [d]: e.target.value })} />
          </Field>
        ))}
        <Field label="Préavis (mois)"><input className="input" type="number" min={0} max={12} value={f.preavis} onChange={(e) => setF({ ...f, preavis: e.target.value })} /></Field>
        <Field label="Reconduction par période de">
          <select className="select" value={f.reconduction} onChange={(e) => setF({ ...f, reconduction: e.target.value })}>
            {[1, 3, 5].map((n) => <option key={n} value={n}>{n} an{n > 1 ? 's' : ''}</option>)}
          </select>
        </Field>
      </div>
      <div className="mt-3"><button type="button" className="btn btn-secondary" disabled={occupe} onClick={enregistrer}>Enregistrer</button></div>
    </>
  )
}

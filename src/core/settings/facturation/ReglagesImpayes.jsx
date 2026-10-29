import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../supabase'
import { Field } from '../shared'

// Impayés (0469) : paliers de relance, mise en demeure, taux directeur de la BCE pour calculer les intérêts de retard.
// Aucun taux par défaut : sans taux saisi, la mise en demeure indique « montant à calculer ».

const URL_BCE = 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.fr.html'

export default function ReglagesImpayes() {
  const [r, setR] = useState(null)
  const [f, setF] = useState({ paliers: '7, 15, 30', md: '45', bce: '', bce_au: '' })
  const [occupe, setOccupe] = useState(false)
  useEffect(() => {
    supabase.from('billing_settings').select('company_id, relance_paliers, mise_en_demeure_jours, taux_bce, taux_bce_au').limit(1).maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) return
        setR(data)
        setF({ paliers: (data.relance_paliers || []).join(', '), md: data.mise_en_demeure_jours ?? '', bce: data.taux_bce ?? '', bce_au: data.taux_bce_au || '' })
      }, () => {})
  }, [])
  if (!r) return null
  const enregistrer = async () => {
    const paliers = [...new Set(String(f.paliers).split(/[,; ]+/).map((x) => parseInt(x, 10)).filter((x) => x > 0 && x <= 365))].sort((a, b) => a - b)
    const bce = String(f.bce).trim() === '' ? null : Number(String(f.bce).replace(',', '.'))
    if (bce !== null && !Number.isFinite(bce)) return toast.error('Taux BCE invalide')
    if (bce !== null && !f.bce_au) return toast.error('Indiquez la date du taux BCE saisi')
    setOccupe(true)
    const { error } = await supabase.from('billing_settings').update({
      relance_paliers: paliers.length ? paliers : [7, 15, 30], mise_en_demeure_jours: String(f.md).trim() === '' ? null : Math.max(1, Math.min(365, Number(f.md) || 45)),
      taux_bce: bce, taux_bce_au: bce === null ? null : f.bce_au, updated_at: new Date().toISOString(),
    }).eq('company_id', r.company_id)
    setOccupe(false)
    if (error) return toast.error(error.message)
    toast.success('Réglages des impayés enregistrés')
  }
  return (
    <>
      <h2 className="section-title">Relances d'impayés</h2>
      <p className="text-ui-sm text-gray-500 -mt-2 mb-3">Chaque nuit, les relances des factures échues sont préparées dans « Relances à valider », sur un ton qui monte d'un palier à l'autre, puis la mise en demeure. Rien n'est envoyé sans vous. Valeurs proposées par défaut : J+7, J+15, J+30, mise en demeure à J+45.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Field label="Relances (jours après l'échéance)"><input className="input" value={f.paliers} onChange={(e) => setF({ ...f, paliers: e.target.value })} /></Field>
        <Field label="Mise en demeure (jours)" hint="Vide : jamais"><input className="input" type="number" min={1} max={365} value={f.md} onChange={(e) => setF({ ...f, md: e.target.value })} /></Field>
        <Field label="Taux BCE, refinancement (%)" hint="Sert au calcul des intérêts de retard"><input className="input" inputMode="decimal" value={f.bce} onChange={(e) => setF({ ...f, bce: e.target.value })} /></Field>
        <Field label="Taux en vigueur au" hint="1er janvier ou 1er juillet du semestre"><input className="input" type="date" value={f.bce_au} onChange={(e) => setF({ ...f, bce_au: e.target.value })} /></Field>
      </div>
      <p className="text-ui-sm text-gray-500 mt-2">Taux de l'opération principale de refinancement, à relever sur le site de la <a className="text-accent-700 hover:underline" href={URL_BCE} target="_blank" rel="noreferrer">Banque centrale européenne</a> : celui du 1er janvier vaut pour le premier semestre, celui du 1er juillet pour le second. Professionnels : taux majoré de 10 points (art. L441-10 du code de commerce) et indemnité de 40 € ; clients publics : majoré de 8 points (code de la commande publique) ; particuliers : intérêts au taux légal à compter de la mise en demeure, sans indemnité.</p>
      <div className="mt-3"><button type="button" className="btn btn-secondary" disabled={occupe} onClick={enregistrer}>Enregistrer</button></div>
    </>
  )
}

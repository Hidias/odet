import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../supabase'
import { Field } from '../shared'

// Contrats de maintenance (0460) : frais d'établissement par durée (ligne ajoutée au devis), préavis et période de
// reconduction proposés par défaut. Aucun montant par défaut : l'entreprise saisit les siens.
// 0463 : prix de l'inventaire initial, délai de déduction, prix par appareil et par an pour chaque type de matériel
// (base du « prix d'après le parc » ; un tarif propre au client passe avant).

export default function ReglagesContrats() {
  const [r, setR] = useState(null)
  const [f, setF] = useState({ 1: '', 3: '', 5: '', preavis: 3, reconduction: 1, inventaire: '', deduction: 30 })
  const [types, setTypes] = useState([])
  const [prix, setPrix] = useState({})
  const [occupe, setOccupe] = useState(false)
  useEffect(() => {
    supabase.from('billing_settings').select('company_id, contrat_frais_etablissement, contrat_preavis_mois, contrat_reconduction_ans, contrat_prix_inventaire, contrat_deduction_jours').limit(1).maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) return
        setR(data)
        const fe = data.contrat_frais_etablissement || {}
        setF({ 1: fe['1'] ?? '', 3: fe['3'] ?? '', 5: fe['5'] ?? '', preavis: data.contrat_preavis_mois ?? 3, reconduction: data.contrat_reconduction_ans ?? 1,
          inventaire: data.contrat_prix_inventaire ?? '', deduction: data.contrat_deduction_jours ?? 30 })
        supabase.from('itv_equipment_types').select('id, name, family').eq('is_active', true).order('family').order('name').then(({ data: t }) => setTypes(t || []), () => {})
        supabase.from('itv_type_prices').select('type_id, price_ht').eq('company_id', data.company_id)
          .then(({ data: p }) => setPrix(Object.fromEntries((p || []).map((x) => [x.type_id, String(x.price_ht)]))), () => {})
      }, () => {})
  }, [])
  if (!r) return null

  const montant = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null }
  const montantOuZero = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null }
  const enregistrer = async () => {
    const frais = Object.fromEntries([1, 3, 5].map((d) => [String(d), montant(f[d])]).filter(([, v]) => v !== null))
    setOccupe(true)
    const { error } = await supabase.from('billing_settings').update({
      contrat_frais_etablissement: frais, contrat_preavis_mois: Math.max(0, Math.min(12, Number(f.preavis) || 0)),
      contrat_reconduction_ans: [1, 3, 5].includes(Number(f.reconduction)) ? Number(f.reconduction) : 1,
      contrat_prix_inventaire: String(f.inventaire).trim() === '' ? null : montantOuZero(f.inventaire),
      contrat_deduction_jours: Math.max(0, Math.min(365, Number(f.deduction) || 0)), updated_at: new Date().toISOString(),
    }).eq('company_id', r.company_id)
    if (error) { setOccupe(false); return toast.error(error.message) }
    const aGarder = types.filter((t) => String(prix[t.id] ?? '').trim() !== '' && montantOuZero(prix[t.id]) !== null)
      .map((t) => ({ company_id: r.company_id, type_id: t.id, price_ht: montantOuZero(prix[t.id]), updated_at: new Date().toISOString() }))
    const aRetirer = types.filter((t) => String(prix[t.id] ?? '').trim() === '').map((t) => t.id)
    const e1 = aGarder.length ? (await supabase.from('itv_type_prices').upsert(aGarder, { onConflict: 'company_id,type_id' })).error : null
    const e2 = aRetirer.length ? (await supabase.from('itv_type_prices').delete().eq('company_id', r.company_id).in('type_id', aRetirer)).error : null
    setOccupe(false)
    if (e1 || e2) return toast.error((e1 || e2).message)
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
      <h3 className="font-medium text-gray-900 mt-5 mb-1">Inventaire initial</h3>
      <p className="text-ui-sm text-gray-500 mb-3">Visite d'inventaire facturée à ce prix (laisser vide : la facture d'inventaire ne se prépare pas). Si le contrat est signé dans le délai après l'inventaire, la première échéance le déduit.</p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Field label="Prix de l'inventaire (€ HT)"><input className="input" inputMode="decimal" value={f.inventaire} onChange={(e) => setF({ ...f, inventaire: e.target.value })} /></Field>
        <Field label="Déduit si contrat signé sous (jours)"><input className="input" type="number" min={0} max={365} value={f.deduction} onChange={(e) => setF({ ...f, deduction: e.target.value })} /></Field>
      </div>
      {types.length > 0 && (
        <>
          <h3 className="font-medium text-gray-900 mt-5 mb-1">Prix par appareil et par an</h3>
          <p className="text-ui-sm text-gray-500 mb-3">Sert au « prix d'après le parc » sur chaque contrat. Un tarif propre au client (fiche client, tarifs) passe avant. Laisser vide : type sans prix, signalé sur le contrat.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
            {types.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-ui-sm">
                <span className="flex-1 text-gray-800">{t.name}<span className="text-gray-400"> · {t.family}</span></span>
                <input className="input w-28 text-right" inputMode="decimal" aria-label={`Prix par appareil, ${t.name}`} value={prix[t.id] ?? ''} onChange={(e) => setPrix({ ...prix, [t.id]: e.target.value })} />
                <span className="text-gray-500 w-12">€ HT</span>
              </label>
            ))}
          </div>
        </>
      )}
      <div className="mt-3"><button type="button" className="btn btn-secondary" disabled={occupe} onClick={enregistrer}>Enregistrer</button></div>
    </>
  )
}

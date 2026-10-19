import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../supabase'
import { Field } from '../shared'

// Paramètres › Banque et facturation › Numérotation (réglages de facturation de la société, 0360).
// Le numéro est donné par la base à l'émission (billing_issue). Une société qui existait avant l'outil reprend la suite
// de ses numéros : saisir le numéro de sa dernière facture (et de son dernier avoir). Vide : en attendant, la suite des
// numéros déjà présents dans l'outil.
// Le réglage n'est plus modifiable une fois qu'un document a été émis par la base (le compteur est lancé).

export default function NumerotationFactures() {
  const [r, setR] = useState(null)
  const [lance, setLance] = useState({ invoice: false, credit_note: false })
  const [prochain, setProchain] = useState({})
  const [occupe, setOccupe] = useState(false)
  const [indispo, setIndispo] = useState(false)

  const charger = async () => {
    const { data, error } = await supabase.from('billing_settings').select('*').limit(1).maybeSingle()
    if (error || !data) { setIndispo(true); return }
    setR(data)
    const { data: seq } = await supabase.from('billing_sequences').select('series').eq('company_id', data.company_id)
    setLance({ invoice: (seq || []).some((x) => x.series === 'invoice'), credit_note: (seq || []).some((x) => x.series === 'credit_note') })
    const [a, b] = await Promise.all([
      supabase.rpc('billing_next_number', { p_type: 'invoice' }),
      supabase.rpc('billing_next_number', { p_type: 'credit_note' }),
    ])
    setProchain({ invoice: a.data || '', credit_note: b.data || '' })
  }
  useEffect(() => { charger() }, [])

  if (indispo) return <p className="text-ui-sm text-gray-500">La numérotation par la base n'est pas encore installée.</p>
  if (!r) return null

  const set = (k, v) => setR({ ...r, [k]: v })
  const entier = (v) => (v === '' || v === null || v === undefined ? null : Math.max(0, parseInt(v, 10) || 0))
  const enregistrer = async () => {
    setOccupe(true)
    const { error } = await supabase.from('billing_settings').update({
      invoice_prefix: (r.invoice_prefix || '').trim().toUpperCase(), credit_prefix: (r.credit_prefix || '').trim().toUpperCase(),
      number_format: r.number_format, invoice_last_number_before: entier(r.invoice_last_number_before),
      credit_last_number_before: entier(r.credit_last_number_before), updated_at: new Date().toISOString(),
    }).eq('company_id', r.company_id)
    setOccupe(false)
    if (error) return toast.error(error.message)
    toast.success('Numérotation enregistrée')
    charger()
  }

  return (
    <>
      <h2 className="section-title">Numérotation des factures et des avoirs</h2>
      <p className="text-ui-sm text-gray-500">Le numéro est donné à l'émission, sans trou ni doublon. Pour une société qui facturait déjà, indiquez le numéro de sa dernière facture : la première facture émise ici prendra le suivant.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Préfixe des factures"><input className="input" value={r.invoice_prefix || ''} disabled={lance.invoice} onChange={(e) => set('invoice_prefix', e.target.value)} /></Field>
        <Field label="Préfixe des avoirs"><input className="input" value={r.credit_prefix || ''} disabled={lance.credit_note} onChange={(e) => set('credit_prefix', e.target.value)} /></Field>
        <Field label="Format du numéro" className="md:col-span-2" hint="{PREFIXE}, {AAAAMMJJ}, {AAAA}, {MM}, {JJ}, et le compteur {N5} (5 chiffres) ou {N}">
          <input className="input" value={r.number_format || ''} disabled={lance.invoice || lance.credit_note} onChange={(e) => set('number_format', e.target.value)} />
        </Field>
        <Field label="Numéro de la dernière facture avant l'outil" hint={lance.invoice ? 'Compteur lancé : ne se modifie plus' : 'Vide : suite des numéros déjà présents dans l\'outil'}>
          <input className="input" inputMode="numeric" value={r.invoice_last_number_before ?? ''} disabled={lance.invoice} onChange={(e) => set('invoice_last_number_before', e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Numéro du dernier avoir avant l'outil" hint={lance.credit_note ? 'Compteur lancé : ne se modifie plus' : 'Vide : suite des numéros déjà présents dans l\'outil'}>
          <input className="input" inputMode="numeric" value={r.credit_last_number_before ?? ''} disabled={lance.credit_note} onChange={(e) => set('credit_last_number_before', e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
      <p className="text-ui-sm text-gray-600">Prochaine facture : <span className="font-medium">{prochain.invoice || '…'}</span> · prochain avoir : <span className="font-medium">{prochain.credit_note || '…'}</span></p>
      {!(lance.invoice && lance.credit_note) && (
        <div><button type="button" className="btn btn-secondary" disabled={occupe} onClick={enregistrer}>Enregistrer la numérotation</button></div>
      )}
    </>
  )
}

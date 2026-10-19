import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../supabase'
import { Field } from '../shared'

// Paramètres › Banque et facturation › Transmission au comptable (réglages de facturation de la société, 0366).
// Rien n'est supposé : sans mode choisi, l'envoi au comptable reste désactivé. Seuls les documents émis partent.
// Le destinataire est celui de « Accès comptable » (adresse du comptable).

const MODES = [
  ['', 'Non réglé (envoi désactivé)'],
  ['email_facturx', 'Email mensuel : récapitulatif et Factur-X de chaque facture'],
  ['email_pdf', 'Email mensuel : récapitulatif et PDF simple de chaque facture'],
]

export default function TransmissionComptable() {
  const [r, setR] = useState(null)
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    supabase.from('billing_settings').select('company_id, comptable_transmission, plateforme_agreee').limit(1).maybeSingle()
      .then(({ data, error }) => { if (!error && data) setR(data) })
  }, [])
  if (!r) return null

  const enregistrer = async () => {
    setOccupe(true)
    const { error } = await supabase.from('billing_settings').update({
      comptable_transmission: r.comptable_transmission || null,
      plateforme_agreee: (r.plateforme_agreee || '').trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('company_id', r.company_id)
    setOccupe(false)
    if (error) return toast.error(error.message)
    toast.success('Transmission enregistrée')
  }

  return (
    <>
      <h2 className="section-title">Transmission au comptable</h2>
      <p className="text-ui-sm text-gray-500">Depuis Budget › Envoi au comptable. Seules les factures et les avoirs émis partent, jamais un brouillon.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Mode de transmission">
          <select className="select" value={r.comptable_transmission || ''} onChange={(e) => setR({ ...r, comptable_transmission: e.target.value })}>
            {MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Plateforme de dématérialisation" hint="Plateforme agréée retenue pour la facture électronique (renseignement ; le branchement viendra plus tard)">
          <input className="input" value={r.plateforme_agreee || ''} onChange={(e) => setR({ ...r, plateforme_agreee: e.target.value })} />
        </Field>
      </div>
      <div><button type="button" className="btn btn-secondary" disabled={occupe} onClick={enregistrer}>Enregistrer la transmission</button></div>
    </>
  )
}

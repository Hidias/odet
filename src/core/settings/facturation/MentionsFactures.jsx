import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../supabase'
import { Field, Toggle } from '../shared'

// Paramètres › Banque et facturation › Mentions des factures (réglages de facturation de la société, 0363).
// Aucune phrase légale dans le code : les textes changent avec la loi (recodification de la TVA au 01/01/2027).
// Les mentions sont figées sur chaque facture au moment de son émission ; changer un texte ici ne modifie jamais une
// facture déjà émise.

const TEXTES = [
  ['mention_escompte', 'Escompte pour paiement anticipé', 'Clients professionnels'],
  ['mention_penalites', 'Pénalités de retard', 'Clients professionnels'],
  ['mention_indemnite', 'Indemnité forfaitaire de recouvrement', 'Clients professionnels seulement (jamais pour un particulier)'],
  ['mention_franchise', 'Franchise en base de TVA', 'Si l\'organisme n\'applique pas la TVA (Identité)'],
  ['mention_autoliquidation', 'Autoliquidation', 'Lignes au régime « Autoliquidation »'],
  ['mention_exoneration', 'Exonération de la formation', 'Lignes au régime « Exonérée », avec l\'attestation ci-dessous'],
  ['mention_debits', 'Option pour la TVA sur les débits', 'Si l\'option est cochée'],
]

export default function MentionsFactures() {
  const [r, setR] = useState(null)
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    supabase.from('billing_settings').select('*').limit(1).maybeSingle().then(({ data }) => {
      if (data && 'mention_escompte' in data) setR(data)
    })
  }, [])
  if (!r) return null

  const set = (k, v) => setR({ ...r, [k]: v })
  const enregistrer = async () => {
    setOccupe(true)
    const patch = Object.fromEntries(TEXTES.map(([k]) => [k, (r[k] || '').trim()]))
    const { error } = await supabase.from('billing_settings').update({
      ...patch, option_debits: !!r.option_debits, exoneration_formation_active: !!r.exoneration_formation_active,
      exoneration_attestation_ref: (r.exoneration_attestation_ref || '').trim() || null,
      exoneration_attestation_date: r.exoneration_attestation_date || null, updated_at: new Date().toISOString(),
    }).eq('company_id', r.company_id)
    setOccupe(false)
    if (error) return toast.error(error.message)
    toast.success('Mentions enregistrées')
  }

  return (
    <>
      <h2 className="section-title">Mentions des factures</h2>
      <p className="text-ui-sm text-gray-500">Imprimées selon le client et le régime de chaque ligne, puis figées sur la facture à son émission.</p>
      <div className="grid grid-cols-1 gap-4">
        {TEXTES.map(([k, label, hint]) => (
          <Field key={k} label={label} hint={hint}>
            <textarea className="input" rows={2} value={r[k] || ''} onChange={(e) => set(k, e.target.value)} />
          </Field>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Toggle checked={!!r.option_debits} onChange={(v) => set('option_debits', v)} label="Option pour la TVA sur les débits" hint="À cocher seulement si l'organisme a pris cette option auprès des impôts" />
        <Toggle checked={!!r.exoneration_formation_active} onChange={(v) => set('exoneration_formation_active', v)} label="Exonération de TVA de la formation" hint="Seulement avec une attestation de la DREETS (formulaire 3511-SD) ; elle s'impose alors à toutes les formations" />
        {r.exoneration_formation_active && (
          <>
            <Field label="Référence de l'attestation"><input className="input" value={r.exoneration_attestation_ref || ''} onChange={(e) => set('exoneration_attestation_ref', e.target.value)} /></Field>
            <Field label="Date de l'attestation"><input type="date" className="input" value={r.exoneration_attestation_date || ''} onChange={(e) => set('exoneration_attestation_date', e.target.value)} /></Field>
          </>
        )}
      </div>
      <div><button type="button" className="btn btn-secondary" disabled={occupe} onClick={enregistrer}>Enregistrer les mentions</button></div>
    </>
  )
}

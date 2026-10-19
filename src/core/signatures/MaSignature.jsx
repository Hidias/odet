import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { PenLine } from 'lucide-react'
import { useAuthStore } from '../store'
import PadSimple from '../../ui/signature/PadSimple'
import { chargerSignatures, enregistrerMaSignature, retirerMaSignature } from './signatures'

// Ma signature, dessinée une fois (0387) : reprise sur les documents que je signe (titres d'habilitation et
// autorisations de conduite, plus tard certificats et attestations). Décision de H du 19/10.
export default function MaSignature({ companyId, compact = false, onSaved = null }) {
  const profile = useAuthStore((s) => s.profile)
  const [actuelle, setActuelle] = useState(undefined)
  const [image, setImage] = useState(null)
  const [titre, setTitre] = useState('')
  const [refaire, setRefaire] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!companyId || !profile?.id) return
    chargerSignatures(companyId).then((l) => {
      const m = l.find((s) => s.profile_id === profile.id) || null
      setActuelle(m); setTitre(m?.signer_title || profile?.job_title || '')
    }).catch(() => setActuelle(null))
  }, [companyId, profile?.id])
  if (actuelle === undefined || !profile?.id) return null
  const enregistrer = async () => {
    if (!image) { toast.error('Signez dans le cadre'); return }
    setBusy(true)
    try {
      await enregistrerMaSignature({ companyId, profileId: profile.id, image, signerTitle: titre })
      toast.success('Signature enregistrée')
      setActuelle({ image, signer_title: titre }); setRefaire(false); setImage(null)
      onSaved?.()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  const retirer = async () => {
    try { await retirerMaSignature({ companyId, profileId: profile.id }); setActuelle(null); toast.success('Signature retirée') } catch (e) { toast.error(e.message) }
  }
  return (
    <section className={compact ? 'space-y-2' : 'card space-y-2'}>
      <h2 className="section-title flex items-center gap-2"><PenLine className="w-4 h-4 text-gray-400" aria-hidden="true" />Ma signature</h2>
      <p className="text-ui-sm muted">Dessinée une fois, elle est posée sur les documents que vous signez (titres d'habilitation, autorisations de conduite, certificats). Vous seul pouvez la modifier.</p>
      {actuelle && !refaire ? (
        <div className="flex flex-wrap items-center gap-3">
          <img src={actuelle.image} alt="Votre signature" className="h-16 max-w-[220px] border rounded-ui-sm bg-white p-1 object-contain" />
          <div className="text-ui-sm text-gray-600">{actuelle.signer_title || ''}</div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRefaire(true)}>Refaire</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={retirer}>Retirer</button>
        </div>
      ) : (
        <div className="space-y-2 max-w-md">
          <PadSimple onChange={setImage} />
          <label className="block"><span className="label">Qualité (sous la signature)</span>
            <input className="input" value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Ex. : Gérant" maxLength={120} /></label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={enregistrer} disabled={busy}>Enregistrer ma signature</button>
            {actuelle && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRefaire(false)}>Annuler</button>}
          </div>
        </div>
      )}
    </section>
  )
}

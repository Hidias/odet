import { useEffect, useState } from 'react'
import { FileText, Loader2, PenLine, ShieldCheck, X } from 'lucide-react'
import PadSimple from '../../../ui/signature/PadSimple'
import { empreinte } from '../../../core/portail/journal'
import { rechargerSiMiseAJour } from '../../../core/errors/chunkReload'

// Décharge « numéro de sécurité sociale non communiqué » signée depuis le portail stagiaire (0436, décision de H du
// 22/10). Le stagiaire ouvre et lit la décharge pré-remplie, coche son accord et signe à l'écran ; l'empreinte du PDF
// présenté part avec la signature, l'organisme est prévenu et l'entreprise la reçoit après la formation.

export const ACCORD_DECHARGE = "J'ai lu la décharge. Je ne communique pas mon numéro de sécurité sociale : la formation ne sera pas déclarée par l'organisme dans mon passeport de prévention, la déclaration revient à mon employeur."

function enBlob(base64) {
  const bin = atob(base64)
  const o = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i)
  return new Blob([o], { type: 'application/pdf' })
}

/** genererPdf() → base64 de la décharge pré-remplie ; onSigner({ signature, sha256, nom }) ; nom : nom du stagiaire */
export default function DechargeNir({ genererPdf, nom, onSigner, onPlusTard }) {
  const [pdf, setPdf] = useState(null)
  const [lu, setLu] = useState(false)
  const [accepte, setAccepte] = useState(false)
  const [trace, setTrace] = useState(null)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')

  useEffect(() => {
    let url = null
    genererPdf().then((b64) => {
      url = URL.createObjectURL(enBlob(b64))
      setPdf({ base64: b64, url })
    }).catch((e) => { if (!rechargerSiMiseAJour(e)) setErreur('La décharge ne peut pas être affichée.') })
    return () => { if (url) URL.revokeObjectURL(url) }
    // Décharge préparée une seule fois : c'est ce document exact qui est lu puis signé
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signer = async () => {
    setEnvoi(true); setErreur('')
    try {
      const sha = await empreinte(pdf.base64)
      if (!sha) throw new Error('Empreinte du document impossible sur ce navigateur')
      await onSigner({ signature: trace, sha256: sha, nom })
    } catch (e) {
      setErreur(e.message || 'Signature impossible, réessayez.')
      setEnvoi(false)
    }
  }

  const pret = pdf && lu && accepte && trace && !envoi
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="titre-decharge">
      <div className="bg-white w-full sm:max-w-lg rounded-t-ui-lg sm:rounded-ui-lg max-h-[92vh] overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="titre-decharge" className="font-display text-lg font-semibold text-gray-900 flex items-center gap-2"><PenLine className="w-5 h-5 text-accent-600" aria-hidden="true" />Décharge à signer</h2>
            <p className="text-sm text-gray-500">Numéro de sécurité sociale non communiqué</p>
          </div>
          <button type="button" onClick={onPlusTard} className="p-1 text-gray-400 hover:text-gray-700" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-700">
            Vous ne communiquez pas votre numéro de sécurité sociale. Sans lui, nous ne pouvons pas déclarer cette formation dans votre passeport de prévention : votre employeur s'en chargera.
            Merci de lire et de signer la décharge ci-dessous ; vous pouvez revenir sur ce choix à tout moment.
          </p>
          <div>
            <p className="text-sm font-medium text-gray-800">1. Ouvrez et lisez la décharge</p>
            {pdf ? (
              <a href={pdf.url} target="_blank" rel="noreferrer" onClick={() => setLu(true)} className="mt-2 btn btn-secondary w-full justify-center gap-2">
                <FileText className="w-4 h-4" aria-hidden="true" />Ouvrir la décharge (PDF)
              </a>
            ) : !erreur && <p className="mt-2 text-sm text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Préparation du document…</p>}
            {pdf && !lu && <p className="mt-1 text-xs text-accent-700">Ouvrez le document et lisez-le : la signature n'est possible qu'ensuite.</p>}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800 mb-2">2. Signez dans le cadre</p>
            <PadSimple onChange={setTrace} hauteur={150} label="Signez avec le doigt ou la souris" />
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1 rounded" checked={accepte} onChange={(e) => setAccepte(e.target.checked)} />
            <span>{ACCORD_DECHARGE}</span>
          </label>
          {erreur && <p role="alert" className="text-sm text-[rgb(var(--c-danger))]">{erreur}</p>}
          <button type="button" onClick={signer} disabled={!pret} className="btn btn-primary w-full justify-center h-11 gap-2">
            {envoi ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <PenLine className="w-4 h-4" aria-hidden="true" />}Signer la décharge
          </button>
          <button type="button" onClick={onPlusTard} className="btn btn-secondary w-full justify-center">Plus tard</button>
          <p className="text-xs text-gray-400 flex items-start gap-1.5"><ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            Signature électronique simple : la date, l'heure, l'adresse IP, l'appareil et l'empreinte du document sont enregistrés comme preuve.</p>
        </div>
      </div>
    </div>
  )
}

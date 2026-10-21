// Signature de la convention depuis l'espace client (0402). Le client lit le PDF exact qu'il signe, coche son
// accord et signe à l'écran ; l'empreinte SHA-256 de ce PDF part avec la signature. La base relève l'adresse IP et
// l'appareil, marque la session « convention signée » et prévient l'organisme.

import { useEffect, useState } from 'react'
import { FileText, Loader2, PenLine, ShieldCheck, X } from 'lucide-react'
import PadSimple from '../../../ui/signature/PadSimple'
import { empreinte } from '../../../core/portail/journal'

export const ACCORD_SIGNATURE = "J'ai lu la convention de formation ci-dessus et je l'accepte au nom de mon entreprise. Je reconnais que cette signature électronique m'engage comme une signature manuscrite."

function enBlob(base64) {
  const bin = atob(base64)
  const o = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i)
  return new Blob([o], { type: 'application/pdf' })
}

export default function SignerConvention({ session, genererPdf, signataire, onSigner, onFermer }) {
  const [pdf, setPdf] = useState(null) // { base64, url, filename }
  const [nom, setNom] = useState(signataire?.name || '')
  const [fonction, setFonction] = useState(signataire?.role || '')
  const [accord, setAccord] = useState(false)
  const [lu, setLu] = useState(false)
  const [trace, setTrace] = useState(null)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')

  useEffect(() => {
    let url = null
    genererPdf().then((out) => {
      if (!out) { setErreur('La convention ne peut pas être affichée.'); return }
      url = URL.createObjectURL(enBlob(out.base64))
      setPdf({ base64: out.base64, url, filename: out.filename })
    }).catch(() => setErreur('La convention ne peut pas être affichée.'))
    return () => { if (url) URL.revokeObjectURL(url) }
    // PDF préparé une seule fois à l'ouverture : c'est ce document exact qui est lu puis signé
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pret = pdf && lu && accord && trace && nom.trim().length >= 2 && !envoi

  const signer = async () => {
    setEnvoi(true); setErreur('')
    try {
      const sha = await empreinte(pdf.base64)
      if (!sha) throw new Error('Empreinte du document impossible sur ce navigateur')
      await onSigner({ base64: pdf.base64, sha256: sha, name: nom.trim(), role: fonction.trim(), signature: trace, consent: ACCORD_SIGNATURE, label: `Convention de formation ${session.reference || ''}`.trim() })
    } catch (e) {
      setErreur(e.message || 'Signature impossible, réessayez.')
      setEnvoi(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="titre-signer">
      <div className="vitrine-monte bg-white w-full sm:max-w-lg rounded-t-ui-lg sm:rounded-ui-lg max-h-[92vh] overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="titre-signer" className="font-display text-lg font-semibold text-gray-900 flex items-center gap-2"><PenLine className="w-5 h-5 text-accent-600" aria-hidden="true" />Signer la convention</h2>
            <p className="text-sm text-gray-500">{session.courses?.title || 'Formation'}{session.reference ? `, ${session.reference}` : ''}</p>
          </div>
          <button type="button" onClick={onFermer} className="p-1 text-gray-400 hover:text-gray-700" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-gray-800">1. Lisez la convention</p>
            {pdf ? (
              <a href={pdf.url} target="_blank" rel="noreferrer" onClick={() => setLu(true)} className="mt-2 btn btn-secondary w-full justify-center gap-2">
                <FileText className="w-4 h-4" aria-hidden="true" />Ouvrir la convention (PDF)
              </a>
            ) : !erreur && <p className="mt-2 text-sm text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Préparation de la convention…</p>}
            {pdf && !lu && <p className="mt-1 text-xs text-gray-500">Ouvrez-la pour pouvoir signer.</p>}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm"><span className="text-gray-600">Nom et prénom du signataire</span>
              <input className="input w-full mt-1" value={nom} onChange={(e) => setNom(e.target.value)} autoComplete="name" /></label>
            <label className="block text-sm"><span className="text-gray-600">Fonction</span>
              <input className="input w-full mt-1" value={fonction} onChange={(e) => setFonction(e.target.value)} autoComplete="organization-title" /></label>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800 mb-2">2. Signez dans le cadre</p>
            <PadSimple onChange={setTrace} hauteur={150} label="Signez avec le doigt ou la souris" />
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1 rounded" checked={accord} onChange={(e) => setAccord(e.target.checked)} />
            <span>{ACCORD_SIGNATURE}</span>
          </label>
          {erreur && <p role="alert" className="text-sm text-[rgb(var(--c-danger))]">{erreur}</p>}
          <button type="button" onClick={signer} disabled={!pret} className="btn btn-primary w-full justify-center h-11 gap-2">
            {envoi ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <PenLine className="w-4 h-4" aria-hidden="true" />}Signer la convention
          </button>
          <p className="text-xs text-gray-400 flex items-start gap-1.5"><ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            Signature électronique simple : la date, l'heure, l'adresse IP, l'appareil et l'empreinte du document sont enregistrés comme preuve. Vous retrouverez la convention signée dans votre espace.</p>
        </div>
      </div>
    </div>
  )
}

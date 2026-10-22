// Signature de la convention depuis l'espace client (0402). Le client ouvre et lit le PDF exact qu'il signe (obligatoire
// avant de signer, rappel de H du 22/10), coche son
// accord et signe à l'écran ; l'empreinte SHA-256 de ce PDF part avec la signature. La base relève l'adresse IP et
// l'appareil, marque la session « convention signée » et prévient l'organisme.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Loader2, PenLine, ShieldCheck, X } from 'lucide-react'
import PadSimple from '../../../ui/signature/PadSimple'
import { empreinte } from '../../../core/portail/journal'
import { rechargerSiMiseAJour } from '../../../core/errors/chunkReload'

export const ACCORD_SIGNATURE = "J'ai lu la convention de formation ci-dessus et je l'accepte au nom de mon entreprise. Je reconnais que cette signature électronique m'engage comme une signature manuscrite."
export const ACCORD_DEVIS = "J'ai lu le devis ci-dessus et je l'accepte au nom de mon entreprise (bon pour accord). Je reconnais que cette signature électronique m'engage comme une signature manuscrite."
export const ACCORD_CONTRAT = "J'ai lu le contrat ci-dessus et je l'accepte au nom de mon entreprise. Je reconnais que cette signature électronique m'engage comme une signature manuscrite."

// Mention écrite au clavier par le signataire (décision de H, 21/10, 23 h 36) : celle du document (« Lu et approuvé,
// bon pour accord ») ou, au plus court, « Bon pour accord ». Elle part avec l'accord et figure sur la page de preuve ;
// la base refuse une signature sans elle (0429).
export const MENTION_DOCUMENT = 'Lu et approuvé, bon pour accord'
const normaliser = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim()
export const mentionValable = (t, mention = MENTION_DOCUMENT) => {
  const n = normaliser(t)
  return n === normaliser(mention) || n === 'bon pour accord'
}

function enBlob(base64) {
  const bin = atob(base64)
  const o = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i)
  return new Blob([o], { type: 'application/pdf' })
}

// Sert aussi aux devis et contrats mis à disposition (0406) : titre, nom du document et texte d'accord en paramètres
export default function SignerConvention({ session, genererPdf, signataire, onSigner, onFermer, titre = 'Signer la convention', nomDocument = 'la convention', accord = ACCORD_SIGNATURE, libelle = null, mention = MENTION_DOCUMENT }) {
  const [pdf, setPdf] = useState(null) // { base64, url, filename }
  const [nom, setNom] = useState(signataire?.name || '')
  const [fonction, setFonction] = useState(signataire?.role || '')
  const [accepte, setAccepte] = useState(false)
  const [lu, setLu] = useState(false)
  const [trace, setTrace] = useState(null)
  const [mentionSaisie, setMentionSaisie] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')

  useEffect(() => {
    let url = null
    genererPdf().then((out) => {
      if (!out) { setErreur('Le document ne peut pas être affiché.'); return }
      url = URL.createObjectURL(enBlob(out.base64))
      setPdf({ base64: out.base64, url, filename: out.filename })
    }).catch((e) => { if (!rechargerSiMiseAJour(e)) setErreur('Le document ne peut pas être affiché.') })
    return () => { if (url) URL.revokeObjectURL(url) }
    // PDF préparé une seule fois à l'ouverture : c'est ce document exact qui est lu puis signé
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mentionOk = mentionValable(mentionSaisie, mention)
  const pret = pdf && lu && accepte && trace && mentionOk && nom.trim().length >= 2 && !envoi

  const signer = async () => {
    setEnvoi(true); setErreur('')
    try {
      const sha = await empreinte(pdf.base64)
      if (!sha) throw new Error('Empreinte du document impossible sur ce navigateur')
      await onSigner({ base64: pdf.base64, sha256: sha, name: nom.trim(), role: fonction.trim(), signature: trace, consent: `${accord} Mention écrite par le signataire : « ${mentionSaisie.trim()} ».`, label: libelle || `Convention de formation ${session?.reference || ''}`.trim() })
    } catch (e) {
      setErreur(e.message || 'Signature impossible, réessayez.')
      setEnvoi(false)
    }
  }

  // Rendue au niveau de la page (22/10) : dans une carte animée, la fenêtre était coupée et ne défilait pas
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="titre-signer">
      <div className="vitrine-monte bg-white w-full sm:max-w-lg rounded-t-ui-lg sm:rounded-ui-lg max-h-[92vh] overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="titre-signer" className="font-display text-lg font-semibold text-gray-900 flex items-center gap-2"><PenLine className="w-5 h-5 text-accent-600" aria-hidden="true" />{titre}</h2>
            <p className="text-sm text-gray-500">{libelle || `${session?.courses?.title || 'Formation'}${session?.reference ? `, ${session.reference}` : ''}`}</p>
          </div>
          <button type="button" onClick={onFermer} className="p-1 text-gray-400 hover:text-gray-700" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-gray-800">1. Ouvrez et lisez {nomDocument} avant de signer</p>
            {pdf ? (
              <a href={pdf.url} target="_blank" rel="noreferrer" onClick={() => setLu(true)} className="mt-2 btn btn-secondary w-full justify-center gap-2">
                <FileText className="w-4 h-4" aria-hidden="true" />Ouvrir {nomDocument} (PDF)
              </a>
            ) : !erreur && <p className="mt-2 text-sm text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Préparation du document…</p>}
            {pdf && (
              <p className={`mt-1 text-xs ${lu ? 'text-gray-500' : 'text-accent-700'}`}>
                {lu
                  ? 'Vérifiez la prestation, les dates, le prix et les conditions : en signant, vous acceptez le document tel qu\'il est.'
                  : 'Ouvrez le document et lisez-le en entier : la signature n\'est possible qu\'ensuite.'}
              </p>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm"><span className="text-gray-600">Nom et prénom du signataire</span>
              <input className="input w-full mt-1" value={nom} onChange={(e) => setNom(e.target.value)} autoComplete="name" /></label>
            <label className="block text-sm"><span className="text-gray-600">Fonction</span>
              <input className="input w-full mt-1" value={fonction} onChange={(e) => setFonction(e.target.value)} autoComplete="organization-title" /></label>
          </div>
          <div>
            <label htmlFor="mention-signataire" className="text-sm font-medium text-gray-800">2. Écrivez « {mention} »</label>
            <input id="mention-signataire" className="input w-full mt-1" value={mentionSaisie} onChange={(e) => setMentionSaisie(e.target.value)}
              placeholder={mention} autoComplete="off" autoCapitalize="sentences" aria-describedby="mention-aide" />
            <p id="mention-aide" className={`mt-1 text-xs ${mentionSaisie && !mentionOk ? 'text-[rgb(var(--c-warning))]' : 'text-gray-500'}`}>
              {mentionOk ? 'Mention enregistrée avec votre signature.' : `À écrire vous-même : « ${mention} » ou « Bon pour accord ».`}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800 mb-2">3. Signez dans le cadre</p>
            <PadSimple onChange={setTrace} hauteur={150} label="Signez avec le doigt ou la souris" />
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1 rounded" checked={accepte} onChange={(e) => setAccepte(e.target.checked)} />
            <span>{accord}</span>
          </label>
          {erreur && <p role="alert" className="text-sm text-[rgb(var(--c-danger))]">{erreur}</p>}
          {pdf && !lu && <p className="text-xs text-gray-500">Pour signer, ouvrez d'abord le document (étape 1).</p>}
          <button type="button" onClick={signer} disabled={!pret} className="btn btn-primary w-full justify-center h-11 gap-2">
            {envoi ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <PenLine className="w-4 h-4" aria-hidden="true" />}{titre}
          </button>
          <p className="text-xs text-gray-400 flex items-start gap-1.5"><ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            Signature électronique simple : la date, l'heure, l'adresse IP, l'appareil et l'empreinte du document sont enregistrés comme preuve. Vous retrouverez le document signé dans votre espace.</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}

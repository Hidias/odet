import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, Upload, Camera, Loader2, X, CheckCircle2, FileText } from 'lucide-react'
import { preparerDepot, tailleLisible, enBase64 } from '../../../core/fichiers/compression'

// Imprimer, signer à la main et déposer (0431, décision de H du 21/10) : au lieu de signer en ligne, le client imprime
// le document, le signe avec la mention « Lu et approuvé, bon pour accord », puis dépose le scan ou des photos des
// pages. Le fichier est allégé dans le navigateur avant l'envoi ; l'organisme est prévenu et valide le dépôt.

/** telecharger() → télécharge le PDF à imprimer ; envoyer({ base64, avant }) → dépôt ; nomDocument : « le devis »… */
export default function DeposerSigne({ titre = 'Imprimer, signer et déposer', nomDocument = 'le document', telecharger, envoyer, onFermer }) {
  const [prepa, setPrepa] = useState(null) // { octets, avant, apres }
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState('')
  const [fait, setFait] = useState(false)

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onFermer() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onFermer])

  const choisir = async (e) => {
    const fichiers = e.target.files
    setErreur(''); setPrepa(null)
    if (!fichiers?.length) return
    setOccupe(true)
    try { setPrepa(await preparerDepot(fichiers)) } catch (err) { setErreur(err.message) } finally { setOccupe(false); e.target.value = '' }
  }

  const deposer = async () => {
    setOccupe(true); setErreur('')
    try {
      await envoyer({ base64: enBase64(prepa.octets), avant: prepa.avant })
      setFait(true)
      setTimeout(onFermer, 1400)
    } catch (err) { setErreur(err.message || 'Dépôt impossible, réessayez.') } finally { setOccupe(false) }
  }

  // Rendue au niveau de la page (22/10) : dans une carte animée, la fenêtre était coupée et ne défilait pas
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFermer}>
      <div role="dialog" aria-modal="true" aria-labelledby="depot-titre" className="vitrine-monte w-full sm:max-w-lg bg-white rounded-t-ui-lg sm:rounded-ui-lg max-h-[92vh] overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3">
          <h2 id="depot-titre" className="font-display text-lg font-semibold text-gray-900">{titre}</h2>
          <button type="button" onClick={onFermer} aria-label="Fermer" className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-gray-800">1. Imprimez et lisez {nomDocument}</p>
            <p className="text-sm text-gray-600 mt-1">Lisez le document en entier avant de signer : en le signant, vous acceptez la prestation, les dates, le prix et les conditions tels qu'ils y figurent.</p>
            <button type="button" className="mt-2 btn btn-secondary w-full justify-center gap-2" onClick={() => telecharger().catch((e) => setErreur(e.message))}>
              <Printer className="w-4 h-4" aria-hidden="true" />Télécharger pour imprimer
            </button>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">2. Signez à la main</p>
            <p className="text-sm text-gray-600 mt-1">Nom, fonction, date, signature, cachet de l'entreprise et la mention « Lu et approuvé, bon pour accord ».</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">3. Déposez le document signé</p>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="btn btn-secondary justify-center gap-2 cursor-pointer">
                <Upload className="w-4 h-4" aria-hidden="true" />Choisir un PDF ou des photos
                <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" multiple className="sr-only" onChange={choisir} />
              </label>
              <label className="btn btn-secondary justify-center gap-2 cursor-pointer sm:hidden">
                <Camera className="w-4 h-4" aria-hidden="true" />Prendre les pages en photo
                <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={choisir} />
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-1">Un seul PDF, ou une photo par page (12 au plus). Le fichier est allégé avant l'envoi, sans perte de lisibilité.</p>
          </div>
          {occupe && !prepa && <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Préparation du fichier…</p>}
          {prepa && (
            <p className="text-sm text-gray-700 flex items-center gap-2 rounded-ui bg-gray-50 border border-gray-200 px-3 py-2">
              <FileText className="w-4 h-4 text-accent-600 shrink-0" aria-hidden="true" />
              Prêt à déposer : {tailleLisible(prepa.apres)}{prepa.avant > prepa.apres * 1.1 ? ` (au lieu de ${tailleLisible(prepa.avant)})` : ''}
            </p>
          )}
          {erreur && <p role="alert" className="text-sm text-[rgb(var(--c-danger))]">{erreur}</p>}
          <button type="button" className="btn btn-primary w-full justify-center h-11 gap-2" disabled={!prepa || occupe || fait} onClick={deposer}>
            {occupe && prepa ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : fait ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
            {fait ? 'Déposé : votre organisme est prévenu' : 'Déposer le document signé'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

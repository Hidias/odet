import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Camera, Loader2, X } from 'lucide-react'
import { deposerPhoto, lienSigne } from '../lib/photosDevis'

// Photo d'une ligne de devis (0445) : celle de l'article du catalogue, ou une photo prise pour ce devis (site,
// installation). Case « dans le PDF » pour l'imprimer sous les lignes.

export default function PhotoLigneDevis({ item, dossier, onChange }) {
  const [apercu, setApercu] = useState(null)
  const [envoi, setEnvoi] = useState(false)
  const entree = useRef(null)

  useEffect(() => {
    let actif = true
    if (item.photo_path) lienSigne(item.photo_path).then((u) => { if (actif) setApercu(u) })
    else setApercu(null)
    return () => { actif = false }
  }, [item.photo_path])

  const choisir = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setEnvoi(true)
    try {
      const path = await deposerPhoto(f, dossier)
      onChange({ photo_path: path, show_photo: true })
      toast.success('Photo ajoutée')
    } catch (err) {
      toast.error(err.message || 'Photo non ajoutée')
    }
    setEnvoi(false)
  }

  return (
    <div className="flex items-center gap-2 text-ui-sm text-gray-600">
      {apercu && <img src={apercu} alt="" className="w-9 h-9 object-cover rounded border border-gray-200" />}
      <button type="button" onClick={() => entree.current?.click()} disabled={envoi}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-gray-200 rounded hover:bg-gray-50" aria-label={item.photo_path ? 'Changer la photo de la ligne' : 'Ajouter une photo à la ligne'}>
        {envoi ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Camera size={12} aria-hidden="true" />}{item.photo_path ? 'Changer' : 'Photo'}
      </button>
      <input ref={entree} type="file" accept="image/*" capture="environment" className="hidden" onChange={choisir} />
      {item.photo_path && (
        <>
          <label className="flex items-center gap-1"><input type="checkbox" className="rounded" checked={!!item.show_photo} onChange={(e) => onChange({ show_photo: e.target.checked })} />Dans le PDF</label>
          <button type="button" onClick={() => onChange({ photo_path: null, show_photo: false })} className="p-0.5 text-gray-400 hover:text-[rgb(var(--c-danger))]" aria-label="Retirer la photo de la ligne"><X size={12} /></button>
        </>
      )}
    </div>
  )
}

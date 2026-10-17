// Préparation des fichiers : le serveur contrôle, fabrique et renvoie les fichiers ; on les garde en mémoire
// le temps du téléchargement, qui se fait par un vrai clic (les navigateurs bloquent les téléchargements
// lancés sans clic). Rien n'est stocké.

import { useEffect, useRef, useState } from 'react'
import { Loader2, Download, X, AlertTriangle } from 'lucide-react'
import { apiPasseport, telechargerTexte } from '../lib/ppData'

export default function GenerationModal({ inscriptionIds, correction = false, onClose, onDone }) {
  const [state, setState] = useState({ loading: true })
  const fichiersRef = useRef([])
  const [telecharges, setTelecharges] = useState({})
  const lance = useRef(false)

  useEffect(() => {
    // Une seule fabrication par ouverture (chaque appel crée des envois numérotés)
    if (lance.current) return undefined
    lance.current = true
    apiPasseport('generate', { inscription_ids: inscriptionIds, correction })
      .then((r) => {
        fichiersRef.current = r.fichiers || []
        setState({ loading: false, fichiers: (r.fichiers || []).map(({ contenu, ...f }) => f), retires: r.retires || [] })
        onDone?.()
      })
      .catch((e) => setState({ loading: false, error: e.message }))
    return undefined
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fermer = () => { fichiersRef.current = []; onClose() }

  const telecharger = (id) => {
    const f = fichiersRef.current.find((x) => x.id === id)
    if (!f) return
    telechargerTexte(f.nom, f.contenu)
    setTelecharges((t) => ({ ...t, [id]: true }))
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Préparer les fichiers">
      <div className="bg-white w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-ui-lg sm:rounded-ui-lg">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <div className="flex-1">
            <div className="section-title">{correction ? 'Préparer le fichier de correction' : 'Préparer les fichiers'}</div>
            <div className="text-ui-sm muted">{inscriptionIds.length} stagiaire{inscriptionIds.length > 1 ? 's' : ''} sélectionné{inscriptionIds.length > 1 ? 's' : ''}</div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={fermer} aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          {state.loading && <div className="flex items-center gap-2 text-ui"><Loader2 className="w-5 h-5 animate-spin" /> Contrôles et fabrication en cours…</div>}
          {state.error && <div className="text-[rgb(var(--c-danger))] text-ui">Échec : {state.error}</div>}
          {!state.loading && !state.error && (
            <>
              {state.fichiers.length === 0 && <div className="card bg-gray-50 text-ui">Aucun stagiaire ne peut partir pour l'instant : voir les motifs ci-dessous.</div>}
              {state.fichiers.map((f) => (
                <div key={f.id} className="card space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`badge ${f.type === 'JDR' ? 'badge-success' : 'badge-info'}`}>{f.type}</span>
                    <b className="flex-1">{f.type === 'JDR' ? 'Justificatifs de réussite' : 'Attestations de formation'}</b>
                    <span className="text-ui-sm muted">{f.lignes} stagiaire{f.lignes > 1 ? 's' : ''}, {f.declarations} déclaration{f.declarations > 1 ? 's' : ''}</span>
                  </div>
                  <code className="block text-ui-sm text-gray-600 break-all">{f.nom}</code>
                  <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={() => telecharger(f.id)}>
                    <Download className="w-4 h-4" /> {telecharges[f.id] ? 'Télécharger à nouveau' : `Télécharger le fichier ${f.type}`}
                  </button>
                </div>
              ))}
              {state.fichiers.length > 0 && (
                <div className="rounded-ui bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] p-3 text-ui-sm leading-relaxed">
                  <b>N'ouvrez pas ces fichiers dans Excel ou Numbers</b> : ils cassent le séparateur et les zéros. Déposez-les tels quels sur le portail du Passeport de prévention (espace organisme, import en masse), dans la rubrique du bon type, puis revenez déposer l'accusé de traitement dans « Fichiers et accusés ».
                </div>
              )}
              {state.retires.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-semibold text-ui"><AlertTriangle className="w-4 h-4 text-[rgb(var(--c-warning))]" /> Restent à déclarer ({state.retires.length})</div>
                  <ul className="text-ui-sm divide-y divide-gray-100">
                    {state.retires.map((r) => <li key={r.inscription_id} className="py-1.5"><b>{r.qui}</b> : {r.motif}</li>)}
                  </ul>
                </div>
              )}
              <p className="text-ui-sm muted">Fichiers fabriqués par le serveur au moment du clic et jamais conservés. Le numéro complet n'apparaît que dans le fichier téléchargé.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

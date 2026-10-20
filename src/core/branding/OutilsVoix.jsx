// Boutons « Écouter » et « Dicter », présents sur tous les écrans quand le réglage Voix est actif (affichage adapté).
// Écouter : lit le texte sélectionné, sinon la page. Dicter : écrit ce que l'on dit dans la dernière case touchée.

import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Volume2, Square, Mic, MicOff } from 'lucide-react'
import {
  useAdapte, parler, arreterLecture, texteALire, voixDisponible,
  dicteeDisponible, demarrerDictee, insererTexte, caseDeTexte,
} from './adapte'

const ERREURS_DICTEE = {
  'not-allowed': 'Le micro est refusé. Autorisez le micro pour ce site dans le navigateur.',
  'service-not-allowed': 'Le micro est refusé. Autorisez le micro pour ce site dans le navigateur.',
  'no-speech': 'Je n\'ai rien entendu. Appuyez sur Dicter et parlez.',
  'audio-capture': 'Aucun micro trouvé sur cet appareil.',
  network: 'La dictée a besoin d\'internet.',
  indisponible: 'Ce navigateur ne propose pas la dictée. Utilisez Chrome, Edge ou Safari, ou le micro du clavier du téléphone.',
}

export default function OutilsVoix({ basMobile = false }) {
  const { voix } = useAdapte()
  const [lecture, setLecture] = useState(false)
  const [ecoute, setEcoute] = useState(false)
  const derniereCase = useRef(null)
  const arret = useRef(null)

  // Mémorise la dernière case de texte touchée : le bouton Dicter y écrira
  useEffect(() => {
    if (!voix) return undefined
    const surFocus = (e) => { if (caseDeTexte(e.target)) derniereCase.current = e.target }
    document.addEventListener('focusin', surFocus)
    return () => document.removeEventListener('focusin', surFocus)
  }, [voix])

  // Arrêt propre en quittant le réglage ou l'écran
  useEffect(() => () => { arreterLecture(); arret.current?.() }, [])
  useEffect(() => { if (!voix) { arreterLecture(); arret.current?.(); setLecture(false); setEcoute(false) } }, [voix])

  if (!voix) return null

  const ecouter = () => {
    if (lecture) { arreterLecture(); setLecture(false); return }
    const ok = parler(texteALire(), { onFin: () => setLecture(false) })
    if (ok) setLecture(true)
    else toast.error('Ce navigateur ne sait pas lire à voix haute.')
  }

  const dicter = () => {
    if (ecoute) { arret.current?.(); return }
    const cible = derniereCase.current
    if (!cible || !document.body.contains(cible)) { toast('Touchez d\'abord la case où écrire, puis Dicter.'); return }
    arreterLecture(); setLecture(false)
    setEcoute(true)
    arret.current = demarrerDictee({
      onTexte: (t) => { insererTexte(cible, t); cible.focus() },
      onFin: () => { setEcoute(false); arret.current = null },
      onErreur: (code) => { setEcoute(false); arret.current = null; if (code !== 'aborted') toast.error(ERREURS_DICTEE[code] || 'La dictée n\'a pas marché. Réessayez.') },
    })
  }

  // mousedown empêché : la case garde le focus quand on appuie sur Dicter
  const garderFocus = (e) => e.preventDefault()

  return (
    <div className={`outils-voix ${basMobile ? 'outils-voix-haut' : ''}`} role="toolbar" aria-label="Voix">
      {voixDisponible() && (
        <button type="button" onMouseDown={garderFocus} onClick={ecouter} className={`outils-voix-btn ${lecture ? 'is-actif' : ''}`} aria-pressed={lecture}>
          {lecture ? <Square className="w-5 h-5" aria-hidden="true" /> : <Volume2 className="w-5 h-5" aria-hidden="true" />}
          <span>{lecture ? 'Arrêter' : 'Écouter'}</span>
        </button>
      )}
      <button type="button" onMouseDown={garderFocus} onClick={dicteeDisponible() ? dicter : () => toast(ERREURS_DICTEE.indisponible)}
        className={`outils-voix-btn ${ecoute ? 'is-ecoute' : ''}`} aria-pressed={ecoute}>
        {ecoute ? <MicOff className="w-5 h-5" aria-hidden="true" /> : <Mic className="w-5 h-5" aria-hidden="true" />}
        <span>{ecoute ? 'Je vous écoute…' : 'Dicter'}</span>
      </button>
    </div>
  )
}

/* global __BUILD_ID__ */
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

// Nouvelle version en ligne : un onglet resté ouvert garde les anciens fichiers après un déploiement.
// La construction inscrit son identifiant dans l'application et dans /version.json (vite.config.js) ;
// on relit /version.json toutes les 5 minutes et au retour sur l'onglet. S'il a changé, un bandeau propose de
// recharger : jamais de rechargement automatique (une saisie en cours serait perdue).

const ICI = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : null

async function versionEnLigne() {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const json = await res.json()
    return typeof json?.build === 'string' ? json.build : null
  } catch {
    return null
  }
}

export default function NouvelleVersion() {
  const [nouvelle, setNouvelle] = useState(false)

  useEffect(() => {
    if (!ICI || ICI.startsWith('local-')) return undefined
    let arret = false
    const verifier = async () => {
      const enLigne = await versionEnLigne()
      if (!arret && enLigne && enLigne !== ICI) setNouvelle(true)
    }
    const auRetour = () => { if (document.visibilityState === 'visible') verifier() }
    const t = setInterval(verifier, 300000)
    document.addEventListener('visibilitychange', auRetour)
    return () => { arret = true; clearInterval(t); document.removeEventListener('visibilitychange', auRetour) }
  }, [])

  if (!nouvelle) return null
  return (
    <div role="status" className="fixed left-1/2 -translate-x-1/2 z-50 top-[calc(0.75rem+env(safe-area-inset-top))] w-[min(440px,calc(100vw-1.5rem))] rounded-ui border border-gray-200 bg-white shadow-md px-3 py-2 flex items-center gap-3 print:hidden">
      <RefreshCw className="w-4 h-4 text-accent-600 flex-none" aria-hidden="true" />
      <span className="text-ui-sm text-gray-800 flex-1">Une nouvelle version de l'application est en ligne.</span>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>Recharger</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNouvelle(false)}>Plus tard</button>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Clock, RotateCcw, X } from 'lucide-react'
import { useAuthStore } from '../store'
import { noterActivite, derniereActivite, etatInactivite } from './inactivite'
import { garderSaisie, saisiesGardees, oublierSaisie, remettreSaisie } from './saisieInterrompue'

// Déconnexion automatique après une heure sans activité (A1, demande de H du 21/10), pour l'application interne
// (les portails stagiaire et client ont leurs propres règles) : avertissement à 55 minutes avec « Rester connecté »,
// saisie de la page gardée sur l'appareil, session fermée côté serveur, puis bandeau de reprise à la reconnexion.

const EVENEMENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']
const fmt = (s) => `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`

export function SurveillanceInactivite() {
  const logout = useAuthStore((s) => s.logout)
  const userId = useAuthStore((s) => s.user?.id)
  const location = useLocation()
  const [alerte, setAlerte] = useState(null)
  const local = useRef(Date.now())
  const enCours = useRef(false)
  const route = `${location.pathname}${location.search || ''}`
  const routeRef = useRef(route)
  routeRef.current = route

  useEffect(() => {
    if (!userId) return undefined
    noterActivite()
    let dernierEnvoi = 0
    const activite = () => {
      const t = Date.now()
      local.current = t
      if (t - dernierEnvoi > 15000) { dernierEnvoi = t; noterActivite(t) }
    }
    const verifier = async () => {
      if (enCours.current) return
      const inactif = Date.now() - derniereActivite(local.current)
      const e = etatInactivite(inactif)
      if (e.etat === 'deconnexion') {
        enCours.current = true
        garderSaisie(userId, routeRef.current)
        try { sessionStorage.setItem('odet_deconnexion_inactivite', '1') } catch { /* sans message */ }
        await logout({ scope: 'local' })
        return
      }
      setAlerte(e.etat === 'avertissement' ? e.reste : null)
    }
    EVENEMENTS.forEach((ev) => window.addEventListener(ev, activite, { passive: true }))
    const visible = () => { if (document.visibilityState === 'visible') verifier() }
    document.addEventListener('visibilitychange', visible)
    const t = setInterval(verifier, 1000)
    return () => {
      EVENEMENTS.forEach((ev) => window.removeEventListener(ev, activite))
      document.removeEventListener('visibilitychange', visible)
      clearInterval(t)
    }
  }, [userId, logout])

  if (alerte == null) return null
  const rester = () => { local.current = noterActivite(); setAlerte(null) }
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="inactivite-titre">
      <div className="surface max-w-sm w-full p-5 space-y-3 text-center">
        <Clock className="w-8 h-8 mx-auto text-[rgb(var(--c-warning))]" aria-hidden="true" />
        <h2 id="inactivite-titre" className="font-display font-semibold text-lg text-gray-900">Toujours là ?</h2>
        <p className="text-ui text-gray-600">Sans activité, vous serez déconnecté dans <strong>{fmt(alerte)}</strong>. Votre saisie en cours sera gardée sur cet appareil.</p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary flex-1" onClick={() => { local.current = 0; noterActivite(1) }}>Me déconnecter</button>
          <button type="button" className="btn btn-primary flex-1" autoFocus onClick={rester}>Rester connecté</button>
        </div>
      </div>
    </div>
  )
}

// Bandeau de reprise : la page et la saisie interrompues par la déconnexion
export function RepriseSaisie() {
  const userId = useAuthStore((s) => s.user?.id)
  const location = useLocation()
  const navigate = useNavigate()
  const [saisies, setSaisies] = useState([])
  const [voir, setVoir] = useState(false)
  useEffect(() => { if (userId) setSaisies(saisiesGardees(userId)) }, [userId, location.pathname])
  if (!userId || saisies.length === 0) return null
  const route = `${location.pathname}${location.search || ''}`
  const ici = saisies.find((s) => s.route === route)
  const s = ici || saisies[0]
  const heure = new Date(s.a).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const oublier = () => { oublierSaisie(userId, s.route); setSaisies(saisiesGardees(userId)); setVoir(false) }
  const reprendre = () => {
    const n = remettreSaisie(s)
    if (n > 0 && n >= (s.champs || []).filter((c) => c.valeur).length) oublier()
    else setVoir(true)
  }
  return (
    <div className="mb-3 rounded-ui border border-[rgb(var(--c-warning))]/40 bg-[rgb(var(--c-warning-bg))] p-3 text-ui text-gray-800" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <RotateCcw className="w-4 h-4 text-[rgb(var(--c-warning))] flex-none" aria-hidden="true" />
        <span className="flex-1 min-w-[14rem]">Une saisie a été interrompue par la déconnexion de {heure}{ici ? '' : ' sur une autre page'}.</span>
        {ici
          ? <button type="button" className="btn btn-primary btn-sm" onClick={reprendre}>Remettre la saisie</button>
          : <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate(s.route)}>Y retourner</button>}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setVoir((v) => !v)}>{voir ? 'Masquer' : 'Voir les valeurs'}</button>
        <button type="button" className="p-1 text-gray-500 hover:text-gray-700" onClick={oublier} aria-label="Oublier cette saisie"><X className="w-4 h-4" /></button>
      </div>
      {voir && (
        <div className="mt-2 space-y-1">
          <p className="text-ui-sm text-gray-600">Si le formulaire n'est pas ouvert, ouvrez-le puis « Remettre la saisie », ou recopiez :</p>
          <ul className="max-h-48 overflow-y-auto text-ui-sm bg-white rounded-ui border border-gray-200 divide-y divide-gray-100">
            {(s.champs || []).filter((c) => c.valeur).map((c, i) => (
              <li key={i} className="px-2 py-1"><span className="text-gray-500">{c.libelle || 'Champ'} :</span> <span className="whitespace-pre-wrap select-all">{c.valeur}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

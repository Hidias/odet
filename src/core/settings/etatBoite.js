import { useEffect, useState } from 'react'
import { apiFetch } from '../api'

// Boîte d'envoi de l'utilisateur connecté configurée ou non (décision de H du 19/10 : l'outil doit le dire clairement).
// Lu une fois par onglet (sessionStorage), oublié dès que la personne enregistre ou retire une boîte.
const CLE = 'odet.boite_envoi'

export function oublierEtatBoite() {
  try { sessionStorage.removeItem(CLE) } catch { /* stockage indisponible */ }
  try { window.dispatchEvent(new Event('odet:boite-envoi')) } catch { /* hors navigateur */ }
}

// Renvoie true (configurée), false (aucune boîte) ou null (inconnu, ou compte sans boîte d'envoi)
export function useEtatBoite(actif = true) {
  const [etat, setEtat] = useState(() => {
    try { const v = sessionStorage.getItem(CLE); return v === '1' ? true : v === '0' ? false : null } catch { return null }
  })
  useEffect(() => {
    if (!actif) return undefined
    let fini = false
    const lire = async () => {
      try {
        const v = sessionStorage.getItem(CLE)
        if (v === '1' || v === '0') { setEtat(v === '1'); return }
      } catch { /* stockage indisponible */ }
      try {
        const res = await apiFetch('/api/user-email-config')
        if (!res.ok) return // compte sans boîte d'envoi (lecture, technicien, externe) : rien à dire
        const json = await res.json().catch(() => ({}))
        const ok = (json.configs || []).some((c) => c.is_active !== false)
        if (fini) return
        setEtat(ok)
        try { sessionStorage.setItem(CLE, ok ? '1' : '0') } catch { /* stockage indisponible */ }
      } catch { /* réseau : on ne dit rien */ }
    }
    lire()
    const relire = () => { setEtat(null); lire() }
    window.addEventListener('odet:boite-envoi', relire)
    return () => { fini = true; window.removeEventListener('odet:boite-envoi', relire) }
  }, [actif])
  return etat
}

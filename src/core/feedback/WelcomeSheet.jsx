import { useEffect, useState } from 'react'
import { StickyNote } from 'lucide-react'
import { Sheet } from '../../ui'
import { supabase } from '../supabase'
import { useBranding } from '../branding/BrandingProvider'

// Message d'accueil affiché une seule fois à chaque utilisateur, à sa première connexion.
// Signé du prénom du super administrateur (personne qui déploie l'outil), jamais d'un nom écrit dans le code.
// « Déjà vu » est enregistré dans le compte (user_metadata), donc valable sur tous les appareils.

const SEEN_KEY = 'welcome_seen_at'

function firstName(p) {
  if (!p) return ''
  if (p.first_name) return p.first_name
  return String(p.display_name || '').trim().split(/\s+/)[0] || ''
}

export default function WelcomeSheet({ user, profile, userRole }) {
  const { branding } = useBranding()
  const [show, setShow] = useState(false)
  const [signature, setSignature] = useState('')

  useEffect(() => {
    if (!user || !profile) return
    // Aperçu pour le super administrateur : ajouter ?accueil=apercu à l'adresse de la page
    const preview = userRole === 'superadmin' && /[?&]accueil=apercu\b/.test(window.location.hash || '')
    if (!preview) {
      if (userRole === 'superadmin') return
      if (user.user_metadata?.[SEEN_KEY]) return
      try { if (window.localStorage.getItem(`odet.welcome.${user.id}`)) return } catch (_) { /* stockage indisponible */ }
    }
    let alive = true
    supabase.from('profiles').select('first_name, display_name').eq('role', 'superadmin').eq('is_active', true).limit(1)
      .then(({ data }) => { if (alive) { setSignature(firstName(data?.[0])); setShow(true) } })
    return () => { alive = false }
  }, [user, profile, userRole])

  const close = async () => {
    setShow(false)
    if (userRole === 'superadmin') return
    const now = new Date().toISOString()
    try { window.localStorage.setItem(`odet.welcome.${user.id}`, now) } catch (_) { /* stockage indisponible */ }
    try { await supabase.auth.updateUser({ data: { [SEEN_KEY]: now } }) } catch (_) { /* déjà retenu dans ce navigateur */ }
  }

  if (!show) return null
  const prenom = firstName(profile)
  const app = branding?.app_name || 'l\'application'

  return (
    <Sheet
      title={`Bienvenue dans ${app}`}
      onClose={close}
      footer={<button type="button" className="btn btn-primary" onClick={close}>C'est parti</button>}
    >
      <div className="space-y-3 text-ui text-gray-800 leading-relaxed">
        <p className="font-semibold text-gray-900">Bonjour {prenom || 'et bienvenue'},</p>
        <p>
          Je suis très heureux de vous ouvrir l'accès à {app}. L'outil est encore en cours de déploiement :
          certains écrans vont évoluer dans les jours qui viennent et vous croiserez sans doute quelques imperfections.
          Merci par avance pour votre indulgence pendant cette période.
        </p>
        <p>
          Les données que vous voyez aujourd'hui sont fictives : vous pouvez explorer, créer et modifier librement,
          rien de ce que vous ferez n'aura de conséquence.
        </p>
        <div className="rounded-ui border border-highlight-300 bg-highlight-50 p-3 flex gap-3">
          <StickyNote className="w-5 h-5 shrink-0 text-highlight-700" aria-hidden="true" />
          <p>
            En bas à droite de l'écran, le post-it <strong>« Une remarque ? »</strong> vous suit sur toutes les pages.
            Notez-y au fil de l'eau tout ce qui vous gêne, vous manque ou vous fait penser à une idée : le texte reste
            en place quand vous changez de page. Dès que vous cliquez sur <strong>« Envoyer »</strong>, votre note
            m'arrive directement, avec la page sur laquelle vous étiez. Aucune remarque n'est trop petite : ce sont vos
            retours qui feront de cet outil le vôtre.
          </p>
        </div>
        <p>Bonne découverte, et à très vite,</p>
        {signature && <p className="font-semibold text-gray-900">{signature}</p>}
      </div>
    </Sheet>
  )
}

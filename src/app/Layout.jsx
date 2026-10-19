import toast from 'react-hot-toast'
import { NavLink, Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Menu, X, Bell, Check, LogOut, ChevronDown, Plus, Settings, Sliders, SlidersHorizontal, LayoutDashboard, Calendar, MapPin, Building2, MoreHorizontal, AlertCircle, MessageSquare, Eye, Wrench, ClipboardList, BarChart3, CalendarClock, Phone, Info, Mail, KeyRound,
} from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useAuthStore } from '../core/store'
import { RouteErrorBoundary } from '../core/errors/ErrorBoundary'
import PostIt from '../core/feedback/PostIt'
import WelcomeSheet from '../core/feedback/WelcomeSheet'
import BandeauInfo from '../core/notices/BandeauInfo'
import { useNotices } from '../core/notices/notices'
import { useEtatBoite } from '../core/settings/etatBoite'
import { supabase } from '../core/supabase'
import { useBranding, brandLogo, appIcon } from '../core/branding/BrandingProvider'
import { useUiPrefs } from '../core/branding/useUiPrefs'
import { UI_PRESETS, DENSITIES, NAVS, RADII, LISTS, modeParDefaut } from '../core/branding/presets'
import { visibleSections, visibleSettingsItems, accesPage, pageTitleFor, sectionIdFor, entreesMenu, ongletsPour, entreePourChemin, creationsVisibles } from '../core/modules/registry'
import PageRefusee from '../core/rights/PageRefusee'
import { SelecteurSociete, ChoixSociete, BandeauVueGroupe } from '../core/company/SelecteurSociete'

const ROLE_LABELS = {
  superadmin: 'Super administrateur',
  admin: 'Administrateur',
  direction: 'Direction',
  gestionnaire: 'Gestionnaire',
  formateur: 'Formateur',
  commercial: 'Commercial',
  comptable: 'Comptable',
  lecture: 'Lecture seule',
}

const NOTIF_ICONS = {
  completude: AlertCircle,
  reclamation: MessageSquare,
  veille: Eye,
  materiel: Wrench,
  audit: ClipboardList,
  revue_direction: BarChart3,
  j90: CalendarClock,
  rdv_phoning: Phone,
  rappel_phoning: Phone,
}

const MENU_KEY = 'menu.sections.v1'

// L'adresse est-elle celle de l'entrée (ou d'une de ses pages filles) ?
const surRoute = (pathname, to) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/'))

function initials(profile, user) {
  const name = profile?.display_name || user?.email || ''
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '')
}

export default function Layout() {
  const { user, profile, userRole, modules, logout, fieldOnly, rights, can } = useAuthStore()
  const { branding } = useBranding()
  const { prefs, update } = useUiPrefs()
  const navigate = useNavigate()
  const location = useLocation()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showDisplay, setShowDisplay] = useState(false)
  const [showNouveau, setShowNouveau] = useState(false)

  // Mode simple ou complet (réglage personnel ; par défaut selon le rôle)
  const mode = prefs.mode || modeParDefaut(userRole)
  const simple = mode === 'simple'
  // Technicien de terrain : seulement l'entrée Interventions, ni paramètres, ni recherche, ni notifications.
  // sectionsCompletes : tout ce que le compte peut ouvrir (onglets des groupes) ; sections : le menu (simple ou complet)
  const sectionsCompletes = useMemo(() => {
    const all = visibleSections(modules, userRole, can)
    if (!fieldOnly) return all
    return all.map((s) => ({ ...s, items: s.items.filter((i) => i.to === '/interventions') })).filter((s) => s.items.length > 0)
  }, [modules, userRole, fieldOnly, rights, can])
  const sections = useMemo(() => {
    if (!simple || fieldOnly) return sectionsCompletes
    return visibleSections(modules, userRole, can, { simple: true })
  }, [simple, fieldOnly, sectionsCompletes, modules, userRole, rights, can])
  const creations = useMemo(() => (fieldOnly ? [] : creationsVisibles(modules, userRole, can)), [fieldOnly, modules, userRole, rights, can])
  // Bandeau d'information et « Quoi de neuf » (chantier A) : état lu par la base, relu toutes les 15 minutes
  const notices = useNotices()
  // Boîte d'envoi non configurée : bandeau clair (comptes qui envoient des emails seulement)
  const boiteEnvoi = useEtatBoite(!!user?.id && !fieldOnly && can?.('organisation.preferences.gerer') !== false && !['lecture', 'entreprise', 'stagiaire', 'formateur_externe'].includes(userRole))
  const chargerNotices = notices.charger
  useEffect(() => {
    if (!user?.id) return undefined
    chargerNotices()
    const t = setInterval(chargerNotices, 900000)
    return () => clearInterval(t)
  }, [user?.id, chargerNotices])
  const retoursActif = notices.disponible ? (modules || []).includes('retours') : null
  const settingsItems = useMemo(() => (fieldOnly ? [] : visibleSettingsItems(userRole, can, modules)
    .map((i) => (i.to === '/nouveautes' ? { ...i, dot: notices.unseen } : i))), [userRole, fieldOnly, rights, can, modules, notices.unseen])
  // Garde de l'adresse directe : même table que le menu (rôle et droits)
  const pageAutorisee = useMemo(() => accesPage(location.pathname, userRole, can), [location.pathname, userRole, rights, can])
  const fieldAllowed = !fieldOnly || location.pathname.startsWith('/interventions') || location.pathname === '/mot-de-passe'
  const activeSectionId = useMemo(() => sectionIdFor(location.pathname) || sections[0]?.id, [location.pathname, sections])
  const basculerMode = () => update({ mode: simple ? 'complet' : 'simple' })
  const pageTitle = useMemo(() => pageTitleFor(location.pathname), [location.pathname])
  // Pages d'un même groupe (ex. Catalogue, Tests et quiz, Obligations) : onglets en haut de la page
  const onglets = useMemo(() => ongletsPour(location.pathname, sectionsCompletes), [location.pathname, sectionsCompletes])
  const ongletActif = useMemo(() => entreePourChemin(location.pathname)?.to, [location.pathname])

  // Barre de navigation en bas sur téléphone : les 4 destinations principales disponibles pour ce rôle et ces modules, puis « Plus » (menu complet)
  const bottomItems = useMemo(() => {
    if (fieldOnly) return []
    const available = new Set(sections.flatMap((s) => s.items.map((i) => i.to)))
    return [
      { to: '/', icon: LayoutDashboard, label: 'Accueil' },
      { to: '/sessions', icon: Calendar, label: 'Sessions' },
      { to: '/interventions', icon: MapPin, label: 'Journée' },
      { to: '/clients', icon: Building2, label: 'Clients' },
    ].filter((i) => available.has(i.to)).slice(0, 4)
  }, [sections, fieldOnly])
  const showBottomNav = bottomItems.length > 0
  useEffect(() => {
    const el = document.documentElement
    if (showBottomNav) el.dataset.bottomNav = '1'
    else delete el.dataset.bottomNav
    return () => { delete el.dataset.bottomNav }
  }, [showBottomNav])

  // Sections ouvertes du menu : choix de la personne, gardés sur cet appareil (confort, jamais indispensable).
  // Par défaut seule la section de la page en cours est ouverte ; changer de page ouvre sa section sans refermer les autres.
  const [openSections, setOpenSections] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem(MENU_KEY) || '{}') || {} } catch { return {} }
  })
  useEffect(() => {
    if (activeSectionId) setOpenSections((prev) => (prev[activeSectionId] === true ? prev : { ...prev, [activeSectionId]: true }))
  }, [activeSectionId])
  useEffect(() => {
    try { window.localStorage.setItem(MENU_KEY, JSON.stringify(openSections)) } catch { /* stockage indisponible */ }
  }, [openSections])

  // Barre d'icônes : section sélectionnée dans le rail
  const [railSection, setRailSection] = useState(activeSectionId)
  useEffect(() => { if (activeSectionId) setRailSection(activeSectionId) }, [activeSectionId])

  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  useEffect(() => {
    if (fieldOnly) return undefined
    loadNotifications()
    const interval = setInterval(loadNotifications, 60000)
    return () => clearInterval(interval)
  }, [fieldOnly])

  const loadNotifications = async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
    setNotifications(data || [])
  }
  const unreadCount = notifications.filter((n) => !n.read_at).length
  const markAsRead = async (id) => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
    loadNotifications()
  }
  // « Email non associé » : ne plus jamais signaler cette adresse (Paramètres > Banque et emails, adresses à ignorer)
  const ignoreAddress = async (n) => {
    const addr = String(n.metadata?.to_email || '').trim().toLowerCase()
    if (!addr) return
    const { data: org } = await supabase.from('organization_settings').select('id, email_sync_ignored').limit(1).maybeSingle()
    if (!org?.id) return toast.error('Paramètres de l\'organisme introuvables')
    const list = String(org.email_sync_ignored || '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
    if (!list.includes(addr)) list.push(addr)
    const { error } = await supabase.from('organization_settings').update({ email_sync_ignored: list.join(', ') }).eq('id', org.id)
    if (error) return toast.error(error.message)
    const same = notifications.filter((x) => x.type === 'email_sync' && !x.read_at && String(x.metadata?.to_email || '').toLowerCase() === addr).map((x) => x.id)
    if (same.length) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', same)
    toast.success(`${addr} ne sera plus signalée`)
    loadNotifications()
  }
  const markAllAsRead = async () => {
    const ids = notifications.filter((n) => !n.read_at).map((n) => n.id)
    if (ids.length === 0) return
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
    loadNotifications()
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const logo = brandLogo(branding, prefs.nav !== 'light')
  const icon = appIcon(branding)
  const navIsDark = prefs.nav !== 'light'
  const navText = navIsDark ? 'text-nav-fg' : 'text-gray-900'
  const navMuted = navIsDark ? 'text-nav-fg/60' : 'text-gray-500'
  const navHover = navIsDark ? 'hover:bg-nav-fg/10 hover:text-nav-fg' : 'hover:bg-gray-100 hover:text-gray-900'
  const navActive = navIsDark
    ? 'bg-nav-fg/10 text-nav-fg font-semibold border-l-2 border-accent-500'
    : 'bg-accent-500/10 text-accent-700 font-semibold'
  const navBg = navIsDark ? 'bg-nav' : 'bg-white border-r border-gray-200'

  // ─── Blocs communs ─────────────────────────────────────────
  // Les blocs ci-dessous sont des fonctions appelées, pas des composants : un composant déclaré dans le rendu
  // est recréé à chaque rendu, React démonte alors tout le menu (défilement remis en haut, sections redéployées).
  const brand = (compact = false) => (
    <div className={`flex items-center gap-3 ${compact ? '' : 'px-2'}`}>
      {icon ? (
        <img src={icon} alt={branding.app_name || 'Logo'} className={`${compact ? 'h-7 w-7' : 'h-9 w-9'} rounded-ui-sm object-cover flex-none`} />
      ) : logo ? (
        <div className={`${navIsDark ? 'bg-white' : ''} rounded-ui-sm p-1 flex items-center justify-center`}>
          <img src={logo} alt={branding.org_name || 'Logo'} className={compact ? 'h-7 w-auto' : 'h-9 w-auto max-w-[140px] object-contain'} />
        </div>
      ) : (
        <div className="h-9 w-9 rounded-ui-sm bg-accent-500 text-accent-fg flex items-center justify-center font-display font-bold">
          {(branding.app_short_name || branding.app_name || 'O').slice(0, 1)}
        </div>
      )}
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className={`font-display font-semibold truncate ${navText}`}>{branding.app_name || branding.org_name || ''}</div>
          {branding.org_name && branding.app_name && branding.org_name !== branding.app_name && (
            <div className={`text-ui-sm truncate ${navMuted}`}>{branding.org_name}</div>
          )}
        </div>
      )}
    </div>
  )

  const navItem = (item, indent = false) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) => `flex items-center gap-3 ${indent ? 'pl-5 pr-3' : 'px-3'} py-2 rounded-ui-sm text-ui transition-colors ${
        isActive || (item.routes || []).some((r) => surRoute(location.pathname, r)) ? navActive : `${navMuted} ${navHover}`
      }`}
    >
      <item.icon className="w-[18px] h-[18px] flex-none" />
      <span className="truncate">{item.label}</span>
      {item.soon && <span className="ml-auto badge badge-neutral" style={{ height: 18, fontSize: 10.5 }}>bientôt</span>}
      {item.dot && <span className="ml-auto badge badge-warning" style={{ height: 18, fontSize: 10.5 }}>nouveau</span>}
    </NavLink>
  )

  const sectionedNav = () => (
    <nav className="flex-1 overflow-y-auto min-h-0 px-2 py-2">
      {sections.map((section) => {
        const isOpen = openSections[section.id] === true
        const isActiveSection = activeSectionId === section.id
        // Accueil, ou section réduite à une seule page (selon les modules et les droits) : la page directement, sans repli
        const entrees = entreesMenu(section.items)
        if (section.flat || entrees.length === 1) return <div key={section.id} className="mb-1 space-y-0.5">{entrees.map((item) => navItem(item))}</div>
        const SectionIcon = section.icon
        return (
          <div key={section.id} className="mb-1">
            <button
              type="button"
              onClick={() => setOpenSections((prev) => ({ ...prev, [section.id]: !isOpen }))}
              aria-expanded={isOpen}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-ui-sm ${navHover}`}
            >
              <span className={`flex items-center gap-2 text-ui-sm font-semibold uppercase tracking-[0.12em] ${isActiveSection ? (navIsDark ? 'text-nav-fg' : 'text-gray-900') : navMuted}`}>
                {SectionIcon && <SectionIcon className="w-4 h-4 flex-none" aria-hidden="true" />}
                {section.label}
                {!isOpen && <span className="font-normal normal-case tracking-normal opacity-70">({entrees.length})</span>}
              </span>
              <ChevronDown className={`w-4 h-4 ${navMuted} transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <div className="mt-0.5 space-y-0.5">
                {entrees.map((item) => navItem(item, true))}
              </div>
            )}
          </div>
        )
      })}
      {!fieldOnly && (
        <button type="button" onClick={basculerMode} className={`w-full text-left px-3 py-1.5 text-ui-sm underline-offset-2 hover:underline ${navMuted}`}>
          {simple ? 'Afficher tout le menu' : 'Menu simple'}
        </button>
      )}
      {settingsItems.length > 0 && (
        <div className={`mt-2 pt-2 border-t ${navIsDark ? 'border-nav-fg/10' : 'border-gray-200'} space-y-0.5`}>
          {settingsItems.map((item) => navItem(item))}
        </div>
      )}
    </nav>
  )

  const userBlock = () => (
    <div className={`px-3 py-3 border-t ${navIsDark ? 'border-nav-fg/10' : 'border-gray-200'} flex items-center gap-3`}>
      <div className="w-9 h-9 rounded-full bg-highlight-500 text-highlight-fg flex items-center justify-center font-semibold text-ui-sm uppercase">
        {initials(profile, user)}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className={`text-ui font-medium truncate ${navText}`}>{profile?.display_name || user?.email}</div>
        <div className={`text-ui-sm truncate ${navMuted}`}>{fieldOnly ? 'Technicien' : (ROLE_LABELS[userRole] || userRole)}</div>
      </div>
      <button type="button" onClick={handleLogout} aria-label="Se déconnecter" className={`p-2 rounded-ui-sm ${navMuted} ${navHover}`}>
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  )

  // ─── Variante rail : barre d'icônes avec libellés + sous-menu ───────────
  // Une section à une seule entrée ouvre directement sa page ; les autres affichent leurs pages à côté, sans changer de page.
  const railSectionObj = sections.find((s) => s.id === railSection) || sections[0]
  const railBtn = (on) => `w-[70px] min-h-[52px] py-1.5 px-0.5 rounded-ui-sm flex flex-col items-center justify-center gap-1 transition-colors ${on ? 'bg-accent-500 text-accent-fg' : 'text-nav-fg/70 hover:bg-nav-fg/10 hover:text-nav-fg'}`
  const railLabel = 'text-[10px] tracking-tight leading-tight text-center w-full truncate'
  const rail = () => (
    <>
      <div className="w-[76px] bg-nav flex flex-col items-center py-3 gap-1 flex-none overflow-y-auto">
        {icon ? <img src={icon} alt="" className="w-11 h-11 rounded-ui-sm object-cover mb-2 flex-none" /> : <div className="bg-white rounded-ui-sm p-1 mb-2 flex items-center justify-center w-11 h-11 flex-none">
          {logo ? <img src={logo} alt="" className="max-h-9 max-w-9 object-contain" /> : <span className="font-display font-bold">{(branding.app_name || 'O').slice(0, 1)}</span>}
        </div>}
        {sections.map((s) => {
          const Icon = s.icon || s.items[0]?.icon
          const seule = entreesMenu(s.items).length === 1
          const on = seule ? activeSectionId === s.id : railSection === s.id
          return (
            <button
              key={s.id}
              type="button"
              title={s.label}
              aria-current={activeSectionId === s.id ? 'page' : undefined}
              onClick={() => { setRailSection(s.id); if (seule) navigate(s.items[0].to) }}
              className={railBtn(on)}
            >
              {Icon ? <Icon className="w-5 h-5 flex-none" aria-hidden="true" /> : null}
              <span className={railLabel}>{s.label}</span>
            </button>
          )
        })}
        {!fieldOnly && (
          <button type="button" onClick={basculerMode} title={simple ? 'Afficher tout le menu' : 'Menu simple'} className={railBtn(false)}>
            <MoreHorizontal className="w-5 h-5 flex-none" aria-hidden="true" />
            <span className={railLabel}>{simple ? 'Tout' : 'Simple'}</span>
          </button>
        )}
        <div className="flex-1 min-h-2" />
        {settingsItems.map((item) => (
          <NavLink key={item.to} to={item.to} title={item.label}
            className={({ isActive }) => `relative ${railBtn(false)} ${isActive ? '!bg-nav-fg/15 !text-nav-fg' : ''}`}>
            <item.icon className="w-5 h-5 flex-none" aria-hidden="true" />
            <span className={railLabel}>{item.short || item.label}</span>
            {item.dot && <span className="absolute top-1.5 right-3 w-2.5 h-2.5 rounded-full bg-accent-500" aria-label="nouveau" />}
          </NavLink>
        ))}
        {/* Compte, mot de passe et déconnexion : menu des initiales, en haut à droite */}
      </div>
      <div className="w-52 bg-white border-r border-gray-200 flex flex-col flex-none">
        <div className="px-3 pt-4 pb-2">
          <div className="font-display font-semibold text-gray-900">{railSectionObj?.label}</div>
          <div className="text-ui-sm text-gray-500 truncate">{branding.app_name || branding.org_name}</div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {entreesMenu(railSectionObj?.items).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}
              className={({ isActive }) => `flex items-center gap-2.5 px-2.5 py-1.5 rounded-ui-sm text-ui ${isActive || (item.routes || []).some((r) => surRoute(location.pathname, r)) ? 'bg-gray-100 text-gray-900 font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}>
              <item.icon className="w-4 h-4 flex-none" aria-hidden="true" />
              <span className="truncate flex-1">{item.label}</span>
              {item.soon && <span className="badge badge-neutral" style={{ height: 18, fontSize: 10.5 }}>bientôt</span>}
            </NavLink>
          ))}
        </nav>
      </div>
    </>
  )

  // ─── Menu Affichage ────────────────────────────────────────
  const choice = ({ label, options, value, onChange, render }) => (
    <div key={label} className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-ui-sm text-gray-500">{label}</span>
      <div className="flex rounded-ui-sm border border-gray-200 overflow-hidden">
        {options.map((o) => (
          <button key={o} type="button" onClick={() => onChange(o)}
            className={`px-2.5 py-1 text-ui-sm ${value === o ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            {render ? render(o) : o}
          </button>
        ))}
      </div>
    </div>
  )
  const displayMenu = () => (
    <div className="absolute right-0 top-11 w-[320px] max-w-[calc(100vw-1rem)] bg-white rounded-ui border border-gray-200 shadow-md z-50 p-3 animate-fadeIn">
      <div className="font-display font-semibold mb-2">Affichage</div>
      <div className="grid grid-cols-2 gap-2 mb-3" role="radiogroup" aria-label="Mode">
        {[['simple', 'Simple', 'Les pages du quotidien, le reste en onglets'], ['complet', 'Complet', 'Toutes les pages dans le menu']].map(([k, label, desc]) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => update({ mode: k })}
            className={`rounded-ui-sm border p-2 text-left ${mode === k ? 'border-accent-500 ring-2 ring-accent-500/20' : 'border-gray-200 hover:border-gray-300'}`}>
            <div className="text-ui font-semibold">{label}</div>
            <div className="text-ui-sm text-gray-500 leading-tight mt-0.5">{desc}</div>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {Object.entries(UI_PRESETS).map(([key, p]) => (
          <button key={key} type="button" onClick={() => update({ preset: key })}
            className={`rounded-ui-sm border p-2 text-left ${prefs.preset === key ? 'border-accent-500 ring-2 ring-accent-500/20' : 'border-gray-200 hover:border-gray-300'}`}>
            <div className="text-ui font-semibold">{p.label}</div>
            <div className="text-ui-sm text-gray-500 leading-tight mt-0.5">{p.description}</div>
          </button>
        ))}
      </div>
      <div className="border-t border-gray-100 pt-2">
        {choice({ label: 'Densité', options: DENSITIES, value: prefs.density, onChange: (v) => update({ density: v }),
          render: (o) => ({ compact: 'Compacte', normal: 'Normale', large: 'Large' })[o] })}
        {choice({ label: 'Navigation', options: NAVS, value: prefs.nav, onChange: (v) => update({ nav: v }),
          render: (o) => ({ dark: 'Sombre', light: 'Claire', rail: 'Icônes' })[o] })}
        {choice({ label: 'Arrondis', options: RADII, value: prefs.radius, onChange: (v) => update({ radius: v }),
          render: (o) => ({ sm: 'Nets', md: 'Moyens', lg: 'Ronds' })[o] })}
        {choice({ label: 'Listes', options: LISTS, value: prefs.lists, onChange: (v) => update({ lists: v }),
          render: (o) => ({ table: 'Tableaux', cards: 'Cartes' })[o] })}
      </div>
      <div className="text-ui-sm text-gray-400 mt-2">Réglages personnels, mémorisés sur votre compte.</div>
    </div>
  )

  const notificationsMenu = () => (
    <div className="absolute right-0 top-11 w-[360px] max-w-[calc(100vw-1rem)] bg-white rounded-ui border border-gray-200 shadow-md z-50 overflow-hidden animate-fadeIn">
      <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
        <span className="font-display font-semibold">Notifications</span>
        {unreadCount > 0 && (
          <button type="button" onClick={markAllAsRead} className="text-ui-sm text-accent-700 hover:underline flex items-center gap-1">
            <Check className="w-3.5 h-3.5" />Tout marquer comme lu
          </button>
        )}
      </div>
      <div className="max-h-96 overflow-y-auto">
        {notifications.length === 0 ? (
          <p className="p-4 text-center text-gray-500 text-ui">Aucune notification</p>
        ) : notifications.map((n) => {
          const Icon = NOTIF_ICONS[n.type] || Info
          return (
            <div key={n.id} className={`border-b border-gray-100 ${!n.read_at ? 'bg-accent-500/5' : ''}`}>
            <button type="button"
              onClick={() => { markAsRead(n.id); if (n.link) navigate(n.link); setShowNotifications(false) }}
              className="w-full text-left px-3 py-2.5 hover:bg-gray-50 flex items-start gap-3">
              <span className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center flex-none ${!n.read_at ? 'bg-accent-500/10 text-accent-700' : 'bg-gray-100 text-gray-500'}`}>
                <Icon className="w-4 h-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-ui ${!n.read_at ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{n.title}</span>
                {n.message && <span className="block text-ui-sm text-gray-500 truncate">{n.message}</span>}
                <span className="block text-ui-sm text-gray-400 mt-0.5">{format(new Date(n.created_at), 'd MMM à HH:mm', { locale: fr })}</span>
              </span>
            </button>
            {n.type === 'email_sync' && n.metadata?.to_email && (
              <div className="px-3 pb-2 pl-[52px]">
                <button type="button" onClick={() => ignoreAddress(n)} className="text-ui-sm text-gray-500 hover:text-gray-800 underline">Ne plus signaler cette adresse</button>
              </div>
            )}
            </div>
          )
        })}
      </div>
    </div>
  )

  const closeMenus = () => { setShowNotifications(false); setShowUserMenu(false); setShowDisplay(false); setShowNouveau(false) }

  return (
    <div className="min-h-screen flex">
      {/* Navigation bureau */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-30">
        {prefs.nav === 'rail' ? (
          <div className="flex h-full">{rail()}</div>
        ) : (
          <div className={`w-64 h-full flex flex-col ${navBg}`}>
            <div className="px-3 pt-4 pb-3">{brand()}</div>
            {sectionedNav()}
            {userBlock()}
          </div>
        )}
      </aside>

      {showBottomNav && (
        <nav aria-label="Navigation principale" className="bottom-nav lg:hidden">
          {bottomItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `bottom-nav-item ${isActive ? 'is-active' : ''}`}>
              <item.icon className="w-[22px] h-[22px]" aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          ))}
          <button type="button" onClick={() => setDrawerOpen(true)} className={`bottom-nav-item ${drawerOpen ? 'is-active' : ''}`} aria-label="Plus de rubriques">
            <MoreHorizontal className="w-[22px] h-[22px]" aria-hidden="true" />
            <span>Plus</span>
          </button>
        </nav>
      )}

      {/* Tiroir mobile */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className={`absolute left-0 top-0 bottom-0 w-72 flex flex-col ${navBg}`} style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            <div className="px-3 pt-4 pb-3 flex items-center justify-between">
              {brand()}
              <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Fermer" className={`p-2 ${navMuted}`}><X className="w-5 h-5" /></button>
            </div>
            {sectionedNav()}
            {userBlock()}
          </div>
        </div>
      )}

      {/* Contenu */}
      <div className={`flex-1 min-w-0 ${prefs.nav === 'rail' ? 'lg:pl-[284px]' : 'lg:pl-64'}`}>
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="flex items-center gap-2 sm:gap-3 h-14" style={{ paddingLeft: 'var(--page-px)', paddingRight: 'var(--page-px)' }}>
            <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Menu" className="lg:hidden p-2 -ml-2 rounded-ui-sm text-gray-700 hover:bg-gray-100">
              <Menu className="w-5 h-5" />
            </button>
            <div className="lg:hidden flex items-center gap-2 min-w-0">
              {brand(true)}
              {pageTitle && <span className="font-display font-semibold text-gray-900 truncate">{pageTitle}</span>}
            </div>
            <h1 className="hidden lg:block font-display font-semibold text-gray-900 truncate" style={{ fontSize: 'calc(var(--text-ui) * 1.15)' }}>{pageTitle}</h1>
            <div className="flex-1" />
            {creations.length > 0 && (
              <div className="relative">
                <button type="button" onClick={() => { const v = !showNouveau; closeMenus(); setShowNouveau(v) }} aria-haspopup="menu" aria-expanded={showNouveau}
                  className="btn btn-primary h-9 px-3"><Plus className="w-4 h-4" /><span className="hidden sm:inline">Nouveau</span></button>
                {showNouveau && (
                  <div role="menu" className="absolute right-0 top-11 w-56 bg-white rounded-ui border border-gray-200 shadow-md z-50 py-1 animate-fadeIn">
                    {creations.map((c) => (
                      <button key={c.to} type="button" role="menuitem" className="w-full text-left px-3 py-2 text-ui text-gray-700 hover:bg-gray-50"
                        onClick={() => { closeMenus(); navigate(c.to, c.sansOuverture ? undefined : { state: { openNew: true } }) }}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <SelecteurSociete />

            {!fieldOnly && <div className="relative">
              <button type="button" onClick={() => { const v = !showNotifications; closeMenus(); setShowNotifications(v) }} aria-label="Notifications"
                className={`h-9 w-9 rounded-ui-sm flex items-center justify-center hover:bg-gray-100 relative ${showNotifications ? 'bg-gray-100 text-gray-900' : 'text-gray-600'}`}>
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-accent-500 text-accent-fg text-ui-sm rounded-full flex items-center justify-center font-semibold">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {showNotifications && notificationsMenu()}
            </div>}

            <div className="relative">
              <button type="button" onClick={() => { const v = !showUserMenu; closeMenus(); setShowUserMenu(v) }} aria-label="Compte"
                className="h-9 pl-1 pr-2 rounded-ui-sm flex items-center gap-2 hover:bg-gray-100">
                <span className="relative w-7 h-7 rounded-full bg-highlight-500 text-highlight-fg flex items-center justify-center font-semibold text-ui-sm uppercase">
                  {initials(profile, user)}
                  {notices.unseen && !fieldOnly && (modules || []).includes('nouveautes') && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent-500 ring-2 ring-white" aria-label="Nouveautés à voir" />}
                </span>
                <ChevronDown className="w-4 h-4 text-gray-500 hidden sm:block" />
              </button>
              {showDisplay && displayMenu()}
              {showUserMenu && (
                <div className="absolute right-0 top-11 w-64 bg-white rounded-ui border border-gray-200 shadow-md z-50 overflow-hidden animate-fadeIn">
                  <div className="px-3 py-3 border-b border-gray-100">
                    <div className="text-ui font-semibold text-gray-900 truncate">{profile?.display_name || user?.email}</div>
                    <div className="text-ui-sm text-gray-500 truncate">{user?.email}</div>
                    <div className="mt-1"><span className="badge badge-neutral">{ROLE_LABELS[userRole] || userRole}</span></div>
                  </div>
                  <div className="py-1">
                    {settingsItems.map((item) => (
                      <NavLink key={item.to} to={item.to} onClick={closeMenus} className="flex items-center gap-3 px-3 py-2 text-ui text-gray-700 hover:bg-gray-50">
                        <item.icon className="w-4 h-4" />{item.label}
                        {item.dot && <span className="ml-auto badge badge-warning" style={{ height: 18, fontSize: 10.5 }}>nouveau</span>}
                      </NavLink>
                    ))}
                    <button type="button" onClick={() => { closeMenus(); setShowDisplay(true) }} className="w-full flex items-center gap-3 px-3 py-2 text-ui text-gray-700 hover:bg-gray-50">
                      <SlidersHorizontal className="w-4 h-4" />Affichage
                    </button>
                    <NavLink to="/settings/email" onClick={closeMenus} className="flex items-center gap-3 px-3 py-2 text-ui text-gray-700 hover:bg-gray-50">
                      <Mail className="w-4 h-4" />Ma boîte d'envoi
                    </NavLink>
                    <NavLink to="/mot-de-passe" onClick={closeMenus} className="flex items-center gap-3 px-3 py-2 text-ui text-gray-700 hover:bg-gray-50">
                      <KeyRound className="w-4 h-4" />Changer mon mot de passe
                    </NavLink>
                    <button type="button" onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2 text-ui text-gray-700 hover:bg-gray-50">
                      <LogOut className="w-4 h-4" />Se déconnecter
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {(showNotifications || showUserMenu || showDisplay || showNouveau) && <div className="fixed inset-0 z-10" onClick={closeMenus} />}

        <main className={`max-w-7xl mx-auto ${showBottomNav ? 'has-bottom-nav' : ''}`} style={{ padding: 'var(--space-4) var(--page-px)', paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
          {branding?.demo_mode && (
            <div className="mb-4 rounded-ui px-3 py-2 text-ui-sm flex items-center gap-2" style={{ background: 'rgb(var(--c-warning-bg))', color: 'rgb(var(--c-warning))' }}>
              <span className="font-semibold">Mode démonstration</span>
              <span>Les emails ne partent pas vers leurs destinataires : ils sont redirigés vers l'adresse de test.</span>
            </div>
          )}
          {notices.disponible && (
            <BandeauInfo nouveautes={!fieldOnly && (modules || []).includes('nouveautes')} retours={retoursActif !== false} />
          )}
          {boiteEnvoi === false && location.pathname !== '/settings/email' && (
            <div className="mb-3 rounded-ui border border-[rgb(var(--c-warning)/0.4)] bg-[rgb(var(--c-warning-bg))] px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-ui text-gray-800" role="status">
              <Mail className="w-4 h-4 flex-none text-[rgb(var(--c-warning))]" aria-hidden="true" />
              <span className="flex-1 min-w-[12rem]">Votre boîte d'envoi n'est pas configurée : vos devis, factures et convocations ne peuvent pas partir par email.</span>
              <NavLink to="/settings/email" className="btn btn-secondary btn-sm">Configurer ma boîte</NavLink>
            </div>
          )}
          <BandeauVueGroupe />
          {onglets.length > 1 && (
            <nav aria-label="Pages de la rubrique" className="tabs mb-4">
              <div className="flex gap-1 overflow-x-auto min-w-0 tabs-scroll">
                {onglets.map((o) => (
                  <NavLink key={o.to} to={o.to} className={`tab ${o.to === ongletActif ? 'tab-active' : ''} inline-flex items-center gap-1.5 whitespace-nowrap`}
                    aria-current={o.to === ongletActif ? 'page' : undefined}>
                    <o.icon className="w-4 h-4" aria-hidden="true" />{o.label}
                  </NavLink>
                ))}
              </div>
            </nav>
          )}
          {!fieldAllowed ? <Navigate to="/interventions" replace />
            : pageAutorisee ? <RouteErrorBoundary><Outlet /></RouteErrorBoundary>
            : <PageRefusee accueil={location.pathname !== '/'} />}
        </main>
      </div>

      <ChoixSociete />
      {retoursActif !== false && <PostIt userId={user?.id} pageTitle={pageTitle} complet={retoursActif === true} />}
      <WelcomeSheet user={user} profile={profile} userRole={userRole} />
    </div>
  )
}

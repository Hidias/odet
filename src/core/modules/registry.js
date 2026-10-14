import {
  LayoutDashboard, Calendar, GraduationCap, Users, UserCheck, FileText, FileQuestion, ClipboardCheck,
  Building2, Receipt, CreditCard, Search, Mail, Globe, Layers, FolderInput, Shield, Wallet, Calculator,
  Megaphone, FolderCheck, CheckCircle, BarChart3, AlertTriangle, Award, Eye, Target, ScrollText,
  MapPin, Briefcase, Settings, Sliders, ShieldCheck, BookUser,
} from 'lucide-react'

// Registre des modules : chaque module déclare sa clé (celle de org_modules),
// ses entrées de menu et les rôles qui y ont accès.
// Un module désactivé dans org_modules disparaît du menu et des routes.

export const ALL_ROLES = ['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture']
const STAFF = ['superadmin', 'admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'lecture']
const MANAGERS = ['superadmin', 'admin', 'direction', 'gestionnaire']
const SALES = ['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial']
const FINANCE = ['superadmin', 'admin', 'direction', 'comptable']
const ADMINS = ['superadmin', 'admin']

export const NAV_SECTIONS = [
  {
    id: 'formation',
    module: 'formation',
    label: 'Formation',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Tableau de bord', roles: STAFF },
      { to: '/sessions', icon: Calendar, label: 'Sessions', roles: STAFF },
      { to: '/formations', icon: GraduationCap, label: 'Catalogue', roles: STAFF },
      { to: '/stagiaires', icon: Users, label: 'Stagiaires', roles: STAFF },
      { to: '/passeport', icon: BookUser, label: 'Passeport de prévention', roles: MANAGERS, module: 'passeport' },
      { to: '/formateurs', icon: UserCheck, label: 'Formateurs', roles: MANAGERS },
      { to: '/documents', icon: FileText, label: 'Documents', roles: STAFF },
      { to: '/documents-vierges', icon: FileQuestion, label: 'Documents vierges', roles: STAFF },
      { to: '/tests-positionnement', icon: ClipboardCheck, label: 'Tests et quiz', roles: STAFF },
    ],
  },
  {
    id: 'commerce',
    module: 'commercial',
    label: 'Commerce',
    items: [
      { to: '/clients', icon: Building2, label: 'Clients', roles: STAFF },
      { to: '/devis', icon: Receipt, label: 'Devis', roles: SALES },
      { to: '/factures', icon: CreditCard, label: 'Factures', roles: [...SALES, 'comptable'] },
      { to: '/prospection', icon: Search, label: 'Suivi commercial', roles: SALES, module: 'prospection' },
      { to: '/mailing', icon: Mail, label: 'Campagnes email', roles: SALES, module: 'mailing' },
      { to: '/prospection-massive', icon: Globe, label: 'Base prospects', roles: SALES, module: 'prospection' },
      { to: '/multi-etablissements', icon: Layers, label: 'Multi-établissements', roles: SALES, module: 'prospection' },
      { to: '/admin/import', icon: FolderInput, label: 'Import', roles: ADMINS, module: 'prospection' },
    ],
  },
  {
    id: 'prestations',
    module: 'duerp',
    label: 'Prestations',
    items: [
      { to: '/duerp', icon: Shield, label: 'DUERP', roles: MANAGERS },
    ],
  },
  {
    id: 'finance',
    module: 'finance',
    label: 'Finance',
    items: [
      { to: '/budget', icon: Wallet, label: 'Budget', roles: FINANCE },
      { to: '/comptable', icon: Calculator, label: 'Espace comptable', roles: FINANCE, module: 'comptabilite' },
    ],
  },
  {
    id: 'communication',
    module: 'social',
    label: 'Communication',
    items: [
      { to: '/social', icon: Megaphone, label: 'Réseaux sociaux', roles: SALES },
    ],
  },
  {
    id: 'qualite',
    module: 'qualite',
    label: 'Qualité',
    items: [
      { to: '/qualite', icon: FolderCheck, label: 'Processus qualité', roles: MANAGERS },
      { to: '/qualite/completude', icon: CheckCircle, label: 'Complétude', roles: MANAGERS },
      { to: '/indicateurs', icon: BarChart3, label: 'Indicateurs', roles: STAFF },
      { to: '/non-conformites', icon: AlertTriangle, label: 'Non-conformités', roles: MANAGERS },
      { to: '/qualiopi', icon: Award, label: 'Qualiopi', roles: MANAGERS },
      { to: '/certification', icon: ShieldCheck, label: 'Certification', roles: MANAGERS, module: 'certification' },
      { to: '/bpf', icon: FileText, label: 'BPF', roles: MANAGERS },
      { to: '/veille-qualiopi', icon: Eye, label: 'Veille', roles: MANAGERS },
      { to: '/registre-psh', icon: Shield, label: 'Registre PSH', roles: MANAGERS },
      { to: '/profil-stagiaires', icon: Target, label: 'Profil stagiaires', roles: MANAGERS },
      { to: '/audit-logs', icon: ScrollText, label: 'Journal d\'audit', roles: ADMINS },
    ],
  },
  {
    id: 'entreprise',
    module: 'interventions',
    label: 'Entreprise',
    items: [
      { to: '/interventions', icon: MapPin, label: 'Interventions', roles: STAFF },
      { to: '/collaborateurs', icon: Briefcase, label: 'Collaborateurs', roles: MANAGERS, module: 'rh', soon: true },
    ],
  },
]

export const SETTINGS_ITEMS = [
  { to: '/parametres', icon: Settings, label: 'Paramètres', roles: ADMINS },
  { to: '/console', icon: Sliders, label: 'Console', roles: ['superadmin'] },
]

// Filtre les sections et entrées selon les modules activés et le rôle de l'utilisateur
export function visibleSections(enabledModules, role) {
  const enabled = new Set(enabledModules || [])
  return NAV_SECTIONS
    .filter((s) => enabled.has(s.module))
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => (!i.module || enabled.has(i.module)) && (!i.roles || i.roles.includes(role))),
    }))
    .filter((s) => s.items.length > 0)
}

// Titre de page déduit de la route (pour la barre du haut)
export function pageTitleFor(pathname) {
  const all = [...NAV_SECTIONS.flatMap((s) => s.items), ...SETTINGS_ITEMS]
  const exact = all.find((i) => i.to === pathname)
  if (exact) return exact.label
  const prefix = all
    .filter((i) => i.to !== '/' && pathname.startsWith(i.to + '/'))
    .sort((a, b) => b.to.length - a.to.length)[0]
  return prefix ? prefix.label : ''
}

export function sectionIdFor(pathname) {
  for (const s of NAV_SECTIONS) {
    for (const i of s.items) {
      if (i.to === '/' ? pathname === '/' : pathname === i.to || pathname.startsWith(i.to + '/')) return s.id
    }
  }
  return null
}

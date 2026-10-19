import {
  LayoutDashboard, Calendar, GraduationCap, Users, UserCheck, FileText, FileQuestion, ClipboardCheck,
  Building2, Receipt, CreditCard, Search, Mail, Globe, Layers, FolderInput, Shield, Wallet, Calculator,
  Megaphone, FolderCheck, CheckCircle, BarChart3, AlertTriangle, Award, Eye, Target, ScrollText,
  MapPin, Briefcase, Settings, Sliders, ShieldCheck, BookUser, Workflow, Sparkles, StickyNote,
} from 'lucide-react'

// Registre des modules : chaque module déclare sa clé (celle de org_modules),
// ses entrées de menu, les rôles qui y ont accès et le droit (C1b) qui ouvre la page.
// Un module désactivé dans org_modules disparaît du menu et des routes.
//
// Gardes des pages (branche ecrans/gardes) : une même table sert au menu et à l'adresse directe.
//  - droits connus (my_rights) : la page s'ouvre si le compte a le droit (un des droits si c'est une liste)
//    ET si son rôle figure dans `roles` (les droits ne font que restreindre l'accès d'avant ; un compte au rôle
//    de base « membre » n'a que ses droits) ;
//  - droits inconnus (fonction absente, lecture en échec) : `fallbackRoles` s'il existe, sinon `roles`.

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
      { to: '/sessions', right: ['formation.sessions.voir', 'formation.sessions.voir_siennes'], icon: Calendar, label: 'Sessions', roles: STAFF },
      { to: '/formations', right: 'formation.catalogue.voir', icon: GraduationCap, label: 'Catalogue', roles: STAFF },
      { to: '/stagiaires', right: ['formation.stagiaires.voir', 'formation.stagiaires.voir_siens'], icon: Users, label: 'Stagiaires', roles: STAFF },
      { to: '/passeport', right: 'passeport.declarations.gerer', icon: BookUser, label: 'Passeport de prévention', roles: MANAGERS, module: 'passeport' },
      { to: '/formateurs', right: 'formation.formateurs.gerer', icon: UserCheck, label: 'Formateurs', roles: MANAGERS },
      { to: '/documents', right: 'formation.documents.voir', icon: FileText, label: 'Documents', roles: STAFF },
      { to: '/documents-vierges', right: 'formation.documents.voir', icon: FileQuestion, label: 'Documents vierges', roles: STAFF },
      { to: '/tests-positionnement', right: 'formation.catalogue.voir', icon: ClipboardCheck, label: 'Tests et quiz', roles: STAFF },
    ],
  },
  {
    id: 'commerce',
    module: 'commercial',
    label: 'Commerce',
    items: [
      { to: '/clients', right: 'clients.fiches.voir', icon: Building2, label: 'Clients', roles: STAFF },
      { to: '/devis', right: 'commercial.devis.voir', icon: Receipt, label: 'Devis', roles: SALES },
      { to: '/factures', right: 'facturation.factures.voir', icon: CreditCard, label: 'Factures', roles: [...SALES, 'comptable'] },
      { to: '/prospection', right: 'commercial.prospection.voir', icon: Search, label: 'Suivi commercial', roles: SALES, module: 'prospection' },
      { to: '/mailing', right: 'communication.campagnes.gerer', icon: Mail, label: 'Campagnes email', roles: SALES, module: 'mailing' },
      { to: '/prospection-massive', right: 'commercial.prospection.voir', icon: Globe, label: 'Base prospects', roles: SALES, module: 'prospection' },
      { to: '/multi-etablissements', right: 'commercial.prospection.voir', icon: Layers, label: 'Multi-établissements', roles: SALES, module: 'prospection' },
      { to: '/admin/import', right: 'commercial.prospection.gerer', icon: FolderInput, label: 'Import', roles: ADMINS, module: 'prospection' },
    ],
  },
  {
    id: 'prestations',
    module: 'duerp',
    label: 'Prestations',
    items: [
      { to: '/duerp', right: 'prestations.duerp.gerer', icon: Shield, label: 'DUERP', roles: MANAGERS },
    ],
  },
  {
    id: 'finance',
    module: 'finance',
    label: 'Finance',
    items: [
      { to: '/budget', right: 'finance.budget.gerer', icon: Wallet, label: 'Budget', roles: FINANCE },
      { to: '/comptable', right: 'facturation.export.comptable', icon: Calculator, label: 'Espace comptable', roles: FINANCE, module: 'comptabilite' },
    ],
  },
  {
    id: 'communication',
    module: 'social',
    label: 'Communication',
    items: [
      { to: '/social', right: 'communication.reseaux.gerer', icon: Megaphone, label: 'Réseaux sociaux', roles: SALES },
    ],
  },
  {
    id: 'qualite',
    module: 'qualite',
    label: 'Qualité',
    items: [
      { to: '/qualite', right: 'qualite.registres.gerer', icon: FolderCheck, label: 'Processus qualité', roles: MANAGERS },
      { to: '/qualite/completude', right: 'qualite.completude.suivre', icon: CheckCircle, label: 'Complétude', roles: MANAGERS },
      { to: '/indicateurs', right: 'qualite.registres.voir', icon: BarChart3, label: 'Indicateurs', roles: STAFF },
      { to: '/non-conformites', right: 'qualite.registres.gerer', icon: AlertTriangle, label: 'Non-conformités', roles: MANAGERS },
      { to: '/qualiopi', right: 'qualite.registres.gerer', icon: Award, label: 'Qualiopi', roles: MANAGERS },
      { to: '/certification', right: 'qualite.certification.gerer', icon: ShieldCheck, label: 'Certification', roles: MANAGERS, module: 'certification' },
      { to: '/bpf', right: 'qualite.registres.gerer', icon: FileText, label: 'BPF', roles: MANAGERS },
      { to: '/veille-qualiopi', right: 'qualite.registres.gerer', icon: Eye, label: 'Veille', roles: MANAGERS },
      { to: '/registre-psh', right: 'qualite.registres.voir', icon: Shield, label: 'Registre PSH', roles: MANAGERS },
      { to: '/profil-stagiaires', right: 'qualite.registres.gerer', icon: Target, label: 'Profil stagiaires', roles: MANAGERS },
      { to: '/audit-logs', right: 'conformite.journal.voir', icon: ScrollText, label: 'Journal d\'audit', roles: ADMINS },
    ],
  },
  {
    id: 'entreprise',
    module: 'interventions',
    label: 'Entreprise',
    items: [
      { to: '/interventions', right: ['interventions.visites.voir', 'interventions.missions.voir'], icon: MapPin, label: 'Interventions', roles: STAFF },
      { to: '/collaborateurs', right: 'rh.personnel.voir', icon: Briefcase, label: 'Collaborateurs', roles: MANAGERS, module: 'rh', soon: true },
    ],
  },
]

export const SETTINGS_ITEMS = [
  // Quoi de neuf (module « nouveautes », chantier A) : tout compte interne qui voit les réglages de l'organisme
  { to: '/nouveautes', icon: Sparkles, label: 'Quoi de neuf', module: 'nouveautes', right: 'organisation.reglages.voir' },
  // Paramètres : super administrateur ; administrateur seulement avec la licence totale (droit parametres.ouvrir,
  // filtré par la base) ; direction jamais (décision du 17/10). Droits inconnus : super administrateur seulement.
  { to: '/parametres', icon: Settings, label: 'Paramètres', roles: ADMINS, right: 'parametres.ouvrir', fallbackRoles: ['superadmin'] },
  // Règles de gestion : circuits de validation et comptable externe, hors Paramètres (la direction y accède)
  { to: '/regles-gestion', icon: Workflow, label: 'Règles de gestion', roles: ['superadmin', 'admin', 'direction', 'membre'],
    right: ['validations.circuits.configurer', 'facturation.comptable_externe.regler'], fallbackRoles: [] },
  // Suivi des retours (module « retours », chantier A) : super administrateur et administrateur ; droits inconnus :
  // super administrateur seulement
  { to: '/retours', icon: StickyNote, label: 'Retours des utilisateurs', module: 'retours', roles: ['superadmin', 'admin', 'membre'],
    right: 'organisation.retours.suivre', fallbackRoles: ['superadmin'] },
  { to: '/console', right: 'plateforme.administrer', icon: Sliders, label: 'Console', roles: ['superadmin'] },
]

// Le compte peut-il ouvrir cette entrée ? `can(code)` renvoie true, false, ou null quand les droits sont inconnus.
export function itemAutorise(item, role, can) {
  if (!item) return true
  const codes = item.right ? (Array.isArray(item.right) ? item.right : [item.right]) : []
  const verdicts = typeof can === 'function' ? codes.map((c) => can(c)) : []
  const droitsConnus = codes.length > 0 && verdicts.length > 0 && verdicts.every((v) => v === true || v === false)
  if (droitsConnus) {
    if (!verdicts.some((v) => v === true)) return false
    return role === 'membre' || !item.roles || item.roles.includes(role)
  }
  const roles = item.fallbackRoles || item.roles
  return !roles || roles.includes(role)
}

// Filtre les sections et entrées selon les modules activés, le rôle et les droits de l'utilisateur
export function visibleSections(enabledModules, role, can) {
  const enabled = new Set(enabledModules || [])
  return NAV_SECTIONS
    .filter((s) => enabled.has(s.module))
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => (!i.module || enabled.has(i.module)) && itemAutorise(i, role, can)),
    }))
    .filter((s) => s.items.length > 0)
}

// `modules` (facultatif) : une entrée rattachée à un module n'apparaît que si le module est actif
export function visibleSettingsItems(role, can, modules = null) {
  const actifs = modules ? new Set(modules) : null
  return SETTINGS_ITEMS.filter((i) => (!i.module || !actifs || actifs.has(i.module)) && itemAutorise(i, role, can))
}

// Pages hors menu, rattachées à une entrée (même garde)
const ALIASES = [
  { prefix: '/setup', to: '/parametres' },
  { prefix: '/settings/email', to: null }, // sa propre boîte d'envoi : tout compte connecté
  { prefix: '/mot-de-passe', to: null },
  { prefix: '/design-systeme', to: null },
]

// Entrée du registre qui garde une adresse (la plus précise), ou null si l'adresse n'est pas gardée
export function entreePourChemin(pathname) {
  const alias = ALIASES.find((a) => pathname === a.prefix || pathname.startsWith(a.prefix + '/'))
  const all = [...NAV_SECTIONS.flatMap((s) => s.items.map((i) => ({ ...i, module: i.module || s.module }))), ...SETTINGS_ITEMS]
  if (alias) return alias.to ? all.find((i) => i.to === alias.to) || null : null
  const exact = all.find((i) => i.to === pathname)
  if (exact) return exact
  return all
    .filter((i) => i.to !== '/' && pathname.startsWith(i.to + '/'))
    .sort((a, b) => b.to.length - a.to.length)[0] || null
}

// Garde d'une adresse : rôle et droits (le module coupé reste géré comme avant par les pages)
export function accesPage(pathname, role, can) {
  return itemAutorise(entreePourChemin(pathname), role, can)
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

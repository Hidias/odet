import {
  LayoutDashboard, Calendar, GraduationCap, Users, UserCheck, FileText, FileQuestion, ClipboardCheck,
  Building2, Receipt, CreditCard, Search, Mail, Globe, Layers, FolderInput, Shield, Wallet, Calculator,
  Megaphone, FolderCheck, CheckCircle, BarChart3, AlertTriangle, Award, Eye, Target, ScrollText,
  MapPin, Briefcase, Settings, Sliders, ShieldCheck, BookUser, Workflow, Sparkles, StickyNote, CalendarClock, Inbox,
  Home, Store, Wrench, ClipboardList, KanbanSquare, Fingerprint, Package, Landmark, Car, ListTodo, CalendarCheck, BookOpenText, HeartHandshake,
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

// Chaque section porte son icône (barre d'icônes) ; `flat` : affichée sans titre ni repli (une seule entrée).
// L'accueil n'appartient à aucun module : il reste visible quels que soient les modules actifs.
export const NAV_SECTIONS = [
  {
    id: 'accueil',
    module: null,
    label: 'Accueil',
    icon: Home,
    flat: true,
    items: [
      { simple: true, to: '/', icon: LayoutDashboard, label: 'Tableau de bord', roles: STAFF },
      // Actions de l'équipe et point de la semaine (0407)
      { simple: true, to: '/actions', right: 'organisation.reglages.voir', icon: ListTodo, label: 'Actions', roles: STAFF },
      { simple: true, to: '/point-semaine', right: 'manager.cockpit.voir', icon: CalendarCheck, label: 'Point de la semaine', roles: MANAGERS },
      // Réunions et rendez-vous : guide, notes à la volée, compte rendu (0408)
      { simple: true, to: '/reunions', right: 'organisation.reglages.voir', icon: BookOpenText, label: 'Réunions', roles: STAFF },
    ],
  },
  {
    id: 'formation',
    module: 'formation',
    label: 'Formation',
    icon: GraduationCap,
    items: [
      { simple: true, to: '/sessions', right: ['formation.sessions.voir', 'formation.sessions.voir_siennes'], icon: Calendar, label: 'Sessions', roles: STAFF },
      { simple: true, to: '/formations', right: 'formation.catalogue.voir', icon: GraduationCap, label: 'Catalogue', roles: STAFF, groupe: 'catalogue' },
      { to: '/tests-positionnement', right: 'formation.catalogue.voir', icon: ClipboardCheck, label: 'Tests et quiz', roles: STAFF, groupe: 'catalogue' },
      // Référentiel des obligations (lot 2, 0042) : périodicités des formations, du matériel et des exercices
      { to: '/obligations', right: 'formation.catalogue.voir', icon: CalendarClock, label: 'Obligations', roles: MANAGERS, groupe: 'catalogue' },
      { simple: true, to: '/stagiaires', right: ['formation.stagiaires.voir', 'formation.stagiaires.voir_siens'], icon: Users, label: 'Stagiaires', roles: STAFF },
      { simple: true, to: '/passeport', right: 'passeport.declarations.gerer', icon: BookUser, label: 'Passeport de prévention', roles: MANAGERS, module: 'passeport' },
      { to: '/formateurs', right: 'formation.formateurs.gerer', icon: UserCheck, label: 'Formateurs', roles: MANAGERS, groupe: 'formateurs' },
      // Sous-traitance, donneur d'ordres (lot 2, 0045) : prestataires, justificatifs, bons de commande
      { to: '/sous-traitants', right: 'formation.formateurs.voir', icon: Briefcase, label: 'Sous-traitants', roles: MANAGERS, groupe: 'formateurs' },
      { to: '/documents', right: 'formation.documents.voir', icon: FileText, label: 'Documents', roles: STAFF, groupe: 'documents' },
      { to: '/documents-vierges', right: 'formation.documents.voir', icon: FileQuestion, label: 'Documents vierges', roles: STAFF, groupe: 'documents' },
    ],
  },
  {
    id: 'commerce',
    module: 'commercial',
    label: 'Commerce',
    icon: Store,
    items: [
      { simple: true, to: '/clients', right: 'clients.fiches.voir', icon: Building2, label: 'Clients', roles: STAFF },
      // Suivi des affaires (chantier 10, 0380) : à faire, pipeline, clients à appeler
      { simple: true, to: '/affaires', right: 'commercial.devis.voir', icon: KanbanSquare, label: 'Affaires', roles: SALES, module: 'affaires', groupe: 'affaires' },
      { simple: true, to: '/devis', right: 'commercial.devis.voir', icon: Receipt, label: 'Devis', roles: SALES },
      { simple: true, to: '/factures', right: 'facturation.factures.voir', icon: CreditCard, label: 'Factures', roles: [...SALES, 'comptable'] },
      // Relances préparées chaque nuit, validées à la main (lot 2, 0043)
      { simple: true, to: '/a-valider', right: 'formation.convocations.envoyer', icon: Inbox, label: 'Relances à valider', roles: SALES },
      // Demandes des comptes entreprise et actualités publiées dans leurs espaces (lot 2, 0046)
      { to: '/espace-entreprise', right: 'clients.fiches.voir', icon: Megaphone, label: 'Espace entreprise', roles: SALES },
      // Pistes entre formation et maintenance (fonction 10, 0130)
      { to: '/pistes', right: 'clients.fiches.voir', icon: Workflow, label: 'Pistes', roles: SALES, module: 'pont', groupe: 'affaires' },
      // Chiffre d'affaires récurrent attendu sur 12 mois (fonction 12, 0150)
      { to: '/previsionnel', right: 'commercial.devis.voir', icon: BarChart3, label: 'Prévisionnel', roles: SALES, module: 'previsionnel', groupe: 'affaires' },
      // Qui a apporté quoi (0409) : origine du chiffre d'affaires, par personne et par rôle
      { to: '/apports', right: 'manager.cockpit.voir', icon: HeartHandshake, label: 'Qui a apporté quoi', roles: MANAGERS, groupe: 'affaires' },
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
    icon: ClipboardList,
    items: [
      { simple: true, to: '/duerp', right: 'prestations.duerp.gerer', icon: Shield, label: 'DUERP', roles: MANAGERS },
    ],
  },
  {
    id: 'finance',
    module: 'finance',
    label: 'Finance',
    icon: Wallet,
    items: [
      { simple: true, to: '/budget', right: 'finance.budget.gerer', icon: Wallet, label: 'Budget', roles: FINANCE },
      { simple: true, to: '/comptable', right: 'facturation.export.comptable', icon: Calculator, label: 'Espace comptable', roles: FINANCE, module: 'comptabilite' },
    ],
  },
  {
    id: 'communication',
    module: 'social',
    label: 'Communication',
    icon: Megaphone,
    items: [
      { simple: true, to: '/social', right: 'communication.reseaux.gerer', icon: Megaphone, label: 'Réseaux sociaux', roles: SALES },
    ],
  },
  {
    id: 'qualite',
    module: 'qualite',
    label: 'Qualité',
    icon: Award,
    items: [
      { simple: true, to: '/qualiopi', right: 'qualite.registres.gerer', icon: Award, label: 'Qualiopi', roles: MANAGERS, groupe: 'qualiopi' },
      { to: '/certification', right: 'qualite.certification.gerer', icon: ShieldCheck, label: 'Certification', roles: MANAGERS, module: 'certification', groupe: 'qualiopi' },
      { to: '/qualite', right: 'qualite.registres.gerer', icon: FolderCheck, label: 'Processus qualité', roles: MANAGERS, groupe: 'qualiopi' },
      { to: '/qualite/completude', right: 'qualite.completude.suivre', icon: CheckCircle, label: 'Dossiers à compléter', roles: MANAGERS, groupe: 'qualiopi' },
      { to: '/bpf', right: 'qualite.registres.gerer', icon: FileText, label: 'BPF (bilan annuel)', roles: MANAGERS, groupe: 'qualiopi' },
      { to: '/indicateurs', right: 'qualite.registres.voir', icon: BarChart3, label: 'Indicateurs', roles: STAFF },
      { to: '/non-conformites', right: 'qualite.registres.gerer', icon: AlertTriangle, label: 'Non-conformités', roles: MANAGERS, groupe: 'registres' },
      { to: '/registre-psh', right: 'qualite.registres.voir', icon: Shield, label: 'Registre PSH', roles: MANAGERS, groupe: 'registres' },
      { to: '/veille-qualiopi', right: 'qualite.registres.gerer', icon: Eye, label: 'Veille réglementaire', roles: MANAGERS, groupe: 'registres' },
      { to: '/profil-stagiaires', right: 'qualite.registres.gerer', icon: Target, label: 'Profil des stagiaires', roles: MANAGERS, groupe: 'registres' },
      // Conformité RGPD (chantier F, 0340) : registre par société, demandes, violations, sous-traitants, preuves
      { to: '/conformite', right: ['conformite.rgpd.gerer', 'conformite.demandes.gerer', 'conformite.violations.gerer'], icon: Fingerprint, label: 'RGPD',
        roles: ['superadmin', 'admin', 'direction', 'membre'], module: 'rgpd' },
      { to: '/audit-logs', right: 'conformite.journal.voir', icon: ScrollText, label: 'Journal d\'audit', roles: ADMINS },
    ],
  },
  {
    // Maintenance : interventions, stock (0240) et véhicules (0320) dans une seule section ; chaque entrée suit son
    // module (une entrée dont le module est coupé disparaît, la section avec sa dernière entrée).
    id: 'entreprise',
    module: null,
    label: 'Maintenance',
    icon: Wrench,
    items: [
      { simple: true, to: '/interventions', right: ['interventions.visites.voir', 'interventions.missions.voir'], icon: MapPin, label: 'Interventions', roles: STAFF, module: 'interventions' },
      // Stock : le technicien n'a que « Mon stock » (sans prix), les gestionnaires voient tout
      { simple: true, to: '/stock', right: ['stock.voir', 'stock.sien.mouvementer'], icon: Package, label: 'Stock', roles: [...STAFF, 'membre'], module: 'stock' },
      // Véhicules : le conducteur n'a que « Mon véhicule », la direction et les gestionnaires voient le parc
      { simple: true, to: '/vehicules', right: ['vehicules.parc.voir', 'vehicules.siens.utiliser', 'vehicules.couts.voir'], icon: Car, label: 'Véhicules', roles: [...ALL_ROLES, 'membre'], module: 'vehicules' },
    ],
  },
  {
    // Entreprise : le personnel (module RH, 0290) et, pour la direction, les emprunts et crédits (module Manager, 0220)
    id: 'personnel',
    module: null,
    label: 'Entreprise',
    icon: Briefcase,
    items: [
      { simple: true, to: '/collaborateurs', right: 'rh.personnel.voir', icon: Briefcase, label: 'Personnel', roles: [...MANAGERS, 'membre'], module: 'rh' },
      { simple: true, to: '/emprunts', right: 'manager.emprunts.gerer', icon: Landmark, label: 'Emprunts et crédits', roles: [...FINANCE, 'membre'], module: 'manager' },
    ],
  },
]

// Groupes : plusieurs pages proches sous une seule entrée du menu ; la page ouverte montre les autres en onglets.
// L'entrée du menu porte le nom du groupe et mène à la première page du groupe que le compte peut ouvrir.
export const GROUPES = {
  catalogue: { label: 'Catalogue', icon: GraduationCap },
  affaires: { label: 'Affaires', icon: KanbanSquare },
  formateurs: { label: 'Formateurs', icon: UserCheck },
  documents: { label: 'Documents', icon: FileText },
  qualiopi: { label: 'Qualiopi', icon: Award },
  registres: { label: 'Registres', icon: FolderCheck },
}

// Entrées du menu d'une section : une entrée par page, ou une seule par groupe (à la place de sa première page visible)
export function entreesMenu(items) {
  const vus = new Set()
  const out = []
  for (const i of items || []) {
    if (!i.groupe) { out.push(i); continue }
    if (vus.has(i.groupe)) continue
    vus.add(i.groupe)
    const membres = items.filter((x) => x.groupe === i.groupe)
    if (membres.length === 1) { out.push(i); continue }
    const g = GROUPES[i.groupe] || { label: i.label, icon: i.icon }
    out.push({ ...i, label: g.label, icon: g.icon, routes: membres.map((m) => m.to) })
  }
  return out
}

// Onglets à montrer pour une adresse : les pages visibles du même groupe (au moins deux), sinon rien
export function ongletsPour(pathname, sections) {
  const items = (sections || []).flatMap((s) => s.items)
  const entree = entreePourChemin(pathname)
  if (!entree?.groupe) return []
  const membres = items.filter((i) => i.groupe === entree.groupe)
  return membres.length > 1 ? membres : []
}

export const SETTINGS_ITEMS = [
  // Quoi de neuf (module « nouveautes », chantier A) : tout compte interne qui voit les réglages de l'organisme
  { to: '/nouveautes', icon: Sparkles, label: 'Quoi de neuf', short: 'Nouveautés', module: 'nouveautes', right: 'organisation.reglages.voir' },
  // Paramètres : super administrateur ; administrateur seulement avec la licence totale (droit parametres.ouvrir,
  // filtré par la base) ; direction jamais (décision du 17/10). Droits inconnus : super administrateur seulement.
  { to: '/parametres', icon: Settings, label: 'Paramètres', short: 'Paramètres', roles: ADMINS, right: 'parametres.ouvrir', fallbackRoles: ['superadmin'] },
  // Règles de gestion : circuits de validation et comptable externe, hors Paramètres (la direction y accède)
  { to: '/regles-gestion', icon: Workflow, label: 'Règles de gestion', short: 'Règles', roles: ['superadmin', 'admin', 'direction', 'membre'],
    right: ['validations.circuits.configurer', 'facturation.comptable_externe.regler'], fallbackRoles: [] },
  // Suivi des retours (module « retours », chantier A) : super administrateur et administrateur ; droits inconnus :
  // super administrateur seulement
  { to: '/retours', icon: StickyNote, label: 'Retours des utilisateurs', short: 'Retours', module: 'retours', roles: ['superadmin', 'admin', 'membre'],
    right: 'organisation.retours.suivre', fallbackRoles: ['superadmin'] },
  { to: '/console', right: 'plateforme.administrer', icon: Sliders, label: 'Console', short: 'Console', roles: ['superadmin'] },
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

// Filtre les sections et entrées selon les modules activés, le rôle et les droits de l'utilisateur.
// Mode simple : seulement les entrées du quotidien (`simple: true`) ; les autres pages restent accessibles par les
// onglets de leur groupe et par leur adresse.
export function visibleSections(enabledModules, role, can, { simple = false } = {}) {
  const enabled = new Set(enabledModules || [])
  return NAV_SECTIONS
    .filter((s) => !s.module || enabled.has(s.module))
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => (!i.module || enabled.has(i.module)) && itemAutorise(i, role, can) && (!simple || i.simple)),
    }))
    .filter((s) => s.items.length > 0)
}

// Bouton « + Nouveau » : créations courantes, ouvertes sur leur page (état { openNew: true })
export const CREATIONS = [
  { to: '/sessions', label: 'Session', module: 'formation', right: 'formation.sessions.creer' },
  { to: '/clients', label: 'Client', module: 'commercial', right: 'clients.fiches.modifier' },
  { to: '/affaires', label: 'Affaire', module: 'affaires', right: 'commercial.devis.modifier' },
  { to: '/devis', label: 'Devis', module: 'commercial', right: 'commercial.devis.modifier' },
  { to: '/factures', label: 'Facture', module: 'commercial', right: 'facturation.factures.modifier' },
  { to: '/stagiaires', label: 'Stagiaire', module: 'formation', right: 'formation.stagiaires.creer' },
  { to: '/interventions/planning', label: 'Intervention', module: 'interventions', right: 'interventions.visites.gerer', sansOuverture: true },
]

export function creationsVisibles(enabledModules, role, can) {
  const enabled = new Set(enabledModules || [])
  return CREATIONS.filter((c) => enabled.has(c.module) && can?.(c.right) !== false && itemAutorise(entreePourChemin(c.to), role, can))
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
  // Mon espace (congés, heures, documents) : toute personne du personnel, technicien compris ; la base ne montre que
  // ses propres données (audit du 19/10 au soir)
  { prefix: '/collaborateurs/mon-espace', to: null },
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

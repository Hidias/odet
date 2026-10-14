// src/lib/mailingExclusions.js
// ─────────────────────────────────────────────────────────────────────────────
// Exclusions du mailing - l'application
//
// Sources :
//   • mailing_blocklist    : désabonnés (bloqués), concurrents (invisibles), manuel
//   • mailing_email_status : adresses invalides / à vérifier / indicateurs (rgpd…)
//   • règles métier        : organismes de formation (NAF, type client, nom)
//
// Aucune écriture ici : lecture et calcul uniquement.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'

// NAF des organismes de formation / enseignement (format stocké : « 85.59A »)
export const OF_NAF = ['85.51Z', '85.52Z', '85.53Z', '85.59A', '85.59B', '85.60Z', '85.42Z', '85.41Z']
const OF_NAF_NORM = new Set(OF_NAF.map(n => n.replace(/\./g, '')))

// Mots-clés dans le nom indiquant un OF ou un OPCO
export const OF_NAME_KEYWORDS = ['formation', 'opco', 'uniformation', 'akto', 'fafsea', 'constructys', 'atlas', 'ocapiat', 'afdas']

// Types de clients « partenaires » (réintégrables pour une campagne partenaires)
export const PARTNER_CLIENT_TYPES = ['organisme_formation', 'opco']

export const normEmail = (e) => String(e || '').trim().toLowerCase()
export const normNaf = (n) => String(n || '').replace(/\./g, '').trim().toUpperCase()
export const emailDomain = (e) => normEmail(e).split('@')[1] || ''

export const isOfNaf = (naf) => OF_NAF_NORM.has(normNaf(naf))
export const hasOfName = (name) => {
  const n = String(name || '').toLowerCase()
  return OF_NAME_KEYWORDS.some(kw => n.includes(kw))
}

// Libellés des motifs d'exclusion
export const EXCLUSION_LABELS = {
  desabonne:   'Désabonné',
  bloque:      'Liste de blocage',
  invalide:    'Adresse invalide',
  rgpd:        'Adresse RGPD (dpo@…)',
  of:          'Organisme de formation',
  partenaire:  'OF / OPCO partenaire',
  ne_pas_mailer: 'Client « ne pas mailer »',
}

// Motifs non réintégrables (bloquants)
export const HARD_EXCLUSIONS = ['desabonne', 'bloque', 'invalide', 'ne_pas_mailer', 'of']

// Libellés des indicateurs d'adresse
export const FLAG_LABELS = {
  syntaxe:             'Syntaxe invalide',
  fichier:             'Nom de fichier (récupéré sur un site)',
  modele:              'Adresse modèle / factice',
  extension_inconnue:  'Extension inconnue',
  caractere_invisible: 'Caractère invisible',
  rgpd:                'Adresse RGPD / technique',
  service:             'Service peu pertinent',
  multi_siren:         'Partagée entre plusieurs SIREN',
  rejet_serveur:       'Rejetée par le serveur (550)',
}

/**
 * Charge les exclusions en une fois.
 * @returns {Promise<{blockedEmails: Map, blockedDomains: Map, blockedNames: Array, statusByEmail: Map}>}
 */
export async function loadMailingExclusions() {
  const [blR, stR] = await Promise.all([
    // fetchAll OBLIGATOIRE : une liste tronquée à 1 000 lignes laisserait partir
    // des mails vers des adresses désabonnées, bloquées ou RGPD.
    fetchAll(() => supabase.from('mailing_blocklist').select('kind, value, category')),
    // mailing_email_status n'a pas de colonne id : clé primaire = email
    fetchAll(() => supabase.from('mailing_email_status').select('email, status, flags').or('status.neq.ok,flags.cs.{rgpd}'), { orderBy: 'email' }),
  ])
  if (blR.error) throw blR.error
  if (stR.error) throw stR.error

  const blockedEmails = new Map()   // email → category
  const blockedDomains = new Map()  // domaine → category
  const blockedNames = []           // [{ value, category }]
  for (const b of (blR.data || [])) {
    const v = String(b.value || '').trim().toLowerCase().replace(/^@/, '')
    if (!v) continue
    if (b.kind === 'email') blockedEmails.set(v, b.category)
    else if (b.kind === 'domaine') blockedDomains.set(v, b.category)
    else if (b.kind === 'nom') blockedNames.push({ value: v, category: b.category })
  }

  const statusByEmail = new Map()   // email → { status, flags }
  for (const s of (stR.data || [])) statusByEmail.set(s.email, { status: s.status, flags: s.flags || [] })

  return { blockedEmails, blockedDomains, blockedNames, statusByEmail }
}

/**
 * Motif d'exclusion d'un destinataire, ou null s'il est retenu.
 * Renvoie 'hidden' pour un concurrent : il ne doit apparaître nulle part.
 *
 * @param {object} row  { email, name, naf, source ('prospection_massive'|'clients'), client_type, do_not_mail }
 * @param {object} excl résultat de loadMailingExclusions()
 * @param {object} opts { includeRgpd, includePartners }
 */
export function getExclusionReason(row, excl, opts = {}) {
  const email = normEmail(row.email)
  const dom = emailDomain(email)
  const name = String(row.name || '').toLowerCase()

  // Concurrents : invisibles
  if (excl.blockedEmails.get(email) === 'concurrent') return 'hidden'
  if (excl.blockedDomains.get(dom) === 'concurrent') return 'hidden'
  if (excl.blockedNames.some(b => b.category === 'concurrent' && name.includes(b.value))) return 'hidden'

  // Désabonnés et blocages manuels
  const cat = excl.blockedEmails.get(email) || excl.blockedDomains.get(dom)
    || excl.blockedNames.find(b => name.includes(b.value))?.category
  if (cat === 'desabonne') return 'desabonne'
  if (cat) return 'bloque'

  // Client « ne pas mailer » ; un particulier n'est jamais destinataire d'une campagne commerciale
  if (row.source === 'clients' && (row.do_not_mail || row.client_type === 'particulier')) return 'ne_pas_mailer'

  // Adresse invalide
  const st = excl.statusByEmail.get(email)
  if (st?.status === 'invalide') return 'invalide'

  // Organismes de formation / OPCO
  if (row.source === 'clients' && PARTNER_CLIENT_TYPES.includes(row.client_type)) {
    return opts.includePartners ? null : 'partenaire'
  }
  if (isOfNaf(row.naf) || hasOfName(row.name)) {
    // Un client OF est un partenaire ; un prospect OF est toujours exclu
    if (row.source === 'clients') return opts.includePartners ? null : 'partenaire'
    return 'of'
  }

  // Adresses RGPD : exclues par défaut
  if (st?.flags?.includes('rgpd') && !opts.includeRgpd) return 'rgpd'

  return null
}

/**
 * Filtre une liste et compte les exclusions par motif (hors concurrents).
 * @returns {{ kept: Array, counts: Object }}
 */
export function applyExclusions(rows, excl, opts = {}) {
  const kept = []
  const counts = {}
  for (const r of rows) {
    const reason = getExclusionReason(r, excl, opts)
    if (!reason) { kept.push(r); continue }
    if (reason === 'hidden') continue
    counts[reason] = (counts[reason] || 0) + 1
  }
  return { kept, counts }
}

/**
 * Regroupe les lignes par adresse e-mail (1 ligne = 1 adresse) puis applique
 * les exclusions AU NIVEAU DE L'ADRESSE : si une seule des lignes de l'adresse
 * est exclue (client « ne pas mailer », OF, partenaire…), l'adresse entière l'est.
 *
 * Ligne retenue comme représentante : client > siège > première trouvée.
 * Nom affiché : groupe, sinon nom de l'entreprise.
 *
 * @returns {{ kept: Array, counts: Object, merged: number }}
 *   merged = nombre de lignes fusionnées (doublons d'adresse)
 */
export function dedupeAndExclude(rows, excl, opts = {}) {
  const PRIORITY = ['hidden', 'desabonne', 'bloque', 'invalide', 'ne_pas_mailer', 'of', 'partenaire', 'rgpd']
  const groups = new Map()
  for (const r of rows) {
    const key = normEmail(r.email)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }

  const kept = []
  const counts = {}
  let merged = 0

  for (const [key, list] of groups) {
    merged += list.length - 1

    // Exclusion : le motif le plus fort parmi toutes les lignes de l'adresse
    let reason = null
    for (const r of list) {
      const rr = getExclusionReason(r, excl, opts)
      if (rr && (reason === null || PRIORITY.indexOf(rr) < PRIORITY.indexOf(reason))) reason = rr
    }
    if (reason === 'hidden') continue
    if (reason) { counts[reason] = (counts[reason] || 0) + 1; continue }

    // Représentant : client > siège > premier
    const rep = list.find(r => r.source === 'clients') || list.find(r => r.is_siege) || list[0]
    const names = [...new Set(list.map(r => r.name).filter(Boolean))]
    const cities = [...new Set(list.map(r => r.city).filter(Boolean))]
    const groupe = list.map(r => r.groupe).find(Boolean) || null
    kept.push({
      ...rep,
      email: key,
      display_name: groupe || rep.name || names[0] || key,
      nb_lignes: list.length,
      noms: names,
      villes: cities,
      sources: [...new Set(list.map(r => r.source))],
    })
  }

  kept.sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), 'fr'))
  return { kept, counts, merged }
}

// Motifs d'exclusion qu'on peut lever à la main, destinataire par destinataire
export const SOFT_EXCLUSIONS = ['partenaire', 'rgpd']

/**
 * Motif d'exclusion d'une ligne de la vue mailing_audience_v (1 ligne = 1 adresse).
 * 'hidden' = concurrent → ne jamais afficher.
 * @param {object} a    ligne de mailing_audience_v
 * @param {object} excl résultat de loadMailingExclusions() (pour les blocages par nom)
 * @param {object} opts { includeRgpd, includePartners }
 */
export function getAudienceExclusion(a, excl, opts = {}) {
  const names = (a.noms || [a.display_name]).filter(Boolean).map(n => String(n).toLowerCase())
  const nameBlocks = excl?.blockedNames || []

  if (a.blocage === 'concurrent') return 'hidden'
  if (nameBlocks.some(b => b.category === 'concurrent' && names.some(n => n.includes(b.value)))) return 'hidden'

  if (a.blocage === 'desabonne') return 'desabonne'
  if (a.blocage) return 'bloque'
  const nb = nameBlocks.find(b => names.some(n => n.includes(b.value)))
  if (nb) return nb.category === 'desabonne' ? 'desabonne' : 'bloque'

  if (a.do_not_mail || (a.types_client || []).includes('particulier')) return 'ne_pas_mailer'
  if (a.email_status === 'invalide') return 'invalide'

  const types = a.types_client || []
  const isClientSide = (a.source_types || []).some(t => t === 'client' || t === 'crm' || t === 'contact')
  if (types.some(t => PARTNER_CLIENT_TYPES.includes(t))) return opts.includePartners ? null : 'partenaire'

  const ofNaf = (a.nafs || []).some(n => OF_NAF_NORM.has(normNaf(n)))
  const ofName = names.some(n => OF_NAME_KEYWORDS.some(kw => n.includes(kw)))
  if (ofNaf || ofName) {
    if (isClientSide) return opts.includePartners ? null : 'partenaire'
    return 'of'
  }

  if ((a.email_flags || []).includes('rgpd') && !opts.includeRgpd) return 'rgpd'
  return null
}

/** « Désabonné : 12 · Adresse invalide : 3… » */
export function formatExclusionCounts(counts) {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${EXCLUSION_LABELS[k] || k} : ${n}`)
    .join(' · ')
}

/** Statut d'une adresse (pour afficher un badge « à vérifier ») */
export function getEmailStatus(email, excl) {
  return excl?.statusByEmail?.get(normEmail(email)) || null
}

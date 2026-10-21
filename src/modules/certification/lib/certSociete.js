// Certifications de la société (chantier F, 0350) : référentiels communs ou propres à la société, statut de chaque
// certification, import du texte d'un référentiel payant depuis l'exemplaire de la société.
// La face interne (conseil de direction) a son propre fichier : certInterne.js.

import { supabase } from '../../../core/supabase'

export const NATURES = {
  qualiopi: 'Qualiopi',
  nda: 'Déclaration d\'activité',
  apsad: 'APSAD et NF Service',
  interne: 'Référentiel interne',
  autre: 'Autre certification',
}

export const SOURCES_TEXTE = {
  officiel: 'Texte officiel public',
  societe: 'Texte fourni par la société',
  a_saisir: 'Texte payant : à importer depuis votre exemplaire',
}

export const STATUTS = [
  { v: 'visee', label: 'Visée', badge: 'badge-neutral' },
  { v: 'dossier', label: 'Dossier en préparation', badge: 'badge-warning' },
  { v: 'audit_planifie', label: 'Audit planifié', badge: 'badge-warning' },
  { v: 'obtenue', label: 'Obtenue', badge: 'badge-success' },
  { v: 'suspendue', label: 'Suspendue', badge: 'badge-danger' },
  { v: 'retiree', label: 'Retirée', badge: 'badge-danger' },
  { v: 'refusee', label: 'Refusée', badge: 'badge-danger' },
]

export const statut = (v) => STATUTS.find((s) => s.v === v) || STATUTS[0]

// Champs modifiables d'une certification (ordre d'affichage du formulaire)
export const CHAMPS_CERTIF = [
  { k: 'certificateur', label: 'Organisme certificateur', type: 'text' },
  { k: 'numero', label: 'Numéro du certificat', type: 'text' },
  { k: 'obtenue_le', label: 'Obtenue le', type: 'date' },
  { k: 'valable_jusqu_au', label: 'Valable jusqu\'au', type: 'date' },
  { k: 'audit_initial_prevu', label: 'Audit initial prévu le', type: 'date' },
  { k: 'audit_initial_fait', label: 'Audit initial fait le', type: 'date' },
  { k: 'audit_suivi_prevu', label: 'Audit de surveillance prévu le', type: 'date' },
  { k: 'audit_suivi_fait', label: 'Audit de surveillance fait le', type: 'date' },
  { k: 'renouvellement_prevu', label: 'Renouvellement prévu le', type: 'date' },
  { k: 'perimetre', label: 'Périmètre (activités, sites)', type: 'textarea' },
  { k: 'notes', label: 'Notes', type: 'textarea' },
]

/** Vrai si la certification est obtenue et en cours de validité (même règle que app.cert_valid en base) */
export function certValide(c, aujourdhui = new Date().toISOString().slice(0, 10)) {
  return !!c && c.statut === 'obtenue' && (!c.valable_jusqu_au || c.valable_jusqu_au >= aujourdhui)
}

/** Prochaine échéance utile d'une certification (audit prévu non fait, renouvellement, fin de validité) */
export function prochaineEcheance(c) {
  if (!c) return null
  const dates = [
    !c.audit_initial_fait && c.audit_initial_prevu ? { d: c.audit_initial_prevu, label: 'Audit initial' } : null,
    c.audit_suivi_prevu && (!c.audit_suivi_fait || c.audit_suivi_fait < c.audit_suivi_prevu) ? { d: c.audit_suivi_prevu, label: 'Audit de surveillance' } : null,
    c.renouvellement_prevu ? { d: c.renouvellement_prevu, label: 'Renouvellement' } : null,
    c.valable_jusqu_au ? { d: c.valable_jusqu_au, label: 'Fin de validité' } : null,
  ].filter(Boolean).sort((a, b) => a.d.localeCompare(b.d))
  return dates[0] || null
}

/**
 * Lit le texte collé d'un référentiel (une exigence par ligne) et prépare l'import.
 *  - « # 5 Organisation » ouvre un chapitre (code facultatif puis titre) ;
 *  - « 5.2 ; Titre ; Texte » : code, titre court, texte ;
 *  - « 5.2 ; Texte » ou « 5.2<tabulation>Texte » : code et texte ;
 *  - une ligne sans séparateur : le texte seul.
 * Les lignes vides sont ignorées ; avant le premier chapitre, les exigences vont dans « Exigences ».
 */
export function lireExigences(texte) {
  const out = []
  let chapitre = 0
  let titreChapitre = null
  let codeChapitre = null
  for (const brute of String(texte || '').split(/\r?\n/)) {
    const ligne = brute.trim()
    if (!ligne) continue
    if (ligne.startsWith('#')) {
      const reste = ligne.replace(/^#+\s*/, '')
      const m = reste.match(/^([\dA-Za-z][\w.§-]{0,14})\s+(.+)$/)
      chapitre += 1
      if (m && /\d/.test(m[1])) { codeChapitre = m[1]; titreChapitre = m[2].trim() } else { codeChapitre = null; titreChapitre = reste || null }
      continue
    }
    if (chapitre === 0) { chapitre = 1; titreChapitre = 'Exigences'; codeChapitre = null }
    const parts = ligne.split(/\s*;\s*|\t+/).map((p) => p.trim())
    let code = null
    let titre = null
    let corps = ligne
    if (parts.length >= 3 && parts[0].length <= 20) {
      code = parts[0] || null
      titre = parts[1] || null
      corps = parts.slice(2).join(' ; ')
    } else if (parts.length === 2 && parts[0].length <= 20) {
      code = parts[0] || null
      corps = parts[1]
    }
    if (!corps) corps = titre || code || ligne
    out.push({ chapitre, chapitre_titre: titreChapitre, chapitre_code: codeChapitre, code, titre, texte: corps })
  }
  return out
}

export async function chargerCertifications() {
  const [r, c] = await Promise.all([
    supabase.from('cert_referentials').select('code, label, legal_ref, source_url, notes, sort_order, kind, issuer, text_source, company_id, equipment_families').order('sort_order'),
    supabase.from('cert_company_certifications').select('*'),
  ])
  if (r.error) throw r.error
  if (c.error) throw c.error
  const refs = r.data || []
  // Nombre d'exigences par référentiel (pour les textes importés)
  const { data: ind } = await supabase.from('cert_indicators').select('referential_code').in('referential_code', refs.map((x) => x.code))
  const nb = {}
  for (const i of ind || []) nb[i.referential_code] = (nb[i.referential_code] || 0) + 1
  return { refs: refs.map((x) => ({ ...x, exigences: nb[x.code] || 0 })), certifs: c.data || [] }
}

export async function enregistrerCertification(referentialCode, existante, patch) {
  const propre = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === '' ? null : v]))
  if (existante?.id) {
    const { error } = await supabase.from('cert_company_certifications').update(propre).eq('id', existante.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('cert_company_certifications').insert({ referential_code: referentialCode, ...propre })
    if (error) throw error
  }
}

export async function importerTexte(source, exigences) {
  const { data, error } = await supabase.rpc('cert_importer_texte', { p_source: source, p_exigences: exigences })
  if (error) throw error
  return data
}

// Champs remplis au moment de l'affichage dans les textes enregistrés en base
// (documents Qualiopi, désignations, organigramme, arguments d'appel...).
//
//   {{org.nom}}, {{org.nom_majuscules}}, {{org.raison_sociale}}, {{org.adresse}}, {{org.code_postal}},
//   {{org.ville}}, {{org.telephone}}, {{org.email}}, {{org.site}}, {{org.siret}}, {{org.nda}},
//   {{org.region}}, {{org.region_nda}}, {{org.dirigeant}}, {{org.dirigeant_qualite}},
//   {{org.lieu_signature}}, {{org.tribunal}}, {{app.nom}}, {{catalogue}},
//   {{role.<code>}}, {{role.<code>.email}}, {{role.<code>.telephone}}, {{role.<code>.suppleant}}
//
// Les valeurs viennent de organization_settings, quality_roles (+ profiles) et courses.
// Aucune valeur d'un organisme particulier n'est écrite ici.

import { supabase } from '../supabase'

export const TEMPLATE_FIELDS = [
  ['{{org.nom}}', "Nom affiché de l'organisme"],
  ['{{org.raison_sociale}}', 'Raison sociale'],
  ['{{org.adresse}}', 'Adresse'],
  ['{{org.code_postal}}', 'Code postal'],
  ['{{org.ville}}', 'Ville'],
  ['{{org.telephone}}', 'Téléphone'],
  ['{{org.email}}', 'Email'],
  ['{{org.siret}}', 'SIRET'],
  ['{{org.nda}}', "Numéro de déclaration d'activité"],
  ['{{org.region}}', "Région d'intervention"],
  ['{{org.dirigeant}}', 'Dirigeant'],
  ['{{org.dirigeant_qualite}}', 'Qualité du dirigeant'],
  ['{{org.lieu_signature}}', 'Lieu de signature'],
  ['{{org.tribunal}}', 'Tribunal compétent'],
  ['{{catalogue}}', 'Liste des formations du catalogue'],
  ['{{role.responsable_qualite}}', 'Responsable qualité (Paramètres > Qualité)'],
  ['{{role.referent_handicap}}', 'Référent handicap'],
  ['{{role.referent_reclamations}}', 'Référent réclamations'],
  ['{{role.referent_signalements}}', 'Référent violences, harcèlement et discriminations'],
  ['{{role.referent_rgpd}}', 'Référent données personnelles'],
  ['{{role.referent_deontologie}}', 'Référent déontologie'],
  ['{{role.referent_amelioration}}', 'Référent amélioration continue'],
  ['{{role.referent_veille}}', 'Référent veille'],
  ['{{role.validation_programmes}}', 'Référent pédagogique'],
  ['{{role.<code>.suppleant}}', "Suppléant d'un rôle"],
]

let cache = null
let pending = null

const personName = (p) => {
  if (!p) return ''
  const n = [p.first_name, p.last_name ? String(p.last_name).toUpperCase() : ''].filter(Boolean).join(' ').trim()
  return n || p.display_name || p.email || ''
}

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function formatNda(nda) {
  const d = String(nda || '').replace(/\s+/g, '')
  if (!d) return "en cours d'attribution"
  return /^\d{11}$/.test(d) ? `${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)} ${d.slice(9)}` : d
}

/** Construit le contexte à partir des lignes lues en base (fonction pure, testable) */
export function buildTemplateContext({ org = {}, roles = [], courses = [], deputies = [] } = {}) {
  const nom = org.name || org.legal_name || ''
  const role = {}
  const byId = new Map((deputies || []).map((d) => [d.id, d]))
  for (const r of roles) {
    const p = r.profile || null
    role[r.code] = {
      nom: personName(p), email: p?.sender_email || p?.email || '', telephone: p?.phone || '',
      label: r.label || '', suppleant: personName(byId.get(r.deputy_profile_id)),
    }
  }
  return {
    org: {
      nom,
      nom_majuscules: nom.toUpperCase(),
      raison_sociale: [org.legal_name || nom, org.forme_juridique && !(org.legal_name || nom).toLowerCase().includes(String(org.forme_juridique).toLowerCase()) ? org.forme_juridique : ''].filter(Boolean).join(' '),
      adresse: org.address || '',
      code_postal: org.postal_code || '',
      ville: org.city || '',
      telephone: org.phone || '',
      email: org.email || '',
      site: String(org.website || '').replace(/^https?:\/\//, ''),
      siret: org.siret || '',
      nda: formatNda(org.nda),
      region: org.region || org.nda_region || '',
      region_nda: org.nda_region || org.region || '',
      dirigeant: org.dirigeant_name || '',
      dirigeant_qualite: org.dirigeant_title || 'Dirigeant',
      lieu_signature: org.lieu_signature || org.city || '',
      tribunal: org.tribunal_competent || '',
    },
    app: { nom: org.app_name || nom },
    role,
    catalogue: (courses || []).map((c) => c.title).filter(Boolean),
  }
}

/** Remplace les champs {{...}} ; html: true échappe les valeurs et rend {{catalogue}} en blocs HTML */
export function fillTemplate(text, ctx, { html = false } = {}) {
  if (text == null) return text
  const s = String(text)
  if (!s.includes('{{') || !ctx) return s
  const esc = (v) => (html ? escapeHtml(v) : String(v))
  return s.replace(/\{\{\s*([a-z_]+)(?:\.([a-z_]+))?(?:\.([a-z_]+))?\s*\}\}/g, (all, a, b, c) => {
    if (a === 'catalogue') {
      const list = ctx.catalogue || []
      if (html) return list.map((t) => `<div class="formation-item"><h4>${escapeHtml(t)}</h4></div>`).join('')
      return list.join(', ')
    }
    if (a === 'org' && b) return ctx.org?.[b] != null ? esc(ctx.org[b]) : all
    if (a === 'app' && b) return ctx.app?.[b] != null ? esc(ctx.app[b]) : all
    if (a === 'role' && b) {
      const r = ctx.role?.[b]
      if (!r) return ''
      return esc(c ? (r[c] || '') : r.nom)
    }
    return all
  })
}

/** Applique fillTemplate à toutes les chaînes d'un objet ou tableau (contenu JSON) */
export function fillDeep(value, ctx) {
  if (typeof value === 'string') return fillTemplate(value, ctx)
  if (Array.isArray(value)) return value.map((v) => fillDeep(v, ctx))
  if (value && typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value)) out[k] = fillDeep(value[k], ctx)
    return out
  }
  return value
}

/** Charge (une fois) paramètres, rôles qualité et catalogue ; force: true pour relire */
export async function loadTemplateContext(force = false) {
  if (cache && !force) return cache
  if (pending && !force) return pending
  pending = (async () => {
    const [orgR, rolesR, coursesR] = await Promise.all([
      supabase.from('organization_settings').select('*').limit(1).maybeSingle(),
      supabase.from('quality_roles').select('code, label, profile_id, deputy_profile_id, profile:profiles(first_name, last_name, display_name, email, sender_email, phone)').order('sort_order'),
      supabase.from('courses').select('title').order('title'),
    ])
    const deputyIds = [...new Set((rolesR.data || []).map((r) => r.deputy_profile_id).filter(Boolean))]
    const depR = deputyIds.length ? await supabase.from('profiles').select('id, first_name, last_name, display_name, email').in('id', deputyIds) : { data: [] }
    cache = buildTemplateContext({ org: orgR.data || {}, roles: rolesR.data || [], courses: coursesR.data || [], deputies: depR.data || [] })
    pending = null
    return cache
  })()
  return pending
}

/** Contexte déjà chargé (ou null) */
export const templateContext = () => cache

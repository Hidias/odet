// Documents qualité au nouveau modèle : sections numérotées faites de blocs (paragraphe, liste,
// liste à cocher, tableau, citation, encadré), versions validées, revue annuelle.
//
// Contenu enregistré dans quality_documents.content :
//   { model: 'rich', sections: [{ id, title, cond?, blocks: [...] }], options: { particuliers },
//     diffusion: { equipe, formateurs, portail }, status: 'brouillon' | 'valide',
//     version: n (dernière version validée), validated_at, next_review, motif (brouillon) }
// Blocs : { t: 'p', text } | { t: 'h', text } | { t: 'ul' | 'ol' | 'check', items, start? }
//         | { t: 'table', head, rows } | { t: 'quote', paras } | { t: 'note', text }
// Mise en forme dans le texte : **gras** uniquement.

import { fillTemplate } from '../../../core/org/templateContext'

export const FAMILIES = [
  { id: 'procedures', name: 'Procédures' },
  { id: 'stagiaires', name: 'Stagiaires et clients' },
  { id: 'gouvernance', name: 'Gouvernance' },
  { id: 'pilotage', name: 'Pilotage' },
  { id: 'checklists', name: 'Check-lists' },
  { id: 'soustraitance', name: 'Sous-traitance' },
  { id: 'fiches', name: 'Fiches modèles' },
]

let templatesPromise = null
/** Modèles par défaut (chargés à la demande : fichier volumineux) */
export function loadTemplates() {
  if (!templatesPromise) templatesPromise = import('./templates').then((m) => m.default)
  return templatesPromise
}

export const isRich = (content) => !!content && content.model === 'rich' && Array.isArray(content.sections)

const clone = (x) => JSON.parse(JSON.stringify(x))

/** Nouveau document de travail à partir du modèle */
export function fromTemplate(tpl) {
  return {
    model: 'rich',
    sections: clone(tpl.sections),
    options: { particuliers: false },
    diffusion: { equipe: true, formateurs: true, portail: ['stagiaires'].includes(tpl.family) },
    status: 'brouillon',
    version: 0,
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Section modifiée par rapport au modèle (ou ajoutée par l'organisme) */
export function sectionChanged(section, tpl) {
  const ref = (tpl?.sections || []).find((s) => s.id === section.id)
  if (!ref) return true
  return !same({ t: ref.title, b: ref.blocks }, { t: section.title, b: section.blocks })
}

/** Remet une section dans l'état du modèle */
export function resetSection(content, sectionId, tpl) {
  const ref = (tpl?.sections || []).find((s) => s.id === sectionId)
  if (!ref) return content
  return { ...content, sections: content.sections.map((s) => (s.id === sectionId ? clone(ref) : s)) }
}

export function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
}
export function plusOneYear(iso) {
  const d = new Date(`${iso}T12:00:00`)
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}
export const frDate = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')

/** Statut affiché : modele (rien enregistré), brouillon, valide, a_revoir */
export function docStatus(content, today = todayIso()) {
  if (!isRich(content)) return { code: 'modele', label: 'Modèle', tone: 'gray' }
  if (content.status === 'valide') {
    if (content.next_review && content.next_review <= today) return { code: 'a_revoir', label: 'À revoir', tone: 'amber' }
    return { code: 'valide', label: `Validé v${content.version}`, tone: 'green' }
  }
  return { code: 'brouillon', label: `Brouillon v${(content.version || 0) + 1}`, tone: 'blue' }
}

/** Textes de tous les blocs (recherche, contrôles) */
export function blockTexts(b) {
  if (b.t === 'p' || b.t === 'h' || b.t === 'note') return [b.text || '']
  if (b.t === 'ul' || b.t === 'ol' || b.t === 'check') return b.items || []
  if (b.t === 'table') return [...(b.head || []), ...(b.rows || []).flat()]
  if (b.t === 'quote') return b.paras || []
  return []
}

/** Sections publiées selon les options (articles « particuliers » des CGV) */
export function visibleSections(content) {
  return (content.sections || []).filter((s) => !s.cond || (s.cond === 'particuliers' && content.options?.particuliers))
}

/** Passages à compléter entre crochets ([date], [nom du médiateur]...) */
export function bracketGaps(content) {
  const out = []
  visibleSections(content).forEach((s) => s.blocks.forEach((b) => blockTexts(b).forEach((txt) => {
    const m = String(txt).match(/\[[^\]]{2,60}\]/g)
    if (m) m.forEach((g) => out.push({ section: s.title || 'Introduction', gap: g }))
  })))
  return out
}

/** Champs {{role.x}} vides (rôle non désigné) */
export function missingRoles(content, ctx) {
  const codes = new Set()
  visibleSections(content).forEach((s) => s.blocks.forEach((b) => blockTexts(b).forEach((txt) => {
    for (const m of String(txt).matchAll(/\{\{\s*role\.([a-z_]+)(?:\.[a-z_]+)?\s*\}\}/g)) {
      if (!ctx?.role?.[m[1]]?.nom) codes.add(m[1])
    }
  })))
  return [...codes]
}

/**
 * Découpe un texte en morceaux pour l'affichage : gras (**...**), champs remplis, champs vides,
 * passages entre crochets. ctx null : champs laissés tels quels.
 * @returns {{ text: string, bold?: boolean, field?: 'ok'|'missing', gap?: boolean }[]}
 */
export function richTokens(text, ctx) {
  const out = []
  const parts = String(text ?? '').split(/(\*\*[^*]+\*\*)/g)
  parts.forEach((part) => {
    if (!part) return
    const bold = /^\*\*[^*]+\*\*$/.test(part)
    const raw = bold ? part.slice(2, -2) : part
    raw.split(/(\{\{[^}]+\}\}|\[[^\]]{2,60}\])/g).forEach((seg) => {
      if (!seg) return
      if (/^\{\{[^}]+\}\}$/.test(seg)) {
        if (!ctx) { out.push({ text: seg, bold, field: 'ok' }); return }
        const val = fillTemplate(seg, ctx)
        if (val && val !== seg) out.push({ text: val, bold, field: 'ok' })
        else out.push({ text: seg.startsWith('{{role') ? 'non désigné' : seg, bold, field: 'missing' })
        return
      }
      if (/^\[[^\]]{2,60}\]$/.test(seg)) { out.push({ text: seg, bold, gap: true }); return }
      out.push({ text: seg, bold })
    })
  })
  return out
}

/** Texte brut rempli (PDF) : champs remplis, **gras** conservé */
export function fillText(text, ctx) {
  return ctx ? fillTemplate(String(text ?? ''), ctx) : String(text ?? '')
}

/** Nouveau bloc vide */
export function emptyBlock(t) {
  if (t === 'table') return { t, head: ['Colonne 1', 'Colonne 2'], rows: [['', '']] }
  if (t === 'ul' || t === 'ol' || t === 'check') return { t, items: [''] }
  if (t === 'quote') return { t, paras: [''] }
  return { t, text: '' }
}

export const BLOCK_LABEL = { p: 'Paragraphe', h: 'Intertitre', ul: 'Liste', ol: 'Liste numérotée', check: 'Liste à cocher', table: 'Tableau', quote: 'Citation', note: 'Encadré' }

/** Champs insérables dans le texte */
export function insertableFields(ctx) {
  const roles = Object.keys(ctx?.role || {})
  return [
    ['{{org.nom}}', "Nom de l'organisme"], ['{{org.adresse_site}}', 'Adresse du site (mise en avant)'], ['{{org.siege}}', 'Siège social (adresse légale)'],
    ['{{org.telephone}}', 'Téléphone'], ['{{org.email}}', 'Email'], ['{{org.nda}}', "Déclaration d'activité"],
    ['{{org.siret}}', 'SIRET'], ['{{org.dirigeant}}', 'Dirigeant'], ['{{org.dirigeant_qualite}}', 'Qualité du dirigeant'],
    ['{{org.lieu_signature}}', 'Lieu de signature'], ['{{org.tribunal}}', 'Tribunal compétent'],
    ...roles.flatMap((code) => [[`{{role.${code}}}`, `Rôle : ${ctx.role[code].label || code}`], [`{{role.${code}.email}}`, `Email : ${ctx.role[code].label || code}`]]),
  ]
}

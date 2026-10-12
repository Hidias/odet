// ════════════════════════════════════════════════════════════════
// pdfPreparationRdv.js - Fiche de préparation d'un RDV commercial
// Page 1 et suivantes : entreprise, interlocuteur, historique, besoin,
// objections entendues, arguments (avec références à relire),
// questions à poser, documents à apporter, avant de partir.
// Dernière page : grille de diagnostic express à remplir sur place.
// Document interne.
// ════════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { startDocument, drawDocTitle, numberPages, setF } from '../../../core/pdf/layout'

// Mise en page commune des documents (core/pdf/layout.js) ; identité lue dans organization_settings.
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•--˜™š›œžŸ'

// Police standard : on remplace ce qu'elle ne sait pas afficher
function clean(text) {
  return String(text ?? '')
    .replace(/[\u00a0\u202f\u2009]/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .split('')
    .filter(ch => ch.charCodeAt(0) <= 0xff || CP1252_EXTRA.includes(ch) || ch === '\n')
    .join('')
}

function fmtDate(value) {
  if (!value) return ''
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number)
  if (!y) return ''
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function fmtShort(value) {
  if (!value) return ''
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number)
  if (!y) return ''
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

function money(n) {
  return clean(Number(n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }))
}

export const ALWAYS_BRING = [
  'Cette fiche de préparation',
  'Certificat Qualiopi de l\'organisme',
  'Fiche d\'indicateurs de résultats à jour',
  'Présentation de l\'organisme (une page)',
  'Exemple de convention de formation et conditions générales de vente',
  'Informations accessibilité et référent handicap',
  'Grille de diagnostic express (dernière page)',
]

export const BEFORE_LEAVING = [
  'Relire les objections entendues au téléphone',
  'Vérifier l\'adresse et le nom de la personne qui accueille',
  'Préparer 2 dates de session à proposer',
  'Proposer une visite des postes pour adapter la formation',
  'Relire les références juridiques sur Légifrance',
]

const DIAGNOSTIC_ROWS = [
  'Effectif par site',
  'Métiers et postes exposés',
  'Sauveteurs secouristes formés (combien, date du dernier recyclage)',
  'Extincteurs, consignes et exercices d\'évacuation (date du dernier)',
  'Guide-file et serre-file désignés',
  'Chariots, gerbeurs et engins utilisés (qui conduit, autorisations)',
  'Intervenants à proximité d\'installations électriques',
  'Manutentions, postures, rotations de poste',
  'Document unique (date de la dernière mise à jour)',
  'Prestataires en place et dates de renouvellement',
  'OPCO et mode de financement',
  'Contraintes (horaires, saisonnalité, équipes)',
  'Qui décide, et quand',
]

export async function generatePrepRdvPDF({ rdv, clientName, client, ctx, prep, argumentsList = [], kitDocs = [], objectionLabels = [] }) {
  const ORG = await loadPdfOrg(true)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const themes = prep.themes || []
  const company = clean(clientName || client?.name || 'Entreprise')
  const f = startDocument(doc, ORG, { docLabel: 'Préparation de rendez-vous · document interne', code: 'PREPRDV', title: 'Préparation du rendez-vous', subtitle: company })
  const kv = (rows) => f.kv(rows.filter(r => r[1] !== null && r[1] !== undefined && r[1] !== '').map(r => [clean(r[0]), clean(r[1])]), { labelW: 42 }) || f.space(3)

  // ── Rendez-vous ──
  f.cards([
    { label: 'Rendez-vous', lines: [clean([fmtDate(rdv.rdv_date), rdv.rdv_time ? 'à ' + String(rdv.rdv_time).slice(0, 5).replace(':', 'h') : ''].filter(Boolean).join(' ')), clean(rdv.conducted_by ? 'Mené par ' + rdv.conducted_by : ''), clean(rdv.rdv_address || [client?.address, client?.postal_code, client?.city].filter(Boolean).join(' '))] },
    { label: 'Interlocuteur', lines: [clean(rdv.contact_name || ''), clean(rdv.contact_phone || ''), clean(rdv.contact_email || '')] },
  ])

  // ── Entreprise ──
  f.section('Entreprise')
  kv([
    ['Raison sociale', client?.name || clientName],
    ['SIRET', client?.siret],
    ['Activité', [client?.naf_code || client?.naf, client?.naf_label].filter(Boolean).join(' - ')],
    ['Effectif', prep.effectif || client?.effectif || client?.taille_entreprise],
    ['Sites', prep.sites],
    ['Métiers', prep.metiers],
    ['OPCO', prep.opco || client?.opco_name],
    ['Statut', client?.status ? `Client ${client.status}` : 'Prospect'],
  ])

  // ── Interlocuteur ──
  const contacts = ctx?.contacts?.length ? ctx.contacts.slice(0, 6).map(c => `${c.name}${c.role ? ' (' + c.role + ')' : ''}${c.phone ? ' ' + c.phone : ''}`).join('\n') : null
  if (prep.decideur || contacts) {
    f.section('Interlocuteurs')
    kv([['Qui décide', prep.decideur], ['Contacts connus', contacts]])
  }

  // ── Historique ──
  f.section('Historique')
  kv([
    ['Formations suivies', ctx?.sessions?.length ? ctx.sessions.slice(0, 6).map(s => `${s.courses?.title || 'Formation'} (${fmtShort(s.end_date)})`).join('\n') : 'Aucune'],
    ['Recyclage SST', ctx?.macDue ? `Échéance le ${fmtShort(ctx.macDue)}` : null],
    ['Devis en cours', ctx?.openQuotes?.length ? ctx.openQuotes.map(q => `${q.reference} du ${fmtShort(q.quote_date)} - ${money(q.total_ht)}`).join('\n') : null],
    ['Dernier appel', ctx?.lastCall ? `${fmtShort(ctx.lastCall.called_at)} (${ctx.lastCall.called_by || '-'}) : ${ctx.lastCall.notes || ctx.lastCall.call_result}` : null],
    ['Dernier échange', ctx?.lastInteraction ? `${fmtShort(ctx.lastInteraction.interaction_date)} : ${ctx.lastInteraction.title}` : null],
  ])

  // ── Besoin ──
  f.section('Besoin exprimé')
  kv([
    ['Thèmes visés', (prep.themeLabels || []).join(', ')],
    ['Prestataires en place', ctx?.providers?.length ? ctx.providers.map(p => `${p.theme} : ${p.provider_name || '?'}${p.last_training_year ? ' (' + p.last_training_year + ')' : ''}`).join('\n') : null],
    ['Notes de l\'appel', (rdv.notes || rdv.notes_crm) ? [rdv.notes, rdv.notes_crm].filter(Boolean).join('\n') : null],
  ])
  if (prep.besoin) f.callout('Besoin en quelques mots', clean(prep.besoin))

  // ── Objections ──
  const objections = [...new Set([...(prep.objections || []), ...objectionLabels])]
  if (objections.length) {
    f.section('Objections entendues au téléphone')
    f.bullets(objections.map(clean))
  }

  // ── Arguments ──
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const args = argumentsList.filter(a => a.is_active && (!a.valid_until || a.valid_until >= today))
    .filter(a => !a.themes?.length || a.themes.some(t => themes.includes(t)))
  if (args.length) {
    f.ensure(34)
    f.section('Arguments')
    args.forEach(a => {
      f.ensure(14)
      f.para(clean(a.title), { style: 'bold', after: 1 })
      if (a.say_text) f.para(clean(a.say_text), { x: f.M + 4, w: f.W - 4, after: 1 })
      if (a.detail) f.para(clean(a.detail), { x: f.M + 4, w: f.W - 4, size: 8.5, color: f.t.muted, after: 1 })
      if (a.legal_reference) f.para('Référence : ' + clean(a.legal_reference), { x: f.M + 4, w: f.W - 4, size: 8.5, color: f.t.accent, after: 1 })
      f.space(2)
    })
  }

  // ── Questions ──
  const questions = String(prep.questions || '').split('\n').map(q => q.trim()).filter(Boolean)
  if (questions.length) {
    f.section('Questions à poser')
    f.checks(questions.map(q => ({ label: clean(q) })))
  }

  // ── À apporter ──
  f.section('À apporter')
  f.checks([
    ...ALWAYS_BRING,
    ...(prep.themeLabels || []).map(t => `Programme : ${t}`),
    ...kitDocs.filter(d => (prep.documents || []).includes(d.id)).map(d => `Kit : ${d.title}`),
    ...(themes.includes('opco') ? ['Fiche démarches de prise en charge OPCO'] : []),
  ].map(t => ({ label: clean(t) })))

  // ── Avant de partir ──
  f.section('Avant de partir')
  f.checks(BEFORE_LEAVING.map(t => ({ label: clean(t) })))

  if (prep.notes) {
    f.section('Notes')
    f.para(clean(prep.notes))
  }

  // ── Grille de diagnostic express ──
  f.newPage()
  f.y = drawDocTitle(doc, ORG, 'Diagnostic express', clean(`${company} · à remplir avec l'interlocuteur`), f.y)
  const rowH = 16.5
  DIAGNOSTIC_ROWS.forEach(label => {
    f.ensure(rowH)
    doc.setDrawColor(...ORG.theme.line); doc.setLineWidth(0.3)
    doc.rect(f.M, f.y, f.W, rowH)
    doc.setFillColor(...ORG.theme.accent); doc.rect(f.M, f.y, 1, rowH, 'F')
    setF(doc, 'bold'); doc.setFontSize(8); doc.setTextColor(...ORG.theme.muted)
    doc.text(clean(label).toUpperCase(), f.M + 4, f.y + 4.5, { charSpace: 0.2 })
    f.y += rowH
  })
  doc.setTextColor(...ORG.theme.text)

  f.finish()
  numberPages(doc, ORG)
  const safeName = clean(clientName || client?.name || 'client').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40)
  doc.save(`Preparation_RDV_${safeName}_${String(rdv.rdv_date || '').slice(0, 10)}.pdf`)
  return doc
}

// ════════════════════════════════════════════════════════════════
// pdfPreparationRdv.js — Fiche de préparation d'un RDV commercial
// Page 1 et suivantes : entreprise, interlocuteur, historique, besoin,
// objections entendues, arguments (avec références à relire),
// questions à poser, documents à apporter, avant de partir.
// Dernière page : grille de diagnostic express à remplir sur place.
// Document interne.
// ════════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'
import { supabase } from '../../../core/supabase'
import { buildORG } from '../../../core/org/orgUtils'

const MARGIN = 15
const PAGE_W = 210
const PAGE_H = 297
const CONTENT_W = PAGE_W - MARGIN * 2
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'

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
  'Certificat Qualiopi ("Access Formation est certifié Qualiopi")',
  'Fiche d\'indicateurs de résultats à jour (Access Campus)',
  'Présentation d\'Access Formation (une page)',
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

class Writer {
  constructor(doc, org) {
    this.doc = doc
    this.org = org
    this.y = MARGIN
  }

  ensure(h) {
    if (this.y + h > PAGE_H - 18) {
      this.doc.addPage()
      this.y = MARGIN
    }
  }

  title(text) {
    const d = this.doc
    d.setFont('helvetica', 'bold')
    d.setFontSize(18)
    d.setTextColor(20, 20, 20)
    d.text(clean(text), MARGIN, this.y + 6)
    this.y += 10
  }

  subtitle(text) {
    const d = this.doc
    d.setFont('helvetica', 'normal')
    d.setFontSize(11)
    d.setTextColor(80, 80, 80)
    const lines = d.splitTextToSize(clean(text), CONTENT_W)
    d.text(lines, MARGIN, this.y + 4)
    this.y += lines.length * 5 + 3
  }

  section(text) {
    this.ensure(14)
    const d = this.doc
    this.y += 3
    d.setDrawColor(30, 58, 95)
    d.setLineWidth(0.4)
    d.line(MARGIN, this.y, PAGE_W - MARGIN, this.y)
    d.setFont('helvetica', 'bold')
    d.setFontSize(12)
    d.setTextColor(30, 58, 95)
    d.text(clean(text), MARGIN, this.y + 6)
    this.y += 10
  }

  line(label, value) {
    if (value === null || value === undefined || value === '') return
    const d = this.doc
    d.setFontSize(10)
    const labelW = 42
    const lines = d.splitTextToSize(clean(value), CONTENT_W - labelW)
    this.ensure(lines.length * 4.6 + 1)
    d.setFont('helvetica', 'bold')
    d.setTextColor(90, 90, 90)
    d.text(clean(label), MARGIN, this.y + 4)
    d.setFont('helvetica', 'normal')
    d.setTextColor(20, 20, 20)
    d.text(lines, MARGIN + labelW, this.y + 4)
    this.y += lines.length * 4.6 + 1.5
  }

  paragraph(text, { size = 10, color = [20, 20, 20], indent = 0, bold = false } = {}) {
    if (!text) return
    const d = this.doc
    d.setFont('helvetica', bold ? 'bold' : 'normal')
    d.setFontSize(size)
    d.setTextColor(...color)
    const lines = d.splitTextToSize(clean(text), CONTENT_W - indent)
    this.ensure(lines.length * (size * 0.46) + 1)
    d.text(lines, MARGIN + indent, this.y + 4)
    this.y += lines.length * (size * 0.46) + 1.5
  }

  bullet(text) {
    const d = this.doc
    d.setFont('helvetica', 'normal')
    d.setFontSize(10)
    const lines = d.splitTextToSize(clean(text), CONTENT_W - 6)
    this.ensure(lines.length * 4.6 + 1)
    d.setTextColor(20, 20, 20)
    d.text('-', MARGIN + 1, this.y + 4)
    d.text(lines, MARGIN + 6, this.y + 4)
    this.y += lines.length * 4.6 + 1
  }

  checkbox(text, checked = false) {
    const d = this.doc
    d.setFont('helvetica', 'normal')
    d.setFontSize(10)
    const lines = d.splitTextToSize(clean(text), CONTENT_W - 8)
    this.ensure(lines.length * 4.6 + 1.5)
    d.setDrawColor(60, 60, 60)
    d.setLineWidth(0.3)
    d.rect(MARGIN + 0.5, this.y + 1, 3.6, 3.6)
    if (checked) {
      d.line(MARGIN + 1.2, this.y + 3, MARGIN + 2.2, this.y + 4)
      d.line(MARGIN + 2.2, this.y + 4, MARGIN + 3.6, this.y + 1.6)
    }
    d.setTextColor(20, 20, 20)
    d.text(lines, MARGIN + 7, this.y + 4)
    this.y += lines.length * 4.6 + 1.5
  }

  gap(h = 2) { this.y += h }

  footers() {
    const d = this.doc
    const total = d.getNumberOfPages()
    for (let i = 1; i <= total; i++) {
      d.setPage(i)
      d.setFont('helvetica', 'normal')
      d.setFontSize(8)
      d.setTextColor(140, 140, 140)
      d.text(clean(`${this.org.name} est certifié Qualiopi · Document interne de préparation`), MARGIN, PAGE_H - 8)
      d.text(`${i} / ${total}`, PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' })
    }
  }
}

export async function generatePrepRdvPDF({ rdv, clientName, client, ctx, prep, argumentsList = [], kitDocs = [], objectionLabels = [] }) {
  let orgSettings = null
  try {
    const { data } = await supabase.from('organization_settings').select('*').limit(1).maybeSingle()
    orgSettings = data || null
  } catch { orgSettings = null }
  const org = buildORG(orgSettings)

  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const w = new Writer(doc, org)
  const themes = prep.themes || []

  // ── En-tête ──
  w.title('Préparation du RDV')
  w.subtitle(clientName || client?.name || 'Entreprise')
  w.line('Date', [fmtDate(rdv.rdv_date), rdv.rdv_time ? 'à ' + String(rdv.rdv_time).slice(0, 5).replace(':', 'h') : ''].filter(Boolean).join(' '))
  w.line('Mené par', rdv.conducted_by)
  w.line('Lieu', rdv.rdv_address || [client?.address, client?.postal_code, client?.city].filter(Boolean).join(' '))

  // ── Entreprise ──
  w.section('Entreprise')
  w.line('Raison sociale', client?.name || clientName)
  w.line('SIRET', client?.siret)
  w.line('Activité', [client?.naf_code || client?.naf, client?.naf_label].filter(Boolean).join(' - '))
  w.line('Effectif', prep.effectif || client?.effectif || client?.taille_entreprise)
  w.line('Sites', prep.sites)
  w.line('Métiers', prep.metiers)
  w.line('OPCO', prep.opco || client?.opco_name)
  w.line('Statut', client?.status ? `Client ${client.status}` : 'Prospect')

  // ── Interlocuteur ──
  w.section('Interlocuteur')
  w.line('Contact du RDV', [rdv.contact_name, rdv.contact_phone, rdv.contact_email].filter(Boolean).join(' · '))
  w.line('Qui décide', prep.decideur)
  if (ctx?.contacts?.length) {
    w.line('Contacts connus', ctx.contacts.slice(0, 6).map(c => `${c.name}${c.role ? ' (' + c.role + ')' : ''}${c.phone ? ' ' + c.phone : ''}`).join('\n'))
  }

  // ── Historique ──
  w.section('Historique')
  w.line('Formations suivies', ctx?.sessions?.length
    ? ctx.sessions.slice(0, 6).map(s => `${s.courses?.title || 'Formation'} (${fmtShort(s.end_date)})`).join('\n')
    : 'Aucune')
  w.line('Recyclage SST', ctx?.macDue ? `Échéance le ${fmtShort(ctx.macDue)}` : null)
  w.line('Devis en cours', ctx?.openQuotes?.length
    ? ctx.openQuotes.map(q => `${q.reference} du ${fmtShort(q.quote_date)} - ${money(q.total_ht)}`).join('\n')
    : null)
  w.line('Dernier appel', ctx?.lastCall ? `${fmtShort(ctx.lastCall.called_at)} (${ctx.lastCall.called_by || '-'}) : ${ctx.lastCall.notes || ctx.lastCall.call_result}` : null)
  w.line('Dernier échange', ctx?.lastInteraction ? `${fmtShort(ctx.lastInteraction.interaction_date)} : ${ctx.lastInteraction.title}` : null)

  // ── Besoin ──
  w.section('Besoin exprimé')
  w.line('Thèmes visés', (prep.themeLabels || []).join(', '))
  w.paragraph(prep.besoin)
  if (ctx?.providers?.length) {
    w.line('Prestataires en place', ctx.providers.map(p => `${p.theme} : ${p.provider_name || '?'}${p.last_training_year ? ' (' + p.last_training_year + ')' : ''}`).join('\n'))
  }
  if (rdv.notes || rdv.notes_crm) w.line('Notes de l\'appel', [rdv.notes, rdv.notes_crm].filter(Boolean).join('\n'))

  // ── Objections ──
  const objections = [...new Set([...(prep.objections || []), ...objectionLabels])]
  if (objections.length) {
    w.section('Objections entendues au téléphone')
    objections.forEach(o => w.bullet(o))
  }

  // ── Arguments ──
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const args = argumentsList.filter(a => a.is_active && (!a.valid_until || a.valid_until >= today))
    .filter(a => !a.themes?.length || a.themes.some(t => themes.includes(t)))
  if (args.length) {
    w.section('Arguments')
    args.forEach(a => {
      w.paragraph(a.title, { bold: true })
      w.paragraph(a.say_text, { indent: 4 })
      if (a.detail) w.paragraph(a.detail, { indent: 4, color: [70, 70, 70], size: 9 })
      if (a.legal_reference) w.paragraph('Référence : ' + a.legal_reference, { indent: 4, color: [120, 70, 20], size: 9 })
      w.gap(1)
    })
  }

  // ── Questions ──
  const questions = String(prep.questions || '').split('\n').map(q => q.trim()).filter(Boolean)
  if (questions.length) {
    w.section('Questions à poser')
    questions.forEach(q => w.checkbox(q))
  }

  // ── À apporter ──
  w.section('À apporter')
  ALWAYS_BRING.forEach(t => w.checkbox(t))
  ;(prep.themeLabels || []).forEach(t => w.checkbox(`Programme : ${t}`))
  kitDocs.filter(d => (prep.documents || []).includes(d.id)).forEach(d => w.checkbox(`Kit : ${d.title}`))
  if (themes.includes('opco')) w.checkbox('Fiche démarches de prise en charge OPCO')

  // ── Avant de partir ──
  w.section('Avant de partir')
  BEFORE_LEAVING.forEach(t => w.checkbox(t))

  if (prep.notes) {
    w.section('Notes')
    w.paragraph(prep.notes)
  }

  // ── Grille de diagnostic express ──
  doc.addPage()
  w.y = MARGIN
  w.title('Diagnostic express')
  w.subtitle(`${clientName || client?.name || ''} · à remplir avec l'interlocuteur`)
  const rowH = 17
  DIAGNOSTIC_ROWS.forEach(label => {
    w.ensure(rowH)
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.3)
    doc.rect(MARGIN, w.y, CONTENT_W, rowH)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(60, 60, 60)
    doc.text(clean(label), MARGIN + 2, w.y + 4.5)
    w.y += rowH
  })

  w.footers()
  const safeName = clean(clientName || client?.name || 'client').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40)
  doc.save(`Preparation_RDV_${safeName}_${String(rdv.rdv_date || '').slice(0, 10)}.pdf`)
}

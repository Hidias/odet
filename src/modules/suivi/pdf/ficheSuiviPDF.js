// Fiche de suivi des évaluations formatives d'une session : document récapitulatif demandé par le manuel du
// formateur SST (INRS) et preuve de l'indicateur 11 (Qualiopi). Mise en page commune (core/pdf/layout.js).
// Contenu : séquences et modalités, résultats par stagiaire (note du groupe ou individuelle, rôle principal),
// remarques et remédiations, point avant les épreuves, signature du formateur.

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { startDocument } from '../../../core/pdf/layout'
import { modalityLabel, modalityShort } from '../lib/sequenceTemplates'
import { STATUSES, statusOf, effectiveStatus, indexEvaluations, computeCoverage, hasRoles, principalRole } from '../lib/sfData'

const fr = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('fr-FR') : '')
const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const fullName = (t) => `${t.first_name || ''} ${(t.last_name || '').toUpperCase()}`.trim()

/**
 * @param {object} ORG identité (loadPdfOrg)
 * @param {object} p { session, sequences, evaluations, trainees, version, archivedAt }
 * @returns jsPDF
 */
export function buildFicheSuiviPDF(ORG, { session = {}, sequences = [], evaluations = [], trainees = [], version = null, archivedAt = null } = {}) {
  const wide = sequences.length > 14
  const doc = new jsPDF({ compress: true, orientation: wide ? 'landscape' : 'portrait' })
  const subtitle = [session.courses?.title, version ? `Version ${version}${archivedAt ? ` archivée le ${fr(archivedAt)}` : ''}` : `État au ${fr(new Date())}`].filter(Boolean).join('  ·  ')
  const f = startDocument(doc, ORG, {
    ref: session.reference || null, docLabel: 'Suivi formatif', code: 'SUIVI-FORM',
    title: 'Fiche de suivi des évaluations formatives', subtitle,
  })

  const trainer = [session.trainers?.first_name, session.trainers?.last_name].filter(Boolean).join(' ')
  // L'intitulé complet de la formation est déjà dans le sous-titre : les cartes restent sur une ligne chacune
  const several = session.end_date && session.end_date !== session.start_date
  const dates = session.start_date ? (several ? `Du ${fr(session.start_date)} au ${fr(session.end_date)}` : `Le ${fr(session.start_date)}`) : ''
  f.cards([
    { label: 'Session', lines: [dates, [session.location_name, session.location_city].filter(Boolean).join(', '), session.reference ? `Référence ${session.reference}` : ''] },
    { label: 'Encadrement', lines: [trainer ? `Formateur : ${trainer}` : '', `${trainees.length} stagiaire${trainees.length > 1 ? 's' : ''}`] },
  ])

  // 1. Séquences
  f.section('1. Séquences et modalités d\'évaluation formative')
  f.table(['N°', 'Séquence', 'Compétences', 'Modalité', 'Date', 'Groupe'],
    sequences.map((s, i) => [
      `S${i + 1}`, s.title, (s.competences || []).join(', '), modalityLabel(s.modality),
      fr(s.planned_date || s.closed_at), statusOf(s.group_status)?.label || '',
    ]),
    { columnStyles: { 0: { cellWidth: 11 }, 2: { cellWidth: 26 }, 3: { cellWidth: 30 }, 4: { cellWidth: 20 }, 5: { cellWidth: 20 } } })

  // 2. Résultats
  const idx = indexEvaluations(evaluations)
  f.section('2. Résultats par stagiaire')
  const cov = computeCoverage(sequences, evaluations, trainees)
  const head = ['Stagiaire', ...sequences.map((s, i) => `S${i + 1}\n${modalityShort(s.modality)}`), ...(cov.hasRoleSequences ? ['Rôle\nprinc.'] : [])]
  const body = trainees.map((t) => [
    fullName(t),
    ...sequences.map((s) => {
      const row = idx.get(`${s.id}|${t.id}`)
      const st = effectiveStatus(s, row)
      const code = st.key ? statusOf(st.key).code : ''
      const label = st.source === 'groupe' ? code.toLowerCase() : code
      const role = row?.role && hasRoles(s) && row.role === principalRole(s) ? ' P' : ''
      return label + role
    }),
    ...(cov.hasRoleSequences ? [String(cov.principalCount[t.id] || 0)] : []),
  ])
  const nameW = wide ? 42 : 36
  const colStyles = { 0: { cellWidth: nameW, halign: 'left' } }
  sequences.forEach((_, i) => { colStyles[i + 1] = { halign: 'center', cellPadding: 1 } })
  f.table(head, body, {
    styles: { fontSize: 7.5 },
    headStyles: { fontSize: 6.8, halign: 'center' },
    columnStyles: colStyles,
    didParseCell: (c) => {
      if (c.section !== 'body' || c.column.index === 0) return
      const raw = String(c.cell.raw || '').replace(' P', '')
      const st = STATUSES.find((s) => s.code === raw.toUpperCase())
      if (!st) return
      const individual = raw === raw.toUpperCase()
      c.cell.styles.fillColor = hexToRgb(individual ? st.solid : st.tint)
      c.cell.styles.textColor = individual ? [255, 255, 255] : hexToRgb(st.ink)
      c.cell.styles.fontStyle = individual ? 'bold' : 'normal'
    },
  })
  f.note('A acquis · EC en cours · AR à revoir · NO non observé · minuscules : note du groupe ; majuscules sur fond plein : note individuelle · P : rôle principal tenu dans la mise en situation (premier rôle de la séquence) · O oral, Q QCM, EC étude de cas, MS mise en situation, D démonstration.')

  // 3. Remarques
  const remarks = []
  sequences.forEach((s, i) => {
    if (s.group_remark) remarks.push(`S${i + 1} · Groupe : ${s.group_remark}`)
    for (const t of trainees) {
      const row = idx.get(`${s.id}|${t.id}`)
      if (row?.remark) remarks.push(`S${i + 1} · ${fullName(t)}${row.role ? ` (${row.role})` : ''} : ${row.remark}`)
    }
  })
  f.section('3. Remarques et remédiations')
  if (remarks.length) f.bullets(remarks)
  else f.note('Aucune remarque saisie.')

  // 4. Avant les épreuves
  f.section('4. Point avant les épreuves certificatives')
  const lines = []
  if (cov.hasRoleSequences) {
    const p = sequences.find(hasRoles)
    const roleName = principalRole(p) || 'rôle principal'
    lines.push(cov.neverPrincipal.length
      ? `Jamais en rôle « ${roleName} » : ${cov.neverPrincipal.map(fullName).join(', ')}.`
      : `Chaque stagiaire a tenu au moins une fois le rôle « ${roleName} ».`)
    cov.byCompetence.filter((c) => c.missing.length).forEach((c) => lines.push(`${c.code} : ${c.seen} sur ${c.total} vus en rôle principal ; pas encore : ${c.missing.map(fullName).join(', ')}.`))
  }
  lines.push(cov.pending.length
    ? `« À revoir » sans reprise acquise ensuite : ${cov.pending.map((x) => `${fullName(x.trainee)} (${x.sequence.title})`).join(' ; ')}.`
    : 'Aucun « à revoir » sans reprise.')
  f.bullets(lines)

  f.signatures([{ label: 'Le formateur', name: trainer || ' ', hint: 'Date et signature' }], { height: 24 })
  f.finish()
  return doc
}

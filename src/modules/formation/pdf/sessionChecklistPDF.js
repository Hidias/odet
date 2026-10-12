// Fiche de contrôle de session (avant / pendant / après), vierge ou remplie,
// sur la mise en page commune des documents (core/pdf/layout.js).

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { startDocument, drawCheckbox } from '../../../core/pdf/layout'

const fr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '')

/**
 * @param {object} ORG identité (loadPdfOrg)
 * @param {object} p { session, traineeCount, phases: [{ title, items: [{ code, label, sst }] }], data: { [code]: { is_checked, date_realized, comment } }, blank }
 */
export function buildSessionChecklistPDF(ORG, { session = {}, traineeCount = 0, phases = [], data = {}, blank = false, location = '' } = {}) {
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, { ref: session.reference || null, docLabel: 'Fiche de contrôle', code: 'CTRL', title: 'Fiche de contrôle de la session', subtitle: blank ? 'Version vierge pour archivage papier' : `État au ${fr(new Date())}` })
  const trainer = [session.trainers?.first_name, session.trainers?.last_name].filter(Boolean).join(' ')
  const dates = fr(session.start_date) + (session.end_date && session.end_date !== session.start_date ? ' au ' + fr(session.end_date) : '')
  f.cards([
    { label: 'Session', lines: [session.courses?.title || '', `Du ${dates}`, location || '', `${traineeCount} stagiaire${traineeCount > 1 ? 's' : ''}`] },
    { label: 'Intervenants', lines: [session.clients?.name || '', trainer ? `Formateur : ${trainer}` : '', session.reference ? `Référence ${session.reference}` : ''] },
  ])

  phases.forEach(ph => {
    if (!ph.items.length) return
    const done = ph.items.filter(it => !blank && data[it.code]?.is_checked).length
    f.section(`${ph.title}${blank ? '' : `  ·  ${done} / ${ph.items.length}`}`)
    const rows = ph.items.map(it => {
      const d = blank ? {} : (data[it.code] || {})
      return ['', it.label + (it.sst ? ' (SST)' : ''), blank ? '' : fr(d.date_realized), blank ? '' : (d.comment || '')]
    })
    f.table(['', 'Contrôle', 'Réalisé le', 'Commentaire'], rows, {
      columnStyles: { 0: { cellWidth: 9 }, 1: { cellWidth: 72 }, 2: { cellWidth: 24, halign: 'center' } },
      bodyStyles: { minCellHeight: 7.5 },
      didDrawCell: (c) => {
        if (c.section === 'body' && c.column.index === 0) {
          const it = ph.items[c.row.index]
          const checked = !blank && !!data[it.code]?.is_checked
          drawCheckbox(doc, ORG, c.cell.x + 2.6, c.cell.y + (c.cell.height - 3.6) / 2, 3.6, checked)
        }
      },
    })
  })

  f.signatures([
    { label: 'Vérifié par', hint: 'Nom et date' },
    { label: 'Signature', hint: '' },
  ], { height: 22 })
  f.finish()
  return doc
}

// Rapport de complétude (éléments manquants dans les dossiers) sur la mise en page commune.

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { startDocument, numberPages } from '../../../core/pdf/layout'

const PRIO = { bloquant: { label: 'Bloquant', color: [200, 30, 45] }, important: { label: 'Important', color: [217, 119, 6] }, mineur: { label: 'Mineur', color: [107, 114, 128] } }

/**
 * @param {object} ORG identité (loadPdfOrg)
 * @param {object} p { issues: [{ priority, categoryLabel, element, detail, client, since }], stats: { total, bloquant, important, mineur } }
 */
export function buildCompletudePDF(ORG, { issues = [], stats = {} } = {}) {
  const doc = new jsPDF({ orientation: 'landscape', compress: true })
  const f = startDocument(doc, ORG, { docLabel: 'Système qualité', code: 'COMPL', title: 'Rapport de complétude', subtitle: `Édité le ${format(new Date(), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}` })
  f.cards([
    { label: 'Éléments manquants', lines: [String(stats.total || 0), 'au total'] },
    { label: 'Bloquants', lines: [String(stats.bloquant || 0), 'à traiter en priorité'] },
    { label: 'Importants', lines: [String(stats.important || 0), 'à traiter rapidement'] },
    { label: 'Mineurs', lines: [String(stats.mineur || 0), 'à compléter'] },
  ])
  if (!issues.length) {
    f.para('Aucun élément manquant.', { color: f.t.muted })
  } else {
    f.table(['Priorité', 'Catégorie', 'Élément', 'Détail', 'Client', 'Depuis'], issues.map(i => [
      PRIO[i.priority]?.label || i.priority || '',
      i.categoryLabel || '',
      i.element || '',
      i.detail || '',
      i.client || '-',
      i.since ? format(new Date(i.since), 'dd/MM/yy') : '-',
    ]), {
      columnStyles: { 0: { cellWidth: 22, fontStyle: 'bold' }, 1: { cellWidth: 34 }, 2: { cellWidth: 60 }, 4: { cellWidth: 48 }, 5: { cellWidth: 18, halign: 'center' } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 0) {
          const p = issues[data.row.index]?.priority
          if (PRIO[p]) data.cell.styles.textColor = PRIO[p].color
        }
      },
    })
  }
  f.finish()
  if (doc.getNumberOfPages() > 1) numberPages(doc, ORG)
  return doc
}

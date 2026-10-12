// « Nos résultats et leur méthode de calcul » (indicateur 2 du référentiel Qualiopi), mise en page commune.

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { startDocument, numberPages } from '../../../core/pdf/layout'
import { publishedLines } from '../lib/results'

const frDay = (iso) => (iso ? format(new Date(`${iso}T12:00:00`), 'd MMMM yyyy', { locale: fr }) : '')

export function buildMethodePDF(ORG, results, show, { from = null, to = null } = {}) {
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, {
    docLabel: 'Information du public', code: 'RESULTATS',
    title: 'Nos résultats et leur méthode de calcul',
    subtitle: `Mis à jour le ${format(new Date(), 'd MMMM yyyy', { locale: fr })}`,
  })
  f.para(`Formations terminées${from ? ` du ${frDay(from)}` : ''}${to ? ` au ${frDay(to)}` : ''} : ${results.sessions} session${results.sessions > 1 ? 's' : ''}, ${results.trainees} stagiaire${results.trainees > 1 ? 's' : ''}.`, { size: 10, after: 4 })
  const lines = publishedLines(results, show)
  f.table(['Résultat', 'Valeur', 'Méthode de calcul', 'Base'], lines.map((l) => [l.label, l.value + (l.small ? '\n(effectif réduit)' : ''), l.method, l.sample]), {
    columnStyles: { 0: { cellWidth: 32, fontStyle: 'bold' }, 1: { cellWidth: 24, halign: 'center' }, 3: { cellWidth: 38 } },
  })
  f.space(3)
  f.note('Seules les formations terminées sont comptées. Un résultat calculé sur moins de 10 réponses est signalé « effectif réduit ».')
  f.finish()
  numberPages(doc, ORG)
  return { doc, filename: `Resultats_methode_de_calcul_${format(new Date(), 'yyyy-MM-dd')}.pdf` }
}

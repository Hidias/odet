// Dossier d'audit : un PDF par critère (libellé officiel, statut, preuves trouvées, preuves ajoutées,
// non-applicabilité justifiée), sur la mise en page commune.

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { startDocument, numberPages } from '../../../core/pdf/layout'
import { STATUS_LABEL } from '../lib/proofs'

export function buildCriterionPDF(ORG, { criterion, indicators, referential, includeNa = true, proofFileName = () => '' }) {
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, {
    docLabel: 'Dossier d\'audit Qualiopi', code: `AUDIT-C${criterion.number}`,
    title: `Critère ${criterion.number}`,
    subtitle: `${criterion.title}. ${referential?.label || ''}, édité le ${format(new Date(), 'd MMMM yyyy', { locale: fr })}`,
  })
  const list = indicators.filter((i) => includeNa || i.status !== 'non_applicable')
  f.table(['Indicateur', 'Intitulé', 'Statut'], list.map((i) => [String(i.number), i.short_title, STATUS_LABEL[i.status]]), {
    columnStyles: { 0: { cellWidth: 22, halign: 'center', fontStyle: 'bold' }, 2: { cellWidth: 36 } },
  })
  for (const i of list) {
    f.ensure(40)
    f.section(`Indicateur ${i.number} : ${i.short_title}`)
    f.para(i.text, { size: 8.5, after: 3 })
    if (i.status === 'non_applicable') {
      f.kv([['Statut', 'Non applicable'], ['Justification', i.naReason || '-']], { labelW: 30 })
      continue
    }
    f.kv([['Statut', STATUS_LABEL[i.status]]], { labelW: 30 })
    if (i.items.length) {
      f.table(['', 'Élément vérifiable dans l\'outil'], i.items.map((it) => [it.ok ? 'Oui' : 'Non', it.label]), {
        columnStyles: { 0: { cellWidth: 14, halign: 'center', fontStyle: 'bold' } },
      })
    }
    if (i.manual.length) {
      f.table(['Preuve ajoutée', 'Commentaire', 'Pièce'], i.manual.map((p) => [p.label, p.note || '-', p.file_path ? proofFileName(p) : (p.url || '-')]), {
        columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold' }, 2: { cellWidth: 52 } },
      })
    }
    if (i.missing.length) {
      f.para('Points à préciser', { style: 'bold', size: 9, after: 1 })
      f.bullets(i.missing)
    }
    f.space(2)
  }
  f.finish()
  numberPages(doc, ORG)
  return doc
}

export function buildSamplePDF(ORG, { sessions = [] }) {
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, {
    docLabel: 'Dossier d\'audit Qualiopi', code: 'AUDIT-ECH',
    title: 'Échantillon de sessions', subtitle: `Édité le ${format(new Date(), 'd MMMM yyyy', { locale: fr })}`,
  })
  if (!sessions.length) f.para('Aucune session terminée.')
  else f.table(['Session', 'Formation', 'Dates', 'Client', 'Stagiaires', 'Convention'], sessions.map((s) => [
    s.reference || '', s.courses?.title || '', [s.start_date, s.end_date].filter(Boolean).map((d) => format(new Date(`${d}T12:00:00`), 'dd/MM/yyyy')).filter((v, k, a) => a.indexOf(v) === k).join(' au '),
    s.clients?.name || '-', String(s.session_trainees?.length || 0), s.convention_signed ? 'Signée' : 'Non signée',
  ]), { columnStyles: { 0: { cellWidth: 26, fontStyle: 'bold' }, 4: { cellWidth: 20, halign: 'center' }, 5: { cellWidth: 22 } } })
  f.space(3)
  f.note('Émargements, évaluations et attestations de ces sessions sont consultables dans l\'outil pendant l\'audit.')
  f.finish()
  numberPages(doc, ORG)
  return doc
}

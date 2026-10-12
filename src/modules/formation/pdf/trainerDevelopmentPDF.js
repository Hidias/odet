// Plan de développement des compétences d'un formateur (formations suivies, entretiens)
// sur la mise en page commune des documents (core/pdf/layout.js).

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { startDocument, numberPages } from '../../../core/pdf/layout'

const TYPES = { externe: 'Formation externe', interne: 'Formation interne', echange_pratiques: 'Échange de pratiques' }
const ITW = { annuel: 'Entretien annuel', semestriel: 'Entretien semestriel', ponctuel: 'Entretien ponctuel' }
const fr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '')

export function buildTrainerDevelopmentPDF(ORG, { trainerName = '', trainings = [], interviews = [] } = {}) {
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, { docLabel: 'Développement des compétences', code: 'PDC', title: 'Plan de développement des compétences', subtitle: `Formateur : ${trainerName}` })

  const done = trainings.filter(t => t.training_date && new Date(t.training_date) <= new Date()).length
  f.kv([
    ['Formateur', trainerName],
    ['Formations', `${trainings.length} enregistrée${trainings.length > 1 ? 's' : ''}, dont ${done} réalisée${done > 1 ? 's' : ''}`],
    ['Entretiens', `${interviews.length} enregistré${interviews.length > 1 ? 's' : ''}`],
    ["Date d'édition", fr(new Date())],
  ], { labelW: 40 })
  f.space(2)

  f.section('Formations suivies et planifiées')
  if (trainings.length) {
    f.table(['Date', 'Formation', 'Type', 'Organisme', 'Durée', 'Certificat'], trainings.map(t => [
      fr(t.training_date),
      t.training_name || '',
      TYPES[t.training_type] || t.training_type || '',
      t.organizer || '-',
      t.duration_days ? `${t.duration_days} j` : (t.duration_hours ? `${t.duration_hours} h` : '-'),
      t.certificate_obtained ? 'Oui' : 'Non',
    ]), { columnStyles: { 0: { cellWidth: 22 }, 2: { cellWidth: 32 }, 3: { cellWidth: 32 }, 4: { cellWidth: 15, halign: 'center' }, 5: { cellWidth: 20, halign: 'center' } } })
  } else f.note('Aucune formation enregistrée.')

  f.section('Entretiens professionnels')
  if (interviews.length) {
    f.table(['Date', 'Type', 'Réalisé par', 'Thèmes abordés', 'Besoins identifiés'], interviews.map(i => [
      fr(i.interview_date),
      ITW[i.interview_type] || i.interview_type || '',
      i.interviewer_name || '',
      i.themes_discussed || '-',
      i.identified_needs || '-',
    ]), { columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 32 }, 2: { cellWidth: 32 } } })
  } else f.note('Aucun entretien enregistré.')

  f.finish()
  if (doc.getNumberOfPages() > 1) numberPages(doc, ORG)
  return doc
}

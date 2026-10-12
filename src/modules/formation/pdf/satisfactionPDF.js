// Questionnaires de satisfaction (entreprise cliente et donneur d'ordre en sous-traitance),
// sur la mise en page commune des documents (core/pdf/layout.js).

import jsPDF from 'jspdf'
import { format } from 'date-fns'
import { startDocument } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'

const d = (v) => { try { return v ? format(new Date(v), 'dd/MM/yyyy') : '' } catch { return '' } }

function datesOf(session) {
  const s = d(session?.start_date), e = d(session?.end_date)
  return !e || s === e ? s : `du ${s} au ${e}`
}

function writeQuestionnaire(doc, ORG, session, { kind, client = null }) {
  const isDO = kind === 'do'
  const trainer = session?.trainers
  const f = startDocument(doc, ORG, {
    ref: session?.reference || null,
    docLabel: 'Questionnaire de satisfaction',
    code: isDO ? 'SATDO' : 'SATENT',
    title: 'Questionnaire de satisfaction',
    subtitle: isDO ? 'Évaluation de la prestation de sous-traitance' : 'Évaluation de la prestation de formation par l\'entreprise',
  })
  f.kv([
    ['Formation', (isDO ? session?.subcontract_course_title : null) || session?.courses?.title || ''],
    ['Dates', datesOf(session)],
    [isDO ? 'Donneur d\'ordre' : 'Entreprise', client?.name || session?.clients?.name || ''],
    ['Formateur', trainer ? `${trainer.first_name || ''} ${trainer.last_name || ''}`.trim() : ''],
    ...(isDO ? [['Stagiaires', session?.subcontract_nb_trainees ? `${session.subcontract_nb_trainees} stagiaire(s)` : ''], ['Lieu', session?.location_name || '']] : []),
  ])
  f.y += 4
  f.para(isDO
    ? 'Votre retour est essentiel pour améliorer la qualité de nos prestations de sous-traitance. Merci de prendre quelques minutes pour remplir ce questionnaire.'
    : 'Votre retour nous aide à améliorer nos formations. Merci de prendre quelques minutes pour remplir ce questionnaire.', { after: 3 })
  f.note('1 = très insatisfait, 2 = insatisfait, 3 = neutre, 4 = satisfait, 5 = très satisfait.', { after: 2 })
  const rows = isDO
    ? ['Qualité de nos échanges (avant, pendant et après la formation)', 'Qualité de notre prestation', 'Gestion administrative (documents, attestations, réactivité)', 'Satisfaction globale de notre intervention']
    : ['Organisation de la formation (logistique, matériel, horaires)', "Qualité de l'intervenant (pédagogie, expertise, disponibilité)", 'Adéquation avec vos besoins (contenu, objectifs atteints)', 'Gestion administrative (documents, suivi, réactivité)']
  f.ratingGrid([{ title: 'Évaluation de la prestation', rows: rows.map(label => ({ label, value: null })) }], { nc: false, colW: 12, rowH: 8 })
  f.choiceLine(isDO ? 'Feriez-vous de nouveau appel à nous ?' : 'Recommanderiez-vous nos services à d\'autres entreprises ?', [{ label: 'Oui' }, { label: 'Non' }])
  f.box("Commentaires et suggestions (points forts, axes d'amélioration, besoins futurs)", { height: 30, lined: true })
  f.signatures([{ label: 'Le répondant', hint: 'Nom, fonction, date, signature et cachet' }], { height: 26 })
  f.note('Merci de nous retourner ce questionnaire complété, par email ou par courrier.', { align: 'center' })
  f.finish()
}

async function toPayload(doc, filename, withBlob) {
  const base64 = doc.output('datauristring').split(',')[1]
  const out = { filename, base64, size: base64.length }
  if (withBlob) out.blob = new Blob([doc.output('arraybuffer')], { type: 'application/pdf' })
  return out
}

export async function generateSatisfactionEntreprisePDF(session, client, orgOverride = null) {
  const ORG = orgOverride || await loadPdfOrg()
  const doc = new jsPDF({ compress: true })
  writeQuestionnaire(doc, ORG, session, { kind: 'entreprise', client })
  return toPayload(doc, `Questionnaire_Satisfaction_${session?.reference || 'formation'}.pdf`, false)
}

export async function generateSatisfactionDOPDF(session, orgOverride = null) {
  const ORG = orgOverride || await loadPdfOrg()
  const doc = new jsPDF({ compress: true })
  writeQuestionnaire(doc, ORG, session, { kind: 'do' })
  return toPayload(doc, `Questionnaire_Satisfaction_DO_${session?.reference || 'session'}.pdf`, true)
}

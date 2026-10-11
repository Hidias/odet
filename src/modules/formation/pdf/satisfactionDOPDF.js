import jsPDF from 'jspdf'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

/**
 * Génère le questionnaire de satisfaction Donneur d'Ordre (sous-traitance)
 * Pré-rempli avec les infos de la session
 * Fidèle au template Questionnaire_Satisfaction_DO.pdf
 */
export async function generateSatisfactionDOPDF(session) {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  // ══════════════════════════════════════════════════════════════
  // EN-TÊTE
  // ══════════════════════════════════════════════════════════════

  try {
    const logoUrl = '/assets/logo-access.png'
    const logoResponse = await fetch(logoUrl)
    if (logoResponse.ok) {
      const logoBlob = await logoResponse.blob()
      const logoBase64 = await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.readAsDataURL(logoBlob)
      })
      doc.addImage(logoBase64, 'PNG', 15, 10, 40, 15)
    }
  } catch (e) {
    console.warn('Logo non chargé:', e)
  }

  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(31, 78, 121)
  doc.text('QUESTIONNAIRE DE SATISFACTION', pageWidth / 2, 22, { align: 'center' })

  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80, 80, 80)
  doc.text('Évaluation de la prestation de sous-traitance', pageWidth / 2, 30, { align: 'center' })

  doc.setDrawColor(31, 78, 121)
  doc.setLineWidth(0.5)
  doc.line(15, 36, pageWidth - 15, 36)

  // ══════════════════════════════════════════════════════════════
  // INFOS FORMATION (pré-remplies)
  // ══════════════════════════════════════════════════════════════

  let y = 44

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text('INFORMATIONS SUR LA FORMATION', 15, y)
  y += 7

  // Cadre gris
  doc.setFillColor(245, 245, 245)
  doc.rect(15, y - 3, pageWidth - 30, 42, 'F')

  doc.setFontSize(9)

  const trainer = session?.trainers
  const trainerName = trainer ? `${trainer.first_name} ${trainer.last_name}` : ''
  const courseTitle = session?.subcontract_course_title || session?.courses?.title || ''
  const startDate = session?.start_date ? format(new Date(session.start_date), 'dd/MM/yyyy', { locale: fr }) : ''
  const endDate = session?.end_date ? format(new Date(session.end_date), 'dd/MM/yyyy', { locale: fr }) : ''
  const dateText = startDate === endDate ? startDate : `${startDate} au ${endDate}`
  const nbTrainees = session?.subcontract_nb_trainees || 0
  const lieu = session?.location_name || ''

  const fields = [
    { label: 'Formation :', value: courseTitle },
    { label: 'Référence :', value: session?.reference || '' },
    { label: 'Dates :', value: dateText },
    { label: 'Formateur :', value: trainerName },
    { label: 'Stagiaires :', value: nbTrainees ? `${nbTrainees} stagiaire(s)` : '' },
    { label: 'Lieu :', value: lieu },
  ]

  fields.forEach(({ label, value }) => {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(60, 60, 60)
    doc.text(label, 20, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(0, 0, 0)
    // Tronquer si trop long
    const maxW = pageWidth - 70
    const truncated = doc.splitTextToSize(value, maxW)[0] || ''
    doc.text(truncated, 52, y)
    y += 6
  })

  y += 2 // fin cadre

  // ══════════════════════════════════════════════════════════════
  // INTRO
  // ══════════════════════════════════════════════════════════════

  doc.setFontSize(9)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(80, 80, 80)
  const intro = "Votre retour est essentiel pour améliorer la qualité de nos prestations de sous-traitance.\nMerci de prendre quelques minutes pour remplir ce questionnaire."
  const splitIntro = doc.splitTextToSize(intro, pageWidth - 30)
  doc.text(splitIntro, 15, y)
  y += splitIntro.length * 4 + 6

  // ══════════════════════════════════════════════════════════════
  // QUESTIONS (fidèles au template DO)
  // ══════════════════════════════════════════════════════════════

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(0, 0, 0)
  doc.text('ÉVALUATION DE LA PRESTATION', 15, y)
  y += 5

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 100, 100)
  doc.text('Échelle : 1 = Très insatisfait  •  2 = Insatisfait  •  3 = Neutre  •  4 = Satisfait  •  5 = Très satisfait', pageWidth / 2, y, { align: 'center' })
  y += 7

  const questions = [
    '1. Qualité de nos échanges (avant / pendant / après la formation)',
    '2. Qualité de notre prestation',
    '3. Gestion administrative (documents, attestations, réactivité)',
    '4. Satisfaction globale de notre intervention',
  ]

  questions.forEach((q) => {
    // Fond léger
    doc.setFillColor(250, 250, 252)
    doc.rect(15, y - 4, pageWidth - 30, 16, 'F')
    doc.setDrawColor(220, 220, 230)
    doc.setLineWidth(0.2)
    doc.rect(15, y - 4, pageWidth - 30, 16)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(30, 30, 30)
    doc.text(q, 19, y)

    // Cases à cocher 1-5
    const boxSize = 5
    const startX = pageWidth - 30 - 5 * 14
    doc.setDrawColor(100, 100, 100)
    doc.setLineWidth(0.3)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(60, 60, 60)
    for (let i = 1; i <= 5; i++) {
      const bx = startX + (i - 1) * 14
      doc.rect(bx, y - 1, boxSize, boxSize)
      doc.text(i.toString(), bx + boxSize + 1.5, y + 3.2)
    }

    y += 18
  })

  // ══════════════════════════════════════════════════════════════
  // COMMENTAIRES
  // ══════════════════════════════════════════════════════════════

  y += 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(0, 0, 0)
  doc.text('Commentaires et suggestions', 15, y)
  y += 2
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(100, 100, 100)
  doc.text("(points forts, axes d'amélioration, attentes futures...)", 15, y)
  y += 4

  const commentH = 28
  doc.setDrawColor(150, 150, 150)
  doc.setLineWidth(0.3)
  doc.rect(15, y, pageWidth - 30, commentH)
  doc.setDrawColor(220, 220, 220)
  doc.setLineWidth(0.1)
  for (let i = 1; i <= 4; i++) {
    const lineY = y + i * (commentH / 5)
    doc.line(17, lineY, pageWidth - 17, lineY)
  }
  y += commentH + 10

  // ══════════════════════════════════════════════════════════════
  // SIGNATURE
  // ══════════════════════════════════════════════════════════════

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(0, 0, 0)

  // Ligne Date
  doc.text('Date :', 15, y)
  doc.setDrawColor(150, 150, 150)
  doc.setLineWidth(0.3)
  doc.line(30, y, 90, y)

  // Nom + prénom (droite)
  const rightX = pageWidth / 2 + 10
  doc.text('Nom et prénom :', rightX, y)
  doc.line(rightX + 30, y, pageWidth - 15, y)

  y += 14

  doc.setFont('helvetica', 'bold')
  doc.text('Signature et cachet :', 15, y)
  doc.setDrawColor(150, 150, 150)
  doc.rect(15, y + 3, pageWidth - 30, 22)

  // ══════════════════════════════════════════════════════════════
  // PIED DE PAGE
  // ══════════════════════════════════════════════════════════════

  doc.setFontSize(7)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(150, 150, 150)
  doc.text('Merci de nous retourner ce questionnaire complété.', pageWidth / 2, pageHeight - 15, { align: 'center' })
  doc.text('Access Formation - Organisme de formation professionnelle', pageWidth / 2, pageHeight - 10, { align: 'center' })

  // ══════════════════════════════════════════════════════════════
  // RETOUR
  // ══════════════════════════════════════════════════════════════

  const pdfBytes = doc.output('arraybuffer')
  const blob = new Blob([pdfBytes], { type: 'application/pdf' })
  const base64 = await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result.split(',')[1])
    reader.readAsDataURL(blob)
  })

  const filename = `Questionnaire_Satisfaction_DO_${session?.reference || 'session'}.pdf`

  return { filename, base64, blob, size: base64.length }
}

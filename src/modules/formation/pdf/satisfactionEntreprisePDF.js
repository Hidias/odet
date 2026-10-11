import jsPDF from 'jspdf'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

/**
 * Génère le questionnaire de satisfaction entreprise — 1 PAGE GARANTIE
 * Calcul Y précis : total ≈ 275mm, tient sur A4 (297mm)
 */
export async function generateSatisfactionEntreprisePDF(session, client) {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  // ══════════════════════════════════════════════════════════════
  // EN-TÊTE  (y=0→48)
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
  } catch (error) {
    console.warn('Logo non chargé:', error)
  }

  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(31, 78, 121)
  doc.text('QUESTIONNAIRE DE SATISFACTION', pageWidth / 2, 35, { align: 'center' })

  doc.setFontSize(12)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 100, 100)
  doc.text('Évaluation de la prestation de formation', pageWidth / 2, 42, { align: 'center' })

  doc.setDrawColor(31, 78, 121)
  doc.setLineWidth(0.5)
  doc.line(15, 48, pageWidth - 15, 48)

  // ══════════════════════════════════════════════════════════════
  // INFORMATIONS SESSION  (y=56→97)
  // ══════════════════════════════════════════════════════════════

  let y = 56

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text('INFORMATIONS SUR LA FORMATION', 15, y)
  y += 8  // y=64

  // Cadre gris hauteur 30
  doc.setFillColor(245, 245, 245)
  doc.rect(15, y - 3, pageWidth - 30, 30, 'F')

  doc.setFontSize(9)

  doc.setFont('helvetica', 'bold')
  doc.text('Formation :', 20, y)
  doc.setFont('helvetica', 'normal')
  doc.text(session?.courses?.title || '', 50, y)
  y += 5  // y=69

  doc.setFont('helvetica', 'bold')
  doc.text('Référence :', 20, y)
  doc.setFont('helvetica', 'normal')
  doc.text(session?.reference || '', 50, y)
  y += 5  // y=74

  doc.setFont('helvetica', 'bold')
  doc.text('Dates :', 20, y)
  doc.setFont('helvetica', 'normal')
  const startDate = session?.start_date ? format(new Date(session.start_date), 'dd/MM/yyyy', { locale: fr }) : ''
  const endDate = session?.end_date ? format(new Date(session.end_date), 'dd/MM/yyyy', { locale: fr }) : ''
  const dateText = startDate === endDate ? startDate : `${startDate} au ${endDate}`
  doc.text(dateText, 50, y)
  y += 5  // y=79

  doc.setFont('helvetica', 'bold')
  doc.text('Entreprise :', 20, y)
  doc.setFont('helvetica', 'normal')
  doc.text(client?.name || session?.clients?.name || '', 50, y)
  y += 5  // y=84

  doc.setFont('helvetica', 'bold')
  doc.text('Formateur :', 20, y)
  doc.setFont('helvetica', 'normal')
  const trainerName = session?.trainers ? `${session.trainers.first_name} ${session.trainers.last_name}` : ''
  doc.text(trainerName, 50, y)
  y += 8  // y=92

  // ══════════════════════════════════════════════════════════════
  // INTRODUCTION  (y=92→111)
  // ══════════════════════════════════════════════════════════════

  doc.setFontSize(9)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(80, 80, 80)
  const introText = "Votre avis est précieux pour nous permettre d'améliorer continuellement la qualité de nos prestations. Nous vous remercions de prendre quelques minutes pour compléter ce questionnaire."
  const splitIntro = doc.splitTextToSize(introText, pageWidth - 30)
  doc.text(splitIntro, 15, y)
  y += splitIntro.length * 4 + 6  // y≈111

  // ══════════════════════════════════════════════════════════════
  // QUESTIONS 1-4  (y=111→174)
  // ══════════════════════════════════════════════════════════════

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(0, 0, 0)
  doc.text('ÉVALUATION DE LA PRESTATION', 15, y)
  y += 5  // y=116

  const questions = [
    { text: "1. Organisation de la formation", subtitle: "(logistique, matériel, horaires)" },
    { text: "2. Qualité de l'intervenant", subtitle: "(pédagogie, expertise, disponibilité)" },
    { text: "3. Adéquation avec vos besoins", subtitle: "(pertinence du contenu, objectifs atteints)" },
    { text: "4. Gestion administrative", subtitle: "(documents, suivi, réactivité)" }
  ]

  doc.setFontSize(8)
  doc.setTextColor(100, 100, 100)
  doc.text('Échelle : 1 = Très insatisfait  •  2 = Insatisfait  •  3 = Neutre  •  4 = Satisfait  •  5 = Très satisfait', pageWidth / 2, y, { align: 'center' })
  y += 6  // y=122

  questions.forEach((q) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(0, 0, 0)
    doc.text(q.text, 15, y)
    y += 3

    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(100, 100, 100)
    doc.text(q.subtitle, 15, y)
    y += 2

    const startX = 15
    const boxSize = 5
    const spacing = 35
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(0, 0, 0)
    for (let i = 1; i <= 5; i++) {
      const x = startX + (i - 1) * spacing
      doc.setDrawColor(100, 100, 100)
      doc.setLineWidth(0.3)
      doc.rect(x, y, boxSize, boxSize)
      doc.text(i.toString(), x + boxSize + 2, y + 3.5)
    }
    y += 8  // par question : 3+2+8=13 → 4×13=52 → y=174
  })

  // ══════════════════════════════════════════════════════════════
  // QUESTION 5 OUI/NON  (y=174→194)
  // ══════════════════════════════════════════════════════════════

  y += 3  // y=177

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(0, 0, 0)
  doc.text("5. Recommanderiez-vous nos services à d'autres entreprises ?", 15, y)
  y += 6  // y=183

  const boxSize = 5
  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.3)
  doc.rect(15, y, boxSize, boxSize)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Oui', 22, y + 3.5)
  doc.rect(50, y, boxSize, boxSize)
  doc.text('Non', 57, y + 3.5)
  y += 11  // y=194

  // ══════════════════════════════════════════════════════════════
  // COMMENTAIRES  (y=194→233)
  // ══════════════════════════════════════════════════════════════

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(0, 0, 0)
  doc.text('6. Commentaires et suggestions', 15, y)
  y += 2  // y=196

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(100, 100, 100)
  doc.text("(points forts, axes d'amélioration, besoins futurs...)", 15, y)
  y += 4  // y=200

  const commentBoxHeight = 25
  doc.setDrawColor(150, 150, 150)
  doc.setLineWidth(0.3)
  doc.rect(15, y, pageWidth - 30, commentBoxHeight)

  doc.setDrawColor(220, 220, 220)
  doc.setLineWidth(0.1)
  for (let i = 1; i <= 4; i++) {
    const lineY = y + (i * 5.5)
    if (lineY < y + commentBoxHeight - 2) {
      doc.line(17, lineY, pageWidth - 17, lineY)
    }
  }
  y += commentBoxHeight + 8  // y=233

  // ══════════════════════════════════════════════════════════════
  // SIGNATURE  (y=233→275 — dans pageHeight=297)
  // ══════════════════════════════════════════════════════════════

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(0, 0, 0)

  // Date (gauche) + Nom répondant (droite) — même ligne
  doc.text('Date :', 15, y)
  doc.setFont('helvetica', 'normal')
  doc.setDrawColor(150, 150, 150)
  doc.setLineWidth(0.3)
  doc.line(28, y, 90, y)

  const rightColX = pageWidth / 2 + 10
  doc.setFont('helvetica', 'bold')
  doc.text('Nom et fonction du répondant :', rightColX, y)
  doc.setFont('helvetica', 'normal')
  doc.line(rightColX, y + 8, pageWidth - 15, y + 8)

  y += 18  // y=251

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('Signature :', 15, y)

  doc.setDrawColor(150, 150, 150)
  doc.rect(15, y + 2, pageWidth - 30, 22)  // fin à y=275

  // ══════════════════════════════════════════════════════════════
  // PIED DE PAGE
  // ══════════════════════════════════════════════════════════════

  doc.setFontSize(7)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(150, 150, 150)
  doc.text('Merci de nous retourner ce questionnaire complété par email ou courrier.', pageWidth / 2, pageHeight - 15, { align: 'center' })
  doc.text('Access Formation - organisme de formation professionnelle', pageWidth / 2, pageHeight - 10, { align: 'center' })

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

  return {
    filename: `Questionnaire_Satisfaction_${session?.reference || 'formation'}.pdf`,
    base64,
    size: base64.length
  }
}

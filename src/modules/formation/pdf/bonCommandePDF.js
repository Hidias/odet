// Bon de commande de sous-traitance (lot 2, 0045) : l'organisme commande une prestation de formation à un
// prestataire. Mise en page commune (core/pdf/layout.js), identité de l'organisme depuis loadPdfOrg().
// Contenu : parties, objet et session, période, jours, prix, conditions (justificatifs, conformité au référentiel
// national qualité, indicateur 27), signatures des deux parties.

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { startDocument, formatMoney } from '../../../core/pdf/layout'

const fr = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('fr-FR') : '')

/**
 * @param {object} ORG identité (loadPdfOrg)
 * @param {object} p { order, subcontractor, session }
 * @returns jsPDF
 */
export function buildBonCommandePDF(ORG, { order = {}, subcontractor = {}, session = null } = {}) {
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, {
    ref: order.reference || null, docLabel: 'Bon de commande', code: 'BC-ST',
    title: 'Bon de commande de prestation de formation', subtitle: order.order_date ? `Émis le ${fr(order.order_date)}` : null,
  })

  const st = subcontractor || {}
  f.cards([
    { label: 'Donneur d\'ordres', lines: [ORG.nameFull || ORG.name, ORG.address, [ORG.siret ? `SIRET ${ORG.siret}` : '', ORG.nda ? `NDA ${ORG.nda}` : ''].filter(Boolean).join('  ·  ')] },
    { label: 'Prestataire', lines: [st.name, [st.address, [st.postal_code, st.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      [st.siret ? `SIRET ${st.siret}` : (st.siren ? `SIREN ${st.siren}` : ''), st.nda ? `NDA ${st.nda}` : ''].filter(Boolean).join('  ·  ')] },
  ])

  f.section('Prestation commandée')
  const periode = order.start_date
    ? (order.end_date && order.end_date !== order.start_date ? `Du ${fr(order.start_date)} au ${fr(order.end_date)}` : `Le ${fr(order.start_date)}`)
    : 'À convenir'
  const lieu = session ? [session.location_name, session.location_city].filter(Boolean).join(', ') : ''
  f.kv([
    ['Objet', order.object || session?.courses?.title || 'Prestation de formation'],
    ...(session?.reference ? [['Session', session.reference]] : []),
    ['Période', periode],
    ...(lieu ? [['Lieu', lieu]] : []),
    ...(st.contact_name ? [['Intervenant', st.contact_name]] : []),
  ], { labelW: 30 })

  f.section('Prix')
  const days = Number(order.days || 0)
  const rate = Number(order.daily_rate || 0)
  const amount = Number(order.amount_ht ?? days * rate)
  f.table(['Désignation', 'Jours', 'Prix par jour HT', 'Montant HT'],
    [[order.object || session?.courses?.title || 'Prestation de formation', days ? String(days).replace('.', ',') : '', rate ? formatMoney(rate) : '', formatMoney(amount)]],
    { columnStyles: { 1: { halign: 'right', cellWidth: 18 }, 2: { halign: 'right', cellWidth: 34 }, 3: { halign: 'right', cellWidth: 34 } } })
  f.note('Montant hors taxes. TVA selon le régime du prestataire ; une prestation de formation professionnelle continue peut en être exonérée (CGI, article 261-4-4° a).')

  f.section('Conditions')
  f.bullets([
    'Le prestataire réalise la prestation conformément au programme transmis et au référentiel national qualité (Qualiopi, indicateur 27) ; il signale toute difficulté sans délai.',
    'Il remet les pièces de suivi de la session (émargements par demi-journée, évaluations) à la fin de la prestation.',
    'Il tient à jour ses justificatifs : attestation de vigilance URSSAF tous les six mois pour une commande d\'au moins 5 000 € HT (code du travail, D8222-5 et R8222-1), assurance de responsabilité civile professionnelle, déclaration d\'activité.',
    'Facture à adresser à la fin de la prestation, en rappelant la référence de ce bon de commande.',
  ])
  if (order.notes) f.para(order.notes, { size: 8.5 })

  f.space(4)
  f.signatures([
    { label: 'Pour le donneur d\'ordres', name: [ORG.dirigeant, ORG.dirigeant_title].filter(Boolean).join(', '), image: ORG.dirigeant_signature_base64 || null, hint: 'Date, signature et cachet' },
    { label: 'Pour le prestataire', name: st.contact_name || st.name || '', hint: 'Date, signature, « Bon pour accord »' },
  ])
  f.finish()
  return doc
}

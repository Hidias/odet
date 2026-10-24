import jsPDF from 'jspdf'
import { calcTotals } from '../lib/quoteTotals'
import { chargerRegimeTva, regimeTva, mentionsTvaDevis } from '../../../core/billing/regimeTva'
import { lienEspaceClient } from '../../../core/portail/lienEspace'
import { mentionFinancement } from '../lib/financementDevis'
import 'jspdf-autotable'
import { format } from 'date-fns'
import { buildORG, prepareOrgForPDF } from '../../../core/org/orgUtils'
import { renderCommercialDoc, itemRow, fmtEuro, fmtRate, issuerLines, recipientLines, companyLegalLine, bankRows } from './commercialLayout'
import { devisDeFormation } from '../lib/metierDevis'
import { mentionsDevis, chargerMentionsDevis, formulaireRetractation } from '../lib/mentionsDevis'
import { photosDuDevis } from '../lib/photosDevis'

// Devis et bon de commande partiel sur la mise en page commune des documents.
// Identité de l'organisme : uniquement depuis organization_settings (options.orgSettings).

function fmtDate(d) {
  if (!d) return ''
  return format(new Date(d), 'dd/MM/yyyy')
}

// Contact affiché sur le document : la personne connectée (options.contactPerson), sinon l'organisme
function contactFor(L, options) {
  const p = options && options.contactPerson
  if (p && p.name) return { name: p.name, phone: p.phone || L.phone, email: p.email || L.email }
  return { name: '', phone: L.phone, email: L.email }
}

async function orgFor(orgSettings) {
  const prepared = (await prepareOrgForPDF(orgSettings || {})) || orgSettings || {}
  return { ...prepared, ...buildORG(prepared) }
}

// Totaux : même calcul que l'écran du devis (quoteTotals) et que les factures ; lignes exonérées à 0 %
function totalsFor(quote, items, regime) {
  const rate = (quote.tva_rate === null || quote.tva_rate === undefined || quote.tva_rate === '') ? 20 : (parseFloat(quote.tva_rate) || 0)
  const tvaOn = quote.tva_applicable !== false && !regime.franchise
  const dp = parseFloat(quote.discount_percent) || 0
  const t = calcTotals(items, dp, rate, tvaOn)
  const rows = [{ label: 'Total HT', value: fmtEuro(t.subtotalHt) }]
  if (dp > 0) {
    rows.push({ label: (quote.discount_label || 'Remise') + ' (' + fmtRate(dp) + ')', value: '-' + fmtEuro(t.discountAmount), muted: true })
    rows.push({ label: 'Total net HT', value: fmtEuro(t.totalHt), bold: true })
  }
  const toutesExonerees = items.length > 0 && items.every((it) => it.vat_regime === 'exonere')
  if (!tvaOn) rows.push({ label: 'TVA', value: 'non applicable', muted: true })
  else if (toutesExonerees) rows.push({ label: 'TVA', value: 'exonérée', muted: true })
  else rows.push({ label: 'TVA ' + fmtRate(rate), value: fmtEuro(t.totalTva) })
  rows.push({ label: 'Total TTC', value: fmtEuro(t.totalTtc), grand: true })
  return rows
}

async function buildQuoteDoc(quote, items, client, contact, options, partial) {
  options = options || {}
  const L = await orgFor(options.orgSettings)
  const regime = regimeTva().charge ? regimeTva() : await chargerRegimeTva()
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const cb = contactFor(L, options)

  const payment = [
    ['Validité', quote.validity_date ? "jusqu'au " + fmtDate(quote.validity_date) : null],
    ['Mode', quote.payment_method || 'virement bancaire'],
    ['Délai', quote.payment_terms || 'à 30 jours'],
    ...bankRows(L),
  ].filter(r => r[1])

  // Mentions du devis : pénalités au taux BCE + 10 points (L441-10) et indemnité de 40 € seulement envers un
  // professionnel ; pas de mention d'exigibilité de la TVA sur un devis (elle dépend des lignes : biens ou services,
  // et de l'option sur les débits ; la facture la porte, calculée par la base) ; l'exonération de TVA de la formation
  // (261-4-4° du CGI) seulement pour un devis de formation
  const particulier = client && client.client_type === 'particulier'
  // Acheteur public (décision de H, 21/10) : intérêts moratoires du code de la commande publique (réglages de facturation)
  const publicClient = client && client.client_type === 'public'
  const penalitesPublic = [regime.mentions.penalitesPublic, regime.mentions.indemnitePublic].filter(Boolean).join(' ')
  const formation = devisDeFormation(quote, items)
  // Mentions selon le métier et le client (0444) : devis à distance, matériel, acompte, délai, éco-participation,
  // assurances et déchets des travaux, rétractation et garanties légales d'un particulier ; textes des réglages
  const md = options.mentionsDevis || await chargerMentionsDevis()
  const mm = mentionsDevis({ quote, items, client, textes: md.textes, pieces: md.pieces })
  const legal = [
    particulier ? null : publicClient && penalitesPublic ? penalitesPublic : "En cas de retard de paiement, des pénalités sont exigibles au taux de la Banque centrale européenne majoré de 10 points, ainsi qu'une indemnité forfaitaire de 40 € pour frais de recouvrement (art. L441-10 du Code de commerce).",
    ...(partial ? [] : mm.legal),
    // Mentions de TVA des réglages de l'organisme (franchise, exonération de la formation, autoliquidation)
    ...mentionsTvaDevis(items, quote, regime, formation),
    mentionFinancement(quote),
    companyLegalLine(L),
  ].filter(Boolean)

  // Devis à signer : encadré « Signer en ligne » si le client a un accès à son espace (pas sur un bon de commande
  // partiel ni sur un devis déjà signé ou accepté)
  const enLigne = !partial && options.enLigne !== false && !quote.signature_base64 && !['accepted', 'partial', 'refused', 'expired'].includes(quote.status)
    ? await lienEspaceClient(client?.id || quote.client_id) : null

  renderCommercialDoc(doc, L, {
    enLigne,
    formation,
    ref: partial ? quote.reference + '-P' : quote.reference,
    docLabel: partial ? 'Bon de commande' : 'Devis',
    code: partial ? 'BDC' : 'DEV',
    title: partial ? 'Bon de commande partiel' : 'Devis',
    subtitle: partial ? 'Lignes acceptées du devis ' + quote.reference + ' du ' + fmtDate(quote.quote_date) + ', montants recalculés sur ces seules lignes' : null,
    issuerLabel: 'Émetteur',
    issuerLines: issuerLines(L, cb),
    recipientLabel: 'Client',
    recipientLines: recipientLines(client, contact, true),
    meta: [
      ['N° de devis', quote.reference],
      ['Date', fmtDate(quote.quote_date)],
      ['Valable jusqu\'au', quote.validity_date ? fmtDate(quote.validity_date) : null],
      ['Réf. client', quote.client_reference || null],
    ],
    object: quote.object || null,
    rows: items.map((it) => itemRow(Number(it.eco_ht) > 0
      ? { ...it, description_detail: [it.description_detail, `Dont éco-participation : ${fmtEuro(it.eco_ht)} HT l'unité`].filter(Boolean).join('\n') }
      : it, { tvaOn: quote.tva_applicable !== false && !regime.franchise, taux: (quote.tva_rate === null || quote.tva_rate === undefined || quote.tva_rate === '') ? 20 : (parseFloat(quote.tva_rate) || 0) })),
    totals: totalsFor(quote, items, regime),
    notes: quote.notes || null,
    signature: {
      label: 'Bon pour accord du client',
      // Près de la signature : acceptation des conditions générales jointes (0444), attestation du taux réduit
      hint: [...mm.signature, 'Nom, fonction, date, signature, cachet et mention « Lu et approuvé, bon pour accord »'].join(' '),
      image: quote.signature_base64 || null,
    },
    payment,
    legal,
    // Photos des lignes cochées « dans le PDF » (0445)
    photos: options.photos || (typeof document !== 'undefined' ? await photosDuDevis(items) : []),
  })
  // Particulier, contrat conclu hors établissement ou à distance : formulaire type de rétractation joint (0444)
  if (!partial && particulier && quote.hors_etablissement) {
    doc.addPage()
    const M = 18
    doc.setFont(undefined, 'bold'); doc.setFontSize(13)
    doc.text('Formulaire de rétractation', M, 24)
    doc.setFont(undefined, 'normal'); doc.setFontSize(9)
    doc.text(`Devis ${quote.reference || ''} du ${fmtDate(quote.quote_date)}`, M, 31)
    let y = 42
    doc.setFontSize(10)
    formulaireRetractation(L).forEach((l) => {
      const lines = doc.splitTextToSize(l, 174)
      doc.text(lines, M, y)
      y += lines.length * 5 + (/:$/.test(l) ? 12 : 4)
    })
  }
  return doc
}

// ============================================================
// DEVIS
// ============================================================
export async function generateQuotePDF(quote, items, client, contact, options) {
  options = options || {}
  const doc = await buildQuoteDoc(quote, items || [], client, contact || null, options, false)
  if (!options.skipSave) doc.save(quote.reference + '.pdf')
  return doc
}

// ============================================================
// ACCEPTATION PARTIELLE - BON DE COMMANDE
// ============================================================
export async function generatePartialAcceptancePDF(quote, allItems, client, contact, options) {
  options = options || {}
  const acceptedItems = (allItems || []).filter(it => it.accepted === true)
  if (acceptedItems.length === 0) {
    throw new Error('Aucune ligne acceptée dans ce devis')
  }
  const doc = await buildQuoteDoc(quote, acceptedItems, client, contact || null, options, true)
  if (!options.skipSave) doc.save(quote.reference + '-PARTIEL.pdf')
  return doc
}

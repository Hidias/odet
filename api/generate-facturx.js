// api/generate-facturx.js
// Factur-X, profil EN 16931 : PDF/A-3b avec XML CII embarqué (factur-x.xml).
// L'identité du vendeur vient uniquement de organization_settings (getOrg).
// Si un champ obligatoire manque, la route répond 422 avec la liste des champs à compléter.
// Usage : POST { invoice_id, pdf_base64 }

import { PDFDocument, PDFName, PDFString, PDFNumber, AFRelationship } from 'pdf-lib'
import { getSupabaseAdmin, getOrg } from './_lib/mailer.js'
import { requireRight, BILLING } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'
import { computeDocumentTotals } from '../src/core/billing/totals.js'

export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
  maxDuration: 30,
}

// --- Erreur de configuration (paramètres de l'organisme incomplets) ----------

export class FacturXConfigError extends Error {
  constructor(message, missing) {
    super(message)
    this.name = 'FacturXConfigError'
    this.missing = missing || []
  }
}

// --- Helpers ----------------------------------------------------------------

function ciiDate(d) {
  if (!d) return ''
  const s = String(d)
  // Date SQL (AAAA-MM-JJ) : lue telle quelle, sans passage par le fuseau horaire
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return m[1] + m[2] + m[3]
  const dt = new Date(s)
  return dt.getFullYear().toString() + String(dt.getMonth() + 1).padStart(2, '0') + String(dt.getDate()).padStart(2, '0')
}
function round2(v) { return Math.round((Number(v) + Number.EPSILON) * 100) / 100 }
function amt(v) { return round2(v).toFixed(2) }
function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
function digits(s) { return String(s || '').replace(/\D/g, '') }
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
function rateStr(r) { return String(round2(r)) }
function unitCode(u) {
  const m = { jour: 'DAY', 'jour(s)': 'DAY', jours: 'DAY', heure: 'HUR', 'heure(s)': 'HUR', heures: 'HUR', h: 'HUR', mois: 'MON',
    forfait: 'C62', unite: 'C62', 'unité': 'C62', pers: 'C62', personne: 'C62', stagiaire: 'C62' }
  return m[String(u || '').trim().toLowerCase()] || 'C62'
}

function ibanIsValid(iban) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const moved = iban.slice(4) + iban.slice(0, 4)
  let rest = 0
  for (const ch of moved) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of v) rest = (rest * 10 + Number(d)) % 97
  }
  return rest === 1
}

// Moyen de paiement (BT-81) d'après le libellé saisi sur la facture.
// Un libellé combiné (« chèque, virement bancaire ») retient le virement.
function paymentMeansCode(label) {
  const s = String(label || '').toLowerCase()
  if (!s || s.includes('virement')) return 30
  if (s.includes('prélèvement') || s.includes('prelevement')) return 49
  if (s.includes('carte')) return 48
  if (s.includes('chèque') || s.includes('cheque')) return 20
  if (s.includes('espèces') || s.includes('especes')) return 10
  return 30
}

// --- Vendeur : lu dans organization_settings, contrôlé --------------------------

/**
 * Construit le vendeur à partir de getOrg(). Lève FacturXConfigError si un champ obligatoire manque.
 * Obligatoires : raison sociale, SIREN (ou SIRET), adresse, code postal, ville, numéro de TVA intracommunautaire,
 * IBAN si la facture est payable par virement. BIC facultatif, contrôlé s'il est saisi.
 */
export function buildSeller(org, { needsIban }) {
  const o = org || {}
  const missing = []
  const legalName = String(o.legal_name || o.name || '').trim()
  const tradingName = String(o.name || '').trim()
  const siren = digits(o.siren).length === 9 ? digits(o.siren) : digits(o.siret).slice(0, 9)
  const address = String(o.address || '').trim()
  const postalCode = String(o.postal_code || '').trim()
  const city = String(o.city || '').trim()
  const vat = String(o.tva_intra || '').replace(/\s/g, '').toUpperCase()
  const iban = String(o.iban || '').replace(/\s/g, '').toUpperCase()
  const bic = String(o.bic || '').replace(/\s/g, '').toUpperCase()

  if (!legalName) missing.push('raison sociale (Identité)')
  if (siren.length !== 9) missing.push('SIRET ou SIREN (Identité)')
  if (!address) missing.push('adresse du siège (Coordonnées et signataire)')
  if (!postalCode) missing.push('code postal du siège (Coordonnées et signataire)')
  if (!city) missing.push('ville du siège (Coordonnées et signataire)')
  if (!vat) missing.push('numéro de TVA intracommunautaire (Identité)')
  if (needsIban && !iban) missing.push('IBAN, obligatoire pour une facture payable par virement (Banque et facturation)')

  if (missing.length) {
    throw new FacturXConfigError(
      'Paramètres incomplets pour la facture électronique : ' + missing.join(' ; ') + '. À compléter dans Paramètres.',
      missing,
    )
  }
  const invalid = []
  if (!/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(vat)) invalid.push(`numéro de TVA « ${vat} »`)
  if (iban && !ibanIsValid(iban)) invalid.push('IBAN (clé de contrôle incorrecte)')
  if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) invalid.push(`BIC « ${bic} » (8 ou 11 caractères)`)
  if (invalid.length) {
    throw new FacturXConfigError('Paramètres invalides pour la facture électronique : ' + invalid.join(' ; ') + '. À corriger dans Paramètres.', invalid)
  }

  return {
    legalName,
    tradingName: tradingName && tradingName !== legalName ? tradingName : '',
    siren,
    address,
    postalCode,
    city,
    vat,
    iban,
    bic,
    softwareName: String(o.app_name || o.name || legalName).trim(),
    // Mentions légales du vendeur (BT-33) : forme, capital, RCS
    legalInfo: [legalName + (o.forme_juridique ? ', ' + String(o.forme_juridique).trim() : '') + (o.capital_social ? ' au capital de ' + String(o.capital_social).trim() + ' €' : ''),
      String(o.rcs || '').trim()].filter(Boolean).join(', '),
    // Organisme exonéré par défaut (franchise) : tva_applicable = false dans les paramètres
    orgVatApplicable: o.tva_applicable !== false,
  }
}

// --- Calculs (arrondis à 2 décimales, règles BR-CO-10 à BR-CO-16 et BR-S-08) ----

export function computeTotals(invoice, items, vatApplicable) {
  // Calcul unique partagé avec l'écran et le PDF (src/core/billing/totals.js)
  const t = computeDocumentTotals(items, { discountPercent: invoice.discount_percent, vatApplicable })
  const prepaid = round2(num(invoice.amount_paid))
  const due = round2(t.grandTotal - prepaid)
  return { ...t, prepaid, due }
}

// --- XML CII (profil EN 16931) --------------------------------------------------
// L'ordre des éléments suit le schéma XSD Factur-X (CII D16B).

export function generateCIIXML(invoice, items, client, seller) {
  const isCredit = invoice.type === 'credit_note'
  const vatApplicable = invoice.tva_applicable !== false && seller.orgVatApplicable
  const t = computeTotals(invoice, items, vatApplicable)

  // Motifs d'exonération (BT-120 / BT-121) par catégorie : franchise du vendeur, ligne exonérée (formation),
  // autoliquidation (AE). Texte repris des mentions figées à l'émission quand il y en a une.
  const mentions = Array.isArray(invoice.legal_mentions) ? invoice.legal_mentions.map(String) : []
  const mention = (re, defaut) => mentions.find((m) => re.test(m)) || defaut
  const exemptionFor = (g) => {
    if (g.cat === 'AE') return { code: 'VATEX-EU-AE', reason: mention(/autoliquidation/i, 'Autoliquidation') }
    if (g.cat !== 'E') return null
    if (!seller.orgVatApplicable) return { code: 'VATEX-FR-FRANCHISE', reason: mention(/293 ?B/i, 'TVA non applicable, article 293 B du CGI') }
    if (g.exonere || (!vatApplicable && invoice.is_formation_pro !== false)) {
      return { code: 'VATEX-EU-132-1I', reason: mention(/exon[ée]ration/i, 'Exonération de TVA, article 261-4-4° a du CGI (formation professionnelle continue)') }
    }
    return { code: '', reason: 'Exonération de TVA' }
  }

  // Cadre de facturation (BT-23) : biens, services ou mixte (spécifications externes DGFiP, annexe 7)
  const nature = invoice.nature_operation || (() => {
    const b = t.lines.some((l) => l.it.nature === 'bien'); const sv = t.lines.some((l) => l.it.nature !== 'bien')
    return b && sv ? 'mixte' : b ? 'biens' : 'services'
  })()
  // Facture de solde après acomptes (0368) : cadre 4 (B4, S4, M4)
  const cadre = invoice.invoice_kind === 'solde' ? ({ biens: 'B4', mixte: 'M4' }[nature] || 'S4') : ({ biens: 'B1', mixte: 'M1' }[nature] || 'S1')
  // Exigibilité de la TVA (BT-8) : débits (date de facture), biens (livraison), services (encaissement)
  const dueDateCode = mentions.some((m) => /d[ée]bits/i.test(m)) ? '5' : nature === 'biens' ? '29' : '72'

  const linesXml = t.lines.map((l, idx) => {
    const name = String(l.it.description_title || '').trim() || String(l.it.code || '').trim() || 'Prestation'
    const detail = String(l.it.description_detail || '').trim()
    const sellerId = String(l.it.code || '').trim()
    // Prix net jamais négatif (BR-27) : une ligne de remise ou de reprise d'acompte passe en quantité négative
    const negatif = Number(l.pu) < 0
    const pu = negatif ? -Number(l.pu) : l.pu
    const q = negatif ? -Number(l.q) : l.q
    return `    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${idx + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>${sellerId ? `
        <ram:SellerAssignedID>${esc(sellerId)}</ram:SellerAssignedID>` : ''}
        <ram:Name>${esc(name)}</ram:Name>${detail ? `
        <ram:Description>${esc(detail)}</ram:Description>` : ''}
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>${amt(pu)}</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${unitCode(l.it.unit)}">${amt(q)}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${l.cat}</ram:CategoryCode>
          <ram:RateApplicablePercent>${rateStr(l.rate)}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${amt(l.net)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`
  }).join('\n')

  // Notes d'en-tête (BG-1) : notes libres, mentions légales figées avec leur code (AAB escompte, PMD pénalités,
  // PMT indemnité de recouvrement), mentions légales du vendeur (REG, BT-33)
  const notes = []
  if (invoice.notes && String(invoice.notes).trim()) notes.push({ text: String(invoice.notes).trim(), code: 'AAI' })
  for (const m of mentions) {
    const code = /escompte/i.test(m) ? 'AAB' : /p[ée]nalit/i.test(m) ? 'PMD' : /indemnit/i.test(m) ? 'PMT' : 'AAI'
    notes.push({ text: m, code })
  }
  if (seller.legalInfo) notes.push({ text: seller.legalInfo, code: 'REG' })
  const notesXml = notes.map((n) => `    <ram:IncludedNote><ram:Content>${esc(n.text)}</ram:Content><ram:SubjectCode>${n.code}</ram:SubjectCode></ram:IncludedNote>`).join('\n')

  // Vendeur (BG-4)
  const sellerXml = `      <ram:SellerTradeParty>
        <ram:Name>${esc(seller.legalName)}</ram:Name>
        <ram:SpecifiedLegalOrganization>
          <ram:ID schemeID="0002">${seller.siren}</ram:ID>${seller.tradingName ? `
          <ram:TradingBusinessName>${esc(seller.tradingName)}</ram:TradingBusinessName>` : ''}
        </ram:SpecifiedLegalOrganization>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${esc(seller.postalCode)}</ram:PostcodeCode>
          <ram:LineOne>${esc(seller.address)}</ram:LineOne>
          <ram:CityName>${esc(seller.city)}</ram:CityName>
          <ram:CountryID>FR</ram:CountryID>
        </ram:PostalTradeAddress>
        <ram:URIUniversalCommunication><ram:URIID schemeID="0225">${seller.siren}</ram:URIID></ram:URIUniversalCommunication>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(seller.vat)}</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>`

  // Acheteur (BG-7) : SIREN (schéma 0002), SIRET (0009) pour un client public (Chorus Pro), adresse électronique (BT-49)
  const buyerSiren = digits(client.siren).length === 9 ? digits(client.siren) : (digits(client.siret).length >= 9 ? digits(client.siret).slice(0, 9) : '')
  const buyerSiret = digits(client.siret).length === 14 ? digits(client.siret) : ''
  const buyerPublic = client.client_type === 'public' && buyerSiret
  const buyerLegal = buyerPublic ? `<ram:ID schemeID="0009">${buyerSiret}</ram:ID>` : buyerSiren ? `<ram:ID schemeID="0002">${buyerSiren}</ram:ID>` : ''
  const buyerVat = String(client.tva || '').replace(/\s/g, '').toUpperCase()
  const buyerXml = `      <ram:BuyerTradeParty>
        <ram:Name>${esc(client.name || '')}</ram:Name>${buyerLegal ? `
        <ram:SpecifiedLegalOrganization>${buyerLegal}</ram:SpecifiedLegalOrganization>` : ''}
        <ram:PostalTradeAddress>${client.postal_code ? `
          <ram:PostcodeCode>${esc(client.postal_code)}</ram:PostcodeCode>` : ''}${client.address && String(client.address).trim() ? `
          <ram:LineOne>${esc(String(client.address).trim())}</ram:LineOne>` : ''}${client.city ? `
          <ram:CityName>${esc(String(client.city).toUpperCase())}</ram:CityName>` : ''}
          <ram:CountryID>FR</ram:CountryID>
        </ram:PostalTradeAddress>${buyerSiren && client.client_type !== 'particulier' ? `
        <ram:URIUniversalCommunication><ram:URIID schemeID="0225">${buyerSiren}</ram:URIID></ram:URIUniversalCommunication>` : ''}${buyerVat ? `
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(buyerVat)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:BuyerTradeParty>`

  // Chorus Pro : code service (BT-10) ; numéro d'engagement ou bon de commande (BT-13)
  const buyerRef = String(invoice.chorus_service_code || '').trim()
  const buyerRefXml = buyerRef ? `      <ram:BuyerReference>${esc(buyerRef)}</ram:BuyerReference>` : ''
  const orderRef = String(invoice.chorus_engagement || '').trim() || String(invoice.client_reference || '').trim()
  const buyerOrderXml = orderRef
    ? `      <ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>${esc(orderRef)}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>`
    : ''

  // Livraison : date de fin de la prestation (BT-72)
  const deliveryDate = invoice.service_end_date || invoice.service_start_date
  const deliveryXml = deliveryDate
    ? `    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${ciiDate(deliveryDate)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>`
    : '    <ram:ApplicableHeaderTradeDelivery/>'

  // Moyen de paiement (BG-16) : IBAN (BT-84) et BIC (BT-86) pour un virement
  const pmCode = paymentMeansCode(invoice.payment_method)
  const transfer = pmCode === 30
  const paymentMeansXml = `      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>${pmCode}</ram:TypeCode>${transfer && seller.iban ? `
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${seller.iban}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>` : ''}${transfer && seller.iban && seller.bic ? `
        <ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${seller.bic}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}
      </ram:SpecifiedTradeSettlementPaymentMeans>`

  // Ventilation de TVA (BG-23)
  const taxXml = t.breakdown.map((g) => {
    const ex = exemptionFor(g)
    return `      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${amt(g.tax)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>${ex ? `
        <ram:ExemptionReason>${esc(ex.reason)}</ram:ExemptionReason>` : ''}
        <ram:BasisAmount>${amt(g.base)}</ram:BasisAmount>
        <ram:CategoryCode>${g.cat}</ram:CategoryCode>${ex && ex.code ? `
        <ram:ExemptionReasonCode>${ex.code}</ram:ExemptionReasonCode>` : ''}${g.cat === 'S' ? `
        <ram:DueDateTypeCode>${dueDateCode}</ram:DueDateTypeCode>` : ''}
        <ram:RateApplicablePercent>${rateStr(g.rate)}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`
  }).join('\n')

  // Période de facturation (BG-14)
  const periodXml = invoice.service_start_date && invoice.service_end_date && invoice.service_end_date !== invoice.service_start_date
    ? `      <ram:BillingSpecifiedPeriod>
        <ram:StartDateTime><udt:DateTimeString format="102">${ciiDate(invoice.service_start_date)}</udt:DateTimeString></ram:StartDateTime>
        <ram:EndDateTime><udt:DateTimeString format="102">${ciiDate(invoice.service_end_date)}</udt:DateTimeString></ram:EndDateTime>
      </ram:BillingSpecifiedPeriod>`
    : ''

  // Remise globale (BG-20) : une ligne par catégorie et taux de TVA
  const allowanceXml = t.dp > 0
    ? t.breakdown.filter((g) => g.allowance > 0).map((g) => `      <ram:SpecifiedTradeAllowanceCharge>
        <ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator>
        <ram:CalculationPercent>${rateStr(t.dp)}</ram:CalculationPercent>
        <ram:BasisAmount>${amt(g.lines)}</ram:BasisAmount>
        <ram:ActualAmount>${amt(g.allowance)}</ram:ActualAmount>
        <ram:Reason>${esc(String(invoice.discount_label || '').trim() || 'Remise')}</ram:Reason>
        <ram:CategoryTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${g.cat}</ram:CategoryCode>
          <ram:RateApplicablePercent>${rateStr(g.rate)}</ram:RateApplicablePercent>
        </ram:CategoryTradeTax>
      </ram:SpecifiedTradeAllowanceCharge>`).join('\n')
    : ''

  // Conditions de paiement (BT-20) et échéance (BT-9)
  const terms = String(invoice.payment_terms || '').trim()
  const termsXml = terms || invoice.due_date
    ? `      <ram:SpecifiedTradePaymentTerms>${terms ? `
        <ram:Description>${esc(terms)}</ram:Description>` : ''}${invoice.due_date ? `
        <ram:DueDateDateTime><udt:DateTimeString format="102">${ciiDate(invoice.due_date)}</udt:DateTimeString></ram:DueDateDateTime>` : ''}
      </ram:SpecifiedTradePaymentTerms>`
    : ''

  const summationXml = `      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amt(t.lineTotal)}</ram:LineTotalAmount>${t.allowanceTotal > 0 ? `
        <ram:AllowanceTotalAmount>${amt(t.allowanceTotal)}</ram:AllowanceTotalAmount>` : ''}
        <ram:TaxBasisTotalAmount>${amt(t.taxBasis)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${amt(t.taxTotal)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amt(t.grandTotal)}</ram:GrandTotalAmount>${t.prepaid > 0 ? `
        <ram:TotalPrepaidAmount>${amt(t.prepaid)}</ram:TotalPrepaidAmount>` : ''}
        <ram:DuePayableAmount>${amt(t.due)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>`

  // Factures citées (BG-3, BT-25 et BT-26) : facture d'origine d'un avoir, factures d'acompte déduites d'un solde
  const refDoc = (ref, date) => `      <ram:InvoiceReferencedDocument>
        <ram:IssuerAssignedID>${esc(ref)}</ram:IssuerAssignedID>${date ? `
        <ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${ciiDate(date)}</qdt:DateTimeString></ram:FormattedIssueDateTime>` : ''}
      </ram:InvoiceReferencedDocument>`
  const precedingXml = isCredit && invoice.parent_reference
    ? refDoc(invoice.parent_reference, invoice.parent_invoice_date)
    : (Array.isArray(invoice.deposit_refs) ? invoice.deposit_refs.map((d) => refDoc(d.reference, d.invoice_date)).join('\n') : '')

  const join = (parts) => parts.filter(Boolean).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${cadre}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
${join([
  `    <ram:ID>${esc(invoice.reference)}</ram:ID>`,
  `    <ram:TypeCode>${isCredit ? '381' : invoice.invoice_kind === 'acompte' ? '386' : '380'}</ram:TypeCode>`,
  `    <ram:IssueDateTime><udt:DateTimeString format="102">${ciiDate(invoice.invoice_date)}</udt:DateTimeString></ram:IssueDateTime>`,
  notesXml,
])}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${linesXml}
    <ram:ApplicableHeaderTradeAgreement>
${join([buyerRefXml, sellerXml, buyerXml, buyerOrderXml])}
    </ram:ApplicableHeaderTradeAgreement>
${deliveryXml}
    <ram:ApplicableHeaderTradeSettlement>
${join([
  `      <ram:PaymentReference>${esc(invoice.reference)}</ram:PaymentReference>`,
  '      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>',
  paymentMeansXml,
  taxXml,
  periodXml,
  allowanceXml,
  termsXml,
  summationXml,
  precedingXml,
])}
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`
}

// --- Profil ICC sRGB minimal (ICC v2) ---------------------------------------
// Périphérique d'affichage, RGB, PCS XYZ, primaires sRGB BT.709, gamma 2.2

function buildMinimalSRGBICC() {
  function w4(buf, off, v) { buf.writeUInt32BE(v >>> 0, off) }
  function ws(buf, off, s) { buf.write(s, off, 'ascii') }
  function w2(buf, off, v) { buf.writeUInt16BE(v & 0xFFFF, off) }
  function s15f16(v) { return Math.round(v * 65536) }

  function xyzType(X, Y, Z) {
    const b = Buffer.alloc(20)
    ws(b, 0, 'XYZ '); w4(b, 4, 0)
    w4(b, 8, s15f16(X)); w4(b, 12, s15f16(Y)); w4(b, 16, s15f16(Z))
    return b
  }
  function curveType(gamma) {
    const b = Buffer.alloc(14)
    ws(b, 0, 'curv'); w4(b, 4, 0); w4(b, 8, 1)
    w2(b, 12, Math.round(gamma * 256))
    return b
  }
  function textType(txt) {
    const tb = Buffer.from(txt + '\0', 'ascii')
    const b = Buffer.alloc(8 + tb.length)
    ws(b, 0, 'text'); w4(b, 4, 0); tb.copy(b, 8)
    return b
  }
  function descType(ascii) {
    const ab = Buffer.from(ascii + '\0', 'ascii')
    const b = Buffer.alloc(8 + 4 + ab.length + 4 + 2 + 4 + 2 + 1 + 67, 0)
    ws(b, 0, 'desc'); w4(b, 4, 0); w4(b, 8, ab.length)
    ab.copy(b, 12)
    return b
  }

  const tagDefs = [
    { sig: 'wtpt', data: xyzType(0.96420, 1.00000, 0.82491) },
    { sig: 'rXYZ', data: xyzType(0.43607, 0.22249, 0.01392) },
    { sig: 'gXYZ', data: xyzType(0.38515, 0.71687, 0.09708) },
    { sig: 'bXYZ', data: xyzType(0.14307, 0.06061, 0.71393) },
    { sig: 'rTRC', data: curveType(2.2) },
    { sig: 'gTRC', data: curveType(2.2) },
    { sig: 'bTRC', data: curveType(2.2) },
    { sig: 'desc', data: descType('sRGB IEC61966-2.1') },
    { sig: 'cprt', data: textType('Public Domain') },
  ]

  const headerSize = 128
  const tagTableSize = 4 + tagDefs.length * 12
  let dataOff = headerSize + tagTableSize
  const tagDataParts = tagDefs.map((t) => {
    const off = dataOff
    const padded = Math.ceil(t.data.length / 4) * 4
    dataOff += padded
    return { ...t, off, padded }
  })
  const totalSize = dataOff

  const p = Buffer.alloc(totalSize, 0)
  w4(p, 0, totalSize)
  w4(p, 8, 0x02100000)
  ws(p, 12, 'mntr')
  ws(p, 16, 'RGB ')
  ws(p, 20, 'XYZ ')
  w2(p, 24, 2024); w2(p, 26, 1); w2(p, 28, 1)
  ws(p, 36, 'acsp')
  w4(p, 64, 0)
  w4(p, 68, s15f16(0.96420))
  w4(p, 72, s15f16(1.00000))
  w4(p, 76, s15f16(0.82491))

  w4(p, 128, tagDefs.length)
  let te = 132
  tagDataParts.forEach((t) => {
    ws(p, te, t.sig); w4(p, te + 4, t.off); w4(p, te + 8, t.data.length); te += 12
  })
  tagDataParts.forEach((t) => t.data.copy(p, t.off))
  return p
}

// --- Métadonnées XMP PDF/A-3b + extension Factur-X ----------------------------

function isoSeconds(d) { return new Date(Math.floor(d.getTime() / 1000) * 1000).toISOString().replace('.000Z', 'Z') }

export function buildXmpMetadata({ title, author, subject, tool, createDate, modifyDate, documentId, instanceId }) {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">

  <rdf:Description rdf:about=""
    xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>3</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>

  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(title)}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${esc(author)}</rdf:li></rdf:Seq></dc:creator>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(subject)}</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>

  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreateDate>${createDate}</xmp:CreateDate>
   <xmp:ModifyDate>${modifyDate}</xmp:ModifyDate>
   <xmp:CreatorTool>${esc(tool)}</xmp:CreatorTool>
  </rdf:Description>

  <rdf:Description rdf:about=""
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>${esc(tool)}</pdf:Producer>
  </rdf:Description>

  <rdf:Description rdf:about=""
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">
   <xmpMM:DocumentID>${esc(documentId)}</xmpMM:DocumentID>
   <xmpMM:InstanceID>${esc(instanceId)}</xmpMM:InstanceID>
  </rdf:Description>

  <rdf:Description rdf:about=""
    xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
    xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
    xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
   <pdfaExtension:schemas>
    <rdf:Bag>
     <rdf:li rdf:parseType="Resource">
      <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
      <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
      <pdfaSchema:prefix>fx</pdfaSchema:prefix>
      <pdfaSchema:property>
       <rdf:Seq>
        <rdf:li rdf:parseType="Resource">
         <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
         <pdfaProperty:valueType>Text</pdfaProperty:valueType>
         <pdfaProperty:category>external</pdfaProperty:category>
         <pdfaProperty:description>name of the embedded XML invoice file</pdfaProperty:description>
        </rdf:li>
        <rdf:li rdf:parseType="Resource">
         <pdfaProperty:name>DocumentType</pdfaProperty:name>
         <pdfaProperty:valueType>Text</pdfaProperty:valueType>
         <pdfaProperty:category>external</pdfaProperty:category>
         <pdfaProperty:description>INVOICE</pdfaProperty:description>
        </rdf:li>
        <rdf:li rdf:parseType="Resource">
         <pdfaProperty:name>Version</pdfaProperty:name>
         <pdfaProperty:valueType>Text</pdfaProperty:valueType>
         <pdfaProperty:category>external</pdfaProperty:category>
         <pdfaProperty:description>The actual version of the Factur-X data</pdfaProperty:description>
        </rdf:li>
        <rdf:li rdf:parseType="Resource">
         <pdfaProperty:name>ConformanceLevel</pdfaProperty:name>
         <pdfaProperty:valueType>Text</pdfaProperty:valueType>
         <pdfaProperty:category>external</pdfaProperty:category>
         <pdfaProperty:description>The conformance level of the Factur-X data</pdfaProperty:description>
        </rdf:li>
       </rdf:Seq>
      </pdfaSchema:property>
     </rdf:li>
    </rdf:Bag>
   </pdfaExtension:schemas>
  </rdf:Description>

  <rdf:Description rdf:about=""
    xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
   <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
   <fx:DocumentType>INVOICE</fx:DocumentType>
   <fx:Version>1.0</fx:Version>
   <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
  </rdf:Description>

 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

// --- XML embarqué + conformité PDF/A-3b via pdf-lib ----------------------------

export async function embedAndMakePDFA3(pdfBuffer, xmlString, invoice, seller) {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true, updateMetadata: false })
  const label = invoice.type === 'credit_note' ? 'Avoir' : 'Facture'
  const title = `${label} ${invoice.reference}`
  const subject = `${title} - ${seller.legalName}`
  const now = new Date()
  const created = invoice.invoice_date ? new Date(`${String(invoice.invoice_date).slice(0, 10)}T12:00:00Z`) : now
  const createDate = isoSeconds(created)
  const modifyDate = isoSeconds(now)

  // 1. XML attaché (AFRelationship Data, NF Z55-300)
  const xmlBytes = new TextEncoder().encode(xmlString)
  await pdfDoc.attach(xmlBytes, 'factur-x.xml', {
    mimeType: 'text/xml',
    description: `${title} - Factur-X EN 16931`,
    creationDate: new Date(createDate),
    modificationDate: new Date(modifyDate),
    afRelationship: AFRelationship.Data,
  })

  // 1b. /Subtype du fichier embarqué : pdf-lib l'encode en PDFName, veraPDF attend text/xml
  try {
    const afArray = pdfDoc.catalog.get(PDFName.of('AF'))
    if (afArray) {
      const afList = afArray instanceof Array ? afArray : [afArray]
      for (const afRef of afList) {
        const af = pdfDoc.context.lookup(afRef) || afRef
        if (af && typeof af.get === 'function') {
          const efDict = af.get(PDFName.of('EF'))
          if (efDict) {
            const efResolved = pdfDoc.context.lookup(efDict) || efDict
            const fRef = efResolved && typeof efResolved.get === 'function' ? efResolved.get(PDFName.of('F')) : null
            if (fRef) {
              const embStream = pdfDoc.context.lookup(fRef) || fRef
              if (embStream && embStream.dict) embStream.dict.set(PDFName.of('Subtype'), PDFString.of('text/xml'))
            }
          }
        }
      }
    }
  } catch (_) {}

  // 2. Métadonnées XMP (identiques au dictionnaire Info, exigé par PDF/A)
  const safeRef = String(invoice.reference || 'facture').replace(/[^a-zA-Z0-9-]/g, '')
  const xmpString = buildXmpMetadata({
    title,
    author: seller.legalName,
    subject,
    tool: seller.softwareName,
    createDate,
    modifyDate,
    documentId: `urn:facture:${seller.siren}:${safeRef}`,
    instanceId: `urn:facture:${seller.siren}:${safeRef}:${now.getTime().toString(36)}`,
  })
  const xmpStream = pdfDoc.context.stream(new TextEncoder().encode(xmpString), {
    Type: PDFName.of('Metadata'),
    Subtype: PDFName.of('XML'),
  })
  pdfDoc.catalog.set(PDFName.of('Metadata'), pdfDoc.context.register(xmpStream))

  // 3. OutputIntent sRGB (requis PDF/A)
  const iccStream = pdfDoc.context.stream(buildMinimalSRGBICC(), { N: PDFNumber.of(3), Alternate: PDFName.of('DeviceRGB') })
  const iccRef = pdfDoc.context.register(iccStream)
  const outputIntent = pdfDoc.context.obj({
    Type: PDFName.of('OutputIntent'),
    S: PDFName.of('GTS_PDFA1'),
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    RegistryName: PDFString.of('http://www.color.org'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: iccRef,
  })
  pdfDoc.catalog.set(PDFName.of('OutputIntents'), pdfDoc.context.obj([pdfDoc.context.register(outputIntent)]))

  // 4a. Transparence des images (SMask) interdite en PDF/A-3b
  for (const page of pdfDoc.getPages()) {
    let resourcesObj = page.node.get(PDFName.of('Resources'))
    if (!resourcesObj) continue
    if (resourcesObj.constructor && resourcesObj.constructor.name === 'PDFRef') resourcesObj = pdfDoc.context.lookup(resourcesObj)
    if (!resourcesObj || typeof resourcesObj.get !== 'function') continue
    const xoDict = resourcesObj.get(PDFName.of('XObject'))
    if (!xoDict) continue
    const xo = xoDict.constructor && xoDict.constructor.name === 'PDFRef' ? pdfDoc.context.lookup(xoDict) : xoDict
    if (!xo || typeof xo.values !== 'function') continue
    for (const val of xo.values()) {
      const img = val.constructor && val.constructor.name === 'PDFRef' ? pdfDoc.context.lookup(val) : val
      if (!img || !img.dict) continue
      if (img.dict.get(PDFName.of('Subtype'))?.encodedName === '/Image') {
        img.dict.delete(PDFName.of('SMask'))
        if (img.dict.get(PDFName.of('DecodeParms')) && !img.dict.get(PDFName.of('Filter'))) img.dict.delete(PDFName.of('DecodeParms'))
      }
    }
  }

  // 4b. Polices déclarées mais non utilisées (jsPDF déclare les 14 polices standard)
  const usedFonts = new Set(Array.from(pdfBuffer.toString('latin1').matchAll(/\/(F\d+)\s+[\d.]+\s+Tf/g), (m) => m[1]))
  for (const page of pdfDoc.getPages()) {
    let resourcesObj = page.node.get(PDFName.of('Resources'))
    if (!resourcesObj) continue
    if (resourcesObj.constructor && resourcesObj.constructor.name === 'PDFRef') resourcesObj = pdfDoc.context.lookup(resourcesObj)
    if (!resourcesObj || typeof resourcesObj.get !== 'function') continue
    let fontDict = resourcesObj.get(PDFName.of('Font'))
    if (!fontDict) continue
    if (fontDict.constructor && fontDict.constructor.name === 'PDFRef') fontDict = pdfDoc.context.lookup(fontDict)
    if (!fontDict || typeof fontDict.keys !== 'function') continue
    for (const key of [...fontDict.keys()]) {
      if (!usedFonts.has(String(key).replace(/^\//, ''))) fontDict.delete(key)
    }
  }

  // 5. Dictionnaire Info aligné sur le XMP
  pdfDoc.setTitle(title)
  pdfDoc.setAuthor(seller.legalName)
  pdfDoc.setSubject(subject)
  pdfDoc.setKeywords([])
  pdfDoc.setProducer(seller.softwareName)
  pdfDoc.setCreator(seller.softwareName)
  pdfDoc.setCreationDate(new Date(createDate))
  pdfDoc.setModificationDate(new Date(modifyDate))
  try { pdfDoc.getInfoDict().delete(PDFName.of('Keywords')) } catch (_) {}

  // 6. Enregistrement sans flux d'objets (interdit en PDF/A)
  const pdfBytes = await pdfDoc.save({ useObjectStreams: false })
  return Buffer.from(pdfBytes)
}

// --- Route ---------------------------------------------------------------------

async function handler(req, res) {
  const ctx = await requireRight(req, res, 'facturation.factures.voir', BILLING, BILLING)
  if (!ctx) return
  req.user = ctx.user
  req.profile = ctx.profile
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { invoice_id, pdf_base64 } = req.body || {}
    if (!invoice_id || !pdf_base64) return res.status(400).json({ error: 'invoice_id et pdf_base64 requis' })

    const supabase = getSupabaseAdmin()
    const { data: invoice, error: invErr } = await supabase.from('invoices').select('*').eq('id', invoice_id).single()
    if (invErr || !invoice) return res.status(404).json({ error: 'Facture introuvable' })
    // Pas de Factur-X pour un brouillon : seul un document émis (numéro donné par la base) est une facture
    const nonEmise = Object.prototype.hasOwnProperty.call(invoice, 'issued_at') ? !invoice.issued_at : invoice.status === 'draft'
    if (nonEmise) return res.status(422).json({ error: 'Document non émis : émettez-le avant de produire le Factur-X' })

    const { data: items, error: itemsErr } = await supabase.from('invoice_items').select('*').eq('invoice_id', invoice_id).order('position')
    if (itemsErr) return res.status(500).json({ error: 'Erreur chargement lignes' })
    if (!items || items.length === 0) return res.status(422).json({ error: 'La facture ne contient aucune ligne' })

    const clientId = invoice.billing_client_id || invoice.client_id
    const { data: client, error: clientErr } = await supabase.from('clients').select('id,name,address,postal_code,city,siret,siren,tva,client_type').eq('id', clientId).single()
    if (clientErr || !client) return res.status(404).json({ error: 'Client introuvable' })

    // Identité du vendeur : organization_settings uniquement
    const org = await getOrg(supabase)
    const seller = buildSeller(org, { needsIban: paymentMeansCode(invoice.payment_method) === 30 })

    // Avoir : référence et date de la facture d'origine
    const enriched = { ...invoice }
    if (invoice.type === 'credit_note' && invoice.parent_invoice_id) {
      const { data: parentInv } = await supabase.from('invoices').select('reference,invoice_date').eq('id', invoice.parent_invoice_id).single()
      if (parentInv) {
        enriched.parent_reference = parentInv.reference
        enriched.parent_invoice_date = parentInv.invoice_date
      }
    }

    // Facture de solde : factures d'acompte déduites (0368)
    if (invoice.invoice_kind === 'solde') {
      const { data: liens } = await supabase.from('invoice_deposit_links').select('deposit_invoice_id').eq('final_invoice_id', invoice.id)
      const ids = (liens || []).map((l) => l.deposit_invoice_id)
      if (ids.length) {
        const { data: deps } = await supabase.from('invoices').select('reference,invoice_date').in('id', ids).order('invoice_date')
        enriched.deposit_refs = deps || []
      }
    }

    const xmlString = generateCIIXML(enriched, items, client, seller)
    const pdfBuffer = Buffer.from(pdf_base64, 'base64')
    const result = await embedAndMakePDFA3(pdfBuffer, xmlString, enriched, seller)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.reference}_facturx.pdf"`)
    res.setHeader('Content-Length', result.length)
    return res.status(200).send(result)
  } catch (err) {
    if (err instanceof FacturXConfigError) return res.status(422).json({ error: err.message, missing: err.missing })
    console.error('[generate-facturx] Erreur :', err)
    return res.status(500).json({ error: err.message || 'Erreur interne' })
  }
}

export default withErrorLog(handler, 'generate-facturx')

// api/generate-facturx.js
// Génère un PDF Factur-X conforme PDF/A-3b (XMP + ICC + XML CII EN16931)
// Utilise uniquement pdf-lib (déjà en dépendance) — aucun ajout requis
// Usage : POST { invoice_id, pdf_base64 }

import { PDFDocument, PDFName, PDFString, PDFNumber, PDFArray, AFRelationship } from 'pdf-lib'
import { getSupabaseAdmin } from './_lib/mailer.js'

export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
  maxDuration: 30,
}

// ─── Helpers XML ──────────────────────────────────────────────

function ciiDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  return dt.getFullYear().toString() + String(dt.getMonth()+1).padStart(2,'0') + String(dt.getDate()).padStart(2,'0')
}
function ciiAmt(v) { return (parseFloat(v)||0).toFixed(2) }
function cleanSiret(s) { return (s||'').replace(/\D/g,'') }
function esc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function unitCode(u) {
  const m={jour:'DAY','jour(s)':'DAY',heure:'HUR','heure(s)':'HUR',h:'HUR',mois:'MON',
    forfait:'C62',unite:'C62','unité':'C62',pers:'C62',personne:'C62',stagiaire:'C62'}
  return m[(u||'').toLowerCase()]||'C62'
}

// ─── Profil ICC sRGB minimal (conforme ICC v2) ────────────────
// Display device, RGB, XYZ PCS, primaires sRGB BT.709, gamma 2.2

function buildMinimalSRGBICC() {
  // Helpers
  function w4(buf, off, v) { buf.writeUInt32BE(v>>>0, off) }
  function ws(buf, off, s) { buf.write(s, off, 'ascii') }
  function w2(buf, off, v) { buf.writeUInt16BE(v&0xFFFF, off) }
  function s15f16(v) { return Math.round(v * 65536) }

  // Types de tags
  function xyzType(X, Y, Z) {
    const b = Buffer.alloc(20)
    ws(b,0,'XYZ '); w4(b,4,0)
    w4(b,8,s15f16(X)); w4(b,12,s15f16(Y)); w4(b,16,s15f16(Z))
    return b
  }
  function curveType(gamma) {
    // count=1 → single gamma value as u8Fixed8Number
    const b = Buffer.alloc(14)
    ws(b,0,'curv'); w4(b,4,0); w4(b,8,1)
    w2(b,12, Math.round(gamma*256))
    return b
  }
  function textType(txt) {
    const tb = Buffer.from(txt+'\0','ascii')
    const b = Buffer.alloc(8+tb.length)
    ws(b,0,'text'); w4(b,4,0); tb.copy(b,8)
    return b
  }
  function descType(ascii) {
    const ab = Buffer.from(ascii+'\0','ascii')
    // profileDescriptionType: tag(4)+reserved(4)+ascii_len(4)+ascii+unicode_count(4)+unicode_lang(2)+unicode_len(4)+script_count(2)+script_max_len(1)+script_data(67)
    const b = Buffer.alloc(8+4+ab.length+4+2+4+2+1+67, 0)
    ws(b,0,'desc'); w4(b,4,0); w4(b,8,ab.length)
    ab.copy(b,12)
    return b
  }

  const tagDefs = [
    { sig:'wtpt', data: xyzType(0.96420, 1.00000, 0.82491) },          // D50 white point
    { sig:'rXYZ', data: xyzType(0.43607, 0.22249, 0.01392) },          // sRGB red primary
    { sig:'gXYZ', data: xyzType(0.38515, 0.71687, 0.09708) },          // sRGB green primary
    { sig:'bXYZ', data: xyzType(0.14307, 0.06061, 0.71393) },          // sRGB blue primary
    { sig:'rTRC', data: curveType(2.2) },
    { sig:'gTRC', data: curveType(2.2) },
    { sig:'bTRC', data: curveType(2.2) },
    { sig:'desc', data: descType('sRGB IEC61966-2.1') },
    { sig:'cprt', data: textType('Public Domain') },
  ]

  const headerSize = 128
  const tagTableSize = 4 + tagDefs.length * 12
  let dataOff = headerSize + tagTableSize
  const tagDataParts = tagDefs.map(t => {
    const off = dataOff
    const padded = Math.ceil(t.data.length/4)*4
    dataOff += padded
    return {...t, off, padded}
  })
  const totalSize = dataOff

  const p = Buffer.alloc(totalSize, 0)
  // Header
  w4(p,0,totalSize)
  w4(p,8,0x02100000)         // ICC v2.1
  ws(p,12,'mntr')             // display device
  ws(p,16,'RGB ')
  ws(p,20,'XYZ ')
  w2(p,24,2024); w2(p,26,1); w2(p,28,1) // date 2024-01-01
  ws(p,36,'acsp')
  w4(p,64,0)                 // rendering intent: perceptual
  w4(p,68,s15f16(0.96420))   // D50 X
  w4(p,72,s15f16(1.00000))   // D50 Y
  w4(p,76,s15f16(0.82491))   // D50 Z

  // Tag table
  w4(p,128,tagDefs.length)
  let te = 132
  tagDataParts.forEach(t => {
    ws(p,te,t.sig); w4(p,te+4,t.off); w4(p,te+8,t.data.length); te+=12
  })
  // Tag data
  tagDataParts.forEach(t => t.data.copy(p,t.off))
  return p
}

// ─── Métadonnées XMP PDF/A-3b + Factur-X ─────────────────────

function buildXmpMetadata(invoiceRef, invoiceDate, invoiceType) {
  const isCredit = invoiceType === 'credit_note'
  const label = isCredit ? 'Avoir' : 'Facture'
  const now = new Date().toISOString()
  const docDate = invoiceDate ? new Date(invoiceDate).toISOString() : now

  // DocumentID stable par facture ; InstanceID unique à chaque génération
  const safeRef = (invoiceRef || 'unknown').replace(/[^a-zA-Z0-9-]/g, '')
  const documentId = `uuid-afm-${safeRef}`
  const instanceId = `uuid:${safeRef}-${Date.now().toString(36)}`

  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
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
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${label} ${invoiceRef}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>Access Formation</rdf:li></rdf:Seq></dc:creator>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${label} ${invoiceRef} - Access Formation</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>

  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreateDate>${docDate}</xmp:CreateDate>
   <xmp:ModifyDate>${now}</xmp:ModifyDate>
   <xmp:CreatorTool>Access Formation - AFM Campus</xmp:CreatorTool>
  </rdf:Description>

  <rdf:Description rdf:about=""
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>Access Formation - AFM Campus</pdf:Producer>
   <pdf:PDFVersion>1.7</pdf:PDFVersion>
  </rdf:Description>

  <rdf:Description rdf:about=""
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">
   <xmpMM:DocumentID>${documentId}</xmpMM:DocumentID>
   <xmpMM:InstanceID>${instanceId}</xmpMM:InstanceID>
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

// ─── Générateur XML CII (profil EN16931) ─────────────────────

function generateCIIXML(invoice, items, client) {
  const isCredit = invoice.type === 'credit_note'
  const typeCode = isCredit ? '381' : '380'
  const tvaApplicable = invoice.tva_applicable !== false
  const subtotalHt = items.reduce((s,it)=>s+(parseFloat(it.quantity)||0)*(parseFloat(it.unit_price_ht)||0),0)
  const dp = parseFloat(invoice.discount_percent)||0
  const discountAmt = subtotalHt*dp/100
  const netHt = subtotalHt-discountAmt
  const tvaByRate = {}
  items.forEach(it=>{
    const rate=parseFloat(it.tva_rate)||20
    const lht=(parseFloat(it.quantity)||0)*(parseFloat(it.unit_price_ht)||0)
    if(!tvaByRate[rate]) tvaByRate[rate]={base:0,tva:0}
    tvaByRate[rate].base+=lht
  })
  if(dp>0) Object.keys(tvaByRate).forEach(r=>{tvaByRate[r].base-=tvaByRate[r].base*dp/100})
  let totalTva=0
  if(tvaApplicable) Object.keys(tvaByRate).forEach(r=>{
    tvaByRate[r].tva=tvaByRate[r].base*parseFloat(r)/100; totalTva+=tvaByRate[r].tva
  })
  const totalTtc=netHt+totalTva
  const amountPaid=parseFloat(invoice.amount_paid)||0
  const dueAmount=totalTtc-amountPaid

  const linesXml=items.map((it,idx)=>{
    const q=parseFloat(it.quantity)||0,pu=parseFloat(it.unit_price_ht)||0
    const rate=parseFloat(it.tva_rate)||20,lineTotal=q*pu
    const catCode=tvaApplicable?'S':'E',rateVal=tvaApplicable?rate:0
    const name=esc(it.description_title||''),detail=esc(it.description_detail||'')
    const fullName=detail?`${name} - ${detail}`:name
    return `    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${idx+1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${fullName}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>${ciiAmt(pu)}</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${unitCode(it.unit)}">${ciiAmt(q)}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${catCode}</ram:CategoryCode>
          <ram:RateApplicablePercent>${rateVal}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${ciiAmt(lineTotal)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`
  }).join('\n')

  const tvaBlocksXml=tvaApplicable
    ?Object.entries(tvaByRate).map(([rate,data])=>`    <ram:ApplicableTradeTax>
      <ram:CalculatedAmount>${ciiAmt(data.tva)}</ram:CalculatedAmount>
      <ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>${ciiAmt(data.base)}</ram:BasisAmount>
      <ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>${rate}</ram:RateApplicablePercent>
    </ram:ApplicableTradeTax>`).join('\n')
    :`    <ram:ApplicableTradeTax>
      <ram:CalculatedAmount>0.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>
      <ram:ExemptionReasonCode>VATEX-EU-132-1-i</ram:ExemptionReasonCode>
      <ram:ExemptionReason>Formation professionnelle continue - article 261 du CGI</ram:ExemptionReason>
      <ram:BasisAmount>${ciiAmt(netHt)}</ram:BasisAmount>
      <ram:CategoryCode>E</ram:CategoryCode><ram:RateApplicablePercent>0</ram:RateApplicablePercent>
    </ram:ApplicableTradeTax>`

  const discountXml=discountAmt>0?`    <ram:SpecifiedTradeAllowanceCharge>
      <ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator>
      <ram:CalculationPercent>${dp}</ram:CalculationPercent>
      <ram:BasisAmount>${ciiAmt(subtotalHt)}</ram:BasisAmount><ram:ActualAmount>${ciiAmt(discountAmt)}</ram:ActualAmount>
      <ram:CategoryTradeTax><ram:TypeCode>VAT</ram:TypeCode>
        <ram:CategoryCode>${tvaApplicable?'S':'E'}</ram:CategoryCode>
        <ram:RateApplicablePercent>${tvaApplicable?Object.keys(tvaByRate)[0]||20:0}</ram:RateApplicablePercent>
      </ram:CategoryTradeTax><ram:Reason>Remise</ram:Reason>
    </ram:SpecifiedTradeAllowanceCharge>`:''

  // BG-16 PaymentMeans — BT-81 TypeCode + BT-84 IBAN + BT-86 BIC (EN16931)
  const pmCode = invoice.payment_method === 'virement bancaire' ? 30
    : invoice.payment_method === 'chèque' ? 20
    : invoice.payment_method === 'espèces' ? 10
    : invoice.payment_method === 'carte bancaire' ? 48
    : invoice.payment_method === 'prélèvement' ? 49 : 30
  // IBAN/BIC seulement pour virement (TypeCode 30) et prélèvement (49)
  const AF_IBAN = 'FR7615589297060008906894048'
  const AF_BIC  = 'CMBRFR2BXXX'
  const ibanBlock = (pmCode === 30 || pmCode === 49) ? `
      <ram:PayeePartyCreditorFinancialAccount>
        <ram:IBANID>${AF_IBAN}</ram:IBANID>
      </ram:PayeePartyCreditorFinancialAccount>
      <ram:PayeeSpecifiedCreditorFinancialInstitution>
        <ram:BICID>${AF_BIC}</ram:BICID>
      </ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''
  const paymentMeansXml = `    <ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:TypeCode>${pmCode}</ram:TypeCode>${ibanBlock}
    </ram:SpecifiedTradeSettlementPaymentMeans>`

  const dueDateXml=invoice.due_date?`    <ram:SpecifiedTradePaymentTerms>
      <ram:DueDateDateTime><udt:DateTimeString format="102">${ciiDate(invoice.due_date)}</udt:DateTimeString></ram:DueDateDateTime>
    </ram:SpecifiedTradePaymentTerms>`:''

  const prepaidXml=amountPaid>0?`      <ram:TotalPrepaidAmount>${ciiAmt(amountPaid)}</ram:TotalPrepaidAmount>`:''
  const allowanceXml=discountAmt>0?`      <ram:AllowanceTotalAmount>${ciiAmt(discountAmt)}</ram:AllowanceTotalAmount>`:''

  const clientSiret=cleanSiret(client.siret)
  const clientSiren=client.siren||(clientSiret.length>=9?clientSiret.substring(0,9):'')
  const clientId=clientSiret||clientSiren
  const buyerSiretXml=clientId?`        <ram:SpecifiedLegalOrganization>
          <ram:ID schemeID="0002">${clientId}</ram:ID>
        </ram:SpecifiedLegalOrganization>`:''
  const clientTva=(client.tva||'').trim()
  const buyerTaxXml=clientTva?`        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(clientTva)}</ram:ID></ram:SpecifiedTaxRegistration>`:''
  const encaissementsNote=`    <ram:IncludedNote><ram:Content>TVA exigible d'apres les encaissements - Article 269 2-c du CGI</ram:Content></ram:IncludedNote>`
  const buyerRefXml=invoice.client_reference?`      <ram:BuyerOrderReferencedDocument>
        <ram:IssuerAssignedID>${esc(invoice.client_reference)}</ram:IssuerAssignedID>
      </ram:BuyerOrderReferencedDocument>`:''
  // Mention 25 : date de fin d'exécution de la prestation
  // ApplicableHeaderTradeDelivery → ActualDeliveryDate = service_end_date (ou start si absent)
  // BillingSpecifiedPeriod (EN16931 BG-14) va sous ApplicableHeaderTradeSettlement
  const deliveryEndDate = invoice.service_end_date || invoice.service_start_date
  const deliveryXml = invoice.service_start_date
    ? `    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime>
          <udt:DateTimeString format="102">${ciiDate(deliveryEndDate)}</udt:DateTimeString>
      </ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>`
    : '    <ram:ApplicableHeaderTradeDelivery/>'
  // BillingSpecifiedPeriod — sous ApplicableHeaderTradeSettlement (EN16931 BG-14)
  const billingPeriodXml = (invoice.service_start_date && invoice.service_end_date && invoice.service_end_date !== invoice.service_start_date)
    ? `    <ram:BillingSpecifiedPeriod>
      <ram:StartDateTime><udt:DateTimeString format="102">${ciiDate(invoice.service_start_date)}</udt:DateTimeString></ram:StartDateTime>
      <ram:EndDateTime><udt:DateTimeString format="102">${ciiDate(invoice.service_end_date)}</udt:DateTimeString></ram:EndDateTime>
    </ram:BillingSpecifiedPeriod>` : ''
  const noteXml=invoice.notes?`    <ram:IncludedNote><ram:Content>${esc(invoice.notes)}</ram:Content></ram:IncludedNote>`:''
  // Mention +6 : date d'émission de la facture rectifiée (obligatoire dans l'avoir)
  const precedingXml=isCredit&&invoice.parent_reference?`      <ram:InvoiceReferencedDocument>
        <ram:IssuerAssignedID>${esc(invoice.parent_reference)}</ram:IssuerAssignedID>${invoice.parent_invoice_date ? `
        <ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${ciiDate(invoice.parent_invoice_date)}</qdt:DateTimeString></ram:FormattedIssueDateTime>` : ''}
      </ram:InvoiceReferencedDocument>`:''

  return `<?xml version='1.0' encoding='UTF-8'?>
<rsm:CrossIndustryInvoice
  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>A1</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(invoice.reference)}</ram:ID>
    <ram:TypeCode>${typeCode}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${ciiDate(invoice.invoice_date)}</udt:DateTimeString></ram:IssueDateTime>
${noteXml}
${encaissementsNote}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${linesXml}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>Access Formation</ram:Name>
        <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">94356386600012</ram:ID></ram:SpecifiedLegalOrganization>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>29900</ram:PostcodeCode>
          <ram:LineOne>24 Rue Kerbleiz</ram:LineOne><ram:CityName>Concarneau</ram:CityName><ram:CountryID>FR</ram:CountryID>
        </ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">FR71943563866</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${esc(client.name||'')}</ram:Name>
${buyerSiretXml}
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${esc(client.postal_code||'')}</ram:PostcodeCode>
          <ram:LineOne>${esc(client.address||'')}</ram:LineOne>
          <ram:CityName>${esc((client.city||'').toUpperCase())}</ram:CityName>
          <ram:CountryID>FR</ram:CountryID>
        </ram:PostalTradeAddress>
${buyerTaxXml}
      </ram:BuyerTradeParty>
${buyerRefXml}
    </ram:ApplicableHeaderTradeAgreement>
${deliveryXml}
    <ram:ApplicableHeaderTradeSettlement>
      <ram:PaymentReference>${esc(invoice.reference)}</ram:PaymentReference>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
${billingPeriodXml}
${paymentMeansXml}
${precedingXml}
${tvaBlocksXml}
${discountXml}
${dueDateXml}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${ciiAmt(subtotalHt)}</ram:LineTotalAmount>
${allowanceXml}
        <ram:TaxBasisTotalAmount>${ciiAmt(netHt)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${ciiAmt(totalTva)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${ciiAmt(totalTtc)}</ram:GrandTotalAmount>
${prepaidXml}
        <ram:DuePayableAmount>${ciiAmt(dueAmount>0?dueAmount:totalTtc)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
}

// ─── Embed XML + PDF/A-3b compliance via pdf-lib ─────────────

async function embedAndMakePDFA3(pdfBuffer, xmlString, invoiceRef, invoiceDate, invoiceType) {
  const pdfDoc = await PDFDocument.load(pdfBuffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  })

  // 1. Attacher l'XML (AFRelationship.Data = NF Z55-300 §4.2.3 obligatoire)
  const xmlBytes = new TextEncoder().encode(xmlString)
  const label = invoiceType === 'credit_note' ? 'Avoir' : 'Facture'
  await pdfDoc.attach(xmlBytes, 'factur-x.xml', {
    mimeType: 'text/xml',
    description: `${label} ${invoiceRef} - Factur-X EN16931`,
    creationDate: invoiceDate ? new Date(invoiceDate) : new Date(),
    modificationDate: new Date(),
    afRelationship: AFRelationship.Data,
  })

  // 1b. Corriger le /Subtype du EmbeddedFile : pdf-lib encode comme PDFName invalide
  // veraPDF exige une PDFString (application/xml), pas un PDFName (/application#2Fxml)
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
            const fRef = efResolved && typeof efResolved.get === 'function'
              ? efResolved.get(PDFName.of('F')) : null
            if (fRef) {
              const embStream = pdfDoc.context.lookup(fRef) || fRef
              if (embStream && embStream.dict) {
                // Forcer Subtype comme PDFString text/xml (requis PDF/A-3 NF Z55-300)
                embStream.dict.set(PDFName.of('Subtype'), PDFString.of('text/xml'))
              }
            }
          }
        }
      }
    }
  } catch (_) {}

  // 2. XMP metadata PDF/A-3b + Factur-X extension schema
  const xmpString = buildXmpMetadata(invoiceRef, invoiceDate, invoiceType)
  const xmpBytes = new TextEncoder().encode(xmpString)

  // Créer le stream XMP (non compressé, requis PDF/A)
  const xmpStream = pdfDoc.context.stream(xmpBytes, {
    Type: PDFName.of('Metadata'),
    Subtype: PDFName.of('XML'),
  })
  const xmpRef = pdfDoc.context.register(xmpStream)
  pdfDoc.catalog.set(PDFName.of('Metadata'), xmpRef)

  // 3. OutputIntents avec profil ICC sRGB (requis PDF/A)
  const iccProfile = buildMinimalSRGBICC()

  const iccStream = pdfDoc.context.stream(iccProfile, {
    N: PDFNumber.of(3),
    Alternate: PDFName.of('DeviceRGB'),
  })
  const iccRef = pdfDoc.context.register(iccStream)

  const outputIntent = pdfDoc.context.obj({
    Type: PDFName.of('OutputIntent'),
    S: PDFName.of('GTS_PDFA1'),
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    RegistryName: PDFString.of('http://www.color.org'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: iccRef,
  })
  const outputIntentRef = pdfDoc.context.register(outputIntent)
  pdfDoc.catalog.set(PDFName.of('OutputIntents'), pdfDoc.context.obj([outputIntentRef]))

  // 4a. Supprimer les SMask (transparence) sur les images — interdit PDF/A
  // Le logo PNG a un canal alpha qui génère un /SMask, violation PDF/A §6.5
  for (const page of pdfDoc.getPages()) {
    let resourcesObj = page.node.get(PDFName.of('Resources'))
    if (!resourcesObj) continue
    if (resourcesObj.constructor && resourcesObj.constructor.name === 'PDFRef') {
      resourcesObj = pdfDoc.context.lookup(resourcesObj)
    }
    if (!resourcesObj || typeof resourcesObj.get !== 'function') continue
    const xoDict = resourcesObj.get(PDFName.of('XObject'))
    if (!xoDict) continue
    const xo = xoDict.constructor && xoDict.constructor.name === 'PDFRef'
      ? pdfDoc.context.lookup(xoDict) : xoDict
    if (!xo || typeof xo.values !== 'function') continue
    for (const val of xo.values()) {
      const img = val.constructor && val.constructor.name === 'PDFRef'
        ? pdfDoc.context.lookup(val) : val
      if (!img || !img.dict) continue
      if (img.dict.get(PDFName.of('Subtype'))?.encodedName === '/Image') {
        img.dict.delete(PDFName.of('SMask'))
        // Supprimer DecodeParms orphelin sans Filter (invalide PDF/A)
        if (img.dict.get(PDFName.of('DecodeParms')) && !img.dict.get(PDFName.of('Filter'))) {
          img.dict.delete(PDFName.of('DecodeParms'))
        }
      }
    }
  }

  // 4b. Nettoyer les polices non embarquées non utilisées (PDF/A interdit les polices sans embedding)
  // jsPDF déclare les 14 polices standard dans Resources même si inutilisées
  // Identifier d'abord toutes les polices réellement utilisées dans le PDF brut
  // (jsPDF ne compresse pas ses streams, regex directe possible)
  const usedFonts = new Set(
    Array.from(pdfBuffer.toString('latin1').matchAll(/\/(F\d+)\s+[\d.]+\s+Tf/g), m => m[1])
  )

  const pages = pdfDoc.getPages()
  for (const page of pages) {
    // pdf-lib peut retourner une PDFRef — résoudre via context.lookup()
    let resourcesObj = page.node.get(PDFName.of('Resources'))
    if (!resourcesObj) continue
    if (resourcesObj.constructor && resourcesObj.constructor.name === 'PDFRef') {
      resourcesObj = pdfDoc.context.lookup(resourcesObj)
    }
    if (!resourcesObj || typeof resourcesObj.get !== 'function') continue

    let fontDict = resourcesObj.get(PDFName.of('Font'))
    if (!fontDict) continue
    if (fontDict.constructor && fontDict.constructor.name === 'PDFRef') {
      fontDict = pdfDoc.context.lookup(fontDict)
    }
    if (!fontDict || typeof fontDict.keys !== 'function') continue

    // Supprimer toutes les polices non utilisées dans le contenu
    for (const key of [...fontDict.keys()]) {
      const fontName = String(key).replace(/^\//, '')
      if (!usedFonts.has(fontName)) {
        fontDict.delete(key)
      }
    }
  }

  // 5. Infos document
  pdfDoc.setTitle(`${label} ${invoiceRef}`)
  pdfDoc.setAuthor('Access Formation')
  pdfDoc.setSubject(`${label} ${invoiceRef} - Access Formation`)
  pdfDoc.setProducer('Access Formation - AFM Campus')
  pdfDoc.setCreator('Access Formation - AFM Campus')

  // 6. Sauvegarder sans object streams (interdit en PDF/A)
  const pdfBytes = await pdfDoc.save({ useObjectStreams: false })
  return Buffer.from(pdfBytes)
}

// ─── Handler principal ────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { invoice_id, pdf_base64 } = req.body
    if (!invoice_id || !pdf_base64) return res.status(400).json({ error: 'invoice_id et pdf_base64 requis' })

    const supabase = getSupabaseAdmin()
    const { data: invoice, error: invErr } = await supabase.from('invoices').select('*').eq('id', invoice_id).single()
    if (invErr || !invoice) return res.status(404).json({ error: 'Facture introuvable' })

    const { data: items, error: itemsErr } = await supabase.from('invoice_items').select('*').eq('invoice_id', invoice_id).order('position')
    if (itemsErr) return res.status(500).json({ error: 'Erreur chargement lignes' })

    const clientId = invoice.billing_client_id || invoice.client_id
    const { data: client, error: clientErr } = await supabase.from('clients').select('id,name,address,postal_code,city,siret,siren,tva').eq('id', clientId).single()
    if (clientErr || !client) return res.status(404).json({ error: 'Client introuvable' })

    // Résoudre référence + date de la facture parente pour les avoirs (mention +6)
    let enrichedInvoice = { ...invoice }
    if (invoice.type === 'credit_note' && invoice.parent_invoice_id) {
      const { data: parentInv } = await supabase.from('invoices')
        .select('reference,invoice_date').eq('id', invoice.parent_invoice_id).single()
      if (parentInv) {
        enrichedInvoice.parent_reference = parentInv.reference
        enrichedInvoice.parent_invoice_date = parentInv.invoice_date
      }
    }

    const xmlString = generateCIIXML(enrichedInvoice, items || [], client)
    const pdfBuffer = Buffer.from(pdf_base64, 'base64')
    const result = await embedAndMakePDFA3(pdfBuffer, xmlString, invoice.reference, invoice.invoice_date, invoice.type)

    const filename = `${invoice.reference}_facturx.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', result.length)
    return res.status(200).send(result)

  } catch (err) {
    console.error('[generate-facturx] Erreur :', err)
    return res.status(500).json({ error: err.message || 'Erreur interne' })
  }
}

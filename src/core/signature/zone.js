// Zone de signature du client dans un PDF (22/10, retour de H : « la signature n'apparaît pas sur le devis »).
// Le générateur (devis, convention) note dans les mots-clés du PDF la page et le cadre « Bon pour accord » réservés
// au client ; une fois le document signé en ligne, la signature tracée est reportée dans ce cadre (documentAvecPreuve).
// Le fichier présenté et signé reste rangé tel quel : son empreinte, en page de preuve, porte sur lui.

const MARQUE = 'odet-zone-signature'

/** À appeler juste après avoir dessiné le cadre du client (unités du document jsPDF : mm, origine en haut à gauche) */
export function marquerZoneSignature(doc, { x, y, w, h }) {
  const page = doc.getCurrentPageInfo().pageNumber
  const ph = doc.internal.pageSize.getHeight()
  const pw = doc.internal.pageSize.getWidth()
  const v = [page, x / pw, y / ph, w / pw, h / ph].map((n, i) => (i ? n.toFixed(5) : String(n)))
  doc.setProperties({ keywords: `${MARQUE} ${v.join(' ')}` })
}

/** { page (index 0), x, y, w, h } en fractions de la page, ou null */
export function lireZoneSignature(keywords) {
  const m = new RegExp(`${MARQUE} (\\d+) ([\\d.]+) ([\\d.]+) ([\\d.]+) ([\\d.]+)`).exec(String(keywords || ''))
  if (!m) return null
  const [page, x, y, w, h] = m.slice(1).map(Number)
  if (!(page >= 1) || [x, y, w, h].some((n) => !(n >= 0 && n <= 1)) || !(w > 0 && h > 0)) return null
  return { page: page - 1, x, y, w, h }
}

// Police standard du PDF : caractères hors Latin-1 remplacés (sinon le report échouerait)
const latin1 = (t) => String(t).replace(/[\u00a0\u202f]/g, ' ').normalize('NFC')
  .replace(/[^\x20-\x7e\xa0-\xff]/g, (c) => c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e\xa0-\xff]/g, '?'))

const octetsDe = (dataUrl) => {
  const b64 = String(dataUrl).split(',')[1] || ''
  const bin = atob(b64)
  const o = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i)
  return o
}

/**
 * Reporte la signature dans la zone notée (document pdf-lib déjà chargé). Renvoie vrai si elle a été posée.
 * sig : { signature_data (data URL PNG ou JPEG), signer_name, signed_at, consentement (porte la mention écrite) }
 */
export async function reporterSignature(pdf, sig, { StandardFonts, rgb }) {
  if (!sig?.signature_data) return false
  let kw = ''
  try { kw = pdf.getKeywords() || '' } catch { kw = '' }
  const z = lireZoneSignature(kw)
  if (!z || z.page >= pdf.getPageCount()) return false
  const page = pdf.getPage(z.page)
  const { width: PW, height: PH } = page.getSize()
  const bx = z.x * PW, bw = z.w * PW, bh = z.h * PH
  const by = PH - z.y * PH - bh // pdf-lib : origine en bas à gauche
  const jpeg = /^data:image\/jpe?g/i.test(sig.signature_data)
  const img = jpeg ? await pdf.embedJpg(octetsDe(sig.signature_data)) : await pdf.embedPng(octetsDe(sig.signature_data))
  // Légende en bas du cadre, signature au-dessus, à l'échelle
  const police = await pdf.embedFont(StandardFonts.Helvetica)
  const quand = sig.signed_at ? new Date(sig.signed_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : ''
  const legende = latin1(`Signé en ligne${sig.signer_name ? ` par ${sig.signer_name}` : ''}${quand ? ` le ${quand}` : ''}, preuve en dernière page`)
  let taille = 6
  while (taille > 4 && police.widthOfTextAtSize(legende, taille) > bw - 6) taille -= 0.25
  // Bandeau blanc sous la légende (recouvre l'indication « Signature et cachet » du cadre vide)
  const bande = Math.min(14, bh / 3) // hauteur de l'indication en italique au pied du cadre de la convention
  page.drawRectangle({ x: bx + 0.8, y: by + 0.8, width: bw - 1.6, height: bande, color: rgb(1, 1, 1) })
  page.drawText(legende, { x: bx + 3, y: by + 4, size: taille, font: police, color: rgb(0.35, 0.37, 0.42) })
  // Mention écrite au clavier par le signataire (« Lu et approuvé, bon pour accord »), en haut du cadre
  const m = /Mention écrite par le signataire : « ([^»]{2,80}) »/.exec(String(sig.consentement || sig.metadata?.consentement || ''))
  let haut = 0
  if (m) {
    const italique = await pdf.embedFont(StandardFonts.HelveticaOblique)
    const texte = latin1(`« ${m[1].trim()} »`)
    let t2 = 8
    while (t2 > 5 && italique.widthOfTextAtSize(texte, t2) > bw - 8) t2 -= 0.25
    page.drawText(texte, { x: bx + 4, y: by + bh - t2 - 3, size: t2, font: italique, color: rgb(0.1, 0.1, 0.12) })
    haut = t2 + 4
  }
  const zoneH = bh - bande - 4 - haut
  const r = Math.min((bw - 8) / img.width, zoneH / img.height)
  const w = img.width * r, h = img.height * r
  page.drawImage(img, { x: bx + (bw - w) / 2, y: by + bande + 1 + (zoneH - h) / 2, width: w, height: h })
  return true
}

import QRCode from 'qrcode'
import { supabase } from '../supabase'
import { publicBaseUrl } from '../org/orgUtils'
import { setF } from '../pdf/layout'

// Encadré « Signer en ligne » des devis et conventions (décision de H, 21/10, 21 h 55) : le lien vers l'espace
// client est dans le document, pas dans le corps du mail (les mails sans lien passent mieux les filtres). L'adresse,
// le QR code et le code d'accès viennent de l'accès entreprise du client (fiche client › Espace entreprise). Sans
// accès actif, ou lu depuis un portail (droits insuffisants), rien n'est ajouté.

export async function lienEspaceClient(clientId) {
  if (!clientId) return null
  try {
    const { data, error } = await supabase.from('client_portal_access').select('token, access_code, is_active').eq('client_id', clientId).maybeSingle()
    if (error || !data || !data.is_active || !data.token) return null
    const url = `${publicBaseUrl()}/#/entreprise/${data.token}`
    const qr = await QRCode.toDataURL(url, { width: 220, margin: 1 })
    return { url, code: data.access_code || '', qr }
  } catch {
    return null
  }
}

export const TEXTE_EN_LIGNE = 'Consultez et signez ce document dans votre espace client : scannez le QR code ou saisissez l\'adresse ci-dessous. Vous pouvez aussi le signer et nous le retourner.'

// Hauteur de l'encadré (mm) pour une largeur donnée
export function hauteurEncadreEnLigne(doc, w) {
  setF(doc, 'normal'); doc.setFontSize(8.5)
  const lignes = doc.splitTextToSize(TEXTE_EN_LIGNE, w - 44).length
  return Math.max(34, 12 + lignes * 4 + 14)
}

/** Dessine l'encadré à (x, y), largeur w ; theme = { accent, text, muted, surface, line } en [r, g, b] ; renvoie sa hauteur */
export function dessinerEncadreEnLigne(doc, theme, x, y, w, lien) {
  const h = hauteurEncadreEnLigne(doc, w)
  const qrS = 26
  doc.setFillColor(...theme.surface); doc.rect(x, y, w, h, 'F')
  doc.setFillColor(...theme.accent); doc.rect(x, y, 1.2, h, 'F')
  setF(doc, 'bold'); doc.setFontSize(7); doc.setTextColor(...theme.accent)
  doc.text('SIGNER EN LIGNE', x + 5, y + 6, { charSpace: 0.4 })
  setF(doc, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...theme.text)
  const tw = w - qrS - 18
  const lignes = doc.splitTextToSize(TEXTE_EN_LIGNE, tw)
  lignes.forEach((l, i) => doc.text(l, x + 5, y + 11.5 + i * 4))
  let yy = y + 11.5 + lignes.length * 4 + 1.5
  doc.setFontSize(8); doc.setTextColor(...theme.accent)
  const url = doc.splitTextToSize(lien.url, tw)
  url.forEach((l, i) => doc.textWithLink(l, x + 5, yy + i * 3.6, { url: lien.url }))
  yy += url.length * 3.6 + 2
  if (lien.code) {
    setF(doc, 'bold'); doc.setFontSize(9); doc.setTextColor(...theme.text)
    doc.text(`Code d'accès : ${lien.code}`, x + 5, yy + 1)
  }
  try {
    doc.setFillColor(255, 255, 255); doc.rect(x + w - qrS - 6, y + (h - qrS) / 2 - 1, qrS + 2, qrS + 2, 'F')
    doc.addImage(lien.qr, 'PNG', x + w - qrS - 5, y + (h - qrS) / 2, qrS, qrS)
  } catch { /* QR non inséré : l'adresse reste écrite */ }
  doc.setTextColor(...theme.text)
  return h
}

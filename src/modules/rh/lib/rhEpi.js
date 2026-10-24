// EPI remis au personnel (0394, liste unique A5) : articles du stock marqués EPI, remise signée par le salarié,
// sortie du stock faite par la base, fiche de remise en PDF rangée dans les documents de la personne.
// Code du travail : EPI fournis gratuitement par l'employeur (R4323-95), adaptés à la personne, remplacés dès qu'usés.
// Document hors formation : ni NDA ni mention Qualiopi (orgHorsFormation).

import jsPDF from 'jspdf'
import { supabase } from '../../../core/supabase'
import { startDocument, drawImageFitted } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { orgHorsFormation } from '../../../core/org/orgUtils'

const must = ({ data, error }) => { if (error) throw error; return data }
const frDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')

export const chargerEpiPersonne = async (personId) => must(await supabase.from('hr_ppe_handovers')
  .select('id, item_id, quantity, size, handed_on, renew_on, returned_on, signed_at, notes, from_location_id, stock_items(label, reference, unit)')
  .eq('person_id', personId).order('handed_on', { ascending: false }))

export const chargerArticlesEpi = async () => must(await supabase.from('stock_items')
  .select('id, label, reference, unit, ppe_renew_months').eq('ppe', true).eq('is_active', true).order('label'))

export const chargerEmplacementsActifs = async () => must(await supabase.from('stock_locations')
  .select('id, kind, name').eq('is_active', true).order('kind').order('name'))

export async function remettreEpi(v) {
  return must(await supabase.from('hr_ppe_handovers').insert({
    person_id: v.personId, item_id: v.itemId, quantity: Number(v.quantity) || 1, size: v.size?.trim() || null,
    from_location_id: v.fromLocationId || null, handed_on: v.handedOn, renew_on: v.renewOn || null,
    employee_signature: v.signature || null, notes: v.notes?.trim() || null,
  }).select('id, renew_on').single())
}

export const marquerRendu = async (id, jour) => must(await supabase.from('hr_ppe_handovers').update({ returned_on: jour }).eq('id', id))
export const annulerRemise = async (id) => must(await supabase.from('hr_ppe_handovers').delete().eq('id', id))

/** État d'une remise à une date : rendu, à renouveler (dépassé), bientôt (30 jours), en cours */
export function etatRemise(r, aujourdhui = new Date().toISOString().slice(0, 10)) {
  if (r.returned_on) return 'rendu'
  if (!r.renew_on) return 'en_cours'
  if (r.renew_on < aujourdhui) return 'a_renouveler'
  const d = new Date(`${aujourdhui}T12:00:00`); d.setDate(d.getDate() + 30)
  return r.renew_on <= d.toISOString().slice(0, 10) ? 'bientot' : 'en_cours'
}
export const ETATS_REMISE = {
  en_cours: { label: 'En cours', badge: 'badge-success' },
  bientot: { label: 'À renouveler bientôt', badge: 'badge-warning' },
  a_renouveler: { label: 'À renouveler', badge: 'badge-danger' },
  rendu: { label: 'Rendu', badge: 'badge-neutral' },
}

/** Date de renouvellement proposée : date de remise + durée de l'article (en mois) */
export function renouvellementPropose(handedOn, mois) {
  if (!handedOn || !mois) return ''
  const [a, m, j] = String(handedOn).slice(0, 10).split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + Number(mois), 1))
  const dernier = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(j, dernier))
  return d.toISOString().slice(0, 10)
}

/**
 * Fiche de remise d'EPI en PDF.
 * @param {object} p { person, jobTitle, lignes: [{ label, reference, quantity, unit, size, renew_on }], handedOn,
 *                     remisPar, employeeSignature }
 * @returns {Promise<Blob>}
 */
export async function genererFicheRemisePDF(p) {
  const ORG = orgHorsFormation(await loadPdfOrg(true))
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, { code: 'EPI', docLabel: 'Fiche de remise d\'EPI', title: 'Fiche de remise d\'équipements de protection individuelle', subtitle: 'Articles R4323-91 à R4323-106 du code du travail' })
  const nom = `${p.person?.first_name || ''} ${(p.person?.last_name || '').toUpperCase()}`.trim()
  f.section('Salarié')
  f.fields([{ label: 'Nom et prénom', value: nom, w: 2 }, { label: 'Fonction', value: p.jobTitle || '', w: 2 }])
  f.fields([{ label: 'Employeur', value: ORG.legal_name || ORG.name, w: 3 }, { label: 'Remis le', value: frDate(p.handedOn) }])
  f.section('Équipements remis')
  f.table(['Équipement', 'Référence', 'Quantité', 'Taille', 'À renouveler le'],
    (p.lignes || []).map((l) => [l.label || '', l.reference || '', `${l.quantity} ${l.unit || ''}`.trim(), l.size || '', frDate(l.renew_on) || '']))
  f.section('Engagements')
  f.para('L\'employeur fournit gratuitement ces équipements, adaptés au travail et à la personne, et les remplace dès qu\'ils sont usés, abîmés ou périmés.')
  f.para('Le salarié a reçu l\'information sur les risques contre lesquels ils protègent, les conditions d\'utilisation et d\'entretien. Il s\'engage à les porter quand le travail l\'exige, à en prendre soin et à signaler tout défaut.')
  f.ensure(48)
  f.space(4)
  const w = (f.W - 8) / 2
  const y0 = f.y
  const cadre = (x, label, nomS, qualite, image) => {
    doc.setDrawColor(...ORG.theme.line); doc.setLineWidth(0.3); doc.rect(x, y0, w, 40)
    doc.setFontSize(7); doc.setTextColor(...ORG.theme.muted); doc.text(label.toUpperCase(), x + 3, y0 + 5)
    doc.setFontSize(9); doc.setTextColor(...ORG.theme.text); doc.text(nomS || '', x + 3, y0 + 10)
    if (qualite) { doc.setFontSize(8); doc.text(qualite, x + 3, y0 + 14) }
    if (image) { try { drawImageFitted(doc, image, x + 3, y0 + 16, w - 6, 22) } catch { /* image illisible */ } }
  }
  cadre(f.M, 'Remis par', p.remisPar || '', 'Pour l\'employeur', null)
  cadre(f.M + w + 8, 'Le salarié', nom, 'Reçu, lu et approuvé', p.employeeSignature)
  f.y = y0 + 44
  f.note(`Fait à ${ORG.city || ''}, le ${frDate(p.handedOn)}.`)
  f.finish()
  return doc.output('blob')
}

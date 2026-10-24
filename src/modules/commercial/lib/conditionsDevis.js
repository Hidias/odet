// Conditions générales jointes au devis mis à disposition dans l'espace client (0444) : le client lit et signe un seul
// document, le devis suivi de ses conditions générales (versions validées, variante du client). L'empreinte de la
// signature couvre donc aussi les conditions ; leur liste (document, version, variante) est gardée avec le devis et
// figée par la base à l'acceptation.

import { PDFDocument } from 'pdf-lib'
import { supabase } from '../../../core/supabase'
import { documentsAJoindre } from './metierDevis'

const enOctets = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
function enBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Conditions générales validées à joindre au devis, dans la variante du client */
export async function conditionsDuDevis(quote, items, client) {
  const { publishedDocPDF } = await import('../../qualite/richdocs/published')
  const audience = client?.client_type === 'particulier' ? 'particulier' : 'pro'
  const out = []
  for (const d of documentsAJoindre(quote, items).filter((x) => x.kind === 'cgv')) {
    const pdf = await publishedDocPDF(d.doc, { audience })
    // Seule une version validée est remise au client avec le devis à signer
    if (pdf?.source === 'valide') out.push({ doc: d.doc, label: d.label, version: pdf.version, audience, validated_at: pdf.validated_at || null, base64: pdf.base64 })
  }
  return out
}

/** Liste gardée avec le devis (sans le fichier) */
export const resumeConditions = (conds) => (conds || []).map(({ doc, label, version, audience, validated_at }) => ({ doc, label, version, audience, validated_at }))

/** Devis suivi de ses conditions générales, en un seul PDF (les mots-clés du devis, dont le cadre de signature, restent) */
export async function devisAvecConditions(devisBase64, conds) {
  if (!conds?.length) return devisBase64
  const doc = await PDFDocument.load(enOctets(devisBase64), { updateMetadata: false })
  for (const c of conds) {
    const src = await PDFDocument.load(enOctets(c.base64))
    const pages = await doc.copyPages(src, src.getPageIndices())
    pages.forEach((p) => doc.addPage(p))
  }
  return enBase64(await doc.save({ useObjectStreams: false }))
}

export const libelleDevisPublie = (quote, conds) => `${quote?.amendment_of ? 'Avenant' : 'Devis'} ${quote?.reference || ''}${conds?.length ? ' et conditions générales' : ''}`.trim()

/**
 * Prépare le PDF remis au client : devis + conditions générales validées. Avant l'acceptation, la liste des
 * conditions jointes est enregistrée sur le devis (la base la fige quand le devis est accepté).
 * @returns {{ base64: string, label: string, conditions: object[] }}
 */
export async function preparerDevisPublie(quote, items, client, devisBase64) {
  let conds = []
  try { conds = await conditionsDuDevis(quote, items, client) } catch (e) { console.warn('Conditions générales du devis :', e.message) }
  const base64 = await devisAvecConditions(devisBase64, conds)
  const resume = resumeConditions(conds)
  if (quote?.id && !['accepted', 'partial', 'refused', 'expired'].includes(quote.status)
      && JSON.stringify(quote.conditions_jointes || []) !== JSON.stringify(resume)) {
    const { error } = await supabase.from('quotes').update({ conditions_jointes: resume }).eq('id', quote.id)
    if (error) console.warn('Conditions jointes au devis :', error.message)
  }
  return { base64, label: libelleDevisPublie(quote, conds), conditions: resume }
}

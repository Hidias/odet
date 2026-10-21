import { supabase } from '../supabase'
import { round2 } from './totals'

// Régime de TVA de l'organisme (marque blanche : rien en dur, tout vient des réglages, 0363) :
//   assujetti : TVA normale sur toutes les lignes ;
//   franchise en base (Paramètres › Identité, « TVA applicable » décoché) : aucune TVA, mention de franchise ;
//   exonération de la formation (Paramètres › Banque et facturation, attestation de la DREETS) : les lignes de
//   formation sont exonérées (0 %, mention d'exonération), les autres prestations restent à la TVA normale.
// On ne retire jamais la TVA pour un client parce qu'il ne la récupère pas : le prix se fixe alors en TTC.

const DEFAUT = { charge: false, franchise: false, exoFormation: false, attestation: null, mentions: {} }
let regime = { ...DEFAUT }

export async function chargerRegimeTva() {
  try {
    const [{ data: o }, { data: b }] = await Promise.all([
      supabase.from('organization_settings').select('tva_applicable').limit(1).maybeSingle(),
      supabase.from('billing_settings').select('exoneration_formation_active, exoneration_attestation_ref, mention_exoneration, mention_franchise, mention_autoliquidation').limit(1).maybeSingle(),
    ])
    regime = {
      charge: true,
      franchise: o?.tva_applicable === false,
      exoFormation: !!b?.exoneration_formation_active,
      attestation: b?.exoneration_attestation_ref || null,
      mentions: { exoneration: b?.mention_exoneration || '', franchise: b?.mention_franchise || '', autoliquidation: b?.mention_autoliquidation || '' },
    }
  } catch { /* réglages illisibles (portail) : régime par défaut */ }
  return regime
}

export const regimeTva = () => regime

// Taux et régime d'une nouvelle ligne selon le régime de l'organisme (formation = ligne liée à une formation)
export function tvaLigne(formation, r = regime) {
  if (r.franchise) return { tva_rate: 0, vat_regime: 'normal' }
  if (r.exoFormation && formation) return { tva_rate: 0, vat_regime: 'exonere' }
  return { tva_rate: 20, vat_regime: 'normal' }
}

// Filet de sécurité à l'enregistrement : franchise = aucune TVA ; exonération = lignes de formation exonérées
export function appliquerRegime(lignes, r = regime) {
  return (lignes || []).map((it) => {
    if (r.franchise) return { ...it, tva_rate: 0, vat_regime: it.vat_regime === 'autoliquidation' ? 'normal' : (it.vat_regime || 'normal') }
    if (r.exoFormation && it.course_id) return { ...it, tva_rate: 0, vat_regime: 'exonere' }
    return it
  })
}

// Mentions de TVA d'un devis (les factures, elles, reçoivent leurs mentions de la base à l'émission)
export function mentionsTvaDevis(lignes, quote, r = regime, formation = false) {
  const m = []
  if (r.franchise) { if (r.mentions.franchise) m.push(r.mentions.franchise); return m }
  if ((lignes || []).some((it) => it.vat_regime === 'exonere')) {
    if (r.mentions.exoneration) m.push(r.mentions.exoneration)
  } else if (quote?.tva_applicable === false && formation && r.exoFormation && r.mentions.exoneration) {
    m.push(r.mentions.exoneration)
  }
  if ((lignes || []).some((it) => it.vat_regime === 'autoliquidation') && r.mentions.autoliquidation) m.push(r.mentions.autoliquidation)
  return m
}

/**
 * Prix unitaires HT pour obtenir un total TTC voulu (client qui ne récupère pas la TVA : le prix convenu est le TTC).
 * Les prix sont ajustés en proportion ; renvoie les lignes et le TTC obtenu (au centime près selon les quantités).
 */
export function ajusterAuTtc(lignes, cibleTtc, taux, calc) {
  const cible = Number(String(cibleTtc).replace(',', '.'))
  const avant = calc(lignes).totalTtc
  if (!(cible > 0) || !(avant > 0)) return null
  const f = cible / avant
  let res = lignes.map((it) => ({ ...it, unit_price_ht: round2((Number(it.unit_price_ht) || 0) * f) }))
  // Écart d'arrondi : reporté sur une ligne de quantité 1 si possible
  const ecart = round2(cible - calc(res).totalTtc)
  if (ecart !== 0) {
    const k = res.findIndex((it) => Number(it.quantity) === 1)
    if (k >= 0) {
      const r = Number(taux) || 0
      res = res.map((it, i) => (i === k ? { ...it, unit_price_ht: round2(Number(it.unit_price_ht) + ecart / (1 + (it.vat_regime && it.vat_regime !== 'normal' ? 0 : r) / 100)) } : it))
    }
  }
  return { lignes: res, ttc: calc(res).totalTtc }
}

// Mentions des devis selon le métier et le client (0444). Les textes viennent des réglages de facturation
// (billing_settings.mentions_devis, Paramètres › Banque et facturation › Devis) : aucune phrase légale figée ici.
// Règle unique pour le PDF du devis et l'écran.

import { supabase } from '../../../core/supabase'
import { metiersPourPieces, documentsAJoindre, pieceValable } from './metierDevis'

export const remplir = (texte, valeurs) => String(texte || '').replace(/\{(\w+)\}/g, (_, k) => (valeurs[k] ?? '').toString()).trim()
// Espaces insécables remplacés : la police du PDF ne les connaît pas
const euros = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0).replace(/[\u00a0\u202f]/g, ' ')
const frDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '')

export const INFOS_DISTANCE = ['Photos', 'Nombre d\'appareils', 'Plans', 'Mesures', 'Descriptif écrit']

/** Total de l'éco-participation comprise dans les lignes (unitaire × quantité) */
export function totalEco(items) {
  return Math.round((items || []).reduce((s, it) => s + (Number(it.eco_ht) || 0) * (Number(it.quantity) || 0), 0) * 100) / 100
}

const tauxReduit = (it) => [10, 5.5].includes(Number(String(it.tva_rate ?? '').replace(',', '.')))

/**
 * Mentions d'un devis.
 * @returns {{ signature: string[], legal: string[], avertissements: string[] }}
 *   signature : textes près du cadre de signature (acceptation des conditions générales, attestation du client pour
 *     le taux réduit de TVA) ; legal : mentions du bas ; avertissements : ce qui manque (écran seulement).
 */
export function mentionsDevis({ quote, items, client, textes, pieces = [], jour = new Date().toISOString().slice(0, 10), avenant = null }) {
  const t = textes && typeof textes === 'object' ? textes : {}
  const q = quote || {}
  const lignes = items || []
  const metiers = metiersPourPieces(q, lignes)
  const particulier = client?.client_type === 'particulier'
  const a = (m) => metiers.includes(m)
  const signature = []
  const legal = []
  const avertissements = []
  const ajout = (liste, cle, valeurs = {}) => { const s = remplir(t[cle], valeurs); if (s) liste.push(s) }

  // Acceptation des conditions générales : sur tout devis qui en joint
  if (documentsAJoindre(q, lignes).some((d) => d.kind === 'cgv')) ajout(signature, 'cgv')
  // Particulier, travaux à taux réduit : attestation du client portée sur le devis signé
  if (particulier && (a('installation') || a('depannage') || a('maintenance')) && lignes.some(tauxReduit)) ajout(signature, 'tva_reduite')

  // Avenant (0446) : rattachement au devis signé et montants (devis, avenants acceptés, écart, nouveau total)
  if (q.amendment_of && avenant) {
    ajout(legal, 'avenant', {
      devis: avenant.reference || '', signe_le: frDate(avenant.signe_le) || '-', montant_devis: euros(avenant.montant_devis),
      avenants: euros(avenant.avenants), ecart: euros(avenant.ecart), nouveau_total: euros((Number(avenant.montant_devis) || 0) + (Number(avenant.avenants) || 0) + (Number(avenant.ecart) || 0)),
    })
  }
  if (q.a_distance) {
    const infos = (Array.isArray(q.a_distance_infos) ? q.a_distance_infos : []).filter(Boolean)
    ajout(legal, 'distance', { date: frDate(q.a_distance_le || q.quote_date), infos: infos.length ? infos.join(', ').toLowerCase() : 'informations transmises' })
  }
  const materiel = a('vente') || (a('installation') && lignes.some((it) => it.nature === 'bien'))
  if (materiel) ajout(legal, 'materiel')
  if (q.acompte_pct && (a('vente') || a('installation'))) ajout(legal, 'acompte', { pct: String(q.acompte_pct).replace('.', ',') })
  if (q.delai_execution && String(q.delai_execution).trim()) ajout(legal, 'delai', { delai: String(q.delai_execution).trim() })
  else if (a('vente') || a('installation')) avertissements.push('Délai de livraison ou d\'intervention à indiquer.')
  const eco = totalEco(lignes)
  if (eco > 0) ajout(legal, 'eco', { montant: euros(eco) })

  if (a('installation')) {
    for (const k of ['rc_pro', 'decennale']) {
      const pc = (pieces || []).find((x) => x.kind === k && pieceValable(x, jour))
      if (pc) ajout(legal, k, { assureur: pc.insurer || '', contrat: pc.policy_number || '', couverture: pc.coverage || '' })
      else avertissements.push(k === 'decennale' ? 'Attestation décennale valable manquante (Paramètres › Banque et facturation › Devis).' : 'Attestation de responsabilité civile professionnelle valable manquante.')
    }
    if (q.dechets && String(q.dechets).trim()) ajout(legal, 'dechets', { dechets: String(q.dechets).trim() })
    else avertissements.push('Déchets de chantier à préciser (quantité, gestion, point de collecte, coût) pour des travaux.')
  }

  if (particulier) {
    if (q.hors_etablissement) ajout(legal, 'retractation')
    if (q.hors_etablissement && q.acompte_pct) avertissements.push('Particulier démarché : aucun acompte ne peut être encaissé avant 7 jours après la signature (article L221-10 du Code de la consommation).')
    if (a('vente')) ajout(legal, 'garanties')
  }
  return { signature, legal, avertissements }
}

// Textes des mentions et pièces de l'entreprise, lus une fois par minute
let cache = null
export async function chargerMentionsDevis({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < 60000) return cache.value
  const value = { textes: {}, pieces: [] }
  try {
    const { data } = await supabase.from('billing_settings').select('mentions_devis').limit(1).maybeSingle()
    if (data?.mentions_devis) value.textes = data.mentions_devis
  } catch { /* réglages illisibles : aucune mention ajoutée */ }
  try {
    const { data } = await supabase.from('company_papers').select('kind, insurer, policy_number, coverage, valid_from, valid_until')
    value.pieces = data || []
  } catch { /* idem */ }
  cache = { at: Date.now(), value }
  return value
}

// Formulaire type de rétractation (annexe à l'article R221-1 du Code de la consommation), joint au devis d'un
// particulier conclu hors établissement ou à distance
export function formulaireRetractation(org) {
  const dest = [org?.legal_name || org?.name, org?.street, [org?.postal_code, org?.city].filter(Boolean).join(' '), org?.email].filter(Boolean).join(', ')
  return [
    '(Veuillez compléter et renvoyer le présent formulaire uniquement si vous souhaitez vous rétracter du contrat.)',
    `À l'attention de ${dest} :`,
    'Je/Nous (*) vous notifie/notifions (*) par la présente ma/notre (*) rétractation du contrat portant sur la vente du bien (*)/pour la prestation de services (*) ci-dessous :',
    'Commandé le (*)/reçu le (*) :',
    'Nom du (des) consommateur(s) :',
    'Adresse du (des) consommateur(s) :',
    'Signature du (des) consommateur(s) (uniquement en cas de notification du présent formulaire sur papier) :',
    'Date :',
    '(*) Rayez la mention inutile.',
  ]
}

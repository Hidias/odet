// Module Stock, socle (0240). Une seule source : les quantités sont calculées depuis les mouvements (v_stock_levels),
// jamais saisies. Les mouvements s'écrivent seulement par public.stock_mouvement() ; ils ne se modifient pas.
// Les prix d'achat (stock_item_costs, v_stock_value) ne se lisent qu'avec « Voir les prix d'achat ».
// Le technicien passe par des fonctions sans aucun prix (stock_mon_stock, stock_articles_terrain, stock_depots_terrain).

import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'

const must = ({ data, error }) => { if (error) throw error; return data }
const nettoyer = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() || null) : v]))

export const TYPES_MOUVEMENT = {
  entree: { label: 'Entrée', aide: 'Réception d\'une livraison', sens: '+' },
  sortie: { label: 'Sortie', aide: 'Utilisé sur un chantier ou vendu', sens: '−' },
  transfert: { label: 'Transfert', aide: 'D\'un emplacement à un autre', sens: '↔' },
  retour: { label: 'Retour', aide: 'Retour au dépôt', sens: '↔' },
  perte: { label: 'Perte ou casse', aide: 'Sortie sans usage', sens: '−' },
  ajustement: { label: 'Ajustement', aide: 'Correction après comptage', sens: '±' },
}
export const TYPES_EMPLACEMENT = { depot: 'Dépôt', technicien: 'Stock d\'un technicien', vehicule: 'Véhicule', chantier: 'Chantier' }

export const qte = (n) => String(Math.round(Number(n || 0) * 1000) / 1000).replace('.', ',')
export const euros = (n) => (n == null ? '' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }))

// ─── Lecture ───
export const chargerArticles = async () => must(await fetchAll(() => supabase.from('stock_items')
  .select('*, stock_categories(name), suppliers(name)').order('label')))
export const chargerCategories = async () => must(await supabase.from('stock_categories').select('*').order('position').order('name'))
export const chargerEmplacements = async () => must(await supabase.from('stock_locations').select('*').order('kind').order('name'))
export const chargerFournisseurs = async () => must(await supabase.from('suppliers').select('*').is('archived_at', null).order('name'))
export const chargerNiveaux = async () => must(await fetchAll(() => supabase.from('v_stock_levels').select('*')))
export const chargerSeuils = async () => must(await supabase.from('stock_thresholds').select('*'))
export const chargerAlertes = async () => must(await supabase.from('v_stock_alerts').select('*').order('to_order', { ascending: false }))
export const chargerMouvements = async ({ itemId = null, limite = 200 } = {}) => {
  let q = supabase.from('stock_movements').select('*').order('created_at', { ascending: false }).limit(limite)
  if (itemId) q = q.eq('item_id', itemId)
  return must(await q)
}
/** Prix d'achat et valeur : vide sans le droit (la base renvoie zéro ligne) */
export const chargerCouts = async () => { const { data } = await supabase.from('stock_item_costs').select('*'); return data || [] }
export const chargerValeur = async () => { const { data } = await supabase.from('v_stock_value').select('*'); return data || [] }

// Terrain (technicien) : sans aucun prix
export const chargerMonStock = async () => must(await supabase.rpc('stock_mon_stock'))
export const chargerArticlesTerrain = async () => must(await supabase.rpc('stock_articles_terrain'))
export const chargerDepotsTerrain = async () => must(await supabase.rpc('stock_depots_terrain'))

// ─── Écriture ───
export async function enregistrerArticle(a, prixAchat = undefined) {
  const { id, stock_categories: _c, suppliers: _s, ...reste } = nettoyer(a)
  reste.sale_price_ht = reste.sale_price_ht === '' || reste.sale_price_ht == null ? null : Number(String(reste.sale_price_ht).replace(',', '.'))
  const ligne = id ? must(await supabase.from('stock_items').update(reste).eq('id', id).select('id').single())
    : must(await supabase.from('stock_items').insert(reste).select('id').single())
  if (prixAchat !== undefined && prixAchat !== '' && prixAchat != null) {
    must(await supabase.from('stock_item_costs').upsert({ item_id: ligne.id, purchase_price_ht: Number(String(prixAchat).replace(',', '.')) }))
  }
  return ligne
}
export const archiverArticle = async (id, actif) => must(await supabase.from('stock_items').update({ is_active: actif }).eq('id', id))

export async function enregistrerEmplacement(l) {
  const { id, ...reste } = nettoyer(l)
  if (id) return must(await supabase.from('stock_locations').update(reste).eq('id', id))
  return must(await supabase.from('stock_locations').insert(reste))
}
export async function enregistrerFournisseur(f) {
  const { id, ...reste } = nettoyer(f)
  if (reste.lead_time_days != null) reste.lead_time_days = Number(reste.lead_time_days) || null
  if (id) return must(await supabase.from('suppliers').update(reste).eq('id', id))
  return must(await supabase.from('suppliers').insert(reste))
}
export const archiverFournisseur = async (id) => must(await supabase.from('suppliers').update({ archived_at: new Date().toISOString() }).eq('id', id))

export async function enregistrerSeuil({ item_id, location_id, min_qty, target_qty }) {
  return must(await supabase.from('stock_thresholds').upsert({
    item_id, location_id, min_qty: Number(String(min_qty || 0).replace(',', '.')),
    target_qty: target_qty === '' || target_qty == null ? null : Number(String(target_qty).replace(',', '.')),
  }, { onConflict: 'item_id,location_id' }))
}

/** Écrire un mouvement (contrôlé par la base : droits, emplacement, sens) */
export async function mouvement({ kind, itemId, quantity, from = null, to = null, note = null, unitCost = null, serial = null }) {
  const q = Number(String(quantity).replace(',', '.'))
  if (!(q > 0)) throw new Error('Indiquez une quantité supérieure à zéro')
  return must(await supabase.rpc('stock_mouvement', {
    p_kind: kind, p_item: itemId, p_quantity: q, p_from: from || null, p_to: to || null, p_note: note || null,
    p_unit_cost: unitCost === '' || unitCost == null ? null : Number(String(unitCost).replace(',', '.')), p_serial: serial || null,
  }))
}

/** Quantité par article (tous emplacements) et par article et emplacement */
export function indexerNiveaux(niveaux) {
  const parArticle = {}
  const parCouple = {}
  for (const n of niveaux || []) {
    parArticle[n.item_id] = (parArticle[n.item_id] || 0) + Number(n.quantity)
    parCouple[`${n.item_id}:${n.location_id}`] = Number(n.quantity)
  }
  return { parArticle, parCouple }
}

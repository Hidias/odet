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
export const chargerNiveaux = async () => must(await fetchAll(() => supabase.from('v_stock_levels').select('*'), { orderBy: ['item_id', 'location_id'] }))
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
  if ('ppe_renew_months' in reste) reste.ppe_renew_months = reste.ppe && reste.ppe_renew_months !== '' && reste.ppe_renew_months != null ? Number(reste.ppe_renew_months) : null
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

// ─── Commandes (0245) ───
export const STATUTS_COMMANDE = {
  brouillon: { label: 'Brouillon', badge: 'badge-neutral' },
  a_valider: { label: 'À valider', badge: 'badge-warning' },
  validee: { label: 'Validée', badge: 'badge-info' },
  envoyee: { label: 'Envoyée', badge: 'badge-info' },
  partielle: { label: 'En partie reçue', badge: 'badge-warning' },
  recue: { label: 'Reçue', badge: 'badge-success' },
  refusee: { label: 'Refusée', badge: 'badge-danger' },
  annulee: { label: 'Annulée', badge: 'badge-neutral' },
}
export const chargerCommandes = async () => must(await supabase.from('purchase_orders')
  .select('*, suppliers(name), stock_locations(name)').order('created_at', { ascending: false }).limit(300))
export const chargerLignesCommande = async (orderId) => must(await supabase.from('purchase_order_lines')
  .select('*, stock_items(label, reference, unit)').eq('order_id', orderId).order('position').order('created_at'))
export const chargerReceptions = async (orderId) => must(await supabase.from('purchase_receipts')
  .select('*').eq('order_id', orderId).order('received_at'))
export const creerCommande = async ({ supplierId, locationId = null, notes = null }) => must(await supabase.rpc('stock_commande_creer', {
  p_supplier: supplierId, p_location: locationId || null, p_notes: notes || null }))
export const commandeDepuisAlertes = async (supplierId, locationId = null) => must(await supabase.rpc('stock_commande_depuis_alertes', {
  p_supplier: supplierId, p_location: locationId || null }))
const nombre = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')))
export async function enregistrerLigne({ id, order_id, item_id, quantity, unit_price_ht }) {
  const ligne = { item_id, quantity: nombre(quantity), unit_price_ht: nombre(unit_price_ht) }
  if (!(ligne.quantity > 0)) throw new Error('Indiquez une quantité supérieure à zéro')
  if (id) return must(await supabase.from('purchase_order_lines').update(ligne).eq('id', id))
  return must(await supabase.from('purchase_order_lines').insert({ ...ligne, order_id }))
}
export const supprimerLigne = async (id) => must(await supabase.from('purchase_order_lines').delete().eq('id', id))
export const modifierCommande = async (id, champs) => must(await supabase.from('purchase_orders').update(champs).eq('id', id))
export const supprimerCommande = async (id) => must(await supabase.from('purchase_orders').delete().eq('id', id))
export const soumettreCommande = async (id) => must(await supabase.rpc('stock_commande_soumettre', { p_order: id }))
export const commandeEnvoyee = async (id) => must(await supabase.rpc('stock_commande_envoyee', { p_order: id }))
export const annulerCommande = async (id) => must(await supabase.rpc('stock_commande_annuler', { p_order: id }))
export const deciderCommande = async (approvalId, decision, motif) => must(await supabase.rpc('approval_decide', {
  p_request: approvalId, p_decision: decision, p_comment: motif || null }))
export const recevoirLigne = async ({ lineId, quantity, locationId = null, note = null }) => must(await supabase.rpc('stock_commande_recevoir', {
  p_line: lineId, p_quantity: nombre(quantity), p_location: locationId || null, p_note: note || null }))

// ─── Inventaires et numéros de série (0247) ───
export const chargerInventaires = async () => must(await supabase.from('stock_counts')
  .select('*, stock_locations(name, kind)').order('started_at', { ascending: false }).limit(100))
export const chargerLignesInventaire = async (countId) => must(await supabase.from('stock_count_lines')
  .select('*').eq('count_id', countId).order('created_at'))
export const ouvrirInventaire = async (locationId, note = null) => must(await supabase.rpc('stock_inventaire_ouvrir', { p_location: locationId, p_note: note || null }))
export const compterArticle = async (countId, itemId, quantity) => must(await supabase.rpc('stock_inventaire_compter', {
  p_count: countId, p_item: itemId, p_quantity: quantity === '' || quantity == null ? null : Number(String(quantity).replace(',', '.')) }))
export const validerInventaire = async (countId) => must(await supabase.rpc('stock_inventaire_valider', { p_count: countId }))
export const annulerInventaire = async (countId) => must(await supabase.rpc('stock_inventaire_annuler', { p_count: countId }))
export const chargerSeries = async (itemId) => must(await supabase.from('stock_serials')
  .select('*, stock_locations(name)').eq('item_id', itemId).order('serial'))
export async function enregistrerSerie(s) {
  const { id, stock_locations: _l, ...reste } = nettoyer(s)
  if (id) return must(await supabase.from('stock_serials').update(reste).eq('id', id))
  return must(await supabase.from('stock_serials').insert(reste))
}

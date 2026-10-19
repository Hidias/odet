// Accès aux données du module Interventions. Clients, sites et contacts : tables existantes, jamais recopiées.
// Techniciens : comptes du personnel (profiles) cochés dans itv_technicians ; nom et téléphone lus dans le compte.

import { supabase } from '../../../core/supabase'
import { fetchAll, fetchAllIn } from '../../../core/fetchAll'
import { profileName } from '../../../core/org/currentOrg'
import { DEFAULT_OPERATION_LABELS, todayIso } from './schedule'
import { computeDocumentTotals, lineTotal } from '../../../core/billing/totals'

const must = ({ data, error }) => { if (error) throw error; return data }

// Prix masqués (droits composés, C1b) : un compte sans le droit « Voir les prix des interventions » (le technicien)
// ne lit aucun prix en base. Il lit les vues sans prix (itv_*_terrain) et écrit les pièces fournies par des
// fonctions qui prennent le prix dans le catalogue. Réglé par la page Interventions à partir des droits lus en base ;
// faux par défaut (droits inconnus : lecture directe des tables, comme avant C1b).
let prixMasques = false
export function setPrixMasques(masques) { prixMasques = !!masques }
export function getPrixMasques() { return prixMasques }
// Listes : pagination complète (PostgREST tronque à 1 000 lignes sans erreur)
const mustAll = async (build, options) => must(await fetchAll(build, options))
const mustAllIn = async (build, column, ids, options) => must(await fetchAllIn(build, column, ids, options))

// ─── Réglages, types, pièces, techniciens ───
export async function loadSettings() {
  const s = must(await supabase.from(prixMasques ? 'itv_settings_terrain' : 'itv_settings').select('*').eq('id', 1).maybeSingle()) || {}
  return { ...s, operation_labels: { ...DEFAULT_OPERATION_LABELS, ...(s.operation_labels || {}) } }
}
export const saveSettings = async (patch) => must(await supabase.from('itv_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1))

export const loadTypes = async () => must(await supabase.from('itv_equipment_types').select('*').order('sort_order').order('name'))
export async function saveType(t) {
  const row = { ...t, updated_at: new Date().toISOString() }
  if (row.id) return must(await supabase.from('itv_equipment_types').update(row).eq('id', row.id).select().single())
  return must(await supabase.from('itv_equipment_types').insert(row).select().single())
}
export async function removeType(id) {
  const { count } = await supabase.from('itv_equipment').select('id', { count: 'exact', head: true }).eq('type_id', id)
  if (count) throw new Error(`Ce type est utilisé par ${count} appareil${count > 1 ? 's' : ''} : désactivez-le plutôt.`)
  return must(await supabase.from('itv_equipment_types').delete().eq('id', id))
}

export const loadParts = async () => must(await supabase.from(prixMasques ? 'itv_parts_terrain' : 'itv_parts').select('*').order('name'))
export async function savePart(p) {
  if (p.id) return must(await supabase.from('itv_parts').update(p).eq('id', p.id).select().single())
  return must(await supabase.from('itv_parts').insert(p).select().single())
}

/** Techniciens : [{ id (profil), name, phone, email, color, is_active }] */
export async function loadTechnicians({ all = false } = {}) {
  const rows = must(await supabase.from('itv_technicians').select('profile_id, color, is_active, profiles(id, first_name, last_name, display_name, email, phone, is_active)'))
  return (rows || [])
    .filter((r) => r.profiles && (all || (r.is_active && r.profiles.is_active)))
    .map((r) => ({ id: r.profile_id, name: profileName(r.profiles), phone: r.profiles.phone, email: r.profiles.email, color: r.color, is_active: r.is_active && r.profiles.is_active }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }))
}
export const loadStaffProfiles = async () => must(await supabase.from('profiles').select('id, first_name, last_name, display_name, email, role, is_active').order('created_at'))
export async function setTechnician(profileId, on, color) {
  if (on) return must(await supabase.from('itv_technicians').upsert({ profile_id: profileId, is_active: true, ...(color ? { color } : {}) }))
  return must(await supabase.from('itv_technicians').update({ is_active: false }).eq('profile_id', profileId))
}
export const setTechnicianColor = async (profileId, color) => must(await supabase.from('itv_technicians').update({ color }).eq('profile_id', profileId))

// ─── Clients et sites (tables existantes) ───
export const loadClientsLight = async () => mustAll(() => supabase.from('clients').select('id, name, city, postal_code, address').order('name'))
export const loadClient = async (id) => must(await supabase.from('clients').select('id, name, address, postal_code, city, siret, contact_name, contact_phone, contact_email, email').eq('id', id).single())
export const loadSites = async (clientId) => must(await supabase.from('sites').select('*').eq('client_id', clientId).order('name'))
export const loadPrimaryContact = async (clientId) => {
  const rows = must(await supabase.from('client_contacts').select('id, name, first_name, last_name, fonction, role, phone, mobile, email, is_primary').eq('client_id', clientId).order('is_primary', { ascending: false }).limit(1))
  return rows?.[0] || null
}

/** Position d'une adresse par l'API Adresse de l'État (gratuite, sans clé). Retourne { lat, lng } ou null. */
export async function geocode(address, postalCode, city) {
  const q = [address, postalCode, city].filter(Boolean).join(' ').trim()
  if (q.length < 4) return null
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1${postalCode ? `&postcode=${encodeURIComponent(postalCode)}` : ''}`
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) })
    const j = await r.json()
    const c = j?.features?.[0]?.geometry?.coordinates
    return c ? { lat: c[1], lng: c[0] } : null
  } catch { return null }
}

/** Crée ou modifie un site du client ; la position est calculée depuis l'adresse si elle manque ou si l'adresse change */
export async function saveSite(site) {
  const row = { kind: 'client', is_active: true, ...site }
  const before = row.id ? must(await supabase.from('sites').select('address, postal_code, city, latitude').eq('id', row.id).single()) : null
  const moved = !before || before.address !== row.address || before.postal_code !== row.postal_code || before.city !== row.city || before.latitude == null
  if (moved) {
    const g = await geocode(row.address, row.postal_code, row.city)
    if (g) { row.latitude = g.lat; row.longitude = g.lng }
  }
  if (row.id) return must(await supabase.from('sites').update(row).eq('id', row.id).select().single())
  return must(await supabase.from('sites').insert(row).select().single())
}

/** Site par défaut créé depuis l'adresse de la fiche client (aucune ressaisie).
 *  Depuis 0041, la base crée elle-même ce site avec le client : s'il existe déjà (même archivé), il est réactivé
 *  au lieu d'en créer un second (un seul site « adresse de la fiche » par client). */
export async function createDefaultSite(client) {
  const existant = must(await supabase.from('sites').select('id').eq('client_id', client.id).eq('is_default', true).limit(1))?.[0]
  if (existant) return saveSite({ id: existant.id, client_id: client.id, is_active: true })
  return saveSite({ client_id: client.id, name: 'Site principal', address: client.address, postal_code: client.postal_code, city: client.city, is_default: true })
}

// ─── Parc ───
const EQUIP_COLS = '*, itv_equipment_types(id, name, family, verification_months, operations, lifespan_years, defects, fields), sites(id, name, city)'
export const loadEquipmentForClient = async (clientId) => must(await supabase.from('itv_equipment').select(EQUIP_COLS).eq('client_id', clientId).neq('status', 'retire').order('site_id').order('location'))
export const loadEquipmentForSite = async (siteId) => must(await supabase.from('itv_equipment').select(EQUIP_COLS).eq('site_id', siteId).neq('status', 'retire').order('location'))
export const loadEquipmentByCode = async (code) => must(await supabase.from('itv_equipment').select(`${EQUIP_COLS}, clients(id, name)`).ilike('label_code', String(code).trim()).maybeSingle())

export async function saveEquipment(e) {
  const row = { ...e, updated_at: new Date().toISOString() }
  delete row.itv_equipment_types; delete row.sites; delete row.clients
  if (!row.label_code) {
    const codes = must(await supabase.rpc('itv_next_label', { p_count: 1 }))
    row.label_code = codes[0]
  }
  if (row.id) return must(await supabase.from('itv_equipment').update(row).eq('id', row.id).select().single())
  return must(await supabase.from('itv_equipment').insert(row).select().single())
}
export const retireEquipment = async (id) => must(await supabase.from('itv_equipment').update({ status: 'retire', updated_at: new Date().toISOString() }).eq('id', id))

/** Historique d'un appareil : lignes de visite terminées, de la plus récente à la plus ancienne */
export async function loadEquipmentHistory(equipmentId) {
  const rows = must(await supabase.from('itv_visit_items')
    .select('id, operation, result, defect, observation, checked_at, itv_visits!inner(id, reference, status, started_at, planned_on, finished_at, technician_id, profiles:technician_id(first_name, last_name, display_name, email))')
    .eq('equipment_id', equipmentId))
  return (rows || [])
    .filter((r) => r.itv_visits?.status === 'terminee')
    .map((r) => ({ ...r, day: (r.itv_visits.started_at || r.itv_visits.finished_at || r.itv_visits.planned_on || '').slice(0, 10), technician: r.itv_visits.profiles ? profileName(r.itv_visits.profiles) : '' }))
    .sort((a, b) => (b.day || '').localeCompare(a.day || ''))
}

/** Opérations déjà faites (pour ne pas reproposer une maintenance additionnelle faite) : { equipment_id: [{ operation, year }] } */
export async function loadDoneOperations(equipmentIds) {
  if (!equipmentIds.length) return {}
  const rows = await mustAllIn(() => supabase.from('itv_visit_items')
    .select('equipment_id, operation, result, itv_visits!inner(status, started_at, planned_on)')
    .neq('operation', 'verification'), 'equipment_id', equipmentIds)
  const out = {}
  for (const r of rows || []) {
    if (r.itv_visits?.status !== 'terminee' || !['conforme', 'remplace'].includes(r.result)) continue
    const y = Number((r.itv_visits.started_at || r.itv_visits.planned_on || '').slice(0, 4))
    ;(out[r.equipment_id] = out[r.equipment_id] || []).push({ operation: r.operation, year: y })
  }
  return out
}

// ─── Contrats ───
export const loadContracts = async (clientId = null) => {
  return mustAll(() => {
    let q = supabase.from('itv_contracts').select('*, clients(id, name, city)').order('created_at', { ascending: false })
    if (clientId) q = q.eq('client_id', clientId)
    return q
  })
}
export async function saveContract(c) {
  const row = { ...c, updated_at: new Date().toISOString() }
  delete row.clients
  if (row.id) return must(await supabase.from('itv_contracts').update(row).eq('id', row.id).select().single())
  return must(await supabase.from('itv_contracts').insert(row).select().single())
}
export const generateContractVisits = async (contractId, year) => must(await supabase.rpc('itv_generate_contract_visits', { p_contract: contractId, p_year: year }))

// ─── Visites ───
const VISIT_COLS = '*, clients(id, name, city), sites(id, name, address, postal_code, city, latitude, longitude, access_notes), itv_contracts(id, label, annual_price_ht)'
export async function loadVisits({ from = null, to = null, technicianId = null, status = null, clientId = null, siteId = null } = {}) {
  return mustAll(() => {
    let q = supabase.from('itv_visits').select(VISIT_COLS)
    if (from) q = q.gte('planned_on', from)
    if (to) q = q.lte('planned_on', to)
    if (technicianId) q = q.eq('technician_id', technicianId)
    if (status) q = Array.isArray(status) ? q.in('status', status) : q.eq('status', status)
    if (clientId) q = q.eq('client_id', clientId)
    if (siteId) q = q.eq('site_id', siteId)
    return q.order('planned_on', { ascending: true, nullsFirst: false }).order('route_order')
  })
}
export const loadVisit = async (id) => must(await supabase.from('itv_visits').select(VISIT_COLS).eq('id', id).single())
export const loadVisitItems = async (visitId) => must(await supabase.from('itv_visit_items').select('*').eq('visit_id', visitId))
export const loadVisitParts = async (visitId) => must(await supabase.from(prixMasques ? 'itv_visit_parts_terrain' : 'itv_visit_parts').select('*').eq('visit_id', visitId).order('created_at'))
export const updateVisit = async (id, patch) => must(await supabase.from('itv_visits').update(patch).eq('id', id).select().single())
export const createVisit = async (row) => must(await supabase.from('itv_visits').insert(row).select().single())

/** Démarre une visite : statut en cours, heure d'arrivée, lignes créées pour tous les appareils du site (opération proposée) */
export async function startVisit(visit, equipmentWithOps) {
  const items = await loadVisitItems(visit.id)
  const have = new Set(items.map((i) => i.equipment_id))
  const missing = equipmentWithOps.filter((e) => !have.has(e.id)).map((e) => ({ visit_id: visit.id, equipment_id: e.id, operation: e.suggested?.code || 'verification' }))
  if (missing.length) must(await supabase.from('itv_visit_items').insert(missing))
  if (visit.status !== 'en_cours' && visit.status !== 'terminee') {
    await updateVisit(visit.id, { status: 'en_cours', started_at: visit.started_at || new Date().toISOString(), planned_on: visit.planned_on || todayIso() })
  }
  return loadVisitItems(visit.id)
}
export const saveVisitItem = async (id, patch) => must(await supabase.from('itv_visit_items').update({ ...patch, checked_at: new Date().toISOString() }).eq('id', id).select().single())
export const addVisitItem = async (row) => must(await supabase.from('itv_visit_items').insert(row).select().single())
// Pièces fournies. Prix masqués : par les fonctions de la base (le prix unitaire n'est ni envoyé ni renvoyé)
export async function addVisitPart(row) {
  if (prixMasques) {
    return must(await supabase.rpc('itv_visit_part_add', {
      p_visit: row.visit_id, p_part: row.part_id || null, p_label: row.label || null, p_quantity: Number(row.quantity || 1),
    }))
  }
  return must(await supabase.from('itv_visit_parts').insert(row).select().single())
}
export async function updateVisitPart(id, patch) {
  if (prixMasques) {
    // Seule la quantité est modifiable sur le terrain
    return must(await supabase.rpc('itv_visit_part_set_quantity', { p_id: id, p_quantity: Number(patch.quantity) }))
  }
  return must(await supabase.from('itv_visit_parts').update(patch).eq('id', id))
}
export async function removeVisitPart(id) {
  if (prixMasques) return must(await supabase.rpc('itv_visit_part_remove', { p_id: id }))
  return must(await supabase.from('itv_visit_parts').delete().eq('id', id))
}
export const closeVisit = async (id) => must(await supabase.rpc('itv_close_visit', { p_visit: id }))

// ─── Photos (bucket privé « interventions ») ───
export async function uploadPhoto(visitId, file) {
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `visites/${visitId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('interventions').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
  if (error) throw error
  return path
}
export async function photoUrl(path) {
  const { data } = await supabase.storage.from('interventions').createSignedUrl(path, 3600)
  return data?.signedUrl || null
}
export async function photoDataUrl(path) {
  const { data, error } = await supabase.storage.from('interventions').download(path)
  if (error || !data) return null
  return new Promise((resolve) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = () => resolve(null)
    fr.readAsDataURL(data)
  })
}

/** Réduit une photo avant envoi (côté le plus long 1600 px, JPEG) : moins de données mobiles sur le terrain */
export async function shrinkImage(file, max = 1600) {
  if (!file?.type?.startsWith('image/')) return file
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82))
    return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file
  } catch { return file }
}

// ─── À planifier : sites dont des appareils arrivent à échéance, et visites de contrat non planifiées ───
export async function loadDueSites(horizonIso) {
  const [eq, open] = await Promise.all([
    mustAll(() => supabase.from('itv_equipment').select('id, site_id, client_id, next_check_on, type_id, itv_equipment_types(name, family)').neq('status', 'retire').lte('next_check_on', horizonIso)),
    mustAll(() => supabase.from('itv_visits').select(VISIT_COLS).in('status', ['a_planifier', 'planifiee', 'en_cours'])),
  ])
  const bySite = new Map()
  for (const e of eq || []) {
    const s = bySite.get(e.site_id) || { site_id: e.site_id, client_id: e.client_id, count: 0, first_due: e.next_check_on, families: {} }
    s.count += 1
    if (e.next_check_on < s.first_due) s.first_due = e.next_check_on
    const fam = e.itv_equipment_types?.family || 'Autre'
    s.families[fam] = (s.families[fam] || 0) + 1
    bySite.set(e.site_id, s)
  }
  // Sites déjà planifiés : retirés de la liste ; visites de contrat à planifier : ajoutées
  const planned = new Set((open || []).filter((v) => v.status !== 'a_planifier').map((v) => v.site_id))
  const pending = (open || []).filter((v) => v.status === 'a_planifier')
  for (const v of pending) {
    if (!bySite.has(v.site_id)) bySite.set(v.site_id, { site_id: v.site_id, client_id: v.client_id, count: 0, first_due: v.due_on, families: {} })
    const s = bySite.get(v.site_id)
    s.pending_visit = v
    if (v.due_on && (!s.first_due || v.due_on < s.first_due)) s.first_due = v.due_on
  }
  const ids = [...bySite.keys()].filter((id) => !planned.has(id))
  if (!ids.length) return []
  const sites = await mustAllIn(() => supabase.from('sites').select('id, name, address, postal_code, city, latitude, longitude, client_id, clients(id, name)'), 'id', ids)
  const contracts = await mustAll(() => supabase.from('itv_contracts').select('client_id').eq('status', 'actif'))
  const withContract = new Set((contracts || []).map((c) => c.client_id))
  return (sites || []).map((s) => ({ ...bySite.get(s.id), site: s, client: s.clients, contract: withContract.has(s.client_id) }))
    .sort((a, b) => (a.first_due || '9999').localeCompare(b.first_due || '9999'))
}

/** Place un site sur un jour et un technicien : reprend la visite à planifier si elle existe, sinon en crée une */
export async function planSite(due, { day, technicianId, order = 99, time = null }) {
  if (due.pending_visit) return updateVisit(due.pending_visit.id, { planned_on: day, technician_id: technicianId, route_order: order, planned_time: time, status: 'planifiee' })
  return createVisit({ client_id: due.client_id, site_id: due.site_id, due_on: due.first_due, planned_on: day, technician_id: technicianId, route_order: order, planned_time: time, status: 'planifiee' })
}

/** Nouvel ordre de passage d'une journée : ids dans l'ordre */
export async function reorderVisits(ids) {
  await Promise.all(ids.map((id, i) => supabase.from('itv_visits').update({ route_order: i + 1 }).eq('id', id)))
}

// ─── Factures et devis pré-remplis (tables existantes, brouillons) ───
async function nextRef(table, prefix) {
  const ds = todayIso().replace(/-/g, '')
  const { data } = await supabase.from(table).select('reference').like('reference', `${prefix}-%`).order('reference', { ascending: false }).limit(1)
  let seq = 1
  const m = data?.[0]?.reference?.match(/-(\d+)$/)
  if (m) seq = parseInt(m[1], 10) + 1
  return `${prefix}-${ds}-${String(seq).padStart(5, '0')}`
}
function totals(lines, tvaRate) {
  // Même calcul que les factures (src/core/billing/totals.js)
  const t = computeDocumentTotals(lines.map((l) => ({ ...l, tva_rate: l.tva_rate ?? tvaRate })))
  return { ht: t.taxBasis, tva: t.taxTotal, ttc: t.grandTotal }
}
async function currentUserName() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('first_name, last_name, display_name, email').eq('id', user.id).maybeSingle()
  return data ? profileName(data) : null
}

/** Lignes de facture d'une visite : forfait du contrat ou forfait de visite, puis pièces fournies */
export function invoiceLinesForVisit(visit, parts, settings) {
  const tva = Number(settings?.tva_rate ?? 20)
  const lines = []
  const day = (visit.started_at || visit.planned_on || '').slice(0, 10)
  if (visit.itv_contracts) {
    lines.push({ description_title: visit.itv_contracts.label || 'Contrat de maintenance', description_detail: `Visite du ${day.split('-').reverse().join('/')} - ${visit.sites?.name || ''}`, quantity: 1, unit: 'forfait', unit_price_ht: Number(visit.itv_contracts.annual_price_ht || 0), tva_rate: tva })
  } else {
    lines.push({ description_title: 'Visite de vérification du matériel de sécurité', description_detail: `${visit.reference || ''} du ${day.split('-').reverse().join('/')} - ${visit.sites?.name || ''}`, quantity: 1, unit: 'forfait', unit_price_ht: Number(settings?.visit_fee_ht || 0), tva_rate: tva })
  }
  // Pièces fournies : livraisons de biens (nature de l'opération, 0363) ; forfaits : prestations de services
  for (const p of parts || []) lines.push({ description_title: p.label, description_detail: '', quantity: Number(p.quantity || 1), unit: 'unité', unit_price_ht: Number(p.unit_price_ht || 0), tva_rate: tva, nature: 'bien' })
  return lines
}

export async function createInvoiceDraft(visit, parts, settings) {
  const lines = invoiceLinesForVisit(visit, parts, settings)
  const t = totals(lines, settings?.tva_rate ?? 20)
  const contact = await loadPrimaryContact(visit.client_id)
  const inv = must(await supabase.from('invoices').insert({
    // Aucun numéro avant l'émission : la base remplace cette référence provisoire (0362) et numérote à l'émission (0361)
    reference: 'BROUILLON-' + Math.random().toString(36).slice(2, 12).toUpperCase(), type: 'invoice', client_id: visit.client_id, contact_id: contact?.id || null,
    invoice_date: todayIso(), service_start_date: (visit.started_at || visit.planned_on || '').slice(0, 10) || null, service_end_date: (visit.started_at || visit.planned_on || '').slice(0, 10) || null,
    object: `Vérification du matériel de sécurité, visite ${visit.reference || ''}`.trim(), status: 'draft', is_formation_pro: false, tva_applicable: true,
    total_ht: t.ht, total_discount: 0, total_net_ht: t.ht, total_tva: t.tva, total_ttc: t.ttc, amount_paid: 0, amount_due: t.ttc,
    created_by: await currentUserName(),
  }).select().single())
  must(await supabase.from('invoice_items').insert(lines.map((l, i) => ({ ...l, invoice_id: inv.id, position: i, total_ht: lineTotal(l) }))))
  await updateVisit(visit.id, { invoice_id: inv.id })
  return inv
}

/** Devis des appareils à remplacer d'une visite (prix à compléter) */
export async function createReplacementQuote(visit, items, equipmentById, settings) {
  const tva = Number(settings?.tva_rate ?? 20)
  const lines = items.filter((i) => i.result === 'a_remplacer').map((i) => {
    const e = equipmentById[i.equipment_id] || {}
    return { description_title: `Remplacement : ${e.itv_equipment_types?.name || 'appareil'}`, description_detail: [e.label_code, e.location, i.defect].filter(Boolean).join(' - '), quantity: 1, unit: 'unité', unit_price_ht: 0, tva_rate: tva }
  })
  if (!lines.length) throw new Error('Aucun appareil à remplacer sur cette visite.')
  const contact = await loadPrimaryContact(visit.client_id)
  const d = new Date(); d.setDate(d.getDate() + 30)
  const q = must(await supabase.from('quotes').insert({
    reference: await nextRef('quotes', 'DEV'), client_id: visit.client_id, contact_id: contact?.id || null,
    quote_date: todayIso(), validity_date: d.toISOString().slice(0, 10), payment_deadline: d.toISOString().slice(0, 10),
    object: `Remplacement de matériel de sécurité, suite à la visite ${visit.reference || ''}`.trim(), status: 'draft',
    tva_rate: tva, tva_applicable: true, total_ht: 0, total_tva: 0, total_ttc: 0, created_by: await currentUserName(),
  }).select().single())
  must(await supabase.from('quote_items').insert(lines.map((l, i) => ({ ...l, quote_id: q.id, position: i, total_ht: 0 }))))
  await updateVisit(visit.id, { quote_id: q.id })
  return q
}

// ─── Tableau de bord ───
export const loadDashboard = async () => must(await supabase.rpc('itv_dashboard'))

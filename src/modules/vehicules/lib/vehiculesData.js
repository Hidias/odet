// Module Véhicules (0320) : parc, attributions, kilométrage, échéances, pleins, entretiens et incidents.
// Le kilométrage n'est jamais tapé deux fois : il vient des pleins, des entretiens, des états des lieux et des relevés.
// Les anomalies d'un plein sont signalées par la base (statut « à vérifier »), jamais corrigées en silence.

import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'
import { compresser } from '../../../core/feedback/retours'
import { FILTRE_EQUIPE } from '../../../core/org/currentOrg'

const must = ({ data, error }) => { if (error) throw error; return data }
export const nombre = (v) => (v === '' || v == null ? null : Number(String(v).replace(/\s/g, '').replace(',', '.')))
const propre = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() || null) : v]))

export const ENERGIES = { gazole: 'Gazole', essence: 'Essence', electrique: 'Électrique', hybride: 'Hybride', gpl: 'GPL', autre: 'Autre' }
export const ACQUISITIONS = { achat: 'Achat comptant', credit: 'Achat à crédit', lld: 'Location longue durée', loa: 'Location avec option d\'achat', credit_bail: 'Crédit-bail' }
export const STATUTS = { actif: 'En service', immobilise: 'Immobilisé', vendu: 'Vendu', restitue: 'Restitué' }
export const REGLES = { vidange: 'Vidange', pneus: 'Pneus', freins: 'Freins', revision: 'Révision', controle_technique: 'Contrôle technique', autre: 'Autre' }
export const EVENEMENTS = { entretien: 'Entretien', reparation: 'Réparation', controle_technique: 'Contrôle technique', sinistre: 'Sinistre', panne: 'Panne', immobilisation: 'Immobilisation' }
export const ETATS = { depassee: ['Dépassée', 'badge-danger'], bientot: ['Bientôt', 'badge-warning'], ok: ['À jour', 'badge-success'], inconnue: ['À renseigner', 'badge-neutral'] }

export const euros = (n) => (n == null ? '' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }))
export const km = (n) => (n == null ? '' : `${Number(n).toLocaleString('fr-FR')} km`)

export const chargerVehicules = async () => must(await supabase.from('vehicles').select('*').order('plate'))
export const chargerAttributions = async () => must(await supabase.from('vehicle_assignments').select('*').order('start_on', { ascending: false }))
export const chargerKm = async () => {
  const rows = must(await fetchAll(() => supabase.from('vehicle_odometer').select('vehicle_id, km')))
  const parV = {}
  for (const r of rows) parV[r.vehicle_id] = Math.max(parV[r.vehicle_id] || 0, r.km)
  return parV
}
export const chargerEcheances = async () => must(await supabase.from('v_vehicle_deadlines').select('*'))
export const chargerPleins = async (vehicleId = null) => {
  let q = supabase.from('vehicle_fuel').select('*').order('filled_at', { ascending: false }).limit(300)
  if (vehicleId) q = q.eq('vehicle_id', vehicleId)
  return must(await q)
}
export const chargerConsommation = async (vehicleId) => must(await supabase.from('v_vehicle_consumption').select('*').eq('vehicle_id', vehicleId).order('filled_at'))
export const chargerEvenements = async (vehicleId) => must(await supabase.from('vehicle_events').select('*').eq('vehicle_id', vehicleId).order('happened_on', { ascending: false }))
export const chargerRegles = async (vehicleId) => must(await supabase.from('vehicle_maintenance_rules').select('*').eq('vehicle_id', vehicleId).order('kind'))
export const chargerComptes = async () => must(await supabase.from('profiles').select('id, first_name, last_name, display_name, email, is_active').or(FILTRE_EQUIPE).order('last_name'))
export const nomCompte = (p) => (p ? (`${p.first_name || ''} ${p.last_name || ''}`.trim() || p.display_name || p.email) : '')

export async function enregistrerVehicule(v) {
  const { id, created_at: _c, updated_at: _u, company_id: _co, ...reste } = propre(v)
  if (id) return must(await supabase.from('vehicles').update(reste).eq('id', id).select('id').single())
  return must(await supabase.from('vehicles').insert(reste).select('id').single())
}
export async function attribuer({ vehicleId, profileId, startKm, startFuel, startNotes }) {
  return must(await supabase.from('vehicle_assignments').insert({
    vehicle_id: vehicleId, profile_id: profileId, start_km: nombre(startKm), start_fuel: startFuel || null, start_notes: startNotes || null,
  }))
}
export async function restituer({ id, endKm, endFuel, endNotes }) {
  return must(await supabase.from('vehicle_assignments').update({
    end_on: new Date().toISOString().slice(0, 10), end_km: nombre(endKm), end_fuel: endFuel || null, end_notes: endNotes || null,
  }).eq('id', id))
}
export const releverKm = async (vehicleId, valeur) => must(await supabase.from('vehicle_odometer').insert({ vehicle_id: vehicleId, km: nombre(valeur), source: 'saisie' }))
export async function enregistrerRegle(r) {
  const { id, created_at: _c, updated_at: _u, company_id: _co, ...reste } = propre(r)
  for (const k of ['every_km', 'every_months', 'last_km', 'alert_days', 'alert_km']) if (k in reste) reste[k] = nombre(reste[k])
  if (reste.alert_days == null) delete reste.alert_days
  if (reste.alert_km == null) delete reste.alert_km
  if (id) return must(await supabase.from('vehicle_maintenance_rules').update(reste).eq('id', id))
  return must(await supabase.from('vehicle_maintenance_rules').insert(reste))
}
export const supprimerRegle = async (id) => must(await supabase.from('vehicle_maintenance_rules').delete().eq('id', id))
export async function enregistrerEvenement(e) {
  const { id, created_at: _c, updated_at: _u, company_id: _co, created_by: _b, ...reste } = propre(e)
  reste.km = nombre(reste.km); reste.cost_ttc = nombre(reste.cost_ttc)
  for (const k of ['deductible', 'indemnity']) if (k in reste) reste[k] = nombre(reste[k])
  for (const k of ['claim_declared_on', 'claim_status', 'at_fault']) if (k in reste && !reste[k]) reste[k] = null
  if (id) return must(await supabase.from('vehicle_events').update(reste).eq('id', id))
  return must(await supabase.from('vehicle_events').insert(reste).select('id').single())
}
export const marquerVerifie = async (id) => must(await supabase.from('vehicle_fuel').update({ status: 'normal' }).eq('id', id))

async function empreinte(blob) {
  const buf = await blob.arrayBuffer()
  const h = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Plein : photo du ticket compressée (facultative), envoyée dans le bucket privé, puis la ligne */
export async function enregistrerPlein({ vehicle, kmValue, liters, amount, fullTank = true, station = '', toReimburse = false, photo = null }) {
  const ligne = {
    vehicle_id: vehicle.id, km: nombre(kmValue), liters: nombre(liters), amount_ttc: nombre(amount),
    full_tank: !!fullTank, station: station.trim() || null, to_reimburse: !!toReimburse, fuel: vehicle.energy,
  }
  if (!(ligne.km >= 0) || !(ligne.liters > 0) || !(ligne.amount_ttc >= 0)) throw new Error('Kilométrage, litres et montant sont nécessaires')
  if (photo) {
    const data = await compresser(photo)
    const blob = await (await fetch(data)).blob()
    ligne.receipt_hash = await empreinte(blob)
    const chemin = `${vehicle.company_id}/${vehicle.id}/${Date.now()}-ticket.jpg`
    must(await supabase.storage.from('vehicules').upload(chemin, blob, { contentType: 'image/jpeg' }))
    ligne.receipt_path = chemin
  }
  return must(await supabase.from('vehicle_fuel').insert(ligne).select('id, status, anomaly').single())
}
export async function lienTicket(chemin) {
  const { data, error } = await supabase.storage.from('vehicules').createSignedUrl(chemin, 120)
  if (error) throw error
  return data.signedUrl
}

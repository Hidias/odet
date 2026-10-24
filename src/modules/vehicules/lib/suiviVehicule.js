// Suivi des véhicules (0448) : avis de contravention et désignation du conducteur (45 jours), équipements du véhicule
// (extincteur, trousse de secours…), coût total par véhicule. Le conducteur est retrouvé par la base dans les
// attributions : rien n'est cherché à la main.

import { supabase } from '../../../core/supabase'

const must = ({ data, error }) => { if (error) throw error; return data }
const nombre = (v) => (v === '' || v == null ? null : Number(String(v).replace(/\s/g, '').replace(',', '.')))
const vide = (v) => (typeof v === 'string' ? (v.trim() || null) : v)

export const STATUTS_AMENDE = { a_designer: 'Conducteur à désigner', designe: 'Conducteur désigné', conteste: 'Contestée', paye: 'Payée', classe: 'Classée' }
export const EQUIPEMENTS = { extincteur: 'Extincteur', trousse_secours: 'Trousse de secours', gilet: 'Gilet haute visibilité', triangle: 'Triangle de présignalisation', autre: 'Autre équipement' }
// Désignation en ligne du conducteur (service public)
export const ANTAI = 'https://www.antai.gouv.fr'

const jour = (d = new Date()) => d.toISOString().slice(0, 10)

// ── Avis de contravention ──
export const chargerAmendes = async (vehicleId) => must(await supabase.from('vehicle_fines').select('*').eq('vehicle_id', vehicleId).order('offense_at', { ascending: false }))
export const conducteurA = async (vehicleId, at) => must(await supabase.rpc('vehicule_conducteur_a', { p_vehicle: vehicleId, p_at: at }))

export async function enregistrerAmende(a) {
  const { id, created_at: _c, updated_at: _u, company_id: _co, created_by: _b, deadline_on: _d, driver_source: _s, ...reste } = a
  const ligne = Object.fromEntries(Object.entries(reste).map(([k, v]) => [k, vide(v)]))
  ligne.amount = nombre(ligne.amount)
  if (!ligne.offense_at || !ligne.notice_on) throw new Error('Date de l\'infraction et date de l\'avis sont nécessaires')
  if (id) return must(await supabase.from('vehicle_fines').update(ligne).eq('id', id).select('*').single())
  return must(await supabase.from('vehicle_fines').insert(ligne).select('*').single())
}

/** Où en est la désignation : en retard, à faire (jours restants), faite */
export function echeanceAmende(f, j = jour()) {
  if (!f) return null
  if (f.status !== 'a_designer') return { etat: 'fait', texte: f.designated_on ? `Désigné le ${new Date(f.designated_on).toLocaleDateString('fr-FR')}` : STATUTS_AMENDE[f.status] }
  const reste = Math.round((new Date(f.deadline_on) - new Date(j)) / 86400000)
  const le = new Date(f.deadline_on).toLocaleDateString('fr-FR')
  if (reste < 0) return { etat: 'retard', texte: `Désignation en retard (limite le ${le})` }
  return { etat: 'afaire', texte: `À désigner avant le ${le} (${reste} jour${reste > 1 ? 's' : ''})` }
}

/** Ce qu'il faut pour désigner : fiche du personnel lue seulement si les droits RH le permettent (sinon à compléter) */
export async function ficheDesignation(profileId) {
  if (!profileId) return null
  const { data: p } = await supabase.from('hr_people').select('id, first_name, last_name, usage_name, birth_date, personal_address, personal_postal_code, personal_city').eq('profile_id', profileId).is('archived_at', null).limit(1).maybeSingle()
  if (!p) return null
  const { data: permis } = await supabase.from('hr_qualifications').select('label, obtained_on, issuer').eq('person_id', p.id).eq('kind', 'permis').is('archived_at', null).order('obtained_on', { ascending: false }).limit(1).maybeSingle()
  return { ...p, permis: permis || null }
}

// ── Équipements ──
export const chargerEquipements = async (vehicleId) => must(await supabase.from('vehicle_equipment').select('*').eq('vehicle_id', vehicleId).order('kind'))
export async function enregistrerEquipement(q) {
  const { id, created_at: _c, updated_at: _u, company_id: _co, ...reste } = q
  const ligne = Object.fromEntries(Object.entries(reste).map(([k, v]) => [k, vide(v)]))
  if (id) return must(await supabase.from('vehicle_equipment').update(ligne).eq('id', id))
  return must(await supabase.from('vehicle_equipment').insert(ligne))
}
export const supprimerEquipement = async (id) => must(await supabase.from('vehicle_equipment').delete().eq('id', id))

// ── Coût total ──
/** Mois entiers écoulés entre deux dates (au moins 0) */
export function moisEntre(debut, fin) {
  if (!debut || !fin || fin < debut) return 0
  const [a1, m1, j1] = debut.split('-').map(Number)
  const [a2, m2, j2] = fin.split('-').map(Number)
  return Math.max(0, (a2 - a1) * 12 + (m2 - m1) - (j2 < j1 ? 1 : 0))
}

/**
 * Coût total d'un véhicule depuis son entrée dans le parc : prix d'achat (achat comptant ; un crédit compte ses
 * mensualités), loyers ou mensualités, assurance, carburant,
 * entretiens et réparations, sinistres nets (réparation payée ou franchise, moins l'indemnité), amendes payées par la société.
 */
export function coutTotal({ vehicule, pleins = [], evenements = [], amendes = [], jusqua = jour() }) {
  const v = vehicule || {}
  const fin = v.contract_end_on && v.contract_end_on < jusqua ? v.contract_end_on : jusqua
  const mois = moisEntre(v.acquired_on, fin)
  const somme = (l, f) => l.reduce((t, x) => t + (Number(f(x)) || 0), 0)
  const parts = {
    achat: v.acquisition === 'achat' ? Number(v.purchase_price_ttc) || 0 : 0,
    loyers: v.acquired_on ? (Number(v.monthly_cost_ttc) || 0) * mois : 0,
    assurance: v.acquired_on ? Math.round((Number(v.insurance_annual_ttc) || 0) * mois / 12 * 100) / 100 : 0,
    carburant: somme(pleins, (p) => p.amount_ttc),
    entretien: somme(evenements.filter((e) => e.kind !== 'sinistre'), (e) => e.cost_ttc),
    sinistres: somme(evenements.filter((e) => e.kind === 'sinistre'), (e) => (e.cost_ttc ?? e.deductible ?? 0) - (e.indemnity ?? 0)),
    amendes: somme(amendes.filter((f) => f.paid_by_company), (f) => f.amount),
  }
  const total = Math.round(Object.values(parts).reduce((t, x) => t + x, 0) * 100) / 100
  return { parts, total, mois, parMois: mois > 0 ? Math.round(total / mois * 100) / 100 : null }
}

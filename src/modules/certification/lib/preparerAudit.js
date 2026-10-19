// « Préparer l'audit » (chantier F, spec § 7) : montrer la pratique réelle, pas une vitrine.
// APSAD : sites où les opérations périodiques ont vraiment été faites (à proposer à l'auditeur), opérations dues non
// faites, remplacements sans motif. Qualiopi : sessions terminées complètes ou à compléter (l'auditeur choisit son
// échantillon). Lecture seule, droits de la base ; aucune donnée de la face interne.

import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'
import { periodicOperations, PERIODIC_OPERATIONS } from '../../interventions/lib/schedule'

const must = ({ data, error }) => { if (error) throw error; return data }

/** Date ISO (AAAA-MM-JJ) il y a n mois */
export function ilYa(mois, aujourdhui = new Date()) {
  const d = new Date(aujourdhui)
  d.setMonth(d.getMonth() - mois)
  return d.toISOString().slice(0, 10)
}

/**
 * Sites à proposer à l'auditeur : opérations périodiques réellement faites (résultat « conforme ») sur une visite
 * terminée depuis la date donnée. lignes : [{ result, operation, equipment_id, itv_visits: { id, reference, status,
 * finished_at, started_at, planned_on, site_id, client_id, sites, clients } }]
 */
export function sitesAMontrer(lignes, depuis) {
  const parSite = new Map()
  for (const l of lignes || []) {
    const v = l.itv_visits
    if (!v || v.status !== 'terminee' || l.result !== 'conforme' || !PERIODIC_OPERATIONS.includes(l.operation)) continue
    const jour = String(v.finished_at || v.started_at || v.planned_on || '').slice(0, 10)
    if (!jour || jour < depuis) continue
    const cle = v.site_id || v.client_id
    const s = parSite.get(cle) || { site_id: v.site_id, client_id: v.client_id, site: v.sites?.name || '', ville: v.sites?.city || '', client: v.clients?.name || '', operations: {}, total: 0, dernier: '', visites: new Map() }
    s.operations[l.operation] = (s.operations[l.operation] || 0) + 1
    s.total += 1
    if (jour > s.dernier) s.dernier = jour
    s.visites.set(v.id, v.reference || v.id)
    parSite.set(cle, s)
  }
  return [...parSite.values()]
    .map((s) => ({ ...s, visites: [...s.visites.entries()].map(([id, reference]) => ({ id, reference })) }))
    .sort((a, b) => b.total - a.total || b.dernier.localeCompare(a.dernier))
}

/** Opérations périodiques dues (cette année) ou en retard (l'an dernier) et non faites, par client */
export function operationsEnRetard(equipements, faites, annee = new Date().getFullYear()) {
  const parClient = new Map()
  for (const e of equipements || []) {
    const ops = periodicOperations(e.itv_equipment_types, e, annee, faites[e.id] || [])
      .filter((o) => o.state === 'due' || o.state === 'late')
    if (!ops.length) continue
    const c = parClient.get(e.client_id) || { client_id: e.client_id, client: e.clients?.name || '', dues: 0, retard: 0 }
    for (const o of ops) { if (o.state === 'late') c.retard += 1; else c.dues += 1 }
    parClient.set(e.client_id, c)
  }
  return [...parClient.values()].sort((a, b) => b.retard - a.retard || b.dues - a.dues)
}

/** Sessions terminées depuis la date : complètes (aucune alerte ouverte) ou à compléter (avec leurs alertes) */
export function sessionsEchantillon(sessions, alertes, depuis, aujourdhui = new Date().toISOString().slice(0, 10)) {
  const ouvertes = new Map()
  for (const a of alertes || []) {
    if (a.resolved_at || !a.entity_id) continue
    ouvertes.set(a.entity_id, (ouvertes.get(a.entity_id) || 0) + 1)
  }
  const terminees = (sessions || []).filter((s) => s.end_date && s.end_date >= depuis && s.end_date < aujourdhui
    && !['cancelled', 'annulee'].includes(s.status))
  const completes = terminees.filter((s) => !ouvertes.has(s.id))
  const aCompleter = terminees.filter((s) => ouvertes.has(s.id)).map((s) => ({ ...s, alertes: ouvertes.get(s.id) }))
    .sort((a, b) => b.alertes - a.alertes)
  return { total: terminees.length, completes, aCompleter }
}

export async function chargerApsad(depuis) {
  const lignes = must(await fetchAll(() => supabase.from('itv_visit_items')
    .select('id, result, operation, equipment_id, replace_reason, itv_visits!inner(id, reference, status, finished_at, started_at, planned_on, site_id, client_id, sites(name, city), clients(name))')
    .in('operation', PERIODIC_OPERATIONS.concat(['verification', 'remplacement', 'mise_en_service']))))
  const equipements = must(await fetchAll(() => supabase.from('itv_equipment')
    .select('id, client_id, manufactured_year, status, itv_equipment_types(operations, lifespan_years), clients(name)')
    .neq('status', 'retire')))
  // Opérations faites (visites terminées, résultat conforme ou remplacé), comme au démarrage d'une visite
  const faites = {}
  for (const l of lignes) {
    const v = l.itv_visits
    if (v?.status !== 'terminee' || !['conforme', 'remplace'].includes(l.result) || l.operation === 'verification') continue
    const y = Number(String(v.started_at || v.planned_on || '').slice(0, 4))
    ;(faites[l.equipment_id] = faites[l.equipment_id] || []).push({ operation: l.operation, year: y })
  }
  const sansMotif = lignes.filter((l) => l.result === 'remplace' && !l.replace_reason && l.itv_visits?.status === 'terminee'
    && String(l.itv_visits.finished_at || l.itv_visits.started_at || '').slice(0, 10) >= depuis).length
  return { sites: sitesAMontrer(lignes, depuis), retards: operationsEnRetard(equipements, faites), sansMotif }
}

export async function chargerQualiopi(depuis) {
  const sessions = must(await fetchAll(() => supabase.from('sessions')
    .select('id, reference, start_date, end_date, status, courses(title), clients(name)')
    .gte('end_date', depuis)))
  const alertes = must(await fetchAll(() => supabase.from('completude_alerts').select('id, entity_id, resolved_at').is('resolved_at', null)))
  return sessionsEchantillon(sessions, alertes, depuis)
}

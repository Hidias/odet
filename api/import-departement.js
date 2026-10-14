/**
 * ============================================================================
 * API ENDPOINT - IMPORT UN DÉPARTEMENT
 * ============================================================================
 * 
 * À METTRE : afm-app-main/api/import-departement.js
 * 
 * Cet endpoint importe les prospects d'UN SEUL département
 * Peut être appelé 9 fois (1 fois par département)
 * Durée : 3-5 minutes par département
 * ============================================================================
 */

import { createClient } from '@supabase/supabase-js'
import { requireCronOrUser } from './_lib/auth.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
// Clé serveur : la table prospection_massive est protégée (RLS, accès connecté uniquement)
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const TRANCHES_EFFECTIF = ['53', '52', '51', '42', '41', '32', '31', '22', '21', '12', '11', '03', '02', '01']
const API_BASE_URL = 'https://recherche-entreprises.api.gouv.fr/search'
const MAX_PAGES = 400

function getEffectifLabel(code) {
  const labels = {
    '01': '1-2 salariés',
    '02': '3-5 salariés',
    '03': '6-9 salariés',
    '11': '10-19 salariés',
    '12': '20-49 salariés',
    '21': '50-99 salariés',
    '22': '100-199 salariés',
    '31': '200-249 salariés',
    '32': '250-499 salariés',
    '41': '500-999 salariés',
    '42': '1000-1999 salariés',
    '51': '2000-4999 salariés',
    '52': '5000-9999 salariés',
    '53': '10000+ salariés',
  }
  return labels[code] || 'NN'
}

function calculateQualityScore(prospect) {
  let score = 50
  if (['12', '21', '22', '31', '32', '41', '42', '51', '52', '53'].includes(prospect.effectif)) score += 20
  if (['03', '11'].includes(prospect.effectif)) score += 10
  if (['01', '02'].includes(prospect.effectif)) score += 5
  if (prospect.latitude && prospect.longitude) score += 10
  if (prospect.site_web) score += 10
  if (prospect.naf?.startsWith('41') || prospect.naf?.startsWith('42') || 
      prospect.naf?.startsWith('43') || prospect.naf?.startsWith('10') || 
      prospect.naf?.startsWith('25') || prospect.naf?.startsWith('62')) {
    score += 10
  }
  return Math.min(100, score)
}

async function fetchDepartementByTranche(dept, trancheEffectif, startTime) {
  const allResults = []
  let page = 1
  
  while (page <= MAX_PAGES) {
    if (startTime && Date.now() - startTime > 250000) break
    try {
      const params = new URLSearchParams({
        departement: dept,
        etat_administratif: 'A',
        tranche_effectif_salarie: trancheEffectif,
        per_page: '25',
        page: page.toString()
      })
      
      const response = await fetch(`${API_BASE_URL}?${params}`)
      
      if (!response.ok) break
      
      const data = await response.json()
      
      if (!data.results || data.results.length === 0) break
      
      allResults.push(...data.results)
      page++
      
      await new Promise(resolve => setTimeout(resolve, 150))
      
    } catch (error) {
      console.error(`Erreur page ${page} tranche ${trancheEffectif}:`, error)
      break
    }
  }
  
  return allResults
}

async function fetchDepartement(dept) {
  const allResults = []
  const startTime = Date.now()
  const MAX_DURATION = 250000 // 250 sec, garde 50s pour l'insertion
  
  for (const tranche of TRANCHES_EFFECTIF) {
    if (Date.now() - startTime > MAX_DURATION) {
      console.log(`Timeout approaching, stopping at tranche ${tranche}`)
      break
    }
    console.log(`Fetching dept ${dept}, tranche ${tranche}...`)
    const results = await fetchDepartementByTranche(dept, tranche, startTime)
    console.log(`  → ${results.length} résultats`)
    allResults.push(...results)
  }
  
  // Dédupliquer par SIREN
  const seen = new Set()
  const unique = allResults.filter(r => {
    if (seen.has(r.siren)) return false
    seen.add(r.siren)
    return true
  })
  
  console.log(`Total dept ${dept}: ${allResults.length} brut → ${unique.length} uniques`)
  return unique
}

// Formes juridiques exclues : SCI (65xx) et entrepreneurs individuels / micro (1000)
const EXCLUDED_JURIDIQUES = ['1000']
const EXCLUDED_JURIDIQUES_PREFIX = ['65']

function transformAndFilter(results, dept) {
  const prospects = []
  
  for (const r of results) {
    const effectifCode = r.tranche_effectif_salarie_entreprise || r.tranche_effectif_salarie
    if (!TRANCHES_EFFECTIF.includes(effectifCode)) continue
    
    // Exclure SCI et auto/micro-entrepreneurs
    const nj = r.nature_juridique
    if (nj && (EXCLUDED_JURIDIQUES.includes(nj) || EXCLUDED_JURIDIQUES_PREFIX.some(p => nj.startsWith(p)))) continue
    
    const etablissements = r.matching_etablissements || []
    
    if (etablissements.length > 0) {
      for (const etab of etablissements) {
        prospects.push({
          siret: etab.siret,
          siren: r.siren,
          name: r.nom_complet || r.nom_raison_sociale,
          address: etab.adresse,
          postal_code: etab.code_postal,
          city: etab.libelle_commune,
          departement: dept,
          effectif: effectifCode,
          effectif_label: getEffectifLabel(effectifCode),
          forme_juridique: r.nature_juridique,
          naf: r.activite_principale,
          latitude: etab.latitude || null,
          longitude: etab.longitude || null,
          site_web: etab.site_internet || r.siege?.site_internet || null,
          phone: etab.telephone || null,
          email: etab.courriel || null,
        })
      }
    } else {
      const siege = r.siege || {}
      prospects.push({
        siret: siege.siret || r.siret,
        siren: r.siren,
        name: r.nom_complet || r.nom_raison_sociale,
        address: siege.adresse || r.adresse,
        postal_code: siege.code_postal || r.code_postal,
        city: siege.libelle_commune || r.libelle_commune,
        departement: dept,
        effectif: effectifCode,
        effectif_label: getEffectifLabel(effectifCode),
        forme_juridique: r.nature_juridique,
        naf: r.activite_principale,
        latitude: siege.latitude || r.latitude || null,
        longitude: siege.longitude || r.longitude || null,
        site_web: siege.site_internet || null,
        phone: siege.telephone || null,
        email: siege.courriel || null,
      })
    }
  }
  
  return prospects
}

async function insertProspects(supabase, prospects) {
  const prospectsWithScore = prospects.map(p => ({
    ...p,
    quality_score: calculateQualityScore(p)
  }))
  
  const BATCH_SIZE = 1000
  let inserted = 0
  let duplicates = 0
  
  for (let i = 0; i < prospectsWithScore.length; i += BATCH_SIZE) {
    const batch = prospectsWithScore.slice(i, i + BATCH_SIZE)
    
    try {
      const { error } = await supabase
        .from('prospection_massive')
        .upsert(batch, { onConflict: 'siret', ignoreDuplicates: true })
      
      if (error) {
        if (error.code === '23505') {
          duplicates += batch.length
        }
      } else {
        inserted += batch.length
      }
    } catch (error) {
      console.error('Erreur insertion:', error)
    }
  }
  
  return { inserted, duplicates }
}

export default async function handler(req, res) {
  if (req.method !== 'OPTIONS') {
    // Utilisateur connecté (import manuel) ou tâche planifiée (secret CRON_SECRET, appel de import-auto-cron)
    const ctx = await requireCronOrUser(req, res)
    if (!ctx) return
    req.user = ctx.user || null
    req.profile = ctx.profile || null
  }
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  
  const { departement, tranche_effectif } = req.body
  
  if (!departement) {
    return res.status(400).json({ error: 'departement requis' })
  }
  
  try {
    if (!SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY manquante' })
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    let allResults = []
    
    if (tranche_effectif) {
      // Mode tranche unique (appelé par le frontend)
      allResults = await fetchDepartementByTranche(departement, tranche_effectif, Date.now())
    } else {
      // Mode legacy (toutes les tranches d'un coup)
      allResults = await fetchDepartement(departement)
    }
    
    // Transformation
    const prospects = transformAndFilter(allResults, departement)
    
    // Insertion
    const { inserted, duplicates } = await insertProspects(supabase, prospects)
    
    return res.status(200).json({
      success: true,
      departement,
      tranche_effectif: tranche_effectif || 'all',
      recupere: allResults.length,
      filtre: prospects.length,
      insere: inserted,
      doublons: duplicates
    })
    
  } catch (error) {
    console.error('Erreur:', error)
    return res.status(500).json({ 
      error: error.message,
      departement 
    })
  }
}

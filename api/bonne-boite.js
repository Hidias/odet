/**
 * ============================================================================
 * API - LA BONNE BOÎTE v2 (France Travail) — Signal recrutement
 * ============================================================================
 * 
 * À METTRE : afm-app-main/api/bonne-boite.js
 * 
 * Interroge l'API La Bonne Boîte v2 pour trouver les entreprises qui recrutent
 * autour d'une position géographique, puis croise avec notre base.
 * 
 * ENV REQUISES dans Vercel :
 *   FT_CLIENT_ID      = Identifiant client francetravail.io
 *   FT_CLIENT_SECRET   = Clé secrète francetravail.io
 * 
 * Rate limit : 2 appels/seconde (on espace les requêtes)
 * Coût : 100% GRATUIT
 * ============================================================================
 */

export const config = { maxDuration: 25 }

// Codes ROME pertinents pour Access Formation
// BTP, Industrie, Logistique, Maintenance → besoins SST/CACES/Incendie/Elec
const ROME_CODES_BY_SECTOR = {
  btp: ['F1701', 'F1702', 'F1703', 'F1704', 'F1301', 'F1302', 'F1601', 'F1602', 'F1603', 'F1606', 'F1607', 'F1608', 'F1609', 'F1610', 'F1611'],
  industrie: ['H2901', 'H2902', 'H2903', 'H2906', 'H2909', 'H2910', 'H2912', 'H2913', 'H2914', 'H3101', 'H3102', 'H3201', 'H3202', 'H3203', 'H3301', 'H3302', 'H3303'],
  logistique: ['N1101', 'N1103', 'N1104', 'N1105', 'N1201', 'N1202', 'N1301', 'N1302', 'N1303'],
  maintenance: ['I1301', 'I1302', 'I1303', 'I1304', 'I1305', 'I1306', 'I1307', 'I1308', 'I1309', 'I1310'],
}

// Respecter le rate limit de 2 req/sec
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getAccessToken() {
  const resp = await fetch(
    'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.FT_CLIENT_ID,
        client_secret: process.env.FT_CLIENT_SECRET,
        scope: 'api_labonneboitev2',
      }),
    }
  )
  if (!resp.ok) {
    const text = await resp.text()
    // Fallback: essayer le scope v1 si v2 échoue
    if (resp.status === 400 || resp.status === 401) {
      console.warn('Scope v2 refusé, tentative avec v1...')
      const resp2 = await fetch(
        'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: process.env.FT_CLIENT_ID,
            client_secret: process.env.FT_CLIENT_SECRET,
            scope: 'api_labonneboitev1',
          }),
        }
      )
      if (!resp2.ok) {
        const text2 = await resp2.text()
        throw new Error(`Auth France Travail failed v1 fallback: ${resp2.status} ${text2}`)
      }
      return (await resp2.json()).access_token
    }
    throw new Error(`Auth France Travail failed: ${resp.status} ${text}`)
  }
  const data = await resp.json()
  return data.access_token
}

async function queryBonneBoite(token, latitude, longitude, romeCodes, distance = 30) {
  const results = []
  
  for (let i = 0; i < romeCodes.length; i++) {
    const rome = romeCodes[i]
    try {
      const params = new URLSearchParams({
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        rome_codes: rome,
        distance: distance.toString(),
        page_size: '100',
      })
      
      // Essayer v2, fallback v1
      let resp = await fetch(
        `https://api.francetravail.io/partenaire/labonneboite/v2/company/?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      
      if (resp.status === 404 || resp.status === 403) {
        resp = await fetch(
          `https://api.francetravail.io/partenaire/labonneboite/v1/company/?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
      }
      
      if (!resp.ok) {
        console.warn(`Bonne Boîte ${rome}: ${resp.status}`)
        continue
      }
      
      const data = await resp.json()
      if (data.companies) {
        results.push(...data.companies)
      }
    } catch (err) {
      console.error(`Erreur Bonne Boîte ${rome}:`, err.message)
    }
    
    // Pause 600ms entre chaque appel (max 2 req/sec)
    if (i < romeCodes.length - 1) {
      await sleep(600)
    }
  }
  
  // Dédupliquer par SIRET
  const seen = new Set()
  return results.filter(r => {
    if (!r.siret || seen.has(r.siret)) return false
    seen.add(r.siret)
    return true
  })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  
  const { latitude, longitude, distance, sectors, rome_codes } = req.body
  
  if (!latitude || !longitude) {
    return res.status(400).json({ error: 'latitude et longitude requis' })
  }
  
  // Soit codes ROME directs, soit sélection par secteurs
  let romeCodes
  if (rome_codes && rome_codes.length > 0) {
    romeCodes = rome_codes
  } else {
    const selectedSectors = sectors || Object.keys(ROME_CODES_BY_SECTOR)
    romeCodes = selectedSectors.flatMap(s => ROME_CODES_BY_SECTOR[s] || [])
  }
  
  if (romeCodes.length === 0) {
    return res.status(400).json({ error: 'Aucun code ROME' })
  }
  
  // Limiter à 20 codes ROME max pour rester dans le timeout de 25s
  const limitedRomes = romeCodes.slice(0, 20)
  
  try {
    const token = await getAccessToken()
    const companies = await queryBonneBoite(token, latitude, longitude, limitedRomes, distance || 50)
    
    const enriched = companies.map(c => ({
      siret: c.siret,
      name: c.name,
      naf: c.naf,
      naf_text: c.naf_text,
      city: c.city,
      lat: c.lat,
      lon: c.lon,
      headcount_text: c.headcount_text,
      distance: c.distance,
      recrute_score: Math.min(100, Math.round(c.score ? c.score * 100 : 50)),
    }))
    
    return res.status(200).json({
      count: enriched.length,
      companies: enriched,
      rome_codes_queried: limitedRomes.length,
      rome_codes_total: romeCodes.length,
    })
    
  } catch (err) {
    console.error('Erreur Bonne Boîte:', err)
    return res.status(500).json({ error: err.message })
  }
}

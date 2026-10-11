/**
 * ============================================================================
 * API - ENRICHISSEMENT ENTREPRISE (API Recherche Entreprises + email patterns)
 * ============================================================================
 * 
 * À METTRE : afm-app-main/api/enrich-entreprise.js
 * 
 * 2 fonctions en 1 :
 *   1. Appelle recherche-entreprises.api.gouv.fr → dirigeant, effectif à jour
 *   2. Génère les patterns d'email à partir du dirigeant + domaine du site web
 * 
 * 100% GRATUIT — aucune clé API requise
 * Rate limit : 7 appels/seconde
 * ============================================================================
 */

export const config = { maxDuration: 15 }

// Patterns d'emails professionnels français (ordonnés par fréquence)
function generateEmailPatterns(prenom, nom, domain) {
  if (!prenom || !nom || !domain) return []
  
  const p = prenom.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlever accents
    .replace(/[^a-z-]/g, '') // garder lettres + tiret
  const n = nom.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z-]/g, '')
  
  if (!p || !n) return []
  
  const pi = p[0] // première lettre prénom
  // Gérer les prénoms composés : jean-marc → jm
  const initials = p.split('-').map(s => s[0]).join('')
  
  const patterns = [
    `${p}.${n}@${domain}`,         // jean.dupont@
    `${p}${n}@${domain}`,          // jeandupont@
    `${pi}.${n}@${domain}`,        // j.dupont@
    `${pi}${n}@${domain}`,         // jdupont@
    `${n}.${p}@${domain}`,         // dupont.jean@
    `${n}${pi}@${domain}`,         // dupontj@
    `${p}-${n}@${domain}`,         // jean-dupont@
    `${p}_${n}@${domain}`,         // jean_dupont@
    `${n}@${domain}`,              // dupont@
    `${p}@${domain}`,              // jean@
  ]
  
  // Si prénom composé, ajouter variantes
  if (initials.length > 1) {
    patterns.push(`${initials}.${n}@${domain}`)  // jm.dupont@
    patterns.push(`${initials}${n}@${domain}`)   // jmdupont@
  }
  
  // Dédupliquer
  return [...new Set(patterns)]
}

function extractDomain(siteWeb) {
  if (!siteWeb) return null
  try {
    let url = siteWeb.trim()
    if (!url.startsWith('http')) url = 'https://' + url
    const hostname = new URL(url).hostname
    return hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function pickBestDirigeant(dirigeants) {
  if (!dirigeants || dirigeants.length === 0) return null
  
  // Priorité : Président > Gérant > DG > Directeur > premier trouvé
  const priorities = [
    'Président', 'Présidente',
    'Gérant', 'Gérante',
    'Directeur général', 'Directrice générale',
    'Directeur', 'Directrice',
    'Administrateur', 'Administratrice',
  ]
  
  for (const prio of priorities) {
    const match = dirigeants.find(d => 
      d.qualite?.toLowerCase().includes(prio.toLowerCase()) ||
      d.fonction?.toLowerCase().includes(prio.toLowerCase())
    )
    if (match) return match
  }
  
  return dirigeants[0]
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  
  const { siren, siret, site_web } = req.body
  
  if (!siren && !siret) {
    return res.status(400).json({ error: 'siren ou siret requis' })
  }
  
  try {
    // 1. Appel API Recherche Entreprises (GRATUIT, pas de clé)
    const query = siren || siret
    const resp = await fetch(
      `https://recherche-entreprises.api.gouv.fr/search?q=${query}&per_page=1`,
      { headers: { Accept: 'application/json' } }
    )
    
    if (!resp.ok) {
      return res.status(resp.status).json({ error: `API error: ${resp.status}` })
    }
    
    const data = await resp.json()
    
    if (!data.results || data.results.length === 0) {
      return res.status(404).json({ error: 'Entreprise non trouvée' })
    }
    
    const entreprise = data.results[0]
    const dirigeants = entreprise.dirigeants || []
    const best = pickBestDirigeant(dirigeants)
    
    // 2. Générer les patterns d'email
    const domain = extractDomain(site_web || entreprise.siege?.site_internet)
    const emailPatterns = best
      ? generateEmailPatterns(best.prenoms || best.prenom, best.nom, domain)
      : []
    
    // 3. Construire la réponse enrichie
    const result = {
      // Dirigeant
      dirigeant_nom: best?.nom || null,
      dirigeant_prenom: best?.prenoms || best?.prenom || null,
      dirigeant_qualite: best?.qualite || best?.fonction || null,
      
      // Tous les dirigeants (pour affichage)
      tous_dirigeants: dirigeants.map(d => ({
        nom: d.nom,
        prenom: d.prenoms || d.prenom,
        qualite: d.qualite || d.fonction,
      })),
      
      // Email patterns
      email_patterns: emailPatterns,
      domain: domain,
      
      // Données mises à jour
      effectif_actuel: entreprise.tranche_effectif_salarie || entreprise.siege?.tranche_effectif_salarie,
      convention_collective: entreprise.complements?.identifiant_convention_collective?.[0] || null,
      nature_juridique: entreprise.nature_juridique,
      etat_administratif: entreprise.etat_administratif,
      
      // Siège
      siege: entreprise.siege ? {
        adresse: entreprise.siege.adresse,
        code_postal: entreprise.siege.code_postal,
        commune: entreprise.siege.commune || entreprise.siege.libelle_commune,
        latitude: entreprise.siege.latitude,
        longitude: entreprise.siege.longitude,
      } : null,
    }
    
    return res.status(200).json(result)
    
  } catch (err) {
    console.error('Erreur enrichissement:', err)
    return res.status(500).json({ error: err.message })
  }
}

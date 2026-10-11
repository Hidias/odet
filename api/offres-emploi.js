/**
 * ============================================================================
 * API - OFFRES D'EMPLOI (France Travail) — Détection recrutement actif
 * ============================================================================
 * 
 * À METTRE : afm-app-main/api/offres-emploi.js
 * 
 * Cherche les offres d'emploi actives par SIRET ou par zone géo + NAF.
 * Si une entreprise de notre base a des offres actives = elle recrute NOW.
 * 
 * Argument de vente : "Je vois que vous publiez 3 postes de maçons,
 * vous savez que le CACES est obligatoire pour chaque nouvel opérateur ?"
 * 
 * ENV REQUISES : FT_CLIENT_ID, FT_CLIENT_SECRET (mêmes que bonne-boite)
 * Coût : 100% GRATUIT
 * ============================================================================
 */

export const config = { maxDuration: 15 }

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
        scope: 'api_offresdemploiv2 o2dsoffre',
      }),
    }
  )
  if (!resp.ok) throw new Error(`Auth failed: ${resp.status}`)
  return (await resp.json()).access_token
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  
  const { siret, departement, codeNAF, commune, distance } = req.body
  
  try {
    const token = await getAccessToken()
    
    const params = new URLSearchParams()
    // Recherche par SIRET spécifique ou par zone
    if (siret) {
      // Recherche des offres d'une entreprise précise
      // L'API n'a pas de filtre SIRET direct, on cherche par commune+NAF
      // et on filtre côté serveur
    }
    if (departement) params.set('departement', departement)
    if (codeNAF) params.set('codeNAF', codeNAF)
    if (commune) params.set('commune', commune)
    if (distance) params.set('distance', distance.toString())
    params.set('range', '0-149') // max 150 résultats
    
    const resp = await fetch(
      `https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${params}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    )
    
    if (!resp.ok) {
      const text = await resp.text()
      return res.status(resp.status).json({ error: text })
    }
    
    const data = await resp.json()
    const offres = data.resultats || []
    
    // Agréger par entreprise : combien d'offres par boîte ?
    const parEntreprise = {}
    for (const offre of offres) {
      const ent = offre.entreprise
      if (!ent?.nom) continue
      
      const key = ent.nom.toUpperCase().trim()
      if (!parEntreprise[key]) {
        parEntreprise[key] = {
          nom: ent.nom,
          siret: ent.siret || null,
          offres: [],
          count: 0,
        }
      }
      parEntreprise[key].count++
      parEntreprise[key].offres.push({
        intitule: offre.intitule,
        typeContrat: offre.typeContrat,
        lieu: offre.lieuTravail?.libelle,
        dateCreation: offre.dateCreation,
        salaire: offre.salaire?.commentaire || offre.salaire?.libelle || null,
      })
    }
    
    // Trier par nombre d'offres (les plus gros recruteurs en premier)
    const sorted = Object.values(parEntreprise)
      .sort((a, b) => b.count - a.count)
    
    return res.status(200).json({
      total_offres: offres.length,
      entreprises_qui_recrutent: sorted.length,
      entreprises: sorted.slice(0, 50), // top 50
    })
    
  } catch (err) {
    console.error('Erreur offres emploi:', err)
    return res.status(500).json({ error: err.message })
  }
}

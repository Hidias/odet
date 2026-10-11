// api/geocode-prospects.js
// Géocode les prospects par code postal via l'API gouvernementale gratuite geo.api.gouv.fr

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // 1. Récupérer les codes postaux uniques sans coordonnées via RPC
    const { data: postalData, error } = await supabase.rpc('get_ungeo_postal_codes')

    if (error) {
      // Fallback si la fonction n'existe pas
      console.log('RPC fallback, using direct query')
      const { data: prospects, error: err2 } = await supabase
        .from('prospection_massive')
        .select('postal_code')
        .is('latitude', null)
        .not('postal_code', 'is', null)
        .limit(1000)

      if (err2) throw err2
      var uniquePostalCodes = [...new Set((prospects || []).map(p => p.postal_code).filter(Boolean))]
    } else {
      var uniquePostalCodes = (postalData || []).map(r => r.postal_code).filter(Boolean)
    }

    if (uniquePostalCodes.length === 0) {
      return res.status(200).json({ success: true, message: 'Tous les prospects sont déjà géocodés', geocoded: 0 })
    }

    let geocoded = 0
    let errors = 0

    // 2. Pour chaque code postal, appeler l'API geo.api.gouv.fr
    for (const cp of uniquePostalCodes) {
      try {
        const geoRes = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${cp}&fields=centre&format=json`)
        
        if (!geoRes.ok) {
          errors++
          continue
        }

        const communes = await geoRes.json()
        
        if (communes.length === 0) {
          errors++
          continue
        }

        // Prendre la première commune (la plus pertinente)
        const centre = communes[0].centre
        if (!centre || !centre.coordinates) {
          errors++
          continue
        }

        // GeoJSON = [longitude, latitude]
        const longitude = centre.coordinates[0]
        const latitude = centre.coordinates[1]

        // 3. Mettre à jour tous les prospects avec ce code postal
        const { error: updateError } = await supabase
          .from('prospection_massive')
          .update({ latitude, longitude })
          .eq('postal_code', cp)
          .is('latitude', null)

        if (updateError) {
          errors++
          continue
        }

        geocoded++

        // Pause 100ms pour respecter les rate limits de l'API
        await new Promise(r => setTimeout(r, 100))

      } catch (e) {
        console.error(`Erreur géocodage CP ${cp}:`, e.message)
        errors++
      }
    }

    return res.status(200).json({
      success: true,
      total_postal_codes: uniquePostalCodes.length,
      geocoded,
      errors,
    })

  } catch (error) {
    console.error('Erreur géocodage:', error)
    return res.status(500).json({ error: error.message })
  }
}

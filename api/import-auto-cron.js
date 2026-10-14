import { requireCronOrUser } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'
/**
 * ============================================================================
 * API ENDPOINT - IMPORT AUTO CRON
 * ============================================================================
 * 
 * À METTRE : afm-app-main/api/import-auto-cron.js
 * 
 * Cet endpoint est appelé automatiquement tous les soirs à 2h du matin
 * par le cron job Vercel (configuré dans vercel.json)
 * ============================================================================
 */

const DEPARTEMENTS = ['22', '29', '35', '56', '44', '49', '53', '72', '85']

async function handler(req, res) {
  if (!(await requireCronOrUser(req, res))) return
  // Vérifier que c'est bien le cron Vercel qui appelle
  
  console.log('🤖 CRON JOB - Import automatique lancé')
  
  const stats = {
    totalRecupere: 0,
    totalInsere: 0,
    totalDoublons: 0,
    byDept: {},
    errors: []
  }
  
  // Importer chaque département
  for (const dept of DEPARTEMENTS) {
    try {
      console.log(`📍 Import département ${dept}...`)
      
      const response = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/import-departement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departement: dept })
      })
      
      const data = await response.json()
      
      if (data.success) {
        stats.totalRecupere += data.recupere
        stats.totalInsere += data.insere
        stats.totalDoublons += data.doublons
        stats.byDept[dept] = data
        console.log(`✅ Département ${dept} : ${data.insere} prospects`)
      } else {
        stats.errors.push({ dept, error: data.error })
        console.error(`❌ Erreur département ${dept}:`, data.error)
      }
      
      // Pause entre départements
      await new Promise(resolve => setTimeout(resolve, 2000))
      
    } catch (error) {
      stats.errors.push({ dept, error: error.message })
      console.error(`❌ Erreur département ${dept}:`, error)
    }
  }
  
  console.log(`✅ CRON JOB TERMINÉ - ${stats.totalInsere} prospects insérés`)
  
  return res.status(200).json({
    success: true,
    timestamp: new Date().toISOString(),
    stats
  })
}

export default withErrorLog(handler, 'import-auto-cron')

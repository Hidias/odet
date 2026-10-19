import { requireCronOrRole, ADMINS } from './_lib/auth.js'
import { getOrg, getSupabaseAdmin } from './_lib/mailer.js'
import { appUrl } from './_lib/internal.js'
import { withErrorLog } from './_lib/errors.js'
import { withJobLog } from './_lib/taches.js'
/**
 * Import automatique des entreprises de la zone de prospection, chaque nuit à 2 h (vercel.json).
 * Départements : Paramètres > Identité, « Zone d'intervention ». Zone vide : rien n'est importé.
 */

async function handler(req, res) {
  // Tâche planifiée (CRON_SECRET) ou lancement manuel par un administrateur
  if (!(await requireCronOrRole(req, res, ADMINS))) return
  
  console.log('🤖 CRON JOB - Import automatique lancé')
  
  const stats = {
    totalRecupere: 0,
    totalInsere: 0,
    totalDoublons: 0,
    byDept: {},
    errors: []
  }
  
  // Import de nuit seulement si le module Prospection est actif et l'import automatique activé (org_modules.settings.auto_import)
  const supa = getSupabaseAdmin()
  const { data: mod } = await supa.from('org_modules').select('enabled, settings').eq('key', 'prospection').maybeSingle()
  if (!mod?.enabled || mod?.settings?.auto_import !== true) {
    return res.status(200).json({ success: true, skipped: true, reason: 'Import automatique désactivé (Paramètres > Modules, Prospection)' })
  }
  const org = await getOrg()
  const DEPARTEMENTS = (Array.isArray(org.zone_departements) ? org.zone_departements : []).map(d => String(d).trim()).filter(Boolean)
  if (!DEPARTEMENTS.length) return res.status(200).json({ success: true, skipped: true, reason: 'Aucune zone de prospection dans Paramètres' })
  const base = appUrl(req)

  // Importer chaque département
  for (const dept of DEPARTEMENTS) {
    try {
      console.log(`📍 Import département ${dept}...`)
      
      const response = await fetch(`${base}/api/import-departement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Même autorisation que l'appel reçu : secret des tâches planifiées, sinon jeton de l'utilisateur
          ...(process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : (req.headers.authorization ? { Authorization: req.headers.authorization } : {})),
        },
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

export default withErrorLog(withJobLog(handler, 'import-auto-cron'), 'import-auto-cron')

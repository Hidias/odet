// api/capacites.js : services facultatifs disponibles sur cette instance, pour afficher ou masquer leurs boutons.
// Aucune valeur de clé n'est renvoyée, seulement leur présence. Réservé aux comptes connectés.
// Décision de H du 19/10 : l'outil ne dépend jamais de l'IA ; le bouton n'apparaît que lorsque la clé existe.

import { requireUser } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' })
  const ctx = await requireUser(req)
  if (!ctx) return res.status(401).json({ error: 'Connexion requise' })
  res.setHeader('Cache-Control', 'private, max-age=300')
  return res.status(200).json({ ia: !!process.env.ANTHROPIC_API_KEY })
}

export default withErrorLog(handler, 'capacites')

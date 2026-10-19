import { requireRight, SA } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'
import { consulterAnnuaire, interpreterAnnuaire, nettoyerIdentifiant, AnnuaireIndisponible } from './_lib/annuaire.js'

// Préremplissage d'une société depuis l'annuaire officiel (assistant Paramètres › Sociétés, chantier C3).
// GET ?id=<SIREN ou SIRET> ; seul l'identifiant part vers l'annuaire. Réservé à la plateforme.

export const config = { maxDuration: 15 }

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' })
  const ctx = await requireRight(req, res, 'plateforme.administrer', SA, SA)
  if (!ctx) return
  const id = nettoyerIdentifiant(req.query?.id)
  if (!/^\d{9}(\d{5})?$/.test(id)) return res.status(400).json({ error: 'SIREN (9 chiffres) ou SIRET (14 chiffres) attendu' })
  try {
    const json = await consulterAnnuaire(id)
    const r = interpreterAnnuaire(json, id)
    const ul = (json?.results || []).find((x) => x?.siren === id.slice(0, 9)) || null
    return res.status(200).json({
      trouve: r.etat !== 'inconnu' || !!ul,
      etat: r.etat, message: r.message,
      legal_name: r.nom || null, siren: r.siren, siret: r.siege_siret || r.siret || null,
      address: r.adresse, postal_code: r.code_postal, city: r.ville, vat_number: r.tva,
      naf: ul?.activite_principale || null,
      dirigeants: Array.isArray(ul?.dirigeants) ? ul.dirigeants.length : 0,
    })
  } catch (e) {
    if (e instanceof AnnuaireIndisponible) return res.status(200).json({ indisponible: true, message: e.message })
    throw e
  }
}

export default withErrorLog(handler, 'annuaire')

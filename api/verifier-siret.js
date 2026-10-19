import { requireRight, clientDeLAppelant, BILLING, SALES } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'
import { consulterAnnuaire, interpreterAnnuaire, nettoyerIdentifiant, AnnuaireIndisponible } from './_lib/annuaire.js'

// Revérifie le SIRET d'un client dans l'annuaire officiel (Facturation fiable, 0365).
//   POST { invoice_id } : brouillon de facture ou d'avoir ; le résultat est gardé sur le brouillon (siret_checked_at,
//                         siret_check_result). La base exige un contrôle de moins de 24 h avant d'émettre à un professionnel,
//                         ou un motif si l'annuaire ne répond pas (billing_siret_motif).
//   POST { client_id }  : fiche client ; le résultat est gardé sur la fiche et l'adresse à jour est proposée.
// L'appelant doit voir la ligne avec ses propres droits (lecture sous sa session) avant l'écriture par le serveur.
// Aucune donnée personnelle n'est envoyée à l'annuaire : seulement le SIREN ou le SIRET.

export const config = { maxDuration: 15 }

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const { invoice_id: invoiceId, client_id: clientIdDemande } = req.body || {}
  const uuid = /^[0-9a-f-]{36}$/i
  if (!(uuid.test(invoiceId || '') || uuid.test(clientIdDemande || ''))) return res.status(400).json({ error: 'Facture ou client attendu' })

  const ctx = invoiceId
    ? await requireRight(req, res, ['facturation.factures.valider', 'facturation.factures.modifier', 'facturation.avoirs.emettre'], BILLING, BILLING)
    : await requireRight(req, res, ['clients.fiches.modifier', 'facturation.factures.valider', 'facturation.factures.modifier'], SALES, [...SALES, 'comptable'])
  if (!ctx) return
  const moi = clientDeLAppelant(req)
  if (!moi) return res.status(401).json({ error: 'Connexion requise' })

  let invoice = null
  let clientId = clientIdDemande
  if (invoiceId) {
    const { data, error } = await moi.from('invoices').select('id, type, issued_at, client_id, billing_client_id').eq('id', invoiceId).maybeSingle()
    if (error || !data) return res.status(404).json({ error: 'Facture introuvable' })
    if (data.issued_at) return res.status(409).json({ error: 'Facture déjà émise : le contrôle se fait avant émission' })
    invoice = data
    clientId = data.billing_client_id || data.client_id
  }
  const { data: client, error: ec } = await moi.from('clients').select('id, name, siret, siren, address, postal_code, city').eq('id', clientId).maybeSingle()
  if (ec || !client) return res.status(404).json({ error: 'Client introuvable' })
  const identifiant = nettoyerIdentifiant(client.siret) || nettoyerIdentifiant(client.siren)
  if (!/^\d{9}(\d{5})?$/.test(identifiant)) return res.status(422).json({ error: 'SIRET ou SIREN du client absent ou mal saisi' })

  let resultat
  try {
    const json = await consulterAnnuaire(identifiant)
    resultat = interpreterAnnuaire(json, identifiant, client)
  } catch (e) {
    if (e instanceof AnnuaireIndisponible) return res.status(200).json({ indisponible: true, message: e.message })
    throw e
  }
  const maintenant = new Date().toISOString()
  const garde = { ...resultat, identifiant, verifie_le: maintenant }
  const admin = ctx.admin
  if (invoice) {
    const { error } = await admin.from('invoices').update({ siret_checked_at: maintenant, siret_check_result: garde }).eq('id', invoice.id).is('issued_at', null)
    if (error) throw error
  } else {
    const { error } = await admin.from('clients').update({ siret_checked_at: maintenant, siret_check_result: garde }).eq('id', client.id)
    if (error) throw error
  }
  return res.status(200).json({ indisponible: false, resultat: garde })
}

export default withErrorLog(handler, 'verifier-siret')

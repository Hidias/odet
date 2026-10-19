// Annuaire officiel des entreprises (recherche-entreprises.api.gouv.fr) : gratuit, sans clé, 7 appels par seconde.
// consulterAnnuaire interroge l'annuaire ; interpreterAnnuaire traduit sa réponse en un résultat simple, sans réseau
// (testé seul). Le résultat est gardé sur la facture ou la fiche client par /api/verifier-siret.

const URL_ANNUAIRE = 'https://recherche-entreprises.api.gouv.fr/search'

export class AnnuaireIndisponible extends Error {}

export function nettoyerIdentifiant(v) {
  return String(v || '').replace(/\s/g, '')
}

export async function consulterAnnuaire(identifiant, { delai = 6000, fetchImpl = fetch } = {}) {
  const id = nettoyerIdentifiant(identifiant)
  if (!/^\d{9}(\d{5})?$/.test(id)) throw new Error('SIREN (9 chiffres) ou SIRET (14 chiffres) attendu')
  const ctrl = new AbortController()
  const minuterie = setTimeout(() => ctrl.abort(), delai)
  try {
    const r = await fetchImpl(`${URL_ANNUAIRE}?q=${id}&per_page=1`, { headers: { Accept: 'application/json' }, signal: ctrl.signal })
    if (!r.ok) throw new AnnuaireIndisponible(`L'annuaire a répondu ${r.status}`)
    return await r.json()
  } catch (e) {
    if (e instanceof AnnuaireIndisponible) throw e
    throw new AnnuaireIndisponible(e?.name === 'AbortError' ? "L'annuaire ne répond pas" : "L'annuaire est injoignable")
  } finally {
    clearTimeout(minuterie)
  }
}

function rue(etab) {
  if (!etab) return ''
  const fin = [etab.code_postal, etab.libelle_commune].filter(Boolean).join(' ')
  const adresse = String(etab.adresse || '')
  return (fin && adresse.endsWith(fin) ? adresse.slice(0, -fin.length) : adresse).trim()
}

function norm(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Résultat : { etat, siren, siret, nom, adresse, code_postal, ville, tva, siege_siret, ecarts, message }
 *   etat : actif | ferme | siege_deplace | inconnu
 *   ecarts : champs de la fiche client qui diffèrent de l'annuaire (adresse, code_postal, ville)
 */
export function interpreterAnnuaire(json, identifiant, fiche = {}) {
  const id = nettoyerIdentifiant(identifiant)
  const siren = id.slice(0, 9)
  const siretDemande = id.length === 14 ? id : null
  const ul = (json?.results || []).find((r) => r?.siren === siren)
  if (!ul) {
    return { etat: 'inconnu', siren, siret: siretDemande, ecarts: [], message: `${siretDemande ? 'SIRET' : 'SIREN'} inconnu de l'annuaire` }
  }
  const siege = ul.siege || null
  const etabs = Array.isArray(ul.matching_etablissements) ? ul.matching_etablissements : []
  let etab = siretDemande ? (etabs.find((e) => e?.siret === siretDemande) || (siege?.siret === siretDemande ? siege : null)) : siege
  let etat = 'actif'
  let message = 'Établissement actif'
  if (siretDemande && !etab) {
    etat = 'inconnu'
    message = "Ce SIRET n'apparaît pas dans l'annuaire ; le siège de l'entreprise est proposé"
    etab = siege
  } else if (ul.etat_administratif === 'C') {
    etat = 'ferme'
    message = 'Entreprise cessée dans l\'annuaire'
  } else if (etab?.etat_administratif === 'F') {
    if ((etab.est_siege || etab.ancien_siege) && siege && siege.siret !== etab.siret && siege.etat_administratif !== 'F') {
      etat = 'siege_deplace'
      message = 'Siège déplacé : le nouveau siège est proposé'
      etab = siege
    } else {
      etat = 'ferme'
      message = 'Établissement fermé dans l\'annuaire'
    }
  }
  const proposition = {
    nom: ul.nom_raison_sociale || ul.nom_complet || null,
    adresse: rue(etab) || null,
    code_postal: etab?.code_postal || null,
    ville: etab?.libelle_commune || null,
  }
  const ecarts = []
  if (proposition.adresse && fiche.address !== undefined && norm(fiche.address) !== norm(proposition.adresse)) ecarts.push('adresse')
  if (proposition.code_postal && fiche.postal_code !== undefined && norm(fiche.postal_code) !== norm(proposition.code_postal)) ecarts.push('code_postal')
  if (proposition.ville && fiche.city !== undefined && norm(fiche.city) !== norm(proposition.ville)) ecarts.push('ville')
  return {
    etat, siren, siret: etab?.siret || siretDemande, ...proposition,
    tva: Array.isArray(ul.tva) ? (ul.tva[0] || null) : (ul.tva || null),
    siege_siret: siege?.siret || null, ecarts, message,
  }
}

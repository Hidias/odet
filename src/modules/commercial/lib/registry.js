// Répertoire des entreprises (recherche-entreprises.api.gouv.fr) : bibliothèque unique côté application.
// Gratuit, sans clé, 7 appels par seconde par adresse ; appels lancés par l'utilisateur seulement.
// Lot 2 (spec odet-lot2-spec.md, section 2) : recherche, normalisation, établissements, écarts avec la fiche.
// Points vérifiés le 14/10 : le numéro de TVA n'est pas renvoyé (calculé) ; une recherche par SIREN ne liste pas
// les établissements, il faut un filtre géographique (code postal ou département) ; coordonnées GPS du siège fournies.
// Les fonctions de normalisation et d'écarts sont pures (testées sans réseau).

import { tvaFromSiren } from '../../../core/org/tva'

const URL_RECHERCHE = 'https://recherche-entreprises.api.gouv.fr/search'

// Natures juridiques les plus courantes (code INSEE, niveau III)
export const NATURES_JURIDIQUES = {
  1000: 'Entrepreneur individuel', 5410: 'SARL nationale', 5422: 'SARL immobilière de gestion', 5426: 'SARL immobilière',
  5430: 'SARL d\'économie mixte', 5499: 'SARL', 5498: 'EURL', 5505: 'SA à participation ouvrière', 5510: 'SA nationale',
  5599: 'SA à conseil d\'administration', 5699: 'SA à directoire', 5710: 'SAS', 5720: 'SASU', 5785: 'Société d\'exercice libéral par actions simplifiée',
  5385: 'SELARL', 6540: 'SCI', 6599: 'Société civile', 9220: 'Association déclarée', 9210: 'Association non déclarée',
  7210: 'Commune', 7220: 'Département', 7230: 'Région', 7348: 'Communauté d\'agglomération', 7346: 'Communauté de communes',
  7389: 'Établissement public local', 7383: 'Établissement public local d\'enseignement', 7364: 'Établissement d\'hospitalisation',
  4110: 'Établissement public industriel et commercial', 7120: 'Service central d\'un ministère', 5306: 'Société en nom collectif',
}

// Tranches d'effectif salarié (code INSEE) → libellé et valeur courte rangée dans clients.effectif
export const TRANCHES_EFFECTIF = {
  NN: ['Non employeuse', '0'], '00': ['0 salarié', '0'], '01': ['1 ou 2 salariés', '1-2'], '02': ['3 à 5 salariés', '3-5'],
  '03': ['6 à 9 salariés', '6-9'], 11: ['10 à 19 salariés', '10-19'], 12: ['20 à 49 salariés', '20-49'],
  21: ['50 à 99 salariés', '50-99'], 22: ['100 à 199 salariés', '100-199'], 31: ['200 à 249 salariés', '200-249'],
  32: ['250 à 499 salariés', '250-499'], 41: ['500 à 999 salariés', '500-999'], 42: ['1 000 à 1 999 salariés', '1000-1999'],
  51: ['2 000 à 4 999 salariés', '2000-4999'], 52: ['5 000 à 9 999 salariés', '5000-9999'], 53: ['10 000 salariés et plus', '10000+'],
}

export const nettoyer = (v) => String(v || '').replace(/\s/g, '')
export const estSiren = (v) => /^\d{9}$/.test(nettoyer(v))
export const estSiret = (v) => /^\d{14}$/.test(nettoyer(v))

function rueDe(e) {
  if (!e) return ''
  const parts = [e.numero_voie, e.indice_repetition, e.type_voie, e.libelle_voie].filter(Boolean)
  if (parts.length) return parts.join(' ').replace(/\s+/g, ' ').trim()
  const fin = [e.code_postal, e.libelle_commune].filter(Boolean).join(' ')
  const adresse = String(e.adresse || '')
  return (fin && adresse.endsWith(fin) ? adresse.slice(0, -fin.length) : adresse).trim()
}

function codeNaf(v) {
  return v ? String(v).toUpperCase() : null
}

/** Établissement de l'annuaire → champs d'un site */
export function normaliserEtablissement(e, sirenEntreprise = null) {
  if (!e) return null
  return {
    siret: e.siret || null,
    siren: sirenEntreprise || (e.siret ? String(e.siret).slice(0, 9) : null),
    nom: e.nom_commercial || e.enseigne || (Array.isArray(e.liste_enseignes) ? e.liste_enseignes[0] : null) || null,
    adresse: rueDe(e) || null,
    code_postal: e.code_postal || null,
    ville: e.libelle_commune || null,
    est_siege: !!e.est_siege,
    etat: e.etat_administratif === 'F' ? 'F' : 'A',
    latitude: e.latitude != null ? Number(e.latitude) : null,
    longitude: e.longitude != null ? Number(e.longitude) : null,
    naf: codeNaf(e.activite_principale),
  }
}

/** Entreprise de l'annuaire → champs de la fiche client (aucune écriture : proposition) */
export function normaliserEntreprise(r) {
  if (!r?.siren) return null
  const siege = normaliserEtablissement(r.siege, r.siren)
  const dirigeant = Array.isArray(r.dirigeants) ? r.dirigeants.find((d) => d?.nom || d?.denomination) : null
  const tranche = r.tranche_effectif_salarie != null ? TRANCHES_EFFECTIF[r.tranche_effectif_salarie] : null
  const nature = r.nature_juridique != null ? (NATURES_JURIDIQUES[Number(r.nature_juridique)] || `Code ${r.nature_juridique}`) : null
  return {
    siren: r.siren,
    nom: r.nom_complet || r.nom_raison_sociale || null,
    raison_sociale: r.nom_raison_sociale || r.nom_complet || null,
    nature_code: r.nature_juridique != null ? String(r.nature_juridique) : null,
    forme_juridique: nature,
    naf: codeNaf(r.activite_principale),
    naf_libelle: r.libelle_activite_principale || null,
    effectif_code: r.tranche_effectif_salarie ?? null,
    effectif: tranche ? tranche[1] : null,
    effectif_libelle: tranche ? tranche[0] : null,
    date_creation: r.date_creation || null,
    etat: r.etat_administratif === 'C' ? 'C' : 'A',
    etablissements_ouverts: r.nombre_etablissements_ouverts ?? null,
    dirigeant_nom: dirigeant ? (dirigeant.denomination || [dirigeant.prenoms, dirigeant.nom].filter(Boolean).join(' ')) : null,
    dirigeant_qualite: dirigeant?.qualite || null,
    tva: tvaFromSiren(r.siren) || null,
    est_organisme_formation: !!r.complements?.est_organisme_formation,
    est_qualiopi: !!r.complements?.est_qualiopi,
    idcc: Array.isArray(r.complements?.liste_idcc) ? r.complements.liste_idcc : (Array.isArray(r.siege?.liste_idcc) ? r.siege.liste_idcc : []),
    siege,
    etablissements: Array.isArray(r.matching_etablissements) ? r.matching_etablissements.map((e) => normaliserEtablissement(e, r.siren)) : [],
  }
}

async function appeler(params, { delai = 7000, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), delai)
  try {
    const qs = new URLSearchParams(params)
    const res = await fetchImpl(`${URL_RECHERCHE}?${qs.toString()}`, { headers: { Accept: 'application/json' }, signal: ctrl.signal })
    if (res.status === 429) throw new Error('Le répertoire limite les recherches : réessayez dans quelques secondes')
    if (!res.ok) throw new Error(`Le répertoire a répondu ${res.status}`)
    return await res.json()
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('Le répertoire ne répond pas')
    throw e
  } finally {
    clearTimeout(t)
  }
}

/** Recherche par nom, SIREN ou SIRET (3 caractères au moins) */
export async function chercherEntreprises(q, { parPage = 8, ...opts } = {}) {
  const texte = String(q || '').trim()
  if (texte.length < 3) return []
  const json = await appeler({ q: estSiret(texte) || estSiren(texte) ? nettoyer(texte) : texte, per_page: String(parPage) }, opts)
  return (json?.results || []).map(normaliserEntreprise).filter(Boolean)
}

/** Une entreprise par SIREN (ou SIRET : son entreprise) */
export async function lireEntreprise(identifiant, opts = {}) {
  const id = nettoyer(identifiant)
  if (!estSiren(id) && !estSiret(id)) throw new Error('SIREN (9 chiffres) ou SIRET (14 chiffres) attendu')
  const json = await appeler({ q: id, per_page: '1' }, opts)
  const r = (json?.results || []).find((x) => x?.siren === id.slice(0, 9))
  return r ? normaliserEntreprise(r) : null
}

/**
 * Établissements d'une entreprise : la recherche par SIREN seul ne les liste pas, il faut un code postal ou un
 * département (filtre géographique de l'annuaire).
 */
export async function etablissementsDe(siren, { codePostal = null, departement = null, ...opts } = {}) {
  const id = nettoyer(siren).slice(0, 9)
  if (!estSiren(id)) throw new Error('SIREN (9 chiffres) attendu')
  const params = { q: id, per_page: '1', limite_matching_etablissements: '100' }
  if (codePostal) params.code_postal = nettoyer(codePostal)
  else if (departement) params.departement = nettoyer(departement)
  else throw new Error('Indiquez un code postal ou un département pour lister les établissements')
  const json = await appeler(params, opts)
  const r = (json?.results || []).find((x) => x?.siren === id)
  if (!r) return []
  return (Array.isArray(r.matching_etablissements) ? r.matching_etablissements : []).map((e) => normaliserEtablissement(e, id))
}

const egal = (a, b) => String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase()

/**
 * Écarts entre la fiche client et le répertoire, champ par champ (Accepter / Ignorer à l'écran ; jamais d'écriture
 * d'office). `adresseDuSiege` : la fiche porte l'adresse du siège (sinon l'adresse n'est pas comparée).
 * Chaque écart : { champ, libelle, actuel, propose, valeur } où valeur est l'objet à écrire dans clients.
 */
export function ecartsFiche(client = {}, ent, { adresseDuSiege = true } = {}) {
  if (!ent) return []
  const out = []
  const ajoute = (champ, libelle, actuel, propose, valeur = { [champ]: propose }) => {
    if (propose == null || propose === '') return
    if (egal(actuel, propose)) return
    out.push({ champ, libelle, actuel: actuel ?? null, propose, valeur })
  }
  ajoute('legal_name', 'Raison sociale', client.legal_name, ent.raison_sociale)
  ajoute('forme_juridique', 'Forme juridique', client.forme_juridique, ent.forme_juridique)
  ajoute('naf_code', 'Code NAF', client.naf_code || client.naf, ent.naf, { naf_code: ent.naf, naf: ent.naf, naf_label: ent.naf_libelle || client.naf_label || null })
  ajoute('effectif', 'Effectif', client.effectif, ent.effectif)
  ajoute('dirigeant_nom', 'Dirigeant', client.dirigeant_nom, ent.dirigeant_nom, { dirigeant_nom: ent.dirigeant_nom, dirigeant_qualite: ent.dirigeant_qualite })
  ajoute('date_creation', 'Date de création', client.date_creation, ent.date_creation)
  ajoute('etat_administratif', 'État au répertoire', client.etat_administratif, ent.etat)
  if (!client.vat_exempt && (client.country || 'FR') === 'FR') ajoute('tva', 'N° de TVA (calculé)', client.tva, ent.tva)
  if (adresseDuSiege && ent.siege) {
    ajoute('address', 'Adresse du siège', client.address, ent.siege.adresse,
      { address: ent.siege.adresse, postal_code: ent.siege.code_postal, city: ent.siege.ville })
    if (!out.some((e) => e.champ === 'address')) {
      ajoute('postal_code', 'Code postal du siège', client.postal_code, ent.siege.code_postal)
      ajoute('city', 'Ville du siège', client.city, ent.siege.ville)
    }
    ajoute('siret', 'SIRET du siège', client.siret, ent.siege.siret)
  }
  return out
}

/** Photographie gardée sur la fiche (registry_snapshot) : sans les établissements, avec la date de lecture */
export function photographie(ent) {
  if (!ent) return null
  const { etablissements: _e, ...reste } = ent
  return { ...reste, lu_le: new Date().toISOString() }
}

export const libelleEtat = (etat) => (etat === 'C' || etat === 'F' ? 'Fermé' : 'Actif')
export const pappers = (siren) => (estSiren(nettoyer(siren).slice(0, 9)) ? `https://www.pappers.fr/entreprise/${nettoyer(siren).slice(0, 9)}` : null)
export const annuaireOfficiel = (siren) => (estSiren(nettoyer(siren).slice(0, 9)) ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${nettoyer(siren).slice(0, 9)}` : null)

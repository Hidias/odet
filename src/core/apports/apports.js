// Qui a apporté quoi (0409) : origine d'un client ou d'une affaire (membre de l'équipe ou apporteur extérieur), et
// regroupement du chiffre facturé et encaissé par personne et par rôle.

export const TYPES_APPORTEUR = { prescripteur: 'Prescripteur', partenaire: 'Partenaire', client: 'Client qui recommande', autre: 'Autre' }
export const METIERS_CA = { formation: 'Formation', maintenance: 'Maintenance', autre: 'Autre' }

/** Valeur d'un choix d'origine : « p:<id> » pour un membre, « c:<id> » pour un apporteur, vide sinon */
export function valeurOrigine(profileId, contributorId) {
  if (profileId) return `p:${profileId}`
  if (contributorId) return `c:${contributorId}`
  return ''
}

export function lireOrigine(v) {
  const s = String(v || '')
  return {
    introduced_by_profile: s.startsWith('p:') ? s.slice(2) : null,
    introduced_by_contributor: s.startsWith('c:') ? s.slice(2) : null,
  }
}

const VIDE = () => ({ apport_ht: 0, apport_enc: 0, indirect_ht: 0, indirect_enc: 0, idee_ht: 0, vente_ht: 0, vente_enc: 0, realise_ht: 0, factures: new Set() })

/**
 * Regroupe les factures (lignes de ca_apports) par personne. Un apporteur amené par un membre ou par un autre
 * apporteur leur donne un apport « via ses apporteurs » (toute la chaîne, sans boucle, 5 niveaux au plus).
 * noms : { 'p:<id>': 'Nom', 'c:<id>': 'Nom' }
 */
export function agreger(lignes, apporteurs = [], noms = {}) {
  const parId = new Map(apporteurs.map((a) => [a.id, a]))
  const tab = new Map()
  const ajouter = (cle, champ, ht, enc, encChamp, ligne) => {
    if (!cle) return
    if (!tab.has(cle)) tab.set(cle, VIDE())
    const t = tab.get(cle)
    t[champ] += ht
    if (encChamp) t[encChamp] += enc
    t.factures.add(ligne.invoice_id)
  }
  let total = 0
  let encaisse = 0
  let sansOrigine = 0
  const sansOrigineClients = new Map()
  for (const l of lignes || []) {
    const ht = Number(l.ht) || 0
    const enc = Number(l.encaisse_ht) || 0
    total += ht
    encaisse += enc
    const pa = l.apport_p ? `p:${l.apport_p}` : null
    const ca = l.apport_c ? `c:${l.apport_c}` : null
    if (!pa && !ca) { sansOrigine += ht; sansOrigineClients.set(l.client_id, l.client) }
    ajouter(pa, 'apport_ht', ht, enc, 'apport_enc', l)
    ajouter(ca, 'apport_ht', ht, enc, 'apport_enc', l)
    // Chaîne : qui a amené l'apporteur, et ainsi de suite
    const vus = new Set()
    let a = l.apport_c ? parId.get(l.apport_c) : null
    for (let n = 0; a && n < 5 && !vus.has(a.id); n += 1) {
      vus.add(a.id)
      if (a.introduced_by_profile) ajouter(`p:${a.introduced_by_profile}`, 'indirect_ht', ht, enc, 'indirect_enc', l)
      a = a.introduced_by_contributor ? parId.get(a.introduced_by_contributor) : null
      if (a) ajouter(`c:${a.id}`, 'indirect_ht', ht, enc, 'indirect_enc', l)
    }
    ajouter(l.idee_p ? `p:${l.idee_p}` : null, 'idee_ht', ht, 0, null, l)
    ajouter(l.vente_p ? `p:${l.vente_p}` : null, 'vente_ht', ht, enc, 'vente_enc', l)
    ajouter(l.realise_p ? `p:${l.realise_p}` : null, 'realise_ht', ht, 0, null, l)
  }
  const personnes = [...tab.entries()].map(([cle, t]) => ({
    cle, nom: noms[cle] || (cle.startsWith('c:') ? 'Apporteur' : 'Membre de l\'équipe'), externe: cle.startsWith('c:'),
    ...t, nb: t.factures.size, factures: undefined,
  })).sort((x, y) => (y.apport_ht + y.indirect_ht + y.vente_ht) - (x.apport_ht + x.indirect_ht + x.vente_ht))
  return { personnes, total, encaisse, sansOrigine, sansOrigineClients: [...sansOrigineClients.entries()].map(([id, name]) => ({ id, name })) }
}

/** Factures d'une personne pour un rôle (détail) */
export function facturesDe(lignes, cle, apporteurs = []) {
  const id = cle.slice(2)
  const parId = new Map(apporteurs.map((a) => [a.id, a]))
  const dansChaine = (l) => {
    const vus = new Set()
    let a = l.apport_c ? parId.get(l.apport_c) : null
    for (let n = 0; a && n < 5 && !vus.has(a.id); n += 1) {
      vus.add(a.id)
      if (cle === `p:${a.introduced_by_profile}`) return true
      a = a.introduced_by_contributor ? parId.get(a.introduced_by_contributor) : null
      if (a && cle === `c:${a.id}`) return true
    }
    return false
  }
  return (lignes || []).map((l) => {
    const roles = []
    if (cle.startsWith('p:')) {
      if (l.apport_p === id) roles.push('apport')
      if (l.idee_p === id) roles.push('idée')
      if (l.vente_p === id) roles.push('vente')
      if (l.realise_p === id) roles.push('réalisation')
    } else if (l.apport_c === id) roles.push('apport')
    if (dansChaine(l)) roles.push('via ses apporteurs')
    return roles.length ? { ...l, roles } : null
  }).filter(Boolean)
}

export function periode(code, auj = new Date()) {
  const y = auj.getFullYear()
  const m = auj.getMonth()
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  switch (code) {
    case 'mois': return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))]
    case 'mois_dernier': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))]
    case 'trimestre': { const t = Math.floor(m / 3) * 3; return [iso(new Date(y, t, 1)), iso(new Date(y, t + 3, 0))] }
    case 'annee_derniere': return [`${y - 1}-01-01`, `${y - 1}-12-31`]
    case 'douze_mois': return [iso(new Date(y, m - 11, 1)), iso(new Date(y, m + 1, 0))]
    default: return [`${y}-01-01`, `${y}-12-31`]
  }
}

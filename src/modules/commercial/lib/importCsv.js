// Import générique de clients (B3, 05/11) : fichier CSV de n'importe quel outil, colonnes choisies par l'utilisateur.
// Remplace l'import au format Sellsy imposé. Aucun nom d'outil ni d'entreprise en dur : la correspondance est proposée
// d'après des intitulés courants, puis modifiable. Doublons repérés par SIRET (14 chiffres) ; un nom identique à un
// client existant est signalé, non coché par défaut. Henrri viendra plus tard (source choisie par société à ce moment).

// Champs que l'import sait remplir. `requis` : sans lui, la ligne est écartée avec un motif.
export const CHAMPS_IMPORT = [
  { cle: 'name', label: 'Nom de la société', requis: true, alias: ['nom societe', 'raison sociale', 'societe', 'entreprise', 'nom entreprise', 'client', 'nom client', 'denomination', 'nom'] },
  { cle: 'siret', label: 'SIRET', alias: ['siret', 'siret societe', 'n siret', 'numero siret'] },
  { cle: 'address', label: 'Adresse', alias: ['adresse', 'adresse partie 1', 'adresse 1', 'adresse ligne 1', 'rue'] },
  { cle: 'postal_code', label: 'Code postal', alias: ['code postal', 'cp'] },
  { cle: 'city', label: 'Ville', alias: ['ville', 'commune', 'localite'] },
  { cle: 'email', label: 'E-mail de la société', alias: ['email societe', 'e-mail societe', 'mail societe', 'email', 'e-mail', 'courriel'] },
  { cle: 'phone', label: 'Téléphone de la société', alias: ['telephone societe', 'tel societe', 'telephone', 'tel', 'standard'] },
  { cle: 'external_ref', label: 'Identifiant dans l\'ancien outil', alias: ['id societe', 'identifiant', 'id client', 'code client', 'reference client', 'id'] },
  { cle: 'contact_last_name', label: 'Contact : nom', alias: ['nom contact', 'contact nom'] },
  { cle: 'contact_first_name', label: 'Contact : prénom', alias: ['prenom contact', 'contact prenom', 'prenom'] },
  { cle: 'contact_email', label: 'Contact : e-mail', alias: ['email contact', 'e-mail contact', 'mail contact'] },
  { cle: 'contact_phone', label: 'Contact : téléphone', alias: ['telephone contact', 'mobile contact', 'tel contact', 'portable contact', 'mobile', 'portable'] },
  { cle: 'contact_role', label: 'Contact : fonction', alias: ['fonction contact', 'fonction', 'poste'] },
  { cle: 'contact_primary', label: 'Contact principal (oui ou non)', alias: ['contact principal', 'principal'] },
]

const normaliser = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[_.:'’]/g, ' ').replace(/\s+/g, ' ').trim()

/** Texte du fichier : UTF-8, sinon Windows-1252 (exports Excel français) quand l'UTF-8 donne des caractères illisibles */
export function decoderFichier(buffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '')
  return new TextDecoder('windows-1252').decode(buffer)
}

/** Séparateur le plus fréquent sur la première ligne, hors guillemets : ; , ou tabulation */
function separateur(texte) {
  const premiere = texte.split(/\r?\n/, 1)[0] || ''
  let dedans = false
  const compte = { ';': 0, ',': 0, '\t': 0 }
  for (const ch of premiere) {
    if (ch === '"') dedans = !dedans
    else if (!dedans && ch in compte) compte[ch]++
  }
  return Object.entries(compte).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(compte).sort((a, b) => b[1] - a[1])[0][0] : ';'
}

/** Lecture CSV : guillemets, guillemets doublés, retours à la ligne dans une cellule. Renvoie { entetes, lignes } */
export function lireCsv(texte) {
  const t = String(texte || '').replace(/^﻿/, '')
  const sep = separateur(t)
  const rangs = []
  let rang = []; let cell = ''; let dedans = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (dedans) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') dedans = false
      else cell += ch
    } else if (ch === '"') dedans = true
    else if (ch === sep) { rang.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++
      rang.push(cell); rangs.push(rang); rang = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || rang.length) { rang.push(cell); rangs.push(rang) }
  const pleins = rangs.filter((r) => r.some((c) => c.trim() !== ''))
  if (pleins.length === 0) return { entetes: [], lignes: [] }
  const entetes = pleins[0].map((h) => h.trim())
  const lignes = pleins.slice(1).map((r) => entetes.map((_, j) => (r[j] ?? '').trim()))
  return { entetes, lignes }
}

/** Correspondance proposée : intitulé identique à un alias d'abord, puis intitulé qui contient l'alias ; une colonne sert une fois */
export function correspondanceAuto(entetes) {
  const n = entetes.map(normaliser)
  const prises = new Set()
  const out = {}
  for (const passe of ['egal', 'contient']) {
    for (const champ of CHAMPS_IMPORT) {
      if (out[champ.cle] != null) continue
      for (const a of champ.alias) {
        const j = n.findIndex((h, k) => !prises.has(k) && (passe === 'egal' ? h === a : h.includes(a)))
        if (j >= 0) { out[champ.cle] = j; prises.add(j); break }
      }
    }
  }
  return out
}

export const siretPropre = (v) => String(v || '').replace(/\s/g, '')
const OUI = new Set(['oui', 'o', 'y', 'yes', 'x', '1', 'vrai', 'true'])

/**
 * Sociétés à créer, à partir des lignes et de la correspondance (clé du champ → index de colonne).
 * Lignes regroupées par identifiant de l'ancien outil, sinon par SIRET, sinon par nom : une ligne par contact.
 * Renvoie { societes, ecartees } ; `ecartees` : numéro de ligne du fichier (en-tête = 1) et motif.
 */
export function construireSocietes(lignes, corr) {
  const val = (l, cle) => (corr[cle] == null ? '' : String(l[corr[cle]] ?? '').trim())
  const societes = new Map()
  const ecartees = []
  lignes.forEach((l, i) => {
    const numero = i + 2
    const name = val(l, 'name')
    if (!name) { ecartees.push({ ligne: numero, motif: 'Nom de la société vide' }); return }
    const siret = siretPropre(val(l, 'siret'))
    if (siret && !/^\d{14}$/.test(siret)) { ecartees.push({ ligne: numero, nom: name, motif: `SIRET invalide (${siret}) : 14 chiffres attendus` }); return }
    const ref = val(l, 'external_ref')
    if (ref.length > 50) { ecartees.push({ ligne: numero, nom: name, motif: 'Identifiant de l\'ancien outil trop long (50 caractères au plus)' }); return }
    const cle = ref ? `ref:${ref}` : siret ? `siret:${siret}` : `nom:${normaliser(name)}`
    if (!societes.has(cle)) {
      societes.set(cle, {
        cle, lignes: [numero], name, siret, external_ref: ref || null,
        address: val(l, 'address'), postal_code: val(l, 'postal_code'), city: val(l, 'city'),
        email: val(l, 'email'), phone: val(l, 'phone'), contacts: [],
      })
    } else societes.get(cle).lignes.push(numero)
    const s = societes.get(cle)
    const nom = val(l, 'contact_last_name'); const prenom = val(l, 'contact_first_name')
    if (nom || prenom) {
      const email = val(l, 'contact_email')
      const deja = s.contacts.some((c) => c.last_name === nom && c.first_name === prenom && c.email === email)
      if (!deja) {
        s.contacts.push({
          last_name: nom, first_name: prenom, name: `${prenom} ${nom}`.trim(), email,
          phone: val(l, 'contact_phone'), role: val(l, 'contact_role'),
          is_primary: OUI.has(normaliser(val(l, 'contact_primary'))),
        })
      }
    }
  })
  return { societes: Array.from(societes.values()), ecartees }
}

/**
 * Doublons : même SIRET qu'un client existant ou qu'une société plus haut dans le fichier → « doublon », jamais importé ;
 * même nom qu'un client existant sans SIRET commun → « nom connu », non coché par défaut (l'utilisateur tranche).
 */
export function marquerDoublons(societes, clientsExistants = []) {
  const parSiret = new Map(); const parNom = new Map()
  for (const c of clientsExistants || []) {
    const s = siretPropre(c.siret)
    if (s) parSiret.set(s, c)
    if (c.name) parNom.set(normaliser(c.name), c)
  }
  const vus = new Set()
  return societes.map((s) => {
    if (s.siret && parSiret.has(s.siret)) return { ...s, etat: 'doublon', motif: `SIRET déjà connu : ${parSiret.get(s.siret).name}`, selected: false }
    if (s.siret && vus.has(s.siret)) return { ...s, etat: 'doublon', motif: 'SIRET déjà présent plus haut dans le fichier', selected: false }
    if (s.siret) vus.add(s.siret)
    if (parNom.has(normaliser(s.name))) return { ...s, etat: 'nom_connu', motif: `Un client porte déjà ce nom : ${parNom.get(normaliser(s.name)).name}`, selected: false }
    return { ...s, etat: 'nouveau', motif: '', selected: true }
  })
}

/** Ligne de la table clients pour une société du fichier (statut « À compléter », comme l'ancien import) */
export function ligneClient(s) {
  const avecContacts = s.contacts?.length > 0
  return {
    name: s.name.toUpperCase(),
    siret: s.siret || null,
    address: s.address || null,
    postal_code: s.postal_code || null,
    city: s.city || null,
    contact_email: avecContacts ? null : (s.email || null),
    contact_phone: avecContacts ? null : (s.phone || null),
    email: s.email || null,
    status: 'a_completer',
    external_source: 'csv',
    external_ref: s.external_ref || null,
  }
}

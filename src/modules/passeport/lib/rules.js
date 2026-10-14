// Règles métier du Passeport de prévention : contrôles, dates limites, construction des fichiers ADF et JDR,
// lecture de l'accusé de traitement. Fonctions pures, sans dépendance : utilisées par les écrans et par la
// route serveur api/passeport.js. Les valeurs réglementaires (colonnes, délais, valeurs autorisées) viennent
// du réglage versionné pp_format_versions, jamais de ce fichier.

// ── Dates (chaînes AAAA-MM-JJ, sans fuseau horaire) ──
const pad = (n) => String(n).padStart(2, '0')

export function isoDate(d) {
  if (!d) return null
  if (typeof d === 'string') return d.slice(0, 10)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function frDate(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function parts(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map((v) => parseInt(v, 10))
  return { y, m, d }
}

function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate() }

// Ajoute des mois en restant dans le mois visé (31/01 + 1 mois = 28 ou 29/02)
export function addMonths(iso, months) {
  const { y, m, d } = parts(iso)
  const total = (y * 12 + (m - 1)) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`
}

export function addDays(iso, days) {
  const { y, m, d } = parts(iso)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

export function daysBetween(fromIso, toIso) {
  const a = parts(fromIso); const b = parts(toIso)
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000)
}

export function endOfQuarter(iso) {
  const { y, m } = parts(iso)
  const qm = Math.ceil(m / 3) * 3
  return `${y}-${pad(qm)}-${pad(daysInMonth(y, qm))}`
}

// Fin de mois de la date (pour que fin de trimestre + n mois tombe toujours en fin de mois)
function endOfMonth(iso) {
  const { y, m } = parts(iso)
  return `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`
}

// ── Date limite de déclaration de l'organisme ──
export function dateLimite(endDate, regles) {
  if (!endDate) return null
  const delais = regles?.delais || {}
  const tr = delais.transitoire
  const transitoire = !!(tr && tr.fin_formation_jusqu_au && endDate <= tr.fin_formation_jusqu_au)
  const mois = transitoire ? tr.mois : (delais.droit_commun_mois ?? 3)
  const finTrimestre = endOfQuarter(endDate)
  return {
    date: endOfMonth(addMonths(finTrimestre, mois)),
    finTrimestre,
    mois,
    transitoire,
    aConfirmer: transitoire && !!tr.a_confirmer,
    employeurJusquau: endOfMonth(addMonths(endOfMonth(addMonths(finTrimestre, mois)), delais.employeur_mois ?? 9)),
  }
}

// Déclaration obligatoire pour l'organisme, ou volontaire (formations plus anciennes, catégories 3 et 4)
export function obligatoire(categorie, startDate, regles) {
  const o = regles?.obligation_of || {}
  if (!startDate) return false
  if (o.toutes_depuis && startDate >= o.toutes_depuis) return true
  if ([1, 2].includes(Number(categorie)) && o.categories_1_2_depuis && startDate >= o.categories_1_2_depuis) return true
  return false
}

export function couleurDelai(limite, today, regles, estObligatoire = true) {
  if (!estObligatoire) return 'gris'
  if (!limite) return 'gris'
  const n = daysBetween(today, limite)
  const c = regles?.couleurs || { rouge_jours: 30, orange_jours: 90 }
  if (n <= c.rouge_jours) return 'rouge'
  if (n <= c.orange_jours) return 'orange'
  return 'vert'
}

// ── Numéro de sécurité sociale (13 caractères sans la clé) ──
const NIR_RE = /^[12]\d{4}(\d{2}|2A|2B)\d{6}$/

function nirNumeric(nir13) {
  return nir13.replace('2A', '19').replace('2B', '18')
}

export function nirKey(nir13) {
  return 97 - Number(BigInt(nirNumeric(nir13)) % 97n)
}

// Accepte 13 ou 15 caractères (avec clé), espaces et points ignorés. Renvoie le numéro à 13 caractères.
export function normaliserNir(input) {
  const raw = String(input || '').toUpperCase().replace(/[\s.\-]/g, '')
  if (!raw) return { ok: false, error: 'Numéro vide' }
  if (raw.length !== 13 && raw.length !== 15) return { ok: false, error: 'Le numéro doit contenir 13 caractères, ou 15 avec la clé' }
  const nir13 = raw.slice(0, 13)
  if (!NIR_RE.test(nir13)) return { ok: false, error: 'Format invalide : le numéro commence par 1 ou 2 et ne contient que des chiffres (2A ou 2B pour la Corse)' }
  if (raw.length === 15) {
    const key = parseInt(raw.slice(13), 10)
    if (Number.isNaN(key) || key !== nirKey(nir13)) return { ok: false, error: 'La clé de contrôle ne correspond pas : vérifiez le numéro' }
  }
  return { ok: true, nir: nir13 }
}

// Cohérence avec le sexe et la date de naissance connus (liste des écarts, vide si cohérent)
export function ecartsNir(nir13, { gender, birth_date } = {}) {
  const out = []
  if (!nir13) return out
  const sexe = nir13[0]
  if (gender === 'male' && sexe !== '1') out.push('le numéro indique une femme')
  if (gender === 'female' && sexe !== '2') out.push('le numéro indique un homme')
  if (birth_date) {
    const { y, m } = parts(birth_date)
    if (nir13.slice(1, 3) !== pad(y % 100)) out.push("l'année de naissance ne correspond pas")
    const mm = parseInt(nir13.slice(3, 5), 10)
    if (mm >= 1 && mm <= 12 && mm !== m) out.push('le mois de naissance ne correspond pas')
  }
  return out
}

export function finNir(nir13) { return String(nir13 || '').slice(-3) }

export function nirMasque(fin) { return fin ? `se termine par ${fin}` : '' }

// ── SIRET : 14 chiffres et clé de Luhn (La Poste : somme des chiffres multiple de 5) ──
export function siretValide(siret) {
  const s = String(siret || '').replace(/\s/g, '')
  if (!/^\d{14}$/.test(s)) return false
  if (s.startsWith('356000000')) return s.split('').reduce((a, c) => a + Number(c), 0) % 5 === 0
  let sum = 0
  for (let i = 0; i < 14; i++) {
    let n = Number(s[13 - i])
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9 }
    sum += n
  }
  return sum % 10 === 0
}

// ── Noms : majuscules sans accents, 30 caractères au plus, jamais tronqués ──
export function nomPortail(nom, max = 30) {
  const v = String(nom || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[Œœ]/g, 'OE').replace(/[Ææ]/g, 'AE')
    .toUpperCase()
    .replace(/[^A-Z '\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { value: v, ok: v.length > 0 && v.length <= max, tropLong: v.length > max }
}

export function nomCompose(nom) { return /[- ']/.test(String(nom || '').trim()) }

// Nom de naissance à faire confirmer : pas encore confirmé, et femme ou nom composé
export function nomAVerifier(t) {
  if (t.nom_naissance_confirme_le) return false
  const nom = t.nom_naissance || t.last_name
  return t.gender === 'female' || nomCompose(nom)
}

// ── Réglages d'une formation ──
export function reglagesManquants(s, contrat) {
  if (!s) return ['réglages Passeport absents']
  if (!s.declarable) return []
  const m = []
  const c = contrat || {}
  if (!s.categorie) m.push('catégorie')
  if (!s.type_decl) m.push('type ADF ou JDR')
  const nRome = (s.rome || []).length
  if (nRome < (c.rome_min ?? 3) || nRome > (c.rome_max ?? 10)) m.push('codes ROME (3 à 10)')
  if (s.certifiante) {
    if (!s.code_rs) m.push('code RS')
  } else {
    const nF = (s.formacodes || []).length; const nN = (s.nsf || []).length
    if (nF < (c.formacode_min ?? 1) || nF > (c.formacode_max ?? 5)) m.push('Formacodes (1 à 5)')
    if (nN < (c.nsf_min ?? 1) || nN > (c.nsf_max ?? 3)) m.push('codes NSF (1 à 3)')
  }
  if (s.type_decl === 'JDR') {
    if (!s.type_jdr) m.push('TYPE_JDR')
    if (!s.nom_jdr) m.push('NOM_JDR')
  }
  return m
}

// ── Statut d'une inscription ──
// Renvoie { statut, motif, bloquants[] } ; statut : declare, rejete, genere, a_declarer, non_declarable
export function statutInscription(row, settings, contrat) {
  const ligne = row.ligne
  if (ligne?.statut === 'declare') return { statut: 'declare', motif: null, bloquants: [] }
  if (!settings) return { statut: 'non_declarable', motif: 'Formation non réglée pour le Passeport', bloquants: [] }
  if (!settings.declarable) return { statut: 'non_declarable', motif: settings.motif || 'Formation non déclarable', bloquants: [] }
  if (row.absent) return { statut: 'non_declarable', motif: 'Absent', bloquants: [] }
  if (row.early_departure) return { statut: 'non_declarable', motif: 'Départ anticipé : participation incomplète', bloquants: [] }
  if (settings.type_decl === 'JDR' && row.result && row.result !== 'acquired') return { statut: 'non_declarable', motif: 'Résultat non acquis', bloquants: [] }
  if (row.refused_ssn) return { statut: 'non_declarable', motif: 'Refuse de communiquer son numéro', bloquants: [] }

  const bloquants = []
  const manquants = reglagesManquants(settings, contrat)
  if (manquants.length) bloquants.push({ code: 'reglages', label: `Réglages de la formation incomplets : ${manquants.join(', ')}` })
  if (settings.type_decl === 'JDR' && !row.result) bloquants.push({ code: 'resultat', label: 'Résultat non saisi' })
  if (!row.nir_present) bloquants.push({ code: 'nir', label: 'Numéro de sécurité sociale manquant' })
  const nom = nomPortail(row.nom_naissance || row.last_name, contrat?.nom_titulaire_max ?? 30)
  if (!nom.ok) bloquants.push({ code: 'nom', label: nom.tropLong ? 'Nom de naissance de plus de 30 caractères' : 'Nom de naissance vide' })
  else if (nomAVerifier(row)) bloquants.push({ code: 'nom_verifier', label: `Nom de naissance à vérifier (${row.gender === 'female' ? 'femme' : 'nom composé'})` })
  if (row.client_type !== 'particulier' && !siretValide(row.client_siret)) bloquants.push({ code: 'siret', label: "SIRET de l'employeur invalide" })

  if (ligne?.statut === 'rejete') return { statut: 'rejete', motif: null, bloquants }
  if (ligne?.statut === 'genere') return { statut: 'genere', motif: null, bloquants }
  return { statut: 'a_declarer', motif: null, bloquants }
}

export const STATUT_LABEL = {
  a_declarer: 'À déclarer',
  genere: 'Fichier préparé',
  declare: 'Déclaré',
  rejete: 'Rejeté',
  non_declarable: 'Non déclarable',
}

// ── Construction des fichiers ──
function clean(v) { return String(v ?? '').replace(/[|\r\n]/g, ' ').trim() }

// Valeurs d'une ligne. item : { row, settings, nir, tentative, idUnique, idDeclaration }
export function valeursLigne(type, item) {
  const { row, settings: s, nir } = item
  const certifiante = !!s.certifiante
  const entreprise = row.client_type !== 'particulier' && !!row.client_siret
  const debutValidite = type === 'JDR' && row.date_certification && row.date_certification >= row.end_date ? row.date_certification : row.end_date
  const finValidite = s.validite_mois ? addDays(addMonths(debutValidite, s.validite_mois), -1) : ''
  const modalite = row.is_remote ? 'A_DISTANCE' : (s.modalite || 'PRESENTIEL')
  const v = {
    ID_DECLARATION: item.idDeclaration,
    REFERENCE_DECLARATION: row.reference,
    ID_UNIQUE_PARTENAIRE: item.idUnique,
    NOM_FORMATION: s.nom_formation || row.course_title,
    DATE_DEBUT_FORMATION: frDate(row.start_date),
    DATE_FIN_FORMATION: frDate(row.end_date),
    MODALITE_DISPENSE: modalite,
    COMPETENCE_TRANSFERABLE: (s.rome || []).join('/'),
    QUALIFICATION_FORMATEUR: s.qualification_formateur || '',
    FORMATION_CERTIFIANTE: certifiante ? 'OUI' : 'NON',
    CERTIFICATION_VISEE: certifiante ? (s.code_rs || '') : '',
    DOMAINE_FORMATION: certifiante ? '' : (s.formacodes || []).join('/'),
    SPECIALITE_FORMATION: certifiante ? '' : (s.nsf || []).join('/'),
    NIR: nir,
    NOM_TITULAIRE: nomPortail(row.nom_naissance || row.last_name).value,
    PRESENCE_EMPLOYEUR: entreprise ? 'OUI' : 'NON',
    SIRET_EMPLOYEUR: entreprise ? String(row.client_siret).replace(/\s/g, '') : '',
    REFERENCE_EMPLOYEUR: '',
    DATE_DEBUT_VALIDITE: frDate(debutValidite),
    DATE_FIN_VALIDITE: finValidite ? frDate(finValidite) : '',
    TYPE_JDR: s.type_jdr || '',
    NOM_JDR: s.nom_jdr || '',
    NOM_OPTION_SPECIALITE: s.nom_option || '',
    MODE_OBTENTION: s.mode_obtention || '',
    PRESENCE_FORMATION: 'OUI',
    RESULTAT_OBTENU: '',
    MENTION_OBTENUE: '',
    LIEN_PREUVE: '',
    IDENTIFIANT_PREUVE: '',
  }
  return v
}

export function construireFichier(type, items, contrat) {
  const cols = type === 'JDR' ? contrat.jdr : contrat.adf
  const sep = contrat.separateur || '|'
  const lines = [cols.join(sep)]
  for (const it of items) {
    const v = valeursLigne(type, it)
    lines.push(cols.map((c) => clean(v[c])).join(sep))
  }
  return lines.join('\n') + '\n'
}

export function identifiants(base, reference, tentative, contrat) {
  const sufId = contrat?.suffixe_correction_identifiant || '-C'
  const sufDecl = contrat?.suffixe_correction_declaration || '_C'
  const n = Math.max(1, tentative || 1)
  return {
    idUnique: n === 1 ? String(base) : `${base}${sufId}${n - 1}`,
    idDeclaration: n === 1 ? String(reference) : `${reference}${sufDecl}${n - 1}`,
  }
}

export function nomFichier(prefix, type, when, correction, contrat) {
  const d = when instanceof Date ? when : new Date()
  // Heure légale française (le serveur tourne en UTC) ; repli sur l'heure locale si le fuseau est inconnu
  let stamp
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', {
      timeZone: contrat?.fuseau || 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]))
    stamp = `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}`
  } catch {
    stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
  }
  const interdits = contrat?.nom_fichier_interdits || '@<>:"/\\|?*%'
  const p = String(prefix || 'OF').split('').filter((c) => !interdits.includes(c) && c !== ' ').join('') || 'OF'
  return `${p}_passeport_${type}${correction ? '_correction' : ''}_${stamp}.csv`.slice(0, contrat?.nom_fichier_max || 200)
}

// ── Accusé de traitement (séparateur point-virgule, ligne vide finale possible) ──
export function lireAccuse(text, contrat) {
  const conf = contrat?.accuse || {}
  const sep = conf.separateur || ';'
  const raw = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  if (raw.length === 0) return { ok: false, error: 'Fichier vide', lignes: [] }
  const header = raw[0].split(sep).map((h) => h.trim().toUpperCase())
  const idx = (name) => header.indexOf(name)
  const need = ['ID_UNIQUE_PARTENAIRE', 'STATUT']
  const missing = need.filter((n) => idx(n) < 0)
  if (missing.length) return { ok: false, error: `Ce fichier n'est pas un accusé de traitement : colonne ${missing.join(', ')} absente`, lignes: [] }
  const lignes = raw.slice(1).map((l) => {
    const c = l.split(sep)
    const g = (n) => (idx(n) >= 0 ? (c[idx(n)] || '').trim() : '')
    return {
      numero: g('NUMERO_LIGNE'),
      id_unique: g('ID_UNIQUE_PARTENAIRE'),
      id_declaration: g('ID_DECLARATION_PARTENAIRE'),
      statut: g('STATUT'),
      colonne: g('COLONNE'),
      code: g('CODE_ERREUR'),
      // la description peut contenir le séparateur : on garde tout ce qui suit
      description: idx('DESCRIPTION_ERREUR') >= 0 ? c.slice(idx('DESCRIPTION_ERREUR')).join(sep).trim() : '',
    }
  }).filter((l) => l.id_unique)
  return { ok: true, lignes }
}

export function causeLabel(envoi, regles) {
  if (!envoi?.code_erreur) return ''
  const causes = regles?.causes || {}
  const c = causes[envoi.code_erreur]
  if (c && typeof c === 'object') return c[envoi.cause_probable] || Object.values(c)[0]
  return causes._defaut || ''
}

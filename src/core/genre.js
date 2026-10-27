// Genre des personnes et accords (S19, 27/10/2026)
//
// Une seule règle pour tout l'outil : écrans, PDF et e-mails passent par ces fonctions.
// Chaque fiche garde son propre champ (une personne = une fiche, pas de copie) :
//   - stagiaire       trainees.gender           'male' | 'female' | 'non_binary'
//   - contact client  client_contacts.civilite  'M' | 'Mme'
//   - personnel       hr_people.gender          'M' | 'F'
//   - formateur       trainers.gender           'male' | 'female' (0459, repris de la fiche du personnel quand elle est reliée)
//   - signataire      organization_settings.dirigeant_gender, companies.dirigeant_gender (0459)
// Genre non renseigné ou non binaire : masculin générique (voir FORMES), jamais « (e) ».

const FEMININ = new Set(['female', 'f', 'femme', 'mme', 'madame', 'mlle', 'mademoiselle'])
const MASCULIN = new Set(['male', 'm', 'h', 'homme', 'monsieur', 'mr', 'm.'])
const NEUTRE = new Set(['non_binary', 'x', 'nb', 'non binaire', 'non-binaire'])

// Valeur stockée (toutes conventions de l'outil) vers 'F', 'M', 'X' ou null
export function normaliserGenre(v) {
  if (v === null || v === undefined) return null
  const k = String(v).trim().toLowerCase()
  if (!k) return null
  if (FEMININ.has(k)) return 'F'
  if (MASCULIN.has(k)) return 'M'
  if (NEUTRE.has(k)) return 'X'
  return null
}

// accorder(g, 'formateur', 'formatrice') ; troisième forme pour le genre inconnu ou neutre
export function accorder(g, masculin, feminin, neutre) {
  const n = normaliserGenre(g)
  if (n === 'F') return feminin
  if (n === 'M') return masculin
  return neutre !== undefined ? neutre : masculin
}

// Formes [masculin, féminin, genre non renseigné]. Genre non renseigné : masculin générique de
// l'écrit administratif, sans « (e) » ; la fiche signale à l'écran que la civilité manque.
const FORMES = {
  formateur: ['formateur', 'formatrice', 'formateur'],
  directeur: ['directeur', 'directrice', 'directeur'],
  dirigeant: ['dirigeant', 'dirigeante', 'dirigeant'],
  gerant: ['gérant', 'gérante', 'gérant'],
  salarie: ['salarié', 'salariée', 'salarié'],
  stagiaire: ['stagiaire', 'stagiaire', 'stagiaire'],
  technicien: ['technicien', 'technicienne', 'technicien'],
  inscrit: ['inscrit', 'inscrite', 'inscrit'],
  note: ['noté', 'notée', 'noté'],
  ne: ['né', 'née', 'né'],
  soussigne: ['soussigné', 'soussignée', 'soussigné'],
  designe: ['désigné', 'désignée', 'désigné'],
  informe: ['informé', 'informée', 'informé'],
  convoque: ['convoqué', 'convoquée', 'convoqué'],
  attendu: ['attendu', 'attendue', 'attendu'],
  absent: ['absent', 'absente', 'absent'],
  present: ['présent', 'présente', 'présent'],
}

// mot('formateur', g) ; majuscule initiale avec { majuscule: true }
export function mot(cle, g, { majuscule = false } = {}) {
  const f = FORMES[cle]
  if (!f) throw new Error(`Forme inconnue : ${cle}`)
  const n = normaliserGenre(g)
  const r = n === 'F' ? f[1] : f[n === 'M' ? 0 : 2]
  return majuscule ? r.charAt(0).toUpperCase() + r.slice(1) : r
}

// « Le formateur » / « La formatrice » ; « votre formateur » / « votre formatrice »
export function leMot(cle, g, { majuscule = false } = {}) {
  const n = normaliserGenre(g)
  const art = n === 'F' ? 'la' : 'le'
  const r = `${art} ${mot(cle, g)}`
  return majuscule ? r.charAt(0).toUpperCase() + r.slice(1) : r
}

// Civilité : 'Madame' / 'Monsieur' ; courte : 'Mme' / 'M.' ; inconnue : ''
export function civilite(g, { courte = false } = {}) {
  const n = normaliserGenre(g)
  if (n === 'F') return courte ? 'Mme' : 'Madame'
  if (n === 'M') return courte ? 'M.' : 'Monsieur'
  return ''
}

// Formule d'appel d'un courrier : « Madame Le Meur, » si la civilité et le nom sont connus,
// sinon « Bonjour Prénom, » si le prénom l'est, sinon « Madame, Monsieur, »
export function formuleAppel({ genre, nom, prenom } = {}) {
  const c = civilite(genre)
  if (c && nom) return `${c} ${nom},`
  if (c) return `${c},`
  if (prenom) return `Bonjour ${prenom},`
  return 'Madame, Monsieur,'
}

// « M. Le Meur » (courte) ou « Monsieur Le Meur » pour un contact client ; nom seul si civilité absente
export function nomContact(contact, { courte = true, nomDeFamille = false } = {}) {
  if (!contact) return ''
  const complet = contact.name || [contact.first_name, contact.last_name].filter(Boolean).join(' ')
  const civ = civilite(contact.civilite, { courte })
  // « Bonjour Monsieur Le Meur » ; sans civilité, jamais le nom de famille seul : « Bonjour Ronan Le Meur »
  const nom = nomDeFamille && civ ? (contact.last_name || complet) : complet
  return [civ, nom].filter(Boolean).join(' ').trim()
}

// Valeurs proposées dans les formulaires, dans la convention de chaque fiche
export const CHOIX_CIVILITE_CONTACT = [['', 'Non renseignée'], ['Mme', 'Madame'], ['M', 'Monsieur']]
export const CHOIX_GENRE = [['', 'Non renseigné'], ['female', 'Femme'], ['male', 'Homme']]
// Même convention que CHOIX_GENRE, présentée en civilité (formateur, signataire)
export const CHOIX_CIVILITE_GENRE = [['', 'Non renseignée'], ['female', 'Madame'], ['male', 'Monsieur']]

// Pluriel simple : pluriel(3, 'appareil') → '3 appareils' ; formes irrégulières en troisième argument
export function pluriel(n, singulier, plurielForme) {
  const nb = Number(n) || 0
  return `${nb} ${nb > 1 ? (plurielForme || `${singulier}s`) : singulier}`
}

// Déclaration préalable à l'embauche (DPAE), 0521 : règles communes à l'écran et aux tests.
// Sources (Légifrance, lues le 18/11/2026) : Code du travail R1221-1 (mentions), R1221-4 (au plus tôt dans les huit
// jours précédant la date prévisible de l'embauche), R1221-5 (voie électronique), R1221-7 (accusé de réception).
// Le numéro de sécurité sociale n'est jamais stocké : il se saisit sur le site de l'Urssaf.

export const LIEN_DPAE_URSSAF = 'https://www.urssaf.fr/accueil/employeur/embaucher-gerer-salaries/embaucher/declaration-prealable-embauche.html'
export const LIEN_DPAE_NET_ENTREPRISES = 'https://www.net-entreprises.fr/declaration/dpae/'

/** Contrats de salarié soumis à la DPAE dans l'outil (stage, intérim, mandataire et autre : non). */
export const CONTRATS_DPAE = ['cdi', 'cdd', 'apprentissage', 'professionnalisation']
export const dpaeConcernee = (contrat) => CONTRATS_DPAE.includes(contrat?.contract_type)

const jour = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00`)
const iso = (d) => d.toISOString().slice(0, 10)
const ecart = (a, b) => Math.round((jour(a) - jour(b)) / 86400000)

/** Premier jour où la DPAE peut partir : 8 jours avant la date d'embauche (R1221-4). */
export function dpaeOuvreLe(debut) {
  if (!debut) return null
  const d = jour(debut)
  d.setDate(d.getDate() - 8)
  return iso(d)
}

/**
 * État de la DPAE d'un contrat.
 * 'sans_objet' | 'faite' | 'trop_tot' (avant la fenêtre de 8 jours) | 'a_faire' (dans la fenêtre) | 'en_retard' (embauche passée)
 */
export function etatDpae(contrat, aujourdhui = new Date().toISOString().slice(0, 10)) {
  if (!dpaeConcernee(contrat) || !contrat.start_on) return { etat: 'sans_objet' }
  if (contrat.dpae_sent_on) return { etat: 'faite', le: contrat.dpae_sent_on }
  const ouvre = dpaeOuvreLe(contrat.start_on)
  if (ecart(contrat.start_on, aujourdhui) <= 0) return { etat: 'en_retard', ouvre }
  if (ecart(ouvre, aujourdhui) > 0) return { etat: 'trop_tot', ouvre }
  return { etat: 'a_faire', ouvre }
}

export const LIBELLES_ETAT_DPAE = {
  faite: { label: 'DPAE faite', badge: 'badge-success' },
  trop_tot: { label: 'DPAE à faire', badge: 'badge-neutral' },
  a_faire: { label: 'DPAE à faire maintenant', badge: 'badge-warning' },
  en_retard: { label: 'DPAE non notée', badge: 'badge-danger' },
}

const NATURES = { cdi: 'Contrat à durée indéterminée', cdd: 'Contrat à durée déterminée', apprentissage: 'Contrat d\'apprentissage', professionnalisation: 'Contrat de professionnalisation' }
const frDate = (d) => (d ? jour(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null)
const joindre = (...x) => x.filter((v) => v != null && String(v).trim() !== '').join(' ').trim() || null

/**
 * Récapitulatif des mentions de la DPAE (R1221-1), à recopier sur le site de l'Urssaf.
 * Chaque ligne : { label, valeur } ; valeur null = à saisir sur le site (aide dit pourquoi).
 */
export function recapitulatifDpae({ societe = {}, etablissement = null, personne = {}, contrat = {} }) {
  const lieu = etablissement || {}
  const adresse = joindre(lieu.address || societe.address, [lieu.postal_code || societe.postal_code, lieu.city || societe.city].filter(Boolean).join(' '))
  return [
    { groupe: 'Employeur', label: 'Dénomination', valeur: societe.legal_name || null },
    { groupe: 'Employeur', label: 'SIRET de l\'établissement', valeur: lieu.siret || null, aide: 'à saisir (absent de la fiche de l\'établissement)' },
    { groupe: 'Employeur', label: 'Code APE', valeur: societe.naf || null },
    { groupe: 'Employeur', label: 'Adresse', valeur: adresse },
    { groupe: 'Employeur', label: 'Service de santé au travail', valeur: null, aide: 'à saisir sur le site' },
    { groupe: 'Salarié', label: 'Nom', valeur: personne.last_name || null },
    { groupe: 'Salarié', label: 'Prénoms', valeur: personne.first_name || null },
    { groupe: 'Salarié', label: 'Sexe', valeur: personne.gender === 'F' ? 'Femme' : personne.gender === 'M' ? 'Homme' : null },
    { groupe: 'Salarié', label: 'Date de naissance', valeur: frDate(personne.birth_date) },
    { groupe: 'Salarié', label: 'Lieu de naissance', valeur: null, aide: 'à saisir sur le site' },
    { groupe: 'Salarié', label: 'Numéro de sécurité sociale', valeur: null, aide: 'à saisir sur le site, jamais conservé dans l\'outil' },
    { groupe: 'Embauche', label: 'Date d\'embauche', valeur: frDate(contrat.start_on) },
    { groupe: 'Embauche', label: 'Heure d\'embauche', valeur: null, aide: 'à saisir sur le site' },
    { groupe: 'Embauche', label: 'Nature du contrat', valeur: NATURES[contrat.contract_type] || null },
    { groupe: 'Embauche', label: 'Fin du contrat', valeur: contrat.contract_type === 'cdi' ? 'Sans objet' : frDate(contrat.end_on) },
    { groupe: 'Embauche', label: 'Fin de la période d\'essai', valeur: frDate(contrat.trial_end_on), aide: 'à saisir si une période d\'essai est prévue' },
  ].map((l) => ({ ...l, aide: l.valeur ? null : (l.aide || 'à saisir sur le site') }))
}

/** Texte à copier (une ligne par mention renseignée). */
export const texteRecapitulatif = (lignes) => lignes.filter((l) => l.valeur).map((l) => `${l.label} : ${l.valeur}`).join('\n')

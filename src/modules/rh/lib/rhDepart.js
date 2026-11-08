// Départ d'un salarié (0515, idée n° 4 reprise d'Odoo, décisions de H du 08/11) : le bilan et l'enregistrement sont
// faits par la base (app.depart_bilan, public.rh_enregistrer_depart) ; ici, les appels et la mise en mots du bilan.
import { supabase } from '../../../core/supabase'
import { pluriel } from '../../../core/genre'

const must = ({ data, error }) => { if (error) throw new Error(error.message); return data }

// Motifs proposés (texte libre accepté, repris sur le contrat clos)
export const MOTIFS_DEPART = [
  'Démission', 'Fin de CDD', 'Rupture conventionnelle', 'Licenciement', 'Fin de période d\'essai', 'Retraite',
  'Fin de contrat d\'apprentissage', 'Fin de stage', 'Mutation dans une autre société du groupe',
]

// Cases du bilan, toutes cochées par défaut (choix de H) ; le contrat se clôt toujours
export const CHOIX_DEFAUT = { vehicules: true, absences: true, actions: true, archiver: true }

export const bilanDepart = async (personId, jour) => must(await supabase.rpc('rh_depart_bilan', { p_person: personId, p_jour: jour }))
export const enregistrerDepart = async (personId, jour, motif, choix = CHOIX_DEFAUT) => must(await supabase.rpc('rh_enregistrer_depart', {
  p_person: personId, p_jour: jour, p_motif: motif, p_choix: { ...CHOIX_DEFAUT, ...choix },
}))
export const annulerDepart = async (personId) => must(await supabase.rpc('rh_annuler_depart', { p_person: personId }))

export const frJour = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '')

export function erreurDepart(jour, motif) {
  if (!jour || !/^\d{4}-\d{2}-\d{2}$/.test(jour)) return 'Indiquez le dernier jour de la personne.'
  const m = String(motif || '').trim()
  if (m.length < 2) return 'Indiquez le motif du départ.'
  if (m.length > 200) return 'Motif trop long (200 caractères au plus).'
  return null
}

// Ce que deviendra le compte de connexion, en mots
export function texteCompte(compte, archiver = true, actions = true) {
  const etat = compte?.etat || 'aucun'
  if (etat === 'aucun') return 'Pas de compte de connexion relié à cette fiche.'
  if (etat === 'deja_inactif') return 'Le compte de connexion est déjà désactivé.'
  if (!archiver) return 'Le compte de connexion reste actif (archivage décoché).'
  const rappel = actions ? 'une action vous le rappelle.' : 'pensez à le couper vous-même dans Paramètres, Utilisateurs.'
  if (etat === 'superadmin') return `Compte de super administrateur : il n'est jamais coupé automatiquement, ${rappel}`
  if (etat === 'non_autorise') return `Votre profil ne permet pas de couper un compte de connexion : il reste actif, ${rappel}`
  if (etat === 'societe') return 'La personne garde son compte pour les autres sociétés du groupe ; son accès à cette société est coupé.'
  return 'Le compte de connexion est désactivé (son historique est conservé).'
}

const d = (x) => frJour(x)

// Blocs du bilan dans l'ordre d'affichage : { cle, titre, lignes, effet, choix }
// effet : 'fait' (fait au départ), 'action' (une action de l'équipe), 'info' ; choix : case qui le commande
export function blocsBilan(b) {
  if (!b) return []
  const blocs = []
  const ajoute = (cle, titre, lignes, effet, choix = null) => { if (lignes.length) blocs.push({ cle, titre, lignes, effet, choix }) }
  ajoute('contrats', 'Contrat clos à la date de départ', (b.contrats || []).map((c) =>
    `${(c.type || '').toUpperCase()} depuis le ${d(c.debut)}${c.emploi ? `, ${c.emploi}` : ''}${c.fin ? ` (fin prévue le ${d(c.fin)})` : ''}`), 'fait')
  ajoute('vehicules', 'Véhicule rendu à la date de départ', (b.vehicules || []).map((v) => `${v.vehicule}, affecté depuis le ${d(v.debut)}`), 'fait', 'vehicules')
  ajoute('absences', 'Absences annulées (elles commencent après le départ)', (b.absences || []).map((a) =>
    `${a.type} du ${d(a.debut)} au ${d(a.fin)}${a.statut === 'validee' ? ', validée : jours rendus au solde' : ', en attente'}`), 'fait', 'absences')
  ajoute('epi', 'EPI à récupérer', (b.epi || []).map((e) =>
    `${e.article}${e.taille ? ` (taille ${e.taille})` : ''}, remis le ${d(e.remis)}`), 'action', 'actions')
  ajoute('sessions', 'Sessions à venir dont la personne est formatrice', (b.sessions || []).map((s) =>
    `${s.reference || 'Session'} du ${d(s.debut)}`), 'action', 'actions')
  ajoute('visites', 'Visites de maintenance encore ouvertes, à réaffecter', (b.visites || []).map((v) =>
    `${v.reference || 'Visite'}${v.prevue ? ` prévue le ${d(v.prevue)}` : ', à planifier'}`), 'action', 'actions')
  ajoute('actions', 'Actions de l\'équipe à reprendre', (b.actions || []).map((a) =>
    `${a.titre}${a.echeance ? `, pour le ${d(a.echeance)}` : ''}`), 'action', 'actions')
  ajoute('absences_a_cheval', 'Absences déjà commencées ou qui continuent après le départ (non modifiées)', (b.absences_a_cheval || []).map((a) =>
    `${a.type} du ${d(a.debut)} au ${d(a.fin)}`), 'action', 'actions')
  ajoute('vehicules_futurs', 'Véhicule prévu après le départ (non modifié)', (b.vehicules_futurs || []).map((v) =>
    `${v.vehicule} à partir du ${d(v.debut)}`), 'action', 'actions')
  return blocs
}

// Cases utiles : seulement celles qui commandent quelque chose dans ce bilan (l'archivage, toujours)
export function casesUtiles(b) {
  const blocs = blocsBilan(b)
  const a = (k) => blocs.some((x) => x.choix === k)
  return { vehicules: a('vehicules'), absences: a('absences'), actions: a('actions'), archiver: true }
}

// Résumé après l'enregistrement
export function resumeDepart(r) {
  const f = r?.fait || {}
  const parts = []
  if (f.contrats) parts.push(`${pluriel(f.contrats, 'contrat')} clos`)
  if (f.vehicules) parts.push(`${pluriel(f.vehicules, 'véhicule')} rendu${f.vehicules > 1 ? 's' : ''}`)
  if (f.absences) parts.push(`${pluriel(f.absences, 'absence')} annulée${f.absences > 1 ? 's' : ''}`)
  if (f.actions) parts.push(`${pluriel(f.actions, 'action')} créée${f.actions > 1 ? 's' : ''}`)
  const debut = parts.length ? `Départ enregistré : ${parts.join(', ')}.` : 'Départ enregistré.'
  return r?.archivage_le ? `${debut} ${texteNuit(r.archivage_le, ['desactive', 'societe'].includes(r.compte))}` : debut
}

// Ce que fera la nuit (le compte n'est coupé que s'il a été noté à l'enregistrement)
export function texteNuit(le, compteCoupe) {
  return `Fiche archivée${compteCoupe ? ' et compte de connexion coupé' : ''} le ${frJour(le)}, au cours de la nuit.`
}

// Jour où la nuit traitera un départ : le lendemain du dernier jour, ou la nuit prochaine s'il est déjà passé
export function jourArchivage(dernierJour, aujourdhui) {
  const l = new Date(`${String(dernierJour).slice(0, 10)}T12:00:00`)
  l.setDate(l.getDate() + 1)
  const a = new Date(`${String(aujourdhui).slice(0, 10)}T12:00:00`)
  a.setDate(a.getDate() + 1)
  return (l > a ? l : a).toLocaleDateString('sv-SE')
}

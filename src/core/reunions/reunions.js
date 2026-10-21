// Réunions et rendez-vous (0408) : types, guide repris d'une trame, lignes rapides des notes, email récapitulatif.

export const TYPES_REUNION = {
  rdv_client: 'Rendez-vous client',
  rdv_fournisseur: 'Rendez-vous fournisseur',
  reunion_interne: 'Réunion d\'équipe',
  autre: 'Autre réunion',
}

// Raccourcis de la prise de notes : la ligne commence par le mot, l'assistant s'en sert pour ranger
export const RACCOURCIS = [
  { id: 'decision', libelle: 'Décision', prefixe: 'Décision : ' },
  { id: 'action', libelle: 'Action', prefixe: 'Action (qui, pour quand) : ' },
  { id: 'relancer', libelle: 'À relancer', prefixe: 'À relancer : ' },
  { id: 'info', libelle: 'Info', prefixe: 'Info : ' },
]

const nouvelId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)

/** Guide d'une réunion à partir d'une trame : chaque élément devient une ligne à cocher, avec sa réponse */
export function guideDepuisTrame(items) {
  return (items || []).filter((i) => i && String(i.texte || '').trim())
    .map((i) => ({ id: nouvelId(), type: i.type === 'sujet' ? 'sujet' : 'question', texte: String(i.texte).trim(), coche: false, reponse: '' }))
}

export function nouvelElement(texte, type = 'question') {
  return { id: nouvelId(), type, texte: String(texte || '').trim(), coche: false, reponse: '' }
}

/** Sujets repris du point de la semaine (urgent, pas fait, à relancer) pour une réunion d'équipe */
export function sujetsDuPoint(lignes) {
  const garder = ['urgent', 'non_fait', 'relancer']
  return (lignes || []).filter((l) => !l.retire && garder.includes(l.section))
    .map((l) => nouvelElement(l.owner_nom ? `${l.texte} (${l.owner_nom})` : l.texte, 'sujet'))
}

/** Insère un raccourci à la position du curseur, sur une nouvelle ligne */
export function insererLigne(texte, position, prefixe) {
  const t = texte || ''
  const p = Math.max(0, Math.min(position ?? t.length, t.length))
  const avant = t.slice(0, p)
  const apres = t.slice(p)
  const saut = avant && !avant.endsWith('\n') ? '\n' : ''
  const nouveau = `${avant}${saut}${prefixe}${apres && !apres.startsWith('\n') ? '\n' : ''}${apres}`
  return { texte: nouveau, curseur: avant.length + saut.length + prefixe.length }
}

/** Trouve un membre de l'équipe d'après un nom écrit dans les notes (prénom seul ou nom complet) */
export function membreDepuisNom(nom, equipe, nomProfil) {
  const n = String(nom || '').trim().toLowerCase()
  if (!n) return null
  const exact = equipe.find((p) => nomProfil(p).toLowerCase() === n)
  if (exact) return exact
  const parPrenom = equipe.filter((p) => String(p.first_name || nomProfil(p).split(' ')[0] || '').toLowerCase() === n.split(' ')[0])
  return parPrenom.length === 1 ? parPrenom[0] : null
}

/** Texte du compte rendu noté sur la fiche du client */
export function texteCompteRendu(s) {
  const bloc = (titre, l) => (l && l.length ? `${titre}\n${l.map((x) => `- ${x}`).join('\n')}` : '')
  return [s.resume, bloc('Décisions', s.decisions), bloc('Actions', (s.actions || []).map((a) => [a.titre, a.qui, a.echeance].filter(Boolean).join(' · '))),
    bloc('À relancer', s.a_relancer), s.prochain_rdv ? `Prochain rendez-vous : ${s.prochain_rdv}` : ''].filter(Boolean).join('\n\n')
}

export function lienMessagerie({ a = [], objet = '', corps = '' }) {
  const dest = a.map((x) => String(x || '').trim().replace(/[^\w.@+-]/g, '')).filter((x) => x.includes('@')).join(',')
  return `mailto:${dest}?subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(corps)}`
}

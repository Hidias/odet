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

// ── Faire le point sans l'assistant (assistant non configuré) : rangement par les raccourcis des notes ──
const PREFIXES = [
  ['decisions', /^d[ée]cision\s*:\s*/i],
  ['actions', /^action(\s*\([^)]*\))?\s*:\s*/i],
  ['a_relancer', /^[àa]\s*relancer\s*:\s*/i],
  ['infos', /^info\s*:\s*/i],
]

/** Date écrite dans une ligne (24/10, 24/10/2026, 24-10-26) : la prochaine à venir si l'année manque */
export function dateDansTexte(t, auj = new Date()) {
  const m = String(t || '').match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/)
  if (!m) return ''
  const j = Number(m[1]); const mo = Number(m[2])
  if (j < 1 || j > 31 || mo < 1 || mo > 12) return ''
  let a = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : auj.getFullYear()
  const iso = (y) => `${y}-${String(mo).padStart(2, '0')}-${String(j).padStart(2, '0')}`
  const jour = `${auj.getFullYear()}-${String(auj.getMonth() + 1).padStart(2, '0')}-${String(auj.getDate()).padStart(2, '0')}`
  if (!m[3] && iso(a) < jour) a += 1
  return iso(a)
}

export function pointLocal(m, equipe = [], nomProfil = (p) => p?.display_name || '', auj = new Date()) {
  const out = { decisions: [], actions: [], a_relancer: [], infos: [] }
  const libres = []
  for (const brut of String(m.notes || '').split('\n')) {
    const l = brut.trim()
    if (!l) continue
    const p = PREFIXES.find(([, re]) => re.test(l))
    const texte = p ? l.replace(p[1], '').trim() : l
    if (!texte) continue
    if (p) out[p[0]].push(texte); else libres.push(texte)
  }
  const reponses = (m.guide || []).filter((g) => String(g.reponse || '').trim()).map((g) => `${g.texte} : ${String(g.reponse).trim()}`)
  const actions = out.actions.map((t) => {
    const premier = t.split(/\s+/)[0]
    const membre = membreDepuisNom(premier, equipe, nomProfil)
    return { titre: t, qui: membre ? nomProfil(membre) : '', echeance: dateDansTexte(t, auj) }
  })
  const date = m.starts_at ? new Date(m.starts_at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) : ''
  const interne = m.kind === 'reunion_interne'
  const puces = [...reponses, ...out.infos, ...libres, ...out.decisions].map((x) => `- ${x}`)
  const etapes = [...actions.map((a) => `- ${a.titre}`), ...out.a_relancer.map((x) => `- ${x}`)]
  const corps = [
    interne ? 'Bonjour à tous,' : 'Bonjour,',
    '',
    interne ? `Voici le compte rendu de notre réunion${date ? ` du ${date}` : ''}.` : `Merci pour le temps que vous nous avez accordé${date ? ` le ${date}` : ''}.`,
    '',
    'Voici le récapitulatif des éléments abordés :',
    ...(puces.length ? puces : ['- (à compléter)']),
    ...(etapes.length ? ['', 'Prochaines étapes :', ...etapes] : []),
    '',
    interne ? 'Bonne journée,' : 'Nous restons à votre disposition pour toute question.\n\nBien cordialement,',
  ].join('\n')
  return {
    resume: [...reponses, ...libres].join('\n'),
    decisions: out.decisions,
    actions,
    a_relancer: out.a_relancer,
    prochain_rdv: '',
    email: { objet: interne ? `Compte rendu : ${m.title}` : `Récapitulatif de notre échange${date ? ` du ${date}` : ''}`, corps },
    sansAssistant: true,
  }
}

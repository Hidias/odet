// Champs protégés des documents (décision de H, 19/10, 18h32) : une adresse, un téléphone, un email, un SIRET ou
// un nom de référent ne se tape jamais dans un document. Il s'insère comme champ {{...}}, rempli à l'affichage depuis
// Paramètres : changer une coordonnée la change partout.
//   - champCasse(avant, apres) : vrai si la modification abîme un champ (accolades ouvertes, nom tronqué). L'écran
//     refuse alors la frappe : un champ s'insère ou se retire en entier, il ne se modifie pas lettre par lettre ;
//   - valeursEnDur(texte, ctx) : les coordonnées de l'organisme tapées à la main, et les traces d'un autre organisme ;
//   - remplacerEnDur(texte, ctx) : remplace les coordonnées tapées à la main par leur champ.

const CHAMP = /\{\{\s*[a-z_]+(?:\.[a-z_<>]+){0,2}\s*\}\}/g

// Champs reconnus : org.<champ connu>, app.nom, role.<code>[.email|.telephone|.suppleant], catalogue
// (liste des champs de l'organisme : templateContext.js, buildTemplateContext)
const ORG_CHAMPS = ['nom', 'nom_majuscules', 'raison_sociale', 'adresse_site', 'siege', 'adresse', 'code_postal', 'ville', 'telephone',
  'email', 'site', 'siret', 'nda', 'region', 'region_nda', 'dirigeant', 'dirigeant_qualite', 'lieu_signature', 'tribunal']
const CHAMP_VALIDE = new RegExp(`^\\{\\{\\s*(?:catalogue|org\\.(?:${ORG_CHAMPS.join('|')})|app\\.nom|role\\.[a-z_]+(?:\\.(?:email|telephone|suppleant))?)\\s*\\}\\}$`)

function morceauxAbimes(texte) {
  const s = String(texte || '')
  const sansChamps = s.replace(CHAMP, (m) => (CHAMP_VALIDE.test(m) ? '' : '\u0000'))
  return sansChamps.includes('\u0000') || sansChamps.includes('{{') || sansChamps.includes('}}')
}

export function champCasse(avant, apres) {
  return !morceauxAbimes(avant) && morceauxAbimes(apres)
}

const chiffres = (v) => String(v || '').replace(/\D/g, '')
const echapper = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Motif tolérant aux espaces, points et tirets entre les chiffres (téléphone, SIRET)
function motifChiffres(v) {
  const d = chiffres(v)
  return d.length >= 9 ? new RegExp(d.split('').join('[\\s.\\-]?'), 'g') : null
}

// Valeurs de l'organisme à chercher dans un texte, avec le champ qui les remplace (les plus longues d'abord)
function reperes(ctx) {
  const o = ctx?.org || {}
  const liste = [
    [o.adresse_site, '{{org.adresse_site}}', 'texte'],
    [o.siege, '{{org.siege}}', 'texte'],
    [o.adresse_site_rue, '{{org.adresse_site}}', 'texte'],
    [o.adresse, '{{org.adresse}}', 'texte'],
    [o.email, '{{org.email}}', 'texte'],
    [o.telephone, '{{org.telephone}}', 'chiffres'],
    [o.siret, '{{org.siret}}', 'chiffres'],
  ]
  for (const r of Object.values(ctx?.role || {})) {
    if (r?.email) liste.push([r.email, '', 'texte'])
  }
  return liste.filter(([v]) => v && String(v).trim().length >= 6)
    .sort((a, b) => String(b[0]).length - String(a[0]).length)
}

// Traces d'un autre organisme (outil d'origine) : saisies dans les paramètres de l'organisme (traces_a_signaler, 0412),
// à signaler, jamais remplacées automatiquement. Un numéro se reconnaît avec ou sans espaces.
function tracesAutresOrganismes(ctx) {
  return (ctx?.traces || []).map((t) => motifChiffres(t) || new RegExp(echapper(t).replace(/\s+/g, '\\s+'), 'i')).filter(Boolean)
}

/** Liste des valeurs tapées à la main : [{ texte, champ }] ; champ vide = à corriger à la main */
export function valeursEnDur(texte, ctx) {
  const s = String(texte || '').replace(CHAMP, ' ')
  const vus = []
  for (const [v, champ, sorte] of reperes(ctx)) {
    const re = sorte === 'chiffres' ? motifChiffres(v) : new RegExp(echapper(String(v).trim()), 'gi')
    if (!re) continue
    const m = s.match(re)
    if (m) vus.push({ texte: m[0], champ })
  }
  for (const re of tracesAutresOrganismes(ctx)) {
    const m = s.match(re)
    if (m) vus.push({ texte: m[0], champ: '' })
  }
  return vus
}

/** Remplace les coordonnées tapées à la main par leur champ (sans toucher aux champs déjà présents) */
export function remplacerEnDur(texte, ctx) {
  let s = String(texte || '')
  const champs = []
  s = s.replace(CHAMP, (m) => { champs.push(m); return `\u0001${champs.length - 1}\u0001` })
  for (const [v, champ, sorte] of reperes(ctx)) {
    if (!champ) continue
    const re = sorte === 'chiffres' ? motifChiffres(v) : new RegExp(echapper(String(v).trim()), 'gi')
    if (re) s = s.replace(re, champ)
  }
  return s.replace(/\u0001(\d+)\u0001/g, (_, i) => champs[Number(i)])
}

/** Applique remplacerEnDur à toutes les chaînes d'un contenu (objet ou tableau) */
export function remplacerEnDurPartout(valeur, ctx) {
  if (typeof valeur === 'string') return remplacerEnDur(valeur, ctx)
  if (Array.isArray(valeur)) return valeur.map((v) => remplacerEnDurPartout(v, ctx))
  if (valeur && typeof valeur === 'object') {
    const out = {}
    for (const k of Object.keys(valeur)) out[k] = remplacerEnDurPartout(valeur[k], ctx)
    return out
  }
  return valeur
}

/** Valeurs tapées à la main dans tout un contenu (objet ou tableau) */
export function valeursEnDurPartout(valeur, ctx) {
  const out = []
  const parcourir = (v) => {
    if (typeof v === 'string') out.push(...valeursEnDur(v, ctx))
    else if (Array.isArray(v)) v.forEach(parcourir)
    else if (v && typeof v === 'object') Object.values(v).forEach(parcourir)
  }
  parcourir(valeur)
  const vus = new Set()
  return out.filter((x) => (vus.has(x.texte.toLowerCase()) ? false : vus.add(x.texte.toLowerCase())))
}

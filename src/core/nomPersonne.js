// Nom d'un contact en « NOM Prénom » (demande de H du 07/11). Même règle que la base (0508 : app.nom_majuscules,
// app.prenom_forme, app.contact_nom_affiche), qui la réapplique de toute façon à l'enregistrement ; ici pour l'aperçu et
// l'affichage immédiat après enregistrement.

// Mêmes espaces que app.espaces_nom (insécables, fines, invisibles)
const espaces = (v) => String(v ?? '').replace(/[\s\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+/g, ' ').trim()

// « le régent » → « LE RÉGENT » (particules comprises)
export function nomMajuscules(nom) {
  const s = espaces(nom)
  return s ? s.toLocaleUpperCase('fr-FR') : null
}

// « jEAN-pierre  marie » → « Jean-Pierre Marie » : majuscule au début de chaque partie (espace ou tiret)
export function prenomForme(prenom) {
  const s = espaces(prenom).toLocaleLowerCase('fr-FR')
  if (!s) return null
  let r = ''
  let prec = ' '
  for (const ch of s) {
    r += prec === ' ' || prec === '-' ? ch.toLocaleUpperCase('fr-FR') : ch
    prec = ch
  }
  return r
}

// « DURAND Paul », ou le seul élément connu ; null si ni nom ni prénom
export function nomAffiche(nom, prenom) {
  return [nomMajuscules(nom), prenomForme(prenom)].filter(Boolean).join(' ') || null
}

// Mêmes mots sans tenir compte de l'ordre, de la casse, des tirets ni des virgules (« Paul Durand » et « DURAND Paul ») : app.memes_mots en base
export function memesMots(a, b) {
  const mots = (v) => espaces(v).toLocaleLowerCase('fr-FR').split(/[ ,-]+/).filter(Boolean).sort().join(' ')
  return mots(a) !== '' && mots(a) === mots(b)
}

// Champs à enregistrer depuis un formulaire de contact (nom, prénom séparés). Sans nom ni prénom, le nom libre déjà
// enregistré est gardé (« Contact général ») ; sans rien du tout : erreur à afficher.
export function champsNomContact({ last_name, first_name }, nomActuel = '') {
  const nom = nomMajuscules(last_name)
  const prenom = prenomForme(first_name)
  if (nom || prenom) return { last_name: nom, first_name: prenom, name: nomAffiche(nom, prenom) }
  const libre = espaces(nomActuel)
  if (libre) return { last_name: null, first_name: null, name: libre }
  return { erreur: 'Indiquez au moins le nom ou le prénom' }
}

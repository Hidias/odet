// Écriture vérifiée : une modification qui ne touche aucune ligne n'est jamais prise pour un succès.
//
// POURQUOI : une mise à jour (ou une suppression) refusée par une règle d'accès de la base
// ne renvoie PAS d'erreur : PostgREST répond « 0 ligne modifiée ». Écrite sans `.select()`,
// la requête renvoie { error: null } et l'écran affiche « Enregistré » alors que rien n'a
// changé. Même effet si la fiche a été supprimée ou a changé d'état entre-temps.
//
// CONVENTION (même esprit que fetchAll) :
//   - enregistrer ne lève JAMAIS d'exception : il renvoie { data, error }.
//   - Succès : { data: [lignes modifiées], error: null }, au moins une ligne
//     (ou exactement `attendu` lignes si l'option est donnée).
//   - 0 ligne, ou un autre nombre que `attendu` : { data: [lignes], error } avec
//     error.code = 'AUCUNE_LIGNE' et un message en français prêt pour un toast.
//   - Erreur de la base : { data: null, error } (l'erreur d'origine, inchangée).
//
// UTILISATION :
//   const { error } = await enregistrer(supabase.from('invoices').update(champs).eq('id', id))
//   if (error) return toast.error(error.message)
//   - Passer la requête SANS `.single()` ni `.maybeSingle()`.
//   - `.select('id')` est ajouté s'il manque ; si la requête a déjà un `.select(...)`,
//     il est gardé (les lignes renvoyées portent alors ces colonnes).
//   - Table sans colonne `id` : { colonnes: 'session_id' }.
//   - Plusieurs fiches d'un coup : { attendu: ids.length } pour refuser un enregistrement partiel.
//   - Message propre à l'écran : { message: 'Facture non modifiée : ...' }.
//
//   enregistrerOuLever : mêmes options, renvoie les lignes ou lève l'erreur
//   (pour les écrans qui enchaînent plusieurs écritures dans un try).

export const AUCUNE_LIGNE = 'AUCUNE_LIGNE'

export const MESSAGE_AUCUNE_LIGNE =
  "Rien n'a été enregistré : votre compte n'a pas le droit de modifier cette fiche, ou elle a été modifiée ou supprimée entre-temps."

export function messagePartiel(obtenu, attendu) {
  return `Enregistrement incomplet : ${obtenu} sur ${attendu} enregistré${attendu > 1 ? 's' : ''}. Vérifiez vos droits ou rechargez la page.`
}

function erreurAucuneLigne(obtenu, attendu, message) {
  const texte = message || (obtenu > 0 && attendu != null ? messagePartiel(obtenu, attendu) : MESSAGE_AUCUNE_LIGNE)
  const e = new Error(texte)
  e.code = AUCUNE_LIGNE
  e.obtenu = obtenu
  e.attendu = attendu
  return e
}

function aDejaUnSelect(requete) {
  try { return Boolean(requete?.url?.searchParams?.get('select')) } catch { return false }
}

export async function enregistrer(requete, { colonnes = 'id', attendu = null, message = null } = {}) {
  try {
    const q = aDejaUnSelect(requete) ? requete : requete.select(colonnes)
    const { data, error } = await q
    if (error) return { data: null, error }
    const lignes = Array.isArray(data) ? data : data ? [data] : []
    const ok = attendu == null ? lignes.length > 0 : lignes.length === attendu
    if (!ok) return { data: lignes, error: erreurAucuneLigne(lignes.length, attendu, message) }
    return { data: lignes, error: null }
  } catch (e) {
    return { data: null, error: e }
  }
}

export async function enregistrerOuLever(requete, options) {
  const { data, error } = await enregistrer(requete, options)
  if (error) throw error
  return data
}

export function estAucuneLigne(error) {
  return error?.code === AUCUNE_LIGNE
}

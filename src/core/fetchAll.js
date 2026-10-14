// Chargement complet d'une requête Supabase, sans troncature à 1 000 lignes.
//
// POURQUOI : PostgREST (Supabase) renvoie au plus 1 000 lignes par requête,
// SANS erreur. Une requête sans pagination tronque donc silencieusement ses
// résultats dès que la table grossit (KPI faux, doublons non détectés, etc.).
//
// CONVENTION (unique pour tout le projet) :
//   - fetchAll et fetchAllIn ne lèvent JAMAIS d'exception pour une erreur
//     Supabase : ils renvoient { data, error } comme une requête Supabase
//     classique, ce qui permet de remplacer
//         const { data, error } = await supabase.from('t').select('*')
//     par
//         const { data, error } = await fetchAll(() => supabase.from('t').select('*'))
//   - En cas de succès : { data: [...toutes les lignes...], error: null }.
//   - En cas d'erreur sur N'IMPORTE QUELLE page : { data: null, error }.
//     On ne renvoie jamais un résultat partiel : mieux vaut une erreur visible
//     qu'un tableau tronqué pris pour complet.
//
// UTILISATION :
//   fetchAll(() => supabase.from('t').select('a, b').eq('x', 1).order('date'))
//   - `build` doit renvoyer une requête NEUVE à chaque appel (une par page).
//   - Le helper ajoute `.order(orderBy)` APRÈS le tri éventuellement posé par
//     `build` : c'est un tri SECONDAIRE de départage, qui rend l'ordre stable
//     entre les pages (sans lui, un tri sur une colonne non unique comme
//     `date` ou `name` peut sauter ou doubler des lignes d'une page à l'autre).
//     Le tri principal (celui de `build`) est donc conservé.
//   - Table sans colonne `id` : passer `{ orderBy: 'autre_colonne' }` ou une
//     liste `{ orderBy: ['col_a', 'col_b'] }` formant une clé unique.
//
//   fetchAllIn(() => supabase.from('t').select('*'), 'session_id', ids)
//   - Découpe une longue liste d'identifiants en lots (200 par défaut) pour
//     éviter les URL trop longues, applique `.in(column, lot)` puis fetchAll
//     sur chaque lot, et concatène. ATTENTION : l'ordre global n'est garanti
//     qu'à l'intérieur d'un lot ; si l'appelant dépend d'un tri global, il
//     doit retrier le résultat.

function ajouterTriSecondaire(query, orderBy) {
  const colonnes = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean)
  // Colonnes déjà présentes dans le tri posé par `build` (paramètre `order`
  // de l'URL PostgREST) : inutile de les répéter.
  let existant = ''
  try { existant = query?.url?.searchParams?.get('order') || '' } catch { existant = '' }
  const dejaTriees = new Set(
    existant.split(',').map((s) => s.split('.')[0].trim()).filter(Boolean)
  )
  let q = query
  for (const col of colonnes) {
    if (!dejaTriees.has(col)) q = q.order(col, { ascending: true })
  }
  return q
}

export async function fetchAll(build, { pageSize = 1000, orderBy = 'id' } = {}) {
  const all = []
  for (let from = 0; ; from += pageSize) {
    let query
    try {
      query = ajouterTriSecondaire(build(), orderBy).range(from, from + pageSize - 1)
    } catch (e) {
      return { data: null, error: e }
    }
    const { data, error } = await query
    if (error) return { data: null, error }
    const page = data || []
    all.push(...page)
    if (page.length < pageSize) break
  }
  return { data: all, error: null }
}

// Variantes pour les appelants historiques qui attendaient directement un
// tableau (anciennes copies locales de fetchAll) :
//   - fetchAllOrThrow : renvoie les lignes, ou LÈVE l'erreur Supabase
//     (copies de resultsData.js et Mailing.jsx, qui levaient déjà) ;
//   - fetchAllRows : renvoie les lignes, ou [] en journalisant l'erreur
//     (copies de BudgetModule.jsx et EspaceComptable.jsx, qui journalisaient
//     et continuaient). Ne renvoie jamais un tableau partiel.
export async function fetchAllOrThrow(build, options) {
  const { data, error } = await fetchAll(build, options)
  if (error) throw error
  return data
}

export async function fetchAllRows(build, options) {
  const { data, error } = await fetchAll(build, options)
  if (error) {
    console.error('fetchAll :', error.message || error)
    return []
  }
  return data
}

export async function fetchAllIn(build, column, ids, { chunk = 200, ...options } = {}) {
  const uniques = [...new Set((ids || []).filter((v) => v !== null && v !== undefined))]
  if (uniques.length === 0) return { data: [], error: null }
  const all = []
  for (let i = 0; i < uniques.length; i += chunk) {
    const lot = uniques.slice(i, i + chunk)
    const { data, error } = await fetchAll(() => build().in(column, lot), options)
    if (error) return { data: null, error }
    all.push(...data)
  }
  return { data: all, error: null }
}

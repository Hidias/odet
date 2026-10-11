// ════════════════════════════════════════════════════════════════
// storageUtils.js — Helpers pour Supabase Storage
// ════════════════════════════════════════════════════════════════
//
// PROBLÈME RÉSOLU :
// Supabase Storage refuse toute clé (chemin de fichier) contenant des
// caractères non-ASCII ou des espaces.
//
//   sessions/xxx/Grille_SST_PINTO CUNHA_André.pdf
//   → StorageApiError: Invalid key
//
// Il faut donc TOUJOURS sanitiser le nom de fichier avant de construire
// le chemin passé à supabase.storage.from(...).upload(path, file).
//
// ⚠️ Sanitiser le CHEMIN STORAGE uniquement.
// Le nom affiché (colonne file_name en base, nom de PJ email, entrée ZIP)
// doit conserver le nom d'origine avec ses accents : ce sont des colonnes
// texte Postgres / des encodages UTF-8, aucune contrainte de ce type.
// ════════════════════════════════════════════════════════════════

/**
 * Transforme un nom de fichier en clé Supabase Storage valide.
 * - supprime les accents / diacritiques (é → e, ï → i, à → a...)
 * - remplace tout caractère hors [a-zA-Z0-9._-] par _ (espaces, apostrophes, etc.)
 * - dédoublonne les underscores consécutifs
 * - retire les underscores en début / fin
 *
 * @param {string} name - nom de fichier d'origine (ex: "Grille SST_André.pdf")
 * @returns {string} clé sûre (ex: "Grille_SST_Andre.pdf")
 */
// Caractères que NFD ne décompose pas (ligatures, lettres barrées)
const LIGATURES = {
  'Œ': 'OE', 'œ': 'oe', 'Æ': 'AE', 'æ': 'ae',
  'Ø': 'O', 'ø': 'o', 'Đ': 'D', 'đ': 'd',
  'Ł': 'L', 'ł': 'l', 'ß': 'ss', 'Þ': 'TH', 'þ': 'th',
}

export function sanitizeStorageKey(name) {
  if (!name) return 'fichier'
  const clean = String(name)
    .replace(/[ŒœÆæØøĐđŁłßÞþ]/g, c => LIGATURES[c] || c)
    .normalize('NFD')                    // décompose les caractères accentués
    .replace(/[\u0300-\u036f]/g, '')     // supprime les diacritiques
    .replace(/[^a-zA-Z0-9._-]/g, '_')    // tout le reste → _
    .replace(/_+/g, '_')                 // évite les __ multiples
    .replace(/^_+|_+$/g, '')             // trim des _ en début/fin
  return clean || 'fichier'
}

/**
 * Construit un nom de fichier horodaté et sûr pour le Storage.
 * @param {string} originalName - nom d'origine
 * @param {number} [ts] - timestamp (par défaut Date.now())
 * @returns {string} ex: "1788200282261_Grille_SST_Andre.pdf"
 */
export function buildStorageFileName(originalName, ts = Date.now()) {
  return `${ts}_${sanitizeStorageKey(originalName)}`
}

export default sanitizeStorageKey

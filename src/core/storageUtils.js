import { supabase } from './supabase'

// ════════════════════════════════════════════════════════════════
// storageUtils.js - Helpers pour Supabase Storage
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
//  Sanitiser le CHEMIN STORAGE uniquement.
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

// ════════════════════════════════════════════════════════════════
// Fichiers des buckets privés (liens signés)
// ════════════════════════════════════════════════════════════════
// Les colonnes gardent l'adresse « publique » enregistrée à l'envoi du fichier
// (…/storage/v1/object/public/<bucket>/<chemin>) : elle sert seulement à retrouver
// le chemin. Pour un bucket privé, on demande un lien signé de courte durée.
// Une adresse qui n'est pas celle d'un bucket privé connu est renvoyée telle quelle.


// « documents » privé depuis l'audit du 19/10 (attestations, cartes, documents de session, programmes) : lien signé
export const PRIVATE_BUCKETS = ['trainer-signatures', 'documents']

/** Chemin du fichier dans le bucket, depuis une adresse enregistrée ou un chemin */
export function storagePathFrom(bucket, urlOrPath) {
  if (!urlOrPath) return null
  const s = String(urlOrPath)
  const marker = `/${bucket}/`
  const i = s.indexOf(marker)
  if (i >= 0 && /^https?:/.test(s)) return decodeURIComponent(s.slice(i + marker.length).split('?')[0])
  if (/^https?:|^data:/.test(s)) return null
  return s.replace(/^\/+/, '')
}

/** Lien utilisable par le navigateur : signé (5 min) pour un bucket privé, sinon l'adresse d'origine */
export async function readableUrl(urlOrPath, seconds = 300) {
  if (!urlOrPath || /^data:/.test(String(urlOrPath))) return urlOrPath || null
  for (const bucket of PRIVATE_BUCKETS) {
    // Adresse du stockage de l'instance pour ce bucket (publique, signée ou authentifiée) ; un chemin seul n'est
    // jamais deviné ici
    if (!new RegExp(`/storage/v1/object/(public|sign|authenticated)/${bucket}/`).test(String(urlOrPath))) continue
    const path = storagePathFrom(bucket, urlOrPath)
    if (!path) return null
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds)
    return error ? null : data?.signedUrl || null
  }
  return urlOrPath
}

/** Ouvre un fichier enregistré dans un nouvel onglet (lien signé pour un bucket privé). La fenêtre est ouverte tout de
 * suite, avant la demande du lien, pour ne pas être bloquée par le navigateur. */
export async function ouvrirFichier(urlOrPath, seconds = 300) {
  const w = typeof window !== 'undefined' ? window.open('', '_blank') : null
  const url = await readableUrl(urlOrPath, seconds)
  if (!url) { if (w) w.close(); throw new Error('Fichier introuvable ou accès refusé') }
  if (w) w.location.href = url
  else window.location.href = url
  return url
}

/** Contenu d'un fichier (adresse enregistrée ou lien), sous forme de data URL ; null si illisible */
export async function fileAsDataUrl(urlOrPath) {
  const url = await readableUrl(urlOrPath)
  if (!url) return null
  if (/^data:/.test(url)) return url
  const resp = await fetch(url)
  if (!resp.ok) return null
  const blob = await resp.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

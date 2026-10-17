// Archives de formation (bucket privé « archives-formation », migration 0250).
//   <session>/suivi/...              fiches de suivi formatif, une nouvelle version à chaque archivage
//   <session>/certification-sst/...  grilles de certification SST remplies (à conserver au moins 24 mois)
// Les fichiers déposés ne sont ni remplacés ni supprimés depuis l'application. Ouverture par lien signé.

import { supabase } from '../../../core/supabase'

export const ARCHIVE_BUCKET = 'archives-formation'

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
const safe = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 80)

/** Empreinte SHA-256 (hexadécimal) d'un contenu binaire */
export async function sha256Hex(bytes) {
  const buf = bytes instanceof ArrayBuffer ? bytes : (bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function upload(path, bytes) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: 'application/pdf' })
  const { error } = await supabase.storage.from(ARCHIVE_BUCKET).upload(path, blob, { contentType: 'application/pdf', upsert: false })
  if (error) throw error
}

/**
 * Archive une fiche de suivi formatif et l'inscrit au registre. Renvoie { version, path, hash }.
 * bytes : ArrayBuffer ou Uint8Array du PDF.
 */
export async function archiveFormativeSheet(sessionId, bytes, { fileName, reason } = {}) {
  const hash = await sha256Hex(bytes)
  const name = safe(fileName || 'Fiche_suivi_formatif.pdf')
  const path = `${sessionId}/suivi/${stamp()}_${name}`
  await upload(path, bytes)
  const { data, error } = await supabase.rpc('sf_register_sheet', {
    p_session: sessionId, p_path: path, p_name: name, p_hash: hash, p_reason: reason || null,
  })
  if (error) throw error
  return { version: data, path, hash }
}

/**
 * Archive la grille de certification SST d'un candidat et note son emplacement dans sst_certifications
 * (pdf_url garde le chemin dans le bucket privé, pdf_generated passe à vrai).
 */
export async function archiveSstGrid(certification, bytes, fileName) {
  if (!certification?.session_id || !certification?.id) throw new Error('Grille sans session')
  const path = `${certification.session_id}/certification-sst/${stamp()}_${safe(fileName || 'Grille_SST.pdf')}`
  await upload(path, bytes)
  const { error } = await supabase.from('sst_certifications')
    .update({ pdf_url: `${ARCHIVE_BUCKET}/${path}`, pdf_generated: true })
    .eq('id', certification.id)
  if (error) throw error
  return path
}

/** Chemin dans le bucket à partir de la valeur rangée (« archives-formation/<chemin> » ou chemin seul) */
export function archivePathOf(value) {
  if (!value) return null
  const v = String(value)
  if (v.startsWith(`${ARCHIVE_BUCKET}/`)) return v.slice(ARCHIVE_BUCKET.length + 1)
  if (/^https?:/i.test(v)) return null
  return v
}

/** Ouvre une archive dans un nouvel onglet par un lien signé de 5 minutes */
export async function openArchive(pathOrValue) {
  const path = archivePathOf(pathOrValue)
  if (!path) throw new Error('Archive introuvable')
  const w = window.open('', '_blank')
  const { data, error } = await supabase.storage.from(ARCHIVE_BUCKET).createSignedUrl(path, 300)
  if (error || !data?.signedUrl) {
    if (w) w.close()
    throw error || new Error('Lien indisponible')
  }
  if (w) w.location.href = data.signedUrl
  else window.location.href = data.signedUrl
}

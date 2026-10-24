// Photos des articles et des devis (0445). Fichiers dans le stockage privé « documents » :
//   articles/<article>/…             photo et fiche technique d'un article du catalogue ;
//   devis/<devis ou « brouillon »>/… photo propre à une ligne de devis (site, installation).
// Une photo est allégée avant d'être déposée (1 600 px au plus, JPEG 0,82) ; pour le PDF, elle est relue par un lien
// signé de 5 minutes et réduite à 900 px.

import { supabase } from '../../../core/supabase'
import { compresserImage } from '../../../core/fichiers/compression'

const BUCKET = 'documents'
const nomPropre = (n) => String(n || 'fichier').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-60)

function dataUrlEnBlob(dataUrl) {
  const [tete, b64] = String(dataUrl).split(',')
  const type = (tete.match(/data:([^;]+)/) || [])[1] || 'image/jpeg'
  const bin = atob(b64)
  const o = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i)
  return new Blob([o], { type })
}

/** Dépose une photo allégée ; renvoie son chemin */
export async function deposerPhoto(fichier, dossier) {
  if (!fichier || !/^image\//.test(fichier.type || '')) throw new Error('Choisissez une photo (JPEG ou PNG)')
  const { dataUrl } = await compresserImage(fichier, { coteMax: 1600 })
  const path = `${dossier}/${Date.now()}-${nomPropre(fichier.name).replace(/\.[^.]+$/, '')}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, dataUrlEnBlob(dataUrl), { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error(error.message)
  return path
}

/** Dépose la fiche technique PDF d'un article ; renvoie son chemin */
export async function deposerFiche(fichier, dossier) {
  if (!fichier || fichier.type !== 'application/pdf') throw new Error('La fiche technique doit être un PDF')
  if (fichier.size > 5 * 1024 * 1024) throw new Error('Fiche technique trop lourde (5 Mo au plus)')
  const path = `${dossier}/${Date.now()}-${nomPropre(fichier.name)}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, fichier, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(error.message)
  return path
}

/** Lien signé de 5 minutes (aperçu à l'écran, envoi) */
export async function lienSigne(path, secondes = 300) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, secondes)
  return error ? null : data?.signedUrl || null
}

const chargerImage = (src) => new Promise((resolve, reject) => {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('Photo illisible'))
  img.src = src
})

/** Photo du stockage en image JPEG réduite pour le PDF (data URL), ou null */
export async function photoPourPdf(path, coteMax = 900) {
  try {
    const url = await lienSigne(path)
    if (!url) return null
    const r = await fetch(url)
    if (!r.ok) return null
    const blobUrl = URL.createObjectURL(await r.blob())
    try {
      const img = await chargerImage(blobUrl)
      const k = Math.min(1, coteMax / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k))
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0, c.width, c.height)
      return c.toDataURL('image/jpeg', 0.82)
    } finally { URL.revokeObjectURL(blobUrl) }
  } catch {
    return null
  }
}

/** Lignes dont la photo est imprimée : celles cochées qui ont une photo */
export const lignesAvecPhoto = (items) => (items || []).filter((it) => it?.show_photo && it?.photo_path)

/** Photos à imprimer sous les lignes du devis : [{ title, dataUrl }] (une photo illisible est passée) */
export async function photosDuDevis(items) {
  const out = []
  for (const it of lignesAvecPhoto(items).slice(0, 12)) {
    const dataUrl = await photoPourPdf(it.photo_path)
    if (dataUrl) out.push({ title: it.description_title || '', dataUrl })
  }
  return out
}

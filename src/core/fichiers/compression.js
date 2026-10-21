import jsPDF from 'jspdf'

// Compression des fichiers déposés (décision de H, 21/10) : moins de données stockées, sans perte visible.
//  - Photo ou scan en image : réduit à la résolution d'impression A4 (2 480 px au plus sur le grand côté, soit
//    300 points par pouce), en JPEG de qualité 0,82, puis mis en page dans un PDF A4 (une image par page).
//  - PDF : réenregistré en flux d'objets compacts (sans toucher au contenu) ; gardé tel quel s'il n'y gagne rien.
// Tout se fait dans le navigateur : rien ne part avant d'être allégé.

export const COTE_MAX = 2480
export const QUALITE_JPEG = 0.82
export const LIMITE_OCTETS = 3.4 * 1024 * 1024

const lireDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result)
  r.onerror = () => reject(new Error('Fichier illisible'))
  r.readAsDataURL(blob)
})

const chargerImage = (src) => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('Image illisible'))
  img.src = src
})

/** Image réduite et recompressée : { dataUrl, largeur, hauteur } */
export async function compresserImage(fichier, { coteMax = COTE_MAX, qualite = QUALITE_JPEG } = {}) {
  const url = URL.createObjectURL(fichier)
  try {
    const img = await chargerImage(url)
    const r = Math.min(1, coteMax / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * r))
    const h = Math.max(1, Math.round(img.height * r))
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return { dataUrl: c.toDataURL('image/jpeg', qualite), largeur: w, hauteur: h }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Plusieurs images en un PDF A4, une par page, à l'échelle de la page (portrait ou paysage selon l'image) */
export async function imagesEnPdf(fichiers) {
  let doc = null
  for (const f of fichiers) {
    const { dataUrl, largeur, hauteur } = await compresserImage(f)
    const paysage = largeur > hauteur
    const [pw, ph] = paysage ? [297, 210] : [210, 297]
    if (!doc) doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: paysage ? 'landscape' : 'portrait', compress: true })
    else doc.addPage('a4', paysage ? 'landscape' : 'portrait')
    const r = Math.min(pw / largeur, ph / hauteur)
    const w = largeur * r, h = hauteur * r
    doc.addImage(dataUrl, 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h, undefined, 'FAST')
  }
  return doc ? new Uint8Array(doc.output('arraybuffer')) : null
}

/** PDF réenregistré en flux d'objets compacts ; l'original s'il n'y gagne rien */
export async function allegerPdf(buf) {
  const original = new Uint8Array(buf)
  try {
    const { PDFDocument } = await import('pdf-lib')
    const d = await PDFDocument.load(original, { ignoreEncryption: false, updateMetadata: false })
    const sortie = await d.save({ useObjectStreams: true })
    return sortie.length < original.length ? sortie : original
  } catch {
    return original
  }
}

/**
 * Fichiers choisis (un PDF, ou une ou plusieurs photos) → un seul PDF allégé.
 * Renvoie { octets: Uint8Array, avant, apres } ; lève une erreur lisible si le résultat reste trop lourd.
 */
export async function preparerDepot(fichiers, { limite = LIMITE_OCTETS } = {}) {
  const liste = Array.from(fichiers || [])
  if (!liste.length) throw new Error('Choisissez un fichier.')
  const avant = liste.reduce((s, f) => s + (f.size || 0), 0)
  const pdfs = liste.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''))
  const images = liste.filter((f) => /^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type || ''))
  if (pdfs.length > 1 || (pdfs.length && images.length)) throw new Error('Déposez un seul PDF, ou des photos des pages.')
  if (!pdfs.length && !images.length) throw new Error('Format accepté : PDF, JPEG, PNG ou WebP.')
  if (images.length > 12) throw new Error('12 pages au plus.')
  let octets
  if (pdfs.length) {
    if (pdfs[0].size > 40 * 1024 * 1024) throw new Error('PDF trop lourd (40 Mo au plus avant compression).')
    octets = await allegerPdf(await pdfs[0].arrayBuffer())
  } else {
    octets = await imagesEnPdf(images)
  }
  if (!octets) throw new Error('Fichier illisible.')
  if (octets.length > limite) {
    throw new Error(pdfs.length
      ? 'Ce PDF reste trop lourd après compression : scannez-le en noir et blanc ou en 150 points par pouce, ou déposez des photos des pages.'
      : 'Ces photos restent trop lourdes après compression : déposez moins de pages à la fois.')
  }
  return { octets, avant, apres: octets.length }
}

export const tailleLisible = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`)

/** base64 d'un Uint8Array (envoi au serveur) */
export function enBase64(octets) {
  let s = ''
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode(...octets.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Lu par l'aperçu : data URL d'un Blob */
export { lireDataUrl }

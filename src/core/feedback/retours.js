// Retours des utilisateurs : libellés communs et compression des captures (chantier A, migration 0263).

export const TYPES = [
  { id: 'probleme', label: 'Problème' },
  { id: 'idee', label: 'Idée' },
  { id: 'question', label: 'Question' },
]
export const TYPE_LABELS = { probleme: 'Problème', idee: 'Idée', question: 'Question' }

export const GRAVITES = [
  { id: 'faible', label: 'Gêne légère' },
  { id: 'genant', label: 'Gênant' },
  { id: 'bloquant', label: 'Bloquant' },
]
export const GRAVITE_LABELS = { faible: 'Gêne légère', genant: 'Gênant', bloquant: 'Bloquant' }

// [ton du badge, libellé pour le suivi, libellé pour l'auteur]
export const STATUTS = {
  nouveau: ['warning', 'Nouveau', 'Envoyé'],
  vu: ['info', 'Vu', 'Lu par l\'équipe'],
  en_cours: ['info', 'En cours', 'En cours'],
  fait: ['success', 'Fait', 'Réglé'],
  ecarte: ['neutral', 'Écarté', 'Non retenu'],
}
export const ORDRE_STATUTS = ['nouveau', 'vu', 'en_cours', 'fait', 'ecarte']

const COTE_MAX = 1600
const POIDS_MAX = 2.5 * 1024 * 1024

function chargerImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image illisible'))
    img.src = src
  })
}

// Image (fichier, ou image déjà dessinée) → JPEG compressé en data URL, 1 600 px au plus de côté
export async function compresser(source) {
  let img = source
  let url = null
  if (source instanceof Blob) {
    url = URL.createObjectURL(source)
    img = await chargerImage(url)
  }
  try {
    const w = img.naturalWidth || img.videoWidth || img.width
    const h = img.naturalHeight || img.videoHeight || img.height
    if (!w || !h) throw new Error('Image vide')
    const ratio = Math.min(1, COTE_MAX / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * ratio)
    canvas.height = Math.round(h * ratio)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const q of [0.78, 0.65, 0.5, 0.38]) {
      const data = canvas.toDataURL('image/jpeg', q)
      if (data.length * 0.75 <= POIDS_MAX) return data
    }
    throw new Error('Capture trop lourde, même compressée')
  } finally {
    if (url) URL.revokeObjectURL(url)
  }
}

// Capture de l'écran par le navigateur (le navigateur demande quoi partager) ; indisponible sur téléphone
export const captureEcranPossible = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia

export async function capturerEcran() {
  const flux = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true })
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = flux
    await video.play()
    await new Promise((r) => setTimeout(r, 250))
    return await compresser(video)
  } finally {
    flux.getTracks().forEach((t) => t.stop())
  }
}

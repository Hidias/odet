// Pictogrammes des programmes de formation. Tracés repris des icônes Lucide (licence ISC, https://lucide.dev),
// convertis en chemins SVG sur une grille de 24 × 24. La liste est fermée (contrainte courses_pictogram_check, 0049).
// Rendu en image PNG par le navigateur (canvas), une pastille de couleur avec le tracé en blanc, pour jsPDF.

const cercle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`

export const PICTOGRAMMES = {
  flamme: { label: 'Incendie', d: ['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z'] },
  secours: { label: 'Secourisme', d: ['M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2h-2z'] },
  coeur: { label: 'Santé', d: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z', 'M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27'] },
  electricite: { label: 'Électricité', d: ['M13 2L3 14L12 14L11 22L21 10L12 10L13 2Z'] },
  posture: { label: 'Gestes et postures', d: [cercle(12, 5, 1), 'm9 20 3-6 3 6', 'm6 8 6 2 6-2', 'M12 10v4'] },
  conduite: { label: 'Conduite d\'engins', d: ['M12 12H5a2 2 0 0 0-2 2v5', cercle(13, 19, 2), cercle(5, 19, 2), 'M8 19h3m5-17v17h6M6 12V7c0-1.1.9-2 2-2h3l5 5'] },
  document: { label: 'Document, DUERP', d: ['M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z', 'M14 2L14 8L20 8', 'M16 13L8 13', 'M16 17L8 17', 'M10 9L8 9'] },
  bouclier: { label: 'Sécurité', d: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10'] },
  alarme: { label: 'Alarme, évacuation', d: ['M7 12a5 5 0 0 1 5-5v0a5 5 0 0 1 5 5v6H7v-6Z', 'M5 20a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2H5v-2Z', 'M21 12h1', 'M18.5 4.5 18 5', 'M2 12h1', 'M12 2v1', 'm4.929 4.929.707.707', 'M12 12v6'] },
  chantier: { label: 'Chantier, EPI', d: ['M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2z', 'M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5', 'M4 15v-3a6 6 0 0 1 6-6h0', 'M14 6h0a6 6 0 0 1 6 6v3'] },
}

const hex = (rgb) => `rgb(${rgb.join(',')})`

// Pastille ronde (couleur `fond`) et tracé blanc ; null hors navigateur ou pictogramme inconnu
export function pictogrammePNG(cle, fond = [200, 16, 46], taille = 256) {
  const p = PICTOGRAMMES[cle]
  if (!p || typeof document === 'undefined' || typeof Path2D === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = taille; canvas.height = taille
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = hex(fond)
    ctx.beginPath(); ctx.arc(taille / 2, taille / 2, taille / 2, 0, Math.PI * 2); ctx.fill()
    const echelle = (taille * 0.56) / 24
    ctx.translate(taille * 0.22, taille * 0.22)
    ctx.scale(echelle, echelle)
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    for (const d of p.d) ctx.stroke(new Path2D(d))
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

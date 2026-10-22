// Impression directe d'un PDF depuis l'espace client (22/10, demande de H) : sur ordinateur, la fenêtre d'impression
// du navigateur s'ouvre sans télécharger ; sur téléphone ou tablette (pas d'impression depuis une page cachée), le PDF
// s'ouvre dans un nouvel onglet, d'où l'on imprime avec le bouton de partage.

export const estMobile = (ua = typeof navigator !== 'undefined' ? navigator.userAgent : '', tactile = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0) =>
  /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && tactile > 1)

function enOctets(d) {
  if (d instanceof Uint8Array) return d
  if (d instanceof ArrayBuffer) return new Uint8Array(d)
  const bin = atob(String(d || ''))
  const o = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i)
  return o
}

/**
 * produire() → PDF (ArrayBuffer, Uint8Array ou base64). À appeler directement depuis le clic : sur mobile, l'onglet
 * est ouvert tout de suite (sinon le navigateur le bloque après l'attente).
 */
export async function imprimer(produire) {
  const mobile = estMobile()
  const onglet = mobile ? window.open('', '_blank') : null
  let url = null
  try {
    const pdf = await produire()
    if (!pdf) throw new Error('Aucun document à imprimer')
    url = URL.createObjectURL(new Blob([enOctets(pdf)], { type: 'application/pdf' }))
    if (mobile) {
      if (onglet) onglet.location.href = url
      else window.location.href = url
      setTimeout(() => URL.revokeObjectURL(url), 120000)
      return 'onglet'
    }
    const cadre = document.createElement('iframe')
    cadre.setAttribute('aria-hidden', 'true')
    cadre.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    cadre.src = url
    cadre.onload = () => {
      try { cadre.contentWindow.focus(); cadre.contentWindow.print() } catch { window.open(url, '_blank') }
      setTimeout(() => { cadre.remove(); URL.revokeObjectURL(url) }, 120000)
    }
    document.body.appendChild(cadre)
    return 'impression'
  } catch (e) {
    if (onglet) onglet.close()
    if (url) URL.revokeObjectURL(url)
    throw e
  }
}

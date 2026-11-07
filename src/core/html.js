// Texte saisi à l'écran mis en HTML pour un e-mail.
// Le texte est toujours échappé : « R&D », « < 10 personnes » ou un nom
// avec une apostrophe s'affichent tels quels chez le destinataire.

export const echapperHtml = (texte) => String(texte ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

// Une ligne vide sépare deux paragraphes, un simple retour à la ligne reste
// dans le paragraphe. { ligneParParagraphe: true } : chaque ligne non vide
// devient un paragraphe (relances de devis, texte écrit ligne à ligne).
export function texteEnHtml(texte, { ligneParParagraphe = false } = {}) {
  const propre = String(texte ?? '').replace(/\r\n?/g, '\n')
  const blocs = ligneParParagraphe ? propre.split('\n').map((l) => [l]) : propre.split(/\n\s*\n/).map((b) => b.split('\n'))
  return blocs
    .map((lignes) => lignes.map((l) => l.trim()).filter(Boolean))
    .filter((lignes) => lignes.length)
    .map((lignes) => `<p>${lignes.map(echapperHtml).join('<br>')}</p>`)
    .join('')
}

// HTML ramené au texte lisible (zone de texte, aperçu d'un e-mail envoyé).
// « &amp; » est décodé en dernier : « &amp;lt; » redonne « &lt; », pas « < ».
export function htmlEnTexte(html) {
  return String(html ?? '')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

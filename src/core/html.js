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
// dans le paragraphe.
export function texteEnHtml(texte) {
  return String(texte ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((bloc) => bloc.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((lignes) => lignes.length)
    .map((lignes) => `<p>${lignes.map(echapperHtml).join('<br>')}</p>`)
    .join('')
}

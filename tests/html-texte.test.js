import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { echapperHtml, texteEnHtml, htmlEnTexte } from '../src/core/html'
import { wrapEmailHTML } from '../api/_lib/mailer.js'

describe('texte saisi mis en HTML', () => {
  it('échappe les caractères spéciaux', () => {
    expect(echapperHtml(`R&D < 10 "x" l'été`)).toBe('R&amp;D &lt; 10 &quot;x&quot; l&#39;été')
  })
  it('paragraphes séparés par une ligne vide, retour à la ligne gardé', () => {
    expect(texteEnHtml('Bonjour,\n\nLigne 1\nLigne 2\n\n\nCordialement'))
      .toBe('<p>Bonjour,</p><p>Ligne 1<br>Ligne 2</p><p>Cordialement</p>')
  })
  it('relance : une ligne, un paragraphe', () => {
    expect(texteEnHtml('Bonjour Madame,\nJe reviens vers vous.\n\nN\'hésitez pas.', { ligneParParagraphe: true }))
      .toBe('<p>Bonjour Madame,</p><p>Je reviens vers vous.</p><p>N&#39;hésitez pas.</p>')
  })
  it('un texte qui ressemble à du HTML reste du texte', () => {
    expect(texteEnHtml('<b>Prix</b> & délai')).toBe('<p>&lt;b&gt;Prix&lt;/b&gt; &amp; délai</p>')
  })
  it('vide ou absent', () => {
    expect(texteEnHtml('')).toBe('')
    expect(texteEnHtml(null)).toBe('')
    expect(htmlEnTexte(undefined)).toBe('')
  })
  it('aller et retour sans perte', () => {
    const t = "Bonjour,\n\nR&D < 10 personnes, l'équipe \"terrain\"\net &lt; reste écrit tel quel"
    expect(htmlEnTexte(texteEnHtml(t))).toBe(t)
  })
  it('« Bien cordialement » jamais en double', () => {
    const sender = { name: 'A', email: 'a@example.invalid' }
    const avec = wrapEmailHTML(texteEnHtml('Bonjour,\n\nMerci.\n\nBien cordialement,'), sender, {})
    const sans = wrapEmailHTML(texteEnHtml('Bonjour,\n\nMerci.'), sender, {})
    expect(avec.match(/cordialement/gi)).toHaveLength(1)
    expect(sans.match(/cordialement/gi)).toHaveLength(1)
  })
  it('relance, fiche client et aperçu enregistré passent par la règle partagée', () => {
    expect(readFileSync('src/modules/commercial/lib/useRelanceIA.js', 'utf8')).toContain('texteEnHtml(body, { ligneParParagraphe: true })')
    const fiche = readFileSync('src/modules/commercial/pages/ClientDetail.jsx', 'utf8')
    expect(fiche).toContain('texteEnHtml(emailForm.body)')
    expect(fiche).toContain('htmlEnTexte(data.body)')
    expect(readFileSync('api/send-prospect-email.js', 'utf8')).toContain('body_preview: htmlEnTexte(body)')
  })
})

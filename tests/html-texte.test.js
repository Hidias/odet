import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { echapperHtml, texteEnHtml } from '../src/core/html'

describe('texte saisi mis en HTML', () => {
  it('échappe les caractères spéciaux', () => {
    expect(echapperHtml(`R&D < 10 "x" l'été`)).toBe('R&amp;D &lt; 10 &quot;x&quot; l&#39;été')
  })
  it('paragraphes séparés par une ligne vide, retour à la ligne gardé', () => {
    expect(texteEnHtml('Bonjour,\n\nLigne 1\nLigne 2\n\n\nCordialement'))
      .toBe('<p>Bonjour,</p><p>Ligne 1<br>Ligne 2</p><p>Cordialement</p>')
  })
  it('un texte qui ressemble à du HTML reste du texte', () => {
    expect(texteEnHtml('<b>Prix</b> & délai')).toBe('<p>&lt;b&gt;Prix&lt;/b&gt; &amp; délai</p>')
  })
  it('vide ou absent', () => {
    expect(texteEnHtml('')).toBe('')
    expect(texteEnHtml(null)).toBe('')
  })
  it('relance de devis et e-mail de la fiche client passent par texteEnHtml', () => {
    for (const f of ['src/modules/commercial/lib/useRelanceIA.js', 'src/modules/commercial/pages/ClientDetail.jsx']) {
      const src = readFileSync(f, 'utf8')
      expect(src).toContain('texteEnHtml(')
      expect(src).not.toMatch(/`<p>\$\{/)
    }
  })
})

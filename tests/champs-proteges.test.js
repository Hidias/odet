import { describe, it, expect } from 'vitest'
import { champCasse, valeursEnDur, remplacerEnDur } from '../src/core/org/champsProteges'
import { buildTemplateContext, fillTemplate } from '../src/core/org/templateContext'

const ctx = buildTemplateContext({ org: { name: 'Entreprise Essai', address: '10 rue des Essais', postal_code: '29000', city: 'Brest',
  exploitation_address: '8 parc des Essais', exploitation_postal_code: '29600', exploitation_city: 'Morlaix', phone: '02 11 22 33 44', email: 'contact@entreprise-essai.fr', siret: '12345678200015',
  traces_a_signaler: ['Ancien Organisme Essai', '99 88 77777 66'] } })

describe('champs protégés des documents', () => {
  it('donne l’adresse du site et le siège', () => {
    expect(fillTemplate('{{org.adresse_site}}', ctx)).toBe('8 parc des Essais, 29600 Morlaix')
    expect(fillTemplate('{{org.siege}}', ctx)).toBe('10 rue des Essais, 29000 Brest')
  })
  it('refuse une frappe qui abîme un champ, accepte son retrait en entier', () => {
    expect(champCasse('Adresse : {{org.adresse_site}}.', 'Adresse : {{org.adresse_sit}}.')).toBe(true)
    expect(champCasse('Adresse : {{org.adresse_site}}.', 'Adresse : {{org.adresse_site}.')).toBe(true)
    expect(champCasse('Adresse : {{org.adresse_site}}.', 'Adresse : .')).toBe(false)
    expect(champCasse('Bonjour', 'Bonjour à tous')).toBe(false)
  })
  it('trouve et remplace les coordonnées tapées à la main', () => {
    const t = 'Venez au 8 parc des Essais, 29600 Morlaix ou appelez le 02.11.22.33.44. Ancien : Ancien   Organisme Essai, NDA 9988777776 6.'
    const vus = valeursEnDur(t, ctx)
    expect(vus.map((v) => v.champ)).toContain('{{org.adresse_site}}')
    expect(vus.map((v) => v.champ)).toContain('{{org.telephone}}')
    expect(vus.some((v) => /Ancien\s+Organisme Essai/.test(v.texte) && !v.champ)).toBe(true)
    expect(vus.some((v) => v.texte.replace(/\D/g, '') === '99887777766' && !v.champ)).toBe(true)
    expect(remplacerEnDur(t, ctx)).toBe('Venez au {{org.adresse_site}} ou appelez le {{org.telephone}}. Ancien : Ancien   Organisme Essai, NDA 9988777776 6.')
  })
  it('ne touche pas aux champs déjà présents', () => {
    expect(remplacerEnDur('{{org.telephone}} et {{org.siege}}', ctx)).toBe('{{org.telephone}} et {{org.siege}}')
    expect(valeursEnDur('{{org.adresse_site}}', ctx)).toEqual([])
  })
})

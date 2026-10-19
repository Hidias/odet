import { describe, it, expect } from 'vitest'
import { champCasse, valeursEnDur, remplacerEnDur } from '../src/core/org/champsProteges'
import { buildTemplateContext, fillTemplate } from '../src/core/org/templateContext'

const ctx = buildTemplateContext({ org: { name: 'GLD Sécurité', address: '40 bis Avenue de la Libération', postal_code: '29000', city: 'Quimper',
  exploitation_address: '33 ZA de Penhoad Braz', exploitation_postal_code: '29700', exploitation_city: 'Plomelin', phone: '02 98 52 18 50', email: 'gldsecurite@gmail.com', siret: '83069564900015' } })

describe('champs protégés des documents', () => {
  it('donne l’adresse du site et le siège', () => {
    expect(fillTemplate('{{org.adresse_site}}', ctx)).toBe('33 ZA de Penhoad Braz, 29700 Plomelin')
    expect(fillTemplate('{{org.siege}}', ctx)).toBe('40 bis Avenue de la Libération, 29000 Quimper')
  })
  it('refuse une frappe qui abîme un champ, accepte son retrait en entier', () => {
    expect(champCasse('Adresse : {{org.adresse_site}}.', 'Adresse : {{org.adresse_sit}}.')).toBe(true)
    expect(champCasse('Adresse : {{org.adresse_site}}.', 'Adresse : {{org.adresse_site}.')).toBe(true)
    expect(champCasse('Adresse : {{org.adresse_site}}.', 'Adresse : .')).toBe(false)
    expect(champCasse('Bonjour', 'Bonjour à tous')).toBe(false)
  })
  it('trouve et remplace les coordonnées tapées à la main', () => {
    const t = 'Venez au 33 ZA de Penhoad Braz, 29700 Plomelin ou appelez le 02.98.52.18.50. Ancien : Access Formation.'
    const vus = valeursEnDur(t, ctx)
    expect(vus.map((v) => v.champ)).toContain('{{org.adresse_site}}')
    expect(vus.map((v) => v.champ)).toContain('{{org.telephone}}')
    expect(vus.some((v) => v.texte === 'Access Formation' && !v.champ)).toBe(true)
    expect(remplacerEnDur(t, ctx)).toBe('Venez au {{org.adresse_site}} ou appelez le {{org.telephone}}. Ancien : Access Formation.')
  })
  it('ne touche pas aux champs déjà présents', () => {
    expect(remplacerEnDur('{{org.telephone}} et {{org.siege}}', ctx)).toBe('{{org.telephone}} et {{org.siege}}')
    expect(valeursEnDur('{{org.adresse_site}}', ctx)).toEqual([])
  })
})

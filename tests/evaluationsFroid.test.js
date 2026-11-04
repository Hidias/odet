import { describe, expect, it } from 'vitest'
import { grouper, htmlDe, lienPortail, periode, texteContact, texteStagiaire } from '../api/evaluations-froid.js'

const base = { session_id: 's1', formation: 'Sauveteur secouriste du travail', debut: '2026-03-03', fin: '2026-03-04', jeton: 'abc', rang: 0 }

describe('évaluations à froid : textes et regroupement (0482)', () => {
  it('dates : « le » pour un jour, « du ... au ... » sinon', () => {
    expect(periode('2026-03-03', '2026-03-03')).toBe('le 3 mars 2026')
    expect(periode('2026-03-03', '2026-03-04')).toBe('du 3 mars 2026 au 4 mars 2026')
  })
  it('stagiaire : vouvoiement, code et lien personnels, mention de la relance seulement au rang 1', () => {
    const t0 = texteStagiaire({ ...base, prenom: 'Anne', code: 'K7P2', cible: 'stagiaire' }, 'Organisme Test', 'https://app.exemple.fr')
    expect(t0.sujet).toBe('Votre avis sur la formation « Sauveteur secouriste du travail »')
    expect(t0.corps).toMatch(/^Bonjour Anne,/)
    expect(t0.corps).toContain('Votre code personnel : K7P2')
    expect(t0.corps).toContain('https://app.exemple.fr/#/portail/abc')
    expect(t0.corps).not.toContain('pas encore reçu')
    const t1 = texteStagiaire({ ...base, prenom: 'Anne', rang: 1 }, 'Organisme Test', 'https://app.exemple.fr')
    expect(t1.corps).toContain('pas encore reçu votre évaluation à froid')
    for (const t of [t0, t1]) expect(t.corps).not.toMatch(/—|–/)
  })
  it('contact : un seul mail par session et par adresse, stagiaires sans adresse nommés, employeur invité', () => {
    const envois = [
      { ...base, id: 'a', cible: 'stagiaire', destinataire: 'anne@exemple.fr' },
      { ...base, id: 'b', cible: 'contact', destinataire: 'suivi@exemple.fr', prenom: 'Bob', nom: 'Sans' },
      { ...base, id: 'c', cible: 'employeur', destinataire: 'SUIVI@exemple.fr' },
      { ...base, id: 'd', cible: 'stagiaire', destinataire: 'cleo@exemple.fr' },
      { ...base, id: 'e', session_id: 's2', cible: 'employeur', destinataire: 'suivi@exemple.fr' },
    ]
    const g = grouper(envois)
    expect(g.map((x) => x.map((y) => y.id))).toEqual([['a'], ['b', 'c'], ['d'], ['e']])
    const t = texteContact(g[1], 'Organisme Test', 'https://app.exemple.fr')
    expect(t.corps).toContain('Bob Sans')
    expect(t.corps).toContain('/#/mon-entreprise')
    expect(t.corps).toContain('/#/portail/abc')
    expect(t.corps).not.toMatch(/—|–/)
  })
  it('HTML échappé, liens cliquables', () => {
    expect(htmlDe('a <b>\nhttps://x.fr/#/portail/1')).toBe('a &lt;b&gt;<br><a href="https://x.fr/#/portail/1">https://x.fr/#/portail/1</a>')
    expect(lienPortail('https://x.fr/', 'a b')).toBe('https://x.fr/#/portail/a%20b')
  })
})

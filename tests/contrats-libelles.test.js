// Contrat de maintenance (07/11, signalé par H) : « En début de période » affiché deux fois dans « Facture émise »,
// libellés peu clairs (P0, I0, « 0 € sur la visite »).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const f = readFileSync('src/modules/interventions/pages/Contrats.jsx', 'utf8')
const select = f.slice(f.indexOf('id="ct-terme"'), f.indexOf('</select>', f.indexOf('id="ct-terme"')))

describe('fiche contrat : moment de la facture', () => {
  it('deux choix, chacun affiché une seule fois', () => {
    const options = [...select.matchAll(/<option value="(\w*)">([^<]+)</g)].map((m) => [m[1], m[2]])
    expect(options).toEqual([['echoir', 'Au début de chaque période'], ['echu', 'À la fin de chaque période']])
  })
  it('sans choix enregistré, la règle par défaut de la base est affichée (public : à la fin)', () => {
    expect(select).toContain("value={f.billing_term || (publicClient ? 'echu' : 'echoir')}")
  })
  it('plus de formule ni de sigle dans les libellés', () => {
    for (const t of ['P = P0', '(I0)', '0 € sur la visite', 'Facture émise</label>']) expect(f).not.toContain(t)
  })
})

describe('réglages des interventions : opérations', () => {
  it('l\'écran dit qu\'on renomme les opérations prévues, sans en ajouter', () => {
    const r = readFileSync('src/modules/interventions/pages/Reglages.jsx', 'utf8')
    expect(r).toContain('Renommez ici les opérations prévues par l\'outil')
  })
})

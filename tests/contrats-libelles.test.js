// Contrat de maintenance (07/11, signalé par H) : « En début de période » affiché deux fois dans « Facture émise »,
// libellés peu clairs (P0, I0, « 0 € sur la visite »).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { aideTerme } from '../src/modules/interventions/pages/Contrats.jsx'

const f = readFileSync('src/modules/interventions/pages/Contrats.jsx', 'utf8')
const select = f.slice(f.indexOf('id="ct-terme"'), f.indexOf('</select>', f.indexOf('id="ct-terme"')))

describe('fiche contrat : moment de la facture', () => {
  it('deux choix, chacun affiché une seule fois', () => {
    const options = [...select.matchAll(/<option value="(\w*)">([^<]+)</g)].map((m) => [m[1], m[2]])
    expect(options).toEqual([['echoir', 'Au début de chaque période'], ['echu', 'Après chaque période']])
  })
  it('sans choix enregistré, la règle par défaut de la base est affichée (public : à la fin)', () => {
    expect(f).toContain("const terme = f.billing_term || (publicClient ? 'echu' : 'echoir')")
    expect(select).toContain('value={terme}')
    // rien n'est écrit tant que rien n'est choisi : la règle par défaut reste celle de la base
    expect(f).toContain('billing_term: f.billing_term || null')
  })
  it('plus de formule ni de sigle dans les libellés', () => {
    for (const t of ['P = P0', '(I0)', '0 € sur la visite', 'Facture émise</label>']) expect(f).not.toContain(t)
  })
})

describe('fiche contrat : aide et contrat signé', () => {
  it('l\'aide suit le choix affiché, pas le type de client', () => {
    expect(aideTerme('echu', false, false)).toMatch(/lendemain de chaque période/)
    expect(aideTerme('echoir', false, true)).toMatch(/premier jour de chaque période/)
    expect(aideTerme('echu', true, true)).toMatch(/client public/)
  })
  it('contrat signé : le moment de la facture ne change plus (liste figée, champ jamais écrit)', () => {
    expect(select).toContain('disabled={signe}')
    expect(f).toMatch(/if \(signe\) for \(const k of \[[^\]]*'billing_term'/)
  })
})

describe('réglages des interventions : opérations', () => {
  it('l\'écran dit qu\'on renomme les opérations prévues, sans en ajouter', () => {
    const r = readFileSync('src/modules/interventions/pages/Reglages.jsx', 'utf8')
    expect(r).toContain('Renommez ici les types d\'opération prévus par l\'outil')
  })
})

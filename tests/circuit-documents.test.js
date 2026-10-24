import { describe, it, expect } from 'vitest'
import { modeDuDocument, etapes, etapeCourante, resteATrancher, actionsPossibles, propositionsDepuisFichier, diffProposition } from '../src/modules/qualite/richdocs/circuit'
import templatesCommerce from '../src/modules/qualite/richdocs/templatesCommerce'

const sec = (id, text, title = id) => ({ id, title, blocks: [{ t: 'p', text }] })

describe('circuit de validation des documents (0455)', () => {
  it('circuit du document : propre, sinon par défaut, sinon direct', () => {
    expect(modeDuDocument(null, 'cgv')).toBe('direct')
    expect(modeDuDocument({ default_mode: 'interne', per_doc: {} }, 'cgv')).toBe('interne')
    expect(modeDuDocument({ default_mode: 'interne', per_doc: { cgv: 'complet' } }, 'cgv')).toBe('complet')
    expect(modeDuDocument({ default_mode: 'bizarre' }, 'cgv')).toBe('direct')
  })

  it('étapes selon le circuit, retour de l\'expert repéré', () => {
    expect(etapes('interne').map(([k]) => k)).toEqual(['relecture', 'arbitrage', 'validee'])
    expect(etapes('complet').map(([k]) => k)).toEqual(['relecture', 'arbitrage', 'expert', 'retour', 'validee'])
    expect(etapeCourante({ status: 'arbitrage', mode: 'complet', expert_returned_at: '2026-10-24' })).toBe('retour')
    expect(etapeCourante({ status: 'arbitrage', mode: 'complet' })).toBe('arbitrage')
  })

  it('actions : le relecteur donne son avis, seule la direction arbitre et valide', () => {
    const items = [{ kind: 'modification', status: 'ouverte' }]
    const relecture = { status: 'relecture', mode: 'complet' }
    expect([...actionsPossibles(relecture, { estRelecteur: true })].sort()).toEqual(['avis', 'terminer'])
    expect(actionsPossibles(relecture, { estRelecteur: true }).has('arbitrer')).toBe(false)
    const arb = { status: 'arbitrage', mode: 'complet' }
    expect(actionsPossibles(arb, { estRelecteur: true }).size).toBe(0)
    expect(actionsPossibles(arb, { peutValider: true, items }).has('expert')).toBe(false)
    expect(actionsPossibles(arb, { peutValider: true, items: [] }).has('expert')).toBe(true)
    expect(actionsPossibles(arb, { peutValider: true, items: [] }).has('valider')).toBe(false)
    expect(actionsPossibles({ ...arb, expert_returned_at: 'x' }, { peutValider: true }).has('valider')).toBe(true)
    expect(actionsPossibles({ status: 'arbitrage', mode: 'interne' }, { peutValider: true }).has('valider')).toBe(true)
    expect(actionsPossibles({ status: 'expert', mode: 'complet' }, { peutGerer: true }).has('retour_expert')).toBe(true)
    expect(actionsPossibles({ status: 'validee', mode: 'interne' }, { peutValider: true }).size).toBe(0)
    expect(resteATrancher([{ kind: 'question', status: 'ouverte' }, { kind: 'commentaire', status: 'ouverte' }, { kind: 'modification', status: 'acceptee' }]))
      .toEqual({ modifications: 0, questions: 1, commentaires: 1 })
  })

  it('retour de l\'expert par fichier : une proposition par article changé ou ajouté', () => {
    const avant = [sec('a', 'Un an.'), sec('b', 'Rien.')]
    const apres = [sec('a', 'Trois ans.'), sec('b', 'Rien.'), { ...sec('c', 'Nouveau.'), cond: 'professionnels' }]
    const p = propositionsDepuisFichier(avant, apres)
    expect(p.map((x) => x.section_id)).toEqual(['a', 'c'])
    expect(p[1].proposed.extra).toEqual({ cond: 'professionnels' })
    expect(diffProposition(avant[0], apres[0]).filter((d) => d.t !== '=').map((d) => `${d.t}${d.s}`)).toEqual(['-Un', '+Trois', '-an.', '+ans.'])
  })

  it('conditions de maintenance : compléments et question de durée', () => {
    const m = templatesCommerce['cgv-maintenance']
    const ids = m.sections.map((s) => s.id)
    for (const id of ['sinistre', 'exclusivite', 'modification-parc', 'cession']) expect(ids).toContain(id)
    expect(m.sections.find((s) => s.id === 'exclusivite').cond).toBe('professionnels')
    expect(m.questions[0].section).toBe('duree')
    expect(m.questions[0].choix).toEqual(expect.arrayContaining(['3 ans', '5 ans']))
    expect(JSON.stringify(m)).not.toMatch(/Quimper|GLD/)
  })
})

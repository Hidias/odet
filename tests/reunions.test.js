import { describe, it, expect } from 'vitest'
import { guideDepuisTrame, sujetsDuPoint, insererLigne, membreDepuisNom, texteCompteRendu, lienMessagerie } from '../src/core/reunions/reunions.js'

const nom = (p) => p.display_name

describe('réunions', () => {
  it('reprend une trame en guide à cocher', () => {
    const g = guideDepuisTrame([{ type: 'question', texte: ' Effectif ' }, { type: 'sujet', texte: 'Suite' }, { texte: '' }])
    expect(g.map((x) => [x.type, x.texte, x.coche, x.reponse])).toEqual([['question', 'Effectif', false, ''], ['sujet', 'Suite', false, '']])
    expect(new Set(g.map((x) => x.id)).size).toBe(2)
  })
  it('reprend le point de la semaine comme ordre du jour', () => {
    const s = sujetsDuPoint([{ section: 'urgent', texte: 'Facture', owner_nom: 'Anthony' }, { section: 'bravo', texte: 'Gagné' }, { section: 'relancer', texte: 'Devis', retire: true }])
    expect(s.map((x) => x.texte)).toEqual(['Facture (Anthony)'])
  })
  it('insère un raccourci sur une nouvelle ligne', () => {
    expect(insererLigne('Bonjour', 7, 'Décision : ')).toEqual({ texte: 'Bonjour\nDécision : ', curseur: 19 })
    expect(insererLigne('', 0, 'Info : ')).toEqual({ texte: 'Info : ', curseur: 7 })
    expect(insererLigne('a\nb', 1, 'Action : ').texte).toBe('a\nAction : \nb')
  })
  it('retrouve un membre par son nom ou son prénom', () => {
    const eq = [{ id: 1, display_name: 'Anthony Arzel', first_name: 'Anthony' }, { id: 2, display_name: 'Hubert Poupard', first_name: 'Hubert' }]
    expect(membreDepuisNom('anthony', eq, nom)?.id).toBe(1)
    expect(membreDepuisNom('Hubert Poupard', eq, nom)?.id).toBe(2)
    expect(membreDepuisNom('Pierre', eq, nom)).toBeNull()
  })
  it('compose le compte rendu et le lien de messagerie', () => {
    const t = texteCompteRendu({ resume: 'R', decisions: ['D1'], actions: [{ titre: 'Envoyer le devis', qui: 'Anthony' }], a_relancer: [], prochain_rdv: 'mardi' })
    expect(t).toContain('Décisions\n- D1')
    expect(t).toContain('- Envoyer le devis · Anthony')
    expect(t).toContain('Prochain rendez-vous : mardi')
    expect(lienMessagerie({ a: ['a@b.fr', 'c@d.fr'], objet: 'Récap', corps: 'Bonjour\nà vous' })).toBe('mailto:a@b.fr,c@d.fr?subject=R%C3%A9cap&body=Bonjour%0A%C3%A0%20vous')
  })
})

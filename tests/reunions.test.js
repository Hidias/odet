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
    const s = sujetsDuPoint([{ section: 'urgent', texte: 'Facture', owner_nom: 'Paul' }, { section: 'bravo', texte: 'Gagné' }, { section: 'relancer', texte: 'Devis', retire: true }])
    expect(s.map((x) => x.texte)).toEqual(['Facture (Paul)'])
  })
  it('insère un raccourci sur une nouvelle ligne', () => {
    expect(insererLigne('Bonjour', 7, 'Décision : ')).toEqual({ texte: 'Bonjour\nDécision : ', curseur: 19 })
    expect(insererLigne('', 0, 'Info : ')).toEqual({ texte: 'Info : ', curseur: 7 })
    expect(insererLigne('a\nb', 1, 'Action : ').texte).toBe('a\nAction : \nb')
  })
  it('retrouve un membre par son nom ou son prénom', () => {
    const eq = [{ id: 1, display_name: 'Paul Martin', first_name: 'Paul' }, { id: 2, display_name: 'Jean Durand', first_name: 'Jean' }]
    expect(membreDepuisNom('paul', eq, nom)?.id).toBe(1)
    expect(membreDepuisNom('Jean Durand', eq, nom)?.id).toBe(2)
    expect(membreDepuisNom('Pierre', eq, nom)).toBeNull()
  })
  it('compose le compte rendu et le lien de messagerie', () => {
    const t = texteCompteRendu({ resume: 'R', decisions: ['D1'], actions: [{ titre: 'Envoyer le devis', qui: 'Paul' }], a_relancer: [], prochain_rdv: 'mardi' })
    expect(t).toContain('Décisions\n- D1')
    expect(t).toContain('- Envoyer le devis · Paul')
    expect(t).toContain('Prochain rendez-vous : mardi')
    expect(lienMessagerie({ a: ['a@b.fr', 'c@d.fr'], objet: 'Récap', corps: 'Bonjour\nà vous' })).toBe('mailto:a@b.fr,c@d.fr?subject=R%C3%A9cap&body=Bonjour%0A%C3%A0%20vous')
  })
})

import { pointLocal, dateDansTexte } from '../src/core/reunions/reunions.js'
describe('faire le point sans assistant', () => {
  it('range les notes d\'après les raccourcis et prépare l\'email', () => {
    const m = { kind: 'rdv_client', title: 'Découverte', starts_at: '2026-10-21T13:15:00Z',
      guide: [{ texte: 'Effectif', reponse: '9 salariées' }, { texte: 'Sites', reponse: '' }],
      notes: 'Former toute l\'équipe au SST\nDécision : deux sessions le samedi\nAction (qui, pour quand) : Claire envoie le devis avant vendredi 24/10\nÀ relancer : rappeler Anne début novembre\nInfo : MAC pour certaines' }
    const r = pointLocal(m, [{ id: 'h', display_name: 'Claire Lemoine', first_name: 'Claire' }], (p) => p.display_name, new Date(2026, 9, 21))
    expect(r.decisions).toEqual(['deux sessions le samedi'])
    expect(r.actions).toEqual([{ titre: 'Claire envoie le devis avant vendredi 24/10', qui: 'Claire Lemoine', echeance: '2026-10-24' }])
    expect(r.a_relancer).toEqual(['rappeler Anne début novembre'])
    expect(r.resume).toBe('Effectif : 9 salariées\nFormer toute l\'équipe au SST')
    expect(r.email.corps).toContain('Voici le récapitulatif des éléments abordés :\n- Effectif : 9 salariées\n- MAC pour certaines\n- Former toute l\'équipe au SST\n- deux sessions le samedi')
    expect(r.email.corps).toContain('Prochaines étapes :\n- Claire envoie le devis avant vendredi 24/10\n- rappeler Anne début novembre')
    expect(r.email.corps).not.toMatch(/\btu\b|\bton\b/)
  })
  it('lit une date écrite, l\'année suivante si elle est passée', () => {
    expect(dateDansTexte('avant le 05/01', new Date(2026, 9, 21))).toBe('2027-01-05')
    expect(dateDansTexte('le 24/10/26', new Date(2026, 9, 21))).toBe('2026-10-24')
    expect(dateDansTexte('rien', new Date())).toBe('')
  })
})

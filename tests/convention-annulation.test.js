import { describe, it, expect } from 'vitest'
import { cgvAnnulationBlocs } from '../src/modules/qualite/richdocs/published.js'
import { estFormationSST } from '../src/modules/formation/lib/sst.js'

// Article « Annulation et report » de la convention : articles 8 et 9 des CGV en blocs lisibles, sans rien
// reformuler ; passage SST (de son intertitre à la fin de l'article) seulement pour une formation SST.
const CGV = {
  sections: [
    { id: 'a7', title: 'Article 7. Paiement', blocks: [{ t: 'p', text: 'Hors sujet.' }] },
    { id: 'a8', title: 'Article 8. Annulation, report ou absence du fait du client', blocks: [
      { t: 'p', text: 'Toute annulation est notifiée par écrit.' },
      { t: 'table', head: ['Date', 'Dédommagement dû par le client'], rows: [['Plus de 15 jours avant', 'Aucun'], ['Le jour même', '100 % du prix des heures non suivies']] },
      { t: 'p', text: 'Un report demandé plus de 15 jours avant est sans frais.' },
      { t: 'h', text: 'Formations Sauveteur Secouriste du Travail (SST) : effectif et prérequis' },
      { t: 'p', text: 'Pour les formations SST, les règles suivantes complètent le tableau.' },
      { t: 'ol', items: ['**Effectif réglementaire.** De 4 à 10 participants.', '**Prérequis du MAC.** Certificat SST.'] },
    ] },
    { id: 'a9', title: "Article 9. Annulation ou report du fait de l'organisme", blocks: [{ t: 'p', text: "L'organisme peut reporter une session." }] },
  ],
}
const textes = (blocs) => JSON.stringify(blocs)

describe('Convention : annulation et report', () => {
  it('formation non SST : intertitres, barème ligne par ligne, aucune règle SST', () => {
    const b = cgvAnnulationBlocs(CGV, { sst: false })
    expect(b[0]).toEqual({ h: 'Annulation, report ou absence du fait du client' })
    expect(b).toContainEqual({ bareme: [['Plus de 15 jours avant', 'Aucun'], ['Le jour même', '100 % du prix des heures non suivies']], titre: 'Dédommagement dû par le client' })
    expect(b).toContainEqual({ h: "Annulation ou report du fait de l'organisme" })
    expect(textes(b)).not.toMatch(/SST|MAC|Effectif réglementaire/)
    expect(textes(b)).not.toMatch(/Hors sujet/)
  })
  it('formation SST : passage SST repris tel quel, en liste, sans astérisques ni « ; » ajoutés', () => {
    const b = cgvAnnulationBlocs(CGV, { sst: true })
    expect(b).toContainEqual({ h: 'Formations Sauveteur Secouriste du Travail (SST) : effectif et prérequis' })
    expect(b).toContainEqual({ list: ['1. Effectif réglementaire. De 4 à 10 participants.', '2. Prérequis du MAC. Certificat SST.'], numerote: true })
    expect(textes(b)).not.toMatch(/\*\*|\.\.| ; /)
  })
  it('l\'article 9 suit le passage SST : il revient pour une formation non SST', () => {
    const b = cgvAnnulationBlocs(CGV, { sst: false })
    expect(b).toContainEqual({ p: "L'organisme peut reporter une session." })
  })
  it('un sous-titre ou un intertitre vide ne ferme pas le passage SST (fin de l\'article)', () => {
    const cgv = { sections: [{ title: 'Article 8. Annulation', blocks: [
      { t: 'p', text: 'Règle commune.' },
      { t: 'h', text: 'Formations SST' }, { t: 'p', text: 'Règle SST 1.' },
      { t: 'h', text: 'Maintien et actualisation des compétences' }, { t: 'p', text: 'Règle SST 2.' },
      { t: 'h', text: '' }, { t: 'p', text: 'Règle SST 3.' },
    ] }] }
    expect(textes(cgvAnnulationBlocs(cgv, { sst: false }))).not.toMatch(/Règle SST|Maintien/)
    expect(textes(cgvAnnulationBlocs(cgv, { sst: true }))).toMatch(/Règle SST 3/)
  })
  it('intertitre sans contenu derrière retiré ; seulement des intertitres : rien', () => {
    const cgv = { sections: [{ title: 'Article 8. Annulation', blocks: [{ t: 'h', text: 'Formations SST' }, { t: 'p', text: 'Règle SST.' }] }] }
    expect(cgvAnnulationBlocs(cgv, { sst: false })).toEqual([])
    expect(cgvAnnulationBlocs(cgv, { sst: true })[0]).toEqual({ h: 'Annulation' })
  })
  it('CGV absentes ou sans articles 8 et 9 : rien', () => {
    expect(cgvAnnulationBlocs(null)).toEqual([])
    expect(cgvAnnulationBlocs({ sections: [CGV.sections[0]] })).toEqual([])
  })
  it('formation SST reconnue à son intitulé ou à son code', () => {
    expect(estFormationSST({ title: 'SST initial' })).toBe(true)
    expect(estFormationSST({ title: 'MAC Sauveteur secouriste du travail' })).toBe(true)
    expect(estFormationSST({ title: 'Recyclage', code: 'SST-MAC' })).toBe(true)
    expect(estFormationSST({ title: 'Équipier de première intervention', code: 'INC-EPI' })).toBe(false)
    expect(estFormationSST(null)).toBe(false)
  })
})

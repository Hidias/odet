import { describe, it, expect } from 'vitest'
import {
  metierLigne, metierDeduit, metierDevis, metiersPourPieces, documentsAJoindre, piecesEntrepriseAJoindre,
  pieceValable, objetsProposes, libelleMetier,
} from '../src/modules/commercial/lib/metierDevis'
import { visibleSections, pourDestinataire, loadTemplates } from '../src/modules/qualite/richdocs/model'

const formation = { course_id: 'c1', description_title: 'SST' }
const baes = { description_title: 'Bloc BAES', nature: 'bien' }
const deplacement = { code: 'DEP-Z1', description_title: 'Déplacement', nature: 'service' }
const matFormation = { code: 'MAT-EXT-CO2', description_title: 'Extincteur de formation', nature: 'bien' }
const visite = { description_title: 'Visite annuelle', metier: 'maintenance' }

describe('Métier du devis (0443)', () => {
  it('métier de chaque ligne', () => {
    expect(metierLigne(formation)).toBe('formation')
    expect(metierLigne(baes)).toBe('vente')
    expect(metierLigne(deplacement)).toBe(null)
    expect(metierLigne(matFormation)).toBe(null)
    expect(metierLigne(visite)).toBe('maintenance')
    expect(metierLigne({ description_title: 'Libre' })).toBe(null)
  })
  it('déduit des lignes : un métier, mixte, ou rien', () => {
    expect(metierDeduit([formation, deplacement, matFormation])).toBe('formation')
    expect(metierDeduit([baes, deplacement])).toBe('vente')
    expect(metierDeduit([formation, baes])).toBe('mixte')
    expect(metierDeduit([{ description_title: 'Libre' }])).toBe(null)
    expect(metierDeduit([], { session_id: 's' })).toBe('formation')
  })
  it('le choix de l’équipe l’emporte', () => {
    expect(metierDevis({ metier: 'installation' }, [baes])).toBe('installation')
    expect(metierDevis({ metier: 'nimporte' }, [baes])).toBe('vente')
    expect(metiersPourPieces({ metier: 'mixte' }, [formation, visite])).toEqual(['formation', 'maintenance'])
  })
  it('pièces par métier, sans doublon', () => {
    expect(documentsAJoindre({}, [baes]).map((d) => d.doc)).toEqual(['cgv-vente', 'garantie-vente'])
    expect(documentsAJoindre({}, [visite]).map((d) => d.doc)).toEqual(['cgv-maintenance', 'perimetre-maintenance'])
    expect(documentsAJoindre({}, [visite, { ...visite, metier: 'depannage' }]).map((d) => d.doc)).toEqual(['cgv-maintenance', 'perimetre-maintenance'])
    expect(documentsAJoindre({ metier: 'installation' }, [baes]).map((d) => d.doc)).toEqual(['cgv-installation'])
    expect(piecesEntrepriseAJoindre({ metier: 'installation' }, [])).toEqual(['rc_pro', 'decennale'])
    expect(piecesEntrepriseAJoindre({}, [baes])).toEqual([])
  })
  it('attestation valable à la date du jour', () => {
    expect(pieceValable({ valid_until: '2026-12-31' }, '2026-10-24')).toBe(true)
    expect(pieceValable({ valid_until: '2026-10-23' }, '2026-10-24')).toBe(false)
    expect(pieceValable({ valid_from: '2027-01-01' }, '2026-10-24')).toBe(false)
  })
  it('objets proposés par métier', () => {
    const o = { formation: ['SST', 'SST'], vente: ['Extincteurs'] }
    expect(objetsProposes(o, 'formation')).toEqual(['SST'])
    expect(objetsProposes(o, null)).toEqual(['SST', 'Extincteurs'])
    expect(objetsProposes(null, 'vente')).toEqual([])
    expect(libelleMetier('mixte')).toBe('Mixte')
  })
})

describe('Conditions générales : variante professionnels ou particuliers', () => {
  const content = { sections: [{ id: 'a' }, { id: 'p', cond: 'particuliers' }, { id: 'pro', cond: 'professionnels' }], options: {} }
  it('lecture dans Qualité sans destinataire : comme avant', () => {
    expect(visibleSections(content).map((s) => s.id)).toEqual(['a', 'pro'])
    expect(visibleSections({ ...content, options: { particuliers: true } }).map((s) => s.id)).toEqual(['a', 'p', 'pro'])
  })
  it('remise à un destinataire : seulement ses articles', () => {
    expect(visibleSections(pourDestinataire(content, 'pro')).map((s) => s.id)).toEqual(['a', 'pro'])
    expect(visibleSections(pourDestinataire(content, 'particulier')).map((s) => s.id)).toEqual(['a', 'p'])
  })
  it('les quatre jeux de conditions et leurs annexes sont des documents versionnés', async () => {
    const t = await loadTemplates()
    for (const id of ['cgv', 'cgv-maintenance', 'cgv-vente', 'cgv-installation', 'garantie-vente', 'perimetre-maintenance']) {
      expect(t[id], id).toBeTruthy()
      expect(t[id].sections.length, id).toBeGreaterThan(0)
    }
    for (const id of ['cgv-maintenance', 'cgv-vente', 'cgv-installation']) {
      expect(t[id].family).toBe('commerce')
      expect(t[id].numeroter).toBe(true)
      expect(t[id].sections.some((s) => s.cond === 'particuliers'), id).toBe(true)
      expect(t[id].sections.some((s) => s.cond === 'professionnels'), id).toBe(true)
      // Projets : chaque jeu porte des clauses à faire valider par l'expert
      expect(JSON.stringify(t[id]).includes('À valider par l\'expert'), id).toBe(true)
      // Aucun renvoi par numéro d'article (numérotés à l'impression, variante par variante)
      expect(t[id].sections.every((s) => !/^Article \d/.test(s.title)), id).toBe(true)
    }
    expect(Object.keys(t).length).toBeGreaterThan(30) // modèles qualité gardés, conditions commerciales ajoutées
  })
})

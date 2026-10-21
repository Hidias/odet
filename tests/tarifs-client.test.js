import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
const { tarifPour, prixFormation, prixPiece, prixFrais, prixVisite, ligneAuTarif, appliquerTarifs, valide } = await import('../src/core/tarifs/tarifsClient')

const tarifs = [
  { kind: 'formation', course_id: 'sst', prix_ht: 900, prix_inter_ht: 150 },
  { kind: 'formation', course_id: 'sst', prix_ht: 800, du_groupe: true },
  { kind: 'remise_pieces', remise_pct: 10 },
  { kind: 'piece', part_id: 'p2', prix_ht: 12 },
  { kind: 'deplacement', code: 'DEP-Z1', prix_ht: 0 },
  { kind: 'visite', prix_ht: 55 },
]

describe('tarifs par client (0418)', () => {
  it('le tarif du client passe avant celui du groupe', () => {
    expect(tarifPour(tarifs, { kind: 'formation', course_id: 'sst' }).prix_ht).toBe(900)
  })
  it('formation intra et inter, catalogue sans tarif', () => {
    expect(prixFormation(tarifs, { id: 'sst', price_ht: 1200 })).toMatchObject({ prix: 900, tarifClient: true })
    expect(prixFormation(tarifs, { id: 'sst', price_ht: 1200 }, 'inter').prix).toBe(150)
    expect(prixFormation(tarifs, { id: 'h0b0', price_ht: 700 })).toMatchObject({ prix: 700, tarifClient: false })
  })
  it('pièces : prix négocié, sinon remise ; frais et visite', () => {
    expect(prixPiece(tarifs, { id: 'p2', price_ht: 20 }).prix).toBe(12)
    expect(prixPiece(tarifs, { id: 'p1', price_ht: 45.5 }).prix).toBe(40.95)
    expect(prixFrais(tarifs, 'DEP-Z1', 30)).toMatchObject({ prix: 0, tarifClient: true })
    expect(prixVisite(tarifs, 80).prix).toBe(55)
    expect(prixVisite([], 80)).toMatchObject({ prix: 80, tarifClient: false })
  })
  it('badge sur la ligne au tarif, pas sur un prix modifié', () => {
    expect(ligneAuTarif(tarifs, { course_id: 'sst', unit_price_ht: '900' })).toBe(true)
    expect(ligneAuTarif(tarifs, { course_id: 'sst', unit_price_ht: 950 })).toBe(false)
    expect(ligneAuTarif(tarifs, { code: 'DEP-Z1', unit_price_ht: 0 })).toBe(true)
  })
  it('changement de client : seulement les lignes restées au prix du catalogue', () => {
    const [l, n] = appliquerTarifs(tarifs, [
      { course_id: 'sst', unit_price_ht: 1200 },
      { course_id: 'sst', unit_price_ht: 1100 },
      { code: 'DEP-Z1', unit_price_ht: 30 },
      { description_title: 'Ligne libre', unit_price_ht: 5 },
    ], { courses: [{ id: 'sst', price_ht: 1200 }], frais: [{ code: 'DEP-Z1', unit_price_ht: 30 }] })
    expect(n).toBe(2)
    expect(l.map((x) => x.unit_price_ht)).toEqual([900, 1100, 0, 5])
  })
  it('tarif échu', () => {
    expect(valide({ valid_until: '2000-01-01' })).toBe(false)
    expect(valide({ valid_until: null })).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { erreurNomType, delaiValide, echeanceDuType, choixType, suiteProposee, libelleDelai } from '../src/core/point/typesActions.js'

const auj = '2026-11-11'
const types = [
  { id: 'app', name: 'Appeler', delay_days: 0, next_type_id: null, active: true },
  { id: 'env', name: 'Envoyer un devis', delay_days: 0, next_type_id: 'rel', active: true },
  { id: 'rel', name: 'Relancer le devis', delay_days: 7, next_type_id: null, default_owner_id: 'marie', active: true },
  { id: 'vieux', name: 'Ancien', delay_days: 3, next_type_id: 'app', active: false },
  { id: 'versvieux', name: 'Vers ancien', delay_days: 0, next_type_id: 'vieux', active: true },
]

describe('Types d\'action', () => {
  it('nom : longueur et doublon sans tenir compte de la casse ni des espaces', () => {
    expect(erreurNomType(' a ', types)).toMatch(/au moins 2/)
    expect(erreurNomType('x'.repeat(81), types)).toMatch(/80/)
    expect(erreurNomType('  relancer LE devis ', types)).toMatch(/déjà/)
    expect(erreurNomType('Relancer le devis', types, 'rel')).toBeNull()
    expect(erreurNomType('Visite', types)).toBeNull()
  })
  it('nom unique par société seulement (vue groupe : même nom dans deux sociétés)', () => {
    const t2 = [{ id: 'x1', company_id: 's1', name: 'Appeler' }, { id: 'x2', company_id: 's2', name: 'Appeler' }]
    expect(erreurNomType('Appeler', t2, 'x1', 's1')).toBeNull()
    expect(erreurNomType('Appeler', t2, null, 's1')).toMatch(/déjà/)
  })
  it('délai : entier de 0 à 365', () => {
    expect(delaiValide('0')).toBe(0)
    expect(delaiValide(' 7 ')).toBe(7)
    expect(delaiValide('365')).toBe(365)
    for (const v of ['366', '-1', '2.5', '', 'sept', null]) expect(delaiValide(v)).toBeNull()
  })
  it('échéance : jour de création plus le délai', () => {
    expect(echeanceDuType(types[2], auj)).toBe('2026-11-18')
    expect(echeanceDuType(types[0], auj)).toBe(auj)
    expect(echeanceDuType(null, auj)).toBeNull()
  })
  it('libellé du délai', () => {
    expect(libelleDelai(0)).toBe('le jour même')
    expect(libelleDelai(1)).toBe('1 jour après')
    expect(libelleDelai(7)).toBe('7 jours après')
  })
})

describe('Choix d\'un type à la création', () => {
  const form = { title: '', owner_id: 'moi', due_on: '', urgent: false }
  it('remplit l\'intitulé vide, le responsable du type et l\'échéance', () => {
    expect(choixType(form, types[2], auj)).toMatchObject({ type_id: 'rel', title: 'Relancer le devis', owner_id: 'marie', due_on: '2026-11-18' })
  })
  it('garde un intitulé déjà saisi et le responsable choisi si le type n\'en a pas', () => {
    expect(choixType({ ...form, title: 'Appeler M. Durand' }, types[0], auj)).toMatchObject({ title: 'Appeler M. Durand', owner_id: 'moi', due_on: auj })
  })
  it('changer de type remplace l\'intitulé tant qu\'il est celui du type choisi avant', () => {
    const f1 = choixType(form, types[0], auj, types)
    expect(choixType(f1, types[2], auj, types).title).toBe('Relancer le devis')
    expect(choixType({ ...f1, title: 'Appeler M. Durand' }, types[2], auj, types).title).toBe('Appeler M. Durand')
  })
  it('le type porte sa société (action créée dans la société du type)', () => {
    expect(choixType(form, { ...types[0], company_id: 's2' }, auj, types).company_id).toBe('s2')
  })
  it('sans type : rien d\'autre ne change', () => {
    expect(choixType({ ...form, title: 'x', type_id: 'app' }, null, auj)).toEqual({ ...form, title: 'x', type_id: '' })
  })
})

describe('Suite proposée', () => {
  const faite = { id: 'a1', type_id: 'env', owner_id: 'moi', client_id: 'c1', clients: { id: 'c1', name: 'SARL Dupont' }, link: '/devis/x' }
  it('type suivant, son délai et son responsable, même client et même lien', () => {
    expect(suiteProposee(faite, types, { auj })).toEqual({
      title: 'Relancer le devis : SARL Dupont', owner_id: 'marie', due_on: '2026-11-18', type_id: 'rel', previous_id: 'a1', company_id: null, client_id: 'c1', link: '/devis/x',
    })
  })
  it('sans responsable sur le type suivant : le même que l\'action faite', () => {
    const t = types.map((x) => (x.id === 'rel' ? { ...x, default_owner_id: null } : x))
    expect(suiteProposee({ ...faite, clients: null, client_id: null, link: null }, t, { auj })).toMatchObject({ title: 'Relancer le devis', owner_id: 'moi', client_id: null })
  })
  it('rien sans type, sans suite, avec un type ou un suivant inactif, ou une suite déjà créée', () => {
    expect(suiteProposee({ ...faite, type_id: null }, types, { auj })).toBeNull()
    expect(suiteProposee({ ...faite, type_id: 'app' }, types, { auj })).toBeNull()
    expect(suiteProposee({ ...faite, type_id: 'vieux' }, types, { auj })).toBeNull()
    expect(suiteProposee({ ...faite, type_id: 'versvieux' }, types, { auj })).toBeNull()
    expect(suiteProposee({ ...faite, type_id: 'inconnu' }, types, { auj })).toBeNull()
    expect(suiteProposee(faite, types, { auj, dejaSuivies: ['a1'] })).toBeNull()
    expect(suiteProposee(faite, null, { auj })).toBeNull()
  })
  it('compte de plusieurs sociétés : types et suite de la société de l\'action', () => {
    const t2 = [
      { id: 'e1', company_id: 's1', name: 'Envoyer', next_type_id: 'r2', active: true },
      { id: 'r2', company_id: 's2', name: 'Relancer', delay_days: 7, active: true },
      { id: 'e3', company_id: 's2', name: 'Envoyer', next_type_id: 'r2', active: true },
    ]
    expect(suiteProposee({ id: 'x', type_id: 'e1', company_id: 's1' }, t2, { auj })).toBeNull()
    expect(suiteProposee({ id: 'y', type_id: 'e3', company_id: 's2' }, t2, { auj })).toMatchObject({ type_id: 'r2', company_id: 's2' })
  })
  it('intitulé coupé à 300 caractères', () => {
    expect(suiteProposee({ ...faite, clients: { name: 'x'.repeat(400) } }, types, { auj }).title).toHaveLength(300)
  })
})

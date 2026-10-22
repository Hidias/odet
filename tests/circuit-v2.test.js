// Retours du premier essai réel (22/10) : saisie des participants et impression
import { describe, it, expect } from 'vitest'
import { erreursLigne } from '../src/modules/portail/components/ParticipantsSession'
import { estMobile } from '../src/core/fichiers/imprimer'

const ligne = (x = {}) => ({ first_name: 'Léa', last_name: 'Martin', naissance_identique: true, nom_naissance: '', email: '', ssn: '', birth_date: '', birth_place: '', job_title: '', ...x })

describe('participants saisis par le client', () => {
  it('accepte nom et prénom seuls', () => expect(erreursLigne(ligne())).toEqual([]))
  it('refuse un nom illisible', () => expect(erreursLigne(ligne({ first_name: '123' }))).toContain('nom ou prénom illisible'))
  it('demande le nom de naissance si différent', () => expect(erreursLigne(ligne({ naissance_identique: false }))).toContain('nom de naissance à indiquer'))
  it('contrôle le n° de sécurité sociale', () => {
    expect(erreursLigne(ligne({ ssn: '1 85 05 78 006 084 91' }))).toEqual([])
    expect(erreursLigne(ligne({ ssn: '1850578006084' }))).toEqual([])
    expect(erreursLigne(ligne({ ssn: '185057800608492' })).join()).toMatch(/clé/)
  })
  it('refuse une date de naissance invraisemblable', () => {
    expect(erreursLigne(ligne({ birth_date: '01/01/2020' }))).toContain('date de naissance invraisemblable')
    expect(erreursLigne(ligne({ birth_date: '02/05/1985' }))).toEqual([])
  })
  it('contrôle l\'e-mail', () => expect(erreursLigne(ligne({ email: 'lea@' }))).toContain('e-mail invalide'))
})

describe('impression', () => {
  it('ouvre un onglet sur téléphone et tablette', () => {
    expect(estMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(true)
    expect(estMobile('Mozilla/5.0 (Linux; Android 14)', 5)).toBe(true)
    expect(estMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true)
    expect(estMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false)
    expect(estMobile('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0)).toBe(false)
  })
})

describe('date de naissance en JJ/MM/AAAA', () => {
  it('convertit et refuse une date impossible', async () => {
    const { versIso } = await import('../src/modules/portail/components/ParticipantsSession')
    expect(versIso('02/05/1985')).toBe('1985-05-02')
    expect(versIso('31/02/1985')).toBeNull()
    expect(versIso('1985-05-02')).toBeNull()
    expect(erreursLigne(ligne({ birth_date: '1985' }))).toContain('date de naissance au format JJ/MM/AAAA')
  })
})

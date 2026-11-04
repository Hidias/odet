// Effectif imposé et prérequis de certificat (0479, CGV formation article 8).
import { describe, it, expect } from 'vitest'
import { decouperGroupes, etatEffectif, ajouterMois, statutCertificat, finValiditeInterne, montantDedommagement } from '../src/modules/formation/lib/effectifPrerequis.js'

const SST = { effectif_strict: true, min_participants: 4, max_participants: 10 }

describe('Découpage en groupes', () => {
  it('11 participants pour 4 à 10 : 6 et 5, jamais 10 et 1', () => expect(decouperGroupes(11, 4, 10)).toEqual([6, 5]))
  it('14 : 7 et 7', () => expect(decouperGroupes(14, 4, 10)).toEqual([7, 7]))
  it('21 : trois groupes de 7', () => expect(decouperGroupes(21, 4, 10)).toEqual([7, 7, 7]))
  it('10 : un seul groupe', () => expect(decouperGroupes(10, 4, 10)).toEqual([10]))
  it('3 : impossible sous le minimum', () => expect(decouperGroupes(3, 4, 10)).toBeNull())
  it('chaque groupe respecte le minimum et le maximum', () => {
    for (let n = 4; n <= 60; n++) {
      const g = decouperGroupes(n, 4, 10)
      expect(g.reduce((a, b) => a + b, 0)).toBe(n)
      g.forEach((x) => { expect(x).toBeGreaterThanOrEqual(4); expect(x).toBeLessThanOrEqual(10) })
    }
  })
})

describe('État de l\'effectif', () => {
  it('formation sans effectif imposé : rien', () => expect(etatEffectif(12, { max_participants: 10 })).toBeNull())
  it('sous le minimum', () => expect(etatEffectif(3, SST)).toMatchObject({ niveau: 'insuffisant', manque: 1 }))
  it('dans les limites', () => expect(etatEffectif(4, SST).niveau).toBe('ok'))
  it('au-delà du maximum, découpage proposé', () => expect(etatEffectif(11, SST)).toMatchObject({ niveau: 'depasse', groupes: [6, 5] }))
})

describe('Dates', () => {
  it('ajout de mois', () => expect(ajouterMois('2026-01-15', 6)).toBe('2026-07-15'))
  it('fin de mois respectée', () => expect(ajouterMois('2025-08-31', 6)).toBe('2026-02-28'))
  it('année bissextile', () => expect(ajouterMois('2027-08-31', 6)).toBe('2028-02-29'))
  it('certificat interne valable 24 mois', () => expect(finValiditeInterne('2024-11-04')).toBe('2026-11-04'))
})

describe('Certificat présenté (MAC, tolérance de 6 mois)', () => {
  const base = { filePath: 'prerequis/x.pdf', debutFormation: '2026-11-20', toleranceMois: 6 }
  it('en cours de validité', () => expect(statutCertificat({ ...base, validUntil: '2026-12-01' }).statut).toBe('valide'))
  it('expiré depuis moins de 6 mois : toléré', () => expect(statutCertificat({ ...base, validUntil: '2026-06-01' }).statut).toBe('tolere'))
  it('expiré depuis exactement 6 mois : toléré', () => expect(statutCertificat({ ...base, validUntil: '2026-05-20' }).statut).toBe('tolere'))
  it('expiré depuis plus de 6 mois : refusé', () => expect(statutCertificat({ ...base, validUntil: '2026-05-19' }).statut).toBe('refuse'))
  it('sans copie : manquant', () => expect(statutCertificat({ ...base, filePath: null, validUntil: '2026-12-01' }).statut).toBe('manquant'))
  it('certificat délivré par l\'organisme : pas de copie demandée', () => expect(statutCertificat({ ...base, filePath: null, interne: true, validUntil: '2026-12-01' }).statut).toBe('valide'))
  it('sans date : manquant', () => expect(statutCertificat({ ...base, validUntil: null }).statut).toBe('manquant'))
})

describe('Dédommagement proposé', () => {
  it('intra annulée : 100 % du prix de la session', () => expect(montantDedommagement({ cas: 'intra_annulation', prixSession: 1200 })).toBe(1200))
  it('intra reportée : 50 %', () => expect(montantDedommagement({ cas: 'intra_report', prixSession: 1250.5 })).toBe(625.25))
  it('inter : 100 % des places non honorées', () => expect(montantDedommagement({ cas: 'inter_places', prixPlace: 180, places: 2 })).toBe(360))
  it('cas inconnu : rien', () => expect(montantDedommagement({ cas: 'autre', prixSession: 100 })).toBeNull())
})

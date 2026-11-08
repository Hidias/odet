// 0515 : départ d'un salarié (idée n° 4 reprise d'Odoo). Mise en mots du bilan ; les règles sont en base
// (app.depart_bilan, public.rh_enregistrer_depart, essai supabase/tests/depart_0515.sql).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { erreurDepart, texteCompte, blocsBilan, casesUtiles, resumeDepart, CHOIX_DEFAUT } from '../src/modules/rh/lib/rhDepart'

const bilan = {
  jour: '2026-11-30', archivage_le: '2026-12-01', bloquant: null,
  contrats: [{ id: 'c', type: 'cdi', debut: '2025-01-06', fin: null, emploi: 'Technicien' }],
  vehicules: [{ id: 'v', vehicule: 'AA-123-AA Renault Kangoo', debut: '2026-01-02' }],
  vehicules_futurs: [],
  absences: [{ id: 'a', type: 'Congés payés', debut: '2026-12-10', fin: '2026-12-12', statut: 'validee' }],
  absences_a_cheval: [],
  epi: [{ id: 'e', article: 'Casque', taille: 'M', remis: '2026-03-01' }],
  sessions: [], visites: [{ id: 'x', reference: 'ITV-2026-0004', prevue: null }], actions: [],
  compte: { etat: 'desactive' },
}

describe('erreurDepart', () => {
  it('demande une date et un motif', () => {
    expect(erreurDepart('', 'Démission')).toMatch(/dernier jour/)
    expect(erreurDepart('2026-11-30', ' ')).toMatch(/motif/)
    expect(erreurDepart('2026-11-30', 'x'.repeat(201))).toMatch(/trop long/)
    expect(erreurDepart('2026-11-30', 'Démission')).toBeNull()
  })
})

describe('blocsBilan', () => {
  it('ne montre que ce qui existe, dans l\'ordre, avec son effet et sa case', () => {
    const b = blocsBilan(bilan)
    expect(b.map((x) => x.cle)).toEqual(['contrats', 'vehicules', 'absences', 'epi', 'visites'])
    expect(b.find((x) => x.cle === 'contrats')).toMatchObject({ effet: 'fait', choix: null })
    expect(b.find((x) => x.cle === 'epi')).toMatchObject({ effet: 'action', choix: 'actions' })
    expect(b.find((x) => x.cle === 'absences').lignes[0]).toMatch(/validée : jours rendus au solde/)
    expect(b.find((x) => x.cle === 'epi').lignes[0]).toMatch(/^Casque \(taille M\), remis le 1 mars 2026$/)
    expect(b.find((x) => x.cle === 'visites').lignes[0]).toBe('ITV-2026-0004, à planifier')
    expect(blocsBilan(null)).toEqual([])
  })
  it('propose seulement les cases utiles, l\'archivage toujours', () => {
    expect(casesUtiles(bilan)).toEqual({ vehicules: true, absences: true, actions: true, archiver: true })
    expect(casesUtiles({ ...bilan, vehicules: [], absences: [], epi: [], visites: [] })).toEqual({ vehicules: false, absences: false, actions: false, archiver: true })
  })
})

describe('texteCompte', () => {
  it('dit ce que devient le compte', () => {
    expect(texteCompte({ etat: 'superadmin' })).toMatch(/jamais coupé automatiquement/)
    expect(texteCompte({ etat: 'societe' })).toMatch(/autres sociétés/)
    expect(texteCompte({ etat: 'desactive' })).toMatch(/désactivé/)
    expect(texteCompte({ etat: 'desactive' }, false)).toMatch(/reste actif/)
    expect(texteCompte(null)).toMatch(/Pas de compte/)
  })
})

describe('resumeDepart', () => {
  it('compte ce qui a été fait et annonce la nuit', () => {
    expect(resumeDepart({ fait: { contrats: 1, vehicules: 1, absences: 2, actions: 3 }, archivage_le: '2026-12-01' }))
      .toBe('Départ enregistré : 1 contrat clos, 1 véhicule rendu, 2 absences annulées, 3 actions créées. Fiche archivée et compte coupé le 1 décembre 2026, au cours de la nuit.')
    expect(resumeDepart({ fait: { contrats: 0 }, archivage_le: null })).toBe('Départ enregistré.')
  })
  it('toutes les cases sont cochées par défaut (choix de H)', () => {
    expect(Object.values(CHOIX_DEFAUT).every(Boolean)).toBe(true)
  })
})

describe('liens avec la base et la nuit', () => {
  const migration = readFileSync('supabase/migrations/0515_rh_depart.sql', 'utf8')
  it('les fonctions appelées existent dans la migration', () => {
    for (const f of ['rh_depart_bilan', 'rh_enregistrer_depart', 'rh_annuler_depart', 'rh_departs_appliquer']) {
      expect(migration).toContain(`function public.${f}(`)
    }
  })
  it('la nuit applique les départs', () => {
    expect(readFileSync('api/maintenance-nuit.js', 'utf8')).toContain("admin.rpc('rh_departs_appliquer')")
  })
})

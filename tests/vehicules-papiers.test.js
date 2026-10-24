import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import { PDFDocument } from 'pdf-lib'

vi.mock('../src/core/supabase', () => ({ supabase: {} }))
const { decouperAdresse, echeanceSinistre, eConstatPossible, donneesVehicule, infosEConstat, remplirCerfaCession, remplirConstat, papierValable } = await import('../src/modules/vehicules/lib/papiersVehicule')

const vehicule = {
  plate: 'AB-123-CD', vin: 'VF1RFB00X12345678', brand: 'Renault', model: 'Kangoo', type_variant: 'FW0E', national_genre: 'CTTE',
  commercial_name: 'KANGOO', registration_formula: '2019AB12345', first_registration_on: '2019-03-14', insurer: 'Assureur', insurance_policy: 'P-1',
  green_card_number: 'CV-2', own_damage_covered: true,
}
const societe = { legal_name: 'Société Essai', siret: '123 456 789 00012', address: '12 bis rue des Lilas', postal_code: '29900', city: 'Concarneau' }

describe('Papiers des véhicules', () => {
  it('adresse découpée pour les cases du Cerfa', () => {
    expect(decouperAdresse('12 bis rue des Lilas')).toEqual({ numero: '12', extension: 'bis', type: 'rue', voie: 'des Lilas' })
    expect(decouperAdresse('4, avenue Foch')).toEqual({ numero: '4', extension: '', type: 'avenue', voie: 'Foch' })
    expect(decouperAdresse('Lieu-dit Kerbleiz').voie).toBe('Lieu-dit Kerbleiz')
  })
  it('sinistre : à déclarer avant la date limite, en retard après, fait une fois déclaré', () => {
    const s = { kind: 'sinistre', claim_status: 'a_declarer', claim_deadline_on: '2026-10-30' }
    expect(echeanceSinistre(s, '2026-10-26').etat).toBe('afaire')
    expect(echeanceSinistre(s, '2026-11-02').etat).toBe('retard')
    expect(echeanceSinistre({ ...s, claim_status: 'declare', claim_declared_on: '2026-10-27' }, '2026-11-02').etat).toBe('fait')
    expect(echeanceSinistre({ kind: 'panne' })).toBeNull()
  })
  it('e-constat auto : deux véhicules au plus, en France, sans blessé', () => {
    expect(eConstatPossible({ vehicules: 2, france: true, blesses: false }).possible).toBe(true)
    expect(eConstatPossible({ vehicules: 3 }).raisons).toEqual(['plus de deux véhicules'])
    expect(eConstatPossible({ blesses: true, france: false }).raisons).toHaveLength(2)
  })
  it('attestation valable à une date', () => {
    expect(papierValable({ valid_from: '2026-04-01', valid_until: '2027-03-31' }, '2026-10-24')).toBe(true)
    expect(papierValable({ valid_until: '2026-03-31' }, '2026-10-24')).toBe(false)
  })
  it('infos à recopier dans l’e-constat', () => {
    const l = Object.fromEntries(infosEConstat(donneesVehicule({ vehicule, societe })))
    expect(l['Immatriculation']).toBe('AB-123-CD')
    expect(l['N° de carte verte']).toBe('CV-2')
    expect(l['Assuré (preneur d\'assurance)']).toBe('Société Essai')
  })
  it('Cerfa 15776 : véhicule, société et acheteur dans les deux exemplaires', async () => {
    const d = donneesVehicule({ vehicule, km: 84512, societe })
    const pdf = await remplirCerfaCession(fs.readFileSync('public/formulaires/cerfa_15776-01.pdf'), d, { date: '2026-10-24', heure: '14:05' }, { nom: 'Paul Martin', sexe: 'M', adresse: '4 avenue Foch', cp: '29200', ville: 'Brest' })
    const f = (await PDFDocument.load(pdf)).getForm()
    for (const p of [1, 2]) {
      const t = (n) => f.getTextField(`topmostSubform[0].Page${p}[0].${n}[0]`).getText()
      expect(t('num_Immatriculation')).toBe('AB-123-CD')
      expect(t('num_Formule')).toBe('19AB12345')
      expect(t('Num_Siret')).toBe('12345678900012')
      expect(t('num_VoieAdresse')).toBe('12')
      expect(t('txt_NomVoie')).toBe('des Lilas')
      expect(t('num_DateVenteAnnée')).toBe('2026')
      expect(t('num_HoraireVente2')).toBe('05')
      expect(t('txt_IdentitéAcheteur')).toBe('Paul Martin')
      expect(f.getRadioGroup(`topmostSubform[0].Page${p}[0].Groupe_de_boutons_radio3[0]`).getSelected()).toBe('1')
    }
  })
  it('constat : la partie Véhicule A est écrite sur la dernière page, les autres pages gardées', async () => {
    const src = await PDFDocument.create()
    src.addPage([595.22, 842]); src.addPage([595.22, 842])
    const out = await PDFDocument.load(await remplirConstat(await src.save(), donneesVehicule({ vehicule, societe, conducteur: { first_name: 'Jean', last_name: 'Dupont' } })))
    expect(out.getPageCount()).toBe(2)
  })
})

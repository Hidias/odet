import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  MOTIFS_CDD, estRemplacement, sansTermePermis, modelePour, conditions, remunerationAuDebut, texteRemuneration,
  texteDureeTravail, valeurs, articlesRetenus, champsDe, remplir, manquants, erreurAvenant, modeleCourant, origine, CHAMPS,
} from '../src/modules/rh/lib/rhContrats'

const migration = readFileSync(new URL('../supabase/migrations/0525_rh_contrats.sql', import.meta.url), 'utf8')
// Modèles de départ tels que posés par la migration
const modeles = Object.fromEntries([...migration.matchAll(/\('(cdi|cdd|avenant)', '[^']+', \$j\$(\[[\s\S]*?\])\$j\$::jsonb\)/g)]
  .map((m) => [m[1], { kind: m[1], version: 1, status: 'projet', articles: JSON.parse(m[2]) }]))

const societe = { legal_name: 'GLD Sécurité', legal_form: 'SAS', siren: '123456789', address: '1 rue X', postal_code: '29700', city: 'Plomelin', idcc: '3248' }
const reglages = { collective_agreement_name: 'Métallurgie', retirement_fund: 'Caisse X', pay_terms: 'mensuellement, par virement', prevoyance_org: '' }
const personne = { first_name: 'Jean', last_name: 'Essai', personal_address: '2 rue Y', personal_postal_code: '29000', personal_city: 'Quimper' }
const cdi = { contract_type: 'cdi', start_on: '2026-12-01', job_title: 'Technicien', qualification: 'Technicien niveau 3', work_places: 'Plomelin', weekly_hours: 35 }
const remu = { amount: 2100, period: 'mensuel', effective_on: '2026-12-01' }
// Primes et accessoires gardés avec la rémunération (choix de H du 18/11)

describe('Contrats de travail (0525)', () => {
  it('les trois modèles de départ sont lisibles et chaque champ a un libellé', () => {
    expect(Object.keys(modeles).sort()).toEqual(['avenant', 'cdd', 'cdi'])
    for (const m of Object.values(modeles)) for (const a of m.articles) for (const k of champsDe(a.texte)) expect(CHAMPS[k], k).toBeTruthy()
  })
  it('aucune clause facultative dans les modèles', () => {
    const texte = JSON.stringify(modeles).toLowerCase()
    for (const mot of ['mobilité', 'non-concurrence', 'non concurrence', 'exclusivité', 'astreinte']) expect(texte).not.toContain(mot)
  })
  it('motifs de CDD : cas 1° à 4° de L1242-2, sans terme précis seulement pour remplacement et saisonnier', () => {
    expect(Object.keys(MOTIFS_CDD)).toHaveLength(8)
    expect(estRemplacement('remplacement_absence')).toBe(true)
    expect(sansTermePermis('saisonnier')).toBe(true)
    expect(sansTermePermis('accroissement')).toBe(false)
    // L1242-7 : ni le passage provisoire à temps partiel ni le départ avant suppression du poste
    expect(sansTermePermis('remplacement_temps_partiel')).toBe(false)
    expect(sansTermePermis('remplacement_depart')).toBe(false)
    expect(sansTermePermis('remplacement_suspension')).toBe(true)
    // Mêmes codes que la contrainte de la base
    for (const k of Object.keys(MOTIFS_CDD)) expect(migration).toContain(`'${k}'`)
  })
  it('type de modèle : CDI et CDD seulement', () => {
    expect(modelePour('cdi')).toBe('cdi')
    expect(modelePour('apprentissage')).toBeNull()
  })
  it('conditions du CDD', () => {
    const c = conditions({ contract_type: 'cdd', cdd_reason: 'remplacement_absence', cdd_min_end_on: '2027-01-01', cdd_renewable: true, risky_post: true, trial_end_on: '2026-12-10' }, { prevoyance_org: 'P' })
    expect([...c].sort()).toEqual(['essai', 'heures', 'poste_risque', 'prevoyance', 'remplacement', 'renouvelable', 'sans_terme'])
    expect(conditions({ contract_type: 'cdi', days_per_year: 218 }).has('forfait_jours')).toBe(true)
    expect(conditions({ contract_type: 'cdd', end_on: '2027-01-01' }).has('terme_precis')).toBe(true)
    expect(conditions({ contract_type: 'cdd' }).has('terme_precis')).toBe(true)
    expect(conditions({ contract_type: 'cdi', risky_post: true }).has('poste_risque')).toBe(false)
  })
  it('rémunération en vigueur au début, texte sans espace insécable', () => {
    const l = [{ amount: 1, effective_on: '2026-01-01' }, { amount: 2, effective_on: '2026-12-01' }, { amount: 3, effective_on: '2027-02-01' }]
    expect(remunerationAuDebut(l, '2026-12-15').amount).toBe(2)
    expect(remunerationAuDebut(l, '2025-01-01')).toBeNull()
    expect(remunerationAuDebut([], '2026-01-01')).toBeNull()
    expect(texteRemuneration(remu)).toBe('2 100,00 euros par mois')
  })
  it('durée du travail : forfait jours ou heures', () => {
    expect(texteDureeTravail({ days_per_year: 218 })).toMatch(/218 jours/)
    expect(texteDureeTravail({ weekly_hours: 35.5 })).toMatch(/35,5 heures/)
    expect(texteDureeTravail({})).toBe('')
  })
  it('CDI complet : aucune mention manquante, texte rempli', () => {
    const v = valeurs({ societe, personne, contrat: cdi, reglages, remuneration: { ...remu, components: 'néant' } })
    const art = articlesRetenus(modeles.cdi, conditions(cdi, reglages))
    expect(manquants(art, v)).toEqual([])
    expect(art.some((a) => a.si === 'prevoyance')).toBe(false)
    const texte = art.map((a) => remplir(a.texte, v)).join(' ')
    expect(texte).toContain('GLD Sécurité')
    expect(texte).toContain('IDCC 3248')
    expect(texte).toContain('2 100,00 euros par mois')
    expect(texte).not.toMatch(/\{\{/)
  })
  it('mentions manquantes bloquantes : convention, rémunération, adresse', () => {
    const v = valeurs({ societe: { ...societe, idcc: '' }, personne: { ...personne, personal_address: '' , personal_city: '', personal_postal_code: '' }, contrat: cdi, reglages: {}, remuneration: null })
    const m = manquants(articlesRetenus(modeles.cdi, conditions(cdi, {})), v)
    expect(m).toContain(CHAMPS.convention_idcc)
    expect(m).toContain(CHAMPS.convention_nom)
    expect(m).toContain(CHAMPS.remuneration)
    expect(m).toContain(CHAMPS.salarie_adresse)
    expect(m).toContain(CHAMPS.caisse_retraite)
    expect(m).toContain(CHAMPS.remuneration_composantes)
  })
  it('CDD de remplacement sans le nom du remplacé : bloqué', () => {
    const cdd = { ...cdi, contract_type: 'cdd', cdd_reason: 'remplacement_absence', end_on: '2027-03-01' }
    const v = valeurs({ societe, personne, contrat: cdd, reglages, remuneration: { ...remu, components: 'néant' } })
    const m = manquants(articlesRetenus(modeles.cdd, conditions(cdd, reglages)), v)
    expect(m).toEqual([CHAMPS.remplace_nom, CHAMPS.remplace_qualification])
    expect(v.motif_cdd).toBe('remplacement d\'un salarié absent')
  })
  it('CDD sans motif ni fin : bloqué', () => {
    const cdd = { ...cdi, contract_type: 'cdd' }
    const m = manquants(articlesRetenus(modeles.cdd, conditions(cdd, reglages)), valeurs({ societe, personne, contrat: cdd, reglages, remuneration: { ...remu, components: 'néant' } }))
    expect(m).toContain(CHAMPS.motif_cdd)
    expect(m).toContain(CHAMPS.date_fin)
  })
  it('forfait jours : pas de phrase sur les heures supplémentaires', () => {
    const c = { ...cdi, weekly_hours: null, days_per_year: 218 }
    const art = articlesRetenus(modeles.cdi, conditions(c, reglages))
    const texte = art.map((a) => remplir(a.texte, valeurs({ societe, personne, contrat: c, reglages, remuneration: { ...remu, components: 'néant' } }))).join(' ')
    expect(texte).toContain('218 jours')
    expect(texte).not.toContain('L3121-28')
  })
  it('champ inconnu ou mal écrit : bloqué, jamais imprimé tel quel', () => {
    expect(manquants([{ texte: 'Bonjour {{Salarie_nom}}' }], { salarie_nom: 'X' })[0]).toMatch(/Champ inconnu/)
    expect(manquants([{ titre: 'T', texte: 'Bonjour {{salarie_nom' }], { salarie_nom: 'X' })[0]).toMatch(/non fermées/)
  })
  it('modèle d\'avenant : le tableau des modifications est repéré par une clé', () => {
    expect(modeles.avenant.articles.filter((a) => a.tableau)).toHaveLength(1)
  })
  it('avenant : date, objet, une ligne complète', () => {
    const ok = { effective_on: '2026-12-01', subject: 'Horaire', changes: [{ label: 'Durée', before: '35 h', after: '39 h' }] }
    expect(erreurAvenant(ok)).toBeNull()
    expect(erreurAvenant({ ...ok, changes: [] })).toMatch(/au moins une/)
    expect(erreurAvenant({ ...ok, changes: [{ label: 'Durée', after: '' }] })).toMatch(/nouvelle valeur/)
    expect(erreurAvenant({ ...ok, subject: ' ' })).toMatch(/Objet/)
  })
  it('modèle courant : le validé le plus récent, sinon le plus récent', () => {
    const l = [{ kind: 'cdi', version: 1, status: 'valide' }, { kind: 'cdi', version: 2, status: 'projet' }]
    expect(modeleCourant(l, 'cdi').version).toBe(1)
    expect(modeleCourant([{ kind: 'cdi', version: 2, status: 'projet' }], 'cdi').version).toBe(2)
    expect(modeleCourant(l, 'cdd')).toBeNull()
    expect(origine({ kind: 'cdi', version: 2, status: 'projet' })).toMatch(/^(cdi|cdd|avenant)@[0-9]+:(projet|valide)$/)
  })
})

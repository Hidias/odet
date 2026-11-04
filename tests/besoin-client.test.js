import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MOTIFS, PROFILS, NIVEAUX, reponsesVides, depuisReponses, verifierReponses, besoinsARemplir, etatBesoinOrganisme,
  lignesBesoin, demandeAvecBesoin,
} from '../src/modules/formation/lib/besoinClient.js'

const bon = () => ({ ...reponsesVides(), context_reasons: ['reglementation'], participants_count: '8', objectives_description: 'Réagir à un départ de feu', psh_adaptation: false })

describe('analyse du besoin remplie par l\'entreprise (0486)', () => {
  it('réponses complètes acceptées', () => {
    expect(verifierReponses(bon())).toBeNull()
  })

  it('dit ce qui manque, comme la base', () => {
    expect(verifierReponses({ ...bon(), context_reasons: [] })).toBe('Indiquez au moins un motif de la formation')
    expect(verifierReponses({ ...bon(), participants_count: '' })).toBe('Indiquez le nombre de participants')
    expect(verifierReponses({ ...bon(), participants_count: '0' })).toBe('Indiquez le nombre de participants')
    expect(verifierReponses({ ...bon(), participants_count: '1000' })).toBe('Indiquez le nombre de participants')
    expect(verifierReponses({ ...bon(), objectives_description: '   ' })).toBe('Décrivez ce que vous attendez de la formation')
    expect(verifierReponses({ ...bon(), psh_adaptation: null })).toBe('Répondez à la question sur le besoin d\'adaptation')
    expect(verifierReponses({ ...bon(), psh_adaptation: true, psh_contact: ' ' })).toBe('Indiquez la personne à contacter pour l\'adaptation')
    expect(verifierReponses({ ...bon(), psh_adaptation: true, psh_contact: 'Mme Martin' })).toBeNull()
    expect(verifierReponses({ ...bon(), psh_contact: 'x'.repeat(201), psh_adaptation: true })).toBe('Texte trop long (200 caractères au plus)')
  })

  it('reprend des réponses déjà envoyées sans laisser de null dans les champs', () => {
    const r = depuisReponses({ participants_count: 9, context_other: null, psh_adaptation: true, psh_contact: 'Mme Martin' })
    expect(r.participants_count).toBe('9')
    expect(r.context_other).toBe('')
    expect(r.psh_adaptation).toBe(true)
    expect(depuisReponses(null)).toEqual(reponsesVides())
  })

  it('compte à l\'accueil seulement les analyses encore à remplir', () => {
    expect(besoinsARemplir([
      { etat: 'a_completer', modifiable: true }, { etat: 'a_valider', modifiable: true },
      { etat: 'a_completer', modifiable: false }, { etat: 'validee', modifiable: false },
    ])).toBe(1)
    expect(besoinsARemplir(null)).toBe(0)
  })

  it('état côté organisme', () => {
    expect(etatBesoinOrganisme(null)).toBe('absente')
    expect(etatBesoinOrganisme({ client_submitted_at: 'x' })).toBe('a_valider')
    expect(etatBesoinOrganisme({ client_submitted_at: 'x', org_validated_at: 'y' })).toBe('validee')
    expect(etatBesoinOrganisme({ filled_at: 'x' })).toBe('remplie')
  })

  it.each(['0486_besoin_espace_client', '0487_besoin_demande_intra'])('listes identiques à celles de la base (%s)', (m) => {
    const sql = readFileSync(resolve(__dirname, `../supabase/migrations/${m}.sql`), 'utf8')
    const liste = (debut) => {
      const m = sql.match(new RegExp(`${debut}[^\\n]*?array\\[([^\\]]+)\\]`))
      return m[1].split(',').map((x) => x.trim().replace(/'/g, ''))
    }
    expect(liste('if not v_raisons <@')).toEqual(MOTIFS.map((x) => x.value))
    expect(liste('if not v_profils <@')).toEqual(PROFILS.map((x) => x.value))
    const niveaux = sql.match(/v_niveau not in \(([^)]+)\)/)[1].split(',').map((x) => x.trim().replace(/'/g, ''))
    expect(niveaux).toEqual(NIVEAUX.map((x) => x.value))
  })

  it('aucun détail de santé demandé à l\'entreprise, ni renvoyé par l\'espace', () => {
    const ecran = readFileSync(resolve(__dirname, '../src/modules/portail/components/AnalyseBesoin.jsx'), 'utf8')
    expect(ecran).not.toMatch(/particularities_psh/)
    const sql = readFileSync(resolve(__dirname, '../supabase/migrations/0486_besoin_espace_client.sql'), 'utf8')
    const lecture = sql.slice(sql.indexOf('function public.ent_besoins()'), sql.indexOf('function public.ent_besoin_enregistrer'))
    expect(lecture).not.toMatch(/particularities_psh|org_conclusion/)
  })

  it('résumé lisible des réponses, sans ligne vide', () => {
    const l = lignesBesoin({ context_reasons: ['autre', 'reglementation'], context_other: 'Audit', objectives_description: 'Évacuer', participants_count: 6,
      participants_profiles: ['terrain'], psh_adaptation: true, psh_contact: 'M. Durand', company_equipment: false })
    expect(Object.fromEntries(l)).toMatchObject({
      Motifs: 'Autre : Audit, Réglementation, obligation légale', Participants: '6 · Terrain', 'Besoin d\'adaptation': 'Oui, contact : M. Durand',
      'Matériel de l\'entreprise': 'Non', 'Équipements de protection fournis': 'Non précisé',
    })
    expect(l.find(([k]) => k === 'Enjeux')).toBeUndefined()
    expect(lignesBesoin(null)).toEqual([])
  })

  it('demande intra avec besoin pas encore reliée', () => {
    expect(demandeAvecBesoin({ kind: 'demande_intra', payload: { besoin: { participants_count: 3 } } })).toBe(true)
    expect(demandeAvecBesoin({ kind: 'demande_intra', session_id: 'x', payload: { besoin: {} } })).toBe(false)
    expect(demandeAvecBesoin({ kind: 'message', payload: { besoin: {} } })).toBe(false)
    expect(demandeAvecBesoin({ kind: 'demande_intra', payload: {} })).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TYPES_ENVOI, MODES_ENVOI, libelleMode, propositions, TACHES } from '../src/core/console/TachesEtEnvois.jsx'
import { issueEnvoi } from '../api/_lib/envoisAuto.js'

const migration = readFileSync(new URL('../supabase/migrations/0519_envois_reglages.sql', import.meta.url), 'utf8')

describe('Réglage des envois (0519)', () => {
  it('reprend exactement les types de la base, dans le même ordre', () => {
    const bloc = migration.match(/function app\.envoi_types\(\)[\s\S]*?select array\[([\s\S]*?)\]/)[1]
    const types = [...bloc.matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
    expect(TYPES_ENVOI.map((t) => t.kind)).toEqual(types)
  })
  it('a retiré les interrupteurs qui ne commandaient rien', () => {
    const kinds = TYPES_ENVOI.map((t) => t.kind)
    for (const k of ['relance_devis', 'convocation', 'attestation', 'relance_facture']) expect(kinds).not.toContain(k)
  })
  it('nomme les trois modes', () => {
    expect(Object.keys(MODES_ENVOI)).toEqual(['ferme', 'a_valider', 'auto'])
    expect(libelleMode('rappel', 'a_valider')).toBe('À valider')
    expect(libelleMode('demande_nir', 'a_valider')).toBe('Depuis la session')
    expect(libelleMode('rappel', 'auto')).toBe('Automatique')
  })
  it('ne propose que les types signalés par la base', () => {
    const p = propositions([{ kind: 'rappel', proposition: true }, { kind: 'autre', proposition: false }, { kind: 'inconnu', proposition: true }])
    expect(p.map((x) => x.kind)).toEqual(['rappel'])
    expect(p[0].type.label).toBe('Rappels')
    expect(propositions(null)).toEqual([])
  })
  it('annonce les envois automatiques dans la tâche du matin', () => {
    expect(TACHES.find((t) => t.job === 'relances-circuit').label).toMatch(/envois automatiques/)
  })
})

describe('Issue d\'un envoi automatique', () => {
  it('envoyé, refusé par le serveur, échec avant envoi, incertain', () => {
    expect(issueEnvoi({ info: { messageId: 'x', rejected: [] }, destinataire: 'a@b.fr' })).toBe('envoyee')
    expect(issueEnvoi({ info: { rejected: ['A@b.fr'] }, destinataire: 'a@b.fr' })).toBe('erreur')
    expect(issueEnvoi({ err: { code: 'EAUTH' }, destinataire: 'a@b.fr' })).toBe('erreur')
    expect(issueEnvoi({ err: { code: 'ECONNECTION', message: 'Connection closed' }, destinataire: 'a@b.fr' })).toBe('incertain')
  })
})

describe('Envoi automatique : rien ne part sans les conditions', async () => {
  const { vi } = await import('vitest')
  it('mode démonstration, préversion ou boîte par défaut absente : aucune réservation, aucun envoi', async () => {
    vi.resetModules()
    const reglage = { org: { demo_mode: true, email_default_sender: 'contact@exemple.invalid' } }
    const mailer = vi.fn(async () => ({ cfg: { email: 'autre@exemple.invalid' }, transporter: { sendMail: vi.fn(), close: vi.fn() }, from: 'x' }))
    vi.doMock('../api/_lib/mailer.js', async (orig) => ({ ...(await orig()), getOrgForCompany: async () => reglage.org, getSender: async () => ({ name: 'Org' }) }))
    vi.doMock('../api/_lib/internal.js', () => ({ internalMailer: mailer }))
    const { envoyerRelancesAuto } = await import('../api/_lib/envoisAuto.js')
    const appels = []
    const admin = { rpc: async (nom) => { appels.push(nom); return nom === 'relances_auto_a_envoyer' ? { data: ['id-1'] } : { data: null } } }
    let r = await envoyerRelancesAuto(admin)
    expect(r.envoyees).toBe(0)
    expect(r.raison).toMatch(/démonstration/)
    expect(mailer).not.toHaveBeenCalled()
    reglage.org = { demo_mode: false, email_default_sender: '' }
    r = await envoyerRelancesAuto(admin)
    expect(r.raison).toMatch(/par défaut/)
    reglage.org = { demo_mode: false, email_default_sender: 'contact@exemple.invalid' }
    r = await envoyerRelancesAuto(admin)
    expect(r.raison).toMatch(/désactivée/)
    expect(appels.filter((n) => n !== 'relances_auto_a_envoyer')).toEqual([])
    vi.doUnmock('../api/_lib/mailer.js'); vi.doUnmock('../api/_lib/internal.js')
  })
})

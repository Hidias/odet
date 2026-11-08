import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Vue groupe en lecture seule (0516) : les écrans des actions et des types refusent avant d'envoyer, avec la phrase
// de la base ; un refus de la base garde cette phrase ; les routes serveur à clé de service refusent aussi.
const appels = []
let reponse = { data: { id: 'n' }, error: null }
const chaine = (op) => {
  const c = { select: () => c, eq: () => c, single: async () => reponse, then: (ok) => ok(reponse) }
  appels.push(op)
  return c
}
vi.mock('../src/core/supabase.js', () => ({
  supabase: { from: () => ({ insert: () => chaine('insert'), update: () => chaine('update'), delete: () => chaine('delete') }) },
}))
const { creerAction, modifierAction, supprimerAction } = await import('../src/core/point/actions.js')
const { enregistrerType, supprimerType, messageType } = await import('../src/core/point/typesActions.js')
const { setCurrentCompanyId } = await import('../src/core/company/companyContext.js')
const { MESSAGE_VUE_GROUPE, societeEnCours } = await import('../src/core/company/societes.js')
const { refusVueGroupe, MESSAGE_VUE_GROUPE: MESSAGE_SERVEUR } = await import('../api/_lib/auth.js')

describe('Vue groupe : écritures refusées à l\'écran', () => {
  beforeEach(() => { appels.length = 0; reponse = { data: { id: 'n' }, error: null }; setCurrentCompanyId('groupe') })

  it('actions : création, modification et suppression refusées sans rien envoyer', async () => {
    await expect(creerAction({ title: 'Rappeler' })).rejects.toThrow(MESSAGE_VUE_GROUPE)
    await expect(modifierAction('a', { status: 'fait' })).rejects.toThrow(MESSAGE_VUE_GROUPE)
    await expect(supprimerAction('a')).rejects.toThrow(MESSAGE_VUE_GROUPE)
    expect(appels).toHaveLength(0)
  })
  it('types : ajout, modification et suppression refusés sans rien envoyer', async () => {
    await expect(enregistrerType({ name: 'Visite' })).rejects.toThrow(MESSAGE_VUE_GROUPE)
    await expect(enregistrerType({ id: 't', name: 'Visite' })).rejects.toThrow(MESSAGE_VUE_GROUPE)
    await expect(supprimerType('t')).rejects.toThrow(MESSAGE_VUE_GROUPE)
    expect(appels).toHaveLength(0)
  })
  it('refus de la base : la phrase de la vue groupe, pas « réservée à la direction »', async () => {
    const err = { code: '42501', message: 'Vue groupe : lecture seule. Pour créer ou modifier, choisissez une société dans l\'en-tête.' }
    expect(messageType(err)).toBe(MESSAGE_VUE_GROUPE)
    expect(messageType({ code: '42501', message: 'permission denied' })).toMatch(/réservée à la direction/)
    setCurrentCompanyId('s1')
    reponse = { data: null, error: err }
    await expect(modifierAction('a', { status: 'fait' })).rejects.toThrow(MESSAGE_VUE_GROUPE)
    await expect(enregistrerType({ id: 't', name: 'Visite' })).rejects.toThrow(MESSAGE_VUE_GROUPE)
    setCurrentCompanyId(null)
  })
  it('société en cours : jamais « groupe » envoyé comme identifiant de société', () => {
    expect(societeEnCours()).toBeNull()
    setCurrentCompanyId('s1')
    expect(societeEnCours()).toBe('s1')
    setCurrentCompanyId(null)
    for (const f of ['src/core/point/PointSemaine.jsx', 'src/core/reunions/Reunions.jsx', 'src/core/settings/Settings.jsx', 'src/core/push/AlertesTelephone.jsx']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/getCurrentCompanyId\(\)/)
    }
  })
})

describe('Vue groupe : routes serveur', () => {
  const res = () => { const r = { code: 0, corps: null }; r.status = (c) => { r.code = c; return r }; r.json = (b) => { r.corps = b; return r }; return r }
  it('refus en 403 avec la phrase de la base, rien sinon', () => {
    const r = res()
    expect(refusVueGroupe({ headers: { 'x-company-id': 'groupe' } }, r)).toBe(true)
    expect(r.code).toBe(403)
    expect(r.corps.error).toBe(MESSAGE_SERVEUR)
    expect(MESSAGE_SERVEUR).toBe(MESSAGE_VUE_GROUPE)
    const r2 = res()
    expect(refusVueGroupe({ headers: { 'x-company-id': '0b8f6d1e-0000-4000-8000-000000000000' } }, r2)).toBe(false)
    expect(r2.code).toBe(0)
  })
  it('les routes qui écrivent avec la clé serveur (ou préparent un enregistrement) appellent le refus', () => {
    for (const f of ['api/documents-client.js', 'api/reunion-point.js', 'api/convention-en-ligne.js', 'api/auth/google.js', 'api/auth/meta.js', 'api/auth/linkedin.js']) {
      expect(readFileSync(f, 'utf8')).toMatch(/refusVueGroupe\(req, res\)/)
    }
  })
})

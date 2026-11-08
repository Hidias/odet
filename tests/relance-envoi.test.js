import { beforeEach, describe, expect, it, vi } from 'vitest'

// Envoi d'une relance depuis l'outil (0518) : texte du mail et route, sans base ni messagerie
const etat = vi.hoisted(() => ({ rpc: [], envois: [], mailerErreur: null, envoiEchoue: false, ligne: null, reserve: null, reserveErreur: null, finErreurs: 0, demo: false, reel: false, orgErreur: false, testEnv: false, testEnv: false }))

vi.mock('../api/_lib/auth.js', () => ({
  OFFICE_WRITE: ['admin'],
  requireRight: vi.fn(async () => ({ user: { id: 'u1' } })),
  refusVueGroupe: vi.fn(() => false),
  clientDeLAppelant: vi.fn(() => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: etat.ligne, error: null }) }) }) }),
    rpc: vi.fn(async (nom, args) => {
      etat.rpc.push([nom, args])
      if (nom === 'relance_envoi_reserver') return etat.reserveErreur ? { data: null, error: etat.reserveErreur } : { data: etat.reserve, error: null }
      return { data: null, error: null }
    }),
  })),
}))
vi.mock('../api/_lib/errors.js', () => ({ withErrorLog: (h) => h }))
vi.mock('../api/_lib/mailer.js', async (orig) => {
  const vrai = await orig()
  return {
    finirParCordialement: vrai.finirParCordialement,
    buildSignatureHTML: () => '<div>SIGNATURE</div>',
    isTestEnvironment: () => etat.testEnv,
    getSupabaseAdmin: () => ({
      rpc: async (nom, args) => {
        etat.rpc.push([nom, args])
        if (etat.finErreurs > 0) { etat.finErreurs -= 1; return { error: { message: 'base injoignable' } } }
        return { error: null }
      },
    }),
    getOrgForCompany: async (_c, societe) => {
      if (societe && etat.orgErreur) throw new Error('réglages illisibles')
      return { name: 'Organisme', email_bcc: 'copie@exemple.invalid', demo_mode: etat.demo }
    },
    getSender: async () => ({ name: 'Anne Envoi' }),
    getMailer: async () => (etat.mailerErreur ? { error: etat.mailerErreur } : { transporter: { close() {} }, emailConfig: { email: 'moi@exemple.invalid' }, error: null, envoiReel: etat.reel }),
    sendWithRetry: async (_t, opts) => {
      if (etat.envoiEchoue) throw Object.assign(new Error('Boîte injoignable'), etat.envoiEchoue === 'EAUTH' ? { code: 'EAUTH' } : {})
      etat.envois.push(opts)
      return { messageId: '<m1@exemple.invalid>' }
    },
  }
})

const { default: handler, mailDeRelance, echecAvantEnvoi } = await import('../api/relance-envoi.js')

const ID = '11111111-2222-4333-8444-555555555555'
function appel(body) {
  const res = { code: 0, json: null, status(c) { this.code = c; return this }, json(j) { this.json = j; return this } }
  return handler({ method: 'POST', body, headers: {} }, res).then(() => res)
}

beforeEach(() => {
  Object.assign(etat, { rpc: [], envois: [], mailerErreur: null, envoiEchoue: false, reserveErreur: null, finErreurs: 0, demo: false, reel: false, orgErreur: false, testEnv: false,
    ligne: { id: ID, company_id: 'c1', title: 'Titre', status: 'valide', validated_at: '2026-11-08T14:00:00.123456+00:00', payload: { destinataire: 'client@exemple.invalid', objet: 'Objet', texte: 'Bonjour,\n\nR&D < 10' } },
    reserve: { id: ID, company_id: 'c1', kind: 'autre', destinataire: 'client@exemple.invalid', objet: 'Objet', texte: 'Bonjour' } })
})

describe('relance envoyée depuis l\'outil (0518)', () => {
  it('mail : texte échappé, titre si objet vide, politesse ajoutée une seule fois', () => {
    const m = mailDeRelance({ objet: '  ', texte: 'Bonjour,\n\nR&D < 10', titre: 'Recyclage SST' }, { name: 'A' }, {})
    expect(m.sujet).toBe('Recyclage SST')
    expect(m.html).toContain('R&amp;D &lt; 10')
    expect(m.html).toContain('Bien cordialement')
    expect(m.texte.endsWith('Bien cordialement,')).toBe(true)
    const m2 = mailDeRelance({ objet: 'O', texte: 'Bonjour\n\nCordialement,' }, null, {})
    expect(m2.html).not.toContain('Bien cordialement')
    expect(m2.texte).toBe('Bonjour\n\nCordialement,')
  })

  it('aperçu : rien n\'est réservé ni envoyé', async () => {
    const r = await appel({ id: ID, action: 'apercu' })
    expect(r.code).toBe(200)
    expect(r.json).toMatchObject({ destinataire: 'client@exemple.invalid', expediteur: 'moi@exemple.invalid', copieCachee: 'copie@exemple.invalid', sujet: 'Objet', piecesJointes: [] })
    expect(r.json.html).toContain('SIGNATURE')
    expect(etat.rpc).toEqual([])
    expect(etat.envois).toEqual([])
  })

  it('test : à la seule adresse de la personne connectée, sans copie cachée ni réservation', async () => {
    const r = await appel({ id: ID, action: 'test' })
    expect(r.code).toBe(200)
    expect(etat.envois).toHaveLength(1)
    expect(etat.envois[0].to).toBe('moi@exemple.invalid')
    expect(etat.envois[0].bcc).toBeUndefined()
    expect(etat.envois[0].subject).toBe('[Test] Objet')
    expect(etat.rpc).toEqual([])
  })

  it('envoi : réservé par la base, parti au destinataire avec copie cachée, puis noté envoyé', async () => {
    const r = await appel({ id: ID, action: 'envoi', destinataire: 'client@exemple.invalid', valideLe: '2026-11-08T14:00:00.123456+00:00' })
    expect(r.code).toBe(200)
    expect(etat.rpc.map((x) => x[0])).toEqual(['relance_envoi_reserver', 'relance_envoi_terminer'])
    expect(etat.envois[0]).toMatchObject({ to: 'client@exemple.invalid', bcc: 'copie@exemple.invalid', subject: 'Objet' })
    expect(etat.rpc[0][1]).toEqual({ p_id: ID, p_destinataire: 'client@exemple.invalid', p_valide_le: '2026-11-08T14:00:00.123456+00:00' })
    expect(etat.rpc[1][1]).toMatchObject({ p_id: ID, p_auteur: 'u1', p_ok: true, p_message_id: '<m1@exemple.invalid>', p_boite: 'moi@exemple.invalid' })
  })

  it('envoi : boîte non configurée = rien n\'est réservé', async () => {
    etat.mailerErreur = 'Votre boîte d\'envoi n\'est pas configurée'
    const r = await appel({ id: ID, action: 'envoi', destinataire: 'client@exemple.invalid', valideLe: '2026-11-08T14:00:00.123456+00:00' })
    expect(r.code).toBe(400)
    expect(etat.rpc).toEqual([])
    expect(etat.envois).toEqual([])
  })

  it('envoi : refus de la base = rien ne part', async () => {
    etat.reserveErreur = { code: '22023', message: 'Envoi déjà en cours pour cette relance' }
    const r = await appel({ id: ID, action: 'envoi', destinataire: 'client@exemple.invalid', valideLe: '2026-11-08T14:00:00.123456+00:00' })
    expect(r.code).toBe(409)
    expect(r.json.error).toContain('déjà en cours')
    expect(etat.envois).toEqual([])
  })

  it('envoi refusé par la messagerie avant le contenu : l\'erreur est notée sur la relance', async () => {
    etat.envoiEchoue = 'EAUTH'
    const r = await appel({ id: ID, action: 'envoi', destinataire: 'client@exemple.invalid', valideLe: '2026-11-08T14:00:00.123456+00:00' })
    expect(r.code).toBe(502)
    expect(etat.rpc[1]).toEqual(['relance_envoi_terminer', { p_id: ID, p_auteur: 'u1', p_ok: false, p_erreur: 'Boîte injoignable' }])
  })

  it('envoi sans aperçu (destinataire vu absent) : refusé avant tout', async () => {
    const r = await appel({ id: ID, action: 'envoi' })
    expect(r.code).toBe(400)
    expect(etat.rpc).toEqual([])
  })

  it('mode démonstration : refusé sauf envoi réel du super administrateur, et signalé à l\'aperçu', async () => {
    etat.demo = true
    const r = await appel({ id: ID, action: 'envoi', destinataire: 'client@exemple.invalid', valideLe: '2026-11-08T14:00:00.123456+00:00' })
    expect(r.code).toBe(409)
    expect(etat.rpc).toEqual([])
    expect(etat.envois).toEqual([])
    expect((await appel({ id: ID, action: 'apercu' })).json.avertissement).toContain('Mode démonstration')
    etat.reel = true
    expect((await appel({ id: ID, action: 'envoi', destinataire: 'client@exemple.invalid', valideLe: '2026-11-08T14:00:00.123456+00:00' })).code).toBe(200)
    expect(etat.envois).toHaveLength(1)
  })

  it('trace refusée après le mail : un second essai, puis avertissement sans renvoi', async () => {
    etat.finErreurs = 2
    const r = await appel({ id: ID, action: 'envoi', destinataire: 'client@exemple.invalid', valideLe: '2026-11-08T14:00:00.123456+00:00' })
    expect(r.code).toBe(200)
    expect(r.json.avertissement).toContain('Ne la renvoyez pas')
    expect(etat.rpc.filter((x) => x[0] === 'relance_envoi_terminer')).toHaveLength(2)
    expect(etat.envois).toHaveLength(1)
  })

  it('erreur après la réservation, avant le mail : réservation levée, rien ne part', async () => {
    etat.orgErreur = true
    await expect(appel({ id: ID, action: 'envoi', destinataire: 'client@exemple.invalid', valideLe: '2026-11-08T14:00:00.123456+00:00' })).rejects.toThrow('réglages illisibles')
    expect(etat.rpc[1]).toEqual(['relance_envoi_terminer', { p_id: ID, p_auteur: 'u1', p_ok: false, p_erreur: 'Mail non préparé, rien n\'est parti' }])
    expect(etat.envois).toEqual([])
  })

  it('formule de clôture déjà écrite plus haut (avis du financeur, mise en demeure) : pas de seconde formule', () => {
    for (const t of ['Bonjour,\n\nMerci.\n\nCordialement,\nOrganisme', 'Madame, Monsieur,\n\nVeuillez agréer, Madame, Monsieur, nos salutations distinguées.']) {
      const m = mailDeRelance({ objet: 'O', texte: t }, null, {})
      expect(m.html).not.toContain('Bien cordialement')
      expect(m.texte).toBe(t)
    }
  })

  it('échec de messagerie : avant le contenu (réessai possible) ou incertain', () => {
    expect(echecAvantEnvoi({ code: 'EAUTH' })).toBe(true)
    expect(echecAvantEnvoi({ command: 'RCPT TO' })).toBe(true)
    expect(echecAvantEnvoi({ command: 'DATA' })).toBe(false)
    expect(echecAvantEnvoi(new Error('socket hang up'))).toBe(false)
  })

  it('résultat incertain : la relance n\'est pas remise à envoyer', async () => {
    etat.envoiEchoue = true
    const r = await appel({ id: ID, action: 'envoi', destinataire: 'client@exemple.invalid', valideLe: '2026-11-08T14:00:00.123456+00:00' })
    expect(r.code).toBe(502)
    expect(r.json.error).toContain('Résultat incertain')
    expect(etat.rpc.map((x) => x[0])).toEqual(['relance_envoi_reserver'])
  })

  it('préversion ou test : refusé même pour l\'envoi réel ; « Test à moi » le dit', async () => {
    etat.testEnv = true
    etat.reel = true
    expect((await appel({ id: ID, action: 'envoi', destinataire: 'client@exemple.invalid', valideLe: '2026-11-08T14:00:00.123456+00:00' })).code).toBe(409)
    expect(etat.envois).toEqual([])
    expect((await appel({ id: ID, action: 'test' })).json.test).toContain('adresse de test')
    expect((await appel({ id: ID, action: 'apercu' })).json.redirige).toBe(true)
  })

  it('demande mal formée refusée', async () => {
    expect((await appel({ id: 'x', action: 'envoi', destinataire: 'client@exemple.invalid', valideLe: '2026-11-08T14:00:00.123456+00:00' })).code).toBe(400)
    expect((await appel({ id: ID, action: 'autre' })).code).toBe(400)
  })
})

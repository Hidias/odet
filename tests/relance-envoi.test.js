import { beforeEach, describe, expect, it, vi } from 'vitest'

// Envoi d'une relance depuis l'outil (0518) : texte du mail et route, sans base ni messagerie
const etat = vi.hoisted(() => ({ rpc: [], envois: [], mailerErreur: null, envoiEchoue: false, ligne: null, reserve: null, reserveErreur: null }))

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
    getSupabaseAdmin: () => ({}),
    getOrgForCompany: async () => ({ name: 'Organisme', email_bcc: 'copie@exemple.invalid' }),
    getSender: async () => ({ name: 'Anne Envoi' }),
    getMailer: async () => (etat.mailerErreur ? { error: etat.mailerErreur } : { transporter: { close() {} }, emailConfig: { email: 'moi@exemple.invalid' }, error: null }),
    sendWithRetry: async (_t, opts) => {
      if (etat.envoiEchoue) throw new Error('Boîte injoignable')
      etat.envois.push(opts)
      return { messageId: '<m1@exemple.invalid>' }
    },
  }
})

const { default: handler, mailDeRelance } = await import('../api/relance-envoi.js')

const ID = '11111111-2222-4333-8444-555555555555'
function appel(body) {
  const res = { code: 0, json: null, status(c) { this.code = c; return this }, json(j) { this.json = j; return this } }
  return handler({ method: 'POST', body, headers: {} }, res).then(() => res)
}

beforeEach(() => {
  Object.assign(etat, { rpc: [], envois: [], mailerErreur: null, envoiEchoue: false, reserveErreur: null,
    ligne: { id: ID, company_id: 'c1', title: 'Titre', status: 'valide', payload: { destinataire: 'client@exemple.invalid', objet: 'Objet', texte: 'Bonjour,\n\nR&D < 10' } },
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
    const r = await appel({ id: ID, action: 'envoi' })
    expect(r.code).toBe(200)
    expect(etat.rpc.map((x) => x[0])).toEqual(['relance_envoi_reserver', 'relance_envoi_terminer'])
    expect(etat.envois[0]).toMatchObject({ to: 'client@exemple.invalid', bcc: 'copie@exemple.invalid', subject: 'Objet' })
    expect(etat.rpc[1][1]).toMatchObject({ p_id: ID, p_ok: true, p_message_id: '<m1@exemple.invalid>', p_boite: 'moi@exemple.invalid' })
  })

  it('envoi : boîte non configurée = rien n\'est réservé', async () => {
    etat.mailerErreur = 'Votre boîte d\'envoi n\'est pas configurée'
    const r = await appel({ id: ID, action: 'envoi' })
    expect(r.code).toBe(400)
    expect(etat.rpc).toEqual([])
    expect(etat.envois).toEqual([])
  })

  it('envoi : refus de la base = rien ne part', async () => {
    etat.reserveErreur = { code: '22023', message: 'Envoi déjà en cours pour cette relance' }
    const r = await appel({ id: ID, action: 'envoi' })
    expect(r.code).toBe(409)
    expect(r.json.error).toContain('déjà en cours')
    expect(etat.envois).toEqual([])
  })

  it('envoi échoué : l\'erreur est notée sur la relance', async () => {
    etat.envoiEchoue = true
    const r = await appel({ id: ID, action: 'envoi' })
    expect(r.code).toBe(502)
    expect(etat.rpc[1]).toEqual(['relance_envoi_terminer', { p_id: ID, p_ok: false, p_erreur: 'Boîte injoignable' }])
  })

  it('demande mal formée refusée', async () => {
    expect((await appel({ id: 'x', action: 'envoi' })).code).toBe(400)
    expect((await appel({ id: ID, action: 'autre' })).code).toBe(400)
  })
})

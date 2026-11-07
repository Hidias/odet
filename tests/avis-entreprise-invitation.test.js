import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('../src/core/supabase', () => ({ supabase: {} }))

const { invitationAvisPossible, phraseAvisEnLigne } = await import('../src/modules/formation/lib/avisEntrepriseInvitation')
const { TEXTES_AVIS } = await import('../src/core/portail/lienEspace')

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

describe('Invitation de l’entreprise à donner son avis (07/11)', () => {
  const finie = { client_id: 'c1', status: 'confirmed', start_date: '2026-11-02', end_date: '2026-11-03' }

  it('seulement pour une formation réalisée, non annulée, d’un client, hors particulier', () => {
    expect(invitationAvisPossible(finie, null, '2026-11-03')).toBe(true)
    expect(invitationAvisPossible(finie, null, '2026-11-02')).toBe(false)
    expect(invitationAvisPossible({ ...finie, status: 'cancelled' }, null, '2026-11-10')).toBe(false)
    expect(invitationAvisPossible({ ...finie, client_id: null }, null, '2026-11-10')).toBe(false)
    expect(invitationAvisPossible(finie, { kind: 'particulier' }, '2026-11-10')).toBe(false)
    expect(invitationAvisPossible(finie, { kind: 'entreprise' }, '2026-11-10')).toBe(true)
    expect(invitationAvisPossible({ ...finie, end_date: null }, null, '2026-11-02')).toBe(true)
    // Client particulier sans groupe : questions d'entreprise, pas d'invitation
    expect(invitationAvisPossible({ ...finie, clients: { client_type: 'particulier' } }, null, '2026-11-10')).toBe(false)
    expect(invitationAvisPossible({ ...finie, clients: { client_type: 'entreprise' } }, null, '2026-11-10')).toBe(true)
  })

  it('phrase du mail : rien sans accès, code annoncé seulement s’il est dans l’encadré', () => {
    expect(phraseAvisEnLigne(null)).toBe('')
    expect(phraseAvisEnLigne({ url: 'x', code: '123456', codeApart: false })).toMatch(/^Vous pouvez aussi donner votre avis en ligne.*votre code d'accès figurent dans l'encadré « Répondre en ligne »/)
    expect(phraseAvisEnLigne({ url: 'x', code: '', codeApart: false })).not.toMatch(/code d'accès/)
    const apart = phraseAvisEnLigne({ url: 'x', code: '', codeApart: true })
    expect(apart).toMatch(/l'adresse et le QR code figurent/)
    expect(apart).not.toMatch(/code d'accès/)
  })

  it('encadré « Répondre en ligne » renvoie au bouton réel de l’espace client', () => {
    expect(TEXTES_AVIS.titre).toBe('RÉPONDRE EN LIGNE')
    const bouton = TEXTES_AVIS.texte.match(/« ([^»]+) »/)[1].trim()
    expect(lire('src/modules/portail/pages/ClientPortal.jsx')).toContain(`'${bouton}'`)
    expect(lire('src/modules/portail/pages/EspaceEntreprise.jsx')).toContain(`'${bouton}'`)
  })

  it('envoi « Après formation » : accès lu une fois, pour le questionnaire et pour le mail', () => {
    const modal = lire('src/modules/formation/components/SessionEmailModal.jsx')
    expect(modal).toMatch(/lienAvisEntreprise\(session, groupe\)/)
    expect(modal).toMatch(/generateSatisfactionEntreprisePDF\(session, session\?\.clients, null, \{ enLigne: await lienAvis\(\) \}\)/)
    expect(modal).toMatch(/phraseAvisEnLigne\(await lienAvis\(\)\)/)
    // Insérée avant la formule finale, comme le paragraphe du Passeport (qui peut arriver avant elle), jamais en double
    expect(modal).toMatch(/setEmailBody\(\(b\) => \(b\.includes\(avisEnLigne\) \? b : b\.replace\(`\\n\\n\$\{suite\}`/)
    expect(modal).toMatch(/const suite = 'Nous vous remercions pour votre confiance/)
  })

  it('bouton d’avis dès le dernier jour dans les deux espaces (même règle que la base, 0504)', () => {
    for (const f of ['src/modules/portail/pages/ClientPortal.jsx', 'src/modules/portail/pages/EspaceEntreprise.jsx']) {
      const src = lire(f)
      expect(src).toMatch(/\{avisDispo && avisPossible\(s, todayIso\(\)\) && \(/)
      expect(src).not.toMatch(/(finished|finie) && avisDispo/)
    }
  })
})

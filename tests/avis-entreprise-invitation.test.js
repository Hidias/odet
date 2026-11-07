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
  })

  it('phrase du mail : rien sans accès, code annoncé seulement s’il est dans l’encadré', () => {
    expect(phraseAvisEnLigne(null)).toBe('')
    expect(phraseAvisEnLigne({ url: 'x', code: '123456', codeApart: false })).toMatch(/votre code d'accès figurent dans l'encadré « Répondre en ligne »/)
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
  })
})

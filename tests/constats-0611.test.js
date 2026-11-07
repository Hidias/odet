import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { estASigner } from '../src/modules/portail/components/MesDocuments'
import { aLaPlaceDe, signeALaPlace } from '../src/core/portail/signataire'

// Constats de l'inter d'essai du 06/11
describe('Document à signer signalé en haut de l\'espace client', () => {
  const sigs = new Map([['d2', { signed_at: '2026-11-06' }]])
  const signatureDe = (d) => sigs.get(d.id) || null
  it('devis et contrats non signés ; signés, déposés ou non signables exclus', () => {
    expect(estASigner({ id: 'd1', kind: 'contrat' }, { signatureDe })).toBe(true)
    expect(estASigner({ id: 'd2', kind: 'contrat' }, { signatureDe })).toBe(false)
    expect(estASigner({ id: 'd3', kind: 'facture' }, { signatureDe })).toBe(false)
    expect(estASigner({ id: 'd4', kind: 'devis' }, { signatureDe, depotDe: () => ({ status: 'recu' }) })).toBe(false)
    expect(estASigner({ id: 'd5', kind: 'devis' }, { signatureDe, depotDe: () => ({ status: 'refuse' }) })).toBe(true)
    expect(estASigner({ id: 'd6', kind: 'rapport' }, { signatureDe })).toBe(false)
    expect(estASigner({ id: 'd6', kind: 'rapport' }, { signatureDe, aSignerEnPlus: new Set(['d6']) })).toBe(true)
  })
  it('le bandeau est affiché dans l\'espace par lien, au-dessus des formations', () => {
    const src = readFileSync('src/modules/portail/pages/ClientPortal.jsx', 'utf8')
    expect(src).toMatch(/<BandeauASigner/)
    expect(src.indexOf('<BandeauASigner')).toBeLessThan(src.indexOf('<MesDocuments'))
    expect(src).toMatch(/onListe=\{setDocsPublies\}/)
    // Un seul document : la signature s'ouvre directement (A11 lot 5, 07/11) ; plusieurs : la liste, qui ne cache
    // jamais un document à signer
    expect(src).toMatch(/d \? ouvrirSignatureDocument\(d\)/)
    const liste = readFileSync('src/modules/portail/components/MesDocuments.jsx', 'utf8')
    expect(liste).toMatch(/i < 12 \|\| \(onSigner && estASigner/)
  })
})

describe('Signé « à la place de » côté organisme', () => {
  const prevu = { name: 'Alice ESSAI', role: 'Gérante' }
  it('nom différent : mention ; même nom (casse, accents, espaces) : rien', () => {
    expect(aLaPlaceDe('Aline ESSAI', prevu)).toBe(' à la place de Alice ESSAI')
    expect(aLaPlaceDe('  alice   essai ', prevu)).toBe('')
    expect(aLaPlaceDe('Alice ESSAI', null)).toBe('')
    expect(signeALaPlace('Élise', { name: 'Elise' })).toBe(false)
  })
  it('carte du groupe et liste des documents de la fiche client', () => {
    expect(readFileSync('src/modules/formation/components/SessionGroupes.jsx', 'utf8')).toMatch(/aLaPlaceDe\(signes\[g\.id\]\.sig\.signer_name, signes\[g\.id\]\.doc\.signataire_prevu\)/)
    expect(readFileSync('src/modules/commercial/components/DocumentsEspaceClient.jsx', 'utf8')).toMatch(/aLaPlaceDe\(sigs\[d\.id\]\.signer_name, d\.signataire_prevu\)/)
  })
})

describe('Fiche session et formulaire stagiaire', () => {
  const src = readFileSync('src/modules/formation/pages/SessionDetail.jsx', 'utf8')
  it('inter sans groupe : « Ajoutez d\'abord les groupes », plus de suivi de session à cocher', () => {
    expect(src).toMatch(/Ajoutez d\\'abord les groupes/)
    expect(src).not.toMatch(/session\.session_type === 'inter' && groupesConvention\.some\(\(g\) => g\.status !== 'cancelled'\)\n/)
  })
  it('groupes pas encore lus : jamais « Ajoutez d\'abord les groupes » ; l\'envoi avant formation d\'une inter ne coche plus la convention de session', () => {
    expect(src).toMatch(/useState\(null\)/)
    expect(src).toMatch(/if \(!groupesConvention\) return 'Lecture des groupes/)
    const modal = readFileSync('src/modules/formation/components/SessionEmailModal.jsx', 'utf8')
    expect(modal).toMatch(/codes\.includes\('convention_envoyee'\) && !groupe && session\?\.session_type !== 'inter'/)
    expect(modal).toMatch(/session\?\.session_type === 'inter' \? \['convocations_envoyees'\]/)
    // Relecture après un envoi : la liste affichée est gardée (null seulement au changement de session)
    expect(src).toMatch(/useEffect\(\(\) => \{ setGroupesConvention\(null\) \}, \[session\?\.id\]\)/)
  })
  it('champs du nouveau stagiaire nommés (étiquette reliée)', () => {
    for (const id of ['prenom', 'nom', 'email', 'telephone', 'genre']) {
      expect(src).toContain(`htmlFor="nouveau-stagiaire-${id}"`)
      expect(src).toContain(`id="nouveau-stagiaire-${id}"`)
    }
  })
})

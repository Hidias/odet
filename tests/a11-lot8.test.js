// A11 lot 8 (07/11) : suppression d'un devis signé par le client (D12), mentions internes de la Console (D10).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { libelleRelance } from '../src/modules/commercial/components/RelancePreviewModal.jsx'
import { devisPeutEtreSigne, messageRefusSuppressionDevis, refusSuppressionDevisSigne, REFUS_SUPPRESSION_DEVIS_SIGNE } from '../src/core/portail/alertesPublication'

describe('suppression d\'un devis', () => {
  it('statuts où le devis a pu être signé', () => {
    for (const s of ['accepted', 'partial', 'invoiced', 'replaced']) expect(devisPeutEtreSigne(s)).toBe(true)
    for (const s of ['draft', 'sent', 'refused', 'expired', null]) expect(devisPeutEtreSigne(s)).toBe(false)
  })
  it('le refus de la base dit pourquoi, sans message technique', () => {
    expect(messageRefusSuppressionDevis({ message: "Devis signé par le client : il ne s'efface pas" })).toContain(REFUS_SUPPRESSION_DEVIS_SIGNE)
    expect(messageRefusSuppressionDevis({ message: 'update or delete on table "quotes" violates foreign key constraint' })).toMatch(/relié à une facture/)
    expect(messageRefusSuppressionDevis({ message: 'x' })).toBe("Le devis n'a pas pu être supprimé.")
  })
  it('ce qui reste possible dépend de l\'état du devis signé', () => {
    expect(refusSuppressionDevisSigne('invoiced')).toMatch(/avoir/)
    expect(refusSuppressionDevisSigne('invoiced')).not.toMatch(/nouvelle version/)
    expect(refusSuppressionDevisSigne('replaced')).toMatch(/dernière version/)
    expect(refusSuppressionDevisSigne('accepted')).toMatch(/avenant ou une nouvelle version/)
  })
  it('la signature est vérifiée avant de proposer « Supprimer définitivement »', () => {
    const f = readFileSync('src/modules/commercial/pages/Quotes.jsx', 'utf8')
    const corps = f.slice(f.indexOf('async function deleteQuote'), f.indexOf("toast.success('Devis supprimé')"))
    expect(corps.indexOf("rpc('devis_est_signe'")).toBeGreaterThan(-1)
    expect(corps.indexOf("rpc('devis_est_signe'")).toBeLessThan(corps.indexOf('confirmationSuppressionDevis(devis)'))
    expect(corps).toContain('messageRefusSuppressionDevis(error)')
  })
})

describe('Console sans numéro de migration à l\'écran', () => {
  it('aucun texte affiché ne cite une migration', () => {
    for (const p of ['src/core/console/Console.jsx', 'src/core/console/TachesEtEnvois.jsx', 'src/core/notices/AvisConsole.jsx', 'src/core/console/ConsoleErreurs.jsx']) {
      const lignes = readFileSync(p, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      for (const l of lignes) expect(l, p).not.toMatch(/(migration|base) 0[0-9]{2,3}|0070_suivi_erreurs/)
    }
  })
})

describe('relance de devis du Suivi commercial (D4)', () => {
  const f = readFileSync('src/modules/commercial/components/RelancePreviewModal.jsx', 'utf8')
  it('rien en anglais ni « IA » à l\'écran, titre lisible', () => {
    expect(f).not.toMatch(/Fallback \(|Relance IA|IA indisponible|Sparkles/)
    expect(f).not.toMatch(/1ère|2ème|3ème/)
  })
  it('l\'envoi demande une confirmation avec le destinataire', () => {
    const corps = f.slice(f.indexOf('const handleSend'), f.indexOf('return (', f.indexOf('const handleSend')))
    expect(corps.indexOf('confirmer(')).toBeGreaterThan(-1)
    expect(corps.indexOf('confirmer(')).toBeLessThan(corps.indexOf('onConfirm('))
  })
  it('les états sont déclarés avant la sortie sans aperçu', () => {
    const sortie = f.indexOf('if (!previewData) return null')
    expect(f.lastIndexOf('useState(')).toBeLessThan(sortie)
  })
  it('le texte modifié part, même après retour à l\'aperçu', () => {
    expect(f).toContain('onConfirm(editSubject, editBody)')
    expect(f).not.toMatch(/\{subject\}|\{body\}/)
    expect(f).not.toMatch(/setEditSubject\(subject\)/)
  })
})

describe('numéro de relance', () => {
  it('1re, 2e, 3e', () => { expect([1, 2, 3].map(libelleRelance)).toEqual(['1re relance', '2e relance', '3e relance']) })
})

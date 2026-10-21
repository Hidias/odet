import { describe, it, expect } from 'vitest'
import { ajouterCopieCachee } from '../api/_lib/mailer.js'

describe('envoi réel du super administrateur', () => {
  it('ajoute sa propre adresse en copie cachée, sans doublon', () => {
    expect(ajouterCopieCachee({ to: 'client@exemple.fr' }, 'moi@exemple.fr').bcc).toEqual(['moi@exemple.fr'])
    expect(ajouterCopieCachee({ to: 'c@exemple.fr', bcc: 'Moi@exemple.fr, autre@exemple.fr' }, 'moi@exemple.fr').bcc).toEqual(['moi@exemple.fr', 'autre@exemple.fr'])
  })
  it('garde les destinataires d\'origine', () => {
    const o = ajouterCopieCachee({ to: 'client@exemple.fr', cc: 'rh@exemple.fr', subject: 'Devis' }, 'moi@exemple.fr')
    expect(o.to).toBe('client@exemple.fr')
    expect(o.cc).toBe('rh@exemple.fr')
    expect(o.subject).toBe('Devis')
  })
})

import { boutonHTML, finirParCordialement } from '../api/_lib/mailer.js'
describe('mail du devis', () => {
  it('bouton sans image ni émoji, adresse en clair dessous', () => {
    const h = boutonHTML('https://espace.exemple.fr/#/entreprise/abc', 'Consulter et signer le devis')
    expect(h).toContain('href="https://espace.exemple.fr/#/entreprise/abc"')
    expect(h).toContain('Si le bouton ne s')
    expect(h).not.toContain('<img')
  })
  it('pas de « Bien cordialement » en double', () => {
    expect(finirParCordialement('Bonjour,\n\nTexte.\n\nBien cordialement,')).toBe(true)
    expect(finirParCordialement('Bonjour,\n\nTexte.')).toBe(false)
  })
})

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

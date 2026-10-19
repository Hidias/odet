import { describe, it, expect } from 'vitest'
import { optionsDeQuestion, confirmer } from '../src/ui/Confirm'

describe('confirmation commune (remplace window.confirm)', () => {
  it('déduit le bouton et le danger de la question', () => {
    expect(optionsDeQuestion('Supprimer ce devis ?')).toMatchObject({ confirmLabel: 'Supprimer', danger: true })
    expect(optionsDeQuestion('Dupliquer le devis DEV-1 ?')).toMatchObject({ confirmLabel: 'Dupliquer', danger: false })
    expect(optionsDeQuestion('Annuler cette publication planifiée ?')).toMatchObject({ confirmLabel: 'Oui, annuler', cancelLabel: 'Non', danger: true })
    expect(optionsDeQuestion(' ATTENTION : tout sera effacé')).toMatchObject({ confirmLabel: 'Confirmer', danger: true })
    expect(optionsDeQuestion('Le contrôle ne tombe pas juste.\n\nEnregistrer quand même ?')).toMatchObject({ confirmLabel: 'Confirmer', danger: false })
  })

  it('sans fenêtre montée ni navigateur : jamais de « oui » à la place de l\'utilisateur', async () => {
    expect(await confirmer('Supprimer ?')).toBe(false)
  })
})

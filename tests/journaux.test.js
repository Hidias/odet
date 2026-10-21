// Règle du chantier F (écart 14) : aucune donnée personnelle dans les journaux des fonctions /api
// ni dans le suivi des erreurs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { redact, redactAny, installConsoleRedaction } from '../api/_lib/redact.js'

describe('Masquage des données personnelles', () => {
  const cas = [
    ['Envoi à jean.dupont@exemple.fr refusé', 'Envoi à [email] refusé'],
    ['550 5.1.1 <marie+test@exemple.fr>: unknown', '550 5.1.1 <[email]>: unknown'],
    ['tél 06 12 34 56 78', 'tél [téléphone]'],
    ['tél 06.12.34.56.78', 'tél [téléphone]'],
    ['tél 0612345678', 'tél [téléphone]'],
    ['tél +33 6 12 34 56 78', 'tél [téléphone]'],
    ['IBAN FR76 3000 6000 0112 3456 7890 189', 'IBAN [IBAN]'],
    ['IBAN FR7630006000011234567890189', 'IBAN [IBAN]'],
    ['NIR 1 85 05 78 006 084 36', 'NIR [NIR]'],
    ['NIR 285057800608436', 'NIR [NIR]'],
    ['Authorization: Bearer abcdefghij123456', 'Authorization: Bearer [jeton]'],
    ['{"access_token":"ya29.a0AfH6SMBx","expires_in":3599}', '{"access_token":"[masqué]","expires_in":3599}'],
    ['GET /api/auth/google?code=4/0AX4XfWh&state=xyz123', 'GET /api/auth/google?code=[masqué]&state=[masqué]'],
    // Jeton fictif assemblé à l'exécution : aucun jeton complet écrit dans le dépôt (les détecteurs de secrets le prenaient pour un vrai)
    [`jeton ${['eyJ' + 'a'.repeat(12), 'eyJ' + 'b'.repeat(12), 'c'.repeat(20)].join('.')}`, 'jeton [jeton]'],
  ]
  for (const [entree, attendu] of cas) {
    it(`masque : ${attendu}`, () => expect(redact(entree)).toBe(attendu))
  }

  it('laisse intacts les messages techniques utiles', () => {
    const msg = 'TypeError: Cannot read properties of undefined (reading \'trainees\') at SessionDetail.jsx:812:31, code PGRST116, réponse 500'
    expect(redact(msg)).toBe(msg)
  })

  it('objets et erreurs : masqués après mise en texte', () => {
    expect(redactAny({ to: 'a@b.fr', n: 2 })).toBe('{"to":"[email]","n":2}')
    const e = redactAny(new Error('client c@d.fr injoignable'))
    expect(e.message).toBe('client [email] injoignable')
    expect(e.stack).not.toContain('c@d.fr')
  })

  it('tous les journaux console de la route sont masqués', () => {
    const sortie = []
    const faux = { log: (...a) => sortie.push(a), error: (...a) => sortie.push(a) }
    installConsoleRedaction(faux)
    faux.log('Sync', 'claire@exemple.fr', { tel: '06 12 34 56 78' })
    faux.error('Erreur', new Error('IBAN FR76 3000 6000 0112 3456 7890 189'))
    const texte = JSON.stringify(sortie.map((a) => a.map((x) => (x instanceof Error ? x.message : x))))
    expect(texte).not.toMatch(/@exemple\.fr|06 12 34|FR76 3000 6/)
    expect(texte).toContain('[email]')
  })
})

describe('Suivi des erreurs sans donnée personnelle', () => {
  const migration = readFileSync('supabase/migrations/0070_suivi_erreurs.sql', 'utf8')
  const serveur = readFileSync('api/_lib/errors.js', 'utf8')
  const navigateur = readFileSync('src/core/errors/reporter.js', 'utf8')
  const ecran = readFileSync('src/core/console/ConsoleErreurs.jsx', 'utf8')

  it('la table ne garde aucun email (identifiants de compte seulement)', () => {
    expect(migration).not.toMatch(/user_email|users text|'user', v_email/)
    expect(migration).toMatch(/user_ids uuid\[\]/)
  })
  it('la base masque elle-même message, pile et page', () => {
    expect(migration).toMatch(/v_message text := left\(public\.error_redact/)
    expect(migration).toMatch(/v_stack text := left\(public\.error_redact/)
    expect(migration).toMatch(/v_page text := left\(public\.error_redact/)
  })
  it('serveur et navigateur masquent avant envoi, sans email', () => {
    expect(serveur).toMatch(/installConsoleRedaction\(\)/)
    expect(serveur).toMatch(/p_message: redact\(/)
    expect(serveur).not.toMatch(/p_user_email|user\?\.email/)
    expect(navigateur).toMatch(/p_message: redact\(/)
  })
  it('l\'écran Erreurs n\'enregistre pas l\'email de qui traite', () => {
    expect(ecran).not.toMatch(/resolved_by: user\?\.email/)
  })
})

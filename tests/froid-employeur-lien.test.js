import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { messageFroid } from '../src/modules/portail/components/FroidEspace'

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

describe('Évaluation à froid de l’employeur par l’espace par lien (0509)', () => {
  it('message de la base montré tel quel, le reste en phrase simple', () => {
    expect(messageFroid({ code: '22023', message: 'Merci de répondre à toutes les questions' })).toBe('Merci de répondre à toutes les questions')
    expect(messageFroid({ code: '23505', message: 'Votre réponse est déjà enregistrée : merci' })).toBe('Votre réponse est déjà enregistrée : merci')
    expect(messageFroid({ code: '42501', message: 'permission denied for function client_portal_froid_repondre' }, 'x')).toBe('x')
    expect(messageFroid({ message: 'TypeError: Failed to fetch' }, 'x')).toBe('x')
    expect(messageFroid({}, 'x')).toBe('x')
  })

  it('espace par lien : rubrique branchée sur les fonctions du lien, créées par 0509', () => {
    const portail = lire('src/modules/portail/pages/ClientPortal.jsx')
    expect(portail).toMatch(/rpc\('client_portal_froid', \{ p_token: token, p_code: c \}\)/)
    expect(portail).toMatch(/<FroidEspace[\s\S]*client_portal_froid_repondre'/)
    const migration = lire('supabase/migrations/0509_froid_employeur_par_lien.sql')
    expect(migration).toMatch(/function public\.client_portal_froid\(p_token text, p_code text\)/)
    expect(migration).toMatch(/function public\.client_portal_froid_repondre\(p_token text, p_code text, p_session uuid, p_reponses jsonb\)/)
    // espace par compte : même règle commune
    expect(migration).toMatch(/return app\.froid_employeur_client\(v\.client_id, v\.company_id\)/)
  })
})

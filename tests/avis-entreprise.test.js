import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { messageAvis } from '../src/modules/portail/components/AvisEntreprise'

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

describe('Avis de l’entreprise (0415, 0504)', () => {
  it('message de la base montré tel quel, le reste en phrase simple', () => {
    expect(messageAvis({ code: '22023', message: 'L\'avis se donne à la fin de la formation' }, 'x')).toBe('L\'avis se donne à la fin de la formation')
    expect(messageAvis({ code: '42501', message: 'Session inconnue pour ce client' }, 'x')).toBe('Session inconnue pour ce client')
    expect(messageAvis({ message: 'TypeError: Failed to fetch' }, 'Avis non enregistré.')).toBe('Avis non enregistré.')
    expect(messageAvis({ code: 'PGRST202', message: 'Could not find the function' }, 'Avis non enregistré.')).toBe('Avis non enregistré.')
    expect(messageAvis(null, 'défaut')).toBe('défaut')
    expect(messageAvis({ code: '42501', message: 'permission denied for function client_portal_satisfaction' }, 'Avis non enregistré.')).toBe('Avis non enregistré.')
  })

  it('espace par lien : bouton d’avis branché sur les fonctions du lien, créées par 0504', () => {
    const portail = lire('src/modules/portail/pages/ClientPortal.jsx')
    expect(portail).toMatch(/<AvisEntreprise[\s\S]*client_portal_satisfaction'/)
    expect(portail).toMatch(/rpc\('client_portal_satisfactions'/)
    expect(portail).toMatch(/finished && avisDispo/)
    const migration = lire('supabase/migrations/0504_avis_entreprise_par_lien.sql')
    expect(migration).toMatch(/function public\.client_portal_satisfaction\(p_token text, p_code text, p_session uuid, p_reponses jsonb/)
    expect(migration).toMatch(/function public\.client_portal_satisfactions\(p_token text, p_code text\)/)
  })

  it('une lecture qui échoue n’ouvre pas le formulaire', () => {
    const avis = lire('src/modules/portail/components/AvisEntreprise.jsx')
    expect(avis).toMatch(/if \(error \|\| data\?\.error\) \{ setErreurLecture/)
    expect(avis).toMatch(/\{erreurLecture \? \(/)
  })
})

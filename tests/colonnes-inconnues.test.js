// Contrôle des colonnes demandées au client Supabase (scripts/qualite/colonnes.mjs) : cas fictifs.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const schema = {
  cols: {
    clients: ['id', 'name', 'contact_phone'],
    session_groups: ['id', 'session_id', 'client_id'],
    sessions: ['id', 'reference', 'client_id'],
  },
  fks: [
    { t: 'session_groups', col: 'client_id', ref: 'clients', name: 'session_groups_client_id_fkey' },
    { t: 'session_groups', col: 'session_id', ref: 'sessions', name: 'session_groups_session_id_fkey' },
  ],
}

function lancer(code) {
  const dossier = mkdtempSync(join(tmpdir(), 'colonnes-'))
  mkdirSync(join(dossier, 'src'))
  writeFileSync(join(dossier, 'schema.json'), JSON.stringify(schema))
  writeFileSync(join(dossier, 'src', 'ecran.jsx'), code)
  try {
    const sortie = execFileSync('node', ['scripts/qualite/colonnes.mjs', join(dossier, 'schema.json'), join(dossier, 'src')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, sortie }
  } catch (e) {
    return { code: e.status, sortie: e.stdout }
  }
}

describe('colonnes inconnues', () => {
  it('signale une colonne absente dans une sous-sélection par clé étrangère (cas de l\'onglet Groupes)', () => {
    const r = lancer("supabase.from('session_groups').select('*, clients:client_id(id, name, phone, contact_phone)').eq('session_id', id)")
    expect(r.code).toBe(1)
    expect(r.sortie).toContain('session_groups > clients : colonne inconnue « phone »')
  })

  it('accepte une sélection juste, avec alias, sous-sélection par nom de table et filtres', () => {
    const r = lancer("supabase.from('session_groups').select('id, groupe:client_id, sessions(reference), clients!session_groups_client_id_fkey(name)').eq('session_id', x).order('id')")
    expect(r.code).toBe(0)
  })

  it('signale un filtre sur une colonne absente', () => {
    const r = lancer("supabase.from('clients').select('id').eq('phone', '06')")
    expect(r.code).toBe(1)
    expect(r.sortie).toContain('clients : filtre sur une colonne inconnue « phone »')
  })

  it('ne relie pas un filtre à la requête précédente', () => {
    const r = lancer("await Promise.all([\n  supabase.from('clients').select('id'),\n  count('sessions', (q) => q.eq('reference', 'x')),\n  supabase.from('sessions').select('id').eq('client_id', 1),\n])")
    expect(r.code).toBe(0)
  })

  it('ignore une sélection construite avec ${} et une table inconnue du schéma', () => {
    const r = lancer("supabase.from('clients').select(`id, ${champ}`); supabase.from('vue_absente').select('quoi')")
    expect(r.code).toBe(0)
  })
})

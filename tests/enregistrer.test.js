// Écriture vérifiée (lot fiabilité, 19/11) : 0 ligne modifiée n'est jamais un succès.
import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { enregistrer, enregistrerOuLever, estAucuneLigne, AUCUNE_LIGNE, MESSAGE_AUCUNE_LIGNE } from '../src/core/enregistrer.js'

// Fausse requête : mémorise le select demandé et renvoie la réponse fournie.
function fausse(reponse, selectInitial = null) {
  const params = new URLSearchParams(selectInitial ? { select: selectInitial } : {})
  const q = {
    url: { searchParams: params },
    colonnesDemandees: selectInitial,
    select(c) { q.colonnesDemandees = c; params.set('select', c); return q },
    then(res, rej) { return Promise.resolve(reponse).then(res, rej) },
  }
  return q
}

describe('enregistrer', () => {
  it('ajoute select(id) quand la requête n’en a pas', async () => {
    const q = fausse({ data: [{ id: 1 }], error: null })
    const r = await enregistrer(q)
    expect(q.colonnesDemandees).toBe('id')
    expect(r).toEqual({ data: [{ id: 1 }], error: null })
  })

  it('garde le select déjà posé', async () => {
    const q = fausse({ data: [{ id: 1, status: 'x' }], error: null }, 'id,status')
    await enregistrer(q)
    expect(q.colonnesDemandees).toBe('id,status')
  })

  it('colonnes personnalisées pour une table sans id', async () => {
    const q = fausse({ data: [{ session_id: 's' }], error: null })
    await enregistrer(q, { colonnes: 'session_id' })
    expect(q.colonnesDemandees).toBe('session_id')
  })

  it('0 ligne sans erreur de la base : erreur AUCUNE_LIGNE', async () => {
    const r = await enregistrer(fausse({ data: [], error: null }))
    expect(r.error.code).toBe(AUCUNE_LIGNE)
    expect(r.error.message).toBe(MESSAGE_AUCUNE_LIGNE)
    expect(estAucuneLigne(r.error)).toBe(true)
    expect(r.data).toEqual([])
  })

  it('data null sans erreur : traité comme 0 ligne', async () => {
    const r = await enregistrer(fausse({ data: null, error: null }))
    expect(estAucuneLigne(r.error)).toBe(true)
  })

  it('erreur de la base renvoyée telle quelle', async () => {
    const err = { message: 'violation', code: '23505' }
    const r = await enregistrer(fausse({ data: null, error: err }))
    expect(r).toEqual({ data: null, error: err })
    expect(estAucuneLigne(r.error)).toBe(false)
  })

  it('attendu : enregistrement partiel refusé avec un message chiffré', async () => {
    const r = await enregistrer(fausse({ data: [{ id: 1 }, { id: 2 }], error: null }), { attendu: 3 })
    expect(r.error.code).toBe(AUCUNE_LIGNE)
    expect(r.error.obtenu).toBe(2)
    expect(r.error.attendu).toBe(3)
    expect(r.error.message).toContain('2 sur 3')
  })

  it('attendu atteint : succès', async () => {
    const r = await enregistrer(fausse({ data: [{ id: 1 }, { id: 2 }], error: null }), { attendu: 2 })
    expect(r.error).toBeNull()
  })

  it('message propre à l’écran', async () => {
    const r = await enregistrer(fausse({ data: [], error: null }), { message: 'Facture non modifiée.' })
    expect(r.error.message).toBe('Facture non modifiée.')
  })

  it('une ligne seule (objet) est mise en tableau', async () => {
    const r = await enregistrer(fausse({ data: { id: 9 }, error: null }))
    expect(r).toEqual({ data: [{ id: 9 }], error: null })
  })

  it('ne lève jamais : exception de la requête renvoyée en erreur', async () => {
    const q = { url: null, select() { throw new Error('cassé') } }
    const r = await enregistrer(q)
    expect(r.data).toBeNull()
    expect(r.error.message).toBe('cassé')
  })

  it('enregistrerOuLever lève sur 0 ligne et renvoie les lignes sinon', async () => {
    await expect(enregistrerOuLever(fausse({ data: [], error: null }))).rejects.toMatchObject({ code: AUCUNE_LIGNE })
    await expect(enregistrerOuLever(fausse({ data: [{ id: 1 }], error: null }))).resolves.toEqual([{ id: 1 }])
  })

  it('vraie requête supabase-js : select(id) posé et retour des lignes demandé', () => {
    const s = createClient('https://exemple.supabase.co', 'cle')
    const q = s.from('invoices').update({ status: 'paid' }).eq('id', '1')
    expect(q.url.searchParams.get('select')).toBeNull()
    const avec = q.select('id')
    expect(avec.url.searchParams.get('select')).toBe('id')
  })
})

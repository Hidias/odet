import { describe, it, expect, beforeEach, vi } from 'vitest'

// Chaque rechargement repart d'un module neuf (nouvelle page), avec le même stockage de l'onglet
async function page() {
  vi.resetModules()
  return import('../src/core/errors/chunkReload.js')
}

describe('rechargement après une mise en ligne', () => {
  beforeEach(() => {
    const store = {}
    globalThis.sessionStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v) } }
    globalThis.window = { location: { reload: vi.fn() } }
    vi.useFakeTimers()
  })
  it('recharge jusqu\'à trois fois en trois minutes, puis laisse l\'erreur s\'afficher', async () => {
    let m = await page()
    expect(m.reloadOnceAfterUpdate()).toBe(true)
    expect(m.reloadOnceAfterUpdate()).toBe(true) // même erreur vue deux fois : un seul rechargement
    expect(window.location.reload).toHaveBeenCalledTimes(1)
    m = await page()
    expect(m.reloadOnceAfterUpdate()).toBe(true)
    vi.advanceTimersByTime(3000)
    expect(window.location.reload).toHaveBeenCalledTimes(2)
    m = await page()
    expect(m.reloadOnceAfterUpdate()).toBe(true)
    vi.advanceTimersByTime(8000)
    expect(window.location.reload).toHaveBeenCalledTimes(3)
    m = await page()
    expect(m.reloadOnceAfterUpdate()).toBe(false)
  })
})

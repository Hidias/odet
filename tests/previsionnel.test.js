import { describe, it, expect } from 'vitest'
import { parMois, totaux } from '../src/modules/commercial/lib/previsionnel'

// Prévisionnel récurrent (fonction 12, 0150) : regroupement par mois, sans estimation des échéances sans prix
const k = (decal) => { const d = new Date(); const x = new Date(d.getFullYear(), d.getMonth() + decal, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01` }

describe('prévisionnel', () => {
  const lignes = [
    { mois: k(0), nature: 'formation', montant_attendu: 600, montant_devise: 200, montant_planifie: 200, nb_sans_prix: 0, nb_echeances: 3 },
    { mois: k(0), nature: 'maintenance', montant_attendu: 0, montant_devise: 0, montant_planifie: 0, nb_sans_prix: 1, nb_echeances: 1 },
    { mois: k(2), nature: 'contrat', montant_attendu: 1200, montant_devise: 0, montant_planifie: 0, nb_sans_prix: 0, nb_echeances: 1 },
    { mois: k(14), nature: 'formation', montant_attendu: 999, nb_sans_prix: 0, nb_echeances: 1 },
  ]
  it('12 mois, totaux par nature, hors fenêtre ignoré', () => {
    const m = parMois(lignes)
    expect(m).toHaveLength(12)
    expect(m[0].attendu).toBe(600)
    expect(m[0].formation).toBe(600)
    expect(m[0].sansPrix).toBe(1)
    expect(m[2].contrat).toBe(1200)
    expect(totaux(lignes)).toEqual({ attendu: 1800, devise: 200, planifie: 200, sansPrix: 1 })
    expect(totaux(lignes, 'formation').attendu).toBe(600)
  })
})

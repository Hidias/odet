import { describe, it, expect } from 'vitest'
import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { startDocument, compacter, compacterAsync, dernierePagePeuRemplie } from '../src/core/pdf/layout'
import { buildORG } from '../src/core/org/orgUtils'

// Dernière page presque vide (demande de H, 06/11) : recomposée plus serrée, ou lignes de tableau reportées
const ORG = buildORG({ name: 'Organisme essai', city: 'Quimper' })

// Document de n paragraphes : avec n bien choisi, il déborde de quelques lignes sur une seconde page
function document(n, densite) {
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, { code: 'ESSAI', title: 'Essai', densite })
  for (let i = 0; i < n; i++) {
    f.section(`Partie ${i + 1}`)
    f.para('Texte de la partie, assez long pour occuper plusieurs lignes dans la largeur de la page, avec une suite de mots ordinaires.')
    f.bullets(['Premier point', 'Deuxième point'])
  }
  f.finish()
  return doc
}

const pagesDe = (d) => d.getNumberOfPages()

describe('Mesure de la dernière page', () => {
  it('un document d\'une page n\'est jamais « peu rempli »', () => {
    expect(dernierePagePeuRemplie(document(2))).toBe(false)
  })
  it('un débordement de quelques lignes est repéré', () => {
    // n tel que la seconde page ne porte qu'une partie
    let n = 2
    while (pagesDe(document(n)) === 1) n++
    expect(dernierePagePeuRemplie(document(n))).toBe(true)
  })
})

describe('compacter (construction synchrone)', () => {
  it('retire la page presque vide en serrant les espacements', () => {
    let n = 2
    while (pagesDe(document(n)) === 1) n++
    expect(pagesDe(document(n))).toBe(2)
    expect(pagesDe(compacter(() => document(n)))).toBe(1)
  })
  it('ne touche pas un document qui tient sur une page', () => {
    const d = compacter(() => document(2))
    expect(pagesDe(d)).toBe(1)
    expect(d.__odetMesure.remplissage).toBe(1)
  })
  it('garde la version d\'origine si serrer ne retire aucune page', () => {
    // très long : la dernière page reste partielle même serrée, le document d'origine est rendu tel quel
    const d = compacter(() => document(40))
    expect(pagesDe(d)).toBe(pagesDe(document(40)))
  })
  it('la densité revient à la normale après une recomposition', () => {
    let n = 2
    while (pagesDe(document(n)) === 1) n++
    compacter(() => document(n))
    const ensuite = new jsPDF()
    const f = startDocument(ensuite, ORG, { code: 'ESSAI' })
    expect(f.densite).toBe(1)
  })
})

describe('compacterAsync (devis, facture)', () => {
  it('transmet la densité et ne tente le report de lignes qu\'en dernier recours', async () => {
    const appels = []
    let n = 2
    while (pagesDe(document(n)) === 1) n++
    const d = await compacterAsync(async (densite, report) => { appels.push([densite, report]); return document(n, densite) }, { reportMax: 3 })
    expect(pagesDe(d)).toBe(1)
    expect(appels[0]).toEqual([1, 0])
    expect(appels.every(([, r]) => r === 0)).toBe(true)
  })
  it('renvoie l\'objet construit tel quel ({ doc }) quand il tient', async () => {
    const r = await compacterAsync(async () => ({ doc: document(2), filename: 'x.pdf' }))
    expect(r.filename).toBe('x.pdf')
  })
})

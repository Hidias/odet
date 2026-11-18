import { describe, it, expect, vi, beforeEach } from 'vitest'

// Appel entrant (B110) : recherche de fiche, statut client ou prospect, création de la fiche et de l'action reliée
const appels = []
let lecture = { data: [], error: null }
let insertion = { data: { id: 'f1', name: 'Hôtel Test', type: 'prospect', company_id: 'c1' }, error: null }
vi.mock('../src/core/supabase.js', () => ({
  supabase: {
    from: (table) => ({
      select: () => ({ or: (f) => { appels.push({ table, or: f }); return { order: () => ({ limit: async () => lecture }) } } }),
      insert: (l) => { appels.push({ table, insert: l }); return { select: () => ({ single: async () => (table === 'clients' ? insertion : { data: { id: 'a1', ...l }, error: null }) }) } },
    }),
  },
}))
const { filtreRecherche, chiffresTelephone, societeAction, statutFiche, titreAction, detailAction, chercherFiches, creerFicheProspect, creerActionAppel } = await import('../src/core/point/appelEntrant.js')

beforeEach(() => { appels.length = 0; lecture = { data: [], error: null } })

describe('Recherche de la fiche', () => {
  it('rien sous 2 caractères', () => {
    expect(filtreRecherche('')).toBeNull()
    expect(filtreRecherche(' a ')).toBeNull()
  })
  it('nom : caractères du filtre remplacés par un joker (la fiche enregistrée avec eux est retrouvée)', () => {
    const f = filtreRecherche('Garage (Brest), Nord')
    expect(f).toContain('name.ilike.*Garage *Brest* Nord*')
    expect(f).toContain('legal_name.ilike.*Garage *Brest* Nord*')
    expect(f).not.toMatch(/[()"]/)
    expect(filtreRecherche('(,)')).toBeNull()
  })
  it('téléphone : chiffres dans l\'ordre, quel que soit le format de la fiche', () => {
    const f = filtreRecherche('06 35 20 04 28')
    expect(f).toContain('contact_phone.ilike.*6*3*5*2*0*0*4*2*8*')
    expect(f).toContain('mobile.ilike.*6*3*5*2*0*0*4*2*8*')
  })
  it('téléphone : même motif pour 06…, +33 6… et 0033 6… (fiche enregistrée dans un autre format retrouvée)', () => {
    expect(chiffresTelephone('06 35 20 04 28')).toBe('635200428')
    expect(chiffresTelephone('+33 6 35 20 04 28')).toBe('635200428')
    expect(chiffresTelephone('0033 6 35 20 04 28')).toBe('635200428')
    expect(chiffresTelephone('35 20 04')).toBe('352004')
  })
  it('SIRET et SIREN exacts', () => {
    expect(filtreRecherche('830 695 649 00020')).toContain('siret.eq.83069564900020')
    expect(filtreRecherche('830695649')).toContain('siren.eq.830695649')
  })
  it('lecture refusée : null, jamais une liste vide inventée', async () => {
    lecture = { data: null, error: { code: '42501' } }
    expect(await chercherFiches('Hôtel')).toBeNull()
  })
  it('texte trop court : aucune lecture', async () => {
    expect(await chercherFiches('a')).toEqual([])
    expect(appels).toHaveLength(0)
  })
})

describe('Société de l\'action', () => {
  it('société où l\'on travaille quand la fiche lui est partagée', () => {
    expect(societeAction({ company_id: 'A', company_ids: ['A', 'C'] }, 'C')).toBe('C')
    expect(societeAction({ company_id: 'A', company_ids: ['A'] }, 'A')).toBe('A')
  })
  it('sinon société de la fiche ; aucune : base', () => {
    expect(societeAction({ company_id: 'A', company_ids: ['A'] }, 'C')).toBe('A')
    expect(societeAction({ company_id: 'A' }, null)).toBe('A')
    expect(societeAction({}, null)).toBeNull()
  })
})

describe('Statut de la fiche (règle 0507)', () => {
  it('client seulement quand la base l\'a passée client', () => {
    expect(statutFiche({ type: 'client' })).toBe('Client')
    expect(statutFiche({ type: 'prospect' })).toBe('Prospect')
    expect(statutFiche({})).toBe('Prospect')
  })
})

describe('Intitulé et détail de l\'action', () => {
  it('verbe, fiche, motif', () => {
    expect(titreAction('rappeler', 'Hôtel Test', ' devis  extincteurs ')).toBe('Rappeler Hôtel Test (appel entrant) : devis extincteurs')
    expect(titreAction('aller_voir', 'Hôtel Test', '')).toBe('Aller voir Hôtel Test (appel entrant)')
    expect(titreAction('inconnu', '', '')).toBe('Rappeler le correspondant (appel entrant)')
  })
  it('300 caractères au plus (règle de la base)', () => {
    expect(titreAction('rappeler', 'X', 'm'.repeat(400))).toHaveLength(300)
  })
  it('détail vide : null', () => {
    expect(detailAction({})).toBeNull()
    expect(detailAction({ contact: 'M. Martin', telephone: '02 98', motif: 'devis' })).toBe('Contact : M. Martin\nTéléphone : 02 98\nMotif : devis')
  })
})

describe('Création', () => {
  it('fiche prospect : le type n\'est jamais écrit à la main', async () => {
    await creerFicheProspect({ nom: ' Hôtel Test ', telephone: '02 98 00 00 00', contact: 'M. Martin' })
    const ins = appels.find((a) => a.table === 'clients').insert
    expect(ins.name).toBe('Hôtel Test')
    expect(ins).not.toHaveProperty('type')
    expect(ins.contact_phone).toBe('02 98 00 00 00')
  })
  it('fiche sans nom : refusée avant tout envoi', async () => {
    await expect(creerFicheProspect({ nom: ' ' })).rejects.toThrow()
    expect(appels).toHaveLength(0)
  })
  it('refus de la base remonté (pas de faux succès)', async () => {
    insertion = { data: null, error: { code: '42501', message: 'refus' } }
    await expect(creerFicheProspect({ nom: 'Hôtel' })).rejects.toMatchObject({ code: '42501' })
    insertion = { data: { id: 'f1', name: 'Hôtel Test', type: 'prospect', company_id: 'c1' }, error: null }
  })
  it('action reliée à la fiche, dans la société de la fiche', async () => {
    await creerActionAppel({ fiche: { id: 'f1', name: 'Hôtel Test', company_id: 'c1' }, suite: 'rappeler', motif: 'devis', owner_id: 'u1', due_on: '2026-11-19' })
    const ins = appels.find((a) => a.table === 'team_actions').insert
    expect(ins).toMatchObject({ client_id: 'f1', company_id: 'c1', owner_id: 'u1', due_on: '2026-11-19', source: 'manuel', title: 'Rappeler Hôtel Test (appel entrant) : devis' })
  })
  it('sans fiche : refusée', async () => {
    await expect(creerActionAppel({ fiche: null })).rejects.toThrow()
  })
})

// B111 : écran unique, responsable par défaut, action sans fiche, filtre « À attribuer »
const { estTelephone, responsableParDefaut, etatEnregistrement } = await import('../src/core/point/appelEntrant.js')
const { pourPersonne } = await import('../src/core/point/actions.js')

describe('Écran unique (B111)', () => {
  it('reconnaît un numéro saisi', () => {
    expect(estTelephone('06 12 34 56 78')).toBe(true)
    expect(estTelephone('+33 6 12 34 56 78')).toBe(true)
    expect(estTelephone('Garage 29')).toBe(false)
    expect(estTelephone('0612')).toBe(false)
  })
  it('responsable : celui qui décroche s\'il peut traiter, sinon à attribuer', () => {
    expect(responsableParDefaut('u1', true)).toBe('u1')
    expect(responsableParDefaut('u1', false)).toBe('')
    expect(responsableParDefaut(undefined, true)).toBe('')
  })
  const base = { fiche: null, texte: 'Hôtel', nom: '', aJour: true, nbResultats: 0, nouveauConfirme: false, peutCreerFiche: true }
  it('attend la fin de la recherche avant de proposer une création', () => {
    expect(etatEnregistrement({ ...base, aJour: false })).toBe('attendre')
    expect(etatEnregistrement({ ...base, texte: 'H' })).toBe('attendre')
  })
  it('fiche choisie : action reliée', () => {
    expect(etatEnregistrement({ ...base, fiche: { id: 'f1' }, nbResultats: 3 })).toBe('fiche')
  })
  it('des fiches correspondent : choisir ou confirmer le nouveau prospect (pas de doublon par défaut)', () => {
    expect(etatEnregistrement({ ...base, nbResultats: 2 })).toBe('choisir')
    expect(etatEnregistrement({ ...base, nbResultats: 2, nouveauConfirme: true })).toBe('creer')
    expect(etatEnregistrement({ ...base, nbResultats: 9, nouveauConfirme: true })).toBe('preciser')
  })
  it('numéro seul : un nom est demandé pour créer la fiche', () => {
    expect(etatEnregistrement({ ...base, texte: '06 12 34 56 78' })).toBe('nommer')
    expect(etatEnregistrement({ ...base, texte: '06 12 34 56 78', nom: 'Boulangerie' })).toBe('creer')
  })
  it('sans droit de créer la fiche : action seule', () => {
    expect(etatEnregistrement({ ...base, peutCreerFiche: false })).toBe('sans_fiche')
    expect(etatEnregistrement({ ...base, texte: '06 12 34 56 78', peutCreerFiche: false })).toBe('sans_fiche')
  })
  it('action sans fiche : intitulé avec le nom saisi, sans client_id', async () => {
    await creerActionAppel({ fiche: null, nomLibre: '06 12 34 56 78', suite: 'rappeler', motif: 'devis', telephone: '06 12 34 56 78' })
    const ins = appels.find((x) => x.table === 'team_actions').insert
    expect(ins.client_id).toBe(null)
    expect(ins.title).toBe('Rappeler 06 12 34 56 78 (appel entrant) : devis')
    expect(ins.owner_id).toBe(null)
  })
  it('refuse une action sans fiche ni nom', async () => {
    await expect(creerActionAppel({ fiche: null, nomLibre: '' })).rejects.toThrow()
  })
})

describe('Filtre Personne des Actions (B111)', () => {
  const a = (owner_id) => ({ owner_id })
  it('Mes actions inclut les actions à attribuer', () => {
    expect(pourPersonne(a('u1'), 'moi', 'u1')).toBe(true)
    expect(pourPersonne(a(null), 'moi', 'u1')).toBe(true)
    expect(pourPersonne(a('u2'), 'moi', 'u1')).toBe(false)
  })
  it('À attribuer ne montre que les actions sans responsable', () => {
    expect(pourPersonne(a(null), 'a_attribuer', 'u1')).toBe(true)
    expect(pourPersonne(a('u1'), 'a_attribuer', 'u1')).toBe(false)
  })
  it('Tous et une personne précise', () => {
    expect(pourPersonne(a('u2'), 'tous', 'u1')).toBe(true)
    expect(pourPersonne(a('u2'), 'u2', 'u1')).toBe(true)
    expect(pourPersonne(a(null), 'u2', 'u1')).toBe(false)
  })
})

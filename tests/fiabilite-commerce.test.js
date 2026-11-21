// Lot fiabilité commerce (B121, 21/11) : les écritures du module commercial passent par « enregistrer ».
// Contrôle de source : une mise à jour ou une suppression écrite sans vérification du nombre de lignes
// ferait passer un refus de la règle d'accès pour un succès (fiches clients, contacts, sites, affaires...).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function fichiers(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return fichiers(chemin)
    return /\.(js|jsx)$/.test(nom) ? [chemin] : []
  })
}

const FICHIERS = fichiers('src/modules/commercial')

// Écritures volontairement hors « enregistrer », avec leur raison
const EXCEPTIONS = [
  // Relances : nombre de lignes déjà lu, validation partielle normale (les autres étaient déjà traitées)
  { fichier: 'AValider.jsx', motif: "from('scheduled_actions').update({ status: 'valide' })" },
  // Relance : 0 ligne relue pour distinguer « déjà traitée » et « compte sans droit »
  { fichier: 'AValider.jsx', motif: "from('scheduled_actions').update(maj)" },
  // Répertoire de prospection : 0 ligne est normal (SIREN absent), l'erreur de la base est vérifiée
  { fichier: 'ClientDetail.jsx', motif: "from('prospection_massive').update(" },
  // Statuts « en retard » et « à échéance » mis à jour à l'ouverture (compte autorisé seulement), liste relue juste après
  { fichier: 'Invoices.jsx', motif: "from('invoices').update({ status: 'overdue'" },
  { fichier: 'Invoices.jsx', motif: "from('invoices').update({ status: 'due'" },
  // Anciennes lignes supprimées avant réinsertion, après la facture ou le devis vérifié : 0 ligne est normal
  { fichier: 'Invoices.jsx', motif: "from('invoice_items').delete().eq('invoice_id', iid)" },
  { fichier: 'Quotes.jsx', motif: "from('quote_items').delete().eq('quote_id', quoteId)" },
]

const plat = (chemin) => readFileSync(chemin, 'utf8').replace(/\)\s*\n\s*\./g, ').').replace(/supabase\s*\n\s*\.from/g, 'supabase.from')

describe('écritures du module commercial', () => {
  it("aucune mise à jour ni suppression sans « enregistrer », hors exceptions listées", () => {
    const fautes = []
    for (const chemin of FICHIERS) {
      const t = plat(chemin)
      const re = /from\('(\w+)'\)\.(update|delete)\(/g
      let m
      while ((m = re.exec(t))) {
        const avant = t.slice(Math.max(0, m.index - 40), m.index)
        if (/enregistrer(OuLever)?\(/.test(avant)) continue
        const exception = EXCEPTIONS.find((e) => chemin.endsWith(e.fichier) && t.slice(m.index, m.index + 120).startsWith(e.motif))
        if (exception) continue
        fautes.push(`${chemin} : ${t.slice(m.index, m.index + 80)}`)
      }
    }
    expect(fautes).toEqual([])
  })

  it('chaque exception existe encore', () => {
    for (const e of EXCEPTIONS) {
      const chemin = FICHIERS.find((f) => f.endsWith('/' + e.fichier))
      expect(plat(chemin)).toContain(e.motif)
    }
  })

  it("l'erreur des exceptions est vérifiée", () => {
    expect(plat('src/modules/commercial/pages/ClientDetail.jsx')).toContain('if (erreurMarquage) throw erreurMarquage')
    expect(plat('src/modules/commercial/pages/AValider.jsx')).toContain("if (!data?.length) { toast.error('Aucune relance validée")
    const inv = plat('src/modules/commercial/pages/Invoices.jsx')
    expect(inv.slice(inv.indexOf("from('invoice_items').delete().eq('invoice_id', iid)"), inv.indexOf("from('invoice_items').delete().eq('invoice_id', iid)") + 120)).toContain('if (de) throw de')
  })

  it("aucune écriture vérifiée n'est suivie de .single() (enregistrer attend une liste)", () => {
    for (const chemin of FICHIERS) {
      expect(plat(chemin)).not.toMatch(/enregistrer(OuLever)?\(supabase\.from\('\w+'\)\.(update|delete)\([^\n]*\.single\(\)/)
    }
  })

  it('les fiches modifiées renvoient toujours une fiche (pas une liste)', () => {
    expect(plat('src/modules/commercial/components/AffairesClient.jsx')).toContain('onClientChange?.(data[0])')
    expect(plat('src/modules/commercial/pages/ClientDetail.jsx')).toContain("const [data] = await enregistrerOuLever(supabase.from('client_portal_access')")
  })

  it("un ancien contact « documents » ou « facturation » non retiré arrête l'enregistrement", () => {
    const t = plat('src/modules/commercial/pages/ClientDetail.jsx')
    expect(t).toContain("Contact « documents » de")
    expect(t).toContain('Contact de facturation')
  })

  it("le contact principal n'est resynchronisé qu'après une écriture réussie (liste des clients)", () => {
    const t = plat('src/modules/commercial/pages/Clients.jsx')
    for (const ecriture of ["update(contactData).eq('id', id))", "delete().eq('id', c.id))"]) {
      const debut = t.indexOf(ecriture)
      const sync = t.indexOf("client_contact_sync_primary', { p_client_id: selectedClient.id })", debut)
      expect(debut).toBeGreaterThan(0)
      expect(t.slice(debut, sync)).toContain('if (error) return toast.error(')
    }
  })
})

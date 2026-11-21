// Lot fiabilité finance (B118, 21/11) : les écritures du Budget et de l'Espace comptable passent par « enregistrer ».
// Contrôle de source : une mise à jour ou une suppression écrite sans vérification du nombre de lignes
// ferait passer un refus de la règle d'accès pour un succès.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const FICHIERS = [
  'src/modules/finance/pages/BudgetModule.jsx',
  'src/modules/finance/pages/EspaceComptable.jsx',
]

// Écritures volontairement hors « enregistrer », avec leur raison
const EXCEPTIONS = [
  // Justificatifs et convives supprimés avant la transaction : 0 ligne est normal, l'erreur est contrôlée
  { fichier: 'BudgetModule.jsx', motif: "from('budget_receipts').delete().eq('transaction_id', txId)" },
  { fichier: 'BudgetModule.jsx', motif: "from('budget_meal_guests').delete().eq('transaction_id', txId)" },
  // Convives supprimés avant réinsertion : 0 ligne est normal au premier enregistrement, l'erreur est contrôlée
  { fichier: 'BudgetModule.jsx', motif: "from('budget_meal_guests').delete().eq('transaction_id', transactionId)" },
  // Liens détaillés d'un rapprochement : 0 ligne est normal (lien principal seul), l'erreur est contrôlée
  { fichier: 'EspaceComptable.jsx', motif: "from('budget_transaction_invoices').delete().eq('transaction_id', tx.id)" },
  // Retour arrière d'un paiement après un échec : au mieux, l'erreur d'origine est déjà affichée
  { fichier: 'EspaceComptable.jsx', motif: "from('invoice_payments').delete().eq('id', createdPaymentId)" },
]

const plat = (chemin) => readFileSync(chemin, 'utf8').replace(/\)\s*\n\s*\./g, ').').replace(/supabase\s*\n\s*\.from/g, 'supabase.from')

describe('écritures du module finance', () => {
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

  it('chaque exception existe encore (sinon la retirer de la liste)', () => {
    for (const e of EXCEPTIONS) {
      const chemin = FICHIERS.find((f) => f.endsWith(e.fichier))
      expect(plat(chemin)).toContain(e.motif)
    }
  })

  it('les suppressions préalables contrôlent leur erreur', () => {
    const b = plat('src/modules/finance/pages/BudgetModule.jsx')
    expect(b).toContain("if (er) { toast.error('Erreur : ' + er.message); return }")
    expect(b).toContain("if (eg) { toast.error('Erreur : ' + eg.message); return }")
    expect(b).toContain('if (delErr) throw delErr')
    const c = plat('src/modules/finance/pages/EspaceComptable.jsx')
    expect(c).toContain('if (liensErr) throw liensErr')
  })

  it('le recalcul d\'une facture lève une erreur si rien n\'est enregistré', () => {
    for (const chemin of FICHIERS) {
      const t = plat(chemin)
      const debut = t.indexOf('async function recomputeInvoiceFromPayments')
      expect(debut).toBeGreaterThan(0)
      expect(t.slice(debut, debut + 1600)).toContain("enregistrerOuLever(supabase.from('invoices')")
    }
  })

  it("l'import par lot note une facture non recalculée sans arrêter l'import", () => {
    const b = plat('src/modules/finance/pages/BudgetModule.jsx')
    expect(b).toContain('catch (e) { errors.push(`Facture ${inv.reference}: ${e.message}`); continue }')
  })

  it('les remises en file d\'envoi refusent un enregistrement partiel', () => {
    const b = plat('src/modules/finance/pages/BudgetModule.jsx')
    expect(b.match(/\.in\('id', ids\), \{ attendu: ids\.length \}\)/g)?.length).toBe(2)
  })
})

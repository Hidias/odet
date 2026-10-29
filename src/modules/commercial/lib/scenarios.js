// Prévisionnel en trois scénarios (0474) : chaque mois, sources (certain, devis en cours, récurrent) pondérées par les
// hypothèses du scénario ; encaissements décalés du délai de paiement (30 jours d'échéance usuelle plus le retard du
// scénario) ; factures déjà émises encaissées à leur échéance plus le retard. Rien n'est estimé sans source.
// Encaissements et charges sont en TTC (flux bancaires) ; le chiffre d'affaires reste en HT.

export const SCENARIOS = [['pessimiste', 'Pessimiste'], ['realiste', 'Réaliste'], ['optimiste', 'Optimiste']]
export const ECHEANCE_USUELLE_J = 30

const pct = (h, cle, s) => Number(h?.[cle]?.[s] ?? 0) / 100
const decalageMois = (jours) => Math.max(0, Math.round(Number(jours || 0) / 30))
const r2 = (n) => Math.round(n * 100) / 100

export function calculerScenarios(data) {
  const mois = data?.mois || []
  const h = data?.hypotheses || {}
  const charges = data?.charges_mensuelles == null ? null : Number(data.charges_mensuelles)
  const ouvertes = data?.encaissements?.factures_ouvertes || []
  // Encaissements en TTC : chiffre d'affaires HT × rapport TTC / HT constaté ; sans historique, laissé HT (signalé)
  const ratio = data?.historique?.ratio_ttc == null ? null : Number(data.historique.ratio_ttc)
  const lignes = mois.map((m) => {
    const ca = Object.fromEntries(SCENARIOS.map(([s]) => [s, r2(Number(m.certain || 0) * pct(h, 'certain', s) + Number(m.devis || 0) * pct(h, 'devis', s) + Number(m.recurrent || 0) * pct(h, 'recurrent', s))]))
    return { mois: m.mois, certain: Number(m.certain || 0), devis: Number(m.devis || 0), recurrent: Number(m.recurrent || 0), ca, visites: Number(m.visites_prevues || 0), realise: m.realise == null ? null : Number(m.realise), encaissement: { pessimiste: 0, realiste: 0, optimiste: 0 } }
  })
  const index = Object.fromEntries(lignes.map((l, i) => [String(l.mois).slice(0, 7), i]))
  for (const [s] of SCENARIOS) {
    const retard = Number(h?.retard_paiement_j?.[s] ?? 0)
    const dec = decalageMois(ECHEANCE_USUELLE_J + retard)
    lignes.forEach((l, i) => { if (i + dec < lignes.length) lignes[i + dec].encaissement[s] += l.ca[s] * (ratio ?? 1) })
    for (const f of ouvertes) {
      const i = index[String(f.mois).slice(0, 7)]
      if (i == null) continue
      const j = Math.min(lignes.length - 1, i + decalageMois(retard))
      lignes[j].encaissement[s] += Number(f.montant || 0)
    }
  }
  for (const l of lignes) {
    for (const [s] of SCENARIOS) l.encaissement[s] = r2(l.encaissement[s])
    l.solde = charges == null ? null : Object.fromEntries(SCENARIOS.map(([s]) => [s, r2(l.encaissement[s] - charges)]))
  }
  const somme = (n) => Object.fromEntries(SCENARIOS.map(([s]) => [s, r2(lignes.slice(0, n).reduce((t, l) => t + l.ca[s], 0))]))
  return { lignes, total12: somme(12), total36: somme(36), charges, ratioTtc: ratio, heuresParVisite: Number(data?.historique?.heures_par_visite || 0) }
}

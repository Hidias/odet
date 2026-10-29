// Bilan annuel d'un client sous contrat (0472, décisions du 27/10 § 8.2) : visites des 12 derniers mois et leurs
// résultats, appareils remplacés, vérifications et fins de vie à venir, échéances du contrat, budget à prévoir.
// Les montants de remplacement viennent du prix de vente actuel de l'article du stock relié au type d'appareil ;
// sans article relié, le montant n'est pas estimé (rien d'inventé).
import { jsPDF } from 'jspdf'
import 'jspdf-autotable'
import { startDocument, numberPages } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { orgHorsFormation } from '../../../core/org/orgUtils'
import { endOfLife, summarize, frShort } from '../lib/schedule'

const euros = (n) => `${Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € HT`
const moisDe = (iso) => new Date(`${String(iso).slice(0, 7)}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

/**
 * Données du bilan, calculées sans PDF (testables).
 * equipment : appareils du client (avec itv_equipment_types) ; visits : visites terminées (avec items) ;
 * types : types d'appareil (lifespan_years) ; prixType : { type_id: prix de vente HT } ; echeances : échéances à venir.
 */
export function donneesBilan({ equipment = [], visits = [], types = [], prixType = {}, echeances = [], today = new Date() }) {
  const iso = (d) => d.toISOString().slice(0, 10)
  const debut = new Date(today); debut.setFullYear(debut.getFullYear() - 1)
  const fin = new Date(today); fin.setFullYear(fin.getFullYear() + 1)
  const anneeProchaine = today.getFullYear() + 1
  const typesById = Object.fromEntries(types.map((t) => [t.id, t]))
  const recentes = visits.filter((v) => v.status === 'terminee' && (v.started_at || v.planned_on || '').slice(0, 10) >= iso(debut))
    .sort((a, b) => String(a.started_at || a.planned_on).localeCompare(String(b.started_at || b.planned_on)))
  const parVisite = recentes.map((v) => ({ date: (v.started_at || v.planned_on || '').slice(0, 10), site: v.sites?.name || '', ...summarize(v.items || []) }))
  const remplaces = recentes.reduce((n, v) => n + (v.items || []).filter((i) => i.result === 'remplace').length, 0)
  const actifs = equipment.filter((e) => e.status !== 'retire')
  const aVerifier = {}
  // Échéance déjà passée : comptée à part (« en retard »), jamais parmi les vérifications à venir
  const enRetard = actifs.filter((e) => e.next_check_on && e.next_check_on < iso(today)).length
  for (const e of actifs) {
    if (!e.next_check_on || e.next_check_on < iso(today) || e.next_check_on > iso(fin)) continue
    const m = e.next_check_on.slice(0, 7)
    aVerifier[m] = (aVerifier[m] || 0) + 1
  }
  const finsDeVie = {}
  for (const e of actifs) {
    const eol = endOfLife(typesById[e.type_id] || e.itv_equipment_types, e, anneeProchaine)
    if (!eol?.reached) continue
    const k = e.type_id
    finsDeVie[k] = finsDeVie[k] || { type: (typesById[k] || e.itv_equipment_types)?.name || 'Appareil', nb: 0, prix: prixType[k] ?? null }
    finsDeVie[k].nb += 1
  }
  const fdv = Object.values(finsDeVie).map((x) => ({ ...x, total: x.prix == null ? null : Math.round(x.nb * x.prix * 100) / 100 }))
  const contrat = echeances.filter((e) => e.status !== 'annulee' && e.due_on >= iso(today) && e.due_on <= iso(fin)).reduce((s, e) => s + Number(e.amount_ht || 0), 0)
  const remplacement = fdv.reduce((s, x) => s + (x.total || 0), 0)
  return {
    visites: parVisite, remplaces, appareils: actifs.length, enRetard,
    aVerifier: Object.entries(aVerifier).sort(([a], [b]) => a.localeCompare(b)).map(([mois, nb]) => ({ mois, nb })),
    finsDeVie: fdv, anneeProchaine,
    budget: { contrat: Math.round(contrat * 100) / 100, remplacement: Math.round(remplacement * 100) / 100, nonEstimes: fdv.filter((x) => x.total == null).reduce((n, x) => n + x.nb, 0) },
  }
}

export async function buildBilanPDF({ client, contract, data, org = null }) {
  const ORG = orgHorsFormation(org || await loadPdfOrg())
  const doc = new jsPDF({ compress: true })
  const annee = new Date().getFullYear()
  const f = startDocument(doc, ORG, { ref: contract?.reference || null, docLabel: 'Bilan annuel', code: 'BIL', title: `Bilan annuel ${annee}`, subtitle: contract?.label || 'Maintenance du matériel de sécurité' })
  f.cards([{ label: 'Client', lines: [client?.name || '', client?.address || '', [client?.postal_code, client?.city].filter(Boolean).join(' ')].filter(Boolean) }])
  f.para(`Voici le point sur votre matériel de sécurité : ${data.appareils} appareil${data.appareils > 1 ? 's' : ''} suivi${data.appareils > 1 ? 's' : ''}, les visites des douze derniers mois et ce qui est à prévoir pour l'année qui vient.`, { after: 3 })

  f.section('Visites des douze derniers mois')
  if (data.visites.length) {
    f.table(['Date', 'Site', 'Appareils', 'Conformes', 'À remplacer', 'Remplacés'],
      data.visites.map((v) => [frShort(v.date), v.site, String(v.total), String(v.conforme), String(v.a_remplacer), String(v.remplace)]),
      { columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } } })
  } else f.para('Aucune visite terminée sur la période.')
  if (data.remplaces) f.para(`${data.remplaces} appareil${data.remplaces > 1 ? 's' : ''} remplacé${data.remplaces > 1 ? 's' : ''} pendant les visites.`, { size: 8.5 })

  f.section('Vérifications à venir')
  if (data.enRetard) f.para(`${data.enRetard} appareil${data.enRetard > 1 ? 's ont' : ' a'} dépassé la date de vérification : à prévoir dès que possible.`)
  if (data.aVerifier.length) f.table(['Mois', 'Appareils à vérifier'], data.aVerifier.map((x) => [moisDe(x.mois), String(x.nb)]), { columnStyles: { 1: { halign: 'right', cellWidth: 40 } } })
  else f.para('Aucune vérification prévue dans les douze prochains mois.')

  f.section(`Appareils en fin de vie en ${data.anneeProchaine}`)
  if (data.finsDeVie.length) {
    f.table(['Matériel', 'Nombre', 'Prix unitaire', 'Total'], data.finsDeVie.map((x) => [x.type, String(x.nb), x.prix == null ? 'sur devis' : euros(x.prix), x.total == null ? 'sur devis' : euros(x.total)]),
      { columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } } })
  } else f.para('Aucun appareil n\'atteint sa durée de vie l\'an prochain.')

  f.section('Budget à prévoir sur douze mois')
  f.kv([
    ['Contrat de maintenance', data.budget.contrat ? euros(data.budget.contrat) : 'selon le contrat'],
    ['Remplacements en fin de vie', data.budget.remplacement ? `${euros(data.budget.remplacement)}${data.budget.nonEstimes ? `, plus ${data.budget.nonEstimes} appareil${data.budget.nonEstimes > 1 ? 's' : ''} sur devis` : ''}` : data.budget.nonEstimes ? 'sur devis' : 'aucun'],
  ], { labelW: 60 })
  f.para('Montants indicatifs, aux prix actuels : un devis vous est remis avant tout remplacement. Les pièces et recharges constatées lors des visites s\'ajoutent selon les conditions de votre contrat.', { size: 8.5, after: 6 })
  f.signOff()
  numberPages(doc, ORG)
  return { doc, filename: `Bilan_annuel_${annee}_${(client?.name || 'client').replace(/[^A-Za-z0-9]+/g, '_')}.pdf` }
}

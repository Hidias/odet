// Manager, emprunts (0220). L'échéancier a une seule source : le tableau de la banque importé (relu avant
// enregistrement), sinon le calcul de la base (loan_calculer), marqué « calculé ». Aucune échéance ne se saisit à la main.

import * as XLSX from 'xlsx-js-style'
import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'

const must = ({ data, error }) => { if (error) throw error; return data }

export const NATURES = {
  amortissable: 'Prêt amortissable', in_fine: 'Prêt in fine', pge: 'Prêt garanti par l\'État', credit_bail: 'Crédit-bail',
  loa: 'Location avec option d\'achat', lld: 'Location longue durée', compte_courant: 'Compte courant d\'associé',
}
export const PERIODICITES = { mensuelle: 'Mensuelle', trimestrielle: 'Trimestrielle', semestrielle: 'Semestrielle', annuelle: 'Annuelle' }
export const DIFFERES = { aucun: 'Aucun', partiel: 'Partiel (intérêts seuls)', total: 'Total (intérêts ajoutés au capital)' }
export const STATUTS = { en_cours: 'En cours', solde: 'Soldé', rembourse_anticipe: 'Remboursé par anticipation' }
export const EVENEMENTS = { remboursement_anticipe: 'Remboursement anticipé', taux: 'Changement de taux', renegociation: 'Renégociation', report: 'Report d\'échéances' }

export const euros = (n) => (n == null ? '' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }))
export const nombre = (v) => {
  if (v === '' || v == null) return null
  if (typeof v === 'number') return v
  const n = Number(String(v).replace(/\s| |€/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export const chargerEmprunts = async () => must(await supabase.from('loans').select('*').order('created_at'))
export const chargerSyntheses = async () => must(await supabase.from('v_loans_summary').select('*'))
export const chargerEcheancier = async (loanId) => must(await fetchAll(() => supabase.from('loan_schedule_lines').select('*').eq('loan_id', loanId).order('number')))
export const chargerToutesEcheances = async () => must(await fetchAll(() => supabase.from('loan_schedule_lines').select('loan_id, due_on, payment, interest, remaining').order('due_on')))
export const chargerEvenements = async (loanId) => must(await supabase.from('loan_events').select('*').eq('loan_id', loanId).order('happened_on'))

const CHAMPS_NOMBRE = ['principal', 'rate_nominal', 'taeg', 'duration_months', 'deferral_months', 'insurance_per_term', 'fees']
export async function enregistrerEmprunt(e) {
  const { id, created_at: _c, updated_at: _u, created_by: _b, company_id: _co, schedule_source: _s, ...reste } = e
  for (const k of Object.keys(reste)) if (typeof reste[k] === 'string') reste[k] = reste[k].trim() || null
  for (const k of CHAMPS_NOMBRE) if (k in reste) reste[k] = nombre(reste[k])
  if (reste.deferral_months == null) reste.deferral_months = 0
  if (reste.insurance_per_term == null) reste.insurance_per_term = 0
  if (reste.rate_nominal == null) reste.rate_nominal = 0
  if (id) return must(await supabase.from('loans').update(reste).eq('id', id).select('id, schedule_source').single())
  return must(await supabase.from('loans').insert(reste).select('id, schedule_source').single())
}
export const supprimerEmprunt = async (id) => must(await supabase.from('loans').delete().eq('id', id))
export const calculer = async (id) => must(await supabase.rpc('loan_calculer', { p_loan: id }))
export const importer = async (id, lignes) => must(await supabase.rpc('loan_importer', { p_loan: id, p_lignes: lignes }))
export const propositions = async (id) => must(await supabase.rpc('loan_propositions', { p_loan: id }))
export const rapprocher = async (lineId, transactionId, ecart = null) => must(await supabase.from('loan_schedule_lines')
  .update({ transaction_id: transactionId, gap: ecart }).eq('id', lineId))
export async function ajouterEvenement(ev) {
  return must(await supabase.from('loan_events').insert({ ...ev, amount: nombre(ev.amount), new_rate: nombre(ev.new_rate), note: ev.note?.trim() || null }))
}
export const supprimerEvenement = async (id) => must(await supabase.from('loan_events').delete().eq('id', id))

// ─── Lecture du tableau d'amortissement de la banque (Excel ou CSV) ───
const sansAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const COLONNES = [
  ['remaining', /(restant|capital du|crd|solde)/],
  ['interest', /interet/],
  ['insurance', /assurance/],
  ['principal', /(amortissement|capital rembourse|^capital$|part capital|capital amorti)/],
  ['due_on', /(date)/],
  ['payment', /(echeance|mensualite|montant|total|annuite)/],
  ['number', /^(n|no|numero|rang|n°|num)\b/],
]
function versDate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null }
  const m = String(v).trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) { const a = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` }
  const iso = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

/** Lit un fichier et propose les lignes de l'échéancier ; renvoie { lignes, colonnes, alertes } */
export async function lireTableauBanque(fichier) {
  const wb = XLSX.read(await fichier.arrayBuffer(), { type: 'array', cellDates: true, raw: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rangs = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
  let entete = -1
  let carte = {}
  for (let i = 0; i < Math.min(rangs.length, 30); i++) {
    const c = {}
    rangs[i].forEach((cell, j) => {
      const t = sansAccent(cell)
      if (!t) return
      for (const [cle, re] of COLONNES) if (!(cle in c) && re.test(t)) { c[cle] = j; break }
    })
    if ('due_on' in c && ('remaining' in c || 'payment' in c)) { entete = i; carte = c; break }
  }
  if (entete < 0) throw new Error('Colonnes introuvables : le tableau doit avoir au moins une colonne « Date » et « Échéance » ou « Capital restant dû »')
  const lignes = []
  for (const r of rangs.slice(entete + 1)) {
    const due = versDate(r[carte.due_on])
    if (!due) continue
    const l = {
      due_on: due,
      payment: nombre(r[carte.payment]),
      interest: nombre(r[carte.interest]) ?? 0,
      principal: nombre(r[carte.principal]) ?? 0,
      insurance: nombre(r[carte.insurance]) ?? 0,
      remaining: nombre(r[carte.remaining]),
    }
    if (l.payment == null) l.payment = Math.round((l.interest + l.principal + l.insurance) * 100) / 100
    if (l.remaining == null) continue
    lignes.push({ number: lignes.length + 1, ...l })
  }
  const alertes = []
  if (!('principal' in carte)) alertes.push('Pas de colonne de capital remboursé : la part de capital est laissée à zéro.')
  if (!('interest' in carte)) alertes.push('Pas de colonne d\'intérêts : les intérêts sont laissés à zéro.')
  if (!lignes.length) throw new Error('Aucune échéance lue dans le fichier')
  return { lignes, colonnes: Object.keys(carte), alertes }
}

/** Capital restant dû total à la fin de chaque mois (pour la courbe), à partir des échéanciers */
export function courbeRestant(emprunts, echeances, mois = 60) {
  const parPret = {}
  for (const e of echeances) (parPret[e.loan_id] ||= []).push(e)
  const debut = new Date(); debut.setDate(1)
  const points = []
  for (let k = 0; k <= mois; k++) {
    const fin = new Date(debut.getFullYear(), debut.getMonth() + k + 1, 0)
    const iso = fin.toISOString().slice(0, 10)
    let total = 0
    for (const l of emprunts) {
      const lignes = parPret[l.id] || []
      if (!lignes.length) continue
      const passees = lignes.filter((x) => x.due_on <= iso)
      total += passees.length ? Number(passees[passees.length - 1].remaining) : Number(l.principal)
    }
    points.push({ mois: fin.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }), restant: Math.round(total) })
    if (total <= 0 && k > 0) break
  }
  return points
}

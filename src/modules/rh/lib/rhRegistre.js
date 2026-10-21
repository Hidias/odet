// Module RH, registre unique du personnel et éléments variables de paie (chantier 12, 0313).
//   - Registre (L1221-13 et D1221-23 du Code du travail) : une ligne par contrat, dans l'ordre des embauches, généré
//     depuis les fiches et les contrats. Conservé 5 ans après le départ du salarié (L1221-13).
//   - Éléments variables du mois : absences validées (jours ouvrés du mois, hors jours fériés non travaillés) et heures
//     supplémentaires validées (semaines commencées dans le mois, 25 % puis 50 %), à transmettre au logiciel de paie.
//     L'outil ne calcule pas la paie.

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import * as XLSX from 'xlsx-js-style'
import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'
import { startDocument, numberPages } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { orgHorsFormation } from '../../../core/org/orgUtils'
import { appName } from '../../../core/org/currentOrg'
import { CONTRATS, joursOuvres, nomComplet, chargerFeries, feriesNonTravailles } from './rhData'

const must = ({ data, error }) => { if (error) throw error; return data }
const frDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')

/** Mentions du registre pour un contrat (D1221-23, 9° à 13°) */
export function mentionsContrat(c) {
  const m = []
  if (c.contract_type === 'cdd') m.push('Contrat à durée déterminée')
  if (c.contract_type === 'interim') m.push(`Salarié temporaire${c.agency_name ? ` (${[c.agency_name, c.agency_address].filter(Boolean).join(', ')})` : ''}`)
  if (c.contract_type === 'apprentissage') m.push('Apprenti')
  if (c.contract_type === 'professionnalisation') m.push('Contrat de professionnalisation')
  if (c.contract_type === 'stage') m.push('Stagiaire')
  if (c.contract_type !== 'interim' && c.agency_name) m.push(`Mis à disposition par ${[c.agency_name, c.agency_address].filter(Boolean).join(', ')}`)
  if (c.weekly_hours && Number(c.weekly_hours) < 35 && !c.days_per_year) m.push('Salarié à temps partiel')
  if (!m.length) m.push(CONTRATS[c.contract_type] || 'CDI')
  return m.join(' ; ')
}

/** Lignes du registre : contrats de la société dans l'ordre des embauches (stagiaires à part, L1221-13) */
export async function chargerRegistre() {
  const rows = must(await fetchAll(() => supabase.from('hr_employments')
    .select('*, hr_people!hr_employments_person_id_fkey(first_name, last_name, usage_name, birth_date, nationality, gender, work_permit_type, work_permit_ref)')
    .order('start_on').order('created_at')))
  return rows.filter((r) => r.hr_people)
}

export function lignesRegistre(rows) {
  return rows.map((c, i) => {
    const p = c.hr_people
    return {
      numero: i + 1,
      nom: [p.last_name?.toUpperCase(), p.usage_name && p.usage_name !== p.last_name ? `(${p.usage_name})` : null, p.first_name].filter(Boolean).join(' '),
      nationalite: p.nationality || '',
      naissance: frDate(p.birth_date),
      sexe: p.gender || '',
      emploi: [c.job_title, c.qualification].filter(Boolean).join(', '),
      entree: frDate(c.start_on),
      sortie: frDate(c.end_on),
      contrat: mentionsContrat(c),
      autorisation: [p.work_permit_type, p.work_permit_ref].filter(Boolean).join(' n° ') + (c.authorization_on ? `${p.work_permit_type ? ' ; ' : ''}autorisation du ${frDate(c.authorization_on)}` : ''),
      stagiaire: c.contract_type === 'stage',
      incomplet: !p.nationality || !p.gender || !p.birth_date || !c.job_title,
    }
  })
}

export async function telechargerRegistrePDF(rows, { enregistrer = true } = {}) {
  const ORG = orgHorsFormation(await loadPdfOrg(true))
  const doc = new jsPDF({ orientation: 'landscape', compress: true })
  const f = startDocument(doc, ORG, {
    docLabel: 'Registre unique du personnel', code: 'RUP',
    title: 'Registre unique du personnel', subtitle: `Articles L1221-13 et D1221-23 du Code du travail, édité le ${new Date().toLocaleDateString('fr-FR')}`,
  })
  const tete = ['N°', 'Nom et prénoms', 'Nationalité', 'Né(e) le', 'Sexe', 'Emploi et qualification', 'Entrée', 'Sortie', 'Contrat', 'Autorisation']
  const ligne = (r) => [String(r.numero), r.nom, r.nationalite, r.naissance, r.sexe, r.emploi, r.entree, r.sortie, r.contrat, r.autorisation]
  const salaries = rows.filter((r) => !r.stagiaire)
  const stagiaires = rows.filter((r) => r.stagiaire)
  f.section('Salariés, dans l\'ordre des embauches')
  if (salaries.length) f.table(tete, salaries.map(ligne), { styles: { fontSize: 7.5 }, columnStyles: { 0: { cellWidth: 9 }, 4: { cellWidth: 11 } } })
  else f.para('Aucun salarié.')
  if (stagiaires.length) {
    f.section('Stagiaires (partie distincte, L1221-13)')
    f.table(tete, stagiaires.map(ligne), { styles: { fontSize: 7.5 }, columnStyles: { 0: { cellWidth: 9 }, 4: { cellWidth: 11 } } })
  }
  f.note(`Les mentions sont tenues de façon indélébile et conservées 5 ans à compter du départ du salarié. Registre établi à partir des fiches du personnel et des contrats enregistrés dans ${appName() || "l'outil de gestion"}.`)
  f.finish()
  numberPages(doc, ORG)
  if (enregistrer) doc.save(`registre-unique-du-personnel-${new Date().toISOString().slice(0, 10)}.pdf`)
  return doc
}

// ─── Éléments variables du mois ───

const finDuMois = (annee, mois) => new Date(Date.UTC(annee, mois, 0)).toISOString().slice(0, 10)

/** Absences validées et heures supplémentaires validées d'un mois, par personne */
export async function chargerVariablesMois(annee, mois) {
  const debut = `${annee}-${String(mois).padStart(2, '0')}-01`
  const fin = finDuMois(annee, mois)
  const [absences, semaines, feries, annuaire] = await Promise.all([
    fetchAll(() => supabase.from('hr_absence_requests').select('person_id, start_on, start_half, end_on, end_half, hr_absence_types(label, code, category)')
      .eq('status', 'validee').lte('start_on', fin).gte('end_on', debut)).then(must),
    fetchAll(() => supabase.from('hr_timesheets').select('person_id, week_start, total_minutes, contract_minutes, overtime_minutes')
      .eq('status', 'validee').gte('week_start', debut).lte('week_start', fin)).then(must),
    chargerFeries(),
    fetchAll(() => supabase.from('v_hr_annuaire').select('id, first_name, last_name, usage_name')).then(must),
  ])
  const off = feriesNonTravailles(feries)
  const noms = Object.fromEntries((annuaire || []).map((p) => [p.id, nomComplet(p)]))
  const parPersonne = {}
  const ligne = (id) => (parPersonne[id] ||= { personId: id, nom: noms[id] || 'Personne', absences: {}, sup25: 0, sup50: 0, semaines: 0 })
  for (const a of absences || []) {
    // Partie de l'absence comprise dans le mois ; les demi-journées ne comptent qu'au premier et au dernier jour réels
    const d = a.start_on < debut ? debut : a.start_on
    const f = a.end_on > fin ? fin : a.end_on
    const n = joursOuvres(d, d === a.start_on && a.start_half === 'apres_midi', f, f === a.end_on && a.end_half === 'matin', off)
    if (!n) continue
    const l = ligne(a.person_id)
    const type = a.hr_absence_types?.label || 'Absence'
    l.absences[type] = (l.absences[type] || 0) + n
  }
  for (const s of semaines || []) {
    const l = ligne(s.person_id)
    const sup = Math.max(0, Number(s.overtime_minutes) || 0)
    l.sup25 += Math.min(sup, 8 * 60)
    l.sup50 += Math.max(0, sup - 8 * 60)
    l.semaines += 1
  }
  return Object.values(parPersonne).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
}

const heuresDecimales = (min) => Math.round((min / 60) * 100) / 100

export function telechargerVariablesExcel(lignes, annee, mois) {
  const types = [...new Set(lignes.flatMap((l) => Object.keys(l.absences)))].sort()
  const tete = ['Salarié', ...types.map((t) => `${t} (jours)`), 'Heures sup. 25 % (h)', 'Heures sup. 50 % (h)', 'Semaines validées']
  const corps = lignes.map((l) => [l.nom, ...types.map((t) => l.absences[t] || 0), heuresDecimales(l.sup25), heuresDecimales(l.sup50), l.semaines])
  const ws = XLSX.utils.aoa_to_sheet([tete, ...corps])
  ws['!cols'] = tete.map((t, i) => ({ wch: i === 0 ? 28 : Math.max(12, t.length + 2) }))
  for (let c = 0; c < tete.length; c += 1) {
    const ref = XLSX.utils.encode_cell({ r: 0, c })
    if (ws[ref]) ws[ref].s = { font: { bold: true }, fill: { fgColor: { rgb: 'EEEEEE' } }, alignment: { wrapText: true, vertical: 'center' } }
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `${String(mois).padStart(2, '0')}-${annee}`)
  XLSX.writeFile(wb, `elements-variables-paie-${annee}-${String(mois).padStart(2, '0')}.xlsx`)
}

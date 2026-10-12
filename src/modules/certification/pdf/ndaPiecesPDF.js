// Pièces du dossier de déclaration d'activité générées depuis les données (article R6351-5, 5°) :
// 1. contenu des actions, organisation, moyens techniques et pédagogiques ;
// 2. liste des intervenants avec leurs titres et qualités, lien avec la prestation et lien contractuel.
// Mise en page commune (core/pdf/layout.js). Identité lue dans organization_settings.

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { supabase } from '../../../core/supabase'
import { startDocument, numberPages } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'

const strip = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/[\u2013\u2014]/g, '-').replace(/\n{3,}/g, '\n\n').trim()
const hours = (h) => (Number(h) > 0 ? `${String(Number(h)).replace('.', ',')} h` : '')

async function loadData() {
  const [courses, equipment, sites, trainers] = await Promise.all([
    supabase.from('courses').select('title, code, objectives, prerequisites, target_audience, duration_hours, duration_days, teaching_methods, pedagogical_methods, methods, evaluation_methods, materials, material, content, program').order('title'),
    supabase.from('equipment_catalog').select('name, theme, quantity').order('theme'),
    supabase.from('sites').select('name, kind, address, postal_code, city, capacity, is_active').eq('is_active', true),
    supabase.from('trainers').select('first_name, last_name, specialties, qualifications_list, certifications, qualifications, is_internal').order('last_name'),
  ])
  return { courses: courses.data || [], equipment: equipment.data || [], sites: sites.data || [], trainers: trainers.data || [] }
}

export async function buildNdaProgrammePDF() {
  const [ORG, d] = await Promise.all([loadPdfOrg(true), loadData()])
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, {
    docLabel: 'Déclaration d\'activité', code: 'NDA-PROG',
    title: 'Contenu des actions, organisation et moyens', subtitle: `Pièce jointe à la déclaration d'activité, ${format(new Date(), 'd MMMM yyyy', { locale: fr })}`,
  })
  f.section('Actions de formation proposées')
  if (!d.courses.length) f.para('Aucune formation au catalogue.')
  for (const c of d.courses) {
    f.ensure(30)
    f.para(c.title || '', { size: 10.5, style: 'bold', after: 1.5 })
    f.kv([
      ['Durée', [hours(c.duration_hours), c.duration_days ? `${c.duration_days} jour${c.duration_days > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ') || null],
      ['Public', strip(c.target_audience) || null],
      ['Prérequis', strip(c.prerequisites) || null],
      ['Méthodes', strip(c.pedagogical_methods || c.teaching_methods || c.methods) || null],
      ['Évaluation', strip(c.evaluation_methods) || null],
    ].filter((r) => r[1]), { labelW: 28 })
    if (strip(c.objectives)) { f.para('Objectifs', { style: 'bold', size: 9, after: 1 }); f.para(strip(c.objectives)) }
    const prog = strip(c.content || c.program)
    if (prog) { f.para('Contenu', { style: 'bold', size: 9, after: 1 }); f.para(prog.length > 1800 ? prog.substring(0, 1800) + ' [...]' : prog) }
    f.space(3)
  }
  f.section('Organisation')
  f.para('Les formations sont réalisées en présentiel, en entreprise (intra) ou en salle (inter), par groupes. Chaque action fait l\'objet d\'une convention ou d\'un contrat, d\'une convocation, d\'une feuille d\'émargement par demi-journée, d\'une évaluation des acquis et d\'un questionnaire de satisfaction.')
  if (d.sites.length) {
    f.section('Lieux de formation')
    f.table(['Lieu', 'Adresse', 'Capacité'], d.sites.map((s) => [s.name || '', [s.address, s.postal_code, s.city].filter(Boolean).join(' '), s.capacity ? String(s.capacity) : '-']), { columnStyles: { 2: { cellWidth: 22, halign: 'center' } } })
  }
  f.section('Moyens techniques et pédagogiques')
  if (d.equipment.length) {
    f.table(['Matériel', 'Thème', 'Quantité'], d.equipment.map((e) => [e.name || '', e.theme || '', e.quantity != null ? String(e.quantity) : '-']), { columnStyles: { 2: { cellWidth: 22, halign: 'center' } } })
  } else f.para('Inventaire du matériel à compléter.')
  f.finish()
  numberPages(doc, ORG)
  return { doc, filename: `Declaration_activite_programme_moyens_${format(new Date(), 'yyyy-MM-dd')}.pdf` }
}

export async function buildNdaIntervenantsPDF() {
  const [ORG, d] = await Promise.all([loadPdfOrg(true), loadData()])
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, {
    docLabel: 'Déclaration d\'activité', code: 'NDA-INTER',
    title: 'Liste des intervenants', subtitle: `Titres et qualités, lien avec les prestations, lien contractuel, ${format(new Date(), 'd MMMM yyyy', { locale: fr })}`,
  })
  if (!d.trainers.length) f.para('Aucun formateur enregistré.')
  else {
    f.table(['Intervenant', 'Titres et qualités', 'Formations assurées', 'Lien contractuel'], d.trainers.map((t) => [
      [t.first_name, (t.last_name || '').toUpperCase()].filter(Boolean).join(' '),
      [...(t.qualifications_list || []), strip(t.certifications), strip(t.qualifications)].filter(Boolean).join(', ') || 'À compléter',
      strip(t.specialties) || '-',
      t.is_internal === false ? 'Prestataire (contrat de sous-traitance)' : 'Intervenant interne',
    ]), { columnStyles: { 0: { cellWidth: 36, fontStyle: 'bold' }, 3: { cellWidth: 38 } } })
  }
  f.space(3)
  f.note('Les justificatifs (diplômes, certificats de formateur, contrats) sont tenus à la disposition de l\'administration.')
  f.finish()
  numberPages(doc, ORG)
  return { doc, filename: `Declaration_activite_intervenants_${format(new Date(), 'yyyy-MM-dd')}.pdf` }
}

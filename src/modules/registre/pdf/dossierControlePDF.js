// Dossier de contrôle du registre de sécurité (fonction 11, 0140) : synthèse en PDF pour un site (ou tous), à
// présenter en cas de contrôle. Mise en page commune (core/pdf/layout.js). Des faits datés et des échéances, jamais
// une note de conformité ; le registre alimente les registres légaux, il ne les remplace pas.

import { orgHorsFormation } from '../../../core/org/orgUtils'
import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { startDocument } from '../../../core/pdf/layout'

const fr = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('fr-FR') : '')
const ETATS = { a_jour: 'À jour', a_prevoir: 'À prévoir', manquant: 'Manquant', depasse: 'Dépassé' }

/**
 * @param {object} ORG identité (loadPdfOrg ou ent_org préparé)
 * @param {object} r données du registre (ent_registre ou registre_client)
 * @returns jsPDF
 */
export function buildDossierControlePDF(ORGsource, r) {
  const ORG = orgHorsFormation(ORGsource)
  const doc = new jsPDF({ compress: true })
  const site = r.site ? (r.sites || []).find((s) => s.id === r.site) : null
  const f = startDocument(doc, ORG, {
    docLabel: 'Registre de sécurité', code: 'REG-SECU',
    title: 'Dossier de contrôle', subtitle: [r.client?.name, site ? `Site ${site.name}` : 'Tous les sites', `État au ${fr(new Date())}`].filter(Boolean).join('  ·  '),
  })

  f.section('1. Pièces à présenter')
  f.table(['Pièce', 'Référence', 'État'], (r.dossier || []).map((p) => [p.piece, p.ref || '', ETATS[p.etat] || p.etat]),
    { columnStyles: { 1: { cellWidth: 40 }, 2: { cellWidth: 26 } } })

  f.section('2. Vérifications du matériel de sécurité')
  if ((r.verifications || []).length) {
    f.table(['Date', 'Référence', 'Site', 'Appareils', 'Conformes', 'À remplacer'],
      r.verifications.map((v) => [fr(v.date), v.reference || '', v.site || '', String(v.appareils), String(v.conformes), String(v.a_remplacer)]),
      { columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } } })
  } else f.note('Aucune vérification enregistrée par l\'organisme. Les rapports d\'un autre prestataire se déposent dans les documents.')
  if (r.parc?.appareils) f.note(`Parc suivi : ${r.parc.appareils} appareil(s), prochaine vérification ${fr(r.parc.prochaine_verification) || 'à planifier'}${r.parc.en_retard ? `, ${r.parc.en_retard} en retard` : ''}.`)

  f.section('3. Exercices et essais (R4227-39 : au moins tous les six mois)')
  if ((r.exercices || []).length) {
    f.table(['Date', 'Exercice ou essai', 'Fait par', 'Participants', 'Observations'],
      r.exercices.map((e) => [fr(e.done_on), e.label, e.done_by || '', e.participants != null ? String(e.participants) : '', e.observations || '']),
      { columnStyles: { 0: { cellWidth: 22 }, 3: { halign: 'right', cellWidth: 22 } } })
  } else f.note('Aucun exercice enregistré.')

  f.section('4. Personnel formé')
  const lignes = []
  ;(r.personnel || []).forEach((p) => (p.validites || []).forEach((v) => lignes.push([
    `${(p.last_name || '').toUpperCase()} ${p.first_name || ''}`.trim(), p.job_title || '', v.label, fr(v.valide_le), v.echeance ? fr(v.echeance) : 'Sans échéance', ETATS[v.statut] || '',
  ])))
  if (lignes.length) f.table(['Salarié', 'Fonction', 'Formation', 'Validée le', 'Échéance', 'État'], lignes)
  else f.note('Aucune formation enregistrée pour le personnel.')

  f.section('5. Échéances')
  const ech = (r.echeances || []).filter((e) => e.status !== 'a_jour')
  if (ech.length) f.table(['Échéance', 'Obligation', 'Objet', 'Site', 'État'], ech.map((e) => [fr(e.due_on), e.label || '', e.objet || '', e.site || '', ETATS[e.status] || e.status]))
  else f.note('Aucune échéance dépassée ou à prévoir.')

  f.section('6. Documents déposés')
  if ((r.documents || []).length) f.table(['Document', 'Date', 'Valable jusqu\'au', 'Déposé par'], r.documents.map((d) => [d.title, fr(d.issued_on), fr(d.valid_until), d.source === 'entreprise' ? 'Entreprise' : 'Organisme']))
  else f.note('Aucun document déposé.')
  if (r.duerp) f.note(`Document unique : ${r.duerp.reference || ''} version ${r.duerp.version || 1}${r.duerp.date_prochaine_maj ? `, mise à jour prévue le ${fr(r.duerp.date_prochaine_maj)}` : ''}.`)

  f.space(3)
  f.note('Les exercices et essais déclarés par l\'entreprise restent sous sa responsabilité. Ce dossier rassemble les éléments enregistrés ; il ne remplace pas les registres légaux tant que leur tenue sur support informatique n\'est pas confirmée (code du travail, L8113-6).')
  f.finish()
  return doc
}

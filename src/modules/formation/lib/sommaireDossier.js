// Sommaire du dossier de session (dossier complet en un clic, pour l'OPCO ou l'audit) : identité de la session,
// stagiaires (présence, résultat), pièces du dossier et pièces manquantes, appréciations (évaluation à chaud,
// attentes, ressenti, avis de l'entreprise) et facturation. Placé en tête du ZIP « rempli » (00_Sommaire).

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { supabase } from '../../../core/supabase'
import { startDocument, numberPages } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'

const jj = (d) => (d ? format(new Date(`${String(d).slice(0, 10)}T12:00:00`), 'dd/MM/yyyy') : '')
// Espaces fines insécables remplacées : la police du PDF ne les affiche pas
const euros = (n) => (n == null ? '-' : `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[\u202f\u00a0]/g, ' ')} €`)
const ETATS = { draft: 'Brouillon', sent: 'Envoyée', issued: 'Émise', paid: 'Payée', partial: 'Réglée en partie', partially_paid: 'Réglée en partie', overdue: 'En retard', cancelled: 'Annulée' }
const RESULTATS = { acquis: 'Acquis', acquired: 'Acquis', non_acquis: 'Non acquis', not_acquired: 'Non acquis', en_cours: 'En cours', partiel: 'Partiel' }
const virgule = (n, d = 1) => (n == null || Number.isNaN(n) ? '-' : String(Math.round(n * 10 ** d) / 10 ** d).replace('.', ','))

// Libellés des pièces, d'après le nom du fichier dans le ZIP
const PIECES = [
  [/^Convention_/, 'Convention de formation'],
  [/^Programme_/, 'Programme'],
  [/^Convocations_/, 'Convocations'],
  [/^Fiches_Renseignements_/, 'Fiches de renseignements'],
  [/^Emargement_/, 'Feuille d\'émargement'],
  [/^Eval_Chaud_/, 'Évaluations à chaud'],
  [/^Eval_Froid_/, 'Évaluation à froid (modèle)'],
  [/^Analyse_Besoin_/, 'Analyse du besoin'],
  [/^Certificats_/, 'Certificats de réalisation'],
  [/^Attestations_/, 'Attestations de présence'],
  [/^Test_Positionnement_/, 'Tests de positionnement'],
  [/^Scans\//, 'Document téléversé'],
]
export function libellePiece(nom) {
  const p = PIECES.find(([re]) => re.test(nom))
  return p ? p[1] : 'Document'
}

// Moyenne des notes d'une évaluation à chaud (colonnes q_*, notes de 1 à 5 ; 0 = non concerné)
export function moyenneChaud(evals) {
  const notes = []
  for (const e of evals || []) {
    if (!e.questionnaire_submitted && !e.submitted_at) continue
    for (const [k, v] of Object.entries(e)) if (k.startsWith('q_') && typeof v === 'number' && v >= 1 && v <= 5) notes.push(v)
  }
  return notes.length ? notes.reduce((a, b) => a + b, 0) / notes.length : null
}

// Pièces attendues absentes, d'après la session et les fichiers du ZIP
export function piecesManquantes(session, fichiers, { nbInscrits, nbEvals }) {
  const a = (re) => fichiers.some((f) => re.test(f))
  const manque = []
  if (!session.convention_signed) manque.push('Convention signée par l\'entreprise')
  if (!a(/^Emargement_/)) manque.push('Feuille d\'émargement')
  if (nbInscrits > 0 && nbEvals < nbInscrits) manque.push(`Évaluations à chaud : ${nbEvals} sur ${nbInscrits}`)
  if (!a(/^Certificats_/)) manque.push('Certificats de réalisation (résultats à saisir)')
  if (!a(/^Attestations_/)) manque.push('Attestations de présence')
  return manque
}

export async function sommaireDossier(session, fichiers) {
  const ORG = await loadPdfOrg()
  const sid = session.id
  const [ev, re, av, fa] = await Promise.all([
    supabase.from('trainee_evaluations').select('*').eq('session_id', sid),
    supabase.from('session_ressentis').select('note').eq('session_id', sid),
    supabase.from('client_satisfactions').select('note_globale, recommande, clients(name)').eq('session_id', sid),
    supabase.from('invoices').select('reference, type, invoice_date, total_ttc, amount_paid, status').eq('session_id', sid).order('invoice_date'),
  ])
  const evals = ev.error ? [] : ev.data || []
  const envoyees = evals.filter((e) => e.questionnaire_submitted || e.submitted_at)
  const inscrits = session.session_trainees || []

  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, {
    docLabel: 'Dossier de session', code: `DOSSIER-${session.reference || ''}`,
    title: session.courses?.title || 'Formation',
    subtitle: `Session ${session.reference || ''}, dossier édité le ${format(new Date(), 'd MMMM yyyy', { locale: fr })}`,
  })

  f.section('La session')
  const lieu = [session.location_name, [session.location_postal_code, session.location_city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  f.kv([
    ['Dates', session.start_date === session.end_date || !session.end_date ? jj(session.start_date) : `${jj(session.start_date)} au ${jj(session.end_date)}`],
    ['Durée', session.courses?.duration_hours ? `${virgule(Number(session.courses.duration_hours))} h` : '-'],
    ['Lieu', session.is_remote ? 'À distance' : (lieu || '-')],
    ['Entreprise', session.clients?.name || '-'],
    ['Formateur', session.trainers ? `${session.trainers.first_name || ''} ${session.trainers.last_name || ''}`.trim() : '-'],
    ['Financement', [session.funding_type && session.funding_type !== 'none' ? session.funding_type : null, session.funding_details].filter(Boolean).join(', ') || '-'],
    ['Convention', session.convention_signed ? `Signée${session.convention_signed_date ? ` le ${jj(session.convention_signed_date)}` : ''}` : 'Non signée'],
  ], { labelW: 32 })

  f.section(`Stagiaires (${inscrits.length})`)
  if (inscrits.length) {
    f.table(['Stagiaire', 'Présence', 'Résultat'], inscrits.map((st) => [
      `${(st.trainees?.last_name || '').toUpperCase()} ${st.trainees?.first_name || ''}`.trim(),
      st.absent ? 'Absent' : st.early_departure ? 'Départ anticipé' : st.presence_complete ? 'Complète' : 'À vérifier',
      RESULTATS[st.result] || st.result || '-',
    ]), { columnStyles: { 1: { cellWidth: 34 }, 2: { cellWidth: 34 } } })
  } else f.para('Aucun stagiaire inscrit.')

  f.section('Pièces du dossier')
  const pieces = fichiers.filter((n) => !n.endsWith('/')).sort()
  f.table(['Pièce', 'Fichier'], pieces.map((n) => [libellePiece(n), n]), { columnStyles: { 0: { cellWidth: 62, fontStyle: 'bold' } } })
  const manque = piecesManquantes(session, pieces, { nbInscrits: inscrits.filter((st) => !st.absent).length, nbEvals: envoyees.length })
  if (manque.length) {
    f.para('Pièces manquantes ou incomplètes', { style: 'bold', size: 9, after: 1 })
    f.bullets(manque)
  }

  f.section('Appréciations')
  const moy = moyenneChaud(evals)
  const reco = envoyees.filter((e) => e.would_recommend === true).length
  const att = evals.filter((e) => e.attentes_satisfaites)
  const ress = re.error ? [] : re.data || []
  const avis = av.error ? [] : av.data || []
  const lignes = [
    ['Évaluation à chaud', envoyees.length ? `${envoyees.length} réponse${envoyees.length > 1 ? 's' : ''}, ${virgule(moy)} sur 5, ${reco} recommandation${reco > 1 ? 's' : ''}` : 'Aucune réponse'],
  ]
  if (att.length) {
    const oui = att.filter((e) => e.attentes_satisfaites === 'oui').length
    const part = att.filter((e) => e.attentes_satisfaites === 'en_partie').length
    lignes.push(['Attentes des stagiaires', `${oui} sur ${att.length} satisfaites${part ? `, ${part} en partie` : ''}`])
  }
  if (ress.length) lignes.push(['Ressenti au fil de la formation', `${ress.length} ressenti${ress.length > 1 ? 's' : ''}, ${virgule(ress.reduce((a, r) => a + r.note, 0) / ress.length)} sur 5`])
  for (const a of avis) lignes.push([`Avis de l'entreprise${a.clients?.name ? ` (${a.clients.name})` : ''}`, `${a.note_globale} sur 5${a.recommande === true ? ', recommande la formation' : a.recommande === false ? ', ne la recommande pas' : ''}`])
  f.kv(lignes, { labelW: 62 })

  const factures = fa.error ? [] : fa.data || []
  f.section('Facturation')
  if (factures.length) {
    f.table(['Pièce', 'Date', 'Montant TTC', 'Réglé', 'État'], factures.map((x) => [
      `${x.type === 'credit_note' ? 'Avoir' : 'Facture'} ${x.reference || ''}`, jj(x.invoice_date), euros(x.total_ttc), euros(x.amount_paid), ETATS[x.status] || x.status || '-',
    ]), { columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } } })
  } else f.para('Aucune facture rattachée à la session.')

  f.space(3)
  f.note('Les pièces signées en ligne (convention, émargement) gardent leur preuve dans l\'outil : horodatage, signataire, empreinte du document.')
  f.finish()
  numberPages(doc, ORG)
  return doc.output('blob')
}

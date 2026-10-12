// Documents qualité éditables (organigramme, désignations, procédures, listes de contrôle,
// revue de direction, registres) sur la mise en page commune des documents (core/pdf/layout.js).

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { startDocument, drawPartyCard, PAGE_MARGIN } from '../../../core/pdf/layout'

const PSH_DECISION = { a_analyser: 'À analyser', adapte: 'Adaptée', partiel: 'Partielle', oriente: 'Orientée', refuse: 'Refusée' }
const PSH_STATUT = { open: 'Ouverte', in_review: 'En analyse', awaiting_info: 'Informations manquantes', decided: 'Décidée', implemented: 'Mise en oeuvre', closed: 'Clôturée' }
const STATUTS = { open: 'Ouvert', ouvert: 'Ouvert', in_progress: 'En cours', en_cours: 'En cours', closed: 'Clôturé', cloture: 'Clôturé', cloturee: 'Clôturée', done: 'Fait', resolved: 'Résolu', a_traiter: 'À traiter', traite: 'Traité' }

function signBlock(f, ORG, otherLabel) {
  f.y += 4
  f.ensure(42)
  f.body(9)
  f.doc.text(`Fait à ${ORG.lieu_signature || ORG.city || ''}, le ${format(new Date(), 'dd/MM/yyyy')}, en deux exemplaires.`, f.M, f.y)
  f.y += 4
  f.signatures([
    { label: `Pour ${ORG.name || "l'organisme"}`, name: [ORG.dirigeant, ORG.dirigeant_title].filter(Boolean).join(', '), hint: 'Signature et cachet', stamp: ORG.stamp_base64 },
    { label: otherLabel, hint: 'Nom, signature et cachet' },
  ], { height: 32 })
}

const fmtDate = (d) => { try { return format(new Date(d), 'dd/MM/yyyy') } catch { return '' } }

/**
 * @param {object} ORG identité de l'organisme (pdfOrgFrom / loadPdfOrg)
 * @param {object} p { docId, docInfo: { code, name, indicateur, table }, code (avec initiales), version, data, rddData, registre }
 * @returns {jsPDF}
 */
export function buildQualityDocPDF(ORG, { docId, docInfo, code, version, data = {}, rddData = null, registre = [] }) {
  const doc = new jsPDF({ compress: true })
  const docLabel = 'Système qualité'
  const f = startDocument(doc, ORG, {
    ref: `${code}-V${version}`,
    docLabel,
    code: String(docInfo.code || 'QUAL'),
    title: docInfo.name,
    subtitle: docInfo.indicateur ? `Indicateur Qualiopi ${docInfo.indicateur}` : null,
  })
  const t = ORG.theme
  const today = format(new Date(), 'dd/MM/yyyy')

  if (docId === 'organigramme') {
    const direction = data.direction || []
    const formateurs = data.formateurs || []
    f.section('Direction')
    const gap = 6
    const n = Math.max(1, direction.length)
    const colW = (f.W - gap * (n - 1)) / n
    let bottom = f.y
    f.ensure(30)
    direction.forEach((d, i) => {
      bottom = Math.max(bottom, drawPartyCard(doc, ORG, f.M + i * (colW + gap), f.y, colW, 'Direction', [d.nom || '', ...(d.roles || [])]))
    })
    f.y = bottom + 6
    f.section('Équipe pédagogique')
    if (formateurs.length) {
      f.table(['Formateur', 'Spécialités'], formateurs.map(x => [x.nom || '', (x.specialites || []).join(', ') || '-']), { columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold' } } })
    } else f.note('Aucun formateur enregistré.')
  } else if (docId.startsWith('des-')) {
    const dateStr = data.date ? format(new Date(data.date), 'd MMMM yyyy', { locale: fr }) : format(new Date(), 'd MMMM yyyy', { locale: fr })
    const legal = ORG.nameFull ? ORG.nameFull.replace(/ - Organisme de formation certifié Qualiopi$/, '') : (ORG.legal_name || ORG.name)
    f.para(`La société ${legal}, représentée par ${ORG.dirigeant || 'son représentant légal'}${ORG.dirigeant_title ? `, ${ORG.dirigeant_title}` : ''}, désigne par la présente :`, { size: 10, after: 5 })
    f.cards([{ label: 'Personne désignée', lines: [data.personne || 'Non désignée', `en qualité de ${data.role || docInfo.name}`, `à compter du ${dateStr}`] }])
    if ((data.missions || []).length) { f.section('Missions'); f.bullets(data.missions) }
    f.y += 4
    f.ensure(40)
    f.body(9)
    doc.text(`Fait à ${ORG.lieu_signature || ORG.city || ''}, le ${dateStr}.`, f.M, f.y)
    f.y += 4
    f.signatures([
      { label: 'Le représentant légal', name: [ORG.dirigeant, ORG.dirigeant_title].filter(Boolean).join(', '), hint: 'Signature', image: ORG.dirigeant_signature_base64 },
      { label: 'La personne désignée', name: data.personne || '', hint: 'Signature précédée de « Bon pour accord »' },
    ], { height: 30 })
  } else if (docId.startsWith('proc-')) {
    f.kv([
      ['Responsable', data.responsable || '-'],
      ['Révision', `Annuelle, dernière mise à jour le ${today}`],
      ['Délai d\'accusé de réception', data.delaiAccuse || null],
      ['Délai de clôture', data.delaiCloture || null],
      ['Délai de traitement', data.delaiTraitement || null],
      ['Fréquence', data.frequence || null],
    ], { labelW: 58 })
    if (data.objectif) { f.section('Objectif'); f.para(data.objectif) }
    if (data.indicateurs?.length) { f.section('Indicateurs suivis'); f.bullets(data.indicateurs) }
    if (data.sources?.length) { f.section('Sources de veille'); f.bullets(data.sources) }
    if (data.swimlanes?.length) {
      f.section('Logigramme : qui fait quoi')
      f.table(['Acteur', 'Étape', 'Délai', 'Résultat attendu'], data.swimlanes.map(r => [r.acteur || '', r.etape || '', r.delai || '-', r.output || '']), {
        columnStyles: { 0: { cellWidth: 34, fontStyle: 'bold' }, 2: { cellWidth: 24 }, 3: { cellWidth: 46 } },
      })
    }
  } else if (docId.startsWith('ck-')) {
    f.fields([{ label: 'Session ou date', value: '', w: 1.4 }, { label: 'Vérifié par', value: '', w: 1 }])
    f.space(2)
    f.checks((data.items || []).map((it, i) => ({ label: `${i + 1}. ${it}` })))
    f.box('Observations', { height: 26, lined: true })
  } else if (docId === 'rdd' && rddData) {
    const periode = `${format(rddData.periode.start, 'MMMM yyyy', { locale: fr })} à ${format(rddData.periode.end, 'MMMM yyyy', { locale: fr })}`
    f.kv([['Période', periode], ['Participants', 'Direction'], ['Date', today]])
    f.section('1. Formations')
    f.kv([['Sessions terminées', `${rddData.sessions.terminees} sur ${rddData.sessions.total}`], ['Stagiaires formés', String(rddData.stagiaires)]], { labelW: 50 })
    f.section('2. Satisfaction')
    f.kv([['Note moyenne', `${rddData.satisfaction.score} / 5`], ['Taux de recommandation', `${rddData.satisfaction.tauxReco} %`]], { labelW: 50 })
    f.section('3. Réclamations')
    f.kv([['Reçues', String(rddData.reclamations.total)], ['Clôturées', String(rddData.reclamations.cloturees)]], { labelW: 50 })
    f.section('4. Non-conformités')
    f.kv([['Relevées', String(rddData.nc.total)], ['Clôturées', String(rddData.nc.cloturees)]], { labelW: 50 })
    f.section('5. Décisions et actions')
    f.box(null, { height: 40, lined: true })
  } else if (docId.startsWith('reg-') && docInfo.table) {
    f.note(`Export du ${today} : ${registre.length} enregistrement${registre.length > 1 ? 's' : ''}.`, { after: 3 })
    if (!registre.length) {
      f.para('Aucun enregistrement.', { color: t.muted })
    } else if (docInfo.table === 'psh_requests') {
      f.table(['Référence', 'Besoin exprimé', 'Décision', 'Statut'], registre.map(i => [i.reference || '-', i.besoin_fonctionnel || '-', PSH_DECISION[i.decision] || '-', PSH_STATUT[i.status] || i.status || '-']), { columnStyles: { 0: { cellWidth: 28 }, 2: { cellWidth: 28 }, 3: { cellWidth: 32 } } })
    } else if (docInfo.table === 'programme_versions') {
      f.table(['Référence', 'Programme', 'Version', 'Date', 'Validé par'], registre.map(i => [i.ref_doc || '', i.nom_programme || '', i.version || '', fmtDate(i.date_maj), i.valide_par || '']), { columnStyles: { 0: { cellWidth: 28 }, 2: { cellWidth: 16 }, 3: { cellWidth: 22 }, 4: { cellWidth: 32 } } })
    } else {
      f.table(['Date', 'Objet', 'Statut'], registre.map(i => [fmtDate(i.date || i.created_at), i.sujet || i.subject || i.title || i.titre || i.description || i.name || '-', STATUTS[i.status || i.statut] || i.status || i.statut || '-']), { columnStyles: { 0: { cellWidth: 24 }, 2: { cellWidth: 30 } } })
    }
  } else if (docId === 'contrat-st') {
    f.cards([
      { label: 'Donneur d\'ordre', lines: [ORG.legal_name || ORG.name, ORG.address || '', ORG.siret ? `SIRET ${ORG.siret}` : ''].filter(Boolean) },
      { label: 'Prestataire', lines: [data.prestataire || '..............................................', '', ''] },
    ])
    f.kv([['Objet', data.objet || ''], ['Durée', data.duree || ''], ['Montant', data.montant || '']])
    if (data.obligations?.length) { f.section('Obligations du prestataire'); f.bullets(data.obligations) }
    if (data.conditions?.length) { f.section('Conditions'); f.bullets(data.conditions) }
    signBlock(f, ORG, 'Le prestataire')
  } else if (docId === 'charte-st') {
    f.para(`Le prestataire intervenant pour le compte de ${ORG.name || "l'organisme"} s'engage à :`, { size: 10, after: 3 })
    f.bullets(data.engagements || [])
    signBlock(f, ORG, 'Le prestataire')
  } else if (docId === 'nda') {
    const parties = (data.parties || []).filter(Boolean)
    f.cards([
      { label: 'Partie 1', lines: [parties[0] || (ORG.legal_name || ORG.name), ORG.address || ''] },
      { label: 'Partie 2', lines: [parties[1] || '..............................................', ''] },
    ])
    f.kv([['Durée de confidentialité', data.duree || '']], { labelW: 50 })
    if (data.informations?.length) { f.section('Informations confidentielles'); f.bullets(data.informations) }
    f.para("Les parties s'engagent à ne pas divulguer ces informations à des tiers et à ne les utiliser que pour l'exécution de leur collaboration.", { after: 3 })
    signBlock(f, ORG, 'Partie 2')
  } else if (docId === 'plan-action') {
    const PRIO = { haute: 'Haute', normale: 'Normale', basse: 'Basse' }
    const ST = { en_cours: 'En cours', a_faire: 'À faire', fait: 'Fait', termine: 'Terminé' }
    const rows = (data.actions || []).filter(a => a.action)
    if (rows.length) f.table(['Action', 'Responsable', 'Échéance', 'Priorité', 'Statut'], rows.map(a => [a.action, a.responsable || '', a.echeance ? fmtDate(a.echeance) : '', PRIO[a.priorite] || a.priorite || '', ST[a.statut] || a.statut || '']), { columnStyles: { 1: { cellWidth: 34 }, 2: { cellWidth: 22 }, 3: { cellWidth: 20 }, 4: { cellWidth: 22 } } })
    else f.para('Aucune action enregistrée.', { color: t.muted })
  } else {
    f.para('Document en cours de rédaction.', { color: t.muted })
  }

  f.finish()
  return doc
}

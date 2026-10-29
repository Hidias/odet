// Certificats de réalisation, attestations de présence (0399) et attestations de fin de formation (0476) figés
// une fois émis.
// Session terminée : la première édition enregistre la version 1, datée de la fin de la session. Réédité sans
// changement, le document reprend la version émise. Si les heures, le résultat ou les absences ont changé, une
// nouvelle version est émise, datée du jour, avec un motif : elle annule et remplace la précédente.
// Session pas encore terminée : brouillon, rien n'est enregistré.

import toast from 'react-hot-toast'
import { supabase } from '../../../core/supabase'
import { currentUserName } from '../../../core/org/currentOrg'
import { demander } from '../../../ui/Confirm'
import { heuresDuDocument } from './presence'
import { memesObjectifs } from './finFormation'

const aujourdhui = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const NOM_KIND = { certificat: 'certificat de réalisation', attestation: 'attestation de présence', fin_formation: 'attestation de fin de formation' }

/** Valeurs qui figurent sur le document d'un stagiaire */
export function contenuDocument(session, kind, t) {
  const st = (session?.session_trainees || []).find((x) => x.trainee_id === t.id) || {}
  return {
    hours: Math.round(heuresDuDocument(session, session?.courses || {}, st, t) * 100) / 100,
    result: kind === 'certificat' || kind === 'fin_formation' ? (t.result || null) : null,
    absences: [...(t.absences_notees || [])],
    // Attestation de fin de formation : objectifs et résultat de chacun, figés avec le document (0476)
    objectives: kind === 'fin_formation' ? (t.objectifs_resultats || []).map((o) => ({ texte: o.texte, acquis: o.acquis })) : null,
  }
}

export function memeContenu(a, b) {
  return Number(a.hours) === Number(b.hours) && (a.result || null) === (b.result || null)
    && (a.absences || []).join('|') === (b.absences || []).join('|')
    && memesObjectifs(a.objectives, b.objectives)
}

/**
 * Prépare la liste à éditer : chaque stagiaire reçoit `document_emis` { version, issued_on, remplace }.
 * @returns la liste, ou null si l'on renonce à motiver une correction
 */
export async function figerDocuments(session, kind, liste) {
  if (!session?.end_date || String(session.end_date).slice(0, 10) > aujourdhui()) return liste
  const { data: emis, error } = await supabase.from('training_documents_issued').select('*')
    .eq('session_id', session.id).eq('kind', kind).order('version')
  if (error) { console.error('Documents émis :', error); return liste }
  const parStagiaire = {}
  ;(emis || []).forEach((r) => { (parStagiaire[r.trainee_id] ||= []).push(r) })

  const nouveaux = []
  const corriges = []
  const suite = (liste || []).map((t) => {
    const versions = parStagiaire[t.id] || []
    const derniere = versions[versions.length - 1]
    const contenu = contenuDocument(session, kind, t)
    if (!derniere) { nouveaux.push({ t, contenu }); return t }
    if (memeContenu(contenu, { hours: derniere.hours, result: derniere.result, absences: derniere.absences, objectives: derniere.objectives })) {
      const avant = versions.find((v) => v.version === derniere.version - 1)
      return { ...t, document_emis: { version: derniere.version, issued_on: derniere.issued_on, remplace: avant ? { version: avant.version, issued_on: avant.issued_on } : null } }
    }
    corriges.push({ t, contenu, derniere })
    return t
  })

  let motif = null
  if (corriges.length) {
    const noms = corriges.map(({ t }) => `${t.first_name || ''} ${(t.last_name || '').toUpperCase()}`.trim()).join(', ')
    motif = await demander(`${corriges.length > 1 ? `${corriges.length} ${NOM_KIND[kind]}s déjà émis changent` : `Le ${NOM_KIND[kind]} déjà émis change`} (${noms}).\n\nUn nouveau document, daté d'aujourd'hui, annulera et remplacera le précédent. Motif de la correction :`, { title: 'Correction d\'un document émis' })
    if (motif === null) return null
    if (motif.trim().length < 3) { toast.error('Le motif de la correction est obligatoire'); return null }
  }

  const lignes = [
    ...nouveaux.map(({ t, contenu }) => ({ t, version: 1, issued_on: String(session.end_date).slice(0, 10), contenu, reason: null, avant: null })),
    ...corriges.map(({ t, contenu, derniere }) => ({ t, version: derniere.version + 1, issued_on: aujourdhui(), contenu, reason: motif.trim(), avant: derniere })),
  ]
  if (!lignes.length) return suite
  const auteur = currentUserName() || null
  const { error: errIns } = await supabase.from('training_documents_issued').insert(lignes.map((l) => ({
    session_id: session.id, trainee_id: l.t.id, kind, version: l.version, issued_on: l.issued_on,
    hours: l.contenu.hours, result: l.contenu.result, absences: l.contenu.absences, reason: l.reason, issued_by_name: auteur,
    ...(kind === 'fin_formation' ? { objectives: l.contenu.objectives } : {}),
  })))
  if (errIns) {
    toast.error(`Document non enregistré comme émis : ${errIns.message}`)
    return suite
  }
  const parId = Object.fromEntries(lignes.map((l) => [l.t.id, l]))
  return suite.map((t) => {
    const l = parId[t.id]
    if (!l) return t
    return { ...t, document_emis: { version: l.version, issued_on: l.issued_on, remplace: l.avant ? { version: l.avant.version, issued_on: l.avant.issued_on } : null } }
  })
}

/** Stagiaires qui ont une version émise (portails : l'attestation de fin de formation n'existe qu'émise) */
export function seulementEmis(liste) {
  return (liste || []).filter((t) => t.document_emis)
}

/**
 * Pour un envoi par e-mail : heures réellement suivies puis document figé. Les demi-journées non régularisées
 * restent comptées (signalées). @returns la liste, ou null si une correction n'est pas motivée
 */
export async function preparerDocuments(session, kind, liste) {
  const { avecHeuresRealisees } = await import('./emargementControle')
  const r = await avecHeuresRealisees(session, liste)
  if (r.aRegulariser) toast(`${r.aRegulariser} demi-journée(s) sans émargement à régulariser (onglet Présence de la session)`, { icon: '⚠️', duration: 7000 })
  return figerDocuments(session, kind, r.liste)
}


/**
 * Portails (lecture seule) : chaque stagiaire reçoit la dernière version émise, telle qu'elle a été remise
 * (lignes servies par client_portal_documents_emis, ent_documents_emis ou stg_documents_emis). Sans version émise,
 * rien ne change.
 */
export function appliquerEmis(lignes, sessionId, kind, liste) {
  const versions = {}
  ;(lignes || []).filter((r) => r.session_id === sessionId && r.kind === kind)
    .sort((a, b) => a.version - b.version)
    .forEach((r) => { (versions[r.trainee_id] ||= []).push(r) })
  return (liste || []).map((t) => {
    const v = versions[t.id]
    if (!v?.length) return t
    const d = v[v.length - 1]
    const avant = v.find((x) => x.version === d.version - 1)
    return {
      ...t,
      heures_realisees: d.hours != null ? Number(d.hours) : t.heures_realisees,
      ...((kind === 'certificat' || kind === 'fin_formation') && d.result ? { result: d.result } : {}),
      ...(kind === 'fin_formation' ? { objectifs_resultats: d.objectives || [] } : {}),
      absences_notees: d.absences || [],
      document_emis: { version: d.version, issued_on: d.issued_on, remplace: avant ? { version: avant.version, issued_on: avant.issued_on } : null },
    }
  })
}

/**
 * Pour un envoi par e-mail : attestations de fin de formation (0476) de ceux qui peuvent en avoir une complète
 * (présent, résultat saisi, tous les objectifs évalués dans l'onglet Suivi). Les autres sont écartés et comptés.
 * @returns { liste, ecartes } ; liste null si une correction n'est pas motivée
 */
export async function preparerFinFormationEnvoi(session, liste) {
  const { avecObjectifs, blocageFinFormation, nonEvalues } = await import('./finFormation')
  const { data: lignes, error } = await supabase.from('trainee_objectives').select('trainee_id, objective_index, validated').eq('session_id', session.id)
  if (error) { console.error('Objectifs des stagiaires :', error); return { liste: [], ecartes: (liste || []).length } }
  const absents = (session?.session_trainees || []).filter((st) => st.absent).map((st) => st.trainee_id)
  const avec = avecObjectifs(liste, session?.courses, lignes)
  const ok = avec.filter((t) => !blocageFinFormation(t, { absent: absents.includes(t.id) }) && nonEvalues(t) === 0)
  const ecartes = avec.length - ok.length
  if (!ok.length) return { liste: [], ecartes }
  return { liste: await preparerDocuments(session, 'fin_formation', ok), ecartes }
}

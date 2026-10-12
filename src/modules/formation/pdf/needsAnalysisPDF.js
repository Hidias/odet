// Analyse du besoin de formation (vierge ou remplie depuis la session ou le prospect).
// Mise en page commune des documents (core/pdf/layout.js) ; identité lue dans organization_settings.

import jsPDF from 'jspdf'
import { buildORG, prepareOrgForPDF } from '../../../core/org/orgUtils'
import { startDocument } from '../../../core/pdf/layout'

const safe = (value, defaultValue = '') => (value === null || value === undefined ? defaultValue : String(value))

const REASONS = {
  reglementation: 'Réglementation, obligations légales',
  accident: 'Suite à un accident ou un incident',
  renouvellement: 'Renouvellement de certificats',
  nouveaux_embauches: 'Nouveaux embauchés',
  evolution_risques: 'Évolution des risques',
  autre: 'Autre',
}
const PROFILES = { administratif: 'Administratif', production: 'Production', terrain: 'Terrain', encadrement: 'Encadrement' }
const LEVELS = { debutant: 'Débutant', intermediaire: 'Intermédiaire', avance: 'Avancé' }

async function orgFor(orgSettings) {
  const prepared = (await prepareOrgForPDF(orgSettings || {})) || orgSettings || {}
  return { ...prepared, ...buildORG(prepared) }
}

function buildDoc(ORG, session, analysisData, blank) {
  const doc = new jsPDF({ compress: true })
  const a = !blank && analysisData ? analysisData : null
  const ref = blank ? null : (session?.reference || null)
  const f = startDocument(doc, ORG, { ref, docLabel: 'Analyse du besoin', code: 'BESOIN', title: 'Analyse du besoin de formation' })

  const clientName = blank ? '' : safe(session?.clients?.name || session?.name)
  const date = blank ? '' : (a?.analysis_date ? new Date(a.analysis_date).toLocaleDateString('fr-FR') : new Date().toLocaleDateString('fr-FR'))
  f.fields([
    { label: 'Entreprise', value: clientName, w: 2 },
    { label: 'Date', value: date, w: 0.7 },
    ...(blank ? [{ label: 'N° de session', value: '', w: 0.8 }] : []),
  ])

  // 1. Contexte et enjeux
  f.section('1. Contexte et enjeux')
  f.label('Pourquoi cette formation maintenant ?')
  if (a) {
    const reasons = (a.context_reasons || []).map(r => (r === 'autre' ? `Autre : ${safe(a.context_other)}` : REASONS[r])).filter(Boolean)
    if (reasons.length) f.bullets(reasons); else f.box(null, { height: 10, lined: true })
  } else {
    f.checks(Object.entries(REASONS).map(([, label]) => ({ label: label === 'Autre' ? 'Autre : ........................................' : label })), { columns: 3 })
  }
  f.box('Enjeux spécifiques', { height: 12, text: a?.context_stakes || null, lined: !a })

  // 2. Objectifs attendus
  f.section('2. Objectifs attendus')
  f.box("Ce que les stagiaires doivent savoir faire à l'issue", { height: 12, text: a?.objectives_description || null, lined: !a })
  f.box('Résultats mesurables attendus', { height: 10, text: a?.objectives_measurable || null, lined: !a })

  // 3. Public concerné
  f.section('3. Public concerné')
  if (a) {
    f.kv([
      ['Participants', a.participants_count ? safe(a.participants_count) : ''],
      ['Profils', (a.participants_profiles || []).map(p => PROFILES[p] || p).join(', ')],
      ['Niveau', LEVELS[a.level] || safe(a.level)],
      ['Particularités', [a.particularities_psh ? `Situation de handicap : ${safe(a.particularities_psh)}` : '', a.particularities_non_french ? 'Public non francophone' : '', a.particularities_other ? `Autre : ${safe(a.particularities_other)}` : ''].filter(Boolean).join(' ; ') || 'Aucune'],
    ], { labelW: 42 })
  } else {
    f.fields([{ label: 'Nombre de participants', value: '', w: 0.8 }, { label: 'Prérequis validés', value: '', w: 0.8 }, { label: 'Niveau', value: '', w: 1 }])
    f.label('Profils')
    f.checks(Object.values(PROFILES).map(label => ({ label })), { inline: true, colW: 34 })
    f.label('Particularités')
    f.checks([{ label: 'Situation de handicap' }, { label: 'Public non francophone' }, { label: 'Autre' }], { inline: true, colW: 50 })
  }

  // 4. Contraintes et moyens
  f.section('4. Contraintes et moyens')
  if (a) {
    const lieu = a.location_name || (a.location_type === 'client' ? `Chez le client${a.location_client_address ? ' (' + safe(a.location_client_address) + ')' : ''}` : (a.location_type ? `Dans nos locaux (${ORG.name})` : ''))
    f.kv([
      ['Lieu', lieu],
      ['Horaires', safe(a.preferred_schedule)],
      ['Dates souhaitées', safe(a.preferred_dates)],
      ['Matériel entreprise', a.company_equipment == null ? '' : (a.company_equipment ? `Oui${a.company_equipment_details ? ' (' + safe(a.company_equipment_details) + ')' : ''}` : 'Non')],
      ['EPI fournis', a.ppe_provided == null ? '' : (a.ppe_provided ? 'Oui' : 'Non')],
    ], { labelW: 42 })
    if (a.other_constraints) f.box('Autres contraintes', { height: 10, text: a.other_constraints })
  } else {
    f.checks([{ label: 'Dans nos locaux' }, { label: 'Chez le client, adresse :' }], { inline: true, colW: 45 })
    f.y -= 2
    f.fields([{ label: '', value: '', w: 1 }], { height: 6 })
    f.fields([{ label: 'Horaires souhaités', value: '', w: 1 }, { label: 'Dates souhaitées', value: '', w: 1 }, { label: 'Matériel fourni', value: '', w: 0.8 }, { label: 'EPI fournis', value: '', w: 0.6 }])
  }

  // Signatures
  f.y += 1
  f.signatures([
    { label: "Pour l'entreprise", hint: 'Nom, date et signature', image: a?.signature_client || null },
    { label: `Pour ${ORG.name || "l'organisme"}`, hint: 'Date et signature', image: a?.signature_trainer || null },
  ], { height: 22 })
  f.finish()
  return doc
}

export const downloadNeedsAnalysisPDF = async (session, analysisData = null, blank = false, orgSettings = null) => {
  const ORG = await orgFor(orgSettings)
  const doc = buildDoc(ORG, session, analysisData, blank)
  doc.save(blank ? 'Analyse_Besoin_Vierge.pdf' : `Analyse_Besoin_${safe(session?.reference, 'Session')}.pdf`)
}

// Version qui retourne les octets (pièce jointe d'email)
export const getNeedsAnalysisPDFBytes = async (session, analysisData = null, blank = false, orgSettings = null) => {
  const ORG = await orgFor(orgSettings)
  return buildDoc(ORG, session, analysisData, blank).output('arraybuffer')
}

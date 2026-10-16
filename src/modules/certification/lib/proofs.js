// Preuves trouvées automatiquement dans la base pour chaque indicateur du référentiel.
// loadEvidence() lit les comptes utiles (requêtes légères), evaluateIndicators() est pure (testable).
// Une preuve « ok » est un élément vérifiable par l'auditeur ; « missing » liste ce qui manque.
// Les preuves ajoutées à la main (cert_proofs) complètent ces règles.

import { supabase } from '../../../core/supabase'

const filled = (v) => v != null && String(v).trim() !== ''

async function count(table, build) {
  let q = supabase.from(table).select('*', { count: 'exact', head: true })
  if (build) q = build(q)
  const { count: n, error } = await q
  return error ? 0 : (n || 0)
}

/** Lit dans la base tout ce que les règles utilisent */
export async function loadEvidence() {
  const [
    courses, org, qdocs, qualDocs, roles, settings, veille, trainers, sessionsTotal, sessionsDone, demoNames,
  ] = await Promise.all([
    supabase.from('courses').select('id, title, objectives, prerequisites, duration_hours, price_ht, price_per_day, target_audience, teaching_methods, pedagogical_methods, methods, evaluation_methods, content, program, program_url, positioning_questions'),
    Promise.resolve({ data: null }),
    Promise.resolve({ data: [] }),
    supabase.from('quality_documents').select('doc_id, content, updated_at'),
    supabase.from('quality_roles').select('code, profile_id, demo_name'),
    supabase.from('cert_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('veille_qualiopi').select('type, action_menee, statut'),
    supabase.from('trainers').select('id, qualifications_list, certifications, is_internal'),
    count('sessions'),
    count('sessions', (q) => q.eq('status', 'completed')),
    supabase.rpc('quality_demo_names_active').then(({ data }) => !!data, () => false),
  ])
  const [
    needs, positioning, positioningTests, objectivesValidated, results, convocations, infoSheets, psh, disability,
    attendance, partial, equipment, courseDocs, sessionTrainers, trainerCerts, trainerTrainings, trainerInterviews,
    hotEvals, coldEvals, trainerEvals, satisfactionSent, reclamations, ncs, alertsTreated, programmes, sst, opcoSessions,
    audits, signedConventions, formativeSheets, formativeSessions, formativeOn,
  ] = await Promise.all([
    count('session_needs_analysis'),
    count('positioning_results'),
    count('trainee_positioning_tests'),
    count('trainee_objectives', (q) => q.eq('validated', true)),
    count('session_trainees', (q) => q.not('result', 'is', null)),
    count('session_trainees', (q) => q.not('convocation_sent_at', 'is', null)),
    count('trainee_info_sheets'),
    count('psh_requests'),
    count('trainees', (q) => q.eq('has_disability', true)),
    count('attendance_halfdays'),
    count('session_trainees', (q) => q.eq('early_departure', true)),
    count('equipment_catalog'),
    count('course_documents'),
    count('sessions', (q) => q.not('trainer_id', 'is', null)),
    count('trainer_certificates'),
    count('trainer_trainings'),
    count('trainer_interviews'),
    count('trainee_evaluations'),
    count('evaluations_cold', (q) => q.not('completed_at', 'is', null)),
    count('trainer_evaluations'),
    supabase.from('session_emails_sent').select('attachments').then(({ data }) => (data || []).filter((m) => JSON.stringify(m.attachments || '').toLowerCase().includes('satisfaction')).length, () => 0),
    count('reclamations'),
    count('non_conformites'),
    count('quality_alerts', (q) => q.neq('status', 'pending')),
    count('programme_versions'),
    count('sst_certifications', (q) => q.eq('candidat_certifie', true)),
    count('sessions', (q) => q.ilike('funding_type', '%opco%')),
    count('audits_internes'),
    count('sessions', (q) => q.eq('convention_signed', true)),
    // Suivi formatif (module optionnel, migration 0250) : fiches archivées et sessions qui en ont une
    count('formative_sheets'),
    supabase.from('formative_sheets').select('session_id').then(({ data }) => new Set((data || []).map((r) => r.session_id)).size, () => 0),
    supabase.from('org_modules').select('enabled').eq('key', 'suivi_formatif').maybeSingle().then(({ data }) => !!data?.enabled, () => false),
  ])

  const c = courses.data || []
  const v = veille.data || []
  const qual = new Map((qualDocs.data || []).map((d) => [d.doc_id, d]))
  // Noms fictifs de démonstration comptés tant qu'ils sont en service (effacés avec les données de démonstration)
  const role = new Map((roles.data || []).map((r) => [r.code, r.profile_id || (demoNames && r.demo_name) || null]))
  const t = trainers.data || []
  return {
    settings: settings.data || {},
    courses: {
      total: c.length,
      withInfo: c.filter((x) => filled(x.objectives) && filled(x.prerequisites) && Number(x.duration_hours) > 0
        && (Number(x.price_ht) > 0 || Number(x.price_per_day) > 0) && filled(x.target_audience)
        && (filled(x.teaching_methods) || filled(x.pedagogical_methods) || filled(x.methods)) && filled(x.evaluation_methods)).length,
      withObjectives: c.filter((x) => filled(x.objectives)).length,
      withContent: c.filter((x) => filled(x.content) || filled(x.program) || filled(x.program_url)).length,
      withPositioning: c.filter((x) => Array.isArray(x.positioning_questions) ? x.positioning_questions.length > 0 : filled(x.positioning_questions)).length,
    },
    // Documents : une seule source, Documents qualité (document enregistré, brouillon ou validé)
    org: {
      reglement: qual.has('reglement'),
      livret: qual.has('livret-court') || qual.has('livret-complet'),
      referentHandicap: !!role.get('referent_handicap'),
    },
    docs: {
      reclamationProc: qual.has('proc-recl'),
      handicapProc: qual.has('proc-hand'),
      veilleProc: qual.has('proc-veille'),
      ncProc: qual.has('proc-nc'),
      vssProc: qual.has('proc-vss'),
      riskMap: qual.has('carto-risques') && ((qual.get('carto-risques')?.content?.risques || []).length > 0),
      organigramme: qual.has('organigramme'),
      contratSt: qual.has('contrat-st'),
      contratStClause: JSON.stringify(qual.get('contrat-st')?.content || {}).toLowerCase().includes('référentiel national'),
      charteSt: qual.has('charte-st'),
    },
    roles: { signalements: !!role.get('referent_signalements'), reclamations: !!role.get('referent_reclamations') },
    veille: {
      legale: v.filter((x) => x.type === 'legale').length,
      metiers: v.filter((x) => x.type === 'metiers').length,
      pedagogique: v.filter((x) => x.type === 'pedagogique').length,
      legaleExploited: v.filter((x) => x.type === 'legale' && filled(x.action_menee)).length,
      metiersExploited: v.filter((x) => x.type === 'metiers' && filled(x.action_menee)).length,
      pedagogiqueExploited: v.filter((x) => x.type === 'pedagogique' && filled(x.action_menee)).length,
    },
    trainers: {
      total: t.length,
      qualified: t.filter((x) => (x.qualifications_list || []).length > 0 || filled(x.certifications)).length,
      external: t.filter((x) => x.is_internal === false).length,
    },
    n: {
      sessionsTotal, sessionsDone, needs, positioning: positioning + positioningTests, objectivesValidated, results,
      convocations, infoSheets, psh, disability, attendance, partial, equipment, courseDocs, sessionTrainers,
      trainerCerts, trainerTrainings, trainerInterviews, hotEvals, coldEvals, trainerEvals, satisfactionSent,
      reclamations, ncs, alertsTreated, programmes, sst, opcoSessions, audits, signedConventions,
      formativeSheets, formativeSessions,
    },
    formativeOn,
  }
}

const L = {
  catalogue: '/formations', sessions: '/sessions', formateurs: '/formateurs', qualite: '/qualite', qualiopi: '/qualiopi',
  veille: '/veille-qualiopi', psh: '/registre-psh', nc: '/non-conformites', indicateurs: '/indicateurs',
  parametres: '/parametres', methode: '/certification/methode', bpf: '/bpf', completude: '/qualite/completude',
}
const ok = (label, link) => ({ label, ok: true, link })
const ko = (label, link) => ({ label, ok: false, link })
const plural = (n, s, p) => `${n} ${n > 1 ? (p || s + 's') : s}`

/** Règles par numéro d'indicateur : renvoie { items, missing } */
export const RULES = {
  1: (e) => ({
    items: [
      e.courses.total ? (e.courses.withInfo === e.courses.total
        ? ok(`Fiches formation complètes : ${e.courses.withInfo} sur ${e.courses.total}`, L.catalogue)
        : ko(`Fiches formation complètes : ${e.courses.withInfo} sur ${e.courses.total} (objectifs, prérequis, durée, tarif, public, méthodes, évaluation)`, L.catalogue))
        : ko('Aucune formation au catalogue', L.catalogue),
      e.org.referentHandicap ? ok('Accessibilité : référent handicap désigné', L.parametres) : ko('Accessibilité : référent handicap non désigné', L.parametres),
    ],
    missing: ['Préciser sur chaque offre le type de reconnaissance (attestation, certificat), les modalités pédagogiques et de financement et les délais d\'accès (exigence 2026), puis ajouter la page du site en preuve'],
  }),
  2: (e) => ({
    items: [
      e.n.hotEvals + e.n.results > 0 ? ok('Résultats calculés depuis les sessions : satisfaction, objectifs, assiduité, recommandation', L.methode) : ko('Aucun résultat calculable (sessions terminées sans évaluation)', L.methode),
      e.settings.results_published_at ? ok(`Méthode de calcul publiée le ${new Date(e.settings.results_published_at).toLocaleDateString('fr-FR')}`, L.methode) : ko('Méthode de calcul pas encore publiée', L.methode),
    ],
    missing: e.settings.results_published_at ? [] : ['Publier les résultats avec leur méthode de calcul (page Méthode de calcul), puis noter la date de publication'],
  }),
  3: (e) => ({
    items: [e.n.sst ? ok(`Candidats certifiés enregistrés : ${e.n.sst}`, L.sessions) : ko('Aucun résultat de certification enregistré', L.sessions)],
    missing: ['Publier le taux d\'obtention, les blocs de compétences, passerelles, suites de parcours et débouchés'],
  }),
  4: (e) => ({
    items: [e.n.needs ? ok(`Analyses du besoin : ${e.n.needs} pour ${plural(e.n.sessionsTotal, 'session')}`, L.sessions) : ko('Aucune analyse du besoin enregistrée', L.sessions)],
    missing: e.n.needs && e.n.needs < e.n.sessionsTotal ? [`${plural(e.n.sessionsTotal - e.n.needs, 'session')} sans analyse du besoin`] : [],
  }),
  5: (e) => ({
    items: [e.courses.total && e.courses.withObjectives === e.courses.total ? ok(`Objectifs définis : ${e.courses.withObjectives} formations sur ${e.courses.total}`, L.catalogue) : ko(`Objectifs définis : ${e.courses.withObjectives} formations sur ${e.courses.total}`, L.catalogue)],
    missing: [],
  }),
  6: (e) => ({
    items: [
      e.courses.total && e.courses.withContent === e.courses.total ? ok(`Programmes rédigés : ${e.courses.withContent} sur ${e.courses.total}`, L.catalogue) : ko(`Programmes rédigés : ${e.courses.withContent} sur ${e.courses.total}`, L.catalogue),
      e.n.programmes ? ok(`Registre des versions de programmes : ${plural(e.n.programmes, 'ligne')}`, L.qualite) : ko('Registre des versions de programmes vide', L.qualite),
    ],
    missing: [],
  }),
  7: () => ({ items: [], missing: ['Prouver l\'adéquation des contenus au référentiel de certification et la capacité à assurer la certification (habilitation)'] }),
  8: (e) => ({
    items: [
      e.courses.withPositioning ? ok(`Tests de positionnement définis : ${e.courses.withPositioning} formations sur ${e.courses.total}`, '/tests-positionnement') : ko('Aucun test de positionnement défini', '/tests-positionnement'),
      e.n.positioning ? ok(`Réponses de positionnement enregistrées : ${e.n.positioning}`, L.sessions) : ko('Aucune réponse de positionnement enregistrée', L.sessions),
    ],
    missing: [],
  }),
  9: (e) => ({
    items: [
      e.n.convocations ? ok(`Convocations envoyées : ${e.n.convocations}`, L.sessions) : ko('Aucune convocation envoyée', L.sessions),
      e.org.livret ? ok('Livret d\'accueil rédigé', L.qualiopi) : ko('Livret d\'accueil absent', L.qualiopi),
      e.org.reglement ? ok('Règlement intérieur rédigé', L.qualiopi) : ko('Règlement intérieur absent', L.qualiopi),
    ],
    missing: [],
  }),
  10: (e) => ({
    items: [
      e.n.infoSheets ? ok(`Fiches de renseignement (besoins particuliers) : ${e.n.infoSheets}`, L.sessions) : ko('Aucune fiche de renseignement', L.sessions),
      ok(`Demandes d'adaptation (registre PSH) : ${e.n.psh}`, L.psh),
    ],
    missing: [],
  }),
  11: (e) => ({
    items: [
      e.n.objectivesValidated ? ok(`Objectifs évalués et validés : ${e.n.objectivesValidated}`, L.sessions) : ko('Aucun objectif évalué', L.sessions),
      e.n.results ? ok(`Résultats des stagiaires saisis : ${e.n.results}`, L.sessions) : ko('Aucun résultat saisi', L.sessions),
      ...(e.n.formativeSheets
        ? [ok(`Suivi formatif par séquence : ${plural(e.n.formativeSessions, 'session')} avec fiche archivée (${plural(e.n.formativeSheets, 'version')})`, L.sessions)]
        : (e.formativeOn ? [ko('Suivi formatif activé, aucune fiche de suivi archivée', L.sessions)] : [])),
    ],
    missing: [],
  }),
  12: (e) => ({
    items: [
      e.n.attendance ? ok(`Émargements par demi-journée : ${e.n.attendance}`, L.sessions) : ko('Aucun émargement', L.sessions),
      ok(`Départs anticipés et arrivées tardives notés : ${e.n.partial}`, L.sessions),
      e.docs.vssProc ? ok('Procédure violences, harcèlement et discriminations', L.qualite) : ko('Procédure violences, harcèlement et discriminations absente', L.qualite),
      e.roles.signalements ? ok('Référent signalements désigné', L.parametres) : ko('Référent signalements non désigné (Paramètres, Qualité et référents)', L.parametres),
    ],
    missing: [],
  }),
  16: (e) => ({
    items: [e.n.sst ? ok(`Certifications délivrées : ${e.n.sst}`, L.sessions) : ko('Aucune certification enregistrée', L.sessions)],
    missing: ['Garder la preuve du respect des exigences formelles de l\'autorité de certification (habilitation, conditions d\'évaluation)'],
  }),
  17: (e) => ({
    items: [
      e.n.equipment ? ok(`Matériel pédagogique inventorié : ${plural(e.n.equipment, 'élément')}`, L.qualite) : ko('Inventaire du matériel vide', L.qualite),
      e.trainers.total ? ok(`Formateurs : ${e.trainers.total}`, L.formateurs) : ko('Aucun formateur', L.formateurs),
    ],
    missing: [],
  }),
  18: (e) => ({
    items: [
      e.n.sessionTrainers ? ok(`Sessions avec formateur affecté : ${e.n.sessionTrainers} sur ${e.n.sessionsTotal}`, L.sessions) : ko('Aucune session avec formateur', L.sessions),
      e.docs.organigramme ? ok('Organigramme', L.qualite) : ko('Organigramme absent', L.qualite),
    ],
    missing: [],
  }),
  19: (e) => ({
    items: [e.n.courseDocs ? ok(`Ressources pédagogiques en ligne : ${e.n.courseDocs}`, L.catalogue) : ko('Aucune ressource pédagogique déposée', L.catalogue)],
    missing: e.settings.has_distance ? ['Prouver le suivi effectif des modules à distance (connexions, temps passé, travaux rendus)'] : [],
  }),
  21: (e) => ({
    items: [
      e.trainers.total && e.trainers.qualified === e.trainers.total ? ok(`Qualifications renseignées : ${e.trainers.qualified} formateurs sur ${e.trainers.total}`, L.formateurs) : ko(`Qualifications renseignées : ${e.trainers.qualified} formateurs sur ${e.trainers.total}`, L.formateurs),
      e.n.trainerCerts ? ok(`Certificats des formateurs : ${e.n.trainerCerts}`, L.formateurs) : ko('Aucun certificat de formateur déposé', L.formateurs),
      e.n.trainerEvals ? ok(`Évaluations formateur : ${e.n.trainerEvals}`, L.sessions) : ko('Aucune évaluation des intervenants', L.sessions),
    ],
    missing: [],
  }),
  22: (e) => ({
    items: [
      e.n.trainerTrainings ? ok(`Formations suivies par l'équipe : ${e.n.trainerTrainings}`, L.formateurs) : ko('Aucune formation suivie enregistrée', L.formateurs),
      e.n.trainerInterviews ? ok(`Entretiens professionnels : ${e.n.trainerInterviews}`, L.formateurs) : ko('Aucun entretien enregistré', L.formateurs),
    ],
    missing: [],
  }),
  23: (e) => ({
    items: [e.veille.legale ? ok(`Veille légale : ${plural(e.veille.legale, 'entrée')}, dont ${e.veille.legaleExploited} exploitée${e.veille.legaleExploited > 1 ? 's' : ''}`, L.veille) : ko('Aucune veille légale', L.veille)],
    missing: e.veille.legale && !e.veille.legaleExploited ? ['Noter l\'action menée sur au moins une entrée de veille légale'] : [],
  }),
  24: (e) => ({
    items: [e.veille.metiers ? ok(`Veille métiers et emplois : ${plural(e.veille.metiers, 'entrée')}, dont ${e.veille.metiersExploited} exploitée${e.veille.metiersExploited > 1 ? 's' : ''}`, L.veille) : ko('Aucune veille métiers', L.veille)],
    missing: e.veille.metiers && !e.veille.metiersExploited ? ['Noter l\'action menée sur au moins une entrée de veille métiers'] : [],
  }),
  25: (e) => ({
    items: [e.veille.pedagogique ? ok(`Veille pédagogique et technologique : ${plural(e.veille.pedagogique, 'entrée')}, dont ${e.veille.pedagogiqueExploited} exploitée${e.veille.pedagogiqueExploited > 1 ? 's' : ''}`, L.veille) : ko('Aucune veille pédagogique', L.veille)],
    missing: e.veille.pedagogique && !e.veille.pedagogiqueExploited ? ['Noter l\'action menée sur au moins une entrée de veille pédagogique'] : [],
  }),
  26: (e) => ({
    items: [
      e.org.referentHandicap ? ok('Référent handicap désigné', L.parametres) : ko('Référent handicap non désigné', L.parametres),
      e.docs.handicapProc ? ok('Procédure handicap', L.qualiopi) : ko('Procédure handicap absente', L.qualiopi),
      ok(`Registre PSH : ${plural(e.n.psh, 'demande')}`, L.psh),
    ],
    missing: [],
  }),
  27: (e) => ({
    items: [
      e.docs.contratSt ? ok('Contrat de sous-traitance type', L.qualite) : ko('Contrat de sous-traitance type absent', L.qualite),
      e.docs.contratSt && e.docs.contratStClause ? ok('Clause de conformité au référentiel national qualité dans le contrat', L.qualite) : ko('Clause de conformité au référentiel absente du contrat (exigence 2026)', L.qualite),
      e.docs.charteSt ? ok('Charte qualité prestataire', L.qualite) : ko('Charte qualité prestataire absente', L.qualite),
    ],
    missing: ['Garder les preuves de contrôle des sous-traitants (certificat Qualiopi, CV, attestations)'],
  }),
  30: (e) => ({
    items: [
      e.n.hotEvals ? ok(`Stagiaires, évaluations à chaud : ${e.n.hotEvals}`, L.indicateurs) : ko('Aucune évaluation à chaud', L.indicateurs),
      e.n.coldEvals ? ok(`Stagiaires, évaluations à froid : ${e.n.coldEvals}`, L.indicateurs) : ko('Aucune évaluation à froid', L.indicateurs),
      e.n.trainerEvals ? ok(`Équipe pédagogique, évaluations formateur : ${e.n.trainerEvals}`, L.indicateurs) : ko('Aucune évaluation formateur', L.indicateurs),
      e.n.satisfactionSent ? ok(`Entreprises et donneurs d'ordre, questionnaires envoyés : ${e.n.satisfactionSent}`, L.sessions) : ko('Aucun questionnaire entreprise envoyé', L.sessions),
      ...(e.n.opcoSessions ? [ko(`Financeurs : ${plural(e.n.opcoSessions, 'session financée')} par un OPCO, recueil à prévoir`, null)] : []),
    ],
    missing: ['Déposer ici les questionnaires entreprise et donneur d\'ordre retournés signés'],
  }),
  31: (e) => ({
    items: [
      e.docs.reclamationProc ? ok('Procédure de traitement des réclamations', L.qualiopi) : ko('Procédure de réclamation absente', L.qualiopi),
      e.roles.reclamations ? ok('Référent réclamations désigné', L.parametres) : ko('Référent réclamations non désigné', L.parametres),
      ok(`Réclamations enregistrées : ${e.n.reclamations}`, L.nc),
      ok(`Alertes qualité traitées : ${e.n.alertsTreated}`, L.indicateurs),
    ],
    missing: [],
  }),
  32: (e) => ({
    items: [
      e.docs.ncProc ? ok('Procédure non-conformités et amélioration', L.qualite) : ko('Procédure non-conformités absente', L.qualite),
      ok(`Non-conformités et actions correctives : ${e.n.ncs}`, L.nc),
      e.n.audits ? ok(`Audits internes : ${e.n.audits}`, L.qualite) : ko('Aucun audit interne enregistré', L.qualite),
      e.docs.riskMap ? ok('Cartographie des risques sur la qualité des formations', L.qualite) : ko('Cartographie des risques qualité absente (exigence 2026)', L.qualite),
    ],
    missing: [],
  }),
}

/** Raison automatique de non-applicabilité selon le périmètre d'activité */
export function autoNotApplicable(ind, settings = {}) {
  switch (ind.applies_when) {
    case 'certifiant': return settings.has_certifying ? null : 'Aucune formation ne prépare à une certification professionnelle (RNCP ou Répertoire spécifique).'
    case 'alternance': return settings.has_alternance ? null : 'L\'organisme ne propose pas de formation en alternance.'
    case 'apprentissage': return settings.has_apprentissage ? null : 'L\'organisme n\'est pas un CFA et ne dispense pas d\'actions par apprentissage.'
    case 'fest': return settings.has_fest ? null : 'Les prestations ne comportent pas de période de formation en situation de travail.'
    case 'sous_traitance': return settings.uses_subcontracting ? null : 'L\'organisme ne fait appel ni à la sous-traitance ni au portage salarial.'
    default: return null
  }
}

/**
 * Statut de chaque indicateur.
 * @returns {Array<{...ind, status: 'preuves'|'a_completer'|'manquant'|'non_applicable', items, missing, manual, naReason, naAuto}>}
 */
export function evaluateIndicators(indicators, evidence, { statuses = [], proofs = [] } = {}) {
  const st = new Map(statuses.map((s) => [s.number, s]))
  return indicators.map((ind) => {
    const s = st.get(ind.number) || {}
    const auto = autoNotApplicable(ind, evidence?.settings || {})
    const na = s.not_applicable === true || (s.not_applicable == null && !!auto)
    const manual = proofs.filter((p) => p.indicator_number === ind.number)
    if (na) {
      return { ...ind, status: 'non_applicable', items: [], missing: [], manual, naReason: s.na_justification || auto || '', naAuto: s.not_applicable == null }
    }
    const rule = RULES[ind.number]
    const r = rule && evidence ? rule(evidence) : { items: [], missing: [] }
    const items = r.items || []
    // Une preuve ajoutée à la main lève les éléments « à préciser » qui ne se calculent pas
    const missing = manual.length ? [] : [...(r.missing || [])]
    const failing = items.filter((i) => !i.ok)
    const okCount = items.filter((i) => i.ok).length + manual.length
    let status
    if (!okCount) status = 'manquant'
    else if (failing.length || missing.length) status = 'a_completer'
    else status = 'preuves'
    return { ...ind, status, items, missing, manual, naReason: '', naAuto: false }
  })
}

export const STATUS_LABEL = {
  preuves: 'Preuves trouvées',
  a_completer: 'À compléter',
  manquant: 'Manquant',
  non_applicable: 'Non applicable',
}

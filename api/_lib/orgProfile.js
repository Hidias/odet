// api/_lib/orgProfile.js
// Profil de l'organisme injecté dans les prompts de l'Aide à la rédaction.
// Tout vient de organization_settings et du catalogue (courses) : aucune identité en dur.
// En cas d'échec de lecture, on renvoie un profil vide plutôt que l'identité d'un autre organisme.

export async function loadOrgProfile(admin) {
  const profile = { name: '', legalName: '', city: '', region: '', phone: '', email: '', website: '', qualiopi: false, caces: false, nda: '', dirigeant: '', dirigeantTitle: '', activity: '', tutoiement: false, presentation: '', zone: [], catalogue: [], stats: null }
  if (!admin) return profile
  try {
    const { data: o } = await admin
      .from('organization_settings')
      .select('name, legal_name, city, region, phone, email, website, qualiopi_certified, caces_activity, nda, zone_departements, created_at, dirigeant_name, dirigeant_title, activity_kind, ai_profile')
      .limit(1)
      .maybeSingle()
    if (o) {
      Object.assign(profile, {
        name: o.name || '',
        legalName: o.legal_name || o.name || '',
        city: o.city || '',
        region: o.region || '',
        phone: o.phone || '',
        email: o.email || '',
        website: o.website || '',
        qualiopi: !!o.qualiopi_certified,
        caces: !!o.caces_activity,
        nda: o.nda || '',
        dirigeant: o.dirigeant_name || '',
        dirigeantTitle: o.dirigeant_title || '',
        activity: o.activity_kind || '',
        tutoiement: !!(o.ai_profile && o.ai_profile.tutoiement),
        presentation: String((o.ai_profile && o.ai_profile.presentation) || '').trim(),
        zone: Array.isArray(o.zone_departements) ? o.zone_departements : [],
        statsSince: String(o.created_at || '').slice(0, 10),
      })
    }
    const { data: courses } = await admin
      .from('courses')
      .select('title, duration_hours, duration_days')
      .order('title')
      .limit(40)
    profile.catalogue = (courses || []).map((c) => {
      const h = Number(c.duration_hours) || null
      const d = Number(c.duration_days) || null
      const dur = h ? `${h} h${d && d > 1 ? ` sur ${d} jours` : ''}` : ''
      return `${c.title}${dur ? ` (${dur})` : ''}`
    })
    profile.stats = await loadRealStats(admin, profile.statsSince)
  } catch (err) {
    console.error('loadOrgProfile :', err?.message || err)
  }
  return profile
}

// Chiffres réels, calculés comme la page Indicateurs :
// - satisfaction : moyenne des 14 critères (sur 5) des évaluations à chaud des stagiaires formés ;
// - réussite : part des résultats « acquis » sur les sessions terminées.
// Seules les sessions qui commencent après la mise en service de l'instance comptent : un historique
// importé (par exemple celui d'un autre organisme) n'est jamais présenté comme le résultat de celui-ci.
// Rien n'est renvoyé tant qu'il n'y a pas de données : l'IA ne cite alors aucun chiffre.
const SATISFACTION_KEYS = [
  'q_org_accueil', 'q_org_documents', 'q_org_locaux', 'q_org_materiel',
  'q_contenu_supports', 'q_contenu_programme', 'q_contenu_organisation', 'q_contenu_duree',
  'q_formateur_pedagogie', 'q_formateur_expertise', 'q_formateur_progression', 'q_formateur_moyens',
  'q_global_adequation', 'q_global_competences',
]

async function loadRealStats(admin, since) {
  try {
    const [{ data: sts }, { data: sessions }, { data: evals }] = await Promise.all([
      admin.from('session_trainees').select('session_id, trainee_id, result, presence_complete, early_departure'),
      admin.from('sessions').select('id, status, start_date'),
      admin.from('trainee_evaluations').select(`session_id, trainee_id, ${SATISFACTION_KEYS.join(', ')}`),
    ])
    const own = (sessions || []).filter((x) => !since || String(x.start_date || '') >= since)
    const ownIds = new Set(own.map((x) => x.id))
    const completed = new Set(own.filter((x) => x.status === 'completed').map((x) => x.id))
    const formed = new Set((sts || []).filter((x) => ownIds.has(x.session_id) && (x.presence_complete === true || x.early_departure === true)).map((x) => `${x.session_id}:${x.trainee_id}`))
    const scores = []
    let nEval = 0
    ;(evals || []).forEach((e) => {
      if (!formed.has(`${e.session_id}:${e.trainee_id}`)) return
      let used = false
      SATISFACTION_KEYS.forEach((k) => { const v = e[k]; if (v !== null && v !== undefined && !Number.isNaN(Number(v))) { scores.push(Number(v)); used = true } })
      if (used) nEval++
    })
    const results = (sts || []).filter((x) => completed.has(x.session_id) && x.result)
    const acquired = results.filter((x) => x.result === 'acquired').length
    return {
      satisfaction: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      satisfactionCount: nEval,
      successRate: results.length ? Math.round((acquired / results.length) * 100) : null,
      successCount: results.length,
      formedCount: formed.size,
    }
  } catch (err) {
    console.error('loadRealStats :', err?.message || err)
    return null
  }
}

// Nom de l'expéditeur : profil de l'utilisateur connecté, sinon nom transmis par l'écran
export function senderFromProfile(userProfile, fallback = '') {
  const p = userProfile || {}
  return p.display_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || fallback || ''
}

// Bloc d'identité pour un prompt système (sans valeur inventée : les lignes vides sont omises)
export function orgIdentityBlock(org) {
  const lines = [
    `- Nom : ${org.name || 'organisme de formation'}${org.legalName && org.legalName !== org.name ? ` (${org.legalName})` : ''}`,
    org.city ? `- Implantation : ${org.city}${org.region ? ` (${org.region})` : ''}` : '',
    org.dirigeant ? `- Dirigeant : ${org.dirigeant}${org.dirigeantTitle ? `, ${org.dirigeantTitle}` : ''}` : '',
    org.qualiopi ? '- Certifié Qualiopi' : '',
    org.phone || org.email ? `- Contact : ${[org.phone, org.email].filter(Boolean).join(' | ')}` : '',
    org.zone.length ? `- Zone d'intervention : départements ${org.zone.join(', ')}` : '',
  ].filter(Boolean)
  const st = org.stats
  const figures = []
  if (st?.satisfaction != null && st.satisfactionCount > 0) figures.push(`- Satisfaction des stagiaires : ${String(st.satisfaction).replace('.', ',')}/5 (${st.satisfactionCount} évaluation${st.satisfactionCount > 1 ? 's' : ''})`)
  if (st?.successRate != null && st.successCount > 0) figures.push(`- Taux de réussite : ${st.successRate} % (${st.successCount} résultat${st.successCount > 1 ? 's' : ''})`)
  if (st?.formedCount > 0) figures.push(`- Stagiaires formés : ${st.formedCount}`)
  const figBlock = figures.length
    ? `\n\nCHIFFRES RÉELS (les seuls que tu peux citer, tels quels, et seulement si c'est utile) :\n${figures.join('\n')}`
    : '\n\nCHIFFRES : aucun indicateur disponible pour le moment, ne cite aucun chiffre de satisfaction ni de réussite.'
  const cat = org.catalogue.length
    ? `\n\nCATALOGUE (ne cite que ces formations, avec leurs intitulés exacts) :\n${org.catalogue.map((c) => `- ${c}`).join('\n')}`
    : ''
  const pres = org.presentation ? `\n\nPRÉSENTATION (fournie par l'organisme, à reprendre sans l'enrichir) :\n${org.presentation}` : ''
  return `IDENTITÉ DE L'ORGANISME :\n${lines.join('\n')}${pres}${cat}${figBlock}

RÈGLES DE RÉDACTION :
- N'invente aucun chiffre, aucune certification${org.qualiopi ? '' : ' (l\'organisme n\'est pas certifié Qualiopi : ne le mentionne pas)'} ni aucune formation absente du catalogue.
${org.caces ? '- L\'organisme délivre des CACES : tu peux employer ce terme pour les formations du catalogue qui y préparent.' : '- L\'organisme ne délivre pas de CACES : pour la conduite de chariots ou de gerbeurs, écris « formation à la conduite en vue de la délivrance de l\'autorisation de conduite », jamais « CACES ».'}
- Pas de tiret long ni d'emoji.`
}

// Formule d'adresse des emails commerciaux (Paramètres > Identité : « Tutoyer les contacts »)
export function addressRule(org) {
  return org?.tutoiement
    ? '- Tutoie le destinataire (formules : « ton », « ta », « tes »).'
    : '- Vouvoie le destinataire.'
}

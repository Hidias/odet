// api/evaluations-froid.js
// ─────────────────────────────────────────────────────────────────────────────
// Évaluations à froid (0482, option C validée par H le 04/11) : envoi des mails préparés la nuit, après validation
// à l'écran (page des non-répondants). Rien ne part seul.
//   - l'appelant est vérifié (droit d'envoyer aux stagiaires et aux clients) ; la base revérifie, envoi par envoi,
//     le droit dans la société de la session, l'interrupteur « Questionnaires à froid » de la Console, l'état
//     « à envoyer » et la règle d'une adresse par jour (froid_envois_reserver, appelée avec le jeton de l'appelant) ;
//   - un mail par stagiaire, sans autre destinataire visible ; pour le contact de l'entreprise (stagiaires sans
//     adresse, évaluation de l'employeur), un seul mail par session et par contact ;
//   - boîte d'envoi de la personne connectée, signature et copie cachée habituelles ; les règles d'envoi réel de
//     l'outil s'appliquent (getMailer, envoi réel) ;
//   - chaque envoi est tracé (froid_envoi_terminer).
//
//   POST /api/evaluations-froid { ids: [...] }                 → envoi
//   POST /api/evaluations-froid { ids: [...], apercu: true }   → textes seulement, rien n'est réservé ni envoyé
//   POST /api/evaluations-froid { ids: [id], test: true }      → un exemple à l'adresse de la personne connectée
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin, getMailer, sendWithRetry, getOrg, getSender, buildSignatureHTML, finirParCordialement } from './_lib/mailer.js'
import { requireRight, clientDeLAppelant, OFFICE_WRITE } from './_lib/auth.js'
import { appUrl } from './_lib/internal.js'
import { withErrorLog } from './_lib/errors.js'
import { nomPourAppel } from '../src/core/nomPersonne.js'

export const config = { maxDuration: 60 }

const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
// Corps en HTML : texte échappé, adresses rendues cliquables
export function htmlDe(corps) {
  return esc(corps).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, '<br>')
}
const jour = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '')

// « le 3 mars 2026 » pour un jour, « du 3 au 4 mars 2026 » sinon (règle validée par H le 02/11)
export function periode(debut, fin) {
  if (!debut) return ''
  if (!fin || String(fin).slice(0, 10) === String(debut).slice(0, 10)) return `le ${jour(debut)}`
  return `du ${jour(debut)} au ${jour(fin)}`
}

export function lienPortail(base, jeton) {
  return `${String(base || '').replace(/\/$/, '')}/#/portail/${encodeURIComponent(jeton || '')}`
}

// Texte au stagiaire (premier envoi ou relance)
export function texteStagiaire(e, orgName, base) {
  const formation = e.formation || 'votre formation'
  const relance = Number(e.rang) > 0
  const corps = [
    `Bonjour${e.prenom ? ` ${e.prenom}` : ''},`,
    '',
    `Vous avez suivi la formation « ${formation} » ${periode(e.debut, e.fin)}${orgName ? ` avec ${orgName}` : ''}, et nous vous en remercions.`,
    '',
    relance
      ? 'Quelque temps après une formation, nous demandons à chaque stagiaire ce qu\'il en a retenu et ce qu\'il a pu mettre en pratique. Nous n\'avons pas encore reçu votre évaluation à froid.'
      : 'Quelque temps après une formation, nous demandons à chaque stagiaire ce qu\'il en a retenu et ce qu\'il a pu mettre en pratique.',
    '',
    `Si vous avez quelques minutes, pourriez-vous répondre au questionnaire dans votre espace stagiaire ? Quelques questions suffisent, et vos réponses nous aident à améliorer nos formations.${e.code ? ` Votre code personnel : ${e.code}` : ''}`,
    '',
    lienPortail(base, e.jeton),
    '',
    'Si vous avez déjà répondu, merci de ne pas tenir compte de ce message.',
  ].join('\n')
  return { sujet: `Votre avis sur la formation « ${formation} »`, corps }
}

// Espace de l'entreprise (0509) : l'espace par lien si le client a un accès actif (aucun compte en production le 08/11),
// sinon l'espace par compte. Le code d'accès n'est jamais mis dans le mail.
export function espaceEntreprise(base, jetonAcces) {
  const b = String(base || '').replace(/\/$/, '')
  return jetonAcces ? `${b}/#/entreprise/${encodeURIComponent(jetonAcces)}` : `${b}/#/mon-entreprise`
}

// Jetons des accès actifs par client (lecture par la clé de service, après le contrôle des droits de l'appelant)
async function jetonsDesClients(admin, clientIds) {
  const ids = [...new Set((clientIds || []).filter(Boolean))]
  if (!ids.length) return new Map()
  const { data } = await admin.from('client_portal_access').select('client_id, token, is_active').in('client_id', ids)
  return new Map((data || []).filter((a) => a.is_active && a.token).map((a) => [a.client_id, a.token]))
}

// Client dont l'espace est proposé dans le mail : celui de l'employeur, sinon celui du premier envoi
const clientDuGroupe = (groupe) => (groupe.find((x) => x.cible === 'employeur') || groupe[0])?.client_id || null

// Texte au contact de l'entreprise : stagiaires sans adresse et/ou évaluation de l'employeur, une même session.
// jetonAcces : accès par lien actif du client (0509), sinon lien vers l'espace par compte.
export function texteContact(groupe, orgName, base, jetonAcces = null) {
  const e = groupe[0]
  const formation = e.formation || 'la formation'
  const employeur = groupe.some((x) => x.cible === 'employeur')
  const sansAdresse = groupe.filter((x) => x.cible === 'contact')
  const relance = groupe.every((x) => Number(x.rang) > 0)
  const lignes = [
    `Bonjour${e.destinataire_nom ? ` ${nomPourAppel(e.destinataire_nom)}` : ''},`,
    '',
    `Votre entreprise a suivi la formation « ${formation} » ${periode(e.debut, e.fin)}${orgName ? ` avec ${orgName}` : ''}, et nous vous en remercions.`,
    '',
  ]
  if (employeur) {
    lignes.push(`${relance ? 'Nous n\'avons pas encore reçu votre avis d\'employeur. ' : ''}Quelques mois après la formation, votre avis nous aide à mesurer ce qu'elle apporte dans le travail. Le questionnaire vous attend dans votre espace entreprise, rubrique « Évaluations à froid »${jetonAcces ? ', avec votre code d\'accès habituel (si vous ne l\'avez pas, répondez simplement à ce message)' : ''} :`, '', espaceEntreprise(base, jetonAcces), '')
  }
  if (sansAdresse.length) {
    const noms = sansAdresse.map((x) => [x.prenom, x.nom].filter(Boolean).join(' ')).join(', ')
    lignes.push(`Nous n'avons pas d'adresse e-mail pour ${sansAdresse.length > 1 ? 'les participants suivants' : 'ce participant'} : ${noms}. Pourriez-vous ${sansAdresse.length > 1 ? 'leur' : 'lui'} transmettre le lien de l'espace stagiaire ci-dessous ? Chacun y répond avec son code personnel, que vous retrouvez dans votre espace entreprise.`, '', lienPortail(base, e.jeton), '')
    if (!employeur) lignes.push(`Votre espace entreprise : ${espaceEntreprise(base, jetonAcces)}`, '')
  }
  lignes.push('Si la réponse nous a déjà été transmise, merci de ne pas tenir compte de ce message.')
  return { sujet: `Évaluation à froid de la formation « ${formation} »`, corps: lignes.join('\n') }
}

// Regroupe : un mail par envoi stagiaire ; un mail par (session, client, adresse) pour le contact et l'employeur
export function grouper(envois) {
  const out = []
  const contacts = new Map()
  for (const e of envois) {
    if (e.cible === 'stagiaire') { out.push([e]); continue }
    // par client aussi (0509) : chaque mail mène à l'espace de sa propre entreprise
    const cle = `${e.session_id}|${e.client_id || ''}|${String(e.destinataire || '').toLowerCase()}`
    if (!contacts.has(cle)) { contacts.set(cle, []); out.push(contacts.get(cle)) }
    contacts.get(cle).push(e)
  }
  return out
}

const MAILS_PAR_APPEL = 15
// Budget de temps : au-delà, les mails restants ne partent pas et passent « à reprendre » (temps limite du serveur : 300 s)
const BUDGET_MS = 150000

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const ctx = await requireRight(req, res, ['formation.convocations.envoyer'], OFFICE_WRITE)
  if (!ctx) return
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)) : []
  if (!ids.length || ids.length > 200) return res.status(400).json({ error: 'Choisissez de 1 à 200 envois' })
  const apercu = !!req.body?.apercu
  const test = !!req.body?.test
  const appelant = clientDeLAppelant(req)
  if (!appelant) return res.status(401).json({ error: 'Connexion requise' })
  const admin = getSupabaseAdmin()
  const org = await getOrg(admin)
  const base = appUrl(req)

  // Aperçu et test : lecture des lignes visibles par l'appelant, rien n'est réservé
  if (apercu || test) {
    const { data: lignes, error } = await appelant.from('froid_envois').select('id, session_id, trainee_id, client_id, cible, rang, destinataire, destinataire_nom, statut').in('id', ids)
    if (error) return res.status(400).json({ error: error.message })
    const sessions = [...new Set((lignes || []).map((l) => l.session_id))]
    const { data: ses } = await admin.from('sessions').select('id, start_date, end_date, attendance_token, courses(title)').in('id', sessions.length ? sessions : ['00000000-0000-0000-0000-000000000000'])
    const tids = (lignes || []).map((l) => l.trainee_id).filter(Boolean)
    const { data: trs } = await admin.from('trainees').select('id, first_name, last_name').in('id', tids.length ? tids : ['00000000-0000-0000-0000-000000000000'])
    const { data: codes } = await admin.from('session_trainees').select('session_id, trainee_id, access_code').in('session_id', sessions.length ? sessions : ['00000000-0000-0000-0000-000000000000'])
    const enrichis = (lignes || []).map((l) => {
      const s = (ses || []).find((x) => x.id === l.session_id) || {}
      const t = (trs || []).find((x) => x.id === l.trainee_id) || {}
      const c = (codes || []).find((x) => x.session_id === l.session_id && x.trainee_id === l.trainee_id) || {}
      return { ...l, formation: s.courses?.title, debut: s.start_date, fin: s.end_date || s.start_date, jeton: s.attendance_token, prenom: t.first_name, nom: t.last_name, code: c.access_code }
    })
    const jetons = await jetonsDesClients(admin, enrichis.filter((l) => l.cible !== 'stagiaire').map((l) => l.client_id))
    const textes = grouper(enrichis).map((g) => ({ ids: g.map((x) => x.id), destinataire: g[0].destinataire, ...(g[0].cible === 'stagiaire' ? texteStagiaire(g[0], org.name, base) : texteContact(g, org.name, base, jetons.get(clientDuGroupe(g)) || null)) }))
    if (apercu) return res.status(200).json({ textes })
    // Test : le premier texte, à la seule adresse de la personne connectée
    const mailer = await getMailer(admin, ctx.user.id, { envoiReel: true })
    if (mailer.error) return res.status(400).json({ error: mailer.error })
    const sender = await getSender(admin, mailer.emailConfig.email)
    const t = textes[0]
    if (!t) return res.status(400).json({ error: 'Rien à prévisualiser' })
    try {
      await sendWithRetry(mailer.transporter, {
        from: `"${sender.name}" <${mailer.emailConfig.email}>`, to: mailer.emailConfig.email,
        subject: `[Test] ${t.sujet}`, text: t.corps,
        html: `${htmlDe(t.corps)}${finirParCordialement(t.corps) ? '' : '<br><br><p style="margin: 0;">Bien cordialement,</p>'}${buildSignatureHTML(sender, org)}`,
      }, 1)
    } finally { try { mailer.transporter.close() } catch {} }
    return res.status(200).json({ ok: true, test: mailer.emailConfig.email })
  }

  // Envoi réel : au plus 15 mails par appel, pour rester sous le temps limite du serveur (la page envoie par lots)
  {
    const { data: lignes, error } = await appelant.from('froid_envois').select('id, session_id, cible, destinataire').in('id', ids)
    if (error) return res.status(400).json({ error: error.message })
    if (grouper(lignes || []).length > MAILS_PAR_APPEL) return res.status(400).json({ error: `Au plus ${MAILS_PAR_APPEL} mails à la fois` })
  }
  // Réservation par la base au nom de l'appelant
  const { data: reserve, error: rErr } = await appelant.rpc('froid_envois_reserver', { p_ids: ids })
  if (rErr) return res.status(403).json({ error: rErr.message })
  const refus = reserve?.refus || []
  // Client de chaque envoi (absent de la réservation) pour proposer l'espace par lien de l'entreprise (0509)
  const reserves = reserve?.envois || []
  const { data: clientsEnvois } = reserves.length ? await admin.from('froid_envois').select('id, client_id').in('id', reserves.map((e) => e.id)) : { data: [] }
  const clientDe = new Map((clientsEnvois || []).map((x) => [x.id, x.client_id]))
  const envois = reserves.map((e) => ({ ...e, client_id: clientDe.get(e.id) || null }))
  if (!envois.length) return res.status(200).json({ envoyes: 0, erreurs: 0, refus })
  const jetons = await jetonsDesClients(admin, envois.filter((e) => e.cible !== 'stagiaire').map((e) => e.client_id))
  const mailer = await getMailer(admin, ctx.user.id, { envoiReel: true })
  if (mailer.error) {
    for (const e of envois) await appelant.rpc('froid_envoi_terminer', { p_id: e.id, p_ok: false, p_erreur: mailer.error })
    return res.status(400).json({ error: mailer.error })
  }
  const sender = await getSender(admin, mailer.emailConfig.email)
  let envoyes = 0
  let erreurs = 0
  const debut = Date.now()
  try {
    for (const groupe of grouper(envois)) {
      if (Date.now() - debut > BUDGET_MS) {
        for (const e of groupe) await appelant.rpc('froid_envoi_terminer', { p_id: e.id, p_ok: false, p_erreur: 'Non envoyé : messagerie trop lente, à reprendre' })
        erreurs += 1
        continue
      }
      const t = groupe[0].cible === 'stagiaire' ? texteStagiaire(groupe[0], org.name, base) : texteContact(groupe, org.name, base, jetons.get(clientDuGroupe(groupe)) || null)
      try {
        const info = await sendWithRetry(mailer.transporter, {
          from: `"${sender.name}" <${mailer.emailConfig.email}>`,
          to: groupe[0].destinataire,
          bcc: org.email_bcc || undefined,
          subject: t.sujet,
          text: t.corps,
          html: `${htmlDe(t.corps)}${finirParCordialement(t.corps) ? '' : '<br><br><p style="margin: 0;">Bien cordialement,</p>'}${buildSignatureHTML(sender, org)}`,
        }, 1)
        for (const e of groupe) await appelant.rpc('froid_envoi_terminer', { p_id: e.id, p_ok: true, p_message_id: info?.messageId || null, p_boite: mailer.emailConfig.email })
        envoyes += 1
      } catch (err) {
        for (const e of groupe) await appelant.rpc('froid_envoi_terminer', { p_id: e.id, p_ok: false, p_erreur: String(err?.message || 'Échec').slice(0, 300) })
        erreurs += 1
      }
    }
  } finally { try { mailer.transporter.close() } catch {} }
  return res.status(200).json({ envoyes, erreurs, refus })
}

export default withErrorLog(handler, 'evaluations-froid')

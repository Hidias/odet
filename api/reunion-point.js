// api/reunion-point.js
// « Faire le point » d'une réunion ou d'un rendez-vous (0408) : range les notes prises à la volée et les réponses du
// guide en résumé, décisions, actions, points à relancer, prochain rendez-vous, et prépare un email récapitulatif.
// La réunion est lue avec les droits de l'appelant. Rien n'est envoyé ni enregistré ici : la page montre le résultat,
// la personne le corrige, choisit les actions à suivre et envoie l'email elle-même.

import { requireUser, clientDeLAppelant, getAdminClient } from './_lib/auth.js'
import { loadOrgProfile, orgIdentityBlock, addressRule } from './_lib/orgProfile.js'
import { withErrorLog } from './_lib/errors.js'

export const config = { maxDuration: 60 }
const UUID = /^[0-9a-f-]{36}$/i
const TYPES = { rdv_client: 'rendez-vous client', rdv_fournisseur: 'rendez-vous fournisseur', reunion_interne: 'réunion d\'équipe', autre: 'réunion' }

function texteGuide(guide) {
  return (guide || []).map((g) => {
    const etat = g.coche ? '[traité]' : '[non traité]'
    const rep = String(g.reponse || '').trim()
    return `- ${g.type === 'sujet' ? 'Sujet' : 'Question'} ${etat} : ${g.texte}${rep ? `\n  Réponse : ${rep}` : ''}`
  }).join('\n')
}

function extraireJson(texte) {
  const debut = texte.indexOf('{')
  const fin = texte.lastIndexOf('}')
  if (debut < 0 || fin <= debut) throw new Error('Réponse illisible')
  return JSON.parse(texte.slice(debut, fin + 1))
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const ctx = await requireUser(req)
  if (!ctx || ctx.profile.role === 'entreprise') return res.status(403).json({ error: 'Accès refusé' })
  const { meeting_id: id } = req.body || {}
  if (!UUID.test(String(id || ''))) return res.status(400).json({ error: 'Réunion inconnue' })
  if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'L\'assistant de rédaction n\'est pas configuré.' })

  const appelant = clientDeLAppelant(req)
  const { data: m } = await appelant.from('meetings').select('*, clients(name), suppliers(name)').eq('id', id).maybeSingle()
  if (!m) return res.status(403).json({ error: 'Accès refusé' })
  const notes = String(m.notes || '').trim()
  const guide = texteGuide(m.guide)
  if (notes.length < 5 && !(m.guide || []).some((g) => String(g.reponse || '').trim())) {
    return res.status(400).json({ error: 'Pas encore de notes ni de réponses à ranger.' })
  }

  const admin = getAdminClient()
  const org = await loadOrgProfile(admin)
  const { data: equipe } = await admin.from('profiles').select('display_name, first_name, last_name').eq('is_active', true)
  const noms = (equipe || []).map((p) => p.display_name || [p.first_name, p.last_name].filter(Boolean).join(' ')).filter(Boolean)
  const tiers = m.clients?.name || m.suppliers?.name || ''
  const participants = (m.participants || []).map((p) => [p.nom, p.role].filter(Boolean).join(', ')).filter(Boolean).join(' ; ')
  const interne = m.kind === 'reunion_interne'

  const system = `Tu ranges les notes d'une ${TYPES[m.kind] || 'réunion'}${org.name ? ` pour ${org.name}` : ''} et tu prépares le compte rendu.

${orgIdentityBlock(org)}

RÈGLES :
- N'invente rien : uniquement ce qui figure dans les notes et les réponses. Une information absente reste absente.
- Français, phrases courtes, sans jargon.
- Les actions : un verbe à l'infinitif, qui (un nom de l'équipe parmi : ${noms.join(', ') || 'aucun'} ; sinon le nom cité dans les notes, ou vide), échéance au format AAAA-MM-JJ seulement si une date est dite.
- Email récapitulatif${interne ? ' destiné à l\'équipe' : ` destiné à ${tiers || 'l\'interlocuteur'}`} : ton professionnel B2B, courtois et chaleureux, sans familiarité.
${interne ? '- Tutoiement ou vouvoiement : comme dans les notes, sinon vouvoiement.' : addressRule(org)}
- Email : remerciement bref, « Voici le récapitulatif des éléments abordés : » puis des puces, puis « Prochaines étapes : », puis une formule de clôture. Sans signature. Pas d'appel à l'action artificiel.
- Ne parle pas d'argent de façon froide ou comptable.

Réponds UNIQUEMENT par un objet JSON :
{"resume": "3 à 6 phrases", "decisions": ["..."], "actions": [{"titre": "...", "qui": "...", "echeance": "AAAA-MM-JJ ou vide"}], "a_relancer": ["..."], "prochain_rdv": "texte ou vide", "email": {"objet": "...", "corps": "texte brut avec retours à la ligne"}}`

  const prompt = `Titre : ${m.title}
Type : ${TYPES[m.kind] || 'réunion'}
${tiers ? `${m.kind === 'rdv_fournisseur' ? 'Fournisseur' : 'Client'} : ${tiers}\n` : ''}${m.starts_at ? `Date : ${new Date(m.starts_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}\n` : ''}${participants ? `Participants : ${participants}\n` : ''}
GUIDE (questions et sujets) :
${guide || '(aucun)'}

NOTES PRISES À LA VOLÉE :
${notes || '(aucune)'}`

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3000, system, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    return res.status(502).json({ error: e.error?.message || 'Assistant indisponible' })
  }
  const data = await r.json()
  let out
  try { out = extraireJson(data.content?.[0]?.text || '') } catch { return res.status(502).json({ error: 'Réponse de l\'assistant illisible, réessayez.' }) }
  const liste = (v) => (Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 30) : [])
  return res.status(200).json({
    resume: String(out.resume || '').trim(),
    decisions: liste(out.decisions),
    actions: (Array.isArray(out.actions) ? out.actions : []).slice(0, 30).map((a) => ({
      titre: String(a?.titre || '').trim().slice(0, 300),
      qui: String(a?.qui || '').trim(),
      echeance: /^\d{4}-\d{2}-\d{2}$/.test(String(a?.echeance || '')) ? a.echeance : '',
    })).filter((a) => a.titre.length >= 2),
    a_relancer: liste(out.a_relancer),
    prochain_rdv: String(out.prochain_rdv || '').trim(),
    email: { objet: String(out.email?.objet || '').trim().slice(0, 200), corps: String(out.email?.corps || '').trim() },
  })
}

export default withErrorLog(handler, 'reunion-point')

// api/retours.js : retours des utilisateurs (post-it), suivi et réponse à l'auteur.
//
// POST                 un compte interne actif envoie un retour : texte, type (problème, idée, question), gravité
//                      ressentie, capture facultative (image compressée par le navigateur, 3 Mo au plus), page en cours.
// GET                  ses propres retours (statut, réponse) ; ?scope=tous : tous les retours (droit de suivi) ;
//                      ?capture=<id> : lien signé d'une minute vers la capture (auteur ou droit de suivi).
// PATCH                { id, read: true } : l'auteur a lu la réponse ;
//                      { id, status?, response?, notice_id? } : suivi (droit de suivi).
// La table user_feedback n'a aucune règle d'accès et aucun droit pour anon ni pour les comptes connectés
// (0260, 0263) : seul ce serveur la lit et l'écrit (clé de service). Les captures sont dans le bucket privé
// « retours », sans règle de stockage : elles ne sortent jamais de l'outil (lien signé de courte durée).
// Droit de suivi : organisation.retours.suivre (super administrateur et administrateur) ; droits inconnus :
// super administrateur seulement. Un administrateur suit les retours de ses sociétés ; le super administrateur, tous.
// Chaque nouveau retour crée une notification réservée au super administrateur (metadata.audience, règle de 0070).
// Journaux : jamais le texte d'un retour ni le nom de son auteur.

import crypto from 'crypto'
import { requireUser, droitsDeLAppelant, OFFICE } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

const STATUSES = ['nouveau', 'vu', 'en_cours', 'fait', 'ecarte']
const KINDS = ['probleme', 'idee', 'question']
const SEVERITIES = ['faible', 'genant', 'bloquant']
const KIND_LABELS = { probleme: 'problème', idee: 'idée', question: 'question' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CAPTURE = 3 * 1024 * 1024
const IMAGE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
const clip = (v, n) => (v == null ? null : String(v).slice(0, n))
const COLONNES = 'id, created_at, company_id, author_id, author_label, page_path, page_title, viewport, message, kind, severity, screenshot_path, status, handled_at, response, responded_at, response_read_at, notice_id, updated_at'
const COLONNES_0260 = 'id, created_at, company_id, author_id, author_label, page_path, page_title, viewport, message, status, handled_at'
// Colonne absente : migration 0263 pas encore appliquée (le post-it simple de 0260 continue de marcher)
const colonneInconnue = (e) => ['42703', 'PGRST204'].includes(e?.code) || /column|colonne/i.test(String(e?.message || ''))

// Sociétés où le compte est membre actif (un administrateur suit les retours de ses sociétés)
async function societesDuCompte(admin, userId) {
  const { data } = await admin.from('company_members').select('company_id').eq('profile_id', userId).eq('is_active', true)
  return (data || []).map((m) => m.company_id)
}

// Société du retour : celle choisie dans l'onglet si le compte en est membre, sinon sa société par défaut
async function societeDuRetour(admin, req, userId) {
  const demandee = req.headers?.['x-company-id']
  const { data } = await admin.from('company_members').select('company_id, is_default').eq('profile_id', userId).eq('is_active', true)
  const liste = data || []
  if (typeof demandee === 'string' && UUID.test(demandee) && liste.some((m) => m.company_id === demandee)) return demandee
  return (liste.find((m) => m.is_default) || liste[0])?.company_id || null
}

async function peutSuivre(req, profile) {
  const droits = await droitsDeLAppelant(req)
  if (droits) return droits.includes('organisation.retours.suivre')
  return profile.role === 'superadmin'
}

async function handler(req, res) {
  if (!['POST', 'GET', 'PATCH'].includes(req.method)) return res.status(405).json({ error: 'Méthode non autorisée' })
  const ctx = await requireUser(req)
  if (!ctx) return res.status(401).json({ error: 'Connexion requise' })
  const { user, profile, admin } = ctx
  // Comptes internes seulement (les comptes externes n'ont pas de post-it) ; « membre » : droits par profils
  if (!OFFICE.includes(profile.role) && profile.role !== 'membre') return res.status(403).json({ error: 'Accès refusé pour ce rôle' })
  const superadmin = profile.role === 'superadmin'

  try {
    // ── Envoi d'un retour ──
    if (req.method === 'POST') {
      const body = req.body || {}
      const message = String(body.message || '').trim()
      if (!message) return res.status(400).json({ error: 'Le retour est vide' })
      if (message.length > 4000) return res.status(400).json({ error: 'Texte trop long (4 000 caractères au plus)' })
      const kind = KINDS.includes(body.kind) ? body.kind : null
      const severity = kind === 'probleme' && SEVERITIES.includes(body.severity) ? body.severity : null
      const companyId = await societeDuRetour(admin, req, user.id)
      const id = crypto.randomUUID()

      let screenshotPath = null
      if (body.screenshot) {
        const m = IMAGE.exec(String(body.screenshot))
        if (!m) return res.status(400).json({ error: 'Capture refusée : image JPEG, PNG ou WebP seulement' })
        const buffer = Buffer.from(m[2], 'base64')
        if (buffer.length === 0 || buffer.length > MAX_CAPTURE) return res.status(400).json({ error: 'Capture trop lourde (3 Mo au plus)' })
        const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg'
        screenshotPath = `${companyId || 'sans-societe'}/${new Date().toISOString().slice(0, 7)}/${id}.${ext}`
        const { error: upErr } = await admin.storage.from('retours').upload(screenshotPath, buffer, { contentType: m[1], upsert: false })
        if (upErr) {
          console.error('[retours] capture non enregistrée', upErr?.statusCode || upErr?.name || 'erreur')
          return res.status(500).json({ error: 'La capture n\'a pas pu être enregistrée (le texte n\'est pas envoyé)' })
        }
      }

      const ligne = {
        id,
        author_id: user.id,
        author_label: clip(profile.display_name || user.email, 200),
        page_path: clip(body.page_path, 500),
        page_title: clip(body.page_title, 200),
        viewport: clip(body.viewport, 40),
        message,
        kind,
        severity,
        screenshot_path: screenshotPath,
      }
      if (companyId) ligne.company_id = companyId
      let { error } = await admin.from('user_feedback').insert(ligne)
      if (error && colonneInconnue(error)) {
        // Avant 0263 : texte et page seulement (le type et la gravité sont repris en tête du texte)
        const { kind: _k, severity: _s, screenshot_path: _p, ...base } = ligne
        const prefixe = kind ? `[${KIND_LABELS[kind]}${severity ? `, ${severity}` : ''}] ` : ''
        ;({ error } = await admin.from('user_feedback').insert({ ...base, message: (prefixe + message).slice(0, 4000) }))
      }
      if (error) {
        if (screenshotPath) await admin.storage.from('retours').remove([screenshotPath])
        throw error
      }

      // Notification réservée au super administrateur (sans le texte du retour)
      const notif = {
        type: 'retour',
        title: `Nouveau retour${kind ? ` (${KIND_LABELS[kind]})` : ''}${severity === 'bloquant' ? ' bloquant' : ''}`,
        message: `${clip(profile.display_name || 'Un utilisateur', 80)}${body.page_title ? ` · ${clip(body.page_title, 80)}` : ''}`,
        link: '/retours',
        metadata: { audience: 'superadmin', feedback_id: id },
      }
      if (companyId) notif.company_id = companyId
      const { error: nErr } = await admin.from('notifications').insert(notif)
      if (nErr) console.error('[retours] notification non créée', nErr?.code || 'erreur')

      return res.status(200).json({ ok: true, id })
    }

    // ── Lecture ──
    if (req.method === 'GET') {
      const q = req.query || {}

      if (q.capture) {
        if (!UUID.test(String(q.capture))) return res.status(400).json({ error: 'Retour invalide' })
        const { data: row } = await admin.from('user_feedback').select('id, author_id, company_id, screenshot_path').eq('id', q.capture).maybeSingle()
        if (!row?.screenshot_path) return res.status(404).json({ error: 'Pas de capture pour ce retour' })
        let autorise = row.author_id === user.id
        if (!autorise && await peutSuivre(req, profile)) {
          autorise = superadmin || (await societesDuCompte(admin, user.id)).includes(row.company_id)
        }
        if (!autorise) return res.status(403).json({ error: 'Cette capture ne fait pas partie de vos accès' })
        const { data, error } = await admin.storage.from('retours').createSignedUrl(row.screenshot_path, 60)
        if (error || !data?.signedUrl) throw error || new Error('lien')
        return res.status(200).json({ url: data.signedUrl })
      }

      if (q.scope === 'tous') {
        if (!(await peutSuivre(req, profile))) return res.status(403).json({ error: 'Le suivi des retours ne fait pas partie de vos accès' })
        let query = admin.from('user_feedback').select(COLONNES).order('created_at', { ascending: false }).limit(500)
        if (!superadmin) {
          const societes = await societesDuCompte(admin, user.id)
          if (societes.length === 0) return res.status(200).json({ items: [] })
          query = query.in('company_id', societes)
        }
        let { data, error } = await query
        if (error && colonneInconnue(error)) {
          let q0 = admin.from('user_feedback').select(COLONNES_0260).order('created_at', { ascending: false }).limit(500)
          if (!superadmin) q0 = q0.in('company_id', await societesDuCompte(admin, user.id))
          ;({ data, error } = await q0)
        }
        if (error) throw error
        return res.status(200).json({ items: (data || []).map(({ screenshot_path: s, ...r }) => ({ ...r, has_screenshot: !!s })) })
      }

      const mine = (cols) => admin.from('user_feedback').select(cols).eq('author_id', user.id)
        .order('created_at', { ascending: false }).limit(100)
      let { data, error } = await mine('id, created_at, page_title, message, kind, severity, screenshot_path, status, response, responded_at, response_read_at')
      if (error && colonneInconnue(error)) ({ data, error } = await mine('id, created_at, page_title, message, status'))
      if (error) throw error
      return res.status(200).json({ items: (data || []).map(({ screenshot_path: s, ...r }) => ({ ...r, has_screenshot: !!s })) })
    }

    // ── PATCH ──
    const body = req.body || {}
    const { id } = body
    if (!id || !UUID.test(String(id))) return res.status(400).json({ error: 'Retour invalide' })
    const { data: row } = await admin.from('user_feedback').select('id, author_id, company_id, status, response').eq('id', id).maybeSingle()
    if (!row) return res.status(404).json({ error: 'Retour introuvable' })

    // L'auteur a lu la réponse
    if (body.read === true && Object.keys(body).every((k) => ['id', 'read'].includes(k))) {
      if (row.author_id !== user.id) return res.status(403).json({ error: 'Ce retour n\'est pas le vôtre' })
      const { error } = await admin.from('user_feedback').update({ response_read_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      return res.status(200).json({ ok: true })
    }

    // Suivi
    if (!(await peutSuivre(req, profile))) return res.status(403).json({ error: 'Le suivi des retours ne fait pas partie de vos accès' })
    if (!superadmin && !(await societesDuCompte(admin, user.id)).includes(row.company_id)) {
      return res.status(403).json({ error: 'Ce retour appartient à une autre société' })
    }
    const maj = { updated_at: new Date().toISOString() }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return res.status(400).json({ error: 'Statut invalide' })
      maj.status = body.status
      const clos = ['fait', 'ecarte'].includes(body.status)
      maj.handled_at = clos ? new Date().toISOString() : null
      maj.handled_by = clos ? user.id : null
    }
    if (body.response !== undefined) {
      const reponse = body.response == null ? '' : String(body.response).trim()
      if (reponse.length > 4000) return res.status(400).json({ error: 'Réponse trop longue (4 000 caractères au plus)' })
      if (reponse !== (row.response || '')) {
        maj.response = reponse || null
        maj.responded_at = reponse ? new Date().toISOString() : null
        maj.responded_by = reponse ? user.id : null
        maj.response_read_at = null
      }
    }
    if (body.notice_id !== undefined) {
      if (body.notice_id !== null && !UUID.test(String(body.notice_id))) return res.status(400).json({ error: 'Nouveauté invalide' })
      if (body.notice_id) {
        const { data: n } = await admin.from('platform_notices').select('id').eq('id', body.notice_id).eq('kind', 'nouveaute').maybeSingle()
        if (!n) return res.status(400).json({ error: 'Nouveauté introuvable' })
      }
      maj.notice_id = body.notice_id || null
    }
    const { error } = await admin.from('user_feedback').update(maj).eq('id', id)
    if (error) throw error
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[retours] échec', req.method, err?.code || 'erreur')
    return res.status(500).json({ error: 'Le retour n\'a pas pu être traité' })
  }
}

export default withErrorLog(handler, 'retours')

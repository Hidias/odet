import crypto from 'node:crypto'
import { getAdminClient, requireRight } from './_lib/auth.js'
import {
  normaliserNir, ecartsNir, finNir, statutInscription, construireFichier, identifiants, nomFichier,
} from '../src/modules/passeport/lib/rules.js'
import { withErrorLog } from './_lib/errors.js'

// Module Passeport de prévention : seule porte d'accès au numéro de sécurité sociale.
//
// Règles :
//  - le numéro est chiffré ici (AES-256-GCM, clé dérivée d'ENCRYPTION_KEY) et déchiffré ici seulement,
//    au moment de fabriquer un fichier ; jamais de clé en base, jamais de déchiffrement dans le navigateur ;
//  - le numéro n'est jamais renvoyé, sauf dans le contenu du fichier demandé par un rôle habilité ;
//    ailleurs : 3 derniers caractères au plus ;
//  - aucun numéro dans les journaux : les erreurs sont journalisées par leur code seulement ;
//  - les fichiers ne sont jamais stockés : ils partent directement dans la réponse.
//
// Actions :
//  portal-state, portal-save (portail stagiaire, sans compte : jeton de session + stagiaire + code individuel
//  si la session en a un) ; staff-save, generate, demo-accuse, reprise-ancien (rôles habilités) ; demo-seed (superadmin).

const MANAGERS = ['superadmin', 'admin', 'direction', 'gestionnaire']
const INFO = 'odet-passeport-nir-v1'

function key() {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw Object.assign(new Error('ENCRYPTION_KEY manquante'), { code: 'NO_KEY' })
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(raw, 'hex'), Buffer.alloc(0), Buffer.from(INFO), 32))
}

function chiffrer(nir) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([c.update(nir, 'utf8'), c.final()])
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`
}

function dechiffrer(payload) {
  const [v, iv, tag, ct] = String(payload || '').split(':')
  if (v !== 'v1') throw Object.assign(new Error('Format inconnu'), { code: 'BAD_FORMAT' })
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}

function logErr(where, e) {
  // Jamais de contenu : seulement l'endroit et le code
  console.error(`[passeport] ${where} : ${e?.code || e?.name || 'erreur'}`)
}

async function moduleOn(admin) {
  const { data } = await admin.from('org_modules').select('enabled').eq('key', 'passeport').maybeSingle()
  return !!data?.enabled
}

async function formatEnVigueur(admin) {
  const { data, error } = await admin.from('pp_format_versions').select('version, contrat, regles')
    .eq('en_vigueur', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error || !data) throw Object.assign(new Error('Format officiel absent'), { code: 'NO_FORMAT' })
  return data
}

// Portail : jeton de session, stagiaire inscrit, code individuel si la session en a un
async function portalCheck(admin, body) {
  const { token, trainee_id, code } = body || {}
  if (!token || !trainee_id) return { status: 400, error: 'Requête incomplète' }
  const { data: s } = await admin.from('sessions').select('id').eq('attendance_token', String(token)).maybeSingle()
  if (!s) return { status: 404, error: 'Session non trouvée' }
  const { data: st } = await admin.from('session_trainees').select('id, access_code, access_code_locked')
    .eq('session_id', s.id).eq('trainee_id', trainee_id).maybeSingle()
  if (!st) return { status: 404, error: 'Stagiaire non trouvé dans cette session' }
  if (st.access_code) {
    if (st.access_code_locked) return { status: 423, error: 'Accès verrouillé' }
    if (!code) return { status: 401, error: 'Code individuel requis' }
    const { data: v, error } = await admin.rpc('verify_trainee_access_code', { p_session_trainee_id: st.id, p_access_code: String(code) })
    if (error || !v?.success) return { status: 401, error: v?.error || 'Code incorrect' }
  }
  return { ok: true, sessionId: s.id, inscriptionId: st.id }
}

async function enregistrerNir(admin, traineeId, nir13, source, by) {
  const { error } = await admin.from('pp_nir').upsert({
    trainee_id: traineeId, nir_chiffre: chiffrer(nir13), fin: finNir(nir13), source, saisi_le: new Date().toISOString(), saisi_par: by || null,
  }, { onConflict: 'trainee_id' })
  if (error) throw Object.assign(new Error('Enregistrement impossible'), { code: error.code })
  await admin.from('trainees').update({ refused_ssn: false }).eq('id', traineeId)
  await admin.from('pp_lignes').update({ corrige_le: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('trainee_id', traineeId).eq('statut', 'rejete')
}

async function etatStagiaire(admin, traineeId) {
  const { data: t } = await admin.from('trainees')
    .select('last_name, gender, nom_naissance, nom_naissance_confirme_le, refused_ssn').eq('id', traineeId).maybeSingle()
  const { data: n } = await admin.from('pp_nir').select('fin').eq('trainee_id', traineeId).maybeSingle()
  return {
    enabled: true,
    nom_naissance: t?.nom_naissance || (t?.last_name || '').toUpperCase(),
    nom_confirme: !!t?.nom_naissance_confirme_le,
    refuse: !!t?.refused_ssn,
    nir_present: !!n,
    fin: n?.fin || null,
  }
}

// ── Fabrication des fichiers ──
async function generer(admin, profile, body) {
  const ids = Array.isArray(body?.inscription_ids) ? body.inscription_ids.filter(Boolean).slice(0, 5000) : []
  const correction = !!body?.correction
  if (!ids.length) return { status: 400, error: 'Aucune inscription sélectionnée' }

  const fmt = await formatEnVigueur(admin)
  const contrat = fmt.contrat
  const { data: rows, error: e1 } = await admin.rpc('pp_donnees', { p_session_ids: null, p_inscription_ids: ids })
  if (e1) throw Object.assign(new Error('Lecture impossible'), { code: e1.code })
  const courseIds = [...new Set((rows || []).map((r) => r.course_id).filter(Boolean))]
  const { data: settingsList } = await admin.from('pp_course_settings').select('*').in('course_id', courseIds.length ? courseIds : ['00000000-0000-0000-0000-000000000000'])
  const settings = Object.fromEntries((settingsList || []).map((s) => [s.course_id, s]))
  const fichierIds = [...new Set((rows || []).map((r) => r.dernier_envoi?.fichier_id).filter(Boolean))]
  const { data: fichiersPrec } = fichierIds.length
    ? await admin.from('pp_fichiers').select('id, marque_non_depose').in('id', fichierIds)
    : { data: [] }
  const nonDepose = new Set((fichiersPrec || []).filter((f) => f.marque_non_depose).map((f) => f.id))
  const traineeIds = [...new Set((rows || []).map((r) => r.trainee_id))]
  const { data: nirs } = await admin.from('pp_nir').select('trainee_id, nir_chiffre').in('trainee_id', traineeIds)
  const nirByTrainee = Object.fromEntries((nirs || []).map((n) => [n.trainee_id, n.nir_chiffre]))
  const { data: org } = await admin.from('organization_settings').select('doc_prefix').limit(1).maybeSingle()

  const retires = []
  const parType = { ADF: [], JDR: [] }
  for (const row of rows || []) {
    const s = settings[row.course_id]
    const st = statutInscription(row, s, contrat)
    const qui = `${row.last_name || ''} ${row.first_name || ''}`.trim()
    const reprise = st.statut === 'genere' && row.dernier_envoi && nonDepose.has(row.dernier_envoi.fichier_id)
    const attendu = correction ? st.statut === 'rejete' : (st.statut === 'a_declarer' || reprise)
    if (!attendu) {
      retires.push({ inscription_id: row.inscription_id, qui, motif: st.motif || (st.statut === 'genere' ? 'Fichier déjà préparé, accusé attendu' : `Statut : ${st.statut}`) })
      continue
    }
    if (st.bloquants.length) {
      retires.push({ inscription_id: row.inscription_id, qui, motif: st.bloquants.map((b) => b.label).join(' ; ') })
      continue
    }
    let nir
    try { nir = dechiffrer(nirByTrainee[row.trainee_id]) } catch (e) {
      logErr('dechiffrement', e)
      retires.push({ inscription_id: row.inscription_id, qui, motif: 'Numéro illisible : à ressaisir' })
      continue
    }
    const n = normaliserNir(nir)
    const ecarts = n.ok ? ecartsNir(n.nir, row) : ['format']
    if (!n.ok || ecarts.length) {
      retires.push({ inscription_id: row.inscription_id, qui, motif: `Numéro incohérent avec la fiche : ${ecarts.join(', ')}` })
      continue
    }
    parType[s.type_decl].push({ row, settings: s, nir: n.nir, reprise })
  }

  const now = new Date()
  const fichiers = []
  for (const type of ['ADF', 'JDR']) {
    const items = parType[type]
    if (!items.length) continue
    // Lignes de déclaration : identifiant de base tiré une seule fois, jamais recalculé
    for (const it of items) {
      const ligne = it.row.ligne
      if (!ligne) {
        const { data: l, error } = await admin.from('pp_lignes').insert({
          session_trainee_id: it.row.inscription_id, session_id: it.row.session_id, trainee_id: it.row.trainee_id,
          type_decl: type, statut: 'genere', tentative: 1,
        }).select('*').single()
        if (error) throw Object.assign(new Error('Ligne impossible'), { code: error.code })
        it.ligne = l
      } else if (it.reprise) {
        it.ligne = ligne
      } else {
        const tentative = (ligne.tentative || 1) + (correction ? 1 : 0)
        const { data: l, error } = await admin.from('pp_lignes')
          .update({ statut: 'genere', tentative, corrige_le: null, updated_at: now.toISOString() })
          .eq('id', ligne.id).select('*').single()
        if (error) throw Object.assign(new Error('Ligne impossible'), { code: error.code })
        it.ligne = l
      }
      Object.assign(it, identifiants(it.ligne.id_unique_base, it.row.reference, it.ligne.tentative, contrat))
    }
    const declarations = new Set(items.map((it) => it.idDeclaration))
    const nom = nomFichier(org?.doc_prefix, type, now, correction, contrat)
    const { data: f, error: ef } = await admin.from('pp_fichiers').insert({
      type_decl: type, version_format: fmt.version, nom, nb_lignes: items.length, nb_declarations: declarations.size,
      correction, selection: { inscriptions: items.length }, genere_par: profile.id,
    }).select('id').single()
    if (ef) throw Object.assign(new Error('Fichier impossible'), { code: ef.code })
    // En mode démonstration, le fichier part avec les données fictives
    if (await demoMode(admin)) await admin.from('demo_records').insert({ tbl: 'pp_fichiers', id: f.id })
    for (const it of items) {
      if (it.reprise) {
        await admin.from('pp_envois').update({ fichier_id: f.id }).eq('id_unique_partenaire', it.idUnique)
      } else {
        const { error } = await admin.from('pp_envois').insert({
          ligne_id: it.ligne.id, fichier_id: f.id, tentative: it.ligne.tentative,
          id_unique_partenaire: it.idUnique, id_declaration: it.idDeclaration,
        })
        if (error) throw Object.assign(new Error('Envoi impossible'), { code: error.code })
      }
    }
    fichiers.push({ id: f.id, type, nom, lignes: items.length, declarations: declarations.size, contenu: construireFichier(type, items, contrat) })
  }
  return { status: 200, body: { fichiers, retires } }
}

// ── Démonstration ──
function hashInt(s) { return parseInt(crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8), 16) }

function nirFictif(t) {
  const sexe = t.gender === 'female' ? '2' : '1'
  const d = t.birth_date ? String(t.birth_date) : '1990-01-15'
  const yy = d.slice(2, 4); const mm = d.slice(5, 7)
  const ordre = String(hashInt(t.id) % 1000).padStart(3, '0')
  // Département 99 et commune 999 : combinaison qui ne désigne aucune personne réelle
  return `${sexe}${yy}${mm}99999${ordre}`
}

async function demoMode(admin) {
  const { data } = await admin.from('organization_settings').select('demo_mode').limit(1).maybeSingle()
  return !!data?.demo_mode
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const body = req.body || {}
  const action = body.action
  let admin
  try { admin = getAdminClient() } catch (e) { logErr('init', e); return res.status(500).json({ error: 'Serveur non configuré' }) }

  try {
    // ── Portail stagiaire ──
    if (action === 'portal-state' || action === 'portal-save') {
      if (!(await moduleOn(admin))) return res.status(200).json({ enabled: false })
      const chk = await portalCheck(admin, body)
      if (!chk.ok) return res.status(chk.status).json({ error: chk.error })
      const traineeId = body.trainee_id
      if (action === 'portal-state') return res.status(200).json(await etatStagiaire(admin, traineeId))

      const nom = String(body.nom_naissance || '').trim()
      if (body.refuse) {
        await admin.from('trainees').update({ refused_ssn: true }).eq('id', traineeId)
        await admin.from('pp_nir').delete().eq('trainee_id', traineeId)
      } else {
        if (!nom) return res.status(400).json({ error: 'Nom de naissance requis' })
        if (body.nir) {
          const n = normaliserNir(body.nir)
          if (!n.ok) return res.status(400).json({ error: n.error })
          // Sexe et date de naissance : ceux de la fiche en cours de saisie s'ils sont fournis, sinon ceux en base
          const { data: t } = await admin.from('trainees').select('gender, birth_date').eq('id', traineeId).maybeSingle()
          const ref = { gender: body.gender || t?.gender, birth_date: body.birth_date || t?.birth_date }
          const ecarts = ecartsNir(n.nir, ref)
          if (ecarts.length) return res.status(400).json({ error: `Vérifiez votre numéro : ${ecarts.join(', ')}` })
          await enregistrerNir(admin, traineeId, n.nir, 'portail', null)
        }
      }
      if (nom) {
        // Le stagiaire saisit lui-même son nom de naissance : il vaut confirmation
        await admin.from('trainees').update({ nom_naissance: nom, nom_naissance_confirme_le: new Date().toISOString() }).eq('id', traineeId)
      }
      return res.status(200).json(await etatStagiaire(admin, traineeId))
    }

    // ── Actions du personnel ──
    const ctx = await requireRight(req, res, 'passeport.declarations.gerer', MANAGERS, MANAGERS)
    if (!ctx) return
    if (!(await moduleOn(admin))) return res.status(403).json({ error: 'Module Passeport de prévention désactivé' })

    if (action === 'staff-save') {
      const traineeId = body.trainee_id
      if (!traineeId) return res.status(400).json({ error: 'Stagiaire manquant' })
      const n = normaliserNir(body.nir)
      if (!n.ok) return res.status(400).json({ error: n.error })
      const { data: t } = await admin.from('trainees').select('gender, birth_date').eq('id', traineeId).maybeSingle()
      if (!t) return res.status(404).json({ error: 'Stagiaire non trouvé' })
      const ecarts = ecartsNir(n.nir, t)
      if (ecarts.length && !body.force) return res.status(409).json({ error: `Numéro incohérent avec la fiche : ${ecarts.join(', ')}`, ecarts })
      await enregistrerNir(admin, traineeId, n.nir, 'fiche', ctx.profile.id)
      return res.status(200).json({ ok: true, fin: finNir(n.nir) })
    }

    // Source unique (décision du 17/10) : les numéros saisis par l'ancien chemin (table trainee_ssn du
    // chantier 2, en clair côté base mais sans aucun accès direct) passent dans pp_nir chiffré, puis sont effacés.
    // { dry: true } : compte seulement. Aucun numéro dans la réponse ni dans les journaux.
    if (action === 'reprise-ancien') {
      const { data: rows, error: e1 } = await admin.from('trainee_ssn').select('trainee_id, ssn')
      if (e1) {
        // Table absente (chantier 2 non appliqué) : rien à reprendre
        if (e1.code === '42P01' || e1.code === 'PGRST205') return res.status(200).json({ en_attente: 0, repris: 0, invalides: 0 })
        throw e1
      }
      const ids = (rows || []).map((r) => r.trainee_id)
      if (body.dry) return res.status(200).json({ en_attente: ids.length })
      const { data: deja } = await admin.from('pp_nir').select('trainee_id').in('trainee_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
      const dejaSet = new Set((deja || []).map((d) => d.trainee_id))
      let repris = 0; let invalides = 0; let doublons = 0
      for (const r of rows || []) {
        if (!dejaSet.has(r.trainee_id)) {
          const n = normaliserNir(r.ssn)
          if (!n.ok) { invalides++; continue }
          await enregistrerNir(admin, r.trainee_id, n.nir, 'fiche', ctx.profile.id)
          repris++
        } else doublons++
        await admin.from('trainee_ssn').delete().eq('trainee_id', r.trainee_id)
        await admin.from('trainees').update({ ssn_present: false }).eq('id', r.trainee_id)
      }
      return res.status(200).json({ en_attente: invalides, repris, deja_dans_le_passeport: doublons, invalides })
    }

    if (action === 'generate') {
      const r = await generer(admin, ctx.profile, body)
      if (r.error) return res.status(r.status).json({ error: r.error })
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json(r.body)
    }

    if (action === 'demo-accuse') {
      if (!(await demoMode(admin))) return res.status(403).json({ error: 'Réservé au mode démonstration' })
      const fmt = await formatEnVigueur(admin)
      const acc = fmt.contrat.accuse
      const { data: f } = await admin.from('pp_fichiers').select('id, nom').eq('id', body.fichier_id).maybeSingle()
      if (!f) return res.status(404).json({ error: 'Fichier non trouvé' })
      const { data: envois } = await admin.from('pp_envois').select('id_unique_partenaire, id_declaration, ligne_id').eq('fichier_id', f.id).order('created_at')
      const ligneIds = (envois || []).map((e) => e.ligne_id)
      const { data: lignes } = await admin.from('pp_lignes').select('id, trainee_id').in('id', ligneIds.length ? ligneIds : ['00000000-0000-0000-0000-000000000000'])
      const traineeOf = Object.fromEntries((lignes || []).map((l) => [l.id, l.trainee_id]))
      const { data: ts } = await admin.from('trainees').select('id, gender').in('id', Object.values(traineeOf).length ? Object.values(traineeOf) : ['00000000-0000-0000-0000-000000000000'])
      const female = new Set((ts || []).filter((t) => t.gender === 'female').map((t) => t.id))
      const rejet = (envois || []).find((e) => female.has(traineeOf[e.ligne_id])) || (envois || [])[0]
      const sep = acc.separateur
      const lines = [acc.colonnes.join(sep)]
      ;(envois || []).forEach((e, i) => {
        const ko = rejet && e.id_unique_partenaire === rejet.id_unique_partenaire
        lines.push([i + 2, e.id_unique_partenaire, e.id_declaration, ko ? acc.echec : acc.succes,
          ko ? 'NIR / NOM' : '', ko ? 'TITU_INCOHERENCE_NIR_NOM' : '',
          ko ? "Le couple Numéro de sécurité sociale / Nom n'existe pas." : ''].join(sep))
      })
      return res.status(200).json({ nom: `accuse_demo_${f.nom}`, contenu: lines.join('\n') + '\n' })
    }

    if (action === 'demo-seed') {
      if (ctx.profile.role !== 'superadmin') return res.status(403).json({ error: 'Réservé au super administrateur' })
      if (!(await demoMode(admin))) return res.status(403).json({ error: 'Réservé au mode démonstration' })
      const { data: demoTrainees } = await admin.from('demo_records').select('id').eq('tbl', 'trainees')
      const demoIds = new Set((demoTrainees || []).map((d) => d.id))
      const { data: rows } = await admin.rpc('pp_donnees', { p_session_ids: null, p_inscription_ids: null })
      const { data: settingsList } = await admin.from('pp_course_settings').select('course_id, declarable')
      const declarable = new Set((settingsList || []).filter((s) => s.declarable).map((s) => s.course_id))
      const vus = new Set()
      let crees = 0; let laisses = 0
      for (const r of rows || []) {
        if (!demoIds.has(r.trainee_id) || !declarable.has(r.course_id) || vus.has(r.trainee_id) || r.nir_present || r.refused_ssn) continue
        vus.add(r.trainee_id)
        // Environ un stagiaire sur huit reste sans numéro, pour montrer le blocage
        if (hashInt(`${r.trainee_id}-manque`) % 8 === 0) { laisses++; continue }
        const t = { id: r.trainee_id, gender: r.gender, birth_date: r.birth_date }
        await enregistrerNir(admin, r.trainee_id, nirFictif(t), 'demo', ctx.profile.id)
        await admin.from('demo_records').insert({ tbl: 'pp_nir', id: r.trainee_id })
        crees++
      }
      return res.status(200).json({ ok: true, crees, laisses_sans_numero: laisses })
    }

    return res.status(400).json({ error: 'Action inconnue' })
  } catch (e) {
    logErr(action || 'action', e)
    return res.status(500).json({ error: e?.code === 'NO_KEY' ? 'Chiffrement non configuré sur le serveur' : 'Erreur du serveur Passeport' })
  }
}

export default withErrorLog(handler, 'passeport')

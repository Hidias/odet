// src/modules/mailing/pages/Mailing.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Page Mailing - l'application
//
//   Liste des campagnes · statistiques · détail · qualité des adresses
//   Création sur un seul écran (MailingComposer)
//   Envoi : côté serveur (api/mailing-cron.js) ou depuis ce navigateur
// ─────────────────────────────────────────────────────────────────────────────

import { apiFetch } from '../../../core/api'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../core/supabase'
import { fetchAllOrThrow as fetchAll, fetchAll as fetchAllResult } from '../../../core/fetchAll'
import { useAuthStore } from '../../../core/store'
import {
  Send, Plus, ArrowLeft, Loader2, Square, Play, RefreshCw, AlertTriangle,
  ShieldAlert, Pause, Copy, Reply, BarChart3, Server, Monitor, Paperclip, Clock,
} from 'lucide-react'
import toast from 'react-hot-toast'
import MailingQualite from '../components/MailingQualite'
import MailingComposer, { senderEmailFor } from '../components/MailingComposer'
import { loadMailingExclusions, getExclusionReason, normNaf } from '../lib/mailingExclusions'
import { applyMailingVars } from '../lib/mailingVars'

import { confirmer } from '../../../ui/Confirm'
// ─── Constantes ───────────────────────────────────────────────────────────────

const STATUS_BADGE = {
  brouillon: 'bg-gray-100 text-gray-600',
  planifiée: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]',
  en_cours:  'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]',
  en_pause:  'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]',
  terminée:  'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]',
  annulée:   'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]',
}
const STATUS_LABEL = {
  brouillon: 'Brouillon', planifiée: 'Programmée', en_cours: 'En cours',
  en_pause: 'En pause', terminée: 'Terminée', annulée: 'Annulée',
}
const SEND_STATUS = {
  pending: { l: 'En attente', c: 'bg-gray-100 text-gray-600' },
  sending: { l: 'En cours',   c: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]' },
  sent:    { l: 'Envoyé',     c: 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' },
  error:   { l: 'Erreur',     c: 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]' },
  skipped: { l: 'Ignoré',     c: 'bg-gray-200 text-gray-600' },
}

const SECTEUR_LABELS = [
  ['5530', 'Campings'], ['5510', 'Hôtels'], ['56', 'Restauration'], ['10', 'Agroalimentaire'],
  ['41', 'Bâtiment'], ['43', 'Travaux spécialisés'], ['49', 'Transport'], ['52', 'Logistique'],
  ['47', 'Commerce détail'], ['46', 'Commerce gros'], ['81', 'Services bâtiment'], ['93', 'Sport & loisirs'],
  ['86', 'Santé'], ['87', 'Médico-social'], ['88', 'Action sociale'], ['84', 'Administration'],
]
const secteurOf = (naf) => {
  const n = normNaf(naf)
  if (!n) return 'Non renseigné'
  const hit = SECTEUR_LABELS.find(([p]) => n.startsWith(p))
  return hit ? hit[1] : `NAF ${n.slice(0, 2)}`
}

const fmtDT = (d) => d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'
const fmtD = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '-'
const pct = (a, b) => b > 0 ? Math.round((a / b) * 1000) / 10 : 0


// Pièce jointe stockée d'une campagne → format attendu par send-mailing-single
async function loadCampaignAttachment(campaign) {
  const att = campaign?.attachment
  if (!att?.path) return null
  const { data, error } = await supabase.storage.from('mailing-attachments').download(att.path)
  if (error || !data) throw new Error('Pièce jointe introuvable')
  const buf = new Uint8Array(await data.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000))
  return { filename: att.filename, base64: btoa(bin), contentType: att.contentType || 'application/octet-stream' }
}

// ─── Statistiques (réponses et désabonnements par secteur / département) ────
function MailingStats() {
  const [loading, setLoading] = useState(true)
  const [bySect, setBySect] = useState([])
  const [byDep, setByDep] = useState([])
  const [totals, setTotals] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [sends, aud] = await Promise.all([
        fetchAll(() => supabase.from('mailing_sends').select('email, replied_at, unsubscribed_at').eq('status', 'sent').not('campaign_id', 'is', null)),
        // Vue sans colonne id : départage sur email (unique, GROUP BY email dans la vue)
        fetchAll(() => supabase.from('mailing_audience_v').select('email, nafs, departements'), { orderBy: 'email' }),
      ])
      const audMap = new Map(aud.map(a => [a.email, a]))
      const sect = {}, dep = {}
      let t = { envoyes: 0, reponses: 0, desabonnes: 0 }
      for (const s of sends) {
        const a = audMap.get(String(s.email || '').trim().toLowerCase())
        const kS = secteurOf((a?.nafs || [])[0])
        const kD = (a?.departements || [])[0] || '-'
        for (const [m, k] of [[sect, kS], [dep, kD]]) {
          m[k] = m[k] || { envoyes: 0, reponses: 0, desabonnes: 0 }
          m[k].envoyes++
          if (s.replied_at) m[k].reponses++
          if (s.unsubscribed_at) m[k].desabonnes++
        }
        t.envoyes++
        if (s.replied_at) t.reponses++
        if (s.unsubscribed_at) t.desabonnes++
      }
      const toRows = (m) => Object.entries(m).map(([k, v]) => ({ k, ...v })).sort((a, b) => b.envoyes - a.envoyes)
      setBySect(toRows(sect)); setByDep(toRows(dep)); setTotals(t)
    } catch (e) {
      toast.error('Statistiques : ' + e.message)
    }
    setLoading(false)
  }

  const Table = ({ title, rows }) => (
    <div className="bg-white border border-gray-200 rounded-ui overflow-hidden">
      <p className="px-4 py-2 bg-gray-50 border-b text-ui font-semibold text-gray-700">{title}</p>
      <table className="w-full text-ui-sm">
        <thead className="text-gray-500"><tr>
          <th className="text-left px-3 py-2"></th><th className="text-right px-3 py-2">Envoyés</th>
          <th className="text-right px-3 py-2">Réponses</th><th className="text-right px-3 py-2">Taux</th>
          <th className="text-right px-3 py-2">Désabo.</th>
        </tr></thead>
        <tbody className="divide-y">
          {rows.slice(0, 15).map(r => (
            <tr key={r.k}>
              <td className="px-3 py-1.5 text-gray-800">{r.k}</td>
              <td className="px-3 py-1.5 text-right">{r.envoyes}</td>
              <td className="px-3 py-1.5 text-right text-[rgb(var(--c-success))]">{r.reponses}</td>
              <td className="px-3 py-1.5 text-right font-medium">{pct(r.reponses, r.envoyes)} %</td>
              <td className="px-3 py-1.5 text-right text-gray-800">{r.desabonnes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
  return (
    <div className="space-y-3">
      {totals && (
        <p className="text-ui-sm text-gray-500">
          Depuis le début : {totals.envoyes} mails envoyés · {totals.reponses} réponses ({pct(totals.reponses, totals.envoyes)} %)
          · {totals.desabonnes} désabonnements ({pct(totals.desabonnes, totals.envoyes)} %).
          Les réponses sont comptées depuis la mise en place du suivi.
        </p>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Table title="Par secteur" rows={bySect} />
        <Table title="Par département" rows={byDep} />
      </div>
    </div>
  )
}


// ═════════════════════════════════════════════════════════════════════════════
// PAGE
// ═════════════════════════════════════════════════════════════════════════════
export default function Mailing() {
  const { user } = useAuthStore()
  const [view, setView] = useState('list') // list | detail | compose | sending | qualite

  const [campaigns, setCampaigns] = useState([])
  const [statsMap, setStatsMap] = useState({})
  const [loadingCampaigns, setLoadingCampaigns] = useState(true)
  const [showStats, setShowStats] = useState(false)

  const [selectedCampaign, setSelectedCampaign] = useState(null)
  const [campaignSends, setCampaignSends] = useState([])
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [sendsFilter, setSendsFilter] = useState('all')

  const [composeInitial, setComposeInitial] = useState({})

  // Envoi depuis le navigateur
  const stopRef = useRef(false)
  const [activeCampaignId, setActiveCampaignId] = useState(null)
  const [activeContext, setActiveContext] = useState(null)
  const [activeAttachment, setActiveAttachment] = useState(null)
  const [progress, setProgress] = useState({ sent: 0, errors: 0, total: 0, current: '', stopped: false, done: false })
  const [busy, setBusy] = useState(false)

  useEffect(() => { loadCampaigns() }, [])

  // Rafraîchissement automatique tant qu'une campagne serveur tourne
  const hasServerActivity = campaigns.some(c => c.send_mode === 'serveur' && ['en_cours', 'planifiée'].includes(c.status))
  useEffect(() => {
    if (!hasServerActivity || !['list', 'detail'].includes(view)) return
    const t = setInterval(() => {
      loadCampaigns(true)
      if (view === 'detail' && selectedCampaign) loadCampaignDetail(selectedCampaign, true)
    }, 30000)
    return () => clearInterval(t)
  }, [hasServerActivity, view, selectedCampaign?.id])

  // ══════════════════════════════════════════════════════════════════════════
  // CHARGEMENT
  // ══════════════════════════════════════════════════════════════════════════
  async function loadCampaigns(silent = false) {
    if (!silent) setLoadingCampaigns(true)
    const [{ data }, { data: stats }] = await Promise.all([
      fetchAllResult(() => supabase.from('mailing_campaigns').select('*').order('created_at', { ascending: false })),
      // Vue sans colonne id : une ligne par campagne (GROUP BY campaign_id)
      fetchAllResult(() => supabase.from('mailing_campaign_stats_v').select('*'), { orderBy: 'campaign_id' }),
    ])
    setCampaigns(data || [])
    setStatsMap(Object.fromEntries((stats || []).map(s => [s.campaign_id, s])))
    setLoadingCampaigns(false)
  }

  async function loadCampaignDetail(campaign, silent = false) {
    if (!silent) { setView('detail'); setLoadingDetail(true) }
    const [{ data: fresh }, sends] = await Promise.all([
      supabase.from('mailing_campaigns').select('*').eq('id', campaign.id).single(),
      fetchAll(() => supabase.from('mailing_sends')
        .select('id, email, company_name, status, sent_at, error_message, unsubscribed_at, replied_at, created_at')
        .eq('campaign_id', campaign.id)
        .order('created_at', { ascending: true })),
    ])
    setSelectedCampaign(fresh || campaign)
    setCampaignSends(sends || [])
    setLoadingDetail(false)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ENVOI DEPUIS LE NAVIGATEUR
  // ══════════════════════════════════════════════════════════════════════════
  async function dropBlockedSends(sends) {
    const excl = await loadMailingExclusions()
    const HARD = ['hidden', 'desabonne', 'bloque', 'invalide']
    const kept = sends.filter(s => !HARD.includes(getExclusionReason(
      { email: s.email, name: s.company_name, source: 'mailing' }, excl, { includeRgpd: true, includePartners: true }
    )))
    const removed = sends.length - kept.length
    if (removed > 0) toast(`${removed} envoi${removed > 1 ? 's' : ''} ignoré${removed > 1 ? 's' : ''} (désabonné, bloqué ou invalide)`, { icon: '' })
    return kept
  }

  async function sendLoop(sends, ctx, attachment) {
    const cadence = Number(ctx.cadence || 180)
    for (let i = 0; i < sends.length; i++) {
      const send = sends[i]
      if (stopRef.current) { setProgress(p => ({ ...p, stopped: true, current: '' })); break }
      setProgress(p => ({ ...p, current: send.company_name || send.email }))
      const vars = send.vars || {}
      try {
        const res = await apiFetch('/api/send-mailing-single', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            send_id: send.id, to: send.email,
            subject: applyMailingVars(ctx.subject, vars),
            body_html: applyMailingVars(ctx.body_html, vars, { html: true }),
            caller: ctx.signature_caller,
            unsubscribe_token: send.unsubscribe_token,
            attachments: attachment ? [attachment] : [],
          }),
        })
        res.ok ? setProgress(p => ({ ...p, sent: p.sent + 1 })) : setProgress(p => ({ ...p, errors: p.errors + 1 }))
      } catch {
        setProgress(p => ({ ...p, errors: p.errors + 1 }))
      }
      if (i < sends.length - 1) await new Promise(r => setTimeout(r, cadence * 1000))
    }
  }

  async function runBrowserSending({ campaign, sends, context, attachment }) {
    stopRef.current = false
    setActiveCampaignId(campaign.id)
    setActiveContext(context)
    setActiveAttachment(attachment || null)
    setProgress({ sent: 0, errors: 0, total: sends.length, current: '', stopped: false, done: false })
    setView('sending')
    await sendLoop(sends, context, attachment)
    if (!stopRef.current) {
      await apiFetch('/api/send-mailing-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaign.id }),
      }).catch(() => {})
      setProgress(p => ({ ...p, done: true, current: '' }))
    }
    loadCampaigns(true)
  }

  // Reprise dans le navigateur (en attente ou erreurs), avec la PJ stockée
  async function resumeInBrowser(campaign, statuses) {
    setBusy(true)
    try {
      if (statuses.includes('error')) {
        await supabase.from('mailing_sends').update({ status: 'pending', error_message: null })
          .eq('campaign_id', campaign.id).eq('status', 'error')
      }
      const { data: sends } = await fetchAllResult(() => supabase
        .from('mailing_sends')
        .select('id, email, company_name, unsubscribe_token, vars')
        .eq('campaign_id', campaign.id).eq('status', 'pending')
        .order('created_at'))
      const ok = await dropBlockedSends(sends || [])
      if (!ok.length) { toast('Aucun envoi à faire'); setBusy(false); return }
      const attachment = await loadCampaignAttachment(campaign).catch(e => { toast.error(e.message); return null })
      await supabase.from('mailing_campaigns')
        .update({ status: 'en_cours', send_mode: 'navigateur', paused_at: null, updated_at: new Date().toISOString() })
        .eq('id', campaign.id)
      setBusy(false)
      await runBrowserSending({
        campaign,
        sends: ok,
        context: { body_html: campaign.body_html, subject: campaign.subject, signature_caller: campaign.signature_caller, cadence: campaign.cadence_seconds || 180 },
        attachment,
      })
    } catch (e) {
      toast.error(e.message)
      setBusy(false)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ACTIONS CAMPAGNE (serveur)
  // ══════════════════════════════════════════════════════════════════════════
  async function updateCampaign(campaign, patch, msg) {
    setBusy(true)
    const { error } = await supabase.from('mailing_campaigns')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', campaign.id)
    setBusy(false)
    if (error) { toast.error(error.message); return false }
    if (msg) toast.success(msg)
    await loadCampaigns(true)
    if (view === 'detail') await loadCampaignDetail(campaign, true)
    return true
  }

  const pauseCampaign = (c) => updateCampaign(c, { status: 'en_pause', paused_at: new Date().toISOString() }, 'Campagne en pause')
  const continueOnServer = (c) => updateCampaign(c, {
    status: 'en_cours', send_mode: 'serveur', paused_at: null, last_error: null,
    next_send_at: new Date().toISOString(), started_at: c.started_at || new Date().toISOString(),
  }, 'Envoi repris par le serveur (1er mail dans la minute)')
  const startNow = (c) => updateCampaign(c, { scheduled_at: new Date().toISOString() }, 'Démarrage dans la minute')
  // Alerte avant action (angles morts B11) : reprendre ou démarrer une campagne envoie à de vrais destinataires
  const confirmerEnvoi = (c, n, quand) => confirmer({
    title: 'Envoyer la campagne',
    message: `${n} mail${n > 1 ? 's' : ''} de « ${c.name} » ${n > 1 ? 'partiront' : 'partira'} ${quand} vers les destinataires de la campagne. Un mail parti ne se reprend pas.`,
    confirmLabel: `Envoyer ${n} mail${n > 1 ? 's' : ''}`,
  })
  async function cancelCampaign(c) {
    if (!await confirmer(`Annuler « ${c.name} » ? Les mails non envoyés ne partiront pas.`)) return
    stopRef.current = true
    await updateCampaign(c, { status: 'annulée' }, 'Campagne annulée')
  }
  async function retryErrorsOnServer(c) {
    setBusy(true)
    const { error } = await supabase.from('mailing_sends')
      .update({ status: 'pending', error_message: null })
      .eq('campaign_id', c.id).eq('status', 'error')
    setBusy(false)
    if (error) { toast.error(error.message); return }
    await continueOnServer(c)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DUPLICATION / RELANCE
  // ══════════════════════════════════════════════════════════════════════════
  async function duplicate(c, { nonRepondants = false } = {}) {
    let attachmentFile = null
    try { attachmentFile = await loadCampaignAttachment(c) } catch { /* PJ absente */ }
    let preselectEmails = null
    if (nonRepondants) {
      const { data } = await fetchAllResult(() => supabase.from('mailing_sends')
        .select('email').eq('campaign_id', c.id).eq('status', 'sent')
        .is('replied_at', null).is('unsubscribed_at', null))
      preselectEmails = (data || []).map(s => s.email)
      if (!preselectEmails.length) { toast('Aucun non-répondant à relancer'); return }
    }
    setComposeInitial({
      name: nonRepondants ? `Relance - ${c.name}` : `${c.name} (copie)`,
      subject: c.subject,
      body_html: c.body_html,
      signature_caller: c.signature_caller,
      cadence_seconds: c.cadence_seconds || 180,
      attachmentFile,
      preselectEmails,
      source_campaign_id: c.id,
      filters: nonRepondants ? {} : (c.filters?.audience || {}),
    })
    setView('compose')
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VUES
  // ══════════════════════════════════════════════════════════════════════════
  if (view === 'qualite') {
    return <MailingQualite user={user} onBack={() => setView('list')} />
  }

  if (view === 'compose') {
    return (
      <MailingComposer
        key={composeInitial.source_campaign_id || 'new'}
        user={user}
        campaigns={campaigns}
        initial={composeInitial}
        onCancel={() => setView('list')}
        onScheduled={(camp) => { loadCampaigns(); loadCampaignDetail(camp) }}
        onLaunchBrowser={runBrowserSending}
      />
    )
  }

  // ── Envoi navigateur ──
  if (view === 'sending') {
    const done = progress.sent + progress.errors
    const p = progress.total > 0 ? Math.round((done / progress.total) * 100) : 0
    const remaining = progress.total - done
    const minutesLeft = Math.ceil(remaining * Number(activeContext?.cadence || 180) / 60)
    const activeCampaign = campaigns.find(c => c.id === activeCampaignId)
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="bg-white rounded-ui shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-6">
            {progress.done ? ' Campagne terminée' : progress.stopped ? ' Envoi arrêté' : ' Envoi en cours…'}
          </h2>
          <div className="w-full bg-gray-100 rounded-full h-3 mb-4">
            <div className="bg-[rgb(var(--c-info))] h-3 rounded-full transition-all duration-500" style={{ width: `${p}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center bg-[rgb(var(--c-info-bg))] rounded-ui-sm p-3"><p className="text-ui-sm text-[rgb(var(--c-info))]">Total</p><p className="text-2xl font-bold text-[rgb(var(--c-info))]">{progress.total}</p></div>
            <div className="text-center bg-[rgb(var(--c-success-bg))] rounded-ui-sm p-3"><p className="text-ui-sm text-[rgb(var(--c-success))]">Envoyés</p><p className="text-2xl font-bold text-[rgb(var(--c-success))]">{progress.sent}</p></div>
            <div className="text-center bg-[rgb(var(--c-danger-bg))] rounded-ui-sm p-3"><p className="text-ui-sm text-[rgb(var(--c-danger))]">Erreurs</p><p className="text-2xl font-bold text-[rgb(var(--c-danger))]">{progress.errors}</p></div>
          </div>
          {progress.current && !progress.done && !progress.stopped && (
            <p className="text-ui text-gray-500 flex items-center gap-2 mb-2">
              <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" /><span className="truncate">{progress.current}</span>
            </p>
          )}
          {!progress.done && !progress.stopped && remaining > 0 && (
            <p className="text-ui-sm text-gray-400 mb-4">Temps restant estimé : ~{minutesLeft} min · ne fermez pas cet onglet</p>
          )}
          {activeAttachment && <p className="text-ui-sm text-gray-500 mb-4"><Paperclip className="w-3.5 h-3.5 inline" /> {activeAttachment.filename}</p>}

          {!progress.done && !progress.stopped && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { stopRef.current = true }}
                className="flex items-center gap-2 px-5 py-2.5 bg-[rgb(var(--c-danger))] hover:bg-[rgb(var(--c-danger))] text-white rounded-ui-sm text-ui font-medium">
                <Square className="w-4 h-4" /> Arrêter
              </button>
              {activeCampaign && (
                <button onClick={async () => { stopRef.current = true; await continueOnServer(activeCampaign); setView('list') }}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-ui-sm text-ui font-medium">
                  <Server className="w-4 h-4" /> Continuer par le serveur
                </button>
              )}
            </div>
          )}

          {(progress.done || progress.stopped) && (
            <div className="space-y-3">
              {progress.done && <p className="text-ui text-gray-500">Rapport de campagne envoyé à <strong>{senderEmailFor(activeContext?.signature_caller) || '-'}</strong>.</p>}
              {progress.stopped && activeCampaign && (
                <button onClick={() => { continueOnServer(activeCampaign); setView('list') }}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[rgb(var(--c-info))] hover:bg-[rgb(var(--c-info))] text-white rounded-ui-sm text-ui font-medium">
                  <Server className="w-4 h-4" /> Terminer l'envoi par le serveur
                </button>
              )}
              <button onClick={() => { setView('list'); loadCampaigns() }}
                className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-ui-sm text-ui font-medium">
                <ArrowLeft className="w-4 h-4" /> Retour à la liste
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Détail ──
  if (view === 'detail' && selectedCampaign) {
    const c = selectedCampaign
    const st = statsMap[c.id] || {}
    const count = (fn) => campaignSends.filter(fn).length
    const nSent = count(s => s.status === 'sent')
    const nErr = count(s => s.status === 'error')
    const nPending = count(s => s.status === 'pending' || s.status === 'sending')
    const nSkipped = count(s => s.status === 'skipped')
    const nReplied = count(s => s.replied_at)
    const nUnsub = count(s => s.unsubscribed_at)
    const total = campaignSends.length
    const doneP = total ? Math.round(((total - nPending) / total) * 100) : 0

    const filteredSends = campaignSends.filter(s => {
      if (sendsFilter === 'sent') return s.status === 'sent'
      if (sendsFilter === 'replied') return !!s.replied_at
      if (sendsFilter === 'error') return s.status === 'error'
      if (sendsFilter === 'skipped') return s.status === 'skipped'
      if (sendsFilter === 'pending') return s.status === 'pending' || s.status === 'sending'
      if (sendsFilter === 'unsubscribed') return !!s.unsubscribed_at
      return true
    })

    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => { setView('list'); setSelectedCampaign(null) }} className="text-gray-500 hover:text-gray-700"><ArrowLeft className="w-5 h-5" /></button>
          <h1 className="text-xl font-bold text-gray-900 truncate">{c.name}</h1>
          <span className={`px-2.5 py-1 rounded-full text-ui-sm font-medium ${STATUS_BADGE[c.status] || 'bg-gray-100 text-gray-600'}`}>{STATUS_LABEL[c.status] || c.status}</span>
          <span className="text-ui-sm text-gray-400 flex items-center gap-1">{c.send_mode === 'serveur' ? <><Server className="w-3.5 h-3.5" /> serveur</> : <><Monitor className="w-3.5 h-3.5" /> navigateur</>}</span>
          <button onClick={() => loadCampaignDetail(c)} className="ml-auto p-2 text-gray-400 hover:text-gray-700" title="Rafraîchir"><RefreshCw className="w-4 h-4" /></button>
        </div>

        <div className="bg-white rounded-ui border border-gray-200 p-5 space-y-4">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {[
              ['Total', total, 'text-gray-900'], ['Envoyés', nSent, 'text-[rgb(var(--c-success))]'], ['Réponses', nReplied, 'text-[rgb(var(--c-success))]'],
              ['Erreurs', nErr, 'text-[rgb(var(--c-danger))]'], ['En attente', nPending, 'text-[rgb(var(--c-info))]'], ['Désabonnés', nUnsub, 'text-gray-800'],
            ].map(([l, v, cl]) => (
              <div key={l} className="text-center"><p className="text-ui-sm text-gray-500">{l}</p><p className={`text-2xl font-bold ${cl}`}>{v}</p></div>
            ))}
          </div>
          {['en_cours', 'en_pause', 'planifiée'].includes(c.status) && (
            <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-[rgb(var(--c-info))] h-2 rounded-full" style={{ width: `${doneP}%` }} /></div>
          )}

          <div className="text-ui text-gray-600 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
            <p><span className="text-gray-400">Objet :</span> {c.subject}</p>
            <p><span className="text-gray-400">Expéditeur :</span> {c.sender_email}</p>
            <p><span className="text-gray-400">Créée le :</span> {fmtDT(c.created_at)}</p>
            {c.status === 'planifiée' && <p><span className="text-gray-400">Départ programmé :</span> <strong>{fmtDT(c.scheduled_at)}</strong></p>}
            {c.status === 'en_cours' && c.send_mode === 'serveur' && <p><span className="text-gray-400">Prochain envoi :</span> {fmtDT(c.next_send_at)} · cadence {c.cadence_seconds} s</p>}
            {c.completed_at && <p><span className="text-gray-400">Terminée le :</span> {fmtDT(c.completed_at)}</p>}
            {c.attachment?.filename && <p><span className="text-gray-400">Pièce jointe :</span> <Paperclip className="w-3.5 h-3.5 inline" /> {c.attachment.filename}</p>}
            {nSkipped > 0 && <p><span className="text-gray-400">Ignorés :</span> {nSkipped} (désabonnés ou bloqués pendant l'envoi)</p>}
            {st.dernier_envoi && <p><span className="text-gray-400">Dernier envoi :</span> {fmtDT(st.dernier_envoi)}</p>}
          </div>
          {c.last_error && <p className="text-ui-sm text-[rgb(var(--c-danger))] bg-[rgb(var(--c-danger-bg))] border border-[rgb(var(--c-danger)/0.3)] rounded-ui-sm px-3 py-2"> {c.last_error}</p>}

          <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
            {c.status === 'planifiée' && (
              <button onClick={async () => { if (await confirmerEnvoi(c, nPending, 'dans la minute')) startNow(c) }} disabled={busy} className="flex items-center gap-2 px-3 py-2 bg-[rgb(var(--c-info))] hover:bg-[rgb(var(--c-info))] text-white rounded-ui-sm text-ui disabled:opacity-50"><Play className="w-4 h-4" /> Démarrer maintenant</button>
            )}
            {c.status === 'en_cours' && c.send_mode === 'serveur' && (
              <button onClick={() => pauseCampaign(c)} disabled={busy} className="flex items-center gap-2 px-3 py-2 bg-[rgb(var(--c-warning))] hover:bg-[rgb(var(--c-warning))] text-white rounded-ui-sm text-ui disabled:opacity-50"><Pause className="w-4 h-4" /> Pause</button>
            )}
            {(c.status === 'en_pause' || (c.status === 'en_cours' && c.send_mode !== 'serveur')) && nPending > 0 && (
              <button onClick={async () => { if (await confirmerEnvoi(c, nPending, 'au rythme de la campagne')) continueOnServer(c) }} disabled={busy} className="flex items-center gap-2 px-3 py-2 bg-[rgb(var(--c-info))] hover:bg-[rgb(var(--c-info))] text-white rounded-ui-sm text-ui disabled:opacity-50"><Server className="w-4 h-4" /> Continuer par le serveur ({nPending})</button>
            )}
            {['en_cours', 'en_pause'].includes(c.status) && c.send_mode !== 'serveur' && nPending > 0 && (
              <button onClick={async () => { if (await confirmerEnvoi(c, nPending, 'depuis ce navigateur')) resumeInBrowser(c, ['pending']) }} disabled={busy} className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-ui-sm text-ui disabled:opacity-50"><Monitor className="w-4 h-4" /> Continuer dans ce navigateur</button>
            )}
            {nErr > 0 && (
              <>
                <button onClick={async () => { if (await confirmerEnvoi(c, nErr, 'au rythme de la campagne')) retryErrorsOnServer(c) }} disabled={busy} className="flex items-center gap-2 px-3 py-2 bg-[rgb(var(--c-warning-bg))] hover:bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] rounded-ui-sm text-ui disabled:opacity-50"><RefreshCw className="w-4 h-4" /> Re-tenter {nErr} erreur{nErr > 1 ? 's' : ''} (serveur)</button>
                <button onClick={async () => { if (await confirmerEnvoi(c, nErr, 'depuis ce navigateur')) resumeInBrowser(c, ['error']) }} disabled={busy} className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-ui-sm text-ui disabled:opacity-50"><Monitor className="w-4 h-4" /> Re-tenter ici</button>
              </>
            )}
            <button onClick={() => duplicate(c)} className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-ui-sm text-ui"><Copy className="w-4 h-4" /> Dupliquer</button>
            {nSent > 0 && (
              <button onClick={() => duplicate(c, { nonRepondants: true })} className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-ui-sm text-ui"><Reply className="w-4 h-4" /> Relancer les non-répondants</button>
            )}
            {['en_cours', 'en_pause', 'planifiée'].includes(c.status) && (
              <button onClick={() => cancelCampaign(c)} disabled={busy} className="flex items-center gap-2 px-3 py-2 bg-[rgb(var(--c-danger-bg))] hover:bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))] rounded-ui-sm text-ui disabled:opacity-50"><AlertTriangle className="w-4 h-4" /> Annuler</button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            ['all', `Tous (${total})`], ['sent', `Envoyés (${nSent})`], ['replied', `Réponses (${nReplied})`],
            ['pending', `En attente (${nPending})`], ['error', `Erreurs (${nErr})`], ['skipped', `Ignorés (${nSkipped})`],
            ['unsubscribed', `Désabonnés (${nUnsub})`],
          ].map(([v, l]) => (
            <button key={v} onClick={() => setSendsFilter(v)}
              className={`px-3 py-1.5 rounded-full text-ui-sm font-medium ${sendsFilter === v ? 'bg-[rgb(var(--c-info))] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{l}</button>
          ))}
        </div>

        {loadingDetail ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : (
          <div className="bg-white rounded-ui border border-gray-200 overflow-hidden">
            <table className="w-full text-ui">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Entreprise</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Email</th>
                  <th className="text-center px-4 py-3 text-gray-500 font-medium">Statut</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Détail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSends.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-ui text-gray-400">Aucun résultat</td></tr>
                ) : filteredSends.map(s => {
                  const ss = SEND_STATUS[s.status] || { l: s.status, c: 'bg-gray-100 text-gray-600' }
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-900 font-medium">{s.company_name || '-'}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-ui-sm">{s.email}</td>
                      <td className="px-4 py-2.5 text-center space-x-1 whitespace-nowrap">
                        {s.unsubscribed_at
                          ? <span className="px-2 py-0.5 rounded-full text-ui-sm bg-gray-100 text-gray-800">Désabonné</span>
                          : <span className={`px-2 py-0.5 rounded-full text-ui-sm ${ss.c}`}>{ss.l}</span>}
                        {s.replied_at && <span className="px-2 py-0.5 rounded-full text-ui-sm bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]">↩ Réponse</span>}
                      </td>
                      <td className="px-4 py-2.5 text-ui-sm text-gray-400 max-w-xs truncate">
                        {s.error_message
                          || (s.replied_at ? `Réponse le ${fmtD(s.replied_at)}` : '')
                          || (s.unsubscribed_at ? `Désabonné le ${fmtD(s.unsubscribed_at)}` : '')
                          || (s.sent_at ? `Envoyé le ${fmtDT(s.sent_at)}` : '')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // ── Liste ──
  const doneCamps = campaigns.filter(c => ['terminée', 'en_cours', 'en_pause', 'annulée'].includes(c.status))
  const kpi = doneCamps.reduce((a, c) => {
    const s = statsMap[c.id] || {}
    a.sent += s.envoyes || 0; a.replies += s.reponses || 0; a.unsub += s.desabonnes || 0; a.err += s.erreurs || 0
    return a
  }, { sent: 0, replies: 0, unsub: 0, err: 0 })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Mailing</h1>
          <p className="text-ui text-gray-500 mt-1">Campagnes d&apos;emails de prospection</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowStats(s => !s)}
            className={`flex items-center gap-2 px-4 py-2.5 border rounded-ui-sm text-ui font-medium ${showStats ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
            <BarChart3 className="w-4 h-4" /> Statistiques
          </button>
          <button onClick={() => setView('qualite')}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-ui-sm text-ui font-medium">
            <ShieldAlert className="w-4 h-4" /> Qualité des adresses
          </button>
          <button onClick={() => { setComposeInitial({}); setView('compose') }}
            className="flex items-center gap-2 px-5 py-2.5 bg-[rgb(var(--c-info))] hover:bg-[rgb(var(--c-info))] text-white rounded-ui-sm text-ui font-medium">
            <Plus className="w-4 h-4" /> Nouvelle campagne
          </button>
        </div>
      </div>

      {campaigns.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white border border-gray-200 rounded-ui p-4 text-center"><p className="text-ui-sm text-gray-500">Campagnes</p><p className="text-2xl font-bold text-gray-900">{campaigns.length}</p></div>
          <div className="bg-white border border-gray-200 rounded-ui p-4 text-center"><p className="text-ui-sm text-gray-500">Emails envoyés</p><p className="text-2xl font-bold text-[rgb(var(--c-success))]">{kpi.sent.toLocaleString('fr-FR')}</p></div>
          <div className="bg-white border border-gray-200 rounded-ui p-4 text-center"><p className="text-ui-sm text-gray-500">Réponses</p><p className="text-2xl font-bold text-[rgb(var(--c-success))]">{kpi.replies} <span className="text-ui font-normal text-gray-400">({pct(kpi.replies, kpi.sent)} %)</span></p></div>
          <div className="bg-white border border-gray-200 rounded-ui p-4 text-center"><p className="text-ui-sm text-gray-500">Désabonnements</p><p className="text-2xl font-bold text-gray-800">{kpi.unsub} <span className="text-ui font-normal text-gray-400">({pct(kpi.unsub, kpi.sent)} %)</span></p></div>
        </div>
      )}

      {showStats && <MailingStats />}

      {loadingCampaigns ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : campaigns.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-200 rounded-ui p-12 text-center">
          <Send className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Aucune campagne. Crée-en une pour commencer.</p>
        </div>
      ) : (
        <div className="bg-white rounded-ui shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-ui">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">Campagne</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium hidden sm:table-cell">Expéditeur</th>
                <th className="text-center px-4 py-3 text-gray-500 font-medium">Statut</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Envoyés</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium hidden md:table-cell">Réponses</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium hidden md:table-cell">Désabo.</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium">Erreurs</th>
                <th className="text-right px-4 py-3 text-gray-500 font-medium hidden lg:table-cell">Date</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {campaigns.map(c => {
                const s = statsMap[c.id] || {}
                const total = s.total ?? c.total_recipients ?? 0
                return (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => loadCampaignDetail(c)}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{c.name}</p>
                      <p className="text-ui-sm text-gray-400 truncate max-w-xs">{c.subject}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-ui-sm hidden sm:table-cell">{c.signature_caller}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded-full text-ui-sm font-medium ${STATUS_BADGE[c.status] || 'bg-gray-100 text-gray-600'}`}>{STATUS_LABEL[c.status] || c.status}</span>
                      {c.status === 'planifiée' && <p className="text-ui-sm text-[rgb(var(--c-info))] mt-1"><Clock className="w-3 h-3 inline" /> {fmtDT(c.scheduled_at)}</p>}
                      {c.status === 'en_cours' && c.send_mode === 'serveur' && <p className="text-ui-sm text-[rgb(var(--c-info))] mt-1"><Server className="w-3 h-3 inline" /> serveur</p>}
                      {c.last_error && <p className="text-ui-sm text-[rgb(var(--c-danger))] mt-1" title={c.last_error}> erreur</p>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-[rgb(var(--c-success))]">{s.envoyes ?? c.sent_count ?? 0}<span className="text-gray-300 font-normal">/{total}</span></td>
                    <td className="px-4 py-3 text-right text-[rgb(var(--c-success))] hidden md:table-cell">{s.reponses || '-'}</td>
                    <td className="px-4 py-3 text-right text-gray-800 hidden md:table-cell">{s.desabonnes || '-'}</td>
                    <td className="px-4 py-3 text-right text-[rgb(var(--c-danger))]">{(s.erreurs ?? c.error_count) > 0 ? (s.erreurs ?? c.error_count) : '-'}</td>
                    <td className="px-4 py-3 text-right text-ui-sm text-gray-400 hidden lg:table-cell">{fmtD(c.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={e => { e.stopPropagation(); duplicate(c) }} title="Dupliquer" className="p-1.5 text-gray-400 hover:text-gray-700"><Copy className="w-4 h-4" /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

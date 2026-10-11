import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'
import FullscreenSignaturePad from '../../../ui/signature/FullscreenSignaturePad'
import {
  ArrowLeft, Check, Clock, PenLine, RefreshCw, WifiOff, UploadCloud,
  UserX, ChevronRight, Users, AlertCircle, HelpCircle, X,
} from 'lucide-react'
import toast from 'react-hot-toast'

// ═══════════════════════════════════════════════════════════════
// SignatureFormateur — page mobile ouverte par le QR code formateur
//
// Le formateur est connecté à Campus. Il tend son téléphone au
// stagiaire, qui signe en plein écran. Rien d'autre.
//
//   • demi-journée du jour choisie automatiquement (13h = bascule)
//   • régularisation possible sur les demi-journées déjà passées
//   • enchaînement automatique vers le stagiaire suivant
//   • sans réseau : la signature est gardée sur le téléphone puis
//     envoyée dès le retour du réseau (heure réelle conservée)
//   • stagiaire qui ne peut pas signer : signature par un tiers
// ═══════════════════════════════════════════════════════════════

const QUEUE_KEY = 'afm_signature_queue'

const TRAINER_NAMES = {
  'hicham.saidi@accessformation.pro': 'Hicham SAIDI',
  'maxime.langlais@accessformation.pro': 'Maxime LANGLAIS',
}

const PROXY_REASONS = [
  'Handicap',
  'Blessure / plâtre',
  'Difficulté à écrire',
  'Autre',
]

const fmtDate = (iso) => {
  if (!iso) return ''
  const [y, m, d] = String(iso).substring(0, 10).split('-')
  return `${d}/${m}/${y}`
}
const fmtHeure = (ts) => {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`
}
const periodLabel = (p) => (p === 'afternoon' ? 'Après-midi' : 'Matin')

// ─── File d'attente locale (hors réseau) ─────────────────────
const readQueue = () => {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch { return [] }
}
const writeQueue = (items) => {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(items)) } catch { /* stockage plein */ }
}

export default function SignatureFormateur() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [slot, setSlot] = useState(null)          // { date, period }
  const [signing, setSigning] = useState(null)    // stagiaire en cours de signature
  const [done, setDone] = useState(null)          // { trainee, next }
  const [queue, setQueue] = useState(readQueue())
  const [online, setOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [proxy, setProxy] = useState(null)        // assistant « ne peut pas signer »
  const [showHelp, setShowHelp] = useState(false)
  const slotRef = useRef(null)

  const trainerName = TRAINER_NAMES[(user?.email || '').toLowerCase()] || user?.email || 'Formateur'
  const validatedBy = `Signature sur téléphone – ${trainerName}`

  // ─── Chargement ────────────────────────────────────────────
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const { data: res, error: err } = await supabase.rpc('get_trainer_sign_data', { p_session_id: sessionId })
    if (err) {
      setError(err.message)
    } else if (!res?.ok) {
      setError(res?.error || 'Session introuvable')
    } else {
      setError(null)
      setData(res)
      if (!slotRef.current) {
        const today = res.today
        const dispo = (res.half_days || []).filter(h => h.date <= today)
        const duJour = dispo.filter(h => h.date === today)
        let choisi = null
        if (duJour.length === 1) choisi = duJour[0]
        else if (duJour.length > 1) {
          const apresMidi = (res.now_time || '00:00') >= '13:00'
          choisi = duJour.find(h => h.period === (apresMidi ? 'afternoon' : 'morning')) || duJour[0]
        } else {
          choisi = dispo[dispo.length - 1] || (res.half_days || [])[0] || null
        }
        slotRef.current = choisi
        setSlot(choisi)
      }
    }
    setLoading(false)
  }, [sessionId])

  useEffect(() => { load() }, [load])

  // ─── Réseau ────────────────────────────────────────────────
  useEffect(() => {
    const up = () => { setOnline(true); syncQueue() }
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    const timer = setInterval(() => { if (readQueue().length > 0) syncQueue() }, 30000)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const avant = (e) => {
      if (readQueue().length > 0) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', avant)
    return () => window.removeEventListener('beforeunload', avant)
  }, [])

  // ─── Envoi d'une signature (ou mise en attente) ────────────
  const sendEntry = async (entry) => {
    if (entry.kind === 'proxy') {
      const { data: res, error: err } = await supabase.rpc('trainer_proxy_sign', {
        p_session_id: entry.session_id,
        p_trainee_id: entry.trainee_id,
        p_date: entry.date,
        p_period: entry.period,
        p_reason: entry.reason,
        p_proxy_last_name: entry.proxy_last_name,
        p_proxy_first_name: entry.proxy_first_name,
        p_proxy_role: entry.proxy_role,
        p_proxy_signature: entry.signature,
        p_trainer_signature: entry.trainer_signature,
        p_validated_by: entry.validated_by,
      })
      if (err) throw err
      return res
    }
    const { data: res, error: err } = await supabase.rpc('trainer_sign_halfday', {
      p_session_id: entry.session_id,
      p_trainee_id: entry.trainee_id,
      p_date: entry.date,
      p_period: entry.period,
      p_signature: entry.signature,
      p_signed_at: entry.signed_at,
      p_validated_by: entry.validated_by,
    })
    if (err) throw err
    return res
  }

  const syncQueue = async () => {
    const items = readQueue()
    if (items.length === 0 || syncing) return
    setSyncing(true)
    const restants = []
    let envoyees = 0
    for (const entry of items) {
      try {
        const res = await sendEntry(entry)
        if (res?.ok) envoyees++
        else toast.error(`${entry.trainee_label} : ${res?.error || 'refusé'}`, { duration: 6000 })
      } catch {
        restants.push(entry) // problème de réseau : on garde pour plus tard
      }
    }
    writeQueue(restants)
    setQueue(restants)
    setSyncing(false)
    if (envoyees > 0) {
      toast.success(envoyees === 1 ? 'Signature envoyée' : `${envoyees} signatures envoyées`)
      load(true)
    }
    return restants.length
  }

  const enregistrer = async (entry) => {
    try {
      const res = await sendEntry(entry)
      if (res?.ok) return { ok: true }
      return { ok: false, error: res?.error || 'Refusé' }
    } catch {
      const items = [...readQueue(), entry]
      writeQueue(items)
      setQueue(items)
      return { ok: true, differe: true }
    }
  }

  // ─── Données dérivées ──────────────────────────────────────
  const halfDays = (data?.half_days || []).filter(h => h.date <= (data?.today || h.date))
  const statutDe = (t) => {
    if (!slot) return 'vide'
    const enAttente = queue.some(q => q.trainee_id === t.trainee_id && q.date === slot.date && q.period === slot.period)
    if (enAttente) return 'attente'
    const hd = (t.half_days || []).find(h => h.date === slot.date && h.period === slot.period)
    return hd?.statut || 'vide'
  }
  const heureDe = (t) => {
    const hd = (t.half_days || []).find(h => h.date === slot?.date && h.period === slot?.period)
    return fmtHeure(hd?.signed_at)
  }
  const trainees = data?.trainees || []
  const signables = trainees.filter(t => !t.absent && !['signe', 'tiers', 'attente'].includes(statutDe(t)))
  const nbSignes = trainees.filter(t => ['signe', 'tiers', 'attente'].includes(statutDe(t))).length
  const nbAttendus = trainees.filter(t => !t.absent).length

  const prochain = (apres) => signables.find(t => t.trainee_id !== apres?.trainee_id) || null

  // ─── Validation d'une signature stagiaire ──────────────────
  const onSigned = async (image) => {
    const t = signing
    setSigning(null)
    const entry = {
      kind: 'sign',
      session_id: sessionId,
      trainee_id: t.trainee_id,
      trainee_label: `${t.first_name} ${(t.last_name || '').toUpperCase()}`,
      date: slot.date,
      period: slot.period,
      signature: image,
      signed_at: new Date().toISOString(),
      validated_by: validatedBy,
    }
    const res = await enregistrer(entry)
    if (!res.ok) { toast.error(res.error); return }
    if (res.differe) {
      toast('Signature gardée sur le téléphone, envoi au retour du réseau', { icon: '📶' })
    }
    await load(true)
    setDone({ trainee: t, next: prochain(t), differe: res.differe })
  }

  // ─── Validation de la signature par un tiers ───────────────
  const onProxySigned = async (image, etape) => {
    if (etape === 'tiers') {
      setProxy(p => ({ ...p, proxySignature: image, step: 4 }))
      return
    }
    const p = proxy
    const entry = {
      kind: 'proxy',
      session_id: sessionId,
      trainee_id: p.trainee.trainee_id,
      trainee_label: `${p.trainee.first_name} ${(p.trainee.last_name || '').toUpperCase()}`,
      date: slot.date,
      period: slot.period,
      reason: p.reason === 'Autre' ? (p.reasonLibre || 'Autre') : p.reason,
      proxy_last_name: p.lastName,
      proxy_first_name: p.firstName,
      proxy_role: p.role,
      signature: p.proxySignature,
      trainer_signature: image,
      validated_by: validatedBy,
    }
    setProxy(null)
    const res = await enregistrer(entry)
    if (!res.ok) { toast.error(res.error); return }
    if (res.differe) toast('Signature gardée sur le téléphone, envoi au retour du réseau', { icon: '📶' })
    await load(true)
    setDone({ trainee: p.trainee, next: prochain(p.trainee), differe: res.differe })
  }

  // ═══════════════════════════════════════════════════════════
  // AFFICHAGE
  // ═══════════════════════════════════════════════════════════
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mb-3" />
        <p className="text-gray-800 font-medium mb-4">{error}</p>
        <button onClick={() => navigate(`/sessions/${sessionId}`)} className="btn btn-primary">
          Retour à la session
        </button>
      </div>
    )
  }

  // Pad stagiaire
  if (signing && slot) {
    return (
      <FullscreenSignaturePad
        title={`${signing.first_name} ${(signing.last_name || '').toUpperCase()}`}
        subtitle={`${periodLabel(slot.period)} du ${fmtDate(slot.date)} — ${data.session.course || 'Formation'}`}
        onValidate={onSigned}
        onCancel={() => setSigning(null)}
      />
    )
  }

  // Pad tiers / formateur
  if (proxy?.step === 3) {
    return (
      <FullscreenSignaturePad
        title={`${proxy.firstName} ${proxy.lastName.toUpperCase()}`}
        subtitle={`Signe pour ${proxy.trainee.first_name} ${(proxy.trainee.last_name || '').toUpperCase()} — ${periodLabel(slot.period)} du ${fmtDate(slot.date)}`}
        confirmLabel="Je signe"
        onValidate={(img) => onProxySigned(img, 'tiers')}
        onCancel={() => setProxy(p => ({ ...p, step: 2 }))}
      />
    )
  }
  if (proxy?.step === 4) {
    return (
      <FullscreenSignaturePad
        title={trainerName}
        subtitle="Contresignature du formateur"
        confirmLabel="Je contresigne"
        onValidate={(img) => onProxySigned(img, 'formateur')}
        onCancel={() => setProxy(p => ({ ...p, step: 3 }))}
      />
    )
  }

  const session = data.session

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* En-tête */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(`/sessions/${sessionId}`)} className="p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-gray-900 truncate">{session.course || 'Formation'}</p>
            <p className="text-xs text-gray-500 truncate">{session.client} · {session.location || ''}</p>
          </div>
          <button onClick={() => setShowHelp(true)} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="Aide">
            <HelpCircle className="w-5 h-5" />
          </button>
          <button onClick={() => load()} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="Actualiser">
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {/* Demi-journée */}
        <div className="px-4 pb-3 flex gap-2 overflow-x-auto">
          {halfDays.map(h => {
            const actif = slot && h.date === slot.date && h.period === slot.period
            const aujourdhui = h.date === data.today
            return (
              <button
                key={`${h.date}_${h.period}`}
                onClick={() => { slotRef.current = h; setSlot(h) }}
                className={`px-3 py-2 rounded-xl text-sm whitespace-nowrap border ${
                  actif ? 'bg-primary-600 text-white border-primary-600 font-semibold'
                        : 'bg-white text-gray-600 border-gray-200'}`}
              >
                {aujourdhui ? "Aujourd'hui" : fmtDate(h.date)} · {h.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Bandeaux */}
      {!online && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-2 text-amber-800 text-sm">
          <WifiOff className="w-4 h-4 flex-shrink-0" />
          Pas de réseau : les signatures sont gardées sur le téléphone et partiront toutes seules.
        </div>
      )}
      {queue.length > 0 && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-between gap-2 text-blue-800 text-sm">
          <span className="flex items-center gap-2">
            <UploadCloud className="w-4 h-4 flex-shrink-0" />
            {queue.length} signature{queue.length > 1 ? 's' : ''} en attente d'envoi
          </span>
          <button onClick={syncQueue} disabled={syncing} className="underline font-medium disabled:opacity-50">
            {syncing ? 'Envoi…' : 'Réessayer'}
          </button>
        </div>
      )}
      {slot && slot.date !== data.today && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-purple-50 border border-purple-200 text-purple-800 text-sm">
          Régularisation d'une demi-journée passée. L'heure réelle de signature est enregistrée.
        </div>
      )}

      {/* Compteur */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <p className="text-sm text-gray-500 flex items-center gap-1.5">
          <Users className="w-4 h-4" />
          {slot ? `${periodLabel(slot.period)} du ${fmtDate(slot.date)}` : 'Aucune demi-journée'}
        </p>
        <p className="text-sm font-semibold text-gray-700">{nbSignes}/{nbAttendus} signés</p>
      </div>

      {/* Liste des stagiaires */}
      <div className="px-3 space-y-2">
        {trainees.length === 0 && (
          <p className="text-center text-gray-400 py-10">Aucun stagiaire inscrit</p>
        )}
        {trainees.map(t => {
          const statut = statutDe(t)
          const signe = statut === 'signe' || statut === 'tiers' || statut === 'attente'
          const nom = `${t.first_name} ${(t.last_name || '').toUpperCase()}`
          return (
            <div
              key={t.trainee_id}
              className={`rounded-2xl border p-4 flex items-center gap-3 ${
                t.absent ? 'bg-gray-100 border-gray-200 opacity-70'
                : signe ? 'bg-green-50 border-green-200'
                : 'bg-white border-gray-200'}`}
            >
              <button
                disabled={t.absent || signe || !slot}
                onClick={() => setSigning(t)}
                className="flex-1 text-left disabled:cursor-default"
              >
                <p className="text-lg font-semibold text-gray-900">{nom}</p>
                <p className="text-sm mt-0.5">
                  {t.absent ? (
                    <span className="text-gray-500 flex items-center gap-1"><UserX className="w-4 h-4" /> Absent sur cette session</span>
                  ) : statut === 'attente' ? (
                    <span className="text-blue-700 flex items-center gap-1"><UploadCloud className="w-4 h-4" /> Signé, envoi en attente</span>
                  ) : statut === 'tiers' ? (
                    <span className="text-green-700 flex items-center gap-1"><Check className="w-4 h-4" /> Signé par un tiers {heureDe(t)}</span>
                  ) : statut === 'signe' ? (
                    <span className="text-green-700 flex items-center gap-1"><Check className="w-4 h-4" /> Signé à {heureDe(t)}</span>
                  ) : statut === 'valide' ? (
                    <span className="text-blue-700 flex items-center gap-1"><Clock className="w-4 h-4" /> Présence validée, signature à recueillir</span>
                  ) : (
                    <span className="text-gray-500">À signer</span>
                  )}
                </p>
              </button>

              {!t.absent && !signe && slot && (
                <button
                  onClick={() => setSigning(t)}
                  className="px-4 py-3 rounded-xl bg-primary-600 text-white font-semibold flex items-center gap-1.5"
                >
                  <PenLine className="w-4 h-4" /> Signer
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Ne peut pas signer */}
      {signables.length > 0 && slot && (
        <div className="px-3 mt-5">
          <button
            onClick={() => setProxy({ step: 1, trainee: null, reason: '', reasonLibre: '', lastName: '', firstName: '', role: '' })}
            className="w-full py-3 rounded-xl border border-gray-200 bg-white text-gray-600 text-sm"
          >
            Un stagiaire ne peut pas signer lui-même
          </button>
        </div>
      )}

      {/* Écran de confirmation + enchaînement */}
      {done && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
              <Check className="w-9 h-9 text-green-600" />
            </div>
            <p className="text-xl font-bold text-gray-900">
              {done.trainee.first_name} {(done.trainee.last_name || '').toUpperCase()} a signé
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {done.differe ? 'Enregistré sur le téléphone, envoi au retour du réseau' : `${periodLabel(slot.period)} du ${fmtDate(slot.date)}`}
            </p>

            {done.next ? (
              <>
                <p className="mt-5 text-sm text-gray-500">Stagiaire suivant</p>
                <p className="text-2xl font-bold text-gray-900 mb-4">
                  {done.next.first_name} {(done.next.last_name || '').toUpperCase()}
                </p>
                <button
                  onClick={() => { const n = done.next; setDone(null); setSigning(n) }}
                  className="w-full py-4 rounded-2xl bg-primary-600 text-white text-lg font-bold flex items-center justify-center gap-2"
                >
                  Faire signer <ChevronRight className="w-5 h-5" />
                </button>
                <button onClick={() => setDone(null)} className="w-full py-3 mt-2 text-gray-500">
                  Plus tard
                </button>
              </>
            ) : (
              <>
                <p className="mt-5 text-green-700 font-medium">Tout le monde a signé cette demi-journée</p>
                <button onClick={() => setDone(null)} className="w-full py-4 mt-3 rounded-2xl bg-gray-900 text-white text-lg font-bold">
                  Terminer
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Assistant « ne peut pas signer » */}
      {proxy && (proxy.step === 1 || proxy.step === 2) && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <p className="font-bold text-gray-900">Signature par un tiers — étape {proxy.step} sur 4</p>
              <button onClick={() => setProxy(null)} className="p-2 -mr-2 text-gray-400"><X className="w-5 h-5" /></button>
            </div>

            {proxy.step === 1 && (
              <>
                <p className="text-sm text-gray-500 mb-3">Quel stagiaire ne peut pas signer, et pourquoi ?</p>
                <div className="space-y-2 mb-4">
                  {signables.map(t => (
                    <button
                      key={t.trainee_id}
                      onClick={() => setProxy(p => ({ ...p, trainee: t }))}
                      className={`w-full text-left px-4 py-3 rounded-xl border ${
                        proxy.trainee?.trainee_id === t.trainee_id ? 'border-primary-600 bg-primary-50' : 'border-gray-200'}`}
                    >
                      {t.first_name} {(t.last_name || '').toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {PROXY_REASONS.map(r => (
                    <button
                      key={r}
                      onClick={() => setProxy(p => ({ ...p, reason: r }))}
                      className={`px-3 py-2 rounded-xl text-sm border ${
                        proxy.reason === r ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600'}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                {proxy.reason === 'Autre' && (
                  <input
                    className="input w-full mb-3"
                    placeholder="Précisez le motif"
                    value={proxy.reasonLibre}
                    onChange={(e) => setProxy(p => ({ ...p, reasonLibre: e.target.value }))}
                  />
                )}
                <button
                  disabled={!proxy.trainee || !proxy.reason || (proxy.reason === 'Autre' && !proxy.reasonLibre.trim())}
                  onClick={() => setProxy(p => ({ ...p, step: 2 }))}
                  className="w-full py-4 rounded-2xl bg-primary-600 text-white font-bold disabled:bg-gray-200 disabled:text-gray-400"
                >
                  Continuer
                </button>
              </>
            )}

            {proxy.step === 2 && (
              <>
                <p className="text-sm text-gray-500 mb-3">Qui signe à sa place ?</p>
                <div className="space-y-3 mb-4">
                  <input className="input w-full" placeholder="Nom" value={proxy.lastName}
                    onChange={(e) => setProxy(p => ({ ...p, lastName: e.target.value }))} />
                  <input className="input w-full" placeholder="Prénom" value={proxy.firstName}
                    onChange={(e) => setProxy(p => ({ ...p, firstName: e.target.value }))} />
                  <input className="input w-full" placeholder="Qualité (ex : accompagnatrice, collègue)" value={proxy.role}
                    onChange={(e) => setProxy(p => ({ ...p, role: e.target.value }))} />
                </div>
                <p className="text-xs text-gray-400 mb-3">
                  Ces informations figureront sur une page annexe de la feuille d'émargement,
                  avec le motif et votre contresignature.
                </p>
                <button
                  disabled={!proxy.lastName.trim() || !proxy.firstName.trim() || !proxy.role.trim()}
                  onClick={() => setProxy(p => ({ ...p, step: 3 }))}
                  className="w-full py-4 rounded-2xl bg-primary-600 text-white font-bold disabled:bg-gray-200 disabled:text-gray-400"
                >
                  Faire signer le tiers
                </button>
                <button onClick={() => setProxy(p => ({ ...p, step: 1 }))} className="w-full py-3 mt-1 text-gray-500">
                  Retour
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Aide */}
      {showHelp && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <p className="font-bold text-gray-900">Comment ça marche</p>
              <button onClick={() => setShowHelp(false)} className="p-2 -mr-2 text-gray-400"><X className="w-5 h-5" /></button>
            </div>
            <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
              <li>La demi-journée en cours est choisie toute seule. Vous pouvez en choisir une autre en haut.</li>
              <li>Appuyez sur « Signer » en face d'un nom, puis tendez le téléphone au stagiaire.</li>
              <li>Il signe avec son doigt et appuie sur « C'est signé ».</li>
              <li>Le stagiaire suivant est proposé automatiquement.</li>
              <li>Une demi-journée déjà signée est verrouillée : c'est normal.</li>
              <li>Sans réseau, tout est gardé sur le téléphone et part tout seul au retour du réseau. Ne fermez pas la page avant.</li>
            </ol>
            <p className="font-semibold text-gray-900 mt-4 mb-1 text-sm">Un stagiaire ne peut pas signer</p>
            <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
              <li>Bouton « Un stagiaire ne peut pas signer lui-même », en bas de la liste.</li>
              <li>Choisissez le stagiaire et le motif.</li>
              <li>Saisissez le nom, le prénom et la qualité de la personne qui signe à sa place.</li>
              <li>Elle signe, puis vous contresignez.</li>
              <li>Le détail apparaîtra sur une page annexe de la feuille d'émargement.</li>
            </ol>
            <button onClick={() => setShowHelp(false)} className="w-full py-3 mt-4 rounded-2xl bg-gray-900 text-white font-semibold">
              Compris
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

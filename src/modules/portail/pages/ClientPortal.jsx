import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Lock, Calendar, MapPin, Users, FileText, FileSignature, ClipboardList, Award, BadgeCheck, Download, Loader2, LogOut, AlertCircle } from 'lucide-react'
import { format, parseISO, isAfter, startOfToday } from 'date-fns'
import { fr } from 'date-fns/locale'
import { supabase } from '../../../core/supabase'
import PublicLayout from '../../../app/PublicLayout'
import { useBranding } from '../../../core/branding/BrandingProvider'
import { prepareOrgForPDF } from '../../../core/org/orgUtils'
import { setOrganization, generatePDF, generateAllPDF } from '../../formation/pdf/pdfGenerator'

// Espace entreprise, version minimale : lien + code à 6 chiffres, consultation des sessions
// de l'entreprise et téléchargement de ses documents. Lecture seule.

const STORAGE_KEY = (token) => `odet_client_portal_${token}`

function saveBase64(base64, filename) {
  const bytes = atob(base64)
  const buf = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function urlToDataUrl(url) {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const blob = await r.blob()
    return await new Promise((resolve) => { const fr = new FileReader(); fr.onloadend = () => resolve(fr.result); fr.onerror = () => resolve(null); fr.readAsDataURL(blob) })
  } catch { return null }
}

const fmtDate = (d) => d ? format(parseISO(d), 'd MMMM yyyy', { locale: fr }) : ''

export default function ClientPortal() {
  const { token } = useParams()
  const { branding } = useBranding()
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [orgReady, setOrgReady] = useState(false)
  const [busy, setBusy] = useState(null) // clé du document en cours de génération

  // Reprise de session dans le même onglet
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY(token))
      if (saved) { setCode(saved); login(saved) }
    } catch { /* stockage indisponible */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function login(forcedCode) {
    const c = String(forcedCode ?? code).replace(/\s/g, '')
    if (c.length < 4) { setError('Saisissez le code reçu'); return }
    setChecking(true); setError('')
    try {
      // Données d'abord : un code faux ne compte qu'une tentative. Les erreurs arrivent en JSON { error }.
      const { data: d, error: e1 } = await supabase.rpc('client_portal_data', { p_token: token, p_code: c })
      if (e1) throw e1
      if (d?.error) throw new Error(d.error)
      const { data: org, error: e2 } = await supabase.rpc('client_portal_org', { p_token: token, p_code: c })
      if (e2) throw e2
      if (org?.error) throw new Error(org.error)
      const prepared = await prepareOrgForPDF(org)
      setOrganization(prepared)
      setOrgReady(true)
      setData(d)
      try { sessionStorage.setItem(STORAGE_KEY(token), c) } catch { /* ignore */ }
    } catch (err) {
      const msg = err?.message || ''
      setError(msg.includes('Code incorrect') ? 'Code incorrect' : msg.includes('tentatives') ? 'Trop de tentatives, réessayez dans quelques minutes' : msg.includes('invalide') ? 'Ce lien est invalide ou a été désactivé' : 'Connexion impossible pour le moment')
      setData(null)
      try { sessionStorage.removeItem(STORAGE_KEY(token)) } catch { /* ignore */ }
    } finally {
      setChecking(false)
    }
  }

  function logout() {
    setData(null); setCode(''); setError('')
    try { sessionStorage.removeItem(STORAGE_KEY(token)) } catch { /* ignore */ }
  }

  const today = startOfToday()
  const { upcoming, past } = useMemo(() => {
    const sessions = data?.sessions || []
    const up = [], pa = []
    sessions.forEach(s => { (s.end_date && !isAfter(today, parseISO(s.end_date)) ? up : pa).push(s) })
    up.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
    return { upcoming: up, past: pa }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // Session au format attendu par les générateurs (clients, courses, trainers, session_trainees)
  function toPdfSession(s) {
    return { ...s, clients: data.client, courses: s.courses || {}, trainers: s.trainers || null }
  }
  function traineesOf(s) {
    return (s.session_trainees || []).map(st => ({ ...st.trainees, result: st.result || null, access_code: st.access_code }))
  }

  async function download(s, kind) {
    if (!orgReady) return
    const key = `${s.id}:${kind}`
    setBusy(key)
    try {
      const session = toPdfSession(s)
      const trainees = traineesOf(s)
      const trainer = s.trainers || null
      let out = null
      if (kind === 'convention') {
        out = await generatePDF('convention', session, { trainees, trainer, costs: [] })
      } else if (kind === 'convocations') {
        out = await generateAllPDF('convocation', session, trainees, { trainer })
      } else if (kind === 'emargement') {
        const absents = (s.session_trainees || []).filter(st => st.absent).map(st => st.trainee_id)
        const trainerSignatureBase64 = trainer?.signature_url ? await urlToDataUrl(trainer.signature_url) : null
        const hasAttendance = (s.halfdays || []).length > 0 || (s.proxies || []).length > 0
        out = await generatePDF('emargement', session, {
          // Jamais vierge ici : sans signature, la feuille garde l'intitulé, les dates et les noms
          trainees, trainer, isBlank: false,
          attendanceData: hasAttendance ? { signatures: [], halfdays: s.halfdays || [], proxies: s.proxies || [], absents, trainerSignatureBase64 } : null,
        })
      } else if (kind === 'attestations') {
        out = await generateAllPDF('attestation', session, trainees.filter(t => !((s.session_trainees || []).find(st => st.trainee_id === t.id)?.absent)), { trainer })
      } else if (kind === 'certificats') {
        out = await generateAllPDF('certificat', session, trainees.filter(t => t.result), { trainer })
      }
      if (!out) { setError('Aucun document à générer pour cette session'); return }
      saveBase64(out.base64, out.filename)
    } catch (err) {
      console.error('Document portail entreprise :', err)
      setError('Le document n\'a pas pu être généré : ' + (err.message || 'erreur inconnue'))
    } finally {
      setBusy(null)
    }
  }

  // ── Écran de connexion ──
  if (!data) {
    return (
      <PublicLayout title="Espace entreprise">
        <div className="max-w-md mx-auto bg-white rounded-ui-lg border border-gray-200 p-6 mt-6">
          <div className="w-12 h-12 rounded-full bg-primary-50 text-primary-700 flex items-center justify-center mb-4">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="font-display text-xl font-semibold text-gray-900">Accès à vos documents de formation</h1>
          <p className="text-sm text-gray-500 mt-1">Saisissez le code d'accès transmis par {branding.org_name || 'votre organisme de formation'}.</p>
          <form onSubmit={(e) => { e.preventDefault(); login() }} className="mt-5 space-y-3">
            <input
              inputMode="numeric" autoComplete="one-time-code" placeholder="Code à 6 chiffres"
              className="input w-full text-center text-2xl tracking-[0.4em] font-mono"
              value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              autoFocus
            />
            {error && <p className="text-sm text-[rgb(var(--c-danger))] flex items-center gap-1.5"><AlertCircle className="w-4 h-4" />{error}</p>}
            <button type="submit" className="btn btn-primary w-full justify-center" disabled={checking || code.length < 4}>
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Accéder'}
            </button>
          </form>
        </div>
      </PublicLayout>
    )
  }

  // ── Liste des sessions et documents ──
  const DocButton = ({ s, kind, icon: Icon, label, disabled }) => {
    const key = `${s.id}:${kind}`
    return (
      <button onClick={() => download(s, kind)} disabled={disabled || !!busy || !orgReady}
        className="flex items-center gap-2 px-3 py-2 rounded-ui border border-gray-200 bg-white text-sm text-gray-700 hover:border-primary-300 hover:text-primary-700 disabled:opacity-40 disabled:cursor-not-allowed">
        {busy === key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
        {label}
        {!busy && !disabled && <Download className="w-3.5 h-3.5 ml-auto text-gray-400" />}
      </button>
    )
  }

  const SessionCard = ({ s, finished }) => {
    const nb = (s.session_trainees || []).length
    const nbResults = (s.session_trainees || []).filter(st => st.result).length
    const lieu = [s.location_name, s.location_address, [s.location_postal_code, s.location_city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    const dates = s.start_date === s.end_date ? fmtDate(s.start_date) : `${fmtDate(s.start_date)} au ${fmtDate(s.end_date)}`
    return (
      <div className="bg-white rounded-ui-lg border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-gray-900">{s.courses?.title || 'Formation'}</h3>
            <div className="mt-1.5 flex flex-col gap-1 text-sm text-gray-600">
              <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-gray-400" />{dates}{s.start_time ? `, ${String(s.start_time).slice(0, 5).replace(':', 'h')} à ${String(s.end_time || '').slice(0, 5).replace(':', 'h')}` : ''}</span>
              {lieu && <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-gray-400" />{lieu}</span>}
              <span className="flex items-center gap-1.5"><Users className="w-4 h-4 text-gray-400" />{nb} participant{nb > 1 ? 's' : ''}{s.trainers ? `, formateur ${s.trainers.first_name} ${s.trainers.last_name}` : ''}</span>
            </div>
          </div>
          <span className="shrink-0 text-xs font-mono text-gray-400">{s.reference}</span>
        </div>

        {nb > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {(s.session_trainees || []).map(st => (
              <li key={st.trainee_id} className={`text-xs px-2 py-1 rounded-full ${st.absent ? 'bg-gray-100 text-gray-400 line-through' : ['acquis', 'acquired'].includes(st.result) ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : 'bg-gray-100 text-gray-700'}`}>
                {(st.trainees?.last_name || '').toUpperCase()} {st.trainees?.first_name}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <DocButton s={s} kind="convention" icon={FileSignature} label="Convention de formation" />
          <DocButton s={s} kind="convocations" icon={FileText} label="Convocations" disabled={nb === 0} />
          <DocButton s={s} kind="emargement" icon={ClipboardList} label="Feuille d'émargement" disabled={nb === 0} />
          <DocButton s={s} kind="attestations" icon={BadgeCheck} label="Attestations de présence" disabled={!finished || nb === 0} />
          <DocButton s={s} kind="certificats" icon={Award} label="Certificats de réalisation" disabled={!finished || nbResults === 0} />
        </div>
        {!finished && <p className="mt-2 text-xs text-gray-400">Attestations et certificats disponibles à l'issue de la formation.</p>}
      </div>
    )
  }

  return (
    <PublicLayout title="Espace entreprise">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-xl font-semibold text-gray-900">{data.client?.name}</h1>
          <p className="text-sm text-gray-500">Vos formations avec {branding.org_name}</p>
        </div>
        <button onClick={logout} className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1.5"><LogOut className="w-4 h-4" />Quitter</button>
      </div>

      {error && <p className="mb-4 text-sm text-[rgb(var(--c-danger))] flex items-center gap-1.5"><AlertCircle className="w-4 h-4" />{error}</p>}

      {upcoming.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">À venir ou en cours</h2>
          <div className="space-y-3">{upcoming.map(s => <SessionCard key={s.id} s={s} finished={false} />)}</div>
        </section>
      )}
      {past.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Formations réalisées</h2>
          <div className="space-y-3">{past.map(s => <SessionCard key={s.id} s={s} finished />)}</div>
        </section>
      )}
      {upcoming.length === 0 && past.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-10">Aucune formation enregistrée pour le moment.</p>
      )}
    </PublicLayout>
  )
}

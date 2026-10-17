// Éléments d'interface du module Interventions (classes du thème, aucune couleur d'organisme en dur).

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScanLine, X, Camera } from 'lucide-react'
import { RESULT_BADGE, RESULT_LABEL, VISIT_STATUS, DUE_BADGE, dueState, frMonthYear } from '../lib/schedule'

export function ResultBadge({ result }) {
  if (!result) return <span className="badge badge-neutral">À contrôler</span>
  return <span className={`badge ${RESULT_BADGE[result]}`}>{RESULT_LABEL[result]}</span>
}

export function VisitBadge({ status }) {
  const s = VISIT_STATUS[status] || VISIT_STATUS.a_planifier
  return <span className={`badge ${s.badge}`}>{s.label}</span>
}

export function DueBadge({ date, short = false }) {
  const st = dueState(date)
  if (st === 'none') return <span className="badge badge-neutral">Sans échéance</span>
  const label = st === 'late' ? (short ? 'En retard' : `En retard, ${frMonthYear(date)}`) : frMonthYear(date)
  return <span className={`badge ${DUE_BADGE[st]}`}>{label}</span>
}

export function Kpi({ value, label, tone = null }) {
  const color = tone === 'danger' ? 'text-[rgb(var(--c-danger))]' : tone === 'warning' ? 'text-[rgb(var(--c-warning))]' : tone === 'success' ? 'text-[rgb(var(--c-success))]' : tone === 'info' ? 'text-[rgb(var(--c-info))]' : 'text-gray-900'
  return (
    <div className="card flex flex-col" style={{ padding: 'var(--space-3)' }}>
      <span className={`font-display font-semibold text-xl ${color}`}>{value}</span>
      <span className="text-ui-sm text-gray-500">{label}</span>
    </div>
  )
}

export function Empty({ title, children }) {
  return (
    <div className="card text-center space-y-1 py-8">
      <p className="font-semibold">{title}</p>
      {children && <div className="muted text-ui-sm">{children}</div>}
    </div>
  )
}

/** Code d'étiquette lu dans un texte scanné : URL de l'application (…/appareil/CODE) ou code seul */
export function codeFromScan(text) {
  const s = String(text || '').trim()
  const m = s.match(/appareil\/([^/?#\s]+)/i)
  return decodeURIComponent(m ? m[1] : s).toUpperCase()
}

/**
 * Bouton « Scanner » : caméra du téléphone si le navigateur sait lire les QR codes, sinon saisie du code.
 * Sur iPhone, l'appareil photo du téléphone lit aussi l'étiquette et ouvre directement la fiche.
 */
export function ScanButton({ className = 'btn btn-primary', label = 'Scanner', onCode = null }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label="Scanner une étiquette">
        <ScanLine className="w-5 h-5" />{label && <span>{label}</span>}
      </button>
      {open && <ScanModal onClose={() => setOpen(false)} onCode={onCode} />}
    </>
  )
}

function ScanModal({ onClose, onCode }) {
  const navigate = useNavigate()
  const videoRef = useRef(null)
  const [code, setCode] = useState('')
  const [camera, setCamera] = useState('idle') // idle | on | unsupported | denied
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window

  const done = (c) => {
    const v = codeFromScan(c)
    if (!v) return
    onClose()
    if (onCode) onCode(v)
    else navigate(`/interventions/appareil/${encodeURIComponent(v)}`)
  }

  useEffect(() => {
    if (!supported) { setCamera('unsupported'); return undefined }
    let stream = null, stop = false, timer = null
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (stop) return
        const v = videoRef.current
        v.srcObject = stream
        await v.play()
        setCamera('on')
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        const tick = async () => {
          if (stop) return
          try {
            const found = await detector.detect(v)
            if (found?.[0]?.rawValue) { done(found[0].rawValue); return }
          } catch { /* image pas encore prête */ }
          timer = setTimeout(tick, 250)
        }
        tick()
      } catch { setCamera('denied') }
    })()
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Scanner une étiquette">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-ui-lg p-4 space-y-3" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center justify-between">
          <h2 className="section-title">Scanner une étiquette</h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>
        {camera !== 'unsupported' && camera !== 'denied' && (
          <div className="relative rounded-ui overflow-hidden bg-gray-900 aspect-square">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <div className="absolute inset-10 border-2 border-white/80 rounded-ui pointer-events-none" />
          </div>
        )}
        {(camera === 'unsupported' || camera === 'denied') && (
          <div className="rounded-ui bg-gray-50 border border-gray-200 p-3 text-ui-sm text-gray-700 flex gap-2">
            <Camera className="w-5 h-5 flex-none text-gray-500" />
            <span>{camera === 'denied' ? 'Accès à la caméra refusé.' : 'Ce navigateur ne lit pas les QR codes.'} Ouvrez l'appareil photo du téléphone et visez l'étiquette : la fiche s'ouvre directement. Ou tapez le code ci-dessous.</span>
          </div>
        )}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); done(code) }}>
          <label className="sr-only" htmlFor="itv-scan-code">Code de l'étiquette</label>
          <input id="itv-scan-code" className="input flex-1 uppercase" placeholder="Code de l'étiquette" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" />
          <button type="submit" className="btn btn-secondary" disabled={!code.trim()}>Ouvrir</button>
        </form>
      </div>
    </div>
  )
}

/** Petite boîte de dialogue générique (bas d'écran sur téléphone) */
export function Sheet({ title, onClose, children, footer, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <div className={`bg-white w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} rounded-t-2xl sm:rounded-ui-lg flex flex-col max-h-[92vh]`}>
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-100">
          <h2 className="section-title">{title}</h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 overflow-y-auto space-y-3 flex-1">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-gray-100 flex gap-2 justify-end" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>{footer}</div>}
      </div>
    </div>
  )
}

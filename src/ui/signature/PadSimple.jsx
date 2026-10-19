import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'

// Zone de signature simple (doigt, stylet ou souris) : renvoie une image PNG (data URL) à chaque trait, ou null si vide.
// Pour les signatures enregistrées une fois et les titres signés sur place ; la signature avec piste d'audit des
// stagiaires reste SignaturePad.
export default function PadSimple({ onChange, hauteur = 160, label = 'Signez dans le cadre' }) {
  const ref = useRef(null)
  const dessine = useRef(false)
  const [vide, setVide] = useState(true)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ratio = window.devicePixelRatio || 1
    const w = c.parentElement.clientWidth
    c.width = w * ratio; c.height = hauteur * ratio
    c.style.width = `${w}px`; c.style.height = `${hauteur}px`
    const ctx = c.getContext('2d')
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827'
  }, [hauteur])
  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  const debut = (e) => { e.preventDefault(); ref.current.setPointerCapture?.(e.pointerId); dessine.current = true; const [x, y] = pos(e); const ctx = ref.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(x, y) }
  const trait = (e) => { if (!dessine.current) return; const [x, y] = pos(e); const ctx = ref.current.getContext('2d'); ctx.lineTo(x, y); ctx.stroke(); if (vide) setVide(false) }
  const fin = () => { if (!dessine.current) return; dessine.current = false; onChange?.(ref.current.toDataURL('image/png')) }
  const effacer = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setVide(true); onChange?.(null) }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ui-sm text-gray-600">{label}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={effacer} disabled={vide}><RotateCcw className="w-4 h-4" aria-hidden="true" />Effacer</button>
      </div>
      <div className="rounded-ui border border-gray-300 bg-white" style={{ touchAction: 'none' }}>
        <canvas ref={ref} onPointerDown={debut} onPointerMove={trait} onPointerUp={fin} onPointerLeave={fin} aria-label={label} />
      </div>
    </div>
  )
}

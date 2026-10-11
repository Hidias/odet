import { useRef, useEffect, useState, useCallback } from 'react'
import { X, RotateCcw, Check } from 'lucide-react'

// ═══════════════════════════════════════════════════════════════
// FullscreenSignaturePad — pad plein écran pour faire signer
// le stagiaire sur le téléphone du formateur.
//
// - le tracé est conservé en mémoire et redessiné si le téléphone
//   change d'orientation (rien n'est perdu)
// - un tracé trop court (point, trait accidentel) est refusé
// - l'image renvoyée est recadrée sur le tracé puis ramenée à un
//   format fixe (600 × 240), pour un rendu propre sur la feuille
//
// Props :
//   title        — nom affiché en grand (ex : « Marie DUPONT »)
//   subtitle     — ligne d'explication (ex : « Matin du 17/09 »)
//   confirmLabel — texte du bouton de validation
//   onValidate(dataUrl)
//   onCancel()
// ═══════════════════════════════════════════════════════════════

const OUT_W = 600
const OUT_H = 240
const MIN_LENGTH = 120 // longueur minimale du tracé, en pixels

export default function FullscreenSignaturePad({
  title,
  subtitle,
  confirmLabel = "C'est signé",
  onValidate,
  onCancel,
}) {
  const canvasRef = useRef(null)
  const strokesRef = useRef([])      // [[{x,y}, …], …] en pixels CSS
  const currentRef = useRef(null)
  const lengthRef = useRef(0)
  const [hasDrawn, setHasDrawn] = useState(false)
  const [enough, setEnough] = useState(false)

  // ─── Dessin ────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)
    ctx.strokeStyle = '#1e3a5f'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const stroke of strokesRef.current) {
      if (stroke.length < 2) {
        if (stroke.length === 1) {
          ctx.beginPath()
          ctx.arc(stroke[0].x, stroke[0].y, 1.5, 0, Math.PI * 2)
          ctx.fillStyle = '#1e3a5f'
          ctx.fill()
        }
        continue
      }
      ctx.beginPath()
      ctx.moveTo(stroke[0].x, stroke[0].y)
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y)
      ctx.stroke()
    }
  }, [])

  useEffect(() => {
    redraw()
    const onResize = () => redraw()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [redraw])

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const t = e.touches ? e.touches[0] : e
    return { x: t.clientX - rect.left, y: t.clientY - rect.top }
  }

  const start = (e) => {
    e.preventDefault()
    currentRef.current = [pos(e)]
    strokesRef.current.push(currentRef.current)
    setHasDrawn(true)
  }

  const move = (e) => {
    if (!currentRef.current) return
    e.preventDefault()
    const p = pos(e)
    const stroke = currentRef.current
    const last = stroke[stroke.length - 1]
    lengthRef.current += Math.hypot(p.x - last.x, p.y - last.y)
    stroke.push(p)
    if (!enough && lengthRef.current > MIN_LENGTH) setEnough(true)
    redraw()
  }

  const end = (e) => {
    if (e) e.preventDefault()
    currentRef.current = null
  }

  const clear = () => {
    strokesRef.current = []
    currentRef.current = null
    lengthRef.current = 0
    setHasDrawn(false)
    setEnough(false)
    redraw()
  }

  // ─── Image finale : recadrée sur le tracé, format fixe ──────
  const buildImage = () => {
    const pts = strokesRef.current.flat()
    if (pts.length === 0) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of pts) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
    const pad = 8
    minX -= pad; minY -= pad; maxX += pad; maxY += pad
    const w = Math.max(1, maxX - minX)
    const h = Math.max(1, maxY - minY)

    const out = document.createElement('canvas')
    out.width = OUT_W
    out.height = OUT_H
    const ctx = out.getContext('2d')
    const scale = Math.min(OUT_W / w, OUT_H / h)
    const offX = (OUT_W - w * scale) / 2
    const offY = (OUT_H - h * scale) / 2
    ctx.setTransform(scale, 0, 0, scale, offX - minX * scale, offY - minY * scale)
    ctx.strokeStyle = '#1e3a5f'
    ctx.lineWidth = 3 / scale > 6 ? 6 : Math.max(2, 3 / Math.sqrt(scale))
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const stroke of strokesRef.current) {
      if (stroke.length < 2) continue
      ctx.beginPath()
      ctx.moveTo(stroke[0].x, stroke[0].y)
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y)
      ctx.stroke()
    }
    return out.toDataURL('image/png')
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col" style={{ touchAction: 'none' }}>
      {/* En-tête */}
      <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-3 flex-shrink-0">
        <div className="min-w-0">
          <p className="text-2xl font-bold text-gray-900 leading-tight truncate">{title}</p>
          {subtitle && <p className="text-base text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        <button
          onClick={onCancel}
          className="p-3 -mt-1 -mr-1 rounded-full text-gray-400 hover:bg-gray-100"
          aria-label="Annuler"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Zone de signature */}
      <div className="flex-1 mx-3 mb-3 relative border-4 border-dashed border-gray-300 rounded-2xl overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full block"
          style={{ touchAction: 'none' }}
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
        />
        {!hasDrawn && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-3xl font-semibold text-gray-300">Signez ici avec votre doigt</p>
          </div>
        )}
      </div>

      {/* Boutons */}
      <div className="px-3 pb-5 flex gap-3 flex-shrink-0">
        <button
          onClick={clear}
          disabled={!hasDrawn}
          className="flex items-center justify-center gap-2 px-5 py-5 rounded-2xl bg-gray-100 text-gray-700 text-lg font-medium disabled:opacity-40"
        >
          <RotateCcw className="w-5 h-5" />
          Recommencer
        </button>
        <button
          onClick={() => {
            const img = buildImage()
            if (img) onValidate(img)
          }}
          disabled={!enough}
          className="flex-1 flex items-center justify-center gap-2 px-5 py-5 rounded-2xl bg-green-600 text-white text-xl font-bold disabled:bg-gray-200 disabled:text-gray-400"
        >
          <Check className="w-6 h-6" />
          {enough ? confirmLabel : 'Signez pour valider'}
        </button>
      </div>
    </div>
  )
}

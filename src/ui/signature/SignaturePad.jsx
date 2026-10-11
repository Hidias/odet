import { useState, useRef, useEffect, useCallback } from 'react'
import { RotateCcw, Check, AlertCircle, Shield } from 'lucide-react'
import { supabase } from '../../core/supabase'

// ═══════════════════════════════════════════════════════════════
// SignaturePad — Composant réutilisable signature électronique
// Avec piste d'audit complète (hash, IP, user-agent, horodatage)
// ═══════════════════════════════════════════════════════════════

// Générer un hash SHA-256 d'un texte (pour empreinte document)
async function sha256(text) {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// Récupérer l'IP publique (best effort)
async function getPublicIP() {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) })
    const data = await res.json()
    return data.ip || 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * SignaturePad — Composant de signature avec piste d'audit
 * 
 * Props:
 * @param {string} documentType - convention, emargement, attestation, certificat, evaluation, etc.
 * @param {string} sessionId - UUID de la session
 * @param {string} [traineeId] - UUID du stagiaire
 * @param {string} [clientId] - UUID du client
 * @param {string} signerType - trainee, client, trainer, admin
 * @param {string} signerName - Nom complet du signataire
 * @param {string} [signerEmail] - Email du signataire
 * @param {string} [signerRole] - Rôle (ex: "Responsable formation")
 * @param {string} [documentRef] - Référence du document
 * @param {object} [metadata] - Données supplémentaires en JSON
 * @param {string} [documentContent] - Contenu à hasher pour la piste d'audit
 * @param {function} onSigned - Callback: ({ signatureId, signatureData, auditTrail })
 * @param {function} [onClear] - Callback après effacement
 * @param {string} [existingSignature] - Signature existante (base64)
 * @param {boolean} [readOnly] - Mode lecture seule
 * @param {boolean} [compact] - Mode compact (hauteur réduite)
 * @param {string} [label] - Libellé au-dessus du pad
 * @param {boolean} [showAuditInfo] - Afficher les infos d'audit
 * @param {boolean} [requireCertification] - Case certification RGPD
 * @param {string} [strokeColor] - Couleur du trait (#1e3a5f)
 * @param {number} [strokeWidth] - Épaisseur du trait (2)
 */
export default function SignaturePad({
  documentType,
  sessionId,
  traineeId,
  clientId,
  signerType = 'trainee',
  signerName,
  signerEmail,
  signerRole,
  documentRef,
  metadata = {},
  documentContent,
  onSigned,
  onClear,
  existingSignature,
  readOnly = false,
  compact = false,
  label = 'Signature',
  showAuditInfo = false,
  requireCertification = false,
  strokeColor = '#1e3a5f',
  strokeWidth = 2,
}) {
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(!!existingSignature)
  const [savedAudit, setSavedAudit] = useState(null)
  const [certificationAccepted, setCertificationAccepted] = useState(!requireCertification)
  const [signatureId, setSignatureId] = useState(null)

  const canvasHeight = compact ? 80 : 120

  // ─── Initialiser le canvas ──────────────────────────────────
  useEffect(() => {
    if (readOnly || saved) return
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = canvasHeight * dpr

    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = strokeWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctxRef.current = ctx

    if (!hasDrawn) {
      drawPlaceholder(ctx, rect.width, canvasHeight)
    }
  }, [saved, readOnly, hasDrawn, strokeColor, strokeWidth, canvasHeight])

  const drawPlaceholder = (ctx, w, h) => {
    ctx.fillStyle = '#D1D5DB'
    ctx.font = '14px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Signez ici', w / 2, h / 2 + 5)
  }

  // ─── Event handlers dessin ──────────────────────────────────
  const getPos = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return { x: clientX - rect.left, y: clientY - rect.top }
  }, [])

  const startDrawing = useCallback((e) => {
    if (readOnly || saved) return
    if (!hasDrawn) {
      const canvas = canvasRef.current
      const ctx = ctxRef.current
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      ctx.clearRect(0, 0, rect.width * dpr, canvasHeight * dpr)
      setHasDrawn(true)
    }
    const { x, y } = getPos(e)
    const ctx = ctxRef.current
    ctx.beginPath()
    ctx.moveTo(x, y)
    setIsDrawing(true)
  }, [readOnly, saved, hasDrawn, getPos, canvasHeight])

  const draw = useCallback((e) => {
    if (!isDrawing) return
    e.preventDefault()
    const { x, y } = getPos(e)
    ctxRef.current.lineTo(x, y)
    ctxRef.current.stroke()
  }, [isDrawing, getPos])

  const stopDrawing = useCallback(() => {
    setIsDrawing(false)
  }, [])

  // ─── Effacer ────────────────────────────────────────────────
  const clearCanvas = () => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    ctx.clearRect(0, 0, rect.width * dpr, canvasHeight * dpr)
    setHasDrawn(false)
    drawPlaceholder(ctx, rect.width, canvasHeight)
    setSaved(false)
    setSavedAudit(null)
    setSignatureId(null)
    if (onClear) onClear()
  }

  // ─── Valider et sauvegarder avec piste d'audit ─────────────
  const handleValidate = async () => {
    if (!hasDrawn) return
    if (requireCertification && !certificationAccepted) return

    setSaving(true)
    try {
      const canvas = canvasRef.current
      const signatureDataUrl = canvas.toDataURL('image/png')

      // Piste d'audit
      const [ip, docHash] = await Promise.all([
        getPublicIP(),
        documentContent
          ? sha256(documentContent)
          : sha256(`${documentType}-${sessionId}-${signerName}-${new Date().toISOString()}`)
      ])

      const auditTrail = {
        ip_address: ip,
        user_agent: navigator.userAgent,
        signed_at: new Date().toISOString(),
        document_hash: docHash,
      }

      // Sauvegarder en BDD
      const { data, error } = await supabase
        .from('document_signatures')
        .insert({
          document_type: documentType,
          session_id: sessionId || null,
          trainee_id: traineeId || null,
          client_id: clientId || null,
          signer_type: signerType,
          signer_name: signerName,
          signer_email: signerEmail || null,
          signer_role: signerRole || null,
          signature_data: signatureDataUrl,
          document_hash: docHash,
          ip_address: ip,
          user_agent: navigator.userAgent,
          signed_at: auditTrail.signed_at,
          metadata: {
            ...metadata,
            document_ref: documentRef || null,
          },
          status: 'valid'
        })
        .select()
        .single()

      if (error) throw error

      setSaved(true)
      setSavedAudit(auditTrail)
      setSignatureId(data.id)

      if (onSigned) {
        onSigned({
          signatureId: data.id,
          signatureData: signatureDataUrl,
          auditTrail,
        })
      }
    } catch (err) {
      console.error('Erreur sauvegarde signature:', err)
      alert('Erreur lors de la sauvegarde de la signature. Veuillez réessayer.')
    } finally {
      setSaving(false)
    }
  }

  // ─── Affichage signature existante (lecture seule) ──────────
  if (existingSignature && readOnly) {
    return (
      <div className="space-y-2">
        {label && <p className="text-sm font-medium text-gray-700">{label}</p>}
        <div className="border-2 border-green-200 rounded-lg bg-green-50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Check className="w-4 h-4 text-green-600" />
            <span className="text-xs font-medium text-green-700">Signé par {signerName}</span>
          </div>
          <div className="bg-white rounded p-2 flex items-center justify-center">
            <img src={existingSignature} alt="Signature" className="max-h-16 object-contain" />
          </div>
          {showAuditInfo && savedAudit && (
            <div className="mt-2 text-[10px] text-gray-400 space-y-0.5">
              <p>📅 {new Date(savedAudit.signed_at).toLocaleString('fr-FR')}</p>
              <p>🔒 Hash: {savedAudit.document_hash?.substring(0, 16)}…</p>
              <p>🌐 IP: {savedAudit.ip_address}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─── Affichage après sauvegarde ─────────────────────────────
  if (saved) {
    return (
      <div className="space-y-2">
        {label && <p className="text-sm font-medium text-gray-700">{label}</p>}
        <div className="border-2 border-green-200 rounded-lg bg-green-50 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-green-600" />
              <span className="text-sm font-medium text-green-700">Signature enregistrée</span>
            </div>
            {!readOnly && (
              <button
                onClick={clearCanvas}
                className="text-xs text-gray-500 hover:text-red-600 underline"
              >
                Modifier
              </button>
            )}
          </div>
          {showAuditInfo && savedAudit && (
            <div className="mt-2 pt-2 border-t border-green-200 text-[10px] text-gray-500 flex flex-wrap gap-x-4 gap-y-0.5">
              <span>📅 {new Date(savedAudit.signed_at).toLocaleString('fr-FR')}</span>
              <span>🔒 {savedAudit.document_hash?.substring(0, 16)}…</span>
              <span>🌐 {savedAudit.ip_address}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─── Pad de signature ───────────────────────────────────────
  return (
    <div className="space-y-2">
      {label && <p className="text-sm font-medium text-gray-700">{label}</p>}

      {/* Case certification RGPD */}
      {requireCertification && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-start gap-2 mb-2">
            <Shield className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-900">
              Je certifie l'exactitude des informations et accepte que ma signature soit enregistrée
              avec horodatage et piste d'audit conformément au RGPD (conservation : 3 ans).
            </p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={certificationAccepted}
              onChange={(e) => setCertificationAccepted(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <span className="text-xs font-medium text-blue-800">J'accepte et certifie</span>
          </label>
        </div>
      )}

      {/* Canvas */}
      <div className={`border-2 rounded-lg bg-white transition-colors ${
        !certificationAccepted ? 'border-gray-200 opacity-50 pointer-events-none' :
        hasDrawn ? 'border-blue-300' : 'border-gray-300'
      }`}>
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="w-full cursor-crosshair touch-none"
          style={{ touchAction: 'none', height: `${canvasHeight}px` }}
        />
      </div>

      {/* Boutons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={clearCanvas}
          disabled={!hasDrawn || saving}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Effacer
        </button>
        <button
          type="button"
          onClick={handleValidate}
          disabled={!hasDrawn || saving || (requireCertification && !certificationAccepted)}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />
              Enregistrement…
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5" />
              Valider la signature
            </>
          )}
        </button>
      </div>

      {/* Mention légale */}
      <p className="text-[10px] text-gray-400 flex items-center gap-1">
        <AlertCircle className="w-3 h-3" />
        Signature électronique simple (eIDAS) avec piste d'audit horodatée
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// SignatureAuditBadge — Badge affichant le statut de signature
// ═══════════════════════════════════════════════════════════════
export function SignatureAuditBadge({ sessionId, documentType, traineeId }) {
  const [signatures, setSignatures] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      let query = supabase
        .from('document_signatures')
        .select('id, signer_name, signer_type, signed_at, ip_address, document_hash, status')
        .eq('session_id', sessionId)
        .eq('document_type', documentType)
        .eq('status', 'valid')
        .order('signed_at', { ascending: false })

      if (traineeId) {
        query = query.eq('trainee_id', traineeId)
      }

      const { data } = await query
      setSignatures(data || [])
      setLoading(false)
    }
    if (sessionId && documentType) load()
  }, [sessionId, documentType, traineeId])

  if (loading) return null
  if (signatures.length === 0) {
    return (
      <span className="text-[10px] text-gray-400 flex items-center gap-1">
        <AlertCircle className="w-3 h-3" />
        Non signé
      </span>
    )
  }

  const latest = signatures[0]
  return (
    <span
      className="text-[10px] text-green-600 flex items-center gap-1"
      title={`Signé le ${new Date(latest.signed_at).toLocaleString('fr-FR')} — Hash: ${latest.document_hash?.substring(0, 16)}… — IP: ${latest.ip_address}`}
    >
      <Check className="w-3 h-3" />
      Signé ({signatures.length}) — {new Date(latest.signed_at).toLocaleDateString('fr-FR')}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════
// loadSignatures — Helper pour charger les signatures existantes
// ═══════════════════════════════════════════════════════════════
export async function loadSignatures({ sessionId, documentType, traineeId }) {
  let query = supabase
    .from('document_signatures')
    .select('*')
    .eq('status', 'valid')
    .order('signed_at', { ascending: false })

  if (sessionId) query = query.eq('session_id', sessionId)
  if (documentType) query = query.eq('document_type', documentType)
  if (traineeId) query = query.eq('trainee_id', traineeId)

  const { data, error } = await query
  if (error) console.error('Erreur chargement signatures:', error)
  return data || []
}

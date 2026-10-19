import { useState, useRef, useEffect } from 'react'
import { Upload, Trash2, RotateCcw, Check, Pen, Image as ImageIcon, X } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import toast from 'react-hot-toast'
import { readableUrl } from '../../../core/storageUtils'

import { confirmer } from '../../../ui/Confirm'
export default function TrainerSignatureManager({ trainer, onUpdate }) {
  const [mode, setMode] = useState('draw') // 'draw' ou 'upload'
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [currentSignature, setCurrentSignature] = useState(trainer?.signature_url || null)
  // Bucket privé : l'image s'affiche par un lien signé de courte durée
  const [signatureSrc, setSignatureSrc] = useState(null)
  useEffect(() => {
    let alive = true
    setSignatureSrc(null)
    if (currentSignature) readableUrl(currentSignature).then((u) => { if (alive) setSignatureSrc(u) })
    return () => { alive = false }
  }, [currentSignature])
  
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)

  useEffect(() => {
    if (mode === 'draw' && canvasRef.current) {
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      
      // Configuration haute résolution
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * 2
      canvas.height = rect.height * 2
      ctx.scale(2, 2)
      
      // Style du trait
      ctx.strokeStyle = '#000000'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      
      ctxRef.current = ctx
      
      // Dessiner le texte "Signez ici" si vide
      if (!hasDrawn) {
        drawPlaceholder(ctx, canvas)
      }
    }
  }, [mode, hasDrawn])

  const drawPlaceholder = (ctx, canvas) => {
    ctx.fillStyle = '#D1D5DB'
    ctx.font = '16px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Signez ici', canvas.width / 4, canvas.height / 4)
  }

  const clearPlaceholder = () => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    ctx.clearRect(0, 0, canvas.width / 2, canvas.height / 2)
  }

  const startDrawing = (e) => {
    if (!hasDrawn) {
      clearPlaceholder()
      setHasDrawn(true)
    }
    
    const ctx = ctxRef.current
    const rect = canvasRef.current.getBoundingClientRect()
    const x = (e.clientX || e.touches[0].clientX) - rect.left
    const y = (e.clientY || e.touches[0].clientY) - rect.top
    
    ctx.beginPath()
    ctx.moveTo(x, y)
    setIsDrawing(true)
  }

  const draw = (e) => {
    if (!isDrawing) return
    
    e.preventDefault()
    const ctx = ctxRef.current
    const rect = canvasRef.current.getBoundingClientRect()
    const x = (e.clientX || e.touches[0].clientX) - rect.left
    const y = (e.clientY || e.touches[0].clientY) - rect.top
    
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const stopDrawing = () => {
    setIsDrawing(false)
  }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
    drawPlaceholder(ctx, canvas)
  }

  const saveSignature = async () => {
    if (!hasDrawn) {
      toast.error('Veuillez dessiner votre signature')
      return
    }

    setUploading(true)

    try {
      // Convertir le canvas en blob PNG
      const canvas = canvasRef.current
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))

      // Supprimer l'ancienne signature si elle existe
      if (currentSignature) {
        try {
          const oldPath = currentSignature.split('trainer-signatures/')[1]
          if (oldPath) {
            await supabase.storage
              .from('trainer-signatures')
              .remove([oldPath])
          }
        } catch (error) {
          console.warn('Erreur suppression ancienne signature:', error)
        }
      }

      // Upload la nouvelle signature
      const fileName = `signature_${Date.now()}.png`
      const filePath = `${trainer.id}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('trainer-signatures')
        .upload(filePath, blob, {
          contentType: 'image/png',
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) throw uploadError

      // Récupérer l'URL publique
      const { data: { publicUrl } } = supabase.storage
        .from('trainer-signatures')
        .getPublicUrl(filePath)

      // Mettre à jour la base de données
      const { error: updateError } = await supabase
        .from('trainers')
        .update({ signature_url: publicUrl })
        .eq('id', trainer.id)

      if (updateError) throw updateError

      setCurrentSignature(publicUrl)
      toast.success('Signature enregistrée avec succès')
      
      if (onUpdate) onUpdate({ ...trainer, signature_url: publicUrl })
    } catch (error) {
      console.error('Erreur sauvegarde signature:', error)
      toast.error('Erreur lors de l\'enregistrement')
    } finally {
      setUploading(false)
    }
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Vérifier le type
    if (!file.type.startsWith('image/')) {
      toast.error('Veuillez sélectionner une image')
      return
    }

    // Vérifier la taille (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image trop volumineuse (max 2 MB)')
      return
    }

    setUploading(true)

    try {
      // Supprimer l'ancienne signature
      if (currentSignature) {
        try {
          const oldPath = currentSignature.split('trainer-signatures/')[1]
          if (oldPath) {
            await supabase.storage
              .from('trainer-signatures')
              .remove([oldPath])
          }
        } catch (error) {
          console.warn('Erreur suppression ancienne signature:', error)
        }
      }

      // Upload
      const fileExt = file.name.split('.').pop()
      const fileName = `signature_${Date.now()}.${fileExt}`
      const filePath = `${trainer.id}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('trainer-signatures')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) throw uploadError

      // Récupérer l'URL
      const { data: { publicUrl } } = supabase.storage
        .from('trainer-signatures')
        .getPublicUrl(filePath)

      // Mettre à jour la BDD
      const { error: updateError } = await supabase
        .from('trainers')
        .update({ signature_url: publicUrl })
        .eq('id', trainer.id)

      if (updateError) throw updateError

      setCurrentSignature(publicUrl)
      toast.success('Signature importée avec succès')
      
      if (onUpdate) onUpdate({ ...trainer, signature_url: publicUrl })
    } catch (error) {
      console.error('Erreur upload signature:', error)
      toast.error('Erreur lors de l\'import')
    } finally {
      setUploading(false)
    }
  }

  const deleteSignature = async () => {
    if (!currentSignature) return

    if (!await confirmer(' Supprimer définitivement cette signature ?')) return

    setUploading(true)

    try {
      // Supprimer du storage
      const oldPath = currentSignature.split('trainer-signatures/')[1]
      if (oldPath) {
        await supabase.storage
          .from('trainer-signatures')
          .remove([oldPath])
      }

      // Mettre à jour la BDD
      const { error } = await supabase
        .from('trainers')
        .update({ signature_url: null })
        .eq('id', trainer.id)

      if (error) throw error

      setCurrentSignature(null)
      toast.success('Signature supprimée')
      
      if (onUpdate) onUpdate({ ...trainer, signature_url: null })
    } catch (error) {
      console.error('Erreur suppression signature:', error)
      toast.error('Erreur lors de la suppression')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Titre et description */}
      <div>
        <label className="block text-ui font-medium text-gray-700 mb-1">
          Signature du formateur
        </label>
        <p className="text-ui-sm text-gray-500">
          Cette signature apparaîtra sur les certificats SST
        </p>
      </div>

      {/* Aperçu signature actuelle */}
      {currentSignature && (
        <div className="bg-[rgb(var(--c-success-bg))] border-2 border-[rgb(var(--c-success)/0.3)] rounded-ui-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-ui font-medium text-[rgb(var(--c-success))] flex items-center gap-2">
              <Check className="w-4 h-4" />
              Signature enregistrée
            </span>
            <button
              onClick={deleteSignature}
              disabled={uploading}
              className="text-[rgb(var(--c-danger))] hover:text-[rgb(var(--c-danger))] text-ui flex items-center gap-1 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              Supprimer
            </button>
          </div>
          <div className="flex items-center justify-center bg-white rounded p-4 border border-[rgb(var(--c-success)/0.3)]">
            <img 
              src={signatureSrc || undefined} 
              alt="Signature actuelle" 
              className="max-h-24 object-contain"
            />
          </div>
        </div>
      )}

      {/* Onglets */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setMode('draw')}
          className={`px-4 py-2 text-ui font-medium transition-colors flex items-center gap-2 ${
            mode === 'draw'
              ? 'text-[rgb(var(--c-info))] border-b-2 border-[rgb(var(--c-info)/0.3)]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Pen className="w-4 h-4" />
          Dessiner
        </button>
        <button
          onClick={() => setMode('upload')}
          className={`px-4 py-2 text-ui font-medium transition-colors flex items-center gap-2 ${
            mode === 'upload'
              ? 'text-[rgb(var(--c-info))] border-b-2 border-[rgb(var(--c-info)/0.3)]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <ImageIcon className="w-4 h-4" />
          Importer
        </button>
      </div>

      {/* Mode Dessiner */}
      {mode === 'draw' && (
        <div className="space-y-3">
          {/* Canvas */}
          <div className="border-2 border-gray-300 rounded-ui-sm bg-white">
            <canvas
              ref={canvasRef}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
              className="w-full h-40 cursor-crosshair touch-none"
              style={{ touchAction: 'none' }}
            />
          </div>

          {/* Boutons */}
          <div className="flex gap-2">
            <button
              onClick={clearCanvas}
              disabled={!hasDrawn || uploading}
              className="flex-1 btn btn-secondary flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4" />
              Effacer
            </button>
            <button
              onClick={saveSignature}
              disabled={!hasDrawn || uploading}
              className="flex-1 btn btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Enregistrement...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Valider
                </>
              )}
            </button>
          </div>

          {/* Conseils */}
          <div className="bg-[rgb(var(--c-info-bg))] border border-[rgb(var(--c-info)/0.3)] rounded-ui-sm p-3">
            <p className="text-ui-sm text-[rgb(var(--c-info))]">
              <strong> Conseil :</strong> Signez lentement pour un trait net. 
              Sur mobile, orientez l'écran en mode paysage pour plus d'espace.
            </p>
          </div>
        </div>
      )}

      {/* Mode Importer */}
      {mode === 'upload' && (
        <div className="space-y-3">
          <label 
            htmlFor="signature-file-upload"
            className={`
              flex flex-col items-center justify-center w-full h-40 
              border-2 border-dashed rounded-ui-sm cursor-pointer
              transition-colors
              ${uploading 
                ? 'border-gray-300 bg-gray-50 cursor-not-allowed' 
                : 'border-gray-300 hover:border-[rgb(var(--c-info)/0.3)] bg-gray-50 hover:bg-[rgb(var(--c-info-bg))]'
              }
            `}
          >
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              {uploading ? (
                <>
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[rgb(var(--c-info)/0.3)] mb-2"></div>
                  <p className="text-ui text-gray-600">Import en cours...</p>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-gray-400 mb-2" />
                  <p className="text-ui text-gray-600">
                    <span className="font-semibold text-[rgb(var(--c-info))]">Cliquez pour importer</span> ou glissez-déposez
                  </p>
                  <p className="text-ui-sm text-gray-500 mt-1">PNG, JPG (max. 2MB)</p>
                </>
              )}
            </div>
            <input 
              id="signature-file-upload"
              type="file" 
              className="hidden" 
              accept="image/png,image/jpeg,image/jpg"
              onChange={handleFileUpload}
              disabled={uploading}
            />
          </label>

          {/* Conseils */}
          <div className="bg-[rgb(var(--c-info-bg))] border border-[rgb(var(--c-info)/0.3)] rounded-ui-sm p-3">
            <p className="text-ui-sm text-[rgb(var(--c-info))]">
              <strong> Conseil :</strong> Utilisez une signature sur fond blanc transparent (PNG) 
              ou fond blanc uni. Dimensions recommandées : 400x150 pixels.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

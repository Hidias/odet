import { apiFetch } from '../api'
import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Mail, Save, Loader, CheckCircle, AlertCircle, TestTube } from 'lucide-react'
import toast from 'react-hot-toast'

export default function EmailSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  
  const [userId, setUserId] = useState(null)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    signatureImage: null // Image de signature en base64
  })
  const [hasConfig, setHasConfig] = useState(false)
  const [signaturePreview, setSignaturePreview] = useState(null)

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      
      setUserId(user.id)

      // Récupérer la config existante
      const { data, error } = await supabase
        .from('user_email_configs')
        .select('email, signature_image')
        .eq('user_id', user.id)
        .order('email')
        .limit(1)

      const config = Array.isArray(data) ? data[0] : data
      if (config && !error) {
        setFormData(prev => ({ 
          ...prev, 
          email: config.email,
          signatureImage: config.signature_image 
        }))
        setSignaturePreview(config.signature_image)
        setHasConfig(true)
      }
    } catch (error) {
      console.error('Erreur chargement config:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleTest = async () => {
    if (!formData.email || !formData.password) {
      toast.error('Email et mot de passe obligatoires')
      return
    }

    setTesting(true)

    try {
      const response = await apiFetch('/api/user-email-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          email: formData.email,
          password: formData.password,
          testConnection: true
        })
      })

      const result = await response.json()

      if (result.success) {
        toast.success('✅ Connexion SMTP réussie !')
      } else {
        toast.error('❌ Échec : ' + result.error)
      }
    } catch (error) {
      toast.error('Erreur lors du test')
    } finally {
      setTesting(false)
    }
  }

  const handleSignatureUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    
    // Vérifier que c'est une image
    if (!file.type.startsWith('image/')) {
      toast.error('Le fichier doit être une image')
      return
    }
    
    // Vérifier la taille (max 1MB)
    if (file.size > 1024 * 1024) {
      toast.error('Image trop volumineuse (max 1MB)')
      return
    }
    
    // Lire et compresser l'image
    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        // Créer un canvas pour redimensionner
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        
        // Limiter la largeur max à 600px
        const maxWidth = 600
        let width = img.width
        let height = img.height
        
        if (width > maxWidth) {
          height = (height * maxWidth) / width
          width = maxWidth
        }
        
        canvas.width = width
        canvas.height = height
        
        // Dessiner l'image redimensionnée
        ctx.drawImage(img, 0, 0, width, height)
        
        // Convertir en base64 avec compression
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8)
        
        setFormData(prev => ({ ...prev, signatureImage: compressedBase64 }))
        setSignaturePreview(compressedBase64)
        toast.success('Signature ajoutée et compressée')
      }
      img.src = event.target.result
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveSignature = () => {
    setFormData(prev => ({ ...prev, signatureImage: null }))
    setSignaturePreview(null)
    toast.success('Signature supprimée')
  }

  const handleSave = async () => {
    if (!formData.email || !formData.password) {
      toast.error('Email et mot de passe obligatoires')
      return
    }

    setSaving(true)

    try {
      const response = await apiFetch('/api/user-email-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          email: formData.email,
          password: formData.password,
          signatureImage: formData.signatureImage,
          testConnection: false
        })
      })

      const result = await response.json()

      if (result.success) {
        toast.success('Configuration sauvegardée !')
        setHasConfig(true)
      } else {
        toast.error('Erreur : ' + result.error)
      }
    } catch (error) {
      toast.error('Erreur lors de la sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-8 h-8 text-primary-600 animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <Mail className="w-6 h-6 text-primary-600" />
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Configuration Email</h2>
            <p className="text-sm text-gray-600">Pour envoyer les comptes-rendus depuis Campus</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Votre email professionnel
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="prenom.nom@accessformation.pro"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Mot de passe email
            </label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="••••••••"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Votre mot de passe est chiffré et stocké en sécurité
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800 font-medium mb-2">📧 Serveur SMTP : IONOS Exchange</p>
            <div className="text-xs text-blue-700 space-y-1">
              <p>• Host : smtp.exchange.ionos.eu</p>
              <p>• Port : 587 (STARTTLS)</p>
              <p>• Les emails apparaîtront dans vos "Envoyés"</p>
            </div>
          </div>

          {/* Signature */}
          <div className="border-t border-gray-200 pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              ✍️ Signature email (optionnel)
            </label>
            
            {signaturePreview ? (
              <div className="space-y-2">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <img 
                    src={signaturePreview} 
                    alt="Signature" 
                    className="max-w-full h-auto"
                    style={{ maxHeight: '150px' }}
                  />
                </div>
                <button
                  onClick={handleRemoveSignature}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Supprimer la signature
                </button>
              </div>
            ) : (
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                <label className="flex flex-col items-center cursor-pointer">
                  <Mail className="w-8 h-8 text-gray-400 mb-2" />
                  <span className="text-sm text-gray-600">Ajouter une image de signature</span>
                  <span className="text-xs text-gray-500 mt-1">PNG, JPG (max 1MB)</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={handleSignatureUpload}
                    className="hidden"
                  />
                </label>
              </div>
            )}
            <p className="text-xs text-gray-500 mt-2">
              Cette signature sera automatiquement ajoutée à la fin de vos emails
            </p>
          </div>

          {hasConfig && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <p className="text-sm text-green-800">Configuration active</p>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleTest}
              disabled={testing || !formData.email || !formData.password}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {testing ? <Loader className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
              Tester la connexion
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !formData.email || !formData.password}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Sauvegarder
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

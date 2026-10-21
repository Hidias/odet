import { apiFetch } from '../../../core/api'
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../../core/supabase'
import toast from 'react-hot-toast'
import { useDataStore } from '../../../core/store'
import { orgName, orgCity } from '../../../core/org/currentOrg'
import { buildSocialSystemPrompt, brandHashtag } from '../lib/socialPrompt'

import { confirmer } from '../../../ui/Confirm'
// ═══════════════════════════════════════════════════════════
// MODULE RÉSEAUX SOCIAUX
// Phase 1 : Générateur IA + Calendrier + Médiathèque
// ═══════════════════════════════════════════════════════════

const PLATFORMS = [
  { id: 'linkedin', label: 'LinkedIn Page', icon: '', color: 'blue', maxChars: 3000 },
  { id: 'facebook', label: 'Facebook', icon: '', color: 'indigo', maxChars: 5000 },
  { id: 'instagram', label: 'Instagram', icon: '', color: 'pink', maxChars: 2200 },
  { id: 'gmb', label: 'Google', icon: '', color: 'green', maxChars: 1500 },
]

const POST_TYPES = [
  { id: 'expertise', label: 'Expertise terrain', desc: 'Partager un savoir-faire, une anecdote formation' },
  { id: 'stat', label: 'Statistique / Résultat', desc: 'Taux de réussite, satisfaction, certifications' },
  { id: 'storytelling', label: 'Storytelling', desc: 'Histoire vécue en formation, retour terrain' },
  { id: 'promo', label: 'Promotion', desc: 'Nouvelle formation, offre, événement' },
  { id: 'educatif', label: 'Éducatif', desc: 'Conseil prévention, réglementation, bonnes pratiques' },
  { id: 'qualiopi', label: 'Qualiopi / Qualité', desc: 'Démarche qualité, certification, processus' },
  { id: 'campus', label: 'Outils et innovation', desc: 'Nos outils numériques, nos méthodes, nos nouveautés' },
  { id: 'offre_promo', label: 'Offre promotionnelle', desc: 'Offre avec date de fin, CTA fort, urgence positive' },
  { id: 'veille_reglementaire', label: 'Veille réglementaire', desc: 'Nouvelle norme, obligation légale, mise à jour INRS' },
]

// Hashtags gérés dynamiquement par l'IA dans le prompt

// ─── COMPOSANT PRINCIPAL ─────────────────────────────────
export default function SocialMedia() {
  const [activeTab, setActiveTab] = useState('generator')
  const [posts, setPosts] = useState([])
  const [media, setMedia] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [editingDraft, setEditingDraft] = useState(null)
  const [connections, setConnections] = useState({})

  // Charger les données au montage
  useEffect(() => {
    loadData()
    loadConnections()
    handleOAuthCallback()
  }, [])

  // Vérifier si on revient d'un OAuth
  const handleOAuthCallback = () => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')

    if (params.get('meta') === 'success') {
      const page = params.get('page')
      const igUser = params.get('ig_user')
      toast.success(`Facebook connecté : ${page}${igUser ? ` + Instagram @${igUser}` : ''}`)
      loadConnections()
    } else if (params.get('meta') === 'error') {
      toast.error(`Erreur Meta : ${params.get('reason')}`)
    }

    if (params.get('google') === 'success') {
      toast.success(`Google My Business connecté : ${params.get('location')}`)
      loadConnections()
    } else if (params.get('google') === 'error') {
      toast.error(`Erreur Google : ${params.get('reason')}`)
    }

    if (params.get('linkedin') === 'success') {
      const page = params.get('page')
      toast.success(`LinkedIn connecté : ${page || 'page entreprise'}`)
      loadConnections()
    } else if (params.get('linkedin') === 'error') {
      const reason = params.get('reason')
      const msg = reason === 'no_org_page'
        ? `Aucune page entreprise trouvée : connectez-vous avec le compte administrateur de la page ${orgName() || 'de l\'organisme'}`
        : `Erreur LinkedIn : ${reason}`
      toast.error(msg)
    }

    // Nettoyer l'URL
    if (params.get('meta') || params.get('google') || params.get('linkedin')) {
      window.history.replaceState(null, '', window.location.pathname + '#/social')
    }
  }

  // Charger le statut des connexions
  const loadConnections = async () => {
    try {
      const res = await apiFetch('/api/social/status')
      if (res.ok) {
        const data = await res.json()
        setConnections(data)
      }
    } catch (err) {
      console.warn('Erreur chargement connexions:', err)
    }
  }

  const loadData = async () => {
    setLoading(true)
    try {
      const { data: postsData } = await supabase.from('social_posts').select('*').order('created_at', { ascending: false }).limit(50)
      if (postsData) setPosts(postsData)
    } catch (err) {
      console.warn('Erreur chargement posts:', err)
    }
    try {
      const { data: mediaData } = await supabase.from('social_media_library').select('*').order('created_at', { ascending: false }).limit(100)
      if (mediaData) setMedia(mediaData)
    } catch (err) {
      console.warn('Erreur chargement media:', err)
    }
    await loadStats()
    setLoading(false)
  }

  // Stats depuis les sessions pour alimenter l'IA
  const loadStats = async () => {
    try {
      // Sessions avec jointures correctes
      const { data: sessions, error: sessErr } = await supabase
        .from('sessions')
        .select('id, start_date, end_date, location_city, location_name, status, course:courses(title), client:clients(name), session_trainees(trainee_id, presence_complete, early_departure, result)')
        .order('start_date', { ascending: false })
        .limit(20)

      if (sessErr) console.warn('Stats sessions:', sessErr.message)

      // Évaluations à chaud pour la note moyenne (nouvelles colonnes q_org/q_contenu/q_formateur/q_global)
      const { data: evals, error: evalErr } = await supabase
        .from('trainee_evaluations')
        .select('q_org_accueil, q_org_documents, q_org_locaux, q_org_materiel, q_contenu_supports, q_contenu_programme, q_contenu_organisation, q_contenu_duree, q_formateur_pedagogie, q_formateur_expertise, q_formateur_progression, q_formateur_moyens, q_global_adequation, q_global_competences, submitted_at')
        .not('q_org_accueil', 'is', null)
        .order('submitted_at', { ascending: false })
        .limit(100)

      if (evalErr) console.warn('Stats évaluations:', evalErr.message)

      const completedSessions = (sessions || []).filter(s => s.status === 'completed' || s.status === 'terminée' || s.status === 'Terminée')

      // Calculer la note moyenne sur 5 (moyenne de toutes les notes des 14 critères)
      const newKeys = [
        'q_org_accueil', 'q_org_documents', 'q_org_locaux', 'q_org_materiel',
        'q_contenu_supports', 'q_contenu_programme', 'q_contenu_organisation', 'q_contenu_duree',
        'q_formateur_pedagogie', 'q_formateur_expertise', 'q_formateur_progression', 'q_formateur_moyens',
        'q_global_adequation', 'q_global_competences'
      ]
      const validEvals = (evals || []).filter(e => e.q_org_accueil != null)
      // Aucun chiffre par défaut : sans évaluation, rien n'est affiché ni transmis à l'Aide à la rédaction
      let avgRating = null
      if (validEvals.length > 0) {
        const allScores = []
        validEvals.forEach(e => {
          newKeys.forEach(k => {
            if (e[k] != null && !isNaN(e[k])) allScores.push(Number(e[k]))
          })
        })
        if (allScores.length > 0) {
          avgRating = (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(2)
        }
      }

      // Calculer le vrai nombre de stagiaires formés et le taux de réussite
      let totalTrainees = 0, successOk = 0, successTotal = 0
      completedSessions.forEach(s => {
        const trainees = s.session_trainees || []
        const formed = trainees.filter(st => st.presence_complete || st.early_departure)
        totalTrainees += formed.length
        formed.forEach(st => {
          if (st.result) {
            successTotal++
            if (st.result === 'acquired') successOk++
          }
        })
      })
      const successRate = successTotal > 0 ? Math.round(successOk / successTotal * 100).toString() : null

      const s = {
        recentSessions: (sessions || []).slice(0, 5),
        completedCount: completedSessions.length,
        avgRating,
        totalTrainees,
        successRate,
      }
      setStats(s)
      return s
    } catch (err) {
      console.warn('Erreur stats (non bloquant):', err)
      const fallback = { recentSessions: [], completedCount: 0, avgRating: null, totalTrainees: 0, successRate: null }
      setStats(fallback)
      return fallback
    }
  }

  const tabs = [
    { id: 'generator', label: 'Générateur', count: null },
    { id: 'calendar', label: 'Calendrier', count: posts.filter(p => p.status === 'scheduled').length },
    { id: 'library', label: 'Médiathèque', count: media.length },
    { id: 'drafts', label: 'Brouillons', count: posts.filter(p => p.status === 'draft').length },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title"> Social & Communication</h1>
          <p className="text-ui text-gray-500 mt-1">Générez et planifiez vos publications sur tous vos réseaux</p>
        </div>
      </div>

      {/* Panneau Connexions */}
      <ConnectionPanel connections={connections} onRefresh={loadConnections} />

      {/* Onglets */}
      <div className="flex gap-1 bg-gray-100 rounded-ui p-1 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-2 px-3 rounded-ui-sm text-ui font-medium transition-all whitespace-nowrap ${
              activeTab === t.id
                ? 'bg-white text-[#0F2D35] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className="ml-1.5 bg-[#E9B44C] text-[#0F2D35] text-ui-sm font-bold px-1.5 py-0.5 rounded-full">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Contenu */}
      {activeTab === 'generator' && <GeneratorTab stats={stats} onSave={loadData} media={media} editingDraft={editingDraft} onClearDraft={() => setEditingDraft(null)} connections={connections} />}
      {activeTab === 'calendar' && <CalendarTab posts={posts} onUpdate={loadData} />}
      {activeTab === 'library' && <LibraryTab media={media} onUpdate={loadData} />}
      {activeTab === 'drafts' && <DraftsTab posts={posts.filter(p => p.status === 'draft')} onUpdate={loadData} onEdit={(draft) => { setEditingDraft(draft); setActiveTab('generator') }} onRecycle={(draft) => { setEditingDraft({ ...draft, _recycle: true }); setActiveTab('generator') }} />}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
// PANNEAU DE CONNEXION AUX RÉSEAUX
// ═══════════════════════════════════════════════════════════
function ConnectionPanel({ connections, onRefresh }) {
  const [expanded, setExpanded] = useState(false)

  const platformConfigs = [
    {
      id: 'facebook',
      label: 'Facebook',
      icon: '',
      connectUrl: '/api/auth/meta?action=start',
      color: 'blue',
      details: connections?.facebook?.name,
    },
    {
      id: 'instagram',
      label: 'Instagram',
      icon: '',
      connectUrl: null, // Se connecte via Meta
      color: 'pink',
      details: connections?.instagram?.name ? `@${connections.instagram.name}` : null,
      linkedTo: 'facebook',
    },
    {
      id: 'gmb',
      label: 'Google',
      icon: '',
      connectUrl: '/api/auth/google?action=start',
      color: 'green',
      details: connections?.gmb?.name,
    },
    {
      id: 'linkedin',
      label: 'LinkedIn Page',
      icon: '',
      connectUrl: '/api/auth/linkedin?action=start',
      color: 'blue',
      details: connections?.linkedin?.name || null,
    },
  ]

  const connectedCount = platformConfigs.filter(p => connections?.[p.id]?.connected).length

  // Démarrage OAuth : le serveur vérifie le rôle (jeton de l'utilisateur) et renvoie l'adresse
  // d'autorisation munie d'un state signé, vérifié au retour du fournisseur
  const [connecting, setConnecting] = useState(null)
  const startConnect = async (p) => {
    setConnecting(p.id)
    try {
      const res = await apiFetch(p.connectUrl)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error || `Erreur ${res.status}`)
      window.location.href = data.url
    } catch (err) {
      toast.error(`Connexion ${p.label} impossible : ${err.message}`)
      setConnecting(null)
    }
  }

  return (
    <div className="bg-white rounded-ui border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-ui font-medium text-[#0F2D35]"> Réseaux connectés</span>
          <div className="flex gap-1">
            {platformConfigs.map(p => {
              const isConnected = connections?.[p.id]?.connected
              return (
                <span
                  key={p.id}
                  className={`text-ui ${isConnected ? '' : 'opacity-30 grayscale'}`}
                  title={`${p.label} : ${isConnected ? 'connecté' : 'non connecté'}`}
                >
                  {p.icon}
                  {isConnected && <span className="text-ui-sm ml-[-4px]"></span>}
                </span>
              )
            })}
          </div>
          <span className="text-ui-sm bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
            {connectedCount}/4
          </span>
        </div>
        <span className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
            {platformConfigs.map(p => {
              const conn = connections?.[p.id]
              const isConnected = conn?.connected

              return (
                <div
                  key={p.id}
                  className={`rounded-ui-sm border p-3 text-center space-y-2 ${
                    isConnected ? 'border-[rgb(var(--c-success)/0.3)] bg-[rgb(var(--c-success-bg))]' : 'border-gray-200'
                  } ${p.disabled ? 'opacity-50' : ''}`}
                >
                  <div className="text-2xl">{p.icon}</div>
                  <div className="text-ui-sm font-medium">{p.label}</div>

                  {isConnected ? (
                    <>
                      <div className="text-ui-sm text-[rgb(var(--c-success))] font-medium"> Connecté</div>
                      {p.details && <div className="text-ui-sm text-gray-500 truncate">{p.details}</div>}
                    </>
                  ) : (
                    <>
                      {p.linkedTo ? (
                        <div className="text-ui-sm text-gray-400">
                          {connections?.[p.linkedTo]?.connected
                            ? ` Lié via ${p.linkedTo === 'facebook' ? 'Facebook' : 'LinkedIn page'}`
                            : `Connectez ${p.linkedTo === 'facebook' ? 'Facebook' : 'LinkedIn page'} d'abord`}
                        </div>
                      ) : p.disabled ? (
                        <div className="text-ui-sm text-gray-400">{p.details}</div>
                      ) : p.connectUrl ? (
                        <button
                          type="button"
                          onClick={() => startConnect(p)}
                          disabled={connecting === p.id}
                          className="inline-block text-ui-sm bg-[#0F2D35] text-white px-3 py-1.5 rounded-ui-sm hover:opacity-90 transition-colors font-medium disabled:opacity-60"
                        >
                          {connecting === p.id ? 'Connexion…' : 'Connecter'}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {connectedCount < 3 && (
            <p className="text-ui-sm text-gray-400 mt-3 text-center">
               Connectez vos comptes pour publier directement depuis l'application. Facebook connecte aussi Instagram automatiquement.
            </p>
          )}
        </div>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
// ONGLET GÉNÉRATEUR IA
// ═══════════════════════════════════════════════════════════
function GeneratorTab({ stats, onSave, media, editingDraft, onClearDraft, connections }) {
  // Identité et catalogue de l'organisme : Paramètres et Formations, rien en dur
  const { organization, fetchOrganization, courses, fetchCourses } = useDataStore()
  useEffect(() => {
    if (!organization) fetchOrganization()
    if (!courses?.length && fetchCourses) fetchCourses()
  }, [])
  const [postType, setPostType] = useState('expertise')
  const [selectedPlatforms, setSelectedPlatforms] = useState(['linkedin', 'facebook', 'instagram', 'gmb'])
  const [freeInput, setFreeInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generatedPosts, setGeneratedPosts] = useState(null) // { linkedin: '...', facebook: '...', ... }
  const [editedPosts, setEditedPosts] = useState({})
  const [previewPlatform, setPreviewPlatform] = useState('linkedin')
  const [selectedMedia, setSelectedMedia] = useState([])
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [editingId, setEditingId] = useState(null) // ID du brouillon en cours d'édition
  const [publishing, setPublishing] = useState(false)
  const [withStory, setWithStory] = useState(false)

  // ── Charger un brouillon pour édition ────────────────
  useEffect(() => {
    if (editingDraft) {
      const posts = {}
      const platforms = editingDraft.platforms || []
      if (editingDraft.content_linkedin) posts.linkedin = editingDraft.content_linkedin
      if (editingDraft.content_facebook) posts.facebook = editingDraft.content_facebook
      if (editingDraft.content_instagram) posts.instagram = editingDraft.content_instagram
      if (editingDraft.content_gmb) posts.gmb = editingDraft.content_gmb
      if (editingDraft.content_story) posts.story = editingDraft.content_story

      setGeneratedPosts(posts)
      setEditedPosts(posts)
      setSelectedPlatforms(platforms)
      setTitle(editingDraft.title || '')
      setPostType(editingDraft.post_type || 'expertise')
      setFreeInput(editingDraft.ai_prompt || '')
      // Convertir UTC → heure locale pour le champ datetime-local
      if (editingDraft.scheduled_at) {
        const d = new Date(editingDraft.scheduled_at)
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        setScheduledAt(local.toISOString().slice(0, 16))
      } else {
        setScheduledAt('')
      }
      setPreviewPlatform(platforms[0] || 'linkedin')
      setEditingId(editingDraft._recycle ? null : editingDraft.id) // Recycler = nouveau post
      setSelectedMedia((editingDraft.media_urls || []).map(url => ({ file_url: url })))
      if (editingDraft._recycle) {
        // Pré-remplir le contexte avec le titre du post recyclé pour que l'IA reformule
        setFreeInput(`Reformuler et améliorer ce post existant en gardant le même sujet mais avec un angle différent. Titre original : "${editingDraft.title || 'Sans titre'}"`)
        setGeneratedPosts(null)
        setEditedPosts({})
      }
      onClearDraft?.()
    }
  }, [editingDraft])

  const togglePlatform = (id) => {
    setSelectedPlatforms(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    )
  }

  // ── Génération IA ────────────────────────────────────
  const generateContent = async () => {
    if (selectedPlatforms.length === 0) {
      toast.error('Sélectionnez au moins une plateforme')
      return
    }
    setGenerating(true)
    try {
      const typeInfo = POST_TYPES.find(t => t.id === postType)

      // Contexte enrichi depuis les données de l'application
      const contextParts = []
      if (stats) {
        contextParts.push(`Chiffres réels de l'organisme (les seuls à citer) :`)
        if (stats.avgRating) contextParts.push(`- Note de satisfaction moyenne : ${stats.avgRating}/5`)
        if (stats.successRate) contextParts.push(`- Taux de réussite : ${stats.successRate} %`)
        if (stats.completedCount) contextParts.push(`- Sessions terminées récemment : ${stats.completedCount}`)
        if (stats.recentSessions?.length > 0) {
          const recent = stats.recentSessions.slice(0, 3)
          recent.forEach(s => {
            const courseName = s.course?.title || 'Formation'
            const location = s.location_city || s.location_name || ''
            contextParts.push(`- Session "${courseName}"${location ? ` à ${location}` : ''} (client confidentiel)`)
          })
        }
      }
      const catalogue = (courses || []).map(c => c.title).filter(Boolean)
      if (catalogue.length) contextParts.push(`Catalogue (intitulés exacts) : ${catalogue.join(' ; ')}`)

      const systemPrompt = buildSocialSystemPrompt(organization || {}, contextParts)

      const hasLinkedIn = selectedPlatforms.includes('linkedin')
      const tag = brandHashtag(organization || {})

      const userPrompt = `Génère un post de type "${typeInfo.label}" pour les plateformes : ${selectedPlatforms.join(', ')}.

${freeInput ? `Idée/contexte spécifique : ${freeInput}` : `Choisis un angle pertinent et original basé sur les données ci-dessus.`}

RAPPEL IMPORTANT :
- linkedin (page entreprise) : parler en "nous", PAS de hashtags dans le corps (commentaire séparé), question professionnelle ancrée terrain en fin de post
- Facebook : orienté Shares/partages, CTA "Partage à un dirigeant / RH"
- Instagram : DM shares prioritaires, CTA "Envoie ce post à ton responsable sécu / DRH"
- Formulations positives, sauf contexte accident où il faut être impactant
- Chaque plateforme a son propre style et sa propre longueur${withStory ? '\n- Générer aussi une version Story courte (5-7 mots max, impactant, format vertical)' : ''}

Réponds UNIQUEMENT en JSON valide (pas de markdown, pas de backticks) avec cette structure :
{
  "title": "titre interne court (3-5 mots)",
  ${selectedPlatforms.map(p => `"${p}": "texte du post pour ${p}"`).join(',\n  ')}${hasLinkedIn ? `,\n  "linkedin_hashtags": "3-5 hashtags pour le commentaire LinkedIn${tag ? ` dont ${tag}` : ''}"` : ''}${withStory ? `,\n  "story": "texte story 5-7 mots percutants pour Instagram/Facebook Stories"` : ''}
}`

      const response = await apiFetch('/api/ai-proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      })

      if (!response.ok) {
        const err = await response.text()
        throw new Error(`API ${response.status}: ${err}`)
      }

      const data = await response.json()
      
      // Vérifier si la réponse a été tronquée
      if (data.stop_reason === 'max_tokens') {
        throw new Error('Réponse tronquée - réessayez avec moins de plateformes')
      }
      
      const text = data.content?.[0]?.text || ''

      // Parser le JSON (enlever les backticks si présents)
      const cleanJson = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      let parsed
      try {
        parsed = JSON.parse(cleanJson)
      } catch (jsonErr) {
        console.error('JSON brut reçu:', text)
        throw new Error('L\'IA a renvoyé un JSON invalide - réessayez')
      }

      setGeneratedPosts(parsed)
      setEditedPosts(parsed)
      setTitle(parsed.title || '')

      // Mettre le preview sur la première plateforme sélectionnée
      if (selectedPlatforms.length > 0) {
        setPreviewPlatform(selectedPlatforms[0])
      }

      toast.success('Posts générés !')
    } catch (err) {
      console.error('Erreur génération:', err)
      toast.error('Erreur de génération : ' + err.message)
    }
    setGenerating(false)
  }

  // ── Régénérer une plateforme ─────────────────────────
  const regeneratePlatform = async (platform) => {
    // TODO: appel IA pour régénérer uniquement cette plateforme
    toast('Régénération à venir', { icon: '' })
  }

  // ── Sauvegarder le post ──────────────────────────────
  const savePost = async (status = 'draft') => {
    if (!editedPosts || selectedPlatforms.length === 0) return
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      const postData = {
        title: title || 'Sans titre',
        content_linkedin: editedPosts.linkedin || null,
        content_facebook: editedPosts.facebook || null,
        content_instagram: editedPosts.instagram || null,
        content_gmb: editedPosts.gmb || null,
        content_story: editedPosts.story || null,
        media_urls: selectedMedia.map(m => m.file_url),
        platforms: selectedPlatforms,
        status,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        post_type: postType,
        source_type: 'ai',
        ai_prompt: freeInput || null,
        created_by: user?.id,
        updated_at: new Date().toISOString(),
      }

      // Update si on édite un brouillon existant, sinon insert
      if (editingId) {
        const { error } = await supabase.from('social_posts').update(postData).eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('social_posts').insert(postData)
        if (error) throw error
      }

      toast.success(
        editingId 
          ? (status === 'draft' ? 'Brouillon mis à jour' : 'Publication planifiée !') 
          : (status === 'draft' ? 'Brouillon enregistré' : 'Publication planifiée !')
      )

      // Reset
      setGeneratedPosts(null)
      setEditedPosts({})
      setFreeInput('')
      setTitle('')
      setScheduledAt('')
      setSelectedMedia([])
      setEditingId(null)

      onSave?.()
    } catch (err) {
      console.error('Erreur sauvegarde:', err)
      toast.error('Erreur : ' + err.message)
    }
    setSaving(false)
  }

  // ── Copier le texte dans le presse-papier ────────────
  const copyToClipboard = (platform) => {
    const text = editedPosts[platform]
    if (!text) return
    navigator.clipboard.writeText(text)
    toast.success(`Copié pour ${PLATFORMS.find(p => p.id === platform)?.label} !`)
  }

  return (
    <div className="space-y-4">
      {/* Bandeau si on édite un brouillon */}
      {editingId && (
        <div className="bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] rounded-ui p-3 flex items-center justify-between">
          <span className="text-ui font-medium text-[rgb(var(--c-warning))]"> Édition du brouillon : <strong>{title}</strong></span>
          <button
            onClick={() => {
              setEditingId(null); setGeneratedPosts(null); setEditedPosts({}); setTitle(''); setFreeInput(''); setScheduledAt(''); setSelectedMedia([])
            }}
            className="text-ui-sm bg-white border border-[rgb(var(--c-warning)/0.3)] text-[rgb(var(--c-warning))] px-3 py-1 rounded-ui-sm hover:bg-[rgb(var(--c-warning-bg))]"
          >
             Annuler l'édition
          </button>
        </div>
      )}

      {/* Étape 1 : Type de post + Plateformes */}
      <div className="bg-white rounded-ui border p-4 space-y-4">
        <h2 className="font-bold text-[#0F2D35]">1⃣ Quel type de contenu ?</h2>

        {/* Types de post */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {POST_TYPES.map(type => (
            <button
              key={type.id}
              onClick={() => setPostType(type.id)}
              className={`p-2.5 rounded-ui-sm border text-left transition-all ${
                postType === type.id
                  ? 'border-[#E9B44C] bg-[rgb(var(--c-warning-bg))] ring-2 ring-[#E9B44C]/30'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="text-ui font-medium">{type.label}</div>
              <div className="text-ui-sm text-gray-500 mt-0.5 line-clamp-1">{type.desc}</div>
            </button>
          ))}
        </div>

        {/* Plateformes */}
        <div>
          <h3 className="text-ui font-medium text-gray-600 mb-2">Publier sur :</h3>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map(p => (
              <button
                key={p.id}
                onClick={() => togglePlatform(p.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-ui-sm border text-ui font-medium transition-all ${
                  selectedPlatforms.includes(p.id)
                    ? `border-${p.color}-400 bg-${p.color}-50 text-${p.color}-700 ring-1 ring-${p.color}-200`
                    : 'border-gray-200 text-gray-400 hover:border-gray-300'
                }`}
              >
                <span>{p.icon}</span>
                {p.label}
                {selectedPlatforms.includes(p.id) && <span className="text-[rgb(var(--c-success))]"></span>}
              </button>
            ))}
          </div>
        </div>

        {/* Input libre */}
        <div>
          <label className="text-ui font-medium text-gray-600">Idée ou contexte (optionnel) :</label>
          <textarea
            value={freeInput}
            onChange={e => setFreeInput(e.target.value)}
            placeholder="Ex : session de secourisme très dynamique hier, les stagiaires ont apprécié la mise en situation..."
            className="w-full mt-1 border rounded-ui-sm p-3 text-ui resize-none focus:ring-2 focus:ring-[#E9B44C] focus:border-transparent"
            rows={3}
          />
        </div>

        {/* Chiffres réels transmis à l'Aide à la rédaction */}
        {stats && (
          <div className="bg-gray-50 rounded-ui-sm p-3 text-ui-sm text-gray-600">
            <span className="font-medium text-gray-700">Chiffres disponibles :</span>
            <span className="ml-2">
              {[stats.avgRating ? `${stats.avgRating}/5 satisfaction` : null, stats.successRate ? `${stats.successRate} % réussite` : null, `${stats.completedCount} session${stats.completedCount > 1 ? 's' : ''} terminée${stats.completedCount > 1 ? 's' : ''}`].filter(Boolean).join(' • ')}
              {!stats.avgRating && !stats.successRate && ' (aucune évaluation encore : aucun chiffre ne sera cité)'}
            </span>
          </div>
        )}

        {/* Bouton Générer */}
        <button
          onClick={generateContent}
          disabled={generating || selectedPlatforms.length === 0}
          className="w-full py-3 bg-gradient-to-r from-[#0F2D35] to-[#1a4a56] text-white rounded-ui font-medium text-ui hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
        >
          {generating ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
              Génération en cours...
            </>
          ) : (
            <> Générer les posts</>
          )}
        </button>
      </div>

      {/* Étape 2 : Aperçu et édition */}
      {generatedPosts && (
        <div className="bg-white rounded-ui border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-[#0F2D35]">2⃣ Aperçu et édition</h2>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Titre interne..."
              className="text-ui border rounded-ui-sm px-3 py-1.5 w-64 focus:ring-2 focus:ring-[#E9B44C]"
            />
          </div>

          {/* Sélecteur de plateforme pour preview */}
          <div className="flex gap-1 bg-gray-100 rounded-ui-sm p-1">
            {selectedPlatforms.map(pId => {
              const p = PLATFORMS.find(x => x.id === pId)
              return (
                <button
                  key={pId}
                  onClick={() => setPreviewPlatform(pId)}
                  className={`flex-1 py-1.5 px-2 rounded-ui-sm text-ui-sm font-medium transition-all flex items-center justify-center gap-1 ${
                    previewPlatform === pId
                      ? 'bg-white shadow-sm text-[#0F2D35]'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {p?.icon} {p?.label}
                  {editedPosts[pId] && (
                    <span className="text-ui-sm text-gray-400">({editedPosts[pId].length})</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Zone d'édition */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Éditeur */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-ui font-medium text-gray-700">
                  {PLATFORMS.find(p => p.id === previewPlatform)?.icon}{' '}
                  {PLATFORMS.find(p => p.id === previewPlatform)?.label}
                </label>
                <div className="flex gap-1">
                  <button
                    onClick={() => copyToClipboard(previewPlatform)}
                    className="text-ui-sm bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-ui-sm transition-colors"
                    title="Copier"
                  >
                     Copier
                  </button>
                  <button
                    onClick={() => regeneratePlatform(previewPlatform)}
                    className="text-ui-sm bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-ui-sm transition-colors"
                    title="Régénérer"
                  >Régénérer</button>
                </div>
              </div>
              <textarea
                value={editedPosts[previewPlatform] || ''}
                onChange={e => setEditedPosts(prev => ({ ...prev, [previewPlatform]: e.target.value }))}
                className="w-full border rounded-ui-sm p-3 text-ui resize-none focus:ring-2 focus:ring-[#E9B44C] focus:border-transparent font-mono"
                rows={12}
              />
              <div className="flex justify-between text-ui-sm text-gray-400">
                <span>
                  {(editedPosts[previewPlatform] || '').length} / {PLATFORMS.find(p => p.id === previewPlatform)?.maxChars} caractères
                </span>
              </div>
              {/* Story générée */}
              {withStory && editedPosts.story && (
                <div className="bg-gray-50 border border-gray-200 rounded-ui-sm p-2 flex items-center justify-between">
                  <div className="text-ui-sm text-gray-800">
                    <span className="font-medium"> Story :</span> {editedPosts.story}
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(editedPosts.story); toast.success('Story copiée !') }}
                    className="text-ui-sm bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-ui-sm text-gray-800 ml-2 shrink-0"
                  >
                     Copier
                  </button>
                </div>
              )}

              {/* Hashtags LinkedIn à poster en commentaire */}
              {previewPlatform === 'linkedin' && editedPosts.linkedin_hashtags && (
                <div className="bg-[rgb(var(--c-info-bg))] border border-[rgb(var(--c-info)/0.3)] rounded-ui-sm p-2 flex items-center justify-between">
                  <div className="text-ui-sm text-[rgb(var(--c-info))]">
                    <span className="font-medium"> Commentaire LinkedIn :</span> {editedPosts.linkedin_hashtags}
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(editedPosts.linkedin_hashtags || ''); toast.success('Hashtags copiés !') }}
                    className="text-ui-sm bg-[rgb(var(--c-info-bg))] hover:bg-[rgb(var(--c-info-bg))] px-2 py-1 rounded-ui-sm text-[rgb(var(--c-info))] ml-2 shrink-0"
                  >
                     Copier
                  </button>
                </div>
              )}
            </div>

            {/* Preview visuel */}
            <div className="space-y-2">
              <label className="text-ui font-medium text-gray-700"> Aperçu</label>
              <PostPreview
                platform={previewPlatform}
                content={editedPosts[previewPlatform] || ''}
                media={selectedMedia}
              />
            </div>
          </div>

          {/* Médias */}
          <div>
            <h3 className="text-ui font-medium text-gray-600 mb-2"> Photos / Médias</h3>
            <div className="flex gap-2 flex-wrap">
              {selectedMedia.map((m, i) => (
                <div key={i} className="relative w-16 h-16 rounded-ui-sm overflow-hidden border">
                  <img src={m.file_url} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setSelectedMedia(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-0 right-0 bg-[rgb(var(--c-danger))] text-white text-ui-sm w-4 h-4 flex items-center justify-center rounded-bl-md"
                  >×</button>
                </div>
              ))}
              <MediaPicker
                media={media}
                selected={selectedMedia}
                onSelect={(m) => setSelectedMedia(prev => [...prev, m])}
              />
            </div>
          </div>

          {/* Planification + Actions */}
          <div className="flex flex-col gap-3 pt-2 border-t">
            {/* Story toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setWithStory(!withStory)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-ui-sm border text-ui-sm font-medium transition-all ${withStory ? 'border-gray-400 bg-gray-50 text-gray-800' : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}
              >
                 {withStory ? 'Story incluse ' : 'Générer une Story aussi'}
              </button>
              <span className="text-ui-sm text-gray-400">Instagram & Facebook Stories (5-7 mots percutants)</span>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-3">
            <div className="flex-1">
              <label className="text-ui-sm text-gray-500"> Planifier pour : <span className="text-ui-sm text-gray-400">(heure de Paris)</span></label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
                className="w-full mt-1 border rounded-ui-sm px-3 py-2 text-ui focus:ring-2 focus:ring-[#E9B44C]"
              />
              {/* Suggestions horaires rapides */}
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="text-ui-sm text-gray-400 w-full mb-0.5"> Horaires optimaux :</span>
                {[
                  { label: 'Mar 8h (LI)', day: 2, hour: 8 },
                  { label: 'Mar 9h (LI)', day: 2, hour: 9 },
                  { label: 'Mer 8h (LI)', day: 3, hour: 8 },
                  { label: 'Jeu 8h (LI)', day: 4, hour: 8 },
                  { label: 'Mer 12h (FB/IG)', day: 3, hour: 12 },
                  { label: 'Jeu 12h (FB/IG)', day: 4, hour: 12 },
                  { label: 'Ven 12h (FB/IG)', day: 5, hour: 12 },
                  { label: 'Ven 17h (FB/IG)', day: 5, hour: 17 },
                ].map(({ label, day, hour }) => {
                  const getNextWeekday = (targetDay, targetHour) => {
                    const now = new Date()
                    const current = now.getDay() // 0=dim, 1=lun...
                    const jsDay = targetDay === 7 ? 0 : targetDay
                    let daysUntil = jsDay - current
                    if (daysUntil <= 0) daysUntil += 7
                    const d = new Date(now)
                    d.setDate(d.getDate() + daysUntil)
                    d.setHours(targetHour, 0, 0, 0)
                    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                    return local.toISOString().slice(0, 16)
                  }
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setScheduledAt(getNextWeekday(day, hour))}
                      className="text-ui-sm bg-gray-100 hover:bg-[#E9B44C] hover:text-[#0F2D35] px-2 py-1 rounded-ui-sm transition-colors"
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => savePost('draft')}
                disabled={saving}
                className="px-4 py-2.5 bg-gray-200 text-gray-700 rounded-ui text-ui font-medium hover:bg-gray-300 disabled:opacity-50 transition-colors"
              >
                 Brouillon
              </button>
              <button
                onClick={() => savePost(scheduledAt ? 'scheduled' : 'draft')}
                disabled={saving || !scheduledAt}
                className="px-4 py-2.5 bg-[#E9B44C] text-[#0F2D35] rounded-ui text-ui font-bold hover:bg-[#d4a43e] disabled:opacity-50 transition-colors"
              >
                {saving ? '...' : ' Planifier'}
              </button>
              {/*  PUBLIER MAINTENANT */}
              <button
                onClick={async () => {
                  const connectedPlatforms = selectedPlatforms.filter(p => connections?.[p === 'gmb' ? 'gmb' : p]?.connected)
                  if (connectedPlatforms.length === 0) {
                    toast.error('Connectez d\'abord vos réseaux (panneau ci-dessus)')
                    return
                  }
                  if (!await confirmer(`Publier maintenant sur ${connectedPlatforms.map(p => PLATFORMS.find(x => x.id === p)?.label).join(', ')} ?`)) return

                  setPublishing(true)
                  try {
                    // D'abord sauvegarder le post
                    const { data: { user } } = await supabase.auth.getUser()
                    const postData = {
                      title: title || 'Sans titre',
                      content_linkedin: editedPosts.linkedin || null,
                                    content_facebook: editedPosts.facebook || null,
                      content_instagram: editedPosts.instagram || null,
                      content_gmb: editedPosts.gmb || null,
                      content_story: editedPosts.story || null,
                      media_urls: selectedMedia.map(m => m.file_url),
                      platforms: selectedPlatforms,
                      status: 'publishing',
                      post_type: postType,
                      source_type: 'ai',
                      ai_prompt: freeInput || null,
                      created_by: user?.id,
                    }

                    let postId = editingId
                    if (editingId) {
                      await supabase.from('social_posts').update(postData).eq('id', editingId)
                    } else {
                      const { data: newPost, error } = await supabase.from('social_posts').insert(postData).select('id').single()
                      if (error) throw error
                      postId = newPost.id
                    }

                    // Appeler l'API de publication
                    const pubRes = await apiFetch('/api/social/publish', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ post_id: postId }),
                    })
                    const pubData = await pubRes.json()

                    if (pubData.success) {
                      const results = pubData.results || {}
                      const published = Object.entries(results).filter(([_, r]) => r.status === 'published').map(([p]) => PLATFORMS.find(x => x.id === p)?.label)
                      const failed = Object.entries(results).filter(([_, r]) => r.status === 'error').map(([p, r]) => `${PLATFORMS.find(x => x.id === p)?.label}: ${r.reason}`)

                      if (published.length > 0) toast.success(`Publié sur ${published.join(', ')}`)
                      if (failed.length > 0) toast.error(`Échec : ${failed.join(' | ')}`)

                      // Reset
                      setGeneratedPosts(null); setEditedPosts({}); setFreeInput(''); setTitle(''); setScheduledAt(''); setSelectedMedia([]); setEditingId(null)
                      onSave?.()
                    } else {
                      throw new Error(pubData.error || 'Erreur publication')
                    }
                  } catch (err) {
                    console.error('Erreur publication:', err)
                    toast.error('Erreur : ' + err.message)
                  }
                  setPublishing(false)
                }}
                disabled={publishing || saving}
                className="px-4 py-2.5 bg-gray-50 text-white rounded-ui text-ui font-bold hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-1"
              >
                {publishing ? (
                  <><div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" /> Publication...</>
                ) : (
                  <> Publier maintenant</>
                )}
              </button>
              {/* Bouton copier tout */}
              <button
                onClick={() => {
                  const allTexts = selectedPlatforms
                    .map(pId => {
                      let text = `=== ${PLATFORMS.find(p => p.id === pId)?.label?.toUpperCase()} ===\n${editedPosts[pId] || ''}`
                      if (pId === 'linkedin' && editedPosts.linkedin_hashtags) {
                        text += `\n\n--- COMMENTAIRE LINKEDIN ---\n${editedPosts.linkedin_hashtags}`
                      }
                      return text
                    })
                    .join('\n\n')
                    + (withStory && editedPosts.story ? `\n\n=== STORY ===\n${editedPosts.story}` : '')
                  navigator.clipboard.writeText(allTexts)
                  toast.success('Tous les posts copiés !')
                }}
                className="px-5 py-2.5 bg-[#0F2D35] text-white rounded-ui text-ui font-medium hover:opacity-90 transition-colors"
              >
                 Tout copier
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
// PREVIEW DE POST
// ═══════════════════════════════════════════════════════════
function PostPreview({ platform, content, media }) {
  if (!content) return <div className="text-ui text-gray-400 italic p-4">Aucun contenu</div>

  const platformStyles = {
    linkedin: { bg: 'bg-white', border: 'border-gray-200', accent: '#0a66c2', name: orgName(), subtitle: ['Organisme de formation', orgCity()].filter(Boolean).join(' • ') },
    facebook: { bg: 'bg-white', border: 'border-gray-200', accent: '#1877f2', name: orgName(), subtitle: 'Organisme de formation' },
    instagram: { bg: 'bg-white', border: 'border-gray-200', accent: '#e4405f', name: orgName().toLowerCase().replace(/[^a-z0-9]/g, ''), subtitle: '' },
    gmb: { bg: 'bg-white', border: 'border-gray-200', accent: '#4285f4', name: orgName(), subtitle: orgCity() },
  }

  const style = platformStyles[platform] || platformStyles.linkedin

  return (
    <div className={`${style.bg} border ${style.border} rounded-ui overflow-hidden shadow-sm`}>
      {/* Header */}
      <div className="flex items-center gap-3 p-3 border-b border-gray-100">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-ui-sm font-bold" style={{ backgroundColor: style.accent }}>
          AF
        </div>
        <div>
          <div className="font-semibold text-ui">{style.name}</div>
          <div className="text-ui-sm text-gray-500">{style.subtitle}</div>
        </div>
      </div>

      {/* Image si présente */}
      {media?.length > 0 && (
        <div className="aspect-video bg-gray-100 flex items-center justify-center overflow-hidden">
          <img src={media[0].file_url} alt="" className="w-full h-full object-cover" />
        </div>
      )}

      {/* Contenu */}
      <div className="p-3">
        <p className="text-ui whitespace-pre-wrap leading-relaxed" style={{ maxHeight: '200px', overflow: 'auto' }}>
          {content}
        </p>
      </div>

      {/* Footer mock */}
      <div className="px-3 pb-3 flex items-center gap-4 text-ui-sm text-gray-400">
        {platform === 'linkedin' && <><span> J'aime</span><span> Commenter</span><span> Partager</span></>}
        {platform === 'facebook' && <><span> J'aime</span><span> Commenter</span><span>↗ Partager</span></>}
        {platform === 'instagram' && <><span></span><span></span><span></span><span></span></>}
        {platform === 'gmb' && <><span> Appeler</span><span> Itinéraire</span><span> Site web</span></>}
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
// SÉLECTEUR DE MÉDIAS
// ═══════════════════════════════════════════════════════════
function MediaPicker({ media, selected, onSelect }) {
  const [showPicker, setShowPicker] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const pickerRef = useRef(null)

  // Fermer le picker si on clique en dehors
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setShowPicker(false)
      }
    }
    if (showPicker) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showPicker])

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files)
    if (files.length === 0) return

    setUploading(true)
    for (const file of files) {
      try {
        const safeName = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')
        const fileName = `social/${Date.now()}_${safeName}`
        const { data, error } = await supabase.storage.from('media').upload(fileName, file)
        if (error) throw error

        const { data: urlData } = supabase.storage.from('media').getPublicUrl(fileName)
        const fileUrl = urlData.publicUrl

        const { data: mediaData, error: mediaError } = await supabase.from('social_media_library').insert({
          file_url: fileUrl,
          file_name: file.name,
          file_type: file.type.startsWith('video') ? 'video' : 'image',
          file_size: file.size,
        }).select().single()

        if (mediaError) throw mediaError
        onSelect(mediaData)
        toast.success(`${file.name} déposé`)
      } catch (err) {
        console.error('Erreur upload:', err)
        toast.error(`Erreur upload ${file.name}`)
      }
    }
    setUploading(false)
  }

  // Filtrer les images non déjà sélectionnées
  const selectedIds = (selected || []).map(s => s.id || s.file_url)
  const availableMedia = (media || []).filter(m => {
    const isSelected = selectedIds.includes(m.id) || selectedIds.includes(m.file_url)
    const matchesSearch = !searchTerm || m.file_name?.toLowerCase().includes(searchTerm.toLowerCase())
    return !isSelected && matchesSearch && m.file_type !== 'video'
  })

  return (
    <div className="relative" ref={pickerRef}>
      {/* Bouton principal */}
      <button
        type="button"
        onClick={() => setShowPicker(!showPicker)}
        className="w-16 h-16 rounded-ui-sm border-2 border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:border-[#E9B44C] hover:bg-[rgb(var(--c-warning-bg))] transition-all"
      >
        {uploading ? (
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-400 border-t-transparent" />
        ) : (
          <>
            <span className="text-lg"></span>
            <span className="text-ui-sm text-gray-400">Photo</span>
          </>
        )}
      </button>

      {/* Panneau de sélection */}
      {showPicker && (
        <div className="absolute bottom-full left-0 mb-2 bg-white rounded-ui shadow-md border z-50 w-80 max-h-96 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-3 border-b bg-gray-50">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-ui font-semibold text-[#0F2D35]"> Choisir une photo</h4>
              <button onClick={() => setShowPicker(false)} className="text-gray-400 hover:text-gray-600 text-lg">Fermer</button>
            </div>
            {/* Upload rapide */}
            <label className="flex items-center gap-2 px-3 py-2 bg-[#E9B44C] text-[#0F2D35] rounded-ui-sm cursor-pointer hover:bg-[#d4a43e] transition-colors text-ui-sm font-medium w-full justify-center">
               Uploader une nouvelle image
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => { handleFileUpload(e); }}
                className="hidden"
              />
            </label>
          </div>

          {/* Recherche */}
          {(media || []).length > 6 && (
            <div className="px-3 pt-2">
              <input
                type="text"
                placeholder=" Rechercher..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full border rounded-ui-sm px-2 py-1.5 text-ui-sm focus:ring-1 focus:ring-[#E9B44C]"
              />
            </div>
          )}

          {/* Grille médiathèque */}
          <div className="p-3 overflow-y-auto flex-1">
            {availableMedia.length > 0 ? (
              <>
                <p className="text-ui-sm text-gray-400 mb-2"> Médiathèque ({availableMedia.length} disponibles)</p>
                <div className="grid grid-cols-4 gap-2">
                  {availableMedia.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { onSelect(m); setShowPicker(false); }}
                      className="relative aspect-square rounded-ui-sm overflow-hidden border-2 border-transparent hover:border-[#E9B44C] transition-all group"
                    >
                      <img src={m.file_url} alt={m.file_name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                        <span className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 text-white text-lg transition-opacity"></span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-6 text-gray-400">
                <span className="text-2xl block mb-1"></span>
                <p className="text-ui-sm">{searchTerm ? 'Aucun résultat' : 'Médiathèque vide'}</p>
                <p className="text-ui-sm">Uploadez votre première image ci-dessus</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
// ONGLET CALENDRIER
// ═══════════════════════════════════════════════════════════
function CalendarTab({ posts, onUpdate }) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState(null)
  const [viewMode, setViewMode] = useState('calendar') // 'calendar' | 'list'

  const allPosts = posts.filter(p => ['scheduled', 'published', 'publishing', 'failed'].includes(p.status))

  // Posts à venir triés par date
  const upcomingPosts = allPosts
    .filter(p => p.status === 'scheduled')
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))

  // Historique (publiés + échoués) triés du plus récent
  const pastPosts = allPosts
    .filter(p => p.status !== 'scheduled')
    .sort((a, b) => new Date(b.scheduled_at || b.created_at) - new Date(a.scheduled_at || a.created_at))

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()

  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const daysInMonth = lastDay.getDate()

  let startDay = firstDay.getDay() - 1
  if (startDay < 0) startDay = 6

  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
  const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const getPostsForDay = (dayNum) => {
    return allPosts.filter(p => {
      const dateField = p.scheduled_at || p.created_at
      if (!dateField) return false
      const d = new Date(dateField)
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === dayNum
    })
  }

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1))
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1))
  const goToday = () => setCurrentMonth(new Date())

  const cells = []
  for (let i = 0; i < startDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const selectedPosts = selectedDay ? getPostsForDay(selectedDay) : []

  const statusConfig = {
    scheduled: { label: 'Planifié', bg: 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]', dot: 'bg-[rgb(var(--c-warning))]' },
    published: { label: 'Publié', bg: 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]', dot: 'bg-[rgb(var(--c-success))]' },
    publishing: { label: 'En cours', bg: 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]', dot: 'bg-[rgb(var(--c-info))]' },
    failed: { label: 'Échec', bg: 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]', dot: 'bg-[rgb(var(--c-danger))]' },
  }

  // Actions sur les posts
  const cancelPost = async (postId) => {
    if (!await confirmer('Annuler cette publication planifiée ?')) return
    await supabase.from('social_posts').update({ status: 'draft' }).eq('id', postId)
    toast.success('Publication annulée → remise en brouillon')
    onUpdate?.()
  }

  const deletePost = async (postId) => {
    if (!await confirmer('Supprimer définitivement cette publication ?')) return
    await supabase.from('social_posts').delete().eq('id', postId)
    toast.success('Publication supprimée')
    onUpdate?.()
  }

  const publishNow = async (postId) => {
    if (!await confirmer('Publier maintenant ?')) return
    try {
      const pubRes = await apiFetch('/api/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId }),
      })
      const pubData = await pubRes.json()
      if (pubData.success) {
        toast.success('Publication réussie !')
      } else {
        toast.error('Erreur publication')
      }
      onUpdate?.()
    } catch (err) {
      toast.error('Erreur : ' + err.message)
    }
  }

  // Carte de post réutilisable
  const PostCard = ({ p, showDate = false }) => (
    <div className={`rounded-ui-sm p-3 ${statusConfig[p.status]?.bg || 'bg-gray-100'}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-ui-sm font-semibold">{p.title || 'Sans titre'}</span>
            <span className="text-ui-sm opacity-70">{statusConfig[p.status]?.label}</span>
          </div>
          <div className="flex items-center gap-2 text-ui-sm opacity-70 flex-wrap">
            {showDate && p.scheduled_at && (
              <span> {new Date(p.scheduled_at).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            )}
            {p.scheduled_at && (
              <span> {new Date(p.scheduled_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
            )}
            <span className="flex gap-0.5">
              {p.platforms?.map(pl => (
                <span key={pl}>{PLATFORMS.find(x => x.id === pl)?.icon}</span>
              ))}
            </span>
          </div>
          {(p.content_facebook || p.content_linkedin) && (
            <p className="text-ui-sm opacity-60 mt-1 line-clamp-2">
              {(p.content_facebook || p.content_linkedin).slice(0, 120)}...
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 ml-2 flex-shrink-0">
          {p.media_urls?.[0] && (
            <img src={p.media_urls[0]} alt="" className="w-10 h-10 rounded-ui-sm object-cover" />
          )}
          {p.status === 'scheduled' && (
            <div className="flex gap-1 mt-1">
              <button onClick={() => publishNow(p.id)} className="text-ui-sm bg-[rgb(var(--c-success))] text-white px-1.5 py-0.5 rounded hover:bg-[rgb(var(--c-success))]" title="Publier maintenant">Publier</button>
              <button onClick={() => cancelPost(p.id)} className="text-ui-sm bg-gray-500 text-white px-1.5 py-0.5 rounded hover:bg-gray-600" title="Remettre en brouillon">Brouillon</button>
              <button onClick={() => deletePost(p.id)} className="text-ui-sm bg-[rgb(var(--c-danger))] text-white px-1.5 py-0.5 rounded hover:bg-[rgb(var(--c-danger))]" title="Supprimer">Supprimer</button>
            </div>
          )}
          {p.status === 'failed' && (
            <div className="flex gap-1 mt-1">
              <button onClick={() => publishNow(p.id)} className="text-ui-sm bg-[rgb(var(--c-warning))] text-white px-1.5 py-0.5 rounded hover:bg-[rgb(var(--c-warning))]" title="Réessayer">Réessayer</button>
              <button onClick={() => deletePost(p.id)} className="text-ui-sm bg-[rgb(var(--c-danger))] text-white px-1.5 py-0.5 rounded hover:bg-[rgb(var(--c-danger))]" title="Supprimer">Supprimer</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Toggle vue */}
      <div className="flex gap-2">
        <button
          onClick={() => setViewMode('calendar')}
          className={`flex-1 py-2 rounded-ui-sm text-ui font-medium transition-all ${viewMode === 'calendar' ? 'bg-white shadow-sm border text-[#0F2D35]' : 'text-gray-500 hover:text-gray-700'}`}
        >
           Calendrier
        </button>
        <button
          onClick={() => setViewMode('list')}
          className={`flex-1 py-2 rounded-ui-sm text-ui font-medium transition-all ${viewMode === 'list' ? 'bg-white shadow-sm border text-[#0F2D35]' : 'text-gray-500 hover:text-gray-700'}`}
        >
           Liste ({upcomingPosts.length} planifié{upcomingPosts.length > 1 ? 's' : ''})
        </button>
      </div>

      {viewMode === 'list' ? (
        <div className="bg-white rounded-ui border p-4 space-y-4">
          {/* Prochaines publications */}
          {upcomingPosts.length > 0 && (
            <div>
              <h3 className="text-ui font-bold text-[#0F2D35] mb-3"> Prochaines publications</h3>
              <div className="space-y-2">
                {upcomingPosts.map(p => <PostCard key={p.id} p={p} showDate />)}
              </div>
            </div>
          )}

          {/* Historique */}
          {pastPosts.length > 0 && (
            <div className={upcomingPosts.length > 0 ? 'border-t pt-4' : ''}>
              <h3 className="text-ui font-bold text-[#0F2D35] mb-3"> Historique</h3>
              <div className="space-y-2">
                {pastPosts.slice(0, 20).map(p => <PostCard key={p.id} p={p} showDate />)}
              </div>
            </div>
          )}

          {upcomingPosts.length === 0 && pastPosts.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              <div className="text-3xl mb-2"></div>
              <p className="text-ui">Aucune publication</p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-ui border p-4 space-y-4">
          {/* Header navigation */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={prevMonth} className="p-1.5 rounded-ui-sm hover:bg-gray-100 text-gray-500">◀</button>
              <h2 className="font-bold text-[#0F2D35] text-lg min-w-[200px] text-center">
                {monthNames[month]} {year}
              </h2>
              <button onClick={nextMonth} className="p-1.5 rounded-ui-sm hover:bg-gray-100 text-gray-500">▶</button>
              <button onClick={goToday} className="text-ui-sm bg-gray-100 text-gray-600 px-2.5 py-1 rounded-ui-sm hover:bg-gray-200 transition-colors">
                Aujourd'hui
              </button>
            </div>
            <div className="flex gap-1 items-center">
              <span className="w-2.5 h-2.5 rounded-full bg-[rgb(var(--c-warning))]" /> <span className="text-ui-sm text-gray-500 mr-2">Planifié</span>
              <span className="w-2.5 h-2.5 rounded-full bg-[rgb(var(--c-success))]" /> <span className="text-ui-sm text-gray-500 mr-2">Publié</span>
              <span className="w-2.5 h-2.5 rounded-full bg-[rgb(var(--c-danger))]" /> <span className="text-ui-sm text-gray-500">Échec</span>
            </div>
          </div>

          {/* Jours de la semaine */}
          <div className="grid grid-cols-7 gap-1">
            {dayNames.map(d => (
              <div key={d} className="text-center text-ui-sm font-semibold text-gray-400 py-1">{d}</div>
            ))}
          </div>

          {/* Grille du mois */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((dayNum, i) => {
              if (dayNum === null) return <div key={`empty-${i}`} className="aspect-square" />
              const dayPosts = getPostsForDay(dayNum)
              const cellDate = new Date(year, month, dayNum)
              const isToday = cellDate.getTime() === today.getTime()
              const isSelected = selectedDay === dayNum
              const isPast = cellDate < today
              const hasPosts = dayPosts.length > 0
              return (
                <button
                  key={dayNum}
                  onClick={() => setSelectedDay(isSelected ? null : dayNum)}
                  className={`aspect-square rounded-ui-sm border relative flex flex-col items-center justify-start pt-1 transition-all ${
                    isSelected ? 'border-[#E9B44C] bg-[rgb(var(--c-warning-bg))] ring-2 ring-[#E9B44C]/30'
                    : isToday ? 'border-[#E9B44C] bg-[rgb(var(--c-warning-bg))]'
                    : hasPosts ? 'border-gray-200 hover:border-[#E9B44C] hover:bg-[rgb(var(--c-warning-bg))]'
                    : isPast ? 'border-gray-100 text-gray-300'
                    : 'border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <span className={`text-ui-sm font-medium ${isToday ? 'text-[#E9B44C] font-bold' : isPast && !hasPosts ? 'text-gray-300' : 'text-gray-600'}`}>
                    {dayNum}
                  </span>
                  {hasPosts && (
                    <div className="flex gap-0.5 mt-1 flex-wrap justify-center">
                      {dayPosts.slice(0, 4).map((p, idx) => (
                        <span key={idx} className={`w-2 h-2 rounded-full ${statusConfig[p.status]?.dot || 'bg-gray-300'}`} title={`${p.title} - ${statusConfig[p.status]?.label}`} />
                      ))}
                      {dayPosts.length > 4 && <span className="text-ui-sm text-gray-400">+{dayPosts.length - 4}</span>}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Détail du jour sélectionné */}
          {selectedDay && (
            <div className="border-t pt-4">
              <h3 className="text-ui font-semibold text-[#0F2D35] mb-3">
                 {selectedDay} {monthNames[month]} {year}
                <span className="text-gray-400 font-normal ml-2">{selectedPosts.length} publication{selectedPosts.length > 1 ? 's' : ''}</span>
              </h3>
              {selectedPosts.length > 0 ? (
                <div className="space-y-2">
                  {selectedPosts.map(p => <PostCard key={p.id} p={p} />)}
                </div>
              ) : (
                <p className="text-ui-sm text-gray-400 text-center py-4">Aucune publication ce jour</p>
              )}
            </div>
          )}

          {allPosts.length === 0 && !selectedDay && (
            <div className="text-center py-8 text-gray-400">
              <div className="text-3xl mb-2"></div>
              <p className="text-ui">Aucune publication planifiée</p>
              <p className="text-ui-sm">Utilisez le générateur pour créer vos premiers posts !</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
// ONGLET MÉDIATHÈQUE
// ═══════════════════════════════════════════════════════════
function LibraryTab({ media, onUpdate }) {
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files)
    if (files.length === 0) return

    setUploading(true)
    let count = 0
    for (const file of files) {
      try {
        const safeName = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')
        const fileName = `social/${Date.now()}_${safeName}`
        const { error: upErr } = await supabase.storage.from('media').upload(fileName, file)
        if (upErr) throw upErr

        const { data: urlData } = supabase.storage.from('media').getPublicUrl(fileName)

        await supabase.from('social_media_library').insert({
          file_url: urlData.publicUrl,
          file_name: file.name,
          file_type: file.type.startsWith('video') ? 'video' : 'image',
          file_size: file.size,
        })
        count++
      } catch (err) {
        console.error('Erreur upload:', err)
      }
    }
    toast.success(`${count} fichier(s) déposé(s)`)
    setUploading(false)
    onUpdate?.()
  }

  const deleteMedia = async (id, fileUrl) => {
    if (!await confirmer('Supprimer cette image ?')) return
    try {
      await supabase.from('social_media_library').delete().eq('id', id)
      toast.success('Supprimé')
      onUpdate?.()
    } catch (err) {
      toast.error('Erreur suppression')
    }
  }

  return (
    <div className="bg-white rounded-ui border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-[#0F2D35]"> Médiathèque</h2>
        <label className="bg-[#0F2D35] text-white text-ui px-4 py-2 rounded-ui-sm cursor-pointer hover:opacity-90 transition-colors">
          {uploading ? ' Upload...' : ' Ajouter des photos'}
          <input type="file" accept="image/*,video/*" multiple onChange={handleUpload} className="hidden" />
        </label>
      </div>

      {media.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3"></div>
          <p className="text-ui font-medium">Pas encore de médias</p>
          <p className="text-ui-sm mt-1">Uploadez vos photos de formations, logos, visuels pour les réutiliser dans vos posts</p>
        </div>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {media.map(m => (
            <div key={m.id} className="relative group aspect-square rounded-ui-sm overflow-hidden border border-gray-200 cursor-pointer">
              <img src={m.file_url} alt={m.file_name} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
                <button
                  onClick={() => deleteMedia(m.id, m.file_url)}
                  className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 bg-[rgb(var(--c-danger))] text-white text-ui-sm px-2 py-1 rounded-ui-sm transition-all"
                >Supprimer</button>
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-ui-sm p-1 truncate [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-all">
                {m.file_name}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
// ONGLET BROUILLONS
// ═══════════════════════════════════════════════════════════
function DraftsTab({ posts, onUpdate, onEdit, onRecycle }) {
  const deleteDraft = async (id) => {
    if (!await confirmer('Supprimer ce brouillon ?')) return
    await supabase.from('social_posts').delete().eq('id', id)
    toast.success('Brouillon supprimé')
    onUpdate?.()
  }

  const copyPost = (post, platform) => {
    const content = post[`content_${platform}`]
    if (!content) return
    navigator.clipboard.writeText(content)
    toast.success(`Copié pour ${PLATFORMS.find(p => p.id === platform)?.label} !`)
  }

  if (posts.length === 0) {
    return (
      <div className="bg-white rounded-ui border p-8 text-center text-gray-400">
        <div className="text-3xl mb-2"></div>
        <p className="text-ui">Aucun brouillon</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {posts.map(post => (
        <div key={post.id} className="bg-white rounded-ui border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium text-ui">{post.title || 'Sans titre'}</span>
              <span className="text-ui-sm text-gray-400 ml-2">
                {new Date(post.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {post.platforms?.map(pl => (
                <span key={pl}>{PLATFORMS.find(x => x.id === pl)?.icon}</span>
              ))}
              <button onClick={() => deleteDraft(post.id)} className="ml-2 text-[rgb(var(--c-danger))] hover:text-[rgb(var(--c-danger))] text-ui">Supprimer</button>
            </div>
          </div>

          {/* Preview du contenu */}
          <div className="text-ui-sm text-gray-600 line-clamp-3">
            {post.content_linkedin || post.content_facebook || post.content_instagram || post.content_gmb || 'Aucun contenu'}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 pt-1 flex-wrap">
            <button
              onClick={() => onEdit?.(post)}
              className="text-ui-sm bg-[#E9B44C] text-[#0F2D35] font-bold px-3 py-1.5 rounded-ui-sm hover:bg-[#d4a43e] transition-colors"
            >
               Reprendre
            </button>
            <button
              onClick={() => onRecycle?.(post)}
              className="text-ui-sm bg-gray-100 text-gray-800 font-bold px-3 py-1.5 rounded-ui-sm hover:bg-gray-200 transition-colors"
              title="Reformuler ce post avec l'IA"
            >
               Recycler
            </button>
            {post.platforms?.map(pl => (
              <button
                key={pl}
                onClick={() => copyPost(post, pl)}
                className="text-ui-sm bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-ui-sm transition-colors"
              >
                 {PLATFORMS.find(x => x.id === pl)?.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

import { setCurrentProfile, setTeamCache, profileName, setSocieteCache, ROLES_HORS_EQUIPE } from './org/currentOrg'
import { create } from 'zustand'
import toast from 'react-hot-toast'
import { supabase, ADMIN_EMAILS } from './supabase'
import { buildStorageFileName } from './storageUtils'
import { fetchAll, fetchAllIn } from './fetchAll'
import { configureCompanyContext } from './company/companyContext'
import { chargerDroits, aLeDroit } from './rights/rights'
import { chargerContexteSocietes, chargerIdentiteSociete } from './company/societes'

// ─── Résolution du rôle et du profil d'un utilisateur connecté ─────
// Source de vérité : la table profiles (rôle, identité affichée, préférences).
// Replis temporaires du lot 0 : administrateurs d'amorçage (variable d'environnement)
// et comptable déclaré dans les paramètres de l'organisme (organization_settings).
async function resolveAccess(authUser) {
  const email = authUser?.email?.toLowerCase()
  if (!email) return null

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle()
  // Lecture refusée ou échouée (jeton pas encore posé, réseau) : ce n'est pas un refus d'accès.
  // Depuis le chantier 2, un visiteur sans jeton ne lit plus les profils : sans cette garde,
  // une lecture partie trop tôt pendant la connexion déconnectait le compte.
  if (profileError) return { transient: true }

  if (profile && profile.is_active === false) return null
  if (profile?.role) return { role: profile.role, profile }

  if (ADMIN_EMAILS.includes(email)) {
    return { role: 'admin', profile: profile || { id: authUser.id, email, display_name: email.split('@')[0], role: 'admin', ui_prefs: {} } }
  }

  const { data: orgSettings } = await supabase
    .from('organization_settings')
    .select('comptable_email')
    .limit(1)
    .maybeSingle()
  if (orgSettings?.comptable_email && orgSettings.comptable_email.toLowerCase() === email) {
    return { role: 'comptable', profile: profile || { id: authUser.id, email, display_name: email.split('@')[0], role: 'comptable', ui_prefs: {} } }
  }

  return null
}

// Champs de l'organisme remplacés par ceux de la société courante quand ce n'est pas celle de l'instance (C3)
const IDENTITE_SOCIETE = ['name', 'legal_name', 'forme_juridique', 'capital_social', 'siren', 'siret', 'naf', 'tva_intra', 'tva_applicable',
  'rcs', 'nda', 'address', 'postal_code', 'city', 'phone', 'email', 'website', 'bank_name', 'iban', 'bic', 'logo_url', 'doc_prefix']

async function fetchEnabledModules() {
  const { data } = await supabase.from('org_modules').select('key, enabled, position').order('position')
  return (data || []).filter((m) => m.enabled).map((m) => m.key)
}

// Store pour l'authentification
export const useAuthStore = create((set, get) => ({
  user: null,
  profile: null,
  userRole: null, // superadmin | admin | direction | gestionnaire | formateur | commercial | comptable | lecture
  modules: [],
  fieldOnly: false, // technicien de terrain (Interventions seulement)
  // Droits composés dans la société courante (C1b), lus en base par my_rights ; null = inconnus (comportement d'avant)
  rights: null,
  // Sociétés du compte, société courante, vue groupe (C3) ; null tant que la base ne le propose pas
  societes: null,
  loading: true,
  error: null,

  applySession: async (session) => {
    if (!session?.user) {
      configureCompanyContext({})
      set({ user: null, profile: null, userRole: null, modules: [], fieldOnly: false, rights: null, societes: null })
      return false
    }
    let access = await resolveAccess(session.user)
    for (let i = 0; access?.transient && i < 2; i++) {
      await new Promise((r) => setTimeout(r, 400))
      access = await resolveAccess(session.user)
    }
    if (access?.transient) {
      // Pas de déconnexion sur une erreur passagère : le compte reste connecté, l'écran demande de recharger
      set({ error: 'Connexion momentanément impossible : rechargez la page.' })
      return false
    }
    if (!access) {
      await supabase.auth.signOut()
      set({ user: null, profile: null, userRole: null, modules: [], fieldOnly: false, rights: null, societes: null })
      return false
    }
    setCurrentProfile(access.profile)
    // Lectures indépendantes lancées ensemble (performance, 19/10) : modules, équipe, droits (C1b), sociétés (C3).
    // Chacune garde son comportement en cas d'échec (liste vide, null).
    const chargerEquipe = async () => {
      try {
        const { data: members } = await supabase.from('profiles').select('id, first_name, last_name, display_name, email, sender_email, role, is_active')
        setTeamCache((members || [])
          .filter((m) => m.is_active !== false && !['comptable', 'lecture', 'formateur_externe', ...ROLES_HORS_EQUIPE].includes(m.role))
          .map((m) => ({ id: m.id, name: profileName(m), firstName: m.first_name || profileName(m).split(' ')[0], email: m.sender_email || m.email, role: m.role })))
      } catch {
        setTeamCache([])
      }
    }
    const [modules, , rights, societes] = await Promise.all([
      fetchEnabledModules(), chargerEquipe(), chargerDroits(supabase), chargerContexteSocietes(supabase),
    ])
    // Technicien de terrain : compte en lecture coché technicien dans le module Interventions.
    // Il ne voit que ses interventions (menu, pages et recherche limités dans Layout).
    let fieldOnly = false
    if (access.role === 'lecture' && modules.includes('interventions')) {
      try {
        const { data: tech } = await supabase.from('itv_technicians').select('is_active').eq('profile_id', access.profile.id).maybeSingle()
        fieldOnly = !!tech?.is_active
      } catch { fieldOnly = false }
    }
    configureCompanyContext({ role: access.role })
    // Sociétés (C3) : modules actifs dans la société courante, identité de la société pour les documents
    setSocieteCache(await chargerIdentiteSociete(supabase, societes))
    const modulesSociete = societes && Array.isArray(societes.modules) ? societes.modules : modules
    set({ user: session.user, profile: access.profile, userRole: access.role, modules: modulesSociete, fieldOnly, rights, societes })
    return true
  },

  initialize: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await get().applySession(session)
      set({ loading: false })

      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_OUT') {
          configureCompanyContext({})
          set({ user: null, profile: null, userRole: null, modules: [], fieldOnly: false, rights: null, societes: null })
          return
        }
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          // Pendant login(), c'est login() qui applique la session (évite deux applications concurrentes).
          // Appel différé : la bibliothèque déconseille d'interroger la base dans ce rappel.
          if (get().loggingIn) return
          setTimeout(() => {
            if (!get().user || get().user.id !== session?.user?.id) get().applySession(session)
          }, 0)
        }
      })
    } catch (error) {
      set({ error: error.message, loading: false })
    }
  },

  login: async (email, password) => {
    set({ loading: true, error: null, loggingIn: true })
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      set({ loading: false, error: error.message, loggingIn: false })
      return { error: error.message }
    }
    const ok = await get().applySession(data.session)
    set({ loggingIn: false })
    if (!ok && get().error) {
      set({ loading: false })
      return { error: get().error }
    }
    if (!ok) {
      set({ loading: false, error: 'Ce compte n\'a pas accès à cette instance' })
      return { error: 'Ce compte n\'a pas accès à cette instance' }
    }
    set({ loading: false })
    return { data }
  },

  // scope « local » (déconnexion pour inactivité) : seule la session de cet appareil est fermée côté serveur ;
  // sans option, comme avant (toutes les sessions du compte)
  logout: async (options = {}) => {
    configureCompanyContext({})
    try { await supabase.auth.signOut(options.scope ? { scope: options.scope } : undefined) } catch { /* jeton déjà expiré : session locale effacée quand même */ }
    set({ user: null, profile: null, userRole: null, modules: [], fieldOnly: false, rights: null, societes: null })
    // Les données chargées restent en mémoire : un rechargement complet évite que le compte suivant
    // les voie dans le même onglet avant que la base ne les filtre.
    try { window.location.replace(`${window.location.pathname}#/login`); window.location.reload() } catch { /* hors navigateur */ }
  },

  refreshModules: async () => {
    const societes = await chargerContexteSocietes(supabase)
    const modules = societes && Array.isArray(societes.modules) ? societes.modules : await fetchEnabledModules()
    set({ modules, societes: societes || get().societes })
  },

  // Préférences d'affichage : mémorisées sur le profil (et en cache local par le hook)
  saveUiPrefs: async (ui_prefs) => {
    const profile = get().profile
    if (!profile?.id) return
    set({ profile: { ...profile, ui_prefs } })
    await supabase.from('profiles').update({ ui_prefs }).eq('id', profile.id)
  },

  hasRole: (...roles) => roles.includes(get().userRole),
  // Droit composé (C1b) : true ou false si les droits sont connus, null sinon (l'appelant garde son repli sur le rôle)
  can: (code) => aLeDroit(get().rights, code),
  refreshRights: async () => {
    const rights = await chargerDroits(supabase)
    set({ rights })
    return rights
  },
  isAdmin: () => ['superadmin', 'admin'].includes(get().userRole),
  isSuperadmin: () => get().userRole === 'superadmin',
}))


// Store principal pour les données
export const useDataStore = create((set, get) => ({
  // ========== CLIENTS ==========
  clients: [],
  clientsLoading: false,
  
  fetchClients: async () => {
    set({ clientsLoading: true })
    const { data, error } = await fetchAll(() => supabase
      .from('clients')
      .select('*')
      .order('name'))
    if (!error) set({ clients: data || [] })
    set({ clientsLoading: false })
    return { data, error }
  },
  
  getClient: async (id) => {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', id)
      .single()
    return { data, error }
  },
  
  createClient: async (client) => {
    // Colonnes exactes de ta table clients
    // Normalisation siret/siren : on ne garde que les chiffres.
    // Évite l'erreur 22001 (value too long for varchar(14)) quand le SIRET
    // est collé avec des espaces depuis Pappers/INSEE ("869 802 249 00019").
    const cleanSiret = client.siret ? String(client.siret).replace(/\D/g, '') : null
    const cleanSiren = (client.siren ? String(client.siren).replace(/\D/g, '') : null)
      || (cleanSiret ? cleanSiret.slice(0, 9) : null)
    const validClient = {
      name: client.name,
      address: client.address || null,
      postal_code: client.postal_code || null,
      city: client.city || null,
      siret: cleanSiret,
      siren: cleanSiren,
      contact_name: client.contact_name || null,
      contact_function: client.contact_function || null,
      contact_email: client.contact_email || client.email || null,
      contact_phone: client.contact_phone || client.phone || null,
      website: client.website || null,
      opco_name: client.opco_name || null,
      taille_entreprise: client.taille_entreprise || null,
      tva: client.vat_exempt ? null : (client.tva || null),
      vat_exempt: !!client.vat_exempt,
      notes: client.notes || null,
      status: client.status || 'prospect',
      client_type: client.client_type || 'entreprise',
    }
    // Lot 2 (0041) : informations reprises du répertoire, envoyées seulement quand elles existent
    for (const k of ['legal_name', 'forme_juridique', 'naf_code', 'naf', 'naf_label', 'effectif', 'dirigeant_nom', 'dirigeant_qualite',
      'date_creation', 'etat_administratif', 'registry_snapshot', 'registry_synced_at']) {
      if (client[k] != null && client[k] !== '') validClient[k] = client[k]
    }
    console.log('Creating client:', validClient)
    const { data, error } = await supabase
      .from('clients')
      .insert([validClient])
      .select()
      .single()
    if (error) console.error('Client creation error:', error)
    if (!error && data) {
      set({ clients: [...get().clients, data] })
    }
    return { data, error }
  },
  
  updateClient: async (id, updates) => {
    // Colonnes exactes de ta table clients
    const validUpdates = {}
    if (updates.name !== undefined) validUpdates.name = updates.name
    if (updates.address !== undefined) validUpdates.address = updates.address
    if (updates.postal_code !== undefined) validUpdates.postal_code = updates.postal_code
    if (updates.city !== undefined) validUpdates.city = updates.city
    if (updates.siret !== undefined) validUpdates.siret = updates.siret
    if (updates.siren !== undefined) validUpdates.siren = updates.siren
    if (updates.contact_name !== undefined) validUpdates.contact_name = updates.contact_name
    if (updates.contact_function !== undefined) validUpdates.contact_function = updates.contact_function
    if (updates.contact_email !== undefined) validUpdates.contact_email = updates.contact_email
    if (updates.email !== undefined) validUpdates.contact_email = updates.email
    if (updates.contact_phone !== undefined) validUpdates.contact_phone = updates.contact_phone
    if (updates.phone !== undefined) validUpdates.contact_phone = updates.phone
    if (updates.website !== undefined) validUpdates.website = updates.website
    if (updates.opco_name !== undefined) validUpdates.opco_name = updates.opco_name
    if (updates.taille_entreprise !== undefined) validUpdates.taille_entreprise = updates.taille_entreprise
    if (updates.notes !== undefined) validUpdates.notes = updates.notes
    if (updates.status !== undefined) validUpdates.status = updates.status
    if (updates.client_type !== undefined) validUpdates.client_type = updates.client_type
    if (updates.tva !== undefined) validUpdates.tva = updates.tva
    if (updates.vat_exempt !== undefined) validUpdates.vat_exempt = !!updates.vat_exempt
    
    console.log('Updating client:', id, validUpdates)
    const { data, error } = await supabase
      .from('clients')
      .update(validUpdates)
      .eq('id', id)
      .select()
      .single()
    if (error) console.error('Client update error:', error)
    if (!error && data) {
      set({ clients: get().clients.map(c => c.id === id ? data : c) })
    }
    return { data, error }
  },
  
  deleteClient: async (id) => {
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (!error) {
      set({ clients: get().clients.filter(c => c.id !== id) })
    }
    return { error }
  },

  // ========== FORMATIONS (COURSES) ==========
  courses: [],
  coursesLoading: false,
  
  fetchCourses: async () => {
    set({ coursesLoading: true })
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .order('code')
    if (!error) set({ courses: data || [] })
    set({ coursesLoading: false })
    return { data, error }
  },
  
  getCourse: async (id) => {
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .eq('id', id)
      .single()
    return { data, error }
  },
  
  createCourse: async (course) => {
    const { data, error } = await supabase
      .from('courses')
      .insert([course])
      .select()
      .single()
    if (!error && data) {
      set({ courses: [...get().courses, data] })
    }
    return { data, error }
  },
  
  updateCourse: async (id, updates) => {
    const { data, error } = await supabase
      .from('courses')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (!error && data) {
      set({ courses: get().courses.map(c => c.id === id ? data : c) })
    }
    return { data, error }
  },
  
  deleteCourse: async (id) => {
    const { error } = await supabase.from('courses').delete().eq('id', id)
    if (!error) {
      set({ courses: get().courses.filter(c => c.id !== id) })
    }
    return { error }
  },

  // ========== FORMATEURS (TRAINERS) ==========
  trainers: [],
  trainersLoading: false,
  
  fetchTrainers: async () => {
    set({ trainersLoading: true })
    const { data, error } = await supabase
      .from('trainers')
      .select('*')
      .order('last_name')
    if (!error) set({ trainers: data || [] })
    set({ trainersLoading: false })
    return { data, error }
  },
  
  createTrainer: async (trainer) => {
    const validTrainer = {
      first_name: trainer.first_name,
      last_name: trainer.last_name,
      email: trainer.email,
      phone: trainer.phone || null,
      specialties: trainer.specialties || null,
      bio: trainer.bio || null,
      certifications: trainer.certifications || null,
      hourly_rate: trainer.hourly_rate || null,
      notes: trainer.notes || null,
      qualifications: trainer.qualifications || null,
      certification_number: trainer.certification_number || null,
      is_internal: trainer.is_internal ?? true,
      qualifications_list: trainer.qualifications_list || [],
    }
    console.log('Creating trainer:', validTrainer)
    const { data, error } = await supabase
      .from('trainers')
      .insert([validTrainer])
      .select()
      .single()
    if (error) console.error('Trainer creation error:', error)
    if (!error && data) {
      set({ trainers: [...get().trainers, data] })
    }
    return { data, error }
  },
  
  updateTrainer: async (id, updates) => {
    const validUpdates = {}
    if (updates.first_name !== undefined) validUpdates.first_name = updates.first_name
    if (updates.last_name !== undefined) validUpdates.last_name = updates.last_name
    if (updates.email !== undefined) validUpdates.email = updates.email
    if (updates.phone !== undefined) validUpdates.phone = updates.phone
    if (updates.specialties !== undefined) validUpdates.specialties = updates.specialties
    if (updates.bio !== undefined) validUpdates.bio = updates.bio
    if (updates.certifications !== undefined) validUpdates.certifications = updates.certifications
    if (updates.hourly_rate !== undefined) validUpdates.hourly_rate = updates.hourly_rate
    if (updates.notes !== undefined) validUpdates.notes = updates.notes
    if (updates.qualifications !== undefined) validUpdates.qualifications = updates.qualifications
    if (updates.certification_number !== undefined) validUpdates.certification_number = updates.certification_number
    if (updates.is_internal !== undefined) validUpdates.is_internal = updates.is_internal
    if (updates.qualifications_list !== undefined) validUpdates.qualifications_list = updates.qualifications_list
    
    console.log('Updating trainer:', id, validUpdates)
    const { data, error } = await supabase
      .from('trainers')
      .update(validUpdates)
      .eq('id', id)
      .select()
      .single()
    if (error) console.error('Trainer update error:', error)
    if (!error && data) {
      set({ trainers: get().trainers.map(t => t.id === id ? data : t) })
    }
    return { data, error }
  },
  
  deleteTrainer: async (id) => {
    const { error } = await supabase.from('trainers').delete().eq('id', id)
    if (!error) {
      set({ trainers: get().trainers.filter(t => t.id !== id) })
    }
    return { error }
  },

  // ========== STAGIAIRES (TRAINEES) ==========
  trainees: [],
  traineesLoading: false,
  
  fetchTrainees: async () => {
    set({ traineesLoading: true })
    // Utilise la table directe avec jointure client
    // Le N° sécu sera déchiffré uniquement à la demande (fiche détaillée)
    const { data, error } = await fetchAll(() => supabase
      .from('trainees')
      .select('*, clients(id, name)')
      .order('last_name'))
    if (!error) set({ trainees: data || [] })
    set({ traineesLoading: false })
    return { data, error }
  },
  
  // Récupérer un stagiaire avec son N° sécu déchiffré
  getTraineeWithSSN: async (id) => {
    // Lecture contrôlée par la base : direction, gestion et formateur de la session
    const { data, error } = await supabase
      .rpc('get_trainee_with_ssn', { p_id: id })
    if (error) {
      console.error('getTraineeWithSSN error:', error)
      return { data: null, error }
    }
    return { data: data?.[0] || null, error: null }
  },
  
  createTrainee: async (trainee) => {
    console.log('Utilisation de l\'insert direct (RPC désactivée temporairement)')
    
    // Insert direct dans la table trainees
    const { data, error } = await supabase
      .from('trainees')
      .insert([trainee])
      .select('*, clients(id, name)')
      .single()
    
    console.log('Insert result:', { data, error })
    
    if (!error && data) {
      console.log('Adding trainee to state:', data)
      set({ trainees: [...get().trainees, data] })
    }
    
    return { data, error }
  },
  
  updateTrainee: async (id, updates) => {
    // Essayer d'utiliser la RPC sécurisée
    const { data: rpcData, error: rpcError } = await supabase
      .rpc('save_trainee_with_ssn', {
        p_id: id,
        p_first_name: updates.first_name,
        p_last_name: updates.last_name,
        p_email: updates.email || null,
        p_phone: updates.phone || null,
        p_ssn: updates.social_security_number || null,
        p_client_id: updates.client_id || null,
        p_notes: updates.notes || null,
        p_birth_date: updates.birth_date || null,
        p_refused_ssn: updates.refused_ssn || false,
        p_has_disability: updates.has_disability || false,
        p_disability_details: updates.disability_details || null,
        p_disability_adaptations: updates.disability_adaptations || null,
        p_csp: updates.csp || null,
        p_job_title: updates.job_title || null
      })
    
    if (rpcError) {
      console.warn('RPC save_trainee_with_ssn not available, using direct update:', rpcError)
      // Fallback sur l'update classique
      const { data, error } = await supabase
        .from('trainees')
        .update(updates)
        .eq('id', id)
        .select('*, clients(id, name)')
        .single()
      if (!error && data) {
        set({ trainees: get().trainees.map(t => t.id === id ? data : t) })
      }
      return { data, error }
    }
    
    // La RPC ne gère pas csp, job_title et gender, donc on les met à jour séparément
    if (updates.csp !== undefined || updates.job_title !== undefined || updates.gender !== undefined) {
      const extraFields = {}
      if (updates.csp !== undefined) extraFields.csp = updates.csp
      if (updates.job_title !== undefined) extraFields.job_title = updates.job_title
      if (updates.gender !== undefined) extraFields.gender = updates.gender
      
      await supabase
        .from('trainees')
        .update(extraFields)
        .eq('id', id)
    }
    
    // Récupérer le stagiaire mis à jour
    const { data: updatedTrainee } = await supabase
      .from('trainees')
      .select('*, clients(id, name)')
      .eq('id', id)
      .single()
    if (updatedTrainee) {
      set({ trainees: get().trainees.map(t => t.id === id ? updatedTrainee : t) })
    }
    return { data: updatedTrainee, error: null }
  },
  
  deleteTrainee: async (id) => {
    const { error } = await supabase.from('trainees').delete().eq('id', id)
    if (!error) {
      set({ trainees: get().trainees.filter(t => t.id !== id) })
    }
    return { error }
  },

  // ========== SESSIONS ==========
  sessions: [],
  sessionsLoading: false,
  currentSession: null,
  
  fetchSessions: async () => {
    set({ sessionsLoading: true })
    
    try {
      // Charger toutes les données en parallèle pour éviter la latence
      const [
        { data: sessionsData, error: sessionsError },
        { data: coursesData },
        { data: clientsData },
        { data: trainersData },
        { data: traineesData },
        { data: sessionTraineesData },
        { data: contactsData }
      ] = await Promise.all([
        // fetchAll : pagination complète (PostgREST tronque à 1 000 lignes sans erreur)
        fetchAll(() => supabase.from('sessions').select('*').order('start_date', { ascending: false })),
        fetchAll(() => supabase.from('courses').select('*')),
        fetchAll(() => supabase.from('clients').select('*')),
        fetchAll(() => supabase.from('trainers').select('*')),
        fetchAll(() => supabase.from('trainees').select('*')),
        fetchAll(() => supabase.from('session_trainees').select('id, session_id, trainee_id, registration_date, result, admin_observation, expectations_notification_sent, presence_complete, early_departure, access_code, positioning_test_completed, positioning_test_completed_at, forprev_card_url, departure_date, departure_reason, departure_time, arrival_date, arrival_time, presence_hours, convocation_sent_at, absent, absent_reason')),
        fetchAll(() => supabase.from('client_contacts').select('*'))
      ])
      
      if (sessionsError) {
        console.error('fetchSessions error:', sessionsError)
        set({ sessionsLoading: false })
        return { data: [], error: sessionsError }
      }
      
      // Auto-gérer les statuts des sessions (sauf si forcé manuellement)
      const now = new Date()
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      for (const s of (sessionsData || [])) {
        // Ne pas toucher aux sessions annulées ou avec statut verrouillé
        if (s.status === 'cancelled' || s.status_locked) continue
        
        const startDate = new Date(s.start_date)
        startDate.setHours(0, 0, 0, 0)
        const endDate = new Date(s.end_date)
        endDate.setHours(23, 59, 59, 999)
        
        let newStatus = null
        
        // Session terminée (date de fin passée)
        if (endDate < today && s.status !== 'completed') {
          newStatus = 'completed'
        }
        // Session en cours (entre date début et date fin)
        else if (startDate <= now && now <= endDate && s.status !== 'in_progress' && s.status !== 'completed') {
          newStatus = 'in_progress'
        }
        
        if (newStatus) {
          supabase.from('sessions').update({ status: newStatus }).eq('id', s.id).then(() => {
            console.log(`Session ${s.reference} auto → ${newStatus}`)
          })
          s.status = newStatus
        }
      }
      
      // Créer des maps pour accès rapide O(1)
      const coursesMap = new Map((coursesData || []).map(c => [c.id, c]))
      const trainersMap = new Map((trainersData || []).map(t => [t.id, t]))
      const traineesMap = new Map((traineesData || []).map(t => [t.id, t]))
      const contactsMap = new Map((contactsData || []).map(c => [c.id, c]))
      
      // Grouper les contacts par client_id
      const contactsByClientMap = new Map()
      for (const contact of (contactsData || [])) {
        if (!contactsByClientMap.has(contact.client_id)) {
          contactsByClientMap.set(contact.client_id, [])
        }
        contactsByClientMap.get(contact.client_id).push(contact)
      }
      
      // Attacher les contacts aux clients
      const clientsMap = new Map((clientsData || []).map(c => {
        const clientContacts = contactsByClientMap.get(c.id) || []
        // Trier : contact principal en premier
        clientContacts.sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
        return [c.id, { ...c, contacts: clientContacts }]
      }))
      
      // Grouper session_trainees par session_id
      const sessionTraineesMap = new Map()
      for (const st of (sessionTraineesData || [])) {
        if (!sessionTraineesMap.has(st.session_id)) {
          sessionTraineesMap.set(st.session_id, [])
        }
        sessionTraineesMap.get(st.session_id).push({
          ...st,
          trainees: traineesMap.get(st.trainee_id) || null
        })
      }
      
      // Construire les sessions avec leurs relations
      const sessions = (sessionsData || []).map(s => ({
        ...s,
        courses: coursesMap.get(s.course_id) || null,
        clients: clientsMap.get(s.client_id) || null,
        trainers: trainersMap.get(s.trainer_id) || null,
        contact: contactsMap.get(s.contact_id) || null,
        session_trainees: sessionTraineesMap.get(s.id) || []
      }))
      
      set({ sessions, sessionsLoading: false })
      return { data: sessions, error: null }
    } catch (error) {
      console.error('fetchSessions error:', error)
      set({ sessionsLoading: false })
      return { data: [], error }
    }
  },
  
  getSession: async (id) => {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', id)
      .single()
    
    if (error) {
      console.error('getSession error:', error)
      return { data: null, error }
    }
    
    if (data) {
      // Charger le cours avec TOUS les champs
      if (data.course_id) {
        const { data: course } = await supabase.from('courses').select('*').eq('id', data.course_id).single()
        data.courses = course
      }
      // Charger le client avec TOUS les champs
      if (data.client_id) {
        const { data: client } = await supabase.from('clients').select('*').eq('id', data.client_id).single()
        // Charger les contacts du client
        if (client) {
          const { data: contacts } = await supabase.from('client_contacts').select('*').eq('client_id', client.id).order('is_primary', { ascending: false })
          client.contacts = contacts || []
        }
        data.clients = client
      }
      // Charger le contact spécifique de la session
      if (data.contact_id) {
        const { data: sessionContact } = await supabase.from('client_contacts').select('*').eq('id', data.contact_id).single()
        data.session_contact = sessionContact
      }
      // Charger le formateur
      if (data.trainer_id) {
        const { data: trainer } = await supabase.from('trainers').select('*').eq('id', data.trainer_id).single()
        data.trainers = trainer
      }
      // Charger les stagiaires avec presence_complete et early_departure
      const { data: sessionTrainees, error: stError } = await supabase
        .from('session_trainees')
        .select('id, trainee_id, registration_date, result, remediation_proposal, result_forced_reason, result_forced_at, presence_complete, early_departure, departure_date, departure_reason, departure_time, arrival_date, arrival_time, presence_hours, access_code, convocation_sent_at, absent, absent_reason, bpf_categorie')
        .eq('session_id', id)
      
      // Une liste vide sans message ferait croire à une session sans stagiaire (relecture de 0477) : erreur affichée
      if (stError) {
        console.error('Error loading session_trainees:', stError)
        toast.error(`Stagiaires de la session non chargés : ${stError.message}`, { id: 'session-trainees-erreur' })
      }
      data.session_trainees = sessionTrainees || []
      
      // Charger les infos complètes des stagiaires
      for (let st of data.session_trainees) {
        const { data: trainee } = await supabase.from('trainees').select('*').eq('id', st.trainee_id).single()
        st.trainees = trainee
      }
    }
    
    set({ currentSession: data })
    return { data, error: null }
  },
  
  createSession: async (sessionData) => {
    // Générer référence unique avec timestamp
    const reference = `SES-${Date.now().toString(36).toUpperCase()}`
    
    // Générer token pour QR code (64 chars hex)
    const generateHexToken = (bytes = 32) => {
      const arr = new Uint8Array(bytes)
      crypto.getRandomValues(arr)
      return [...arr].map(b => b.toString(16).padStart(2, '0')).join('')
    }
    
    const { trainer_ids, trainee_ids, ...rest } = sessionData
    
    console.log('createSession received:', { trainer_ids, trainee_ids, rest })
    
    // Colonnes exactes de ta table sessions
    const session = {
      course_id: rest.course_id || null,
      client_id: rest.client_id,
      contact_id: rest.contact_id || null,
      trainer_id: trainer_ids?.length > 0 ? trainer_ids[0] : (rest.trainer_id || null),
      start_date: rest.start_date,
      end_date: rest.end_date,
      start_time: rest.start_time || '09:00',
      end_time: rest.end_time || '17:00',
      location_name: rest.location_name || rest.location || null,
      location_address: rest.location_address || null,
      location_postal_code: rest.location_postal_code || null,
      location_city: rest.location_city || null,
      is_intra: rest.is_intra || false,
      is_remote: rest.is_remote || false,
      day_type: rest.day_type || 'full',
      status: rest.status || 'planned',
      notes: rest.notes || null,
      signatory_name: rest.signatory_name || null,
      signatory_role: rest.signatory_role || null,
      reference,
      attendance_token: generateHexToken(32),
      // Sous-traitance
      session_type: rest.session_type || 'intra',
      subcontract_course_title: rest.subcontract_course_title || null,
      subcontract_client_ref: rest.subcontract_client_ref || null,
      subcontract_nb_trainees: rest.subcontract_nb_trainees || 0,
      subcontract_daily_rate: rest.subcontract_daily_rate || null,
      subcontract_convention_url: rest.subcontract_convention_url || null,
    }
    
    console.log('Creating session with trainer_id:', session.trainer_id)
    
    const { data, error } = await supabase
      .from('sessions')
      .insert([session])
      .select()
      .single()
    
    if (error) {
      console.error('Session creation error:', error)
      return { data: null, error }
    }
    
    if (data) {
      // Ajouter les stagiaires (sans status car n'existe pas)
      if (trainee_ids?.length) {
        await supabase.from('session_trainees').insert(
          trainee_ids.map(tid => ({ 
            session_id: data.id, 
            trainee_id: tid,
            registration_date: new Date().toISOString()
          }))
        ).then(res => {
          if (res.error) console.error('Error adding trainees:', res.error)
        })
      }
      await get().fetchSessions()
    }
    return { data, error: null }
  },
  
  updateSession: async (id, updates) => {
    const { trainer_ids, trainee_ids, ...rest } = updates
    
    // Colonnes exactes de ta table sessions
    const sessionUpdates = {}
    if (rest.course_id !== undefined) sessionUpdates.course_id = rest.course_id
    if (rest.client_id !== undefined) sessionUpdates.client_id = rest.client_id
    if (rest.contact_id !== undefined) sessionUpdates.contact_id = rest.contact_id || null
    if (trainer_ids !== undefined) sessionUpdates.trainer_id = trainer_ids[0] || null
    if (rest.trainer_id !== undefined) sessionUpdates.trainer_id = rest.trainer_id
    if (rest.start_date !== undefined) sessionUpdates.start_date = rest.start_date
    if (rest.end_date !== undefined) sessionUpdates.end_date = rest.end_date
    if (rest.start_time !== undefined) sessionUpdates.start_time = rest.start_time
    if (rest.end_time !== undefined) sessionUpdates.end_time = rest.end_time
    if (rest.location_name !== undefined) sessionUpdates.location_name = rest.location_name
    if (rest.location !== undefined) sessionUpdates.location_name = rest.location
    if (rest.location_address !== undefined) sessionUpdates.location_address = rest.location_address
    if (rest.location_postal_code !== undefined) sessionUpdates.location_postal_code = rest.location_postal_code
    if (rest.location_city !== undefined) sessionUpdates.location_city = rest.location_city
    if (rest.site_id !== undefined) sessionUpdates.site_id = rest.site_id || null
    if (rest.is_intra !== undefined) sessionUpdates.is_intra = rest.is_intra
    if (rest.is_remote !== undefined) sessionUpdates.is_remote = rest.is_remote
    if (rest.day_type !== undefined) sessionUpdates.day_type = rest.day_type
    if (rest.status !== undefined) sessionUpdates.status = rest.status
    if (rest.status_locked !== undefined) sessionUpdates.status_locked = rest.status_locked
    if (rest.notes !== undefined) sessionUpdates.notes = rest.notes
    // Calendrier public des sessions inter (0419) : publication et prix public par personne
    if (rest.is_public !== undefined) sessionUpdates.is_public = !!rest.is_public
    if (rest.public_price_per_person !== undefined) sessionUpdates.public_price_per_person = rest.public_price_per_person === '' || rest.public_price_per_person == null ? null : Number(rest.public_price_per_person)
    if (rest.max_participants !== undefined) sessionUpdates.max_participants = rest.max_participants === '' || rest.max_participants == null ? null : parseInt(rest.max_participants, 10)
    // FORPREV
    if (rest.requires_forprev !== undefined) sessionUpdates.requires_forprev = rest.requires_forprev
    if (rest.forprev_done !== undefined) sessionUpdates.forprev_done = rest.forprev_done
    if (rest.forprev_date !== undefined) sessionUpdates.forprev_date = rest.forprev_date
    if (rest.total_price !== undefined) sessionUpdates.total_price = rest.total_price || null
    // Signataire convention (distinct du contact convocation)
    if (rest.signatory_name !== undefined) sessionUpdates.signatory_name = rest.signatory_name || null
    if (rest.signatory_role !== undefined) sessionUpdates.signatory_role = rest.signatory_role || null
    // Ne pas envoyer room si pas défini (colonne peut ne pas exister)
    if (rest.room !== undefined && rest.room !== '') sessionUpdates.room = rest.room
    // Sous-traitance
    if (rest.session_type !== undefined) sessionUpdates.session_type = rest.session_type
    if (rest.subcontract_course_title !== undefined) sessionUpdates.subcontract_course_title = rest.subcontract_course_title || null
    if (rest.subcontract_client_ref !== undefined) sessionUpdates.subcontract_client_ref = rest.subcontract_client_ref || null
    if (rest.subcontract_nb_trainees !== undefined) sessionUpdates.subcontract_nb_trainees = rest.subcontract_nb_trainees || 0
    if (rest.subcontract_daily_rate !== undefined) sessionUpdates.subcontract_daily_rate = rest.subcontract_daily_rate || null
    if (rest.subcontract_convention_url !== undefined) sessionUpdates.subcontract_convention_url = rest.subcontract_convention_url || null
    if (rest.subcontract_invoiced !== undefined) sessionUpdates.subcontract_invoiced = rest.subcontract_invoiced
    if (rest.subcontract_invoice_id !== undefined) sessionUpdates.subcontract_invoice_id = rest.subcontract_invoice_id || null
    if (rest.subcontract_satisfaction_sent_at !== undefined) sessionUpdates.subcontract_satisfaction_sent_at = rest.subcontract_satisfaction_sent_at
    
    console.log('Updating session:', id, sessionUpdates)
    
    const { data, error } = await supabase
      .from('sessions')
      .update(sessionUpdates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) {
      console.error('updateSession error:', error)
      return { data: null, error }
    }
    
    if (data) {
      // Mettre à jour les stagiaires si fournis
      if (trainee_ids !== undefined) {
        await supabase.from('session_trainees').delete().eq('session_id', id)
        if (trainee_ids.length) {
          await supabase.from('session_trainees').insert(
            trainee_ids.map(tid => ({ 
              session_id: id, 
              trainee_id: tid,
              registration_date: new Date().toISOString()
            }))
          )
        }
      }
      await get().fetchSessions()
    }
    return { data, error }
  },
  
  deleteSession: async (id) => {
    // Supprimer d'abord les relations
    await supabase.from('session_trainees').delete().eq('session_id', id)
    
    const { error } = await supabase.from('sessions').delete().eq('id', id)
    if (!error) {
      set({ sessions: get().sessions.filter(s => s.id !== id) })
    }
    return { error }
  },
  
  addTraineeToSession: async (sessionId, traineeId) => {
    console.log('Adding trainee to session:', sessionId, traineeId)
    const { data, error } = await supabase
      .from('session_trainees')
      .insert([{ 
        session_id: sessionId, 
        trainee_id: traineeId, 
        registration_date: new Date().toISOString()
      }])
      .select()
    if (error) console.error('addTraineeToSession error:', error)
    if (!error) await get().fetchSessions()
    return { data, error }
  },
  
  removeTraineeFromSession: async (sessionId, traineeId) => {
    const { error } = await supabase
      .from('session_trainees')
      .delete()
      .eq('session_id', sessionId)
      .eq('trainee_id', traineeId)
    if (!error) await get().fetchSessions()
    return { error }
  },
  
  // Ajouter un formateur à une session
  addTrainerToSession: async (sessionId, trainerId) => {
    console.log('Adding trainer to session:', sessionId, trainerId)
    const { data, error } = await supabase
      .from('sessions')
      .update({ trainer_id: trainerId })
      .eq('id', sessionId)
      .select()
      .single()
    
    if (error) {
      console.error('addTrainerToSession error:', error)
      return { data: null, error }
    }
    
    if (!error) await get().fetchSessions()
    return { data, error }
  },

  // Retirer un formateur d'une session
  removeTrainerFromSession: async (sessionId, trainerId) => {
    console.log('Removing trainer from session:', sessionId, trainerId)
    const { data, error } = await supabase
      .from('sessions')
      .update({ trainer_id: null })
      .eq('id', sessionId)
      .eq('trainer_id', trainerId)
      .select()
      .single()
    
    if (error) {
      console.error('removeTrainerFromSession error:', error)
      return { data: null, error }
    }
    
    if (!error) await get().fetchSessions()
    return { data, error }
  },
  
  updateTraineeStatus: async (sessionId, traineeId, status) => {
    const { error } = await supabase
      .from('session_trainees')
      .update({ status })
      .eq('session_id', sessionId)
      .eq('trainee_id', traineeId)
    if (!error) await get().fetchSessions()
    return { error }
  },

  // ========== ÉMARGEMENTS (ATTENDANCES) ==========
  attendances: [],
  
  fetchAttendances: async (sessionId) => {
    const { data, error } = await supabase
      .from('attendances')
      .select('*')
      .eq('session_id', sessionId)
      .order('date')
      .order('period')
    if (error) console.error('fetchAttendances error:', error)
    if (!error) set({ attendances: data || [] })
    return { data: data || [], error }
  },
  
  createAttendance: async (attendance) => {
    const { data, error } = await supabase
      .from('attendances')
      .insert([attendance])
      .select()
      .single()
    if (!error && data) {
      set({ attendances: [...get().attendances, data] })
    }
    return { data, error }
  },
  
  getSessionByToken: async (token) => {
    const { data, error } = await supabase
      .from('sessions')
      .select(`
        *,
        courses(title, duration_hours),
        clients(name),
        session_trainees(trainee_id, status, trainees(id, first_name, last_name, email))
      `)
      .eq('attendance_token', token)
      .single()
    return { data, error }
  },
  
  getAttendancesBySessionAndDate: async (sessionId, date) => {
    const { data, error } = await supabase
      .from('attendances')
      .select('*')
      .eq('session_id', sessionId)
      .eq('date', date)
    return { data: data || [], error }
  },

  // ========== DOCUMENTS ==========
  documents: [],
  documentsLoading: false,
  
  fetchDocuments: async (sessionId = null) => {
    set({ documentsLoading: true })
    const build = () => {
      let query = supabase
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false })
      if (sessionId) query = query.eq('session_id', sessionId)
      return query
    }
    
    // fetchAll : pagination complète (sans sessionId, toute la table est chargée)
    const { data, error } = await fetchAll(build)
    if (error) console.error('fetchDocuments error:', error)
    if (!error) set({ documents: data || [] })
    set({ documentsLoading: false })
    return { data, error }
  },
  
  createDocument: async (document) => {
    const now = new Date()
    const prefix = {
      convention: 'CONV',
      convocation: 'CVOC',
      attestation: 'ATT',
      certificat: 'CERT',
      emargement: 'EMAR',
      programme: 'PROG',
      evaluation: 'EVAL'
    }[document.doc_type] || 'DOC'
    
    const { count } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('doc_type', document.doc_type)
    
    const number = `${prefix}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String((count || 0) + 1).padStart(5, '0')}`
    
    const { data, error } = await supabase
      .from('documents')
      .insert([{ ...document, number, status: 'ready' }])
      .select()
      .single()
    
    if (!error && data) {
      set({ documents: [data, ...get().documents] })
    }
    return { data, error }
  },
  
  deleteDocument: async (id) => {
    const { error } = await supabase.from('documents').delete().eq('id', id)
    if (!error) {
      set({ documents: get().documents.filter(d => d.id !== id) })
    }
    return { error }
  },

  // ========== PARAMÈTRES ORGANISME ==========
  // Une seule source : organization_settings (voir fetchOrganization / updateOrganization).
  // Conservés pour compatibilité, ils lisent et écrivent la même ligne.
  orgSettings: null,

  fetchOrgSettings: async () => {
    const { data, error } = await supabase.from('organization_settings').select('*').limit(1).maybeSingle()
    if (!error && data) set({ orgSettings: data })
    return { data, error }
  },

  updateOrgSettings: async (settings) => {
    const result = await get().updateOrganization(settings)
    if (!result.error && result.data) set({ orgSettings: result.data })
    return result
  },

  // ========== FICHIERS UPLOADÉS ==========
  uploadedFiles: [],
  uploadedFilesLoading: false,
  
  fetchUploadedFiles: async () => {
    set({ uploadedFilesLoading: true })
    const { data, error } = await fetchAll(() => supabase
      .from('uploaded_documents')
      .select('*, sessions(reference), courses(title), clients(name)')
      .order('created_at', { ascending: false }))
    if (!error) set({ uploadedFiles: data || [] })
    set({ uploadedFilesLoading: false })
    return { data, error }
  },
  
  uploadFile: async (file, metadata = {}) => {
    // 1. Upload vers Supabase Storage
    const fileExt = file.name.split('.').pop()
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
    const filePath = `uploads/${fileName}`
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('documents')
      .upload(filePath, file)
    
    if (uploadError) {
      console.error('Upload error:', uploadError)
      return { error: uploadError }
    }
    
    // 2. Obtenir l'URL publique
    const { data: urlData } = supabase.storage
      .from('documents')
      .getPublicUrl(filePath)
    
    // 3. Enregistrer dans la base de données
    const docRecord = {
      name: metadata.name || file.name,
      filename: file.name,
      file_url: urlData.publicUrl,
      file_size: file.size,
      mime_type: file.type,
      category: metadata.category || 'other',
      session_id: metadata.session_id || null,
      course_id: metadata.course_id || null,
      client_id: metadata.client_id || null,
      notes: metadata.notes || null,
    }
    
    const { data, error } = await supabase
      .from('uploaded_documents')
      .insert([docRecord])
      .select('*, sessions(reference), courses(title), clients(name)')
      .single()
    
    if (!error && data) {
      set({ uploadedFiles: [data, ...get().uploadedFiles] })
    }
    
    return { data, error }
  },
  
  deleteUploadedFile: async (id, fileUrl) => {
    // 1. Supprimer de la base de données
    const { error } = await supabase
      .from('uploaded_documents')
      .delete()
      .eq('id', id)
    
    if (error) return { error }
    
    // 2. Supprimer du storage (optionnel, extraire le path)
    try {
      const urlParts = fileUrl.split('/uploads/')
      if (urlParts[1]) {
        await supabase.storage.from('documents').remove([`uploads/${urlParts[1]}`])
      }
    } catch (e) {
      console.warn('Storage delete error:', e)
    }
    
    set({ uploadedFiles: get().uploadedFiles.filter(f => f.id !== id) })
    return { error: null }
  },
  
  // ========== TEMPLATES DE DOCUMENTS (RI, Livret) ==========
  documentTemplates: [],
  
  fetchDocumentTemplates: async () => {
    const { data, error } = await supabase
      .from('document_templates')
      .select('*')
      .order('code')
    if (!error) set({ documentTemplates: data || [] })
    return { data, error }
  },
  
  getDocumentTemplate: async (code) => {
    const { data, error } = await supabase
      .from('document_templates')
      .select('*')
      .eq('code', code)
      .single()
    return { data, error }
  },
  
  updateDocumentTemplate: async (code, updates) => {
    const { data: existing } = await supabase
      .from('document_templates')
      .select('id')
      .eq('code', code)
      .single()
    
    let result
    if (existing) {
      result = await supabase
        .from('document_templates')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('code', code)
        .select()
        .single()
    } else {
      result = await supabase
        .from('document_templates')
        .insert([{ code, ...updates }])
        .select()
        .single()
    }
    
    if (!result.error && result.data) {
      const templates = get().documentTemplates
      const idx = templates.findIndex(t => t.code === code)
      if (idx >= 0) {
        templates[idx] = result.data
        set({ documentTemplates: [...templates] })
      } else {
        set({ documentTemplates: [...templates, result.data] })
      }
    }
    return result
  },

  // ========== CERTIFICATS FORMATEURS ==========
  trainerCertificates: [],
  
  fetchTrainerCertificates: async (trainerId) => {
    const { data, error } = await supabase
      .from('trainer_certificates')
      .select('*')
      .eq('trainer_id', trainerId)
      .order('expiry_date', { ascending: true })
    return { data: data || [], error }
  },
  
  createTrainerCertificate: async (certificate) => {
    console.log('Creating certificate:', certificate)
    const { data, error } = await supabase
      .from('trainer_certificates')
      .insert([certificate])
      .select()
      .single()
    if (error) console.error('Certificate creation error:', error)
    return { data, error }
  },
  
  updateTrainerCertificate: async (id, updates) => {
    const { data, error } = await supabase
      .from('trainer_certificates')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    return { data, error }
  },
  
  deleteTrainerCertificate: async (id) => {
    const { error } = await supabase
      .from('trainer_certificates')
      .delete()
      .eq('id', id)
    return { error }
  },

  // ========== DOCUMENTS SESSION (uploadés) ==========
  sessionDocuments: [],
  sessionDocumentsLoading: false,
  
  fetchSessionDocuments: async (sessionId) => {
    set({ sessionDocumentsLoading: true })
    const { data, error } = await supabase
      .from('session_documents')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
    if (error) console.error('fetchSessionDocuments error:', error)
    set({ sessionDocuments: data || [], sessionDocumentsLoading: false })
    return { data: data || [], error }
  },
  
  uploadSessionDocument: async (sessionId, file, category, notes = '') => {
    // Upload file to storage
    //  Supabase Storage refuse les clés avec accents / espaces → on sanitise
    // le CHEMIN, mais on garde le nom d'origine pour l'affichage et le ZIP.
    const ts = Date.now()
    const safeFileName = buildStorageFileName(file.name, ts)
    const filePath = `sessions/${sessionId}/${safeFileName}`
    
    console.log('Uploading to:', filePath)
    
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(filePath, file)
    
    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return { error: uploadError }
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('documents')
      .getPublicUrl(filePath)
    
    // Create record in database
    const { data, error } = await supabase
      .from('session_documents')
      .insert([{
        session_id: sessionId,
        document_type: category,
        file_path: filePath,
        file_name: file.name,
        file_url: urlData?.publicUrl || null,
        notes
      }])
      .select()
      .single()
    
    if (error) {
      console.error('Database insert error:', error)
      return { data: null, error }
    }
    
    if (data) {
      set({ sessionDocuments: [data, ...get().sessionDocuments] })
    }
    return { data, error: null }
  },
  
  deleteSessionDocument: async (id, filePath) => {
    // Delete from storage
    await supabase.storage.from('documents').remove([filePath])
    
    // Delete from database
    const { error } = await supabase
      .from('session_documents')
      .delete()
      .eq('id', id)
    
    if (!error) {
      set({ sessionDocuments: get().sessionDocuments.filter(d => d.id !== id) })
    }
    return { error }
  },
  
  getSessionDocumentUrl: async (filePath) => {
    const { data } = await supabase.storage
      .from('documents')
      .createSignedUrl(filePath, 3600) // 1 hour
    return data?.signedUrl
  },

  // ========== DOCUMENTS STAGIAIRES ==========
  traineeDocuments: [],
  
  fetchTraineeDocuments: async (traineeId) => {
    // Colonnes réelles : document_url (chemin dans Storage) et uploaded_at ; l'écran lit file_path et created_at
    const { data, error } = await supabase
      .from('trainee_documents')
      .select('*')
      .eq('trainee_id', traineeId)
      .order('uploaded_at', { ascending: false })
    return { data: (data || []).map(d => ({ ...d, file_path: d.document_url, created_at: d.uploaded_at })), error }
  },
  
  uploadTraineeDocument: async (traineeId, file, category = 'autre', notes = '') => {
    //  Clé Storage sanitisée (pas d'accents / espaces), nom d'origine conservé en base
    const ts = Date.now()
    const safeFileName = buildStorageFileName(file.name, ts)
    const displayFileName = `${ts}_${file.name}`
    const filePath = `trainees/${traineeId}/${safeFileName}`
    
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(filePath, file)
    
    if (uploadError) return { error: uploadError }
    
    const { data, error } = await supabase
      .from('trainee_documents')
      .insert([{
        trainee_id: traineeId,
        name: file.name.replace(/\.[^/.]+$/, ''),
        category,
        document_url: filePath,
      }])
      .select()
      .single()
    
    if (error) await supabase.storage.from('documents').remove([filePath])
    return { data: data ? { ...data, file_path: data.document_url, created_at: data.uploaded_at } : data, error }
  },
  
  deleteTraineeDocument: async (id, filePath) => {
    await supabase.storage.from('documents').remove([filePath])
    const { error } = await supabase
      .from('trainee_documents')
      .delete()
      .eq('id', id)
    return { error }
  },

  // ========== PRÉSENCE PAR JOURNÉE ==========
  fetchAttendance: async (sessionId) => {
    const { data, error } = await supabase
      .from('attendances')
      .select('*')
      .eq('session_id', sessionId)
    return { data: data || [], error }
  },
  
  upsertAttendance: async (sessionId, traineeId, date, present) => {
    console.log('upsertAttendance:', { sessionId, traineeId, date, present })
    
    // Vérifier si l'enregistrement existe
    const { data: existing } = await supabase
      .from('attendances')
      .select('id')
      .eq('session_id', sessionId)
      .eq('trainee_id', traineeId)
      .eq('date', date)
      .maybeSingle()
    
    let result
    if (existing) {
      // Update
      result = await supabase
        .from('attendances')
        .update({ present })
        .eq('id', existing.id)
        .select()
        .single()
    } else {
      // Insert
      result = await supabase
        .from('attendances')
        .insert({
          session_id: sessionId,
          trainee_id: traineeId,
          date,
          period: 'full', // journée complète par défaut
          present
        })
        .select()
        .single()
    }
    
    if (result.error) console.error('upsertAttendance error:', result.error)
    return result
  },

  // ========== ÉVALUATIONS STAGIAIRES ==========
  fetchTraineeEvaluations: async (sessionId) => {
    const { data, error } = await supabase
      .from('trainee_evaluations')
      .select('*')
      .eq('session_id', sessionId)
    if (error) console.error('fetchTraineeEvaluations error:', error)
    return { data: data || [], error }
  },
  
  upsertTraineeEvaluation: async (sessionId, traineeId, updates) => {
    console.log('upsertTraineeEvaluation:', { sessionId, traineeId, updates })
    
    // Vérifier si l'enregistrement existe
    const { data: existing } = await supabase
      .from('trainee_evaluations')
      .select('id')
      .eq('session_id', sessionId)
      .eq('trainee_id', traineeId)
      .maybeSingle()
    
    let result
    if (existing) {
      // Update
      result = await supabase
        .from('trainee_evaluations')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single()
    } else {
      // Insert
      result = await supabase
        .from('trainee_evaluations')
        .insert({
          session_id: sessionId,
          trainee_id: traineeId,
          ...updates,
          updated_at: new Date().toISOString()
        })
        .select()
        .single()
    }
    
    if (result.error) console.error('upsertTraineeEvaluation error:', result.error)
    return result
  },

  // ========== ÉVALUATION FORMATEUR ==========
  fetchTrainerEvaluation: async (sessionId) => {
    const { data, error } = await supabase
      .from('trainer_evaluations')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle()
    if (error) console.error('fetchTrainerEvaluation error:', error)
    return { data, error }
  },
  
  upsertTrainerEvaluation: async (sessionId, trainerId, updates) => {
    console.log('upsertTrainerEvaluation:', { sessionId, trainerId, updates })
    
    // Vérifier si l'enregistrement existe
    const { data: existing } = await supabase
      .from('trainer_evaluations')
      .select('id')
      .eq('session_id', sessionId)
      .maybeSingle()
    
    let result
    if (existing) {
      // Update
      result = await supabase
        .from('trainer_evaluations')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single()
    } else {
      // Insert
      result = await supabase
        .from('trainer_evaluations')
        .insert({
          session_id: sessionId,
          trainer_id: trainerId,
          ...updates,
          updated_at: new Date().toISOString()
        })
        .select()
        .single()
    }
    
    if (result.error) console.error('upsertTrainerEvaluation error:', result.error)
    return result
  },

  // ========== ÉVALUATIONS À FROID (90 jours) ==========
  fetchColdEvaluations: async (sessionId) => {
    const { data, error } = await supabase
      .from('evaluations_cold')
      .select('*')
      .eq('session_id', sessionId)
    if (error) console.error('fetchColdEvaluations error:', error)
    return { data: data || [], error }
  },
  
  upsertColdEvaluation: async (sessionId, traineeId, updates) => {
    console.log('upsertColdEvaluation:', { sessionId, traineeId, updates })
    
    // Vérifier si l'enregistrement existe
    const { data: existing } = await supabase
      .from('evaluations_cold')
      .select('id')
      .eq('session_id', sessionId)
      .eq('trainee_id', traineeId)
      .maybeSingle()
    
    let result
    if (existing) {
      result = await supabase
        .from('evaluations_cold')
        .update({ ...updates })
        .eq('id', existing.id)
        .select()
        .single()
    } else {
      result = await supabase
        .from('evaluations_cold')
        .insert({
          session_id: sessionId,
          trainee_id: traineeId,
          ...updates
        })
        .select()
        .single()
    }
    
    if (result.error) console.error('upsertColdEvaluation error:', result.error)
    return result
  },

  // ========== CERTIFICATIONS SST ==========
  fetchSSTCertifications: async (sessionId) => {
    const { data, error } = await supabase
      .from('sst_certifications')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
    
    if (error) console.error('fetchSSTCertifications error:', error)
    return { data: data || [], error }
  },

  getSSTCertification: async (sessionId, traineeId) => {
    const { data, error } = await supabase
      .from('sst_certifications')
      .select('*')
      .eq('session_id', sessionId)
      .eq('trainee_id', traineeId)
      .maybeSingle()
    
    if (error) console.error('getSSTCertification error:', error)
    return { data, error }
  },

  upsertSSTCertification: async (certificationData) => {
    const { data, error } = await supabase
      .from('sst_certifications')
      .upsert(certificationData, {
        onConflict: 'session_id,trainee_id'
      })
      .select()
      .single()
    
    if (error) console.error('upsertSSTCertification error:', error)
    return { data, error }
  },

  deleteSSTCertification: async (certificationId) => {
    const { error } = await supabase
      .from('sst_certifications')
      .delete()
      .eq('id', certificationId)
    
    if (error) console.error('deleteSSTCertification error:', error)
    return { error }
  },

  // ========== VALIDATION OBJECTIFS STAGIAIRES ==========
  fetchTraineeObjectives: async (sessionId) => {
    const { data, error } = await supabase
      .from('trainee_objectives')
      .select('*')
      .eq('session_id', sessionId)
      .order('trainee_id')
      .order('objective_index')
    
    if (error) console.error('fetchTraineeObjectives error:', error)
    return data || []
  },

  initializeTraineeObjectives: async (sessionId, trainees, objectives) => {
    // Initialiser les objectifs pour tous les stagiaires
    const records = []
    trainees.forEach(trainee => {
      objectives.forEach((obj, idx) => {
        records.push({
          session_id: sessionId,
          trainee_id: trainee.trainee_id || trainee.id,
          objective_index: idx,
          objective_text: obj.trim(),
          validated: false
        })
      })
    })
    
    if (records.length === 0) return []
    
    // Upsert pour ne pas créer de doublons
    const { data, error } = await supabase
      .from('trainee_objectives')
      .upsert(records, { 
        onConflict: 'session_id,trainee_id,objective_index',
        ignoreDuplicates: true 
      })
      .select()
    
    if (error) console.error('initializeTraineeObjectives error:', error)
    return data || []
  },

  toggleTraineeObjective: async (sessionId, traineeId, objectiveIndex, validated) => {
    console.log('=== toggleTraineeObjective ===', { sessionId, traineeId, objectiveIndex, validated })
    
    // Vérifier si l'objectif existe déjà
    const { data: existing, error: selectError } = await supabase
      .from('trainee_objectives')
      .select('id')
      .eq('session_id', sessionId)
      .eq('trainee_id', traineeId)
      .eq('objective_index', objectiveIndex)
      .maybeSingle()
    
    console.log('existing:', existing, 'selectError:', selectError)
    
    const updateData = {
      validated,
      validated_at: validated ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }
    
    let result
    if (existing?.id) {
      // Mettre à jour
      result = await supabase
        .from('trainee_objectives')
        .update(updateData)
        .eq('id', existing.id)
        .select()
        .single()
      console.log('UPDATE result:', result)
    } else {
      // Créer
      result = await supabase
        .from('trainee_objectives')
        .insert({
          session_id: sessionId,
          trainee_id: traineeId,
          objective_index: objectiveIndex,
          ...updateData
        })
        .select()
        .single()
      console.log('INSERT result:', result)
    }
    
    if (result.error) console.error('toggleTraineeObjective error:', result.error)
    return result
  },

  // Calcule et met à jour le résultat du stagiaire (acquis/non acquis)
  updateTraineeResult: async (sessionId, traineeId) => {
    // 1. Vérifier si tous les objectifs sont validés
    const { data: objectives } = await supabase
      .from('trainee_objectives')
      .select('validated')
      .eq('session_id', sessionId)
      .eq('trainee_id', traineeId)
    
    const allObjectivesValidated = objectives && objectives.length > 0 && 
      objectives.every(o => o.validated === true)
    
    // 2. Récupérer infos session pour calculer le nombre de demi-journées
    const { data: sessionData } = await supabase
      .from('sessions')
      .select('*, courses(duration_hours)')
      .eq('id', sessionId)
      .single()
    
    // Si day_type = 'half', une seule demi-journée par jour suffit
    const isHalfDaySession = sessionData?.day_type === 'half'
    let requiredHalfDays
    
    if (isHalfDaySession) {
      // Session demi-journée : 1 demi-journée par jour
      const startDate = new Date(sessionData.start_date)
      const endDate = new Date(sessionData.end_date)
      const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1
      requiredHalfDays = daysDiff
    } else {
      // Session journée complète : calculé par la durée
      const durationHours = sessionData?.courses?.duration_hours || 7
      requiredHalfDays = Math.ceil(durationHours / 3.5)
    }
    
    // 3. Vérifier la présence demi-journées
    const { data: halfDays } = await supabase
      .from('attendance_halfdays')
      .select('morning, afternoon')
      .eq('session_id', sessionId)
      .eq('trainee_id', traineeId)
    
    let presentHalfDays = 0
    halfDays?.forEach(h => {
      if (h.morning === true) presentHalfDays++
      if (h.afternoon === true) presentHalfDays++
    })
    
    const allPresent = presentHalfDays >= requiredHalfDays
    
    // 4. Déterminer le résultat
    let result = null
    if (objectives && objectives.length > 0) {
      result = (allObjectivesValidated && allPresent) ? 'acquired' : 'not_acquired'
    }
    
    // 5. Mettre à jour session_trainees
    const { data, error } = await supabase
      .from('session_trainees')
      .update({ result })
      .eq('session_id', sessionId)
      .eq('trainee_id', traineeId)
      .select()
      .single()
    
    if (error) console.error('updateTraineeResult error:', error)
    return { data, error, result, allObjectivesValidated, allPresent }
  },
  
  // Forcer le résultat d'un stagiaire manuellement
  forceTraineeResult: async (sessionId, traineeId, forcedResult, reason = '') => {
    const { data, error } = await supabase
      .from('session_trainees')
      .update({ 
        result: forcedResult,
        result_forced_reason: reason,
        result_forced_at: new Date().toISOString()
      })
      .eq('session_id', sessionId)
      .eq('trainee_id', traineeId)
      .select()
      .single()
    
    if (error) console.error('forceTraineeResult error:', error)
    return { data, error, result: forcedResult }
  },
  
  // Mettre à jour la proposition de remédiation
  updateRemediationProposal: async (sessionId, traineeId, proposal) => {
    const { data, error } = await supabase
      .from('session_trainees')
      .update({ remediation_proposal: proposal })
      .eq('session_id', sessionId)
      .eq('trainee_id', traineeId)
      .select()
      .single()
    
    if (error) console.error('updateRemediationProposal error:', error)
    return { data, error }
  },
  
  // Mettre à jour le statut de présence complète
  updatePresenceComplete: async (sessionId, traineeId, isComplete) => {
    const { data, error } = await supabase
      .from('session_trainees')
      .update({ presence_complete: isComplete })
      .eq('session_id', sessionId)
      .eq('trainee_id', traineeId)
      .select()
      .single()
    
    if (error) console.error('updatePresenceComplete error:', error)
    return { data, error }
  },

  // ========== EXPORT COMPLET ==========
  fetchAllEvaluations: async () => {
    try {
      const [hotEvals, trainerEvals, coldEvals, attendances] = await Promise.all([
        fetchAll(() => supabase.from('trainee_evaluations').select('*')),
        fetchAll(() => supabase.from('trainer_evaluations').select('*')),
        fetchAll(() => supabase.from('evaluations_cold').select('*')),
        fetchAll(() => supabase.from('attendances').select('*')),
      ])
      
      return {
        trainee_evaluations: hotEvals.data || [],
        trainer_evaluations: trainerEvals.data || [],
        evaluations_cold: coldEvals.data || [],
        attendances: attendances.data || [],
      }
    } catch (error) {
      console.error('fetchAllEvaluations error:', error)
      return {
        trainee_evaluations: [],
        trainer_evaluations: [],
        evaluations_cold: [],
        attendances: [],
      }
    }
  },

  // ========== QUALIOPI SESSION ==========
  fetchSessionQualiopi: async (sessionId) => {
    const { data, error } = await supabase
      .from('session_qualiopi')
      .select('*')
      .eq('session_id', sessionId)
      .single()
    return { data, error }
  },
  
  upsertSessionQualiopi: async (sessionId, updates) => {
    const { data, error } = await supabase
      .from('session_qualiopi')
      .upsert({
        session_id: sessionId,
        ...updates,
        updated_at: new Date().toISOString()
      }, { onConflict: 'session_id' })
      .select()
      .single()
    return { data, error }
  },

  // ========== STATISTIQUES GLOBALES ==========
  fetchGlobalStats: async () => {
    // D'abord récupérer les IDs des sessions terminées
    // fetchAll / fetchAllIn : pagination complète et lots d'identifiants
    // (une longue liste .in() dépasse la taille d'URL et la limite de 1 000 lignes)
    const { data: completedSessions } = await fetchAll(() => supabase
      .from('sessions')
      .select('id')
      .eq('status', 'completed'))
    
    const completedIds = completedSessions?.map(s => s.id) || []
    
    if (completedIds.length === 0) {
      return { tauxSatisfaction: 0, tauxRecommandation: 0, tauxPresence: 0, tauxReponse: 0 }
    }
    
    // Taux de satisfaction (sessions terminées uniquement)
    const { data: evalData } = await fetchAllIn(() => supabase
      .from('trainee_evaluations')
      .select('satisfaction_score, session_id')
      .not('satisfaction_score', 'is', null), 'session_id', completedIds)
    
    const scores = evalData?.filter(e => e.satisfaction_score) || []
    const avgSatisfaction = scores.length > 0
      ? (scores.reduce((acc, e) => acc + parseFloat(e.satisfaction_score), 0) / scores.length) / 5 * 100
      : 0
    
    // Taux de recommandation (sessions terminées uniquement)
    const { data: recoData } = await fetchAllIn(() => supabase
      .from('trainee_evaluations')
      .select('would_recommend, session_id')
      .not('would_recommend', 'is', null), 'session_id', completedIds)
    
    const recoResponses = recoData?.filter(e => e.would_recommend !== null) || []
    const recoYes = recoResponses.filter(e => e.would_recommend).length
    const tauxRecommandation = recoResponses.length > 0 ? (recoYes / recoResponses.length) * 100 : 0
    
    // Taux de présence (sessions terminées uniquement)
    const { data: presenceData } = await fetchAllIn(() => supabase
      .from('attendances')
      .select('present, session_id'), 'session_id', completedIds)
    
    const totalPresence = presenceData?.length || 0
    const presentCount = presenceData?.filter(p => p.present).length || 0
    const tauxPresence = totalPresence > 0 ? (presentCount / totalPresence) * 100 : 0
    
    // Taux de réponse questionnaires (sessions terminées uniquement)
    const { data: questionnaireData } = await fetchAllIn(() => supabase
      .from('trainee_evaluations')
      .select('questionnaire_submitted, session_id'), 'session_id', completedIds)
    
    const totalQ = questionnaireData?.length || 0
    const submittedQ = questionnaireData?.filter(q => q.questionnaire_submitted).length || 0
    const tauxReponse = totalQ > 0 ? (submittedQ / totalQ) * 100 : 0
    
    return {
      tauxSatisfaction: Math.round(avgSatisfaction * 10) / 10,
      tauxRecommandation: Math.round(tauxRecommandation * 10) / 10,
      tauxPresence: Math.round(tauxPresence * 10) / 10,
      tauxReponse: Math.round(tauxReponse * 10) / 10,
    }
  },

  // ========== COMPLÉTUDE ==========
  fetchCompletudeReport: async () => {
    const missing = []
    
    // fetchAll : pagination complète (PostgREST tronque à 1 000 lignes sans erreur)
    const { data: clients } = await fetchAll(() => supabase.from('clients').select('*'))
    clients?.forEach(c => {
      const m = []
      if (!c.name) m.push('Nom')
      if (!c.siret) m.push('SIRET')
      if (!c.address) m.push('Adresse')
      if (!c.contact_email) m.push('Email contact')
      if (!c.contact_name) m.push('Contact')
      if (m.length > 0) missing.push({ type: 'Client', name: c.name || 'Sans nom', fields: m })
    })
    
    const { data: trainees } = await fetchAll(() => supabase.from('trainees').select('*'))
    trainees?.forEach(t => {
      const m = []
      if (!t.first_name) m.push('Prénom')
      if (!t.last_name) m.push('Nom')
      if (!t.email) m.push('Email')
      if (m.length > 0) missing.push({ type: 'Stagiaire', name: `${t.first_name || ''} ${t.last_name || ''}`.trim() || 'Sans nom', fields: m })
    })
    
    const { data: trainers } = await fetchAll(() => supabase.from('trainers').select('*'))
    trainers?.forEach(t => {
      const m = []
      if (!t.first_name) m.push('Prénom')
      if (!t.last_name) m.push('Nom')
      if (!t.email) m.push('Email')
      if (!t.specialties) m.push('Spécialités')
      if (m.length > 0) missing.push({ type: 'Formateur', name: `${t.first_name || ''} ${t.last_name || ''}`.trim() || 'Sans nom', fields: m })
    })
    
    const { data: sessions } = await fetchAll(() => supabase.from('sessions').select('*'))
    sessions?.forEach(s => {
      const m = []
      if (!s.course_id) m.push('Formation')
      if (!s.client_id) m.push('Client')
      if (!s.trainer_id) m.push('Formateur')
      // Le lieu n'est requis que si ce n'est pas intra (chez le client)
      if (!s.is_intra && !s.location_name && !s.location_address) m.push('Lieu')
      if (m.length > 0) missing.push({ type: 'Session', name: s.reference || 'Sans réf', fields: m })
    })
    
    const total = (clients?.length || 0) + (trainees?.length || 0) + (trainers?.length || 0) + (sessions?.length || 0)
    const completude = total > 0 ? Math.round(((total - missing.length) / total) * 100) : 0
    
    return { completude, missing }
  },

  // ========== RAPPORT QUALIOPI ==========
  fetchQualiopiReport: async () => {
    const issues = []
    
    // Charger les sessions avec leurs relations (pagination complète)
    const { data: sessions } = await fetchAll(() => supabase
      .from('sessions')
      .select('*'))
    
    // Vérifier chaque session
    sessions?.forEach(s => {
      // Indicateur 1 - Info précontractuelle
      if (!s.course_id) {
        issues.push({ indicateur: 1, session: s.reference, probleme: 'Formation non définie' })
      }
      
      // Indicateur 5 - Objectifs et contenus
      // (vérifié via courses.objectives)
      
      // Indicateur 11 - Attestations
      if (s.status === 'completed') {
        // Session terminée devrait avoir des attestations
      }
      
      // Indicateur 17 - Formateur qualifié
      if (!s.trainer_id) {
        issues.push({ indicateur: 17, session: s.reference, probleme: 'Aucun formateur assigné' })
      }
    })
    
    // Charger les formateurs
    const { data: trainers } = await supabase.from('trainers').select('*')
    
    trainers?.forEach(t => {
      if (!t.qualifications && !t.certifications) {
        issues.push({ indicateur: 21, session: `Formateur ${t.first_name} ${t.last_name}`, probleme: 'Qualifications non renseignées' })
      }
    })
    
    // Calculer le score
    const totalChecks = (sessions?.length || 0) * 3 + (trainers?.length || 0)
    const score = totalChecks > 0 ? Math.round(((totalChecks - issues.length) / totalChecks) * 100) : 100
    
    return { score: Math.max(0, Math.min(100, score)), issues }
  },
  
  // ============================================================
  // QUESTIONS DE POSITIONNEMENT
  // ============================================================
  courseQuestions: [],
  
  fetchCourseQuestions: async (courseId) => {
    // D'abord, récupérer le cours pour avoir son theme_id
    const { data: course } = await supabase
      .from('courses')
      .select('theme_id')
      .eq('id', courseId)
      .single()
    
    // Si le cours a un theme_id, charger les questions du thème
    if (course?.theme_id) {
      const { data, error } = await supabase
        .from('theme_questions')
        .select('*')
        .eq('theme_id', course.theme_id)
        .order('position', { ascending: true })
      if (!error) set({ courseQuestions: data || [] })
      return { data: data || [], error }
    }
    
    // Sinon essayer course_questions (ancienne méthode)
    const { data, error } = await supabase
      .from('course_questions')
      .select('*')
      .eq('course_id', courseId)
      .order('position', { ascending: true })
    if (!error) set({ courseQuestions: data || [] })
    return { data: data || [], error }
  },
  
  createCourseQuestion: async (courseId, question) => {
    const { data, error } = await supabase
      .from('course_questions')
      .insert([{ ...question, course_id: courseId }])
      .select()
      .single()
    if (error) {
      console.error('Erreur création question:', error)
    }
    if (!error && data) {
      set(state => ({ courseQuestions: [...state.courseQuestions, data] }))
    }
    return { data, error }
  },
  
  updateCourseQuestion: async (id, updates) => {
    const { data, error } = await supabase
      .from('course_questions')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (!error) {
      set(state => ({
        courseQuestions: state.courseQuestions.map(q => q.id === id ? data : q)
      }))
    }
    return { data, error }
  },
  
  deleteCourseQuestion: async (id) => {
    const { error } = await supabase
      .from('course_questions')
      .delete()
      .eq('id', id)
    if (!error) {
      set(state => ({
        courseQuestions: state.courseQuestions.filter(q => q.id !== id)
      }))
    }
    return { error }
  },
  
  reorderCourseQuestions: async (courseId, questionIds) => {
    // Met à jour les positions
    const updates = questionIds.map((id, index) => 
      supabase.from('course_questions').update({ position: index }).eq('id', id)
    )
    await Promise.all(updates)
    // Recharge
    const { data } = await supabase
      .from('course_questions')
      .select('*')
      .eq('course_id', courseId)
      .order('position', { ascending: true })
    set({ courseQuestions: data || [] })
  },

  // ========== THÈMES DE FORMATION ==========
  themes: [],
  
  fetchThemes: async () => {
    const { data, error } = await supabase
      .from('training_themes')
      .select('*')
      .order('position')
    if (!error) set({ themes: data || [] })
    return { data, error }
  },

  // ========== TESTS PAR THÈME ==========
  themeQuestions: [],
  
  fetchThemeQuestions: async (themeId) => {
    const { data, error } = await supabase
      .from('theme_questions')
      .select('*')
      .eq('theme_id', themeId)
      .order('position')
    if (!error) set({ themeQuestions: data || [] })
    return { data, error }
  },
  
  createThemeQuestion: async (themeId, question) => {
    const { data, error } = await supabase
      .from('theme_questions')
      .insert([{ ...question, theme_id: themeId }])
      .select()
      .single()
    if (!error && data) {
      set(state => ({ themeQuestions: [...state.themeQuestions, data] }))
    }
    return { data, error }
  },
  
  updateThemeQuestion: async (id, updates) => {
    const { data, error } = await supabase
      .from('theme_questions')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (!error && data) {
      set(state => ({
        themeQuestions: state.themeQuestions.map(q => q.id === id ? data : q)
      }))
    }
    return { data, error }
  },
  
  deleteThemeQuestion: async (id) => {
    const { error } = await supabase
      .from('theme_questions')
      .delete()
      .eq('id', id)
    if (!error) {
      set(state => ({
        themeQuestions: state.themeQuestions.filter(q => q.id !== id)
      }))
    }
    return { error }
  },

  // ========== ORGANISATION SETTINGS ==========
  organization: null,
  
  fetchOrganization: async () => {
    const { data, error } = await supabase
      .from('organization_settings')
      .select('*')
      .single()
    if (!error && data) {
      // Référent handicap lu dans le rôle qualité (une seule source), pas dans une copie
      const ref = await supabase.rpc('referent_handicap_info').then((r) => r.data || null, () => null)
      // Société courante autre que celle de l'instance (C3) : identité juridique et bancaire de sa fiche
      const identite = await chargerIdentiteSociete(supabase, useAuthStore.getState().societes)
      const surcharge = identite ? Object.fromEntries(IDENTITE_SOCIETE.map((k) => [k, identite[k] ?? null])) : {}
      set({ organization: { ...data, ...surcharge, referent_handicap_info: ref }, organizationSurchargee: !!identite })
    }
    return { data, error }
  },
  
  updateOrganization: async (updates) => {
    const org = get().organization
    const payload = { ...updates, updated_at: new Date().toISOString() }
    delete payload.id
    delete payload.created_at
    // Société courante autre que celle de l'instance : son identité se règle dans Paramètres › Sociétés, jamais ici
    // (sinon elle écraserait celle de la société de l'instance)
    if (get().organizationSurchargee) IDENTITE_SOCIETE.forEach((k) => { delete payload[k] })
    let result
    if (org?.id) {
      result = await supabase.from('organization_settings').update(payload).eq('id', org.id).select().single()
    } else {
      result = await supabase.from('organization_settings').insert([payload]).select().single()
    }
    if (!result.error && result.data) {
      if (get().organizationSurchargee) await get().fetchOrganization()
      else set({ organization: { ...result.data, referent_handicap_info: get().organization?.referent_handicap_info || null } })
    }
    return result
  },

  // ========== NON-CONFORMITÉS ==========
  nonConformities: [],
  
  fetchNonConformities: async () => {
    const { data, error } = await fetchAll(() => supabase
      .from('non_conformites')
      .select('*')
      .order('created_at', { ascending: false }))
    if (error) console.error('fetchNonConformities error:', error)
    if (!error) set({ nonConformities: data || [] })
    return { data, error }
  },
  
  createNonConformity: async (nc) => {
    const { data, error } = await supabase
      .from('non_conformites')
      .insert([{ ...nc }])
      .select()
      .single()
    if (error) console.error('NC creation error:', error)
    if (!error && data) {
      set(state => ({ nonConformities: [data, ...state.nonConformities] }))
    }
    return { data, error }
  },
  
  updateNonConformity: async (id, updates) => {
    console.log('Updating NC:', id, updates)
    const { data, error } = await supabase
      .from('non_conformites')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    if (error) console.error('NC update error:', error)
    if (!error && data) {
      set(state => ({
        nonConformities: state.nonConformities.map(nc => nc.id === id ? data : nc)
      }))
    }
    return { data, error }
  },
  
  deleteNonConformity: async (id) => {
    const { error } = await supabase
      .from('non_conformites')
      .delete()
      .eq('id', id)
    if (!error) {
      set(state => ({
        nonConformities: state.nonConformities.filter(nc => nc.id !== id)
      }))
    }
    return { error }
  },

  // ========== APP VERSIONS (Changelog) ==========
  appVersions: [],
  
  fetchAppVersions: async () => {
    const { data, error } = await supabase
      .from('app_versions')
      .select('*')
      .order('release_date', { ascending: false })
    if (!error) set({ appVersions: data || [] })
    return { data, error }
  },

  // ========== DUPLICATION ==========
  duplicateCourse: async (courseId) => {
    const course = get().courses.find(c => c.id === courseId)
    if (!course) return { error: 'Formation non trouvée' }
    
    const newCourse = {
      title: `${course.title} (copie)`,
      code: `${course.code || 'F'}-${Date.now().toString(36).toUpperCase()}`,
      description: course.description || null,
      objectives: course.objectives || null,
      prerequisites: course.prerequisites || null,
      target_audience: course.target_audience || null,
      duration_hours: course.duration_hours || null,
      duration: course.duration || null,
      price_ht: course.price_ht || null,
      price_per_day: course.price_per_day || null,
      theme_id: course.theme_id || null,
      content: course.content || null,
      program: course.program || null,
      methods: course.methods || null,
      material: course.material || null,
    }
    
    const { data, error } = await supabase
      .from('courses')
      .insert([newCourse])
      .select()
      .single()
    
    if (error) {
      console.error('Erreur duplication:', error)
    }
    if (!error && data) {
      set(state => ({ courses: [...state.courses, data] }))
    }
    return { data, error }
  },
  
  duplicateSession: async (sessionId) => {
    const session = get().sessions.find(s => s.id === sessionId)
    if (!session) return { error: 'Session non trouvée' }
    
    const ref = `SES-DUP-${Date.now().toString(36).toUpperCase()}`
    const newSession = {
      course_id: session.course_id,
      client_id: session.client_id,
      contact_id: session.contact_id || null,
      trainer_id: session.trainer_id || null,
      reference: ref,
      start_date: null, // Dates à renseigner
      end_date: null,
      start_time: session.start_time || '09:00',
      end_time: session.end_time || '17:00',
      // Recopier le type de journée : sans ça, la base remet 'full' par défaut
      // et une session de 4h dupliquée affiche un après-midi fantôme à l'émargement
      day_type: session.day_type || 'full',
      location_name: session.location_name || session.location || null,
      location_address: session.location_address || null,
      location_postal_code: session.location_postal_code || null,
      location_city: session.location_city || null,
      is_intra: session.is_intra || false,
      is_remote: session.is_remote || false,
      status: 'planned',
      notes: session.notes || null,
      total_price: session.total_price || null,
      room: session.room || null,
    }
    
    const { data, error } = await supabase
      .from('sessions')
      .insert([newSession])
      .select()
      .single()
    
    if (error) {
      console.error('Duplicate session error:', error)
      return { data: null, error }
    }
    
    if (data) {
      await get().fetchSessions()
    }
    return { data, error: null }
  },

  // ========== AUDIT LOGS (RGPD) ==========
  auditLogs: [],
  auditLogsLoading: false,
  
  // Créer un log d'audit
  logAudit: async (action, entityType, entityId = null, entityName = null, details = null) => {
    const { user } = get()
    
    try {
      const { error } = await supabase.rpc('log_audit', {
        p_user_id: user?.id || null,
        p_user_email: user?.email || 'anonymous',
        p_action: action,
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_entity_name: entityName,
        p_details: details
      })
      
      if (error) {
        // Si RPC pas disponible, on ignore silencieusement
        console.warn('Audit log RPC not available:', error.message)
      }
    } catch (e) {
      console.warn('Audit logging failed:', e)
    }
  },
  
  // Récupérer les logs d'audit
  fetchAuditLogs: async (filters = {}) => {
    set({ auditLogsLoading: true })
    
    const { data, error } = await supabase.rpc('get_audit_logs', {
      p_entity_type: filters.entityType || null,
      p_entity_id: filters.entityId || null,
      p_action: filters.action || null,
      p_user_email: filters.userEmail || null,
      p_from_date: filters.fromDate || null,
      p_to_date: filters.toDate || null,
      p_limit: filters.limit || 100
    })
    
    if (error) {
      console.warn('Fetch audit logs failed, trying direct query:', error)
      // Fallback sur requête directe
      const { data: directData } = await supabase
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(filters.limit || 100)
      
      set({ auditLogs: directData || [], auditLogsLoading: false })
      return { data: directData, error: null }
    }
    
    set({ auditLogs: data || [], auditLogsLoading: false })
    return { data, error }
  },
  
  // Logs d'audit pour une entité spécifique
  getEntityAuditLogs: async (entityType, entityId) => {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('timestamp', { ascending: false })
      .limit(50)
    
    return { data, error }
  },

  // ========== RGPD EXPORT & PURGE ==========
  
  // Exporter toutes les données d'un stagiaire (droit d'accès RGPD)
  exportTraineeData: async (traineeId) => {
    const { data, error } = await supabase.rpc('export_trainee_data', {
      p_trainee_id: traineeId
    })
    
    if (error) {
      console.warn('RPC export_trainee_data not available:', error)
      // Fallback : construire l'export manuellement
      const { data: trainee } = await supabase
        .from('trainees')
        .select('*, clients(id, name)')
        .eq('id', traineeId)
        .single()
      
      const { data: sessionTrainees } = await supabase
        .from('session_trainees')
        .select('*, sessions(*, courses(title))')
        .eq('trainee_id', traineeId)
      
      const { data: attendances } = await supabase
        .from('attendances')
        .select('*')
        .eq('trainee_id', traineeId)
      
      const { data: evaluations } = await supabase
        .from('trainee_evaluations')
        .select('*')
        .eq('trainee_id', traineeId)
      
      const { data: documents } = await supabase
        .from('trainee_documents')
        .select('id, name, category, uploaded_at')
        .eq('trainee_id', traineeId)
      
      return {
        data: {
          export_date: new Date().toISOString(),
          export_type: 'RGPD_DATA_EXPORT',
          trainee,
          sessions: sessionTrainees?.map(st => ({
            session_id: st.session_id,
            reference: st.sessions?.reference,
            course: st.sessions?.courses?.title,
            start_date: st.sessions?.start_date,
            end_date: st.sessions?.end_date,
            result: st.result
          })) || [],
          attendances: attendances || [],
          evaluations: evaluations || [],
          documents: documents || []
        },
        error: null
      }
    }
    
    return { data, error }
  },
  
  // Obtenir les stats de purge
  getPurgeStats: async () => {
    const { data, error } = await supabase.rpc('get_purge_stats')
    
    if (error) {
      console.warn('RPC get_purge_stats not available:', error)
      // Fallback : calcul manuel
      // fetchAll : sinon le total et le nombre à purger sont plafonnés à 1 000
      const { data: trainees } = await fetchAll(() => supabase.from('trainees').select('id, created_at, last_session_date'))
      
      const fiveYearsAgo = new Date()
      fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)
      
      const toPurge = (trainees || []).filter(t => {
        const refDate = new Date(t.last_session_date || t.created_at)
        return refDate < fiveYearsAgo
      })
      
      return {
        data: [{
          total_trainees: trainees?.length || 0,
          trainees_to_purge: toPurge.length,
          oldest_trainee_years: 0,
          purge_threshold_years: 5
        }],
        error: null
      }
    }
    
    return { data, error }
  },
  
  // Liste des stagiaires à purger
  getTraineesToPurge: async () => {
    const { data, error } = await supabase
      .from('trainees_to_purge')
      .select('*')
      .limit(100)
    
    if (error) {
      console.warn('View trainees_to_purge not available:', error)
      // Fallback
      // fetchAll : sinon des stagiaires à purger pourraient être ignorés
      const { data: trainees } = await fetchAll(() => supabase
        .from('trainees')
        .select('*, clients(name)'))
      
      const fiveYearsAgo = new Date()
      fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)
      
      const toPurge = (trainees || []).filter(t => {
        const refDate = new Date(t.last_session_date || t.created_at)
        return refDate < fiveYearsAgo
      }).map(t => ({
        ...t,
        client_name: t.clients?.name,
        reference_date: t.last_session_date || t.created_at
      }))
      
      return { data: toPurge, error: null }
    }
    
    return { data, error }
  },
  
  // Purger un stagiaire
  purgeTrainee: async (traineeId, archivedBy) => {
    const { user } = get()
    const { data, error } = await supabase.rpc('purge_trainee', {
      p_trainee_id: traineeId,
      p_archived_by: archivedBy || user?.email || 'system'
    })
    
    if (error) {
      console.error('Purge trainee error:', error)
      return { data: null, error }
    }
    
    // Rafraîchir la liste des stagiaires
    await get().fetchTrainees()
    
    return { data, error }
  },
  
  // ========== GESTION MATÉRIEL ==========
  
  // Récupérer le catalogue matériel
  fetchEquipmentCatalog: async () => {
    const { data, error } = await supabase
      .from('equipment_catalog')
      .select('*')
      .order('theme')
      .order('name')
    if (error) console.error('fetchEquipmentCatalog error:', error)
    return { data: data || [], error }
  },
  
  // Ajouter un équipement personnalisé au catalogue
  addCustomEquipment: async (equipment) => {
    const { data, error } = await supabase
      .from('equipment_catalog')
      .insert({ ...equipment, is_custom: true })
      .select()
      .single()
    if (error) console.error('addCustomEquipment error:', error)
    return { data, error }
  },
  
  // Récupérer le matériel d'une formation
  fetchCourseEquipment: async (courseId) => {
    const { data, error } = await supabase
      .from('course_equipment')
      .select('*, equipment_catalog(*)')
      .eq('course_id', courseId)
    if (error) console.error('fetchCourseEquipment error:', error)
    return { data: data || [], error }
  },
  
  // Sauvegarder le matériel d'une formation
  saveCourseEquipment: async (courseId, equipmentIds) => {
    // Supprimer l'existant
    await supabase.from('course_equipment').delete().eq('course_id', courseId)
    
    // Insérer les nouveaux
    if (equipmentIds.length > 0) {
      const { error } = await supabase
        .from('course_equipment')
        .insert(equipmentIds.map(eqId => ({ course_id: courseId, equipment_id: eqId })))
      if (error) {
        console.error('saveCourseEquipment error:', error)
        return { error }
      }
    }
    return { error: null }
  },
  
  // Récupérer le matériel d'une session (avec quantités calculées)
  fetchSessionEquipment: async (sessionId) => {
    const { data, error } = await supabase
      .from('session_equipment')
      .select('*, equipment_catalog(*)')
      .eq('session_id', sessionId)
      .order('created_at')
    if (error) console.error('fetchSessionEquipment error:', error)
    return { data: data || [], error }
  },
  
  // Générer/recalculer le matériel d'une session depuis la formation
  generateSessionEquipment: async (sessionId) => {
    // Récupérer la session avec son cours et ses stagiaires
    const { data: session } = await supabase
      .from('sessions')
      .select('course_id')
      .eq('id', sessionId)
      .single()
    
    if (!session) return { error: 'Session non trouvée' }
    
    // Récupérer le nombre de stagiaires
    const { count: traineeCount } = await supabase
      .from('session_trainees')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId)
    
    const nbTrainees = traineeCount || 1
    
    // Récupérer le matériel de la formation
    const { data: courseEquipment } = await supabase
      .from('course_equipment')
      .select('equipment_id, equipment_catalog(ratio_per_persons)')
      .eq('course_id', session.course_id)
    
    if (!courseEquipment || courseEquipment.length === 0) {
      return { data: [], error: null }
    }
    
    // Calculer les quantités et insérer
    for (const ce of courseEquipment) {
      const ratio = ce.equipment_catalog?.ratio_per_persons
      const quantity = ratio ? Math.ceil(nbTrainees / ratio) : 1
      
      await supabase
        .from('session_equipment')
        .upsert({
          session_id: sessionId,
          equipment_id: ce.equipment_id,
          quantity_required: quantity
        }, { onConflict: 'session_id,equipment_id' })
    }
    
    // Retourner la liste mise à jour
    return await get().fetchSessionEquipment(sessionId)
  },
  
  // Marquer un équipement comme préparé
  toggleEquipmentPrepared: async (sessionEquipmentId, isPrepared) => {
    const { error } = await supabase
      .from('session_equipment')
      .update({ is_prepared: isPrepared })
      .eq('id', sessionEquipmentId)
    if (error) console.error('toggleEquipmentPrepared error:', error)
    return { error }
  },
  
  // Ajouter un équipement à une session (ajustement manuel)
  addSessionEquipment: async (sessionId, equipmentId, quantity = 1) => {
    const { data, error } = await supabase
      .from('session_equipment')
      .upsert({
        session_id: sessionId,
        equipment_id: equipmentId,
        quantity_required: quantity
      }, { onConflict: 'session_id,equipment_id' })
      .select()
    if (error) console.error('addSessionEquipment error:', error)
    return { data, error }
  },
  
  // Supprimer un équipement d'une session
  removeSessionEquipment: async (sessionEquipmentId) => {
    const { error } = await supabase
      .from('session_equipment')
      .delete()
      .eq('id', sessionEquipmentId)
    if (error) console.error('removeSessionEquipment error:', error)
    return { error }
  },
}))

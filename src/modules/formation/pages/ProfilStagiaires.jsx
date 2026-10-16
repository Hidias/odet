import { useEffect, useState } from 'react'
import { useDataStore } from '../../../core/store'
import { supabase } from '../../../core/supabase'
import { 
  Users, Download, Filter, Calendar, Building, BookOpen, DollarSign,
  PieChart, BarChart3, TrendingUp, User, Briefcase, Heart, Info
} from 'lucide-react'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx-js-style'
import SearchSelect, { clientOptions, courseOptions } from '../../../ui/SearchSelect'

export default function ProfilStagiaires() {
  const { sessions, fetchSessions, clients, fetchClients, courses, fetchCourses } = useDataStore()
  
  const [loading, setLoading] = useState(true)
  const [trainees, setTrainees] = useState([])
  
  // Filtres
  const [filterPeriod, setFilterPeriod] = useState('all') // all, year, custom
  const [filterClient, setFilterClient] = useState('')
  const [filterCourse, setFilterCourse] = useState('')
  const [filterFunding, setFilterFunding] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  
  // Seuil RGPD : minimum de personnes pour afficher les stats
  const RGPD_THRESHOLD = 5
  
  useEffect(() => {
    loadData()
  }, [])
  
  const loadData = async () => {
    setLoading(true)
    await Promise.all([
      fetchSessions(),
      fetchClients(),
      fetchCourses()
    ])
    setLoading(false)
  }
  
  // Charger les stagiaires avec leurs sessions
  useEffect(() => {
    if (sessions.length === 0) return
    loadTraineesData()
  }, [sessions, filterPeriod, filterClient, filterCourse, filterFunding, startDate, endDate])
  
  const loadTraineesData = async () => {
    // Filtrer les sessions
    let filteredSessions = sessions.filter(s => s.status === 'completed')
    
    // Filtre période
    if (filterPeriod === 'year') {
      const currentYear = new Date().getFullYear()
      filteredSessions = filteredSessions.filter(s => {
        const year = new Date(s.start_date).getFullYear()
        return year === currentYear
      })
    } else if (filterPeriod === 'custom' && startDate && endDate) {
      filteredSessions = filteredSessions.filter(s => {
        const sessionDate = new Date(s.start_date)
        return sessionDate >= new Date(startDate) && sessionDate <= new Date(endDate)
      })
    }
    
    // Filtre client
    if (filterClient) {
      filteredSessions = filteredSessions.filter(s => s.client_id === filterClient)
    }
    
    // Filtre formation
    if (filterCourse) {
      filteredSessions = filteredSessions.filter(s => s.course_id === filterCourse)
    }
    
    // Filtre financement
    if (filterFunding) {
      filteredSessions = filteredSessions.filter(s => s.funding_type === filterFunding)
    }
    
    if (filteredSessions.length === 0) {
      setTrainees([])
      return
    }
    
    const sessionIds = filteredSessions.map(s => s.id)
    
    // Charger les stagiaires des sessions filtrées
    const { data: sessionTrainees, error } = await supabase
      .from('session_trainees')
      .select(`
        session_id,
        trainee_id,
        trainees (
          id,
          first_name,
          last_name,
          gender,
          birth_date,
          csp,
          job_title,
          has_disability
        )
      `)
      .in('session_id', sessionIds)
    
    if (error) {
      console.error('Erreur chargement stagiaires:', error)
      return
    }
    
    // Dédupliquer les stagiaires (un stagiaire peut être dans plusieurs sessions)
    const uniqueTrainees = []
    const traineeIds = new Set()
    
    sessionTrainees.forEach(st => {
      if (st.trainees && !traineeIds.has(st.trainees.id)) {
        traineeIds.add(st.trainees.id)
        uniqueTrainees.push(st.trainees)
      }
    })
    
    setTrainees(uniqueTrainees)
  }
  
  // Calculer l'âge à partir de la date de naissance
  const calculateAge = (birthDate) => {
    if (!birthDate) return null
    const today = new Date()
    const birth = new Date(birthDate)
    let age = today.getFullYear() - birth.getFullYear()
    const monthDiff = today.getMonth() - birth.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--
    }
    return age
  }
  
  // Calculer les statistiques par genre
  const getGenderStats = () => {
    if (trainees.length < RGPD_THRESHOLD) {
      return { masked: true, total: trainees.length }
    }
    
    const stats = {
      male: trainees.filter(t => t.gender === 'male').length,
      female: trainees.filter(t => t.gender === 'female').length,
      non_binary: trainees.filter(t => t.gender === 'non_binary').length,
      unknown: trainees.filter(t => !t.gender).length,
      total: trainees.length
    }
    
    return stats
  }
  
  // Calculer les statistiques par tranche d'âge
  const getAgeStats = () => {
    if (trainees.length < RGPD_THRESHOLD) {
      return { masked: true, total: trainees.length }
    }
    
    const ageGroups = {
      'Moins de 26 ans': 0,
      '26-35 ans': 0,
      '36-45 ans': 0,
      '46-55 ans': 0,
      'Plus de 55 ans': 0,
      'Non renseigné': 0
    }
    
    trainees.forEach(t => {
      const age = calculateAge(t.birth_date)
      if (age === null) {
        ageGroups['Non renseigné']++
      } else if (age < 26) {
        ageGroups['Moins de 26 ans']++
      } else if (age < 36) {
        ageGroups['26-35 ans']++
      } else if (age < 46) {
        ageGroups['36-45 ans']++
      } else if (age < 56) {
        ageGroups['46-55 ans']++
      } else {
        ageGroups['Plus de 55 ans']++
      }
    })
    
    return { groups: ageGroups, total: trainees.length }
  }
  
  // Calculer les statistiques par CSP
  const getCSPStats = () => {
    if (trainees.length < RGPD_THRESHOLD) {
      return { masked: true, total: trainees.length }
    }
    
    const cspGroups = {}
    trainees.forEach(t => {
      const csp = t.csp || 'Non renseigné'
      cspGroups[csp] = (cspGroups[csp] || 0) + 1
    })
    
    // Trier par nombre décroissant
    const sorted = Object.entries(cspGroups)
      .sort((a, b) => b[1] - a[1])
    
    return { groups: sorted, total: trainees.length }
  }
  
  // Calculer les statistiques handicap
  const getHandicapStats = () => {
    if (trainees.length < RGPD_THRESHOLD) {
      return { masked: true, total: trainees.length }
    }
    
    const withHandicap = trainees.filter(t => t.has_disability).length
    const withoutHandicap = trainees.filter(t => !t.has_disability).length
    
    return {
      with: withHandicap,
      without: withoutHandicap,
      percentage: trainees.length > 0 ? ((withHandicap / trainees.length) * 100).toFixed(1) : 0,
      total: trainees.length
    }
  }
  
  // Calculer les statistiques par poste
  const getJobStats = () => {
    if (trainees.length < RGPD_THRESHOLD) {
      return { masked: true, total: trainees.length }
    }
    
    const jobGroups = {}
    trainees.forEach(t => {
      const job = t.job_title || 'Non renseigné'
      jobGroups[job] = (jobGroups[job] || 0) + 1
    })
    
    // Top 10 des postes
    const sorted = Object.entries(jobGroups)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
    
    return { groups: sorted, total: trainees.length }
  }
  
  // Export Excel
  const exportExcel = () => {
    const genderStats = getGenderStats()
    const ageStats = getAgeStats()
    const cspStats = getCSPStats()
    const handicapStats = getHandicapStats()
    const jobStats = getJobStats()
    
    // Feuille 1: Répartition par genre
    const genderData = genderStats.masked ? [
      ['Données masquées (< 5 personnes)'],
      ['Total', genderStats.total]
    ] : [
      ['Genre', 'Nombre', 'Pourcentage'],
      ['Hommes', genderStats.male, `${((genderStats.male / genderStats.total) * 100).toFixed(1)}%`],
      ['Femmes', genderStats.female, `${((genderStats.female / genderStats.total) * 100).toFixed(1)}%`],
      ['Non-binaire', genderStats.non_binary, `${((genderStats.non_binary / genderStats.total) * 100).toFixed(1)}%`],
      ['Non renseigné', genderStats.unknown, `${((genderStats.unknown / genderStats.total) * 100).toFixed(1)}%`],
      [],
      ['Total', genderStats.total, '100%']
    ]
    
    // Feuille 2: Répartition par âge
    const ageData = ageStats.masked ? [
      ['Données masquées (< 5 personnes)'],
      ['Total', ageStats.total]
    ] : [
      ['Tranche d\'âge', 'Nombre', 'Pourcentage'],
      ...Object.entries(ageStats.groups).map(([age, count]) => [
        age,
        count,
        `${((count / ageStats.total) * 100).toFixed(1)}%`
      ]),
      [],
      ['Total', ageStats.total, '100%']
    ]
    
    // Feuille 3: Répartition par CSP
    const cspData = cspStats.masked ? [
      ['Données masquées (< 5 personnes)'],
      ['Total', cspStats.total]
    ] : [
      ['CSP', 'Nombre', 'Pourcentage'],
      ...cspStats.groups.map(([csp, count]) => [
        csp,
        count,
        `${((count / cspStats.total) * 100).toFixed(1)}%`
      ]),
      [],
      ['Total', cspStats.total, '100%']
    ]
    
    // Feuille 4: Handicap
    const handicapData = handicapStats.masked ? [
      ['Données masquées (< 5 personnes)'],
      ['Total', handicapStats.total]
    ] : [
      ['Situation de handicap', 'Nombre', 'Pourcentage'],
      ['Avec handicap', handicapStats.with, `${handicapStats.percentage}%`],
      ['Sans handicap', handicapStats.without, `${(100 - handicapStats.percentage).toFixed(1)}%`],
      [],
      ['Total', handicapStats.total, '100%']
    ]
    
    // Feuille 5: Top 10 postes
    const jobData = jobStats.masked ? [
      ['Données masquées (< 5 personnes)'],
      ['Total', jobStats.total]
    ] : [
      ['Poste / Fonction', 'Nombre', 'Pourcentage'],
      ...jobStats.groups.map(([job, count]) => [
        job,
        count,
        `${((count / jobStats.total) * 100).toFixed(1)}%`
      ]),
      [],
      ['Total affiché (Top 10)', jobStats.groups.reduce((sum, [_, count]) => sum + count, 0), '']
    ]
    
    // Créer le workbook
    const wb = XLSX.utils.book_new()
    
    const ws1 = XLSX.utils.aoa_to_sheet(genderData)
    XLSX.utils.book_append_sheet(wb, ws1, 'Genre')
    
    const ws2 = XLSX.utils.aoa_to_sheet(ageData)
    XLSX.utils.book_append_sheet(wb, ws2, 'Âge')
    
    const ws3 = XLSX.utils.aoa_to_sheet(cspData)
    XLSX.utils.book_append_sheet(wb, ws3, 'CSP')
    
    const ws4 = XLSX.utils.aoa_to_sheet(handicapData)
    XLSX.utils.book_append_sheet(wb, ws4, 'Handicap')
    
    const ws5 = XLSX.utils.aoa_to_sheet(jobData)
    XLSX.utils.book_append_sheet(wb, ws5, 'Postes')
    
    // Télécharger
    const filename = `Profil_Stagiaires_${new Date().toISOString().split('T')[0]}.xlsx`
    XLSX.writeFile(wb, filename)
    
    toast.success('Export Excel généré')
  }
  
  // Export CSV
  const exportCSV = () => {
    const genderStats = getGenderStats()
    const ageStats = getAgeStats()
    const cspStats = getCSPStats()
    const handicapStats = getHandicapStats()
    
    if (genderStats.masked) {
      toast.error('Données masquées : moins de 5 stagiaires')
      return
    }
    
    let csv = 'PROFIL DES STAGIAIRES\n\n'
    
    csv += 'RÉPARTITION PAR GENRE\n'
    csv += 'Genre,Nombre,Pourcentage\n'
    csv += `Hommes,${genderStats.male},${((genderStats.male / genderStats.total) * 100).toFixed(1)}%\n`
    csv += `Femmes,${genderStats.female},${((genderStats.female / genderStats.total) * 100).toFixed(1)}%\n`
    csv += `Non-binaire,${genderStats.non_binary},${((genderStats.non_binary / genderStats.total) * 100).toFixed(1)}%\n`
    csv += `Non renseigné,${genderStats.unknown},${((genderStats.unknown / genderStats.total) * 100).toFixed(1)}%\n`
    csv += `Total,${genderStats.total},100%\n\n`
    
    csv += 'RÉPARTITION PAR ÂGE\n'
    csv += 'Tranche,Nombre,Pourcentage\n'
    Object.entries(ageStats.groups).forEach(([age, count]) => {
      csv += `${age},${count},${((count / ageStats.total) * 100).toFixed(1)}%\n`
    })
    csv += `Total,${ageStats.total},100%\n\n`
    
    csv += 'RÉPARTITION PAR CSP\n'
    csv += 'CSP,Nombre,Pourcentage\n'
    cspStats.groups.forEach(([csp, count]) => {
      csv += `"${csp}",${count},${((count / cspStats.total) * 100).toFixed(1)}%\n`
    })
    csv += `Total,${cspStats.total},100%\n\n`
    
    csv += 'SITUATION DE HANDICAP\n'
    csv += 'Type,Nombre,Pourcentage\n'
    csv += `Avec handicap,${handicapStats.with},${handicapStats.percentage}%\n`
    csv += `Sans handicap,${handicapStats.without},${(100 - handicapStats.percentage).toFixed(1)}%\n`
    csv += `Total,${handicapStats.total},100%\n`
    
    // Télécharger
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `Profil_Stagiaires_${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    
    toast.success('Export CSV généré')
  }
  
  const genderStats = getGenderStats()
  const ageStats = getAgeStats()
  const cspStats = getCSPStats()
  const handicapStats = getHandicapStats()
  const jobStats = getJobStats()
  
  const fundingOptions = [
    { value: 'none', label: 'Aucun' },
    { value: 'opco', label: 'OPCO' },
    { value: 'cpf', label: 'CPF' },
    { value: 'faf', label: 'FAF' },
    { value: 'region', label: 'Région' },
    { value: 'france_travail', label: 'France Travail' },
    { value: 'ptp', label: 'PTP' },
    { value: 'fne', label: 'FNE' },
    { value: 'direct', label: 'Financement direct' },
    { value: 'other', label: 'Autre' }
  ]
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-7 h-7 text-primary-600" />
            Profil des Stagiaires
          </h1>
          <p className="text-gray-600 mt-1">
            Statistiques démographiques RGPD-compliant pour OPCO et BPF
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCSV}
            className="btn btn-secondary flex items-center gap-2"
            disabled={trainees.length < RGPD_THRESHOLD}
          >
            <Download className="w-4 h-4" />
            CSV
          </button>
          <button
            onClick={exportExcel}
            className="btn btn-primary flex items-center gap-2"
            disabled={trainees.length < RGPD_THRESHOLD}
          >
            <Download className="w-4 h-4" />
            Excel
          </button>
        </div>
      </div>
      
      {/* Filtres */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-primary-600" />
          <h3 className="font-semibold">Filtres</h3>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Période */}
          <div>
            <label className="label">
              <Calendar className="w-4 h-4" />
              Période
            </label>
            <select
              value={filterPeriod}
              onChange={(e) => setFilterPeriod(e.target.value)}
              className="input"
            >
              <option value="all">Toutes les périodes</option>
              <option value="year">Année en cours</option>
              <option value="custom">Période personnalisée</option>
            </select>
          </div>
          
          {/* Dates personnalisées */}
          {filterPeriod === 'custom' && (
            <>
              <div>
                <label className="label">Date début</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Date fin</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="input"
                />
              </div>
            </>
          )}
          
          {/* Client */}
          <div>
            <label className="label">
              <Building className="w-4 h-4" />
              Client
            </label>
            <SearchSelect
              value={filterClient}
              onChange={(v) => setFilterClient(v)}
              options={clientOptions(clients, { excludeArchived: false })}
              emptyLabel="Tous les clients" searchPlaceholder="Rechercher un client..." aria-label="Filtrer par client" />
          </div>
          
          {/* Formation */}
          <div>
            <label className="label">
              <BookOpen className="w-4 h-4" />
              Formation
            </label>
            <SearchSelect
              value={filterCourse}
              onChange={(v) => setFilterCourse(v)}
              options={courseOptions(courses)}
              emptyLabel="Toutes les formations" searchPlaceholder="Rechercher une formation..." aria-label="Filtrer par formation" />
          </div>
          
          {/* Financement */}
          <div>
            <label className="label">
              <DollarSign className="w-4 h-4" />
              Financement
            </label>
            <select
              value={filterFunding}
              onChange={(e) => setFilterFunding(e.target.value)}
              className="input"
            >
              <option value="">Tous les financements</option>
              {fundingOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Bouton reset */}
        {(filterClient || filterCourse || filterFunding || filterPeriod !== 'all') && (
          <button
            onClick={() => {
              setFilterClient('')
              setFilterCourse('')
              setFilterFunding('')
              setFilterPeriod('all')
              setStartDate('')
              setEndDate('')
            }}
            className="text-ui text-[rgb(var(--c-danger))] hover:underline mt-3"
          >
            Réinitialiser tous les filtres
          </button>
        )}
      </div>
      
      {/* Alerte RGPD */}
      {trainees.length > 0 && trainees.length < RGPD_THRESHOLD && (
        <div className="bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] rounded-ui-sm p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-[rgb(var(--c-warning))] flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-[rgb(var(--c-warning))]">Données masquées (RGPD)</p>
            <p className="text-ui text-[rgb(var(--c-warning))] mt-1">
              Moins de {RGPD_THRESHOLD} stagiaires trouvés ({trainees.length}). Les statistiques détaillées sont masquées pour respecter la confidentialité.
            </p>
          </div>
        </div>
      )}
      
      {/* Statistiques */}
      {trainees.length === 0 ? (
        <div className="card text-center py-12">
          <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">Aucun stagiaire trouvé pour ces critères</p>
          <p className="text-ui text-gray-400 mt-1">Modifiez les filtres ou vérifiez que des sessions sont terminées</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Genre */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <User className="w-5 h-5 text-[rgb(var(--c-info))]" />
                Répartition par genre
              </h3>
              <span className="text-ui text-gray-500">{genderStats.total} stagiaires</span>
            </div>
            
            {genderStats.masked ? (
              <div className="text-center py-8 text-gray-400">
                <Info className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-ui">Données masquées (moins de {RGPD_THRESHOLD} personnes)</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-ui">Hommes</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-[rgb(var(--c-info))] h-2 rounded-full"
                        style={{ width: `${(genderStats.male / genderStats.total) * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-ui font-medium w-16 text-right">
                      {genderStats.male} ({((genderStats.male / genderStats.total) * 100).toFixed(1)}%)
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-ui">Femmes</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-gray-700 h-2 rounded-full"
                        style={{ width: `${(genderStats.female / genderStats.total) * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-ui font-medium w-16 text-right">
                      {genderStats.female} ({((genderStats.female / genderStats.total) * 100).toFixed(1)}%)
                    </span>
                  </div>
                </div>
                
                {genderStats.non_binary > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-ui">Non-binaire</span>
                    <div className="flex items-center gap-2">
                      <div className="w-32 bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-gray-700 h-2 rounded-full"
                          style={{ width: `${(genderStats.non_binary / genderStats.total) * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-ui font-medium w-16 text-right">
                        {genderStats.non_binary} ({((genderStats.non_binary / genderStats.total) * 100).toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                )}
                
                {genderStats.unknown > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-ui text-gray-500">Non renseigné</span>
                    <span className="text-ui font-medium w-16 text-right text-gray-500">
                      {genderStats.unknown}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Âge */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-[rgb(var(--c-success))]" />
                Répartition par âge
              </h3>
              <span className="text-ui text-gray-500">{ageStats.total} stagiaires</span>
            </div>
            
            {ageStats.masked ? (
              <div className="text-center py-8 text-gray-400">
                <Info className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-ui">Données masquées (moins de {RGPD_THRESHOLD} personnes)</p>
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(ageStats.groups).map(([age, count]) => (
                  <div key={age} className="flex items-center justify-between">
                    <span className="text-ui">{age}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-32 bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-[rgb(var(--c-success))] h-2 rounded-full"
                          style={{ width: `${(count / ageStats.total) * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-ui font-medium w-16 text-right">
                        {count} ({((count / ageStats.total) * 100).toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* CSP */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-[rgb(var(--c-warning))]" />
                Répartition par CSP
              </h3>
              <span className="text-ui text-gray-500">{cspStats.total} stagiaires</span>
            </div>
            
            {cspStats.masked ? (
              <div className="text-center py-8 text-gray-400">
                <Info className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-ui">Données masquées (moins de {RGPD_THRESHOLD} personnes)</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {cspStats.groups.map(([csp, count]) => (
                  <div key={csp} className="flex items-center justify-between">
                    <span className="text-ui flex-1 pr-2">{csp}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-[rgb(var(--c-warning))] h-2 rounded-full"
                          style={{ width: `${(count / cspStats.total) * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-ui font-medium w-16 text-right">
                        {count} ({((count / cspStats.total) * 100).toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Handicap */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Heart className="w-5 h-5 text-[rgb(var(--c-danger))]" />
                Situation de handicap
              </h3>
              <span className="text-ui text-gray-500">{handicapStats.total} stagiaires</span>
            </div>
            
            {handicapStats.masked ? (
              <div className="text-center py-8 text-gray-400">
                <Info className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-ui">Données masquées (moins de {RGPD_THRESHOLD} personnes)</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-[rgb(var(--c-danger-bg))] rounded-ui-sm">
                  <div>
                    <p className="text-ui text-gray-600">Avec handicap</p>
                    <p className="text-2xl font-bold text-[rgb(var(--c-danger))]">{handicapStats.with}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-[rgb(var(--c-danger))]">{handicapStats.percentage}%</p>
                    <p className="text-ui-sm text-gray-500">du total</p>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-ui">Avec handicap</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-[rgb(var(--c-danger))] h-2 rounded-full"
                        style={{ width: `${handicapStats.percentage}%` }}
                      ></div>
                    </div>
                    <span className="text-ui font-medium w-16 text-right">
                      {handicapStats.with}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-ui">Sans handicap</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-gray-400 h-2 rounded-full"
                        style={{ width: `${100 - handicapStats.percentage}%` }}
                      ></div>
                    </div>
                    <span className="text-ui font-medium w-16 text-right">
                      {handicapStats.without}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Top 10 Postes */}
          <div className="card md:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-gray-800" />
                Top 10 des postes / fonctions
              </h3>
              <span className="text-ui text-gray-500">{jobStats.total} stagiaires</span>
            </div>
            
            {jobStats.masked ? (
              <div className="text-center py-8 text-gray-400">
                <Info className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-ui">Données masquées (moins de {RGPD_THRESHOLD} personnes)</p>
              </div>
            ) : (
              <div className="space-y-3">
                {jobStats.groups.map(([job, count], index) => (
                  <div key={job} className="flex items-center gap-3">
                    <span className="text-ui-sm font-bold text-gray-400 w-6 text-right">#{index + 1}</span>
                    <div className="flex-1 flex items-center justify-between">
                      <span className="text-ui flex-1 pr-2">{job}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-32 bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-gray-700 h-2 rounded-full"
                            style={{ width: `${(count / jobStats.total) * 100}%` }}
                          ></div>
                        </div>
                        <span className="text-ui font-medium w-16 text-right">
                          {count} ({((count / jobStats.total) * 100).toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

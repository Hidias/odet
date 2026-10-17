/**
 * ============================================================================
 * PROSPECTION MASSIVE
 * ============================================================================
 * 
 * À METTRE : afm-app-main/src/pages/ProspectionMassive.jsx
 * 
 * Interface pour consulter et exporter les prospects de la base
 * de prospection massive sur la zone d'intervention (Paramètres)
 * ============================================================================
 */

import { useState, useEffect } from 'react'
import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'
import { Search, Download, Phone, Mail, Globe, Filter, TrendingUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { useDataStore } from '../../../core/store'
import { useZoneDepartements, zoneLabel } from '../../../core/org/departements'


const TRANCHES_EFFECTIF = [
  { code: '03', label: '6-9 salariés' },
  { code: '11', label: '10-19 salariés' },
  { code: '12', label: '20-49 salariés' },
  { code: '21', label: '50-99 salariés' },
  { code: '22', label: '100-199 salariés' },
  { code: '31', label: '200-249 salariés' },
  { code: '32', label: '250-499 salariés' },
]

export default function ProspectionMassive() {
  // Départements de la zone d'intervention (Paramètres), ou tous si aucune zone n'est renseignée
  const DEPARTEMENTS = useZoneDepartements()
  const organization = useDataStore(s => s.organization)
  const [prospects, setProspects] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  
  const [selectedDepts, setSelectedDepts] = useState([])
  const [selectedEffectifs, setSelectedEffectifs] = useState([])
  const [contactsFilter, setContactsFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  
  const [page, setPage] = useState(1)
  const [perPage] = useState(50)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    loadStats()
    const interval = setInterval(loadStats, 30000)
    return () => clearInterval(interval)
  }, [])

  async function loadStats() {
    // Table de ~275 000 lignes : on ne charge plus les lignes (PostgREST les
    // tronquait à 1 000, d'où des statistiques fausses). Chaque chiffre affiché
    // est désormais une requête de comptage côté base (head: true, aucune ligne
    // transférée), avec exactement les mêmes critères qu'avant :
    //   - « avec téléphone » = valeur non vide (équivalent du test JS `p.phone`) :
    //     like '_%' exclut NULL et la chaîne vide ;
    //   - « avec contacts » d'un département = téléphone OU email non vide.
    const compter = async (filtrer) => {
      const { count, error } = await filtrer(
        supabase.from('prospection_massive').select('id', { count: 'exact', head: true })
      )
      if (error) throw error
      return count || 0
    }
    const AVEC_TEL = (q) => q.like('phone', '_%')
    const AVEC_EMAIL = (q) => q.like('email', '_%')

    let total, enriched, pending, withPhone, withEmail, withBoth
    const byDept = {}
    try {
      ;[total, enriched, pending, withPhone, withEmail, withBoth] = await Promise.all([
        compter((q) => q),
        compter((q) => q.eq('enrichment_status', 'done')),
        compter((q) => q.eq('enrichment_status', 'pending')),
        compter(AVEC_TEL),
        compter(AVEC_EMAIL),
        compter((q) => AVEC_EMAIL(AVEC_TEL(q))),
      ])

      // Par département : 2 comptages par département, par lots de 10 requêtes
      // simultanées (5 départements × 2) pour ne pas saturer l'API quand la zone couvre toute la France.
      const depts = Object.keys(DEPARTEMENTS)
      for (let i = 0; i < depts.length; i += 5) {
        const lot = depts.slice(i, i + 5)
        const res = await Promise.all(lot.map(async (dept) => {
          const [deptTotal, withContacts] = await Promise.all([
            compter((q) => q.eq('departement', dept)),
            compter((q) => q.eq('departement', dept).or('phone.like._*,email.like._*')),
          ])
          return [dept, { total: deptTotal, withContacts }]
        }))
        res.forEach(([dept, v]) => { byDept[dept] = v })
      }
    } catch (error) {
      console.error('Erreur stats:', error)
      return
    }
    
    setStats({
      total,
      enriched,
      pending,
      withPhone,
      withEmail,
      withBoth,
      percentEnriched: Math.round((enriched / total) * 100),
      percentPhone: Math.round((withPhone / total) * 100),
      percentEmail: Math.round((withEmail / total) * 100),
      percentBoth: Math.round((withBoth / total) * 100),
      byDept
    })
  }

  useEffect(() => {
    loadProspects()
  }, [selectedDepts, selectedEffectifs, contactsFilter, searchQuery, page])

  async function loadProspects() {
    setLoading(true)
    
    let query = supabase
      .from('prospection_massive')
      .select('*', { count: 'exact' })
    
    if (selectedDepts.length > 0) {
      query = query.in('departement', selectedDepts)
    }
    
    if (selectedEffectifs.length > 0) {
      query = query.in('effectif', selectedEffectifs)
    }
    
    if (contactsFilter === 'with') {
      query = query.or('phone.not.is.null,email.not.is.null')
    } else if (contactsFilter === 'without') {
      query = query.is('phone', null).is('email', null)
    }
    
    if (searchQuery) {
      query = query.or(`name.ilike.%${searchQuery}%,city.ilike.%${searchQuery}%`)
    }
    
    query = query
      .order('quality_score', { ascending: false })
      .order('created_at', { ascending: false })
      .range((page - 1) * perPage, page * perPage - 1)
    
    const { data, error, count } = await query
    
    if (error) {
      toast.error('Erreur chargement prospects')
      console.error(error)
      setLoading(false)
      return
    }
    
    setProspects(data || [])
    setTotal(count || 0)
    setLoading(false)
  }

  async function exportCSV() {
    toast('Préparation export CSV...', { duration: 2000 })
    
    // Requête reconstruite à chaque page : fetchAll pagine jusqu'au bout
    // (sans lui, l'export était tronqué à 1 000 lignes sans avertissement)
    const buildQuery = () => {
      let query = supabase
        .from('prospection_massive')
        .select('*')
      
      if (selectedDepts.length > 0) {
        query = query.in('departement', selectedDepts)
      }
      if (selectedEffectifs.length > 0) {
        query = query.in('effectif', selectedEffectifs)
      }
      if (contactsFilter === 'with') {
        query = query.or('phone.not.is.null,email.not.is.null')
      } else if (contactsFilter === 'without') {
        query = query.is('phone', null).is('email', null)
      }
      if (searchQuery) {
        query = query.or(`name.ilike.%${searchQuery}%,city.ilike.%${searchQuery}%`)
      }
      return query
    }
    
    const { data, error } = await fetchAll(buildQuery)
    
    if (error) {
      toast.error('Erreur export')
      return
    }
    
    if (!data || data.length === 0) {
      toast.error('Aucun prospect à exporter')
      return
    }
    
    const headers = [
      'Nom',
      'SIRET',
      'Adresse',
      'Code Postal',
      'Ville',
      'Département',
      'Effectif',
      'NAF',
      'Téléphone',
      'Email',
      'Site Web',
      'Score Qualité',
      'Multi-Étab',
      'Recommandation'
    ]
    
    const rows = data.map(p => [
      p.name,
      p.siret,
      p.address || '',
      p.postal_code || '',
      p.city,
      DEPARTEMENTS[p.departement] || p.departement,
      p.effectif_label || '',
      p.naf || '',
      p.phone || '',
      p.email || '',
      p.site_web || '',
      p.quality_score || 0,
      p.is_multi_etablissement ? `${p.etablissements_count} étab.` : '',
      p.contact_recommendation || ''
    ])
    
    const csvContent = [
      headers.join(';'),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(';'))
    ].join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `prospection_massive_${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    URL.revokeObjectURL(url)
    
    toast.success(`${data.length} prospects exportés !`)
  }

  function toggleDept(dept) {
    setSelectedDepts(prev =>
      prev.includes(dept)
        ? prev.filter(d => d !== dept)
        : [...prev, dept]
    )
    setPage(1)
  }

  function toggleEffectif(code) {
    setSelectedEffectifs(prev =>
      prev.includes(code)
        ? prev.filter(c => c !== code)
        : [...prev, code]
    )
    setPage(1)
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        
        <div className="mb-6">
          <h1 className="page-title mb-2">
             Prospection Massive
          </h1>
          <p className="text-gray-600">
            {zoneLabel(organization) || 'Toutes zones'} • 6-499 salariés
          </p>
        </div>

        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-4 rounded-ui-sm shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-ui text-gray-600">Total Prospects</p>
                  <p className="text-2xl font-bold">{stats.total.toLocaleString()}</p>
                </div>
                <TrendingUp className="w-8 h-8 text-[rgb(var(--c-info))]" />
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-ui-sm shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-ui text-gray-600">Avec Téléphone</p>
                  <p className="text-2xl font-bold text-[rgb(var(--c-success))]">{stats.withPhone.toLocaleString()}</p>
                  <p className="text-ui-sm text-gray-500">{stats.percentPhone}%</p>
                </div>
                <Phone className="w-8 h-8 text-[rgb(var(--c-success))]" />
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-ui-sm shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-ui text-gray-600">Avec Email</p>
                  <p className="text-2xl font-bold text-gray-800">{stats.withEmail.toLocaleString()}</p>
                  <p className="text-ui-sm text-gray-500">{stats.percentEmail}%</p>
                </div>
                <Mail className="w-8 h-8 text-gray-800" />
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-ui-sm shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-ui text-gray-600">Complets</p>
                  <p className="text-2xl font-bold text-[rgb(var(--c-info))]">{stats.withBoth.toLocaleString()}</p>
                  <p className="text-ui-sm text-gray-500">{stats.percentBoth}%</p>
                </div>
                <div className="flex gap-1">
                  <Phone className="w-4 h-4 text-[rgb(var(--c-success))]" />
                  <Mail className="w-4 h-4 text-gray-800" />
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white p-4 rounded-ui-sm shadow mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filtres
          </h2>
          
          <div className="mb-4">
            <p className="text-ui font-medium text-gray-700 mb-2">Départements</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(DEPARTEMENTS).map(([code, name]) => (
                <button
                  key={code}
                  onClick={() => toggleDept(code)}
                  className={`px-3 py-1 rounded text-ui ${
                    selectedDepts.includes(code)
                      ? 'bg-[rgb(var(--c-info))] text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {code} - {name}
                  {stats?.byDept[code] && (
                    <span className="ml-1 text-ui-sm opacity-75">
                      ({stats.byDept[code].withContacts}/{stats.byDept[code].total})
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          
          <div className="mb-4">
            <p className="text-ui font-medium text-gray-700 mb-2">Effectif</p>
            <div className="flex flex-wrap gap-2">
              {TRANCHES_EFFECTIF.map(({ code, label }) => (
                <button
                  key={code}
                  onClick={() => toggleEffectif(code)}
                  className={`px-3 py-1 rounded text-ui ${
                    selectedEffectifs.includes(code)
                      ? 'bg-[rgb(var(--c-success))] text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          
          <div className="mb-4">
            <p className="text-ui font-medium text-gray-700 mb-2">Contacts disponibles</p>
            <div className="flex gap-2">
              <button
                onClick={() => setContactsFilter('all')}
                className={`px-4 py-2 rounded ${
                  contactsFilter === 'all'
                    ? 'bg-gray-800 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Tous
              </button>
              <button
                onClick={() => setContactsFilter('with')}
                className={`px-4 py-2 rounded ${
                  contactsFilter === 'with'
                    ? 'bg-[rgb(var(--c-success))] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Avec contacts
              </button>
              <button
                onClick={() => setContactsFilter('without')}
                className={`px-4 py-2 rounded ${
                  contactsFilter === 'without'
                    ? 'bg-[rgb(var(--c-warning))] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Sans contacts
              </button>
            </div>
          </div>
          
          <div>
            <p className="text-ui font-medium text-gray-700 mb-2">Recherche</p>
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setPage(1)
                }}
                placeholder="Nom entreprise ou ville..."
                className="w-full pl-10 pr-4 py-2 border rounded-ui-sm focus:ring-2 focus:ring-[rgb(var(--c-info)/0.3)]"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center mb-4">
          <p className="text-ui text-gray-600">
            {total.toLocaleString()} prospects • Page {page}
          </p>
          <button
            onClick={exportCSV}
            disabled={total === 0}
            className="flex items-center gap-2 btn btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            Exporter CSV
          </button>
        </div>

        <div className="bg-white rounded-ui-sm shadow overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">
              Chargement...
            </div>
          ) : prospects.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              Aucun prospect trouvé avec ces critères
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-ui-sm font-medium text-gray-500 uppercase">Entreprise</th>
                    <th className="px-4 py-3 text-left text-ui-sm font-medium text-gray-500 uppercase">Ville</th>
                    <th className="px-4 py-3 text-left text-ui-sm font-medium text-gray-500 uppercase">Effectif</th>
                    <th className="px-4 py-3 text-left text-ui-sm font-medium text-gray-500 uppercase">Contacts</th>
                    <th className="px-4 py-3 text-left text-ui-sm font-medium text-gray-500 uppercase">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {prospects.map(prospect => (
                    <tr key={prospect.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{prospect.name}</p>
                        <p className="text-ui-sm text-gray-500">{prospect.siret}</p>
                        
                        {prospect.is_multi_etablissement && (
                          <div className="mt-1">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-ui-sm bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]">
                               {prospect.etablissements_count} établissements
                              {prospect.is_siege && " (Siège)"}
                            </span>
                            
                            {prospect.contact_recommendation === 'call_siege_only' && (
                              <div className="mt-1 text-ui-sm text-[rgb(var(--c-warning))]">
                                 Même ville → Appeler le siège uniquement
                              </div>
                            )}
                            {prospect.contact_recommendation === 'call_all' && (
                              <div className="mt-1 text-ui-sm text-[rgb(var(--c-success))]">
                                 Villes différentes → Appeler tous
                              </div>
                            )}
                            {prospect.contact_recommendation === 'verify_first' && (
                              <div className="mt-1 text-ui-sm text-[rgb(var(--c-info))]">
                                 Vérifier si même contact avant
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-ui text-gray-900">{prospect.city}</p>
                        <p className="text-ui-sm text-gray-500">{DEPARTEMENTS[prospect.departement]}</p>
                      </td>
                      <td className="px-4 py-3 text-ui text-gray-700">
                        {prospect.effectif_label}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {prospect.phone && (
                            <div className="flex items-center gap-1 text-ui-sm text-[rgb(var(--c-success))]">
                              <Phone className="w-3 h-3" />
                              {prospect.phone}
                            </div>
                          )}
                          {prospect.email && (
                            <div className="flex items-center gap-1 text-ui-sm text-gray-800">
                              <Mail className="w-3 h-3" />
                              {prospect.email}
                            </div>
                          )}
                          {prospect.site_web && (
                            <div className="flex items-center gap-1 text-ui-sm text-[rgb(var(--c-info))]">
                              <Globe className="w-3 h-3" />
                              Site web
                            </div>
                          )}
                          {!prospect.phone && !prospect.email && !prospect.site_web && (
                            <span className="text-ui-sm text-gray-400">Aucun contact</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className={`inline-flex items-center px-2 py-1 rounded text-ui-sm font-medium ${
                          prospect.quality_score >= 70 ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' :
                          prospect.quality_score >= 50 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {prospect.quality_score}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          
          {total > perPage && (
            <div className="px-4 py-3 border-t flex justify-between items-center">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 text-ui border rounded-ui-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Précédent
              </button>
              <span className="text-ui text-gray-600">
                Page {page} sur {Math.ceil(total / perPage)}
              </span>
              <button
                onClick={() => setPage(p => Math.min(Math.ceil(total / perPage), p + 1))}
                disabled={page >= Math.ceil(total / perPage)}
                className="px-4 py-2 text-ui border rounded-ui-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Suivant
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

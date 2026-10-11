/**
 * ============================================================================
 * GROUPES MULTI-ÉTABLISSEMENTS - ANALYSE INTELLIGENTE
 * ============================================================================
 * 
 * À METTRE : afm-app-main/src/pages/MultiEtablissements.jsx
 * 
 * Cette page affiche les entreprises qui ont plusieurs établissements
 * et aide à décider s'il faut appeler tous ou juste le siège
 * ============================================================================
 */

import { useState, useEffect } from 'react'
import { supabase } from '../../../core/supabase'
import { Building2, MapPin, Phone, AlertTriangle, CheckCircle, HelpCircle } from 'lucide-react'
import toast from 'react-hot-toast'

export default function MultiEtablissements() {
  const [groupes, setGroupes] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedGroupe, setExpandedGroupe] = useState(null)

  useEffect(() => {
    loadGroupes()
  }, [])

  async function loadGroupes() {
    setLoading(true)
    
    const { data, error } = await supabase
      .from('prospection_groupes_siren')
      .select('*')
      .order('nb_etablissements', { ascending: false })
    
    if (error) {
      toast.error('Erreur chargement groupes')
      console.error(error)
      setLoading(false)
      return
    }
    
    setGroupes(data || [])
    setLoading(false)
  }

  async function loadEtablissements(siren) {
    const { data, error } = await supabase
      .from('prospection_massive')
      .select('*')
      .eq('siren', siren)
      .order('is_siege', { ascending: false })
      .order('city')
    
    if (error) {
      toast.error('Erreur chargement établissements')
      return []
    }
    
    return data || []
  }

  function getRecommendationBadge(recommendation) {
    const configs = {
      'call_all': {
        icon: <CheckCircle className="w-4 h-4" />,
        color: 'bg-green-100 text-green-800',
        text: 'Appeler tous les établissements',
        detail: 'Villes/départements différents = contacts probablement différents'
      },
      'call_siege_only': {
        icon: <AlertTriangle className="w-4 h-4" />,
        color: 'bg-orange-100 text-orange-800',
        text: 'Appeler le siège uniquement',
        detail: 'Même ville = probablement le même contact gère tous les établissements'
      },
      'verify_first': {
        icon: <HelpCircle className="w-4 h-4" />,
        color: 'bg-blue-100 text-blue-800',
        text: 'Vérifier avant d\'appeler',
        detail: '2 établissements proches = demander si contacts différents au 1er appel'
      }
    }
    
    const config = configs[recommendation] || configs['verify_first']
    
    return (
      <div className={`p-3 rounded-lg ${config.color}`}>
        <div className="flex items-center gap-2 mb-1">
          {config.icon}
          <span className="font-medium">{config.text}</span>
        </div>
        <p className="text-xs opacity-75">{config.detail}</p>
      </div>
    )
  }

  async function toggleGroupe(siren) {
    if (expandedGroupe === siren) {
      setExpandedGroupe(null)
    } else {
      setExpandedGroupe(siren)
      
      const groupe = groupes.find(g => g.siren === siren)
      if (!groupe.etablissements) {
        const etablissements = await loadEtablissements(siren)
        setGroupes(prev => prev.map(g => 
          g.siren === siren ? { ...g, etablissements } : g
        ))
      }
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <p className="text-gray-600">Chargement...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            🏢 Entreprises Multi-Établissements
          </h1>
          <p className="text-gray-600">
            {groupes.length} entreprises avec plusieurs établissements • Aide à la décision d'appel
          </p>
        </div>

        <div className="bg-white p-4 rounded-lg shadow mb-6">
          <h2 className="font-semibold mb-3">📖 Comment utiliser cette page ?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-green-900">Appeler tous</p>
                <p className="text-gray-600">Villes différentes = contacts différents → Appelle chaque établissement</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-orange-900">Siège uniquement</p>
                <p className="text-gray-600">Même ville = même contact → Appelle le siège, évite les doublons</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <HelpCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-blue-900">Vérifier d'abord</p>
                <p className="text-gray-600">Incertain → Demande au 1er appel si contacts différents</p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {groupes.map(groupe => {
            const isExpanded = expandedGroupe === groupe.siren
            const etablissements = groupe.etablissements || []
            
            return (
              <div key={groupe.siren} className="bg-white rounded-lg shadow overflow-hidden">
                
                <div 
                  className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleGroupe(groupe.siren)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Building2 className="w-5 h-5 text-gray-400" />
                        <h3 className="font-semibold text-lg text-gray-900">{groupe.name}</h3>
                        <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-sm">
                          {groupe.nb_etablissements} établissements
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                        <div className="flex items-center gap-1">
                          <MapPin className="w-4 h-4" />
                          {groupe.departements_list}
                        </div>
                        <div>
                          SIREN: {groupe.siren}
                        </div>
                      </div>
                      
                      {getRecommendationBadge(groupe.recommendation)}
                    </div>
                    
                    <button className="text-gray-400 hover:text-gray-600">
                      {isExpanded ? '▼' : '▶'}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t">
                    <div className="p-4 bg-gray-50">
                      <h4 className="font-medium text-gray-900 mb-3">
                        Détail des {etablissements.length} établissements :
                      </h4>
                      
                      <div className="space-y-2">
                        {etablissements.map((etab, index) => (
                          <div 
                            key={etab.id}
                            className={`p-3 rounded-lg ${
                              etab.is_siege 
                                ? 'bg-blue-50 border-2 border-blue-200' 
                                : 'bg-white border border-gray-200'
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-medium text-gray-900">
                                    {etab.city} ({etab.departement})
                                  </span>
                                  {etab.is_siege && (
                                    <span className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs font-medium">
                                      SIÈGE
                                    </span>
                                  )}
                                </div>
                                
                                <div className="text-sm text-gray-600 space-y-1">
                                  <p>SIRET: {etab.siret}</p>
                                  <p>{etab.address}</p>
                                  <p>Effectif: {etab.effectif_label || 'Non renseigné'}</p>
                                  
                                  <div className="flex gap-4 mt-2">
                                    {etab.phone && (
                                      <div className="flex items-center gap-1 text-green-600">
                                        <Phone className="w-3 h-3" />
                                        {etab.phone}
                                      </div>
                                    )}
                                    {!etab.phone && (
                                      <span className="text-gray-400 text-xs">Téléphone non enrichi</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-700">
                                {index + 1}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                
              </div>
            )
          })}
        </div>

        {groupes.length === 0 && (
          <div className="bg-white p-8 rounded-lg shadow text-center">
            <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">Aucune entreprise multi-établissements trouvée</p>
          </div>
        )}

      </div>
    </div>
  )
}

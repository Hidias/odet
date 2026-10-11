import { useState, useEffect } from 'react'
import { Calendar, Zap, Map, Columns } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../../../core/store'
import Prospection from './Prospection'
import SuiviCommercial from './SuiviCommercial'
import EnrichissementRapide from './EnrichissementRapide'
import ProspectionTerrain from './ProspectionTerrain'


export default function ProspectionTabs() {
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'rendez-vous')
  const { user } = useAuthStore()

  // Sync si on arrive depuis le WeeklyPlanner via ?tab=terrain
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab) setActiveTab(tab)
  }, [searchParams])

  const allTabs = [
    { id: 'rendez-vous',   label: 'Suivi commercial', icon: Calendar, component: SuiviCommercial,      adminOnly: false },
    { id: 'terrain',       label: 'Terrain',         icon: Map,       component: ProspectionTerrain,   adminOnly: false },
    { id: 'enrichissement',label: 'Enrichissement',  icon: Zap,       component: EnrichissementRapide, adminOnly: false },
    { id: 'rdv-ancien',    label: 'RDV (ancienne vue)', icon: Columns, component: Prospection,         adminOnly: false },
  ]

  const tabs = allTabs.filter(t => !t.adminOnly || user?.role === 'admin' || user?.role === 'superadmin')

  // Si l'onglet actif n'est plus visible (ex: Marine accède à commissions), fallback
  const activeExists = tabs.some(t => t.id === activeTab)
  const effectiveTab = activeExists ? activeTab : 'rendez-vous'

  const ActiveComponent = tabs.find(t => t.id === effectiveTab)?.component || SuiviCommercial

  return (
    <div className="space-y-6">
      {/* Onglets */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-4 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap
                  transition-colors
                  ${effectiveTab === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                  ${tab.adminOnly ? 'relative' : ''}
                `}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
                {tab.adminOnly && (
                  <span className="ml-0.5 text-[10px] text-gray-300" title="Réservé Hicham / Maxime">🔒</span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Contenu de l'onglet actif */}
      <div>
        <ActiveComponent />
      </div>
    </div>
  )
}

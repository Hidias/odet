// Module Interventions et tournées : parc de matériel des clients, visites sur téléphone, rapports,
// planning et tournées, contrats de maintenance. Module activable (org_modules, clé « interventions »).

import { useCallback, useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, Link, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Loader2, MapPin } from 'lucide-react'
import { useAuthStore } from '../../../core/store'
import { loadSettings, loadTypes, loadTechnicians, loadParts, setPrixMasques } from '../lib/itvData'
import { prixMasques } from '../../../core/rights/rights'
import MaJournee from './MaJournee'
import Visite from './Visite'
import Appareil from './Appareil'
import Planning from './Planning'
import Parc from './Parc'
import ParcClient from './ParcClient'
import Contrats from './Contrats'
import Reglages from './Reglages'

export const MANAGER_ROLES = ['superadmin', 'admin', 'direction', 'gestionnaire']

export default function Interventions() {
  const { modules, userRole, profile, rights } = useAuthStore()
  // Droits composés (C1b) : sans le droit des prix, lecture des vues sans prix (aucun changement à l'écran)
  const masques = prixMasques(rights)
  const location = useLocation()
  const [settings, setSettings] = useState(null)
  const [types, setTypes] = useState([])
  const [parts, setParts] = useState([])
  const [technicians, setTechnicians] = useState([])
  const [error, setError] = useState(null)
  const enabled = (modules || []).includes('interventions')
  const isManager = MANAGER_ROLES.includes(userRole)
  const isTechnician = technicians.some((t) => t.id === profile?.id)
  const canWrite = isManager || isTechnician

  const reload = useCallback(async () => {
    setPrixMasques(masques)
    try {
      const [s, t, p, tech] = await Promise.all([loadSettings(), loadTypes(), loadParts(), loadTechnicians()])
      setSettings(s); setTypes(t || []); setParts(p || []); setTechnicians(tech || [])
    } catch (e) { setError(e.message || String(e)) }
  }, [masques])

  useEffect(() => { if (enabled) reload() }, [enabled, reload])

  if (!enabled) {
    return (
      <div className="card text-center space-y-2 max-w-lg mx-auto mt-8">
        <MapPin className="w-8 h-8 text-gray-400 mx-auto" />
        <p className="font-semibold">Module « Interventions et tournées » désactivé</p>
        <p className="muted text-ui-sm">Le support peut l'activer sur demande.</p>
        <Link to="/" className="btn btn-secondary">Retour au tableau de bord</Link>
      </div>
    )
  }
  if (error) return <div className="card text-[rgb(var(--c-danger))]">Impossible de charger le module : {error}</div>
  if (!settings) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>

  const ctx = { settings, setSettings, types, setTypes, parts, setParts, technicians, reload, isManager, isTechnician, canWrite, profile, toast }
  const tabs = [
    { to: 'journee', label: 'Ma journée', show: isTechnician || isManager },
    { to: 'planning', label: 'Planning et tournées', show: isManager },
    { to: 'parc', label: 'Parc et visites', show: true },
    { to: 'contrats', label: 'Contrats', show: isManager },
    { to: 'reglages', label: 'Réglages', show: isManager },
  ].filter((t) => t.show)
  // Écrans plein usage terrain : pas d'onglets (visite en cours, appareil scanné)
  const fieldScreen = /\/interventions\/(visite|appareil)\//.test(location.pathname)

  return (
    <div className="space-y-4">
      {!fieldScreen && (
        <>
          <div>
            <div className="muted text-ui-sm">Maintenance</div>
            <h1 className="page-title">Interventions</h1>
          </div>
          <nav className="tabs" aria-label="Rubriques des interventions">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab ${isActive ? 'tab-active' : ''}`}>{t.label}</NavLink>
            ))}
          </nav>
        </>
      )}
      <Routes>
        <Route index element={<Navigate to={isTechnician || !isManager ? 'journee' : 'planning'} replace />} />
        <Route path="journee" element={<MaJournee {...ctx} />} />
        <Route path="visite/:id" element={<Visite {...ctx} />} />
        <Route path="appareil/:code" element={<Appareil {...ctx} />} />
        <Route path="planning" element={isManager ? <Planning {...ctx} /> : <Navigate to="../journee" replace />} />
        <Route path="parc" element={<Parc {...ctx} />} />
        <Route path="parc/:clientId" element={<ParcClient {...ctx} />} />
        <Route path="contrats" element={isManager ? <Contrats {...ctx} /> : <Navigate to="../journee" replace />} />
        <Route path="reglages" element={isManager ? <Reglages {...ctx} /> : <Navigate to="../journee" replace />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    </div>
  )
}

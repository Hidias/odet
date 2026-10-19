// Module Certification : déclaration d'activité (NDA), cycle Qualiopi, indicateurs du référentiel,
// méthode de calcul des résultats, dossier d'audit, toutes les certifications de la société (APSAD…) et, pour la
// direction, la face interne « erreurs à éviter ». Module activable (org_modules, clé « certification »).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Routes, Route, NavLink, Navigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Loader2, ShieldCheck } from 'lucide-react'
import { useAuthStore, useDataStore } from '../../../core/store'
import { loadSettings, loadDeadlines, loadReferential, loadDocuments, ndaPieceStates } from '../lib/certData'
import { loadEvidence, evaluateIndicators } from '../lib/proofs'
import CertHome from './CertHome'
import CertNda from './CertNda'
import CertQualiopi from './CertQualiopi'
import CertIndicateurs from './CertIndicateurs'
import CertMethode from './CertMethode'
import CertDossier from './CertDossier'
import CertSociete from './CertSociete'
import CertInterne from './CertInterne'

const TABS = [
  { to: '', label: 'Accueil', end: true },
  { to: 'nda', label: 'Déclaration' },
  { to: 'qualiopi', label: 'Qualiopi' },
  { to: 'indicateurs', label: 'Indicateurs' },
  { to: 'methode', label: 'Méthode de calcul' },
  { to: 'dossier', label: 'Dossier d\'audit' },
  { to: 'certifications', label: 'Toutes les certifications' },
]
// Face interne (conseil de direction) : onglet visible seulement avec le droit du cockpit ; la base refuse sinon
const TAB_INTERNE = { to: 'interne', label: 'Erreurs à éviter' }

export const WRITE_ROLES = ['superadmin', 'admin', 'direction', 'gestionnaire']

export default function Certification() {
  const { modules, userRole, can } = useAuthStore()
  const { organization, fetchOrganization, updateOrganization } = useDataStore()
  const [settings, setSettings] = useState(null)
  const [deadlines, setDeadlines] = useState([])
  const [documents, setDocuments] = useState([])
  const [ref, setRef] = useState(null)
  const [evidence, setEvidence] = useState(null)
  const [error, setError] = useState(null)
  const enabled = (modules || []).includes('certification')
  const canWrite = WRITE_ROLES.includes(userRole)
  const voitInterne = can?.('manager.cockpit.voir') === true
  const onglets = voitInterne ? [...TABS, TAB_INTERNE] : TABS

  const reloadSettings = useCallback(async () => {
    try {
      const [s, d, docs] = await Promise.all([loadSettings(), loadDeadlines(), loadDocuments()])
      setSettings(s)
      setDeadlines(d)
      setDocuments(docs)
      return s
    } catch (e) { setError(e.message || String(e)) }
    return null
  }, [])

  const reloadIndicators = useCallback(async (code) => {
    try {
      const [r, ev] = await Promise.all([loadReferential(code || settings?.referential_code || 'rnq-2026'), loadEvidence()])
      setRef({ ...r, code: code || settings?.referential_code || 'rnq-2026' })
      setEvidence(ev)
    } catch (e) { toast.error(`Indicateurs : ${e.message || e}`) }
  }, [settings?.referential_code])

  useEffect(() => {
    if (!enabled) return
    if (!organization) fetchOrganization()
    reloadSettings().then((s) => { if (s) reloadIndicators(s.referential_code) })
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const evaluated = useMemo(() => {
    if (!ref || !evidence) return null
    return evaluateIndicators(ref.indicators, { ...evidence, settings: settings || evidence.settings }, { statuses: ref.statuses, proofs: ref.proofs })
  }, [ref, evidence, settings])

  if (!enabled) {
    return (
      <div className="card text-center space-y-2 max-w-lg mx-auto mt-8">
        <ShieldCheck className="w-8 h-8 text-gray-400 mx-auto" />
        <p className="font-semibold">Module « NDA et Qualiopi » désactivé</p>
        <p className="muted text-ui-sm">Il s'active dans la Console, rubrique Modules.</p>
        <Link to="/" className="btn btn-secondary">Retour au tableau de bord</Link>
      </div>
    )
  }
  if (error) return <div className="card text-[rgb(var(--c-danger))]">Impossible de charger le suivi : {error}</div>
  if (!settings) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>

  const pieces = ndaPieceStates(documents, settings, evidence)
  const ctx = {
    settings, deadlines, documents, pieces, ndaDocs: pieces.filter((p) => p.ready).length, canWrite, organization, updateOrganization, fetchOrganization,
    referential: ref, evidence, evaluated, reloadSettings, reloadIndicators, setSettings,
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="muted text-ui-sm">Qualité</div>
        <h1 className="page-title">Certification</h1>
      </div>
      <nav className="tabs" aria-label="Rubriques de la certification">
        {onglets.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab ${isActive ? 'tab-active' : ''}`}>{t.label}</NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<CertHome {...ctx} />} />
        <Route path="nda" element={<CertNda {...ctx} />} />
        <Route path="qualiopi" element={<CertQualiopi {...ctx} />} />
        <Route path="indicateurs" element={<CertIndicateurs {...ctx} />} />
        <Route path="indicateurs/:num" element={<CertIndicateurs {...ctx} />} />
        <Route path="methode" element={<CertMethode {...ctx} />} />
        <Route path="dossier" element={<CertDossier {...ctx} />} />
        <Route path="certifications" element={<CertSociete {...ctx} />} />
        {voitInterne && <Route path="interne" element={<CertInterne />} />}
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    </div>
  )
}

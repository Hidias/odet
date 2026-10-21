// Module Certification : déclaration d'activité (NDA), cycle Qualiopi, indicateurs du référentiel,
// méthode de calcul des résultats, dossier d'audit, toutes les certifications de la société (APSAD…) et, pour la
// direction, la face interne « erreurs à éviter ». Module activable (org_modules, clé « certification »).
// 0391 (décision de H du 21/10) : en haut, la certification suivie. Qualiopi garde ses onglets ; une autre
// certification (APSAD…) a les siens au même endroit : accueil, suivi et audits, exigences, préparer l'audit.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Routes, Route, NavLink, Navigate, Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Loader2, ShieldCheck } from 'lucide-react'
import { useAuthStore, useDataStore } from '../../../core/store'
import { loadSettings, loadDeadlines, loadReferential, loadDocuments, ndaPieceStates } from '../lib/certData'
import { loadEvidence, evaluateIndicators } from '../lib/proofs'
import { chargerCertifications } from '../lib/certSociete'
import CertHome from './CertHome'
import CertNda from './CertNda'
import CertQualiopi from './CertQualiopi'
import CertIndicateurs from './CertIndicateurs'
import CertMethode from './CertMethode'
import CertDossier from './CertDossier'
import CertSociete from './CertSociete'
import CertInterne from './CertInterne'
import CertPreparer from './CertPreparer'
import { CertRefAccueil, CertRefSuivi } from './CertSuivi'

const TABS = [
  { to: '', label: 'Accueil', end: true },
  { to: 'nda', label: 'Déclaration' },
  { to: 'qualiopi', label: 'Certificateur et audits' },
  { to: 'indicateurs', label: 'Indicateurs' },
  { to: 'methode', label: 'Méthode de calcul' },
  { to: 'dossier', label: 'Dossier d\'audit' },
  { to: 'certifications', label: 'Toutes les certifications' },
  { to: 'preparer', label: 'Préparer l\'audit' },
]
// Onglets d'une certification autre que Qualiopi (APSAD…)
const TABS_AUTRE = [
  { to: '', label: 'Accueil', end: true },
  { to: 'suivi', label: 'Suivi et audits' },
  { to: 'exigences', label: 'Exigences' },
  { to: 'preparer', label: 'Préparer l\'audit' },
  { to: 'certifications', label: 'Toutes les certifications' },
]
// Face interne (conseil de direction) : onglet visible seulement avec le droit du cockpit ; la base refuse sinon
const TAB_INTERNE = { to: 'interne', label: 'Erreurs à éviter' }

// Certification suivie : « qualiopi » ou le code d'un référentiel commun (APSAD…). Mémorisée par navigateur.
const CLE_SUIVIE = 'odet-certification-suivie'
const lireSuivie = () => { try { return localStorage.getItem(CLE_SUIVIE) } catch { return null } }
const garderSuivie = (v) => { try { localStorage.setItem(CLE_SUIVIE, v) } catch { /* stockage indisponible */ } }

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
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [suivie, setSuivie] = useState(() => params.get('ref') || lireSuivie() || 'qualiopi')
  const [certifs, setCertifs] = useState(null) // { refs, certifs } de « Toutes les certifications »
  const [autre, setAutre] = useState(null) // exigences de la certification suivie, si ce n'est pas Qualiopi
  const rechargerCertifs = useCallback(() => chargerCertifications().then(setCertifs).catch(() => setCertifs({ refs: [], certifs: [] })), [])
  // Un lien d'échéance (?ref=apsad-…) choisit la certification
  useEffect(() => {
    const r = params.get('ref')
    if (r && r !== suivie) { setSuivie(r); garderSuivie(r) }
    if (r) { params.delete('ref'); setParams(params, { replace: true }) }
  }, [params]) // eslint-disable-line react-hooks/exhaustive-deps
  const choisirs = useMemo(() => (certifs?.refs || []).filter((r) => !r.company_id && !['qualiopi', 'nda'].includes(r.kind)), [certifs])
  const refeSuivie = suivie === 'qualiopi' ? null : choisirs.find((r) => r.code === suivie) || null
  const copieSuivie = refeSuivie ? (certifs?.refs || []).find((x) => x.company_id && x.code.startsWith(`${refeSuivie.code}-`)) || null : null
  const certifSuivie = refeSuivie ? (certifs?.certifs || []).find((c) => c.referential_code === refeSuivie.code) || null : null
  const enQualiopi = !refeSuivie
  const onglets = [...(enQualiopi ? TABS : TABS_AUTRE), ...(voitInterne ? [TAB_INTERNE] : [])]
  const changerSuivie = (v) => { setSuivie(v); garderSuivie(v); navigate('/certification') }

  // Exigences importées de la certification suivie : même calcul que Qualiopi, sans règle automatique
  const rechargerAutre = useCallback(async () => {
    if (!copieSuivie) { setAutre(null); return }
    try {
      const r = await loadReferential(copieSuivie.code)
      setAutre({ ...r, code: copieSuivie.code, evaluated: evaluateIndicators(r.indicators, null, { statuses: r.statuses, proofs: r.proofs }) })
    } catch (e) { toast.error(`Exigences : ${e.message || e}`) }
  }, [copieSuivie?.code]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { rechargerAutre() }, [rechargerAutre])

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
    rechargerCertifs()
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
        <p className="muted text-ui-sm">Le support peut l'activer sur demande.</p>
        <Link to="/" className="btn btn-secondary">Retour au tableau de bord</Link>
      </div>
    )
  }
  if (error) return <div className="card text-[rgb(var(--c-danger))]">Impossible de charger le suivi : {error}</div>
  if (!settings || (suivie !== 'qualiopi' && !certifs)) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>

  const pieces = ndaPieceStates(documents, settings, evidence)
  const ctx = {
    settings, deadlines, documents, pieces, ndaDocs: pieces.filter((p) => p.ready).length, canWrite, organization, updateOrganization, fetchOrganization,
    referential: ref, evidence, evaluated, reloadSettings, reloadIndicators, setSettings,
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="muted text-ui-sm">Qualité</div>
          <h1 className="page-title">Certification</h1>
        </div>
        {choisirs.length > 0 && (
          <label className="block min-w-[16rem] max-w-full">
            <span className="label">Certification suivie</span>
            <select className="select" value={refeSuivie ? refeSuivie.code : 'qualiopi'} onChange={(e) => changerSuivie(e.target.value)}>
              <option value="qualiopi">Qualiopi et déclaration d'activité</option>
              {choisirs.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </label>
        )}
      </div>
      <nav className="tabs" aria-label="Rubriques de la certification">
        {onglets.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab ${isActive ? 'tab-active' : ''}`}>{t.label}</NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={enQualiopi ? <CertHome {...ctx} />
          : <CertRefAccueil refe={refeSuivie} copie={copieSuivie} certif={certifSuivie} evaluated={autre?.evaluated} />} />
        {!enQualiopi && <Route path="suivi" element={<CertRefSuivi refe={refeSuivie} copie={copieSuivie} certif={certifSuivie} canWrite={canWrite} recharger={() => { rechargerCertifs() }} />} />}
        {!enQualiopi && <Route path="exigences" element={<ExigencesSuivies autre={autre} copie={copieSuivie} canWrite={canWrite} recharger={rechargerAutre} />} />}
        {!enQualiopi && <Route path="exigences/:num" element={<ExigencesSuivies autre={autre} copie={copieSuivie} canWrite={canWrite} recharger={rechargerAutre} />} />}
        <Route path="nda" element={<CertNda {...ctx} />} />
        <Route path="qualiopi" element={<CertQualiopi {...ctx} />} />
        <Route path="indicateurs" element={<CertIndicateurs {...ctx} />} />
        <Route path="indicateurs/:num" element={<CertIndicateurs {...ctx} />} />
        <Route path="methode" element={<CertMethode {...ctx} />} />
        <Route path="dossier" element={<CertDossier {...ctx} />} />
        <Route path="certifications" element={<CertSociete {...ctx} />} />
        <Route path="preparer" element={<CertPreparer referentiel={refeSuivie} />} />
        {voitInterne && <Route path="interne" element={<CertInterne />} />}
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    </div>
  )
}

// Exigences de la certification suivie : texte importé par la société, ou invitation à l'importer
function ExigencesSuivies({ autre, copie, canWrite, recharger }) {
  if (!copie) {
    return (
      <div className="card space-y-2 max-w-2xl">
        <h2 className="section-title">Aucune exigence pour l'instant</h2>
        <p className="text-ui-sm text-gray-700">
          Le texte de ce référentiel est payant : l'outil ne le fournit pas et n'invente aucune exigence. Importez-le
          depuis votre exemplaire dans « Suivi et audits » : chaque exigence reçoit ensuite ses preuves, comme un indicateur Qualiopi.
        </p>
        <Link to="/certification/suivi" className="btn btn-secondary btn-sm">Suivi et audits</Link>
      </div>
    )
  }
  if (!autre) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  return <CertIndicateurs exigences referential={autre} evaluated={autre.evaluated} canWrite={canWrite} reloadIndicators={recharger} reloadSettings={recharger} />
}

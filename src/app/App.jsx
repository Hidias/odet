import { useEffect, lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from '../core/store'
import { BrandingProvider, useBranding } from '../core/branding/BrandingProvider'
import { authModeFromUrl } from '../core/auth/SetPassword'
import TestBanner from '../core/TestBanner'
import { PageErrorBoundary, RouteErrorBoundary } from '../core/errors/ErrorBoundary'

// ─── Chargement immédiat (pages critiques) ───────────────────
import Layout from './Layout'
import PublicLayout from './PublicLayout'
import Login from '../core/auth/Login'
import Dashboard from '../modules/dashboard/Dashboard'

// ─── Chargement différé (lazy loading) ───────────────────────
// Pages privées
const Clients = lazy(() => import('../modules/commercial/pages/Clients'))
const ClientDetail = lazy(() => import('../modules/commercial/pages/ClientDetail'))
const Courses = lazy(() => import('../modules/formation/pages/Courses'))
const Trainers = lazy(() => import('../modules/formation/pages/Trainers'))
const Trainees = lazy(() => import('../modules/formation/pages/Trainees'))
const Sessions = lazy(() => import('../modules/formation/pages/Sessions'))
const SessionDetail = lazy(() => import('../modules/formation/pages/SessionDetail'))
const Documents = lazy(() => import('../modules/formation/pages/Documents'))
const DocumentsVierges = lazy(() => import('../modules/formation/pages/DocumentsVierges'))
const Settings = lazy(() => import('../core/settings/Settings'))
const SetupWizard = lazy(() => import('../core/setup/SetupWizard'))
const SetPassword = lazy(() => import('../core/auth/SetPassword'))
const Console = lazy(() => import('../core/console/Console'))
const ConsoleErreurs = lazy(() => import('../core/console/ConsoleErreurs'))
const NonConformites = lazy(() => import('../modules/qualite/pages/NonConformites'))
const RegistrePSH = lazy(() => import('../modules/qualite/pages/RegistrePSH'))
const Indicateurs = lazy(() => import('../modules/qualite/pages/Indicateurs'))
const ProfilStagiaires = lazy(() => import('../modules/formation/pages/ProfilStagiaires'))
const TestsPositionnement = lazy(() => import('../modules/formation/pages/TestsPositionnement'))
const VeilleQualiopi = lazy(() => import('../modules/qualite/pages/VeilleQualiopi'))
const Qualiopi = lazy(() => import('../modules/qualite/pages/Qualiopi'))
const AuditLogs = lazy(() => import('../core/audit/AuditLogs'))
const Quotes = lazy(() => import('../modules/commercial/pages/Quotes'))
const Invoices = lazy(() => import('../modules/commercial/pages/Invoices'))
const QualiteEditables = lazy(() => import('../modules/qualite/pages/QualiteEditables'))
const Completude = lazy(() => import('../modules/qualite/pages/Completude'))
const BPF = lazy(() => import('../modules/qualite/pages/BPF'))
const Certification = lazy(() => import('../modules/certification/pages/Certification'))
const Interventions = lazy(() => import('../modules/interventions/pages/Interventions'))
// Prospection
const ProspectionTabs = lazy(() => import('../modules/prospection/pages/ProspectionTabs'))
const ProspectRDVDetail = lazy(() => import('../modules/prospection/pages/ProspectRDVDetail'))
const ProspectionMassive = lazy(() => import('../modules/prospection/pages/ProspectionMassive'))
const MultiEtablissements = lazy(() => import('../modules/prospection/pages/MultiEtablissements'))
const AdminImport = lazy(() => import('../modules/prospection/pages/AdminImport'))
const Mailing = lazy(() => import('../modules/mailing/pages/Mailing'))
// Email
const EmailSettings = lazy(() => import('../core/settings/EmailSettings'))
// DUERP
const DuerpProjects = lazy(() => import('../modules/duerp/pages/DuerpProjects'))
const DuerpDetail = lazy(() => import('../modules/duerp/pages/DuerpDetail'))
// Budget
const BudgetModule = lazy(() => import('../modules/finance/pages/BudgetModule'))
// Social Media
const SocialMedia = lazy(() => import('../modules/social/pages/SocialMedia'))
// ─── NOUVEAU : Espace Comptable ───
const EspaceComptable = lazy(() => import('../modules/finance/pages/EspaceComptable'))
// ─── Signature sur le téléphone du formateur ───
const SignatureFormateur = lazy(() => import('../modules/formation/pages/SignatureFormateur'))

// Pages publiques
const TraineePortal = lazy(() => import('../modules/portail/pages/TraineePortal'))
const PublicReclamation = lazy(() => import('../modules/portail/pages/Reclamation'))
const ClientPortal = lazy(() => import('../modules/portail/pages/ClientPortal'))

function PageLoader() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500"></div>
    </div>
  )
}

// Composant de protection des routes - redirige le comptable vers /comptable
function PrivateRoute({ children }) {
  const { user, userRole, loading } = useAuthStore()
  const { branding, loaded } = useBranding()
  const location = useLocation()
  const navigate = useNavigate()

  // Instance pas encore configurée : l'administrateur passe par l'assistant
  const needsSetup = !loading && !!user && loaded && branding.setup_completed === false && ['superadmin', 'admin'].includes(userRole) && location.pathname !== '/setup'
  useEffect(() => {
    if (needsSetup) navigate('/setup', { replace: true })
  }, [needsSetup, navigate, location.pathname])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-500"></div>
      </div>
    )
  }

  if (!user) {
    // On garde la page demandée pour y revenir après la connexion
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />
  }

  // Le comptable atterrit toujours sur /comptable
  if (userRole === 'comptable') {
    return <Navigate to="/comptable" replace />
  }

  if (needsSetup) return <PageLoader />

  return children
}

// Route réservée au comptable (et aux admins qui veulent y accéder)
function ComptableRoute({ children }) {
  const { user, loading } = useAuthStore()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-500"></div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}

export default function App() {
  const initialize = useAuthStore(state => state.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])

  // Lien d'invitation ou de réinitialisation : écran dédié, hors routeur
  const authMode = authModeFromUrl()
  if (authMode) {
    return (
      <BrandingProvider>
        <TestBanner />
        <PageErrorBoundary>
          <Suspense fallback={<PageLoader />}><SetPassword mode={authMode} /></Suspense>
        </PageErrorBoundary>
      </BrandingProvider>
    )
  }

  return (
    <BrandingProvider>
    <TestBanner />
    <HashRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'rgb(var(--c-nav))',
            color: 'rgb(var(--c-nav-fg))',
            borderLeft: '4px solid rgb(var(--c-accent-500))',
            fontFamily: 'var(--font-body)',
            fontSize: '14px',
          },
          success: { iconTheme: { primary: 'rgb(var(--c-highlight-500))', secondary: 'rgb(var(--c-nav))' } },
          error: {
            style: { background: 'rgb(var(--c-nav))', borderLeft: '4px solid rgb(var(--c-danger))' },
            iconTheme: { primary: 'rgb(var(--c-danger))', secondary: '#fff' },
          },
        }}
      />

      <RouteErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Routes publiques */}
          <Route path="/login" element={<Login />} />

          <Route path="/reclamation" element={<PublicReclamation />} />

          <Route path="/portail/:token" element={<TraineePortal />} />
          <Route path="/entreprise/:token" element={<ClientPortal />} />

          {/* ─── Route Espace Comptable (comptable + admins) ─── */}
          <Route path="/comptable" element={
            <ComptableRoute>
              <EspaceComptable />
            </ComptableRoute>
          } />

          {/* Assistant de configuration : plein écran, hors menu */}
          <Route path="/setup" element={
            <PrivateRoute>
              <SetupWizard />
            </PrivateRoute>
          } />

          {/* Signature sur le téléphone du formateur : plein écran, hors menu */}
          <Route path="/signature/:sessionId" element={
            <PrivateRoute>
              <SignatureFormateur />
            </PrivateRoute>
          } />

          {/* Routes privées (admins uniquement - comptable redirigé) */}
          <Route path="/" element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }>
            <Route index element={<Dashboard />} />
            <Route path="clients" element={<Clients />} />
            <Route path="clients/:id" element={<ClientDetail />} />
            <Route path="devis" element={<Quotes />} />
            <Route path="factures" element={<Invoices />} />
            <Route path="prospection" element={<ProspectionTabs />} />
            <Route path="prospection/:id" element={<ProspectRDVDetail />} />
            <Route path="prospection-massive" element={<ProspectionMassive />} />
            <Route path="multi-etablissements" element={<MultiEtablissements />} />
            <Route path="admin/import" element={<AdminImport />} />
            <Route path="mailing" element={<Mailing />} />
            <Route path="duerp" element={<DuerpProjects />} />
            <Route path="duerp/:id" element={<DuerpDetail />} />
            <Route path="budget" element={<BudgetModule />} />
            <Route path="social" element={<SocialMedia />} />
            <Route path="formations" element={<Courses />} />
            <Route path="formateurs" element={<Trainers />} />
            <Route path="stagiaires" element={<Trainees />} />
            <Route path="sessions" element={<Sessions />} />
            <Route path="sessions/:id" element={<SessionDetail />} />
            <Route path="documents" element={<Documents />} />
            <Route path="documents-vierges" element={<DocumentsVierges />} />
            <Route path="qualite" element={<QualiteEditables />} />
            <Route path="qualite/completude" element={<Completude />} />
            <Route path="tests-positionnement" element={<TestsPositionnement />} />
            <Route path="non-conformites" element={<NonConformites />} />
            <Route path="registre-psh" element={<RegistrePSH />} />
            <Route path="indicateurs" element={<Indicateurs />} />
            <Route path="profil-stagiaires" element={<ProfilStagiaires />} />
            <Route path="qualiopi" element={<Qualiopi />} />
            <Route path="bpf" element={<BPF />} />
            <Route path="certification/*" element={<Certification />} />
            <Route path="interventions/*" element={<Interventions />} />
            <Route path="veille-qualiopi" element={<VeilleQualiopi />} />
            <Route path="audit-logs" element={<AuditLogs />} />
            <Route path="parametres" element={<Settings />} />
            <Route path="console" element={<Console />} />
            <Route path="console/erreurs" element={<ConsoleErreurs />} />
            <Route path="mot-de-passe" element={<SetPassword mode="change" onDone={() => window.history.back()} />} />
            <Route path="settings/email" element={<EmailSettings />} />
          </Route>

          {/* 404 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </RouteErrorBoundary>
    </HashRouter>
    </BrandingProvider>
  )
}

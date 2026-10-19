import { useEffect, lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from '../core/store'
import { BrandingProvider, useBranding } from '../core/branding/BrandingProvider'
import { authModeFromUrl } from '../core/auth/SetPassword'
import { PageErrorBoundary, RouteErrorBoundary } from '../core/errors/ErrorBoundary'
import { ConfirmProvider } from '../ui/Confirm'
import NouvelleVersion from '../core/version/NouvelleVersion'
import { accesPage } from '../core/modules/registry'
import PageRefusee from '../core/rights/PageRefusee'

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
const DesignReference = lazy(() => import('../ui/DesignReference'))
const ReglesGestion = lazy(() => import('../core/rights/ReglesGestion'))
const ConsoleErreurs = lazy(() => import('../core/console/ConsoleErreurs'))
const QuoiDeNeuf = lazy(() => import('../core/notices/QuoiDeNeuf'))
const Obligations = lazy(() => import('../modules/formation/pages/Obligations'))
const AValider = lazy(() => import('../modules/commercial/pages/AValider'))
const SousTraitants = lazy(() => import('../modules/formation/pages/SousTraitants'))
const EspaceEntrepriseAdmin = lazy(() => import('../modules/commercial/pages/EspaceEntrepriseAdmin'))
const EspaceEntreprise = lazy(() => import('../modules/portail/pages/EspaceEntreprise'))
const EspaceExterne = lazy(() => import('../modules/portail/pages/EspaceExterne'))
const Pistes = lazy(() => import('../modules/commercial/pages/Pistes'))
const Previsionnel = lazy(() => import('../modules/commercial/pages/Previsionnel'))
const Affaires = lazy(() => import('../modules/commercial/pages/Affaires'))
const Conformite = lazy(() => import('../modules/conformite/pages/Conformite'))
const Personnel = lazy(() => import('../modules/rh/pages/Personnel'))
const Stock = lazy(() => import('../modules/stock/pages/Stock'))
const Emprunts = lazy(() => import('../modules/manager/pages/Emprunts'))
const Vehicules = lazy(() => import('../modules/vehicules/pages/Vehicules'))
const RetoursSuivi = lazy(() => import('../core/feedback/RetoursSuivi'))
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
const Passeport = lazy(() => import('../modules/passeport/pages/Passeport'))
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
// ─── Suivi formatif sur le téléphone du formateur ───
const SuiviTelephone = lazy(() => import('../modules/suivi/pages/SuiviTelephone'))

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
  const { user, userRole, loading, rights, can } = useAuthStore()
  const { branding, loaded } = useBranding()
  const location = useLocation()
  const navigate = useNavigate()

  // Instance pas encore configurée : l'administrateur passe par l'assistant
  const needsSetup = !loading && !!user && loaded && branding.setup_completed === false && ['superadmin', 'admin'].includes(userRole) && accesPage('/setup', userRole, can) && location.pathname !== '/setup'
  useEffect(() => {
    if (needsSetup) navigate('/setup', { replace: true })
  }, [needsSetup, navigate, location.pathname, rights])

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

  // Compte entreprise (lot 2, 0046) : son espace seulement
  if (userRole === 'entreprise') {
    return <Navigate to="/mon-entreprise" replace />
  }
  // Formateur externe et stagiaire (lot 2, 0047) : leur espace seulement
  if (userRole === 'formateur_externe' || userRole === 'stagiaire') {
    return <Navigate to="/mon-espace" replace />
  }

  if (needsSetup) return <PageLoader />

  return children
}

// Page hors du cadre principal (assistant de configuration) : même garde que le menu et les pages
function GardeRoute({ chemin, children }) {
  const { userRole, loading, can } = useAuthStore()
  useAuthStore((st) => st.rights)
  if (loading) return <PageLoader />
  if (!accesPage(chemin, userRole, can)) return <PageRefusee />
  return children
}

// Espace d'un compte entreprise : connecté et au rôle entreprise, sinon retour à l'application
function EntrepriseRoute({ children }) {
  const { user, loading, userRole } = useAuthStore()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" state={{ from: '/mon-entreprise' }} replace />
  if (userRole !== 'entreprise') return <Navigate to="/" replace />
  return children
}

// Espace d'un formateur externe ou d'un stagiaire : connecté et à l'un de ces rôles, sinon retour à l'application
function ExterneRoute({ children }) {
  const { user, loading, userRole } = useAuthStore()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" state={{ from: '/mon-espace' }} replace />
  if (userRole !== 'formateur_externe' && userRole !== 'stagiaire') return <Navigate to="/" replace />
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
        <PageErrorBoundary>
          <Suspense fallback={<PageLoader />}><SetPassword mode={authMode} /></Suspense>
        </PageErrorBoundary>
      </BrandingProvider>
    )
  }

  return (
    <BrandingProvider>
    {/* Confirmations communes (useConfirm) : une seule fenêtre pour toute l'application */}
    <ConfirmProvider>
    <HashRouter>
      <NouvelleVersion />
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

          {/* ─── Espace entreprise avec compte (rôle entreprise, lot 2) ─── */}
          <Route path="/mon-entreprise" element={
            <EntrepriseRoute>
              <EspaceEntreprise />
            </EntrepriseRoute>
          } />

          {/* ─── Espaces formateur externe et stagiaire (lot 2) ─── */}
          <Route path="/mon-espace" element={
            <ExterneRoute>
              <EspaceExterne />
            </ExterneRoute>
          } />

          {/* ─── Route Espace Comptable (comptable + admins) ─── */}
          <Route path="/comptable" element={
            <ComptableRoute>
              <EspaceComptable />
            </ComptableRoute>
          } />

          {/* Assistant de configuration : plein écran, hors menu */}
          <Route path="/setup" element={
            <PrivateRoute>
              <GardeRoute chemin="/setup"><SetupWizard /></GardeRoute>
            </PrivateRoute>
          } />

          {/* Signature sur le téléphone du formateur : plein écran, hors menu */}
          <Route path="/signature/:sessionId" element={
            <PrivateRoute>
              <SignatureFormateur />
            </PrivateRoute>
          } />

          {/* ─── Suivi formatif plein écran (téléphone du formateur) ─── */}
          <Route path="/suivi/:sessionId" element={
            <PrivateRoute>
              <SuiviTelephone />
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
            <Route path="passeport/*" element={<Passeport />} />
            <Route path="veille-qualiopi" element={<VeilleQualiopi />} />
            <Route path="audit-logs" element={<AuditLogs />} />
            <Route path="parametres" element={<Settings />} />
            <Route path="console" element={<Console />} />
            <Route path="regles-gestion" element={<ReglesGestion />} />
            <Route path="design-systeme" element={<DesignReference />} />
            <Route path="console/erreurs" element={<ConsoleErreurs />} />
            <Route path="nouveautes" element={<QuoiDeNeuf />} />
            <Route path="obligations" element={<Obligations />} />
            <Route path="a-valider" element={<AValider />} />
            <Route path="sous-traitants" element={<SousTraitants />} />
            <Route path="espace-entreprise" element={<EspaceEntrepriseAdmin />} />
            <Route path="pistes" element={<Pistes />} />
            <Route path="previsionnel" element={<Previsionnel />} />
            <Route path="affaires" element={<Affaires />} />
            <Route path="conformite" element={<Conformite />} />
            <Route path="collaborateurs/*" element={<Personnel />} />
            <Route path="stock/*" element={<Stock />} />
            <Route path="emprunts" element={<Emprunts />} />
            <Route path="vehicules/*" element={<Vehicules />} />
            <Route path="retours" element={<RetoursSuivi />} />
            <Route path="mot-de-passe" element={<SetPassword mode="change" onDone={() => window.history.back()} />} />
            <Route path="settings/email" element={<EmailSettings />} />
          </Route>

          {/* 404 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </RouteErrorBoundary>
    </HashRouter>
    </ConfirmProvider>
    </BrandingProvider>
  )
}

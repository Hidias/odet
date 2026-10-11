-- ============================================================
-- SCHÉMA DE BASE DE DONNÉES POUR AFM (Access Formation Manager) v2
-- À exécuter dans Supabase SQL Editor
-- ============================================================

-- Activer l'extension UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE: CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    siret VARCHAR(14),
    address TEXT,
    postal_code VARCHAR(10),
    city VARCHAR(100),
    country VARCHAR(100) DEFAULT 'France',
    phone VARCHAR(20),
    email VARCHAR(255),
    website VARCHAR(500),
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: COURSES (Formations)
-- ============================================================
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    objectives TEXT,
    prerequisites TEXT,
    target_audience TEXT,
    program TEXT,
    duration_hours DECIMAL(5,1) NOT NULL,
    modality VARCHAR(20) DEFAULT 'presential' CHECK (modality IN ('presential', 'remote', 'hybrid')),
    certification VARCHAR(255),
    rncp_code VARCHAR(20),
    price_ht DECIMAL(10,2),
    min_trainees INTEGER DEFAULT 1,
    max_trainees INTEGER DEFAULT 12,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: TRAINERS (Formateurs)
-- ============================================================
CREATE TABLE IF NOT EXISTS trainers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    specialties TEXT,
    bio TEXT,
    is_internal BOOLEAN DEFAULT true,
    company VARCHAR(255),
    cv_url VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: TRAINEES (Stagiaires)
-- ============================================================
CREATE TABLE IF NOT EXISTS trainees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    birth_date DATE,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    has_nir BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference VARCHAR(50) UNIQUE NOT NULL,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_time TIME DEFAULT '09:00',
    end_time TIME DEFAULT '17:00',
    location VARCHAR(255),
    room VARCHAR(100),
    is_remote BOOLEAN DEFAULT false,
    remote_url VARCHAR(500),
    status VARCHAR(20) DEFAULT 'planned' CHECK (status IN ('draft', 'planned', 'in_progress', 'completed', 'cancelled')),
    attendance_token VARCHAR(64) UNIQUE,
    checklist JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: SESSION_TRAINERS (Formateurs par session)
-- ============================================================
CREATE TABLE IF NOT EXISTS session_trainers (
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    PRIMARY KEY (session_id, trainer_id)
);

-- ============================================================
-- TABLE: SESSION_TRAINEES (Stagiaires inscrits)
-- ============================================================
CREATE TABLE IF NOT EXISTS session_trainees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    trainee_id UUID NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'confirmed', 'attended', 'partial', 'absent', 'cancelled')),
    quiz_score DECIMAL(5,2),
    quiz_passed BOOLEAN,
    certificate_issued BOOLEAN DEFAULT false,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (session_id, trainee_id)
);

-- ============================================================
-- TABLE: ATTENDANCES (Émargements)
-- ============================================================
CREATE TABLE IF NOT EXISTS attendances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    trainee_id UUID NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    period VARCHAR(10) NOT NULL CHECK (period IN ('am', 'pm', 'full')),
    signature_data TEXT,
    signature_hash VARCHAR(100),
    signed_at TIMESTAMPTZ DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT,
    geolocation JSONB,
    proof_hash VARCHAR(64),
    UNIQUE (session_id, trainee_id, date, period)
);

-- ============================================================
-- TABLE: DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doc_type VARCHAR(30) NOT NULL,
    number VARCHAR(50) UNIQUE NOT NULL,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    trainee_id UUID REFERENCES trainees(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'ready' CHECK (status IN ('generating', 'ready', 'error')),
    error_message TEXT,
    file_url VARCHAR(500),
    file_size INTEGER,
    file_hash VARCHAR(64),
    generated_data JSONB DEFAULT '{}',
    retention_until DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID
);

-- ============================================================
-- TABLE: QUESTIONNAIRES
-- ============================================================
CREATE TABLE IF NOT EXISTS questionnaires (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    q_type VARCHAR(20) NOT NULL CHECK (q_type IN ('hot', 'cold', 'custom')),
    title VARCHAR(255) NOT NULL,
    questions JSONB NOT NULL DEFAULT '[]',
    auto_send BOOLEAN DEFAULT false,
    send_delay_days INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: QUESTIONNAIRE_RESPONSES
-- ============================================================
CREATE TABLE IF NOT EXISTS questionnaire_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    questionnaire_id UUID NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    trainee_id UUID REFERENCES trainees(id) ON DELETE SET NULL,
    token VARCHAR(64) UNIQUE NOT NULL,
    answers JSONB DEFAULT '{}',
    is_completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    reminder_sent_at TIMESTAMPTZ
);

-- ============================================================
-- TABLE: ORG_SETTINGS (Paramètres organisme)
-- ============================================================
CREATE TABLE IF NOT EXISTS org_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) DEFAULT 'Access Formation',
    siret VARCHAR(14),
    nda VARCHAR(20),
    address TEXT,
    city VARCHAR(100),
    postal_code VARCHAR(10),
    phone VARCHAR(20),
    email VARCHAR(255),
    website VARCHAR(255),
    logo_url VARCHAR(500),
    dirigeant_name VARCHAR(255),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEX
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sessions_dates ON sessions(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(attendance_token);
CREATE INDEX IF NOT EXISTS idx_attendances_session ON attendances(session_id);
CREATE INDEX IF NOT EXISTS idx_attendances_date ON attendances(date);
CREATE INDEX IF NOT EXISTS idx_documents_session ON documents(session_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_trainees_client ON trainees(client_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Désactiver RLS temporairement pour recréer les politiques
ALTER TABLE clients DISABLE ROW LEVEL SECURITY;
ALTER TABLE courses DISABLE ROW LEVEL SECURITY;
ALTER TABLE trainers DISABLE ROW LEVEL SECURITY;
ALTER TABLE trainees DISABLE ROW LEVEL SECURITY;
ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE session_trainers DISABLE ROW LEVEL SECURITY;
ALTER TABLE session_trainees DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendances DISABLE ROW LEVEL SECURITY;
ALTER TABLE documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE questionnaires DISABLE ROW LEVEL SECURITY;
ALTER TABLE questionnaire_responses DISABLE ROW LEVEL SECURITY;
ALTER TABLE org_settings DISABLE ROW LEVEL SECURITY;

-- Supprimer les anciennes politiques si elles existent
DROP POLICY IF EXISTS "Authenticated users full access" ON clients;
DROP POLICY IF EXISTS "Authenticated users full access" ON courses;
DROP POLICY IF EXISTS "Authenticated users full access" ON trainers;
DROP POLICY IF EXISTS "Authenticated users full access" ON trainees;
DROP POLICY IF EXISTS "Authenticated users full access" ON sessions;
DROP POLICY IF EXISTS "Authenticated users full access" ON session_trainers;
DROP POLICY IF EXISTS "Authenticated users full access" ON session_trainees;
DROP POLICY IF EXISTS "Authenticated users full access" ON documents;
DROP POLICY IF EXISTS "Authenticated users full access" ON questionnaires;
DROP POLICY IF EXISTS "Authenticated users full access" ON org_settings;
DROP POLICY IF EXISTS "Public read sessions by token" ON sessions;
DROP POLICY IF EXISTS "Public read session_trainees" ON session_trainees;
DROP POLICY IF EXISTS "Public read trainees" ON trainees;
DROP POLICY IF EXISTS "Public insert attendances" ON attendances;
DROP POLICY IF EXISTS "Public read attendances" ON attendances;
DROP POLICY IF EXISTS "Authenticated users full access" ON attendances;

-- Réactiver RLS
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainers ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainees ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_trainers ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_trainees ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE questionnaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE questionnaire_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;

-- Politiques pour les utilisateurs authentifiés (accès complet)
CREATE POLICY "Authenticated users full access" ON clients FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON courses FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON trainers FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON trainees FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON sessions FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON session_trainers FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON session_trainees FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON attendances FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON documents FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON questionnaires FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON questionnaire_responses FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON org_settings FOR ALL USING (auth.role() = 'authenticated');

-- Politiques pour l'accès PUBLIC (émargement sans authentification)
-- Permettre à tout le monde de lire les sessions (pour l'émargement via token)
CREATE POLICY "Public read sessions by token" ON sessions FOR SELECT USING (true);

-- Permettre à tout le monde de lire les stagiaires inscrits
CREATE POLICY "Public read session_trainees" ON session_trainees FOR SELECT USING (true);

-- Permettre à tout le monde de lire les infos stagiaires (nom, prénom)
CREATE POLICY "Public read trainees" ON trainees FOR SELECT USING (true);

-- Permettre à tout le monde de lire les cours
CREATE POLICY "Public read courses" ON courses FOR SELECT USING (true);

-- Permettre à tout le monde de lire les clients
CREATE POLICY "Public read clients" ON clients FOR SELECT USING (true);

-- Permettre à tout le monde d'INSÉRER des émargements (signature publique)
CREATE POLICY "Public insert attendances" ON attendances FOR INSERT WITH CHECK (true);

-- Permettre à tout le monde de LIRE les émargements
CREATE POLICY "Public read attendances" ON attendances FOR SELECT USING (true);

-- ============================================================
-- TRIGGER: Updated_at automatique
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Créer les triggers (ignorer si déjà existants)
DROP TRIGGER IF EXISTS update_clients_updated_at ON clients;
DROP TRIGGER IF EXISTS update_courses_updated_at ON courses;
DROP TRIGGER IF EXISTS update_trainers_updated_at ON trainers;
DROP TRIGGER IF EXISTS update_trainees_updated_at ON trainees;
DROP TRIGGER IF EXISTS update_sessions_updated_at ON sessions;

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_trainers_updated_at BEFORE UPDATE ON trainers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_trainees_updated_at BEFORE UPDATE ON trainees FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- DONNÉES INITIALES (optionnel)
-- ============================================================

-- Insérer les paramètres par défaut de l'organisme
INSERT INTO org_settings (name, siret, nda, address, city, postal_code, phone, email, dirigeant_name)
VALUES (
    'SARL Access Formation',
    '943 563 866 00012',
    '53 29 10412 29',
    '22 rue de Concarneau',
    'Concarneau',
    '29900',
    '02 46 56 57 54',
    'contact@accessformation.pro',
    'Hicham SAÏDI'
) ON CONFLICT DO NOTHING;

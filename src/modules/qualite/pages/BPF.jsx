import { toneStyle } from '../../../ui/StatusBadge'
import { useState, useEffect } from 'react'
import { supabase } from '../../../core/supabase'
import { fetchAll, fetchAllIn } from '../../../core/fetchAll'
import { 
  FileText, Calculator, Save, Download, RefreshCw, ChevronDown, ChevronRight,
  Building2, Users, GraduationCap, Euro, ClipboardCheck, AlertCircle, CheckCircle, Info
} from 'lucide-react'
import toast from 'react-hot-toast'

// ═══════════════════════════════════════════════════════════════
// BPF - Bilan Pédagogique et Financier (Cerfa 10443*17)
// Auto-calcul depuis les données de l'application
// ═══════════════════════════════════════════════════════════════

const CURRENT_YEAR = new Date().getFullYear()
const DEFAULT_YEAR = CURRENT_YEAR - 1 // BPF porte sur l'exercice précédent

// Codes NSF des formations
const NSF_CODES = {
  sst: { code: '344', label: 'Sécurité des biens et des personnes, police, surveillance' },
  conduite: { code: '311', label: 'Transport, manutention, magasinage' },
  incendie: { code: '344', label: 'Sécurité des biens et des personnes, police, surveillance' },
  elec: { code: '255', label: 'Électricité, électronique (non compris automatismes, productique)' },
  autre: { code: '333', label: 'Enseignement, formation' },
}

// Constantes organisme
// Identité de l'organisme : lue dans les paramètres (organization_settings), jamais écrite ici
const ORG = {
  name: '', siret: '', naf: '', nda: '', address: '', postal_code: '', city: '',
  phone: '', email: '', forme_juridique: '', dirigeant: '', qualite_dirigeant: '',
}
function syncOrg(o) {
  if (!o) return
  Object.assign(ORG, {
    name: o.legal_name || o.name || '', siret: o.siret || '', naf: o.naf || '', nda: o.nda || '',
    address: o.address || '', postal_code: o.postal_code || '', city: o.city || '', phone: o.phone || '',
    email: o.email || '', forme_juridique: o.forme_juridique || '', dirigeant: o.dirigeant_name || '',
    qualite_dirigeant: o.dirigeant_title || '',
  })
}

export default function BPF() {
  const [year, setYear] = useState(DEFAULT_YEAR)
  const [loading, setLoading] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [bpfId, setBpfId] = useState(null)
  const [openSections, setOpenSections] = useState({
    A: true, B: true, C: true, D: true, E: true, F1: true, F2: true, F3: true, F4: true, G: true, H: true
  })

  // ─── État du formulaire ─────────────────────────────────────
  const [form, setForm] = useState({
    status: 'draft',
    // Cadre A
    org_name: ORG.name,
    org_siret: ORG.siret,
    org_nda: ORG.nda,
    org_address: "",
    org_dirigeant: ORG.dirigeant,
    // Cadre B
    exercice_start: `${DEFAULT_YEAR}-01-01`,
    exercice_end: `${DEFAULT_YEAR}-12-31`,
    has_distance_learning: false,
    // Cadre C - Produits
    c1_entreprises: 0,
    c2a_apprentissage: 0,
    c2b_pro: 0,
    c2c_alternance: 0,
    c2d_transition: 0,
    c2e_cpf: 0,
    c2f_recherche_emploi: 0,
    c2g_non_salaries: 0,
    c2h_plan_dev: 0,
    c3_agents_publics: 0,
    c4_europe: 0,
    c5_etat: 0,
    c6_regions: 0,
    c7_france_travail: 0,
    c8_autres_publics: 0,
    c9_particuliers: 0,
    c10_sous_traitance: 0,
    c11_autres: 0,
    ca_pct_formation: 100,
    // Cadre D - Charges
    d_total: 0,
    d_salaires_formateurs: 0,
    d_sous_traitance: 0,
    // Cadre E - Formateurs
    e_internes_nb: 0,
    e_internes_heures: 0,
    e_externes_nb: 0,
    e_externes_heures: 0,
    // Cadre F-1 - Stagiaires par type
    f1a_salaries_nb: 0, f1a_salaries_heures: 0,
    f1b_apprentis_nb: 0, f1b_apprentis_heures: 0,
    f1c_demandeurs_nb: 0, f1c_demandeurs_heures: 0,
    f1d_particuliers_nb: 0, f1d_particuliers_heures: 0,
    f1e_autres_nb: 0, f1e_autres_heures: 0,
    // Cadre F-2 - Sous-traitance
    f2_nb: 0, f2_heures: 0,
    // Cadre F-3 - Objectifs
    f3a_rncp_nb: 0, f3a_rncp_heures: 0,
    f3a_niv6_nb: 0, f3a_niv6_heures: 0,
    f3a_niv5_nb: 0, f3a_niv5_heures: 0,
    f3a_niv4_nb: 0, f3a_niv4_heures: 0,
    f3a_niv3_nb: 0, f3a_niv3_heures: 0,
    f3a_niv2_nb: 0, f3a_niv2_heures: 0,
    f3a_cqp_nb: 0, f3a_cqp_heures: 0,
    f3b_rs_nb: 0, f3b_rs_heures: 0,
    f3c_cqp_hors_nb: 0, f3c_cqp_hors_heures: 0,
    f3d_autres_nb: 0, f3d_autres_heures: 0,
    f3e_bilan_nb: 0, f3e_bilan_heures: 0,
    f3f_vae_nb: 0, f3f_vae_heures: 0,
    // Cadre F-4 - Spécialités
    specialites: [
      { code: '344', label: 'Sécurité des biens et des personnes (SST, Incendie)', nb: 0, heures: 0 },
      { code: '311', label: 'Transport, manutention, magasinage (Conduite d\'engins)', nb: 0, heures: 0 },
      { code: '255', label: 'Électricité, électronique (Habilitation)', nb: 0, heures: 0 },
      { code: '', label: '', nb: 0, heures: 0 },
      { code: '', label: '', nb: 0, heures: 0 },
    ],
    specialites_autres_nb: 0,
    specialites_autres_heures: 0,
    // Cadre G
    g_nb: 0, g_heures: 0,
    // Cadre H
    h_dirigeant: ORG.dirigeant,
    h_qualite: ORG.qualite_dirigeant,
    h_email: ORG.email,
    h_phone: ORG.phone,
    h_lieu: ORG.city,
    // Meta
    notes: '',
    nb_sessions: 0,
    nb_sessions_realisees: 0,
    calculated_at: null,
  })

  // Identité de l'organisme dans le formulaire (champs encore vides seulement)
  useEffect(() => {
    supabase.from('organization_settings').select('*').limit(1).maybeSingle().then(({ data }) => {
      if (!data) return
      syncOrg(data)
      setForm((f) => ({
        ...f,
        org_name: f.org_name || ORG.name, org_siret: f.org_siret || ORG.siret, org_nda: f.org_nda || ORG.nda,
        org_address: f.org_address || [ORG.address, [ORG.postal_code, ORG.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        org_dirigeant: f.org_dirigeant || ORG.dirigeant,
        h_dirigeant: f.h_dirigeant || ORG.dirigeant, h_qualite: f.h_qualite || ORG.qualite_dirigeant,
        h_email: f.h_email || ORG.email, h_phone: f.h_phone || ORG.phone, h_lieu: f.h_lieu || ORG.city,
      }))
    })
  }, [])

  const updateForm = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  // ─── Charger un BPF existant ────────────────────────────────
  useEffect(() => {
    loadBPF()
  }, [year])

  const loadBPF = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('bpf_declarations')
      .select('*')
      .eq('year', year)
      .maybeSingle()

    if (data) {
      setBpfId(data.id)
      // Mapper les champs DB vers le form
      setForm(prev => ({
        ...prev,
        status: data.status || 'draft',
        org_name: data.org_name || ORG.name,
        org_siret: data.org_siret || ORG.siret,
        org_nda: data.org_nda || ORG.nda,
        org_address: data.org_address || prev.org_address,
        org_dirigeant: data.org_dirigeant || ORG.dirigeant,
        exercice_start: data.exercice_start || `${year}-01-01`,
        exercice_end: data.exercice_end || `${year}-12-31`,
        c1_entreprises: data.ca_entreprises || 0,
        c2h_plan_dev: data.ca_opco || 0,
        c7_france_travail: data.ca_pouvoirs_publics || 0,
        c2e_cpf: data.ca_cpf || 0,
        c9_particuliers: data.ca_particuliers || 0,
        c10_sous_traitance: data.ca_sous_traitance || 0,
        c11_autres: data.ca_autres || 0,
        d_total: data.charges_total || 0,
        d_salaires_formateurs: data.charges_personnel_formateur || 0,
        d_sous_traitance: data.charges_sous_traitance || 0,
        e_internes_nb: data.formateurs_internes_nb || 0,
        e_internes_heures: data.formateurs_internes_heures || 0,
        e_externes_nb: data.formateurs_externes_nb || 0,
        e_externes_heures: data.formateurs_externes_heures || 0,
        f1a_salaries_nb: data.stagiaires_salaries || 0,
        f1c_demandeurs_nb: data.stagiaires_demandeurs_emploi || 0,
        f1d_particuliers_nb: data.stagiaires_particuliers || 0,
        f1e_autres_nb: data.stagiaires_autres || 0,
        specialites: data.specialites?.length > 0 ? data.specialites : prev.specialites,
        nb_sessions: data.nb_sessions || 0,
        nb_sessions_realisees: data.nb_sessions_realisees || 0,
        notes: data.notes || '',
        calculated_at: data.calculated_at,
      }))
    } else {
      setBpfId(null)
      setForm(prev => ({
        ...prev,
        status: 'draft',
        exercice_start: `${year}-01-01`,
        exercice_end: `${year}-12-31`,
        calculated_at: null,
      }))
    }
    setLoading(false)
  }

  // ─── CALCUL AUTO depuis la BDD ──────────────────────────────
  const handleCalculate = async () => {
    setCalculating(true)
    try {
      const startDate = `${year}-01-01`
      const endDate = `${year}-12-31`

      // 1. Sessions de l'année (fetchAll / fetchAllIn : pagination complète, le BPF ne doit rien perdre)
      const { data: sessions } = await fetchAll(() => supabase
        .from('sessions')
        .select('id, reference, course_id, trainer_id, start_date, end_date, status, courses(id, title, code, duration_hours, price_ht)')
        .gte('start_date', startDate)
        .lte('start_date', endDate))

      const allSessions = sessions || []
      const completedSessions = allSessions.filter(s => ['completed', 'closed'].includes(s.status))

      // 2. Factures de l'année (uniquement formation professionnelle)
      const { data: invoices } = await fetchAll(() => supabase
        .from('invoices')
        .select('id, type, total_net_ht, status, client_id, session_id, invoice_date, is_formation_pro')
        .gte('invoice_date', startDate)
        .lte('invoice_date', endDate)
        .in('status', ['paid', 'sent', 'due', 'overdue', 'partial', 'credited']))

      // Exclure les factures hors formation professionnelle
      const allInvoices = (invoices || []).filter(inv => inv.is_formation_pro !== false)
      const excludedInvoices = (invoices || []).filter(inv => inv.is_formation_pro === false)
      // Avoirs validés déduits (montant HT négatif)
      const signedHt = (inv) => (inv.type === 'credit_note' ? -1 : 1) * (parseFloat(inv.total_net_ht) || 0)
      const totalCA = allInvoices.reduce((sum, inv) => sum + signedHt(inv), 0)
      const totalHorsFP = excludedInvoices.reduce((sum, inv) => sum + signedHt(inv), 0)

      // 2b. Clients avec leur type (entreprise, organisme_formation, public)
      const { data: clients } = await fetchAll(() => supabase
        .from('clients')
        .select('id, name, client_type'))

      // 3. Financements multi-financeurs
      const sessionIds = allSessions.map(s => s.id)
      let fundings = []
      if (sessionIds.length > 0) {
        const { data: fundingsData } = await fetchAllIn(() => supabase
          .from('session_fundings')
          .select('*'), 'session_id', sessionIds)
        fundings = fundingsData || []
      }

      // Répartir le CA par type de financeur
      let caEntreprises = 0, caOpco = 0, caCpf = 0, caParticuliers = 0, caAutres = 0
      let caAgentsPublics = 0, caSousTraitance = 0
      const clientMap = new Map((clients || []).map(c => [c.id, c]))

      if (fundings.length > 0) {
        fundings.forEach(f => {
          const amount = parseFloat(f.amount_ht) || 0
          switch (f.funder_type) {
            case 'entreprise': caEntreprises += amount; break
            case 'opco': caOpco += amount; break
            case 'cpf': caCpf += amount; break
            case 'stagiaire': caParticuliers += amount; break
            default: caAutres += amount
          }
        })
      } else {
        // Pas de multi-financeurs → dispatcher par type de client
        allInvoices.forEach(inv => {
          const amount = signedHt(inv)
          const client = clientMap.get(inv.client_id)
          const clientType = client?.client_type || 'entreprise'
          switch (clientType) {
            case 'organisme_formation': caSousTraitance += amount; break
            case 'public': caAgentsPublics += amount; break
            case 'opco': caOpco += amount; break
            case 'particulier': caParticuliers += amount; break
            default: caEntreprises += amount
          }
        })
      }

      // 4. Stagiaires
      const { data: sessionTrainees } = await fetchAllIn(() => supabase
        .from('session_trainees')
        .select('trainee_id, session_id, trainees(id, first_name, last_name, gender, csp)'), 'session_id', sessionIds)

      const stList = sessionTrainees || []
      // Compter les stagiaires uniques
      const uniqueTrainees = new Map()
      stList.forEach(st => {
        if (st.trainees && !uniqueTrainees.has(st.trainees.id)) {
          uniqueTrainees.set(st.trainees.id, st.trainees)
        }
      })

      // Compter par CSP - sur les PARTICIPATIONS (pas les stagiaires uniques)
      // pour cohérence F-1 = F-3 = F-4 (exigence Cerfa)
      let salaries = 0, demandeurs = 0, particuliers = 0, autresSt = 0
      let hommes = 0, femmes = 0
      stList.forEach(st => {
        const t = st.trainees
        if (!t) return
        const csp = (t.csp || '').toLowerCase()
        if (csp.includes('salar') || csp.includes('employé') || csp.includes('cadre') || csp.includes('ouvrier') || csp === '') {
          salaries++
        } else if (csp.includes('demandeur') || csp.includes('chôm')) {
          demandeurs++
        } else if (csp.includes('particulier') || csp.includes('individuel')) {
          particuliers++
        } else {
          autresSt++
        }
        if (t.gender === 'female') femmes++
        else hommes++
      })

      // Si pas de CSP renseigné, tous en salariés (cas le plus courant en intra entreprise)
      if (salaries === 0 && demandeurs === 0 && particuliers === 0 && autresSt === 0) {
        salaries = stList.filter(st => st.trainees).length
      }

      // 5. Heures stagiaires
      // Total = nb inscriptions × durée formation (pas nb unique mais nb participations)
      let totalHeuresStagiaires = 0
      stList.forEach(st => {
        const session = allSessions.find(s => s.id === st.session_id)
        if (session?.courses?.duration_hours) {
          totalHeuresStagiaires += parseFloat(session.courses.duration_hours) || 0
        }
      })

      // 6. Formateurs
      const { data: trainers } = await fetchAll(() => supabase
        .from('trainers')
        .select('id, first_name, last_name, is_internal'))

      const allTrainers = trainers || []
      const trainerIds = [...new Set(allSessions.map(s => s.trainer_id).filter(Boolean))]
      const activeTrainers = allTrainers.filter(t => trainerIds.includes(t.id))
      const internes = activeTrainers.filter(t => t.is_internal !== false)
      const externes = activeTrainers.filter(t => t.is_internal === false)

      // Heures dispensées par les formateurs
      let heuresInternes = 0, heuresExternes = 0
      allSessions.forEach(s => {
        const hours = parseFloat(s.courses?.duration_hours) || 0
        const trainer = allTrainers.find(t => t.id === s.trainer_id)
        if (trainer?.is_internal === false) {
          heuresExternes += hours
        } else {
          heuresInternes += hours
        }
      })

      // 7. Spécialités NSF
      const specMap = {}
      stList.forEach(st => {
        const session = allSessions.find(s => s.id === st.session_id)
        const title = (session?.courses?.title || '').toLowerCase()
        const code = (session?.courses?.code || '').toLowerCase()
        const hours = parseFloat(session?.courses?.duration_hours) || 0

        let nsfCode = '333', nsfLabel = 'Autres formations'
        if (title.includes('sst') || code.includes('sst')) {
          nsfCode = '344'; nsfLabel = 'Sécurité des biens et des personnes (SST)'
        } else if (title.includes('r489') || title.includes('r485') || title.includes('r482') || title.includes('r486') || title.includes('chariot') || title.includes('nacelle') || title.includes('engin')) {
          nsfCode = '311'; nsfLabel = 'Transport, manutention, magasinage (Conduite d\'engins)'
        } else if (title.includes('incendie') || title.includes('epi') || title.includes('evacuation')) {
          nsfCode = '344'; nsfLabel = 'Sécurité des biens et des personnes (Incendie)'
        } else if (title.includes('electri') || title.includes('habilit') || code.includes('elec')) {
          nsfCode = '255'; nsfLabel = 'Électricité, électronique (Habilitation)'
        }

        if (!specMap[nsfCode]) specMap[nsfCode] = { code: nsfCode, label: nsfLabel, nb: 0, heures: 0 }
        specMap[nsfCode].nb++
        specMap[nsfCode].heures += hours
      })

      const specialitesCalc = Object.values(specMap).sort((a, b) => b.nb - a.nb)
      // Remplir 5 lignes max
      const spec5 = []
      for (let i = 0; i < 5; i++) {
        spec5.push(specialitesCalc[i] || { code: '', label: '', nb: 0, heures: 0 })
      }

      // 8. Objectifs - Aucune formation inscrite au RS ou RNCP → tout en "Autres formations"
      const totalStNb = stList.length
      const totalStHeures = totalHeuresStagiaires

      // Calculer le % CA formation pro
      const totalCAGlobal = totalCA + totalHorsFP
      const pctFormation = totalCAGlobal > 0 ? Math.round((totalCA / totalCAGlobal) * 100) : 100

      // Mettre à jour le formulaire
      setForm(prev => ({
        ...prev,
        c1_entreprises: Math.round(caEntreprises * 100) / 100,
        c2h_plan_dev: Math.round(caOpco * 100) / 100,
        c2e_cpf: Math.round(caCpf * 100) / 100,
        c3_agents_publics: Math.round(caAgentsPublics * 100) / 100,
        c9_particuliers: Math.round(caParticuliers * 100) / 100,
        c10_sous_traitance: Math.round(caSousTraitance * 100) / 100,
        c11_autres: Math.round(caAutres * 100) / 100,
        ca_pct_formation: pctFormation,
        e_internes_nb: internes.length,
        e_internes_heures: Math.round(heuresInternes * 10) / 10,
        e_externes_nb: externes.length,
        e_externes_heures: Math.round(heuresExternes * 10) / 10,
        f1a_salaries_nb: salaries,
        f1a_salaries_heures: Math.round(totalHeuresStagiaires * (salaries / (totalStNb || 1)) * 10) / 10,
        f1c_demandeurs_nb: demandeurs,
        f1c_demandeurs_heures: Math.round(totalHeuresStagiaires * (demandeurs / (totalStNb || 1)) * 10) / 10,
        f1d_particuliers_nb: particuliers,
        f1d_particuliers_heures: Math.round(totalHeuresStagiaires * (particuliers / (totalStNb || 1)) * 10) / 10,
        f1e_autres_nb: autresSt,
        f1e_autres_heures: Math.round(totalHeuresStagiaires * (autresSt / (totalStNb || 1)) * 10) / 10,
        f3d_autres_nb: totalStNb,
        f3d_autres_heures: Math.round(totalStHeures * 10) / 10,
        specialites: spec5,
        nb_sessions: allSessions.length,
        nb_sessions_realisees: completedSessions.length,
        calculated_at: new Date().toISOString(),
      }))

      const exclMsg = totalHorsFP > 0 ? ` (${excludedInvoices.length} factures hors FP exclues : ${totalHorsFP.toFixed(0)}€)` : ''
      toast.success(`Calcul terminé : ${allSessions.length} sessions, ${totalStNb} participations (${uniqueTrainees.size} stagiaires uniques), ${totalCA.toFixed(0)}€ CA FP${exclMsg}`)
    } catch (err) {
      console.error('Erreur calcul BPF:', err)
      toast.error('Erreur lors du calcul')
    } finally {
      setCalculating(false)
    }
  }

  // ─── Sauvegarder ────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    try {
      const dbData = {
        year,
        status: form.status,
        org_name: form.org_name,
        org_siret: form.org_siret,
        org_nda: form.org_nda,
        org_address: form.org_address,
        org_dirigeant: form.org_dirigeant,
        exercice_start: form.exercice_start,
        exercice_end: form.exercice_end,
        ca_entreprises: form.c1_entreprises,
        ca_opco: form.c2h_plan_dev,
        ca_cpf: form.c2e_cpf,
        ca_pouvoirs_publics: parseFloat(form.c3_agents_publics || 0) + parseFloat(form.c5_etat || 0) + parseFloat(form.c6_regions || 0) + parseFloat(form.c7_france_travail || 0),
        ca_particuliers: form.c9_particuliers,
        ca_sous_traitance: form.c10_sous_traitance,
        ca_autres: form.c11_autres,
        ca_total: getCTotal(),
        charges_total: form.d_total,
        charges_personnel_formateur: form.d_salaires_formateurs,
        charges_sous_traitance: form.d_sous_traitance,
        formateurs_internes_nb: form.e_internes_nb,
        formateurs_internes_heures: form.e_internes_heures,
        formateurs_externes_nb: form.e_externes_nb,
        formateurs_externes_heures: form.e_externes_heures,
        stagiaires_salaries: form.f1a_salaries_nb,
        stagiaires_demandeurs_emploi: form.f1c_demandeurs_nb,
        stagiaires_particuliers: form.f1d_particuliers_nb,
        stagiaires_autres: form.f1e_autres_nb,
        stagiaires_total: getF1Total('nb'),
        stagiaires_hommes: 0,
        stagiaires_femmes: 0,
        heures_stagiaires_total: getF1Total('heures'),
        specialites: form.specialites,
        nb_sessions: form.nb_sessions,
        nb_sessions_realisees: form.nb_sessions_realisees,
        notes: form.notes,
        calculated_at: form.calculated_at,
        updated_at: new Date().toISOString(),
      }

      if (bpfId) {
        const { error } = await supabase.from('bpf_declarations').update(dbData).eq('id', bpfId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('bpf_declarations').insert(dbData).select().maybeSingle()
        if (error) throw error
        setBpfId(data.id)
      }
      toast.success('BPF sauvegardé')
    } catch (err) {
      console.error('Erreur save BPF:', err)
      toast.error('Erreur : ' + (err.message || 'sauvegarde impossible'))
    } finally {
      setSaving(false)
    }
  }

  // ─── Calculs totaux ─────────────────────────────────────────
  const getC2Total = () => {
    return [form.c2a_apprentissage, form.c2b_pro, form.c2c_alternance, form.c2d_transition, form.c2e_cpf, form.c2f_recherche_emploi, form.c2g_non_salaries, form.c2h_plan_dev]
      .reduce((s, v) => s + (parseFloat(v) || 0), 0)
  }

  const getCTotal = () => {
    return [form.c1_entreprises, getC2Total(), form.c3_agents_publics, form.c4_europe, form.c5_etat, form.c6_regions, form.c7_france_travail, form.c8_autres_publics, form.c9_particuliers, form.c10_sous_traitance, form.c11_autres]
      .reduce((s, v) => s + (parseFloat(v) || 0), 0)
  }

  const getF1Total = (type) => {
    const suffix = type === 'nb' ? '_nb' : '_heures'
    return ['f1a_salaries', 'f1b_apprentis', 'f1c_demandeurs', 'f1d_particuliers', 'f1e_autres']
      .reduce((s, k) => s + (parseFloat(form[k + suffix]) || 0), 0)
  }

  const getF3Total = (type) => {
    const suffix = type === 'nb' ? '_nb' : '_heures'
    return ['f3a_rncp', 'f3b_rs', 'f3c_cqp_hors', 'f3d_autres', 'f3e_bilan', 'f3f_vae']
      .reduce((s, k) => s + (parseFloat(form[k + suffix]) || 0), 0)
  }

  const getF4Total = (type) => {
    const key = type === 'nb' ? 'nb' : 'heures'
    const specTotal = form.specialites.reduce((s, sp) => s + (parseFloat(sp[key]) || 0), 0)
    return specTotal + (parseFloat(type === 'nb' ? form.specialites_autres_nb : form.specialites_autres_heures) || 0)
  }

  // ─── Helpers UI ─────────────────────────────────────────────
  const toggleSection = (id) => setOpenSections(prev => ({ ...prev, [id]: !prev[id] }))

  const SectionHeader = ({ id, icon: Icon, title, color = 'blue' }) => (
    <button
      onClick={() => toggleSection(id)}
      className={`w-full flex items-center gap-3 p-3 border rounded-ui-sm transition-colors`} style={toneStyle(color, { text: false, border: true })}
    >
      {openSections[id] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      <Icon className={`w-5 h-5`} style={toneStyle(color, { bg: false })} />
      <span className="font-semibold text-ui">{title}</span>
    </button>
  )

  const NumField = ({ label, field, suffix = '€', disabled = false, bold = false, sub = false }) => (
    <div className={`flex items-center justify-between gap-2 ${sub ? 'ml-3 sm:ml-6' : ''} ${bold ? 'font-semibold bg-gray-50 p-2 rounded' : ''}`}>
      <span className={`text-ui ${bold ? 'text-gray-900' : 'text-gray-700'} flex-1 min-w-0`}>{label}</span>
      <div className="flex items-center gap-1 flex-none">
        <input
          type="text"
          inputMode="decimal"
          key={`${field}-${form.calculated_at || 'init'}`}
          defaultValue={form[field] || 0}
          onBlur={(e) => updateForm(field, parseFloat(e.target.value) || 0)}
          disabled={disabled}
          className={`w-24 sm:w-32 text-right text-ui border rounded px-2 py-1 ${disabled ? 'bg-gray-100 text-gray-500' : 'bg-white'} ${bold ? 'font-semibold' : ''}`}
        />
        <span className="text-ui-sm text-gray-400 w-6">{suffix}</span>
      </div>
    </div>
  )

  const TotalRow = ({ label, value, suffix = '€' }) => (
    <div className="flex items-center justify-between gap-2 font-bold bg-[rgb(var(--c-info-bg))] p-2 rounded border border-[rgb(var(--c-info)/0.3)]">
      <span className="text-ui text-[rgb(var(--c-info))]">{label}</span>
      <div className="flex items-center gap-1">
        <span className="w-24 sm:w-32 text-right text-ui font-bold text-[rgb(var(--c-info))]">{typeof value === 'number' ? value.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : value}</span>
        <span className="text-ui-sm text-[rgb(var(--c-info))] w-6">{suffix}</span>
      </div>
    </div>
  )

  // ─── RENDU ──────────────────────────────────────────────────
  if (loading) return <div className="flex items-center justify-center py-20"><RefreshCw className="w-6 h-6 animate-spin text-gray-400" /></div>

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <FileText className="w-6 h-6 text-[rgb(var(--c-info))]" />
            Bilan Pédagogique et Financier
          </h1>
          <p className="text-ui text-gray-500 mt-1">Cerfa 10443*17 - Exercice {year}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="input text-ui w-28"
          >
            {[CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={handleCalculate}
            disabled={calculating}
            className="btn btn-secondary flex items-center gap-2 text-ui"
          >
            {calculating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
            Calculer
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary flex items-center gap-2 text-ui"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Sauvegarder
          </button>
        </div>
      </div>

      {/* Info calcul */}
      {form.calculated_at && (
        <div className="bg-[rgb(var(--c-success-bg))] border border-[rgb(var(--c-success)/0.3)] rounded-ui-sm p-3 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-[rgb(var(--c-success))]" />
          <span className="text-ui text-[rgb(var(--c-success))]">
            Dernier calcul auto : {new Date(form.calculated_at).toLocaleString('fr-FR')} - {form.nb_sessions} sessions ({form.nb_sessions_realisees} terminées)
          </span>
        </div>
      )}

      {/* ═══ CADRE A - IDENTIFICATION ═══ */}
      <div className="card space-y-3">
        <SectionHeader id="A" icon={Building2} title="A. IDENTIFICATION DE L'ORGANISME DE FORMATION" />
        {openSections.A && (
          <div className="grid grid-cols-2 gap-3 p-3">
            <div>
              <label className="text-ui-sm text-gray-500">N° de déclaration (NDA)</label>
              <input className="input text-ui" value={form.org_nda} onChange={(e) => updateForm('org_nda', e.target.value)} />
            </div>
            <div>
              <label className="text-ui-sm text-gray-500">SIRET</label>
              <input className="input text-ui" value={form.org_siret} onChange={(e) => updateForm('org_siret', e.target.value)} />
            </div>
            <div>
              <label className="text-ui-sm text-gray-500">Forme juridique</label>
              <input className="input text-ui" value={ORG.forme_juridique} disabled />
            </div>
            <div>
              <label className="text-ui-sm text-gray-500">Code NAF</label>
              <input className="input text-ui" value={ORG.naf} disabled />
            </div>
            <div className="col-span-2">
              <label className="text-ui-sm text-gray-500">Dénomination</label>
              <input className="input text-ui" value={form.org_name} onChange={(e) => updateForm('org_name', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="text-ui-sm text-gray-500">Adresse</label>
              <input className="input text-ui" value={form.org_address} onChange={(e) => updateForm('org_address', e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {/* ═══ CADRE B - INFORMATIONS GÉNÉRALES ═══ */}
      <div className="card space-y-3">
        <SectionHeader id="B" icon={Info} title="B. INFORMATIONS GÉNÉRALES" />
        {openSections.B && (
          <div className="p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-ui-sm text-gray-500">Exercice comptable du</label>
                <input type="date" className="input text-ui" value={form.exercice_start} onChange={(e) => updateForm('exercice_start', e.target.value)} />
              </div>
              <div>
                <label className="text-ui-sm text-gray-500">Au</label>
                <input type="date" className="input text-ui" value={form.exercice_end} onChange={(e) => updateForm('exercice_end', e.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.has_distance_learning} onChange={(e) => updateForm('has_distance_learning', e.target.checked)} className="w-4 h-4" />
              <span className="text-ui">Actions de formation à distance (e-learning, classes virtuelles)</span>
            </label>
          </div>
        )}
      </div>

      {/* ═══ CADRE C - PRODUITS ═══ */}
      <div className="card space-y-3">
        <SectionHeader id="C" icon={Euro} title="C. BILAN FINANCIER HT : ORIGINE DES PRODUITS" color="green" />
        {openSections.C && (
          <div className="p-3 space-y-2">
            <NumField label="1. Entreprises pour la formation de leurs salariés" field="c1_entreprises" />
            <p className="text-ui-sm text-gray-500 font-medium mt-3 mb-1">2. Organismes gestionnaires des fonds de la formation :</p>
            <NumField label="a. Contrats d'apprentissage" field="c2a_apprentissage" sub />
            <NumField label="b. Contrats de professionnalisation" field="c2b_pro" sub />
            <NumField label="c. Promotion/reconversion par alternance" field="c2c_alternance" sub />
            <NumField label="d. Projets de transition professionnelle" field="c2d_transition" sub />
            <NumField label="e. Compte personnel de formation (CPF)" field="c2e_cpf" sub />
            <NumField label="f. Dispositifs personnes en recherche d'emploi" field="c2f_recherche_emploi" sub />
            <NumField label="g. Dispositifs travailleurs non-salariés" field="c2g_non_salaries" sub />
            <NumField label="h. Plan de développement des compétences / OPCO" field="c2h_plan_dev" sub />
            <TotalRow label="Total ligne 2 (a à h)" value={getC2Total()} />
            <NumField label="3. Pouvoirs publics - formation de leurs agents" field="c3_agents_publics" />
            <p className="text-ui-sm text-gray-500 font-medium mt-2 mb-1">Pouvoirs publics - publics spécifiques :</p>
            <NumField label="4. Instances européennes" field="c4_europe" sub />
            <NumField label="5. État" field="c5_etat" sub />
            <NumField label="6. Conseils régionaux" field="c6_regions" sub />
            <NumField label="7. France Travail (ex Pôle emploi)" field="c7_france_travail" sub />
            <NumField label="8. Autres ressources publiques" field="c8_autres_publics" sub />
            <NumField label="9. Personnes à titre individuel (à leurs frais)" field="c9_particuliers" />
            <NumField label="10. Contrats avec d'autres OF (sous-traitance)" field="c10_sous_traitance" />
            <NumField label="11. Autres produits formation professionnelle" field="c11_autres" />
            <TotalRow label="TOTAL DES PRODUITS (lignes 1 à 11)" value={getCTotal()} />
            <NumField label="Part du CA global en formation professionnelle" field="ca_pct_formation" suffix="%" />
          </div>
        )}
      </div>

      {/* ═══ CADRE D - CHARGES ═══ */}
      <div className="card space-y-3">
        <SectionHeader id="D" icon={Euro} title="D. BILAN FINANCIER HT : CHARGES DE L'ORGANISME" color="red" />
        {openSections.D && (
          <div className="p-3 space-y-2">
            <NumField label="Total des charges liées à l'activité de formation" field="d_total" bold />
            <NumField label="• dont Salaires des formateurs" field="d_salaires_formateurs" sub />
            <NumField label="• dont Achats de prestation / honoraires de formation" field="d_sous_traitance" sub />
            <div className="bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] rounded p-2 mt-2">
              <p className="text-ui-sm text-[rgb(var(--c-warning))]">
                <AlertCircle className="w-3 h-3 inline mr-1" />
                Le cadre D doit être rempli manuellement depuis votre comptabilité. Les cadres C et D n'ont pas à s'équilibrer.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ═══ CADRE E - FORMATEURS ═══ */}
      <div className="card space-y-3">
        <SectionHeader id="E" icon={Users} title="E. PERSONNES DISPENSANT DES HEURES DE FORMATION" />
        {openSections.E && (
          <div className="p-3">
            <div className="overflow-x-auto"><table className="w-full text-ui">
              <thead>
                <tr className="border-b text-ui-sm text-gray-500">
                  <th className="text-left py-2">Type</th>
                  <th className="text-right py-2 w-32">Nombre</th>
                  <th className="text-right py-2 w-32">Heures dispensées</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="py-2">Personnes de votre organisme (internes)</td>
                  <td className="py-2"><input type="text" inputMode="numeric" className="input text-ui text-right w-28 ml-auto block" value={form.e_internes_nb} onChange={(e) => updateForm('e_internes_nb', parseInt(e.target.value) || 0)} /></td>
                  <td className="py-2"><input type="text" inputMode="decimal" className="input text-ui text-right w-28 ml-auto block" value={form.e_internes_heures} onChange={(e) => updateForm('e_internes_heures', parseFloat(e.target.value) || 0)} /></td>
                </tr>
                <tr>
                  <td className="py-2">Personnes extérieures (sous-traitance)</td>
                  <td className="py-2"><input type="text" inputMode="numeric" className="input text-ui text-right w-28 ml-auto block" value={form.e_externes_nb} onChange={(e) => updateForm('e_externes_nb', parseInt(e.target.value) || 0)} /></td>
                  <td className="py-2"><input type="text" inputMode="decimal" className="input text-ui text-right w-28 ml-auto block" value={form.e_externes_heures} onChange={(e) => updateForm('e_externes_heures', parseFloat(e.target.value) || 0)} /></td>
                </tr>
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      {/* ═══ CADRE F-1 - STAGIAIRES PAR TYPE ═══ */}
      <div className="card space-y-3">
        <SectionHeader id="F1" icon={GraduationCap} title="F-1. TYPE DE STAGIAIRES" color="purple" />
        {openSections.F1 && (
          <div className="p-3">
            <div className="overflow-x-auto"><table className="w-full text-ui">
              <thead>
                <tr className="border-b text-ui-sm text-gray-500">
                  <th className="text-left py-2">Type de stagiaire</th>
                  <th className="text-right py-2 w-28">Nombre</th>
                  <th className="text-right py-2 w-32">Heures formation</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[
                  { key: 'f1a_salaries', label: 'a. Salariés d\'employeurs privés' },
                  { key: 'f1b_apprentis', label: 'b. Apprentis' },
                  { key: 'f1c_demandeurs', label: 'c. Personnes en recherche d\'emploi' },
                  { key: 'f1d_particuliers', label: 'd. Particuliers à leurs propres frais' },
                  { key: 'f1e_autres', label: 'e. Autres stagiaires' },
                ].map(row => (
                  <tr key={row.key}>
                    <td className="py-2">{row.label}</td>
                    <td className="py-2"><input type="text" inputMode="numeric" className="input text-ui text-right w-24 ml-auto block" value={form[row.key + '_nb']} onChange={(e) => updateForm(row.key + '_nb', parseInt(e.target.value) || 0)} /></td>
                    <td className="py-2"><input type="text" inputMode="decimal" className="input text-ui text-right w-28 ml-auto block" value={form[row.key + '_heures']} onChange={(e) => updateForm(row.key + '_heures', parseFloat(e.target.value) || 0)} /></td>
                  </tr>
                ))}
                <tr className="bg-[rgb(var(--c-info-bg))] font-semibold">
                  <td className="py-2">TOTAL (1)</td>
                  <td className="py-2 text-right pr-2">{getF1Total('nb')}</td>
                  <td className="py-2 text-right pr-2">{getF1Total('heures').toFixed(1)}</td>
                </tr>
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      {/* ═══ CADRE F-2 - SOUS-TRAITANCE ═══ */}
      <div className="card space-y-3">
        <SectionHeader id="F2" icon={GraduationCap} title="F-2. ACTIVITÉ SOUS-TRAITÉE" color="purple" />
        {openSections.F2 && (
          <div className="p-3">
            <div className="flex items-center gap-4">
              <span className="text-ui flex-1">Stagiaires dont l'action a été confiée à un autre organisme (2)</span>
              <input type="text" inputMode="numeric" className="input text-ui text-right w-24" value={form.f2_nb} onChange={(e) => updateForm('f2_nb', parseInt(e.target.value) || 0)} />
              <input type="text" inputMode="decimal" className="input text-ui text-right w-28" value={form.f2_heures} onChange={(e) => updateForm('f2_heures', parseFloat(e.target.value) || 0)} />
            </div>
          </div>
        )}
      </div>

      {/* ═══ CADRE F-3 - OBJECTIFS ═══ */}
      <div className="card space-y-3">
        <SectionHeader id="F3" icon={ClipboardCheck} title="F-3. OBJECTIF GÉNÉRAL DES PRESTATIONS" color="purple" />
        {openSections.F3 && (
          <div className="p-3">
            <div className="overflow-x-auto"><table className="w-full text-ui">
              <thead>
                <tr className="border-b text-ui-sm text-gray-500">
                  <th className="text-left py-2">Objectif</th>
                  <th className="text-right py-2 w-28">Nombre</th>
                  <th className="text-right py-2 w-32">Heures</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[
                  { key: 'f3a_rncp', label: 'a. Diplôme/titre/CQP inscrit au RNCP' },
                  { key: 'f3b_rs', label: 'b. Certification/habilitation inscrite au RS' },
                  { key: 'f3c_cqp_hors', label: 'c. CQP non enregistré RNCP/RS' },
                  { key: 'f3d_autres', label: 'd. Autres formations professionnelles' },
                  { key: 'f3e_bilan', label: 'e. Bilans de compétences' },
                  { key: 'f3f_vae', label: 'f. Accompagnement VAE' },
                ].map(row => (
                  <tr key={row.key}>
                    <td className="py-2">{row.label}</td>
                    <td className="py-2"><input type="text" inputMode="numeric" className="input text-ui text-right w-24 ml-auto block" value={form[row.key + '_nb']} onChange={(e) => updateForm(row.key + '_nb', parseInt(e.target.value) || 0)} /></td>
                    <td className="py-2"><input type="text" inputMode="decimal" className="input text-ui text-right w-28 ml-auto block" value={form[row.key + '_heures']} onChange={(e) => updateForm(row.key + '_heures', parseFloat(e.target.value) || 0)} /></td>
                  </tr>
                ))}
                <tr className="bg-[rgb(var(--c-info-bg))] font-semibold">
                  <td className="py-2">TOTAL (3)</td>
                  <td className="py-2 text-right pr-2">{getF3Total('nb')}</td>
                  <td className="py-2 text-right pr-2">{getF3Total('heures').toFixed(1)}</td>
                </tr>
              </tbody>
            </table></div>
            <div className="bg-[rgb(var(--c-success-bg))] border border-[rgb(var(--c-success)/0.3)] rounded p-2 mt-2">
              <p className="text-ui-sm text-[rgb(var(--c-success))]">
                <Info className="w-3 h-3 inline mr-1" />
                Si aucune formation n'est inscrite au RS ou RNCP actuellement → tout en ligne d. Les totaux (1) et (3) doivent être égaux.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ═══ CADRE F-4 - SPÉCIALITÉS ═══ */}
      <div className="card space-y-3">
        <SectionHeader id="F4" icon={ClipboardCheck} title="F-4. SPÉCIALITÉS DE FORMATION (codes NSF)" color="purple" />
        {openSections.F4 && (
          <div className="p-3">
            <div className="overflow-x-auto"><table className="w-full text-ui">
              <thead>
                <tr className="border-b text-ui-sm text-gray-500">
                  <th className="text-left py-2 w-16">Code</th>
                  <th className="text-left py-2">Spécialité</th>
                  <th className="text-right py-2 w-28">Nombre</th>
                  <th className="text-right py-2 w-32">Heures</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {form.specialites.map((spec, i) => (
                  <tr key={i}>
                    <td className="py-2">
                      <input className="input text-ui w-14" value={spec.code} onChange={(e) => {
                        const s = [...form.specialites]
                        s[i] = { ...s[i], code: e.target.value }
                        updateForm('specialites', s)
                      }} />
                    </td>
                    <td className="py-2">
                      <input className="input text-ui w-full" value={spec.label} onChange={(e) => {
                        const s = [...form.specialites]
                        s[i] = { ...s[i], label: e.target.value }
                        updateForm('specialites', s)
                      }} />
                    </td>
                    <td className="py-2">
                      <input type="text" inputMode="numeric" className="input text-ui text-right w-24 ml-auto block" value={spec.nb} onChange={(e) => {
                        const s = [...form.specialites]
                        s[i] = { ...s[i], nb: parseInt(e.target.value) || 0 }
                        updateForm('specialites', s)
                      }} />
                    </td>
                    <td className="py-2">
                      <input type="text" inputMode="decimal" className="input text-ui text-right w-28 ml-auto block" value={spec.heures} onChange={(e) => {
                        const s = [...form.specialites]
                        s[i] = { ...s[i], heures: parseFloat(e.target.value) || 0 }
                        updateForm('specialites', s)
                      }} />
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2} className="py-2 text-ui">Autres spécialités</td>
                  <td className="py-2"><input type="text" inputMode="numeric" className="input text-ui text-right w-24 ml-auto block" value={form.specialites_autres_nb} onChange={(e) => updateForm('specialites_autres_nb', parseInt(e.target.value) || 0)} /></td>
                  <td className="py-2"><input type="text" inputMode="decimal" className="input text-ui text-right w-28 ml-auto block" value={form.specialites_autres_heures} onChange={(e) => updateForm('specialites_autres_heures', parseFloat(e.target.value) || 0)} /></td>
                </tr>
                <tr className="bg-[rgb(var(--c-info-bg))] font-semibold">
                  <td colSpan={2} className="py-2">TOTAL (4)</td>
                  <td className="py-2 text-right pr-2">{getF4Total('nb')}</td>
                  <td className="py-2 text-right pr-2">{getF4Total('heures').toFixed(1)}</td>
                </tr>
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      {/* ═══ CADRE G - SOUS-TRAITANCE REÇUE ═══ */}
      <div className="card space-y-3">
        <SectionHeader id="G" icon={GraduationCap} title="G. FORMATIONS CONFIÉES À VOTRE ORGANISME PAR UN AUTRE OF" />
        {openSections.G && (
          <div className="p-3">
            <div className="flex items-center gap-4">
              <span className="text-ui flex-1">Formations confiées par un autre OF (5)</span>
              <input type="text" inputMode="numeric" className="input text-ui text-right w-24" value={form.g_nb} onChange={(e) => updateForm('g_nb', parseInt(e.target.value) || 0)} />
              <input type="text" inputMode="decimal" className="input text-ui text-right w-28" value={form.g_heures} onChange={(e) => updateForm('g_heures', parseFloat(e.target.value) || 0)} />
            </div>
          </div>
        )}
      </div>

      {/* ═══ CADRE H - DIRIGEANT ═══ */}
      <div className="card space-y-3">
        <SectionHeader id="H" icon={Users} title="H. PERSONNE AYANT LA QUALITÉ DE DIRIGEANT" />
        {openSections.H && (
          <div className="grid grid-cols-2 gap-3 p-3">
            <div>
              <label className="text-ui-sm text-gray-500">Nom et prénom</label>
              <input className="input text-ui" value={form.h_dirigeant} onChange={(e) => updateForm('h_dirigeant', e.target.value)} />
            </div>
            <div>
              <label className="text-ui-sm text-gray-500">Qualité</label>
              <input className="input text-ui" value={form.h_qualite} onChange={(e) => updateForm('h_qualite', e.target.value)} />
            </div>
            <div>
              <label className="text-ui-sm text-gray-500">Email</label>
              <input className="input text-ui" value={form.h_email} onChange={(e) => updateForm('h_email', e.target.value)} />
            </div>
            <div>
              <label className="text-ui-sm text-gray-500">Téléphone</label>
              <input className="input text-ui" value={form.h_phone} onChange={(e) => updateForm('h_phone', e.target.value)} />
            </div>
            <div>
              <label className="text-ui-sm text-gray-500">Lieu de signature</label>
              <input className="input text-ui" value={form.h_lieu} onChange={(e) => updateForm('h_lieu', e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {/* ═══ NOTES ═══ */}
      <div className="card p-3">
        <label className="text-ui font-medium text-gray-700">Notes internes</label>
        <textarea
          className="input text-ui mt-1 w-full"
          rows={3}
          value={form.notes}
          onChange={(e) => updateForm('notes', e.target.value)}
          placeholder="Notes de travail, rappels..."
        />
      </div>

      {/* ═══ CONTRÔLE DE COHÉRENCE ═══ */}
      <div className="card p-4 space-y-2">
        <h3 className="font-semibold text-ui flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-[rgb(var(--c-info))]" />
          Contrôle de cohérence
        </h3>
        {[
          { label: 'Total F-1 = Total F-3 (nombre)', ok: getF1Total('nb') === getF3Total('nb'), v1: getF1Total('nb'), v2: getF3Total('nb') },
          { label: 'Total F-1 = Total F-4 (nombre)', ok: getF1Total('nb') === getF4Total('nb'), v1: getF1Total('nb'), v2: getF4Total('nb') },
          { label: 'Total F-1 heures = F-3 heures', ok: Math.abs(getF1Total('heures') - getF3Total('heures')) < 0.5, v1: getF1Total('heures').toFixed(1), v2: getF3Total('heures').toFixed(1) },
          { label: 'Total F-1 heures = F-4 heures', ok: Math.abs(getF1Total('heures') - getF4Total('heures')) < 0.5, v1: getF1Total('heures').toFixed(1), v2: getF4Total('heures').toFixed(1) },
        ].map((check, i) => (
          <div key={i} className={`flex items-center gap-2 text-ui p-2 rounded ${check.ok ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]'}`}>
            {check.ok ? <CheckCircle className="w-4 h-4 text-[rgb(var(--c-success))]" /> : <AlertCircle className="w-4 h-4 text-[rgb(var(--c-danger))]" />}
            <span>{check.label}</span>
            {!check.ok && <span className="text-ui-sm ml-auto">({check.v1} ≠ {check.v2})</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

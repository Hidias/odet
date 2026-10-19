// src/components/DuerpConformiteTab.jsx
// ══════════════════════════════════════════════════════════════
// Onglet Conformité du DUERP - Équipements, Habilitations, Obligations
// ══════════════════════════════════════════════════════════════

import { orgName, orgPhone } from '../../../core/org/currentOrg'
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../core/supabase'
import {
  Plus, Save, Trash2, X, Edit, AlertTriangle, CheckCircle, Clock,
  Shield, Users, Search, ChevronDown, ChevronUp, Phone, ExternalLink,
  Calendar, MapPin, Award, RefreshCw, Info, Loader2
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  EQUIPMENT_TYPES, EQUIPMENT_CATEGORIES, EQUIPMENT_STATUS,
  HABILITATION_TYPES, computeObligations, computeConformityScore,
  getEquipmentAutoStatus, getHabilitationStatus
} from '../lib/duerpConformiteData'

import { confirmer } from '../../../ui/Confirm'
const VERIFICATION_TYPES = [
  { id: 'exercice_evacuation', label: 'Exercice d\'évacuation', icon: '', periodicite: '6 mois' },
  { id: 'verification_extincteurs', label: 'Vérification extincteurs', icon: '', periodicite: '12 mois' },
  { id: 'controle_electrique', label: 'Contrôle installation électrique', icon: '', periodicite: '12 mois' },
  { id: 'test_alarme', label: 'Test alarme incendie', icon: '', periodicite: '6 mois' },
  { id: 'controle_dae', label: 'Vérification DAE', icon: '', periodicite: 'Selon fabricant' },
  { id: 'verification_baes', label: 'Test BAES / éclairage', icon: '', periodicite: '12 mois' },
  { id: 'autre', label: 'Autre vérification', icon: '', periodicite: '-' },
]

export default function DuerpConformiteTab({ projectId, project, risks, units }) {
  // ─── DATA ───
  const [equipements, setEquipements] = useState([])
  const [habilitations, setHabilitations] = useState([])
  const [verifications, setVerifications] = useState([])
  const [loading, setLoading] = useState(true)

  // ─── UI ───
  const [subTab, setSubTab] = useState('dashboard') // dashboard | equipements | personnel | verifications
  const [editEquip, setEditEquip] = useState(null)
  const [editHab, setEditHab] = useState(null)
  const [editVerif, setEditVerif] = useState(null)
  const [equipForm, setEquipForm] = useState({})
  const [habForm, setHabForm] = useState({})
  const [verifForm, setVerifForm] = useState({})
  const [searchEquip, setSearchEquip] = useState('')
  const [searchHab, setSearchHab] = useState('')

  // ─── LOAD ───
  useEffect(() => { loadData() }, [projectId])

  const loadData = async () => {
    setLoading(true)
    const [{ data: eq }, { data: hab }, { data: ver }] = await Promise.all([
      supabase.from('duerp_equipements').select('*').eq('project_id', projectId).order('created_at'),
      supabase.from('duerp_habilitations').select('*').eq('project_id', projectId).order('person_name'),
      supabase.from('duerp_verifications').select('*').eq('project_id', projectId).order('date_realisation', { ascending: false }),
    ])
    setEquipements(eq || [])
    setHabilitations(hab || [])
    setVerifications(ver || [])
    setLoading(false)
  }

  // ─── OBLIGATIONS AUTO ───
  const totalSurface = units.reduce((s, u) => s + (u.surface_m2 || 0), 0)
  const obligations = useMemo(() => computeObligations({
    risks, units, effectif: project?.effectif || 0, sector: project?.sector_template || '', surface: totalSurface
  }), [risks, units, project, totalSurface])

  // Auto-update statuses
  const equipementsWithStatus = useMemo(() =>
    equipements.map(eq => ({ ...eq, auto_status: getEquipmentAutoStatus(eq) })),
    [equipements]
  )

  const conformityScore = useMemo(() =>
    computeConformityScore(obligations, equipementsWithStatus, habilitations),
    [obligations, equipementsWithStatus, habilitations]
  )

  // ─── STATS ───
  const stats = useMemo(() => {
    const eqConf = equipementsWithStatus.filter(e => e.auto_status === 'conforme').length
    const eqWarn = equipementsWithStatus.filter(e => ['a_verifier', 'non_conforme'].includes(e.auto_status)).length
    const eqPerime = equipementsWithStatus.filter(e => e.auto_status === 'perime').length

    const habValide = habilitations.filter(h => getHabilitationStatus(h) === 'valide').length
    const habBientot = habilitations.filter(h => getHabilitationStatus(h) === 'bientot').length
    const habExpiree = habilitations.filter(h => getHabilitationStatus(h) === 'expiree').length

    return { eqConf, eqWarn, eqPerime, eqTotal: equipements.length, habValide, habBientot, habExpiree, habTotal: habilitations.length }
  }, [equipementsWithStatus, habilitations])

  // ═══════════════════════════════════════════════════════════
  // CRUD - ÉQUIPEMENTS
  // ═══════════════════════════════════════════════════════════
  const saveEquipement = async () => {
    if (!equipForm.type_id) return toast.error('Type d\'équipement requis')
    const type = EQUIPMENT_TYPES.find(t => t.id === equipForm.type_id)
    const payload = {
      project_id: projectId,
      type_id: equipForm.type_id,
      label: equipForm.label || type?.label || '',
      category: type?.category || 'incendie',
      unit_id: equipForm.unit_id || null,
      emplacement: equipForm.emplacement || '',
      marque: equipForm.marque || '',
      modele: equipForm.modele || '',
      numero_serie: equipForm.numero_serie || '',
      capacite: equipForm.capacite || '',
      install_date: equipForm.install_date || null,
      expiry_date: equipForm.expiry_date || null,
      last_check_date: equipForm.last_check_date || null,
      next_check_date: equipForm.next_check_date || null,
      last_check_by: equipForm.last_check_by || '',
      status: equipForm.status || 'conforme',
      notes: equipForm.notes || '',
      updated_at: new Date().toISOString(),
    }

    if (editEquip === 'new') {
      const qty = Math.max(1, parseInt(equipForm.quantite) || 1)
      if (qty > 1) {
        const inserts = Array.from({ length: qty }, () => ({ ...payload }))
        const { error } = await supabase.from('duerp_equipements').insert(inserts)
        if (error) return toast.error('Erreur: ' + error.message)
        toast.success(`${qty} équipements ajoutés`)
      } else {
        const { error } = await supabase.from('duerp_equipements').insert(payload)
        if (error) return toast.error('Erreur: ' + error.message)
        toast.success('Équipement ajouté')
      }
    } else {
      const { error } = await supabase.from('duerp_equipements').update(payload).eq('id', editEquip)
      if (error) return toast.error('Erreur: ' + error.message)
      toast.success('Équipement modifié')
    }
    setEditEquip(null)
    setEquipForm({})
    loadData()
  }

  const deleteEquipement = async (eqId) => {
    if (!await confirmer('Supprimer cet équipement ?')) return
    await supabase.from('duerp_equipements').delete().eq('id', eqId)
    toast.success('Supprimé')
    loadData()
  }

  // ═══════════════════════════════════════════════════════════
  // CRUD - HABILITATIONS
  // ═══════════════════════════════════════════════════════════
  const saveHabilitation = async () => {
    if (!habForm.person_name || !habForm.type_id) return toast.error('Nom et type requis')
    const type = HABILITATION_TYPES.find(t => t.id === habForm.type_id)

    // Auto-calculer expiry si obtained_date renseignée
    let expiryDate = habForm.expiry_date || null
    if (!expiryDate && habForm.obtained_date && type?.duree_validite) {
      const d = new Date(habForm.obtained_date)
      d.setMonth(d.getMonth() + type.duree_validite)
      expiryDate = d.toISOString().split('T')[0]
    }

    const payload = {
      project_id: projectId,
      person_name: habForm.person_name,
      person_function: habForm.person_function || '',
      type_id: habForm.type_id,
      label: habForm.label || type?.label || '',
      obtained_date: habForm.obtained_date || null,
      expiry_date: expiryDate,
      organisme: habForm.organisme || '',
      certificate_ref: habForm.certificate_ref || '',
      niveau: habForm.niveau || '',
      notes: habForm.notes || '',
      updated_at: new Date().toISOString(),
    }

    if (editHab === 'new') {
      const { error } = await supabase.from('duerp_habilitations').insert(payload)
      if (error) return toast.error('Erreur: ' + error.message)
      toast.success('Habilitation ajoutée')
    } else {
      const { error } = await supabase.from('duerp_habilitations').update(payload).eq('id', editHab)
      if (error) return toast.error('Erreur: ' + error.message)
      toast.success('Habilitation modifiée')
    }
    setEditHab(null)
    setHabForm({})
    loadData()
  }

  const deleteHabilitation = async (hId) => {
    if (!await confirmer('Supprimer cette habilitation ?')) return
    await supabase.from('duerp_habilitations').delete().eq('id', hId)
    toast.success('Supprimée')
    loadData()
  }

  // ═══════════════════════════════════════════════════════════
  // CRUD - VÉRIFICATIONS
  // ═══════════════════════════════════════════════════════════
  const saveVerification = async () => {
    if (!verifForm.type || !verifForm.date_realisation) return toast.error('Type et date requis')
    const vType = VERIFICATION_TYPES.find(v => v.id === verifForm.type)
    const payload = {
      project_id: projectId,
      type: verifForm.type,
      label: verifForm.label || vType?.label || '',
      date_realisation: verifForm.date_realisation,
      realise_par: verifForm.realise_par || '',
      organisme: verifForm.organisme || '',
      nb_participants: verifForm.nb_participants ? parseInt(verifForm.nb_participants) : null,
      observations: verifForm.observations || '',
      conforme: verifForm.conforme !== false,
      prochain_prevu: verifForm.prochain_prevu || null,
    }

    if (editVerif === 'new') {
      const { error } = await supabase.from('duerp_verifications').insert(payload)
      if (error) return toast.error('Erreur: ' + error.message)
      toast.success('Vérification enregistrée')
    } else {
      const { error } = await supabase.from('duerp_verifications').update(payload).eq('id', editVerif)
      if (error) return toast.error('Erreur: ' + error.message)
      toast.success('Vérification modifiée')
    }
    setEditVerif(null)
    setVerifForm({})
    loadData()
  }

  const deleteVerification = async (vId) => {
    if (!await confirmer('Supprimer ?')) return
    await supabase.from('duerp_verifications').delete().eq('id', vId)
    toast.success('Supprimée')
    loadData()
  }

  // ═══════════════════════════════════════════════════════════
  // RENDU
  // ═══════════════════════════════════════════════════════════

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-[rgb(var(--c-warning))]" /></div>

  const scoreColor = conformityScore >= 80 ? 'text-[rgb(var(--c-success))]' : conformityScore >= 50 ? 'text-[rgb(var(--c-warning))]' : 'text-[rgb(var(--c-danger))]'
  const scoreBg = conformityScore >= 80 ? 'from-green-50 to-emerald-50 border-[rgb(var(--c-success)/0.3)]' : conformityScore >= 50 ? 'from-amber-50 to-yellow-50 border-[rgb(var(--c-warning)/0.3)]' : 'from-red-50 to-orange-50 border-[rgb(var(--c-danger)/0.3)]'

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'
  const daysUntil = (d) => d ? Math.ceil((new Date(d) - new Date()) / (1000*60*60*24)) : null

  return (
    <div className="space-y-4">
      {/* ═══ SOUS-NAVIGATION ═══ */}
      <div className="flex gap-1 bg-gray-100 rounded-ui p-1">
        {[
          { id: 'dashboard', label: 'Tableau de bord', count: null },
          { id: 'equipements', label: 'Équipements', count: equipements.length },
          { id: 'personnel', label: 'Personnel', count: habilitations.length },
          { id: 'verifications', label: 'Vérifications', count: verifications.length },
        ].map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={`flex-1 py-2.5 px-3 rounded-ui-sm text-ui font-medium transition ${
              subTab === t.id ? 'bg-white shadow text-[rgb(var(--c-warning))]' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
            {t.count !== null && <span className={`ml-1 text-ui-sm px-1.5 py-0.5 rounded-full ${
              subTab === t.id ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-gray-200 text-gray-500'}`}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════ */}
      {/* DASHBOARD                                               */}
      {/* ════════════════════════════════════════════════════════ */}
      {subTab === 'dashboard' && (
        <div className="space-y-4">
          {/* Score + KPIs */}
          <div className={`bg-gradient-to-r ${scoreBg} rounded-ui-lg border p-6`}>
            <div className="flex flex-col sm:flex-row items-center gap-6">
              {/* Score circulaire */}
              <div className="relative w-32 h-32 flex-shrink-0">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="#e5e7eb" strokeWidth="8" />
                  <circle cx="50" cy="50" r="42" fill="none"
                    stroke={conformityScore >= 80 ? '#22c55e' : conformityScore >= 50 ? '#f59e0b' : '#ef4444'}
                    strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${conformityScore * 2.64} ${264 - conformityScore * 2.64}`} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-3xl font-bold ${scoreColor}`}>{conformityScore}%</span>
                  <span className="text-ui-sm text-gray-500 font-medium">CONFORMITÉ</span>
                </div>
              </div>

              {/* KPIs */}
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3 w-full">
                <div className="bg-white/70 rounded-ui p-3 text-center">
                  <div className="text-2xl font-bold text-[rgb(var(--c-success))]">{stats.eqConf}</div>
                  <div className="text-ui-sm text-gray-500">Équip. conformes</div>
                </div>
                <div className="bg-white/70 rounded-ui p-3 text-center">
                  <div className="text-2xl font-bold text-[rgb(var(--c-danger))]">{stats.eqPerime + stats.eqWarn}</div>
                  <div className="text-ui-sm text-gray-500">À vérifier / périmés</div>
                </div>
                <div className="bg-white/70 rounded-ui p-3 text-center">
                  <div className="text-2xl font-bold text-[rgb(var(--c-success))]">{stats.habValide}</div>
                  <div className="text-ui-sm text-gray-500">Habilitations valides</div>
                </div>
                <div className="bg-white/70 rounded-ui p-3 text-center">
                  <div className="text-2xl font-bold text-[rgb(var(--c-warning))]">{stats.habBientot + stats.habExpiree}</div>
                  <div className="text-ui-sm text-gray-500">À renouveler</div>
                </div>
              </div>
            </div>
          </div>

          {/* Alertes */}
          {obligations.alertes.length > 0 && (
            <div className="space-y-2">
              {obligations.alertes.map((a, i) => (
                <div key={i} className={`flex items-start gap-2 rounded-ui-sm p-3 text-ui ${
                  a.type === 'warning' ? 'bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-info-bg))] border border-[rgb(var(--c-info)/0.3)] text-[rgb(var(--c-info))]'
                }`}>
                  {a.type === 'warning' ? <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                  <span>{a.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Expirations imminentes */}
          {(() => {
            const urgents = [
              ...equipementsWithStatus.filter(e => ['perime', 'a_verifier'].includes(e.auto_status)).map(e => ({
                type: 'equip', icon: EQUIPMENT_TYPES.find(t => t.id === e.type_id)?.icon || '',
                label: e.label || EQUIPMENT_TYPES.find(t => t.id === e.type_id)?.label, sub: e.emplacement,
                date: e.expiry_date || e.next_check_date, status: e.auto_status
              })),
              ...habilitations.filter(h => ['expiree', 'bientot'].includes(getHabilitationStatus(h))).map(h => ({
                type: 'hab', icon: HABILITATION_TYPES.find(t => t.id === h.type_id)?.icon || '',
                label: h.person_name, sub: HABILITATION_TYPES.find(t => t.id === h.type_id)?.short || h.type_id,
                date: h.expiry_date, status: getHabilitationStatus(h) === 'expiree' ? 'perime' : 'a_verifier'
              }))
            ].sort((a, b) => new Date(a.date || '2099') - new Date(b.date || '2099'))

            if (urgents.length === 0) return null
            return (
              <div className="bg-[rgb(var(--c-danger-bg))] border border-[rgb(var(--c-danger)/0.3)] rounded-ui p-4">
                <h4 className="font-semibold text-ui text-[rgb(var(--c-danger))] mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Actions urgentes ({urgents.length})
                </h4>
                <div className="space-y-2">
                  {urgents.slice(0, 8).map((u, i) => {
                    const days = daysUntil(u.date)
                    return (
                      <div key={i} className="flex items-center gap-3 bg-white rounded-ui-sm p-2.5 text-ui">
                        <span className="text-lg">{u.icon}</span>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-gray-900">{u.label}</span>
                          {u.sub && <span className="text-gray-500 ml-1.5">- {u.sub}</span>}
                        </div>
                        <span className={`text-ui-sm font-medium px-2 py-1 rounded-full ${
                          u.status === 'perime' ? 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]' : 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]'
                        }`}>
                          {days !== null ? (days < 0 ? `Expiré ${Math.abs(days)}j` : `${days}j restants`) : 'À vérifier'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Obligations auto-détectées */}
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Équipements requis */}
            <div className="bg-white border rounded-ui p-4">
              <h4 className="font-semibold text-ui text-gray-800 mb-3 flex items-center gap-2">
                 Équipements requis ({obligations.equipements.length})
              </h4>
              <div className="space-y-2">
                {obligations.equipements.map((obl, i) => {
                  const type = EQUIPMENT_TYPES.find(t => t.id === obl.type_id)
                  const installed = equipementsWithStatus.filter(e => e.type_id === obl.type_id && e.auto_status === 'conforme').length
                  const total = equipementsWithStatus.filter(e => e.type_id === obl.type_id).length
                  const ok = installed >= (obl.quantite_requise || 1)
                  return (
                    <div key={i} className={`flex items-start gap-2 p-2.5 rounded-ui-sm text-ui-sm ${ok ? 'bg-[rgb(var(--c-success-bg))]' : 'bg-[rgb(var(--c-danger-bg))]'}`}>
                      <span className="text-base mt-0.5">{type?.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{type?.label}</span>
                          {ok ? <CheckCircle className="w-3.5 h-3.5 text-[rgb(var(--c-success))]" /> : <AlertTriangle className="w-3.5 h-3.5 text-[rgb(var(--c-danger))]" />}
                        </div>
                        <p className="text-gray-500 mt-0.5">{obl.raison}</p>
                        <p className="text-gray-400 mt-0.5">Installé(s) : {total} ({installed} conforme{installed > 1 ? 's' : ''}) / {obl.quantite_requise || '?'} requis</p>
                      </div>
                      {!ok && obl.quantite_requise > 0 && (
                        <button onClick={() => { setSubTab('equipements'); setEditEquip('new'); setEquipForm({ type_id: obl.type_id, label: type?.label }) }}
                          className="text-ui-sm btn btn-secondary flex-shrink-0">
                          + Ajouter
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Formations requises */}
            <div className="bg-white border rounded-ui p-4">
              <h4 className="font-semibold text-ui text-gray-800 mb-3 flex items-center gap-2">
                 Formations requises ({obligations.formations.length})
              </h4>
              <div className="space-y-2">
                {obligations.formations.map((obl, i) => {
                  const type = HABILITATION_TYPES.find(t => t.id === obl.type_id)
                  const valid = habilitations.filter(h => h.type_id === obl.type_id && getHabilitationStatus(h) === 'valide').length
                  const ok = obl.nb_personnes_requises ? valid >= obl.nb_personnes_requises : valid > 0
                  return (
                    <div key={i} className={`flex items-start gap-2 p-2.5 rounded-ui-sm text-ui-sm ${ok ? 'bg-[rgb(var(--c-success-bg))]' : 'bg-[rgb(var(--c-danger-bg))]'}`}>
                      <span className="text-base mt-0.5">{type?.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{type?.short || type?.label}</span>
                          {ok ? <CheckCircle className="w-3.5 h-3.5 text-[rgb(var(--c-success))]" /> : <AlertTriangle className="w-3.5 h-3.5 text-[rgb(var(--c-danger))]" />}
                        </div>
                        <p className="text-gray-500 mt-0.5">{obl.raison}</p>
                        <p className="text-gray-400 mt-0.5">
                          Personnes formées : {valid}{obl.nb_personnes_requises ? ` / ${obl.nb_personnes_requises} requis` : ''}
                          {type?.duree_validite ? ` • Validité : ${type.duree_validite} mois` : ''}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        {!ok && (
                          <button onClick={() => { setSubTab('personnel'); setEditHab('new'); setHabForm({ type_id: obl.type_id }) }}
                            className="text-ui-sm btn btn-secondary hover:bg-[rgb(var(--c-warning))]">
                            + Ajouter
                          </button>
                        )}
                        {type?.access_formation && (
                          <span className="text-ui-sm text-[rgb(var(--c-warning))] font-bold text-center">
                            {orgName()}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* Proposition de formation par l'organisme */}
              <div className="mt-4 bg-gray-50 border border-[rgb(var(--c-warning)/0.3)] rounded-ui p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[rgb(var(--c-warning))] rounded-full flex items-center justify-center text-white text-lg flex-shrink-0"></div>
                  <div className="flex-1">
                    <p className="font-bold text-ui text-[rgb(var(--c-warning))]">Besoin de former vos équipes ?</p>
                    <p className="text-ui-sm text-[rgb(var(--c-warning))]">{orgName()} : SST, incendie, habilitation électrique, conduite d'engins</p>
                  </div>
                  <a href={`tel:${orgPhone().replace(/\s/g, '')}`} className="flex items-center gap-1.5 btn btn-secondary text-ui-sm font-medium hover:bg-[rgb(var(--c-warning))]">
                    <Phone className="w-3.5 h-3.5" /> Nous contacter
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* ÉQUIPEMENTS                                             */}
      {/* ════════════════════════════════════════════════════════ */}
      {subTab === 'equipements' && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={searchEquip} onChange={e => setSearchEquip(e.target.value)} placeholder="Rechercher..."
                className="w-full pl-9 pr-3 py-2 border rounded-ui-sm text-ui" />
            </div>
            <button onClick={() => { setEditEquip('new'); setEquipForm({}) }}
              className="btn btn-secondary text-ui font-medium hover:bg-[rgb(var(--c-warning))] flex items-center gap-2">
              <Plus className="w-4 h-4" /> Ajouter un équipement
            </button>
          </div>

          {/* Catégories */}
          {Object.entries(EQUIPMENT_CATEGORIES).map(([catId, cat]) => {
            const catEquips = equipementsWithStatus.filter(e => e.category === catId &&
              (!searchEquip || (e.label || '').toLowerCase().includes(searchEquip.toLowerCase()) || (e.emplacement || '').toLowerCase().includes(searchEquip.toLowerCase()))
            )
            if (catEquips.length === 0 && searchEquip) return null
            return (
              <div key={catId}>
                <h4 className="font-semibold text-ui text-gray-700 mb-2 flex items-center gap-2">
                  {cat.icon} {cat.label} ({catEquips.length})
                </h4>
                {catEquips.length === 0 ? (
                  <p className="text-ui-sm text-gray-400 italic ml-6 mb-3">Aucun équipement enregistré</p>
                ) : (
                  <div className="space-y-2 mb-4">
                    {catEquips.map(eq => {
                      const type = EQUIPMENT_TYPES.find(t => t.id === eq.type_id)
                      const st = EQUIPMENT_STATUS[eq.auto_status] || EQUIPMENT_STATUS.conforme
                      const days = daysUntil(eq.expiry_date)
                      const nextDays = daysUntil(eq.next_check_date)
                      return (
                        <div key={eq.id} className={`bg-white border rounded-ui p-3 flex items-start gap-3 ring-1 ${st.ring} ring-opacity-30`}>
                          <span className="text-2xl mt-1">{type?.icon || ''}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-ui text-gray-900">{eq.label || type?.label}</span>
                              <span className={`text-ui-sm px-2 py-0.5 rounded-full font-medium ${st.color}`}>
                                {st.icon} {st.label}
                              </span>
                              {eq.status && eq.status !== eq.auto_status && (
                                <span className="text-ui-sm px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200" title="Statut saisi manuellement (écrasé par date)">
                                   saisi : {EQUIPMENT_STATUS[eq.status]?.label || eq.status}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-ui-sm text-gray-500">
                              {eq.emplacement && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{eq.emplacement}</span>}
                              {eq.marque && <span>{eq.marque}{eq.modele ? ' ' + eq.modele : ''}</span>}
                              {eq.numero_serie && <span className="text-gray-400">N° {eq.numero_serie}</span>}
                              {eq.capacite && <span>{eq.capacite}</span>}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-ui-sm">
                              {eq.install_date && <span className="text-gray-400">Installé : {formatDate(eq.install_date)}</span>}
                              {eq.expiry_date && (
                                <span className={days !== null && days < 30 ? 'text-[rgb(var(--c-danger))] font-medium' : 'text-gray-400'}>
                                  Péremption : {formatDate(eq.expiry_date)}{days !== null && days <= 90 ? ` (${days < 0 ? 'EXPIRÉ' : days + 'j'})` : ''}
                                </span>
                              )}
                              {eq.last_check_date && <span className="text-gray-400">Dernier ctrl : {formatDate(eq.last_check_date)}{eq.last_check_by ? ` par ${eq.last_check_by}` : ''}</span>}
                              {eq.next_check_date && (
                                <span className={nextDays !== null && nextDays < 0 ? 'text-[rgb(var(--c-danger))] font-medium' : nextDays !== null && nextDays < 30 ? 'text-[rgb(var(--c-warning))] font-medium' : 'text-gray-400'}>
                                  Prochain ctrl : {formatDate(eq.next_check_date)}{nextDays !== null && nextDays <= 30 ? ` (${nextDays < 0 ? 'EN RETARD' : nextDays + 'j'})` : ''}
                                </span>
                              )}
                            </div>
                            {eq.notes && <p className="text-ui-sm text-gray-400 italic mt-1">{eq.notes}</p>}
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => { setEditEquip(eq.id); setEquipForm(eq) }} className="p-1.5 hover:bg-gray-100 rounded-ui-sm"><Edit className="w-4 h-4 text-gray-400" /></button>
                            <button onClick={() => deleteEquipement(eq.id)} className="p-1.5 hover:bg-[rgb(var(--c-danger-bg))] rounded-ui-sm"><Trash2 className="w-4 h-4 text-[rgb(var(--c-danger))]" /></button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {/* ═══ MODALE AJOUT/EDIT ÉQUIPEMENT ═══ */}
          {editEquip && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) { setEditEquip(null) } }}>
              <div className="bg-white rounded-ui-lg shadow-md w-full max-w-xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50">
                  <h3 className="font-bold text-gray-900"> {editEquip === 'new' ? 'Ajouter' : 'Modifier'} un équipement</h3>
                  <button onClick={() => setEditEquip(null)} className="p-2 hover:bg-gray-100 rounded-ui-sm"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-5 space-y-4">
                  {/* Type */}
                  <div>
                    <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Type *</label>
                    <select value={equipForm.type_id || ''} onChange={e => {
                      const t = EQUIPMENT_TYPES.find(x => x.id === e.target.value)
                      setEquipForm(f => ({ ...f, type_id: e.target.value, label: t?.label || '', category: t?.category || 'incendie' }))
                    }} className="w-full border rounded-ui-sm px-3 py-2 text-ui">
                      <option value="">Sélectionner...</option>
                      {Object.entries(EQUIPMENT_CATEGORIES).map(([cId, c]) => (
                        <optgroup key={cId} label={`${c.icon} ${c.label}`}>
                          {EQUIPMENT_TYPES.filter(t => t.category === cId).map(t => (
                            <option key={t.id} value={t.id}>{t.icon} {t.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  {/* Label + emplacement + quantité */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Libellé personnalisé</label>
                      <input value={equipForm.label || ''} onChange={e => setEquipForm(f => ({ ...f, label: e.target.value }))}
                        placeholder="Ex: Extincteur hall accueil" className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Emplacement</label>
                      <input value={equipForm.emplacement || ''} onChange={e => setEquipForm(f => ({ ...f, emplacement: e.target.value }))}
                        placeholder="Ex: Hall d'entrée" className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                  </div>

                  {/* Quantité (nouveau seulement) */}
                  {editEquip === 'new' && (
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Quantité à créer</label>
                      <input type="number" min="1" max="50"
                        value={equipForm.quantite || 1}
                        onChange={e => setEquipForm(f => ({ ...f, quantite: Math.max(1, parseInt(e.target.value) || 1) }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                      {(equipForm.quantite || 1) > 1 && (
                        <p className="text-ui-sm text-[rgb(var(--c-warning))] mt-1"> {equipForm.quantite} équipements identiques seront créés</p>
                      )}
                    </div>
                  )}

                  {/* Unité de travail */}
                  <div>
                    <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Unité de travail</label>
                    <select value={equipForm.unit_id || ''} onChange={e => setEquipForm(f => ({ ...f, unit_id: e.target.value || null }))}
                      className="w-full border rounded-ui-sm px-3 py-2 text-ui">
                      <option value="">Aucune (général)</option>
                      {units.map(u => <option key={u.id} value={u.id}>{u.code} - {u.name}</option>)}
                    </select>
                  </div>

                  {/* Marque / Modèle / N° série / Capacité */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Marque</label>
                      <input value={equipForm.marque || ''} onChange={e => setEquipForm(f => ({ ...f, marque: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Modèle</label>
                      <input value={equipForm.modele || ''} onChange={e => setEquipForm(f => ({ ...f, modele: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">N° série</label>
                      <input value={equipForm.numero_serie || ''} onChange={e => setEquipForm(f => ({ ...f, numero_serie: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Capacité</label>
                      <input value={equipForm.capacite || ''} onChange={e => setEquipForm(f => ({ ...f, capacite: e.target.value }))}
                        placeholder="6L, 2kg..." className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Installation</label>
                      <input type="date" value={equipForm.install_date || ''} onChange={e => setEquipForm(f => ({ ...f, install_date: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Péremption</label>
                      <input type="date" value={equipForm.expiry_date || ''} onChange={e => setEquipForm(f => ({ ...f, expiry_date: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Dernier contrôle</label>
                      <input type="date" value={equipForm.last_check_date || ''} onChange={e => setEquipForm(f => ({ ...f, last_check_date: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Prochain contrôle</label>
                      <input type="date" value={equipForm.next_check_date || ''} onChange={e => setEquipForm(f => ({ ...f, next_check_date: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                  </div>

                  {/* Vérificateur + statut */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Organisme vérificateur</label>
                      <input value={equipForm.last_check_by || ''} onChange={e => setEquipForm(f => ({ ...f, last_check_by: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Statut</label>
                      <select value={equipForm.status || 'conforme'} onChange={e => setEquipForm(f => ({ ...f, status: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui">
                        {Object.entries(EQUIPMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Notes</label>
                    <textarea value={equipForm.notes || ''} onChange={e => setEquipForm(f => ({ ...f, notes: e.target.value }))}
                      rows={2} className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                  </div>

                  {/* Réglementation du type */}
                  {equipForm.type_id && (() => {
                    const type = EQUIPMENT_TYPES.find(t => t.id === equipForm.type_id)
                    if (!type) return null
                    return (
                      <div className="bg-[rgb(var(--c-info-bg))] border border-[rgb(var(--c-info)/0.3)] rounded-ui-sm p-3 text-ui-sm text-[rgb(var(--c-info))]">
                        <p className="font-medium"> {type.reglementation}</p>
                        <p className="text-[rgb(var(--c-info))] mt-1">{type.notes}</p>
                        {type.periodicite_check && <p className="text-[rgb(var(--c-info))]"> Contrôle tous les {type.periodicite_check} mois</p>}
                        {type.duree_vie_max && <p className="text-[rgb(var(--c-info))]"> Durée de vie max : {type.duree_vie_max} ans</p>}
                      </div>
                    )
                  })()}
                </div>

                <div className="flex gap-2 px-5 py-4 border-t bg-gray-50">
                  <button onClick={() => setEditEquip(null)} className="flex-1 px-4 py-2.5 border rounded-ui-sm text-ui hover:bg-gray-50">Annuler</button>
                  <button onClick={saveEquipement} className="flex-1 btn btn-secondary text-ui font-medium hover:bg-[rgb(var(--c-warning))] flex items-center justify-center gap-2">
                    <Save className="w-4 h-4" /> Enregistrer
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* PERSONNEL - HABILITATIONS                               */}
      {/* ════════════════════════════════════════════════════════ */}
      {subTab === 'personnel' && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={searchHab} onChange={e => setSearchHab(e.target.value)} placeholder="Rechercher une personne..."
                className="w-full pl-9 pr-3 py-2 border rounded-ui-sm text-ui" />
            </div>
            <button onClick={() => { setEditHab('new'); setHabForm({}) }}
              className="btn btn-secondary text-ui font-medium hover:bg-[rgb(var(--c-warning))] flex items-center gap-2">
              <Plus className="w-4 h-4" /> Ajouter une habilitation
            </button>
          </div>

          {/* Groupé par personne */}
          {(() => {
            const byPerson = {}
            const filtered = habilitations.filter(h =>
              !searchHab || (h.person_name || '').toLowerCase().includes(searchHab.toLowerCase()) ||
              (HABILITATION_TYPES.find(t => t.id === h.type_id)?.short || '').toLowerCase().includes(searchHab.toLowerCase())
            )
            filtered.forEach(h => {
              if (!byPerson[h.person_name]) byPerson[h.person_name] = { function: h.person_function, habs: [] }
              byPerson[h.person_name].habs.push(h)
            })

            if (Object.keys(byPerson).length === 0) {
              return <p className="text-center text-gray-400 py-8 text-ui">Aucune habilitation enregistrée</p>
            }

            return Object.entries(byPerson).sort(([a], [b]) => a.localeCompare(b)).map(([name, info]) => (
              <div key={name} className="bg-white border rounded-ui overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b">
                  <div className="w-8 h-8 bg-[rgb(var(--c-warning-bg))] rounded-full flex items-center justify-center text-[rgb(var(--c-warning))] font-bold text-ui">
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <span className="font-semibold text-ui text-gray-900">{name}</span>
                    {info.function && <span className="text-ui-sm text-gray-500 ml-2">- {info.function}</span>}
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    {info.habs.map(h => {
                      const status = getHabilitationStatus(h)
                      const type = HABILITATION_TYPES.find(t => t.id === h.type_id)
                      return (
                        <span key={h.id} className={`text-ui-sm px-2 py-0.5 rounded-full font-medium ${
                          status === 'valide' ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' :
                          status === 'bientot' ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]'
                        }`}>{type?.short || h.type_id}</span>
                      )
                    })}
                  </div>
                </div>
                <div className="divide-y">
                  {info.habs.map(h => {
                    const type = HABILITATION_TYPES.find(t => t.id === h.type_id)
                    const status = getHabilitationStatus(h)
                    const days = daysUntil(h.expiry_date)
                    return (
                      <div key={h.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                        <span className="text-lg">{type?.icon || ''}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-ui text-gray-900">{type?.label || h.type_id}</span>
                            {h.niveau && <span className="text-ui-sm bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))] px-1.5 py-0.5 rounded">{h.niveau}</span>}
                          </div>
                          <div className="flex flex-wrap gap-x-3 text-ui-sm text-gray-500 mt-0.5">
                            {h.obtained_date && <span>Obtenue : {formatDate(h.obtained_date)}</span>}
                            {h.expiry_date && (
                              <span className={status === 'expiree' ? 'text-[rgb(var(--c-danger))] font-medium' : status === 'bientot' ? 'text-[rgb(var(--c-warning))] font-medium' : ''}>
                                Expire : {formatDate(h.expiry_date)}
                                {days !== null && days <= 90 ? ` (${days < 0 ? 'EXPIRÉE' : days + 'j'})` : ''}
                              </span>
                            )}
                            {h.organisme && <span> {h.organisme}</span>}
                            {h.certificate_ref && <span>N° {h.certificate_ref}</span>}
                          </div>
                        </div>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          status === 'valide' ? 'bg-[rgb(var(--c-success))]' : status === 'bientot' ? 'bg-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger))]'
                        }`} />
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => { setEditHab(h.id); setHabForm(h) }} className="p-1.5 hover:bg-gray-100 rounded-ui-sm">
                            <Edit className="w-3.5 h-3.5 text-gray-400" />
                          </button>
                          <button onClick={() => deleteHabilitation(h.id)} className="p-1.5 hover:bg-[rgb(var(--c-danger-bg))] rounded-ui-sm">
                            <Trash2 className="w-3.5 h-3.5 text-[rgb(var(--c-danger))]" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          })()}

          {/* ═══ MODALE AJOUT/EDIT HABILITATION ═══ */}
          {editHab && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) { setEditHab(null) } }}>
              <div className="bg-white rounded-ui-lg shadow-md w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50">
                  <h3 className="font-bold text-gray-900"> {editHab === 'new' ? 'Ajouter' : 'Modifier'} une habilitation</h3>
                  <button onClick={() => setEditHab(null)} className="p-2 hover:bg-gray-100 rounded-ui-sm"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-5 space-y-4">
                  {/* Personne */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Nom complet *</label>
                      <input value={habForm.person_name || ''} onChange={e => setHabForm(f => ({ ...f, person_name: e.target.value }))}
                        placeholder="Jean DUPONT" className="w-full border rounded-ui-sm px-3 py-2 text-ui" list="existing-persons" />
                      <datalist id="existing-persons">
                        {[...new Set(habilitations.map(h => h.person_name))].map(n => <option key={n} value={n} />)}
                      </datalist>
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Fonction</label>
                      <input value={habForm.person_function || ''} onChange={e => setHabForm(f => ({ ...f, person_function: e.target.value }))}
                        placeholder="Chef d'atelier" className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                  </div>

                  {/* Type habilitation */}
                  <div>
                    <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Type d'habilitation *</label>
                    <select value={habForm.type_id || ''} onChange={e => setHabForm(f => ({ ...f, type_id: e.target.value }))}
                      className="w-full border rounded-ui-sm px-3 py-2 text-ui">
                      <option value="">Sélectionner...</option>
                      {HABILITATION_TYPES.map(t => (
                        <option key={t.id} value={t.id}>{t.icon} {t.label} ({t.duree_validite} mois)</option>
                      ))}
                    </select>
                  </div>

                  {/* Niveau */}
                  <div>
                    <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Niveau / Catégorie</label>
                    <input value={habForm.niveau || ''} onChange={e => setHabForm(f => ({ ...f, niveau: e.target.value }))}
                      placeholder="B0, B1V, BR, Cat 3..." className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Date d'obtention</label>
                      <input type="date" value={habForm.obtained_date || ''} onChange={e => setHabForm(f => ({ ...f, obtained_date: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Date d'expiration</label>
                      <input type="date" value={habForm.expiry_date || ''} onChange={e => setHabForm(f => ({ ...f, expiry_date: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                      {habForm.obtained_date && habForm.type_id && !habForm.expiry_date && (() => {
                        const type = HABILITATION_TYPES.find(t => t.id === habForm.type_id)
                        if (!type?.duree_validite) return null
                        const d = new Date(habForm.obtained_date); d.setMonth(d.getMonth() + type.duree_validite)
                        return <p className="text-ui-sm text-[rgb(var(--c-warning))] mt-1">Auto-calculée : {d.toLocaleDateString('fr-FR')} ({type.duree_validite} mois)</p>
                      })()}
                    </div>
                  </div>

                  {/* Organisme + N° certificat */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Organisme de formation</label>
                      <input value={habForm.organisme || ''} onChange={e => setHabForm(f => ({ ...f, organisme: e.target.value }))}
                        placeholder={orgName()} className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">N° certificat</label>
                      <input value={habForm.certificate_ref || ''} onChange={e => setHabForm(f => ({ ...f, certificate_ref: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Notes</label>
                    <textarea value={habForm.notes || ''} onChange={e => setHabForm(f => ({ ...f, notes: e.target.value }))}
                      rows={2} className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                  </div>

                  {/* Info réglementaire */}
                  {habForm.type_id && (() => {
                    const type = HABILITATION_TYPES.find(t => t.id === habForm.type_id)
                    if (!type) return null
                    return (
                      <div className="bg-[rgb(var(--c-info-bg))] border border-[rgb(var(--c-info)/0.3)] rounded-ui-sm p-3 text-ui-sm text-[rgb(var(--c-info))]">
                        <p className="font-medium"> {type.reglementation}</p>
                        <p className="text-[rgb(var(--c-info))] mt-1">{type.obligation}</p>
                        <p className="text-[rgb(var(--c-info))]"> Validité : {type.duree_validite} mois</p>
                        {type.access_formation && (
                          <p className="mt-2 text-[rgb(var(--c-warning))] font-bold">Formation disponible chez {orgName()}, réf. {type.access_ref}</p>
                        )}
                      </div>
                    )
                  })()}
                </div>

                <div className="flex gap-2 px-5 py-4 border-t bg-gray-50">
                  <button onClick={() => setEditHab(null)} className="flex-1 px-4 py-2.5 border rounded-ui-sm text-ui hover:bg-gray-50">Annuler</button>
                  <button onClick={saveHabilitation} className="flex-1 btn btn-secondary text-ui font-medium hover:bg-[rgb(var(--c-warning))] flex items-center justify-center gap-2">
                    <Save className="w-4 h-4" /> Enregistrer
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* VÉRIFICATIONS PÉRIODIQUES                                */}
      {/* ════════════════════════════════════════════════════════ */}
      {subTab === 'verifications' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => { setEditVerif('new'); setVerifForm({}) }}
              className="btn btn-secondary text-ui font-medium hover:bg-[rgb(var(--c-warning))] flex items-center gap-2">
              <Plus className="w-4 h-4" /> Enregistrer une vérification
            </button>
          </div>

          {/* Résumé des périodicités */}
          <div className="bg-[rgb(var(--c-info-bg))] border border-[rgb(var(--c-info)/0.3)] rounded-ui p-4">
            <h4 className="text-ui font-semibold text-[rgb(var(--c-info))] mb-2"> Périodicités réglementaires</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {VERIFICATION_TYPES.filter(v => v.id !== 'autre').map(v => {
                const last = verifications.find(ver => ver.type === v.id)
                return (
                  <div key={v.id} className="bg-white rounded-ui-sm p-2.5 text-ui-sm">
                    <div className="flex items-center gap-1.5">
                      <span>{v.icon}</span>
                      <span className="font-medium text-gray-900">{v.label}</span>
                    </div>
                    <div className="mt-1 text-gray-500">
                      <span> {v.periodicite}</span>
                      {last ? (
                        <span className="ml-2">• Dernier : {formatDate(last.date_realisation)}</span>
                      ) : (
                        <span className="ml-2 text-[rgb(var(--c-danger))] font-medium">• Aucun enregistré</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Historique */}
          {verifications.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-ui">Aucune vérification enregistrée</p>
          ) : (
            <div className="space-y-2">
              {verifications.map(v => {
                const vType = VERIFICATION_TYPES.find(t => t.id === v.type)
                return (
                  <div key={v.id} className={`bg-white border rounded-ui p-3 flex items-start gap-3 ${v.conforme ? '' : 'border-[rgb(var(--c-danger)/0.3)] bg-[rgb(var(--c-danger-bg))]'}`}>
                    <span className="text-xl">{vType?.icon || ''}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ui text-gray-900">{v.label || vType?.label}</span>
                        <span className={`text-ui-sm px-2 py-0.5 rounded-full font-medium ${v.conforme ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]'}`}>
                          {v.conforme ? ' Conforme' : ' Non conforme'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 text-ui-sm text-gray-500 mt-1">
                        <span> {formatDate(v.date_realisation)}</span>
                        {v.realise_par && <span> {v.realise_par}</span>}
                        {v.organisme && <span> {v.organisme}</span>}
                        {v.nb_participants && <span> {v.nb_participants} participants</span>}
                        {v.prochain_prevu && <span className="text-[rgb(var(--c-warning))]">Prochain : {formatDate(v.prochain_prevu)}</span>}
                      </div>
                      {v.observations && <p className="text-ui-sm text-gray-400 italic mt-1">{v.observations}</p>}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => { setEditVerif(v.id); setVerifForm(v) }} className="p-1.5 hover:bg-gray-100 rounded-ui-sm"><Edit className="w-3.5 h-3.5 text-gray-400" /></button>
                      <button onClick={() => deleteVerification(v.id)} className="p-1.5 hover:bg-[rgb(var(--c-danger-bg))] rounded-ui-sm"><Trash2 className="w-3.5 h-3.5 text-[rgb(var(--c-danger))]" /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ═══ MODALE AJOUT/EDIT VÉRIFICATION ═══ */}
          {editVerif && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) { setEditVerif(null) } }}>
              <div className="bg-white rounded-ui-lg shadow-md w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50">
                  <h3 className="font-bold text-gray-900"> {editVerif === 'new' ? 'Enregistrer' : 'Modifier'} une vérification</h3>
                  <button onClick={() => setEditVerif(null)} className="p-2 hover:bg-gray-100 rounded-ui-sm"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Type de vérification *</label>
                    <select value={verifForm.type || ''} onChange={e => {
                      const vt = VERIFICATION_TYPES.find(v => v.id === e.target.value)
                      setVerifForm(f => ({ ...f, type: e.target.value, label: vt?.label || '' }))
                    }} className="w-full border rounded-ui-sm px-3 py-2 text-ui">
                      <option value="">Sélectionner...</option>
                      {VERIFICATION_TYPES.map(v => <option key={v.id} value={v.id}>{v.icon} {v.label} ({v.periodicite})</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Date de réalisation *</label>
                      <input type="date" value={verifForm.date_realisation || ''} onChange={e => setVerifForm(f => ({ ...f, date_realisation: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Prochain prévu</label>
                      <input type="date" value={verifForm.prochain_prevu || ''} onChange={e => setVerifForm(f => ({ ...f, prochain_prevu: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Réalisé par</label>
                      <input value={verifForm.realise_par || ''} onChange={e => setVerifForm(f => ({ ...f, realise_par: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Organisme</label>
                      <input value={verifForm.organisme || ''} onChange={e => setVerifForm(f => ({ ...f, organisme: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Nb participants</label>
                      <input type="number" value={verifForm.nb_participants || ''} onChange={e => setVerifForm(f => ({ ...f, nb_participants: e.target.value }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                    </div>
                    <div>
                      <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Résultat</label>
                      <select value={verifForm.conforme !== false ? 'true' : 'false'} onChange={e => setVerifForm(f => ({ ...f, conforme: e.target.value === 'true' }))}
                        className="w-full border rounded-ui-sm px-3 py-2 text-ui">
                        <option value="true"> Conforme</option>
                        <option value="false"> Non conforme</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-ui-sm font-medium text-gray-600 mb-1 block">Observations</label>
                    <textarea value={verifForm.observations || ''} onChange={e => setVerifForm(f => ({ ...f, observations: e.target.value }))}
                      rows={3} className="w-full border rounded-ui-sm px-3 py-2 text-ui" />
                  </div>
                </div>
                <div className="flex gap-2 px-5 py-4 border-t bg-gray-50">
                  <button onClick={() => setEditVerif(null)} className="flex-1 px-4 py-2.5 border rounded-ui-sm text-ui hover:bg-gray-50">Annuler</button>
                  <button onClick={saveVerification} className="flex-1 btn btn-secondary text-ui font-medium hover:bg-[rgb(var(--c-warning))] flex items-center justify-center gap-2">
                    <Save className="w-4 h-4" /> Enregistrer
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

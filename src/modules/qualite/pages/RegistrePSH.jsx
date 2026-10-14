import { orgReferentHandicap, currentUserName, teamNames } from '../../../core/org/currentOrg'
import { useEffect, useState } from 'react'
import { useDataStore } from '../../../core/store'
import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'
import {
  Plus, Search, X, Save, Edit, Trash2, Calendar,
  Mail, Phone, FileInput, MessageSquare, User, Building2, Users,
  FileText, Loader2, AlertCircle
} from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import SearchSelect from '../../../ui/SearchSelect'

// ===== LABELS & ICÔNES =====
const sourceLabels = {
  stagiaire: { label: 'Stagiaire',  icon: User },
  employeur: { label: 'Employeur',  icon: Building2 },
  client:    { label: 'Client',     icon: Users },
  autre:     { label: 'Autre',      icon: FileText },
}

const canalLabels = {
  telephone: { label: 'Téléphone', icon: Phone },
  email:     { label: 'Email',     icon: Mail },
  formulaire:{ label: 'Formulaire',icon: FileInput },
  autre:     { label: 'Autre',     icon: MessageSquare },
}

const decisionLabels = {
  a_analyser: { label: 'À analyser',  class: 'bg-gray-100 text-gray-700' },
  adapte:     { label: 'Adaptée',     class: 'bg-green-100 text-green-700' },
  partiel:    { label: 'Partielle',   class: 'bg-blue-100 text-blue-700' },
  oriente:    { label: 'Orientée',    class: 'bg-purple-100 text-purple-700' },
  refuse:     { label: 'Refusée',     class: 'bg-red-100 text-red-700' },
}

const statusLabels = {
  open:            { label: 'Ouverte',       class: 'bg-red-100 text-red-700' },
  in_review:       { label: 'En analyse',    class: 'bg-yellow-100 text-yellow-700' },
  awaiting_info:   { label: 'Info manquante',class: 'bg-orange-100 text-orange-700' },
  decided:         { label: 'Décidée',       class: 'bg-blue-100 text-blue-700' },
  implemented:     { label: 'Mise en œuvre', class: 'bg-purple-100 text-purple-700' },
  closed:          { label: 'Clôturé',       class: 'bg-green-100 text-green-700' },
}

// ===== ÉTAT FORMULAIRE PAR DÉFAUT =====
const emptyForm = {
  session_id: '', client_id: '', trainee_id: '',
  source: 'stagiaire', canal: 'telephone',
  besoin_fonctionnel: '', impact_apprentissage: '', contraintes_securite: '',
  decision: 'a_analyser', justification_decision: '', responsable: orgReferentHandicap() || currentUserName(),
  actions_prevues: '', date_mise_en_oeuvre: '',
  status: 'open', is_test: false,
}

export default function RegistrePSH() {
  const { sessions } = useDataStore()

  const [requests, setRequests]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showForm, setShowForm]       = useState(false)
  const [editing, setEditing]         = useState(null)
  const [formData, setFormData]       = useState(emptyForm)
  const [saving, setSaving]           = useState(false)

  useEffect(() => { loadRequests() }, [])

  // ===== CHARGEMENT =====
  const loadRequests = async () => {
    setLoading(true)
    const { data, error } = await fetchAll(() => supabase
      .from('psh_requests')
      .select('*')
      .order('created_at', { ascending: false }))
    if (!error) setRequests(data || [])
    else console.error('PSH load error:', error)
    setLoading(false)
  }

  // ===== FILTRAGE =====
  const filtered = requests.filter(r => {
    const matchSearch =
      r.reference?.toLowerCase().includes(search.toLowerCase()) ||
      r.besoin_fonctionnel?.toLowerCase().includes(search.toLowerCase()) ||
      r.actions_prevues?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || r.status === statusFilter
    return matchSearch && matchStatus
  })

  // ===== STATS =====
  const stats = {
    total:      requests.length,
    open:       requests.filter(r => r.status === 'open' || r.status === 'in_review' || r.status === 'awaiting_info').length,
    decided:    requests.filter(r => r.status === 'decided' || r.status === 'implemented').length,
    closed:     requests.filter(r => r.status === 'closed').length,
    testCount:  requests.filter(r => r.is_test).length,
  }

  // ===== CRUD =====
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.besoin_fonctionnel.trim()) { toast.error('Besoin fonctionnel requis'); return }
    if ((formData.decision === 'refuse' || formData.decision === 'oriente') && !formData.justification_decision?.trim()) {
      toast.error('Justification obligatoire pour un refus ou une orientation'); return
    }

    setSaving(true)
    try {
      if (editing) {
        // Construire les mises à jour avec auto-dates selon statut
        const updates = { ...formData, updated_at: new Date().toISOString() }

        if (formData.status === 'decided' && !editing.date_decision) {
          updates.date_decision = new Date().toISOString()
        }
        if (formData.status === 'closed' && !editing.date_cloture) {
          updates.date_cloture = new Date().toISOString()
        }
        // Si on repasse à un statut avant "decided", on efface les dates auto
        if (formData.status !== 'decided' && formData.status !== 'implemented' && formData.status !== 'closed') {
          updates.date_decision = editing.date_decision || null
        }

        const { error } = await supabase.from('psh_requests').update(updates).eq('id', editing.id)
        if (error) throw error
        toast.success('Demande PSH mise à jour')
      } else {
        const insertData = {
          source: formData.source,
          canal: formData.canal,
          besoin_fonctionnel: formData.besoin_fonctionnel,
          impact_apprentissage: formData.impact_apprentissage || null,
          contraintes_securite: formData.contraintes_securite || null,
          decision: formData.decision,
          justification_decision: formData.justification_decision || null,
          responsable: formData.responsable,
          actions_prevues: formData.actions_prevues || null,
          date_mise_en_oeuvre: formData.date_mise_en_oeuvre || null,
          status: formData.status,
          is_test: formData.is_test,
          session_id: formData.session_id || null,
          client_id: formData.client_id || null,
          trainee_id: formData.trainee_id || null,
          date_reception: new Date().toISOString(),
        }
        const { error } = await supabase.from('psh_requests').insert(insertData)
        if (error) throw error
        toast.success('Demande PSH créée')
      }
      resetForm()
      loadRequests()
    } catch (err) {
      console.error(err)
      toast.error(err.message || 'Erreur')
    }
    setSaving(false)
  }

  const handleDelete = async (id) => {
    if (!confirm('Supprimer cette demande PSH ?')) return
    const { error } = await supabase.from('psh_requests').delete().eq('id', id)
    if (!error) { toast.success('Demande supprimée'); loadRequests() }
    else toast.error(error.message)
  }

  const resetForm = () => {
    setShowForm(false)
    setEditing(null)
    setFormData(emptyForm)
  }

  const openEdit = (req) => {
    setEditing(req)
    setFormData({
      ...emptyForm,
      ...req,
      date_mise_en_oeuvre: req.date_mise_en_oeuvre || '',
    })
    setShowForm(true)
  }

  // ===== RENDER =====
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-600" />
            Registre PSH
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Personnes en Situation de Handicap - Indicateur Qualiopi 26
          </p>
        </div>
      </div>

      {/* Bandeau RGPD */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm text-indigo-700 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          <strong>RGPD :</strong> On enregistre uniquement un <em>besoin fonctionnel</em> (ex : "supports agrandis", "temps majoré"). 
          Aucune donnée médicale ni diagnostic n'est stocké ici.
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          <p className="text-sm text-gray-500">Total</p>
          {stats.testCount > 0 && <p className="text-xs text-gray-400 mt-1">dont {stats.testCount} cas test</p>}
        </div>
        <div className="card p-4 text-center bg-red-50">
          <p className="text-2xl font-bold text-red-600">{stats.open}</p>
          <p className="text-sm text-red-600">En cours</p>
        </div>
        <div className="card p-4 text-center bg-blue-50">
          <p className="text-2xl font-bold text-blue-600">{stats.decided}</p>
          <p className="text-sm text-blue-600">Décidées</p>
        </div>
        <div className="card p-4 text-center bg-green-50">
          <p className="text-2xl font-bold text-green-600">{stats.closed}</p>
          <p className="text-sm text-green-600">Clôturées</p>
        </div>
      </div>

      {/* Filtres */}
      <div className="card p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Rechercher (réf, besoin, actions…)…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-10 w-full"
            />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input">
            <option value="">Tous statuts</option>
            {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <button
            onClick={() => { setShowForm(true); setEditing(null); setFormData(emptyForm) }}
            className="btn btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Nouvelle demande PSH
          </button>
        </div>
      </div>

      {/* Liste */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" /> Chargement…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Users className="w-12 h-12 mx-auto text-gray-300 mb-2" />
            <p>Aucune demande PSH enregistrée</p>
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map(req => {
              const source   = sourceLabels[req.source]   || sourceLabels.autre
              const canal    = canalLabels[req.canal]     || canalLabels.autre
              const decision = decisionLabels[req.decision] || decisionLabels.a_analyser
              const status   = statusLabels[req.status]   || statusLabels.open
              const SourceIcon = source.icon
              const CanalIcon  = canal.icon
              const session  = sessions.find(s => s.id === req.session_id)

              return (
                <div key={req.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      {/* Ligne 1 : réf + badges */}
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-xs font-mono bg-gray-200 px-1.5 py-0.5 rounded">
                          {req.reference}
                        </span>
                        {req.is_test && (
                          <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-medium">
                            CAS TEST
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded ${status.class}`}>{status.label}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${decision.class}`}>{decision.label}</span>
                      </div>

                      {/* Ligne 2 : besoin fonctionnel */}
                      <p className="text-sm font-medium text-gray-800 mb-1">
                        {req.besoin_fonctionnel}
                      </p>

                      {/* Ligne 3 : actions prévues (si elles existent) */}
                      {req.actions_prevues && (
                        <p className="text-xs text-gray-500 mb-1 italic">
                          Actions : {req.actions_prevues.replace(/\n/g, ' • ').substring(0, 120)}
                          {req.actions_prevues.length > 120 && '…'}
                        </p>
                      )}

                      {/* Ligne 4 : métadonnées */}
                      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                        <span><SourceIcon className="w-3 h-3 inline mr-1" />{source.label}</span>
                        <span><CanalIcon  className="w-3 h-3 inline mr-1" />{canal.label}</span>
                        <span>
                          <Calendar className="w-3 h-3 inline mr-1" />
                          {format(new Date(req.date_reception), 'dd/MM/yyyy', { locale: fr })}
                        </span>
                        {session && <span>Session : {session.reference}</span>}
                        {req.responsable && <span>Réf. : {req.responsable}</span>}
                      </div>

                      {/* Ligne 5 : timeline décision / clôture */}
                      <div className="flex items-center gap-3 mt-1.5 text-xs">
                        <span className={req.date_decision ? 'text-green-600' : 'text-gray-400'}>
                          Décision : {req.date_decision ? format(new Date(req.date_decision), 'dd/MM/yyyy') : '-'}
                        </span>
                        <span className={req.date_cloture ? 'text-green-600' : 'text-gray-400'}>
                          Clôture : {req.date_cloture ? format(new Date(req.date_cloture), 'dd/MM/yyyy') : '-'}
                        </span>
                      </div>
                    </div>

                    {/* Boutons actions */}
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => openEdit(req)} className="btn btn-sm btn-secondary">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(req.id)} className="btn btn-sm btn-secondary text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ===== MODAL FORMULAIRE ===== */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header modal */}
            <div className="p-4 border-b flex items-center justify-between bg-gray-50">
              <div>
                <h2 className="font-bold text-lg">
                  {editing ? 'Modifier la demande PSH' : 'Nouvelle demande PSH'}
                </h2>
                {editing && (
                  <p className="text-sm text-gray-500">{editing.reference}</p>
                )}
              </div>
              <button onClick={resetForm} className="p-2 hover:bg-gray-200 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Corps du formulaire */}
            <form onSubmit={handleSubmit} className="p-4 overflow-y-auto flex-1 space-y-4">

              {/* Cas test (checkbox) */}
              <div className="flex items-center gap-2 p-2 bg-yellow-50 rounded-lg">
                <input
                  type="checkbox"
                  id="is_test"
                  checked={formData.is_test}
                  onChange={e => setFormData({ ...formData, is_test: e.target.checked })}
                  className="w-4 h-4 accent-yellow-600"
                />
                <label htmlFor="is_test" className="text-sm text-yellow-800">
                  Cas test (ne pollue pas les stats réelles)
                </label>
              </div>

              {/* Contexte : source + canal */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Source *</label>
                  <select value={formData.source} onChange={e => setFormData({ ...formData, source: e.target.value })} className="input w-full">
                    {Object.entries(sourceLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Canal *</label>
                  <select value={formData.canal} onChange={e => setFormData({ ...formData, canal: e.target.value })} className="input w-full">
                    {Object.entries(canalLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Session liée */}
              <div>
                <label className="block text-sm font-medium mb-1">Session liée</label>
                <SearchSelect value={formData.session_id} onChange={v => setFormData({ ...formData, session_id: v })}
                  options={sessions.map(s => ({ value: s.id, label: s.reference, hint: s.courses?.title || '' }))}
                  emptyLabel="Aucune" searchPlaceholder="Référence ou formation..." aria-label="Session" />
              </div>

              {/* Besoin fonctionnel */}
              <div>
                <label className="block text-sm font-medium mb-1">Besoin fonctionnel *</label>
                <input
                  type="text"
                  value={formData.besoin_fonctionnel}
                  onChange={e => setFormData({ ...formData, besoin_fonctionnel: e.target.value })}
                  className="input w-full"
                  placeholder="ex : supports agrandis, temps majoré…"
                  required
                />
                <p className="text-xs text-gray-400 mt-1">
                  Décrivez le besoin fonctionnel uniquement - pas de données médicales.
                </p>
              </div>

              {/* Impact + contraintes (optionnels) */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Impact apprentissage</label>
                  <textarea
                    value={formData.impact_apprentissage}
                    onChange={e => setFormData({ ...formData, impact_apprentissage: e.target.value })}
                    className="input w-full h-16"
                    placeholder="Comment ça affecte l'apprentissage ?"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Contraintes sécurité</label>
                  <textarea
                    value={formData.contraintes_securite}
                    onChange={e => setFormData({ ...formData, contraintes_securite: e.target.value })}
                    className="input w-full h-16"
                    placeholder="Contraintes liées à la sécurité…"
                  />
                </div>
              </div>

              {/* Décision */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Décision</label>
                  <select value={formData.decision} onChange={e => setFormData({ ...formData, decision: e.target.value })} className="input w-full">
                    {Object.entries(decisionLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Responsable</label>
                  <select value={formData.responsable} onChange={e => setFormData({ ...formData, responsable: e.target.value })} className="input w-full">
                    {[...new Set([orgReferentHandicap(), ...teamNames()].filter(Boolean))].map((n) => (
                      <option key={n} value={n}>{n}{n === orgReferentHandicap() ? ', référent handicap' : ''}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Justification (obligatoire si refuse ou oriente) */}
              {(formData.decision === 'refuse' || formData.decision === 'oriente') && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Justification de la décision <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={formData.justification_decision}
                    onChange={e => setFormData({ ...formData, justification_decision: e.target.value })}
                    className="input w-full h-16 border-orange-300 focus:ring-orange-400"
                    placeholder="Obligatoire pour un refus ou une orientation…"
                  />
                </div>
              )}

              {/* Actions prévues */}
              <div>
                <label className="block text-sm font-medium mb-1">Actions prévues</label>
                <textarea
                  value={formData.actions_prevues}
                  onChange={e => setFormData({ ...formData, actions_prevues: e.target.value })}
                  className="input w-full h-20"
                  placeholder={"Quoi / Qui / Quand\nEx : support PDF en grands caractères, par le formateur, avant J"}
                />
              </div>

              {/* Date mise en œuvre */}
              <div>
                <label className="block text-sm font-medium mb-1">Date mise en œuvre prévue</label>
                <input
                  type="date"
                  value={formData.date_mise_en_oeuvre}
                  onChange={e => setFormData({ ...formData, date_mise_en_oeuvre: e.target.value })}
                  className="input w-full"
                />
              </div>

              {/* Statut */}
              <div>
                <label className="block text-sm font-medium mb-1">Statut</label>
                <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })} className="input w-full">
                  {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  "Décidée" → date_decision auto • "Clôturé" → date_cloture auto
                </p>
              </div>

              {/* Boutons */}
              <div className="flex justify-end gap-2 pt-4 border-t">
                <button type="button" onClick={resetForm} className="btn btn-secondary">Annuler</button>
                <button type="submit" disabled={saving} className="btn btn-primary flex items-center gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

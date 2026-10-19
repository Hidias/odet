import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Building2, Plus, Search, Loader2, Save, ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { supabase } from '../../supabase'
import { callApi } from '../../api'
import { useAuthStore } from '../../store'
import { Sheet } from '../../../ui/Sheet'
import { Field, Toggle } from '../shared'
import Etablissements from '../Etablissements'

// Paramètres › Sociétés (chantier C3) : sociétés de l'instance, fiche (identité, banque, numérotation), modules et
// accès des personnes par société ; assistant « Ajouter une société » (plateforme) en quatre étapes, préremplissage
// par l'annuaire officiel. La société qui porte l'instance garde son identité dans Paramètres › Identité (recopiée).

const ROLES_SOCIETE = [
  ['admin', 'Administrateur'], ['direction', 'Direction'], ['gestionnaire', 'Gestionnaire'], ['formateur', 'Formateur'],
  ['commercial', 'Commercial'], ['comptable', 'Comptable'], ['lecture', 'Lecture seule'],
]
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const CHAMPS = [
  ['legal_name', 'Raison sociale'], ['short_name', 'Nom court'], ['legal_form', 'Forme juridique'], ['capital', 'Capital social'],
  ['siren', 'SIREN'], ['vat_number', 'N° TVA intracommunautaire'], ['rcs', 'RCS et greffe'], ['naf', 'Code NAF'], ['idcc', 'Convention collective (IDCC)'],
  ['nda', 'N° de déclaration d\'activité (organisme de formation)'], ['address', 'Adresse du siège'], ['postal_code', 'Code postal'], ['city', 'Ville'],
  ['phone', 'Téléphone'], ['email', 'Email'], ['website', 'Site'], ['bank_name', 'Banque'], ['iban', 'IBAN'], ['bic', 'BIC'],
  ['logo_url', 'Logo des documents (adresse de l\'image)'], ['doc_prefix', 'Initiales des documents'],
]

function Assistant({ modules, personnes, onClose, onCree }) {
  const [etape, setEtape] = useState(1)
  const [f, setF] = useState({ legal_name: '', siret: '', siren: '', address: '', postal_code: '', city: '', naf: '', vat_number: '', legal_form: '', capital: '', rcs: '',
    bank_name: '', iban: '', bic: '', doc_prefix: '', invoice_prefix: 'FACT', credit_prefix: 'AVR', fiscal_year_start_month: 1, logo_url: '', is_training_org: false })
  const [mods, setMods] = useState([])
  const [acces, setAcces] = useState({})
  const [cherche, setCherche] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))

  const prerempir = async () => {
    const id = (f.siret || f.siren || '').replace(/\s/g, '')
    if (!/^\d{9}(\d{5})?$/.test(id)) return toast.error('SIREN (9 chiffres) ou SIRET (14 chiffres)')
    setCherche(true)
    try {
      const r = await callApi(`/api/annuaire?id=${id}`, {}, { method: 'GET' })
      if (r.indisponible) toast.error(`Annuaire indisponible : ${r.message}`)
      else if (!r.trouve) toast.error('Inconnu de l\'annuaire')
      else {
        setF((x) => ({ ...x, legal_name: r.legal_name || x.legal_name, siren: r.siren || x.siren, siret: r.siret || x.siret,
          address: r.address || x.address, postal_code: r.postal_code || x.postal_code, city: r.city || x.city,
          naf: r.naf || x.naf, vat_number: r.vat_number || x.vat_number }))
        toast.success('Prérempli : vérifiez avant de continuer')
      }
    } catch (e) { toast.error(e.message) } finally { setCherche(false) }
  }

  const creer = async () => {
    setEnCours(true)
    const members = Object.entries(acces).filter(([, a]) => a.role).map(([profile_id, a]) => ({ profile_id, role: a.role, can_consolidate: !!a.groupe }))
    const { data, error } = await supabase.rpc('company_create', { p: { ...f, modules: mods, members } })
    setEnCours(false)
    if (error) return toast.error(error.message)
    toast.success('Société créée')
    onCree(data)
  }

  const peutSuivre = etape !== 1 || f.legal_name.trim().length > 1
  return (
    <Sheet title={`Ajouter une société (étape ${etape} sur 4)`} size="lg" onClose={() => !enCours && onClose()}
      footer={<>
        {etape > 1 ? <button type="button" className="btn btn-secondary" disabled={enCours} onClick={() => setEtape(etape - 1)}><ChevronLeft className="w-4 h-4" />Précédent</button>
          : <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>}
        {etape < 4 ? <button type="button" className="btn btn-primary" disabled={!peutSuivre} onClick={() => setEtape(etape + 1)}>Suivant<ChevronRight className="w-4 h-4" /></button>
          : <button type="button" className="btn btn-primary" disabled={enCours} onClick={creer}>{enCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Créer la société</button>}
      </>}>
      {etape === 1 && (
        <div className="grid gap-4">
          <p className="text-gray-700">Identité de la société : saisissez son SIREN ou son SIRET pour préremplir depuis l'annuaire officiel, puis vérifiez.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="SIRET du siège ou SIREN"><input className="input" value={f.siret} onChange={(e) => set('siret', e.target.value)} /></Field>
            <button type="button" className="btn btn-secondary" disabled={cherche} onClick={prerempir}>{cherche ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Préremplir</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Raison sociale"><input className="input" value={f.legal_name} onChange={(e) => set('legal_name', e.target.value)} /></Field>
            <Field label="SIREN"><input className="input" value={f.siren} onChange={(e) => set('siren', e.target.value)} /></Field>
            <Field label="Forme juridique"><input className="input" value={f.legal_form} onChange={(e) => set('legal_form', e.target.value)} /></Field>
            <Field label="Capital social"><input className="input" value={f.capital} onChange={(e) => set('capital', e.target.value)} /></Field>
            <Field label="Adresse du siège"><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
            <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
              <Field label="Code postal"><input className="input" value={f.postal_code} onChange={(e) => set('postal_code', e.target.value)} /></Field>
              <Field label="Ville"><input className="input" value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
            </div>
            <Field label="Code NAF"><input className="input" value={f.naf} onChange={(e) => set('naf', e.target.value)} /></Field>
            <Field label="N° TVA intracommunautaire"><input className="input" value={f.vat_number} onChange={(e) => set('vat_number', e.target.value)} /></Field>
            <Field label="RCS et greffe"><input className="input" value={f.rcs} onChange={(e) => set('rcs', e.target.value)} /></Field>
            <Toggle checked={!!f.is_training_org} onChange={(v) => set('is_training_org', v)} label="Organisme de formation" />
          </div>
        </div>
      )}
      {etape === 2 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Banque"><input className="input" value={f.bank_name} onChange={(e) => set('bank_name', e.target.value)} /></Field>
          <Field label="BIC"><input className="input" value={f.bic} onChange={(e) => set('bic', e.target.value.toUpperCase())} /></Field>
          <Field label="IBAN" className="md:col-span-2"><input className="input" value={f.iban} onChange={(e) => set('iban', e.target.value)} /></Field>
          <Field label="Initiales des documents" hint="Exemple : GLDR"><input className="input" value={f.doc_prefix} onChange={(e) => set('doc_prefix', e.target.value.toUpperCase())} /></Field>
          <Field label="Début de l'exercice comptable">
            <select className="select" value={f.fiscal_year_start_month} onChange={(e) => set('fiscal_year_start_month', Number(e.target.value))}>
              {MOIS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field>
          <Field label="Préfixe des factures"><input className="input" value={f.invoice_prefix} onChange={(e) => set('invoice_prefix', e.target.value.toUpperCase())} /></Field>
          <Field label="Préfixe des avoirs"><input className="input" value={f.credit_prefix} onChange={(e) => set('credit_prefix', e.target.value.toUpperCase())} /></Field>
          <Field label="Logo des documents (adresse de l'image)" className="md:col-span-2"><input className="input" value={f.logo_url} onChange={(e) => set('logo_url', e.target.value)} /></Field>
        </div>
      )}
      {etape === 3 && (
        <div className="grid gap-2">
          <p className="text-gray-700">Modules actifs pour cette société (parmi ceux installés).</p>
          {modules.map((m) => (
            <label key={m.key} className="flex items-center gap-2">
              <input type="checkbox" checked={mods.includes(m.key)} onChange={(e) => setMods((x) => e.target.checked ? [...x, m.key] : x.filter((k) => k !== m.key))} />
              <span>{m.label || m.key}</span>
            </label>
          ))}
        </div>
      )}
      {etape === 4 && (
        <div className="grid gap-2">
          <p className="text-gray-700">Personnes qui ont accès à cette société, et leur rôle. Vous pourrez en ajouter ensuite.</p>
          <ul className="divide-y hairline">
            {personnes.map((p) => {
              const a = acces[p.id] || {}
              return (
                <li key={p.id} className="py-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-center">
                  <div className="min-w-0"><div className="font-medium truncate">{p.display_name || p.email}</div><div className="text-ui-sm text-gray-500 truncate">{p.email}</div></div>
                  <select className="select" value={a.role || ''} aria-label={`Rôle de ${p.display_name || p.email}`} onChange={(e) => setAcces((x) => ({ ...x, [p.id]: { ...a, role: e.target.value } }))}>
                    <option value="">Pas d'accès</option>
                    {ROLES_SOCIETE.map(([r, l]) => <option key={r} value={r}>{l}</option>)}
                  </select>
                  <label className="flex items-center gap-2 text-ui-sm"><input type="checkbox" disabled={!a.role} checked={!!a.groupe} onChange={(e) => setAcces((x) => ({ ...x, [p.id]: { ...a, groupe: e.target.checked } }))} />Vue groupe</label>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Sheet>
  )
}

function FicheSociete({ societe, modules, personnes, membres, onChange }) {
  const [f, setF] = useState(societe)
  const [enCours, setEnCours] = useState(false)
  useEffect(() => { setF(societe) }, [societe])
  const instance = societe.is_instance_owner
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))

  const enregistrer = async () => {
    setEnCours(true)
    const patch = Object.fromEntries(CHAMPS.map(([k]) => [k, (f[k] ?? '') === '' ? null : f[k]]))
    patch.legal_name = (f.legal_name || '').trim() || societe.legal_name
    patch.vat_applicable = !!f.vat_applicable
    patch.is_training_org = !!f.is_training_org
    patch.fiscal_year_start_month = Number(f.fiscal_year_start_month) || 1
    patch.status = f.status
    const { error } = await supabase.from('companies').update(patch).eq('id', societe.id)
    setEnCours(false)
    if (error) return toast.error(error.message)
    toast.success('Société enregistrée'); onChange()
  }
  const module = async (key, enabled) => {
    const { error } = await supabase.rpc('company_module_set', { p_company: societe.id, p_key: key, p_enabled: enabled })
    if (error) return toast.error(error.message)
    onChange()
  }
  const accesPersonne = async (p, role, groupe, actif) => {
    const { error } = await supabase.rpc('company_member_set', { p_company: societe.id, p_profile: p.id, p_role: role, p_can_consolidate: !!groupe, p_active: actif })
    if (error) return toast.error(error.message)
    toast.success('Accès mis à jour'); onChange()
  }

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="section-title">{societe.legal_name}</h2>
        {instance && <p className="muted">Société qui porte l'instance : son identité se saisit dans Paramètres › Identité et Banque (recopiée ici), ses modules dans la Console.</p>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CHAMPS.map(([k, l]) => (
          <Field key={k} label={l}><input className="input" value={f[k] || ''} disabled={instance} onChange={(e) => set(k, e.target.value)} /></Field>
        ))}
        <Field label="Début de l'exercice comptable">
          <select className="select" value={f.fiscal_year_start_month || 1} disabled={instance} onChange={(e) => set('fiscal_year_start_month', e.target.value)}>
            {MOIS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </Field>
        <Field label="Statut">
          <select className="select" value={f.status || 'active'} disabled={instance} onChange={(e) => set('status', e.target.value)}>
            <option value="active">Active</option><option value="archived">Archivée (lecture seule)</option>
          </select>
        </Field>
        <Toggle checked={!!f.vat_applicable} onChange={(v) => set('vat_applicable', v)} label="Assujettie à la TVA" disabled={instance} />
        <Toggle checked={!!f.is_training_org} onChange={(v) => set('is_training_org', v)} label="Organisme de formation" disabled={instance} />
      </div>
      {!instance && <div><button type="button" className="btn btn-primary" disabled={enCours} onClick={enregistrer}><Save className="w-4 h-4" />Enregistrer la société</button></div>}

      <div className="grid gap-2">
        <h3 className="font-semibold">Établissements</h3>
        <p className="muted">L'adresse principale est mise en avant sur les documents et les signatures de cette société ; le siège reste l'adresse légale.{instance ? ' Pour la société qui porte l\'instance, ils se gèrent aussi dans Paramètres › Coordonnées.' : ''}</p>
        <Etablissements companyId={societe.id} />
      </div>

      {!instance && (
        <>
          <h3 className="font-semibold">Modules de la société</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {modules.map((m) => {
              const actif = (societe.modules || []).some((x) => x.key === m.key && x.enabled)
              return <Toggle key={m.key} checked={actif} onChange={(v) => module(m.key, v)} label={m.label || m.key} />
            })}
          </div>
        </>
      )}

      <h3 className="font-semibold">Personnes qui ont accès</h3>
      <ul className="divide-y hairline">
        {personnes.map((p) => {
          const m = membres.find((x) => x.profile_id === p.id && x.company_id === societe.id)
          const role = m?.is_active ? m.role : ''
          return (
            <li key={p.id} className="py-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-center">
              <div className="min-w-0"><div className="font-medium truncate">{p.display_name || p.email}</div><div className="text-ui-sm text-gray-500 truncate">{p.email}</div></div>
              <select className="select" value={role} aria-label={`Rôle de ${p.display_name || p.email} dans ${societe.legal_name}`}
                onChange={(e) => e.target.value ? accesPersonne(p, e.target.value, m?.can_consolidate, true) : (m && accesPersonne(p, m.role, false, false))}>
                <option value="">Pas d'accès</option>
                {ROLES_SOCIETE.map(([r, l]) => <option key={r} value={r}>{l}</option>)}
              </select>
              <label className="flex items-center gap-2 text-ui-sm">
                <input type="checkbox" disabled={!role} checked={!!m?.can_consolidate && !!role} onChange={(e) => accesPersonne(p, role, e.target.checked, true)} />Vue groupe
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function Societes() {
  const role = useAuthStore((s) => s.userRole)
  const plateforme = role === 'superadmin'
  const [societes, setSocietes] = useState(null)
  const [modules, setModules] = useState([])
  const [personnes, setPersonnes] = useState([])
  const [membres, setMembres] = useState([])
  const [choisie, setChoisie] = useState(null)
  const [assistant, setAssistant] = useState(false)

  const charger = async () => {
    const [{ data: c, error }, { data: om }, { data: pr }, { data: mb }, { data: cm }] = await Promise.all([
      supabase.from('companies').select('*').order('is_instance_owner', { ascending: false }).order('position'),
      supabase.from('org_modules').select('key, label, enabled').order('position'),
      supabase.from('profiles').select('id, email, display_name, role, is_active').order('display_name'),
      supabase.from('company_members').select('company_id, profile_id, role, can_consolidate, is_active'),
      supabase.from('company_modules').select('company_id, key, enabled'),
    ])
    if (error) { toast.error(error.message); setSocietes([]); return }
    setSocietes((c || []).map((s) => ({ ...s, modules: (cm || []).filter((m) => m.company_id === s.id) })))
    setModules((om || []).filter((m) => m.enabled))
    setPersonnes((pr || []).filter((p) => p.is_active !== false && !['superadmin', 'entreprise', 'formateur_externe', 'stagiaire'].includes(p.role)))
    setMembres(mb || [])
  }
  useEffect(() => { charger() }, [])
  const courante = useMemo(() => (societes || []).find((s) => s.id === choisie) || null, [societes, choisie])

  if (societes === null) return <div className="text-gray-500">Chargement</div>
  if (courante) {
    return (
      <>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChoisie(null)}><ChevronLeft className="w-4 h-4" />Toutes les sociétés</button>
        <FicheSociete societe={courante} modules={modules} personnes={personnes} membres={membres} onChange={charger} />
      </>
    )
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="section-title">Sociétés</h2>
          <p className="muted">Chaque société a ses données, ses documents et sa numérotation ; les fiches clients, formateurs et catalogue peuvent être partagées.</p>
        </div>
        {plateforme && <button type="button" className="btn btn-primary" onClick={() => setAssistant(true)}><Plus className="w-4 h-4" />Ajouter une société</button>}
      </div>
      <ul className="divide-y hairline">
        {societes.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => setChoisie(s.id)} className="w-full py-3 flex items-center gap-3 text-left hover:bg-gray-50 px-1">
              {s.logo_url ? <img src={s.logo_url} alt="" className="w-9 h-9 rounded-ui-sm object-contain border border-gray-100" /> : <span className="w-9 h-9 rounded-ui-sm bg-gray-100 flex items-center justify-center"><Building2 className="w-4 h-4 text-gray-500" /></span>}
              <span className="flex-1 min-w-0">
                <span className="block font-medium truncate">{s.legal_name}</span>
                <span className="block text-ui-sm text-gray-500">{[s.siren && `SIREN ${s.siren}`, `${membres.filter((m) => m.company_id === s.id && m.is_active).length} personne(s)`].filter(Boolean).join(' · ')}</span>
              </span>
              {s.is_instance_owner && <span className="badge">Instance</span>}
              {s.status === 'archived' && <span className="badge badge-warning">Archivée</span>}
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </button>
          </li>
        ))}
      </ul>
      {assistant && <Assistant modules={modules} personnes={personnes} onClose={() => setAssistant(false)} onCree={(id) => { setAssistant(false); charger().then(() => setChoisie(id)) }} />}
    </>
  )
}

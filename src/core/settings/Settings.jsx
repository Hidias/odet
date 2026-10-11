import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Building2, MapPin, Palette, FileText, Landmark, Layers, Users, Calculator, Save, Loader2, Upload, Trash2, Mail, KeyRound, Check,
} from 'lucide-react'
import { useDataStore, useAuthStore } from '../store'
import { supabase } from '../supabase'
import { callApi } from '../api'
import { useBranding } from '../branding/BrandingProvider'
import { FONT_PAIRS } from '../branding/presets'
import { missingOrgFields, ORG_REQUIRED } from '../org/orgUtils'
import { THEMES, FORMES, ROLES, Field, Toggle, uploadBrandingFile, ModulesSection, ColorPicker } from './shared'

const SECTIONS = [
  { id: 'identite', label: 'Identité', icon: Building2 },
  { id: 'coordonnees', label: 'Coordonnées et signataire', icon: MapPin },
  { id: 'marque', label: 'Marque et affichage', icon: Palette },
  { id: 'documents', label: 'Documents et textes', icon: FileText },
  { id: 'banque', label: 'Banque et facturation', icon: Landmark },
  { id: 'modules', label: 'Modules', icon: Layers },
  { id: 'utilisateurs', label: 'Utilisateurs', icon: Users },
  { id: 'comptable', label: 'Accès comptable', icon: Calculator },
]

const ORG_FIELDS = [
  'name', 'legal_name', 'forme_juridique', 'capital_social', 'siret', 'siren', 'naf', 'tva_intra', 'tva_applicable', 'rcs', 'tribunal_competent',
  'nda', 'nda_region', 'qualiopi_certified', 'qualiopi_since', 'qualiopi_organisme', 'activity_kind', 'date_creation',
  'address', 'postal_code', 'city', 'phone', 'email', 'website', 'lieu_signature', 'region', 'zone_departements',
  'dirigeant_name', 'dirigeant_title', 'dirigeant_signature_url', 'referent_handicap_nom', 'referent_handicap_email', 'referent_handicap_phone', 'google_review_url',
  'app_name', 'app_short_name', 'brand_primary', 'brand_accent', 'brand_highlight', 'brand_nav', 'font_pair', 'logo_url', 'logo_on_dark_url', 'logo_base64', 'stamp_base64',
  'reglement_interieur', 'reglement_version', 'livret_accueil', 'livret_version', 'conditions_annulation', 'cgv_url', 'doc_prefix',
  'bank_name', 'iban', 'bic', 'email_bcc', 'email_default_sender', 'exercice_start_month', 'demo_mode',
]

export default function Settings() {
  const { organization, fetchOrganization, updateOrganization } = useDataStore()
  const { userRole, refreshModules } = useAuthStore()
  const { refresh: refreshBranding } = useBranding()
  const [params, setParams] = useSearchParams()
  const section = params.get('section') || 'identite'
  const setSection = (id) => setParams({ section: id })

  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const isSuperadmin = userRole === 'superadmin'

  useEffect(() => { (async () => { await fetchOrganization(); setLoading(false) })() }, [])
  useEffect(() => {
    if (organization) {
      const f = {}
      ORG_FIELDS.forEach((k) => { f[k] = organization[k] ?? (k === 'zone_departements' ? [] : '') })
      f.zone_departements_text = (organization.zone_departements || []).join(', ')
      setForm(f)
    }
  }, [organization])

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))
  const missing = useMemo(() => missingOrgFields(form, 'convention'), [form])

  const save = async () => {
    setSaving(true)
    try {
      const payload = { ...form }
      delete payload.zone_departements_text
      payload.zone_departements = (form.zone_departements_text || '').split(',').map((d) => d.trim()).filter(Boolean)
      payload.siret = (form.siret || '').replace(/\s/g, '')
      payload.siren = payload.siret ? payload.siret.slice(0, 9) : (form.siren || '')
      payload.nda = (form.nda || '').replace(/\s/g, '')
      payload.iban = (form.iban || '').replace(/\s/g, '').toUpperCase()
      payload.exercice_start_month = Number(form.exercice_start_month) || 1
      for (const k of ['qualiopi_since', 'date_creation']) if (!payload[k]) payload[k] = null
      const { error } = await updateOrganization(payload)
      if (error) throw error
      await refreshBranding()
      toast.success('Paramètres enregistrés')
    } catch (e) {
      toast.error('Enregistrement impossible : ' + (e.message || 'erreur inconnue'))
    } finally {
      setSaving(false)
    }
  }

  const onFile = (key, kind) => async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      if (kind === 'base64') {
        if (file.size > 500 * 1024) throw new Error('Image trop lourde (500 Ko maximum)')
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file) })
        set(key, b64)
      } else {
        const url = await uploadBrandingFile(file, key)
        set(key, url)
      }
      toast.success('Fichier chargé, pensez à enregistrer')
    } catch (err) {
      toast.error(err.message)
    }
  }

  if (loading) return <div className="p-8 text-gray-500">Chargement des paramètres</div>

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Paramètres</h1>
          <p className="muted mt-1">Identité, marque, textes et accès de votre organisme. Aucune valeur n'est écrite ailleurs que dans ces réglages.</p>
        </div>
        <button type="button" onClick={save} disabled={saving} className="btn btn-primary">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Enregistrer
        </button>
      </div>

      {missing.length > 0 && (
        <div className="rounded-ui border p-3 text-ui" style={{ background: 'rgb(var(--c-warning-bg))', borderColor: 'rgb(var(--c-warning) / 0.3)', color: 'rgb(var(--c-warning))' }}>
          Champs encore manquants pour générer une convention : {missing.join(', ')}.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-5">
        <nav className="card card-flush p-2 self-start">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" onClick={() => setSection(s.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-ui-sm text-ui text-left ${section === s.id ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}>
              <s.icon className="w-4 h-4 flex-none" />{s.label}
            </button>
          ))}
        </nav>

        <div className="card space-y-5">
          {section === 'identite' && (
            <>
              <h2 className="section-title">Identité légale</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Nom affiché (commercial)" hint="Sur l'interface, les emails et les documents">
                  <input className="input" value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
                </Field>
                <Field label="Raison sociale" hint="Telle qu'au Kbis, pour les factures et conventions">
                  <input className="input" value={form.legal_name || ''} onChange={(e) => set('legal_name', e.target.value)} />
                </Field>
                <Field label="Forme juridique">
                  <select className="select" value={form.forme_juridique || ''} onChange={(e) => set('forme_juridique', e.target.value)}>
                    <option value="">Choisir</option>{FORMES.map((f) => <option key={f}>{f}</option>)}
                  </select>
                </Field>
                <Field label="Capital social (EUR)"><input className="input" value={form.capital_social || ''} onChange={(e) => set('capital_social', e.target.value)} /></Field>
                <Field label="SIRET" hint="14 chiffres"><input className="input" value={form.siret || ''} onChange={(e) => set('siret', e.target.value)} /></Field>
                <Field label="Code NAF"><input className="input" value={form.naf || ''} onChange={(e) => set('naf', e.target.value)} placeholder="8559A" /></Field>
                <Field label="TVA intracommunautaire"><input className="input" value={form.tva_intra || ''} onChange={(e) => set('tva_intra', e.target.value)} placeholder="FR00000000000" /></Field>
                <Field label="RCS"><input className="input" value={form.rcs || ''} onChange={(e) => set('rcs', e.target.value)} placeholder="000 000 000 R.C.S. Quimper" /></Field>
                <Field label="Tribunal compétent" hint="Article Litiges des conventions"><input className="input" value={form.tribunal_competent || ''} onChange={(e) => set('tribunal_competent', e.target.value)} placeholder="tribunal de commerce de Quimper" /></Field>
                <Field label="Date de création"><input type="date" className="input" value={form.date_creation || ''} onChange={(e) => set('date_creation', e.target.value)} /></Field>
              </div>
              <h2 className="section-title">Formation professionnelle</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Numéro de déclaration d'activité (NDA)" hint="11 chiffres. Laisser vide tant qu'il n'est pas obtenu"><input className="input" value={form.nda || ''} onChange={(e) => set('nda', e.target.value)} /></Field>
                <Field label="Région du préfet (NDA)"><input className="input" value={form.nda_region || ''} onChange={(e) => set('nda_region', e.target.value)} placeholder="Bretagne" /></Field>
                <Field label="Activité">
                  <select className="select" value={form.activity_kind || 'of'} onChange={(e) => set('activity_kind', e.target.value)}>
                    <option value="of">Organisme de formation</option><option value="entreprise">Entreprise</option><option value="mixte">Formation et entreprise</option>
                  </select>
                </Field>
                <div className="space-y-3 pt-6">
                  <Toggle checked={!!form.qualiopi_certified} onChange={(v) => set('qualiopi_certified', v)} label="Certifié Qualiopi" hint="Ajoute la mention sur les documents" />
                  <Toggle checked={form.tva_applicable !== false} onChange={(v) => set('tva_applicable', v)} label="TVA applicable" hint="Décoché : mention d'exonération (art. 261-4-4° a du CGI)" />
                </div>
                {form.qualiopi_certified && (
                  <>
                    <Field label="Certifié depuis le"><input type="date" className="input" value={form.qualiopi_since || ''} onChange={(e) => set('qualiopi_since', e.target.value)} /></Field>
                    <Field label="Organisme certificateur"><input className="input" value={form.qualiopi_organisme || ''} onChange={(e) => set('qualiopi_organisme', e.target.value)} /></Field>
                  </>
                )}
              </div>
            </>
          )}

          {section === 'coordonnees' && (
            <>
              <h2 className="section-title">Siège</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Adresse" className="md:col-span-2"><input className="input" value={form.address || ''} onChange={(e) => set('address', e.target.value)} /></Field>
                <Field label="Code postal"><input className="input" value={form.postal_code || ''} onChange={(e) => set('postal_code', e.target.value)} /></Field>
                <Field label="Ville"><input className="input" value={form.city || ''} onChange={(e) => set('city', e.target.value)} /></Field>
                <Field label="Téléphone"><input className="input" value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
                <Field label="Email de contact"><input type="email" className="input" value={form.email || ''} onChange={(e) => set('email', e.target.value)} /></Field>
                <Field label="Site web"><input className="input" value={form.website || ''} onChange={(e) => set('website', e.target.value)} placeholder="www.exemple.fr" /></Field>
                <Field label="Lieu de signature des documents" hint="Par défaut, la ville du siège"><input className="input" value={form.lieu_signature || ''} onChange={(e) => set('lieu_signature', e.target.value)} /></Field>
                <Field label="Région"><input className="input" value={form.region || ''} onChange={(e) => set('region', e.target.value)} /></Field>
                <Field label="Départements d'intervention" hint="Numéros séparés par des virgules"><input className="input" value={form.zone_departements_text || ''} onChange={(e) => set('zone_departements_text', e.target.value)} placeholder="29, 56, 22, 35" /></Field>
                <Field label="Lien avis Google" hint="Proposé au stagiaire en fin de formation"><input className="input" value={form.google_review_url || ''} onChange={(e) => set('google_review_url', e.target.value)} /></Field>
              </div>
              <h2 className="section-title">Signataire</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Nom du dirigeant ou signataire"><input className="input" value={form.dirigeant_name || ''} onChange={(e) => set('dirigeant_name', e.target.value)} /></Field>
                <Field label="Fonction"><input className="input" value={form.dirigeant_title || ''} onChange={(e) => set('dirigeant_title', e.target.value)} placeholder="Gérant" /></Field>
                <Field label="Signature manuscrite (image)" hint="PNG sur fond transparent de préférence" className="md:col-span-2">
                  <div className="flex items-center gap-4">
                    {form.dirigeant_signature_url && <img src={form.dirigeant_signature_url} alt="" className="h-14 border rounded-ui-sm bg-white p-1" />}
                    <label className="btn btn-secondary cursor-pointer"><Upload className="w-4 h-4" />Choisir<input type="file" accept="image/*" className="hidden" onChange={onFile('dirigeant_signature_url', 'storage')} /></label>
                    {form.dirigeant_signature_url && <button type="button" className="btn btn-ghost" onClick={() => set('dirigeant_signature_url', '')}><Trash2 className="w-4 h-4" />Retirer</button>}
                  </div>
                </Field>
              </div>
              <h2 className="section-title">Référent handicap</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Nom"><input className="input" value={form.referent_handicap_nom || ''} onChange={(e) => set('referent_handicap_nom', e.target.value)} /></Field>
                <Field label="Email"><input className="input" value={form.referent_handicap_email || ''} onChange={(e) => set('referent_handicap_email', e.target.value)} /></Field>
                <Field label="Téléphone"><input className="input" value={form.referent_handicap_phone || ''} onChange={(e) => set('referent_handicap_phone', e.target.value)} /></Field>
              </div>
            </>
          )}

          {section === 'marque' && (
            <>
              <h2 className="section-title">Nom affiché et logo</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Nom de l'application" hint="Titre de l'onglet et de l'icône sur le téléphone"><input className="input" value={form.app_name || ''} onChange={(e) => set('app_name', e.target.value)} /></Field>
                <Field label="Nom court" hint="Sous l'icône sur le téléphone (12 caractères maximum)"><input className="input" maxLength={12} value={form.app_short_name || ''} onChange={(e) => set('app_short_name', e.target.value)} /></Field>
                <Field label="Logo" hint="PNG ou SVG, fond transparent ou blanc" className="md:col-span-2">
                  <div className="flex items-center gap-4 flex-wrap">
                    {form.logo_url && <img src={form.logo_url} alt="" className="h-14 border rounded-ui-sm bg-white p-1" />}
                    <label className="btn btn-secondary cursor-pointer"><Upload className="w-4 h-4" />Choisir<input type="file" accept="image/*" className="hidden" onChange={onFile('logo_url', 'storage')} /></label>
                  </div>
                </Field>
                <Field label="Logo pour fond sombre (facultatif)" className="md:col-span-2">
                  <div className="flex items-center gap-4 flex-wrap">
                    {form.logo_on_dark_url && <img src={form.logo_on_dark_url} alt="" className="h-14 border rounded-ui-sm bg-gray-900 p-1" />}
                    <label className="btn btn-secondary cursor-pointer"><Upload className="w-4 h-4" />Choisir<input type="file" accept="image/*" className="hidden" onChange={onFile('logo_on_dark_url', 'storage')} /></label>
                    {form.logo_on_dark_url && <button type="button" className="btn btn-ghost" onClick={() => set('logo_on_dark_url', '')}><Trash2 className="w-4 h-4" />Retirer</button>}
                  </div>
                </Field>
                <Field label="Tampon (sur conventions et attestations)" hint="Image, 500 Ko maximum" className="md:col-span-2">
                  <div className="flex items-center gap-4 flex-wrap">
                    {form.stamp_base64 && <img src={form.stamp_base64} alt="" className="h-14 border rounded-ui-sm bg-white p-1" />}
                    <label className="btn btn-secondary cursor-pointer"><Upload className="w-4 h-4" />Choisir<input type="file" accept="image/*" className="hidden" onChange={onFile('stamp_base64', 'base64')} /></label>
                    {form.stamp_base64 && <button type="button" className="btn btn-ghost" onClick={() => set('stamp_base64', '')}><Trash2 className="w-4 h-4" />Retirer</button>}
                  </div>
                </Field>
              </div>
              <h2 className="section-title">Couleurs</h2>
              <ColorPicker form={form} set={set} />
              <h2 className="section-title">Polices</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {Object.entries(FONT_PAIRS).map(([key, p]) => (
                  <button key={key} type="button" onClick={() => set('font_pair', key)}
                    className={`rounded-ui border p-3 text-left ${form.font_pair === key ? 'border-accent-500 ring-2 ring-accent-500/20' : 'border-gray-200 hover:border-gray-300'}`}>
                    <div style={{ fontFamily: p.display }} className="text-lg font-semibold">Titres</div>
                    <div style={{ fontFamily: p.body }} className="text-ui text-gray-600">Texte courant, tableaux et formulaires.</div>
                    <div className="text-ui-sm text-gray-400 mt-1">{p.label}</div>
                  </button>
                ))}
              </div>
              <p className="text-ui-sm text-gray-400">Les couleurs et polices s'appliquent à tous les utilisateurs après enregistrement. Chacun choisit en plus sa densité et son type de navigation dans le menu Affichage.</p>
            </>
          )}

          {section === 'documents' && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Préfixe des codes documentaires" hint="Pied de page des PDF, par exemple GLD-CONV"><input className="input" maxLength={5} value={form.doc_prefix || ''} onChange={(e) => set('doc_prefix', e.target.value.toUpperCase())} /></Field>
                <Field label="Conditions générales de vente (PDF)" hint="Jointes aux devis">
                  <div className="flex items-center gap-3 flex-wrap">
                    {form.cgv_url && <a href={form.cgv_url} target="_blank" rel="noreferrer" className="text-ui text-accent-700 underline">Voir le fichier</a>}
                    <label className="btn btn-secondary btn-sm cursor-pointer"><Upload className="w-4 h-4" />Choisir<input type="file" accept="application/pdf" className="hidden" onChange={onFile('cgv_url', 'storage')} /></label>
                  </div>
                </Field>
              </div>
              <Field label="Conditions d'annulation (article 7 des conventions)" hint="Vide : texte standard (14 jours : 50 %, 7 jours : 75 %)">
                <textarea className="textarea" rows={4} value={form.conditions_annulation || ''} onChange={(e) => set('conditions_annulation', e.target.value)} />
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px] gap-4">
                <Field label="Règlement intérieur" hint="Titres sur une ligne, paragraphes séparés par une ligne vide. Vide : texte standard">
                  <textarea className="textarea" rows={12} value={form.reglement_interieur || ''} onChange={(e) => set('reglement_interieur', e.target.value)} />
                </Field>
                <Field label="Version"><input className="input" value={form.reglement_version || ''} onChange={(e) => set('reglement_version', e.target.value)} placeholder="V1.0" /></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px] gap-4">
                <Field label="Livret d'accueil" hint="Même format. Vide : texte standard">
                  <textarea className="textarea" rows={12} value={form.livret_accueil || ''} onChange={(e) => set('livret_accueil', e.target.value)} />
                </Field>
                <Field label="Version"><input className="input" value={form.livret_version || ''} onChange={(e) => set('livret_version', e.target.value)} placeholder="V1.0" /></Field>
              </div>
            </>
          )}

          {section === 'banque' && (
            <>
              <h2 className="section-title">Coordonnées bancaires (factures et devis)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Banque"><input className="input" value={form.bank_name || ''} onChange={(e) => set('bank_name', e.target.value)} /></Field>
                <Field label="BIC"><input className="input" value={form.bic || ''} onChange={(e) => set('bic', e.target.value.toUpperCase())} /></Field>
                <Field label="IBAN" className="md:col-span-2"><input className="input" value={form.iban || ''} onChange={(e) => set('iban', e.target.value)} /></Field>
              </div>
              <h2 className="section-title">Emails et exercice</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Copie cachée systématique" hint="Adresse d'archivage recevant tous les envois"><input className="input" value={form.email_bcc || ''} onChange={(e) => set('email_bcc', e.target.value)} /></Field>
                <Field label="Expéditeur par défaut" hint="Compte email utilisé quand aucun n'est précisé"><input className="input" value={form.email_default_sender || ''} onChange={(e) => set('email_default_sender', e.target.value)} /></Field>
                <Field label="Premier mois de l'exercice comptable">
                  <select className="select" value={form.exercice_start_month || 1} onChange={(e) => set('exercice_start_month', e.target.value)}>
                    {['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </Field>
                {isSuperadmin && (
                  <div className="pt-6"><Toggle checked={!!form.demo_mode} onChange={(v) => set('demo_mode', v)} label="Mode démonstration" hint="Tous les emails sortants sont redirigés vers l'adresse de test (MAIL_SINK)" /></div>
                )}
              </div>
            </>
          )}

          {section === 'modules' && <ModulesSection onChanged={refreshModules} />}
          {section === 'utilisateurs' && <UsersSection isSuperadmin={isSuperadmin} />}
          {section === 'comptable' && <ComptableSection />}
        </div>
      </div>
    </div>
  )
}

function UsersSection({ isSuperadmin }) {
  const [profiles, setProfiles] = useState([])
  const [invite, setInvite] = useState({ email: '', display_name: '', role: 'gestionnaire' })
  const [busy, setBusy] = useState(false)
  const [resetLink, setResetLink] = useState(null)
  const me = useAuthStore((s) => s.profile)

  const load = async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setProfiles(data || [])
  }
  useEffect(() => { load() }, [])

  const update = async (id, patch) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Mis à jour'); load()
  }
  const sendInvite = async () => {
    if (!invite.email) return
    setBusy(true)
    try {
      await callApi('/api/admin-users', { action: 'invite', ...invite })
      toast.success('Invitation envoyée'); setInvite({ email: '', display_name: '', role: 'gestionnaire' }); load()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  const reset = async (email) => {
    setBusy(true)
    try {
      const r = await callApi('/api/admin-users', { action: 'reset', email })
      setResetLink(r.link); toast.success('Lien de réinitialisation généré')
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  const remove = async (p) => {
    if (!window.confirm(`Supprimer définitivement le compte de ${p.email} ?`)) return
    try { await callApi('/api/admin-users', { action: 'delete', user_id: p.id }); toast.success('Compte supprimé'); load() } catch (e) { toast.error(e.message) }
  }

  return (
    <>
      <h2 className="section-title">Utilisateurs et rôles</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Actif</th><th></th></tr></thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id}>
                <td><div className="font-medium">{p.display_name || p.email}</div><div className="text-ui-sm text-gray-500">{p.email}</div></td>
                <td>
                  <select className="select" style={{ minHeight: 32, width: 190 }} value={p.role} disabled={p.id === me?.id || (p.role === 'superadmin' && !isSuperadmin)}
                    onChange={(e) => update(p.id, { role: e.target.value })}>
                    {ROLES.filter(([r]) => r !== 'superadmin' || isSuperadmin).map(([r, l]) => <option key={r} value={r}>{l}</option>)}
                  </select>
                </td>
                <td><Toggle checked={p.is_active} onChange={(v) => update(p.id, { is_active: v })} label="" /></td>
                <td className="text-right whitespace-nowrap">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => reset(p.email)} disabled={busy}><KeyRound className="w-4 h-4" />Mot de passe</button>
                  {isSuperadmin && p.id !== me?.id && <button type="button" className="btn btn-ghost btn-sm text-red-700" onClick={() => remove(p)}><Trash2 className="w-4 h-4" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {resetLink && (
        <div className="rounded-ui border border-gray-200 bg-gray-50 p-3 text-ui break-all">
          <div className="font-medium mb-1">Lien de réinitialisation (à transmettre, valable une fois) :</div>
          <code className="text-ui-sm">{resetLink}</code>
          <div className="mt-2"><button type="button" className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(resetLink); toast.success('Copié') }}><Check className="w-4 h-4" />Copier</button></div>
        </div>
      )}
      <h2 className="section-title">Inviter un utilisateur</h2>
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_200px_auto] gap-3 items-end">
        <Field label="Email"><input type="email" className="input" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></Field>
        <Field label="Nom affiché"><input className="input" value={invite.display_name} onChange={(e) => setInvite({ ...invite, display_name: e.target.value })} /></Field>
        <Field label="Rôle">
          <select className="select" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
            {ROLES.filter(([r]) => r !== 'superadmin' || isSuperadmin).map(([r, l]) => <option key={r} value={r}>{l}</option>)}
          </select>
        </Field>
        <button type="button" className="btn btn-primary" onClick={sendInvite} disabled={busy || !invite.email}><Mail className="w-4 h-4" />Inviter</button>
      </div>
      <p className="text-ui-sm text-gray-400">L'invité reçoit un email pour choisir son mot de passe. Les règles d'accès (super administrateur, direction, gestionnaire, formateur, commercial, comptable, lecture) s'appliquent dès sa première connexion.</p>
    </>
  )
}

function ComptableSection() {
  const [form, setForm] = useState({ comptable_email: '', comptable_name: '', comptable_cc: '', comptable_bcc: '' })
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    supabase.from('org_settings').select('comptable_email, comptable_name, comptable_cc, comptable_bcc').limit(1).maybeSingle()
      .then(({ data }) => { if (data) setForm({ comptable_email: data.comptable_email || '', comptable_name: data.comptable_name || '', comptable_cc: data.comptable_cc || '', comptable_bcc: data.comptable_bcc || '' }) })
  }, [])
  const save = async () => {
    setSaving(true)
    const { data: existing } = await supabase.from('org_settings').select('id').limit(1).maybeSingle()
    const r = existing
      ? await supabase.from('org_settings').update(form).eq('id', existing.id)
      : await supabase.from('org_settings').insert([{ ...form, name: 'organisation' }])
    setSaving(false)
    if (r.error) return toast.error(r.error.message)
    toast.success('Accès comptable enregistré')
  }
  return (
    <>
      <h2 className="section-title">Cabinet comptable</h2>
      <p className="muted">L'adresse renseignée reçoit les envois automatiques (pièces, récapitulatifs). Pour lui donner un accès à l'espace comptable, invitez-la dans Utilisateurs avec le rôle Comptable.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Nom du cabinet"><input className="input" value={form.comptable_name} onChange={(e) => setForm({ ...form, comptable_name: e.target.value })} /></Field>
        <Field label="Email du comptable"><input type="email" className="input" value={form.comptable_email} onChange={(e) => setForm({ ...form, comptable_email: e.target.value })} /></Field>
        <Field label="Copie (CC)" hint="Plusieurs adresses séparées par des virgules"><input className="input" value={form.comptable_cc} onChange={(e) => setForm({ ...form, comptable_cc: e.target.value })} /></Field>
        <Field label="Copie cachée (BCC)"><input className="input" value={form.comptable_bcc} onChange={(e) => setForm({ ...form, comptable_bcc: e.target.value })} /></Field>
      </div>
      <button type="button" onClick={save} disabled={saving} className="btn btn-primary"><Save className="w-4 h-4" />Enregistrer</button>
      <p className="text-ui-sm text-gray-400">Configuration des comptes d'envoi (SMTP) : <Link to="/settings/email" className="underline">Comptes email</Link>.</p>
    </>
  )
}

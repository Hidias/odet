import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Building2, MapPin, Palette, FileText, Landmark, Layers, Users, Calculator, Save, Loader2, Upload, Trash2, Mail, KeyRound, Check, ShieldCheck, UserCog, ListChecks, Network,
} from 'lucide-react'
import { useDataStore, useAuthStore } from '../store'
import { supabase } from '../supabase'
import { callApi } from '../api'
import { useBranding } from '../branding/BrandingProvider'
import { FONT_PAIRS } from '../branding/presets'
import { missingOrgFields, ORG_REQUIRED } from '../org/orgUtils'
import EmailSettings from './EmailSettings'
import NumerotationFactures from './facturation/NumerotationFactures'
import MentionsFactures from './facturation/MentionsFactures'
import TransmissionComptable from './facturation/TransmissionComptable'
import DroitsPersonnes from './droits/DroitsPersonnes'
import ProfilsDroits from './droits/ProfilsDroits'
import Societes from './societes/Societes'
import { peut } from '../rights/useDroit'
import { THEMES, FORMES, ROLES, Field, Toggle, uploadBrandingFile, ModulesSection, ColorPicker } from './shared'

const SECTIONS = [
  { id: 'identite', label: 'Identité', icon: Building2 },
  { id: 'coordonnees', label: 'Coordonnées et signataire', icon: MapPin },
  { id: 'marque', label: 'Marque et affichage', icon: Palette },
  { id: 'documents', label: 'Documents et textes', icon: FileText },
  { id: 'qualite', label: 'Qualité et référents', icon: ShieldCheck },
  { id: 'banque', label: 'Banque et facturation', icon: Landmark },
  { id: 'modules', label: 'Modules', icon: Layers },
  { id: 'emails', label: 'Comptes email', icon: Mail },
  { id: 'utilisateurs', label: 'Utilisateurs', icon: Users },
  // Droits composés (C1b) : visibles seulement avec le droit, jamais tant que les droits sont inconnus
  { id: 'droits', label: 'Droits des personnes', icon: UserCog, right: 'parametres.droits.attribuer' },
  { id: 'profils', label: 'Profils de droits', icon: ListChecks, right: 'parametres.profils.gerer' },
  { id: 'comptable', label: 'Accès comptable', icon: Calculator },
  // Sociétés (C3) : plateforme, ou administrateur d'une société avec la licence totale
  { id: 'societes', label: 'Sociétés', icon: Network, right: ['plateforme.administrer', 'parametres.organisme.modifier'] },
]

const ORG_FIELDS = [
  'name', 'legal_name', 'forme_juridique', 'capital_social', 'siret', 'siren', 'naf', 'tva_intra', 'tva_applicable', 'rcs', 'tribunal_competent',
  'nda', 'nda_region', 'qualiopi_certified', 'qualiopi_since', 'qualiopi_organisme', 'activity_kind', 'caces_activity', 'date_creation',
  'address', 'postal_code', 'city', 'phone', 'email', 'website', 'lieu_signature', 'region', 'zone_departements',
  'dirigeant_name', 'dirigeant_title', 'dirigeant_signature_url', 'referent_handicap_email', 'referent_handicap_phone', 'google_review_url',
  'app_name', 'app_short_name', 'brand_primary', 'brand_accent', 'brand_highlight', 'brand_nav', 'font_pair', 'logo_url', 'logo_on_dark_url', 'logo_base64', 'stamp_base64', 'icon_192_url', 'icon_512_url', 'favicon_url',
  'doc_prefix',
  'bank_name', 'iban', 'bic', 'bank_overdraft', 'email_bcc', 'email_default_sender', 'email_sync_ignored', 'exercice_start_month', 'demo_mode',
  'ai_profile',
]

export default function Settings() {
  const { organization, fetchOrganization, updateOrganization } = useDataStore()
  const surchargee = useDataStore((st) => st.organizationSurchargee)
  const { userRole, refreshModules, modules, can } = useAuthStore()
  useAuthStore((st) => st.rights)
  const sections = SECTIONS.filter((s) => !s.right || peut(can, userRole, s.right, []))
  // Module Certification actif : la certification Qualiopi se renseigne là-bas (une seule saisie)
  const certModule = (modules || []).includes('certification')
  const { refresh: refreshBranding } = useBranding()
  const [params, setParams] = useSearchParams()
  const section = params.get('section') || 'identite'
  const setSection = (id) => setParams({ section: id })

  const [form, setForm] = useState({})
  // Référent handicap : lu dans le rôle qualité (Paramètres > Qualité et référents), jamais recopié ici
  const [refHandicap, setRefHandicap] = useState(null)
  const loadRefHandicap = () => supabase.rpc('referent_handicap_info').then(({ data }) => setRefHandicap(data || null), () => setRefHandicap(null))
  useEffect(() => { loadRefHandicap() }, [])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const isSuperadmin = userRole === 'superadmin'

  useEffect(() => { (async () => { await fetchOrganization(); setLoading(false) })() }, [])
  useEffect(() => {
    if (organization) {
      const f = {}
      ORG_FIELDS.forEach((k) => { f[k] = organization[k] ?? (k === 'zone_departements' ? [] : k === 'ai_profile' ? {} : '') })
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
      payload.caces_activity = !!form.caces_activity
      payload.bank_overdraft = Math.max(0, Number(String(form.bank_overdraft ?? '').replace(',', '.')) || 0)
      payload.ai_profile = form.ai_profile && typeof form.ai_profile === 'object' ? form.ai_profile : {}
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

  const onFile = (key, kind, alsoKeys = []) => async (e) => {
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
        alsoKeys.forEach((k) => set(k, url))
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

      {surchargee && (
        <div className="rounded-ui border border-gray-300 bg-gray-50 p-3 text-ui">
          Vous travaillez dans une société qui ne porte pas l'instance : son identité, sa banque et ses initiales se règlent dans
          Paramètres › Sociétés. Les champs d'identité enregistrés ici ne la modifient pas.
        </div>
      )}

      {missing.length > 0 && (
        <div className="rounded-ui border p-3 text-ui" style={{ background: 'rgb(var(--c-warning-bg))', borderColor: 'rgb(var(--c-warning) / 0.3)', color: 'rgb(var(--c-warning))' }}>
          Champs encore manquants pour générer une convention : {missing.join(', ')}.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-5">
        <nav className="card card-flush p-2 self-start">
          {sections.map((s) => (
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
                <Field label="Initiales de l'entreprise" hint={`2 à 5 lettres ou chiffres. Servent aux références des sessions et aux codes des documents (pied de page des PDF, par exemple ${form.doc_prefix || 'ABC'}-CONV). Les références déjà créées ne changent pas.`}><input className="input" maxLength={5} value={form.doc_prefix || ''} onChange={(e) => set('doc_prefix', e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} /></Field>
                <Field label="Forme juridique">
                  <select className="select" value={form.forme_juridique || ''} onChange={(e) => set('forme_juridique', e.target.value)}>
                    <option value="">Choisir</option>{FORMES.map((f) => <option key={f}>{f}</option>)}
                  </select>
                </Field>
                <Field label="Capital social (EUR)"><input className="input" value={form.capital_social || ''} onChange={(e) => set('capital_social', e.target.value)} /></Field>
                <Field label="SIRET" hint="14 chiffres"><input className="input" value={form.siret || ''} onChange={(e) => set('siret', e.target.value)} /></Field>
                <Field label="Code NAF"><input className="input" value={form.naf || ''} onChange={(e) => set('naf', e.target.value)} placeholder="8559A" /></Field>
                <Field label="TVA intracommunautaire"><input className="input" value={form.tva_intra || ''} onChange={(e) => set('tva_intra', e.target.value)} placeholder="FR00000000000" /></Field>
                <Field label="RCS"><input className="input" value={form.rcs || ''} onChange={(e) => set('rcs', e.target.value)} placeholder="000 000 000 R.C.S. Ville" /></Field>
                <Field label="Tribunal compétent" hint="Article Litiges des conventions"><input className="input" value={form.tribunal_competent || ''} onChange={(e) => set('tribunal_competent', e.target.value)} placeholder="tribunal de commerce de (ville du siège)" /></Field>
                <Field label="Date de création"><input type="date" className="input" value={form.date_creation || ''} onChange={(e) => set('date_creation', e.target.value)} /></Field>
              </div>
              <h2 className="section-title">Formation professionnelle</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Numéro de déclaration d'activité (NDA)" hint="11 chiffres. Laisser vide tant qu'il n'est pas obtenu"><input className="input" value={form.nda || ''} onChange={(e) => set('nda', e.target.value)} /></Field>
                <Field label="Région du préfet (NDA)"><input className="input" value={form.nda_region || ''} onChange={(e) => set('nda_region', e.target.value)} placeholder="Région du siège" /></Field>
                <Field label="Activité">
                  <select className="select" value={form.activity_kind || 'of'} onChange={(e) => set('activity_kind', e.target.value)}>
                    <option value="of">Organisme de formation</option><option value="entreprise">Entreprise</option><option value="mixte">Formation et entreprise</option>
                  </select>
                </Field>
                <div className="space-y-3 pt-6">
                  {certModule
                    ? <div className="text-ui-sm"><span className="font-medium text-gray-800">{form.qualiopi_certified ? `Certifié Qualiopi${form.qualiopi_since ? ` depuis le ${String(form.qualiopi_since).slice(0, 10).split('-').reverse().join('/')}` : ''}${form.qualiopi_organisme ? `, ${form.qualiopi_organisme}` : ''}` : 'Non certifié Qualiopi'}</span><span className="block text-gray-500">Se renseigne dans <Link to="/certification/qualiopi" className="text-primary-600 underline">Certification, Qualiopi</Link> (date du certificat et certificateur).</span></div>
                    : <Toggle checked={!!form.qualiopi_certified} onChange={(v) => set('qualiopi_certified', v)} label="Certifié Qualiopi" hint="Ajoute la mention sur les documents" />}
                  <Toggle checked={!!form.caces_activity} onChange={(v) => set('caces_activity', v)} label="Activité CACES" hint="Décoché : l'Aide à la rédaction parle de formation à la conduite en vue de l'autorisation de conduite, jamais de CACES" />
                  <Toggle checked={!!form.ai_profile?.tutoiement} onChange={(v) => set('ai_profile', { ...(form.ai_profile || {}), tutoiement: v })} label="Tutoyer les contacts" hint="Emails commerciaux rédigés par l'Aide à la rédaction (comptes rendus, relances). Décoché : vouvoiement" />
                  <Toggle checked={form.tva_applicable !== false} onChange={(v) => set('tva_applicable', v)} label="TVA applicable" hint="Décoché : mention d'exonération (art. 261-4-4° a du CGI)" />
                </div>
                <Field label="Présentation pour l'Aide à la rédaction" className="md:col-span-2" hint="Spécialités, approche, points forts : seules informations sur l'organisme que l'Aide à la rédaction reprend dans les publications et les emails (aucun chiffre ici, ils sont calculés)">
                  <textarea className="input" rows={3} value={form.ai_profile?.presentation || ''} onChange={(e) => set('ai_profile', { ...(form.ai_profile || {}), presentation: e.target.value })} placeholder="Ex : formations en entreprise, matériel fourni, mises en situation au plus près du terrain" />
                </Field>
                {form.qualiopi_certified && !certModule && (
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
                <Field label="Nom" hint="Se choisit dans Qualité et référents">
                  <div className="input bg-gray-50 text-gray-700">{refHandicap?.nom || 'Non désigné'}</div>
                </Field>
                <Field label="Email de contact" hint="Facultatif : vide, c'est celui du référent"><input className="input" placeholder={refHandicap?.email || ''} value={form.referent_handicap_email || ''} onChange={(e) => set('referent_handicap_email', e.target.value)} /></Field>
                <Field label="Téléphone de contact" hint="Facultatif : vide, c'est celui du référent"><input className="input" placeholder={refHandicap?.phone || ''} value={form.referent_handicap_phone || ''} onChange={(e) => set('referent_handicap_phone', e.target.value)} /></Field>
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
                <Field label="Icône de l'application" hint="Carré, PNG 512 × 512 px. Sur le téléphone, dans le menu et sur l'écran de connexion. Vide : le logo est utilisé" className="md:col-span-2">
                  <div className="flex items-center gap-4 flex-wrap">
                    {(form.icon_512_url || form.icon_192_url) && <img src={form.icon_512_url || form.icon_192_url} alt="" className="h-14 w-14 border rounded-ui-sm object-cover" />}
                    <label className="btn btn-secondary cursor-pointer"><Upload className="w-4 h-4" />Choisir<input type="file" accept="image/png,image/svg+xml,image/webp" className="hidden" onChange={onFile('icon_512_url', 'storage', ['icon_192_url'])} /></label>
                    {(form.icon_512_url || form.icon_192_url) && <button type="button" className="btn btn-ghost" onClick={() => { set('icon_512_url', ''); set('icon_192_url', '') }}><Trash2 className="w-4 h-4" />Retirer</button>}
                  </div>
                </Field>
                <Field label="Icône de l'onglet du navigateur (facultatif)" hint="Carré, PNG 48 × 48 px. Vide : l'icône de l'application est utilisée" className="md:col-span-2">
                  <div className="flex items-center gap-4 flex-wrap">
                    {form.favicon_url && <img src={form.favicon_url} alt="" className="h-8 w-8 border rounded-ui-sm object-cover" />}
                    <label className="btn btn-secondary cursor-pointer"><Upload className="w-4 h-4" />Choisir<input type="file" accept="image/png,image/svg+xml,image/x-icon" className="hidden" onChange={onFile('favicon_url', 'storage')} /></label>
                    {form.favicon_url && <button type="button" className="btn btn-ghost" onClick={() => set('favicon_url', '')}><Trash2 className="w-4 h-4" />Retirer</button>}
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
              <h2 className="section-title">Documents remis aux stagiaires et aux clients</h2>
              <p className="text-ui text-gray-700">Le règlement intérieur, le livret d'accueil, les conditions générales de vente (dont les conditions d'annulation reprises dans les conventions) et les chartes se rédigent et se valident à un seul endroit : <Link to="/qualite" className="text-primary-600 underline">Documents qualité</Link>.</p>
              <ul className="text-ui-sm text-gray-600 list-disc pl-5 space-y-1">
                <li>Convocations et documents de session : règlement intérieur et livret d'accueil (version courte), dernière version validée.</li>
                <li>Conventions, article « Annulation et report » : articles 8 et 9 des conditions générales de vente.</li>
                <li>Tant qu'aucune version n'est validée, le brouillon enregistré ou le modèle de l'outil est utilisé.</li>
              </ul>
            </>
          )}

          {section === 'banque' && (
            <>
              <h2 className="section-title">Coordonnées bancaires (factures et devis)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Banque"><input className="input" value={form.bank_name || ''} onChange={(e) => set('bank_name', e.target.value)} /></Field>
                <Field label="BIC"><input className="input" value={form.bic || ''} onChange={(e) => set('bic', e.target.value.toUpperCase())} /></Field>
                <Field label="IBAN" className="md:col-span-2"><input className="input" value={form.iban || ''} onChange={(e) => set('iban', e.target.value)} /></Field>
                <Field label="Découvert autorisé (euros)" hint="Module Budget : alerte quand le découvert approche de cette limite. 0 si aucun"><input className="input" inputMode="decimal" value={form.bank_overdraft ?? ''} onChange={(e) => set('bank_overdraft', e.target.value)} /></Field>
              </div>
              <NumerotationFactures />
              <MentionsFactures />
              <TransmissionComptable />
              <h2 className="section-title">Emails et exercice</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Copie cachée systématique" hint="Adresse d'archivage recevant tous les envois"><input className="input" value={form.email_bcc || ''} onChange={(e) => set('email_bcc', e.target.value)} /></Field>
                <Field label="Expéditeur par défaut" hint="Compte email utilisé quand aucun n'est précisé"><input className="input" value={form.email_default_sender || ''} onChange={(e) => set('email_default_sender', e.target.value)} /></Field>
                <Field label="Adresses à ignorer dans le suivi des emails envoyés" className="md:col-span-2" hint="Adresses personnelles, partenaires, @domaine... séparées par des virgules. Les adresses de l'équipe et le domaine de l'organisme sont déjà ignorés"><input className="input" value={form.email_sync_ignored || ''} onChange={(e) => set('email_sync_ignored', e.target.value)} placeholder="prenom.nom@exemple.fr, @partenaire.fr" /></Field>
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
          {section === 'qualite' && <QualiteSection onReferentHandicap={loadRefHandicap} />}
          {section === 'emails' && <EmailSettings embedded />}
          {section === 'utilisateurs' && <UsersSection isSuperadmin={isSuperadmin} />}
          {section === 'comptable' && <ComptableSection />}
          {section === 'droits' && sections.some((s) => s.id === 'droits') && <DroitsPersonnes />}
          {section === 'profils' && sections.some((s) => s.id === 'profils') && <ProfilsDroits />}
          {section === 'societes' && sections.some((s) => s.id === 'societes') && <Societes />}
        </div>
      </div>
    </div>
  )
}

// Rôles qualité : chaque responsable ou référent est un compte utilisateur, jamais un nom écrit à la main.
// Les documents qualité, le livret et les procédures reprennent le titulaire au moment de l'affichage.
function QualiteSection({ onReferentHandicap }) {
  const [roles, setRoles] = useState([])
  const [profiles, setProfiles] = useState([])
  const [busy, setBusy] = useState(null)
  const [demoNames, setDemoNames] = useState(false)

  const personName = (p) => (p ? [p.first_name, p.last_name ? String(p.last_name).toUpperCase() : ''].filter(Boolean).join(' ').trim() || p.display_name || p.email : '')

  const load = async () => {
    const [r, p] = await Promise.all([
      supabase.from('quality_roles').select('*').order('sort_order'),
      supabase.from('profiles').select('id, first_name, last_name, display_name, email, sender_email, phone, role, is_active').order('created_at'),
    ])
    if (r.error) toast.error(r.error.message)
    setRoles(r.data || [])
    supabase.rpc('quality_demo_names_active').then(({ data }) => setDemoNames(!!data), () => setDemoNames(false))
    setProfiles((p.data || []).filter((x) => x.is_active !== false && !['entreprise', 'formateur_externe'].includes(x.role)))
  }
  useEffect(() => { load() }, [])

  const choose = async (role, profileId) => {
    setBusy(role.code)
    const { error } = await supabase.from('quality_roles').update({ profile_id: profileId || null, updated_at: new Date().toISOString() }).eq('code', role.code)
    if (error) { setBusy(null); return toast.error(error.message) }
    if (role.code === 'referent_handicap') onReferentHandicap?.()
    setBusy(null)
    toast.success('Référent mis à jour')
    load()
  }

  const chooseDeputy = async (role, profileId) => {
    setBusy(role.code)
    const { error } = await supabase.from('quality_roles').update({ deputy_profile_id: profileId || null, updated_at: new Date().toISOString() }).eq('code', role.code)
    setBusy(null)
    if (error) return toast.error(error.message)
    toast.success('Suppléant mis à jour')
    load()
  }

  return (
    <>
      <h2 className="section-title">Responsables et référents qualité</h2>
      <p className="text-ui-sm text-gray-500">Chaque rôle est tenu par un utilisateur, avec un suppléant qui le remplace en cas d'absence ou de conflit d'intérêts (obligatoire pour le référent handicap et le référent violences, harcèlement et discriminations). Les documents qualité affichent automatiquement les personnes choisies ici. Le changement est enregistré immédiatement.</p>
      {demoNames && <p className="text-ui-sm rounded-ui-sm bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] p-2">Démonstration : les documents affichent les noms fictifs indiqués sous chaque rôle. Ils disparaissent avec l'effacement des données de démonstration (Console) ; les comptes choisis ici prennent alors leur place.</p>}
      <div className="divide-y border rounded-ui">
        {roles.map((r) => (
          <div key={r.code} className="flex items-center justify-between gap-3 px-3 py-2 flex-wrap">
            <div>
              <div className="text-ui font-medium text-gray-800">{r.label}</div>
              {demoNames && r.demo_name && <div className="text-ui-sm text-[rgb(var(--c-warning))]">Démonstration : {r.demo_name}{r.demo_deputy_name ? `, suppléant ${r.demo_deputy_name}` : ''}</div>}
            </div>
            <div className="flex items-center gap-2">
              {busy === r.code && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
              <select className="select min-w-[200px]" aria-label={`Titulaire : ${r.label}`} value={r.profile_id || ''} disabled={busy === r.code} onChange={(e) => choose(r, e.target.value)}>
                <option value="">Non désigné</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{personName(p)}</option>)}
              </select>
              <select className="select min-w-[200px]" aria-label={`Suppléant : ${r.label}`} value={r.deputy_profile_id || ''} disabled={busy === r.code} onChange={(e) => chooseDeputy(r, e.target.value)}>
                <option value="">Sans suppléant</option>
                {profiles.filter((p) => p.id !== r.profile_id).map((p) => <option key={p.id} value={p.id}>Suppléant : {personName(p)}</option>)}
              </select>
            </div>
          </div>
        ))}
        {roles.length === 0 && <div className="px-3 py-3 text-ui text-gray-500">Aucun rôle qualité en base.</div>}
      </div>
    </>
  )
}

// Agenda Google de l'utilisateur : ses sessions, RDV, rappels et événements y sont copiés chaque heure
// (le compte de service Google doit avoir accès à cet agenda)
function GcalCell({ profile, onSave }) {
  const [value, setValue] = useState(profile.gcal_id || '')
  useEffect(() => { setValue(profile.gcal_id || '') }, [profile.gcal_id])
  return (
    <div className="flex items-center gap-2" style={{ minWidth: 230 }}>
      <Toggle checked={!!profile.gcal_enabled} onChange={(v) => onSave({ gcal_enabled: v, gcal_id: value.trim() || profile.gcal_id || profile.email })} label="" />
      {profile.gcal_enabled && (
        <input className="input" style={{ minHeight: 32 }} aria-label={`Agenda Google de ${profile.display_name || profile.email}`}
          placeholder={profile.email} value={value} onChange={(e) => setValue(e.target.value)}
          onBlur={() => { const v = value.trim(); if (v !== (profile.gcal_id || '')) onSave({ gcal_id: v || null }) }} />
      )}
    </div>
  )
}

function UsersSection({ isSuperadmin }) {
  const [profiles, setProfiles] = useState([])
  // Compte relié à sa fiche formateur : nom et téléphone identiques des deux côtés (migration 0038)
  const [trainers, setTrainers] = useState([])
  const [invite, setInvite] = useState({ email: '', display_name: '', role: 'gestionnaire' })
  const [busy, setBusy] = useState(false)
  const [resetLink, setResetLink] = useState(null)
  const me = useAuthStore((s) => s.profile)

  const load = async () => {
    const [{ data }, { data: tr }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('trainers').select('id, first_name, last_name').order('last_name'),
    ])
    setProfiles(data || [])
    setTrainers(tr || [])
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
      if (r.link) { setResetLink(r.link); toast.success('Lien de réinitialisation généré') }
      else { setResetLink(null); toast.success('Lien de réinitialisation envoyé par email') }
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
          <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Fiche formateur</th><th>Agenda Google</th><th>Actif</th><th></th></tr></thead>
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
                <td>
                  <select className="select" style={{ minHeight: 32, width: 190 }} aria-label={`Fiche formateur de ${p.display_name || p.email}`} value={p.trainer_id || ''}
                    onChange={(e) => update(p.id, { trainer_id: e.target.value || null })}>
                    <option value="">Aucune</option>
                    {trainers.filter((t) => t.id === p.trainer_id || !profiles.some((x) => x.trainer_id === t.id)).map((t) => <option key={t.id} value={t.id}>{[t.first_name, t.last_name].filter(Boolean).join(' ')}</option>)}
                  </select>
                </td>
                <td><GcalCell profile={p} onSave={(patch) => update(p.id, patch)} /></td>
                <td><Toggle checked={p.is_active} onChange={(v) => update(p.id, { is_active: v })} label="" /></td>
                <td className="text-right whitespace-nowrap">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => reset(p.email)} disabled={busy}><KeyRound className="w-4 h-4" />Mot de passe</button>
                  {isSuperadmin && p.id !== me?.id && <button type="button" className="btn btn-ghost btn-sm text-[rgb(var(--c-danger))]" onClick={() => remove(p)}><Trash2 className="w-4 h-4" /></button>}
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
  // Coordonnées du comptable : colonnes des paramètres de l'organisme (une seule ligne, une seule source)
  const { organization, fetchOrganization, updateOrganization } = useDataStore()
  const [form, setForm] = useState({ comptable_email: '', comptable_name: '', comptable_cc: '', comptable_bcc: '' })
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!organization) fetchOrganization() }, [organization, fetchOrganization])
  useEffect(() => {
    if (organization) setForm({ comptable_email: organization.comptable_email || '', comptable_name: organization.comptable_name || '', comptable_cc: organization.comptable_cc || '', comptable_bcc: organization.comptable_bcc || '' })
  }, [organization?.id])
  const save = async () => {
    setSaving(true)
    if (!organization?.id) await fetchOrganization()
    const r = await updateOrganization(form)
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
    </>
  )
}

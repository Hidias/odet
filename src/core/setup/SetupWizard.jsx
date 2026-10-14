import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Building2, MapPin, Palette, Layers, Users, CheckCircle, ChevronRight, ChevronLeft, Loader2, Upload, Trash2, Sparkles, Mail, Plus, X,
} from 'lucide-react'
import { useDataStore, useAuthStore } from '../store'
import { callApi } from '../api'
import { useBranding, applyBranding } from '../branding/BrandingProvider'
import { FONT_PAIRS } from '../branding/presets'
import { Field, Toggle, FORMES, ROLES, ROLE_HINTS, uploadBrandingFile, ModulesSection, ColorPicker, THEMES } from '../settings/shared'
import { APP_VERSION } from '../version'

// Assistant de configuration d'une instance : exécuté à la première connexion d'un administrateur
// (setup_completed = false) ou relancé depuis la console. Chaque étape enregistre au fur et à mesure.

const STEPS = [
  { id: 'bienvenue', label: 'Bienvenue', icon: Sparkles },
  { id: 'identite', label: 'Identité', icon: Building2 },
  { id: 'contact', label: 'Contact', icon: MapPin },
  { id: 'marque', label: 'Marque', icon: Palette },
  { id: 'modules', label: 'Modules', icon: Layers },
  { id: 'equipe', label: 'Équipe', icon: Users },
  { id: 'fin', label: 'Terminé', icon: CheckCircle },
]

const FIELDS = [
  'name', 'app_name', 'app_short_name', 'activity_kind', 'legal_name', 'forme_juridique', 'siret', 'naf', 'tva_intra', 'tva_applicable',
  'nda', 'nda_region', 'qualiopi_certified', 'address', 'postal_code', 'city', 'lieu_signature', 'phone', 'email', 'website',
  'dirigeant_name', 'dirigeant_title', 'brand_primary', 'brand_accent', 'brand_highlight', 'brand_nav', 'font_pair', 'logo_url', 'logo_on_dark_url', 'doc_prefix',
]

export default function SetupWizard() {
  const navigate = useNavigate()
  const { organization, fetchOrganization, updateOrganization } = useDataStore()
  const { userRole, refreshModules, profile } = useAuthStore()
  const { branding, refresh: refreshBranding } = useBranding()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [invites, setInvites] = useState([{ email: '', role: 'gestionnaire', sent: false }])

  useEffect(() => { fetchOrganization() }, [])
  useEffect(() => {
    if (organization && !form) {
      const f = {}
      FIELDS.forEach((k) => { f[k] = organization[k] ?? '' })
      if (!f.brand_primary) { f.brand_primary = THEMES[0].primary; f.brand_accent = THEMES[0].accent; f.brand_highlight = THEMES[0].highlight; f.brand_nav = THEMES[0].primary }
      if (!f.font_pair) f.font_pair = 'atelier'
      if (!f.activity_kind) f.activity_kind = 'of'
      if (f.tva_applicable === '') f.tva_applicable = true
      if (f.name === 'Nouvelle instance') f.name = ''
      setForm(f)
      setStep(Math.min(organization.setup_step || 0, STEPS.length - 1))
    }
  }, [organization])

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  // Aperçu immédiat de la marque pendant la configuration
  useEffect(() => {
    if (!form) return
    applyBranding({ ...branding, brand_primary: form.brand_primary, brand_accent: form.brand_accent, brand_highlight: form.brand_highlight, brand_nav: form.brand_nav, font_pair: form.font_pair, app_name: form.app_name || branding.app_name })
  }, [form?.brand_primary, form?.brand_accent, form?.brand_highlight, form?.brand_nav, form?.font_pair])

  const missingForDocs = useMemo(() => {
    const m = []
    if (!form) return m
    if (!form.siret) m.push('SIRET')
    if (!form.nda) m.push('NDA')
    if (!form.phone) m.push('téléphone')
    if (!form.dirigeant_name) m.push('signataire')
    return m
  }, [form])

  const canAdmin = ['superadmin', 'admin'].includes(userRole)
  if (!canAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'rgb(var(--ground))' }}>
        <div className="card max-w-md text-center">
          <h1 className="section-title">Instance en cours de configuration</h1>
          <p className="muted mt-2">Un administrateur doit terminer la configuration avant l'ouverture de l'application.</p>
        </div>
      </div>
    )
  }

  if (!form) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-accent-500" /></div>

  const persist = async (extra = {}) => {
    const payload = { ...form, ...extra }
    payload.siret = (payload.siret || '').replace(/\s/g, '')
    payload.siren = payload.siret ? payload.siret.slice(0, 9) : ''
    payload.nda = (payload.nda || '').replace(/\s/g, '')
    if (!payload.legal_name) payload.legal_name = payload.name
    if (!payload.app_name) payload.app_name = payload.name
    if (!payload.app_short_name) payload.app_short_name = (payload.app_name || payload.name || '').slice(0, 12)
    if (!payload.lieu_signature) payload.lieu_signature = payload.city
    if (!payload.doc_prefix) payload.doc_prefix = (payload.app_short_name || payload.name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase()
    const { error } = await updateOrganization(payload)
    if (error) throw error
  }

  const validate = () => {
    const id = STEPS[step].id
    if (id === 'bienvenue' && !form.name.trim()) return 'Le nom de votre organisme est requis'
    if (id === 'identite') {
      const siret = (form.siret || '').replace(/\s/g, '')
      if (siret && !/^\d{14}$/.test(siret)) return 'Le SIRET doit contenir 14 chiffres'
      const nda = (form.nda || '').replace(/\s/g, '')
      if (nda && !/^\d{11}$/.test(nda)) return 'Le NDA doit contenir 11 chiffres (ou rester vide tant qu\'il n\'est pas obtenu)'
    }
    if (id === 'contact') {
      if (!form.address || !form.postal_code || !form.city) return 'L\'adresse complète est requise (elle figure sur tous les documents)'
      if (!form.email) return 'Une adresse email de contact est requise'
    }
    return null
  }

  const next = async () => {
    const err = validate()
    if (err) return toast.error(err)
    setSaving(true)
    try {
      await persist({ setup_step: step + 1 })
      setStep((s) => Math.min(s + 1, STEPS.length - 1))
    } catch (e) {
      toast.error('Enregistrement impossible : ' + e.message)
    } finally {
      setSaving(false)
    }
  }
  const prev = () => setStep((s) => Math.max(0, s - 1))

  const finish = async () => {
    setSaving(true)
    try {
      await persist({ setup_completed: true, setup_step: STEPS.length - 1 })
      await refreshBranding()
      await refreshModules()
      toast.success('Votre instance est prête')
      navigate('/', { replace: true })
    } catch (e) {
      toast.error('Enregistrement impossible : ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const onLogo = (key) => async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const url = await uploadBrandingFile(file, key)
      set(key, url)
      toast.success('Logo chargé')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const sendInvite = async (i) => {
    const inv = invites[i]
    if (!inv.email) return
    try {
      await callApi('/api/admin-users', { action: 'invite', email: inv.email, role: inv.role })
      setInvites((list) => list.map((x, k) => (k === i ? { ...x, sent: true } : x)))
      toast.success(`Invitation envoyée à ${inv.email}`)
    } catch (e) {
      toast.error(e.message)
    }
  }

  const current = STEPS[step]

  return (
    <div className="min-h-screen flex flex-col lg:flex-row" style={{ background: 'rgb(var(--ground))' }}>
      {/* Colonne de progression */}
      <aside className="lg:w-80 bg-nav text-nav-fg p-6 lg:p-10 flex flex-col">
        <div className="flex items-center gap-3 mb-8">
          {form.logo_on_dark_url || form.logo_url ? (
            <img src={form.logo_on_dark_url || form.logo_url} alt="" className="h-10 w-auto max-w-[140px] object-contain bg-white/90 rounded-ui-sm p-1" />
          ) : (
            <div className="w-10 h-10 rounded-ui bg-accent-500 text-accent-fg flex items-center justify-center font-display font-bold">{(form.name || 'O').slice(0, 1)}</div>
          )}
          <div className="min-w-0">
            <div className="font-display font-semibold truncate">{form.app_name || form.name || 'Nouvelle instance'}</div>
            <div className="text-ui-sm opacity-60">Configuration</div>
          </div>
        </div>
        <ol className="space-y-1 flex-1">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const done = i < step
            const active = i === step
            return (
              <li key={s.id}>
                <button type="button" onClick={() => i < step && setStep(i)} disabled={i > step}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-ui text-left transition-colors ${active ? 'bg-white/10' : done ? 'opacity-90 hover:bg-white/5' : 'opacity-40'}`}>
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center flex-none ${done ? 'bg-accent-500 text-accent-fg' : active ? 'bg-white text-gray-900' : 'bg-white/10'}`}>
                    {done ? <CheckCircle className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </span>
                  <span className="text-ui font-medium">{s.label}</span>
                </button>
              </li>
            )
          })}
        </ol>
        <div className="text-ui-sm opacity-40 mt-6">Version {APP_VERSION}</div>
      </aside>

      {/* Contenu */}
      <main className="flex-1 p-5 lg:p-12 max-w-4xl w-full mx-auto">
        <div className="card space-y-6 animate-fadeIn" key={current.id}>
          {current.id === 'bienvenue' && (
            <>
              <div>
                <h1 className="page-title">Bienvenue{profile?.first_name ? `, ${profile.first_name}` : ''}</h1>
                <p className="muted mt-1">Quelques minutes suffisent pour configurer votre instance. Tout reste modifiable ensuite dans Paramètres.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Nom de votre organisme" hint="Nom usuel, tel qu'il apparaît pour vos clients" className="md:col-span-2">
                  <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus placeholder="Nom commercial de l'organisme" />
                </Field>
                <Field label="Nom de l'application" hint="Titre de l'onglet et de l'icône sur les téléphones. Vide : nom de l'organisme">
                  <input className="input" value={form.app_name} onChange={(e) => set('app_name', e.target.value)} placeholder={form.name || 'Nom de votre outil'} />
                </Field>
                <Field label="Nom court" hint="12 caractères maximum, sous l'icône">
                  <input className="input" maxLength={12} value={form.app_short_name} onChange={(e) => set('app_short_name', e.target.value)} placeholder={(form.app_name || form.name || '').slice(0, 12)} />
                </Field>
                <Field label="Activité principale" className="md:col-span-2">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {[['of', 'Organisme de formation', 'Sessions, Qualiopi, conventions'], ['entreprise', 'Entreprise', 'Interventions, collaborateurs, frais'], ['mixte', 'Les deux', 'Formation et activité d\'entreprise']].map(([v, l, h]) => (
                      <button key={v} type="button" onClick={() => set('activity_kind', v)}
                        className={`rounded-ui border p-3 text-left ${form.activity_kind === v ? 'border-accent-500 ring-2 ring-accent-500/20' : 'border-gray-200 hover:border-gray-300'}`}>
                        <div className="text-ui font-medium">{l}</div>
                        <div className="text-ui-sm text-gray-500">{h}</div>
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            </>
          )}

          {current.id === 'identite' && (
            <>
              <div>
                <h1 className="page-title">Identité légale</h1>
                <p className="muted mt-1">Ces informations figurent sur les conventions, attestations, devis et factures.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Raison sociale" hint="Vide : nom de l'organisme"><input className="input" value={form.legal_name} onChange={(e) => set('legal_name', e.target.value)} placeholder={form.name} /></Field>
                <Field label="Forme juridique">
                  <select className="select" value={form.forme_juridique} onChange={(e) => set('forme_juridique', e.target.value)}>
                    <option value="">Choisir</option>{FORMES.map((f) => <option key={f}>{f}</option>)}
                  </select>
                </Field>
                <Field label="SIRET" hint="14 chiffres"><input className="input" value={form.siret} onChange={(e) => set('siret', e.target.value)} placeholder="830 695 649 00020" /></Field>
                <Field label="Code NAF"><input className="input" value={form.naf} onChange={(e) => set('naf', e.target.value)} placeholder="8559A" /></Field>
                <Field label="TVA intracommunautaire"><input className="input" value={form.tva_intra} onChange={(e) => set('tva_intra', e.target.value)} placeholder="FR12345678901" /></Field>
                <div className="pt-6"><Toggle checked={form.tva_applicable !== false} onChange={(v) => set('tva_applicable', v)} label="TVA applicable" hint="Décoché : mention d'exonération sur les factures" /></div>
                <Field label="Numéro de déclaration d'activité (NDA)" hint="11 chiffres. Laissez vide tant qu'il n'est pas obtenu : les conventions seront bloquées jusque-là"><input className="input" value={form.nda} onChange={(e) => set('nda', e.target.value)} /></Field>
                <Field label="Région du préfet (NDA)"><input className="input" value={form.nda_region} onChange={(e) => set('nda_region', e.target.value)} placeholder="Région du siège" /></Field>
                <div className="md:col-span-2"><Toggle checked={!!form.qualiopi_certified} onChange={(v) => set('qualiopi_certified', v)} label="Certifié Qualiopi" hint="Ajoute la mention sur les documents et le portail" /></div>
              </div>
            </>
          )}

          {current.id === 'contact' && (
            <>
              <div>
                <h1 className="page-title">Adresse, contact et signataire</h1>
                <p className="muted mt-1">L'adresse complète apparaît sur chaque document ; le signataire signe conventions et attestations.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                <Field label="Adresse" className="md:col-span-6"><input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="33 ZA de Penhoad Braz" /></Field>
                <Field label="Code postal" className="md:col-span-2"><input className="input" value={form.postal_code} onChange={(e) => set('postal_code', e.target.value)} placeholder="29700" /></Field>
                <Field label="Ville" className="md:col-span-4"><input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Ville" /></Field>
                <Field label="Téléphone" className="md:col-span-2"><input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
                <Field label="Email de contact" className="md:col-span-2"><input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
                <Field label="Site web" className="md:col-span-2"><input className="input" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" /></Field>
                <Field label="Nom du signataire" hint="Dirigeant ou responsable habilité" className="md:col-span-3"><input className="input" value={form.dirigeant_name} onChange={(e) => set('dirigeant_name', e.target.value)} /></Field>
                <Field label="Fonction du signataire" className="md:col-span-3"><input className="input" value={form.dirigeant_title} onChange={(e) => set('dirigeant_title', e.target.value)} placeholder="Gérant" /></Field>
              </div>
            </>
          )}

          {current.id === 'marque' && (
            <>
              <div>
                <h1 className="page-title">Marque</h1>
                <p className="muted mt-1">Logo, couleurs et polices s'appliquent à l'application, au portail stagiaire et aux documents PDF.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Logo" hint="PNG ou SVG sur fond clair ou transparent">
                  <div className="flex items-center gap-3 flex-wrap">
                    {form.logo_url && <img src={form.logo_url} alt="" className="h-14 border rounded-ui-sm bg-white p-1" />}
                    <label className="btn btn-secondary cursor-pointer"><Upload className="w-4 h-4" />Choisir<input type="file" accept="image/*" className="hidden" onChange={onLogo('logo_url')} /></label>
                    {form.logo_url && <button type="button" className="btn btn-ghost" onClick={() => set('logo_url', '')}><Trash2 className="w-4 h-4" />Retirer</button>}
                  </div>
                </Field>
                <Field label="Logo pour fond sombre (facultatif)" hint="Version claire pour le menu">
                  <div className="flex items-center gap-3 flex-wrap">
                    {form.logo_on_dark_url && <img src={form.logo_on_dark_url} alt="" className="h-14 border rounded-ui-sm p-1" style={{ background: 'rgb(var(--c-nav))' }} />}
                    <label className="btn btn-secondary cursor-pointer"><Upload className="w-4 h-4" />Choisir<input type="file" accept="image/*" className="hidden" onChange={onLogo('logo_on_dark_url')} /></label>
                    {form.logo_on_dark_url && <button type="button" className="btn btn-ghost" onClick={() => set('logo_on_dark_url', '')}><Trash2 className="w-4 h-4" />Retirer</button>}
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
              <Field label="Initiales de l'entreprise" hint="2 à 5 lettres ou chiffres : références des sessions et codes des documents. Vide : déduites du nom court">
                <input className="input max-w-[160px]" maxLength={5} value={form.doc_prefix} onChange={(e) => set('doc_prefix', e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} placeholder={(form.app_short_name || form.name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase()} />
              </Field>
            </>
          )}

          {current.id === 'modules' && (
            <>
              <div>
                <h1 className="page-title">Modules</h1>
                <p className="muted mt-1">Activez ce dont vous avez besoin. Un module désactivé disparaît du menu ; rien n'est supprimé.</p>
              </div>
              <ModulesSection compact onChanged={refreshModules} />
            </>
          )}

          {current.id === 'equipe' && (
            <>
              <div>
                <h1 className="page-title">Votre équipe</h1>
                <p className="muted mt-1">Invitez vos collègues maintenant ou plus tard depuis Paramètres. Chacun reçoit un email pour choisir son mot de passe.</p>
              </div>
              <div className="space-y-3">
                {invites.map((inv, i) => (
                  <div key={i} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <input className="input sm:flex-1" type="email" placeholder="prenom.nom@exemple.fr" value={inv.email} disabled={inv.sent} onChange={(e) => setInvites((l) => l.map((x, k) => (k === i ? { ...x, email: e.target.value } : x)))} />
                    <select className="select sm:w-56" value={inv.role} disabled={inv.sent} onChange={(e) => setInvites((l) => l.map((x, k) => (k === i ? { ...x, role: e.target.value } : x)))}>
                      {ROLES.filter(([r]) => r !== 'superadmin' || userRole === 'superadmin').map(([r, l]) => <option key={r} value={r}>{l}</option>)}
                    </select>
                    {inv.sent ? (
                      <span className="badge badge-success"><CheckCircle className="w-3.5 h-3.5" /> Envoyée</span>
                    ) : (
                      <button type="button" onClick={() => sendInvite(i)} className="btn btn-secondary" disabled={!inv.email}><Mail className="w-4 h-4" /> Inviter</button>
                    )}
                    {invites.length > 1 && !inv.sent && (
                      <button type="button" onClick={() => setInvites((l) => l.filter((_, k) => k !== i))} className="btn btn-ghost btn-icon"><X className="w-4 h-4" /></button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => setInvites((l) => [...l, { email: '', role: 'gestionnaire', sent: false }])} className="btn btn-ghost btn-sm"><Plus className="w-4 h-4" /> Ajouter une personne</button>
              </div>
              <div className="rounded-ui bg-gray-50 p-4 text-ui-sm text-gray-600 space-y-1">
                {ROLES.map(([r, l]) => <div key={r}><span className="font-medium text-gray-900">{l}</span> : {ROLE_HINTS[r]}</div>)}
              </div>
            </>
          )}

          {current.id === 'fin' && (
            <>
              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-full bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-9 h-9" />
                </div>
                <h1 className="page-title">{form.app_name || form.name} est prêt</h1>
                <p className="muted mt-1">Récapitulatif de la configuration. Tout reste modifiable dans Paramètres.</p>
              </div>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-ui">
                {[['Organisme', form.name], ['Raison sociale', form.legal_name || form.name], ['SIRET', form.siret || 'non renseigné'], ['NDA', form.nda || 'en cours'],
                  ['Adresse', `${form.address}, ${form.postal_code} ${form.city}`], ['Contact', [form.phone, form.email].filter(Boolean).join(', ')],
                  ['Signataire', form.dirigeant_name ? `${form.dirigeant_name}${form.dirigeant_title ? `, ${form.dirigeant_title}` : ''}` : 'non renseigné'], ['Qualiopi', form.qualiopi_certified ? 'certifié' : 'non']].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-gray-100 py-1.5"><dt className="text-gray-500">{k}</dt><dd className="text-right font-medium text-gray-900">{v}</dd></div>
                ))}
              </dl>
              {missingForDocs.length > 0 && (
                <div className="rounded-ui p-3 text-ui" style={{ background: 'rgb(var(--c-warning-bg))', color: 'rgb(var(--c-warning))' }}>
                  À compléter avant de générer des conventions : {missingForDocs.join(', ')}.
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <button type="button" onClick={prev} disabled={step === 0 || saving} className="btn btn-ghost"><ChevronLeft className="w-4 h-4" /> Précédent</button>
            {current.id === 'fin' ? (
              <button type="button" onClick={finish} disabled={saving} className="btn btn-primary">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Ouvrir l'application</button>
            ) : (
              <button type="button" onClick={next} disabled={saving} className="btn btn-primary">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {current.id === 'equipe' || current.id === 'modules' ? 'Continuer' : 'Enregistrer et continuer'} <ChevronRight className="w-4 h-4" /></button>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

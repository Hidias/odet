import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../supabase'

// Éléments partagés entre Paramètres, l'assistant de configuration et la console.

export const THEMES = [
  { key: 'anthracite-rouge', label: 'Anthracite et rouge', primary: '#1C2024', accent: '#C8102E', highlight: '#D9A62E' },
  { key: 'petrole-or', label: 'Pétrole et or', primary: '#0F2D35', accent: '#0F2D35', highlight: '#E9B44C' },
  { key: 'marine-corail', label: 'Bleu marine et corail', primary: '#1E3A5F', accent: '#E07A5F', highlight: '#F2C14E' },
  { key: 'foret-sable', label: 'Forêt et sable', primary: '#2F5D50', accent: '#2F5D50', highlight: '#C9A66B' },
  { key: 'ardoise-ambre', label: 'Ardoise et ambre', primary: '#3B4252', accent: '#D08C2E', highlight: '#E3B23C' },
  { key: 'bordeaux-creme', label: 'Bordeaux et crème', primary: '#6B1F2A', accent: '#6B1F2A', highlight: '#E8D8B5' },
  { key: 'prune-menthe', label: 'Prune et menthe', primary: '#4A2A5A', accent: '#5FB49C', highlight: '#F3D06A' },
  { key: 'ocean-citron', label: 'Océan et citron', primary: '#0B4F6C', accent: '#0B4F6C', highlight: '#C7D23A' },
]

export const FORMES = ['SARL', 'EURL', 'SAS', 'SASU', 'SA', 'EI', 'Association', 'Autre']

export const ROLES = [
  ['superadmin', 'Super administrateur'], ['admin', 'Administrateur'], ['direction', 'Direction'], ['gestionnaire', 'Gestionnaire'],
  ['formateur', 'Formateur'], ['commercial', 'Commercial'], ['comptable', 'Comptable'], ['lecture', 'Lecture seule'],
]

export const ROLE_HINTS = {
  superadmin: 'Installation, reconfiguration, déverrouillage des évaluations',
  admin: 'Tout sauf la console technique ; gère les accès',
  direction: 'Écriture sur tout, sauf les évaluations',
  gestionnaire: 'Sessions, stagiaires, documents, facturation',
  formateur: 'Ses sessions, émargements, évaluations',
  commercial: 'Clients, devis, prospection',
  comptable: 'Espace comptable uniquement',
  lecture: 'Consultation seule',
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="text-ui-sm text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint, disabled = false }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => !disabled && onChange(!checked)}
        className={`mt-0.5 relative w-10 h-6 rounded-full transition-colors flex-none ${checked ? 'bg-accent-500' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </button>
      {(label || hint) && (
        <span className="min-w-0"><span className="block text-ui font-medium text-gray-900">{label}</span>{hint && <span className="block text-ui-sm text-gray-500">{hint}</span>}</span>
      )}
    </label>
  )
}

export async function uploadBrandingFile(file, name) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase()
  const path = `branding/${name}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('media').upload(path, file, { upsert: true, contentType: file.type })
  if (error) throw error
  const { data } = supabase.storage.from('media').getPublicUrl(path)
  return data.publicUrl
}

export function ModulesSection({ onChanged, compact = false }) {
  const [modules, setModules] = useState([])
  const load = async () => {
    const { data } = await supabase.from('org_modules').select('*').order('position')
    setModules(data || [])
  }
  useEffect(() => { load() }, [])
  const toggle = async (m) => {
    const { error } = await supabase.from('org_modules').update({ enabled: !m.enabled, updated_at: new Date().toISOString() }).eq('key', m.key)
    if (error) return toast.error(error.message)
    await load()
    if (onChanged) await onChanged()
  }
  // Réglages propres à un module (org_modules.settings)
  const setOption = async (m, key, value) => {
    const settings = { ...(m.settings || {}), [key]: value }
    const { error } = await supabase.from('org_modules').update({ settings, updated_at: new Date().toISOString() }).eq('key', m.key)
    if (error) return toast.error(error.message)
    await load()
  }
  return (
    <>
      {!compact && (
        <>
          <h2 className="section-title">Modules activés</h2>
          <p className="muted">Un module désactivé disparaît du menu et des tableaux de bord. Les données ne sont pas supprimées.</p>
        </>
      )}
      <div className="divide-y divide-gray-100">
        {modules.map((m) => (
          <div key={m.key} className="py-3 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-ui font-medium">{m.label}</div>
              {m.description ? <div className="text-ui-sm text-gray-500">{m.description}</div> : <div className="text-ui-sm text-gray-400">{m.key}</div>}
            </div>
            <Toggle checked={m.enabled} onChange={() => toggle(m)} />
            {!compact && m.key === 'prospection' && m.enabled && (
              <div className="basis-full pl-4 border-l-2 border-gray-100">
                <Toggle checked={m.settings?.auto_import === true} onChange={(v) => setOption(m, 'auto_import', v)}
                  label="Import automatique de nuit" hint="Chaque nuit, ajoute à la base prospects les entreprises des départements de la zone d'intervention (Paramètres > Identité), depuis le répertoire public des entreprises" />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

// Palette de couleurs : boutons de thèmes prédéfinis + réglage fin
export function ColorPicker({ form, set }) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {THEMES.map((t) => {
          const on = form.brand_primary === t.primary && form.brand_accent === t.accent
          return (
            <button key={t.key} type="button"
              onClick={() => { set('brand_primary', t.primary); set('brand_accent', t.accent); set('brand_highlight', t.highlight); set('brand_nav', t.primary) }}
              className={`rounded-ui border p-3 text-left ${on ? 'border-accent-500 ring-2 ring-accent-500/20' : 'border-gray-200 hover:border-gray-300'}`}>
              <div className="flex gap-1.5 mb-2">
                <span className="w-6 h-6 rounded" style={{ background: t.primary }} /><span className="w-6 h-6 rounded" style={{ background: t.accent }} /><span className="w-6 h-6 rounded" style={{ background: t.highlight }} />
              </div>
              <div className="text-ui-sm font-medium">{t.label}</div>
            </button>
          )
        })}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        {[['brand_primary', 'Principale'], ['brand_accent', 'Accent (boutons)'], ['brand_highlight', 'Rehaut (badges)'], ['brand_nav', 'Fond du menu']].map(([k, l]) => (
          <Field key={k} label={l}>
            <div className="flex items-center gap-2">
              <input type="color" value={form[k] || '#000000'} onChange={(e) => set(k, e.target.value)} className="w-10 h-10 rounded border p-0.5" />
              <input className="input" value={form[k] || ''} onChange={(e) => set(k, e.target.value)} placeholder="#000000" />
            </div>
          </Field>
        ))}
      </div>
    </>
  )
}

// ════════════════════════════════════════════════════════════════
// PrepRdvModal.jsx - Préparer un RDV (fin de session ou suivi)
// Enregistre dans prospect_rdv.prep_data et génère le PDF.
// ════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { X, Loader2, FileDown, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../../core/supabase'
import { loadCallContext, themeOfTitle } from '../../lib/callContext'
import { THEMES, labelOf } from '../../lib/phoningLabels'
import { generatePrepRdvPDF } from '../../pdf/pdfPreparationRdv'
import { fmtDate, kitCategoryLabel } from './suiviUtils'
import { loadTemplateContext, fillTemplate } from '../../../../core/org/templateContext'

const DEFAULT_QUESTIONS = [
  'Combien de salariés par site, et sur quels postes ?',
  'Qui est formé aujourd\'hui (secourisme, incendie, conduite, électricité), et depuis quand ?',
  'Quels accidents ou presque-accidents ces dernières années ?',
  'Quelles contraintes d\'organisation : horaires, saisonnalité, équipes ?',
  'Qui décide, et quel est le calendrier de décision ?',
  'Quel est votre OPCO, et comment financez-vous la formation ?',
  'Peut-on voir les postes aujourd\'hui ?',
].join('\n')

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm'

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
      {children}
    </label>
  )
}

export default function PrepRdvModal({ rdvId, clientName, onClose, onDone }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rdv, setRdv] = useState(null)
  const [ctx, setCtx] = useState(null)
  const [argumentsList, setArgumentsList] = useState([])
  const [kitDocs, setKitDocs] = useState([])
  const [heardObjections, setHeardObjections] = useState([])
  const [form, setForm] = useState({
    themes: [], effectif: '', sites: '', metiers: '', opco: '', decideur: '',
    besoin: '', objections: [], questions: DEFAULT_QUESTIONS, documents: [], notes: '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: r, error } = await supabase.from('prospect_rdv').select('*, clients (*)').eq('id', rdvId).single()
        if (error) throw error
        const [context, argsRes, kitRes, callsRes, objRes] = await Promise.all([
          loadCallContext({ clientId: r.client_id }),
          supabase.from('call_arguments').select('*').eq('is_active', true).order('sort_order'),
          supabase.from('rdv_kit_documents').select('*').eq('is_active', true).order('category').order('title'),
          supabase.from('prospect_calls').select('objection_codes').eq('client_id', r.client_id).not('objection_codes', 'is', null).limit(20),
          supabase.from('call_objections').select('code, label'),
        ])
        if (cancelled) return
        const codes = new Set((callsRes.data || []).flatMap(c => c.objection_codes || []))
        const heard = (objRes.data || []).filter(o => codes.has(o.code)).map(o => o.label)

        const saved = r.prep_data && Object.keys(r.prep_data).length > 0 ? r.prep_data : null
        const fromInterest = (r.formations_interet || []).map(t => themeOfTitle(t)).filter(Boolean)
        const kit = kitRes.data || []
        setRdv(r)
        setCtx(context)
        // Textes d'argumentaire : champs {{org.nom}}, {{app.nom}} remplis depuis les paramètres
        const tpl = await loadTemplateContext().catch(() => null)
        if (cancelled) return
        setArgumentsList((argsRes.data || []).map(a => ({ ...a, say_text: fillTemplate(a.say_text, tpl), detail: fillTemplate(a.detail, tpl), title: fillTemplate(a.title, tpl) })))
        setKitDocs(kit)
        setHeardObjections(heard)
        setForm(saved ? { ...form, ...saved } : {
          ...form,
          themes: Array.from(new Set(fromInterest)),
          effectif: r.clients?.effectif || r.clients?.taille_entreprise || '',
          opco: r.clients?.opco_name || '',
          decideur: r.contact_name || r.clients?.contact_name || '',
          objections: heard,
          documents: kit.filter(d => d.category === 'toujours').map(d => d.id),
        })
      } catch (err) {
        toast.error('Chargement impossible : ' + err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [rdvId])

  const toggle = (key, value) => set(key, form[key].includes(value) ? form[key].filter(x => x !== value) : [...form[key], value])

  const payload = () => ({
    ...form,
    themeLabels: form.themes.filter(t => t !== 'opco').map(t => labelOf(THEMES, t)),
  })

  const save = async () => {
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const { error } = await supabase.from('prospect_rdv')
        .update({ prep_data: payload(), prep_done_at: now, updated_at: now })
        .eq('id', rdvId)
      if (error) throw error
      toast.success('Préparation enregistrée')
      onDone?.()
      return true
    } catch (err) {
      toast.error('Enregistrement impossible : ' + err.message)
      return false
    } finally { setSaving(false) }
  }

  const pdf = async () => {
    const ok = await save()
    if (!ok) return
    try {
      await generatePrepRdvPDF({
        rdv,
        clientName: clientName || rdv?.clients?.name,
        client: rdv?.clients,
        ctx,
        prep: payload(),
        argumentsList,
        kitDocs,
        objectionLabels: [],
      })
    } catch (err) {
      console.error(err)
      toast.error('PDF impossible : ' + err.message)
    }
  }

  const suggestedKit = kitDocs.filter(d => d.category === 'toujours' || form.themes.includes(d.category))
  const otherKit = kitDocs.filter(d => !suggestedKit.includes(d))

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Préparer le RDV</h3>
            <p className="text-sm text-gray-500">
              {clientName || rdv?.clients?.name || ''}
              {rdv?.rdv_date ? ` · ${fmtDate(rdv.rdv_date)}` : ''}
              {rdv?.conducted_by ? ` · ${rdv.conducted_by}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Fermer">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Chargement</div>
          ) : (
            <>
              <Field label="Thèmes visés">
                <div className="flex flex-wrap gap-1.5">
                  {THEMES.map(t => (
                    <button key={t.value} type="button" onClick={() => toggle('themes', t.value)}
                      className={`px-2.5 py-1 rounded-md text-xs border ${
                        form.themes.includes(t.value) ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Effectif"><input className={inputCls} value={form.effectif} onChange={e => set('effectif', e.target.value)} /></Field>
                <Field label="Sites"><input className={inputCls} value={form.sites} onChange={e => set('sites', e.target.value)} /></Field>
                <Field label="Métiers et postes"><input className={inputCls} value={form.metiers} onChange={e => set('metiers', e.target.value)} /></Field>
                <Field label="OPCO"><input className={inputCls} value={form.opco} onChange={e => set('opco', e.target.value)} /></Field>
                <Field label="Qui décide"><input className={inputCls} value={form.decideur} onChange={e => set('decideur', e.target.value)} /></Field>
              </div>

              <Field label="Besoin exprimé">
                <textarea className={inputCls} rows={3} value={form.besoin} onChange={e => set('besoin', e.target.value)}
                  placeholder="Ce que le client attend, le nombre de personnes, les dates souhaitées" />
              </Field>

              {(heardObjections.length > 0 || form.objections.length > 0) && (
                <Field label="Objections entendues au téléphone">
                  <div className="space-y-1">
                    {Array.from(new Set([...heardObjections, ...form.objections])).map(o => (
                      <label key={o} className="flex items-start gap-2 text-sm text-gray-700">
                        <input type="checkbox" className="mt-0.5" checked={form.objections.includes(o)} onChange={() => toggle('objections', o)} />
                        {o}
                      </label>
                    ))}
                  </div>
                </Field>
              )}

              <Field label="Questions à poser (une par ligne)">
                <textarea className={inputCls} rows={6} value={form.questions} onChange={e => set('questions', e.target.value)} />
              </Field>

              <Field label="Documents du kit à prendre">
                {kitDocs.length === 0 ? (
                  <p className="text-sm text-gray-500">Le kit RDV est vide. Ajoutez des documents dans Suivi commercial, bloc « Kit RDV ».</p>
                ) : (
                  <div className="space-y-1">
                    {[...suggestedKit, ...otherKit].map(d => (
                      <label key={d.id} className="flex items-start gap-2 text-sm text-gray-700">
                        <input type="checkbox" className="mt-0.5" checked={form.documents.includes(d.id)} onChange={() => toggle('documents', d.id)} />
                        <span>{d.title} <span className="text-xs text-gray-400">({kitCategoryLabel(d.category)})</span></span>
                      </label>
                    ))}
                  </div>
                )}
              </Field>

              <Field label="Notes">
                <textarea className={inputCls} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
              </Field>

              <p className="text-xs text-gray-500">
                Le PDF reprend aussi l'historique, les arguments des thèmes choisis avec leurs références (à relire sur Légifrance),
                la liste « À apporter » et une grille de diagnostic express à remplir sur place.
              </p>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Fermer
          </button>
          <button onClick={save} disabled={saving || loading}
            className="flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            <Save className="w-4 h-4" /> Enregistrer
          </button>
          <button onClick={pdf} disabled={saving || loading}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            Enregistrer et télécharger le PDF
          </button>
        </div>
      </div>
    </div>
  )
}

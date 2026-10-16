// Séquences d'une formation du catalogue (suivi formatif) : activation, départ d'un modèle, tableau modifiable.
// Les sessions déjà préparées gardent leur copie : modifier le catalogue ne change pas une preuve passée.

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { X, Plus, Trash2, ArrowUp, ArrowDown, Loader2, Save, ChevronDown, ChevronRight } from 'lucide-react'
import { loadCourseSequences, saveCourseSequences, setCourseFormativeEnabled } from '../lib/sfData'
import { SEQUENCE_TEMPLATES, MODALITIES, templateByKey } from '../lib/sequenceTemplates'

const toText = (arr) => (arr || []).join(', ')
const fromText = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean)
const linesToArr = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean)

export default function CourseSequencesModal({ course, canEdit, onClose, onSaved }) {
  const [list, setList] = useState([])
  const [enabled, setEnabled] = useState(!!course.formative_enabled)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tpl, setTpl] = useState('')
  const [open, setOpen] = useState(null)

  useEffect(() => {
    let alive = true
    loadCourseSequences(course.id)
      .then((rows) => { if (alive) setList(rows) })
      .catch((e) => toast.error(e.message || 'Chargement impossible'))
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [course.id])

  const update = (i, patch) => setList((l) => l.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const move = (i, d) => setList((l) => {
    const j = i + d
    if (j < 0 || j >= l.length) return l
    const c = [...l]; [c[i], c[j]] = [c[j], c[i]]
    return c
  })
  const remove = (i) => setList((l) => l.filter((_, j) => j !== i))
  const add = () => { setList((l) => [...l, { title: '', competences: [], modality: 'oral', roles: [], success_indicators: [] }]); setOpen(list.length) }

  const applyTemplate = () => {
    const t = templateByKey(tpl)
    if (!t) return
    if (list.length && !window.confirm(`Remplacer les ${list.length} séquences actuelles par le modèle « ${t.label} » ? (rien n'est enregistré avant « Enregistrer »)`)) return
    setList(t.sequences.map((s) => ({ ...s, competences: [...s.competences], roles: [...s.roles], success_indicators: [...s.success_indicators] })))
    setOpen(null)
  }

  const save = async () => {
    setSaving(true)
    try {
      const rows = await saveCourseSequences(course.id, list)
      if (enabled !== !!course.formative_enabled) await setCourseFormativeEnabled(course.id, enabled)
      setList(rows)
      toast.success('Séquences enregistrées')
      onSaved?.({ count: rows.length, enabled })
      onClose()
    } catch (e) { toast.error(e.message || 'Enregistrement impossible') }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-label="Séquences et évaluation formative" className="bg-white rounded-ui shadow-md w-full max-w-4xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">Séquences et évaluation formative</h2>
            <p className="text-ui text-gray-500">{course.title} · copiées dans chaque nouvelle session ; une session commencée garde sa copie.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="p-2 hover:bg-gray-100 rounded"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <label className="flex items-center gap-2 text-ui min-h-[40px]">
              <input type="checkbox" checked={enabled} disabled={!canEdit} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4" />
              Suivi formatif pour cette formation
            </label>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="sf-tpl" className="text-ui text-gray-600">Partir d'un modèle</label>
                <select id="sf-tpl" value={tpl} onChange={(e) => setTpl(e.target.value)} className="input w-auto">
                  <option value="">Choisir…</option>
                  {SEQUENCE_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label} ({t.sequences.length})</option>)}
                </select>
                <button type="button" onClick={applyTemplate} disabled={!tpl} className="btn btn-secondary">Appliquer</button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : list.length === 0 ? (
            <p className="text-ui text-gray-500 text-center py-6">Aucune séquence. Partez d'un modèle ou ajoutez une séquence.</p>
          ) : (
            <ol className="space-y-2">
              {list.map((s, i) => {
                const isOpen = open === i
                return (
                  <li key={s.id || `n${i}`} className="border border-gray-200 rounded-ui-sm">
                    <div className="flex items-center gap-2 p-2">
                      <button type="button" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen} aria-label={isOpen ? 'Replier' : 'Déplier'} className="p-1.5 hover:bg-gray-100 rounded">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <span className="text-ui font-semibold text-gray-500 w-8">S{i + 1}</span>
                      <input aria-label={`Intitulé de la séquence ${i + 1}`} value={s.title} disabled={!canEdit} onChange={(e) => update(i, { title: e.target.value })} className="input flex-1 min-w-0" placeholder="Intitulé" />
                      <select aria-label={`Modalité de la séquence ${i + 1}`} value={s.modality} disabled={!canEdit} onChange={(e) => update(i, { modality: e.target.value })} className="input w-44 hidden sm:block">
                        {MODALITIES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </select>
                      {canEdit && (
                        <div className="flex">
                          <button type="button" onClick={() => move(i, -1)} aria-label="Monter" className="p-1.5 hover:bg-gray-100 rounded"><ArrowUp className="w-4 h-4" /></button>
                          <button type="button" onClick={() => move(i, 1)} aria-label="Descendre" className="p-1.5 hover:bg-gray-100 rounded"><ArrowDown className="w-4 h-4" /></button>
                          <button type="button" onClick={() => remove(i)} aria-label="Retirer" className="p-1.5 hover:bg-[rgb(var(--c-danger-bg))] rounded"><Trash2 className="w-4 h-4 text-[rgb(var(--c-danger))]" /></button>
                        </div>
                      )}
                    </div>
                    {isOpen && (
                      <div className="grid sm:grid-cols-2 gap-3 p-3 border-t border-gray-100 bg-gray-50">
                        <label className="text-ui sm:hidden">Modalité
                          <select value={s.modality} disabled={!canEdit} onChange={(e) => update(i, { modality: e.target.value })} className="input w-full mt-1">
                            {MODALITIES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                          </select>
                        </label>
                        <label className="text-ui">Compétences visées (séparées par des virgules)
                          <input value={s._competencesText ?? toText(s.competences)} disabled={!canEdit} onChange={(e) => update(i, { _competencesText: e.target.value, competences: fromText(e.target.value) })} className="input w-full mt-1" placeholder="C5, C8" />
                        </label>
                        <label className="text-ui">Rôles notés (le premier est le rôle principal)
                          <input value={s._rolesText ?? toText(s.roles)} disabled={!canEdit} onChange={(e) => update(i, { _rolesText: e.target.value, roles: fromText(e.target.value) })} className="input w-full mt-1" placeholder="Sauveteur, Victime, Témoin, Observateur" />
                        </label>
                        <label className="text-ui sm:col-span-2">Indicateurs de réussite (un par ligne)
                          <textarea rows={3} value={s._indicatorsText ?? (s.success_indicators || []).join('\n')} disabled={!canEdit} onChange={(e) => update(i, { _indicatorsText: e.target.value, success_indicators: linesToArr(e.target.value) })} className="input w-full mt-1" />
                        </label>
                        <label className="text-ui">Durée prévue (minutes)
                          <input type="number" min="0" value={s.duration_minutes || ''} disabled={!canEdit} onChange={(e) => update(i, { duration_minutes: e.target.value })} className="input w-full mt-1" />
                        </label>
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          )}

          {canEdit && (
            <button type="button" onClick={add} className="btn btn-secondary flex items-center gap-2"><Plus className="w-4 h-4" />Ajouter une séquence</button>
          )}
          <p className="text-ui-sm text-gray-500">Le modèle SST suit le manuel du formateur SST de l'INRS (janvier 2024). Les épreuves certificatives ne font pas partie du suivi formatif.</p>
        </div>

        <div className="flex justify-end gap-3 p-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">{canEdit ? 'Annuler' : 'Fermer'}</button>
          {canEdit && (
            <button type="button" onClick={save} disabled={saving || loading} className="btn btn-primary flex items-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Enregistrer
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

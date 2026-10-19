// Module RH, entretiens et listes d'arrivée et de départ (chantier 12, 0314) : sections de la fiche du personnel.
// Échéances proposées : premier entretien de parcours dans l'année qui suit l'embauche, puis tous les 4 ans ; bilan
// tous les 8 ans (loi du 24/10/2025). Modifiables : un accord de branche peut fixer une autre fréquence.

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, MessagesSquare, ListChecks, Check } from 'lucide-react'
import { Sheet } from '../../../ui/Sheet'
import { confirmer } from '../../../ui/Confirm'
import { supabase } from '../../../core/supabase'
import { nomComplet, chargerPersonnesChoix } from '../lib/rhData'
import { etatEcheance } from '../lib/rhDocuments'

const must = ({ data, error }) => { if (error) throw error; return data }
const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const plusAns = (iso, n) => { if (!iso) return ''; const d = new Date(`${iso}T12:00:00`); d.setFullYear(d.getFullYear() + n); return d.toISOString().slice(0, 10) }

export const TYPES_ENTRETIEN = {
  parcours: { label: 'Entretien de parcours professionnel', ans: 4 },
  bilan: { label: 'Bilan du parcours professionnel', ans: 8 },
  annuel: { label: 'Entretien annuel', ans: 1 },
  autre: { label: 'Autre entretien', ans: null },
}

function Champ({ label, children, aide = null, className = '' }) {
  return <label className={`block ${className}`}><span className="label">{label}</span>{children}{aide && <span className="block text-ui-sm muted mt-0.5">{aide}</span>}</label>
}

function EntretienSheet({ companyId, personId, entretien, onClose, onSaved }) {
  const [v, setV] = useState(() => ({ kind: 'parcours', planned_on: '', done_on: '', interviewer_person_id: '', summary: '', next_due_on: '', ...Object.fromEntries(Object.entries(entretien || {}).map(([k, x]) => [k, x ?? ''])) }))
  const [personnes, setPersonnes] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { chargerPersonnesChoix().then((p) => setPersonnes(p.filter((x) => x.id !== personId))).catch(() => {}) }, [personId])
  const m = (k) => (e) => {
    const val = e.target.value
    const suite = { ...v, [k]: val }
    // Date faite : prochaine échéance proposée selon le type (modifiable)
    if (k === 'done_on' && val && !v.next_due_on && TYPES_ENTRETIEN[v.kind]?.ans) suite.next_due_on = plusAns(val, TYPES_ENTRETIEN[v.kind].ans)
    setV(suite)
  }
  const enregistrer = async (e) => {
    e.preventDefault()
    if (!v.planned_on && !v.done_on && !v.next_due_on) { toast.error('Indiquez au moins une date'); return }
    setBusy(true)
    try {
      const ligne = {
        kind: v.kind, planned_on: v.planned_on || null, done_on: v.done_on || null, next_due_on: v.next_due_on || null,
        interviewer_person_id: v.interviewer_person_id || null, summary: v.summary?.trim() || null,
      }
      if (entretien?.id) must(await supabase.from('hr_reviews').update(ligne).eq('id', entretien.id))
      else must(await supabase.from('hr_reviews').insert({ ...ligne, company_id: companyId, person_id: personId }))
      toast.success('Entretien enregistré')
      onSaved()
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <Sheet title={entretien ? 'Modifier l\'entretien' : 'Prévoir un entretien'} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="rh-entretien" className="btn btn-primary" disabled={busy}>Enregistrer</button></>}>
      <form id="rh-entretien" onSubmit={enregistrer} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ label="Type"><select className="select" value={v.kind} onChange={m('kind')}>{Object.entries(TYPES_ENTRETIEN).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</select></Champ>
          <Champ label="Conduit par">
            <select className="select" value={v.interviewer_person_id} onChange={m('interviewer_person_id')}><option value="">Non précisé</option>{personnes.map((p) => <option key={p.id} value={p.id}>{nomComplet(p)}</option>)}</select>
          </Champ>
          <Champ label="Prévu le"><input className="input" type="date" value={v.planned_on} onChange={m('planned_on')} /></Champ>
          <Champ label="Fait le"><input className="input" type="date" value={v.done_on} onChange={m('done_on')} /></Champ>
          <Champ label="Prochain au plus tard" aide={TYPES_ENTRETIEN[v.kind]?.ans ? `Par défaut ${TYPES_ENTRETIEN[v.kind].ans} an${TYPES_ENTRETIEN[v.kind].ans > 1 ? 's' : ''} après (modifiable selon votre accord de branche)` : null}>
            <input className="input" type="date" value={v.next_due_on} onChange={m('next_due_on')} />
          </Champ>
        </div>
        <Champ label="Compte rendu court" aide={`${(v.summary || '').length} / 2000 · compétences, souhaits d'évolution, formations demandées. Le compte rendu signé se range dans les documents.`}>
          <textarea className="input" rows={4} maxLength={2000} value={v.summary} onChange={m('summary')} />
        </Champ>
      </form>
    </Sheet>
  )
}

export function EntretiensFiche({ companyId, personId, peutGerer = false, embauche = null }) {
  const [liste, setListe] = useState(null)
  const [edite, setEdite] = useState(null)
  const charger = useCallback(() => {
    supabase.from('hr_reviews').select('*, interviewer:interviewer_person_id(first_name, last_name, usage_name)').eq('person_id', personId)
      .order('done_on', { ascending: false, nullsFirst: true }).then(({ data }) => setListe(data || []))
  }, [personId])
  useEffect(() => { charger() }, [charger])
  const supprimer = async (r) => {
    if (!(await confirmer('Supprimer cet entretien saisi par erreur ?'))) return
    try { must(await supabase.from('hr_reviews').delete().eq('id', r.id)); charger() } catch (e) { toast.error(e.message) }
  }
  if (liste === null) return null
  if (!liste.length && !peutGerer) return null
  const premier = !liste.length && embauche ? plusAns(embauche, 1) : null
  return (
    <section className="card space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title flex items-center gap-2"><MessagesSquare className="w-4 h-4 text-gray-400" aria-hidden="true" />Entretiens</h2>
        {peutGerer && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdite(premier ? { kind: 'parcours', planned_on: premier } : {})}>
            <Plus className="w-4 h-4" aria-hidden="true" />Prévoir un entretien
          </button>
        )}
      </div>
      {liste.length === 0 && <p className="text-ui-sm muted">Aucun entretien.{premier ? ` Premier entretien de parcours à prévoir avant le ${fr(premier)}.` : ''}</p>}
      <ul className="divide-y divide-gray-100">
        {liste.map((r) => {
          const ech = etatEcheance(r.done_on ? r.next_due_on : r.planned_on)
          return (
            <li key={r.id} className="py-2 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-ui">{TYPES_ENTRETIEN[r.kind]?.label}</div>
                <div className="text-ui-sm text-gray-600">
                  {[r.done_on ? `fait le ${fr(r.done_on)}` : r.planned_on && `prévu le ${fr(r.planned_on)}`, r.interviewer && `avec ${nomComplet(r.interviewer)}`, r.next_due_on && `prochain au plus tard le ${fr(r.next_due_on)}`].filter(Boolean).join(' · ')}
                </div>
                {r.summary && <p className="text-ui-sm text-gray-700 whitespace-pre-line mt-1">{r.summary}</p>}
              </div>
              {ech && <span className={`badge ${ech.badge} flex-none`}>{ech.label}</span>}
              {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label="Modifier l'entretien" onClick={() => setEdite(r)}><Pencil className="w-4 h-4" /></button>}
              {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label="Supprimer l'entretien" onClick={() => supprimer(r)}><Trash2 className="w-4 h-4" /></button>}
            </li>
          )
        })}
      </ul>
      {edite && <EntretienSheet companyId={companyId} personId={personId} entretien={edite.id ? edite : (edite.planned_on ? edite : null)} onClose={() => setEdite(null)} onSaved={() => { setEdite(null); charger() }} />}
    </section>
  )
}

export function ListesFiche({ personId, peutGerer = false }) {
  const [listes, setListes] = useState(null)
  const charger = useCallback(() => {
    supabase.from('hr_checklists').select('*').eq('person_id', personId).order('kind').then(({ data }) => setListes(data || []))
  }, [personId])
  useEffect(() => { charger() }, [charger])
  const ouvrir = async (kind) => {
    try { must(await supabase.rpc('hr_liste_ouvrir', { p_person: personId, p_kind: kind })); charger() } catch (e) { toast.error(e.message) }
  }
  const cocher = async (l, i) => {
    const items = l.items.map((it, j) => (j === i ? { ...it, done_on: it.done_on ? null : new Date().toISOString().slice(0, 10) } : it))
    try { must(await supabase.from('hr_checklists').update({ items }).eq('id', l.id)); charger() } catch (e) { toast.error(e.message) }
  }
  if (listes === null) return null
  if (!listes.length && !peutGerer) return null
  const titre = { arrivee: 'Arrivée', depart: 'Départ' }
  const manquantes = ['arrivee', 'depart'].filter((k) => !listes.some((l) => l.kind === k))
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title flex items-center gap-2"><ListChecks className="w-4 h-4 text-gray-400" aria-hidden="true" />Arrivée et départ</h2>
        {peutGerer && manquantes.length > 0 && (
          <div className="flex gap-2">
            {manquantes.map((k) => <button key={k} type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir(k)}><Plus className="w-4 h-4" aria-hidden="true" />Liste de {k === 'arrivee' ? 'l\'arrivée' : 'départ'}</button>)}
          </div>
        )}
      </div>
      {listes.length === 0 && <p className="text-ui-sm muted">Aucune liste ouverte. La liste d'arrivée reprend les étapes de la société : contrat, déclaration d'embauche, visite, livret, EPI, accès.</p>}
      {listes.map((l) => {
        const faits = l.items.filter((it) => it.done_on).length
        return (
          <div key={l.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ui">{titre[l.kind]}</span>
              <span className={`badge ${faits === l.items.length ? 'badge-success' : 'badge-neutral'}`}>{faits} / {l.items.length}</span>
            </div>
            <ul className="space-y-1">
              {l.items.map((it, i) => (
                <li key={`${l.id}-${i}`}>
                  <label className="flex items-center gap-3 min-h-[40px]">
                    <input type="checkbox" className="w-5 h-5" checked={!!it.done_on} disabled={!peutGerer} onChange={() => cocher(l, i)} />
                    <span className={`text-ui flex-1 ${it.done_on ? 'text-gray-500 line-through' : ''}`}>{it.label}</span>
                    {it.done_on && <span className="text-ui-sm text-gray-500 flex items-center gap-1"><Check className="w-3.5 h-3.5" aria-hidden="true" />{fr(it.done_on)}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}

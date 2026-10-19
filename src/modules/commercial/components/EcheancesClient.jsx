import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { CalendarClock, ChevronDown, ChevronUp, Plus, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { Sheet } from '../../../ui/Sheet'
import { StatusBadge } from '../../../ui/StatusBadge'

// Échéances du client (lot 2, 0042) : formations du personnel, matériel, contrat, exercices, lues dans
// v_obligation_deadlines (calcul de la base, droits de la personne qui lit). On affiche des faits datés, jamais un
// taux de conformité. Deux saisies : formation suivie ailleurs, exercice ou essai de l'exploitant.

const STATUTS = { depasse: ['danger', 'Dépassée'], a_prevoir: ['warning', 'À prévoir'], a_jour: ['success', 'À jour'] }
const KINDS = { formation: 'Formation', materiel: 'Matériel', contrat: 'Contrat', exercice: 'Exercice' }
const ORDRE = { depasse: 0, a_prevoir: 1, a_jour: 2 }
const fmt = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR') : '')

export default function EcheancesClient({ client, peutModifier, peutStagiaires }) {
  const [ouvert, setOuvert] = useState(true)
  const [rows, setRows] = useState(null)
  const [indispo, setIndispo] = useState(false)
  const [tout, setTout] = useState(false)
  const [saisie, setSaisie] = useState(null)
  const [regles, setRegles] = useState([])
  const [salaries, setSalaries] = useState([])
  const [sites, setSites] = useState([])
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { data, error } = await supabase.from('v_obligation_deadlines')
      .select('kind, objet_id, objet_label, rule_label, domain, due_on, status, site_id')
      .eq('client_id', client.id).order('due_on').limit(500)
    if (error) { setIndispo(true); setRows([]); return }
    setRows(data || [])
  }
  useEffect(() => { if (client?.id) load() }, [client?.id])

  const triees = useMemo(() => (rows || []).slice().sort((a, b) => (ORDRE[a.status] - ORDRE[b.status]) || String(a.due_on).localeCompare(String(b.due_on))), [rows])
  const compte = (st) => (rows || []).filter((r) => r.status === st).length

  if (!client || client.client_type === 'particulier' || indispo) return null

  const ouvrirSaisie = async (type) => {
    const [{ data: r }, { data: t }, { data: s }] = await Promise.all([
      supabase.from('obligation_rules').select('id, label, kind, validity_months').eq('is_active', true).order('label'),
      type === 'externe' ? supabase.from('trainees').select('id, first_name, last_name').eq('client_id', client.id).order('last_name') : { data: [] },
      type === 'exercice' ? supabase.from('sites').select('id, name').eq('client_id', client.id).neq('is_active', false).order('name') : { data: [] },
    ])
    setRegles((r || []).filter((x) => (type === 'exercice' ? x.kind === 'exercice' : x.kind === 'formation')))
    setSalaries(t || [])
    setSites(s || [])
    setSaisie(type === 'externe'
      ? { type, trainee_id: '', rule_id: '', provider_name: '', done_on: '', valid_until: '', notes: '' }
      : { type, rule_id: '', site_id: '', done_on: new Date().toISOString().slice(0, 10), done_by: '', participants: '', is_compliant: true, observations: '', next_due_on: '' })
  }

  const enregistrer = async () => {
    const f = saisie
    if (!f.rule_id) return toast.error('Choisissez l\'obligation concernée')
    if (!f.done_on) return toast.error('Indiquez la date')
    setBusy(true)
    const { error } = f.type === 'externe'
      ? await supabase.from('external_trainings').insert({
        client_id: client.id, trainee_id: f.trainee_id || null, rule_id: f.rule_id, provider_name: f.provider_name || null,
        done_on: f.done_on, valid_until: f.valid_until || null, notes: f.notes || null, source: 'saisie_of',
      })
      : await supabase.from('client_safety_checks').insert({
        client_id: client.id, site_id: f.site_id || null, rule_id: f.rule_id, done_on: f.done_on, done_by: f.done_by || null,
        participants: f.participants === '' ? null : Number(f.participants), is_compliant: f.is_compliant, observations: f.observations || null,
        next_due_on: f.next_due_on || null,
      })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Enregistré : les échéances sont recalculées')
    setSaisie(null)
    load()
  }

  const set = (k, v) => setSaisie((s) => ({ ...s, [k]: v }))
  const visibles = tout ? triees : triees.filter((r) => r.status !== 'a_jour')

  return (
    <div className="bg-white rounded-ui border border-gray-200">
      <button type="button" onClick={() => setOuvert((v) => !v)} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <CalendarClock className="w-5 h-5 text-primary-600" />
          <h2 className="font-semibold text-gray-900">Échéances</h2>
          {compte('depasse') > 0 && <span className="badge badge-danger">{compte('depasse')} dépassée{compte('depasse') > 1 ? 's' : ''}</span>}
          {compte('a_prevoir') > 0 && <span className="badge badge-warning">{compte('a_prevoir')} à prévoir</span>}
        </div>
        {ouvert ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {ouvert && (
        <div className="px-5 pb-4 space-y-2">
          {rows === null ? <p className="text-ui-sm text-gray-400">Chargement…</p> : visibles.length === 0 ? (
            <p className="text-ui-sm text-gray-500">{rows.length === 0 ? 'Aucune échéance connue pour ce client.' : 'Rien à prévoir : tout est à jour.'}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {visibles.slice(0, tout ? 500 : 12).map((r, i) => (
                <li key={`${r.kind}-${r.objet_id}-${i}`} className="py-2 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-ui text-gray-900 truncate">{r.objet_label || KINDS[r.kind]}</div>
                    <div className="text-ui-sm text-gray-500">{KINDS[r.kind]}{r.rule_label ? ` · ${r.rule_label}` : ''} · échéance {fmt(r.due_on)}</div>
                  </div>
                  <StatusBadge tone={STATUTS[r.status]?.[0]}>{STATUTS[r.status]?.[1]}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {(rows || []).some((r) => r.status === 'a_jour') && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTout((v) => !v)}>{tout ? 'Masquer les échéances à jour' : 'Tout afficher'}</button>
            )}
            {peutModifier && <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrirSaisie('exercice')}><Plus className="w-4 h-4" /> Exercice ou essai</button>}
            {peutStagiaires && <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrirSaisie('externe')}><Plus className="w-4 h-4" /> Formation suivie ailleurs</button>}
          </div>
        </div>
      )}

      {saisie && (
        <Sheet title={saisie.type === 'externe' ? 'Formation suivie ailleurs' : 'Exercice ou essai de l\'exploitant'} onClose={() => setSaisie(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setSaisie(null)}>Annuler</button>
            <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer</button>
          </>}>
          <div>
            <label className="label" htmlFor="ech-regle">Obligation</label>
            <select id="ech-regle" className="input" value={saisie.rule_id} onChange={(e) => set('rule_id', e.target.value)}>
              <option value="">Choisir…</option>
              {regles.map((r) => <option key={r.id} value={r.id}>{r.label}{r.validity_months ? ` (tous les ${r.validity_months} mois)` : ''}</option>)}
            </select>
          </div>
          {saisie.type === 'externe' ? (
            <>
              <div>
                <label className="label" htmlFor="ech-salarie">Salarié</label>
                <select id="ech-salarie" className="input" value={saisie.trainee_id} onChange={(e) => set('trainee_id', e.target.value)}>
                  <option value="">L'entreprise (salarié non précisé)</option>
                  {salaries.map((t) => <option key={t.id} value={t.id}>{t.last_name} {t.first_name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="ech-of">Organisme</label>
                <input id="ech-of" className="input" value={saisie.provider_name} onChange={(e) => set('provider_name', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="ech-date">Suivie le</label>
                  <input id="ech-date" type="date" className="input" value={saisie.done_on} onChange={(e) => set('done_on', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="ech-fin">Valable jusqu'au</label>
                  <input id="ech-fin" type="date" className="input" value={saisie.valid_until} onChange={(e) => set('valid_until', e.target.value)} />
                </div>
              </div>
              <p className="text-ui-sm text-gray-400">Sans date de fin, l'échéance est calculée avec la périodicité de l'obligation.</p>
            </>
          ) : (
            <>
              {sites.length > 1 && (
                <div>
                  <label className="label" htmlFor="ech-site">Site</label>
                  <select id="ech-site" className="input" value={saisie.site_id} onChange={(e) => set('site_id', e.target.value)}>
                    <option value="">Tous les sites</option>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="ech-fait">Fait le</label>
                  <input id="ech-fait" type="date" className="input" value={saisie.done_on} onChange={(e) => set('done_on', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="ech-part">Participants</label>
                  <input id="ech-part" className="input" inputMode="numeric" value={saisie.participants} onChange={(e) => set('participants', e.target.value.replace(/\D/g, ''))} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="ech-par">Réalisé par</label>
                <input id="ech-par" className="input" value={saisie.done_by} onChange={(e) => set('done_by', e.target.value)} placeholder="Le client, un organisme…" />
              </div>
              <label className="flex items-center gap-2 text-ui text-gray-800">
                <input type="checkbox" checked={!!saisie.is_compliant} onChange={(e) => set('is_compliant', e.target.checked)} /> Sans anomalie
              </label>
              <div>
                <label className="label" htmlFor="ech-obs">Observations</label>
                <textarea id="ech-obs" className="input min-h-[70px]" value={saisie.observations} onChange={(e) => set('observations', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="ech-proch">Prochain exercice (facultatif)</label>
                <input id="ech-proch" type="date" className="input" value={saisie.next_due_on} onChange={(e) => set('next_due_on', e.target.value)} />
                <p className="text-ui-sm text-gray-400 mt-1">Vide : calculé avec la périodicité de l'obligation (6 mois pour les exercices, article R4227-39).</p>
              </div>
            </>
          )}
        </Sheet>
      )}
    </div>
  )
}

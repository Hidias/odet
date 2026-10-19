import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { ExternalLink, Loader2, ShieldCheck } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'
import { PageHeader } from '../../../ui/PageHeader'
import { DataTable } from '../../../ui/DataTable'
import { StatusBadge } from '../../../ui/StatusBadge'
import { Sheet } from '../../../ui/Sheet'
import { Banner } from '../../../ui/Banner'
import { EmptyState } from '../../../ui/EmptyState'

// Référentiel des obligations (lot 2, 0042) : formations, matériel et exercices suivis, avec leur périodicité et les
// formations du catalogue qui les satisfont. Une seule source pour les échéances du tableau de bord, de la fiche
// client, puis du pont formation-maintenance et du registre de sécurité. Valeurs de départ « à confirmer ».

const DOMAINES = { incendie: 'Incendie', secours: 'Secours', electrique: 'Électrique', manutention: 'Manutention', conduite: 'Conduite', autre: 'Autre' }
const KINDS = { formation: 'Formation', materiel: 'Matériel', exercice: 'Exercice' }
const SOURCES = { officiel: 'Texte officiel', norme: 'Norme ou recommandation', secondaire: 'Source secondaire', a_confirmer: 'À confirmer' }

export default function Obligations() {
  const can = useAuthStore((s) => s.can)
  const peutGerer = can('formation.catalogue.gerer') !== false
  const [regles, setRegles] = useState(null)
  const [cours, setCours] = useState([])
  const [familles, setFamilles] = useState([])
  const [erreur, setErreur] = useState(null)
  const [edition, setEdition] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const [{ data, error }, { data: c }, { data: f }] = await Promise.all([
      supabase.from('obligation_rules').select('*').order('domain').order('label'),
      supabase.from('courses').select('id, code, title').order('title'),
      supabase.from('itv_equipment_types').select('family'),
    ])
    if (error) { setErreur('Le référentiel n\'est pas encore disponible. Prévenez le support.'); setRegles([]); return }
    setRegles(data || [])
    setCours(c || [])
    setFamilles([...new Set((f || []).map((x) => x.family).filter(Boolean))].sort())
  }
  useEffect(() => { load() }, [])

  const coursParId = useMemo(() => Object.fromEntries(cours.map((c) => [c.id, c])), [cours])

  const enregistrer = async () => {
    const r = edition
    if (!r.label?.trim()) return toast.error('Libellé requis')
    setBusy(true)
    const champs = {
      label: r.label.trim(), domain: r.domain, kind: r.kind,
      validity_months: r.validity_months === '' || r.validity_months == null ? null : Number(r.validity_months),
      reminder_days: Number(r.reminder_days || 90), course_ids: r.course_ids || [], equipment_families: r.equipment_families || [],
      legal_ref: r.legal_ref || null, source_url: r.source_url || null, source_kind: r.source_kind,
      is_confirmed: !!r.is_confirmed, is_active: r.is_active !== false, notes: r.notes || null,
      checked_on: r.is_confirmed && !r.checked_on ? new Date().toISOString().slice(0, 10) : r.checked_on || null,
    }
    const { error } = r.id
      ? await supabase.from('obligation_rules').update(champs).eq('id', r.id)
      : await supabase.from('obligation_rules').insert({ ...champs, code: `perso_${Date.now().toString(36)}` })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Enregistré : les échéances suivent')
    setEdition(null)
    load()
  }

  const colonnes = [
    { key: 'label', label: 'Obligation', mobile: 'title' },
    { key: 'kind', label: 'Type', mobile: 'subtitle', render: (r) => `${KINDS[r.kind]} · ${DOMAINES[r.domain]}` },
    { key: 'validity_months', label: 'Périodicité', render: (r) => (r.validity_months ? `${r.validity_months} mois` : 'Aucune fixée') },
    { key: 'cours', label: 'Satisfaite par', render: (r) => (r.kind === 'materiel' ? (r.equipment_families || []).join(', ') || '—'
      : (r.course_ids || []).map((id) => coursParId[id]?.code || coursParId[id]?.title).filter(Boolean).join(', ') || '—') },
    { key: 'etat', label: 'État', mobile: 'aside', render: (r) => (r.is_active === false
      ? <StatusBadge tone="neutral">Inactive</StatusBadge>
      : r.is_confirmed ? <StatusBadge tone="success">Confirmée</StatusBadge> : <StatusBadge tone="warning">À confirmer</StatusBadge>) },
  ]

  const toggle = (liste, v) => (liste.includes(v) ? liste.filter((x) => x !== v) : [...liste, v])
  const set = (k, v) => setEdition((e) => ({ ...e, [k]: v }))

  return (
    <div className="space-y-4">
      <PageHeader title="Obligations" meta={<span>Formations, matériel et exercices suivis : périodicités et formations du catalogue qui les satisfont.</span>}
        actions={peutGerer && !erreur ? <button type="button" className="btn btn-secondary" onClick={() => setEdition({ label: '', domain: 'autre', kind: 'formation', validity_months: '', reminder_days: 90, course_ids: [], equipment_families: [], source_kind: 'a_confirmer', is_active: true })}>Ajouter une obligation</button> : null} />
      {erreur && <Banner tone="warning">{erreur}</Banner>}
      {regles && regles.some((r) => !r.is_confirmed && r.is_active) && (
        <Banner tone="info">Les valeurs de départ sont sourcées mais « à confirmer » : relisez chaque obligation et cochez « Confirmée » quand elle correspond à votre pratique.</Banner>
      )}
      <div className="card">
        <DataTable columns={colonnes} rows={regles || []} loading={regles === null} onRowClick={(r) => setEdition({ ...r, validity_months: r.validity_months ?? '' })}
          caption="Obligations suivies" empty={<EmptyState icon={ShieldCheck} title="Aucune obligation" compact />} />
      </div>

      {edition && (
        <Sheet title={edition.id ? edition.label : 'Nouvelle obligation'} onClose={() => setEdition(null)} size="lg"
          footer={peutGerer ? <>
            <button type="button" className="btn btn-secondary" onClick={() => setEdition(null)}>Annuler</button>
            <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer</button>
          </> : <button type="button" className="btn btn-secondary" onClick={() => setEdition(null)}>Fermer</button>}>
          <fieldset disabled={!peutGerer} className="grid gap-3">
            <div>
              <label className="label" htmlFor="ob-label">Libellé</label>
              <input id="ob-label" className="input" value={edition.label} onChange={(e) => set('label', e.target.value)} />
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="ob-dom">Domaine</label>
                <select id="ob-dom" className="input" value={edition.domain} onChange={(e) => set('domain', e.target.value)}>
                  {Object.entries(DOMAINES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="ob-kind">Type</label>
                <select id="ob-kind" className="input" value={edition.kind} onChange={(e) => set('kind', e.target.value)} disabled={!!edition.id}>
                  {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="ob-mois">Périodicité (mois)</label>
                <input id="ob-mois" className="input" inputMode="numeric" value={edition.validity_months} placeholder="Aucune fixée"
                  onChange={(e) => set('validity_months', e.target.value.replace(/\D/g, ''))} />
              </div>
              <div>
                <label className="label" htmlFor="ob-rappel">Prévoir (jours avant l'échéance)</label>
                <input id="ob-rappel" className="input" inputMode="numeric" value={edition.reminder_days} onChange={(e) => set('reminder_days', e.target.value.replace(/\D/g, ''))} />
              </div>
            </div>
            {edition.kind === 'formation' && (
              <div>
                <div className="label">Formations du catalogue qui la satisfont</div>
                <div className="flex flex-wrap gap-1.5">
                  {cours.map((c) => {
                    const on = (edition.course_ids || []).includes(c.id)
                    return (
                      <button key={c.id} type="button" onClick={() => set('course_ids', toggle(edition.course_ids || [], c.id))} aria-pressed={on}
                        className={`h-8 px-2.5 rounded-full text-ui-sm border ${on ? 'bg-accent-500 text-accent-fg border-accent-500' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                        {c.code ? `${c.code} · ` : ''}{c.title}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {edition.kind === 'materiel' && (
              <div>
                <div className="label">Familles de matériel</div>
                <div className="flex flex-wrap gap-1.5">
                  {familles.map((f) => {
                    const on = (edition.equipment_families || []).includes(f)
                    return (
                      <button key={f} type="button" onClick={() => set('equipment_families', toggle(edition.equipment_families || [], f))} aria-pressed={on}
                        className={`h-8 px-2.5 rounded-full text-ui-sm border ${on ? 'bg-accent-500 text-accent-fg border-accent-500' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}>{f}</button>
                    )
                  })}
                </div>
                <p className="text-ui-sm text-gray-400 mt-1">Les échéances du matériel viennent du parc (prochaine vérification de chaque appareil).</p>
              </div>
            )}
            <div>
              <label className="label" htmlFor="ob-ref">Référence</label>
              <textarea id="ob-ref" className="input min-h-[64px]" value={edition.legal_ref || ''} onChange={(e) => set('legal_ref', e.target.value)} />
            </div>
            <div className="grid sm:grid-cols-[1fr_220px] gap-2">
              <div>
                <label className="label" htmlFor="ob-url">Source (adresse)</label>
                <input id="ob-url" className="input" value={edition.source_url || ''} onChange={(e) => set('source_url', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="ob-src">Nature de la source</label>
                <select id="ob-src" className="input" value={edition.source_kind} onChange={(e) => set('source_kind', e.target.value)}>
                  {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            {edition.source_url && (
              <a href={edition.source_url} target="_blank" rel="noreferrer" className="text-ui-sm text-accent-700 hover:underline inline-flex items-center gap-1">Ouvrir la source <ExternalLink className="w-3.5 h-3.5" /></a>
            )}
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-ui text-gray-800"><input type="checkbox" checked={!!edition.is_confirmed} onChange={(e) => set('is_confirmed', e.target.checked)} /> Confirmée par l'organisme</label>
              <label className="flex items-center gap-2 text-ui text-gray-800"><input type="checkbox" checked={edition.is_active !== false} onChange={(e) => set('is_active', e.target.checked)} /> Suivie</label>
            </div>
          </fieldset>
        </Sheet>
      )}
    </div>
  )
}

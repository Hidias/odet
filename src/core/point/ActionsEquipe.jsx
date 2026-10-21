import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, CalendarClock, Check, ListTodo, Trash2, RotateCcw, Ban } from 'lucide-react'
import { supabase } from '../supabase'
import { useAuthStore } from '../store'
import { PageHeader } from '../../ui/PageHeader'
import { EmptyState } from '../../ui/EmptyState'
import { Banner } from '../../ui/Banner'
import { confirmer } from '../../ui/Confirm'
import { chargerEquipe, nomProfil, creerAction, modifierAction, dateReport, groupeEcheance, GROUPES } from './actions'
import { jjmm } from './pointSemaine'

// Actions de l'équipe (0407) : ce que chacun a à faire, d'où que ça vienne (point de la semaine, bilan, réunion,
// saisie libre). Une action se coche, se reporte d'une semaine (le report est compté), s'abandonne.

const VIDE = { title: '', owner_id: '', due_on: '', urgent: false }

export default function ActionsEquipe() {
  const moi = useAuthStore((s) => s.profile)
  const can = useAuthStore((s) => s.can)
  const direction = can?.('manager.cockpit.voir') === true
  const [actions, setActions] = useState(null)
  const [equipe, setEquipe] = useState([])
  const [qui, setQui] = useState('moi')
  const [voirTerminees, setVoirTerminees] = useState(false)
  const [form, setForm] = useState(VIDE)
  const [erreur, setErreur] = useState(null)
  const [busy, setBusy] = useState(false)

  const charger = async () => {
    const { data, error } = await supabase.from('team_actions').select('*, clients(id, name)')
      .order('due_on', { ascending: true, nullsFirst: false }).order('created_at').limit(1000)
    if (error) { setErreur('Les actions ne sont pas encore disponibles.'); setActions([]); return }
    setActions(data || [])
  }
  useEffect(() => { charger(); chargerEquipe().then(setEquipe) }, [])
  useEffect(() => { if (moi?.id && !form.owner_id) setForm((f) => ({ ...f, owner_id: moi.id })) }, [moi?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const noms = useMemo(() => Object.fromEntries(equipe.map((p) => [p.id, nomProfil(p)])), [equipe])
  const liste = useMemo(() => (actions || []).filter((a) => (qui === 'moi' ? a.owner_id === moi?.id || (!a.owner_id && a.created_by === moi?.id) : qui === 'tous' ? true : a.owner_id === qui)
    && (voirTerminees || a.status === 'a_faire')), [actions, qui, voirTerminees, moi?.id])
  const groupes = useMemo(() => GROUPES.map((g) => ({ ...g, lignes: liste.filter((a) => groupeEcheance(a) === g.id) })).filter((g) => g.lignes.length), [liste])

  const ajouter = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await creerAction({ ...form, owner_id: form.owner_id || null, due_on: form.due_on || null })
      setForm({ ...VIDE, owner_id: moi?.id || '' })
      toast.success('Action ajoutée')
      charger()
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  const maj = async (a, patch, msg) => {
    try { await modifierAction(a.id, patch); if (msg) toast.success(msg); charger() } catch (err) { toast.error(err.message) }
  }
  const supprimer = async (a) => {
    if (!await confirmer(`Supprimer l'action « ${a.title} » ?`)) return
    const { error } = await supabase.from('team_actions').delete().eq('id', a.id)
    if (error) toast.error(error.message); else { toast.success('Action supprimée'); charger() }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Actions de l'équipe" meta={<span>Ce que chacun a à faire, issu du point de la semaine, des réunions ou saisi ici.</span>}
        actions={direction ? <Link to="/point-semaine" className="btn btn-secondary"><CalendarClock className="w-4 h-4" />Point de la semaine</Link> : null} />
      {erreur && <Banner tone="warning">{erreur}</Banner>}

      <form onSubmit={ajouter} className="card p-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_200px_160px_auto_auto] gap-2 items-end">
        <div>
          <label className="label" htmlFor="ac-titre">Nouvelle action</label>
          <input id="ac-titre" className="input" placeholder="Ex. : rappeler le client pour la date de recyclage" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={300} />
        </div>
        <div>
          <label className="label" htmlFor="ac-qui">Qui</label>
          <select id="ac-qui" className="select" value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}>
            <option value="">Personne en particulier</option>
            {equipe.map((p) => <option key={p.id} value={p.id}>{nomProfil(p)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ac-date">Pour le</label>
          <input id="ac-date" type="date" className="input" value={form.due_on} onChange={(e) => setForm({ ...form, due_on: e.target.value })} />
        </div>
        <label className="inline-flex items-center gap-2 text-ui pb-2">
          <input type="checkbox" checked={form.urgent} onChange={(e) => setForm({ ...form, urgent: e.target.checked })} />Urgent
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || form.title.trim().length < 2}><Plus className="w-4 h-4" />Ajouter</button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <select className="select w-auto" value={qui} onChange={(e) => setQui(e.target.value)} aria-label="Personne">
          <option value="moi">Mes actions</option>
          <option value="tous">Toute l'équipe</option>
          {equipe.map((p) => <option key={p.id} value={p.id}>{nomProfil(p)}</option>)}
        </select>
        <label className="inline-flex items-center gap-2 text-ui text-gray-700">
          <input type="checkbox" checked={voirTerminees} onChange={(e) => setVoirTerminees(e.target.checked)} />Voir les actions terminées
        </label>
      </div>

      {actions === null ? <div className="text-ui-sm text-gray-500">Chargement…</div>
        : groupes.length === 0 ? (
          <div className="card"><EmptyState icon={ListTodo} title="Aucune action" compact>Les actions du point de la semaine et des réunions apparaissent ici.</EmptyState></div>
        ) : groupes.map((g) => (
          <section key={g.id} className="surface overflow-hidden" aria-label={g.titre}>
            <div className="px-4 py-2 border-b hairline flex items-center gap-2">
              <h2 className={`section-title ${g.id === 'retard' ? 'text-red-700' : ''}`}>{g.titre}</h2>
              <span className="text-ui-sm text-gray-500">{g.lignes.length}</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {g.lignes.map((a) => (
                <li key={a.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button type="button" className={`w-6 h-6 rounded-full border flex items-center justify-center flex-none ${a.status === 'fait' ? 'bg-green-600 border-green-600 text-white' : 'border-gray-300 hover:border-green-600'}`}
                    aria-label={a.status === 'fait' ? 'Remettre à faire' : 'Marquer comme fait'} title={a.status === 'fait' ? 'Remettre à faire' : 'Marquer comme fait'}
                    onClick={() => maj(a, { status: a.status === 'fait' ? 'a_faire' : 'fait' }, a.status === 'fait' ? null : 'Bravo !')}>
                    {a.status === 'fait' && <Check className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-[200px]">
                    <div className={`text-ui ${a.status !== 'a_faire' ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                      {a.urgent && a.status === 'a_faire' && <span className="status status-danger mr-2">Urgent</span>}
                      {a.link ? <Link to={a.link} className="hover:underline">{a.title}</Link> : a.title}
                    </div>
                    <div className="text-ui-sm text-gray-500">
                      {[a.owner_id ? noms[a.owner_id] || 'Membre de l\'équipe' : 'Personne en particulier',
                        a.clients?.name ? <Link key="c" to={`/clients/${a.clients.id}`} className="hover:underline">{a.clients.name}</Link> : null,
                        a.postponed_count > 0 ? `reporté ${a.postponed_count} fois` : null,
                        a.source !== 'manuel' ? { point: 'point de la semaine', bilan: 'bilan', reunion: 'réunion' }[a.source] : null,
                      ].filter(Boolean).reduce((acc, x, i) => (i ? [...acc, ' · ', x] : [x]), [])}
                    </div>
                  </div>
                  <input type="date" className="input w-auto" style={{ minHeight: 32 }} value={a.due_on || ''} aria-label="Échéance"
                    onChange={(e) => maj(a, { due_on: e.target.value || null })} disabled={a.status !== 'a_faire'} />
                  {a.status === 'a_faire' && (
                    <button type="button" className="btn btn-ghost btn-sm" title="Reporter d'une semaine" onClick={() => maj(a, { due_on: dateReport(a.due_on) }, `Reporté au ${jjmm(dateReport(a.due_on))}`)}>
                      <RotateCcw className="w-4 h-4" />Reporter
                    </button>
                  )}
                  {a.status === 'a_faire' && (
                    <button type="button" className="btn btn-ghost btn-sm" title="Abandonner" onClick={() => maj(a, { status: 'abandonne' }, 'Action abandonnée')}><Ban className="w-4 h-4" /></button>
                  )}
                  {(direction || a.created_by === moi?.id) && (
                    <button type="button" className="btn btn-ghost btn-sm" title="Supprimer" aria-label="Supprimer" onClick={() => supprimer(a)}><Trash2 className="w-4 h-4" /></button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  )
}

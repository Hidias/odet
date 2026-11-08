import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, CalendarClock, Check, ListTodo, Trash2, RotateCcw, Ban } from 'lucide-react'
import { supabase } from '../supabase'
import { useAuthStore } from '../store'
import { PageHeader } from '../../ui/PageHeader'
import { EmptyState } from '../../ui/EmptyState'
import { Banner } from '../../ui/Banner'
import { confirmer } from '../../ui/Confirm'
import { Sheet } from '../../ui/Sheet'
import { Kanban, CLASSE_ITEM_MENU } from '../../ui/Kanban'
import { ChoixVue, useVue } from '../../ui/ChoixVue'
import {
  chargerEquipe, nomProfil, creerAction, modifierAction, supprimerAction, dateReport, groupeEcheance, GROUPES, colonnesActions, changementColonne, choixAction,
} from './actions'
import { jjmm } from './pointSemaine'
import { chargerTypes, choixType, typeActif, suiteProposee, libelleType, enVueGroupe } from './typesActions'
import { MESSAGE_VUE_GROUPE } from '../company/societes'

// Actions de l'équipe (0407) : ce que chacun a à faire, d'où que ça vienne (point de la semaine, bilan, réunion,
// saisie libre). Une action se coche, se reporte d'une semaine (le report est compté), s'abandonne.
// Deux affichages : liste par échéance, ou colonnes par échéance (Kanban : déplacer une carte change sa date).
// Types d'action (0514, réglés dans les Paramètres) : à la création, le type remplit l'intitulé, le responsable et
// l'échéance ; une action faite dont le type a une suite ouvre la suite PROPOSÉE (rien n'est créé sans clic).

const VIDE = { title: '', owner_id: '', due_on: '', urgent: false, type_id: '' }

export default function ActionsEquipe() {
  const moi = useAuthStore((s) => s.profile)
  const ctxSocietes = useAuthStore((s) => s.societes)
  const can = useAuthStore((s) => s.can)
  const direction = can?.('manager.cockpit.voir') === true
  // Vue groupe (0516) : la base refuse toute écriture ; l'écran se lit sans rien proposer de modifier
  const lecture = enVueGroupe()
  const [actions, setActions] = useState(null)
  const [equipe, setEquipe] = useState([])
  const [qui, setQui] = useState('moi')
  const [voirTerminees, setVoirTerminees] = useState(false)
  const [form, setForm] = useState(VIDE)
  const [erreur, setErreur] = useState(null)
  const [busy, setBusy] = useState(false)
  const [vue, setVue] = useVue('actions')
  const [types, setTypes] = useState(null)
  const [suite, setSuite] = useState(null)
  const [busySuite, setBusySuite] = useState(false)
  const navigate = useNavigate()

  const demande = useRef(0)
  const charger = async () => {
    const n = ++demande.current
    const { data, error } = await supabase.from('team_actions').select('*, clients(id, name)')
      .order('due_on', { ascending: true, nullsFirst: false }).order('created_at').limit(1000)
    if (n !== demande.current) return // une lecture plus récente est partie (changements rapprochés)
    if (error) { setErreur('Les actions ne sont pas encore disponibles.'); setActions([]); return }
    setActions(data || [])
  }
  useEffect(() => { charger(); chargerEquipe().then(setEquipe); chargerTypes().then(setTypes) }, [])
  useEffect(() => { if (moi?.id && !form.owner_id) setForm((f) => ({ ...f, owner_id: moi.id })) }, [moi?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const typesActifs = useMemo(() => (types || []).filter((t) => t.active !== false), [types])
  const nomsTypes = useMemo(() => Object.fromEntries((types || []).map((t) => [t.id, t.name])), [types])
  const noms = useMemo(() => Object.fromEntries(equipe.map((p) => [p.id, nomProfil(p)])), [equipe])
  const liste = useMemo(() => (actions || []).filter((a) => (qui === 'moi' ? a.owner_id === moi?.id || (!a.owner_id && a.created_by === moi?.id) : qui === 'tous' ? true : a.owner_id === qui)
    && (voirTerminees || a.status === 'a_faire')), [actions, qui, voirTerminees, moi?.id])
  const colonnes = useMemo(() => colonnesActions(liste, { avecTerminees: voirTerminees }), [liste, voirTerminees])
  const peutModifier = (a) => !lecture && (direction || a.owner_id === moi?.id || a.created_by === moi?.id)
  const lienDe = (a) => a.link || (a.clients?.id ? `/clients/${a.clients.id}` : null)
  const groupes = useMemo(() => GROUPES.map((g) => ({ ...g, lignes: liste.filter((a) => groupeEcheance(a) === g.id) })).filter((g) => g.lignes.length), [liste])

  const ajouter = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await creerAction({ ...form, owner_id: form.owner_id || null, due_on: form.due_on || null, type_id: form.type_id || null, company_id: form.type_id ? form.company_id || null : null })
      setForm({ ...VIDE, owner_id: moi?.id || '' })
      toast.success('Action ajoutée')
      charger()
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  const maj = async (a, patch, msg) => {
    // Vue tout de suite à sa nouvelle place (la carte ne revient pas en arrière pendant l'enregistrement)
    setActions((l) => (l || []).map((x) => (x.id === a.id ? { ...x, ...patch } : x)))
    let ok = false
    try { await modifierAction(a.id, patch); ok = true; if (msg) toast.success(msg) } catch (err) { toast.error(err.message) }
    // Action faite : sa suite est proposée (relue sur la liste à jour : une suite déjà créée n'est pas reproposée)
    if (ok && patch.status === 'fait' && a.status !== 'fait') {
      const dejaSuivies = (actions || []).map((x) => x.previous_id).filter(Boolean)
      const s = suiteProposee(a, types, { dejaSuivies })
      if (s) setSuite(s)
    }
    charger()
  }
  const creerSuite = async (e) => {
    e.preventDefault()
    setBusySuite(true)
    try {
      await creerAction({ ...suite, owner_id: suite.owner_id || null, due_on: suite.due_on || null })
      toast.success('Suite ajoutée')
      setSuite(null)
      charger()
    } catch (err) {
      toast.error(err?.code === '23505' ? 'La suite de cette action existe déjà.' : err.message)
      if (err?.code === '23505') { setSuite(null); charger() }
    } finally { setBusySuite(false) }
  }
  const supprimer = async (a) => {
    if (!await confirmer(`Supprimer l'action « ${a.title} » ?`)) return
    try { await supprimerAction(a.id); toast.success('Action supprimée'); charger() } catch (err) { toast.error(err.message) }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Actions de l'équipe" meta={<span>Ce que chacun a à faire, issu du point de la semaine, des réunions ou saisi ici.</span>}
        actions={direction ? <Link to="/point-semaine" className="btn btn-secondary"><CalendarClock className="w-4 h-4" />Point de la semaine</Link> : null} />
      {erreur && <Banner tone="warning">{erreur}</Banner>}
      {lecture && <Banner tone="info">{MESSAGE_VUE_GROUPE}</Banner>}

      {!lecture && <form onSubmit={ajouter} className={`card p-3 grid grid-cols-1 ${typesActifs.length ? 'md:grid-cols-[180px_minmax(0,1fr)_200px_160px_auto_auto]' : 'md:grid-cols-[minmax(0,1fr)_200px_160px_auto_auto]'} gap-2 items-end`}>
        {typesActifs.length > 0 && (
          <div>
            <label className="label" htmlFor="ac-type">Type</label>
            <select id="ac-type" className="select" value={form.type_id} onChange={(e) => setForm(choixType(form, typeActif(types, e.target.value), undefined, types))}>
              <option value="">Sans type</option>
              {typesActifs.map((t) => <option key={t.id} value={t.id}>{libelleType(t, ctxSocietes)}</option>)}
            </select>
          </div>
        )}
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
      </form>}

      <div className="flex flex-wrap items-center gap-2">
        <select className="select w-auto" value={qui} onChange={(e) => setQui(e.target.value)} aria-label="Personne">
          <option value="moi">Mes actions</option>
          <option value="tous">Toute l'équipe</option>
          {equipe.map((p) => <option key={p.id} value={p.id}>{nomProfil(p)}</option>)}
        </select>
        <label className="inline-flex items-center gap-2 text-ui text-gray-700">
          <input type="checkbox" checked={voirTerminees} onChange={(e) => setVoirTerminees(e.target.checked)} />Voir les actions terminées
        </label>
        <div className="ml-auto"><ChoixVue vue={vue} onChange={setVue} /></div>
      </div>

      {actions === null ? <div className="text-ui-sm text-gray-500">Chargement…</div>
        : vue === 'colonnes' && liste.length > 0 ? (
          <Kanban colonnes={colonnes} cle={(a) => a.id} label="Actions par échéance" labelMenu="Actions possibles" vide="Aucune action"
            onOuvrir={(a) => navigate(lienDe(a))} ouvrable={(a) => !!lienDe(a)}
            deplacable={peutModifier}
            peutDeposer={(a, code) => peutModifier(a) && !!changementColonne(a, code)}
            onDeposer={(a, code) => maj(a, changementColonne(a, code), code === 'terminees' ? 'Bravo !' : 'Échéance changée')}
            libelleMenu={(a) => (peutModifier(a) ? `Actions : ${a.title}` : null)}
            carte={(a) => (
              <>
                <div className={`text-ui ${a.status !== 'a_faire' ? 'line-through text-gray-500' : 'text-gray-900 font-medium'}`}>
                  {a.urgent && a.status === 'a_faire' && <span className="status status-danger mr-2">Urgent</span>}{a.title}
                </div>
                <div className="text-ui-sm text-gray-500">
                  {[a.owner_id ? noms[a.owner_id] || 'Membre de l\'équipe' : 'Personne en particulier', a.clients?.name || null,
                    a.type_id && nomsTypes[a.type_id] ? nomsTypes[a.type_id] : null,
                    a.due_on ? `pour le ${jjmm(a.due_on)}` : null, a.postponed_count > 0 ? `reporté ${a.postponed_count} fois` : null].filter(Boolean).join(' · ')}
                </div>
              </>
            )}
            menu={({ ligne, choisir }) => (
              <>
                <div className="px-3 pt-1.5 pb-1 text-ui-sm text-gray-500">Changer d'échéance ou d'état</div>
                {choixAction(ligne).map((c) => (
                  <button key={c.code} type="button" className={CLASSE_ITEM_MENU} onClick={() => choisir(() => maj(ligne, c.patch, c.message))}>{c.label}</button>
                ))}
              </>
            )} />
        )
        : groupes.length === 0 ? (
          <div className="card"><EmptyState icon={ListTodo} title="Aucune action" compact>Les actions du point de la semaine et des réunions apparaissent ici.</EmptyState></div>
        ) : groupes.map((g) => (
          <section key={g.id} className="surface overflow-hidden" aria-label={g.titre}>
            <fieldset disabled={lecture} className="contents">
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
                        a.type_id && nomsTypes[a.type_id] ? nomsTypes[a.type_id] : null,
                        a.postponed_count > 0 ? `reporté ${a.postponed_count} fois` : null,
                        a.source !== 'manuel' ? { point: 'point de la semaine', bilan: 'bilan', reunion: 'réunion', habilitation: 'titres exigés' }[a.source] : null,
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
                  {a.source !== 'habilitation' && (direction || a.created_by === moi?.id) && (
                    <button type="button" className="btn btn-ghost btn-sm" title="Supprimer" aria-label="Supprimer" onClick={() => supprimer(a)}><Trash2 className="w-4 h-4" /></button>
                  )}
                </li>
              ))}
            </ul>
            </fieldset>
          </section>
        ))}

      {suite && (
        <Sheet title="Suite proposée" size="sm" onClose={() => setSuite(null)}
          footer={(
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setSuite(null)}>Pas de suite</button>
              <button type="submit" form="ac-suite" className="btn btn-primary" disabled={busySuite || String(suite.title || '').trim().length < 2}><Plus className="w-4 h-4" />Créer la suite</button>
            </div>
          )}>
          <form id="ac-suite" onSubmit={creerSuite} className="space-y-3">
            <p className="text-ui text-gray-700">Action faite. Voici la suite prévue pour ce type d'action : vérifiez-la, puis créez-la ou passez.</p>
            <div>
              <label className="label" htmlFor="ac-suite-titre">Action</label>
              <input id="ac-suite-titre" className="input" value={suite.title} maxLength={300} onChange={(e) => setSuite({ ...suite, title: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="ac-suite-qui">Qui</label>
              <select id="ac-suite-qui" className="select" value={suite.owner_id || ''} onChange={(e) => setSuite({ ...suite, owner_id: e.target.value })}>
                <option value="">Personne en particulier</option>
                {equipe.map((p) => <option key={p.id} value={p.id}>{nomProfil(p)}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ac-suite-date">Pour le</label>
              <input id="ac-suite-date" type="date" className="input" value={suite.due_on || ''} onChange={(e) => setSuite({ ...suite, due_on: e.target.value })} />
            </div>
          </form>
        </Sheet>
      )}
    </div>
  )
}

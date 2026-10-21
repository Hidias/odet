import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight, RefreshCw, Send, Eye, Plus, X, Undo2, ListPlus, Loader2, Users, ExternalLink } from 'lucide-react'
import { supabase } from '../supabase'
import { callApi } from '../api'
import { getCurrentCompanyId } from '../company/companyContext'
import { PageHeader } from '../../ui/PageHeader'
import { Tabs } from '../../ui/Tabs'
import { Banner } from '../../ui/Banner'
import { Sheet } from '../../ui/Sheet'
import { confirmer } from '../../ui/Confirm'
import { SECTIONS, SUITES, lundi, decaler, titreSemaine, parSection, jjmm } from './pointSemaine'
import { chargerEquipe, nomProfil, creerAction, modifierAction } from './actions'

// Point de la semaine (lundi) et bilan (vendredi), 0407. Préparés tout seuls à partir des données ; la direction
// retire, ajoute, attribue, transforme une ligne en action, puis envoie aux destinataires choisis dans les
// utilisateurs. Au bilan, chaque ligne est faite, reportée (elle revient au point suivant) ou abandonnée.

const fr = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '')
const VIDE = { section: 'divers', texte: '', owner_id: '', action: false, due_on: '' }

export default function PointSemaine() {
  const [params, setParams] = useSearchParams()
  const semaine = lundi(params.get('semaine') || new Date())
  const kind = params.get('type') === 'bilan' ? 'bilan' : 'point'
  const [brief, setBrief] = useState(undefined)
  const [equipe, setEquipe] = useState([])
  const [destinataires, setDestinataires] = useState([])
  const [busy, setBusy] = useState(false)
  const [ajout, setAjout] = useState(null)
  const [apercu, setApercu] = useState(null)
  const [note, setNote] = useState('')

  const aller = (s, k = kind) => setParams({ semaine: s, type: k })

  const charger = async () => {
    setBrief(undefined)
    let q = supabase.from('weekly_briefs').select('*').eq('week_start', semaine).eq('kind', kind)
    if (getCurrentCompanyId()) q = q.eq('company_id', getCurrentCompanyId())
    const { data, error } = await q.order('created_at').limit(1).maybeSingle()
    if (error) { setBrief(null); toast.error('Le point de la semaine n\'est pas encore disponible.'); return }
    setBrief(data || null)
    setNote(data?.note || '')
  }
  useEffect(() => { charger() }, [semaine, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    chargerEquipe().then(setEquipe)
    let q = supabase.from('weekly_brief_recipients').select('profile_id, point, bilan')
    if (getCurrentCompanyId()) q = q.eq('company_id', getCurrentCompanyId())
    q.then(({ data }) => setDestinataires(data || []))
  }, [])

  const noms = useMemo(() => Object.fromEntries(equipe.map((p) => [p.id, nomProfil(p)])), [equipe])
  const dest = destinataires.filter((d) => d[kind]).map((d) => noms[d.profile_id]).filter(Boolean)
  const sections = useMemo(() => parSection(brief?.lines, kind), [brief, kind])
  const retirees = (brief?.lines || []).filter((l) => l.retire)

  const preparer = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('point_semaine_preparer', { p_week: semaine, p_kind: kind })
    setBusy(false)
    if (error) return toast.error(error.message)
    setBrief(data); setNote(data?.note || '')
    toast.success(brief ? 'Point actualisé : vos choix sont gardés' : 'Point préparé')
  }

  // Les lignes sont réécrites d'un bloc ; l'état local suit la base
  const enregistrer = async (lines, extra = {}) => {
    const { data, error } = await supabase.from('weekly_briefs').update({ lines, ...extra }).eq('id', brief.id).select('*').single()
    if (error) { toast.error(error.message); return false }
    setBrief(data)
    return true
  }
  const majLigne = (id, patch) => enregistrer(brief.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  const enAction = async (l) => {
    try {
      const a = await creerAction({ title: l.texte, owner_id: l.owner_id || null, due_on: decaler(semaine, 4), urgent: l.section === 'urgent',
        source: kind, source_id: brief.id, link: l.lien })
      await majLigne(l.id, { action_id: a.id })
      toast.success('Action créée')
    } catch (e) { toast.error(e.message) }
  }

  const suite = async (l, s) => {
    const nouvelle = l.suite === s ? null : s
    try {
      let actionId = l.action_id || null
      if (nouvelle === 'reporte') {
        if (actionId) await modifierAction(actionId, { status: 'a_faire', due_on: decaler(semaine, 7) })
        else actionId = (await creerAction({ title: l.texte, owner_id: l.owner_id || null, due_on: decaler(semaine, 7), source: 'bilan', source_id: brief.id, link: l.lien })).id
      } else if (actionId) {
        await modifierAction(actionId, { status: nouvelle === 'fait' ? 'fait' : nouvelle === 'abandonne' ? 'abandonne' : 'a_faire' })
      }
      await majLigne(l.id, { suite: nouvelle, action_id: actionId })
    } catch (e) { toast.error(e.message) }
  }

  const ajouter = async () => {
    const texte = ajout.texte.trim()
    if (texte.length < 2) return
    const ligne = { id: `m:${crypto.randomUUID()}`, section: ajout.section, texte, manuel: true,
      owner_id: ajout.owner_id || null, owner_nom: ajout.owner_id ? noms[ajout.owner_id] : null }
    try {
      if (ajout.action) {
        const a = await creerAction({ title: texte, owner_id: ajout.owner_id || null, due_on: ajout.due_on || decaler(semaine, 4), urgent: ajout.section === 'urgent', source: kind, source_id: brief.id })
        ligne.action_id = a.id
      }
      if (await enregistrer([...brief.lines, ligne])) { setAjout(null); toast.success('Ligne ajoutée') }
    } catch (e) { toast.error(e.message) }
  }

  const voirApercu = async () => {
    setBusy(true)
    try { setApercu(await callApi('/api/point-semaine', { brief_id: brief.id, apercu: true })) } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  const envoyer = async () => {
    if (!await confirmer(`Envoyer le ${kind === 'bilan' ? 'bilan' : 'point'} à ${dest.length} personne${dest.length > 1 ? 's' : ''} (${dest.join(', ')}) ?`)) return
    setBusy(true)
    try {
      const r = await callApi('/api/point-semaine', { brief_id: brief.id })
      toast.success(`Envoyé à ${r.destinataires} personne${r.destinataires > 1 ? 's' : ''}`)
      setApercu(null); charger()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const choixSections = SECTIONS.filter((s) => (kind === 'bilan' ? s.bi : s.pt))

  return (
    <div className="space-y-4">
      <PageHeader title={kind === 'bilan' ? 'Bilan de la semaine' : 'Point de la semaine'}
        meta={<span>{titreSemaine(semaine)}. Préparé à partir des données : retirez, ajoutez, attribuez, puis envoyez.</span>}
        actions={<>
          <button type="button" className="btn btn-ghost" onClick={() => aller(decaler(semaine, -7))} aria-label="Semaine précédente"><ChevronLeft className="w-4 h-4" /></button>
          <button type="button" className="btn btn-ghost" onClick={() => aller(lundi())}>Cette semaine</button>
          <button type="button" className="btn btn-ghost" onClick={() => aller(decaler(semaine, 7))} aria-label="Semaine suivante"><ChevronRight className="w-4 h-4" /></button>
        </>} />
      <Tabs tabs={[{ id: 'point', label: 'Point du lundi' }, { id: 'bilan', label: 'Bilan du vendredi' }]} value={kind} onChange={(k) => aller(semaine, k)} />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" onClick={preparer} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{brief ? 'Actualiser' : 'Préparer'}
        </button>
        {brief && <button type="button" className="btn btn-secondary" onClick={() => setAjout({ ...VIDE })}><Plus className="w-4 h-4" />Ajouter une ligne</button>}
        {brief && <button type="button" className="btn btn-secondary" onClick={voirApercu} disabled={busy}><Eye className="w-4 h-4" />Aperçu de l'email</button>}
        {brief && <button type="button" className="btn btn-secondary" onClick={envoyer} disabled={busy || !dest.length}><Send className="w-4 h-4" />Envoyer</button>}
        <Link to="/actions" className="btn btn-ghost ml-auto"><ListPlus className="w-4 h-4" />Actions de l'équipe</Link>
      </div>

      <div className="text-ui-sm text-gray-600 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1"><Users className="w-4 h-4" aria-hidden="true" />
          {dest.length ? `Destinataires : ${dest.join(', ')}` : 'Aucun destinataire choisi'}
          <Link to="/parametres?section=utilisateurs" className="text-accent-700 hover:underline ml-1">Choisir</Link>
        </span>
        {brief?.prepared_at && <span>Préparé le {fr(brief.prepared_at)}{brief.prepared_by ? '' : ' (automatiquement)'}</span>}
        {brief?.sent_at && <span>Envoyé le {fr(brief.sent_at)} à {(brief.sent_to || []).length} personne{(brief.sent_to || []).length > 1 ? 's' : ''}</span>}
      </div>

      {brief === undefined ? <div className="text-ui-sm text-gray-500">Chargement…</div>
        : brief === null ? (
          <Banner tone="info">{kind === 'bilan'
            ? 'Le bilan reprend le point de la semaine. Préparez-le pour marquer chaque ligne faite, reportée ou abandonnée.'
            : 'Pas encore de point pour cette semaine. « Préparer » le construit à partir des factures, sessions, visites, affaires, devis et actions.'}</Banner>
        ) : <>
          <div className="card p-3">
            <label className="label" htmlFor="pt-note">Mot de la direction (en tête de l'email)</label>
            <textarea id="pt-note" className="input min-h-[70px]" maxLength={4000} value={note} placeholder="Ex. : bonne semaine à tous, priorité aux conventions à faire signer."
              onChange={(e) => setNote(e.target.value)} onBlur={() => { if ((brief.note || '') !== note) enregistrer(brief.lines, { note: note || null }) }} />
          </div>
          {sections.length === 0 && <Banner tone="success">Rien à signaler cette semaine.</Banner>}
          {sections.map((s) => (
            <section key={s.id} className="surface overflow-hidden" aria-label={s.titre}>
              <div className="px-4 py-2 border-b hairline flex items-center gap-2">
                <h2 className={`section-title ${s.id === 'urgent' ? 'text-red-700' : s.id === 'bravo' ? 'text-green-700' : ''}`}>{s.titre}</h2>
                <span className="text-ui-sm text-gray-500">{s.lignes.length}</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {s.lignes.map((l) => (
                  <li key={l.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="flex-1 min-w-[220px]">
                      <div className={`text-ui ${l.suite === 'fait' || l.suite === 'abandonne' ? 'line-through text-gray-500' : 'text-gray-900'}`}>{l.texte}</div>
                      <div className="text-ui-sm text-gray-500 flex flex-wrap items-center gap-x-2">
                        <select className="bg-transparent text-ui-sm text-gray-600 border-0 p-0 pr-5 focus:ring-0" value={l.owner_id || ''} aria-label="Qui s'en occupe"
                          onChange={(e) => majLigne(l.id, { owner_id: e.target.value || null, owner_nom: e.target.value ? noms[e.target.value] : null, owner_choisi: true })}>
                          <option value="">Personne en particulier</option>
                          {equipe.map((p) => <option key={p.id} value={p.id}>{nomProfil(p)}</option>)}
                        </select>
                        {l.action_id && <Link to="/actions" className="text-accent-700 hover:underline">action suivie</Link>}
                        {l.manuel && <span>ajoutée à la main</span>}
                      </div>
                    </div>
                    {kind === 'bilan' && !['bravo'].includes(s.id) && (
                      <div className="inline-flex rounded-ui border border-gray-200 overflow-hidden" role="group" aria-label="Suite">
                        {SUITES.map((x) => (
                          <button key={x.id} type="button" onClick={() => suite(l, x.id)} aria-pressed={l.suite === x.id}
                            className={`px-2.5 py-1 text-ui-sm ${l.suite === x.id ? (x.id === 'fait' ? 'bg-green-600 text-white' : x.id === 'reporte' ? 'bg-amber-500 text-white' : 'bg-gray-500 text-white') : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                            {x.libelle}
                          </button>
                        ))}
                      </div>
                    )}
                    {kind === 'point' && !l.action_id && !['bravo', 'anniversaire'].includes(s.id) && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => enAction(l)} title="Suivre comme une action, pour la personne choisie">
                        <ListPlus className="w-4 h-4" />Action
                      </button>
                    )}
                    {l.lien && <Link to={l.lien} className="btn btn-ghost btn-sm" title="Ouvrir"><ExternalLink className="w-4 h-4" /></Link>}
                    <button type="button" className="btn btn-ghost btn-sm" title="Retirer du point" aria-label="Retirer du point" onClick={() => majLigne(l.id, { retire: true })}><X className="w-4 h-4" /></button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {retirees.length > 0 && (
            <details className="surface px-4 py-2">
              <summary className="text-ui-sm text-gray-600 cursor-pointer">{retirees.length} ligne{retirees.length > 1 ? 's' : ''} retirée{retirees.length > 1 ? 's' : ''}</summary>
              <ul className="mt-2 space-y-1">
                {retirees.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 text-ui-sm text-gray-600">
                    <span className="flex-1">{l.texte}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => majLigne(l.id, { retire: false })}><Undo2 className="w-4 h-4" />Remettre</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>}

      {ajout && (
        <Sheet title="Ajouter une ligne" onClose={() => setAjout(null)}
          footer={<><button type="button" className="btn btn-secondary" onClick={() => setAjout(null)}>Annuler</button>
            <button type="button" className="btn btn-primary" onClick={ajouter} disabled={ajout.texte.trim().length < 2}>Ajouter</button></>}>
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="aj-section">Rubrique</label>
              <select id="aj-section" className="select" value={ajout.section} onChange={(e) => setAjout({ ...ajout, section: e.target.value })}>
                {choixSections.map((s) => <option key={s.id} value={s.id}>{s.titre}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="aj-texte">Texte</label>
              <textarea id="aj-texte" className="input min-h-[80px]" maxLength={300} value={ajout.texte} onChange={(e) => setAjout({ ...ajout, texte: e.target.value })}
                placeholder="Ex. : bravo à Anthony pour le contrat signé chez…, ou : préparer le salon de novembre" />
            </div>
            <div>
              <label className="label" htmlFor="aj-qui">Qui</label>
              <select id="aj-qui" className="select" value={ajout.owner_id} onChange={(e) => setAjout({ ...ajout, owner_id: e.target.value })}>
                <option value="">Personne en particulier</option>
                {equipe.map((p) => <option key={p.id} value={p.id}>{nomProfil(p)}</option>)}
              </select>
            </div>
            <label className="inline-flex items-center gap-2 text-ui">
              <input type="checkbox" checked={ajout.action} onChange={(e) => setAjout({ ...ajout, action: e.target.checked })} />Suivre comme une action
            </label>
            {ajout.action && (
              <div>
                <label className="label" htmlFor="aj-date">Pour le</label>
                <input id="aj-date" type="date" className="input" value={ajout.due_on || decaler(semaine, 4)} onChange={(e) => setAjout({ ...ajout, due_on: e.target.value })} />
                <p className="text-ui-sm text-gray-500 mt-1">Par défaut le vendredi {jjmm(decaler(semaine, 4))}.</p>
              </div>
            )}
          </div>
        </Sheet>
      )}

      {apercu && (
        <Sheet title="Aperçu de l'email" size="lg" onClose={() => setApercu(null)}
          footer={<><button type="button" className="btn btn-secondary" onClick={() => setApercu(null)}>Fermer</button>
            <button type="button" className="btn btn-primary" onClick={envoyer} disabled={busy}><Send className="w-4 h-4" />Envoyer</button></>}>
          <p className="text-ui-sm text-gray-600">Destinataires : {(apercu.destinataires || []).join(', ')}</p>
          <iframe title="Aperçu" className="w-full border rounded-ui bg-white" style={{ minHeight: 480 }} sandbox="" srcDoc={apercu.html} />
        </Sheet>
      )}
    </div>
  )
}

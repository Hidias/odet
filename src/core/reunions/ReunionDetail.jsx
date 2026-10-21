import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Sparkles, Loader2, Plus, Check, Trash2, Copy, Mail, Save, ListChecks, BookOpenText, UserPlus, X } from 'lucide-react'
import { supabase } from '../supabase'
import { callApi } from '../api'
import { useAuthStore } from '../store'
import { PageHeader } from '../../ui/PageHeader'
import { StatusBadge } from '../../ui/StatusBadge'
import { Sheet } from '../../ui/Sheet'
import { Banner } from '../../ui/Banner'
import { confirmer } from '../../ui/Confirm'
import SpeechToTextButton from '../../ui/SpeechToTextButton'
import { TYPES_REUNION, RACCOURCIS, nouvelElement, insererLigne, membreDepuisNom, texteCompteRendu, lienMessagerie, pointLocal } from './reunions'
import { chargerEquipe, nomProfil, creerAction } from '../point/actions'

// Réunion ou rendez-vous (0408) : à gauche le guide (questions à poser, sujets à traiter, cochés au fil de l'échange,
// avec la réponse notée), à droite la prise de notes à la volée (raccourcis Décision, Action, À relancer, Info ;
// dictée possible). « Faire le point » range le tout et prépare l'email récapitulatif, à relire et envoyer soi-même.

const fr = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' }) : '')

export default function ReunionDetail() {
  const { id } = useParams()
  const moi = useAuthStore((s) => s.profile)
  const [m, setM] = useState(undefined)
  const [notes, setNotes] = useState('')
  const [equipe, setEquipe] = useState([])
  const [contacts, setContacts] = useState([])
  const [nouvelItem, setNouvelItem] = useState('')
  const [point, setPoint] = useState(null)
  const [busy, setBusy] = useState(false)
  const [vue, setVue] = useState('notes')
  const zone = useRef(null)
  const derniereSauvegarde = useRef('')

  const charger = async () => {
    const { data, error } = await supabase.from('meetings').select('*, clients(id, name, email, contact_email), suppliers(id, name, email)').eq('id', id).maybeSingle()
    if (error || !data) { setM(null); return }
    setM(data)
    setNotes(data.notes || '')
    derniereSauvegarde.current = data.notes || ''
    if (data.client_id) {
      const { data: c } = await supabase.from('client_contacts').select('id, name, first_name, last_name, email, fonction, role').eq('client_id', data.client_id)
      setContacts(c || [])
    }
  }
  useEffect(() => { charger(); chargerEquipe().then(setEquipe) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const enregistrer = async (patch, silencieux = true) => {
    const { data, error } = await supabase.from('meetings').update(patch).eq('id', id).select('*, clients(id, name, email, contact_email), suppliers(id, name, email)').single()
    if (error) { toast.error(error.message); return null }
    setM(data)
    if (!silencieux) toast.success('Enregistré')
    return data
  }

  // Notes : enregistrées toutes les 4 secondes si elles ont changé, et en quittant la zone
  const sauverNotes = async () => {
    if (notes === derniereSauvegarde.current) return
    derniereSauvegarde.current = notes
    await enregistrer({ notes })
  }
  useEffect(() => {
    if (m === undefined || m === null) return undefined
    const t = setTimeout(sauverNotes, 4000)
    return () => clearTimeout(t)
  }, [notes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Raccourci : la ligne est insérée au curseur, qui se place juste après ; le bouton ne prend pas le focus (sinon la
  // barre d'espace le déclencherait à nouveau pendant la frappe)
  const curseurVoulu = useRef(null)
  const raccourci = (r) => {
    const el = zone.current
    const pos = el && document.activeElement === el ? el.selectionStart : notes.length
    const { texte, curseur } = insererLigne(notes, pos, r.prefixe)
    curseurVoulu.current = curseur
    setNotes(texte)
  }
  useLayoutEffect(() => {
    const el = zone.current
    if (curseurVoulu.current == null || !el) return
    el.focus()
    el.setSelectionRange(curseurVoulu.current, curseurVoulu.current)
    curseurVoulu.current = null
  }, [notes])
  const dictee = (t) => setNotes((n) => `${n}${n && !n.endsWith('\n') && !n.endsWith(' ') ? ' ' : ''}${t}`)

  const majGuide = (guide) => enregistrer({ guide })
  const majElement = (eid, patch) => majGuide(m.guide.map((g) => (g.id === eid ? { ...g, ...patch } : g)))
  const ajouterElement = (type) => {
    if (nouvelItem.trim().length < 2) return
    majGuide([...(m.guide || []), nouvelElement(nouvelItem, type)])
    setNouvelItem('')
  }

  const ajouterParticipant = (p) => enregistrer({ participants: [...(m.participants || []), p] })
  const retirerParticipant = (i) => enregistrer({ participants: m.participants.filter((_, j) => j !== i) })

  const faireLePoint = async () => {
    await sauverNotes()
    setBusy(true)
    try {
      // Sans assistant configuré (ou indisponible) : les notes sont rangées d'après leurs raccourcis
      let r
      try { r = await callApi('/api/reunion-point', { meeting_id: id }) } catch (e) {
        if (/pas encore de notes/i.test(e.message)) throw e
        r = pointLocal({ ...m, notes }, equipe, nomProfil)
      }
      setPoint({
        ...r,
        actions: r.actions.map((a) => ({ ...a, suivre: true, owner_id: membreDepuisNom(a.qui, equipe, nomProfil)?.id || '' })),
        a: destinatairesParDefaut(),
      })
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  const destinatairesParDefaut = () => {
    if (m.kind === 'reunion_interne') return (m.participants || []).map((p) => p.email).filter(Boolean)
    const parts = (m.participants || []).map((p) => p.email).filter(Boolean)
    if (parts.length) return parts
    return [m.clients?.contact_email || m.clients?.email || m.suppliers?.email].filter(Boolean)
  }

  const terminer = async () => {
    setBusy(true)
    try {
      const resume = { resume: point.resume, decisions: point.decisions, a_relancer: point.a_relancer, prochain_rdv: point.prochain_rdv,
        email: point.email, actions: point.actions.filter((a) => a.suivre).map((a) => ({ titre: a.titre, qui: a.owner_id ? nomProfil(equipe.find((p) => p.id === a.owner_id)) : a.qui, echeance: a.echeance })) }
      const ids = []
      for (const a of point.actions.filter((x) => x.suivre && x.titre.trim().length >= 2)) {
        const cree = await creerAction({ title: a.titre, owner_id: a.owner_id || null, due_on: a.echeance || null, source: 'reunion', source_id: id,
          client_id: m.client_id || null, link: `/reunions/${id}` })
        ids.push(cree.id)
      }
      await enregistrer({ summary: { ...resume, action_ids: ids }, status: 'terminee', notes })
      if (m.client_id) {
        await supabase.from('client_interactions').insert({ client_id: m.client_id, type: 'meeting', title: `Compte rendu : ${m.title}`.slice(0, 250),
          content: texteCompteRendu(resume), author: nomProfil(moi) || null, interaction_date: m.starts_at || new Date().toISOString(), metadata: { meeting_id: id } })
      }
      toast.success(ids.length ? `Compte rendu enregistré, ${ids.length} action${ids.length > 1 ? 's' : ''} suivie${ids.length > 1 ? 's' : ''}` : 'Compte rendu enregistré')
      setPoint(null)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const rouvrir = async () => {
    if (!await confirmer('Rouvrir la réunion pour compléter les notes ? Le compte rendu enregistré est gardé jusqu\'au prochain.')) return
    enregistrer({ status: 'preparee' })
  }

  const emailCourant = point?.email || m?.summary?.email
  const guideFait = useMemo(() => (m?.guide || []).filter((g) => g.coche).length, [m?.guide])
  if (m === undefined) return <div className="text-ui-sm text-gray-500">Chargement…</div>
  if (m === null) return <Banner tone="warning">Réunion introuvable.</Banner>
  const tiers = m.clients ? <Link to={`/clients/${m.clients.id}`} className="text-accent-700 hover:underline">{m.clients.name}</Link> : m.suppliers?.name
  const close = m.status === 'terminee'

  return (
    <div className="space-y-4">
      <PageHeader crumbs={[{ label: 'Réunions', to: '/reunions' }, { label: m.title }]} title={m.title}
        meta={<span>{TYPES_REUNION[m.kind]}{tiers ? <> · {tiers}</> : null}{m.starts_at ? ` · ${fr(m.starts_at)}` : ''}{m.location ? ` · ${m.location}` : ''}</span>}
        status={<StatusBadge tone={close ? 'success' : 'info'}>{close ? 'Compte rendu fait' : 'En cours'}</StatusBadge>}
        actions={close
          ? <button type="button" className="btn btn-secondary" onClick={rouvrir}>Rouvrir</button>
          : <button type="button" className="btn btn-primary" onClick={faireLePoint} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}Faire le point</button>} />

      <Participants m={m} contacts={contacts} equipe={equipe} onAjouter={ajouterParticipant} onRetirer={retirerParticipant} disabled={close} />

      {close && m.summary && <CompteRendu s={m.summary} email={emailCourant} a={destinatairesParDefaut()} />}

      {/* Téléphone : un onglet à la fois ; écran large : les deux colonnes */}
      <div className="md:hidden inline-flex rounded-ui border border-gray-200 overflow-hidden" role="tablist">
        {[['guide', `Guide (${guideFait}/${(m.guide || []).length})`], ['notes', 'Notes']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={vue === k} onClick={() => setVue(k)}
            className={`px-3 py-1.5 text-ui ${vue === k ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'}`}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4 items-start">
        <section className={`surface overflow-hidden ${vue === 'guide' ? '' : 'hidden md:block'}`} aria-label="Guide">
          <div className="px-4 py-2 border-b hairline flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-gray-500" aria-hidden="true" />
            <h2 className="section-title">Guide</h2>
            <span className="text-ui-sm text-gray-500 ml-auto">{guideFait} / {(m.guide || []).length} traités</span>
          </div>
          {(m.guide || []).length === 0 && <p className="px-4 py-3 text-ui-sm text-gray-500">Pas de trame : ajoutez les questions à poser ou les sujets à traiter.</p>}
          <ul className="divide-y divide-gray-100">
            {(m.guide || []).map((g) => (
              <li key={g.id} className="px-4 py-2.5">
                <div className="flex items-start gap-2">
                  <button type="button" disabled={close} onClick={() => majElement(g.id, { coche: !g.coche })} aria-label={g.coche ? 'Marquer non traité' : 'Marquer traité'}
                    className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center flex-none ${g.coche ? 'bg-green-600 border-green-600 text-white' : 'border-gray-300'}`}>
                    {g.coche && <Check className="w-3.5 h-3.5" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`text-ui ${g.coche ? 'text-gray-500' : 'text-gray-900'}`}>
                      {g.type === 'sujet' && <span className="status status-neutral mr-1.5">Sujet</span>}{g.texte}
                    </div>
                    <AutoTextarea valeur={g.reponse || ''} disabled={close} placeholder={g.type === 'sujet' ? 'Ce qui a été dit…' : 'Réponse…'}
                      onSave={(v) => { if (v !== (g.reponse || '')) majElement(g.id, { reponse: v, coche: g.coche || !!v.trim() }) }} />
                  </div>
                  {!close && <button type="button" className="btn btn-ghost btn-sm" aria-label="Retirer" title="Retirer" onClick={() => majGuide(m.guide.filter((x) => x.id !== g.id))}><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              </li>
            ))}
          </ul>
          {!close && (
            <div className="px-4 py-3 border-t hairline flex gap-2">
              <input className="input" placeholder="Ajouter une question ou un sujet" value={nouvelItem} maxLength={300}
                onChange={(e) => setNouvelItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ajouterElement('question') } }} />
              <button type="button" className="btn btn-secondary" onClick={() => ajouterElement('question')} title="Ajouter une question"><Plus className="w-4 h-4" />Question</button>
              <button type="button" className="btn btn-ghost" onClick={() => ajouterElement('sujet')} title="Ajouter un sujet">Sujet</button>
            </div>
          )}
        </section>

        <section className={`surface overflow-hidden ${vue === 'notes' ? '' : 'hidden md:block'}`} aria-label="Notes">
          <div className="px-4 py-2 border-b hairline flex flex-wrap items-center gap-2">
            <BookOpenText className="w-4 h-4 text-gray-500" aria-hidden="true" />
            <h2 className="section-title mr-auto">Notes à la volée</h2>
            {!close && RACCOURCIS.map((r) => (
              <button key={r.id} type="button" tabIndex={-1} className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => raccourci(r)} title={`Nouvelle ligne « ${r.prefixe.trim()} »`}>{r.libelle}</button>
            ))}
            {!close && <SpeechToTextButton onTranscript={dictee} compact />}
          </div>
          <textarea ref={zone} className="w-full border-0 focus:ring-0 p-4 text-ui leading-relaxed min-h-[420px] resize-y" value={notes} disabled={close}
            onChange={(e) => setNotes(e.target.value)} onBlur={sauverNotes} maxLength={50000}
            placeholder={'Écrivez en vrac pendant l\'échange.\nLes raccourcis ajoutent une ligne « Décision : », « Action : », « À relancer : » ou « Info : » : l\'assistant s\'en sert pour ranger.'} />
          <div className="px-4 py-1.5 border-t hairline text-ui-sm text-gray-400">{notes === derniereSauvegarde.current ? 'Enregistré' : 'Modifications en cours…'}</div>
        </section>
      </div>

      {point && (
        <Sheet title="Faire le point" size="lg" onClose={() => setPoint(null)}
          footer={<>
            <button type="button" className="btn btn-secondary mr-auto" onClick={() => setPoint(null)}>Revenir aux notes</button>
            <button type="button" className="btn btn-primary" onClick={terminer} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Enregistrer le compte rendu</button>
          </>}>
          <div className="space-y-4">
            <Banner tone="info">{point.sansAssistant
              ? 'Notes rangées d\'après les raccourcis (Décision, Action, À relancer, Info) et les réponses du guide. Complétez si besoin. Rien n\'est envoyé.'
              : 'À relire : l\'assistant range vos notes sans rien inventer, mais vérifiez chaque ligne. Rien n\'est envoyé.'}</Banner>
            <div>
              <label className="label" htmlFor="pt-resume">Résumé</label>
              <textarea id="pt-resume" className="input min-h-[90px]" value={point.resume} onChange={(e) => setPoint({ ...point, resume: e.target.value })} />
            </div>
            <ListeEditable titre="Décisions" valeurs={point.decisions} onChange={(v) => setPoint({ ...point, decisions: v })} />
            <div>
              <div className="label">Actions à suivre</div>
              {point.actions.length === 0 && <p className="text-ui-sm text-gray-500">Aucune action relevée.</p>}
              <ul className="space-y-2">
                {point.actions.map((a, i) => (
                  <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)] md:grid-cols-[auto_minmax(0,1fr)_180px_150px] gap-2 items-center">
                    <input type="checkbox" checked={a.suivre} aria-label="Suivre cette action" onChange={(e) => setPoint({ ...point, actions: point.actions.map((x, j) => (j === i ? { ...x, suivre: e.target.checked } : x)) })} />
                    <input className="input" value={a.titre} onChange={(e) => setPoint({ ...point, actions: point.actions.map((x, j) => (j === i ? { ...x, titre: e.target.value } : x)) })} />
                    <select className="select" value={a.owner_id} aria-label="Qui" onChange={(e) => setPoint({ ...point, actions: point.actions.map((x, j) => (j === i ? { ...x, owner_id: e.target.value } : x)) })}>
                      <option value="">{a.qui ? `${a.qui} (hors équipe)` : 'Personne en particulier'}</option>
                      {equipe.map((p) => <option key={p.id} value={p.id}>{nomProfil(p)}</option>)}
                    </select>
                    <input type="date" className="input" value={a.echeance} aria-label="Pour le" onChange={(e) => setPoint({ ...point, actions: point.actions.map((x, j) => (j === i ? { ...x, echeance: e.target.value } : x)) })} />
                  </li>
                ))}
              </ul>
              <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setPoint({ ...point, actions: [...point.actions, { titre: '', qui: '', owner_id: moi?.id || '', echeance: '', suivre: true }] })}><Plus className="w-4 h-4" />Ajouter une action</button>
              <p className="text-ui-sm text-gray-500 mt-1">Les actions cochées partent dans les actions de l'équipe, avec un lien vers cette réunion.</p>
            </div>
            <ListeEditable titre="À relancer" valeurs={point.a_relancer} onChange={(v) => setPoint({ ...point, a_relancer: v })} />
            <div>
              <label className="label" htmlFor="pt-rdv">Prochain rendez-vous</label>
              <input id="pt-rdv" className="input" value={point.prochain_rdv} onChange={(e) => setPoint({ ...point, prochain_rdv: e.target.value })} />
            </div>
            <div className="space-y-2">
              <div className="label">Email récapitulatif</div>
              <input className="input" aria-label="Destinataires" value={(point.a || []).join(', ')} placeholder="Adresses séparées par des virgules"
                onChange={(e) => setPoint({ ...point, a: e.target.value.split(',').map((x) => x.trim()) })} />
              <input className="input" aria-label="Objet" value={point.email.objet} onChange={(e) => setPoint({ ...point, email: { ...point.email, objet: e.target.value } })} />
              <textarea className="input min-h-[220px]" aria-label="Message" value={point.email.corps} onChange={(e) => setPoint({ ...point, email: { ...point.email, corps: e.target.value } })} />
              <EmailBoutons a={point.a} email={point.email} />
            </div>
          </div>
        </Sheet>
      )}
    </div>
  )
}

function AutoTextarea({ valeur, onSave, disabled, placeholder }) {
  const [v, setV] = useState(valeur)
  useEffect(() => { setV(valeur) }, [valeur])
  return (
    <textarea className="mt-1 w-full rounded-ui border border-transparent hover:border-gray-200 focus:border-gray-300 focus:ring-0 px-2 py-1 text-ui-sm text-gray-700 bg-gray-50"
      rows={v ? Math.min(6, v.split('\n').length + 1) : 1} value={v} disabled={disabled} placeholder={placeholder} maxLength={2000}
      onChange={(e) => setV(e.target.value)} onBlur={() => onSave(v)} />
  )
}

function ListeEditable({ titre, valeurs, onChange }) {
  return (
    <div>
      <label className="label">{titre}</label>
      <textarea className="input min-h-[70px]" value={(valeurs || []).join('\n')} placeholder="Une ligne par élément"
        onChange={(e) => onChange(e.target.value.split('\n'))} onBlur={(e) => onChange(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} />
    </div>
  )
}

function EmailBoutons({ a, email }) {
  const copier = async () => {
    try { await navigator.clipboard.writeText(`${email.objet}\n\n${email.corps}`); toast.success('Email copié') } catch { toast.error('Copie impossible') }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-secondary btn-sm" onClick={copier}><Copy className="w-4 h-4" />Copier</button>
      <a className="btn btn-secondary btn-sm" href={lienMessagerie({ a: a || [], objet: email.objet, corps: email.corps })}><Mail className="w-4 h-4" />Ouvrir dans ma messagerie</a>
      <span className="text-ui-sm text-gray-500 self-center">Vous relisez et envoyez vous-même.</span>
    </div>
  )
}

function CompteRendu({ s, email, a }) {
  const bloc = (titre, l) => (l && l.length ? <div><div className="text-ui-sm font-medium text-gray-700">{titre}</div><ul className="list-disc pl-5 text-ui text-gray-900">{l.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null)
  return (
    <section className="surface p-4 space-y-3" aria-label="Compte rendu">
      <h2 className="section-title">Compte rendu</h2>
      {s.resume && <p className="text-ui text-gray-900 whitespace-pre-line">{s.resume}</p>}
      {bloc('Décisions', s.decisions)}
      {bloc('Actions suivies', (s.actions || []).map((x) => [x.titre, x.qui, x.echeance].filter(Boolean).join(' · ')))}
      {bloc('À relancer', s.a_relancer)}
      {s.prochain_rdv && <p className="text-ui"><span className="font-medium">Prochain rendez-vous :</span> {s.prochain_rdv}</p>}
      {email?.corps && (
        <details>
          <summary className="text-ui-sm text-gray-600 cursor-pointer">Email récapitulatif</summary>
          <div className="mt-2 space-y-2">
            <div className="text-ui font-medium">{email.objet}</div>
            <pre className="text-ui whitespace-pre-wrap font-sans text-gray-800">{email.corps}</pre>
            <EmailBoutons a={a} email={email} />
          </div>
        </details>
      )}
      {(s.action_ids || []).length > 0 && <Link to="/actions" className="text-ui-sm text-accent-700 hover:underline">Voir les actions de l'équipe</Link>}
    </section>
  )
}

function Participants({ m, contacts, equipe, onAjouter, onRetirer, disabled }) {
  const [ouvert, setOuvert] = useState(false)
  const [libre, setLibre] = useState({ nom: '', role: '', email: '' })
  const deja = new Set((m.participants || []).map((p) => (p.email || p.nom || '').toLowerCase()))
  const propositions = [
    ...contacts.map((c) => ({ nom: c.name || [c.first_name, c.last_name].filter(Boolean).join(' '), role: c.fonction || c.role || '', email: c.email || '', interne: false })),
    ...equipe.map((p) => ({ nom: nomProfil(p), role: 'Équipe', email: p.email || '', interne: true, profile_id: p.id })),
  ].filter((p) => p.nom && !deja.has((p.email || p.nom).toLowerCase()))
  return (
    <div className="flex flex-wrap items-center gap-2 text-ui-sm">
      <span className="text-gray-600">Participants :</span>
      {(m.participants || []).length === 0 && <span className="text-gray-400">aucun</span>}
      {(m.participants || []).map((p, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-gray-800">
          {p.nom}{p.role ? <span className="text-gray-500">, {p.role}</span> : null}
          {!disabled && <button type="button" aria-label={`Retirer ${p.nom}`} onClick={() => onRetirer(i)}><X className="w-3 h-3" /></button>}
        </span>
      ))}
      {!disabled && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOuvert(true)}><UserPlus className="w-4 h-4" />Ajouter</button>}
      {ouvert && (
        <Sheet title="Ajouter un participant" onClose={() => setOuvert(false)} footer={<button type="button" className="btn btn-secondary" onClick={() => setOuvert(false)}>Fermer</button>}>
          <div className="space-y-3">
            {propositions.length > 0 && (
              <ul className="divide-y divide-gray-100 border rounded-ui">
                {propositions.map((p, i) => (
                  <li key={i} className="px-3 py-2 flex items-center gap-2">
                    <span className="flex-1 text-ui">{p.nom}<span className="text-gray-500">{p.role ? `, ${p.role}` : ''}</span></span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAjouter(p)}><Plus className="w-4 h-4" />Ajouter</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input className="input" placeholder="Nom" value={libre.nom} onChange={(e) => setLibre({ ...libre, nom: e.target.value })} />
              <input className="input" placeholder="Fonction" value={libre.role} onChange={(e) => setLibre({ ...libre, role: e.target.value })} />
              <input className="input" type="email" placeholder="Email (facultatif)" value={libre.email} onChange={(e) => setLibre({ ...libre, email: e.target.value })} />
            </div>
            <button type="button" className="btn btn-primary btn-sm" disabled={libre.nom.trim().length < 2}
              onClick={() => { onAjouter({ nom: libre.nom.trim(), role: libre.role.trim(), email: libre.email.trim(), interne: false }); setLibre({ nom: '', role: '', email: '' }) }}>
              <Plus className="w-4 h-4" />Ajouter cette personne
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

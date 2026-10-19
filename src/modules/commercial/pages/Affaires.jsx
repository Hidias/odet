import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, Phone, MessageSquare, KanbanSquare, PhoneCall, Settings2, Check } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'
import { PageHeader } from '../../../ui/PageHeader'
import { Tabs } from '../../../ui/Tabs'
import { StatusBadge } from '../../../ui/StatusBadge'
import { Banner } from '../../../ui/Banner'
import { EmptyState } from '../../../ui/EmptyState'
import { Sheet } from '../../../ui/Sheet'
import { AffaireSheet, EchangeSheet, useListesCommerciales } from '../components/AffaireSheets'
import { useOuvrirSiDemande } from '../../../ui/useOuvrirSiDemande'
import { BadgeTest } from '../../../core/demo/BadgeTest'
import {
  urgence, URGENCES, trierAFaire, colonnesPipeline, totauxPipeline, cadence, CADENCE, euros, METIERS,
} from '../lib/affaires'

// Suivi des affaires (chantier 10, 0380). Trois vues, rien de plus :
//  - À faire : les affaires et devis à relancer, la plus ancienne action d'abord, et la cadence de la semaine ;
//  - Pipeline : les affaires ouvertes par étape, montant et montant pondéré ;
//  - À appeler : les clients qui ont une échéance dans les 90 jours (formations, matériel, contrats, exercices).
// Une affaire ouverte a toujours une prochaine action (la base le garantit).

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '—')
const NATURES = { formation: 'Formations', materiel: 'Matériel', contrat: 'Contrat', exercice: 'Exercice' }

export default function Affaires() {
  const { can, user } = useAuthStore()
  const peutModifier = can('commercial.devis.modifier') !== false
  const peutNoter = can('clients.historique.ecrire') !== false || can('clients.fiches.modifier') !== false
  const listes = useListesCommerciales()
  const location = useLocation()
  const [onglet, setOnglet] = useState(['a_faire', 'pipeline', 'appeler'].includes(location.state?.onglet) ? location.state.onglet : 'a_faire')
  const [pipeline, setPipeline] = useState(null)
  const [appeler, setAppeler] = useState(null)
  const [cad, setCad] = useState({ reel: [], obj: [] })
  const [erreur, setErreur] = useState(null)
  const [mes, setMes] = useState(false)
  const [edition, setEdition] = useState(null) // { affaire?, clientId? }
  const [echange, setEchange] = useState(null) // { clientId, clientName, affaire?, type? }
  const [reglages, setReglages] = useState(false)

  const charger = useCallback(async () => {
    const [p, a, r, o] = await Promise.all([
      supabase.from('v_pipeline').select('*').order('next_action_on', { ascending: true, nullsFirst: false }).limit(1000),
      supabase.from('v_clients_a_appeler').select('*').order('premiere_echeance').limit(500),
      supabase.from('v_cadence_semaine').select('*'),
      supabase.from('activity_targets').select('*'),
    ])
    if (p.error) { setErreur('Le suivi des affaires n\'est pas encore disponible sur cette instance (migration 0380).'); setPipeline([]); setAppeler([]); return }
    setPipeline(p.data || [])
    setAppeler(a.error ? [] : a.data || [])
    setCad({ reel: r.data || [], obj: o.data || [] })
  }, [])
  useEffect(() => { charger() }, [charger])
  // « + Nouveau › Affaire » (barre du haut)
  useOuvrirSiDemande(() => setEdition({}))

  const lignes = useMemo(() => (pipeline || []).filter((l) => !mes || !l.owner_id || l.owner_id === user?.id), [pipeline, mes, user?.id])
  const aFaire = useMemo(() => trierAFaire(lignes), [lignes])
  const colonnes = useMemo(() => colonnesPipeline(lignes, listes.etape), [lignes, listes.etape])
  const totaux = useMemo(() => totauxPipeline(lignes), [lignes])
  const maCadence = useMemo(() => cadence(cad.reel, cad.obj, user?.id), [cad, user?.id])
  const enRetard = aFaire.filter((l) => urgence(l.next_action_on) === 'retard').length

  const fermer = async (l, stage) => {
    if (l.origine === 'devis') return toast('Changez le statut du devis dans Devis : l\'affaire suit')
    if (stage === 'perdue') return setEdition({ affaire: { ...l, stage: 'perdue' } })
    const { error } = await supabase.from('opportunities').update({ stage }).eq('id', l.id)
    if (error) return toast.error(error.message)
    toast.success('Affaire gagnée')
    charger()
  }

  const nomEtape = (code) => (listes.etape.find((e) => e.code === code)?.label || code)

  const ligneAFaire = (l) => {
    const u = urgence(l.next_action_on)
    return (
      <li key={`${l.origine}-${l.id}`} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {l.next_action_on
              ? <StatusBadge tone={URGENCES[u][0]}>{u === 'retard' || u === 'aujourdhui' ? URGENCES[u][1] : fr(l.next_action_on)}</StatusBadge>
              : <StatusBadge tone="warning">Relance à dater</StatusBadge>}
            <Link to={`/clients/${l.client_id}`} className="font-semibold text-gray-900 hover:underline truncate">{l.client_name}</Link>
            <BadgeTest tbl="clients" id={l.client_id} />
          </div>
          <div className="text-ui-sm text-gray-600 truncate">
            {l.next_action || (l.origine === 'devis' ? 'Relancer le devis' : 'À suivre')} · {l.title}
          </div>
          <div className="text-ui-sm text-gray-400">{nomEtape(l.stage)}{l.amount_ht != null ? ` · ${euros(l.amount_ht)}` : ''}{l.origine === 'devis' ? ' · devis sans affaire' : ''}</div>
        </div>
        <div className="flex gap-2 flex-none">
          {peutNoter && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEchange({ clientId: l.client_id, clientName: l.client_name, affaire: l })}>
            <MessageSquare className="w-4 h-4" />Noter
          </button>}
          {peutModifier && l.origine === 'affaire' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdition({ affaire: l })}>Ouvrir</button>}
          {peutModifier && l.origine === 'devis' && <Link to={`/devis?open=${l.id}`} className="btn btn-ghost btn-sm">Devis</Link>}
        </div>
      </li>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Affaires" meta={<span>Qui rappeler, quoi signer, où en est chaque affaire.</span>}
        actions={peutModifier && <button type="button" className="btn btn-primary" onClick={() => setEdition({})}><Plus className="w-4 h-4" />Nouvelle affaire</button>} />
      {erreur && <Banner tone="warning">{erreur}</Banner>}

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={onglet} onChange={setOnglet} tabs={[
          { id: 'a_faire', label: 'À faire', count: aFaire.length },
          { id: 'pipeline', label: 'Pipeline', count: totaux.nb },
          { id: 'appeler', label: 'À appeler', count: appeler?.length ?? null },
        ]} />
        <label className="ml-auto inline-flex items-center gap-2 text-ui-sm text-gray-600">
          <input type="checkbox" checked={mes} onChange={(e) => setMes(e.target.checked)} />Mes affaires seulement
        </label>
        {peutModifier && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReglages(true)} title="Objectifs et listes"><Settings2 className="w-4 h-4" />Réglages</button>}
      </div>

      {onglet === 'a_faire' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="card p-4">
            {enRetard > 0 && <div className="text-ui-sm mb-2" style={{ color: 'rgb(var(--c-danger))' }}>{enRetard} action{enRetard > 1 ? 's' : ''} en retard</div>}
            {pipeline === null ? <div className="text-gray-500 text-ui-sm">Chargement…</div>
              : aFaire.length === 0 ? <EmptyState icon={Check} title="Rien à relancer" compact>Créez une affaire ou regardez l'onglet « À appeler ».</EmptyState>
                : <ul className="divide-y divide-gray-100">{aFaire.map(ligneAFaire)}</ul>}
          </div>
          <div className="card p-4 space-y-3 self-start">
            <div className="font-display font-semibold">Ma semaine</div>
            {Object.entries(CADENCE).map(([k, label]) => {
              const c = maCadence[k]
              const pct = c.objectif ? Math.min(100, Math.round((c.reel / c.objectif) * 100)) : 0
              return (
                <div key={k}>
                  <div className="flex justify-between text-ui-sm"><span>{label}</span>
                    <span className="tabular-nums text-gray-600">{c.reel}{c.objectif != null ? ` / ${c.objectif}` : ''}</span></div>
                  {c.objectif != null && <div className="h-1.5 rounded-full bg-gray-100 mt-1"><div className="h-1.5 rounded-full bg-accent-500" style={{ width: `${pct}%` }} /></div>}
                </div>
              )
            })}
            <div className="text-ui-sm text-gray-400">Comptés : échanges notés et affaires créées depuis lundi.</div>
          </div>
        </div>
      )}

      {onglet === 'pipeline' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4 text-ui">
            <span><span className="text-gray-500">Ouvertes </span><b className="tabular-nums">{totaux.nb}</b></span>
            <span><span className="text-gray-500">Montant </span><b className="tabular-nums">{euros(totaux.montant)}</b></span>
            <span><span className="text-gray-500">Pondéré </span><b className="tabular-nums">{euros(totaux.pondere)}</b></span>
          </div>
          {totaux.nb === 0 ? <div className="card"><EmptyState icon={KanbanSquare} title="Aucune affaire ouverte" compact>Les affaires et les devis envoyés apparaissent ici.</EmptyState></div> : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {colonnes.map((c) => (
                <div key={c.code} className="card p-3 space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{c.label}</span>
                    <span className="text-ui-sm text-gray-500 tabular-nums">{c.probability} %</span>
                  </div>
                  <div className="text-ui-sm text-gray-500 tabular-nums">{c.lignes.length} · {euros(c.montant)} · pondéré {euros(c.pondere)}</div>
                  <ul className="space-y-1.5">
                    {c.lignes.map((l) => (
                      <li key={`${l.origine}-${l.id}`}>
                        <button type="button" className="w-full text-left rounded-ui-sm border border-gray-200 px-2.5 py-2 hover:bg-gray-50"
                          onClick={() => (l.origine === 'affaire' && peutModifier ? setEdition({ affaire: l }) : setEchange({ clientId: l.client_id, clientName: l.client_name, affaire: l }))}>
                          <div className="text-ui font-medium truncate">{l.client_name} <BadgeTest tbl="clients" id={l.client_id} /></div>
                          <div className="text-ui-sm text-gray-500 truncate">{l.title}</div>
                          <div className="text-ui-sm text-gray-400 flex justify-between"><span>{euros(l.amount_ht)}</span><span>{fr(l.next_action_on)}</span></div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {onglet === 'appeler' && (
        <div className="card p-4">
          <p className="text-ui-sm text-gray-500 mb-2">Clients avec une échéance dans les 90 jours. Un appel noté ici s'ajoute à l'historique du client.</p>
          {appeler === null ? <div className="text-gray-500 text-ui-sm">Chargement…</div>
            : appeler.length === 0 ? <EmptyState icon={PhoneCall} title="Personne à appeler" compact>Les échéances de formation, de matériel, de contrat et d'exercice des clients apparaissent ici.</EmptyState>
              : (
                <ul className="divide-y divide-gray-100">
                  {appeler.map((a) => (
                    <li key={a.client_id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge tone={a.depassee ? 'danger' : 'warning'}>{a.depassee ? 'Dépassée' : fr(a.premiere_echeance)}</StatusBadge>
                          <Link to={`/clients/${a.client_id}`} className="font-semibold text-gray-900 hover:underline truncate">{a.client_name}</Link>
                          <BadgeTest tbl="clients" id={a.client_id} />
                          {a.city && <span className="text-ui-sm text-gray-400">{a.city}</span>}
                        </div>
                        <div className="text-ui-sm text-gray-600">
                          {(a.natures || []).map((n) => NATURES[n] || n).join(', ')} · {a.nb_echeances} échéance{a.nb_echeances > 1 ? 's' : ''}
                          {a.affaire_en_cours ? ' · affaire en cours' : ''}{a.devis_en_cours ? ' · devis en cours' : ''}
                        </div>
                        <div className="text-ui-sm text-gray-400">
                          {a.contact_name || 'Contact à trouver'}{a.dernier_echange ? ` · dernier échange le ${fr(a.dernier_echange)}` : ''}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-none items-center">
                        {a.ne_pas_appeler ? <StatusBadge tone="neutral">Ne pas appeler</StatusBadge>
                          : a.contact_phone && <a className="btn btn-secondary btn-sm" href={`tel:${a.contact_phone.replace(/\s+/g, '')}`}><Phone className="w-4 h-4" />{a.contact_phone}</a>}
                        {peutNoter && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEchange({ clientId: a.client_id, clientName: a.client_name, type: 'call' })}>Noter</button>}
                        {peutModifier && !a.affaire_en_cours && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdition({ clientId: a.client_id, affaire: { client_id: a.client_id, title: `Échéance ${(a.natures || []).map((n) => NATURES[n] || n).join(', ').toLowerCase()}`, metier: (a.natures || []).includes('formation') ? 'formation' : 'maintenance' } })}>Affaire</button>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
        </div>
      )}

      {edition && <AffaireSheet affaire={edition.affaire?.id ? edition.affaire : (edition.affaire ? { ...edition.affaire, id: undefined } : null)}
        clientId={edition.clientId || null} listes={listes} onClose={() => setEdition(null)} onSaved={charger} />}
      {echange && <EchangeSheet clientId={echange.clientId} clientName={echange.clientName} affaire={echange.affaire || null}
        typeDepart={echange.type || 'call'} onClose={() => setEchange(null)} onSaved={charger} />}
      {reglages && <ReglagesAffaires listes={listes} objectifs={cad.obj} onClose={() => setReglages(false)} onSaved={charger} />}
    </div>
  )
}

// Objectifs de la semaine (équipe) et listes (étapes, sources, motifs de perte, segments)
function ReglagesAffaires({ listes, objectifs, onClose, onSaved }) {
  const depart = Object.fromEntries(Object.keys(CADENCE).map((k) => [k, objectifs.find((o) => o.kind === k && !o.profile_id)?.per_week ?? '']))
  const [obj, setObj] = useState(depart)
  const [lignes, setLignes] = useState(() => (listes.toutes || []).map((l) => ({ ...l })))
  const [ajout, setAjout] = useState({ kind: 'source', label: '' })
  const [busy, setBusy] = useState(false)
  const TITRES = { etape: 'Étapes (probabilité en %)', source: 'Sources', motif_perte: 'Motifs de perte', segment: 'Segments' }

  const enregistrer = async () => {
    setBusy(true)
    try {
      for (const [kind, v] of Object.entries(obj)) {
        const ex = objectifs.find((o) => o.kind === kind && !o.profile_id)
        if (v === '' || v == null) { if (ex) await supabase.from('activity_targets').delete().eq('id', ex.id); continue }
        const n = Math.max(0, Math.min(500, parseInt(v, 10) || 0))
        const r = ex ? await supabase.from('activity_targets').update({ per_week: n }).eq('id', ex.id)
          : await supabase.from('activity_targets').insert({ kind, per_week: n, profile_id: null })
        if (r.error) throw r.error
      }
      for (const l of lignes) {
        const o = (listes.toutes || []).find((x) => x.id === l.id)
        if (!o || (o.label === l.label && o.is_active === l.is_active && o.probability === l.probability)) continue
        const r = await supabase.from('commercial_lists').update({ label: l.label, is_active: l.is_active, probability: l.kind === 'etape' ? Number(l.probability) : null }).eq('id', l.id)
        if (r.error) throw r.error
      }
      toast.success('Réglages enregistrés')
      onSaved?.()
      onClose()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const ajouter = async () => {
    const label = ajout.label.trim()
    if (!label) return
    const code = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'autre'
    const pos = Math.max(0, ...lignes.filter((l) => l.kind === ajout.kind && l.position < 90).map((l) => l.position)) + 5
    const { data, error } = await supabase.from('commercial_lists').insert({ kind: ajout.kind, code, label, position: pos, probability: ajout.kind === 'etape' ? 50 : null }).select().single()
    if (error) return toast.error(error.message.includes('duplicate') ? 'Cet élément existe déjà' : error.message)
    setLignes((x) => [...x, data])
    setAjout((a) => ({ ...a, label: '' }))
  }

  return (
    <Sheet title="Réglages des affaires" onClose={onClose} size="lg"
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
        <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={busy}>Enregistrer</button>
      </>}>
      <div>
        <div className="font-semibold mb-1">Objectifs de l'équipe, par personne et par semaine</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(CADENCE).map(([k, label]) => (
            <div key={k}>
              <label className="label" htmlFor={`obj-${k}`}>{label}</label>
              <input id={`obj-${k}`} className="input" inputMode="numeric" value={obj[k]} placeholder="—" onChange={(e) => setObj((o) => ({ ...o, [k]: e.target.value }))} />
            </div>
          ))}
        </div>
      </div>
      {Object.entries(TITRES).map(([kind, titre]) => (
        <div key={kind}>
          <div className="font-semibold mb-1">{titre}</div>
          <ul className="space-y-1">
            {lignes.filter((l) => l.kind === kind).sort((a, b) => a.position - b.position).map((l) => {
              const fixe = kind === 'etape' && ['gagnee', 'perdue'].includes(l.code)
              return (
                <li key={l.id} className="flex items-center gap-2">
                  <input className="input flex-1" value={l.label} aria-label="Libellé" onChange={(e) => setLignes((x) => x.map((y) => (y.id === l.id ? { ...y, label: e.target.value } : y)))} />
                  {kind === 'etape' && <input className="input w-20" inputMode="numeric" value={l.probability ?? ''} disabled={fixe} aria-label="Probabilité"
                    onChange={(e) => setLignes((x) => x.map((y) => (y.id === l.id ? { ...y, probability: e.target.value } : y)))} />}
                  <label className="text-ui-sm text-gray-600 inline-flex items-center gap-1 w-20">
                    <input type="checkbox" checked={l.is_active} disabled={fixe} onChange={(e) => setLignes((x) => x.map((y) => (y.id === l.id ? { ...y, is_active: e.target.checked } : y)))} />Actif
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <div className="flex gap-2 items-end">
        <div>
          <label className="label" htmlFor="aj-kind">Ajouter à</label>
          <select id="aj-kind" className="select" value={ajout.kind} onChange={(e) => setAjout((a) => ({ ...a, kind: e.target.value }))}>
            {Object.entries(TITRES).map(([k, t]) => <option key={k} value={k}>{t.replace(/ \(.*\)/, '')}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="label" htmlFor="aj-label">Libellé</label>
          <input id="aj-label" className="input" value={ajout.label} onChange={(e) => setAjout((a) => ({ ...a, label: e.target.value }))} />
        </div>
        <button type="button" className="btn btn-secondary" onClick={ajouter}><Plus className="w-4 h-4" />Ajouter</button>
      </div>
      <p className="text-ui-sm text-gray-400">Les étapes « Gagnée » et « Perdue » sont fixes. Métiers proposés : {Object.values(METIERS).join(', ')}.</p>
    </Sheet>
  )
}

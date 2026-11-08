// Avis des financeurs (0517, Qualiopi indicateur 30), sous les preuves de l'indicateur 30.
// Une demande d'avis par financeur et par an, préparée la nuit dans « Relances à valider » (jamais envoyée sans vous) ;
// un échange saisi ici (webinaire, réunion, contrôle, site d'avis) couvre aussi l'année (guide V10, p. 37).
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { Sheet } from '../../../ui/Sheet'
import { StatusBadge } from '../../../ui/StatusBadge'
import { confirmer } from '../../../ui/Confirm'
import { enVueGroupe, societeEnCours, estRefusVueGroupe, MESSAGE_VUE_GROUPE } from '../../../core/company/societes'
import { anneesFinanceurs, ETATS_DEMANDE, QUESTIONS_FINANCEUR, TYPES_ECHANGE, TYPES_FINANCEUR, libelleEchange, raisonSansDemande } from '../lib/financeurs'

const anneeParis = () => Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric' }).format(new Date()))
const jourParis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')
const VIDE = { cle: '', type: 'opco', nom: '', kind: 'webinaire', date: '', notes: '' }

export default function SuiviFinanceurs({ canWrite }) {
  const [annee, setAnnee] = useState(anneeParis)
  const [liste, setListe] = useState(null) // null : chargement ou lecture impossible
  const [sansFinanceur, setSansFinanceur] = useState([])
  const [ouverte, setOuverte] = useState(true)
  const [avis, setAvis] = useState([])
  const [echanges, setEchanges] = useState([])
  const [erreur, setErreur] = useState(false)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const groupe = enVueGroupe()
  const ecrire = canWrite && !groupe

  const charger = useCallback(async () => {
    setErreur(false)
    const debut = `${annee}-01-01`
    const fin = `${annee}-12-31`
    const [s, a, e] = await Promise.all([
      supabase.rpc('financeurs_suivi', { p_annee: annee }),
      supabase.from('funder_feedback').select('id, funder_key, funder_name, answered_at, note_globale, q_information, q_administratif, q_qualite, q_relation, commentaire')
        .eq('year', annee).not('answered_at', 'is', null).order('answered_at', { ascending: false }),
      supabase.from('funder_exchanges').select('id, company_id, funder_type, funder_name, kind, happened_on, notes')
        .gte('happened_on', debut).lte('happened_on', fin).order('happened_on', { ascending: false }),
    ])
    if (s.error || a.error || e.error) { setErreur(true); setListe(null); return }
    setListe(s.data?.financeurs || []); setSansFinanceur(s.data?.sans_financeur || []); setOuverte(s.data?.annee_ouverte !== false)
    setAvis(a.data || []); setEchanges(e.data || [])
  }, [annee])
  useEffect(() => { charger() }, [charger])

  const ouvrir = () => setForm({ ...VIDE, date: jourParis(), cle: liste?.[0]?.cle || '' })
  const choisi = form && form.cle ? (liste || []).find((f) => f.cle === form.cle) : null

  const enregistrer = async (ev) => {
    ev.preventDefault()
    if (!form.date) return toast.error('Indiquez la date de l\'échange')
    if (form.date > jourParis()) return toast.error('La date de l\'échange ne peut pas être dans le futur')
    const ligne = choisi
      ? { company_id: choisi.company_id, funder_type: choisi.type, funder_name: choisi.nom, funder_client_id: choisi.fiche_echange || choisi.client_id || null }
      : { company_id: societeEnCours() || undefined, funder_type: form.type, funder_name: form.nom.trim(), funder_client_id: null }
    if (!choisi && ligne.funder_name.length < 2) return toast.error('Indiquez le nom du financeur')
    if (!ligne.company_id) delete ligne.company_id
    setBusy(true)
    const { error } = await supabase.from('funder_exchanges').insert({ ...ligne, kind: form.kind, happened_on: form.date, notes: form.notes.trim() || null })
    setBusy(false)
    if (error) return toast.error(estRefusVueGroupe(error) ? MESSAGE_VUE_GROUPE : /row-level security/i.test(error.message) ? 'Votre compte ne peut pas noter d\'échange' : error.message)
    toast.success('Échange noté')
    setForm(null)
    charger()
  }

  const retirer = async (x) => {
    if (!(await confirmer(`Retirer l'échange du ${fr(x.happened_on)} avec ${x.funder_name} ? Il ne comptera plus comme preuve.`))) return
    const { data, error } = await supabase.from('funder_exchanges').delete().eq('id', x.id).select('id')
    if (error) return toast.error(estRefusVueGroupe(error) ? MESSAGE_VUE_GROUPE : error.message)
    if (!data?.length) return toast.error('Votre compte ne peut pas retirer cet échange')
    toast.success('Échange retiré')
    charger()
  }

  return (
    <section className="space-y-3" aria-labelledby="financeurs-titre">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id="financeurs-titre" className="text-ui-sm font-semibold text-gray-500">FINANCEURS</span>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="financeurs-annee">Année</label>
          <select id="financeurs-annee" className="select w-auto" value={annee} onChange={(e) => setAnnee(Number(e.target.value))}>
            {[anneeParis(), anneeParis() - 1].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {ecrire && <button type="button" className="btn btn-secondary btn-sm" onClick={ouvrir}><Plus className="w-4 h-4" />Noter un échange</button>}
        </div>
      </div>
      {anneesFinanceurs().length > 1 && annee === anneeParis() && (
        <p className="text-ui-sm text-gray-700">L'année {annee - 1} reste traitée jusqu'au 31 mars : choisissez-la dans la liste pour la suivre.</p>
      )}
      <p className="text-ui-sm muted">
        Chaque financeur est sollicité une fois par an. La demande d'avis est préparée la nuit dans <Link to="/a-valider" className="font-semibold underline">Relances à valider</Link> : rien ne part sans vous. Un webinaire, une réunion ou un échange avec le financeur compte aussi.
      </p>

      {erreur && <p className="text-ui-sm text-[rgb(var(--c-danger))]" role="alert">Lecture impossible pour le moment. <button type="button" className="underline" onClick={charger}>Réessayer</button></p>}
      {!erreur && liste === null && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-gray-400" aria-label="Chargement" /></div>}
      {liste && !liste.length && !sansFinanceur.length && <p className="text-ui-sm muted">Aucune session financée par un OPCO, une région, le CPF ou France Travail en {annee}.</p>}
      {sansFinanceur.length > 0 && (
        <div className="rounded-ui-sm border border-[rgb(var(--c-warning)/0.3)] bg-[rgb(var(--c-warning-bg))] p-3 text-ui-sm space-y-1" role="status">
          <div className="font-semibold">{sansFinanceur.length > 1 ? `${sansFinanceur.length} sessions financées sans financeur renseigné` : 'Une session financée sans financeur renseigné'}</div>
          <div>Ajoutez le financeur dans l'onglet « Financement » de la session : sans lui, aucune demande d'avis ne peut être préparée.</div>
          <ul className="list-disc pl-5">
            {sansFinanceur.map((x) => <li key={x.id}><Link to={`/sessions/${x.id}`} className="font-semibold underline">{x.reference || x.titre || 'Session'}</Link>{x.titre && x.reference ? `, ${x.titre}` : ''}, le {fr(x.fin)}</li>)}
          </ul>
        </div>
      )}

      {liste && liste.map((f) => {
        const etat = f.demande ? ETATS_DEMANDE[f.demande] : null
        const raison = raisonSansDemande(f, ouverte)
        return (
          <div key={`${f.company_id}-${f.cle}`} className="rounded-ui-sm border border-gray-200 p-3 space-y-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 [overflow-wrap:anywhere]">{f.nom}</div>
                <div className="text-ui-sm muted">{TYPES_FINANCEUR[f.type] || f.type} · {f.sessions?.length || 0} session{(f.sessions?.length || 0) > 1 ? 's' : ''} en {annee}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {etat && <StatusBadge tone={etat[0]}>{etat[1]}</StatusBadge>}
                {f.echanges > 0 && <StatusBadge tone="success">{f.echanges > 1 ? `${f.echanges} échanges notés` : 'Échange noté'}</StatusBadge>}
                {!f.couvert && !etat && <StatusBadge tone="warning">À solliciter</StatusBadge>}
              </div>
            </div>
            {raison && <p className="text-ui-sm text-gray-600">{raison}</p>}
            {f.demande === 'repondue' && <p className="text-ui-sm text-gray-600">Note globale : {f.note} sur 5, le {fr(f.repondu_le)}</p>}
          </div>
        )
      })}

      {avis.length > 0 && (
        <div className="space-y-2">
          <div className="text-ui-sm font-semibold text-gray-500">AVIS REÇUS EN {annee}</div>
          {avis.map((a) => (
            <div key={a.id} className="rounded-ui-sm bg-gray-50 p-3 text-ui space-y-1">
              <div className="font-semibold">{a.funder_name} · {a.note_globale} sur 5 <span className="font-normal text-ui-sm muted">le {fr(a.answered_at)}</span></div>
              <div className="text-ui-sm text-gray-600">{QUESTIONS_FINANCEUR.filter(([k]) => a[k]).map(([k, l]) => `${l} : ${a[k]}/5`).join(' · ')}</div>
              {a.commentaire && <p className="text-ui-sm whitespace-pre-line [overflow-wrap:anywhere]">{a.commentaire}</p>}
            </div>
          ))}
        </div>
      )}

      {echanges.length > 0 && (
        <div className="space-y-1">
          <div className="text-ui-sm font-semibold text-gray-500">ÉCHANGES NOTÉS EN {annee}</div>
          {echanges.map((x) => (
            <div key={x.id} className="flex items-start gap-2 py-1 text-ui">
              <div className="flex-1 min-w-0">
                <div><span className="font-semibold">{fr(x.happened_on)}</span> · {x.funder_name} · {libelleEchange(x.kind)}</div>
                {x.notes && <div className="text-ui-sm muted [overflow-wrap:anywhere]">{x.notes}</div>}
              </div>
              {ecrire && <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Retirer l'échange du ${fr(x.happened_on)} avec ${x.funder_name}`} onClick={() => retirer(x)}><Trash2 className="w-4 h-4" /></button>}
            </div>
          ))}
        </div>
      )}

      {form && (
        <Sheet title="Noter un échange avec un financeur" onClose={() => setForm(null)}
          footer={<><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Annuler</button><button type="submit" form="form-echange" className="btn btn-primary" disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button></>}>
          <form id="form-echange" onSubmit={enregistrer} className="space-y-3">
            <label className="block"><span className="label">Financeur</span>
              <select className="select" value={form.cle} onChange={(e) => setForm({ ...form, cle: e.target.value })}>
                {(liste || []).map((f) => <option key={`${f.company_id}-${f.cle}`} value={f.cle}>{f.nom}</option>)}
                <option value="">Un autre financeur</option>
              </select>
            </label>
            {!choisi && (
              <>
                <label className="block"><span className="label">Type</span>
                  <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    {Object.entries(TYPES_FINANCEUR).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="block"><span className="label">Nom du financeur</span>
                  <input className="input" maxLength={200} value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
                </label>
              </>
            )}
            <label className="block"><span className="label">Nature de l'échange</span>
              <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {TYPES_ECHANGE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Date</span>
              <input type="date" className="input" max={jourParis()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </label>
            <label className="block"><span className="label">Ce qui a été dit ou retenu (facultatif)</span>
              <textarea className="input min-h-[90px]" maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
          </form>
        </Sheet>
      )}
    </section>
  )
}

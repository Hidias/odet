// Bloc « Accueil sécurité » de la fiche du personnel (0522, choix de H du 18/11 : signature à l'écran).
// Formation pratique et appropriée à la sécurité (Code du travail L4141-2, domaines de R4141-3) : à l'embauche, au
// changement de poste ou de technique, pour les intérimaires. Une fiche signée ne se modifie plus.

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Sheet } from '../../../ui/Sheet'
import PadSimple from '../../../ui/signature/PadSimple'
import { confirmer } from '../../../ui/Confirm'
import { useAuthStore } from '../../../core/store'
import { statutContrat } from '../lib/rhData'
import { chargerPostes } from '../lib/rhPostes'
import { chargerEcheances } from '../lib/rhDocuments'
import {
  MOTIFS_ACCUEIL, pointsProposes, erreurAccueil, chargerAccueils, enregistrerAccueil, supprimerAccueil,
} from '../lib/rhSecurite'

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const aujourdhui = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Champ({ label, children }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>
}

function AccueilSheet({ personId, contrat, poste, motif, onClose, onSaved }) {
  const profile = useAuthStore((s) => s.profile)
  const [v, setV] = useState(() => ({
    done_on: aujourdhui(), reason: motif, topics: pointsProposes(poste),
    conducted_by: [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.display_name || '',
    notes: '', signature: null, ajout: '',
  }))
  const [busy, setBusy] = useState(false)
  const basculer = (i) => setV((x) => ({ ...x, topics: x.topics.map((t, j) => (j === i ? { ...t, done: !t.done } : t)) }))
  const ajouter = () => {
    setV((x) => {
      const label = x.ajout.trim()
      return label ? { ...x, topics: [...x.topics, { label, done: true }], ajout: '' } : x
    })
  }
  const enregistrer = async (e) => {
    e.preventDefault()
    const err = erreurAccueil(v)
    if (err) return toast.error(err)
    setBusy(true)
    try {
      await enregistrerAccueil(personId, { ...v, employment_id: contrat?.id || null })
      toast.success('Accueil sécurité enregistré et signé')
      onSaved()
    } catch (er) { toast.error(er.message) }
    setBusy(false)
  }
  return (
    <Sheet title="Accueil sécurité" onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="rh-accueil" className="btn btn-primary" disabled={busy}>Enregistrer</button></>}>
      <form id="rh-accueil" onSubmit={enregistrer} className="space-y-3">
        <p className="text-ui-sm text-gray-600">
          Formation pratique et appropriée à la sécurité, compréhensible par la personne, à l'embauche et à chaque changement de poste ou de technique (Code du travail, L4141-2).
          {poste ? ` Poste : ${poste.name}.` : ''}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ label="Date"><input className="input" type="date" required max={aujourdhui()} value={v.done_on} onChange={(e) => setV({ ...v, done_on: e.target.value })} /></Champ>
          <Champ label="Motif">
            <select className="select" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })}>
              {Object.entries(MOTIFS_ACCUEIL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Champ>
          <Champ label="Accueil fait par"><input className="input" maxLength={120} value={v.conducted_by} onChange={(e) => setV({ ...v, conducted_by: e.target.value })} /></Champ>
        </div>
        <fieldset>
          <legend className="label">Points abordés</legend>
          <ul className="space-y-1">
            {v.topics.map((t, i) => (
              <li key={`${t.label}-${i}`}>
                <label className="flex items-start gap-2 min-h-[44px] py-1">
                  <input type="checkbox" className="w-5 h-5 mt-0.5 flex-none" checked={t.done} onChange={() => basculer(i)} />
                  <span className="text-ui">{t.label}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 mt-1">
            <input className="input flex-1" maxLength={200} value={v.ajout} placeholder="Autre point abordé" aria-label="Autre point abordé"
              onChange={(e) => setV({ ...v, ajout: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ajouter() } }} />
            <button type="button" className="btn btn-secondary min-h-[44px]" onClick={ajouter}>Ajouter</button>
          </div>
        </fieldset>
        <Champ label="Notes (facultatif)"><textarea className="input" rows={2} maxLength={1000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Champ>
        <div>
          <div className="label">Signature du salarié</div>
          <PadSimple onChange={(s) => setV((x) => ({ ...x, signature: s }))} label="Le salarié signe dans le cadre" />
          <p className="text-ui-sm muted mt-1">Une fois signée, la fiche ne se modifie plus.</p>
        </div>
      </form>
    </Sheet>
  )
}

/** Accueils sécurité d'une personne. L'avertissement vient des échéances de la base (une seule règle, 0522). */
export default function AccueilSecuriteFiche({ personId, contrats = [], peutGerer = false }) {
  const [liste, setListe] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [echeance, setEcheance] = useState(null)
  const [postes, setPostes] = useState([])
  const [saisie, setSaisie] = useState(false)
  const charger = useCallback(() => {
    chargerAccueils(personId).then((l) => { setListe(l); setErreur(null) }).catch((e) => { setListe([]); setErreur(e.message) })
    chargerEcheances({ personId }).then((e) => setEcheance((e || []).find((x) => x.kind === 'accueil_securite') || null)).catch(() => setEcheance(null))
  }, [personId])
  useEffect(() => { charger() }, [charger])
  useEffect(() => { chargerPostes().then(setPostes).catch(() => setPostes([])) }, [])
  const contrat = useMemo(() => (contrats || []).filter((c) => statutContrat(c) !== 'termine' && c.start_on <= dansJours(30)).sort((a, b) => (a.start_on < b.start_on ? 1 : -1))[0] || null, [contrats])
  const poste = useMemo(() => postes.find((p) => p.id === contrat?.job_id) || null, [postes, contrat])
  if (liste === null) return null
  if (!peutGerer && !liste.length && !echeance) return null
  const dernier = liste.find((a) => a.signed_at) || null
  const motif = dernier?.job_id && contrat && dernier.job_id !== (contrat.job_id || null) ? 'changement_poste' : 'embauche'

  const supprimer = async (a) => {
    if (!(await confirmer(`Supprimer l'accueil sécurité du ${fr(a.done_on)} saisi par erreur ?`))) return
    try { await supprimerAccueil(a.id); charger() } catch (e) { toast.error(e.message) }
  }

  return (
    <section className="card space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-title">Accueil sécurité</h2>
        {peutGerer && <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => setSaisie(true)}><Plus className="w-4 h-4" aria-hidden="true" />Faire l'accueil</button>}
      </div>
      {echeance && <p className="text-ui-sm text-[rgb(var(--c-danger))] font-medium">{echeance.label} : prévu le {fr(echeance.due_on)}.</p>}
      {erreur && <p className="text-ui-sm text-[rgb(var(--c-danger))]">Accueils non chargés : {erreur}</p>}
      {!liste.length && !erreur && <p className="text-ui-sm muted">Aucun accueil sécurité enregistré.</p>}
      {liste.length > 0 && (
        <ul>
          {liste.map((a) => (
            <li key={a.id} className="py-2 flex items-start gap-3 border-t border-gray-100 first:border-t-0">
              <ShieldCheck className="w-4 h-4 mt-1 text-gray-400 flex-none" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-ui">{MOTIFS_ACCUEIL[a.reason] || 'Accueil'} · {fr(a.done_on)}</div>
                <div className="text-ui-sm text-gray-600">
                  {[a.hr_jobs?.name && `Poste : ${a.hr_jobs.name}`, a.conducted_by && `par ${a.conducted_by}`,
                    `${(a.topics || []).filter((t) => t.done).length} point(s) abordé(s)`, a.signed_at ? 'signé' : 'non signé'].filter(Boolean).join(' · ')}
                </div>
              </div>
              {peutGerer && <button type="button" className="btn btn-ghost btn-icon min-h-[44px] min-w-[44px]" aria-label={`Supprimer l'accueil du ${fr(a.done_on)}`} onClick={() => supprimer(a)}><Trash2 className="w-4 h-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {saisie && <AccueilSheet personId={personId} contrat={contrat} poste={poste} motif={motif} onClose={() => setSaisie(false)} onSaved={() => { setSaisie(false); charger() }} />}
    </section>
  )
}

// Même fenêtre que les échéances de la base : contrats qui commencent dans les 30 jours au plus
function dansJours(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

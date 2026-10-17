// « À déclarer » : sessions terminées avec des stagiaires à déclarer, date limite et code couleur,
// stagiaires prêts et bloqués (avec le motif et de quoi corriger), sélection par session, client ou période.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, X } from 'lucide-react'
import { frDate, STATUT_LABEL, daysBetween } from '../lib/rules'
import GenerationModal from '../components/GenerationModal'
import PasseportTraineeBlock from '../components/PasseportTraineeBlock'

export const COULEUR_BADGE = { rouge: 'badge-danger', orange: 'badge-warning', vert: 'badge-success', gris: 'badge-neutral' }
const STATUT_BADGE = { a_declarer: 'badge-info', genere: 'badge-warning', declare: 'badge-success', rejete: 'badge-danger', non_declarable: 'badge-neutral' }

export function LimiteBadge({ s, today }) {
  if (!s.obligatoire) return <span className="badge badge-neutral">Volontaire</span>
  if (!s.limite) return null
  const n = daysBetween(today, s.limite.date)
  return (
    <span className={`badge ${COULEUR_BADGE[s.couleur]}`} title={`Fin du trimestre ${frDate(s.limite.finTrimestre)} + ${s.limite.mois} mois${s.limite.aConfirmer ? ' (délai transitoire à confirmer)' : ''}`}>
      {n < 0 ? 'Dépassée' : frDate(s.limite.date)}{n >= 0 && n <= 120 ? `, ${n} j` : ''}
    </span>
  )
}

export function StatutBadge({ statut }) {
  return <span className={`badge ${STATUT_BADGE[statut] || 'badge-neutral'}`}>{STATUT_LABEL[statut] || statut}</span>
}

export default function PpADeclarer({ aDeclarer, today, reload }) {
  const [filtre, setFiltre] = useState('toutes')
  const [client, setClient] = useState('')
  const [du, setDu] = useState('')
  const [au, setAu] = useState('')
  const [selection, setSelection] = useState(() => new Set())
  const [ouverte, setOuverte] = useState(null)
  const [fiche, setFiche] = useState(null)
  const [generation, setGeneration] = useState(null)

  const clients = useMemo(() => [...new Map(aDeclarer.map((s) => [s.client_id, s.client_name])).entries()]
    .filter(([id]) => id).sort((a, b) => (a[1] || '').localeCompare(b[1] || '')), [aDeclarer])

  const liste = aDeclarer.filter((s) => {
    if (filtre === 'obligatoires' && !s.obligatoire) return false
    if (filtre === 'volontaires' && s.obligatoire) return false
    if (filtre === 'bloques' && !s.bloques) return false
    if (client && s.client_id !== client) return false
    if (du && s.end_date < du) return false
    if (au && s.end_date > au) return false
    return true
  })

  const pretsDe = (s) => s.inscriptions.filter((i) => i.statutAffiche === 'a_declarer' && !i.bloquants.length)
  const idsSelection = liste.filter((s) => selection.has(s.session_id)).flatMap((s) => pretsDe(s).map((i) => i.inscription_id))
  const toggle = (id) => setSelection((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toutCocher = () => setSelection(new Set(liste.filter((s) => s.prets > 0).map((s) => s.session_id)))
  const session = ouverte ? aDeclarer.find((s) => s.session_id === ouverte) : null

  return (
    <div className="space-y-3 pb-20 sm:pb-0">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex gap-1 flex-wrap" role="group" aria-label="Filtre">
          {[['toutes', `Toutes ${aDeclarer.length}`], ['obligatoires', `Obligatoires ${aDeclarer.filter((s) => s.obligatoire).length}`], ['volontaires', `Volontaires ${aDeclarer.filter((s) => !s.obligatoire).length}`], ['bloques', `Avec blocages ${aDeclarer.filter((s) => s.bloques).length}`]].map(([k, l]) => (
            <button key={k} type="button" className={`btn btn-sm ${filtre === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFiltre(k)}>{l}</button>
          ))}
        </div>
        <label className="text-ui-sm muted flex flex-col">Client
          <select className="select" value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">Tous</option>
            {clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="text-ui-sm muted flex flex-col">Fin du<input type="date" className="input" value={du} onChange={(e) => setDu(e.target.value)} /></label>
        <label className="text-ui-sm muted flex flex-col">au<input type="date" className="input" value={au} onChange={(e) => setAu(e.target.value)} /></label>
        <button type="button" className="btn btn-secondary btn-sm" onClick={toutCocher}>Tout sélectionner</button>
      </div>

      {liste.length === 0 && <div className="card text-ui muted">Rien à déclarer avec ces filtres.</div>}

      <div className="grid gap-2">
        {liste.map((s) => (
          <div key={s.session_id} className={`card p-0 flex items-stretch ${ouverte === s.session_id ? 'ring-2 ring-accent-400' : ''}`}>
            <label className="flex items-center px-3 border-r border-gray-100 cursor-pointer" aria-label={`Sélectionner ${s.reference}`}>
              <input type="checkbox" className="w-5 h-5" disabled={!s.prets} checked={selection.has(s.session_id)} onChange={() => toggle(s.session_id)} />
            </label>
            <button type="button" className="flex-1 text-left p-3 min-w-0" onClick={() => setOuverte(ouverte === s.session_id ? null : s.session_id)}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{s.course_title}</span>
                <span className={`badge ${s.type === 'JDR' ? 'badge-success' : 'badge-info'}`}>{s.type}</span>
                <span className="text-ui-sm muted">cat. {s.categorie || '?'}</span>
                <span className="ml-auto"><LimiteBadge s={s} today={today} /></span>
              </div>
              <div className="text-ui-sm text-gray-600 truncate">{s.reference} · {s.client_name || 'Sans client'} · fin {frDate(s.end_date)}</div>
              <div className="flex gap-1.5 flex-wrap mt-1.5">
                {s.prets > 0 && <span className="badge badge-success">{s.prets} prêt{s.prets > 1 ? 's' : ''}</span>}
                {s.bloques > 0 && <span className="badge badge-danger">{s.bloques} bloqué{s.bloques > 1 ? 's' : ''}</span>}
                {s.attente > 0 && <span className="badge badge-warning">{s.attente} accusé attendu</span>}
                {s.declares > 0 && <span className="badge badge-neutral">{s.declares} déclaré{s.declares > 1 ? 's' : ''}</span>}
                {s.rejetes > 0 && <span className="badge badge-danger">{s.rejetes} rejeté{s.rejetes > 1 ? 's' : ''}</span>}
              </div>
            </button>
            <span className="flex items-center pr-2 text-gray-300"><ChevronRight className="w-5 h-5" aria-hidden="true" /></span>
          </div>
        ))}
      </div>

      {session && (
        <div className="fixed inset-0 z-40 bg-black/40 flex justify-end" onClick={() => setOuverte(null)} role="presentation">
          <aside className="bg-white w-full sm:max-w-lg h-full overflow-y-auto p-4 space-y-3" onClick={(e) => e.stopPropagation()} aria-label="Détail de la session">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <div className="text-ui-sm muted">{session.reference}</div>
                <h2 className="section-title">{session.course_title}, {session.client_name}</h2>
                <div className="text-ui-sm text-gray-600">Fin le {frDate(session.end_date)}. {session.obligatoire
                  ? <>Date limite : fin du trimestre ({frDate(session.limite.finTrimestre)}) + {session.limite.mois} mois = <b>{frDate(session.limite.date)}</b>{session.limite.aConfirmer ? ' (délai transitoire à confirmer)' : ''}.</>
                  : 'Déclaration volontaire (formation antérieure à l\'obligation pour cette catégorie).'}</div>
              </div>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setOuverte(null)} aria-label="Fermer"><X className="w-5 h-5" /></button>
            </div>
            <ul className="divide-y divide-gray-100">
              {session.inscriptions.map((i) => (
                <li key={i.inscription_id} className="py-2.5 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{i.last_name} {i.first_name}</div>
                    {i.motif && <div className="text-ui-sm muted">{i.motif}</div>}
                    {i.bloquants.map((b) => <div key={b.code} className="text-ui-sm text-[rgb(var(--c-danger))]">{b.label}</div>)}
                    {i.statutAffiche === 'genere' && <div className="text-ui-sm muted">Fichier préparé : accusé de traitement attendu</div>}
                    {i.statutAffiche === 'rejete' && <div className="text-ui-sm text-[rgb(var(--c-danger))]">{i.dernier_envoi?.code_erreur} : <Link to="../a-corriger" className="underline">à corriger</Link></div>}
                    {i.nir_present && !i.bloquants.length && i.statutAffiche === 'a_declarer' && <div className="text-ui-sm muted">Numéro se termine par {i.nir_fin}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatutBadge statut={i.bloquants.length && i.statutAffiche === 'a_declarer' ? 'a_declarer' : i.statutAffiche} />
                    {i.bloquants.some((b) => ['nir', 'nom', 'nom_verifier'].includes(b.code)) && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFiche(i)}>Corriger</button>
                    )}
                    {i.bloquants.some((b) => b.code === 'siret') && <Link className="btn btn-secondary btn-sm" to={`/clients/${i.client_id}`}>Fiche client</Link>}
                    {i.bloquants.some((b) => b.code === 'reglages') && <Link className="btn btn-secondary btn-sm" to={`../reglages/${i.course_id}`}>Réglages</Link>}
                  </div>
                </li>
              ))}
            </ul>
            {pretsDe(session).length > 0 && (
              <button type="button" className="btn btn-primary w-full" onClick={() => setGeneration({ ids: pretsDe(session).map((i) => i.inscription_id) })}>
                Préparer le fichier de cette session ({pretsDe(session).length})
              </button>
            )}
          </aside>
        </div>
      )}

      {fiche && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Corriger le stagiaire">
          <div className="bg-white w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-ui-lg sm:rounded-ui-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="section-title flex-1">{fiche.last_name} {fiche.first_name}</div>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => { setFiche(null); reload() }} aria-label="Fermer"><X className="w-5 h-5" /></button>
            </div>
            <PasseportTraineeBlock compact trainee={{
              id: fiche.trainee_id, last_name: fiche.last_name, gender: fiche.gender, nom_naissance: fiche.nom_naissance,
              nom_naissance_confirme_le: fiche.nom_naissance_confirme_le, refused_ssn: fiche.refused_ssn,
            }} />
            <button type="button" className="btn btn-secondary w-full" onClick={() => { setFiche(null); reload() }}>Terminé</button>
          </div>
        </div>
      )}

      {idsSelection.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 sm:static z-30 bg-white sm:bg-transparent border-t sm:border-0 border-gray-200 p-3 sm:p-0">
          <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={() => setGeneration({ ids: idsSelection })}>
            Préparer les fichiers de la sélection ({idsSelection.length} stagiaire{idsSelection.length > 1 ? 's' : ''})
          </button>
        </div>
      )}

      {generation && (
        <GenerationModal inscriptionIds={generation.ids} onClose={() => { setGeneration(null); setSelection(new Set()); reload() }} />
      )}
    </div>
  )
}

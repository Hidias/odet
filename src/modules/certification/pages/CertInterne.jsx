// Onglet « Erreurs à éviter » : face interne des certifications, conseil réservé à la direction.
// N'apparaît dans aucun document, export ni portail ; la base refuse la lecture sans le droit du cockpit.
// Chaque point de départ est « à confirmer » : la société confirme ou écarte, ajoute son expérience.

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2, Lock, Plus, ChevronDown, ChevronRight } from 'lucide-react'
import { DOMAINES, STATUTS_POINT, SOURCES_POINT, chargerPoints, enregistrerPoint, parDomaine } from '../lib/certInterne'

function Point({ p, onMaj }) {
  const [ouvert, setOuvert] = useState(false)
  const [v, setV] = useState({ reperage: p.reperage || '', action: p.action || '' })
  const st = STATUTS_POINT.find((s) => s.v === p.statut) || STATUTS_POINT[0]
  const changer = async (patch) => {
    try { await enregistrerPoint(p.id, patch); onMaj() } catch (e) { toast.error(e.message || String(e)) }
  }
  return (
    <li className="px-4 py-3 space-y-2">
      <button type="button" className="w-full flex items-start gap-3 text-left" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}>
        {ouvert ? <ChevronDown className="w-4 h-4 mt-1 flex-none text-gray-400" aria-hidden="true" /> : <ChevronRight className="w-4 h-4 mt-1 flex-none text-gray-400" aria-hidden="true" />}
        <span className="font-mono text-ui-sm text-gray-500 w-10 flex-none">{p.code}</span>
        <span className={`flex-1 text-ui ${p.statut === 'ecarte' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{p.erreur}</span>
        <span className={`badge ${st.badge} flex-none`}>{st.label}</span>
      </button>
      {ouvert && (
        <div className="pl-14 space-y-3">
          {p.exigence && <p className="text-ui-sm text-gray-600"><span className="font-semibold">Exigence : </span>{p.exigence}</p>}
          <label className="block">
            <span className="label">Comment le repérer</span>
            <textarea className="input" rows={2} value={v.reperage} onChange={(e) => setV({ ...v, reperage: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Ce qu'on fait</span>
            <textarea className="input" rows={2} value={v.action} onChange={(e) => setV({ ...v, action: e.target.value })} />
          </label>
          <p className="text-ui-sm muted">Source : {p.source || 'non précisée'} ({SOURCES_POINT[p.source_type] || p.source_type})</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => changer({ reperage: v.reperage || null, action: v.action || null })}>Enregistrer</button>
            {STATUTS_POINT.filter((s) => s.v !== p.statut).map((s) => (
              <button key={s.v} type="button" className="btn btn-secondary btn-sm" onClick={() => changer({ statut: s.v })}>
                {s.v === 'confirme' ? 'Confirmer' : s.v === 'ecarte' ? 'Écarter' : 'Remettre à confirmer'}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  )
}

function Ajout({ onFini }) {
  const [v, setV] = useState({ domaine: 'apsad', code: '', erreur: '', action: '' })
  const [busy, setBusy] = useState(false)
  const ajouter = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await enregistrerPoint(null, { ...v, action: v.action || null, source_type: 'societe', source: 'Expérience de la société', statut: 'confirme', position: 100 })
      toast.success('Point ajouté')
      onFini(true)
    } catch (err) { toast.error(err.message || String(err)) }
    setBusy(false)
  }
  return (
    <form onSubmit={ajouter} className="card space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <label className="block">
          <span className="label">Certification</span>
          <select className="input" value={v.domaine} onChange={(e) => setV({ ...v, domaine: e.target.value })}>
            {DOMAINES.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Repère</span>
          <input className="input" required maxLength={10} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} placeholder="ex. S1" />
        </label>
      </div>
      <label className="block">
        <span className="label">Erreur à éviter</span>
        <textarea className="input" required rows={2} value={v.erreur} onChange={(e) => setV({ ...v, erreur: e.target.value })} />
      </label>
      <label className="block">
        <span className="label">Ce qu'on fait</span>
        <textarea className="input" rows={2} value={v.action} onChange={(e) => setV({ ...v, action: e.target.value })} />
      </label>
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn btn-secondary" onClick={() => onFini(false)}>Annuler</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>Ajouter</button>
      </div>
    </form>
  )
}

export default function CertInterne() {
  const [points, setPoints] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [ajout, setAjout] = useState(false)
  const charger = useCallback(async () => {
    try { setPoints(await chargerPoints()) } catch (e) { setErreur(e.message || String(e)) }
  }, [])
  useEffect(() => { charger() }, [charger])

  if (erreur) return <div className="card text-[rgb(var(--c-danger))]">Impossible de charger : {erreur}</div>
  if (!points) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-3">
      <div className="card flex items-start gap-3 bg-gray-50">
        <Lock className="w-5 h-5 text-gray-500 flex-none mt-0.5" aria-hidden="true" />
        <p className="text-ui-sm text-gray-700">
          Conseil interne, visible seulement par la direction. Ces points n'apparaissent dans aucun document, export ou portail.
          Chaque point de départ est à confirmer : gardez ceux qui valent pour vous, écartez les autres, ajoutez votre expérience.
        </p>
      </div>
      {!ajout && (
        <button type="button" className="btn btn-secondary" onClick={() => setAjout(true)}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter un point</button>
      )}
      {ajout && <Ajout onFini={(r) => { setAjout(false); if (r) charger() }} />}
      {parDomaine(points).map((d) => (
        <section key={d.v} className="card card-flush">
          <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
            <h2 className="section-title">{d.label}</h2>
            <span className="text-ui-sm muted">{d.aConfirmer ? `${d.aConfirmer} à confirmer` : 'Tout est revu'}</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {d.liste.map((p) => <Point key={p.id} p={p} onMaj={charger} />)}
          </ul>
        </section>
      ))}
      {points.length === 0 && <p className="muted text-ui-sm">Aucun point pour l'instant.</p>}
    </div>
  )
}

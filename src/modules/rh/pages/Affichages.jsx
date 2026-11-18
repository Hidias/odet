// Affichages et diffusions obligatoires (0522, choix de H du 18/11 : un seul panneau). Référentiel : fiche
// service-public reprise par code.travail.gouv.fr, mise à jour du 08/07/2026, tableau « Jusqu'à 10 salariés ».
// Chaque ligne : fait le, vérifié le, moyen utilisé ; ou sans objet, avec le motif.

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Spinner, EmptyState } from '../../../ui/EmptyState'
import { confirmer } from '../../../ui/Confirm'
import { enVueGroupe } from '../../../core/company/societes'
import { ClipboardList } from 'lucide-react'
import {
  MODES_AFFICHAGE, ETATS_AFFICHAGE, etatAffichage, bilanAffichages, erreurAffichage,
  AFFICHAGES, chargerAffichages, enregistrerAffichage, effacerAffichage, chargerLieuPanneau, enregistrerLieuPanneau,
} from '../lib/rhSecurite'

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const aujourdhui = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const SOURCE = 'https://code.travail.gouv.fr/fiche-service-public/quelles-sont-les-obligations-daffichage-dans-une-entreprise'

function Champ({ label, children }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>
}

function Ligne({ item, ligne, peutGerer, onChange }) {
  const [v, setV] = useState(null)
  const [busy, setBusy] = useState(false)
  const etat = ETATS_AFFICHAGE[etatAffichage(ligne)]
  const ouvrir = () => setV({
    status: ligne?.status || 'fait', done_on: ligne?.done_on || aujourdhui(), checked_on: ligne?.checked_on || '',
    means: ligne?.means || (item.mode === 'affichage' ? 'Panneau d\'affichage' : ''), note: ligne?.note || '',
  })
  const enregistrer = async (e) => {
    e.preventDefault()
    const err = erreurAffichage(v)
    if (err) return toast.error(err)
    setBusy(true)
    try { await enregistrerAffichage(item.code, v); setV(null); onChange() } catch (er) { toast.error(er.message) }
    setBusy(false)
  }
  const effacer = async () => {
    if (!(await confirmer(`Remettre « ${item.label} » à faire ? Les dates notées sont effacées.`))) return
    try { await effacerAffichage(ligne.id); setV(null); onChange() } catch (er) { toast.error(er.message) }
  }
  return (
    <li className="py-3 space-y-2">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex-1 min-w-[12rem]">
          <div className="font-semibold text-ui">{item.label}</div>
          <div className="text-ui-sm text-gray-600">{item.content}</div>
          <div className="text-ui-sm muted">
            {[MODES_AFFICHAGE[item.mode], item.reference,
              ligne?.status === 'fait' && `fait le ${fr(ligne.done_on)}`, ligne?.checked_on && `vérifié le ${fr(ligne.checked_on)}`,
              ligne?.means, ligne?.status === 'sans_objet' && ligne.note].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span className={`badge ${etat.badge}`}>{etat.label}</span>
        {peutGerer && !v && <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" aria-label={`${ligne ? 'Mettre à jour' : 'Noter'} : ${item.label}`} onClick={ouvrir}>{ligne ? 'Mettre à jour' : 'Noter'}</button>}
      </div>
      {v && (
        <form onSubmit={enregistrer} className="space-y-3 rounded-ui-sm border border-gray-200 p-3">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 min-h-[44px]"><input type="radio" name={`etat-${item.code}`} checked={v.status === 'fait'} onChange={() => setV({ ...v, status: 'fait' })} /><span className="text-ui">Fait</span></label>
            <label className="flex items-center gap-2 min-h-[44px]"><input type="radio" name={`etat-${item.code}`} checked={v.status === 'sans_objet'} onChange={() => setV({ ...v, status: 'sans_objet' })} /><span className="text-ui">Sans objet</span></label>
          </div>
          {v.status === 'fait' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Champ label="Mis en place le"><input className="input" type="date" required max={aujourdhui()} value={v.done_on} onChange={(e) => setV({ ...v, done_on: e.target.value })} /></Champ>
              <Champ label="Vérifié à jour le"><input className="input" type="date" max={aujourdhui()} value={v.checked_on} onChange={(e) => setV({ ...v, checked_on: e.target.value })} /></Champ>
              <Champ label="Moyen utilisé"><input className="input" maxLength={200} value={v.means} onChange={(e) => setV({ ...v, means: e.target.value })} placeholder="Panneau, mail, intranet…" /></Champ>
            </div>
          ) : null}
          <Champ label={v.status === 'sans_objet' ? 'Pourquoi sans objet (obligatoire)' : 'Note (facultatif)'}>
            <input className="input" maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
          </Champ>
          <div className="flex gap-2 flex-wrap">
            <button type="submit" className="btn btn-primary min-h-[44px]" disabled={busy}>Enregistrer</button>
            <button type="button" className="btn btn-ghost min-h-[44px]" onClick={() => setV(null)}>Annuler</button>
            {ligne && <button type="button" className="btn btn-ghost min-h-[44px]" onClick={effacer}>Remettre à faire</button>}
          </div>
        </form>
      )}
    </li>
  )
}

export default function Affichages({ peutGerer, peutConfigurer }) {
  const [items, setItems] = useState(null)
  const [lignes, setLignes] = useState([])
  const [lieu, setLieu] = useState('')
  const [lieuSaisi, setLieuSaisi] = useState(null)
  const charger = useCallback(() => {
    chargerAffichages()
      .then((li) => { setLignes(li || []); setItems(AFFICHAGES) })
      .catch((e) => { setItems(AFFICHAGES); toast.error(e.message) })
  }, [])
  useEffect(() => { charger(); chargerLieuPanneau().then(setLieu).catch(() => {}) }, [charger])
  const par = useMemo(() => Object.fromEntries(lignes.map((l) => [l.item_code, l])), [lignes])
  if (enVueGroupe()) return <EmptyState icon={ClipboardList} title="Choisissez une société" compact>Les affichages se tiennent société par société.</EmptyState>
  if (!items) return <Spinner />
  const b = bilanAffichages(items, lignes)
  const enregistrerLieu = async (e) => {
    e.preventDefault()
    try { await enregistrerLieuPanneau(lieuSaisi); setLieu(lieuSaisi.trim()); setLieuSaisi(null); toast.success('Lieu enregistré') } catch (er) { toast.error(er.message) }
  }
  return (
    <div className="space-y-4">
      <p className="text-ui-sm text-gray-600">
        Informations que l'employeur affiche ou diffuse à ses salariés, pour une entreprise de moins de 11 salariés.
        Liste reprise de la <a href={SOURCE} target="_blank" rel="noreferrer">fiche officielle</a> (mise à jour du 08/07/2026). « Par tout moyen » : affichage, mail, intranet ou remise en main propre.
        À partir de 11 salariés, d'autres affichages s'ajoutent : cette liste ne suffit plus.
        « À vérifier » au bout d'un an est un repère de l'outil, pas une exigence de la fiche.
      </p>
      <section className="card space-y-2">
        <h2 className="section-title">Panneau d'affichage</h2>
        {lieuSaisi === null ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-ui flex-1 min-w-0">{lieu || 'Lieu du panneau non renseigné'}</span>
            {peutConfigurer && <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" onClick={() => setLieuSaisi(lieu)}>Modifier le lieu</button>}
          </div>
        ) : (
          <form onSubmit={enregistrerLieu} className="flex flex-wrap items-end gap-2">
            <Champ label="Lieu du panneau"><input className="input" maxLength={200} value={lieuSaisi} onChange={(e) => setLieuSaisi(e.target.value)} placeholder="Site, pièce" /></Champ>
            <button type="submit" className="btn btn-primary min-h-[44px]">Enregistrer</button>
            <button type="button" className="btn btn-ghost min-h-[44px]" onClick={() => setLieuSaisi(null)}>Annuler</button>
          </form>
        )}
        <p className="text-ui-sm text-gray-700">{b.fait} fait(s) · {b.a_verifier} à vérifier · {b.a_faire} à faire · {b.sans_objet} sans objet</p>
      </section>
      <section className="card">
        <ul className="divide-y divide-gray-100">
          {items.map((it) => <Ligne key={it.code} item={it} ligne={par[it.code]} peutGerer={peutGerer} onChange={charger} />)}
        </ul>
      </section>
    </div>
  )
}

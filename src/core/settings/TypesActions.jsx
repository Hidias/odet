import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Save, Trash2 } from 'lucide-react'
import { confirmer } from '../../ui/Confirm'
import { Banner } from '../../ui/Banner'
import { chargerEquipe, nomProfil } from '../point/actions'
import { chargerTypes, enregistrerType, supprimerType, erreurNomType, delaiValide, libelleDelai, DELAI_MAX } from '../point/typesActions'

// Types d'action de l'équipe (0514) : délai, responsable par défaut et suite proposée quand l'action est faite.
// Réglés par la direction ; la suite n'est jamais créée seule, elle est proposée au moment où l'on coche « Fait ».

const NOUVEAU = { name: '', delay_days: '0', default_owner_id: '', next_type_id: '', active: true }

function LigneType({ type, types, equipe, onChange }) {
  const [f, setF] = useState(() => ({ ...type, delay_days: String(type.delay_days ?? 0), default_owner_id: type.default_owner_id || '', next_type_id: type.next_type_id || '' }))
  const [busy, setBusy] = useState(false)
  const modifie = f.name !== type.name || delaiValide(f.delay_days) !== Number(type.delay_days) || (f.default_owner_id || null) !== (type.default_owner_id || null)
    || (f.next_type_id || null) !== (type.next_type_id || null) || f.active !== type.active
  const erreur = erreurNomType(f.name, types, type.id) || (delaiValide(f.delay_days) === null ? `Délai : un nombre de jours de 0 à ${DELAI_MAX}.` : null)
  const id = `ta-${type.id}`

  const enregistrer = async () => {
    setBusy(true)
    try { await enregistrerType(f); toast.success('Type enregistré'); onChange() } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  const supprimer = async () => {
    const suivi = types.filter((t) => t.next_type_id === type.id).map((t) => t.name)
    const texte = suivi.length ? ` Il est la suite de : ${suivi.join(', ')} ; ces types n'auront plus de suite.` : ''
    if (!await confirmer(`Supprimer le type « ${type.name} » ? Les actions déjà créées restent, sans type.${texte}`)) return
    setBusy(true)
    try { await supprimerType(type.id); toast.success('Type supprimé'); onChange() } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }

  return (
    <li className="py-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)_minmax(0,1fr)] gap-2 items-end">
      <div>
        <label className="label" htmlFor={`${id}-nom`}>Nom</label>
        <input id={`${id}-nom`} className="input" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor={`${id}-delai`}>Délai (jours)</label>
        <input id={`${id}-delai`} className="input" inputMode="numeric" value={f.delay_days} onChange={(e) => setF({ ...f, delay_days: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor={`${id}-qui`}>Responsable par défaut</label>
        <select id={`${id}-qui`} className="select" value={f.default_owner_id} onChange={(e) => setF({ ...f, default_owner_id: e.target.value })}>
          <option value="">Celui qui crée l'action</option>
          {equipe.map((p) => <option key={p.id} value={p.id}>{nomProfil(p)}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`${id}-suite`}>Suite proposée une fois fait</label>
        <select id={`${id}-suite`} className="select" value={f.next_type_id} onChange={(e) => setF({ ...f, next_type_id: e.target.value })}>
          <option value="">Aucune</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.active === false ? ' (inactif)' : ''}</option>)}
        </select>
      </div>
      <div className="md:col-span-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-ui text-gray-700">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Proposé à la création des actions
        </label>
        <span className="text-ui-sm text-gray-500">Échéance proposée : {delaiValide(f.delay_days) === null ? '?' : libelleDelai(delaiValide(f.delay_days))}</span>
        {modifie && erreur && <span className="text-ui-sm text-red-700">{erreur}</span>}
        <div className="ml-auto flex gap-2">
          {modifie && <button type="button" className="btn btn-primary btn-sm" disabled={busy || !!erreur} onClick={enregistrer}><Save className="w-4 h-4" />Enregistrer</button>}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={supprimer} aria-label={`Supprimer le type ${type.name}`} title="Supprimer"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
    </li>
  )
}

export default function TypesActions() {
  const [types, setTypes] = useState(undefined)
  const [equipe, setEquipe] = useState([])
  const [form, setForm] = useState(NOUVEAU)
  const [busy, setBusy] = useState(false)
  const charger = () => chargerTypes().then(setTypes)
  useEffect(() => { charger(); chargerEquipe().then(setEquipe) }, [])
  const erreur = useMemo(() => (form.name.trim() ? erreurNomType(form.name, types || []) : null)
    || (delaiValide(form.delay_days) === null ? `Délai : un nombre de jours de 0 à ${DELAI_MAX}.` : null), [form, types])

  const ajouter = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await enregistrerType({ ...form, position: (types || []).length + 1 })
      toast.success('Type ajouté')
      setForm(NOUVEAU)
      charger()
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }

  return (
    <>
      <h2 className="section-title">Types d'action</h2>
      <p className="text-ui text-gray-600">
        Un type donne un délai et un responsable à une nouvelle action. S'il a une suite, elle vous est proposée, pré-remplie,
        quand l'action est marquée faite : vous la créez ou vous passez. Rien n'est créé ni envoyé tout seul.
      </p>
      {types === undefined ? <div className="text-ui-sm text-gray-500">Chargement…</div>
        : types === null ? <Banner tone="warning">Les types d'action ne sont pas encore disponibles.</Banner>
          : types.length === 0 ? <p className="text-ui-sm text-gray-500">Aucun type pour l'instant.</p>
            : <ul className="divide-y divide-gray-100">{types.map((t) => <LigneType key={`${t.id}-${t.updated_at}`} type={t} types={types} equipe={equipe} onChange={charger} />)}</ul>}

      {types !== null && types !== undefined && (
        <form onSubmit={ajouter} className="border-t hairline pt-4 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_110px_auto] gap-2 items-end">
          <div>
            <label className="label" htmlFor="ta-nouveau">Nouveau type</label>
            <input id="ta-nouveau" className="input" placeholder="Ex. : Envoyer la convention" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="ta-nouveau-delai">Délai (jours)</label>
            <input id="ta-nouveau-delai" className="input" inputMode="numeric" value={form.delay_days} onChange={(e) => setForm({ ...form, delay_days: e.target.value })} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy || form.name.trim().length < 2 || !!erreur}><Plus className="w-4 h-4" />Ajouter</button>
          {erreur && <p className="md:col-span-3 text-ui-sm text-red-700">{erreur}</p>}
        </form>
      )}
    </>
  )
}

// Bloc Passeport d'un stagiaire (personnel habilité) : nom de naissance, numéro (jamais affiché en entier),
// refus. Utilisé dans la fiche stagiaire et dans les écrans du module.

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2, Lock } from 'lucide-react'
import { apiPasseport, enregistrerNom, enregistrerRefus, loadNirEtat } from '../lib/ppData'
import { nomAVerifier, nomPortail, normaliserNir } from '../lib/rules'

export default function PasseportTraineeBlock({ trainee, onChange, compact = false }) {
  const [etat, setEtat] = useState(null)
  const [nom, setNom] = useState(trainee.nom_naissance || (trainee.last_name || '').toUpperCase())
  const [confirme, setConfirme] = useState(!!trainee.nom_naissance_confirme_le)
  const [refuse, setRefuse] = useState(!!trainee.refused_ssn)
  const [saisie, setSaisie] = useState(false)
  const [nir, setNir] = useState('')
  const [busy, setBusy] = useState(false)
  const [ecarts, setEcarts] = useState(null)

  useEffect(() => {
    setNom(trainee.nom_naissance || (trainee.last_name || '').toUpperCase())
    setConfirme(!!trainee.nom_naissance_confirme_le)
    setRefuse(!!trainee.refused_ssn)
    loadNirEtat([trainee.id]).then((m) => setEtat(m[trainee.id] || { present: false })).catch(() => setEtat({ present: false, erreur: true }))
  }, [trainee.id, trainee.nom_naissance, trainee.nom_naissance_confirme_le, trainee.refused_ssn, trainee.last_name])

  const aVerifier = !confirme && nomAVerifier({ ...trainee, nom_naissance: nom, nom_naissance_confirme_le: null })
  const nomCheck = nomPortail(nom)

  const saveNom = async (confirm) => {
    setBusy(true)
    try {
      await enregistrerNom(trainee.id, nom, confirm)
      setConfirme(!!confirm)
      toast.success(confirm ? 'Nom de naissance confirmé' : 'Nom de naissance enregistré')
      onChange?.()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  const saveNir = async (force = false) => {
    const n = normaliserNir(nir)
    if (!n.ok) { toast.error(n.error); return }
    setBusy(true)
    try {
      const r = await apiPasseport('staff-save', { trainee_id: trainee.id, nir, force })
      setEtat({ present: true, fin: r.fin, source: 'fiche' })
      setNir(''); setSaisie(false); setEcarts(null); setRefuse(false)
      toast.success('Numéro enregistré et chiffré')
      onChange?.()
    } catch (e) {
      if (e.status === 409) setEcarts(e.message)
      else toast.error(e.message)
    }
    setBusy(false)
  }

  const toggleRefus = async (v) => {
    if (v && !window.confirm('Le numéro enregistré sera effacé et la formation ne pourra pas être déclarée. Continuer ?')) return
    setBusy(true)
    try {
      await enregistrerRefus(trainee.id, v)
      setRefuse(v)
      if (v) setEtat({ present: false })
      onChange?.()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <div className={`space-y-3 ${compact ? '' : 'card'}`}>
      {!compact && <div className="section-title">Passeport de prévention</div>}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <label className="label mb-0 flex-1" htmlFor={`pp-nom-${trainee.id}`}>Nom de naissance</label>
          {confirme ? <span className="badge badge-success">Confirmé</span> : aVerifier ? <span className="badge badge-warning">À vérifier</span> : null}
        </div>
        <input id={`pp-nom-${trainee.id}`} className="input" value={nom} onChange={(e) => { setNom(e.target.value); setConfirme(false) }} />
        {!nomCheck.ok && <p className="text-ui-sm text-red-700">{nomCheck.tropLong ? 'Plus de 30 caractères : le portail le refusera.' : 'Nom vide.'}</p>}
        {aVerifier && <p className="text-ui-sm muted">Prérempli avec le nom d'usage. Pour une femme mariée ou un nom composé, demandez le nom inscrit à la naissance.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !nomCheck.ok} onClick={() => saveNom(true)}>Confirmer ce nom de naissance</button>
          {!confirme && <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !nomCheck.ok} onClick={() => saveNom(false)}>Enregistrer sans confirmer</button>}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="label mb-0 flex-1">Numéro de sécurité sociale</span>
          {etat?.present && <span className="badge badge-success"><Lock className="w-3 h-3" aria-hidden="true" /> Chiffré</span>}
          {refuse && <span className="badge badge-neutral">Refus</span>}
        </div>
        {etat === null ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : refuse ? (
          <p className="text-ui-sm text-gray-700">Refuse de communiquer son numéro : ses formations ne sont pas déclarées.</p>
        ) : etat.present ? (
          <p className="text-ui font-mono tracking-wider">•••• ••• <b>{etat.fin}</b> <span className="font-sans text-ui-sm muted ml-1">saisi {etat.source === 'portail' ? 'par le stagiaire' : etat.source === 'demo' ? '(fictif)' : 'par l\'organisme'}</span></p>
        ) : (
          <p className="text-ui-sm text-red-700">Aucun numéro : la formation ne peut pas être déclarée.</p>
        )}
        {saisie ? (
          <div className="space-y-2">
            <input className="input font-mono" inputMode="text" autoComplete="off" placeholder="13 caractères, ou 15 avec la clé"
              value={nir} onChange={(e) => { setNir(e.target.value); setEcarts(null) }} aria-label="Nouveau numéro de sécurité sociale" />
            {ecarts && (
              <div className="text-ui-sm text-amber-900 bg-amber-50 rounded-ui p-2">
                {ecarts}. <button type="button" className="underline" onClick={() => saveNir(true)}>Enregistrer quand même</button>
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || !nir} onClick={() => saveNir(false)}>Enregistrer</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setSaisie(false); setNir(''); setEcarts(null) }}>Annuler</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setSaisie(true)}>{etat?.present ? 'Remplacer le numéro' : 'Saisir le numéro'}</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => toggleRefus(!refuse)}>{refuse ? 'Annuler le refus' : 'Refuse de le donner'}</button>
          </div>
        )}
        <p className="text-ui-sm muted">Jamais affiché en entier. Effacé dès que le portail a accepté toutes ses déclarations en attente.</p>
      </div>
    </div>
  )
}

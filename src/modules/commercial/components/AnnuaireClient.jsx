import { useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../core/supabase'
import { callApi } from '../../../core/api'
import { fmtDate } from '../../../core/utils'
import { annuaireUrl } from '../../../core/org/tva'

// Contrôle du SIRET d'un client dans l'annuaire officiel (Facturation fiable, 0365).
// « Vérifier » passe par /api/verifier-siret qui garde le résultat sur la fiche ; l'adresse à jour n'est reprise
// qu'après un clic de la personne (jamais de modification automatique de la fiche).

const TON = { actif: 'badge-success', ferme: 'badge-danger', siege_deplace: 'badge-warning', inconnu: 'badge-warning' }
const LIBELLE = { actif: 'Actif', ferme: 'Fermé', siege_deplace: 'Siège déplacé', inconnu: 'Inconnu' }

export default function AnnuaireClient({ client, peutModifier, onChange }) {
  const [enCours, setEnCours] = useState(false)
  const r = client?.siret_check_result || null
  const lien = annuaireUrl(client?.siret || client?.siren)
  if (!client?.siret && !client?.siren) return null

  const verifier = async () => {
    setEnCours(true)
    try {
      const rep = await callApi('/api/verifier-siret', { client_id: client.id })
      if (rep.indisponible) toast.error(`Annuaire indisponible : ${rep.message}`)
      else toast.success(rep.resultat?.message || 'Vérifié')
      await onChange?.()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setEnCours(false)
    }
  }
  const reprendre = async () => {
    setEnCours(true)
    const maj = { address: r.adresse, postal_code: r.code_postal, city: r.ville, updated_at: new Date().toISOString() }
    if (r.etat === 'siege_deplace' && r.siret) maj.siret = r.siret
    const { error } = await supabase.from('clients').update(maj).eq('id', client.id)
    setEnCours(false)
    if (error) return toast.error(error.message)
    toast.success("Adresse de l'annuaire reprise")
    await onChange?.()
  }
  const proposer = r && r.adresse && (r.etat === 'siege_deplace' || (r.ecarts || []).length > 0)

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-gray-500">
      {r ? (
        <>
          <span className={`badge ${TON[r.etat] || 'badge-warning'}`}>Annuaire : {LIBELLE[r.etat] || r.etat}</span>
          <span>vérifié le {fmtDate(client.siret_checked_at)}</span>
          {r.etat !== 'actif' && r.message && <span>{r.message}</span>}
        </>
      ) : <span>SIRET non vérifié dans l'annuaire</span>}
      {proposer && <span>Adresse de l'annuaire : {[r.adresse, r.code_postal, r.ville].filter(Boolean).join(' ')}</span>}
      {peutModifier && <button type="button" className="underline" disabled={enCours} onClick={verifier}>{enCours ? 'Vérification…' : 'Vérifier'}</button>}
      {peutModifier && proposer && <button type="button" className="underline" disabled={enCours} onClick={reprendre}>Reprendre cette adresse</button>}
      {lien && <a className="underline" href={lien} target="_blank" rel="noopener noreferrer">Annuaire officiel</a>}
    </div>
  )
}

// B126 : clôture d'une session réalisée. Affiche ce qui manque pour passer « À facturer », fait avancer le statut
// en base à l'ouverture de la fiche (session_avancer_statut, 0528) et permet « pas de facture » avec un motif.
// Avant l'application de 0528, les fonctions n'existent pas : le panneau reste muet (aucune erreur affichée).
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../core/supabase'
import { enregistrer } from '../../../core/enregistrer'
import { LIBELLES_STATUT, statutAffiche } from '../../../core/session/realisee.js'

const POINTS = [
  ['presences', 'Présences de chaque inscrit à chaque demi-journée'],
  ['objectifs', 'Objectifs évalués pour chaque présent'],
  ['chaud', 'Évaluation à chaud de chaque présent'],
  ['formateur', 'Évaluation du formateur'],
  ['avis', 'Avis de l\'entreprise demandé (envoi « Après formation »)'],
]

const fonctionAbsente = (error) => error && (error.code === 'PGRST202' || error.code === '42883')

export default function ClotureSession({ session, peutModifier, onChange }) {
  const [etat, setEtat] = useState(null)
  const [motif, setMotif] = useState('')
  const [saisieMotif, setSaisieMotif] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const statut = statutAffiche(session)
  const concernee = session?.session_type !== 'subcontract' && ['to_close', 'to_invoice'].includes(statut)

  useEffect(() => {
    if (!concernee || !session?.id) return
    let fini = false
    ;(async () => {
      const avance = await supabase.rpc('session_avancer_statut', { p_session: session.id })
      if (fonctionAbsente(avance.error)) return
      if (!avance.error && avance.data && !fini) onChange?.(avance.data)
      const { data, error } = await supabase.rpc('session_cloture_etat', { p_session: session.id })
      if (!fini && !error) setEtat(data)
    })()
    return () => { fini = true }
  }, [session?.id, statut]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!concernee || !etat) return null

  const enregistrerMotif = async () => {
    const texte = motif.trim()
    if (texte.length < 3) return toast.error('Motif trop court (3 caractères au moins)')
    setEnvoi(true)
    const { error } = await enregistrer(supabase.from('sessions').update({ sans_facture_motif: texte }).eq('id', session.id),
      { message: 'Motif non enregistré : droit de modifier la session requis' })
    if (!error) {
      const avance = await supabase.rpc('session_avancer_statut', { p_session: session.id })
      toast.success(avance.data === 'completed' ? 'Session terminée sans facture' : 'Motif enregistré')
      setSaisieMotif(false)
      onChange?.(avance.data || null)
    } else toast.error(error.message)
    setEnvoi(false)
  }

  return (
    <div className="bg-white border rounded-ui p-4 space-y-2">
      <p className="text-ui font-medium text-gray-700">
        Clôture de la session : {LIBELLES_STATUT[statut]}
        {session.status_locked && statut === 'to_invoice' && (
          <span className="text-ui-sm text-gray-500"> (statut verrouillé : passage en Terminée à la main)</span>
        )}
      </p>
      <ul className="space-y-1">
        {POINTS.map(([cle, libelle]) => (
          <li key={cle} className={`text-ui-sm ${etat[cle] ? 'text-[rgb(var(--c-success))]' : 'text-[rgb(var(--c-warning))]'}`}>
            {etat[cle] ? '✓' : '○'} {libelle}
          </li>
        ))}
      </ul>
      {statut === 'to_invoice' && !etat.facture && !session.sans_facture_motif && peutModifier && (
        saisieMotif ? (
          <div className="flex gap-2 items-center">
            <input className="input flex-1" value={motif} maxLength={500} onChange={(e) => setMotif(e.target.value)}
              placeholder="Motif : pourquoi cette session n'est pas facturée" aria-label="Motif de la session sans facture" />
            <button className="btn btn-primary btn-sm" disabled={envoi} onClick={enregistrerMotif}>Enregistrer</button>
            <button className="btn btn-secondary btn-sm" disabled={envoi} onClick={() => setSaisieMotif(false)}>Annuler</button>
          </div>
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={() => setSaisieMotif(true)}>Pas de facture pour cette session</button>
        )
      )}
      {session.sans_facture_motif && <p className="text-ui-sm text-gray-500">Sans facture : {session.sans_facture_motif}</p>}
    </div>
  )
}

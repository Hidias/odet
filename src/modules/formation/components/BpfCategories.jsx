// Catégorie des stagiaires pour le BPF (cadre F-1 du Cerfa 10443*17, 0477) : déduite du client par défaut
// (entreprise : salarié, particulier : à ses frais, public : autre) ; à préciser seulement quand elle diffère
// (apprenti, demandeur d'emploi…). Le calcul du BPF reprend la valeur saisie.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../core/supabase'

export const CATEGORIES_F1 = [
  { value: 'a', label: 'Salarié d\'un employeur privé (hors apprenti)' },
  { value: 'b', label: 'Apprenti' },
  { value: 'c', label: 'Personne en recherche d\'emploi' },
  { value: 'd', label: 'Particulier à ses frais' },
  { value: 'e', label: 'Autre (agent public, dirigeant non salarié, bénévole…)' },
]

/** Catégorie déduite du type de client de la session, comme dans le calcul en base */
export function categorieDeduite(clientType) {
  if (clientType === 'particulier') return 'd'
  if (clientType === 'public') return 'e'
  return 'a'
}

export default function BpfCategories({ session, peutModifier }) {
  const inscrits = (session?.session_trainees || []).filter((st) => !st.absent)
  const [valeurs, setValeurs] = useState(() => Object.fromEntries(inscrits.map((st) => [st.id, st.bpf_categorie || ''])))
  // Session rechargée (stagiaire ajouté, catégorie changée ailleurs) : valeurs remises à jour depuis la base
  const empreinte = inscrits.map((st) => `${st.id}:${st.bpf_categorie || ''}`).join('|')
  useEffect(() => {
    setValeurs(Object.fromEntries(inscrits.map((st) => [st.id, st.bpf_categorie || ''])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empreinte])
  if (!inscrits.length || session?.session_type === 'subcontract') return null
  const deduite = categorieDeduite(session?.clients?.client_type)
  const libelle = (v) => CATEGORIES_F1.find((c) => c.value === v)?.label || ''

  const changer = async (st, v) => {
    const avant = valeurs[st.id]
    setValeurs((x) => ({ ...x, [st.id]: v }))
    const { error } = await supabase.from('session_trainees').update({ bpf_categorie: v || null }).eq('id', st.id)
    if (error) {
      setValeurs((x) => ({ ...x, [st.id]: avant }))
      toast.error(`Catégorie non enregistrée : ${error.message}`)
    }
  }

  return (
    <div className="card mt-4">
      <h3 className="font-semibold">Catégorie des stagiaires pour le BPF</h3>
      <p className="text-ui text-gray-500 mb-3">Par défaut : {libelle(deduite).toLowerCase()}, d&apos;après le client. À changer seulement pour un apprenti, une personne en recherche d&apos;emploi ou un autre cas.</p>
      <div className="divide-y">
        {inscrits.map((st) => (
          <div key={st.id} className="py-2 flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="sm:w-1/3 text-ui font-medium">{st.trainees?.first_name} {(st.trainees?.last_name || '').toUpperCase()}</span>
            <select className="select sm:flex-1" value={valeurs[st.id] || ''} disabled={!peutModifier} onChange={(e) => changer(st, e.target.value)}
              aria-label={`Catégorie BPF de ${st.trainees?.first_name || ''} ${st.trainees?.last_name || ''}`}>
              <option value="">Par défaut ({libelle(deduite)})</option>
              {CATEGORIES_F1.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}

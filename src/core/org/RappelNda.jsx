import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { addMonths, format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { FileWarning } from 'lucide-react'
import { supabase } from '../supabase'

// Rappel de la déclaration d'activité (décision de H du 19/10, 23h15) : tant que le numéro n'est pas saisi, la
// déclaration est à déposer dans les 3 mois qui suivent la première convention de formation signée (article R6351-1
// du code du travail, dépôt en ligne sur Mes Démarches Emploi et Formation). Affiché à la direction sur l'accueil.
export default function RappelNda({ organization }) {
  const [premiere, setPremiere] = useState(undefined)
  const sansNumero = organization && !String(organization.nda || '').replace(/\s/g, '')
  useEffect(() => {
    if (!sansNumero) return
    supabase.from('sessions').select('convention_signed_date').eq('convention_signed', true)
      .not('convention_signed_date', 'is', null).order('convention_signed_date', { ascending: true }).limit(1)
      .then(({ data, error }) => setPremiere(error ? null : (data?.[0]?.convention_signed_date || null)))
  }, [sansNumero])
  if (!sansNumero || premiere === undefined) return null
  const limite = premiere ? addMonths(new Date(premiere), 3) : null
  const enRetard = limite && limite < new Date()
  return (
    <div className={`rounded-ui border px-3 py-2.5 flex flex-wrap items-start gap-x-3 gap-y-2 text-ui ${enRetard ? 'border-[rgb(var(--c-danger)/0.4)] bg-[rgb(var(--c-danger-bg))]' : 'border-[rgb(var(--c-warning)/0.4)] bg-[rgb(var(--c-warning-bg))]'}`} role="status">
      <FileWarning className={`w-4 h-4 mt-0.5 flex-none ${enRetard ? 'text-[rgb(var(--c-danger))]' : 'text-[rgb(var(--c-warning))]'}`} aria-hidden="true" />
      <div className="flex-1 min-w-[12rem] text-gray-800">
        <div className="font-medium">Déclaration d'activité de formation à déposer</div>
        <div className="text-ui-sm text-gray-700">
          {premiere
            ? <>Première convention signée le {format(new Date(premiere), 'd MMMM yyyy', { locale: fr })} : la déclaration est à déposer {enRetard ? 'depuis le' : 'avant le'} <strong>{format(limite, 'd MMMM yyyy', { locale: fr })}</strong>.</>
            : <>Elle est à déposer dans les 3 mois qui suivent la première convention de formation signée.</>}
          {' '}En attendant, les documents de formation portent la mention « Déclaration d'activité en cours d'enregistrement ». Dès que le numéro est reçu, saisissez-le dans les Paramètres : il remplace la mention partout.
        </div>
      </div>
      <Link to="/certification/nda" className="btn btn-secondary btn-sm">Préparer la déclaration</Link>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { addMonths, format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { FileWarning, Hourglass } from 'lucide-react'
import { supabase } from '../supabase'
import { etatRappelNda, incoherencesNda } from './rappelNdaEtat'

// Rappel de la déclaration d'activité (décision de H du 19/10, 23h15) : tant que le numéro n'est pas saisi, la
// déclaration est à déposer dans les 3 mois qui suivent la première convention de formation signée (article R6351-1
// du code du travail, dépôt en ligne sur Mes Démarches Emploi et Formation). Affiché à la direction sur l'accueil.
// Le statut du suivi de Certification › NDA (cert_settings) est lu (B6, 04/11). Limite : sans le droit ou le module
// Certification, ou pour une seconde société (suivi unique, id = 1), le suivi est illisible et le rappel reste « à déposer ».
export default function RappelNda({ organization }) {
  const [donnees, setDonnees] = useState(undefined)
  const sansNumero = organization && !String(organization.nda || '').replace(/\s/g, '')
  useEffect(() => {
    if (!sansNumero) return undefined
    let actif = true
    Promise.all([
      supabase.from('cert_settings').select('nda_status, nda_filed_at, nda_complete_at, first_convention_date').eq('id', 1).maybeSingle(),
      supabase.from('sessions').select('convention_signed_date').eq('convention_signed', true)
        .not('convention_signed_date', 'is', null).order('convention_signed_date', { ascending: true }).limit(1),
    ]).then(([suivi, sessions]) => { if (actif) setDonnees({
      suivi: suivi.error ? null : suivi.data,
      premiereConventionSession: sessions.error ? null : (sessions.data?.[0]?.convention_signed_date || null),
    }) }).catch(() => { if (actif) setDonnees({ suivi: null, premiereConventionSession: null }) })
    return () => { actif = false }
  }, [sansNumero])
  if (!sansNumero || donnees === undefined) return null
  const etat = etatRappelNda({ nda: organization.nda, ...donnees })
  if (etat.type === 'aucun') return null
  const alertes = incoherencesNda(donnees.suivi)
  const jour = (d) => format(new Date(d), 'd MMMM yyyy', { locale: fr })

  if (etat.type === 'attente') {
    return (
      <div className="rounded-ui border border-gray-200 bg-white px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui" role="status">
        <Hourglass className="w-4 h-4 flex-none text-gray-400" aria-hidden="true" />
        <div className="flex-1 min-w-[12rem] text-gray-700">
          Déclaration d'activité {etat.deposeeLe ? <>déposée le {jour(etat.deposeeLe)}</> : 'déposée'}{etat.completLe ? <>, dossier complet le {jour(etat.completLe)}</> : ''} : en attente du numéro. Dès réception, saisissez-le dans les Paramètres.
          {alertes.map((a) => <div key={a} className="text-ui-sm text-[rgb(var(--c-warning))]">{a}</div>)}
        </div>
        <Link to="/certification/nda" className="btn btn-ghost btn-sm">Suivi</Link>
      </div>
    )
  }

  if (etat.type === 'numero_a_saisir') {
    return (
      <div className="rounded-ui border border-[rgb(var(--c-warning)/0.4)] bg-[rgb(var(--c-warning-bg))] px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui" role="status">
        <FileWarning className="w-4 h-4 flex-none text-[rgb(var(--c-warning))]" aria-hidden="true" />
        <div className="flex-1 min-w-[12rem] text-gray-800">Déclaration d'activité enregistrée : saisissez son numéro dans les Paramètres pour qu'il figure sur les documents.</div>
        <Link to="/parametres" className="btn btn-secondary btn-sm">Paramètres</Link>
      </div>
    )
  }

  const refusee = etat.type === 'refusee'
  const premiere = etat.premiere
  const limite = !refusee && premiere ? addMonths(new Date(premiere), 3) : null
  const enRetard = refusee || (limite && limite < new Date())
  return (
    <div className={`rounded-ui border px-3 py-2.5 flex flex-wrap items-start gap-x-3 gap-y-2 text-ui ${enRetard ? 'border-[rgb(var(--c-danger)/0.4)] bg-[rgb(var(--c-danger-bg))]' : 'border-[rgb(var(--c-warning)/0.4)] bg-[rgb(var(--c-warning-bg))]'}`} role="status">
      <FileWarning className={`w-4 h-4 mt-0.5 flex-none ${enRetard ? 'text-[rgb(var(--c-danger))]' : 'text-[rgb(var(--c-warning))]'}`} aria-hidden="true" />
      <div className="flex-1 min-w-[12rem] text-gray-800">
        <div className="font-medium">{refusee ? "Déclaration d'activité refusée" : "Déclaration d'activité de formation à déposer"}</div>
        <div className="text-ui-sm text-gray-700">
          {refusee
            ? <>Le suivi indique un refus : reprenez le dossier dans Certification.</>
            : premiere
              ? <>Première convention signée le {jour(premiere)} : la déclaration est à déposer {enRetard ? 'depuis le' : 'avant le'} <strong>{format(limite, 'd MMMM yyyy', { locale: fr })}</strong>.</>
              : <>Elle est à déposer dans les 3 mois qui suivent la première convention de formation signée.</>}
          {!refusee && <>{' '}En attendant, les documents de formation portent la mention « Déclaration d'activité en cours d'enregistrement ». Dès que le numéro est reçu, saisissez-le dans les Paramètres : il remplace la mention partout.</>}
          {alertes.map((a) => <div key={a} className="text-[rgb(var(--c-warning))]">{a}</div>)}
        </div>
      </div>
      <Link to="/certification/nda" className="btn btn-secondary btn-sm">{refusee ? 'Reprendre le dossier' : 'Préparer la déclaration'}</Link>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sun, KanbanSquare, Inbox, Calendar, MapPin, CreditCard, Receipt, PhoneCall, CheckCircle, FileText } from 'lucide-react'
import { supabase } from '../../core/supabase'
import { useAuthStore } from '../../core/store'

// Accueil « Ma journée » : ce qu'il y a à faire aujourd'hui, une ligne par sujet, un bouton par ligne.
// Chaque ligne n'apparaît que si le compte peut lire la donnée (droits en base) et qu'il y a quelque chose à faire.

const jour = (decalageJours = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + decalageJours)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Lignes lues (identifiants seuls, 500 au plus) : un comptage HEAD « exact » en parallèle peut être refusé par
// l'API (503) quand le tableau de bord charge en même temps ; les sujets sont donc lus par petits groupes (PAR_GROUPE),
// depuis que les droits sont calculés une fois par requête (0090, environ 10 ms par lecture).
const PLAFOND = 500
const PAR_GROUPE = 4
async function compter(requete) {
  try {
    const { data, error } = await requete.limit(PLAFOND)
    return error ? 0 : (data || []).length
  } catch {
    return 0
  }
}

export default function MaJournee() {
  const modules = useAuthStore((s) => s.modules) || []
  const can = useAuthStore((s) => s.can)
  const [lignes, setLignes] = useState(null)

  useEffect(() => {
    let vivant = true
    const auj = jour()
    const a = (m) => modules.includes(m)
    const ok = (code) => can?.(code) !== false
    const sujets = [
      a('affaires') && ok('commercial.devis.voir') && {
        icon: KanbanSquare, to: '/affaires', libelle: (n) => `${n} affaire${n > 1 ? 's' : ''} à relancer (aujourd'hui ou en retard)`,
        q: () => supabase.from('v_pipeline').select('id').lte('next_action_on', auj),
      },
      a('affaires') && ok('commercial.devis.voir') && {
        icon: PhoneCall, to: '/affaires', etat: { onglet: 'appeler' }, libelle: (n) => `${n} client${n > 1 ? 's' : ''} avec une échéance dépassée à appeler`,
        q: () => supabase.from('v_clients_a_appeler').select('client_id').eq('depassee', true).eq('ne_pas_appeler', false),
      },
      ok('formation.convocations.envoyer') && {
        icon: Inbox, to: '/a-valider', libelle: (n) => `${n} relance${n > 1 ? 's' : ''} préparée${n > 1 ? 's' : ''} à valider`,
        q: () => supabase.from('scheduled_actions').select('id').eq('status', 'a_valider'),
      },
      a('formation') && {
        icon: Calendar, to: '/sessions', libelle: (n) => `${n} session${n > 1 ? 's' : ''} aujourd'hui`,
        q: () => supabase.from('sessions').select('id').lte('start_date', auj).gte('end_date', auj).not('status', 'in', '("cancelled","annulee")'),
      },
      a('interventions') && {
        icon: MapPin, to: '/interventions', libelle: (n) => `${n} visite${n > 1 ? 's' : ''} prévue${n > 1 ? 's' : ''} aujourd'hui`,
        q: () => supabase.from('itv_visits').select('id').eq('planned_on', auj).not('status', 'in', '("terminee","annulee")'),
      },
      // Revue annuelle des programmes (Qualiopi, indicateur 1) : jamais revus ou revus il y a plus d'un an
      a('formation') && ok('formation.catalogue.gerer') && {
        icon: FileText, to: '/formations', libelle: (n) => `${n} programme${n > 1 ? 's' : ''} à revoir (pas de mise à jour depuis plus d'un an)`,
        q: () => supabase.from('courses').select('id').or(`program_updated_on.is.null,program_updated_on.lt.${jour(-365)}`),
      },
      a('commercial') && ok('commercial.devis.voir') && {
        icon: Receipt, to: '/devis', libelle: (n) => `${n} devis à relancer`,
        q: () => supabase.from('quotes').select('id').eq('status', 'sent').lte('next_followup_date', auj),
      },
      a('commercial') && ok('facturation.factures.voir') && {
        icon: CreditCard, to: '/factures', libelle: (n) => `${n} facture${n > 1 ? 's' : ''} en retard de paiement`,
        q: () => supabase.from('invoices').select('id').not('issued_at', 'is', null).lt('due_date', auj).gt('amount_due', 0).eq('type', 'invoice'),
      },
    ].filter(Boolean)
    ;(async () => {
      const r = []
      for (let i = 0; i < sujets.length; i += PAR_GROUPE) {
        if (!vivant) return
        const groupe = sujets.slice(i, i + PAR_GROUPE)
        const n = await Promise.all(groupe.map((s) => compter(s.q())))
        groupe.forEach((s, j) => r.push({ ...s, n: n[j] }))
      }
      if (vivant) setLignes(r.filter((x) => x.n > 0))
    })()
    return () => { vivant = false }
  }, [modules.join(','), can]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="surface overflow-hidden" aria-label="Ma journée">
      <div className="flex items-center gap-2 px-4 py-3 border-b hairline">
        <Sun className="w-5 h-5 text-accent-600" aria-hidden="true" />
        <h2 className="section-title">Ma journée</h2>
      </div>
      {lignes === null ? (
        <div className="px-4 py-3 text-ui-sm text-gray-500">Chargement…</div>
      ) : lignes.length === 0 ? (
        <div className="px-4 py-3 text-ui text-gray-600 flex items-center gap-2"><CheckCircle className="w-4 h-4" aria-hidden="true" />Rien d'urgent aujourd'hui.</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {lignes.map((l) => (
            <li key={l.libelle(1)} className="px-4 py-3 flex items-center gap-3">
              <l.icon className="w-5 h-5 text-gray-500 flex-none" aria-hidden="true" />
              <span className="flex-1 text-ui text-gray-900">{l.n >= PLAFOND ? l.libelle(l.n).replace(String(l.n), `${PLAFOND} ou plus`) : l.libelle(l.n)}</span>
              <Link to={l.to} state={l.etat} className="btn btn-secondary btn-sm">Voir</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

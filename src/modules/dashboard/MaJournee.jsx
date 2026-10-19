import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sun, KanbanSquare, Inbox, Calendar, MapPin, CreditCard, Receipt, PhoneCall, CheckCircle } from 'lucide-react'
import { supabase } from '../../core/supabase'
import { useAuthStore } from '../../core/store'

// Accueil « Ma journée » : ce qu'il y a à faire aujourd'hui, une ligne par sujet, un bouton par ligne.
// Chaque ligne n'apparaît que si le compte peut lire la donnée (droits en base) et qu'il y a quelque chose à faire.

const jour = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function compter(requete) {
  try {
    const { count, error } = await requete
    return error ? 0 : count || 0
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
    const tete = { count: 'exact', head: true }
    const a = (m) => modules.includes(m)
    const ok = (code) => can?.(code) !== false
    const sujets = [
      a('affaires') && ok('commercial.devis.voir') && {
        icon: KanbanSquare, to: '/affaires', libelle: (n) => `${n} affaire${n > 1 ? 's' : ''} à relancer (aujourd'hui ou en retard)`,
        q: () => supabase.from('v_pipeline').select('id', tete).lte('next_action_on', auj),
      },
      a('affaires') && ok('commercial.devis.voir') && {
        icon: PhoneCall, to: '/affaires', etat: { onglet: 'appeler' }, libelle: (n) => `${n} client${n > 1 ? 's' : ''} avec une échéance dépassée à appeler`,
        q: () => supabase.from('v_clients_a_appeler').select('client_id', tete).eq('depassee', true).eq('ne_pas_appeler', false),
      },
      ok('formation.convocations.envoyer') && {
        icon: Inbox, to: '/a-valider', libelle: (n) => `${n} relance${n > 1 ? 's' : ''} préparée${n > 1 ? 's' : ''} à valider`,
        q: () => supabase.from('scheduled_actions').select('id', tete).eq('status', 'a_valider'),
      },
      a('formation') && {
        icon: Calendar, to: '/sessions', libelle: (n) => `${n} session${n > 1 ? 's' : ''} aujourd'hui`,
        q: () => supabase.from('sessions').select('id', tete).lte('start_date', auj).gte('end_date', auj).not('status', 'in', '("cancelled","annulee")'),
      },
      a('interventions') && {
        icon: MapPin, to: '/interventions', libelle: (n) => `${n} visite${n > 1 ? 's' : ''} prévue${n > 1 ? 's' : ''} aujourd'hui`,
        q: () => supabase.from('itv_visits').select('id', tete).eq('planned_on', auj).not('status', 'in', '("terminee","annulee")'),
      },
      a('commercial') && ok('commercial.devis.voir') && {
        icon: Receipt, to: '/devis', libelle: (n) => `${n} devis à relancer`,
        q: () => supabase.from('quotes').select('id', tete).eq('status', 'sent').lte('next_followup_date', auj),
      },
      a('commercial') && ok('facturation.factures.voir') && {
        icon: CreditCard, to: '/factures', libelle: (n) => `${n} facture${n > 1 ? 's' : ''} en retard de paiement`,
        q: () => supabase.from('invoices').select('id', tete).not('issued_at', 'is', null).lt('due_date', auj).gt('amount_due', 0).eq('type', 'invoice'),
      },
    ].filter(Boolean)
    Promise.all(sujets.map(async (s) => ({ ...s, n: await compter(s.q()) }))).then((r) => {
      if (vivant) setLignes(r.filter((x) => x.n > 0))
    })
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
              <span className="flex-1 text-ui text-gray-900">{l.libelle(l.n)}</span>
              <Link to={l.to} state={l.etat} className="btn btn-secondary btn-sm">Voir</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

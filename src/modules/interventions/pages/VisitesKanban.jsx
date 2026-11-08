// Visites par étape (Kanban, consigne de H du 04/11) : à planifier, planifiées, en cours, terminées (30 derniers
// jours). Planifier et changer de jour passent par le Planning ; terminer, par le rapport de la visite. Seul
// déplacement ici : remettre une visite planifiée « à planifier » (avec confirmation).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Loader2, CalendarCheck } from 'lucide-react'
import { Kanban, CLASSE_ITEM_MENU } from '../../../ui/Kanban'
import { EmptyState } from '../../../ui/EmptyState'
import { confirmer } from '../../../ui/Confirm'
import { loadVisits, remettreAPlanifier } from '../lib/itvData'
import { todayIso, parseDay, isoDay, frShort } from '../lib/schedule'
import { colonnesVisites, depotVisitePossible, choixVisite, RETOUR_A_PLANIFIER, JOURS_TERMINEES } from '../lib/visitesKanban'

const ilYa = (n) => { const d = parseDay(todayIso()); d.setDate(d.getDate() - n); return isoDay(d) }

export default function VisitesKanban({ technicians, isManager }) {
  const navigate = useNavigate()
  const [visites, setVisites] = useState(null)
  const demande = useRef(0)
  const noms = useMemo(() => Object.fromEntries((technicians || []).map((t) => [t.id, t.name])), [technicians])

  const charger = useCallback(async () => {
    const n = ++demande.current
    try {
      const [ouvertes, terminees] = await Promise.all([
        loadVisits({ status: ['a_planifier', 'planifiee', 'en_cours'] }),
        loadVisits({ status: 'terminee', from: ilYa(JOURS_TERMINEES) }),
      ])
      if (n !== demande.current) return
      setVisites([...(ouvertes || []), ...(terminees || [])])
    } catch (e) { if (n === demande.current) { toast.error(e.message); setVisites([]) } }
  }, [])
  useEffect(() => { charger() }, [charger])

  const colonnes = useMemo(() => colonnesVisites(visites), [visites])

  const deplanifier = async (v) => {
    const quand = v.planned_on ? ` du ${frShort(v.planned_on, { year: false })}` : ''
    const qui = v.technician_id && noms[v.technician_id] ? ` de ${noms[v.technician_id]}` : ''
    if (!(await confirmer({ title: 'Remettre à planifier ?', message: `La visite ${v.clients?.name ? `chez ${v.clients.name} ` : ''}sort de la tournée${quand}${qui}. Il faudra la replacer dans le Planning.`, confirmLabel: 'Remettre à planifier' }))) return
    setVisites((l) => (l || []).map((x) => (x.id === v.id ? { ...x, ...RETOUR_A_PLANIFIER } : x)))
    try {
      const n = await remettreAPlanifier(v.id, RETOUR_A_PLANIFIER)
      if (n) toast.success('Visite remise à planifier')
      else toast.error('Cette visite a changé entre-temps (commencée, ou déjà replanifiée) : la liste est mise à jour')
    } catch (e) { toast.error(e.message) }
    charger()
  }

  if (visites === null) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  if (visites.length === 0) {
    return <div className="card"><EmptyState icon={CalendarCheck} title="Aucune visite" compact>Les visites des contrats et les vérifications à faire apparaissent ici dès qu'elles sont créées (Contrats, ou Planning et tournées).</EmptyState></div>
  }

  return (
    <div className="space-y-2">
      <p className="text-ui-sm text-gray-500">Planifiez dans « Planning et tournées » ; une visite se termine par son rapport. Ici, vous voyez où en est chaque visite (terminées : {JOURS_TERMINEES} derniers jours).</p>
      <Kanban colonnes={colonnes} cle={(v) => v.id} label="Visites par étape" labelMenu="Actions de la visite" vide="Aucune visite"
        onOuvrir={(v) => navigate(`/interventions/visite/${v.id}`)}
        deplacable={(v) => depotVisitePossible(v, 'a_planifier', isManager)}
        peutDeposer={(v, code) => depotVisitePossible(v, code, isManager)}
        onDeposer={(v) => deplanifier(v)}
        libelleMenu={(v) => `Actions : visite ${[v.clients?.name, v.sites?.name].filter(Boolean).join(', ')}`}
        carte={(v) => (
          <>
            <div className="text-ui font-medium truncate">{v.clients?.name || 'Client'}</div>
            <div className="text-ui-sm text-gray-500 truncate">{[v.sites?.name, v.sites?.city].filter(Boolean).join(', ') || ' '}</div>
            <div className="text-ui-sm text-gray-400 flex justify-between gap-2">
              <span>{v.status === 'a_planifier' ? (v.due_on ? `à faire avant le ${frShort(v.due_on, { year: false })}` : 'à planifier') : (v.planned_on ? frShort(v.planned_on, { year: false }) : '')}</span>
              <span className="truncate">{v.technician_id ? noms[v.technician_id] || 'Technicien' : ''}</span>
            </div>
            {v.itv_contracts?.label && <div className="text-ui-sm text-gray-400 truncate">{v.itv_contracts.label}</div>}
          </>
        )}
        menu={({ ligne, choisir }) => choixVisite(ligne, isManager).map((c) => (
          <button key={c.code} type="button" className={CLASSE_ITEM_MENU}
            onClick={() => (c.lien ? choisir(() => navigate(c.lien), false) : choisir(() => deplanifier(ligne)))}>
            {c.label}
          </button>
        ))} />
    </div>
  )
}

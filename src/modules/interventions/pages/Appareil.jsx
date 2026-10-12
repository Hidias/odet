// Fiche d'un appareil ouverte par son étiquette (QR code ou code saisi) : identité, échéances, historique.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronLeft, Loader2, Pencil } from 'lucide-react'
import { loadEquipmentByCode, loadEquipmentHistory, loadVisits, loadDoneOperations } from '../lib/itvData'
import { RESULT_LABEL, periodicOperations, endOfLife, frShort, todayIso } from '../lib/schedule'
import { ResultBadge, DueBadge, ScanButton, Empty } from '../components/ui'
import EquipmentForm from '../components/EquipmentForm'

export default function Appareil({ settings, types, canWrite, profile }) {
  const { code } = useParams()
  const navigate = useNavigate()
  const [eq, setEq] = useState(undefined)
  const [history, setHistory] = useState([])
  const [openVisit, setOpenVisit] = useState(null)
  const [done, setDone] = useState([])
  const [editing, setEditing] = useState(false)

  const load = async () => {
    const e = await loadEquipmentByCode(decodeURIComponent(code))
    setEq(e || null)
    if (!e) return
    const [h, vs, d] = await Promise.all([
      loadEquipmentHistory(e.id),
      loadVisits({ siteId: e.site_id, status: ['en_cours', 'planifiee'] }),
      loadDoneOperations([e.id]),
    ])
    setHistory(h)
    setDone(d[e.id] || [])
    const mine = (vs || []).find((v) => v.status === 'en_cours' && (!profile || v.technician_id === profile.id)) || (vs || []).find((v) => v.status === 'en_cours') || (vs || []).find((v) => v.planned_on === todayIso())
    setOpenVisit(mine || null)
  }
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  const type = useMemo(() => types.find((t) => t.id === eq?.type_id) || eq?.itv_equipment_types, [types, eq])
  const ops = useMemo(() => (eq && type ? periodicOperations(type, eq, new Date().getFullYear(), done).filter((o) => ['due', 'late', 'future'].includes(o.state)) : []), [eq, type, done])
  const eol = eq && type ? endOfLife(type, eq) : null

  if (eq === undefined) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  if (eq === null) {
    return (
      <div className="space-y-3 max-w-xl">
        <Empty title={`Aucun appareil pour le code ${decodeURIComponent(code)}`}>Vérifiez l'étiquette, ou ajoutez l'appareil depuis le parc du client.</Empty>
        <ScanButton label="Scanner une autre étiquette" />
      </div>
    )
  }

  const status = eq.status === 'a_remplacer' ? <span className="badge badge-warning">À remplacer</span> : <DueBadge date={eq.next_check_on} short />
  const row = (k, v, strong = false) => v ? (
    <div className="flex justify-between gap-3 py-2 border-b border-gray-100 last:border-b-0 text-ui">
      <span className="text-gray-500">{k}</span><span className={`text-right ${strong ? 'font-semibold' : ''}`}>{v}</span>
    </div>
  ) : null

  return (
    <div className="space-y-3 max-w-xl">
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label="Retour"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-semibold text-lg truncate">{type?.name}</h1>
          <div className="text-ui-sm text-gray-500">{eq.label_code}</div>
        </div>
        {status}
      </div>

      <section className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {row('Client', <Link to={`/interventions/parc/${eq.client_id}`}>{eq.clients?.name}</Link>, true)}
        {row('Site', [eq.sites?.name, eq.sites?.city].filter(Boolean).join(', '))}
        {row('Emplacement', eq.location)}
        {row('Marque, année', [eq.brand, eq.manufactured_year].filter(Boolean).join(', '))}
        {Object.entries(eq.details || {}).filter(([, v]) => v).map(([k, v]) => row(k, String(v)))}
        {row('Dernière vérification', eq.last_check_on ? frShort(eq.last_check_on) : 'Jamais')}
        {row('Prochaine vérification', eq.next_check_on ? frShort(eq.next_check_on) : 'À définir', true)}
        {ops.slice(0, 2).map((o) => row(o.label, `${o.year}${o.state === 'late' ? ', en retard' : o.state === 'due' ? ', cette année' : ''}`))}
        {eol && row('Fin de vie', `${eol.year}${eol.reached ? ', atteinte' : ''}`)}
      </section>

      {openVisit && canWrite && (
        <Link to={`/interventions/visite/${openVisit.id}`} className="btn btn-primary w-full" style={{ height: 50 }}>{openVisit.status === 'en_cours' ? 'Contrôler dans la visite en cours' : 'Ouvrir la visite du jour'}</Link>
      )}
      {canWrite && <button type="button" className="btn btn-secondary w-full" onClick={() => setEditing(true)}><Pencil className="w-4 h-4" />Modifier la fiche de l'appareil</button>}

      <section className="card space-y-1">
        <h2 className="section-title">Historique</h2>
        {history.length === 0 && <p className="muted text-ui-sm">Aucune visite enregistrée pour cet appareil.</p>}
        {history.map((h) => (
          <div key={h.id} className="flex gap-3 py-2 border-b border-gray-100 last:border-b-0">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-ui">{frShort(h.day)}, {RESULT_LABEL[h.result] ? RESULT_LABEL[h.result].toLowerCase() : 'non contrôlé'}</div>
              <div className="text-ui-sm text-gray-500">{[settings.operation_labels[h.operation] || h.operation, h.defect, h.observation, h.technician].filter(Boolean).join('. ')}</div>
            </div>
            <ResultBadge result={h.result} />
          </div>
        ))}
      </section>
      {editing && <EquipmentForm equipment={eq} clientId={eq.client_id} types={types} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load() }} />}
    </div>
  )
}

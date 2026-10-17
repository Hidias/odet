import { teamFirstNames } from '../../../core/org/currentOrg'
import { useEffect, useState } from 'react'
import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'
import { Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { formatDistanceToNowStrict, parseISO, isToday, isTomorrow, isBefore, startOfDay, format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useNavigate } from 'react-router-dom'

const LOCATION_LABELS = {
  leurs_locaux: ' Leurs locaux',
  nos_locaux: ' Nos locaux',
  visio: ' Visio',
  telephone: ' Tél.',
}

const RDV_TYPE_LABELS = {
  decouverte: 'Découverte',
  telephone: 'Téléphone',
  visio: 'Visio',
  sur_place: 'Sur place',
  suivi: 'Suivi',
  signature: 'Signature',
  relance: 'Relance',
  autre: 'Autre',
}

function agoLabel(dateStr) {
  if (!dateStr) return null
  try {
    return formatDistanceToNowStrict(parseISO(dateStr), { locale: fr, addSuffix: false })
  } catch {
    return null
  }
}

function isActionLate(rdv) {
  if (!rdv.next_action_date) return false
  try {
    return isBefore(parseISO(rdv.next_action_date), startOfDay(new Date()))
  } catch {
    return false
  }
}

function isRdvLate(rdv) {
  if (!rdv.rdv_date) return false
  try {
    return isBefore(parseISO(rdv.rdv_date), startOfDay(new Date()))
  } catch {
    return false
  }
}

export default function Prospection() {
  const navigate = useNavigate()
  const [rdvs, setRdvs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterBy, setFilterBy] = useState('all')

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      // fetchAll : pagination complète (PostgREST tronque à 1 000 lignes sans erreur)
      const { data, error } = await fetchAll(() => supabase
        .from('prospect_rdv')
        .select(`
          *,
          clients (id, name, city, proprietaire)
        `)
        .order('updated_at', { ascending: false }))
      if (error) throw error
      setRdvs(data || [])
    } catch (err) {
      console.error(err)
      toast.error('Erreur lors du chargement')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    if (!confirm('Supprimer ce RDV ?')) return
    try {
      const { error } = await supabase.from('prospect_rdv').delete().eq('id', id)
      if (error) throw error
      toast.success('RDV supprimé')
      loadData()
    } catch (err) {
      toast.error('Erreur suppression')
    }
  }

  // Filtrage par commercial
  const filtered = rdvs.filter(r => {
    if (filterBy === 'all') return true
    return (r.conducted_by || '').toLowerCase() === filterBy.toLowerCase()
  })

  const today = startOfDay(new Date())

  // helper : RDV prévu dont la date est passée
  const isPrevuLate = r => r.status === 'prevu' && r.rdv_date && isBefore(parseISO(r.rdv_date), today)
  // helper : next_action_date dépassée (tous statuts actifs)
  const hasLateAction = r => r.next_action_date && isBefore(parseISO(r.next_action_date), today)
  // helper : réalisé sans session liée ET next_action_date dépassée
  const realiseOrphelin = r => r.status === 'realise' && !r.session_id && r.next_action_date && isBefore(parseISO(r.next_action_date), today)

  // Transferts = a_prendre avec source phoning_marine_transfer
  const transferts = filtered
    .filter(r => r.status === 'a_prendre' && r.source === 'phoning_marine_transfer')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) // plus anciens en premier

  // Chauds = a_prendre signalé en prospection téléphonique (hors transferts)
  const chauds = filtered
    .filter(r => r.status === 'a_prendre' && r.source?.includes('phoning') && r.source !== 'phoning_marine_transfer')
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))

  //  À relancer = 4 cas (mutuellement exclusif avec chauds/prevus/realises)
  const aRelancer = filtered
    .filter(r =>
      // a_prendre créé manuellement
      (r.status === 'a_prendre' && !r.source?.includes('phoning')) ||
      // prevu dont la date est passée sans être clôturé
      isPrevuLate(r) ||
      // prevu avec next_action_date dépassée (et date pas encore passée)
      (r.status === 'prevu' && !isPrevuLate(r) && hasLateAction(r)) ||
      // réalisé sans suite (pas de session liée)
      realiseOrphelin(r)
    )
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))

  // IDs déjà dans aRelancer pour éviter doublons dans prevus/realises
  const relancerIds = new Set(aRelancer.map(r => r.id))

  //  RDV fixé = prevu avec date future (ou sans date), hors aRelancer
  const prevus = filtered
    .filter(r => r.status === 'prevu' && !relancerIds.has(r.id))
    .sort((a, b) => {
      if (!a.rdv_date) return 1
      if (!b.rdv_date) return -1
      return new Date(a.rdv_date) - new Date(b.rdv_date)
    })

  //  Réalisés avec suite + annulés + reportés - jamais de badge "en retard"
  const realises = filtered
    .filter(r => ['annule', 'reporte'].includes(r.status) || (r.status === 'realise' && !relancerIds.has(r.id)))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gray-900" />
      </div>
    )
  }

  return (
    <div>

      {/* ── HEADER ── */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h2 className="text-ui font-bold text-gray-900">RDV commerciaux</h2>

        {/* Filtres commerciaux */}
        <div className="flex gap-1.5">
          {['all', ...teamFirstNames()].map(f => (
            <button
              key={f}
              onClick={() => setFilterBy(f)}
              className={`px-3 py-1.5 rounded-ui-sm text-ui-sm font-semibold border transition-colors ${
                filterBy === f
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
              }`}
            >
              {f === 'all' ? 'Tous' : f}
            </button>
          ))}
        </div>

        <button
          onClick={() => navigate('/prospection/nouveau')}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-ui-sm text-ui-sm font-semibold hover:bg-gray-700 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Nouveau RDV
        </button>
      </div>

      {/* ── BOARD ── */}
      <div className="bg-gray-100 rounded-ui p-3 overflow-x-auto">
        <div className="grid gap-3 min-w-0" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>

          {/* ── COL 0 : TRANSFERTS DE LA PROSPECTION TÉLÉPHONIQUE ── */}
          <KanbanCol
            title=" Transferts"
            count={transferts.length}
            accentColor="#7c3aed"
            badgeBg="bg-gray-100"
            badgeText="text-gray-800"
          >
            {transferts.map(rdv => (
              <TransfertCard
                key={rdv.id}
                rdv={rdv}
                onConvert={async () => {
                  await supabase.from('prospect_rdv').update({
                    source: 'phoning_marine',
                    updated_at: new Date().toISOString(),
                  }).eq('id', rdv.id)
                  loadData()
                  toast.success('Converti en prospect chaud')
                }}
                onClose={async (result) => {
                  await supabase.from('prospect_rdv').update({
                    status: result,
                    updated_at: new Date().toISOString(),
                  }).eq('id', rdv.id)
                  loadData()
                }}
                onClick={() => navigate(`/prospection/${rdv.id}`)}
                onDelete={handleDelete}
              />
            ))}
            {transferts.length === 0 && <EmptyCol text="Aucun transfert en attente" />}
          </KanbanCol>

          {/* ── COL 1 : CHAUDS ── */}
          <KanbanCol
            title=" Chauds"
            count={chauds.length}
            accentColor="#f97316"
            badgeBg="bg-[rgb(var(--c-warning-bg))]"
            badgeText="text-[rgb(var(--c-warning))]"
            onAdd={() => navigate('/prospection/nouveau')}
            addLabel="+ Signaler prospect chaud"
          >
            {chauds.map(rdv => (
              <RdvCard
                key={rdv.id}
                rdv={rdv}
                variant="hot"
                onClick={() => navigate(`/prospection/${rdv.id}`)}
                onDelete={handleDelete}
              />
            ))}
            {chauds.length === 0 && <EmptyCol text="Aucun prospect chaud" />}
          </KanbanCol>

          {/* ── COL 2 : RDV FIXÉ ── */}
          <KanbanCol
            title=" RDV fixé"
            count={prevus.length}
            accentColor="#3b82f6"
            badgeBg="bg-[rgb(var(--c-info-bg))]"
            badgeText="text-[rgb(var(--c-info))]"
            onAdd={() => navigate('/prospection/nouveau')}
            addLabel="+ Fixer un RDV"
          >
            {prevus.map(rdv => (
              <RdvCard
                key={rdv.id}
                rdv={rdv}
                variant="prevu"
                onClick={() => navigate(`/prospection/${rdv.id}`)}
                onDelete={handleDelete}
              />
            ))}
            {prevus.length === 0 && <EmptyCol text="Aucun RDV planifié" />}
          </KanbanCol>

          {/* ── COL 3 : À RELANCER ── */}
          <KanbanCol
            title=" À relancer"
            count={aRelancer.length}
            accentColor="#8b5cf6"
            badgeBg="bg-gray-100"
            badgeText="text-gray-800"
            onAdd={() => navigate('/prospection/nouveau')}
            addLabel="+ Ajouter"
          >
            {aRelancer.map(rdv => (
              <RdvCard
                key={rdv.id}
                rdv={rdv}
                variant="relance"
                onClick={() => navigate(`/prospection/${rdv.id}`)}
                onDelete={handleDelete}
              />
            ))}
            {aRelancer.length === 0 && <EmptyCol text="Aucune relance en attente" />}
          </KanbanCol>

          {/* ── COL 4 : RÉALISÉS ── */}
          <KanbanCol
            title=" Réalisés"
            count={realises.length}
            accentColor="#22c55e"
            badgeBg="bg-[rgb(var(--c-success-bg))]"
            badgeText="text-[rgb(var(--c-success))]"
          >
            {realises.map(rdv => (
              <RdvCard
                key={rdv.id}
                rdv={rdv}
                variant="realise"
                onClick={() => navigate(`/prospection/${rdv.id}`)}
                onDelete={handleDelete}
              />
            ))}
            {realises.length === 0 && <EmptyCol text="Aucun RDV réalisé" />}
          </KanbanCol>

        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────
   COLONNE KANBAN
───────────────────────────────────────── */
function KanbanCol({ title, count, accentColor, badgeBg, badgeText, children, onAdd, addLabel }) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-1 mb-1">
        <span className="text-ui-sm font-bold uppercase tracking-wide text-gray-500">{title}</span>
        <span className={`text-ui-sm font-bold px-2 py-0.5 rounded-full ${badgeBg} ${badgeText}`}>
          {count}
        </span>
      </div>

      {/* Barre accent */}
      <div className="h-0.5 rounded-full mb-1" style={{ backgroundColor: accentColor }} />

      {/* Cards */}
      {children}

      {/* Bouton ajouter */}
      {onAdd && (
        <button
          onClick={onAdd}
          className="w-full mt-1 py-2 border-2 border-dashed border-gray-300 rounded-ui-sm text-ui-sm text-gray-400 hover:border-gray-500 hover:text-gray-600 hover:bg-white transition-colors"
        >
          {addLabel}
        </button>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────
   CARTE TRANSFERT DE LA PROSPECTION TÉLÉPHONIQUE
───────────────────────────────────────── */
function TransfertCard({ rdv, onConvert, onClose, onClick, onDelete }) {
  const [showClose, setShowClose] = useState(false)
  const [saving, setSaving] = useState(false)
  const ago = agoLabel(rdv.updated_at)
  const days = Math.floor((Date.now() - new Date(rdv.created_at).getTime()) / 86400000)
  const isOld = days >= 3

  const handleConvert = async (e) => {
    e.stopPropagation()
    setSaving(true)
    try { await onConvert() } finally { setSaving(false) }
  }

  const handleClose = async (e, result) => {
    e.stopPropagation()
    setSaving(true)
    try { await onClose(result) } finally { setSaving(false) }
  }

  return (
    <div
      onClick={onClick}
      className={`group bg-white rounded-ui-sm border p-3 cursor-pointer hover:shadow-md transition-all ${isOld ? 'border-[rgb(var(--c-danger)/0.3)] border-l-2 border-l-red-400' : 'border-gray-200 border-l-2 border-l-purple-400'}`}
    >
      <div className="flex items-start justify-between gap-1 mb-1">
        <span className="text-ui font-semibold text-gray-900 leading-tight truncate">
          {rdv.clients?.name || 'Client inconnu'}
        </span>
        <button onClick={(e) => { e.stopPropagation(); onDelete(e, rdv.id) }}
          className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 text-gray-300 hover:text-[rgb(var(--c-danger))] transition-opacity flex-shrink-0">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      {rdv.contact_name && (
        <p className="text-ui-sm text-gray-400 mb-1 truncate"> {rdv.contact_name}{rdv.contact_function ? ` · ${rdv.contact_function}` : ''}</p>
      )}
      {rdv.contact_phone && (
        <p className="text-ui-sm text-[rgb(var(--c-info))] font-medium mb-1">{rdv.contact_phone}</p>
      )}
      {rdv.notes_crm && (
        <p className="text-ui-sm text-gray-500 mb-2 italic line-clamp-2">{rdv.notes_crm.replace(/^\S*\s*Transfert[^\n]*?(-|$)/, '').trim()}</p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <span className="text-ui-sm font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-800">
           Transfert
        </span>
        {rdv.conducted_by && (
          <span className="text-ui-sm font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
            → {rdv.conducted_by}
          </span>
        )}
        {isOld && (
          <span className="text-ui-sm font-semibold px-1.5 py-0.5 rounded-full bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]">
             {days}j
          </span>
        )}
        <span className="text-ui-sm text-gray-400 ml-auto">{ago}</span>
      </div>

      {/* Actions */}
      {!showClose ? (
        <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
          <button onClick={handleConvert} disabled={saving}
            className="flex-1 px-2 py-1 text-ui-sm font-semibold bg-[rgb(var(--c-warning))] text-white rounded hover:bg-[rgb(var(--c-warning))] disabled:opacity-50">
             → Prospect chaud
          </button>
          <button onClick={(e) => { e.stopPropagation(); setShowClose(true) }}
            className="px-2 py-1 text-ui-sm font-semibold bg-gray-100 text-gray-600 rounded hover:bg-gray-200">
            Clôturer
          </button>
        </div>
      ) : (
        <div className="space-y-1" onClick={e => e.stopPropagation()}>
          <p className="text-ui-sm text-gray-500 font-medium">Résultat :</p>
          <div className="flex gap-1 flex-wrap">
            {[['realise', ' Traité'], ['annule', ' Sans suite'], ['reporte', ' Reporter']].map(([v, l]) => (
              <button key={v} onClick={(e) => handleClose(e, v)} disabled={saving}
                className="px-2 py-1 text-ui-sm font-semibold bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50">
                {l}
              </button>
            ))}
            <button onClick={(e) => { e.stopPropagation(); setShowClose(false) }}
              className="px-2 py-1 text-ui-sm text-gray-400 rounded hover:bg-gray-100">Fermer</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────
   CARTE RDV
───────────────────────────────────────── */
function RdvCard({ rdv, variant, onClick, onDelete }) {
  const late = !['realise', 'annule', 'reporte'].includes(variant) && (isActionLate(rdv) || (variant === 'prevu' && isRdvLate(rdv)))
  const isHotFromPhoning = rdv.temperature === 'chaud' && rdv.source?.includes('marine')
  const isTransfer = rdv.source?.includes('transfer')
  const ago = agoLabel(rdv.updated_at)

  // Couleur bordure gauche
  let borderLeft = 'border-l-2 border-l-transparent'
  if (late) borderLeft = 'border-l-2 border-l-red-400'
  else if (variant === 'hot') borderLeft = 'border-l-2 border-l-orange-400'

  // Date label pour les prévus
  let dateLbl = null
  let dateColor = 'text-gray-500'
  if (rdv.rdv_date) {
    try {
      const d = parseISO(rdv.rdv_date)
      if (isToday(d)) { dateLbl = `Auj.${rdv.rdv_time ? ' ' + rdv.rdv_time.slice(0, 5) : ''}`; dateColor = 'text-[rgb(var(--c-danger))] font-bold' }
      else if (isTomorrow(d)) { dateLbl = `Dem.${rdv.rdv_time ? ' ' + rdv.rdv_time.slice(0, 5) : ''}`; dateColor = 'text-[rgb(var(--c-warning))] font-semibold' }
      else if (isRdvLate(rdv)) { dateLbl = 'Dépassé'; dateColor = 'text-[rgb(var(--c-danger))] font-semibold' }
      else {
        dateLbl = format(d, 'EEE d MMM', { locale: fr }) + (rdv.rdv_time ? ' ' + rdv.rdv_time.slice(0, 5) : '')
      }
    } catch {}
  }

  return (
    <div
      onClick={onClick}
      className={`group bg-white rounded-ui-sm border border-gray-200 p-3 cursor-pointer hover:shadow-md hover:-translate-y-px transition-all ${borderLeft}`}
    >
      {/* Nom + actions au hover */}
      <div className="flex items-start justify-between gap-1 mb-1">
        <span className="text-ui font-semibold text-gray-900 leading-tight">
          {rdv.clients?.name || 'Client inconnu'}
        </span>
        <button
          onClick={(e) => onDelete(e, rdv.id)}
          className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 text-gray-300 hover:text-[rgb(var(--c-danger))] transition-opacity flex-shrink-0 mt-0.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Contact */}
      {(rdv.contact_name || rdv.conducted_by) && (
        <p className="text-ui-sm text-gray-400 mb-2 truncate">
          {[rdv.contact_name, rdv.conducted_by ? `· ${rdv.conducted_by}` : null].filter(Boolean).join(' ')}
        </p>
      )}

      {/* Footer : pills + ago */}
      <div className="flex items-center gap-1.5 flex-wrap">

        {/* Badge chaud / transfert */}
        {isTransfer ? (
          <span className="text-ui-sm font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-800">
            Transfert
          </span>
        ) : isHotFromPhoning ? (
          <span className="text-ui-sm font-semibold px-1.5 py-0.5 rounded-full bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]">
            Chaud
          </span>
        ) : null}

        {/* Badge date (prévus) */}
        {dateLbl && variant === 'prevu' && (
          <span className={`text-ui-sm font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 ${dateColor}`}>
            {dateLbl}
          </span>
        )}

        {/* Badge formations */}
        {rdv.formations_interet?.length > 0 && (
          <span className="text-ui-sm font-semibold px-1.5 py-0.5 rounded-full bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))] truncate max-w-[90px]" title={rdv.formations_interet.join(', ')}>
            {rdv.formations_interet[0]}{rdv.formations_interet.length > 1 ? ` +${rdv.formations_interet.length - 1}` : ''}
          </span>
        )}

        {/* Badge type RDV si pas de formations */}
        {!rdv.formations_interet?.length && rdv.rdv_type && (
          <span className="text-ui-sm font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
            {RDV_TYPE_LABELS[rdv.rdv_type] || rdv.rdv_type}
          </span>
        )}

        {/* Badge en retard */}
        {late && (
          <span className="text-ui-sm font-semibold px-1.5 py-0.5 rounded-full bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]">
             En retard
          </span>
        )}

        {/* Prochaine action visible au hover */}
        {rdv.next_action && (
          <span className="hidden group-hover:inline text-ui-sm px-1.5 py-0.5 rounded-full bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] truncate max-w-[120px]" title={rdv.next_action}>
             {rdv.next_action}
          </span>
        )}

        {/* Ago */}
        {ago && (
          <span className={`text-ui-sm ml-auto flex-shrink-0 ${late ? 'text-[rgb(var(--c-danger))] font-semibold' : 'text-gray-300'}`}>
            {ago}
          </span>
        )}
      </div>

      {/* Lieu si prévu */}
      {variant === 'prevu' && rdv.rdv_location && (
        <p className="text-ui-sm text-gray-400 mt-1.5">
          {LOCATION_LABELS[rdv.rdv_location] || rdv.rdv_location}
        </p>
      )}

      {/* Status annulé/reporté */}
      {variant === 'autre' && (
        <span className="text-ui-sm text-gray-400 mt-1 block">
          {rdv.status === 'annule' ? ' Annulé' : ' Reporté'}
        </span>
      )}
    </div>
  )
}

function EmptyCol({ text }) {
  return (
    <div className="text-center py-6 text-ui-sm text-gray-400">
      {text}
    </div>
  )
}

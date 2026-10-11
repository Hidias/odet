// ════════════════════════════════════════════════════════════════
// SuiviCommercial.jsx — Suivi commercial (remplace le kanban RDV)
// Une liste d'actions, de la plus urgente à la moins urgente :
//   comptes rendus à faire, RDV à planifier, devis à faire,
//   à recontacter, devis à relancer, rappels du jour, RDV à venir,
//   kit RDV.
// Les éléments anciens jamais traités partent dans le tri de départ.
// Aucun statut existant n'est renommé : seuls les libellés changent.
// ════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Phone, ExternalLink, Loader2, RefreshCw, ChevronDown, ChevronRight, ListChecks } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'
import { useRelanceIA } from '../../commercial/lib/useRelanceIA'
import RelancePreviewModal from '../../commercial/components/RelancePreviewModal'
import SuiteRdvModal from '../components/suivi/SuiteRdvModal'
import DevisSuiviBlock from '../components/suivi/DevisSuiviBlock'
import KitRdvPanel from '../components/suivi/KitRdvPanel'
import PrepRdvModal from '../components/suivi/PrepRdvModal'
import TriSuiviCommercial from '../components/suivi/TriSuiviCommercial'
import {
  PlanifierRdvModal, ConvertirRappelModal, DeplacerRappelModal, SansSuiteInline,
} from '../components/suivi/SuiviActionModals'
import {
  authorFromEmail, todayStr, fmtDate, fmtDateLong, fmtTime, diffDays, rdvRefDate,
  isOldRdv, needsReport, isQuoteInFollowup, isOldQuote, isQuoteSleeping, groupQuotesByClient,
  isCallbackForToday, isCallbackToDecide, callbackLateDays, RDV_STATUS_LABELS, SENDER_NAMES,
} from '../components/suivi/suiviUtils'

const PEOPLE = ['all', 'Hicham', 'Maxime']

function Tile({ label, value }) {
  return (
    <div className="bg-gray-50 rounded-lg px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  )
}

function Block({ title, count, children, action, defaultOpen = true, muted = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`bg-white border rounded-xl ${muted ? 'border-gray-100' : 'border-gray-200'}`}>
      <header className="flex items-center gap-2 px-4 py-3">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-left flex-1 min-w-0">
          {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <h3 className={`text-sm font-semibold ${muted ? 'text-gray-500' : 'text-gray-900'}`}>{title}</h3>
          {count !== undefined && (
            <span className={`text-xs px-2 py-0.5 rounded-md ${count > 0 && !muted ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>
              {count}
            </span>
          )}
        </button>
        {action}
      </header>
      {open && <div className="px-4 pb-3">{children}</div>}
    </section>
  )
}

function Empty({ text }) {
  return <p className="text-sm text-gray-500 py-2">{text}</p>
}

function Row({ children, actions }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-t border-gray-100 first:border-t-0 flex-wrap">
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex items-center gap-1.5 flex-wrap">{actions}</div>
    </div>
  )
}

function Btn({ onClick, children, primary = false }) {
  return (
    <button
      onClick={onClick}
      className={primary
        ? 'px-2.5 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700'
        : 'px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50'}
    >
      {children}
    </button>
  )
}

function PhoneLink({ phone }) {
  if (!phone) return null
  return (
    <a href={`tel:${String(phone).replace(/\s/g, '')}`}
      className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">
      <Phone className="w-3.5 h-3.5" /> {phone}
    </a>
  )
}

export default function SuiviCommercial() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const author = authorFromEmail(user?.email)
  const today = todayStr()

  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('suivi')
  const [person, setPerson] = useState('all')
  const [rdvs, setRdvs] = useState([])
  const [quotes, setQuotes] = useState([])
  const [allQuotesLight, setAllQuotesLight] = useState([])
  const [callbacks, setCallbacks] = useState([])

  const [suiteRdv, setSuiteRdv] = useState(null)
  const [planRdv, setPlanRdv] = useState(null)
  const [rappelRdv, setRappelRdv] = useState(null)
  const [moveCb, setMoveCb] = useState(null)
  const [prepRdv, setPrepRdv] = useState(null)

  const { relanceQuote, generating, sending, previewData, confirmSend, cancelPreview } = useRelanceIA()

  const load = useCallback(async () => {
    try {
      const [rdvRes, quoteRes, lightRes, cbRes] = await Promise.all([
        supabase
          .from('prospect_rdv')
          .select('*, clients (id, name, city, contact_phone, contact_name)')
          .neq('status', 'annule')
          .order('rdv_date', { ascending: true }),
        supabase
          .from('quotes')
          .select('id, reference, client_id, quote_date, created_at, status, object, notes, total_ht, total_ttc, relance_count, last_relance_date, followup_state, veille_until, next_followup_date, lost_reason, followup_notes, triaged_at, clients (name, contact_name, contact_phone, contact_email)')
          .in('status', ['sent', 'partial'])
          .order('quote_date', { ascending: true }),
        supabase
          .from('quotes')
          .select('id, client_id, quote_date, created_at')
          .limit(1000),
        supabase
          .from('prospect_calls')
          .select('id, client_id, called_by, callback_date, callback_time, callback_reason, contact_name, contact_mobile, notes, clients (id, name, city, contact_phone)')
          .eq('needs_callback', true)
          .order('callback_date', { ascending: true })
          .limit(1000),
      ])
      if (rdvRes.error) throw rdvRes.error
      if (quoteRes.error) throw quoteRes.error
      if (lightRes.error) throw lightRes.error
      if (cbRes.error) throw cbRes.error
      setRdvs(rdvRes.data || [])
      setQuotes(quoteRes.data || [])
      setAllQuotesLight(lightRes.data || [])
      setCallbacks(cbRes.data || [])
    } catch (err) {
      console.error(err)
      toast.error('Chargement du suivi impossible : ' + (err.message || 'erreur'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const closeModals = () => { setSuiteRdv(null); setPlanRdv(null); setRappelRdv(null); setMoveCb(null) }
  const afterAction = () => { closeModals(); load() }

  // ── Filtre personne ────────────────────────────────────────────
  const rdvsForPerson = useMemo(
    () => rdvs.filter(r => person === 'all' || !r.conducted_by || r.conducted_by === person),
    [rdvs, person]
  )
  const callbacksForPerson = useMemo(
    () => callbacks.filter(cb => person === 'all' || cb.called_by === person),
    [callbacks, person]
  )

  // ── Dérivés ────────────────────────────────────────────────────
  const data = useMemo(() => {
    const active = rdvsForPerson.map(r => (r.status === 'reporte' ? { ...r, status: 'prevu' } : r))

    const oldAPrendre = active.filter(r => r.status === 'a_prendre' && isOldRdv(r, today))
    const oldPasses = active.filter(r => r.status !== 'a_prendre' && isOldRdv(r, today) && needsReport(r, today))

    const reports = active
      .filter(r => needsReport(r, today) && !isOldRdv(r, today))
      .sort((a, b) => (rdvRefDate(a) || '').localeCompare(rdvRefDate(b) || ''))

    const aPlanifier = active
      .filter(r => r.status === 'a_prendre' && !isOldRdv(r, today))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

    const devisAFaire = active.filter(r => {
      if (r.outcome !== 'devis_a_faire') return false
      const since = r.rdv_date || rdvRefDate(r)
      return !allQuotesLight.some(q => q.client_id === r.client_id && (q.quote_date || String(q.created_at).slice(0, 10)) >= since)
    })

    const recontacter = active
      .filter(r => r.outcome === 'a_recontacter' && r.next_action_date && r.next_action_date <= today)
      .sort((a, b) => a.next_action_date.localeCompare(b.next_action_date))
    const recontacterPlusTard = active.filter(r => r.outcome === 'a_recontacter' && r.next_action_date && r.next_action_date > today)

    const aVenir = active
      .filter(r => r.status === 'prevu' && r.rdv_date && r.rdv_date >= today)
      .sort((a, b) => (a.rdv_date + (a.rdv_time || '')).localeCompare(b.rdv_date + (b.rdv_time || '')))

    const followQuotes = quotes.filter(q => isQuoteInFollowup(q))
    const oldQuotes = followQuotes.filter(q => isOldQuote(q, today))
    const currentQuotes = followQuotes.filter(q => !isOldQuote(q, today))
    const sleeping = currentQuotes.filter(q => isQuoteSleeping(q, today))
    const awake = currentQuotes.filter(q => !isQuoteSleeping(q, today))
    const awakeGroups = groupQuotesByClient(awake, today)

    const rappelsJour = callbacksForPerson.filter(cb => isCallbackForToday(cb, today))
    const rappelsADecider = callbacks.filter(cb => isCallbackToDecide(cb, today))

    return {
      oldAPrendre, oldPasses, reports, aPlanifier, devisAFaire, recontacter, recontacterPlusTard, aVenir,
      dueGroups: awakeGroups.filter(g => g.isDue),
      laterGroups: awakeGroups.filter(g => !g.isDue),
      sleepingGroups: groupQuotesByClient(sleeping, today),
      oldQuoteGroups: groupQuotesByClient(oldQuotes, today),
      oldQuotesCount: oldQuotes.length,
      rappelsJour,
      rappelsADecider,
    }
  }, [rdvsForPerson, quotes, allQuotesLight, callbacksForPerson, callbacks, today])

  const triCount = data.oldAPrendre.length + data.oldPasses.length + data.oldQuotesCount + data.rappelsADecider.length

  const pasEuLieu = async (rdv) => {
    if (!confirm('Ce RDV n\'a pas eu lieu : le passer en « Annulé » ?')) return
    const now = new Date().toISOString()
    const { error } = await supabase.from('prospect_rdv')
      .update({ status: 'annule', triaged_at: now, updated_at: now })
      .eq('id', rdv.id)
    if (error) { toast.error('Action impossible'); return }
    toast.success('RDV annulé')
    load()
  }

  const handleConfirmRelance = async (subject, body) => {
    const ok = await confirmSend(subject, body)
    if (ok !== false) load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  const relanceModal = previewData && (
    <RelancePreviewModal
      previewData={previewData}
      onConfirm={handleConfirmRelance}
      onCancel={cancelPreview}
      sending={!!sending}
    />
  )

  if (mode === 'tri') {
    return (
      <>
        <TriSuiviCommercial
          oldAPrendre={data.oldAPrendre}
          oldPasses={data.oldPasses}
          oldQuoteGroups={data.oldQuoteGroups}
          callbacks={callbacks}
          author={author}
          onBack={() => setMode('suivi')}
          onChanged={load}
          onRelanceMail={(q) => relanceQuote(q, { senderName: SENDER_NAMES[author] || 'Hicham Saidi' })}
          relanceBusyId={generating || sending}
        />
        {relanceModal}
      </>
    )
  }

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-base font-semibold text-gray-900">Suivi commercial</h2>
        <div className="flex gap-1.5">
          {PEOPLE.map(p => (
            <button key={p} onClick={() => setPerson(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                person === p ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}>
              {p === 'all' ? 'Tous' : p}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => { setLoading(true); load() }}
            className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50" aria-label="Actualiser" title="Actualiser">
            <RefreshCw className="w-4 h-4 text-gray-500" />
          </button>
          <button onClick={() => navigate('/prospection/nouveau')}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-700">
            <Plus className="w-3.5 h-3.5" /> Nouveau RDV
          </button>
        </div>
      </div>

      {/* Compteurs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Comptes rendus à faire" value={data.reports.length} />
        <Tile label="Devis à relancer" value={data.dueGroups.length} />
        <Tile label="Rappels du jour" value={data.rappelsJour.length} />
        <Tile label="RDV à venir" value={data.aVenir.length} />
      </div>

      {/* Tri de départ */}
      {triCount > 0 && (
        <div className="flex items-center gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <ListChecks className="w-5 h-5 text-amber-700 shrink-0" />
          <p className="text-sm text-amber-900 flex-1 min-w-[220px]">
            {triCount} ancien(s) élément(s) à trier : RDV jamais clôturés, devis de plus de 45 jours, rappels en retard de plus de 7 jours.
          </p>
          <button onClick={() => setMode('tri')}
            className="px-3 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700">
            Ouvrir le tri
          </button>
        </div>
      )}

      {/* 1. Comptes rendus */}
      <Block title="RDV faits, compte rendu à faire" count={data.reports.length}>
        {data.reports.length === 0 ? <Empty text="Aucun compte rendu en attente." /> : data.reports.map(r => {
          const late = diffDays(rdvRefDate(r), today)
          return (
            <Row key={r.id} actions={<>
              <Btn primary onClick={() => setSuiteRdv(r)}>Donner la suite</Btn>
              {r.status === 'prevu' && <Btn onClick={() => setPlanRdv(r)}>Reporter</Btn>}
              {r.status === 'prevu' && <Btn onClick={() => pasEuLieu(r)}>N'a pas eu lieu</Btn>}
              <button onClick={() => navigate(`/prospection/${r.id}`)} className="p-1.5 text-gray-400 hover:text-gray-700" aria-label="Ouvrir le RDV">
                <ExternalLink className="w-4 h-4" />
              </button>
            </>}>
              <p className="text-sm font-medium text-gray-900">{r.clients?.name || 'Client inconnu'}</p>
              <p className="text-xs text-gray-500">
                RDV du {fmtDate(rdvRefDate(r))}{r.conducted_by ? ` · ${r.conducted_by}` : ''}
                {late > 0 ? ` · depuis ${late} j` : ''}
                {r.formations_interet?.length ? ` · ${r.formations_interet.join(', ')}` : ''}
              </p>
            </Row>
          )
        })}
      </Block>

      {/* 2. À planifier */}
      <Block title="RDV à planifier" count={data.aPlanifier.length}>
        {data.aPlanifier.length === 0 ? <Empty text="Aucun RDV en attente de date." /> : data.aPlanifier.map(r => (
          <Row key={r.id} actions={<>
            <PhoneLink phone={r.contact_phone || r.clients?.contact_phone} />
            <Btn primary onClick={() => setPlanRdv(r)}>Planifier</Btn>
            <Btn onClick={() => setRappelRdv(r)}>C'est un rappel</Btn>
            <SansSuiteInline rdv={r} author={author} onDone={load} />
            <button onClick={() => navigate(`/prospection/${r.id}`)} className="p-1.5 text-gray-400 hover:text-gray-700" aria-label="Ouvrir le RDV">
              <ExternalLink className="w-4 h-4" />
            </button>
          </>}>
            <p className="text-sm font-medium text-gray-900">{r.clients?.name || 'Client inconnu'}</p>
            <p className="text-xs text-gray-500">
              Signalé le {fmtDate(rdvRefDate(r))}
              {r.contact_name ? ` · ${r.contact_name}` : ''}
              {(r.source || '').includes('marine') ? ' · via Marine' : ''}
              {r.formations_interet?.length ? ` · ${r.formations_interet.join(', ')}` : ''}
            </p>
            {(r.notes || r.notes_crm) && (
              <p className="text-xs text-gray-600 line-clamp-2 whitespace-pre-line">{r.notes || r.notes_crm}</p>
            )}
          </Row>
        ))}
      </Block>

      {/* 3. Devis à faire */}
      {data.devisAFaire.length > 0 && (
        <Block title="Devis à faire après RDV" count={data.devisAFaire.length}>
          {data.devisAFaire.map(r => (
            <Row key={r.id} actions={<>
              <Btn primary onClick={() => navigate(`/devis?client_id=${r.client_id}`)}>Créer le devis</Btn>
              <Btn onClick={() => setSuiteRdv(r)}>Changer la suite</Btn>
            </>}>
              <p className="text-sm font-medium text-gray-900">{r.clients?.name || 'Client inconnu'}</p>
              <p className="text-xs text-gray-500">
                RDV du {fmtDate(rdvRefDate(r))}{r.outcome_reason ? ` · ${r.outcome_reason}` : ''}
              </p>
            </Row>
          ))}
        </Block>
      )}

      {/* 4. À recontacter */}
      <Block
        title="À recontacter"
        count={data.recontacter.length}
        action={data.recontacterPlusTard.length > 0 && (
          <span className="text-xs text-gray-500">{data.recontacterPlusTard.length} plus tard</span>
        )}
      >
        {data.recontacter.length === 0 ? <Empty text="Personne à recontacter aujourd'hui." /> : data.recontacter.map(r => (
          <Row key={r.id} actions={<>
            <PhoneLink phone={r.contact_phone || r.clients?.contact_phone} />
            <Btn primary onClick={() => setSuiteRdv(r)}>Noter la suite</Btn>
          </>}>
            <p className="text-sm font-medium text-gray-900">{r.clients?.name || 'Client inconnu'}</p>
            <p className="text-xs text-gray-500">
              Prévu le {fmtDate(r.next_action_date)} · {r.next_action || 'Recontacter'}
              {r.contact_name ? ` · ${r.contact_name}` : ''}
            </p>
          </Row>
        ))}
      </Block>

      {/* 5. Devis */}
      <Block title="Devis à relancer" count={data.dueGroups.length}>
        <DevisSuiviBlock
          groups={data.dueGroups}
          author={author}
          onChanged={load}
          onRelanceMail={(q) => relanceQuote(q, { senderName: SENDER_NAMES[author] || 'Hicham Saidi' })}
          relanceBusyId={generating || sending}
          emptyText="Aucun devis à relancer aujourd'hui."
        />
      </Block>

      <Block title="Devis suivis, relance plus tard" count={data.laterGroups.length} defaultOpen={false} muted>
        <DevisSuiviBlock
          groups={data.laterGroups}
          author={author}
          onChanged={load}
          onRelanceMail={(q) => relanceQuote(q, { senderName: SENDER_NAMES[author] || 'Hicham Saidi' })}
          relanceBusyId={generating || sending}
          emptyText="Aucun devis en attente."
        />
      </Block>

      <Block title="Devis en veille" count={data.sleepingGroups.length} defaultOpen={false} muted>
        <DevisSuiviBlock
          groups={data.sleepingGroups}
          author={author}
          onChanged={load}
          onRelanceMail={(q) => relanceQuote(q, { senderName: SENDER_NAMES[author] || 'Hicham Saidi' })}
          relanceBusyId={generating || sending}
          emptyText="Aucun devis en veille."
        />
      </Block>

      {/* 6. Rappels du jour */}
      <Block
        title="Rappels du jour"
        count={data.rappelsJour.length}
        action={
          <button onClick={() => navigate('/prospection?tab=session')} className="text-xs text-primary-600 hover:underline">
            Lancer une session
          </button>
        }
      >
        {data.rappelsJour.length === 0 ? <Empty text="Aucun rappel prévu aujourd'hui." /> : data.rappelsJour.map(cb => {
          const late = callbackLateDays(cb, today)
          return (
            <Row key={cb.id} actions={<>
              <PhoneLink phone={cb.contact_mobile || cb.clients?.contact_phone} />
              <Btn onClick={() => setMoveCb(cb)}>Déplacer</Btn>
            </>}>
              <p className="text-sm font-medium text-gray-900">
                {cb.clients?.name || 'Client inconnu'}
                <span className="text-xs font-normal text-gray-500"> · {cb.called_by || '—'}</span>
              </p>
              <p className="text-xs text-gray-500">
                {late > 0 ? `En retard de ${late} j` : `Aujourd'hui${cb.callback_time ? ' à ' + fmtTime(cb.callback_time) : ''}`}
                {cb.contact_name ? ` · ${cb.contact_name}` : ''}
                {cb.callback_reason ? ` · ${cb.callback_reason}` : ''}
              </p>
            </Row>
          )
        })}
      </Block>

      {/* 7. RDV à venir */}
      <Block title="RDV à venir" count={data.aVenir.length}>
        {data.aVenir.length === 0 ? <Empty text="Aucun RDV planifié." /> : data.aVenir.map(r => (
          <Row key={r.id} actions={<>
            {r.prep_done_at
              ? <span className="text-xs px-2 py-0.5 rounded-md bg-green-50 text-green-700">préparé</span>
              : <span className="text-xs px-2 py-0.5 rounded-md bg-amber-50 text-amber-700">à préparer</span>}
            <Btn primary={!r.prep_done_at} onClick={() => setPrepRdv(r)}>{r.prep_done_at ? 'Voir la préparation' : 'Préparer'}</Btn>
            <Btn onClick={() => setPlanRdv(r)}>Déplacer</Btn>
            <button onClick={() => navigate(`/prospection/${r.id}`)} className="p-1.5 text-gray-400 hover:text-gray-700" aria-label="Ouvrir le RDV">
              <ExternalLink className="w-4 h-4" />
            </button>
          </>}>
            <p className="text-sm font-medium text-gray-900">{r.clients?.name || 'Client inconnu'}</p>
            <p className="text-xs text-gray-500">
              <span className="capitalize">{fmtDateLong(r.rdv_date)}</span>
              {r.rdv_time ? ` à ${fmtTime(r.rdv_time)}` : ''}
              {r.conducted_by ? ` · ${r.conducted_by}` : ''}
              {r.clients?.city ? ` · ${r.clients.city}` : ''}
              {` · ${RDV_STATUS_LABELS[r.status] || r.status}`}
            </p>
          </Row>
        ))}
      </Block>

      {/* 8. Kit RDV */}
      <Block title="Kit RDV" defaultOpen={false}>
        <KitRdvPanel author={author} />
      </Block>

      {/* Fenêtres */}
      {suiteRdv && (
        <SuiteRdvModal rdv={suiteRdv} clientName={suiteRdv.clients?.name} author={author}
          onClose={closeModals} onDone={afterAction} />
      )}
      {planRdv && (
        <PlanifierRdvModal rdv={planRdv} clientName={planRdv.clients?.name} author={author}
          onClose={closeModals} onDone={afterAction} />
      )}
      {rappelRdv && (
        <ConvertirRappelModal rdv={rappelRdv} clientName={rappelRdv.clients?.name} author={author}
          onClose={closeModals} onDone={afterAction} />
      )}
      {moveCb && (
        <DeplacerRappelModal callback={moveCb} clientName={moveCb.clients?.name} author={author}
          onClose={closeModals} onDone={afterAction} />
      )}
      {prepRdv && (
        <PrepRdvModal rdvId={prepRdv.id} clientName={prepRdv.clients?.name}
          onClose={() => setPrepRdv(null)} onDone={load} />
      )}
      {relanceModal}
    </div>
  )
}

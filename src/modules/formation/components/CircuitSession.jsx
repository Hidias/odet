import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { CalendarCheck, Send, Users, Loader2, X, Plus, Trash2, AlertTriangle, CheckCircle2, Clock, Check, Ban } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { currentUserEmail } from '../../../core/org/currentOrg'

// Circuit devis signé → session → participants → convention → convocations (0430, décisions de H du 21/10) :
//  - session préparée depuis un devis signé : une fenêtre de contrôle (0437, 22/10) fait vérifier dates, horaires,
//    lieu, formateur, places et contact avant d'ouvrir la saisie au client ; un devis de plusieurs sessions
//    (« 2 sessions de 2 heures ») les prépare toutes, une convention chacune ;
//  - participants : fiche complète ou ce qui manque, participants en plus du maximum à accepter ou refuser ;
//  - convention signée : convocations et documents à vérifier puis envoyer (rien ne part sans l'organisme).

const MOTS = { une: 1, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10 }
/** Nombre de sessions prévues par un texte de devis (« 2 sessions de 2 heures », « deux sessions »), sinon 1 */
export function sessionsDuDevis(textes) {
  for (const t of textes) {
    const m = /(\d+|une|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s+(sessions?|groupes?)\b/i.exec(String(t || ''))
    if (m) {
      const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : MOTS[m[1].toLowerCase()]
      if (n >= 1 && n <= 20) return n
    }
  }
  return 1
}

/** Ce qui manque à la fiche d'un stagiaire pour les documents et le Passeport de prévention */
export function manquesFiche(t = {}) {
  const m = []
  if (!t.gender) m.push('genre')
  if (!t.birth_date) m.push('date de naissance')
  if (!t.email && !t.email_refused) m.push('e-mail')
  if (!t.ssn_present && !t.refused_ssn) m.push('n° de sécurité sociale')
  if (!t.job_title) m.push('poste')
  return m
}

const hhmm = (t) => String(t || '').slice(0, 5)
const SST = /sauveteur secouriste|\bsst\b|\bmac sst\b/i

export default function CircuitSession({ session, peutModifier, onChange, onEnvoyer }) {
  const [confirmer, setConfirmer] = useState(false)
  const [attente, setAttente] = useState([])
  const [occupe, setOccupe] = useState(null)

  const chargerAttente = async () => {
    if (!session?.id || !session.quote_id) return
    const { data } = await supabase.from('session_places_attente').select('id, trainee_id, statut, trainees(first_name, last_name)').eq('session_id', session.id).order('created_at')
    setAttente(data || [])
  }
  useEffect(() => { chargerAttente() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.participants_saisis_le])

  if (!session) return null
  const stagiaires = session.session_trainees || []
  const aConvoquer = stagiaires.filter((st) => !st.convocation_sent_at && !st.absent).length
  const incomplets = session.quote_id ? stagiaires.map((st) => ({ st, m: manquesFiche(st.trainees || {}) })).filter((x) => x.m.length) : []
  const enAttente = attente.filter((a) => a.statut === 'attente')

  const decider = async (a, accepte) => {
    setOccupe(a.id)
    try {
      const { error } = await supabase.rpc('participant_attente_decider', { p_session: session.id, p_trainee: a.trainee_id, p_accepte: accepte })
      if (error) throw error
      toast.success(accepte ? 'Participant accepté et inscrit' : 'Place refusée : le client le voit dans son espace')
      await chargerAttente()
      await onChange?.()
    } catch (e) { toast.error(e.message || 'Décision impossible') } finally { setOccupe(null) }
  }

  return (
    <div className="space-y-2 mb-4">
      {session.validation_requise && (
        <div className="rounded-ui border border-[rgb(var(--c-warning)/0.4)] bg-[rgb(var(--c-warning-bg))] p-3 flex items-start gap-3 flex-wrap">
          <CalendarCheck className="w-5 h-5 text-[rgb(var(--c-warning))] shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-[14rem] text-ui text-gray-800">
            <p className="font-medium">Session préparée depuis le devis signé</p>
            <p className="text-ui-sm text-gray-600">Contrôlez les dates, les horaires, le lieu, le formateur et les places : la convention les reprend. Le client pourra ensuite saisir ses participants.</p>
          </div>
          {peutModifier && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setConfirmer(true)}>
              <CalendarCheck className="w-4 h-4" aria-hidden="true" />Contrôler et confirmer
            </button>
          )}
        </div>
      )}
      {session.participants_saisis_le && !session.validation_requise && (
        <p className="text-ui-sm text-gray-600 flex items-center gap-1.5"><Users className="w-4 h-4 text-gray-400" aria-hidden="true" />
          Participants saisis par le client le {new Date(session.participants_saisis_le).toLocaleDateString('fr-FR')} à {new Date(session.participants_saisis_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.</p>
      )}
      {enAttente.length > 0 && (
        <div className="rounded-ui border border-accent-500/30 bg-accent-500/5 p-3 space-y-2">
          <p className="text-ui font-medium text-gray-800 flex items-center gap-1.5"><Clock className="w-4 h-4 text-accent-600" aria-hidden="true" />
            {enAttente.length} participant{enAttente.length > 1 ? 's' : ''} en plus du maximum ({session.max_participants || 10}) : votre accord est attendu</p>
          <ul className="space-y-1.5">
            {enAttente.map((a) => (
              <li key={a.id} className="flex items-center gap-2 flex-wrap text-ui">
                <span className="flex-1 min-w-[10rem]">{(a.trainees?.last_name || '').toUpperCase()} {a.trainees?.first_name}</span>
                {peutModifier && <>
                  <button type="button" className="btn btn-primary btn-sm" disabled={occupe === a.id} onClick={() => decider(a, true)}><Check className="w-4 h-4" aria-hidden="true" />Accepter</button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={occupe === a.id} onClick={() => decider(a, false)}><Ban className="w-4 h-4" aria-hidden="true" />Refuser</button>
                </>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {incomplets.length > 0 && (
        <details className="rounded-ui border border-gray-200 bg-white p-3">
          <summary className="text-ui text-gray-800 cursor-pointer flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-[rgb(var(--c-warning))]" aria-hidden="true" />
            {stagiaires.length - incomplets.length} fiche{stagiaires.length - incomplets.length > 1 ? 's' : ''} complète{stagiaires.length - incomplets.length > 1 ? 's' : ''} sur {stagiaires.length} : le reste sera complété par les stagiaires dans leur portail
          </summary>
          <ul className="mt-2 space-y-1">
            {incomplets.map(({ st, m }) => (
              <li key={st.trainee_id} className="text-ui-sm text-gray-700"><span className="font-medium">{(st.trainees?.last_name || '').toUpperCase()} {st.trainees?.first_name}</span> : {m.join(', ')}</li>
            ))}
          </ul>
        </details>
      )}
      {session.quote_id && stagiaires.length > 0 && incomplets.length === 0 && (
        <p className="text-ui-sm text-[rgb(var(--c-success))] flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" aria-hidden="true" />Fiches des {stagiaires.length} participants complètes.</p>
      )}
      {session.quote_id && session.convention_signed && aConvoquer > 0 && (
        <div className="rounded-ui border border-accent-500/30 bg-accent-500/5 p-3 flex items-start gap-3 flex-wrap">
          <Send className="w-5 h-5 text-accent-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-[14rem] text-ui text-gray-800">
            <p className="font-medium">Convention signée : convocations à valider</p>
            <p className="text-ui-sm text-gray-600">{aConvoquer} participant{aConvoquer > 1 ? 's' : ''} sans convocation. Vérifiez les convocations et les documents habituels, puis envoyez-les.</p>
          </div>
          {peutModifier && <button type="button" className="btn btn-primary btn-sm" onClick={onEnvoyer}><Send className="w-4 h-4" aria-hidden="true" />Vérifier et envoyer</button>}
        </div>
      )}
      {confirmer && <FenetreConfirmation session={session} onFermer={() => setConfirmer(false)} onFait={async () => { setConfirmer(false); await onChange?.() }} />}
    </div>
  )
}

const champsDe = (s, base = {}) => ({
  start_date: base.start_date ?? s.start_date ?? '',
  end_date: base.end_date ?? s.end_date ?? '',
  start_time: base.start_time ?? hhmm(s.start_time),
  end_time: base.end_time ?? hhmm(s.end_time),
})

/** Valeurs d'une session à confirmer : erreurs bloquantes */
export function erreursConfirmation(v) {
  const e = []
  if (!v.start_date) e.push('date')
  if (v.end_date && v.start_date && v.end_date < v.start_date) e.push('fin avant le début')
  if (!v.start_time || !v.end_time) e.push('horaires')
  else if (v.end_time <= v.start_time) e.push('heure de fin avant le début')
  return e
}

function FenetreConfirmation({ session, onFermer, onFait }) {
  const client = session.clients || {}
  const contacts = client.contacts || []
  const [formateurs, setFormateurs] = useState([])
  const [nbDevis, setNbDevis] = useState(1)
  const [nbExistantes, setNbExistantes] = useState(1)
  const [lieuType, setLieuType] = useState(session.location_name && session.location_name !== client.name ? 'autre' : 'client')
  const [f, setF] = useState(() => ({
    ...champsDe(session),
    location_name: session.location_name || client.name || '',
    location_address: session.location_address || client.address || '',
    location_postal_code: session.location_postal_code || client.postal_code || '',
    location_city: session.location_city || client.city || '',
    trainer_id: session.trainer_id || session.courses?.default_trainer_id || '',
    max_participants: session.max_participants || 10,
    places_supplementaires: session.places_supplementaires || 0,
    contact_id: session.contact_id || contacts.find((c) => c.is_primary)?.id || contacts[0]?.id || '',
    total_price: session.total_price ?? '',
  }))
  const [autres, setAutres] = useState([])
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')
  const sst = SST.test(`${session.courses?.title || ''} ${session.courses?.code || ''}`)

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onFermer() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onFermer])

  useEffect(() => {
    let actif = true
    ;(async () => {
      const [{ data: tr }, { data: q }, { data: items }, { count }] = await Promise.all([
        supabase.from('trainers').select('id, first_name, last_name, email').order('last_name'),
        supabase.from('quotes').select('object').eq('id', session.quote_id).maybeSingle(),
        supabase.from('quote_items').select('description_title, description_detail, course_id').eq('quote_id', session.quote_id),
        supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('quote_id', session.quote_id),
      ])
      if (!actif) return
      setFormateurs(tr || [])
      // Formateur par défaut : celui de la formation, sinon l'utilisateur connecté s'il est formateur
      setF((v) => (v.trainer_id ? v : { ...v, trainer_id: (tr || []).find((t) => t.email && t.email.toLowerCase() === currentUserEmail().toLowerCase())?.id || '' }))
      const lignes = (items || []).filter((i) => !i.course_id || i.course_id === session.course_id)
      const n = sessionsDuDevis([...lignes.flatMap((i) => [i.description_title, i.description_detail]), q?.object])
      const existantes = count || 1
      setNbDevis(n); setNbExistantes(existantes)
      const manque = Math.max(0, n - existantes)
      if (manque > 0) {
        // Prix réparti entre les sessions du devis
        setF((v) => ({ ...v, total_price: v.total_price ? Math.round((Number(v.total_price) / n) * 100) / 100 : v.total_price }))
        setAutres(Array.from({ length: manque }, () => ({ start_date: '', end_date: '', start_time: hhmm(session.start_time), end_time: hhmm(session.end_time) })))
      }
    })()
    return () => { actif = false }
  }, [session.quote_id, session.course_id, session.start_time, session.end_time])

  const maj = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const lieuClient = () => setF((x) => ({ ...x, location_name: client.name || '', location_address: client.address || '', location_postal_code: client.postal_code || '', location_city: client.city || '' }))
  const e1 = erreursConfirmation(f)
  const manquants = [
    ...e1,
    ...(!f.trainer_id ? ['formateur'] : []),
    ...(!(f.location_name || f.location_address || f.location_city) ? ['lieu'] : []),
    ...(!(Number(f.max_participants) >= 1) ? ['places'] : []),
  ]
  const autresErreurs = autres.map((a) => (a.start_date ? erreursConfirmation(a) : []))
  const pret = manquants.length === 0 && autresErreurs.every((x) => x.length === 0) && !envoi
  const duree = useMemo(() => {
    if (!f.start_time || !f.end_time || f.end_time <= f.start_time) return null
    const [h1, m1] = f.start_time.split(':').map(Number); const [h2, m2] = f.end_time.split(':').map(Number)
    const min = h2 * 60 + m2 - (h1 * 60 + m1)
    return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ''}, ${min <= 270 ? 'demi-journée' : 'journée'}`
  }, [f.start_time, f.end_time])

  // Horaires d'une journée qui ne collent pas à la durée de la formation (22/10 : 9 h–17 h préparé pour une
  // formation de 2 heures) : alerte et fin proposée
  const ecartDuree = useMemo(() => {
    const h = Number(session.courses?.duration_hours)
    if (!h || !f.start_time || !f.end_time || (f.end_date && f.end_date !== f.start_date)) return null
    const [h1, m1] = f.start_time.split(':').map(Number); const [h2, m2] = f.end_time.split(':').map(Number)
    const min = h2 * 60 + m2 - (h1 * 60 + m1)
    const attendu = Math.round(h * 60)
    if (attendu > 8 * 60 || Math.abs(min - attendu) <= 15) return null
    // Une journée de 7 h garde sa pause de midi (9 h–17 h) : pas d'alerte
    if (attendu >= 6 * 60 && min - attendu <= 90 && min >= attendu) return null
    const fin = h1 * 60 + m1 + attendu
    return fin < 24 * 60 ? `${String(Math.floor(fin / 60)).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}` : null
  }, [session.courses?.duration_hours, f.start_time, f.end_time, f.start_date, f.end_date])

  const donnees = (base) => ({
    start_date: base.start_date, end_date: base.end_date || base.start_date, start_time: base.start_time, end_time: base.end_time,
    location_name: f.location_name, location_address: f.location_address, location_postal_code: f.location_postal_code, location_city: f.location_city,
    trainer_id: f.trainer_id, max_participants: Number(f.max_participants), places_supplementaires: sst ? 0 : Number(f.places_supplementaires || 0),
    contact_id: f.contact_id || null, total_price: f.total_price === '' ? null : Number(f.total_price),
  })

  const valider = async () => {
    setEnvoi(true); setErreur('')
    try {
      const { error } = await supabase.rpc('session_confirmer', { p_session: session.id, p_data: donnees(f) })
      if (error) throw error
      let n = 0
      for (const a of autres.filter((x) => x.start_date)) {
        const { error: e2 } = await supabase.rpc('session_ajouter_depuis_devis', { p_session: session.id, p_data: donnees(a) })
        if (e2) throw e2
        n++
      }
      toast.success(n ? `Session confirmée et ${n} session${n > 1 ? 's' : ''} du devis préparée${n > 1 ? 's' : ''} : le client peut saisir ses participants.` : 'Session confirmée : le client peut saisir ses participants.')
      await onFait()
    } catch (e) {
      setErreur(e.message || 'Confirmation impossible')
    } finally { setEnvoi(false) }
  }

  const ligneDates = (v, set, prefixe) => (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <label className="text-ui-sm"><span className="text-gray-600">Date *</span><input type="date" className="input w-full mt-1" value={v.start_date} onChange={(e) => set('start_date', e.target.value)} aria-label={`${prefixe} : date`} /></label>
      <label className="text-ui-sm"><span className="text-gray-600">Fin (si plusieurs jours)</span><input type="date" className="input w-full mt-1" value={v.end_date && v.end_date !== v.start_date ? v.end_date : ''} min={v.start_date} onChange={(e) => set('end_date', e.target.value)} aria-label={`${prefixe} : fin`} /></label>
      <label className="text-ui-sm"><span className="text-gray-600">Début *</span><input type="time" className="input w-full mt-1" value={v.start_time} onChange={(e) => set('start_time', e.target.value)} aria-label={`${prefixe} : heure de début`} /></label>
      <label className="text-ui-sm"><span className="text-gray-600">Fin *</span><input type="time" className="input w-full mt-1" value={v.end_time} onChange={(e) => set('end_time', e.target.value)} aria-label={`${prefixe} : heure de fin`} /></label>
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFermer}>
      <div role="dialog" aria-modal="true" aria-labelledby="confirmer-titre" className="w-full sm:max-w-3xl bg-white rounded-t-ui-lg sm:rounded-ui-lg max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="confirmer-titre" className="font-display text-lg font-semibold text-gray-900">Contrôler et confirmer la session</h2>
            <p className="text-ui-sm text-gray-500">{session.courses?.title} · {client.name}{session.reference ? ` · ${session.reference}` : ''}</p>
          </div>
          <button type="button" onClick={onFermer} aria-label="Fermer" className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-5">
          <section>
            <h3 className="text-ui font-semibold text-gray-900 mb-2">{nbDevis > 1 ? `Session 1 sur ${nbDevis}` : 'Dates et horaires'}</h3>
            {ligneDates(f, maj, 'Session 1')}
            {duree && <p className="text-ui-sm text-gray-500 mt-1">{duree}{session.courses?.duration_hours ? ` (formation prévue : ${Number(session.courses.duration_hours)} h)` : ''}</p>}
            {ecartDuree && (
              <p className="text-ui-sm text-[rgb(var(--c-warning))] mt-1 flex items-center gap-2 flex-wrap">
                <AlertTriangle className="w-4 h-4" aria-hidden="true" />Les horaires ne correspondent pas à la durée de la formation.
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => maj('end_time', ecartDuree)}>Finir à {ecartDuree.replace(':', 'h')}</button>
              </p>
            )}
          </section>

          {nbDevis > 1 && (
            <section className="rounded-ui border border-primary-200 bg-primary-50/40 p-3 space-y-3">
              <p className="text-ui text-gray-800">Le devis prévoit <strong>{nbDevis} sessions</strong>{nbExistantes > 1 ? ` (${nbExistantes} déjà préparées)` : ''}. Chacune a sa convention et sa liste de participants ; lieu, formateur et places sont les mêmes.</p>
              {autres.map((a, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-ui-sm font-medium text-gray-800">Session {nbExistantes + i + 1} sur {nbDevis}</p>
                    <button type="button" className="p-1 text-gray-400 hover:text-[rgb(var(--c-danger))]" aria-label={`Ne pas préparer la session ${nbExistantes + i + 1}`} onClick={() => setAutres((l) => l.filter((_, k) => k !== i))}><Trash2 className="w-4 h-4" /></button>
                  </div>
                  {ligneDates(a, (k, v) => setAutres((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x))), `Session ${nbExistantes + i + 1}`)}
                  {!a.start_date && <p className="text-ui-sm text-gray-500">Sans date, elle n'est pas créée : vous pourrez la préparer plus tard depuis le devis.</p>}
                  {autresErreurs[i]?.length > 0 && <p className="text-ui-sm text-[rgb(var(--c-warning))]">À corriger : {autresErreurs[i].join(', ')}</p>}
                </div>
              ))}
              {nbExistantes + autres.length < nbDevis && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAutres((l) => [...l, { start_date: '', end_date: '', start_time: f.start_time, end_time: f.end_time }])}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter une session</button>
              )}
            </section>
          )}

          <section>
            <h3 className="text-ui font-semibold text-gray-900 mb-2">Lieu</h3>
            <div className="flex gap-2 mb-2">
              <button type="button" className={`btn btn-sm ${lieuType === 'client' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setLieuType('client'); lieuClient() }}>Chez le client</button>
              <button type="button" className={`btn btn-sm ${lieuType === 'autre' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setLieuType('autre')}>Autre lieu</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-ui-sm"><span className="text-gray-600">Nom du lieu</span><input className="input w-full mt-1" value={f.location_name} onChange={(e) => maj('location_name', e.target.value)} /></label>
              <label className="text-ui-sm"><span className="text-gray-600">Adresse</span><input className="input w-full mt-1" value={f.location_address} onChange={(e) => maj('location_address', e.target.value)} /></label>
              <label className="text-ui-sm"><span className="text-gray-600">Code postal</span><input className="input w-full mt-1" value={f.location_postal_code} onChange={(e) => maj('location_postal_code', e.target.value)} inputMode="numeric" /></label>
              <label className="text-ui-sm"><span className="text-gray-600">Ville</span><input className="input w-full mt-1" value={f.location_city} onChange={(e) => maj('location_city', e.target.value)} /></label>
            </div>
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-ui-sm"><span className="text-gray-600 font-semibold">Formateur *</span>
              <select className="input w-full mt-1" value={f.trainer_id} onChange={(e) => maj('trainer_id', e.target.value)}>
                <option value="">Choisir…</option>
                {formateurs.map((t) => <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>)}
              </select></label>
            <label className="text-ui-sm"><span className="text-gray-600 font-semibold">Contact du client</span>
              <select className="input w-full mt-1" value={f.contact_id} onChange={(e) => maj('contact_id', e.target.value)}>
                <option value="">Contact principal de la fiche</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name || [c.first_name, c.last_name].filter(Boolean).join(' ')}{c.role ? `, ${c.role}` : ''}</option>)}
              </select></label>
            <label className="text-ui-sm"><span className="text-gray-600 font-semibold">Places</span>
              <input type="number" min={1} max={200} className="input w-full mt-1" value={f.max_participants} onChange={(e) => maj('max_participants', e.target.value)} /></label>
            <label className="text-ui-sm"><span className="text-gray-600 font-semibold">Places en plus, sur votre accord</span>
              <input type="number" min={0} max={20} className="input w-full mt-1" value={sst ? 0 : f.places_supplementaires} disabled={sst} onChange={(e) => maj('places_supplementaires', e.target.value)} />
              <span className="block text-gray-500 mt-1">{sst ? 'SST : 10 participants au plus par formateur (référentiel INRS), pas de dépassement.' : 'Le client peut en saisir autant en plus ; vous acceptez ou refusez chacun.'}</span></label>
            <label className="text-ui-sm"><span className="text-gray-600 font-semibold">Prix de la session (HT)</span>
              <input type="number" min={0} step="0.01" className="input w-full mt-1" value={f.total_price} onChange={(e) => maj('total_price', e.target.value)} />
              {nbDevis > 1 && <span className="block text-gray-500 mt-1">Réparti entre les {nbDevis} sessions du devis.</span>}</label>
          </section>

          <section className="rounded-ui bg-gray-50 border border-gray-200 p-3 text-ui-sm text-gray-700">
            <p className="font-medium text-gray-900 mb-1">La convention indiquera</p>
            <p>{f.start_date ? new Date(`${f.start_date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'date à indiquer'}{f.end_date && f.end_date !== f.start_date ? ` au ${new Date(`${f.end_date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}, de {f.start_time ? f.start_time.replace(':', 'h') : '…'} à {f.end_time ? f.end_time.replace(':', 'h') : '…'}</p>
            <p>{[f.location_name, f.location_address, [f.location_postal_code, f.location_city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'lieu à indiquer'}</p>
            <p>Formateur : {(() => { const t = formateurs.find((x) => x.id === f.trainer_id); return t ? `${t.first_name} ${t.last_name}` : 'à choisir' })()} · {f.max_participants || '…'} participants au plus{!sst && Number(f.places_supplementaires) ? ` (+${f.places_supplementaires} sur accord)` : ''}</p>
          </section>

          {manquants.length > 0 && <p className="text-ui-sm text-[rgb(var(--c-warning))]">À compléter : {manquants.join(', ')}.</p>}
          {erreur && <p role="alert" className="text-ui-sm text-[rgb(var(--c-danger))]">{erreur}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-secondary" onClick={onFermer}>Annuler</button>
            <button type="button" className="btn btn-primary" onClick={valider} disabled={!pret}>
              {envoi ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CalendarCheck className="w-4 h-4" aria-hidden="true" />}
              Confirmer{autres.filter((a) => a.start_date).length ? ` les ${1 + autres.filter((a) => a.start_date).length} sessions` : ' la session'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

import { useEffect, useMemo, useState } from 'react'
import { fichierDeLInstance } from '../../../core/fichiersInstance'
import toast from 'react-hot-toast'
import {
  Home, GraduationCap, Users, MessageSquare, MoreHorizontal, Calendar, MapPin, FileText, FileSignature, ClipboardList,
  Award, BadgeCheck, Download, Loader2, LogOut, AlertCircle, BookOpen, Receipt, Megaphone, ExternalLink, Send, Plus, Trash2, ShieldCheck,
} from 'lucide-react'
import { format, parseISO, isAfter, startOfToday } from 'date-fns'
import { fr as frLocale } from 'date-fns/locale'
import { supabase } from '../../../core/supabase'
import { callApi } from '../../../core/api'
import { useAuthStore } from '../../../core/store'
import PublicLayout from '../../../app/PublicLayout'
import { prepareOrgForPDF } from '../../../core/org/orgUtils'
import { setOrganization, generatePDF, generateAllPDF } from '../../formation/pdf/pdfGenerator'
import { pdfOrgFrom } from '../../../core/pdf/pdfOrg'
import RegistreVue from '../../registre/components/RegistreVue'
import { ouvrirFichier, readableUrl } from '../../../core/storageUtils'

// Espace entreprise avec compte (lot 2, 0046) : accueil (choses à faire, échéances), formations et documents,
// salariés et validités, demandes (inscription inter, formation intra, remplacement, message), catalogue, factures
// (si l'organisme l'autorise), actualités. Toutes les données passent par les fonctions ent_* de la base (le compte
// n'a accès à aucune table). Téléphone d'abord, barre d'onglets en bas, aux couleurs de l'organisme.

const fmtDate = (d) => (d ? format(parseISO(String(d).slice(0, 10)), 'd MMMM yyyy', { locale: frLocale }) : '')
const euros = (n) => (n == null ? '' : `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`)
const ETATS = { depasse: ['bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]', 'Dépassée'], a_prevoir: ['bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]', 'À prévoir'], a_jour: ['bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]', 'À jour'] }
const DEMANDES = { inscription_inter: 'Inscription à une session inter', demande_intra: 'Formation dans vos locaux', remplacement: 'Remplacement d\'un salarié', message: 'Message' }
const STATUTS = { nouvelle: 'Envoyée', en_cours: 'En cours de traitement', traitee: 'Traitée', refusee: 'Non retenue' }

function saveBase64(base64, filename) {
  const bytes = atob(base64)
  const buf = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Pastille({ status }) {
  const e = ETATS[status] || ETATS.a_jour
  return <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${e[0]}`}>{e[1]}</span>
}

export default function EspaceEntreprise() {
  const logout = useAuthStore((s) => s.logout)
  const [onglet, setOnglet] = useState('accueil')
  const [accueil, setAccueil] = useState(null)
  const [erreur, setErreur] = useState(null)
  // Registre de sécurité (fonction 11) : proposé si le module est actif ; dossier de dépôt du compte
  const [mods, setMods] = useState({ registre: false })
  useEffect(() => { supabase.rpc('ent_modules').then(({ data }) => { if (data) setMods(data) }) }, [])

  const charger = async () => {
    const { data, error } = await supabase.rpc('ent_accueil')
    if (error) { setErreur(error.message?.includes('désactivé') || error.code === '42501' ? 'Votre accès à l\'espace entreprise n\'est pas actif. Contactez votre organisme de formation.' : 'Espace momentanément indisponible, réessayez dans quelques instants.'); return }
    setAccueil(data)
  }
  useEffect(() => { charger() }, [])

  const ONGLETS = [
    ['accueil', 'Accueil', Home], ['formations', 'Formations', GraduationCap],
    mods.registre ? ['registre', 'Registre', ShieldCheck] : ['salaries', 'Salariés', Users],
    ['demandes', 'Demandes', MessageSquare], ['plus', 'Plus', MoreHorizontal],
  ]

  if (erreur) {
    return (
      <PublicLayout title="Espace entreprise">
        <div className="max-w-md mx-auto bg-white rounded-ui-lg border border-gray-200 p-6 mt-6 space-y-4">
          <p className="text-sm text-gray-700 flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 text-[rgb(var(--c-danger))]" />{erreur}</p>
          <button type="button" className="btn btn-secondary w-full justify-center" onClick={logout}><LogOut className="w-4 h-4" /> Se déconnecter</button>
        </div>
      </PublicLayout>
    )
  }
  if (!accueil) return <PublicLayout title="Espace entreprise"><div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div></PublicLayout>

  return (
    <PublicLayout title="Espace entreprise">
      <div className="pb-20">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-gray-900 truncate">{accueil.client?.name}</h1>
            <p className="text-sm text-gray-500 truncate">{accueil.compte?.contact?.name ? `${accueil.compte.contact.name}, ` : ''}vos formations avec {accueil.org?.name}</p>
          </div>
          <button type="button" onClick={logout} className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1.5 shrink-0"><LogOut className="w-4 h-4" />Quitter</button>
        </div>
        {onglet === 'accueil' && <Accueil a={accueil} aller={setOnglet} />}
        {onglet === 'formations' && <Formations />}
        {onglet === 'salaries' && <Salaries />}
        {onglet === 'registre' && (
          <RegistreVue mode="entreprise" clientId={mods.client_id} companyId={mods.company_id}
            charger={async (site) => { const { data, error } = await supabase.rpc('ent_registre', { p_site: site }); if (error) throw error; return data }}
            orgPourPdf={async () => { const { data } = await supabase.rpc('ent_org'); return pdfOrgFrom(data || {}) }} />
        )}
        {onglet === 'demandes' && <Demandes compte={accueil.compte} onChange={charger} />}
        {onglet === 'plus' && <Plus_ compte={accueil.compte} org={accueil.org} salaries={mods.registre} />}
      </div>
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 z-40" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="Espace entreprise">
        <div className="max-w-3xl mx-auto grid grid-cols-5">
          {ONGLETS.map(([k, l, Icon]) => (
            <button key={k} type="button" onClick={() => { setOnglet(k); window.scrollTo(0, 0) }} aria-current={onglet === k ? 'page' : undefined}
              className={`flex flex-col items-center gap-0.5 py-2 text-xs ${onglet === k ? 'text-primary-700 font-semibold' : 'text-gray-500'}`}>
              <Icon className="w-5 h-5" />{l}
            </button>
          ))}
        </div>
      </nav>
    </PublicLayout>
  )
}

function Carte({ children, className = '' }) {
  return <div className={`bg-white rounded-ui-lg border border-gray-200 p-4 ${className}`}>{children}</div>
}

function Accueil({ a, aller }) {
  const e = a.echeances || {}
  const afaire = []
  if (e.depasse) afaire.push({ t: `${e.depasse} échéance${e.depasse > 1 ? 's' : ''} dépassée${e.depasse > 1 ? 's' : ''}`, o: 'salaries', ton: 'danger' })
  if (e.a_prevoir) afaire.push({ t: `${e.a_prevoir} recyclage${e.a_prevoir > 1 ? 's' : ''} ou vérification${e.a_prevoir > 1 ? 's' : ''} à prévoir`, o: 'salaries', ton: 'warning' })
  if (a.demandes_en_cours) afaire.push({ t: `${a.demandes_en_cours} demande${a.demandes_en_cours > 1 ? 's' : ''} en cours`, o: 'demandes', ton: 'info' })
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => aller('formations')} className="bg-white rounded-ui-lg border border-gray-200 p-4 text-left">
          <div className="text-2xl font-display font-semibold text-gray-900">{a.a_venir || 0}</div>
          <div className="text-sm text-gray-500">formation{a.a_venir > 1 ? 's' : ''} à venir</div>
        </button>
        <button type="button" onClick={() => aller('salaries')} className="bg-white rounded-ui-lg border border-gray-200 p-4 text-left">
          <div className={`text-2xl font-display font-semibold ${(e.depasse || 0) > 0 ? 'text-[rgb(var(--c-danger))]' : 'text-gray-900'}`}>{(e.depasse || 0) + (e.a_prevoir || 0)}</div>
          <div className="text-sm text-gray-500">échéance{(e.depasse || 0) + (e.a_prevoir || 0) > 1 ? 's' : ''} à traiter</div>
        </button>
      </div>
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">À faire</h2>
        {afaire.length === 0 ? <Carte><p className="text-sm text-gray-500">Rien à traiter pour le moment.</p></Carte> : (
          <div className="space-y-2">
            {afaire.map((x, i) => (
              <button key={i} type="button" onClick={() => aller(x.o)} className="w-full bg-white rounded-ui-lg border border-gray-200 p-3 text-left text-sm text-gray-800 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${x.ton === 'danger' ? 'bg-[rgb(var(--c-danger))]' : x.ton === 'warning' ? 'bg-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-info))]'}`} />{x.t}
              </button>
            ))}
          </div>
        )}
      </section>
      {(a.actus || []).length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Actualités</h2>
          <Carte className="space-y-1.5">
            {a.actus.map((n) => <div key={n.id} className="text-sm text-gray-800">{n.title} <span className="text-gray-400">· {fmtDate(n.published_at)}</span></div>)}
          </Carte>
        </section>
      )}
      <Carte className="text-sm text-gray-600 space-y-0.5">
        <div className="font-medium text-gray-900">{a.org?.name}</div>
        {a.org?.phone && <div><a href={`tel:${a.org.phone}`} className="text-primary-700">{a.org.phone}</a></div>}
        {a.org?.email && <div><a href={`mailto:${a.org.email}`} className="text-primary-700">{a.org.email}</a></div>}
      </Carte>
    </div>
  )
}

function Formations() {
  const [data, setData] = useState(null)
  const [orgPret, setOrgPret] = useState(false)
  const [busy, setBusy] = useState(null)
  const today = startOfToday()

  useEffect(() => {
    (async () => {
      const [{ data: d, error }, { data: org }] = await Promise.all([supabase.rpc('ent_sessions'), supabase.rpc('ent_org')])
      if (error) { toast.error('Formations indisponibles'); setData({ sessions: [] }); return }
      setData(d)
      if (org) { setOrganization(await prepareOrgForPDF(org)); setOrgPret(true) }
    })()
  }, [])

  const { upcoming, past } = useMemo(() => {
    const up = [], pa = []
    ;(data?.sessions || []).forEach((s) => { (s.end_date && !isAfter(today, parseISO(s.end_date)) ? up : pa).push(s) })
    up.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
    return { upcoming: up, past: pa }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const traineesOf = (s) => (s.session_trainees || []).map((st) => ({ ...st.trainees, result: st.result || null, access_code: st.access_code }))

  const download = async (s, kind) => {
    if (!orgPret) return
    setBusy(`${s.id}:${kind}`)
    try {
      const session = { ...s, clients: data.client, courses: s.courses || {}, trainers: s.trainers || null }
      const trainees = traineesOf(s)
      const trainer = s.trainers || null
      let out = null
      if (kind === 'convention') out = await generatePDF('convention', session, { trainees, trainer, costs: [] })
      else if (kind === 'convocations') out = await generateAllPDF('convocation', session, trainees, { trainer })
      else if (kind === 'emargement') {
        const absents = (s.session_trainees || []).filter((st) => st.absent).map((st) => st.trainee_id)
        let trainerSignatureBase64 = null
        try { trainerSignatureBase64 = (await callApi('/api/espace-entreprise', { action: 'signature', session_id: s.id })).dataUrl || null } catch { /* sans signature */ }
        const has = (s.halfdays || []).length > 0
        out = await generatePDF('emargement', session, { trainees, trainer, isBlank: false,
          attendanceData: has ? { signatures: [], halfdays: s.halfdays || [], proxies: [], absents, trainerSignatureBase64 } : null })
      } else if (kind === 'attestations') {
        out = await generateAllPDF('attestation', session, trainees.filter((t) => !((s.session_trainees || []).find((st) => st.trainee_id === t.id)?.absent)), { trainer })
      } else if (kind === 'certificats') out = await generateAllPDF('certificat', session, trainees.filter((t) => t.result), { trainer })
      if (!out) { toast.error('Aucun document pour cette session'); return }
      saveBase64(out.base64, out.filename)
    } catch (err) {
      toast.error(`Document impossible : ${err.message || 'erreur'}`)
    } finally { setBusy(null) }
  }

  if (!data) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>

  const Doc = ({ s, kind, icon: Icon, label, disabled }) => (
    <button type="button" onClick={() => download(s, kind)} disabled={disabled || !!busy || !orgPret}
      className="flex items-center gap-2 px-3 py-2 rounded-ui border border-gray-200 bg-white text-sm text-gray-700 hover:border-primary-300 disabled:opacity-40">
      {busy === `${s.id}:${kind}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}{label}
      <Download className="w-3.5 h-3.5 ml-auto text-gray-400" />
    </button>
  )

  const Session = ({ s, finie }) => {
    const nb = (s.session_trainees || []).length
    const lieu = [s.location_name, [s.location_postal_code, s.location_city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    return (
      <Carte>
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display font-semibold text-gray-900">{s.courses?.title || 'Formation'}</h3>
          <span className="text-xs font-mono text-gray-400 shrink-0">{s.reference}</span>
        </div>
        <div className="mt-1.5 flex flex-col gap-1 text-sm text-gray-600">
          <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-gray-400" />{s.start_date === s.end_date ? fmtDate(s.start_date) : `${fmtDate(s.start_date)} au ${fmtDate(s.end_date)}`}</span>
          {lieu && <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-gray-400" />{lieu}</span>}
          <span className="flex items-center gap-1.5"><Users className="w-4 h-4 text-gray-400" />{nb} participant{nb > 1 ? 's' : ''}{s.group_id ? ' (session inter)' : ''}</span>
        </div>
        {nb > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {s.session_trainees.map((st) => (
              <li key={st.trainee_id} className={`text-xs px-2 py-1 rounded-full ${st.absent ? 'bg-gray-100 text-gray-400 line-through' : ['acquis', 'acquired'].includes(st.result) ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : 'bg-gray-100 text-gray-700'}`}>
                {(st.trainees?.last_name || '').toUpperCase()} {st.trainees?.first_name}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {!s.group_id && <Doc s={s} kind="convention" icon={FileSignature} label="Convention" />}
          <Doc s={s} kind="convocations" icon={FileText} label="Convocations" disabled={nb === 0} />
          <Doc s={s} kind="emargement" icon={ClipboardList} label="Émargement" disabled={nb === 0} />
          <Doc s={s} kind="attestations" icon={BadgeCheck} label="Attestations" disabled={!finie || nb === 0} />
          <Doc s={s} kind="certificats" icon={Award} label="Certificats" disabled={!finie || !(s.session_trainees || []).some((st) => st.result)} />
        </div>
      </Carte>
    )
  }

  return (
    <div className="space-y-5">
      {upcoming.length > 0 && <section><h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">À venir ou en cours</h2><div className="space-y-3">{upcoming.map((s) => <Session key={`${s.id}${s.group_id || ''}`} s={s} finie={false} />)}</div></section>}
      {past.length > 0 && <section><h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Formations réalisées</h2><div className="space-y-3">{past.map((s) => <Session key={`${s.id}${s.group_id || ''}`} s={s} finie />)}</div></section>}
      {upcoming.length === 0 && past.length === 0 && <p className="text-sm text-gray-500 text-center py-10">Aucune formation enregistrée pour le moment.</p>}
    </div>
  )
}

function Salaries() {
  const [salaries, setSalaries] = useState(null)
  const [echeances, setEcheances] = useState([])
  const [recherche, setRecherche] = useState('')
  useEffect(() => {
    (async () => {
      const [{ data: s }, { data: e }] = await Promise.all([supabase.rpc('ent_salaries'), supabase.rpc('ent_echeances')])
      setSalaries(s || [])
      setEcheances(e || [])
    })()
  }, [])
  if (!salaries) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
  const autres = echeances.filter((e) => e.kind !== 'formation' && e.status !== 'a_jour')
  const q = recherche.trim().toLowerCase()
  const liste = q ? salaries.filter((s) => `${s.first_name} ${s.last_name} ${s.job_title || ''}`.toLowerCase().includes(q)) : salaries
  return (
    <div className="space-y-4">
      {autres.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Matériel et exercices</h2>
          <Carte className="space-y-2">
            {autres.map((e, i) => (
              <div key={i} className="flex items-start justify-between gap-2 text-sm">
                <span className="text-gray-800">{e.label}{e.objet ? ` · ${e.objet}` : ''}{e.site ? ` · ${e.site}` : ''}<span className="text-gray-400"> · {fmtDate(e.due_on)}</span></span>
                <Pastille status={e.status} />
              </div>
            ))}
          </Carte>
        </section>
      )}
      <input className="input w-full" placeholder="Rechercher un salarié" value={recherche} onChange={(e) => setRecherche(e.target.value)} aria-label="Rechercher un salarié" />
      {liste.length === 0 ? <p className="text-sm text-gray-500 text-center py-6">Aucun salarié.</p> : (
        <div className="space-y-2">
          {liste.map((s) => (
            <Carte key={s.id}>
              <div className="font-medium text-gray-900">{(s.last_name || '').toUpperCase()} {s.first_name}</div>
              <div className="text-sm text-gray-500">{[s.job_title, s.site].filter(Boolean).join(' · ') || ' '}</div>
              {(s.validites || []).length > 0 && (
                <ul className="mt-2 space-y-1">
                  {s.validites.map((v, i) => (
                    <li key={i} className="flex items-start justify-between gap-2 text-sm">
                      <span className="text-gray-700">{v.label}<span className="text-gray-400">{v.echeance ? ` · jusqu'au ${fmtDate(v.echeance)}` : v.valide_le ? ` · le ${fmtDate(v.valide_le)}` : ''}</span></span>
                      <Pastille status={v.statut} />
                    </li>
                  ))}
                </ul>
              )}
            </Carte>
          ))}
        </div>
      )}
    </div>
  )
}

function Demandes({ compte, onChange }) {
  const [liste, setListe] = useState(null)
  const [catalogue, setCatalogue] = useState({ formations: [], sessions_inter: [] })
  const [sessions, setSessions] = useState([])
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const [{ data }, { data: c }, { data: s }] = await Promise.all([supabase.rpc('ent_demandes'), supabase.rpc('ent_catalogue'), supabase.rpc('ent_sessions')])
    setListe(data || [])
    setCatalogue(c || { formations: [], sessions_inter: [] })
    setSessions((s?.sessions || []).filter((x) => x.end_date && x.end_date >= new Date().toISOString().slice(0, 10)))
  }
  useEffect(() => { load() }, [])

  const envoyer = async () => {
    const f = form
    const stagiaires = (f.stagiaires || []).filter((x) => x.nom?.trim())
    if (f.kind === 'inscription_inter' && (!f.session || stagiaires.length === 0)) return toast.error('Choisissez la session et indiquez au moins un salarié')
    if (f.kind === 'remplacement' && !f.session) return toast.error('Choisissez la session')
    if (f.kind === 'message' && !f.message?.trim()) return toast.error('Écrivez votre message')
    setBusy(true)
    const { error } = await supabase.rpc('ent_demander', {
      p_kind: f.kind, p_message: f.message || null, p_session: f.session || null, p_course: f.course || null,
      p_payload: { stagiaires, periode: f.periode || null, effectif: f.effectif || null },
    })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Demande envoyée à votre organisme')
    setForm(null)
    load(); onChange()
  }

  const setSt = (i, k, v) => setForm((f) => ({ ...f, stagiaires: f.stagiaires.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }))

  if (!liste) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {compte?.can_register && <button type="button" className="btn btn-secondary justify-center" onClick={() => setForm({ kind: 'inscription_inter', session: '', stagiaires: [{ prenom: '', nom: '', fonction: '', email: '' }], message: '' })}>Inscrire</button>}
        <button type="button" className="btn btn-secondary justify-center" onClick={() => setForm({ kind: 'demande_intra', course: '', periode: '', effectif: '', message: '' })}>Formation intra</button>
        <button type="button" className="btn btn-secondary justify-center" onClick={() => setForm({ kind: 'remplacement', session: '', message: '' })}>Remplacement</button>
        <button type="button" className="btn btn-secondary justify-center" onClick={() => setForm({ kind: 'message', message: '' })}>Message</button>
      </div>

      {form && (
        <Carte className="space-y-3">
          <div className="font-medium text-gray-900">{DEMANDES[form.kind]}</div>
          {form.kind === 'inscription_inter' && (
            <>
              <select className="input w-full" value={form.session} onChange={(e) => setForm((f) => ({ ...f, session: e.target.value }))} aria-label="Session inter">
                <option value="">Choisir une session</option>
                {catalogue.sessions_inter.map((s) => <option key={s.id} value={s.id} disabled={s.places === 0}>{s.title} · {fmtDate(s.start_date)}{s.location_city ? ` · ${s.location_city}` : ''}{s.places === 0 ? ' · complet' : ` · ${s.places} place${s.places > 1 ? 's' : ''}`}</option>)}
              </select>
              {catalogue.sessions_inter.length === 0 && <p className="text-sm text-gray-500">Aucune session inter ouverte pour le moment : faites une demande de formation intra ou envoyez un message.</p>}
              {form.stagiaires.map((st, i) => (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <input className="input" placeholder="Prénom" value={st.prenom} onChange={(e) => setSt(i, 'prenom', e.target.value)} aria-label="Prénom" />
                  <input className="input" placeholder="Nom" value={st.nom} onChange={(e) => setSt(i, 'nom', e.target.value)} aria-label="Nom" />
                  <input className="input" placeholder="Fonction" value={st.fonction} onChange={(e) => setSt(i, 'fonction', e.target.value)} aria-label="Fonction" />
                  <div className="flex gap-1">
                    <input className="input flex-1 min-w-0" placeholder="Email (facultatif)" value={st.email} onChange={(e) => setSt(i, 'email', e.target.value)} aria-label="Email" />
                    {form.stagiaires.length > 1 && <button type="button" className="btn btn-ghost px-2" aria-label="Retirer" onClick={() => setForm((f) => ({ ...f, stagiaires: f.stagiaires.filter((_, j) => j !== i) }))}><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </div>
              ))}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm((f) => ({ ...f, stagiaires: [...f.stagiaires, { prenom: '', nom: '', fonction: '', email: '' }] }))}><Plus className="w-4 h-4" /> Ajouter un salarié</button>
            </>
          )}
          {form.kind === 'demande_intra' && (
            <>
              <select className="input w-full" value={form.course} onChange={(e) => setForm((f) => ({ ...f, course: e.target.value }))} aria-label="Formation">
                <option value="">Formation souhaitée (facultatif)</option>
                {catalogue.formations.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input className="input" placeholder="Période souhaitée" value={form.periode} onChange={(e) => setForm((f) => ({ ...f, periode: e.target.value }))} aria-label="Période souhaitée" />
                <input className="input" inputMode="numeric" placeholder="Nombre de personnes" value={form.effectif} onChange={(e) => setForm((f) => ({ ...f, effectif: e.target.value.replace(/\D/g, '') }))} aria-label="Nombre de personnes" />
              </div>
            </>
          )}
          {form.kind === 'remplacement' && (
            <select className="input w-full" value={form.session} onChange={(e) => setForm((f) => ({ ...f, session: e.target.value }))} aria-label="Session">
              <option value="">Choisir la session</option>
              {sessions.map((s) => <option key={`${s.id}${s.group_id || ''}`} value={s.id}>{s.courses?.title || 'Formation'} · {fmtDate(s.start_date)}</option>)}
            </select>
          )}
          <textarea className="input w-full min-h-[90px]" placeholder={form.kind === 'remplacement' ? 'Qui remplace qui ?' : 'Précisions'} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} aria-label="Message" />
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Annuler</button>
            <button type="button" className="btn btn-primary" onClick={envoyer} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Envoyer</button>
          </div>
        </Carte>
      )}

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Vos demandes</h2>
        {liste.length === 0 ? <p className="text-sm text-gray-500">Aucune demande pour le moment.</p> : (
          <div className="space-y-2">
            {liste.map((r) => (
              <Carte key={r.id}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-gray-900 text-sm">{DEMANDES[r.kind]}</span>
                  <span className="text-xs text-gray-500 shrink-0">{STATUTS[r.status]}</span>
                </div>
                <div className="text-sm text-gray-500">{fmtDate(r.created_at)}{r.session?.reference ? ` · session du ${fmtDate(r.session.start_date)}` : ''}{r.course ? ` · ${r.course}` : ''}</div>
                {r.message && <p className="text-sm text-gray-700 mt-1 whitespace-pre-line">{r.message}</p>}
                {r.response && <p className="text-sm text-gray-800 mt-2 bg-gray-50 rounded-ui-sm p-2 whitespace-pre-line">{r.response}</p>}
              </Carte>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Plus_({ compte, org, salaries }) {
  const [vue, setVue] = useState('catalogue')
  const [catalogue, setCatalogue] = useState(null)
  const [factures, setFactures] = useState(null)
  const [actus, setActus] = useState(null)
  useEffect(() => {
    if (vue === 'catalogue' && !catalogue) supabase.rpc('ent_catalogue').then(({ data }) => setCatalogue(data || { formations: [], sessions_inter: [] }))
    if (vue === 'factures' && !factures) supabase.rpc('ent_factures').then(({ data }) => setFactures(data || []))
    if (vue === 'actus' && !actus) supabase.rpc('ent_actus').then(({ data }) => setActus(data || []))
  }, [vue])
  const VUES = [['catalogue', 'Catalogue', BookOpen], ...(salaries ? [['salaries', 'Salariés', Users]] : []), ...(compte?.can_see_invoices ? [['factures', 'Factures', Receipt]] : []), ['actus', 'Actualités', Megaphone]]
  const chargement = <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto">
        {VUES.map(([k, l, Icon]) => (
          <button key={k} type="button" onClick={() => setVue(k)} className={`btn btn-sm ${vue === k ? 'btn-primary' : 'btn-secondary'}`}><Icon className="w-4 h-4" /> {l}</button>
        ))}
      </div>
      {vue === 'catalogue' && (!catalogue ? chargement : (
        <div className="space-y-4">
          {catalogue.sessions_inter.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Prochaines sessions inter</h2>
              <div className="space-y-2">
                {catalogue.sessions_inter.map((s) => (
                  <Carte key={s.id}>
                    <div className="font-medium text-gray-900">{s.title}</div>
                    <div className="text-sm text-gray-500">{fmtDate(s.start_date)}{s.location_city ? ` · ${s.location_city}` : ''}{s.price_per_person ? ` · ${euros(s.price_per_person)} HT par personne` : ''} · {s.places > 0 ? `${s.places} place${s.places > 1 ? 's' : ''}` : 'complet'}</div>
                  </Carte>
                ))}
              </div>
            </section>
          )}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Formations</h2>
            <div className="space-y-2">
              {catalogue.formations.map((c) => (
                <Carte key={c.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-gray-900">{c.title}</div>
                    {c.duration_hours && <span className="text-xs text-gray-500 shrink-0">{String(c.duration_hours).replace('.', ',')} h</span>}
                  </div>
                  {c.objectives && <p className="text-sm text-gray-600 mt-1 line-clamp-3 whitespace-pre-line">{c.objectives}</p>}
                  {fichierDeLInstance(c.program_url) && <a href={fichierDeLInstance(c.program_url)} onClick={(e) => { e.preventDefault(); ouvrirFichier(fichierDeLInstance(c.program_url)).catch((err) => toast.error(err.message)) }} target="_blank" rel="noreferrer" className="text-sm text-primary-700 inline-flex items-center gap-1 mt-1">Programme <ExternalLink className="w-3.5 h-3.5" /></a>}
                </Carte>
              ))}
            </div>
          </section>
        </div>
      ))}
      {vue === 'salaries' && <Salaries />}
      {vue === 'factures' && (!factures ? chargement : factures.length === 0 ? <p className="text-sm text-gray-500 text-center py-6">Aucune facture.</p> : (
        <div className="space-y-2">
          {factures.map((f) => (
            <Carte key={f.id}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-gray-900 text-sm">{f.type === 'credit_note' ? 'Avoir' : 'Facture'} {f.reference}</span>
                <span className="text-sm font-medium text-gray-900 shrink-0">{euros(f.total_ttc)} TTC</span>
              </div>
              <div className="text-sm text-gray-500">{fmtDate(f.invoice_date)}{f.object ? ` · ${f.object}` : ''}</div>
              <div className="text-sm mt-1">{Number(f.amount_due) > 0 ? <span className="text-[rgb(var(--c-warning))]">Reste à régler {euros(f.amount_due)}{f.due_date ? ` avant le ${fmtDate(f.due_date)}` : ''}</span> : <span className="text-[rgb(var(--c-success))]">Réglée</span>}</div>
            </Carte>
          ))}
          <p className="text-xs text-gray-400">Pour recevoir une facture en PDF, écrivez à {org?.email || 'votre organisme'}.</p>
        </div>
      ))}
      {vue === 'actus' && (!actus ? chargement : actus.length === 0 ? <p className="text-sm text-gray-500 text-center py-6">Aucune actualité.</p> : (
        <div className="space-y-2">
          {actus.map((n) => (
            <Carte key={n.id}>
              <div className="font-medium text-gray-900">{n.title}</div>
              <div className="text-xs text-gray-400">{fmtDate(n.published_at)}</div>
              {n.body && <p className="text-sm text-gray-700 mt-1 whitespace-pre-line">{n.body}</p>}
              {n.link && <a href={n.link} target="_blank" rel="noreferrer" className="text-sm text-primary-700 inline-flex items-center gap-1 mt-1">En savoir plus <ExternalLink className="w-3.5 h-3.5" /></a>}
            </Carte>
          ))}
        </div>
      ))}
    </div>
  )
}

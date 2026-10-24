import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fichierDeLInstance } from '../../../core/fichiersInstance'
import toast from 'react-hot-toast'
import { Calendar, MapPin, Users, Download, Loader2, LogOut, AlertCircle, BadgeCheck, Award, ClipboardList, FileText, ExternalLink, ShieldCheck, GraduationCap, PenLine, CalendarPlus } from 'lucide-react'
import { format, parseISO, isAfter, startOfToday } from 'date-fns'
import { fr as frLocale } from 'date-fns/locale'
import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'
import PublicLayout from '../../../app/PublicLayout'
import { telechargerIcsSessions } from '../../../core/fichiers/agenda'
import { useBranding } from '../../../core/branding/BrandingProvider'
import { BandeauAccueil, PersonnaliserEspace } from '../components/Vitrine'
import { useMonProfil } from '../lib/monProfil'
import { prepareOrgForPDF } from '../../../core/org/orgUtils'
import { setOrganization, generatePDF, generateAllPDF } from '../../formation/pdf/pdfGenerator'
import { ouvrirFichier, readableUrl } from '../../../core/storageUtils'

// Espaces des comptes formateur externe et stagiaire (lot 2, 0047). Les données passent par les fonctions ext_* et
// stg_* de la base (aucun accès aux tables). Formateur externe : ses sessions (programme, lieu, stagiaires, feuille
// d'émargement), ses justificatifs ; jamais de prix. Stagiaire : ses formations, attestations, certificats, lien vers
// son espace de session (émargement, évaluations).

const fmtDate = (d) => (d ? format(parseISO(String(d).slice(0, 10)), 'd MMMM yyyy', { locale: frLocale }) : '')
const heure = (t) => (t ? String(t).slice(0, 5).replace(':', 'h') : '')
const ETATS = { a_jour: ['bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]', 'À jour'], a_renouveler: ['bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]', 'À renouveler'], perime: ['bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]', 'Périmé'], manquant: ['bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]', 'Manquant'] }

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

const Carte = ({ children, className = '' }) => <div className={`bg-white rounded-ui-lg border border-gray-200 p-4 ${className}`}>{children}</div>

// En-tête des espaces : « Bonjour » + prénom du compte (photo ou logo choisis par la personne, 0426)
function Entete({ libelle, prenom, sousTitre, logout }) {
  const { branding } = useBranding()
  const moi = useMonProfil(prenom)
  const [perso, setPerso] = useState(false)
  return (
    <>
      <BandeauAccueil branding={branding} libelle={libelle} prenom={moi.prenom} photo={moi.photo} sousTitre={sousTitre}
        onPersonnaliser={moi.connecte ? () => setPerso(true) : null} onQuitter={logout} />
      {perso && <PersonnaliserEspace prenom={moi.prenom} photo={moi.photo} onEnregistrer={moi.enregistrer} onFermer={() => setPerso(false)} />}
    </>
  )
}

export default function EspaceExterne() {
  const role = useAuthStore((s) => s.userRole)
  const logout = useAuthStore((s) => s.logout)
  return role === 'formateur_externe' ? <EspaceFormateur logout={logout} /> : <EspaceStagiaire logout={logout} />
}

function useDonnees(fn, orgFn) {
  const [data, setData] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [orgPret, setOrgPret] = useState(false)
  useEffect(() => {
    (async () => {
      const [{ data: d, error }, { data: org }] = await Promise.all([supabase.rpc(fn), supabase.rpc(orgFn)])
      if (error) { setErreur(error.code === '42501' ? 'Votre accès n\'est pas actif. Contactez votre organisme de formation.' : 'Espace momentanément indisponible, réessayez dans quelques instants.'); return }
      setData(d)
      if (org) { setOrganization(await prepareOrgForPDF(org)); setOrgPret(true) }
    })()
  }, [fn, orgFn])
  return { data, erreur, orgPret }
}

function Erreur({ erreur, logout, titre }) {
  return (
    <PublicLayout title={titre}>
      <div className="max-w-md mx-auto bg-white rounded-ui-lg border border-gray-200 p-6 mt-6 space-y-4">
        <p className="text-sm text-gray-700 flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 text-[rgb(var(--c-danger))]" />{erreur}</p>
        <button type="button" className="btn btn-secondary w-full justify-center" onClick={logout}><LogOut className="w-4 h-4" /> Se déconnecter</button>
      </div>
    </PublicLayout>
  )
}

const Chargement = ({ titre }) => <PublicLayout title={titre}><div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div></PublicLayout>

function partager(sessions) {
  const today = startOfToday()
  const up = [], pa = []
  ;(sessions || []).forEach((s) => { (s.end_date && !isAfter(today, parseISO(s.end_date)) ? up : pa).push(s) })
  up.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
  return { up, pa }
}

const lieuDe = (s) => (s.is_remote ? 'À distance' : [s.location_name, s.location_address, [s.location_postal_code, s.location_city].filter(Boolean).join(' ')].filter(Boolean).join(', '))

/** Session en cours aujourd'hui : l'émargement sur le téléphone du formateur est ouvert (0453) */
export function sessionDuJour(s, aujourdhui = format(new Date(), 'yyyy-MM-dd')) {
  const d = String(s?.start_date || '').slice(0, 10)
  const f = String(s?.end_date || s?.start_date || '').slice(0, 10)
  return !!d && d <= aujourdhui && aujourdhui <= f
}

/** Note de l'agenda du formateur : client, nombre de stagiaires, salle ; jamais de prix */
export function noteAgenda(s) {
  const nb = (s?.session_trainees || []).length
  return [s?.client?.name ? `Client : ${s.client.name}` : '', nb ? `${nb} stagiaire${nb > 1 ? 's' : ''}` : '', s?.room ? `Salle : ${s.room}` : ''].filter(Boolean).join('\n')
}

function Dates({ s }) {
  const lieu = lieuDe(s)
  return (
    <div className="mt-1.5 flex flex-col gap-1 text-sm text-gray-600">
      <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-gray-400" />{s.start_date === s.end_date ? fmtDate(s.start_date) : `${fmtDate(s.start_date)} au ${fmtDate(s.end_date)}`}{s.start_time ? `, ${heure(s.start_time)} à ${heure(s.end_time)}` : ''}</span>
      {s.is_remote ? <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-gray-400" />À distance</span> : lieu && <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-gray-400" />{lieu}</span>}
    </div>
  )
}

function EspaceStagiaire({ logout }) {
  const titre = 'Mon espace formation'
  const { data, erreur, orgPret } = useDonnees('stg_sessions', 'stg_org')
  const [busy, setBusy] = useState(null)
  const { up, pa } = useMemo(() => partager(data?.sessions), [data])
  if (erreur) return <Erreur erreur={erreur} logout={logout} titre={titre} />
  if (!data) return <Chargement titre={titre} />
  const moi = data.trainee || {}

  const doc = async (s, kind) => {
    if (!orgPret) return
    setBusy(`${s.id}:${kind}`)
    try {
      const session = { ...s, clients: s.clients || null, courses: s.courses || {}, trainers: s.trainers || null }
      const me = [{ ...moi, result: s.result || null, access_code: s.access_code }]
      const out = await generateAllPDF(kind, session, me, { trainer: s.trainers || null })
      if (!out) { toast.error('Document indisponible'); return }
      saveBase64(out.base64, out.filename)
    } catch (err) {
      toast.error(`Document impossible : ${err.message || 'erreur'}`)
    } finally { setBusy(null) }
  }

  const Session = ({ s, finie }) => (
    <Carte>
      <h3 className="font-display font-semibold text-gray-900">{s.courses?.title || 'Formation'}</h3>
      <Dates s={s} />
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {!finie && s.attendance_token && (
          <a href={`/#/portail/${s.attendance_token}`} className="flex items-center gap-2 px-3 py-2 rounded-ui border border-gray-200 bg-white text-sm text-gray-700 hover:border-primary-300">
            <ClipboardList className="w-4 h-4" />Émargement et évaluations<ExternalLink className="w-3.5 h-3.5 ml-auto text-gray-400" />
          </a>
        )}
        {finie && !s.absent && (
          <button type="button" onClick={() => doc(s, 'attestation')} disabled={!!busy || !orgPret} className="flex items-center gap-2 px-3 py-2 rounded-ui border border-gray-200 bg-white text-sm text-gray-700 hover:border-primary-300 disabled:opacity-40">
            {busy === `${s.id}:attestation` ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}Attestation de présence<Download className="w-3.5 h-3.5 ml-auto text-gray-400" />
          </button>
        )}
        {finie && s.result && (
          <button type="button" onClick={() => doc(s, 'certificat')} disabled={!!busy || !orgPret} className="flex items-center gap-2 px-3 py-2 rounded-ui border border-gray-200 bg-white text-sm text-gray-700 hover:border-primary-300 disabled:opacity-40">
            {busy === `${s.id}:certificat` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Award className="w-4 h-4" />}Certificat de réalisation<Download className="w-3.5 h-3.5 ml-auto text-gray-400" />
          </button>
        )}
        {fichierDeLInstance(s.courses?.program_url) && (
          <a href={fichierDeLInstance(s.courses?.program_url)} onClick={(e) => { e.preventDefault(); ouvrirFichier(fichierDeLInstance(s.courses?.program_url)).catch((err) => toast.error(err.message)) }} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 rounded-ui border border-gray-200 bg-white text-sm text-gray-700 hover:border-primary-300">
            <FileText className="w-4 h-4" />Programme<ExternalLink className="w-3.5 h-3.5 ml-auto text-gray-400" />
          </a>
        )}
      </div>
      {finie && !s.evaluation_done && s.attendance_token && <p className="mt-2 text-xs text-gray-500">Votre avis compte : questionnaire de satisfaction dans votre espace de session.</p>}
      {s.sst_certified && <p className="mt-2 text-xs text-[rgb(var(--c-success))]">Certification SST obtenue.</p>}
    </Carte>
  )

  return (
    <PublicLayout title={titre} bandeau={<Entete libelle={titre} prenom={moi.first_name} sousTitre="Vos formations" logout={logout} />}>
      <div className="space-y-5">
        {up.length > 0 && <section><h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">À venir ou en cours</h2><div className="space-y-3">{up.map((s) => <Session key={s.id} s={s} finie={false} />)}</div></section>}
        {pa.length > 0 && <section><h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Mes formations réalisées</h2><div className="space-y-3">{pa.map((s) => <Session key={s.id} s={s} finie />)}</div></section>}
        {up.length === 0 && pa.length === 0 && <p className="text-sm text-gray-500 text-center py-10">Aucune formation pour le moment.</p>}
      </div>
    </PublicLayout>
  )
}

function EspaceFormateur({ logout }) {
  const titre = 'Espace formateur'
  const { data, erreur, orgPret } = useDonnees('ext_sessions', 'ext_org')
  const [onglet, setOnglet] = useState('sessions')
  const [justif, setJustif] = useState(null)
  const [busy, setBusy] = useState(null)
  const navigate = useNavigate()
  const { up, pa } = useMemo(() => partager(data?.sessions), [data])
  useEffect(() => { if (onglet === 'justificatifs' && !justif) supabase.rpc('ext_justificatifs').then(({ data: j }) => setJustif(j || { certificats: [] })) }, [onglet])
  if (erreur) return <Erreur erreur={erreur} logout={logout} titre={titre} />
  if (!data) return <Chargement titre={titre} />

  const emargement = async (s) => {
    if (!orgPret) return
    setBusy(s.id)
    try {
      const trainees = (s.session_trainees || []).map((st) => ({ ...st.trainees }))
      const out = await generatePDF('emargement', { ...s, clients: s.client || null, courses: s.courses || {} }, { trainees, trainer: s.trainers || data.trainer, isBlank: true })
      if (!out) { toast.error('Document indisponible'); return }
      saveBase64(out.base64, out.filename)
    } catch (err) {
      toast.error(`Document impossible : ${err.message || 'erreur'}`)
    } finally { setBusy(null) }
  }

  const Session = ({ s, finie }) => {
    const nb = (s.session_trainees || []).length
    return (
      <Carte>
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display font-semibold text-gray-900">{s.courses?.title || 'Formation'}</h3>
          <span className="text-xs font-mono text-gray-400 shrink-0">{s.reference}</span>
        </div>
        <Dates s={s} />
        <div className="mt-1 flex flex-col gap-1 text-sm text-gray-600">
          {s.client?.name && <span className="flex items-center gap-1.5"><GraduationCap className="w-4 h-4 text-gray-400" />{s.client.name}</span>}
          <span className="flex items-center gap-1.5"><Users className="w-4 h-4 text-gray-400" />{nb} stagiaire{nb > 1 ? 's' : ''}{!s.principal && s.trainers ? `, avec ${s.trainers.first_name} ${s.trainers.last_name}` : ''}</span>
          {s.room && <span className="text-gray-500">Salle : {s.room}</span>}
          {s.location_details && <span className="text-gray-500 whitespace-pre-line">{s.location_details}</span>}
          {s.is_remote && s.remote_link && <a href={s.remote_link} target="_blank" rel="noreferrer" className="text-primary-700 inline-flex items-center gap-1">Lien de la classe virtuelle <ExternalLink className="w-3.5 h-3.5" /></a>}
        </div>
        {nb > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {s.session_trainees.map((st) => <li key={st.trainee_id} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">{(st.trainees?.last_name || '').toUpperCase()} {st.trainees?.first_name}</li>)}
          </ul>
        )}
        {s.courses?.objectives && (
          <details className="mt-3 text-sm text-gray-700">
            <summary className="cursor-pointer text-gray-900 font-medium">Objectifs et programme</summary>
            <p className="mt-1 whitespace-pre-line">{s.courses.objectives}</p>
            {(s.courses.program || s.courses.content) && <p className="mt-2 whitespace-pre-line">{s.courses.program || s.courses.content}</p>}
            {s.courses.trainer_equipment && <p className="mt-2 whitespace-pre-line"><span className="font-medium">Matériel : </span>{s.courses.trainer_equipment}</p>}
          </details>
        )}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {!finie && nb > 0 && sessionDuJour(s) && (
            <button type="button" onClick={() => navigate(`/mon-espace/signature/${s.id}`)} className="sm:col-span-2 flex items-center justify-center gap-2 px-3 py-3 rounded-ui bg-primary-600 text-white font-semibold">
              <PenLine className="w-4 h-4" />Faire signer l'émargement
            </button>
          )}
          {!finie && (
            <button type="button" onClick={() => telechargerIcsSessions([s], { lieuDe, prefixe: 'Intervention', noteDe: noteAgenda }, `Intervention_${s.reference || 'session'}.ics`)} className="flex items-center gap-2 px-3 py-2 rounded-ui border border-gray-200 bg-white text-sm text-gray-700 hover:border-primary-300">
              <CalendarPlus className="w-4 h-4" />Ajouter à mon agenda<Download className="w-3.5 h-3.5 ml-auto text-gray-400" />
            </button>
          )}
          {!finie && nb > 0 && (
            <button type="button" onClick={() => emargement(s)} disabled={!!busy || !orgPret} className="flex items-center gap-2 px-3 py-2 rounded-ui border border-gray-200 bg-white text-sm text-gray-700 hover:border-primary-300 disabled:opacity-40">
              {busy === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}Feuille d'émargement papier<Download className="w-3.5 h-3.5 ml-auto text-gray-400" />
            </button>
          )}
          {fichierDeLInstance(s.courses?.program_url) && (
            <a href={fichierDeLInstance(s.courses?.program_url)} onClick={(e) => { e.preventDefault(); ouvrirFichier(fichierDeLInstance(s.courses?.program_url)).catch((err) => toast.error(err.message)) }} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 rounded-ui border border-gray-200 bg-white text-sm text-gray-700 hover:border-primary-300">
              <FileText className="w-4 h-4" />Programme<ExternalLink className="w-3.5 h-3.5 ml-auto text-gray-400" />
            </a>
          )}
        </div>
      </Carte>
    )
  }

  const Etat = ({ status }) => { const e = ETATS[status] || ETATS.a_jour; return <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${e[0]}`}>{e[1]}</span> }

  return (
    <PublicLayout title={titre} bandeau={<Entete libelle={titre} prenom={data.trainer?.first_name} sousTitre="Vos interventions" logout={logout} />}>
      <div className="flex gap-2 mb-4">
        <button type="button" onClick={() => setOnglet('sessions')} className={`btn btn-sm ${onglet === 'sessions' ? 'btn-primary' : 'btn-secondary'}`}><Calendar className="w-4 h-4" /> Mes sessions</button>
        <button type="button" onClick={() => setOnglet('justificatifs')} className={`btn btn-sm ${onglet === 'justificatifs' ? 'btn-primary' : 'btn-secondary'}`}><ShieldCheck className="w-4 h-4" /> Mes justificatifs</button>
      </div>
      {onglet === 'sessions' && (
        <div className="space-y-5">
          {up.length > 1 && (
            <button type="button" onClick={() => telechargerIcsSessions(up, { lieuDe, prefixe: 'Intervention', noteDe: noteAgenda }, 'Mon_planning.ics')} className="btn btn-secondary btn-sm w-full sm:w-auto">
              <CalendarPlus className="w-4 h-4" />Toutes mes sessions à venir dans mon agenda
            </button>
          )}
          {up.length > 0 && <section><h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">À venir ou en cours</h2><div className="space-y-3">{up.map((s) => <Session key={s.id} s={s} finie={false} />)}</div></section>}
          {pa.length > 0 && <section><h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Sessions passées</h2><div className="space-y-3">{pa.map((s) => <Session key={s.id} s={s} finie />)}</div></section>}
          {up.length === 0 && pa.length === 0 && <p className="text-sm text-gray-500 text-center py-10">Aucune session pour le moment.</p>}
        </div>
      )}
      {onglet === 'justificatifs' && (!justif ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div> : (
        <div className="space-y-4">
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Certificats et habilitations</h2>
            {(justif.certificats || []).length === 0 ? <Carte><p className="text-sm text-gray-500">Aucun certificat enregistré : transmettez-les à votre organisme.</p></Carte> : (
              <Carte className="space-y-2">
                {justif.certificats.map((c, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 text-sm">
                    <span className="text-gray-800">{c.name}{c.issuer ? ` · ${c.issuer}` : ''}<span className="text-gray-400">{c.expiry_date && !c.no_expiry ? ` · jusqu'au ${fmtDate(c.expiry_date)}` : ''}</span></span>
                    <Etat status={c.status} />
                  </div>
                ))}
              </Carte>
            )}
          </section>
          {justif.prestataire && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{justif.prestataire.name}</h2>
              <Carte className="space-y-2">
                {(justif.prestataire.justificatifs || []).map((j, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 text-sm">
                    <span className="text-gray-800">{j.label}<span className="text-gray-400">{j.valid_until ? ` · jusqu'au ${fmtDate(j.valid_until)}` : ''}</span></span>
                    <Etat status={j.status} />
                  </div>
                ))}
              </Carte>
              <p className="text-xs text-gray-400 mt-1">Un document manquant ou périmé ? Transmettez-le à votre organisme.</p>
            </section>
          )}
        </div>
      ))}
    </PublicLayout>
  )
}

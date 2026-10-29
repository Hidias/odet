import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Lock, KeyRound, Calendar, MapPin, Users, FileText, FileSignature, ClipboardList, Award, BadgeCheck, Download, Loader2, LogOut, AlertCircle, ShieldCheck, Clock, Phone, Mail, Globe, Accessibility, ArrowRight, Sparkles, GraduationCap, Printer } from 'lucide-react'
import { format, parseISO, isAfter, startOfToday } from 'date-fns'
import { fr } from 'date-fns/locale'
import { supabase } from '../../../core/supabase'
import { useBranding } from '../../../core/branding/BrandingProvider'
import { Halos, Marque, Avatar, PersonnaliserEspace, salutation } from '../components/Vitrine'
import { prepareOrgForPDF } from '../../../core/org/orgUtils'
import { setOrganization, generatePDF, generateAllPDF } from '../../formation/pdf/pdfGenerator'
import { appliquerEmis, seulementEmis } from '../../formation/lib/documentsEmis'
import { noterLien, premiereConnexionDuJour, LIBELLES_DOCUMENT } from '../../../core/portail/journal'
import SignerConvention, { ACCORD_DEVIS, ACCORD_CONTRAT, ACCORD_BON } from '../components/SignerConvention'
import { NOMS_SIGNABLES, signeAvecPreuve } from '../lib/signatureDocument'
import { deposerConvention, conventionSignee } from '../lib/conventionSignee'
import MesDocuments from '../components/MesDocuments'
import ParticipantsSession from '../components/ParticipantsSession'
import DeposerSigne from '../components/DeposerSigne'
import RecapSession from '../components/RecapSession'
import NumerosDemandes from '../components/NumerosDemandes'
import { imprimer } from '../../../core/fichiers/imprimer'
import { rechargerSiMiseAJour } from '../../../core/errors/chunkReload'
import { lireDocumentPortail, versBase64, deposerSigne } from '../../../core/portail/documentsClient'
import { empreinteAppareil } from '../../../core/portail/appareil'
import SecuriteEspace from '../components/SecuriteEspace'

// Espace entreprise par lien + code à 6 chiffres : vitrine de l'organisme pour ses clients. Consultation des
// sessions de l'entreprise et téléchargement de ses documents, en lecture seule. Aux couleurs de l'instance,
// animations discrètes (coupées si l'appareil demande moins de mouvement).

const STORAGE_KEY = (token) => `odet_client_portal_${token}`
// Accueil personnalisé (« Bonjour » + prénom, photo ou logo) : l'accès par code n'a pas de compte, le choix reste
// dans ce navigateur (jamais le nom de l'entreprise à l'accueil)
const PERSO_KEY = (token) => `odet_client_perso_${token}`
function lirePerso(token) {
  try { const v = JSON.parse(window.localStorage.getItem(PERSO_KEY(token)) || 'null'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}

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

async function portalSignature(token, code, sessionId) {
  try {
    const r = await fetch('/api/portail-signature', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, code, session_id: sessionId }),
    })
    if (!r.ok) return null
    const j = await r.json().catch(() => ({}))
    return j.dataUrl || null
  } catch { return null }
}

const fmtDate = (d) => d ? format(parseISO(d), 'd MMMM yyyy', { locale: fr }) : ''

// Compteur animé (0 → valeur), immédiat si l'appareil demande moins de mouvement
function useCompteur(valeur, duree = 900) {
  const [v, setV] = useState(0)
  useEffect(() => {
    const reduit = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduit || !valeur) { setV(valeur); return undefined }
    let raf; const t0 = performance.now()
    const pas = (t) => { const k = Math.min(1, (t - t0) / duree); setV(Math.round(valeur * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(pas) }
    raf = requestAnimationFrame(pas)
    return () => cancelAnimationFrame(raf)
  }, [valeur, duree])
  return v
}

function Chiffre({ valeur, suffixe = '', libelle, icone: Icone, delai }) {
  const v = useCompteur(valeur)
  return (
    <div className="vitrine-monte rounded-ui-lg bg-white/10 backdrop-blur border border-white/15 px-4 py-3" style={{ '--delai': `${delai}ms` }}>
      <div className="flex items-center gap-2 text-white/70 text-xs uppercase tracking-wide"><Icone className="w-4 h-4" aria-hidden="true" />{libelle}</div>
      <div className="mt-1 font-display text-3xl font-semibold text-white tabular-nums">{v}{suffixe}</div>
    </div>
  )
}

const joursAvant = (d) => {
  const x = parseISO(d); const t = startOfToday()
  return Math.round((x - t) / 86400000)
}

export default function ClientPortal() {
  const { token } = useParams()
  const { branding } = useBranding()
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [orgReady, setOrgReady] = useState(false)
  const [org, setOrg] = useState(null)
  const [secoue, setSecoue] = useState(0)
  const [signatures, setSignatures] = useState([])
  const [aSigner, setASigner] = useState(null)
  const [docASigner, setDocASigner] = useState(null)
  const [tourDocs, setTourDocs] = useState(0)
  const [info, setInfo] = useState('')
  const [orgPdf, setOrgPdf] = useState(null)
  const [busy, setBusy] = useState(null) // clé du document en cours de génération
  // Participants saisis par le client (0430) : état par session, sans effet si la base ne le propose pas encore
  const [participants, setParticipants] = useState({})
  const chargerParticipants = async (c = code) => {
    try {
      const { data: p } = await supabase.rpc('client_portal_participants', { p_token: token, p_code: c })
      if (Array.isArray(p)) setParticipants(Object.fromEntries(p.map((x) => [x.session_id, x])))
    } catch { /* fonction absente : rien à afficher */ }
  }
  const enregistrerParticipants = async (sessionId, liste) => {
    const { data: r, error: e } = await supabase.rpc('client_portal_participants_enregistrer', { p_token: token, p_code: code, p_session: sessionId, p_liste: liste })
    if (e) throw new Error(e.message)
    if (r?.error) throw new Error(r.error)
    const { data: d } = await supabase.rpc('client_portal_data', { p_token: token, p_code: code })
    if (d && !d.error) setData(d)
    await chargerParticipants()
    setInfo(`${r?.nombre ?? liste.length} participant(s) enregistré(s). Votre organisme est prévenu.`)
  }
  // Documents signés à la main et déposés (0431) : état des dépôts, fenêtre ouverte
  const [depots, setDepots] = useState([])
  const [aDeposer, setADeposer] = useState(null) // { doc } ou { session }
  const chargerDepots = async (c = code) => {
    try {
      const { data: dp } = await supabase.rpc('client_portal_depots', { p_token: token, p_code: c })
      if (Array.isArray(dp)) setDepots(dp)
    } catch { /* fonction absente */ }
  }
  const depotDe = (type, id) => depots.find((x) => x.object_type === type && x.object_id === id) || null
  const [perso, setPerso] = useState(() => lirePerso(token))
  const [persoOuvert, setPersoOuvert] = useState(false)
  // Sécurité (0449) : appareils, code, compte personnel
  const [securite, setSecurite] = useState(false)
  const [appareils, setAppareils] = useState([])
  const [nouvelAppareil, setNouvelAppareil] = useState(false)
  const [accesInfos, setAccesInfos] = useState(null)
  // Bons d'intervention à signer à distance (0451)
  const [rapportsASigner, setRapportsASigner] = useState(new Set())
  const chargerSecurite = async (c) => {
    try {
      const [{ data: ap }, { data: inf }] = await Promise.all([
        supabase.rpc('client_portal_appareil', { p_token: token, p_code: c, p_device: await empreinteAppareil() }),
        supabase.rpc('client_portal_acces_infos', { p_token: token, p_code: c }),
      ])
      if (ap && !ap.error) { setAppareils(ap.appareils || []); setNouvelAppareil(!!ap.nouveau) }
      if (inf && !inf.error) setAccesInfos(inf)
      const { data: as } = await supabase.rpc('client_portal_a_signer', { p_token: token, p_code: c })
      if (Array.isArray(as)) setRapportsASigner(new Set(as))
    } catch { /* fonctions absentes : rien ne casse */ }
  }
  const enregistrerPerso = async ({ prenom, photo }) => {
    const v = { prenom: prenom || '', photo: photo || null }
    try { window.localStorage.setItem(PERSO_KEY(token), JSON.stringify(v)) } catch { throw new Error('Ce navigateur ne permet pas de garder ce choix.') }
    setPerso(v)
  }

  // Reprise de session dans le même onglet
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY(token))
      if (saved) { setCode(saved); login(saved) }
    } catch { /* stockage indisponible */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function login(forcedCode) {
    const c = String(forcedCode ?? code).replace(/\s/g, '')
    if (c.length < 4) { setError('Saisissez le code reçu'); return }
    setChecking(true); setError('')
    try {
      // Données d'abord : un code faux ne compte qu'une tentative. Les erreurs arrivent en JSON { error }.
      const { data: d, error: e1 } = await supabase.rpc('client_portal_data', { p_token: token, p_code: c })
      if (e1) throw e1
      if (d?.error) throw new Error(d.error)
      const { data: org, error: e2 } = await supabase.rpc('client_portal_org', { p_token: token, p_code: c })
      if (e2) throw e2
      if (org?.error) throw new Error(org.error)
      const prepared = await prepareOrgForPDF(org)
      setOrganization(prepared)
      setOrgPdf(prepared)
      setOrgReady(true)
      setOrg(org)
      setData(d)
      chargerSignatures(c)
      chargerParticipants(c)
      chargerDepots(c)
      chargerSecurite(c)
      try { sessionStorage.setItem(STORAGE_KEY(token), c) } catch { /* ignore */ }
      // Journal de preuve (0401) : connexion notée une fois par jour et par onglet
      if (premiereConnexionDuJour(`lien.${token}`)) noterLien(token, c, { event: 'connexion' })
    } catch (err) {
      const msg = err?.message || ''
      setError(msg.includes('Code incorrect') ? 'Code incorrect' : msg.includes('tentatives') ? 'Trop de tentatives, réessayez dans quelques minutes' : msg.includes('invalide') ? 'Ce lien est invalide ou a été désactivé' : 'Connexion impossible pour le moment')
      setData(null)
      setSecoue((n) => n + 1)
      try { sessionStorage.removeItem(STORAGE_KEY(token)) } catch { /* ignore */ }
    } finally {
      setChecking(false)
    }
  }

  function logout() {
    setData(null); setCode(''); setError('')
    try { sessionStorage.removeItem(STORAGE_KEY(token)) } catch { /* ignore */ }
  }

  const today = startOfToday()
  const { upcoming, past } = useMemo(() => {
    const sessions = data?.sessions || []
    const up = [], pa = []
    sessions.forEach(s => { (s.end_date && !isAfter(today, parseISO(s.end_date)) ? up : pa).push(s) })
    up.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
    return { upcoming: up, past: pa }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // Session au format attendu par les générateurs (clients, courses, trainers, session_trainees)
  function toPdfSession(s) {
    return { ...s, clients: data.client, courses: s.courses || {}, trainers: s.trainers || null }
  }
  // Salariés déjà connus du client, pour les retrouver dans la saisie des participants (0437)
  const chargerSalaries = useCallback(async () => {
    const { data: d, error: e } = await supabase.rpc('client_portal_salaries_connus', { p_token: token, p_code: code })
    return e || !Array.isArray(d) ? [] : d
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // N° de sécurité sociale demandés par les salariés (0440)
  const chargerDemandesNir = useCallback(async () => {
    const { data: d, error: e } = await supabase.rpc('client_portal_nir_demandes', { p_token: token, p_code: code })
    return e || !Array.isArray(d) ? [] : d
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const transmettreNir = async (traineeId, nir) => {
    const { data: d, error: e } = await supabase.rpc('client_portal_nir_transmettre', { p_token: token, p_code: code, p_trainee: traineeId, p_nir: nir })
    if (e || d?.error) throw new Error(e?.message || d?.error || 'Enregistrement impossible')
    return d
  }

  // Session issue d'un devis (22/10, décision de H) : convocations visibles une fois validées et envoyées par
  // l'organisme (chaque participant présent a reçu la sienne), jamais avant la signature de la convention
  const convocationsEnAttente = (s) => !!participants[s.id]?.devis && (!s.convention_signed
    || !(s.session_trainees || []).filter((st) => !st.absent).every((st) => st.convocation_sent_at))

  function traineesOf(s) {
    return (s.session_trainees || []).map(st => ({ ...st.trainees, result: st.result || null, access_code: st.access_code }))
  }

  // Signatures en ligne du client (0402)
  async function chargerSignatures(c = code) {
    const { data: sg } = await supabase.rpc('client_portal_signatures', { p_token: token, p_code: c })
    setSignatures(Array.isArray(sg) ? sg : [])
  }
  const signatureDe = (sid) => [...signatures].reverse().find((x) => x.session_id === sid && x.document_type === 'convention') || null

  async function signer(s, payload) {
    const { data: r, error: e } = await supabase.rpc('client_portal_signer', {
      p_token: token, p_code: code, p_session: s.id, p_kind: 'convention', p_sha256: payload.sha256, p_name: payload.name,
      p_role: payload.role, p_signature: payload.signature, p_consent: payload.consent, p_label: payload.label,
    })
    if (e) throw new Error(e.message)
    if (r?.error) throw new Error(r.error)
    // Le PDF exact signé est gardé (son empreinte est vérifiée par le serveur)
    if (r?.id && !r.deja) await deposerConvention({ token, code }, r.id, payload.base64)
    setData((d) => ({ ...d, sessions: d.sessions.map((x) => (x.id === s.id ? { ...x, convention_signed: true } : x)) }))
    await chargerSignatures()
    setASigner(null)
    setInfo('Convention signée. Merci ! Vous pouvez télécharger la convention signée avec sa preuve.')
  }

  // Versions émises des certificats et attestations (0400) ; sans réponse, les documents sont calculés comme avant
  async function documentsEmis() {
    const { data: d, error: e } = await supabase.rpc('client_portal_documents_emis', { p_token: token, p_code: code })
    return e || !Array.isArray(d) ? [] : d
  }

  // Télécharger, ou imprimer directement (22/10) : même document, même trace au journal
  function download(s, kind, imp = false) {
    if (!orgReady) return
    if (!imp) return remettreDoc(s, kind, (out) => saveBase64(out.base64, out.filename))
    let fin = null
    const pret = new Promise((r) => { fin = r })
    imprimer(() => pret).catch(() => { /* erreur déjà affichée */ })
    remettreDoc(s, kind, (out) => fin(out.base64)).finally(() => fin(null))
  }

  async function remettreDoc(s, kind, remettre) {
    const key = `${s.id}:${kind}`
    setBusy(key)
    try {
      const session = toPdfSession(s)
      const trainees = traineesOf(s)
      const trainer = s.trainers || null
      let out = null
      if (kind === 'convention') {
        out = await generatePDF('convention', session, { trainees, trainer, costs: [] })
      } else if (kind === 'convention_signee') {
        // Convention signée : en ligne (document signé + page de preuve) ou scan déposé par l'organisme (0402)
        out = await conventionSignee({ token, code }, s, signatureDe(s.id), orgPdf,
          () => generatePDF('convention', { ...session, signature_client: signatureDe(s.id) }, { trainees, trainer, costs: [] }))
      } else if (kind === 'convocations') {
        out = await generateAllPDF('convocation', session, trainees, { trainer })
      } else if (kind === 'emargement') {
        const absents = (s.session_trainees || []).filter(st => st.absent).map(st => st.trainee_id)
        // Signature du formateur : bucket privé, servie par le serveur après contrôle du lien et du code
        const trainerSignatureBase64 = trainer?.signature_url ? await portalSignature(token, code, s.id) : null
        const hasAttendance = (s.halfdays || []).length > 0 || (s.proxies || []).length > 0
        out = await generatePDF('emargement', session, {
          // Jamais vierge ici : sans signature, la feuille garde l'intitulé, les dates et les noms
          trainees, trainer, isBlank: false,
          attendanceData: hasAttendance ? { signatures: [], halfdays: s.halfdays || [], proxies: s.proxies || [], absents, trainerSignatureBase64 } : null,
        })
      } else if (kind === 'attestations') {
        // Version émise (0399, 0400) : le client reçoit le document tel qu'il a été remis
        const emis = await documentsEmis()
        out = await generateAllPDF('attestation', session, appliquerEmis(emis, s.id, 'attestation', trainees.filter(t => !((s.session_trainees || []).find(st => st.trainee_id === t.id)?.absent))), { trainer })
      } else if (kind === 'certificats') {
        const emis = await documentsEmis()
        out = await generateAllPDF('certificat', session, appliquerEmis(emis, s.id, 'certificat', trainees).filter(t => t.result), { trainer })
      } else if (kind === 'fins_formation') {
        // Attestations de fin de formation (0476) : seulement les versions émises, jamais recalculées
        const emis = await documentsEmis()
        const liste = seulementEmis(appliquerEmis(emis, s.id, 'fin_formation', trainees))
        out = liste.length ? await generateAllPDF('fin_formation', session, liste, { trainer }) : null
      }
      if (!out) { setError('Aucun document à générer pour cette session'); return }
      remettre(out)
      // Journal de preuve (0401) : document remis, avec son empreinte
      noterLien(token, code, { event: 'document', objectType: 'session', objectId: s.id, kind, label: `${LIBELLES_DOCUMENT[kind] || kind}, ${s.reference || ''}`.trim(), base64: out.base64 })
    } catch (err) {
      if (rechargerSiMiseAJour(err)) return
      console.error('Document portail entreprise :', err)
      setError('Le document n\'a pas pu être généré : ' + (err.message || 'erreur inconnue'))
    } finally {
      setBusy(null)
    }
  }

  // ── Écran de connexion ──
  if (!data) {
    const chiffres = Array.from({ length: 6 }, (_, k) => code[k] || '')
    return (
      <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]" style={{ background: 'rgb(var(--ground))' }}>
        <section className="relative overflow-hidden bg-primary-900 text-white px-6 py-10 sm:px-10 lg:px-14 flex flex-col" style={{ paddingTop: 'max(2.5rem, env(safe-area-inset-top))' }}>
          <Halos />
          <div className="relative"><Marque branding={branding} sombre /></div>
          <div className="relative mt-6 sm:mt-10 lg:mt-auto max-w-lg">
            <p className="vitrine-monte inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-3 py-1 text-xs tracking-wide" style={{ '--delai': '80ms' }}>
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> Votre espace client
            </p>
            <h1 className="vitrine-monte mt-4 font-display text-2xl sm:text-4xl font-semibold leading-tight" style={{ '--delai': '160ms' }}>
              Vos devis, formations, interventions et documents, au même endroit.
            </h1>
            <p className="vitrine-monte mt-3 text-white/75 hidden sm:block" style={{ '--delai': '240ms' }}>
              Tout ce que vous faites avec {branding.org_name || 'votre prestataire'}, signé en ligne et disponible à tout moment.
            </p>
            <ul className="mt-6 space-y-3 text-sm hidden sm:block">
              {[
                { i: FileText, t: 'Devis et conventions à signer en ligne, rapports d\'intervention, factures, attestations et certificats' },
                { i: Clock, t: 'Disponible jour et nuit, sans demande à faire' },
                { i: ShieldCheck, t: branding.qualiopi_certified ? 'Organisme certifié Qualiopi, documents conformes' : 'Accès protégé par votre code personnel' },
              ].map((x, k) => (
                <li key={k} className="vitrine-monte flex items-start gap-3" style={{ '--delai': `${320 + k * 90}ms` }}>
                  <span className="shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center"><x.i className="w-4 h-4" aria-hidden="true" /></span>
                  <span className="pt-1.5 text-white/85">{x.t}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="relative mt-10 lg:mt-auto pt-8 text-xs text-white/50 hidden sm:block">{branding.org_name}{branding.qualiopi_certified ? ', organisme certifié Qualiopi' : ''}</p>
        </section>

        <section className="flex items-center justify-center px-6 py-10 sm:px-10" style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}>
          <div className="w-full max-w-sm vitrine-monte" style={{ '--delai': '200ms' }}>
            <div className="w-12 h-12 rounded-full bg-accent-500/10 text-accent-600 flex items-center justify-center mb-5"><Lock className="w-6 h-6" aria-hidden="true" /></div>
            <h2 className="font-display text-2xl font-semibold text-gray-900">Accédez à vos documents</h2>
            <p className="text-sm text-gray-500 mt-1.5">Saisissez le code à 6 chiffres transmis par {branding.org_name || 'votre organisme de formation'}.</p>
            <form onSubmit={(e) => { e.preventDefault(); login() }} className="mt-6">
              <label htmlFor="code-portail" className="sr-only">Code d'accès à 6 chiffres</label>
              <div key={secoue} className={`relative ${secoue ? 'vitrine-secoue' : ''}`}>
                <div className="grid grid-cols-6 gap-2" aria-hidden="true">
                  {chiffres.map((c, k) => {
                    const actif = k === Math.min(code.length, 5)
                    return (
                      <div key={k} className={`h-14 rounded-ui border-2 flex items-center justify-center font-mono text-2xl font-semibold transition-colors ${error ? 'border-[rgb(var(--c-danger))]/60' : c ? 'border-primary-500 text-gray-900 bg-white' : actif ? 'border-accent-500 bg-white' : 'border-gray-200 bg-white'}`}>
                        {c || (actif ? <span className="vitrine-curseur w-0.5 h-6 bg-accent-500" /> : '')}
                      </div>
                    )
                  })}
                </div>
                <input id="code-portail" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-text"
                  value={code} autoFocus
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 6)
                    setCode(v); setError('')
                    if (v.length === 6) login(v)
                  }} />
              </div>
              {error && <p role="alert" className="mt-3 text-sm text-[rgb(var(--c-danger))] flex items-center gap-1.5"><AlertCircle className="w-4 h-4" aria-hidden="true" />{error}</p>}
              <button type="submit" className="btn btn-primary w-full justify-center mt-5 h-11 gap-2" disabled={checking || code.length < 4}>
                {checking ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <>Accéder à mon espace <ArrowRight className="w-4 h-4" aria-hidden="true" /></>}
              </button>
            </form>
            <p className="mt-6 text-xs text-gray-400 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />Code personnel à votre entreprise. Après 5 essais, l'accès se bloque quelques minutes.</p>
            <p className="mt-3 text-sm text-gray-600">Vous avez un compte personnel ? <a href="#/espace-client" className="font-medium text-primary-800 underline underline-offset-2">Se connecter avec mon adresse e-mail</a></p>
          </div>
        </section>
      </div>
    )
  }

  // ── Tableau de bord de l'entreprise ──
  const sessionsToutes = [...upcoming, ...past]
  const formes = new Set(past.flatMap((s) => (s.session_trainees || []).filter((st) => !st.absent).map((st) => st.trainee_id)))
  const resultats = past.flatMap((s) => (s.session_trainees || []).filter((st) => st.result))
  const reussite = resultats.length ? Math.round(100 * resultats.filter((st) => ['acquired', 'acquis'].includes(st.result)).length / resultats.length) : null
  const prochaine = upcoming[0] || null

  const DocButton = ({ s, kind, icon: Icon, label, disabled }) => {
    const key = `${s.id}:${kind}`
    return (
      <div className="flex items-stretch gap-1">
        <button onClick={() => download(s, kind)} disabled={disabled || !!busy || !orgReady}
          className="vitrine-doc flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2.5 rounded-ui border border-gray-200 bg-white text-sm text-gray-700 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-800 disabled:opacity-40 disabled:cursor-not-allowed text-left">
          <span className="shrink-0 w-8 h-8 rounded-ui-sm bg-gray-50 flex items-center justify-center">
            {busy === key ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Icon className="w-4 h-4" aria-hidden="true" />}
          </span>
          <span className="min-w-0 flex-1">{label}</span>
          {!busy && !disabled && <Download className="w-4 h-4 text-gray-400" aria-hidden="true" />}
        </button>
        <button type="button" onClick={() => download(s, kind, true)} disabled={disabled || !!busy || !orgReady} title="Imprimer" aria-label={`Imprimer : ${label}`}
          className="px-3 rounded-ui border border-gray-200 bg-white text-gray-500 hover:border-primary-300 hover:text-primary-700 disabled:opacity-40 disabled:cursor-not-allowed">
          <Printer className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    )
  }

  const SessionCard = ({ s, finished, index }) => {
    const nb = (s.session_trainees || []).length
    const nbResults = (s.session_trainees || []).filter(st => st.result).length
    const lieu = [s.location_name, s.location_address, [s.location_postal_code, s.location_city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    const dates = s.start_date === s.end_date ? fmtDate(s.start_date) : `${fmtDate(s.start_date)} au ${fmtDate(s.end_date)}`
    const enCours = !finished && s.start_date && joursAvant(s.start_date) <= 0
    const d = s.start_date ? parseISO(s.start_date) : null
    return (
      <article className="vitrine-monte vitrine-carte bg-white rounded-ui-lg border border-gray-200 overflow-hidden" style={{ '--delai': `${Math.min(index, 8) * 70}ms` }}>
        <div className="flex flex-col sm:flex-row">
          <div className={`shrink-0 sm:w-24 flex sm:flex-col items-baseline sm:items-center justify-start sm:justify-center gap-2 sm:gap-0 px-4 py-2 sm:py-4 ${finished ? 'bg-gray-50 text-gray-600' : 'bg-primary-900 text-white'}`}>
            {d && <>
              <span className="font-display text-xl sm:text-3xl font-semibold leading-none sm:my-1 sm:order-2">{format(d, 'd')}</span>
              <span className="text-xs uppercase tracking-wide opacity-70 sm:order-1">{format(d, 'MMMM', { locale: fr })}</span>
              <span className="text-xs opacity-70 sm:order-3">{format(d, 'yyyy')}</span>
            </>}
          </div>
          <div className="min-w-0 flex-1 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <h3 className="font-display font-semibold text-gray-900 text-lg leading-snug">{s.courses?.title || 'Formation'}</h3>
              <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${finished ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : enCours ? 'bg-accent-500/10 text-accent-700' : 'bg-primary-50 text-primary-700'}`}>
                {finished ? 'Réalisée' : enCours ? 'En cours' : `Dans ${joursAvant(s.start_date)} jour${joursAvant(s.start_date) > 1 ? 's' : ''}`}
              </span>
            </div>
            <div className="mt-2 grid gap-1 text-sm text-gray-600">
              <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />{dates}{s.start_time ? `, ${String(s.start_time).slice(0, 5).replace(':', 'h')} à ${String(s.end_time || '').slice(0, 5).replace(':', 'h')}` : ''}</span>
              {lieu && <span className="flex items-start gap-1.5"><MapPin className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" aria-hidden="true" />{lieu}</span>}
              <span className="flex items-center gap-1.5"><Users className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />{nb} participant{nb > 1 ? 's' : ''}{s.trainers ? `, formateur ${s.trainers.first_name} ${s.trainers.last_name}` : ''}</span>
            </div>
            {!finished && <RecapSession s={s} lieu={lieu} sansHoraires />}
            {nb > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Participants">
                {(s.session_trainees || []).map(st => (
                  <li key={st.trainee_id} className={`text-xs px-2 py-1 rounded-full ${st.absent ? 'bg-gray-100 text-gray-400 line-through' : ['acquis', 'acquired'].includes(st.result) ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : 'bg-gray-100 text-gray-700'}`}>
                    {(st.trainees?.last_name || '').toUpperCase()} {st.trainees?.first_name}
                  </li>
                ))}
              </ul>
            )}
            <ParticipantsSession etat={participants[s.id]} onEnregistrer={(liste) => enregistrerParticipants(s.id, liste)} chargerSalaries={chargerSalaries} />
            {!s.convention_signed && !finished && (() => {
              // Session issue d'un devis : la convention se signe une fois la session confirmée et les participants saisis
              const et = participants[s.id]
              const attente = et?.devis ? (et.validation_requise ? 'Votre organisme confirme les dates de la session.' : (et.participants || []).length === 0 ? 'Saisissez d\'abord vos participants.' : (et.participants || []).some((x) => x.statut === 'attente') ? 'votre organisme confirme d\'abord les places en plus du maximum.' : null) : null
              const dep = depotDe('session', s.id)
              if (dep?.status === 'recu') return (
                <p className="mt-4 rounded-ui border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">Convention signée et déposée le {fmtDate(dep.deposited_at)} : votre organisme la valide.</p>
              )
              return (
                <div className="mt-4 rounded-ui border border-accent-500/30 bg-accent-500/5 p-3 flex items-center gap-3 flex-wrap">
                  <FileSignature className="w-5 h-5 text-accent-600 shrink-0" aria-hidden="true" />
                  <p className="text-sm text-gray-700 flex-1 min-w-[12rem]">{attente ? `Convention de formation : ${attente}` : 'La convention de formation attend votre signature.'}
                    {dep?.status === 'refuse' && <span className="block text-[rgb(var(--c-danger))]">Dépôt précédent refusé{dep.motif ? ` : ${dep.motif}` : ''}.</span>}</p>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" onClick={() => setASigner(s)} disabled={!!attente} className="btn btn-primary btn-sm">Signer en ligne</button>
                    <button type="button" onClick={() => setADeposer({ session: s })} disabled={!!attente} className="btn btn-secondary btn-sm">Imprimer, signer, déposer</button>
                  </div>
                </div>
              )
            })()}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {s.convention_signed
                ? <DocButton s={s} kind="convention_signee" icon={FileSignature} label={signatureDe(s.id) ? 'Convention signée, avec sa preuve' : 'Convention signée'} />
                : <DocButton s={s} kind="convention" icon={FileSignature} label="Convention de formation" />}
              {/* Session issue d'un devis : convocations après la convention signée (l'organisme les valide et les envoie) */}
              <DocButton s={s} kind="convocations" icon={FileText} label={convocationsEnAttente(s) ? 'Convocations (après validation par votre organisme)' : 'Convocations'} disabled={nb === 0 || convocationsEnAttente(s)} />
              <DocButton s={s} kind="emargement" icon={ClipboardList} label="Feuille d'émargement" disabled={nb === 0} />
              <DocButton s={s} kind="attestations" icon={BadgeCheck} label="Attestations de présence" disabled={!finished || nb === 0} />
              <DocButton s={s} kind="certificats" icon={Award} label="Certificats de réalisation" disabled={!finished || nbResults === 0} />
              <DocButton s={s} kind="fins_formation" icon={Award} label="Attestations de fin de formation" disabled={!finished || nbResults === 0} />
            </div>
            {!finished && <p className="mt-2 text-xs text-gray-400">Attestations et certificats disponibles à l'issue de la formation.</p>}
          </div>
        </div>
      </article>
    )
  }

  const site = org?.website ? String(org.website).replace(/^https?:\/\//, '') : null
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'rgb(var(--ground))' }}>
      <header className="sticky top-0 z-10 bg-white/85 backdrop-blur border-b border-gray-200" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <Marque branding={branding} />
          <span className="flex items-center gap-2">
            <button type="button" onClick={() => setSecurite(true)} className="btn btn-ghost btn-sm flex items-center gap-1.5"><KeyRound className="w-4 h-4" aria-hidden="true" /><span className="hidden sm:inline">{accesInfos && !accesInfos.compte ? 'Sécurité et compte' : 'Sécurité'}</span></button>
            <button onClick={logout} className="btn btn-secondary btn-sm flex items-center gap-1.5"><LogOut className="w-4 h-4" aria-hidden="true" />Quitter</button>
          </span>
        </div>
      </header>

      <section className="relative overflow-hidden bg-primary-900 text-white">
        <Halos />
        <div className="relative max-w-5xl mx-auto px-4 py-8 sm:py-10">
          <div className="flex items-center gap-4">
            <Avatar photo={perso.photo} prenom={perso.prenom} taille="w-14 h-14 sm:w-16 sm:h-16" className="vitrine-monte" />
            <div className="min-w-0">
              <h1 className="vitrine-monte font-display text-2xl sm:text-3xl font-semibold truncate" style={{ '--delai': '80ms' }}>{salutation(perso.prenom)}</h1>
              <p className="vitrine-monte text-white/70 mt-0.5 truncate" style={{ '--delai': '140ms' }}>{sessionsToutes.length ? (branding.org_name ? `Vos formations avec ${branding.org_name}` : 'Vos formations') : (branding.org_name ? `Votre espace ${branding.org_name}` : 'Votre espace')}</p>
            </div>
          </div>
          <button type="button" onClick={() => setPersoOuvert(true)} className="vitrine-monte mt-4 inline-flex items-center gap-1.5 text-sm text-white/80 hover:text-white underline-offset-4 hover:underline" style={{ '--delai': '200ms' }}>
            <Sparkles className="w-4 h-4" aria-hidden="true" />Personnaliser mon espace
          </button>
          {sessionsToutes.length > 0 && <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Chiffre valeur={past.length} libelle="Réalisées" icone={GraduationCap} delai={200} />
            <Chiffre valeur={upcoming.length} libelle="À venir" icone={Calendar} delai={260} />
            <Chiffre valeur={formes.size} libelle="Salariés formés" icone={Users} delai={320} />
            {reussite != null
              ? <Chiffre valeur={reussite} suffixe=" %" libelle="Réussite" icone={Award} delai={380} />
              : <Chiffre valeur={sessionsToutes.length} libelle="Formations" icone={FileText} delai={380} />}
          </div>}
          {prochaine && (
            <div className="vitrine-monte mt-5 rounded-ui-lg bg-white text-gray-900 p-4 flex items-center gap-4 flex-wrap" style={{ '--delai': '440ms' }}>
              <span className="w-10 h-10 rounded-full bg-accent-500/10 text-accent-600 flex items-center justify-center shrink-0"><Clock className="w-5 h-5" aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-gray-500">Prochaine formation</p>
                <p className="font-medium">{prochaine.courses?.title || 'Formation'}, le {fmtDate(prochaine.start_date)}</p>
              </div>
              <span className="text-sm font-semibold text-accent-700">{joursAvant(prochaine.start_date) <= 0 ? 'En cours' : `J-${joursAvant(prochaine.start_date)}`}</span>
            </div>
          )}
        </div>
      </section>

      {nouvelAppareil && (
        <div role="alert" className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm">
          <div className="max-w-5xl mx-auto px-4 py-2.5 flex flex-wrap items-center gap-2">
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            <span className="flex-1 min-w-[12rem]">Première ouverture de votre espace sur cet appareil. Si ce n'est pas vous ou un collègue, changez le code.</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSecurite(true)}>Voir</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNouvelAppareil(false)}>C'est moi</button>
          </div>
        </div>
      )}
      {securite && <SecuriteEspace mode="lien" token={token} code={code} infos={accesInfos} appareils={appareils} onFermer={() => setSecurite(false)}
        onCode={(n) => { setCode(n); try { sessionStorage.setItem(STORAGE_KEY(token), n) } catch { /* ignore */ } }} />}
      {persoOuvert && <PersonnaliserEspace prenom={perso.prenom} photo={perso.photo} onEnregistrer={enregistrerPerso} onFermer={() => setPersoOuvert(false)}
        note="Votre choix reste sur cet appareil : il ne change rien pour vos collègues." />}
      <main className="max-w-5xl mx-auto px-4 py-8 w-full flex-1">
        {error && <p role="alert" className="mb-4 text-sm text-[rgb(var(--c-danger))] flex items-center gap-1.5"><AlertCircle className="w-4 h-4" aria-hidden="true" />{error}</p>}
        {info && <p role="status" className="vitrine-monte mb-4 rounded-ui bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] text-sm px-3 py-2 flex items-center gap-2"><BadgeCheck className="w-4 h-4" aria-hidden="true" />{info}</p>}

        <NumerosDemandes charger={chargerDemandesNir} transmettre={transmettreNir} />
        {upcoming.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">À venir ou en cours</h2>
            <div className="space-y-4">{upcoming.map((s, k) => <SessionCard key={s.id} s={s} finished={false} index={k} />)}</div>
          </section>
        )}
        {past.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Formations réalisées</h2>
            <div className="space-y-4">{past.map((s, k) => <SessionCard key={s.id} s={s} finished index={k + upcoming.length} />)}</div>
          </section>
        )}
        {upcoming.length === 0 && past.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-10">Rien pour le moment : vos devis, conventions, rapports et documents arriveront ici.</p>
        )}

        {/* Documents mis à disposition, toutes prestations (0404) */}
        <MesDocuments rafraichir={tourDocs}
          onDeposer={(d) => setADeposer({ doc: d })}
          depotDe={(d) => (d.object_type === 'quote' ? depotDe('quote', d.object_id) : null)}
          signatureDe={(d) => signatures.find((x) => x.document_id === d.id) || null}
          onSigner={setDocASigner} aSignerEnPlus={rapportsASigner}
          avecPreuve={(d, buf, sig) => signeAvecPreuve(d, buf, sig, orgPdf)}
          charger={async () => (await supabase.rpc('client_portal_mes_documents', { p_token: token, p_code: code })).data}
          lire={(d) => lireDocumentPortail({ token, code }, d.id)}
          noter={(d, buf) => noterLien(token, code, { event: 'document', objectType: d.object_type, objectId: d.object_id, kind: d.kind, label: d.label, base64: versBase64(buf) })} />

        {org && (org.phone || org.email || site) && (
          <section className="vitrine-monte rounded-ui-lg border border-gray-200 bg-white p-5 sm:p-6 grid gap-5 sm:grid-cols-[1fr_auto] items-center">
            <div>
              <h2 className="font-display text-lg font-semibold text-gray-900">Une question, un nouveau besoin ?</h2>
              <p className="text-sm text-gray-500 mt-1">L'équipe {branding.org_name} vous répond pour organiser vos prochaines formations.</p>
              {org.referent_handicap_nom && (
                <p className="text-sm text-gray-600 mt-3 flex items-start gap-1.5"><Accessibility className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" aria-hidden="true" />
                  Référent handicap : {org.referent_handicap_nom}{org.referent_handicap_email ? `, ${org.referent_handicap_email}` : ''}{org.referent_handicap_phone ? `, ${org.referent_handicap_phone}` : ''}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 min-w-0">
              {org.phone && <a href={`tel:${String(org.phone).replace(/\s/g, '')}`} className="btn btn-primary justify-center gap-2"><Phone className="w-4 h-4" aria-hidden="true" />{org.phone}</a>}
              {org.email && <a href={`mailto:${org.email}`} className="btn btn-secondary justify-center gap-2 truncate"><Mail className="w-4 h-4" aria-hidden="true" />{org.email}</a>}
              {site && <a href={`https://${site}`} target="_blank" rel="noreferrer" className="text-sm text-gray-500 hover:text-gray-800 flex items-center justify-center gap-1.5"><Globe className="w-4 h-4" aria-hidden="true" />{site}</a>}
            </div>
          </section>
        )}
      </main>

      {aDeposer && (
        <DeposerSigne nomDocument={aDeposer.doc ? 'le devis' : 'la convention'}
          titre={aDeposer.doc ? 'Imprimer, signer et déposer le devis' : 'Imprimer, signer et déposer la convention'}
          telecharger={async () => {
            if (aDeposer.doc) {
              const buf = await lireDocumentPortail({ token, code }, aDeposer.doc.id)
              saveBase64(versBase64(buf), `${(aDeposer.doc.label || 'devis').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '_')}.pdf`)
            } else await download(aDeposer.session, 'convention')
          }}
          envoyer={async ({ base64, avant }) => {
            await deposerSigne({ token, code }, aDeposer.doc ? { document_id: aDeposer.doc.id } : { session_id: aDeposer.session.id }, { base64, avant })
            await chargerDepots()
            setInfo('Document signé déposé. Votre organisme est prévenu et le valide.')
          }}
          onFermer={() => setADeposer(null)} />
      )}

      {docASigner && (
        <SignerConvention titre={NOMS_SIGNABLES[docASigner.kind]?.titre} nomDocument={NOMS_SIGNABLES[docASigner.kind]?.nom}
          accord={docASigner.kind === 'contrat' ? ACCORD_CONTRAT : docASigner.kind === 'rapport' ? ACCORD_BON : ACCORD_DEVIS} libelle={docASigner.label} signataire={{}}
          genererPdf={async () => ({ base64: versBase64(await lireDocumentPortail({ token, code }, docASigner.id)), filename: `${docASigner.label}.pdf` })}
          onSigner={async (p) => {
            const { data: r, error: e } = await supabase.rpc('client_portal_signer_document', { p_token: token, p_code: code, p_document: docASigner.id,
              p_name: p.name, p_role: p.role, p_signature: p.signature, p_consent: p.consent })
            if (e) throw new Error(e.message)
            if (r?.error) throw new Error(r.error)
            await chargerSignatures()
            setDocASigner(null); setTourDocs((n) => n + 1)
            setInfo(`${docASigner.label} : signé. Merci ! Le document signé et sa preuve sont dans vos documents.`)
          }}
          onFermer={() => setDocASigner(null)} />
      )}
      {aSigner && (
        <SignerConvention session={aSigner} signataire={{ name: aSigner.signatory_name, role: aSigner.signatory_role }}
          genererPdf={() => generatePDF('convention', toPdfSession(aSigner), { trainees: traineesOf(aSigner), trainer: aSigner.trainers || null, costs: [] })}
          onSigner={(p) => signer(aSigner, p)} onFermer={() => setASigner(null)} />
      )}

      <footer className="border-t border-gray-200 bg-white" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="max-w-5xl mx-auto px-4 py-4 text-center text-xs text-gray-500">
          {branding.org_name}{branding.qualiopi_certified ? ', organisme certifié Qualiopi' : ''}{org?.nda ? `, déclaration d'activité ${org.nda}` : ''}
        </div>
      </footer>
    </div>
  )
}

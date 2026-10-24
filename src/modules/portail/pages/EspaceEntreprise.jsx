import { useCallback, useEffect, useMemo, useState } from 'react'
import { fichierDeLInstance } from '../../../core/fichiersInstance'
import toast from 'react-hot-toast'
import {
  Home, GraduationCap, Users, MessageSquare, MoreHorizontal, Calendar, MapPin, FileText, FileSignature, ClipboardList,
  Award, BadgeCheck, Download, Loader2, LogOut, AlertCircle, BookOpen, Receipt, Megaphone, ExternalLink, Send, Plus, Trash2, ShieldCheck, FolderOpen, Printer,
} from 'lucide-react'
import { format, parseISO, isAfter, startOfToday } from 'date-fns'
import { fr as frLocale } from 'date-fns/locale'
import { supabase } from '../../../core/supabase'
import { callApi } from '../../../core/api'
import { useAuthStore } from '../../../core/store'
import PublicLayout from '../../../app/PublicLayout'
import { useBranding } from '../../../core/branding/BrandingProvider'
import { BandeauAccueil, PersonnaliserEspace } from '../components/Vitrine'
import { useMonProfil } from '../lib/monProfil'
import { prepareOrgForPDF } from '../../../core/org/orgUtils'
import { setOrganization, generatePDF, generateAllPDF } from '../../formation/pdf/pdfGenerator'
import { pdfOrgFrom } from '../../../core/pdf/pdfOrg'
import RegistreVue from '../../registre/components/RegistreVue'
import { ouvrirFichier, readableUrl } from '../../../core/storageUtils'
import { appliquerEmis } from '../../formation/lib/documentsEmis'
import { noterCompte, premiereConnexionDuJour, LIBELLES_DOCUMENT } from '../../../core/portail/journal'
import SignerConvention, { ACCORD_DEVIS, ACCORD_CONTRAT } from '../components/SignerConvention'
import { NOMS_SIGNABLES, signeAvecPreuve } from '../lib/signatureDocument'
import { deposerConvention, conventionSignee } from '../lib/conventionSignee'
import MesDocuments from '../components/MesDocuments'
import AvisEntreprise from '../components/AvisEntreprise'
import ParticipantsSession from '../components/ParticipantsSession'
import NumerosDemandes from '../components/NumerosDemandes'
import DeposerSigne from '../components/DeposerSigne'
import RecapSession from '../components/RecapSession'
import { imprimer } from '../../../core/fichiers/imprimer'
import { rechargerSiMiseAJour } from '../../../core/errors/chunkReload'
import { lireDocumentPortail, versBase64, deposerSigne } from '../../../core/portail/documentsClient'
import { empreinteAppareil } from '../../../core/portail/appareil'
import SecuriteEspace from '../components/SecuriteEspace'

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
  // Accueil « Bonjour » + prénom du compte (jamais le nom de l'entreprise), photo ou logo choisis par la personne
  const { branding } = useBranding()
  const moi = useMonProfil()
  const [perso, setPerso] = useState(false)
  // Sécurité (0449) : appareils du compte, alerte au premier passage d'un appareil inconnu, mot de passe
  const [securite, setSecurite] = useState(false)
  const [appareils, setAppareils] = useState([])
  const [nouvelAppareil, setNouvelAppareil] = useState(false)
  // Registre de sécurité (fonction 11) : proposé si le module est actif ; dossier de dépôt du compte
  const [mods, setMods] = useState({ registre: false })
  useEffect(() => { supabase.rpc('ent_modules').then(({ data }) => { if (data) setMods(data) }) }, [])

  const charger = async () => {
    const { data, error } = await supabase.rpc('ent_accueil')
    if (error) { setErreur(error.message?.includes('désactivé') || error.code === '42501' ? 'Votre accès à l\'espace entreprise n\'est pas actif. Contactez votre organisme de formation.' : 'Espace momentanément indisponible, réessayez dans quelques instants.'); return }
    setAccueil(data)
    // Journal de preuve (0401) : connexion notée une fois par jour et par onglet
    if (premiereConnexionDuJour('compte')) noterCompte({ event: 'connexion' })
    try {
      const { data: ap } = await supabase.rpc('ent_appareil', { p_device: await empreinteAppareil() })
      if (ap && !ap.error) { setAppareils(ap.appareils || []); setNouvelAppareil(!!ap.nouveau) }
    } catch { /* fonction absente : rien ne casse */ }
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
    <PublicLayout title="Espace entreprise" bandeau={(
      <BandeauAccueil branding={branding} libelle="Espace entreprise" prenom={moi.prenom} photo={moi.photo}
        sousTitre={`Votre espace avec ${accueil.org?.name || branding.org_name || 'votre organisme'}`}
        onPersonnaliser={() => setPerso(true)} onQuitter={logout} onSecurite={() => setSecurite(true)} />
    )}>
      {perso && <PersonnaliserEspace prenom={moi.prenom} photo={moi.photo} onEnregistrer={moi.enregistrer} onFermer={() => setPerso(false)} />}
      {securite && <SecuriteEspace mode="compte" appareils={appareils} onFermer={() => setSecurite(false)} />}
      {nouvelAppareil && (
        <div role="alert" className="mb-4 rounded-ui bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2.5 flex flex-wrap items-center gap-2">
          <span className="flex-1 min-w-[12rem]">Première connexion à votre compte depuis cet appareil. Si ce n'est pas vous, changez votre mot de passe.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSecurite(true)}>Voir</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNouvelAppareil(false)}>C'est moi</button>
        </div>
      )}
      <div className="pb-20">
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
  const [signatures, setSignatures] = useState([])
  const [aSigner, setASigner] = useState(null)
  // Satisfaction de l'entreprise (0415) : avis déjà donnés et formation en cours d'avis
  const [avis, setAvis] = useState({})
  const [aNoter, setANoter] = useState(null)
  const [avisDispo, setAvisDispo] = useState(false)
  useEffect(() => {
    supabase.rpc('ent_satisfactions').then(({ data, error }) => {
      if (error || !Array.isArray(data)) return
      setAvis(Object.fromEntries(data.map((x) => [x.session_id, x.note_globale])))
      setAvisDispo(true)
    })
  }, [])
  const [orgPdf, setOrgPdf] = useState(null)
  const today = startOfToday()

  // Participants saisis par le client (0430) : état par session, sans effet si la base ne le propose pas encore
  // Convention signée à la main et déposée (0431)
  const [depots, setDepots] = useState([])
  const [aDeposer, setADeposer] = useState(null)
  const chargerDepots = () => supabase.rpc('ent_depots').then(({ data: dp }) => { if (Array.isArray(dp)) setDepots(dp) }).catch(() => {})
  useEffect(() => { chargerDepots() }, [])
  const [participants, setParticipants] = useState({})
  const chargerParticipants = async () => {
    try {
      const { data: p } = await supabase.rpc('ent_participants')
      if (Array.isArray(p)) setParticipants(Object.fromEntries(p.map((x) => [x.session_id, x])))
    } catch { /* fonction absente */ }
  }
  useEffect(() => { chargerParticipants() }, [])
  const enregistrerParticipants = async (sessionId, liste) => {
    const { data: r, error } = await supabase.rpc('ent_participants_enregistrer', { p_session: sessionId, p_liste: liste })
    if (error) throw new Error(error.message)
    const { data: d } = await supabase.rpc('ent_sessions')
    if (d) setData(d)
    await chargerParticipants()
    toast.success(`${r?.nombre ?? liste.length} participant(s) enregistré(s). Votre organisme est prévenu.`)
  }

  // Signatures en ligne du client (0402)
  const chargerSignatures = () => supabase.rpc('ent_signatures').then(({ data: sg }) => setSignatures(Array.isArray(sg) ? sg : []))
  const signatureDe = (sid) => [...signatures].reverse().find((x) => x.session_id === sid && x.document_type === 'convention') || null
  const signer = async (s, p) => {
    const { data: r, error } = await supabase.rpc('ent_signer', { p_session: s.id, p_kind: 'convention', p_sha256: p.sha256, p_name: p.name,
      p_role: p.role, p_signature: p.signature, p_consent: p.consent, p_label: p.label })
    if (error) throw new Error(error.message)
    if (r?.error) throw new Error(r.error)
    // Le PDF exact signé est gardé (son empreinte est vérifiée par le serveur)
    if (r?.id && !r.deja) await deposerConvention({}, r.id, p.base64)
    setData((d) => ({ ...d, sessions: d.sessions.map((x) => (x.id === s.id ? { ...x, convention_signed: true } : x)) }))
    await chargerSignatures()
    setASigner(null)
    toast.success('Convention signée. Merci !')
  }

  useEffect(() => {
    chargerSignatures()
    ;(async () => {
      const [{ data: d, error }, { data: org }] = await Promise.all([supabase.rpc('ent_sessions'), supabase.rpc('ent_org')])
      if (error) { toast.error('Formations indisponibles'); setData({ sessions: [] }); return }
      setData(d)
      if (org) { const pr = await prepareOrgForPDF(org); setOrganization(pr); setOrgPdf(pr); setOrgPret(true) }
    })()
  }, [])

  const { upcoming, past } = useMemo(() => {
    const up = [], pa = []
    ;(data?.sessions || []).forEach((s) => { (s.end_date && !isAfter(today, parseISO(s.end_date)) ? up : pa).push(s) })
    up.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
    return { upcoming: up, past: pa }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // Salariés déjà connus du client, pour les retrouver dans la saisie des participants (0437)
  const chargerSalaries = useCallback(async () => {
    const { data: d, error: e } = await supabase.rpc('ent_salaries_connus')
    return e || !Array.isArray(d) ? [] : d
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // N° de sécurité sociale demandés par les salariés (0440)
  const chargerDemandesNir = useCallback(async () => {
    const { data: d, error: e } = await supabase.rpc('ent_nir_demandes')
    return e || !Array.isArray(d) ? [] : d
  }, [])
  const transmettreNir = async (traineeId, nir) => {
    const { data: d, error: e } = await supabase.rpc('ent_nir_transmettre', { p_trainee: traineeId, p_nir: nir })
    if (e || d?.error) throw new Error(e?.message || d?.error || 'Enregistrement impossible')
    return d
  }

  // Session issue d'un devis (22/10, décision de H) : convocations visibles une fois validées et envoyées par
  // l'organisme (chaque participant présent a reçu la sienne), jamais avant la signature de la convention
  const convocationsEnAttente = (s) => !!participants[s.id]?.devis && (!s.convention_signed
    || !(s.session_trainees || []).filter((st) => !st.absent).every((st) => st.convocation_sent_at))

  const traineesOf = (s) => (s.session_trainees || []).map((st) => ({ ...st.trainees, result: st.result || null, access_code: st.access_code }))

  // Télécharger, ou imprimer directement (22/10) : même document, même trace au journal
  const download = (s, kind, imp = false) => {
    if (!orgPret) return
    if (!imp) return remettreDoc(s, kind, (out) => saveBase64(out.base64, out.filename))
    let fin = null
    const pret = new Promise((r) => { fin = r })
    imprimer(() => pret).catch(() => { /* erreur déjà affichée */ })
    remettreDoc(s, kind, (out) => fin(out.base64)).finally(() => fin(null))
  }

  const remettreDoc = async (s, kind, remettre) => {
    setBusy(`${s.id}:${kind}`)
    try {
      const session = { ...s, clients: data.client, courses: s.courses || {}, trainers: s.trainers || null }
      const trainees = traineesOf(s)
      const trainer = s.trainers || null
      let out = null
      if (kind === 'convention') out = await generatePDF('convention', session, { trainees, trainer, costs: [] })
      // Convention signée en ligne, avec sa page de preuve (0402)
      else if (kind === 'convention_signee') out = await conventionSignee({}, s, signatureDe(s.id), orgPdf,
        () => generatePDF('convention', { ...session, signature_client: signatureDe(s.id) }, { trainees, trainer, costs: [] }))
      else if (kind === 'convocations') out = await generateAllPDF('convocation', session, trainees, { trainer })
      else if (kind === 'emargement') {
        const absents = (s.session_trainees || []).filter((st) => st.absent).map((st) => st.trainee_id)
        let trainerSignatureBase64 = null
        try { trainerSignatureBase64 = (await callApi('/api/espace-entreprise', { action: 'signature', session_id: s.id })).dataUrl || null } catch { /* sans signature */ }
        const has = (s.halfdays || []).length > 0
        out = await generatePDF('emargement', session, { trainees, trainer, isBlank: false,
          attendanceData: has ? { signatures: [], halfdays: s.halfdays || [], proxies: [], absents, trainerSignatureBase64 } : null })
      } else if (kind === 'attestations') {
        // Version émise (0399, 0400) : l'entreprise reçoit le document tel qu'il a été remis
        const { data: emis } = await supabase.rpc('ent_documents_emis')
        out = await generateAllPDF('attestation', session, appliquerEmis(emis, s.id, 'attestation', trainees.filter((t) => !((s.session_trainees || []).find((st) => st.trainee_id === t.id)?.absent))), { trainer })
      } else if (kind === 'certificats') {
        const { data: emis } = await supabase.rpc('ent_documents_emis')
        out = await generateAllPDF('certificat', session, appliquerEmis(emis, s.id, 'certificat', trainees).filter((t) => t.result), { trainer })
      }
      if (!out) { toast.error('Aucun document pour cette session'); return }
      remettre(out)
      // Journal de preuve (0401) : document remis, avec son empreinte
      noterCompte({ event: 'document', objectType: 'session', objectId: s.id, kind, label: `${LIBELLES_DOCUMENT[kind] || kind}, ${s.reference || ''}`.trim(), base64: out.base64 })
    } catch (err) {
      if (rechargerSiMiseAJour(err)) return
      toast.error(`Document impossible : ${err.message || 'erreur'}`)
    } finally { setBusy(null) }
  }

  if (!data) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>

  const Doc = ({ s, kind, icon: Icon, label, disabled }) => (
    <div className="flex items-stretch gap-1">
      <button type="button" onClick={() => download(s, kind)} disabled={disabled || !!busy || !orgPret}
        className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-ui border border-gray-200 bg-white text-sm text-gray-700 hover:border-primary-300 disabled:opacity-40">
        {busy === `${s.id}:${kind}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}<span className="truncate">{label}</span>
        <Download className="w-3.5 h-3.5 ml-auto text-gray-400 shrink-0" />
      </button>
      <button type="button" onClick={() => download(s, kind, true)} disabled={disabled || !!busy || !orgPret} title="Imprimer" aria-label={`Imprimer : ${label}`}
        className="px-2.5 rounded-ui border border-gray-200 bg-white text-gray-500 hover:border-primary-300 hover:text-primary-700 disabled:opacity-40">
        <Printer className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
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
        {!finie && <RecapSession s={s} lieu={lieu} />}
        {nb > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {s.session_trainees.map((st) => (
              <li key={st.trainee_id} className={`text-xs px-2 py-1 rounded-full ${st.absent ? 'bg-gray-100 text-gray-400 line-through' : ['acquis', 'acquired'].includes(st.result) ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : 'bg-gray-100 text-gray-700'}`}>
                {(st.trainees?.last_name || '').toUpperCase()} {st.trainees?.first_name}
              </li>
            ))}
          </ul>
        )}
        {!s.group_id && <ParticipantsSession etat={participants[s.id]} onEnregistrer={(liste) => enregistrerParticipants(s.id, liste)} chargerSalaries={chargerSalaries} />}
        {!s.group_id && !s.convention_signed && !finie && (() => {
          // Session issue d'un devis : la convention se signe une fois la session confirmée et les participants saisis
          const et = participants[s.id]
          const attente = et?.devis ? (et.validation_requise ? 'Votre organisme confirme les dates de la session.' : (et.participants || []).length === 0 ? 'Saisissez d\'abord vos participants.' : (et.participants || []).some((x) => x.statut === 'attente') ? 'votre organisme confirme d\'abord les places en plus du maximum.' : null) : null
          const dep = depots.find((x) => x.object_type === 'session' && x.object_id === s.id) || null
          if (dep?.status === 'recu') return (
            <p className="mt-3 rounded-ui border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">Convention signée et déposée le {fmtDate(dep.deposited_at)} : votre organisme la valide.</p>
          )
          return (
            <div className="mt-3 rounded-ui border border-accent-500/30 bg-accent-500/5 p-3 flex items-center gap-3 flex-wrap">
              <FileSignature className="w-5 h-5 text-accent-600 shrink-0" aria-hidden="true" />
              <p className="text-sm text-gray-700 flex-1 min-w-[12rem]">{attente ? `Convention de formation : ${attente}` : 'La convention de formation attend votre signature.'}
                {dep?.status === 'refuse' && <span className="block text-[rgb(var(--c-danger))]">Dépôt précédent refusé{dep.motif ? ` : ${dep.motif}` : ''}.</span>}</p>
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={() => setASigner(s)} disabled={!!attente} className="btn btn-primary btn-sm">Signer en ligne</button>
                <button type="button" onClick={() => setADeposer(s)} disabled={!!attente} className="btn btn-secondary btn-sm">Imprimer, signer, déposer</button>
              </div>
            </div>
          )
        })()}
        {finie && avisDispo && (
          <div className="mt-3 rounded-ui border border-gray-200 bg-gray-50 p-3 flex items-center gap-3 flex-wrap">
            <Award className="w-5 h-5 text-accent-600 shrink-0" aria-hidden="true" />
            <p className="text-sm text-gray-700 flex-1 min-w-[12rem]">
              {avis[s.id] ? `Merci pour votre avis (${avis[s.id]} sur 5).` : 'Votre avis sur cette formation nous aide à progresser.'}
            </p>
            <button type="button" onClick={() => setANoter(s)} className={`btn btn-sm ${avis[s.id] ? 'btn-secondary' : 'btn-primary'}`}>{avis[s.id] ? 'Modifier' : 'Donner mon avis'}</button>
          </div>
        )}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {!s.group_id && (s.convention_signed
            ? <Doc s={s} kind="convention_signee" icon={FileSignature} label={signatureDe(s.id) ? 'Convention signée, avec sa preuve' : 'Convention signée'} />
            : <Doc s={s} kind="convention" icon={FileSignature} label="Convention" />)}
          <Doc s={s} kind="convocations" icon={FileText} label={convocationsEnAttente(s) ? 'Convocations (après validation par votre organisme)' : 'Convocations'} disabled={nb === 0 || convocationsEnAttente(s)} />
          <Doc s={s} kind="emargement" icon={ClipboardList} label="Émargement" disabled={nb === 0} />
          <Doc s={s} kind="attestations" icon={BadgeCheck} label="Attestations" disabled={!finie || nb === 0} />
          <Doc s={s} kind="certificats" icon={Award} label="Certificats" disabled={!finie || !(s.session_trainees || []).some((st) => st.result)} />
        </div>
      </Carte>
    )
  }

  return (
    <div className="space-y-5">
      <NumerosDemandes charger={chargerDemandesNir} transmettre={transmettreNir} />
      {upcoming.length > 0 && <section><h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">À venir ou en cours</h2><div className="space-y-3">{upcoming.map((s) => <Session key={`${s.id}${s.group_id || ''}`} s={s} finie={false} />)}</div></section>}
      {aSigner && (
        <SignerConvention session={aSigner} signataire={{ name: aSigner.signatory_name, role: aSigner.signatory_role }}
          genererPdf={() => generatePDF('convention', { ...aSigner, clients: data.client, courses: aSigner.courses || {}, trainers: aSigner.trainers || null }, { trainees: traineesOf(aSigner), trainer: aSigner.trainers || null, costs: [] })}
          onSigner={(p) => signer(aSigner, p)} onFermer={() => setASigner(null)} />
      )}
      {aDeposer && (
        <DeposerSigne nomDocument="la convention" titre="Imprimer, signer et déposer la convention"
          telecharger={async () => {
            const out = await generatePDF('convention', { ...aDeposer, clients: data.client, courses: aDeposer.courses || {}, trainers: aDeposer.trainers || null }, { trainees: traineesOf(aDeposer), trainer: aDeposer.trainers || null, costs: [] })
            if (out) saveBase64(out.base64, out.filename)
          }}
          envoyer={async ({ base64, avant }) => {
            await deposerSigne({}, { session_id: aDeposer.id }, { base64, avant })
            await chargerDepots()
            toast.success('Convention signée déposée. Votre organisme est prévenu.')
          }}
          onFermer={() => setADeposer(null)} />
      )}
      {aNoter && <AvisEntreprise session={aNoter} onFermer={() => setANoter(null)} onEnvoye={(id, n) => setAvis((a) => ({ ...a, [id]: n }))} />}
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
  const [vue, setVue] = useState('documents')
  // Signature des devis et contrats mis à disposition (0406)
  const [signatures, setSignatures] = useState([])
  const [docASigner, setDocASigner] = useState(null)
  const [tourDocs, setTourDocs] = useState(0)
  const [orgDoc, setOrgDoc] = useState(null)
  const chargerSignatures = () => supabase.rpc('ent_signatures').then(({ data: sg }) => setSignatures(Array.isArray(sg) ? sg : []))
  const chargerOrg = async () => { const { data } = await supabase.rpc('ent_org'); const pr = await prepareOrgForPDF(data || {}); setOrgDoc(pr); return pr }
  useEffect(() => { chargerSignatures() }, [])
  // Devis signé à la main et déposé (0431)
  const [depots, setDepots] = useState([])
  const [docADeposer, setDocADeposer] = useState(null)
  const chargerDepots = () => supabase.rpc('ent_depots').then(({ data: dp }) => { if (Array.isArray(dp)) setDepots(dp) }).catch(() => {})
  useEffect(() => { chargerDepots() }, [])
  const [catalogue, setCatalogue] = useState(null)
  const [factures, setFactures] = useState(null)
  const [actus, setActus] = useState(null)
  useEffect(() => {
    if (vue === 'catalogue' && !catalogue) supabase.rpc('ent_catalogue').then(({ data }) => setCatalogue(data || { formations: [], sessions_inter: [] }))
    if (vue === 'factures' && !factures) supabase.rpc('ent_factures').then(({ data }) => setFactures(data || []))
    if (vue === 'actus' && !actus) supabase.rpc('ent_actus').then(({ data }) => setActus(data || []))
  }, [vue])
  const VUES = [['documents', 'Documents', FolderOpen], ['catalogue', 'Catalogue', BookOpen], ...(salaries ? [['salaries', 'Salariés', Users]] : []), ...(compte?.can_see_invoices ? [['factures', 'Factures', Receipt]] : []), ['actus', 'Actualités', Megaphone]]
  const chargement = <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto">
        {VUES.map(([k, l, Icon]) => (
          <button key={k} type="button" onClick={() => setVue(k)} className={`btn btn-sm ${vue === k ? 'btn-primary' : 'btn-secondary'}`}><Icon className="w-4 h-4" /> {l}</button>
        ))}
      </div>
      {vue === 'documents' && (
        <>
          <MesDocuments titre="Documents mis à disposition" rafraichir={tourDocs}
            onDeposer={setDocADeposer}
            depotDe={(d) => (d.object_type === 'quote' ? depots.find((x) => x.object_type === 'quote' && x.object_id === d.object_id) || null : null)}
            signatureDe={(d) => signatures.find((x) => x.document_id === d.id) || null}
            onSigner={setDocASigner}
            avecPreuve={async (d, buf, sig) => signeAvecPreuve(d, buf, sig, orgDoc || await chargerOrg())}
            charger={async () => (await supabase.rpc('ent_mes_documents')).data}
            lire={(d) => lireDocumentPortail({}, d.id)}
            noter={(d, buf) => noterCompte({ event: 'document', objectType: d.object_type, objectId: d.object_id, kind: d.kind, label: d.label, base64: versBase64(buf) })} />
          <p className="text-xs text-gray-400">Rapports d'intervention, devis, factures et contrats mis à disposition par {org?.name || 'votre prestataire'} apparaissent ici.</p>
          {docADeposer && (
            <DeposerSigne nomDocument="le devis" titre="Imprimer, signer et déposer le devis"
              telecharger={async () => saveBase64(versBase64(await lireDocumentPortail({}, docADeposer.id)), `${(docADeposer.label || 'devis').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '_')}.pdf`)}
              envoyer={async ({ base64, avant }) => {
                await deposerSigne({}, { document_id: docADeposer.id }, { base64, avant })
                await chargerDepots(); setTourDocs((n) => n + 1)
                toast.success('Devis signé déposé. Votre organisme est prévenu.')
              }}
              onFermer={() => setDocADeposer(null)} />
          )}
          {docASigner && (
            <SignerConvention titre={NOMS_SIGNABLES[docASigner.kind]?.titre} nomDocument={NOMS_SIGNABLES[docASigner.kind]?.nom}
              accord={docASigner.kind === 'contrat' ? ACCORD_CONTRAT : ACCORD_DEVIS} libelle={docASigner.label} signataire={{ name: compte?.contact?.name || '' }}
              genererPdf={async () => ({ base64: versBase64(await lireDocumentPortail({}, docASigner.id)), filename: `${docASigner.label}.pdf` })}
              onSigner={async (p) => {
                const { data: r, error } = await supabase.rpc('ent_signer_document', { p_document: docASigner.id, p_name: p.name, p_role: p.role, p_signature: p.signature, p_consent: p.consent })
                if (error) throw new Error(error.message)
                if (r?.error) throw new Error(r.error)
                await chargerSignatures()
                setDocASigner(null); setTourDocs((n) => n + 1)
                toast.success('Document signé. Merci !')
              }}
              onFermer={() => setDocASigner(null)} />
          )}
        </>
      )}
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

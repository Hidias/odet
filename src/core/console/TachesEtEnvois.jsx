import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CheckCircle2, AlertTriangle, XCircle, Clock, PauseCircle } from 'lucide-react'
import { supabase } from '../supabase'
import { useAuthStore } from '../store'
import { confirmer, demander } from '../../ui/Confirm'
import { getCurrentCompanyId } from '../company/companyContext'

// Journal des tâches planifiées (0382, audit du 19/10 au soir) et réglage des envois (0519).
//  - TachesPlanifiees : dernier passage de chaque tâche (Console, super administrateur).
//  - EnvoisAutomatiques : un réglage par type d'envoi (0519, décisions de H du 08/11 et du 16/11) : fermé, à valider
//    (défaut) ou automatique. Un administrateur de la société ferme ou remet à valider ; seul le super administrateur
//    passe en automatique, après deux confirmations. Proposition de l'automatique après 5 envois validés sans
//    retouche ; l'outil ne bascule jamais seul. La suspension de 24 heures reste (décision de H du 19/10 à 23h14).

// Heures des tâches : le planning de vercel.json est en heure universelle ; l'heure annoncée est celle de Paris
// le jour de la consultation (une heure de moins en hiver qu'en été).
export function heureDeParis(heureUtc, minuteUtc = 0, jour = new Date()) {
  const d = new Date(Date.UTC(jour.getUTCFullYear(), jour.getUTCMonth(), jour.getUTCDate(), heureUtc, minuteUtc))
  const h = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Paris' }).format(d)
  return `${parseInt(h, 10)}h`
}

export function rythmeDe(t, jour = new Date()) {
  if (!t.utc) return t.rythme
  return t.rythme.replace('{h}', heureDeParis(t.utc[0], t.utc[1] || 0, jour))
}

// `utc` : heure et minute du planning de vercel.json (tests/console-taches.test.js vérifie la concordance)
export const TACHES = [
  { job: 'maintenance-nuit', label: 'Préparation de la nuit (relances, rappels, étapes des sessions, purges à valider, titres exigés)', rythme: 'Chaque nuit, vers {h}', utc: [2, 10] },
  { job: 'sync-sent-emails', label: 'Synchronisation des emails envoyés', rythme: 'Toutes les 30 min en journée, en semaine' },
  { job: 'signature-alert', label: 'Alertes de signature', rythme: 'En semaine, vers {h}', utc: [7, 0] },
  { job: 'signature-weekly', label: 'Bilan des signatures', rythme: 'Le lundi, vers {h}', utc: [7, 0] },
  { job: 'mailing-replies-cron', label: 'Réponses aux campagnes', rythme: 'Chaque jour, vers {h}', utc: [5, 0] },
  { job: 'social/cron-publish', label: 'Publication des posts programmés', rythme: 'Toutes les 5 min' },
  { job: 'import-auto-cron', label: 'Import automatique des prospects', rythme: 'Chaque nuit, vers {h}', utc: [2, 0] },
  { job: 'enrich-prospects', label: 'Enrichissement des prospects', rythme: 'Chaque nuit, vers {h}', utc: [3, 0] },
  { job: 'mailing-cron', label: 'Envoi des campagnes email', rythme: 'Selon les campagnes' },
  { job: 'relances-circuit', label: 'Relances du circuit et envois automatiques', rythme: 'En semaine, vers {h}', utc: [8, 0] },
]

export const TYPES_ENVOI = [
  { kind: 'relance_recyclage', label: 'Relances de recyclage', aide: 'Aux clients dont des salariés arrivent en fin de validité' },
  { kind: 'relance_impaye', label: "Relances d'impayés", aide: 'Factures échues non réglées (la mise en demeure reste toujours à la main)' },
  { kind: 'renouvellement_contrat', label: 'Renouvellement des contrats', aide: 'Contrats de maintenance qui se terminent' },
  { kind: 'visite_hors_contrat', label: 'Vérifications à prévoir', aide: 'Clients sans contrat dont le matériel arrive à échéance' },
  { kind: 'justificatif_prestataire', label: 'Justificatifs des prestataires', aide: 'Documents manquants ou périmés' },
  { kind: 'avis_financeur', label: 'Avis des financeurs', aide: 'Questionnaire annuel aux OPCO et autres financeurs (Qualiopi, indicateur 30)' },
  { kind: 'rappel', label: 'Rappels', aide: 'Rappels préparés la veille ou à l\'échéance (sessions, contrats, visites)' },
  { kind: 'autre', label: 'Autres relances', aide: 'Relances préparées par les règles de gestion' },
  { kind: 'relance_circuit', label: 'Relances du circuit de formation', aide: 'Au client : participants non saisis à J-10, convention non signée à J-7' },
  { kind: 'evaluation_froid', label: 'Questionnaires à froid', aide: 'Aux stagiaires et aux employeurs, au délai réglé (60 jours par défaut) après la formation' },
  { kind: 'demande_nir', label: 'Demande du n° de sécurité sociale', aide: "Au contact de l'entreprise, dès que le stagiaire signe l'autorisation" },
]

export const MODES_ENVOI = {
  ferme: { label: 'Fermé', aide: 'Rien n\'est préparé ni envoyé', badge: 'badge-neutral' },
  a_valider: { label: 'À valider', aide: 'Préparé, puis validé et envoyé depuis l\'outil', badge: 'badge-info' },
  auto: { label: 'Automatique', aide: 'Part seul, sans validation (jamais en mode démonstration)', badge: 'badge-success' },
}

// Libellé du mode « à valider » selon le type : la demande du n° s'envoie depuis la session
export function libelleMode(kind, mode) {
  if (kind === 'demande_nir' && mode === 'a_valider') return 'Depuis la session'
  return MODES_ENVOI[mode]?.label || mode
}

// Types dont l'automatique est proposé (5 envois validés sans retouche)
export function propositions(lignes) {
  return (lignes || []).filter((l) => l.proposition).map((l) => ({ ...l, type: TYPES_ENVOI.find((t) => t.kind === l.kind) })).filter((l) => l.type)
}

const quand = (d) => (d ? `${format(new Date(d), "d MMM 'à' HH'h'mm", { locale: fr })} (il y a ${formatDistanceToNowStrict(new Date(d), { locale: fr })})` : '')

function Etat({ run }) {
  if (!run) return <span className="badge badge-neutral inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />Jamais passée</span>
  if (run.status === 'ok') return <span className="badge badge-success inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />Réussie</span>
  if (run.status === 'en_cours') return <span className="badge badge-neutral inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />En cours</span>
  if (run.status === 'refuse') return <span className="badge badge-danger inline-flex items-center gap-1"><XCircle className="w-3.5 h-3.5" />Refusée</span>
  return <span className="badge badge-warning inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />En erreur</span>
}

export function TachesPlanifiees() {
  const [runs, setRuns] = useState(null)
  const [indispo, setIndispo] = useState(false)
  useEffect(() => {
    supabase.from('v_job_last_runs').select('*').then(({ data, error }) => {
      if (error) { setIndispo(true); setRuns([]); return }
      setRuns(data || [])
    })
  }, [])
  if (indispo) return <p className="text-ui-sm text-gray-500">Le journal des tâches est indisponible pour le moment : la base de données n'est pas encore à jour.</p>
  if (!runs) return <p className="muted text-ui">…</p>
  const par = Object.fromEntries(runs.map((r) => [r.job, r]))
  return (
    <div className="divide-y divide-gray-100">
      {TACHES.map((t) => {
        const r = par[t.job]
        return (
          <div key={t.job} className="py-2.5 text-ui flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-900 break-words">{t.label}</div>
              <div className="text-ui-sm text-gray-500">{rythmeDe(t)}</div>
              {r && <div className="text-ui-sm text-gray-600 mt-0.5">Dernier passage : {quand(r.started_at)}{r.declencheur === 'manuel' ? ', lancé à la main' : ''}</div>}
              {r && r.status !== 'ok' && r.last_ok_at && <div className="text-ui-sm text-gray-600">Dernière réussite : {quand(r.last_ok_at)}</div>}
              {r?.status === 'refuse' && (
                <div className="text-ui-sm text-[rgb(var(--c-danger))] mt-0.5 break-words">
                  {r.detail?.secret_configure === false
                    ? "Appel refusé : le secret des tâches (CRON_SECRET) n'est pas défini sur le serveur. À ajouter dans les variables d'environnement Vercel."
                    : "Appel refusé : le secret reçu ne correspond pas à CRON_SECRET."}
                </div>
              )}
              {r?.status === 'erreur' && r.error && <div className="text-ui-sm text-[rgb(var(--c-warning))] mt-0.5 break-words">{r.error}</div>}
              {r?.echecs_7j > 0 && <div className="text-ui-sm text-gray-500">{r.echecs_7j} échec{r.echecs_7j > 1 ? 's' : ''} sur 7 jours</div>}
            </div>
            <div className="flex-none"><Etat run={r} /></div>
          </div>
        )
      })}
    </div>
  )
}

export function EnvoisAutomatiques({ companyId }) {
  const profile = useAuthStore((s) => s.profile)
  const estSa = profile?.role === 'superadmin'
  const [lignes, setLignes] = useState(null)
  const [indispo, setIndispo] = useState(false)
  const [occupe, setOccupe] = useState(null)

  const charger = useCallback(async () => {
    if (!companyId) return
    const { data, error } = await supabase.rpc('envois_reglages', { p_company: companyId })
    if (error) { setIndispo(true); setLignes([]); return }
    setIndispo(false)
    setLignes(Array.isArray(data) ? data : [])
  }, [companyId])
  useEffect(() => { charger() }, [charger])

  if (indispo) return <p className="text-ui-sm text-gray-500">Les réglages des envois sont indisponibles : base de données pas encore à jour, ou droit de modifier les réglages de l'organisme requis.</p>
  if (!lignes) return <p className="muted text-ui">…</p>
  const par = Object.fromEntries(lignes.map((l) => [l.kind, l]))

  const regler = async (kind, mode) => {
    const t = TYPES_ENVOI.find((x) => x.kind === kind)
    if (mode === 'auto') {
      if (!await confirmer({ title: 'Passer en automatique', message: `« ${t.label} » partira seul aux vrais destinataires, sans validation, depuis la boîte d'envoi par défaut de l'organisme. Les relances déjà préparées restent à valider à la main : seules les nouvelles partiront seules. Rien ne part tant que le mode démonstration est actif.`, confirmLabel: 'Continuer' })) return
      if (!await confirmer({ title: 'Deuxième confirmation', message: 'Vous pourrez revenir à « À valider » à tout moment. Confirmez-vous le passage en automatique ?', confirmLabel: 'Je confirme' })) return
    } else if (mode === 'ferme') {
      if (!await confirmer({ title: 'Fermer cet envoi', message: `« ${t.label} » : plus rien ne sera préparé ni envoyé. Les relances déjà préparées restent dans la liste.`, confirmLabel: 'Fermer' })) return
    }
    setOccupe(kind)
    const { error } = await supabase.rpc('envoi_regler', { p_company: companyId, p_kind: kind, p_mode: mode })
    setOccupe(null)
    if (error) { toast.error(error.message || 'Changement refusé'); return }
    toast.success(`${t.label} : ${libelleMode(kind, mode)}`)
    charger()
  }

  const suspendre = async (kind) => {
    const t = TYPES_ENVOI.find((x) => x.kind === kind)
    if (!await confirmer({ title: 'Suspendre cet envoi', message: `Suspendre « ${t.label} » pendant 24 heures ? Plus rien de ce type ne partira pendant ce temps, ni seul ni depuis « Relances à valider ».`, confirmLabel: 'Continuer' })) return
    if (!await confirmer({ title: 'Deuxième confirmation', message: "L'envoi reprendra tout seul dans 24 heures. Le super administrateur sera seul à pouvoir le reprendre avant. Confirmez-vous ?", confirmLabel: 'Je confirme' })) return
    const saisie = await demander('Dernière confirmation : recopiez « SUSPENDRE 24 H » pour suspendre cet envoi.', { title: 'Troisième confirmation', placeholder: 'SUSPENDRE 24 H' })
    if (saisie == null) return
    const motif = await demander('Pourquoi ? (facultatif, visible dans le journal)', { title: 'Motif', placeholder: 'Ex. : erreur dans le texte' })
    setOccupe(kind)
    const { error } = await supabase.rpc('envoi_auto_suspendre', { p_company: companyId, p_kind: kind, p_confirmation: saisie, p_motif: motif || null })
    setOccupe(null)
    if (error) { toast.error(error.message || 'Suspension refusée'); return }
    toast.success('Envoi suspendu pour 24 heures')
    charger()
  }

  const reprendre = async (kind) => {
    setOccupe(kind)
    const { error } = await supabase.rpc('envoi_auto_reprendre', { p_company: companyId, p_kind: kind })
    setOccupe(null)
    if (error) { toast.error(error.message || 'Reprise refusée'); return }
    toast.success('Suspension levée')
    charger()
  }

  return (
    <div className="divide-y divide-gray-100">
      {TYPES_ENVOI.map((t) => {
        const l = par[t.kind]
        if (!l) return null
        const suspendu = !!l.suspended_until
        const modes = Array.isArray(l.modes) ? l.modes : []
        return (
          <div key={t.kind} className="py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 text-ui">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-900 break-words">{t.label}</div>
              <div className="text-ui-sm text-gray-500 break-words">{t.aide}</div>
              {suspendu && <div className="text-ui-sm text-[rgb(var(--c-warning))] inline-flex items-center gap-1"><PauseCircle className="w-3.5 h-3.5 flex-none" />Suspendu jusqu'au {format(new Date(l.suspended_until), "d MMM 'à' HH'h'mm", { locale: fr })}{l.suspended_reason ? ` : ${l.suspended_reason}` : ''}</div>}
              {l.proposition && <div className="text-ui-sm text-[rgb(var(--c-info))] break-words">{l.sans_retouche} envois validés sans retouche : l'automatique est possible.{estSa ? '' : ' Le super administrateur peut l\'activer.'}</div>}
            </div>
            <div className="flex items-center gap-2 flex-wrap flex-none">
              <span className={`badge ${suspendu ? 'badge-warning' : MODES_ENVOI[l.mode]?.badge || 'badge-neutral'}`}>{suspendu ? 'Suspendu' : libelleMode(t.kind, l.mode)}</span>
              <select className="input input-sm" aria-label={`Réglage : ${t.label}`} value={l.mode} disabled={occupe === t.kind}
                onChange={(e) => regler(t.kind, e.target.value)}>
                {modes.map((m) => <option key={m} value={m} disabled={m === 'auto' && !estSa && l.mode !== 'auto'}>{libelleMode(t.kind, m)}</option>)}
              </select>
              {estSa && suspendu && <button type="button" className="btn btn-ghost btn-sm" disabled={occupe === t.kind} onClick={() => reprendre(t.kind)}>Reprendre</button>}
              {!suspendu && l.mode !== 'ferme' && <button type="button" className="btn btn-ghost btn-sm" disabled={occupe === t.kind} onClick={() => suspendre(t.kind)}>Suspendre 24 h</button>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Avec choix de la société (Console et Règles de gestion) : la société courante par défaut
export function EnvoisAutomatiquesSociete() {
  const [societes, setSocietes] = useState(null)
  const [id, setId] = useState(null)
  useEffect(() => {
    supabase.from('companies').select('id, short_name, legal_name, is_instance_owner').order('is_instance_owner', { ascending: false }).order('position')
      .then(({ data }) => {
        const l = (data || []).map((c) => ({ ...c, name: c.short_name || c.legal_name || 'Société' }))
        setSocietes(l)
        const courante = getCurrentCompanyId()
        setId((courante && l.find((s) => s.id === courante)?.id) || l[0]?.id || null)
      })
  }, [])
  if (!societes) return <p className="muted text-ui">…</p>
  if (!societes.length) return <p className="muted text-ui">Aucune société.</p>
  return (
    <div className="space-y-2">
      {societes.length > 1 && (
        <label className="block max-w-sm">
          <span className="label">Société</span>
          <select className="input w-full" value={id || ''} onChange={(e) => setId(e.target.value)}>
            {societes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      <EnvoisAutomatiques companyId={id} />
      <p className="text-ui-sm text-gray-500">« À valider » par défaut : chaque envoi est préparé, puis validé et envoyé depuis l'outil (Relances à valider). « Automatique » ne part jamais en mode démonstration. Chaque changement est noté au journal.</p>
    </div>
  )
}

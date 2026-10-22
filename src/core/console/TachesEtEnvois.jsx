import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CheckCircle2, AlertTriangle, XCircle, Clock, PauseCircle } from 'lucide-react'
import { supabase } from '../supabase'
import { useAuthStore } from '../store'
import { confirmer, demander } from '../../ui/Confirm'
import { getCurrentCompanyId } from '../company/companyContext'

// Journal des tâches planifiées et interrupteurs des envois automatiques (migration 0382, audit du 19/10 au soir).
//  - TachesPlanifiees : dernier passage de chaque tâche (Console, super administrateur).
//  - EnvoisAutomatiques : un interrupteur par type d'envoi. Le super administrateur ouvre ou ferme ; un administrateur
//    de la société peut seulement suspendre 24 heures, après trois confirmations (décision de H du 19/10 à 23h14).

export const TACHES = [
  { job: 'maintenance-nuit', label: 'Préparation de la nuit (relances, rappels, étapes des sessions, purges à valider)', rythme: 'Chaque nuit, vers 4h' },
  { job: 'sync-sent-emails', label: 'Synchronisation des emails envoyés', rythme: 'Toutes les 30 min en journée, en semaine' },
  { job: 'signature-alert', label: 'Alertes de signature', rythme: 'En semaine, vers 9h' },
  { job: 'signature-weekly', label: 'Bilan des signatures', rythme: 'Le lundi, vers 9h' },
  { job: 'mailing-replies-cron', label: 'Réponses aux campagnes', rythme: 'Chaque jour, vers 7h' },
  { job: 'social/cron-publish', label: 'Publication des posts programmés', rythme: 'Toutes les 5 min' },
  { job: 'import-auto-cron', label: 'Import automatique des prospects', rythme: 'Chaque nuit, vers 4h' },
  { job: 'enrich-prospects', label: 'Enrichissement des prospects', rythme: 'Chaque nuit, vers 5h' },
  { job: 'mailing-cron', label: 'Envoi des campagnes email', rythme: 'Selon les campagnes' },
  { job: 'relances-circuit', label: 'Relances du circuit de formation', rythme: 'En semaine, vers 10h' },
]

export const TYPES_ENVOI = [
  { kind: 'relance_recyclage', label: 'Relances de recyclage', aide: 'Aux clients dont des salariés arrivent en fin de validité' },
  { kind: 'relance_devis', label: 'Relances de devis', aide: 'Devis envoyés sans réponse' },
  { kind: 'relance_facture', label: "Relances d'impayés", aide: 'Factures échues non réglées' },
  { kind: 'convocation', label: 'Convocations à J-7', aide: 'Aux stagiaires inscrits, une semaine avant la session' },
  { kind: 'attestation', label: 'Attestations à la clôture', aide: 'Aux stagiaires et au client, à la clôture de la session' },
  { kind: 'evaluation_froid', label: 'Questionnaires à froid', aide: 'Aux stagiaires, quelques semaines après la formation' },
  { kind: 'renouvellement_contrat', label: 'Renouvellement des contrats', aide: 'Contrats de maintenance qui se terminent' },
  { kind: 'visite_hors_contrat', label: 'Vérifications à prévoir', aide: 'Clients sans contrat dont le matériel arrive à échéance' },
  { kind: 'justificatif_prestataire', label: 'Justificatifs des prestataires', aide: 'Documents manquants ou périmés' },
  { kind: 'relance_circuit', label: 'Relances du circuit de formation', aide: 'Au client : participants non saisis à J-10, convention non signée à J-7' },
  { kind: 'demande_nir', label: 'Demande du n° de sécurité sociale', aide: "Au contact de l'entreprise, dès que le stagiaire signe l'autorisation (sinon : envoi depuis la session)" },
]

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
  if (indispo) return <p className="text-ui-sm text-gray-500">Le journal des tâches sera disponible après la mise à jour de la base 0382.</p>
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
              <div className="text-ui-sm text-gray-500">{t.rythme}</div>
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
    const { data, error } = await supabase.from('auto_send_switches').select('*').eq('company_id', companyId)
    if (error) { setIndispo(true); setLignes([]); return }
    setLignes(data || [])
  }, [companyId])
  useEffect(() => { charger() }, [charger])

  if (indispo) return <p className="text-ui-sm text-gray-500">Les interrupteurs des envois seront disponibles après la mise à jour de la base 0382.</p>
  if (!lignes) return <p className="muted text-ui">…</p>
  const par = Object.fromEntries(lignes.map((l) => [l.kind, l]))

  const regler = async (kind, enabled) => {
    const t = TYPES_ENVOI.find((x) => x.kind === kind)
    if (enabled && !await confirmer({ title: 'Ouvrir cet envoi', message: `« ${t.label} » partira automatiquement aux vrais destinataires. Vérifiez d'abord que l'envoi a été testé vers vous et que le mode démonstration est coupé.`, confirmLabel: "Ouvrir l'envoi" })) return
    setOccupe(kind)
    const { error } = await supabase.rpc('envoi_auto_regler', { p_company: companyId, p_kind: kind, p_enabled: enabled })
    setOccupe(null)
    if (error) { toast.error(error.message || 'Changement refusé'); return }
    toast.success(enabled ? 'Envoi ouvert' : 'Envoi fermé')
    charger()
  }

  const suspendre = async (kind) => {
    const t = TYPES_ENVOI.find((x) => x.kind === kind)
    if (!await confirmer({ title: 'Suspendre cet envoi', message: `Suspendre « ${t.label} » pendant 24 heures ? Plus rien de ce type ne partira pendant ce temps.`, confirmLabel: 'Continuer' })) return
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
        const suspendu = l?.suspended_until && new Date(l.suspended_until) > new Date()
        const ouvert = !!l?.enabled
        return (
          <div key={t.kind} className="py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 text-ui">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-900 break-words">{t.label}</div>
              <div className="text-ui-sm text-gray-500 break-words">{t.aide}</div>
              {suspendu && <div className="text-ui-sm text-[rgb(var(--c-warning))] inline-flex items-center gap-1"><PauseCircle className="w-3.5 h-3.5 flex-none" />Suspendu jusqu'au {format(new Date(l.suspended_until), "d MMM 'à' HH'h'mm", { locale: fr })}{l.suspended_reason ? ` : ${l.suspended_reason}` : ''}</div>}
            </div>
            <div className="flex items-center gap-2 flex-wrap flex-none">
              <span className={`badge ${suspendu ? 'badge-warning' : ouvert ? 'badge-success' : 'badge-neutral'}`}>{suspendu ? 'Suspendu' : ouvert ? 'Ouvert' : 'Fermé'}</span>
              {estSa && (
                <button type="button" className="btn btn-secondary btn-sm" disabled={occupe === t.kind} onClick={() => regler(t.kind, !ouvert)}>{ouvert ? 'Fermer' : 'Ouvrir'}</button>
              )}
              {estSa && suspendu && <button type="button" className="btn btn-ghost btn-sm" disabled={occupe === t.kind} onClick={() => reprendre(t.kind)}>Reprendre</button>}
              {!suspendu && ouvert && <button type="button" className="btn btn-ghost btn-sm" disabled={occupe === t.kind} onClick={() => suspendre(t.kind)}>Suspendre 24 h</button>}
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
      <p className="text-ui-sm text-gray-500">Tout est fermé par défaut. Un envoi ouvert ne part que hors mode démonstration. Chaque changement est noté au journal.</p>
    </div>
  )
}

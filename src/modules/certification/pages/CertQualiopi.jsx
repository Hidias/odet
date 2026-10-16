// Cycle Qualiopi : certificateur, audit initial, surveillance, renouvellement (arrêté du 6 juin 2019 modifié),
// périmètre d'activité (indicateurs non applicables), non-conformités d'audit, BPF.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, Check, ChevronRight } from 'lucide-react'
import { Toggle } from '../../../core/settings/shared'
import { DateField, DueBadge, Step } from '../components/ui'
import { saveSettings, loadFindings, saveFinding, frDate, qualiopiCycle, todayIso, addMonths, addDays } from '../lib/certData'

const CERT_STATUS = [['pressenti', 'Pressenti'], ['devis', 'Devis demandé'], ['contrat_signe', 'Contrat signé']]
const AUDIT_KIND = { initial: 'Audit initial', surveillance: 'Surveillance', renouvellement: 'Renouvellement', complementaire: 'Audit complémentaire' }

export default function CertQualiopi({ settings, canWrite, organization, updateOrganization, reloadSettings, reloadIndicators, deadlines, evidence }) {
  const [form, setForm] = useState(settings)
  const [findings, setFindings] = useState([])
  const [nc, setNc] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setForm(settings) }, [settings])
  const reloadFindings = () => loadFindings().then(setFindings).catch((e) => toast.error(e.message))
  useEffect(() => { reloadFindings() }, [])

  // Instance déjà certifiée avant le module : on reprend la date et le certificateur des paramètres
  useEffect(() => {
    if (!canWrite || settings.certified_at || !organization?.qualiopi_certified || !organization?.qualiopi_since) return
    saveSettings({ certified_at: String(organization.qualiopi_since).substring(0, 10), certifier_name: settings.certifier_name || organization.qualiopi_organisme || null, certifier_status: 'contrat_signe', new_entrant: false })
      .then(reloadSettings).catch(() => {})
  }, [organization?.qualiopi_since]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch, { indicators = false } = {}) => {
    setForm((f) => ({ ...f, ...patch }))
    setBusy(true)
    try {
      await saveSettings(patch, { organization, updateOrganization })
      await reloadSettings()
      if (indicators) await reloadIndicators()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  const cycle = qualiopiCycle(form)
  const firstActionDone = (evidence?.n?.sessionsDone || 0) > 0
  const bpf = deadlines.find((d) => d.key.startsWith('bpf_'))

  const submitNc = async () => {
    if (!nc.description?.trim()) return toast.error('Décrire la non-conformité')
    try {
      await saveFinding({ ...nc, indicator_number: nc.indicator_number ? Number(nc.indicator_number) : null })
      setNc(null); await reloadFindings(); await reloadSettings()
    } catch (e) { toast.error(e.message) }
  }
  const closeNc = async (f) => {
    try { await saveFinding({ id: f.id, closed_at: todayIso() }); await reloadFindings(); await reloadSettings() } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
      <section className="card space-y-3">
        <h2 className="section-title">Certificateur</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-1"><span className="label">Nom</span>
            <input className="input" value={form.certifier_name || ''} disabled={!canWrite} onChange={(e) => setForm({ ...form, certifier_name: e.target.value })} onBlur={() => form.certifier_name !== settings.certifier_name && save({ certifier_name: form.certifier_name?.trim() || null })} />
          </label>
          <label className="block"><span className="label">Statut</span>
            <select className="select" value={form.certifier_status} disabled={!canWrite} onChange={(e) => save({ certifier_status: e.target.value })}>
              {CERT_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <DateField label="Contrat signé le" value={form.certifier_contract_at} disabled={!canWrite} onChange={(v) => save({ certifier_contract_at: v, ...(v ? { certifier_status: 'contrat_signe' } : {}) })} />
        </div>
        <p className="muted text-ui-sm">Le certificateur propose une date d'audit dans les 30 jours suivant le contrat. Référentiel appliqué : {form.referential_code === 'rnq-2019' ? 'décret 2019-565, 32 indicateurs' : 'décret 2026-728, 33 indicateurs (audits à partir du 1er novembre 2026)'}.</p>
      </section>

      <section className="card space-y-4 lg:row-span-2">
        <h2 className="section-title">Cycle de certification</h2>
        <Step done={firstActionDone} current={!firstActionDone} title="Première action réalisée">
          <span>Condition pour déclencher l'audit initial.</span>
          <span>{firstActionDone ? `${evidence.n.sessionsDone} session${evidence.n.sessionsDone > 1 ? 's' : ''} terminée${evidence.n.sessionsDone > 1 ? 's' : ''}.` : 'Aucune session terminée.'}</span>
        </Step>
        <Step done={!!form.certified_at} current={!form.certified_at} title="Audit initial" aside={!form.certified_at && form.initial_audit_at ? <DueBadge date={form.initial_audit_at} /> : null}>
          <span>Sur site, 1 jour pour un organisme de formation de moins de 150 000 € de chiffre d'affaires.</span>
          {form.new_entrant && <span>Nouvel entrant : pour les indicateurs 2, 3, 11, 13, 14, 19, 22, 24, 25, 26 et 32, la formalisation suffit à cet audit ; la mise en oeuvre est vérifiée à la surveillance.</span>}
          {canWrite && <div className="sm:w-1/2 pt-1"><DateField label="Date prévue" value={form.initial_audit_at} onChange={(v) => save({ initial_audit_at: v })} /></div>}
        </Step>
        <Step done={!!form.certified_at} title="Certificat obtenu">
          <span>Valable 3 ans. À afficher dans les locaux et sur le site internet, sinon non-conformité majeure.</span>
          {canWrite && (
            <div className="grid gap-2 sm:grid-cols-2 pt-1">
              <DateField label="Date d'obtention" value={form.certified_at} onChange={(v) => save({ certified_at: v, valid_until: v ? addDays(addMonths(v, 36), -1) : null })} />
              <DateField label="Valable jusqu'au" value={form.valid_until} onChange={(v) => save({ valid_until: v })} hint="Date figurant sur le certificat" />
            </div>
          )}
        </Step>
        <Step done={!!form.surveillance_done_at} current={!!cycle && !form.surveillance_done_at} title="Audit de surveillance"
          aside={cycle && !form.surveillance_done_at ? <DueBadge date={cycle.surveillanceTo} /> : null}>
          <span>À distance, entre le 14e et le 22e mois après l'obtention{cycle ? ` : du ${frDate(cycle.surveillanceFrom)} au ${frDate(cycle.surveillanceTo)}` : ''}.{form.new_entrant ? ' Tous les indicateurs sont revus pour un nouvel entrant.' : ''}</span>
          {canWrite && cycle && (
            <div className="grid gap-2 sm:grid-cols-2 pt-1">
              <DateField label="Date prévue" value={form.surveillance_audit_at} onChange={(v) => save({ surveillance_audit_at: v })} />
              <DateField label="Réalisé le" value={form.surveillance_done_at} onChange={(v) => save({ surveillance_done_at: v })} />
            </div>
          )}
        </Step>
        <Step done={false} current={!!cycle && !!form.surveillance_done_at} title="Audit de renouvellement" aside={cycle ? <DueBadge date={cycle.renewalAlert} /> : null}>
          <span>Sur site, durant la 3e année{cycle ? `, avant le ${frDate(cycle.validUntil)}` : ''}. Alerte 4 mois avant l'échéance pour garder le temps de lever une non-conformité majeure (3 mois).</span>
          {canWrite && cycle && <div className="sm:w-1/2 pt-1"><DateField label="Date prévue" value={form.renewal_audit_at} onChange={(v) => save({ renewal_audit_at: v })} /></div>}
        </Step>
        <p className="muted text-ui-sm">Notifications au tableau de bord 90, 30 et 7 jours avant chaque échéance.</p>
      </section>

      <section className="card space-y-3">
        <h2 className="section-title">Périmètre d'activité</h2>
        <p className="muted text-ui-sm">Il rend non applicables les indicateurs qui ne vous concernent pas, avec une justification modifiable indicateur par indicateur.</p>
        <div className="space-y-3">
          <Toggle checked={!!form.new_entrant} onChange={(v) => canWrite && save({ new_entrant: v })} label="Nouvel entrant" hint="Première année d'activité au moment de l'audit initial" />
          <Toggle checked={!!form.has_certifying} onChange={(v) => canWrite && save({ has_certifying: v }, { indicators: true })} label="Formations certifiantes (RNCP ou Répertoire spécifique)" hint="Indicateurs 3, 7 et 16" />
          <Toggle checked={!!form.uses_subcontracting} onChange={(v) => canWrite && save({ uses_subcontracting: v }, { indicators: true })} label="Sous-traitance ou portage salarial" hint="Indicateur 27" />
          <Toggle checked={!!form.has_distance} onChange={(v) => canWrite && save({ has_distance: v }, { indicators: true })} label="Modules à distance" hint="Indicateur 19 : preuve du suivi effectif" />
          <Toggle checked={!!form.has_fest} onChange={(v) => canWrite && save({ has_fest: v }, { indicators: true })} label="Formation en situation de travail" hint="Indicateur 28" />
          <Toggle checked={!!form.has_alternance} onChange={(v) => canWrite && save({ has_alternance: v }, { indicators: true })} label="Formations en alternance" hint="Indicateur 13" />
          <Toggle checked={!!form.has_apprentissage} onChange={(v) => canWrite && save({ has_apprentissage: v }, { indicators: true })} label="Apprentissage (CFA)" hint="Indicateurs 14, 15, 20, 29 et 33" />
        </div>
        {busy && <p className="muted text-ui-sm">Enregistrement...</p>}
      </section>

      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title">Non-conformités d'audit</h2>
          {canWrite && !nc && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNc({ audit_kind: form.certified_at ? 'surveillance' : 'initial', audit_date: todayIso(), severity: 'mineure', description: '' })}><Plus className="w-4 h-4" />Ajouter</button>}
        </div>
        <p className="muted text-ui-sm">Majeure : 3 mois pour la lever. Mineure : 6 mois, vérifiée à l'audit suivant. Cinq mineures non levées valent une majeure.</p>
        {nc && (
          <div className="space-y-2 border border-gray-200 rounded-ui-sm p-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <label className="block"><span className="label">Audit</span>
                <select className="select" value={nc.audit_kind} onChange={(e) => setNc({ ...nc, audit_kind: e.target.value })}>{Object.entries(AUDIT_KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
              <DateField label="Date" value={nc.audit_date} onChange={(v) => setNc({ ...nc, audit_date: v })} />
              <label className="block"><span className="label">Gravité</span>
                <select className="select" value={nc.severity} onChange={(e) => setNc({ ...nc, severity: e.target.value })}><option value="mineure">Mineure</option><option value="majeure">Majeure</option></select>
              </label>
              <label className="block"><span className="label">Indicateur</span><input className="input" inputMode="numeric" value={nc.indicator_number || ''} onChange={(e) => setNc({ ...nc, indicator_number: e.target.value.replace(/\D/g, '') })} /></label>
            </div>
            <label className="block"><span className="label">Constat</span><textarea className="textarea" rows={2} value={nc.description} onChange={(e) => setNc({ ...nc, description: e.target.value })} /></label>
            <label className="block"><span className="label">Plan d'action</span><textarea className="textarea" rows={2} value={nc.action_plan || ''} onChange={(e) => setNc({ ...nc, action_plan: e.target.value })} /></label>
            <div className="flex gap-2 justify-end"><button type="button" className="btn btn-ghost" onClick={() => setNc(null)}>Annuler</button><button type="button" className="btn btn-primary" onClick={submitNc}>Enregistrer</button></div>
          </div>
        )}
        {!findings.length && !nc && <p className="text-ui-sm">Aucune pour l'instant.</p>}
        {findings.map((f) => (
          <div key={f.id} className="flex items-start gap-3 border-t border-gray-100 pt-2">
            <div className="flex-1 min-w-0 text-ui-sm">
              <div className="font-semibold text-ui">{AUDIT_KIND[f.audit_kind]}{f.indicator_number ? `, indicateur ${f.indicator_number}` : ''}</div>
              <div>{f.description}</div>
              {f.action_plan && <div className="muted">Plan : {f.action_plan}</div>}
            </div>
            <div className="flex flex-col items-end gap-1 flex-none">
              <span className={`badge ${f.severity === 'majeure' ? 'badge-danger' : 'badge-warning'}`}>{f.severity === 'majeure' ? 'Majeure' : 'Mineure'}</span>
              {f.closed_at ? <span className="badge badge-success">Levée le {frDate(f.closed_at)}</span> : <DueBadge date={f.due_date} />}
              {!f.closed_at && canWrite && <button type="button" className="btn btn-ghost btn-sm" onClick={() => closeNc(f)}><Check className="w-4 h-4" />Levée</button>}
            </div>
          </div>
        ))}
      </section>

      <section className="card space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title">{bpf ? bpf.label : 'Bilan pédagogique et financier'}</h2>
          {bpf ? <DueBadge date={bpf.due_date} /> : <span className="badge badge-neutral">Rien à déposer</span>}
        </div>
        <p className="text-ui-sm text-gray-700">Date légale : avant le 30 avril, sur Mon Activité Formation (article R6352-23). Un report au 31 mai a été accordé les années précédentes, sans texte. Sans BPF, ou avec un BPF sans activité, la déclaration d'activité devient caduque.</p>
        <Link to="/bpf" className="btn btn-secondary btn-sm">Ouvrir le BPF <ChevronRight className="w-4 h-4" /></Link>
      </section>
    </div>
  )
}

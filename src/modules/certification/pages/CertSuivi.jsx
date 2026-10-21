// Suivi d'une certification autre que Qualiopi (APSAD…), choisie en haut du module (0391, décision de H du 21/10) :
// accueil (où en est-on), suivi et audits (statut, dates, écarts de l'auditeur), import du texte acheté.
// Les exigences se suivent dans l'onglet « Exigences » (même tableau que les indicateurs Qualiopi).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronRight, Pencil, Plus, Check, Upload, ExternalLink, Loader2 } from 'lucide-react'
import { DateField, DueBadge, Progress } from '../components/ui'
import { frDate, loadFindings, saveFinding, todayIso } from '../lib/certData'
import { NATURES, statut, certValide, prochaineEcheance } from '../lib/certSociete'
import { FormCertif, ImportTexte } from './CertSociete'

const AUDIT_KIND = { initial: 'Audit initial', surveillance: 'Audit de suivi', renouvellement: 'Renouvellement', complementaire: 'Audit complémentaire' }

function useEcarts(code) {
  const [ecarts, setEcarts] = useState(null)
  const recharger = () => loadFindings({ codes: [code] }).then(setEcarts).catch((e) => { toast.error(e.message); setEcarts([]) })
  useEffect(() => { recharger() }, [code]) // eslint-disable-line react-hooks/exhaustive-deps
  return [ecarts, recharger]
}

function EnTete({ refe, certif }) {
  const st = statut(certif?.statut)
  return (
    <div className="flex items-start gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <h2 className="section-title">{refe.label}</h2>
        <p className="text-ui-sm muted">{[NATURES[refe.kind], refe.issuer, refe.legal_ref].filter(Boolean).join(' · ')}</p>
      </div>
      <span className={`badge ${certif ? st.badge : 'badge-neutral'}`}>{certif ? st.label : 'Non suivie'}</span>
      {certValide(certif) && <span className="badge badge-success">Valide</span>}
    </div>
  )
}

/** Accueil d'une certification : statut, prochaine échéance, avancement des exigences, écarts ouverts */
export function CertRefAccueil({ refe, copie, certif, evaluated }) {
  const [ecarts] = useEcarts(refe.code)
  const ech = prochaineEcheance(certif)
  const applicables = (evaluated || []).filter((i) => i.status !== 'non_applicable')
  const prouvees = applicables.filter((i) => i.status === 'preuves').length
  const ouverts = (ecarts || []).filter((e) => !e.closed_at)

  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <section className="card space-y-3 lg:col-span-2">
        <EnTete refe={refe} certif={certif} />
        {certif
          ? <p className="text-ui-sm text-gray-700">{[certif.certificateur, certif.numero ? `n° ${certif.numero}` : null, certif.valable_jusqu_au ? `valable jusqu'au ${frDate(certif.valable_jusqu_au)}` : null].filter(Boolean).join(', ') || 'Aucun détail saisi.'}</p>
          : <p className="text-ui-sm text-gray-700">Cette certification n'est pas encore suivie : indiquez où vous en êtes dans « Suivi et audits ».</p>}
        {ech && (
          <div className="flex items-center gap-2 text-ui-sm">
            <span className="text-gray-700">{ech.label} : {frDate(ech.d)}</span>
            <DueBadge date={ech.d} />
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <Link to="suivi" className="btn btn-secondary btn-sm">Suivi et audits <ChevronRight className="w-4 h-4" /></Link>
          {refe.source_url && <a className="btn btn-ghost btn-sm" href={refe.source_url} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" aria-hidden="true" />Page du certificateur</a>}
        </div>
      </section>

      <Link to="exigences" className="card block no-underline text-gray-900 hover:border-gray-300 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="section-title">Exigences</span>
          {copie ? <span className="badge badge-neutral">{copie.exigences} exigences</span> : <span className="badge badge-warning">Texte à importer</span>}
        </div>
        {copie
          ? <>
              <Progress value={applicables.length ? (prouvees / applicables.length) * 100 : 0} tone="green" />
              <p className="text-ui-sm muted">{prouvees} prouvée{prouvees > 1 ? 's' : ''} sur {applicables.length} applicable{applicables.length > 1 ? 's' : ''}.</p>
            </>
          : <p className="text-ui-sm muted">Le texte est payant : l'outil ne le fournit pas. Importez-le depuis votre exemplaire dans « Suivi et audits ».</p>}
      </Link>

      <Link to="suivi" className="card block no-underline text-gray-900 hover:border-gray-300 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="section-title">Écarts de l'auditeur</span>
          {ecarts === null ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : <span className={`badge ${ouverts.length ? 'badge-warning' : 'badge-success'}`}>{ouverts.length ? `${ouverts.length} ouvert${ouverts.length > 1 ? 's' : ''}` : 'Aucun ouvert'}</span>}
        </div>
        <p className="text-ui-sm muted">Réponse attendue sous 3 semaines après l'audit (référentiel général B0 du CNPP).</p>
      </Link>

      <Link to="preparer" className="card block no-underline text-gray-900 hover:border-gray-300 space-y-1 lg:col-span-2">
        <span className="section-title">Préparer l'audit</span>
        <p className="text-ui-sm muted">
          {refe.equipment_families?.length
            ? `Visites réellement faites sur le matériel concerné (${refe.equipment_families.join(', ').toLowerCase()}), opérations dues, remplacements sans motif et personnes qualifiées.`
            : 'Personnes qualifiées et points à préparer.'}
        </p>
      </Link>
    </div>
  )
}

/** Suivi et audits : statut et dates, écarts relevés par l'auditeur, import du texte du référentiel */
export function CertRefSuivi({ refe, copie, certif, canWrite, recharger }) {
  const [ecarts, rechargerEcarts] = useEcarts(refe.code)
  const [edition, setEdition] = useState(false)
  const [import_, setImport] = useState(false)
  const [nc, setNc] = useState(null)
  const [busy, setBusy] = useState(false)

  const enregistrerEcart = async () => {
    if (!nc.description?.trim()) return toast.error('Décrire l\'écart')
    setBusy(true)
    try {
      await saveFinding({ ...nc, description: nc.description.trim(), indicator_number: nc.indicator_number ? Number(nc.indicator_number) : null, referential_code: refe.code })
      setNc(null); await rechargerEcarts()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  const lever = async (f) => {
    try { await saveFinding({ id: f.id, closed_at: todayIso() }); await rechargerEcarts() } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <section className="card space-y-3">
        <EnTete refe={refe} certif={certif} />
        {!edition && (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-ui-sm">
              {[['Certificateur', certif?.certificateur], ['Numéro', certif?.numero], ['Audit initial', certif?.audit_initial_fait ? `fait le ${frDate(certif.audit_initial_fait)}` : certif?.audit_initial_prevu ? `prévu le ${frDate(certif.audit_initial_prevu)}` : null],
                ['Audit de suivi', certif?.audit_suivi_fait ? `fait le ${frDate(certif.audit_suivi_fait)}` : certif?.audit_suivi_prevu ? `prévu le ${frDate(certif.audit_suivi_prevu)}` : null],
                ['Valable jusqu\'au', certif?.valable_jusqu_au ? frDate(certif.valable_jusqu_au) : null], ['Périmètre', certif?.perimetre]].map(([k, v]) => (
                <div key={k} className="contents"><dt className="muted">{k}</dt><dd className="text-gray-900">{v || '-'}</dd></div>
              ))}
            </dl>
            {canWrite && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdition(true)}><Pencil className="w-4 h-4" aria-hidden="true" />{certif ? 'Modifier' : 'Suivre cette certification'}</button>}
          </>
        )}
        {edition && <FormCertif refe={refe} certif={certif} onFini={(r) => { setEdition(false); if (r) recharger() }} />}
      </section>

      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title">Écarts relevés par l'auditeur</h2>
          {canWrite && !nc && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNc({ audit_kind: 'initial', audit_date: todayIso(), severity: 'mineure', description: '', action_plan: '', indicator_number: '' })}><Plus className="w-4 h-4" />Ajouter</button>}
        </div>
        <p className="text-ui-sm muted">Chaque écart reçoit une réponse sous 3 semaines ; une non-conformité majeure est levée avant l'attribution du certificat.</p>
        {nc && (
          <div className="space-y-2 border border-gray-200 rounded-ui-sm p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block"><span className="label">Audit</span>
                <select className="select" value={nc.audit_kind} onChange={(e) => setNc({ ...nc, audit_kind: e.target.value })}>
                  {Object.entries(AUDIT_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <DateField label="Date de l'audit" value={nc.audit_date} onChange={(v) => setNc({ ...nc, audit_date: v })} />
              <label className="block"><span className="label">Gravité</span>
                <select className="select" value={nc.severity} onChange={(e) => setNc({ ...nc, severity: e.target.value })}><option value="mineure">Mineure</option><option value="majeure">Majeure</option></select>
              </label>
              <label className="block"><span className="label">Exigence (numéro dans l'outil)</span><input className="input" inputMode="numeric" value={nc.indicator_number || ''} onChange={(e) => setNc({ ...nc, indicator_number: e.target.value.replace(/\D/g, '') })} /></label>
            </div>
            <label className="block"><span className="label">Constat de l'auditeur</span><textarea className="textarea" rows={2} value={nc.description} onChange={(e) => setNc({ ...nc, description: e.target.value })} /></label>
            <label className="block"><span className="label">Réponse et plan d'action</span><textarea className="textarea" rows={2} value={nc.action_plan || ''} onChange={(e) => setNc({ ...nc, action_plan: e.target.value })} /></label>
            <div className="flex gap-2 justify-end"><button type="button" className="btn btn-ghost" onClick={() => setNc(null)}>Annuler</button><button type="button" className="btn btn-primary" disabled={busy} onClick={enregistrerEcart}>Enregistrer</button></div>
          </div>
        )}
        {ecarts === null && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>}
        {ecarts?.length === 0 && !nc && <p className="text-ui-sm">Aucun écart enregistré.</p>}
        {(ecarts || []).map((f) => (
          <div key={f.id} className="flex items-start gap-3 border-t border-gray-100 pt-2">
            <div className="flex-1 min-w-0 text-ui-sm">
              <div className="font-semibold text-ui">{AUDIT_KIND[f.audit_kind]}{f.audit_date ? ` du ${frDate(f.audit_date)}` : ''}{f.indicator_number ? `, exigence ${f.indicator_number}` : ''}</div>
              <div>{f.description}</div>
              {f.action_plan && <div className="muted">Réponse : {f.action_plan}</div>}
            </div>
            <div className="flex flex-col items-end gap-1 flex-none">
              <span className={`badge ${f.severity === 'majeure' ? 'badge-danger' : 'badge-warning'}`}>{f.severity === 'majeure' ? 'Majeure' : 'Mineure'}</span>
              {f.closed_at ? <span className="badge badge-success">Levé le {frDate(f.closed_at)}</span> : <DueBadge date={f.due_date} />}
              {!f.closed_at && canWrite && <button type="button" className="btn btn-ghost btn-sm" onClick={() => lever(f)}><Check className="w-4 h-4" />Levé</button>}
            </div>
          </div>
        ))}
      </section>

      <section className="card space-y-2 lg:col-span-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="section-title">Texte du référentiel</h2>
          {copie?.exigences ? <span className="badge badge-success">{copie.exigences} exigences importées</span> : <span className="badge badge-warning">À importer</span>}
        </div>
        <p className="text-ui-sm text-gray-700">
          {refe.text_source === 'a_saisir'
            ? 'Texte payant : l\'outil ne le fournit pas et n\'invente aucune exigence. Collez-le depuis votre exemplaire acheté ; il reste propre à votre société.'
            : 'Texte public.'}
        </p>
        {canWrite && refe.text_source === 'a_saisir' && !import_ && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setImport(true)}><Upload className="w-4 h-4" aria-hidden="true" />{copie?.exigences ? 'Remplacer le texte' : 'Importer le texte'}</button>
        )}
        {import_ && <ImportTexte refe={refe} copie={copie} onFini={(r) => { setImport(false); if (r) recharger() }} />}
      </section>
    </div>
  )
}

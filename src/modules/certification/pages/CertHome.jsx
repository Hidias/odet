// Accueil du module : échéances, avancement de la déclaration d'activité et de Qualiopi.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronRight } from 'lucide-react'
import { DueBadge, Progress, RowLink, StatusBadge } from '../components/ui'
import { NDA_PIECES, frDate, saveSettings, todayIso } from '../lib/certData'

const NDA_STATUS = {
  preparation: 'En préparation', depose: 'Déposée', complet: 'Dossier complet', enregistre: 'Enregistrée', refuse: 'Refusée',
}

export default function CertHome({ settings, deadlines, evaluated, evidence, organization, canWrite, reloadSettings, ndaDocs }) {
  const [busy, setBusy] = useState(false)
  const applicable = (evaluated || []).filter((i) => i.status !== 'non_applicable')
  const proved = applicable.filter((i) => i.status === 'preuves').length
  const missing = applicable.filter((i) => i.status === 'manquant')
  const hasNda = !!String(organization?.nda || '').trim()
  const ndaStatus = hasNda ? 'enregistre' : settings.nda_status

  // Échéances : celles calculées en base, plus les indicateurs sans aucune preuve
  const rows = [
    ...deadlines.filter((d) => d.key !== 'ri_l6352_4'),
    ...missing.map((i) => ({ key: `ind_${i.number}`, label: `Indicateur ${i.number} : aucune preuve`, detail: i.short_title, due_date: null, link: `/certification/indicateurs/${i.number}` })),
  ]
  const riPending = deadlines.some((d) => d.key === 'ri_l6352_4')

  const markRi = async () => {
    setBusy(true)
    try { await saveSettings({ ri_l6352_4_checked_at: todayIso() }); await reloadSettings(); toast.success('Contrôle enregistré') } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <section className="card card-flush lg:row-span-2">
        <h2 className="section-title px-4 pt-3 pb-1">Prochaines échéances</h2>
        {rows.length === 0 && <p className="px-4 pb-4 muted text-ui-sm">Aucune échéance pour l'instant.</p>}
        {rows.map((d) => (
          <RowLink key={d.key} to={d.link || '/certification'} title={d.label}
            detail={[d.due_date ? `Avant le ${frDate(d.due_date, { day: 'numeric', month: 'long', year: 'numeric' })}` : null, d.detail].filter(Boolean).join('. ')}
            aside={d.key.startsWith('ind_') ? <StatusBadge status="manquant" /> : <DueBadge date={d.due_date} />} />
        ))}
      </section>

      <Link to="nda" className="card block no-underline text-gray-900 hover:border-gray-300 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="section-title">Déclaration d'activité</span>
          <span className={`badge ${ndaStatus === 'enregistre' ? 'badge-success' : ndaStatus === 'refuse' ? 'badge-danger' : 'badge-warning'}`}>{NDA_STATUS[ndaStatus]}</span>
        </div>
        {hasNda
          ? <p className="text-ui-sm muted">Numéro {organization.nda}{organization.nda_region ? `, région ${organization.nda_region}` : ''}.</p>
          : <>
              <Progress value={((ndaDocs || 0) / NDA_PIECES.length) * 100} />
              <p className="text-ui-sm muted">
                {settings.first_convention_date ? `Première convention signée le ${frDate(settings.first_convention_date)}.` : 'Date de la première convention à saisir.'}
              </p>
            </>}
      </Link>

      <Link to="qualiopi" className="card block no-underline text-gray-900 hover:border-gray-300 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="section-title">Qualiopi</span>
          <span className={`badge ${settings.certified_at ? 'badge-success' : 'badge-neutral'}`}>{settings.certified_at ? `Certifié depuis le ${frDate(settings.certified_at)}` : 'Avant l\'audit initial'}</span>
        </div>
        {evaluated
          ? <>
              <Progress value={applicable.length ? (proved / applicable.length) * 100 : 0} tone="green" />
              <p className="text-ui-sm muted">
                {proved} indicateur{proved > 1 ? 's' : ''} prouvé{proved > 1 ? 's' : ''} sur {applicable.length} applicable{applicable.length > 1 ? 's' : ''}.
                {settings.certifier_name ? ` Certificateur : ${settings.certifier_name}${settings.certifier_status === 'pressenti' ? ' (pressenti)' : ''}.` : ' Certificateur à choisir.'}
              </p>
            </>
          : <p className="text-ui-sm muted">Calcul des indicateurs en cours.</p>}
      </Link>

      {riPending && (
        <section className="card space-y-2 lg:col-span-2 border-amber-400">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="section-title">Règlement intérieur : mentions obligatoires depuis le 27 juin 2026</h2>
            <span className="badge badge-warning">À vérifier</span>
          </div>
          <p className="text-ui-sm text-gray-700">
            L'article L6352-4 du code du travail impose à tout organisme financé par des fonds publics ou mutualisés d'assurer l'égalité de traitement des stagiaires,
            la liberté d'expression et de conscience et la neutralité des enseignements, et de l'inscrire dans son règlement intérieur.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Link to="/qualiopi" className="btn btn-secondary btn-sm">Ouvrir le règlement intérieur <ChevronRight className="w-4 h-4" /></Link>
            {canWrite && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={markRi}>C'est fait</button>}
          </div>
        </section>
      )}

      <Link to="indicateurs" className="btn btn-secondary lg:col-span-2">Voir les {evaluated?.length || ''} indicateurs <ChevronRight className="w-4 h-4" /></Link>
      {evidence && evidence.n.sessionsDone === 0 && (
        <p className="muted text-ui-sm lg:col-span-2">Aucune session terminée : les preuves de mise en oeuvre apparaîtront après la première formation.</p>
      )}
    </div>
  )
}

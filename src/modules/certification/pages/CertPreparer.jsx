// Onglet « Préparer l'audit » : ce qu'il faut pouvoir montrer à l'auditeur, tiré de la pratique réelle
// (opérations faites, sessions complètes), et ce qui reste à reprendre avant l'audit.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, MapPin, AlertTriangle, CheckCircle, ChevronRight, UserCheck } from 'lucide-react'
import { useAuthStore } from '../../../core/store'
import { frDate } from '../lib/certData'
import { DEFAULT_OPERATION_LABELS } from '../../interventions/lib/schedule'
import { ilYa, chargerApsad, chargerQualiopi, chargerQualifies } from '../lib/preparerAudit'

function Bloc({ titre, children, aside }) {
  return (
    <section className="card card-flush">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="section-title">{titre}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

const ETATS_QUALIFIE = {
  valide: { label: 'En cours de validité', badge: 'badge-success' },
  expiree: { label: 'Expirée', badge: 'badge-danger' },
  suspendue: { label: 'Suspendue', badge: 'badge-danger' },
  partie: { label: 'Partie de l\'entreprise', badge: 'badge-warning' },
}

// referentiel : certification suivie en haut du module (APSAD…). Sans lui (Qualiopi), l'écran reste celui d'avant :
// les deux blocs, APSAD sur tout le matériel et sessions Qualiopi.
export default function CertPreparer({ referentiel = null }) {
  const modules = useAuthStore((s) => s.modules) || []
  const [mois, setMois] = useState(12)
  const [apsad, setApsad] = useState(null)
  const [qualiopi, setQualiopi] = useState(null)
  const [qualifies, setQualifies] = useState(undefined)
  const [erreur, setErreur] = useState(null)
  const avecItv = modules.includes('interventions')
  const avecFormation = modules.includes('formation')
  const familles = referentiel?.equipment_families || null
  const voirMateriel = avecItv && (!referentiel || (familles && familles.length > 0))
  const voirSessions = avecFormation && !referentiel

  useEffect(() => {
    let vivant = true
    const depuis = ilYa(mois)
    setApsad(null); setQualiopi(null)
    Promise.all([
      voirMateriel ? chargerApsad(depuis, familles) : Promise.resolve(false),
      voirSessions ? chargerQualiopi(depuis) : Promise.resolve(false),
      referentiel ? chargerQualifies() : Promise.resolve(undefined),
    ]).then(([a, q, p]) => { if (vivant) { setApsad(a); setQualiopi(q); setQualifies(p) } })
      .catch((e) => { if (vivant) setErreur(e.message || String(e)) })
    return () => { vivant = false }
  }, [mois, voirMateriel, voirSessions, referentiel?.code]) // eslint-disable-line react-hooks/exhaustive-deps

  if (erreur) return <div className="card text-[rgb(var(--c-danger))]">Impossible de préparer l'audit : {erreur}</div>
  if (apsad === null || qualiopi === null) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-ui-sm text-gray-600 flex-1 min-w-[16rem]">
          L'auditeur veut voir la pratique réelle : des opérations vraiment faites, des sessions complètes. Il choisit
          lui-même son échantillon : tout ce qui est « à reprendre » peut tomber.
        </p>
        <label className="flex items-center gap-2 text-ui-sm">
          <span>Période</span>
          <select className="select w-auto" value={mois} onChange={(e) => setMois(Number(e.target.value))}>
            <option value={6}>6 derniers mois</option>
            <option value={12}>12 derniers mois</option>
            <option value={24}>24 derniers mois</option>
          </select>
        </label>
      </div>

      {referentiel && qualifies !== undefined && (
        <Bloc titre="Personnes qualifiées" aside={<span className="text-ui-sm muted">{qualifies ? qualifies.filter((q) => q.etat === 'valide').length : 0} en cours de validité</span>}>
          {qualifies === null && <p className="px-4 pb-4 text-ui-sm text-gray-700">Votre profil ne voit pas les dossiers du personnel : demandez à la RH ou à la direction.</p>}
          {qualifies && qualifies.length === 0 && (
            <p className="px-4 pb-4 text-ui-sm text-gray-700">
              Aucun titre « Certification APSAD » dans les dossiers du personnel. L'auditeur vérifie que des personnes
              qualifiées réalisent les prestations : ajoutez leurs titres dans Personnel, fiche de la personne.
            </p>
          )}
          {qualifies?.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {qualifies.map((q) => (
                <li key={q.id} className="px-4 py-3 flex items-start gap-3">
                  <UserCheck className="w-4 h-4 mt-1 text-gray-400 flex-none" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-ui">{q.nom}</div>
                    <div className="text-ui-sm text-gray-600">{[q.label, q.expire ? `jusqu'au ${frDate(q.expire)}` : null].filter(Boolean).join(', ')}</div>
                    {q.etat === 'partie' && <div className="text-ui-sm text-[rgb(var(--c-warning))]">Départ : prévenir le certificateur sous un mois et remplacer la personne sous trois mois.</div>}
                  </div>
                  <span className={`badge ${ETATS_QUALIFIE[q.etat].badge}`}>{ETATS_QUALIFIE[q.etat].label}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>
      )}

      {referentiel && !familles?.length && (
        <div className="card text-ui-sm text-gray-700">
          Ce référentiel ne se rattache à aucune famille de matériel des interventions : la préparation porte sur les
          personnes qualifiées, les exigences et les écarts.
        </div>
      )}

      {apsad && (
        <>
          <Bloc titre={familles?.length ? `Sites à proposer (${familles.join(', ').toLowerCase()} : opérations périodiques faites)` : 'Sites à proposer (opérations périodiques faites)'} aside={<span className="text-ui-sm muted">{apsad.sites.length} site{apsad.sites.length > 1 ? 's' : ''}</span>}>
            {apsad.sites.length === 0 && (
              <p className="px-4 pb-4 text-ui-sm text-gray-700">
                Aucune maintenance additionnelle, révision ni requalification faite sur la période. Sans elles, l'auditeur
                ne peut pas juger la pratique : planifiez les opérations dues plutôt que des remplacements.
              </p>
            )}
            <ul className="divide-y divide-gray-100">
              {apsad.sites.slice(0, 15).map((s) => (
                <li key={s.site_id || s.client_id} className="px-4 py-3 flex items-start gap-3">
                  <MapPin className="w-4 h-4 mt-1 text-gray-400 flex-none" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-ui">{[s.client, s.site].filter(Boolean).join(' · ')}{s.ville ? `, ${s.ville}` : ''}</div>
                    <div className="text-ui-sm text-gray-600">
                      {Object.entries(s.operations).map(([op, n]) => `${n} ${(DEFAULT_OPERATION_LABELS[op] || op).toLowerCase()}`).join(', ')} ; dernière le {frDate(s.dernier)}
                    </div>
                    <div className="text-ui-sm flex gap-2 flex-wrap mt-1">
                      {s.visites.slice(0, 4).map((v) => <Link key={v.id} to={`/interventions/visite/${v.id}`}>{v.reference}</Link>)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Bloc>

          <Bloc titre="Opérations dues non faites" aside={<span className="text-ui-sm muted">{apsad.retards.reduce((t, c) => t + c.dues + c.retard, 0)} appareil(s)</span>}>
            {apsad.retards.length === 0
              ? <p className="px-4 pb-4 text-ui-sm text-gray-700 flex items-center gap-2"><CheckCircle className="w-4 h-4" aria-hidden="true" />Aucune opération périodique en attente.</p>
              : (
                <ul className="divide-y divide-gray-100">
                  {apsad.retards.slice(0, 15).map((c) => (
                    <li key={c.client_id}>
                      <Link to={`/interventions/parc/${c.client_id}`} className="px-4 py-3 flex items-center gap-3 no-underline text-gray-900 hover:bg-gray-50">
                        <span className="flex-1 text-ui">{c.client || 'Client'}</span>
                        {c.retard > 0 && <span className="badge badge-danger">{c.retard} en retard</span>}
                        {c.dues > 0 && <span className="badge badge-warning">{c.dues} cette année</span>}
                        <ChevronRight className="w-4 h-4 text-gray-400" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
          </Bloc>

          {apsad.sansMotif > 0 && (
            <div className="card flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-[rgb(var(--c-warning))] flex-none" aria-hidden="true" />
              <p className="text-ui-sm text-gray-900">
                {apsad.sansMotif} remplacement{apsad.sansMotif > 1 ? 's' : ''} sur la période sans motif écrit (visites clôturées avant la règle du 19/10).
                Retrouvez le motif dans les rapports et notez-le en observation.
              </p>
            </div>
          )}
        </>
      )}

      {qualiopi && (
        <Bloc titre="Sessions terminées : échantillon possible" aside={<span className="text-ui-sm muted">{qualiopi.completes.length} complète{qualiopi.completes.length > 1 ? 's' : ''} sur {qualiopi.total}</span>}>
          {qualiopi.total === 0 && <p className="px-4 pb-4 text-ui-sm text-gray-700">Aucune session terminée sur la période.</p>}
          {qualiopi.aCompleter.length > 0 && (
            <>
              <p className="px-4 pb-2 text-ui-sm text-gray-700">À reprendre avant l'audit (dossiers incomplets) :</p>
              <ul className="divide-y divide-gray-100">
                {qualiopi.aCompleter.slice(0, 20).map((s) => (
                  <li key={s.id}>
                    <Link to={`/sessions/${s.id}`} className="px-4 py-3 flex items-center gap-3 no-underline text-gray-900 hover:bg-gray-50">
                      <span className="flex-1 min-w-0">
                        <span className="text-ui font-semibold">{s.courses?.title || s.reference}</span>
                        <span className="block text-ui-sm text-gray-600">{[s.reference, s.clients?.name, s.end_date ? `fin le ${frDate(s.end_date)}` : null].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="badge badge-warning">{s.alertes} point{s.alertes > 1 ? 's' : ''}</span>
                      <ChevronRight className="w-4 h-4 text-gray-400" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {qualiopi.total > 0 && qualiopi.aCompleter.length === 0 && (
            <p className="px-4 pb-4 text-ui-sm text-gray-700 flex items-center gap-2"><CheckCircle className="w-4 h-4" aria-hidden="true" />Toutes les sessions terminées sont complètes.</p>
          )}
        </Bloc>
      )}

      {!referentiel && !avecItv && !avecFormation && <p className="muted text-ui-sm">Ni Interventions ni Formation n'est actif : rien à préparer ici.</p>}
    </div>
  )
}

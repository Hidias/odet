import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import ChampNir from '../../../core/nir/ChampNir'
import { verifierNir } from '../../../core/nir/verifierNir'

// Espace client et espace entreprise : « Numéros demandés » (0440, décision de H du 22/10). Un salarié qui ne retrouve
// pas son n° de sécurité sociale a signé une autorisation : l'entreprise le saisit ici, vérifié à la frappe (même
// règle que partout), rangé à part par la base et jamais réaffiché. Rien n'est affiché tant qu'aucune demande n'existe.
//   charger() → [{ trainee_id, first_name, last_name, gender, birth_date, course, start_date, demande_le, renseigne }]
//   transmettre(trainee_id, nir) → { fin }

const dateFr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '')

export default function NumerosDemandes({ charger, transmettre }) {
  const [liste, setListe] = useState([])
  const [saisie, setSaisie] = useState({})
  const [envoi, setEnvoi] = useState(null)
  const [erreur, setErreur] = useState({})
  const [faits, setFaits] = useState({})

  const recharger = useCallback(async () => {
    try { const l = await charger(); setListe(Array.isArray(l) ? l : []) } catch { setListe([]) }
  }, [charger])
  useEffect(() => { recharger() }, [recharger])

  // Une demande par salarié (la plus récente) ; les numéros déjà enregistrés restent affichés comme transmis
  const parSalarie = Object.values(liste.reduce((m, d) => (m[d.trainee_id] ? m : { ...m, [d.trainee_id]: d }), {}))
  const enAttente = parSalarie.filter((d) => !d.renseigne && !faits[d.trainee_id])
  if (!parSalarie.length) return null

  const envoyer = async (d) => {
    const v = verifierNir(saisie[d.trainee_id])
    if (!v.ok) { setErreur((e) => ({ ...e, [d.trainee_id]: v.erreurs[0] || 'Numéro à vérifier' })); return }
    setEnvoi(d.trainee_id); setErreur((e) => ({ ...e, [d.trainee_id]: '' }))
    try {
      const r = await transmettre(d.trainee_id, v.nir15)
      setFaits((f) => ({ ...f, [d.trainee_id]: r?.fin || v.nir15.slice(-3) }))
      setSaisie((s) => ({ ...s, [d.trainee_id]: '' }))
    } catch (e) {
      setErreur((x) => ({ ...x, [d.trainee_id]: e.message || 'Enregistrement impossible, réessayez.' }))
    }
    setEnvoi(null)
  }

  return (
    <section className="mb-8 rounded-ui-lg border border-gray-200 bg-white p-4 sm:p-5" aria-labelledby="titre-numeros-demandes">
      <h2 id="titre-numeros-demandes" className="font-display text-base font-semibold text-gray-900 flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-primary-600" aria-hidden="true" />Numéros demandés
        {enAttente.length > 0 && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]">{enAttente.length} à transmettre</span>}
      </h2>
      <p className="text-sm text-gray-600 mt-1">Ces salariés ne retrouvent pas leur numéro de sécurité sociale et vous autorisent à nous le transmettre, pour inscrire leur formation à leur passeport de prévention.</p>
      <ul className="mt-3 divide-y divide-gray-100">
        {parSalarie.map((d) => {
          const fin = faits[d.trainee_id]
          const ok = d.renseigne || fin
          return (
            <li key={d.trainee_id} className="py-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{String(d.last_name || '').toUpperCase()} {d.first_name}</p>
                  <p className="text-xs text-gray-500">{[d.course, d.start_date ? `le ${dateFr(d.start_date)}` : null].filter(Boolean).join(' · ')} · demandé le {dateFr(d.demande_le)}</p>
                </div>
                {ok && <p className="text-sm text-[rgb(var(--c-success))] flex items-center gap-1"><CheckCircle2 className="w-4 h-4" aria-hidden="true" />Numéro transmis{fin ? ` (se termine par ${fin})` : ''}</p>}
              </div>
              {!ok && (
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
                  <ChampNir id={`nir-demande-${d.trainee_id}`} value={saisie[d.trainee_id] || ''} onChange={(v) => setSaisie((s) => ({ ...s, [d.trainee_id]: v }))}
                    ctx={{ gender: d.gender, birth_date: d.birth_date }} placeholder="15 caractères, clé comprise" />
                  <button type="button" className="btn btn-primary h-10 justify-center gap-2" disabled={envoi === d.trainee_id || !verifierNir(saisie[d.trainee_id]).ok} onClick={() => envoyer(d)}>
                    {envoi === d.trainee_id && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}Transmettre
                  </button>
                  {erreur[d.trainee_id] && <p role="alert" className="text-xs text-[rgb(var(--c-danger))] sm:col-span-2">{erreur[d.trainee_id]}</p>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-gray-400 mt-2 flex items-start gap-1.5"><ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />Le numéro est vérifié, rangé à part et ne s'affiche plus jamais en entier. Merci de ne pas l'envoyer par e-mail.</p>
    </section>
  )
}

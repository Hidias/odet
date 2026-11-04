import { useEffect, useState } from 'react'
import { BadgeCheck, Upload, Loader2, CheckCircle2 } from 'lucide-react'
import { callApi } from '../../../core/api'
import { preparerDepot, enBase64 } from '../../../core/fichiers/compression'
import { versIso } from './ParticipantsSession'

// Certificats exigés à l'entrée (0479, CGV formation, fin de l'article 8, décision de H du 04/11) : pour une formation
// comme le MAC SST, le client dépose depuis son espace la copie du certificat de chaque participant et sa date de fin
// de validité. Le fichier est allégé dans le navigateur ; l'organisme est prévenu et vérifie.
// auth : { token, code } (lien et code) ou {} (compte entreprise connecté).

const fmt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')
const masque = (v) => {
  const c = String(v || '').replace(/\D/g, '').slice(0, 8)
  return [c.slice(0, 2), c.slice(2, 4), c.slice(4, 8)].filter(Boolean).join('/')
}

export default function CertificatsEntree({ auth = {}, className = '' }) {
  const [sessions, setSessions] = useState([])
  const [saisie, setSaisie] = useState({})
  const [occupe, setOccupe] = useState(null)
  const [erreur, setErreur] = useState({})

  const charger = () => callApi('/api/documents-client', { ...auth, action: 'certificats_exiges' })
    .then((r) => setSessions(Array.isArray(r?.sessions) ? r.sessions : [])).catch(() => setSessions([]))
  useEffect(() => { charger() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!sessions.length) return null

  const deposer = async (s, p, fichier) => {
    const cle = `${s.session_id}:${p.trainee_id}`
    const iso = versIso(saisie[cle])
    setErreur((e) => ({ ...e, [cle]: '' }))
    if (!iso) { setErreur((e) => ({ ...e, [cle]: 'Indiquez d\'abord la date de fin de validité (JJ/MM/AAAA).' })); return }
    if (!fichier) return
    setOccupe(cle)
    try {
      const prepa = await preparerDepot([fichier])
      await callApi('/api/documents-client', { ...auth, action: 'deposer_certificat', session_id: s.session_id, trainee_id: p.trainee_id, valid_until: iso, pdf_base64: enBase64(prepa.octets) })
      await charger()
    } catch (err) {
      setErreur((e) => ({ ...e, [cle]: err.message || 'Dépôt impossible, réessayez.' }))
    } finally { setOccupe(null) }
  }

  return (
    <section className={`space-y-3 ${className}`} aria-labelledby="certificats-titre">
      <h2 id="certificats-titre" className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
        <BadgeCheck className="w-4 h-4" aria-hidden="true" />Certificats à fournir
      </h2>
      {sessions.map((s) => (
        <div key={s.session_id} className="card p-4">
          <p className="font-medium text-gray-900">{s.course_title}, le {fmt(s.start_date)}</p>
          <p className="text-sm text-gray-600 mt-1">
            Pour chaque participant : la copie de son certificat et sa date de fin de validité, au plus tard 7 jours avant la formation.
            Un certificat expiré depuis plus de {s.tolerance_mois} mois n'est pas accepté : la formation initiale est alors nécessaire.
          </p>
          <ul className="divide-y divide-gray-100 mt-2">
            {s.participants.map((p) => {
              const cle = `${s.session_id}:${p.trainee_id}`
              return (
                <li key={cle} className="py-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="text-sm text-gray-900 sm:min-w-[11rem]">{p.prenom} {(p.nom || '').toUpperCase()}</span>
                  {p.interne && !p.depose ? (
                    <span className="text-sm text-gray-600 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" aria-hidden="true" />Certificat délivré par votre organisme : rien à fournir</span>
                  ) : p.depose ? (
                    <span className="text-sm text-[rgb(var(--c-success))] flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" aria-hidden="true" />Déposé{p.valid_until ? `, fin de validité le ${fmt(p.valid_until)}` : ''}</span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor={`fin-${cle}`}>Fin de validité du certificat</label>
                      <input id={`fin-${cle}`} inputMode="numeric" className="input w-36" placeholder="JJ/MM/AAAA" value={saisie[cle] || ''}
                        onChange={(e) => setSaisie((x) => ({ ...x, [cle]: masque(e.target.value) }))} />
                      <label className={`btn btn-secondary gap-2 cursor-pointer ${occupe === cle ? 'opacity-60 pointer-events-none' : ''}`}>
                        {occupe === cle ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
                        Déposer la copie
                        <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { deposer(s, p, e.target.files?.[0]); e.target.value = '' }} />
                      </label>
                    </div>
                  )}
                  {erreur[cle] && <span className="text-sm text-red-700" role="alert">{erreur[cle]}</span>}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )
}
